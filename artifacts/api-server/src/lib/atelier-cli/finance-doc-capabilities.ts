/**
 * Task #1090 — Riser finance-document pipelines.
 *
 * "Attach invoices & bank statements in Riser and let agents handle
 * them." Four capabilities, all in the `bank` module so the catalog
 * gate strips them from restricted personas and board observers on top
 * of the explicit fp/partner/finance `requiredRoles`:
 *
 *   classify_finance_document     — deterministic, offline classifier
 *                                   (typed kind + confidence; low
 *                                   confidence ⇒ orchestrator asks ONE
 *                                   clarifying question, never guesses)
 *   ingest_supplier_invoice       — attached PDF → AI-prefill → preview
 *                                   card → SAME payables core as the UI
 *                                   upload (dedupe/lock/review states)
 *   import_bank_statement         — attached CSV/Xero export → shared
 *                                   importStatementCore + auto-match →
 *                                   recap + link to recon
 *   save_bank_letter_account      — attached bank letter → shared
 *                                   extraction → entity disambiguation →
 *                                   proposal → bank-account create core
 *
 * NO parsing logic is forked here: commits run through the exact core
 * functions the REST routes use, so chat-ingested documents land in the
 * identical review states with the identical dedupe semantics. A
 * duplicate is reported as "already filed / already imported" — a
 * successful, idempotent outcome — never as an error.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, atelierUsers, atelierBankAccount, atelierLegalEntities } from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { loadAttachment, loadAttachmentBytes } from "./attachments/index.js";
import {
  classifyFinanceDocument,
  detectInvoiceReceiptPairs,
  extractBankLetterFields,
  normalizeParsedLineItems,
  parseSupplierInvoiceText,
  verifyPairedReceipt,
  type FinanceDocKind,
} from "../atelier-finance-docs.js";
import {
  createSupplierInvoiceCore,
  findPartnerFirmByName,
} from "../../routes/atelier/financePayablesRoutes.js";
import {
  createBankAccountCore,
  detectStatementSource,
  importStatementCore,
  storeStatementObject,
} from "../../routes/atelier/bankRoutes.js";
import {
  parsePdfStatementText,
  pdfRowsToCanonicalCsv,
  PDF_STATEMENT_CONFIDENCE_FLOOR,
} from "../bank-parsers/pdf-statement.js";

// ---------------------------------------------------------------------
// Commit-token defense (see .agents/memory/chat-commit-token.md). The
// orchestrator's tool loop executes ANY tool call whose input carries
// `confirm:true`, including one the MODEL fabricates in the first turn —
// the platform two-phase confirm relies on the model returning the
// confirmation envelope. There is now a GLOBAL forged-confirm strip in the
// dispatch loop, but for these founder-sensitive finance writes we ALSO
// keep this HMAC gate as defense-in-depth for callers that reach tool.run
// directly. Phase 1 stamps an HMAC token into the server-persisted
// `pending.input` (the needs_confirmation frame shows only summary+diff,
// never pending.input, so the model never sees the token). Phase 2 commits
// ONLY when the token verifies against the committed fields; a fabricated
// `confirm:true` without the token degrades to the phase-1 preview instead
// of writing. `/confirm` replays the persisted pending.input verbatim, so
// the token survives that path untouched.
// ---------------------------------------------------------------------
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const COMMIT_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
function commitTokenFor(tool: string, input: Record<string, unknown>): string {
  const keys = Object.keys(input)
    .filter((k) => k !== "confirm" && k !== "commitToken")
    .sort();
  const canonical = JSON.stringify(keys.map((k) => [k, input[k]]));
  return createHmac("sha256", COMMIT_SECRET).update(`${tool}\n${canonical}`).digest("hex");
}
/** True only when `confirm:true` arrives with the phase-1-issued token. */
function isVerifiedCommit(tool: string, input: Record<string, unknown>): boolean {
  if (input.confirm !== true) return false;
  const got = typeof input.commitToken === "string" ? input.commitToken : "";
  const want = commitTokenFor(tool, input);
  if (got.length !== want.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(want, "utf8"));
  } catch {
    return false;
  }
}

/** Org finance documents are a finance-leadership surface (Task #1090
 * scope: role clamps unchanged — self-only roles keep receipt-only). */
const FINANCE_DOC_ROLES = ["founding_partner", "partner", "finance"] as const;

/** Classifier confidence below this asks one clarifying question. */
export const CLASSIFY_CONFIDENCE_FLOOR = 0.6;
/** Supplier-invoice AI parse confidence below this forces a review of
 * the prefilled fields via clarification instead of a straight confirm. */
export const INVOICE_PARSE_CONFIDENCE_FLOOR = 0.6;

const KIND_TO_TOOL: Record<FinanceDocKind, string | null> = {
  supplier_invoice: "ingest_supplier_invoice",
  bank_statement: "import_bank_statement",
  bank_letter: "save_bank_letter_account",
  receipt: "ingest_receipts_to_expenses",
  client_billing: null,
  unknown: null,
};

async function loadFullUser(personaId: string, orgId: string) {
  const [row] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, personaId), eq(atelierUsers.orgId, orgId)));
  return row ?? null;
}

function looksLikePdf(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 5).toString("latin1").startsWith("%PDF-");
}

async function loadFinanceAttachment(attachmentId: string, orgId: string) {
  const loaded = await loadAttachment(attachmentId, orgId);
  if (!loaded || loaded.attachment.deletedAt) return null;
  return loaded;
}

/** Task #1250 — load + verify a paired proof-of-payment receipt. Shared by
 * phase 1 (preview) and phase 2 (commit) so both apply the SAME dual gate:
 * the document must classify as a receipt AND print the invoice reference
 * (delimiter-aware exact match; amounts alone never pair). */
async function loadVerifiedPairedReceipt(args: {
  receiptAttachmentId: string;
  invoiceAttachmentId: string;
  orgId: string;
  reference: string;
  amount: number;
}): Promise<
  | { ok: true; fileName: string; mime: string | null; bytes: Buffer; matchedBy: "reference" }
  | { ok: false; errorCode: "receipt_mismatch" | "not_found"; errorMessage: string }
> {
  if (args.receiptAttachmentId === args.invoiceAttachmentId) {
    return {
      ok: false,
      errorCode: "receipt_mismatch",
      errorMessage: "The invoice can't be its own proof of payment — attach the separate payment receipt.",
    };
  }
  const rcpt = await loadFinanceAttachment(args.receiptAttachmentId, args.orgId);
  if (!rcpt) return { ok: false, errorCode: "not_found", errorMessage: "Receipt attachment not found." };
  const verdict = verifyPairedReceipt({
    receiptText: rcpt.extracted?.normalizedText ?? "",
    receiptFileName: rcpt.attachment.fileName,
    invoice: { reference: args.reference, amount: args.amount },
  });
  if (!verdict.ok) {
    return {
      ok: false,
      errorCode: "receipt_mismatch",
      errorMessage:
        verdict.reason === "not_a_receipt"
          ? "That attachment doesn't look like a payment receipt (it classifies as a different document type), so it can't be used as proof of payment."
          : `That receipt doesn't visibly print the invoice reference ${args.reference}, so I can't treat it as proof of payment for this bill (matching totals alone aren't enough).`,
    };
  }
  const bytes = rcpt.attachment.encryptedRef
    ? await loadAttachmentBytes(rcpt.attachment.encryptedRef)
    : null;
  if (!bytes) return { ok: false, errorCode: "not_found", errorMessage: "Receipt file bytes not found." };
  return {
    ok: true,
    fileName: rcpt.attachment.fileName,
    mime: rcpt.attachment.mime ?? null,
    bytes,
    matchedBy: verdict.matchedBy,
  };
}

// -------
// classify_finance_document — deterministic typed classifier.
// -------
defineCapability({
  id: "bank.classify_finance_document",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "bank",
  toolName: "classify_finance_document",
  description:
    "Classify attached finance documents (supplier invoice / bank statement / bank letter / receipt / client billing) with a confidence score, and recommend which ingest tool to run. Low confidence means: ask the user one clarifying question — never guess.",
  slashAliases: { en: ["/classify-doc"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentIds: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    required: ["attachmentIds"],
  },
  isWrite: false,
  twoPhaseConfirm: false,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_DOC_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["what kind of document is this?", "here's a document — handle it"] },
  async run(input, ctx) {
    const ids = (input.attachmentIds as string[]) ?? [];
    const results: Array<Record<string, unknown>> = [];
    const classifiedDocs: Array<{ attachmentId: string; kind: FinanceDocKind; fileName: string | null; text: string }> = [];
    for (const aid of ids) {
      const loaded = await loadFinanceAttachment(aid, ctx.persona.orgId);
      if (!loaded) {
        results.push({ attachmentId: aid, error: "not_found" });
        continue;
      }
      const cls = classifyFinanceDocument({
        text: loaded.extracted?.normalizedText ?? "",
        fileName: loaded.attachment.fileName,
        mime: loaded.attachment.mime,
        docKind: (loaded.extracted?.kind as string | undefined) ?? null,
      });
      const lowConfidence = cls.confidence < CLASSIFY_CONFIDENCE_FLOOR;
      classifiedDocs.push({
        attachmentId: aid,
        kind: lowConfidence ? "unknown" : cls.kind,
        fileName: loaded.attachment.fileName,
        text: loaded.extracted?.normalizedText ?? "",
      });
      results.push({
        attachmentId: aid,
        fileName: loaded.attachment.fileName,
        kind: cls.kind,
        confidence: +cls.confidence.toFixed(2),
        lowConfidence,
        reasons: cls.reasons,
        runnerUp: cls.runnerUp,
        recommendedTool: lowConfidence ? null : KIND_TO_TOOL[cls.kind],
        // Explicit instruction the orchestrator relays: one question, no guessing.
        nextStep: lowConfidence
          ? `Ask the user ONE clarifying question, e.g. "This looks like a ${cls.kind === "unknown" ? "finance document" : cls.kind.replace(/_/g, " ")}${cls.runnerUp ? ` (or possibly a ${cls.runnerUp.replace(/_/g, " ")})` : ""} — is that right?" Do NOT run an ingest tool until confirmed.`
          : KIND_TO_TOOL[cls.kind]
            ? `Run ${KIND_TO_TOOL[cls.kind]} with this attachment.`
            : cls.kind === "client_billing"
              ? "Client billing (outbound invoicing) is handled in the Engagement billing flow — point the user there."
              : "No automated pipeline matches — ask the user what they'd like done with it.",
      });
    }
    // Task #1250 — same-reference invoice+receipt pairs are ONE combined
    // action: file the invoice with the receipt as proof of payment.
    // Reference-token match only (amounts alone never pair); the commit
    // path independently re-verifies via verifyPairedReceipt.
    const pairs = detectInvoiceReceiptPairs(classifiedDocs).map((p) => ({
      ...p,
      nextStep:
        `These two documents are the SAME bill: run ingest_supplier_invoice ONCE with ` +
        `attachmentId=${p.invoiceAttachmentId} and receiptAttachmentId=${p.receiptAttachmentId} ` +
        `so the invoice is filed already-paid with the receipt attached as proof of payment. ` +
        `Do NOT ingest them twice or run a separate receipt tool for the paired receipt.`,
    }));
    const pairedReceipts = new Map(pairs.map((p) => [p.receiptAttachmentId, p.invoiceAttachmentId]));
    for (const r of results) {
      const invId = pairedReceipts.get(String(r.attachmentId));
      if (invId) {
        r.recommendedTool = null;
        r.pairedInvoiceAttachmentId = invId;
        r.nextStep = "Paired with the supplier invoice above — handled by the combined ingest, no standalone action.";
      }
    }
    // Task #1248 — shape-tagged payload so web + mobile render a
    // friendly classification card instead of a raw JSON dump.
    return { ok: true, data: { shape: "doc_classification_card", results, pairs } };
  },
});

// -------
// ingest_supplier_invoice — chat PDF → payables review flow.
// -------
defineCapability({
  id: "bank.ingest_supplier_invoice",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "bank",
  toolName: "ingest_supplier_invoice",
  description:
    "File an attached supplier-invoice PDF into the payables review queue (same dedupe and review states as the Finance UI upload). Prefills supplier/amount/reference from the document; the user confirms before anything is written.",
  slashAliases: { en: ["/file-invoice", "/supplier-invoice"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: { type: "string" },
      receiptAttachmentId: {
        type: "string",
        description:
          "Optional paired payment receipt (from classify_finance_document pairs). The invoice is then recorded already-paid with the receipt attached as proof.",
      },
      supplierName: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string" },
      reference: { type: "string" },
      invoiceDate: { type: "string" },
      periodLabel: { type: "string" },
      notes: { type: "string" },
      lineItems: { type: "array" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentId"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_DOC_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["file this supplier invoice", "/file-invoice"] },
  async run(input, ctx) {
    const attachmentId = String(input.attachmentId ?? "");
    const loaded = await loadFinanceAttachment(attachmentId, ctx.persona.orgId);
    if (!loaded) {
      return { ok: false, errorCode: "not_found", errorMessage: "Attachment not found." };
    }
    const bytes = loaded.attachment.encryptedRef
      ? await loadAttachmentBytes(loaded.attachment.encryptedRef)
      : null;
    if (!bytes || !looksLikePdf(bytes)) {
      return {
        ok: false,
        errorCode: "pdf_required",
        errorMessage: "Supplier invoices must be PDF files — this attachment isn't a readable PDF.",
      };
    }

    const str = (v: unknown, max: number): string | null =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
    let supplierName = str(input.supplierName, 200);
    let amount =
      typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount : null;
    let currency = str(input.currency, 3)?.toUpperCase() ?? null;
    let reference = str(input.reference, 100);
    let invoiceDate = str(input.invoiceDate, 10);
    let periodLabel = str(input.periodLabel, 60);
    const notes = str(input.notes, 2000);
    const receiptAttachmentId = str(input.receiptAttachmentId, 100);
    // Pin-supplied (phase 2) or model-supplied itemization; the parse below
    // may fill it in phase 1. Always normalized so preview and commit agree.
    let lineItems = normalizeParsedLineItems(input.lineItems);

    // Phase 1 only: prefill missing fields from the document text via
    // the shared AI parser. Fail-soft — a parse failure degrades to a
    // clarification asking for the fields, never a dead end and never
    // a guessed value.
    let parseConfidence: number | null = null;
    // Defense-in-depth: only a `confirm:true` carrying the phase-1 HMAC
    // token commits; anything else (incl. a model-forged confirm) degrades
    // to the phase-1 preview below.
    if (!isVerifiedCommit("ingest_supplier_invoice", input)) {
      const needParse = !supplierName || amount == null || !currency || !reference;
      const text = (loaded.extracted?.normalizedText ?? "").trim();
      if (needParse && text.length >= 40) {
        const parsed = await parseSupplierInvoiceText({
          text,
          contextLabel: `Attachment file name: ${loaded.attachment.fileName}`,
        });
        if (parsed.ok) {
          parseConfidence = parsed.confidence;
          supplierName = supplierName ?? parsed.fields.supplierName;
          amount = amount ?? parsed.fields.amount;
          currency = currency ?? parsed.fields.currency;
          reference = reference ?? parsed.fields.reference;
          invoiceDate = invoiceDate ?? parsed.fields.invoiceDate;
          periodLabel = periodLabel ?? parsed.fields.periodLabel;
          lineItems = lineItems ?? parsed.fields.lineItems;
        }
      }
      const missing: Array<{ field: string; label: string; hint?: string }> = [];
      if (!supplierName) missing.push({ field: "supplierName", label: "Supplier name" });
      if (amount == null || amount <= 0)
        missing.push({ field: "amount", label: "Total amount", hint: "total payable incl. VAT" });
      if (!currency || !/^[A-Z]{3}$/.test(currency))
        missing.push({ field: "currency", label: "Currency", hint: "e.g. AED, USD" });
      if (!reference) missing.push({ field: "reference", label: "Invoice reference / number" });
      const partial: Record<string, unknown> = { attachmentId };
      if (supplierName) partial.supplierName = supplierName;
      if (amount != null) partial.amount = amount;
      if (currency) partial.currency = currency;
      if (reference) partial.reference = reference;
      if (invoiceDate) partial.invoiceDate = invoiceDate;
      if (periodLabel) partial.periodLabel = periodLabel;
      if (notes) partial.notes = notes;
      if (missing.length > 0) {
        return {
          ok: true,
          data: { partial, parseConfidence },
          clarification: {
            field: missing[0].field,
            question:
              parseConfidence == null
                ? `I couldn't read ${missing.map((m) => m.label.toLowerCase()).join(", ")} from the document — please provide ${missing.length > 1 ? "them" : "it"}.`
                : `I read the invoice but couldn't confidently find ${missing.map((m) => m.label.toLowerCase()).join(", ")} — please provide ${missing.length > 1 ? "them" : "it"} (I never guess amounts).`,
            tool: "ingest_supplier_invoice",
            partial,
            fields: missing,
          },
        };
      }
      // All fields present but the parse itself was shaky and the user
      // typed none of them — surface the values for correction first.
      const userProvided =
        input.supplierName != null || input.amount != null || input.reference != null;
      if (parseConfidence != null && parseConfidence < INVOICE_PARSE_CONFIDENCE_FLOOR && !userProvided) {
        return {
          ok: true,
          data: { partial, parseConfidence },
          clarification: {
            field: "supplierName",
            question: `I'm not fully confident in what I read (confidence ${(parseConfidence * 100).toFixed(0)}%): ${supplierName}, ${currency} ${amount}, ref ${reference}. Please correct anything that's wrong, or re-enter the values.`,
            tool: "ingest_supplier_invoice",
            partial,
            fields: [
              { field: "supplierName", label: "Supplier name", defaultValue: supplierName ?? undefined },
              { field: "amount", label: "Total amount", defaultValue: amount != null ? String(amount) : undefined },
              { field: "currency", label: "Currency", defaultValue: currency ?? undefined },
              { field: "reference", label: "Invoice reference", defaultValue: reference ?? undefined },
            ],
          },
        };
      }
      // Paired proof-of-payment receipt: verify the dual gate BEFORE
      // showing a confirmation — a mismatch is refused, never downgraded
      // to a silent unpaired filing.
      let receiptSummary = "";
      if (receiptAttachmentId) {
        const rv = await loadVerifiedPairedReceipt({
          receiptAttachmentId,
          invoiceAttachmentId: attachmentId,
          orgId: ctx.persona.orgId,
          reference: reference!,
          amount: amount!,
        });
        if (!rv.ok) return { ok: false, errorCode: rv.errorCode, errorMessage: rv.errorMessage };
        receiptSummary = ` A matching payment receipt (${rv.fileName}) is attached as proof of payment — the invoice will be recorded as PAID and will skip the approval/payment queue.`;
      }
      const itemsSummary = lineItems
        ? ` Captured ${lineItems.length} printed line item${lineItems.length === 1 ? "" : "s"} from the document.`
        : " No itemizable line rows are printed on the document, so no itemization is stored.";
      // Registered-firm link parity: exact case-insensitive name match
      // only (same as picking the firm in the UI selector); no fuzzy
      // guessing. New/unmatched suppliers stay unlinked.
      const firm = await findPartnerFirmByName(ctx.persona.orgId, supplierName!);
      return {
        ok: true,
        // Task #1248 — shape-tagged friendly preview (no raw ids). The
        // legacy `preview` key is kept for session-fact ingestion.
        data: {
          shape: "supplier_invoice_card",
          stage: "preview",
          supplierName,
          amount,
          currency,
          reference,
          ...(invoiceDate ? { invoiceDate } : {}),
          ...(periodLabel ? { periodLabel } : {}),
          linkedFirm: firm ? { name: firm.name, hasBankDetails: firm.hasBankDetails } : null,
          status: "pending confirmation",
          preview: partial,
        },
        confirmation: {
          summary: `File supplier invoice ${reference} from ${supplierName} — ${currency} ${amount!.toFixed(2)}${firm ? ` (linked to registered firm ${firm.name}${firm.hasBankDetails ? "" : "; approval will hold until firm bank details are on file"})` : " (unregistered supplier — no firm link)"}?${itemsSummary}${receiptSummary}${receiptAttachmentId ? "" : " It lands in the payables review queue for approval."}`,
          diff: {
            create: {
              table: "atelier_partner_firm_invoices",
              values: {
                supplierName, reference, amount, currency,
                invoiceDate, periodLabel, partnerFirmId: firm?.id ?? null,
                status: "submitted", source: "internal_upload",
              },
            },
          },
          pending: {
            tool: "ingest_supplier_invoice",
            input: (() => {
              const pin: Record<string, unknown> = {
                attachmentId, supplierName, amount, currency, reference,
                ...(invoiceDate ? { invoiceDate } : {}),
                ...(periodLabel ? { periodLabel } : {}),
                ...(notes ? { notes } : {}),
                ...(receiptAttachmentId ? { receiptAttachmentId } : {}),
                ...(lineItems ? { lineItems } : {}),
                confirm: true,
              };
              pin.commitToken = commitTokenFor("ingest_supplier_invoice", pin);
              return pin;
            })(),
          },
        },
      };
    }

    // Phase 2 — commit through the SAME core as the UI upload.
    const me = await loadFullUser(ctx.persona.id, ctx.persona.orgId);
    if (!me) return { ok: false, errorCode: "not_found", errorMessage: "User not found." };
    if (!supplierName || amount == null || !currency || !reference) {
      return {
        ok: false,
        errorCode: "missing_fields",
        errorMessage: "Supplier, amount, currency and reference are required to file the invoice.",
      };
    }
    const firm = await findPartnerFirmByName(me.orgId, supplierName);
    // Paired receipt: re-verify the dual gate AT COMMIT TIME (never trust
    // the pinned input alone) so the preview and the write always agree.
    let paymentReceipt: { fileBuffer: Buffer; fileName: string; mime?: string | null; matchedBy: "reference" } | null = null;
    if (receiptAttachmentId) {
      const rv = await loadVerifiedPairedReceipt({
        receiptAttachmentId,
        invoiceAttachmentId: attachmentId,
        orgId: me.orgId,
        reference,
        amount,
      });
      if (!rv.ok) return { ok: false, errorCode: rv.errorCode, errorMessage: rv.errorMessage };
      paymentReceipt = { fileBuffer: rv.bytes, fileName: rv.fileName, mime: rv.mime, matchedBy: rv.matchedBy };
    }
    const out = await createSupplierInvoiceCore({
      me,
      fileBuffer: bytes,
      fileName: loaded.attachment.fileName,
      supplierName,
      amount,
      currency,
      reference,
      invoiceDate,
      periodLabel,
      notes,
      partnerFirmId: firm?.id ?? null,
      lineItems,
      paymentReceipt,
      via: "chat",
    });
    const navigateTo = { path: "/finance/payables/supplier-invoices", when: "on_commit" as const };
    if (out.status === 201) {
      // Task #1248 — shape-tagged friendly commit card + a closing
      // narration line the confirm path emits after the card, so the
      // turn never ends on a bare card (or raw JSON with spi_* ids).
      const closingLine = paymentReceipt
        ? `Recorded supplier invoice from ${supplierName} — ${currency} ${amount.toFixed(2)}${periodLabel ? `, ${periodLabel}` : ""} as PAID, with the payment receipt attached as proof. It won't enter the payment queue.`
        : `Recorded supplier invoice from ${supplierName} — ${currency} ${amount.toFixed(2)}${periodLabel ? `, ${periodLabel}` : ""}. It's in the payables review queue.${firm && !firm.hasBankDetails ? " Approval will hold until the firm's bank details are on file." : ""}`;
      return {
        ok: true,
        data: {
          shape: "supplier_invoice_card",
          stage: "committed",
          supplierName,
          amount,
          currency,
          reference,
          ...(invoiceDate ? { invoiceDate } : {}),
          ...(periodLabel ? { periodLabel } : {}),
          status: paymentReceipt ? "paid" : "submitted",
          item: (out.body as { item?: unknown }).item,
          linkedFirm: firm ? { id: firm.id, name: firm.name, hasBankDetails: firm.hasBankDetails } : null,
          message: paymentReceipt
            ? `Invoice ${reference} from ${supplierName} is recorded as PAID with the receipt attached as proof of payment — it will not enter the payment queue.`
            : `Invoice ${reference} from ${supplierName} is in the payables review queue (status: submitted).${firm && !firm.hasBankDetails ? " Note: approval will hold until the firm's bank details are on file." : ""}`,
          closingLine,
          navigateTo,
        },
      };
    }
    if (out.status === 409) {
      // Idempotent outcome, not an error: the invoice is already filed.
      const body = out.body as { message?: string; existing?: unknown };
      const message = body.message ?? "This invoice was already filed — nothing new was created.";
      return {
        ok: true,
        data: {
          shape: "supplier_invoice_card",
          stage: "committed",
          alreadyFiled: true,
          supplierName,
          amount,
          currency,
          reference,
          ...(periodLabel ? { periodLabel } : {}),
          status: "already filed",
          existing: body.existing ?? null,
          message,
          closingLine: message,
          navigateTo,
        },
      };
    }
    return {
      ok: false,
      errorCode: String((out.body as { error?: string }).error ?? "failed"),
      errorMessage: String(
        (out.body as { message?: string }).message ?? "The invoice could not be filed.",
      ),
    };
  },
});

// -------
// import_bank_statement — chat CSV/Xero export → import + auto-match.
// -------
defineCapability({
  id: "bank.import_bank_statement",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "bank",
  toolName: "import_bank_statement",
  description:
    "Import an attached bank statement (CSV, Xero export, or PDF) into a bank account and auto-run transaction matching — same pipeline as the Cash & Bank import page. PDF statements go through guarded table extraction with per-row confidence: the parsed rows are always previewed before import, and a low-confidence PDF is refused with CSV-export guidance instead of guessed. Reconciliation sign-off stays with founders.",
  slashAliases: { en: ["/import-statement", "/bank-statement"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: { type: "string" },
      bankAccountId: { type: "string" },
      statementDate: { type: "string", description: "YYYY-MM-DD statement date; defaults to today" },
      notes: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentId"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_DOC_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["import this bank statement", "/import-statement"] },
  async run(input, ctx) {
    const attachmentId = String(input.attachmentId ?? "");
    const loaded = await loadFinanceAttachment(attachmentId, ctx.persona.orgId);
    if (!loaded) {
      return { ok: false, errorCode: "not_found", errorMessage: "Attachment not found." };
    }
    const bytes = loaded.attachment.encryptedRef
      ? await loadAttachmentBytes(loaded.attachment.encryptedRef)
      : null;
    if (!bytes || bytes.length === 0) {
      return { ok: false, errorCode: "file_missing", errorMessage: "The attachment bytes could not be loaded." };
    }
    // Task #1094 — PDF statements are accepted through GUARDED extraction:
    // date-anchored row segmentation with per-row confidence; rows with
    // ambiguous amounts or unclear direction are flagged (never guessed); a
    // low overall confidence refuses with the CSV-export fallback. The
    // extraction gate runs BEFORE the bank-account clarification so an
    // unparseable PDF gets the CSV guidance immediately instead of a
    // pointless account question.
    const isPdf =
      looksLikePdf(bytes) ||
      loaded.attachment.mime === "application/pdf" ||
      /\.pdf$/i.test(loaded.attachment.fileName);
    const pdfText = isPdf ? (loaded.extracted?.normalizedText ?? "").trim() : "";
    let raw = "";
    if (isPdf) {
      const gate = parsePdfStatementText(pdfText);
      if (gate.rows.length === 0 || gate.confidence < PDF_STATEMENT_CONFIDENCE_FLOOR) {
        return {
          ok: false,
          errorCode: "pdf_low_confidence",
          errorMessage: `I couldn't confidently extract transaction rows from this PDF${gate.flagged.length > 0 ? ` (${gate.flagged.length} candidate row(s) were too ambiguous to trust — I never guess amounts)` : ""} — export a CSV from your bank and attach that instead.`,
        };
      }
    } else {
      raw = bytes.toString("utf8");
      if (!raw.trim()) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "The attached file is empty." };
      }
    }

    const accounts = await db
      .select()
      .from(atelierBankAccount)
      .where(and(eq(atelierBankAccount.orgId, ctx.persona.orgId), isNull(atelierBankAccount.deletedAt)));
    if (accounts.length === 0) {
      return {
        ok: false,
        errorCode: "no_bank_accounts",
        errorMessage: "No bank accounts are registered yet — add one under Finance → Entities before importing statements.",
      };
    }
    let bankAccountId = typeof input.bankAccountId === "string" ? input.bankAccountId : "";
    if (bankAccountId && !accounts.some((a) => a.id === bankAccountId)) {
      return { ok: false, errorCode: "not_found", errorMessage: "That bank account was not found." };
    }
    if (!bankAccountId) {
      if (accounts.length === 1) {
        bankAccountId = accounts[0].id;
      } else {
        return {
          ok: true,
          data: { partial: { attachmentId } },
          clarification: {
            field: "bankAccountId",
            question: "Which bank account is this statement for?",
            tool: "import_bank_statement",
            partial: { attachmentId, ...(typeof input.statementDate === "string" ? { statementDate: input.statementDate } : {}) },
            suggestions: accounts.map((a) => ({
              id: a.id,
              label: `${a.accountLabel} (${a.bankName}, ${a.currency})`,
            })),
            fields: [
              {
                field: "bankAccountId",
                label: "Bank account",
                options: accounts.map((a) => a.id),
              },
            ],
          },
        };
      }
    }
    const acct = accounts.find((a) => a.id === bankAccountId)!;
    const statementDate =
      typeof input.statementDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.statementDate)
        ? input.statementDate
        : new Date().toISOString().slice(0, 10);

    // PDF path: re-parse with the account's currency as default (the parser
    // is deterministic, so phase 1 and phase 2 see identical rows and the
    // canonical-CSV dedupe hash is stable), then serialise the importable
    // rows into the canonical CSV the SHARED importStatementCore consumes —
    // identical dedupe and audit behavior to a CSV upload.
    let pdfMeta: {
      rowsExtracted: number;
      flaggedRows: number;
      confidence: number;
      rows: Array<Record<string, unknown>>;
      flagged: Array<Record<string, unknown>>;
    } | null = null;
    let source: "csv" | "xero";
    if (isPdf) {
      const parsed = parsePdfStatementText(pdfText, acct.currency);
      if (parsed.rows.length === 0 || parsed.confidence < PDF_STATEMENT_CONFIDENCE_FLOOR) {
        // Currency default cannot raise confidence, but keep the guard.
        return {
          ok: false,
          errorCode: "pdf_low_confidence",
          errorMessage:
            "I couldn't confidently extract transaction rows from this PDF — export a CSV from your bank and attach that instead.",
        };
      }
      raw = pdfRowsToCanonicalCsv(parsed.rows);
      source = "csv";
      pdfMeta = {
        rowsExtracted: parsed.rows.length,
        flaggedRows: parsed.flagged.length,
        confidence: parsed.confidence,
        rows: parsed.rows.slice(0, 25).map((r) => ({
          postedDate: r.postedDate,
          amount: r.amount,
          currency: r.currency,
          counterparty: r.counterpartyNameRaw,
          reference: r.referenceRaw,
          kind: r.kind,
          confidence: r.confidence,
        })),
        flagged: parsed.flagged.slice(0, 10).map((f) => ({
          snippet: f.snippet,
          reason: f.reason,
        })),
      };
    } else {
      source = detectStatementSource(raw);
    }
    const lineCount = raw.split(/\r?\n/).filter((l) => l.trim()).length;

    // Defense-in-depth: only a token-verified commit writes (see the
    // commit-token helper above); a forged confirm degrades to preview.
    if (!isVerifiedCommit("import_bank_statement", input)) {
      const summary = pdfMeta
        ? `Import ${loaded.attachment.fileName} (PDF — ${pdfMeta.rowsExtracted} extracted transaction row(s) shown in the preview${pdfMeta.flaggedRows > 0 ? `; ${pdfMeta.flaggedRows} low-confidence row(s) flagged and SKIPPED, not guessed` : ""}) into ${acct.accountLabel} (${acct.bankName}, ${acct.currency}) dated ${statementDate}, then auto-match transactions? Review the parsed rows before confirming — reconciliation sign-off stays with you.`
        : `Import ${loaded.attachment.fileName} (~${Math.max(0, lineCount - 1)} rows, ${source} format) into ${acct.accountLabel} (${acct.bankName}, ${acct.currency}) dated ${statementDate}, then auto-match transactions? Reconciliation sign-off stays with you.`;
      return {
        ok: true,
        data: {
          preview: {
            bankAccountId,
            statementDate,
            source: isPdf ? "pdf" : source,
            lineCount,
            ...(pdfMeta ? { pdf: pdfMeta } : {}),
          },
        },
        confirmation: {
          summary,
          diff: {
            create: {
              table: "atelier_bank_statement_import",
              values: { bankAccountId, statementDate, source, fileName: loaded.attachment.fileName },
            },
          },
          pending: {
            tool: "import_bank_statement",
            input: (() => {
              const pin: Record<string, unknown> = {
                attachmentId, bankAccountId, statementDate,
                ...(typeof input.notes === "string" && input.notes.trim() ? { notes: input.notes.trim() } : {}),
                confirm: true,
              };
              pin.commitToken = commitTokenFor("import_bank_statement", pin);
              return pin;
            })(),
          },
        },
      };
    }

    // Phase 2 — same durable-storage precondition + core as the REST route.
    const me = await loadFullUser(ctx.persona.id, ctx.persona.orgId);
    if (!me) return { ok: false, errorCode: "not_found", errorMessage: "User not found." };
    ctx.progress?.(20, "Storing the original statement file…");
    let stored: Awaited<ReturnType<typeof storeStatementObject>>;
    try {
      stored = await storeStatementObject(
        bytes,
        loaded.attachment.fileName || (isPdf ? "statement.pdf" : "statement.csv"),
        loaded.attachment.mime || (isPdf ? "application/pdf" : "text/csv"),
      );
    } catch (err) {
      return {
        ok: false,
        errorCode: "storage_unavailable",
        errorMessage:
          "Could not store the statement file — nothing was imported. Please retry in a moment.",
      };
    }
    ctx.progress?.(50, "Importing rows and running the transaction matcher…");
    const out = await importStatementCore({
      me,
      bankAccountId,
      source,
      raw,
      statementDate,
      notes: typeof input.notes === "string" ? input.notes : null,
      fileUrl: stored.fileUrl,
    });
    if (out.status !== 200) await stored.removeObject();
    const navigateTo = { path: "/wallet/cash/recon", when: "on_commit" as const };
    if (out.status === 200) {
      const data = (out.body as { data?: Record<string, unknown> }).data ?? {};
      const matcher = data.matcher as { status?: string; summary?: unknown } | undefined;
      return {
        ok: true,
        data: {
          importId: data.importId ?? null,
          rowsImported: data.rowsImported ?? 0,
          parseErrors: data.errors ?? [],
          matcher: matcher ?? null,
          message: `Imported ${data.rowsImported ?? 0} rows into ${acct.accountLabel} and ran auto-matching${matcher?.status === "failed" ? " (the matcher hit an error — review matches manually)" : ""}.${pdfMeta && pdfMeta.flaggedRows > 0 ? ` ${pdfMeta.flaggedRows} low-confidence PDF row(s) were skipped, not guessed — add them manually or import a CSV export.` : ""} Review and reconcile when ready.`,
          navigateTo,
        },
      };
    }
    if (out.status === 409) {
      // Idempotent: the statement was imported before. Not an error.
      return {
        ok: true,
        data: {
          alreadyImported: true,
          importId: (out.body as { importId?: string }).importId ?? null,
          message: "This statement file was already imported — nothing new was created.",
          navigateTo,
        },
      };
    }
    return {
      ok: false,
      errorCode: String((out.body as { error?: string }).error ?? "failed"),
      errorMessage: String(
        (out.body as { message?: string }).message ?? "The statement could not be imported.",
      ),
    };
  },
});

// -------
// save_bank_letter_account — chat bank letter → entity bank account.
// -------
defineCapability({
  id: "bank.save_bank_letter_account",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "bank",
  toolName: "save_bank_letter_account",
  description:
    "Digitize an attached bank letter (IBAN letter / account confirmation) with the same extraction the Finance Entities page uses, and — after review — save the proposed bank account against a legal entity. Finance leadership only.",
  slashAliases: { en: ["/bank-letter"] },
  inputSchema: {
    type: "object",
    properties: {
      attachmentId: { type: "string" },
      legalEntityId: { type: "string" },
      bankName: { type: "string" },
      accountHolderName: { type: "string" },
      iban: { type: "string" },
      accountNumber: { type: "string" },
      swift: { type: "string" },
      currency: { type: "string" },
      accountLabel: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["attachmentId"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_DOC_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["save the bank details from this letter", "/bank-letter"] },
  async run(input, ctx) {
    const attachmentId = String(input.attachmentId ?? "");
    const loaded = await loadFinanceAttachment(attachmentId, ctx.persona.orgId);
    if (!loaded) {
      return { ok: false, errorCode: "not_found", errorMessage: "Attachment not found." };
    }

    const entities = await db
      .select({ id: atelierLegalEntities.id, legalNameEn: atelierLegalEntities.legalNameEn })
      .from(atelierLegalEntities)
      .where(eq(atelierLegalEntities.orgId, ctx.persona.orgId));
    let legalEntityId = typeof input.legalEntityId === "string" ? input.legalEntityId : "";
    if (legalEntityId && !entities.some((e) => e.id === legalEntityId)) {
      return { ok: false, errorCode: "not_found", errorMessage: "That legal entity was not found." };
    }

    const str = (v: unknown, max: number): string | null =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

    // Defense-in-depth: only a token-verified commit writes (see the
    // commit-token helper above); a forged confirm degrades to preview.
    if (!isVerifiedCommit("save_bank_letter_account", input)) {
      // Entity disambiguation BEFORE the (slow) extraction call.
      if (!legalEntityId) {
        if (entities.length === 1) {
          legalEntityId = entities[0].id;
        } else if (entities.length > 1) {
          return {
            ok: true,
            data: { partial: { attachmentId } },
            clarification: {
              field: "legalEntityId",
              question: "Which legal entity does this bank account belong to?",
              tool: "save_bank_letter_account",
              partial: { attachmentId },
              suggestions: entities.map((e) => ({ id: e.id, label: e.legalNameEn })),
              fields: [
                { field: "legalEntityId", label: "Legal entity", options: entities.map((e) => e.id) },
              ],
            },
          };
        }
        // Zero entities: the account can still be saved unlinked.
      }
      const text = (loaded.extracted?.normalizedText ?? "").trim();
      if (text.length < 40) {
        return {
          ok: false,
          errorCode: "document_unreadable",
          errorMessage:
            "No usable text could be extracted from this document (scanned image without embedded text?). Upload a digital PDF of the letter.",
        };
      }
      const entity = entities.find((e) => e.id === legalEntityId) ?? null;
      const out = await extractBankLetterFields({
        text,
        contextLabel: `Attachment file name: ${loaded.attachment.fileName}${entity ? `\nLegal entity: ${entity.legalNameEn}` : ""}`,
      });
      if (!out.ok) {
        return { ok: false, errorCode: out.errorCode, errorMessage: out.errorMessage };
      }
      // User-supplied overrides beat extracted values (correction path).
      const f = out.fields;
      const bankName = str(input.bankName, 200) ?? f.bankName;
      const accountHolderName = str(input.accountHolderName, 200) ?? f.accountHolderName;
      const iban = (str(input.iban, 64) ?? f.iban)?.replace(/\s+/g, "").toUpperCase() ?? null;
      const accountNumber = str(input.accountNumber, 64) ?? f.accountNumber;
      const swift = (str(input.swift, 16) ?? f.swift)?.replace(/\s+/g, "").toUpperCase() ?? null;
      const currency = (str(input.currency, 3) ?? f.currency)?.toUpperCase() ?? null;
      const missing: Array<{ field: string; label: string; hint?: string }> = [];
      if (!bankName) missing.push({ field: "bankName", label: "Bank name" });
      if (!iban && !accountNumber)
        missing.push({ field: "iban", label: "IBAN (or account number)", hint: "as printed on the letter" });
      const partial: Record<string, unknown> = { attachmentId };
      if (legalEntityId) partial.legalEntityId = legalEntityId;
      if (bankName) partial.bankName = bankName;
      if (accountHolderName) partial.accountHolderName = accountHolderName;
      if (iban) partial.iban = iban;
      if (accountNumber) partial.accountNumber = accountNumber;
      if (swift) partial.swift = swift;
      if (currency) partial.currency = currency;
      if (missing.length > 0) {
        return {
          ok: true,
          data: { partial, confidenceNote: out.confidenceNote },
          clarification: {
            field: missing[0].field,
            question: `The letter didn't state ${missing.map((m) => m.label.toLowerCase()).join(" and ")} clearly — please provide ${missing.length > 1 ? "them" : "it"} (I never invent bank details).`,
            tool: "save_bank_letter_account",
            partial,
            fields: missing,
          },
        };
      }
      const last4 = (accountNumber ?? iban ?? "").replace(/\s+/g, "").slice(-4);
      const accountLabel =
        str(input.accountLabel, 120) ?? `${bankName} ${currency ?? ""}`.trim();
      return {
        ok: true,
        data: { proposal: { ...partial, accountLabel }, confidenceNote: out.confidenceNote },
        confirmation: {
          summary: `Save bank account for ${entity ? entity.legalNameEn : "the firm (no entity link)"}: ${bankName}${accountHolderName ? `, holder ${accountHolderName}` : ""}, IBAN ${iban ?? "—"}${swift ? `, SWIFT ${swift}` : ""}, ${currency ?? "USD"} (label "${accountLabel}")? Extraction note: ${out.confidenceNote || "n/a"}`,
          diff: {
            create: {
              table: "atelier_bank_account",
              values: {
                legalEntityId: legalEntityId || null, bankName, accountLabel,
                accountNumberLast4: last4, iban, swift, currency: currency ?? "USD",
                accountHolderName,
              },
            },
          },
          pending: {
            tool: "save_bank_letter_account",
            input: (() => {
              const pin: Record<string, unknown> = {
                attachmentId,
                ...(legalEntityId ? { legalEntityId } : {}),
                bankName,
                ...(accountHolderName ? { accountHolderName } : {}),
                ...(iban ? { iban } : {}),
                ...(accountNumber ? { accountNumber } : {}),
                ...(swift ? { swift } : {}),
                ...(currency ? { currency } : {}),
                accountLabel,
                confirm: true,
              };
              pin.commitToken = commitTokenFor("save_bank_letter_account", pin);
              return pin;
            })(),
          },
        },
      };
    }

    // Phase 2 — commit through the SAME core as the wallet UI form.
    const me = await loadFullUser(ctx.persona.id, ctx.persona.orgId);
    if (!me) return { ok: false, errorCode: "not_found", errorMessage: "User not found." };
    const bankName = str(input.bankName, 200);
    const iban = str(input.iban, 64);
    const accountNumber = str(input.accountNumber, 64);
    if (!bankName || (!iban && !accountNumber)) {
      return {
        ok: false,
        errorCode: "missing_fields",
        errorMessage: "Bank name and an IBAN or account number are required.",
      };
    }
    const last4 = (accountNumber ?? iban ?? "").replace(/\s+/g, "").slice(-4);
    const out = await createBankAccountCore({
      me,
      bankName,
      accountLabel: str(input.accountLabel, 120) ?? `${bankName} ${str(input.currency, 3) ?? ""}`.trim(),
      accountNumberLast4: last4,
      currency: str(input.currency, 3)?.toUpperCase() ?? undefined,
      legalEntityId: legalEntityId || undefined,
      iban: iban ?? undefined,
      swift: str(input.swift, 16) ?? undefined,
      accountHolderName: str(input.accountHolderName, 200) ?? undefined,
      via: "chat",
    });
    if (out.status === 200) {
      const id = ((out.body as { data?: { id?: string } }).data ?? {}).id ?? null;
      return {
        ok: true,
        data: {
          bankAccountId: id,
          message: `Bank account saved${legalEntityId ? " and linked to the legal entity" : ""}.`,
          navigateTo: {
            path: legalEntityId ? `/finance/entities/${legalEntityId}` : "/finance/entities",
            when: "on_commit" as const,
          },
        },
      };
    }
    return {
      ok: false,
      errorCode: String((out.body as { error?: string }).error ?? "failed"),
      errorMessage: String(
        (out.body as { message?: string }).message ?? "The bank account could not be saved.",
      ),
    };
  },
});
