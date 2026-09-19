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

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierBankAccount,
  atelierLegalEntities,
  atelierPartnerFirmInvoices,
} from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { loadAttachment, loadAttachmentBytes } from "./attachments/index.js";
import {
  classifyFinanceDocument,
  detectInvoiceReceiptPairs,
  extractBankLetterFields,
  normalizeParsedLineItems,
  parseSupplierInvoiceDoc,
  receiptMatchesInvoice,
  verifyPairedReceipt,
  type FinanceDocKind,
} from "../atelier-finance-docs.js";
import {
  attachReceiptToSupplierInvoiceCore,
  createSupplierInvoiceCore,
  findPartnerFirmByName,
} from "../../routes/atelier/financePayablesRoutes.js";
import {
  createBankAccountCore,
  detectStatementSource,
  importStatementCore,
  storeStatementObject,
} from "../../routes/atelier/bankRoutes.js";
import { rowsToCanonicalCsv } from "../bank-parsers/index.js";
import { CognidocsError, getCognidocsJob, parseCognidocsDocument } from "../cognidocs/client.js";
import {
  statementRowsFromJob,
  COGNIDOCS_STATEMENT_CONFIDENCE_FLOOR,
} from "../cognidocs/convert.js";

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

// Task #1318 — phase-1 clarification job pin. When a PDF statement parse
// succeeds but phase 1 still needs an answer (e.g. which bank account), the
// clarification partial carries the CogniDocs jobId plus this HMAC so the
// continuation re-fetches the SAME job instead of re-submitting the bytes.
// Without it, a password-unlocked PDF would re-fail pdf_password_required on
// the continuation (the password is deliberately never persisted). The HMAC
// binds jobId↔attachmentId so a model-forged jobId can never swap in a
// different document's rows.
function statementJobClarifyToken(jobId: string, attachmentId: string): string {
  return createHmac("sha256", COMMIT_SECRET)
    .update(`stmt-clarify\n${jobId}\n${attachmentId}`)
    .digest("hex");
}
function verifyStatementJobClarifyToken(jobId: string, attachmentId: string, got: unknown): boolean {
  if (typeof got !== "string" || !got) return false;
  const want = statementJobClarifyToken(jobId, attachmentId);
  if (got.length !== want.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(want, "utf8"));
  } catch {
    return false;
  }
}

/** Task #1318 — transient PDF password from the tool input (top-level, the
 * clarification answer merge point). Used for the CogniDocs call only —
 * never pinned, never persisted in partials, never logged. The value is
 * forwarded BYTE-FOR-BYTE: no trim, no cap, no normalization (real PDF
 * passwords may start/end with whitespace); only the empty string is
 * treated as "no password provided". */
function pdfPasswordFrom(input: Record<string, unknown>): string | null {
  const v = input.password;
  return typeof v === "string" && v.length > 0 ? v : null;
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

/** Task #1260 — find live already-ingested supplier invoices whose printed
 * reference the receipt text visibly matches (receiptMatchesInvoice: exact
 * delimiter-aware reference match; amounts alone deliberately never pair).
 * Shared by classify (recommendation) and attach_payment_receipt (both
 * phases) so preview and commit always agree. Rejected rows are excluded;
 * paid rows are kept so a duplicate re-attach reports idempotently. */
async function findInvoicesMatchingReceipt(
  orgId: string,
  receiptText: string,
): Promise<Array<typeof atelierPartnerFirmInvoices.$inferSelect>> {
  const rows = await db
    .select()
    .from(atelierPartnerFirmInvoices)
    .where(
      and(
        eq(atelierPartnerFirmInvoices.orgId, orgId),
        inArray(atelierPartnerFirmInvoices.source, ["partner_submitted", "internal_upload"]),
        ne(atelierPartnerFirmInvoices.status, "rejected"),
        isNull(atelierPartnerFirmInvoices.deletedAt),
      ),
    );
  return rows.filter(
    (r) =>
      receiptMatchesInvoice(receiptText, { reference: r.reference, amount: r.costAmount }).match,
  );
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
    // Task #1260 — an UNPAIRED receipt may pay an ALREADY-ingested supplier
    // invoice: check the payables ledger for a visible reference match
    // (amounts alone never pair). Exactly one match ⇒ recommend the attach
    // tool; several ⇒ ask which; none ⇒ the receipt stays on the expense path.
    const unpairedReceipts = classifiedDocs.filter(
      (d) => d.kind === "receipt" && !pairedReceipts.has(d.attachmentId),
    );
    for (const rcpt of unpairedReceipts) {
      const matches = await findInvoicesMatchingReceipt(ctx.persona.orgId, rcpt.text);
      if (matches.length === 0) continue;
      const r = results.find((x) => x.attachmentId === rcpt.attachmentId);
      if (!r) continue;
      const describe = (m: (typeof matches)[number]) =>
        `${m.reference ?? m.id} from ${m.partnerFirmName} (${m.costCurrency} ${m.costAmount}, status ${m.status})`;
      if (matches.length === 1) {
        const m = matches[0];
        r.recommendedTool = "attach_payment_receipt";
        r.matchesExistingInvoice = { invoiceId: m.id, reference: m.reference, supplierName: m.partnerFirmName, status: m.status };
        r.nextStep =
          m.status === "paid"
            ? `This receipt prints the reference of ALREADY-PAID invoice ${describe(m)} — run attach_payment_receipt with receiptAttachmentId=${rcpt.attachmentId} and invoiceId=${m.id}; it will report idempotently if this proof is already on file. Do NOT draft a personal expense for it.`
            : `This receipt visibly prints the reference of already-filed invoice ${describe(m)} — run attach_payment_receipt with receiptAttachmentId=${rcpt.attachmentId} and invoiceId=${m.id} to record that bill as paid with this receipt as proof. Do NOT draft a personal expense for it.`;
      } else {
        r.recommendedTool = null;
        r.matchesExistingInvoice = null;
        r.nextStep = `This receipt matches the reference of ${matches.length} filed invoices (${matches.map(describe).join("; ")}) — ask the user which ONE bill it pays before running attach_payment_receipt (a receipt pairs to exactly one invoice).`;
      }
    }
    // Task #1260 — invoice + receipt in the SAME batch with NO reference
    // match must never pair silently: file the invoice unpaid and tell the
    // user WHY the receipt didn't count as proof of payment.
    let pairMismatch: { explanation: string } | null = null;
    const hasInvoice = classifiedDocs.some((d) => d.kind === "supplier_invoice");
    const mismatchedReceipts = unpairedReceipts.filter(
      (d) => !results.some((x) => x.attachmentId === d.attachmentId && x.recommendedTool === "attach_payment_receipt"),
    );
    if (hasInvoice && pairs.length === 0 && mismatchedReceipts.length > 0) {
      pairMismatch = {
        explanation:
          "The uploaded receipt does not visibly print the invoice's reference, so it can't be treated as proof of payment for that bill (matching totals alone are never enough). File the invoice UNPAID into the payables review queue via ingest_supplier_invoice (no receiptAttachmentId), and tell the user the references didn't match — they can re-send the correct receipt or attach it later.",
      };
    }
    // Task #1248 — shape-tagged payload so web + mobile render a
    // friendly classification card instead of a raw JSON dump.
    return { ok: true, data: { shape: "doc_classification_card", results, pairs, ...(pairMismatch ? { pairMismatch } : {}) } };
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
      cognidocsInvoiceId: { type: "string", description: "Internal: parser-issued dedupe pin from phase 1 — never set manually" },
      password: { type: "string", description: "Password for a password-protected PDF (asked via clarification when the parser reports the document is locked) — used once to unlock the document, never stored" },
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

    // Phase 1 only: prefill missing fields from the document via the
    // shared CogniDocs parser (Task #1316 — bytes in, structured fields
    // out). Fail-soft — a parse failure degrades to a clarification
    // asking for the fields, never a dead end and never a guessed value.
    let parseConfidence: number | null = null;
    let parseErrorCode: string | null = null;
    // Task #1316 — CogniDocs' stable invoice id, pinned through phase 2 as
    // an extra dedupe signal (same underlying invoice ⇒ same id).
    let cognidocsInvoiceId: string | null = null;
    // Defense-in-depth: only a `confirm:true` carrying the phase-1 HMAC
    // token commits; anything else (incl. a model-forged confirm) degrades
    // to the phase-1 preview below.
    if (!isVerifiedCommit("ingest_supplier_invoice", input)) {
      const needParse = !supplierName || amount == null || !currency || !reference;
      if (needParse) {
        const parsed = await parseSupplierInvoiceDoc({
          bytes,
          fileName: loaded.attachment.fileName,
          // Task #1318 — transient unlock password from the clarification
          // answer (or a direct model pass-through when the user typed it
          // with the request). Never pinned, never persisted, never logged.
          password: pdfPasswordFrom(input),
        });
        if (parsed.ok) {
          parseConfidence = parsed.confidence;
          cognidocsInvoiceId = parsed.cognidocsInvoiceId ?? null;
          supplierName = supplierName ?? parsed.fields.supplierName;
          amount = amount ?? parsed.fields.amount;
          currency = currency ?? parsed.fields.currency;
          reference = reference ?? parsed.fields.reference;
          invoiceDate = invoiceDate ?? parsed.fields.invoiceDate;
          periodLabel = periodLabel ?? parsed.fields.periodLabel;
          lineItems = lineItems ?? parsed.fields.lineItems;
        } else {
          parseErrorCode = parsed.errorCode;
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
      if (receiptAttachmentId) partial.receiptAttachmentId = receiptAttachmentId;
      // Task #1318 — locked PDF: ask for the password and retry. The
      // clarification partial (persisted in turn frames) deliberately
      // NEVER includes the password — it lives only in the answer merge
      // of the continuation turn.
      if (parseErrorCode === "pdf_password_required" || parseErrorCode === "pdf_password_incorrect") {
        return {
          ok: true,
          data: { partial },
          clarification: {
            field: "password",
            question:
              parseErrorCode === "pdf_password_incorrect"
                ? "That password didn't unlock the PDF — please double-check it and send the exact password again."
                : "This invoice PDF is password-protected. What's the password? I'll use it once to read the document — it is never stored.",
            tool: "ingest_supplier_invoice",
            partial,
            fields: [
              { field: "password", label: "PDF password", hint: "used once to unlock the document; never stored" },
            ],
          },
        };
      }
      if (missing.length > 0) {
        return {
          ok: true,
          data: { partial, parseConfidence },
          clarification: {
            field: missing[0].field,
            question:
              parseConfidence == null
                ? parseErrorCode != null
                  ? `The document couldn't be parsed (${parseErrorCode}). Please try again, or type ${missing.map((m) => m.label.toLowerCase()).join(", ")} yourself.`
                  : `I couldn't read ${missing.map((m) => m.label.toLowerCase()).join(", ")} from the document — please provide ${missing.length > 1 ? "them" : "it"}.`
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
                ...(cognidocsInvoiceId ? { cognidocsInvoiceId } : {}),
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
      // Token-verified pin from phase 1 (never model-forgeable).
      cognidocsInvoiceId: str(input.cognidocsInvoiceId, 200),
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

/** Task #1260 — orchestrator guard helper: classify the turn's attachments
 * and report which are org finance documents (invoice/receipt/statement/
 * letter/client billing). Used to deterministically stop specialist agent
 * launches on finance-doc turns — those documents belong to the finance-doc
 * tools, never a specialist run. Confident classifications only. */
export async function financeDocKindsForAttachments(
  attachmentIds: string[],
  orgId: string,
): Promise<FinanceDocKind[]> {
  const out: FinanceDocKind[] = [];
  for (const id of attachmentIds.slice(0, 10)) {
    const loaded = await loadFinanceAttachment(String(id), orgId);
    if (!loaded) continue;
    const cls = classifyFinanceDocument({
      text: loaded.extracted?.normalizedText ?? "",
      fileName: loaded.attachment.fileName,
      mime: loaded.attachment.mime,
    });
    if (cls.kind !== "unknown" && cls.confidence >= CLASSIFY_CONFIDENCE_FLOOR) {
      out.push(cls.kind);
    }
  }
  return out;
}

// -------
// attach_payment_receipt — Task #1260: a receipt-only upload that pays an
// ALREADY-ingested supplier invoice. Same dual gate as pairing at ingest
// (classifies as a receipt AND visibly prints the invoice reference —
// amount-only match is deliberately insufficient), two-phase confirm, and
// the commit runs through attachReceiptToSupplierInvoiceCore so the row
// flips to paid exactly like a receipt paired at ingest time.
// -------
defineCapability({
  id: "bank.attach_payment_receipt",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "bank",
  toolName: "attach_payment_receipt",
  description:
    "Attach an uploaded payment receipt to an already-filed supplier invoice as proof of payment, recording that bill as paid so it never enters a payment run. The receipt must visibly print the invoice reference (amounts alone never pair, and a receipt pairs to exactly one invoice). Use classify_finance_document first — it recommends this tool with the matching invoiceId.",
  slashAliases: { en: ["/attach-receipt"] },
  inputSchema: {
    type: "object",
    properties: {
      receiptAttachmentId: { type: "string" },
      invoiceId: {
        type: "string",
        description: "The already-filed supplier invoice this receipt pays (from classify_finance_document's matchesExistingInvoice).",
      },
      confirm: { type: "boolean" },
    },
    required: ["receiptAttachmentId"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  irreversible: false,
  outboundChannel: null,
  resultCard: null,
  requiredRoles: [...FINANCE_DOC_ROLES],
  surfaceOn: ["global"],
  examplePhrases: { en: ["this receipt pays the invoice I filed earlier", "/attach-receipt"] },
  async run(input, ctx) {
    const receiptAttachmentId = String(input.receiptAttachmentId ?? "");
    const rcpt = await loadFinanceAttachment(receiptAttachmentId, ctx.persona.orgId);
    if (!rcpt) {
      return { ok: false, errorCode: "not_found", errorMessage: "Receipt attachment not found." };
    }
    const receiptText = rcpt.extracted?.normalizedText ?? "";
    // Gate 1 — the document must classify as a receipt: arbitrary
    // reference-bearing text is not payment evidence.
    const cls = classifyFinanceDocument({
      text: receiptText,
      fileName: rcpt.attachment.fileName,
      mime: rcpt.attachment.mime,
    });
    if (cls.kind !== "receipt") {
      return {
        ok: false,
        errorCode: "receipt_mismatch",
        errorMessage:
          "That attachment doesn't look like a payment receipt (it classifies as a different document type), so it can't be used as proof of payment.",
      };
    }
    // Resolve THE one invoice this receipt pays. An explicit invoiceId is
    // still re-verified against the receipt text; without one, the ledger
    // is searched and exactly one visible reference match is required.
    const requestedInvoiceId = typeof input.invoiceId === "string" && input.invoiceId.trim() ? input.invoiceId.trim() : null;
    let invoice: typeof atelierPartnerFirmInvoices.$inferSelect | null = null;
    if (requestedInvoiceId) {
      const [row] = await db.select().from(atelierPartnerFirmInvoices).where(and(
        eq(atelierPartnerFirmInvoices.id, requestedInvoiceId),
        eq(atelierPartnerFirmInvoices.orgId, ctx.persona.orgId),
        isNull(atelierPartnerFirmInvoices.deletedAt),
      ));
      if (!row) return { ok: false, errorCode: "not_found", errorMessage: "That supplier invoice was not found." };
      const m = receiptMatchesInvoice(receiptText, { reference: row.reference, amount: row.costAmount });
      if (!m.match) {
        return {
          ok: false,
          errorCode: "receipt_mismatch",
          errorMessage: `That receipt doesn't visibly print the invoice reference ${row.reference ?? row.id}, so I can't treat it as proof of payment for this bill (matching totals alone aren't enough).`,
        };
      }
      invoice = row;
    } else {
      const matches = await findInvoicesMatchingReceipt(ctx.persona.orgId, receiptText);
      if (matches.length === 0) {
        return {
          ok: false,
          errorCode: "no_matching_invoice",
          errorMessage:
            "No filed supplier invoice prints a reference this receipt visibly matches — if this was a personal or company-card spend, use the expense flow instead; if the bill hasn't been filed yet, attach the invoice too.",
        };
      }
      if (matches.length > 1) {
        return {
          ok: true,
          data: { partial: { receiptAttachmentId } },
          clarification: {
            field: "invoiceId",
            question: `This receipt matches ${matches.length} filed invoices — which ONE bill does it pay? ${matches.map((m) => `${m.reference ?? m.id} from ${m.partnerFirmName} (${m.costCurrency} ${m.costAmount})`).join("; ")}. A receipt pairs to exactly one invoice.`,
            tool: "attach_payment_receipt",
            partial: { receiptAttachmentId },
            fields: [{ field: "invoiceId", label: "Invoice", hint: "the invoice id or reference" }],
            suggestions: matches.slice(0, 6).map((m) => ({
              id: m.id,
              label: `${m.reference ?? m.id} — ${m.partnerFirmName} (${m.costCurrency} ${m.costAmount}, ${m.status})`,
            })),
          },
        };
      }
      invoice = matches[0];
    }

    const navigateTo = { path: "/finance/payables/supplier-invoices", when: "on_commit" as const };
    if (!isVerifiedCommit("attach_payment_receipt", input)) {
      // Idempotent preview: the same receipt already attached is a
      // successful outcome — say so without a pointless confirm.
      const receiptSha = rcpt.attachment.sha256 ?? null;
      if (invoice.status === "paid" && invoice.paymentReceipt && receiptSha && invoice.paymentReceipt.sha256 === receiptSha) {
        return {
          ok: true,
          data: {
            shape: "supplier_invoice_card",
            stage: "committed",
            alreadyAttached: true,
            supplierName: invoice.partnerFirmName,
            reference: invoice.reference,
            amount: invoice.costAmount,
            currency: invoice.costCurrency,
            status: "paid",
            message: `Invoice ${invoice.reference ?? invoice.id} from ${invoice.partnerFirmName} is already recorded as paid with this exact receipt attached — nothing new to do.`,
            navigateTo: null,
          },
        };
      }
      if (invoice.status === "paid") {
        return { ok: false, errorCode: "already_paid", errorMessage: `Invoice ${invoice.reference ?? invoice.id} from ${invoice.partnerFirmName} is already recorded as paid — this receipt wasn't attached (the bill can't be paid twice).` };
      }
      const pin: Record<string, unknown> = {
        receiptAttachmentId,
        invoiceId: invoice.id,
        confirm: true,
      };
      pin.commitToken = commitTokenFor("attach_payment_receipt", pin);
      return {
        ok: true,
        data: {
          shape: "supplier_invoice_card",
          stage: "preview",
          supplierName: invoice.partnerFirmName,
          reference: invoice.reference,
          amount: invoice.costAmount,
          currency: invoice.costCurrency,
          status: "pending confirmation",
          receiptFileName: rcpt.attachment.fileName,
        },
        confirmation: {
          summary: `Attach receipt ${rcpt.attachment.fileName} as proof of payment to invoice ${invoice.reference ?? invoice.id} from ${invoice.partnerFirmName} — ${invoice.costCurrency} ${invoice.costAmount}? The bill will be recorded as PAID and will leave the approval/payment queue.`,
          diff: {
            update: {
              table: "atelier_partner_firm_invoices",
              id: invoice.id,
              values: { status: "paid", paymentReceipt: rcpt.attachment.fileName },
            },
          },
          pending: { tool: "attach_payment_receipt", input: pin },
        },
      };
    }

    // Phase 2 — re-verify + commit through the shared core.
    const me = await loadFullUser(ctx.persona.id, ctx.persona.orgId);
    if (!me) return { ok: false, errorCode: "not_found", errorMessage: "User not found." };
    const bytes = rcpt.attachment.encryptedRef
      ? await loadAttachmentBytes(rcpt.attachment.encryptedRef)
      : null;
    if (!bytes) return { ok: false, errorCode: "not_found", errorMessage: "Receipt file bytes not found." };
    const out = await attachReceiptToSupplierInvoiceCore({
      me,
      invoiceId: invoice.id,
      fileBuffer: bytes,
      fileName: rcpt.attachment.fileName,
      mime: rcpt.attachment.mime ?? null,
      matchedBy: "reference",
    });
    if (out.status === 200) {
      const already = (out.body as { alreadyAttached?: boolean }).alreadyAttached === true;
      const closingLine = already
        ? `Invoice ${invoice.reference ?? invoice.id} from ${invoice.partnerFirmName} was already recorded as paid with this receipt — nothing new was written.`
        : `Recorded invoice ${invoice.reference ?? invoice.id} from ${invoice.partnerFirmName} — ${invoice.costCurrency} ${invoice.costAmount} as PAID, with the receipt attached as proof. It won't enter the payment queue.`;
      return {
        ok: true,
        data: {
          shape: "supplier_invoice_card",
          stage: "committed",
          ...(already ? { alreadyAttached: true } : {}),
          supplierName: invoice.partnerFirmName,
          reference: invoice.reference,
          amount: invoice.costAmount,
          currency: invoice.costCurrency,
          status: "paid",
          item: (out.body as { item?: unknown }).item,
          message: closingLine,
          closingLine,
          navigateTo,
        },
      };
    }
    return {
      ok: false,
      errorCode: String((out.body as { error?: string }).error ?? "failed"),
      errorMessage: String(
        (out.body as { message?: string }).message ?? "The receipt could not be attached.",
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
      cognidocsJobId: { type: "string", description: "Internal: parse-job pin issued by phase 1 — never set manually" },
      cognidocsJobToken: { type: "string", description: "Internal: clarification-continuation token binding the parse-job pin — never set manually" },
      password: { type: "string", description: "Password for a password-protected statement PDF (asked via clarification when the parser reports the document is locked) — used once to unlock the document, never stored" },
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
    // Task #1316 — PDF statements parse through CogniDocs. Rows with an
    // unclear debit/credit direction or unusable date/amount are flagged
    // (never guessed); a low overall confidence refuses with the
    // CSV-export fallback. The parse runs BEFORE the bank-account
    // clarification so an unparseable PDF gets the CSV guidance
    // immediately instead of a pointless account question. Phase 1
    // submits the document and pins the CogniDocs jobId; the
    // token-verified phase 2 re-fetches the SAME job (results are
    // retained), so preview and commit see identical rows by construction.
    const isPdf =
      looksLikePdf(bytes) ||
      loaded.attachment.mime === "application/pdf" ||
      /\.pdf$/i.test(loaded.attachment.fileName);
    let raw = "";
    let statementJob: Awaited<ReturnType<typeof getCognidocsJob>> | null = null;
    if (isPdf) {
      const jobIdInput =
        typeof input.cognidocsJobId === "string" && input.cognidocsJobId ? input.cognidocsJobId : null;
      // A pinned job is honored on the token-verified commit (phase 2) OR on
      // a clarification continuation carrying the phase-1 clarify token
      // (Task #1318 — so a password-unlocked parse is never re-run, and the
      // never-persisted password is never needed again).
      const pinnedJobId =
        jobIdInput &&
        (isVerifiedCommit("import_bank_statement", input) ||
          verifyStatementJobClarifyToken(jobIdInput, attachmentId, input.cognidocsJobToken))
          ? jobIdInput
          : null;
      try {
        statementJob = pinnedJobId
          ? await getCognidocsJob(pinnedJobId)
          : await parseCognidocsDocument({
              bytes,
              fileName: loaded.attachment.fileName || "statement.pdf",
              mimeType: "application/pdf",
              declaredType: "auto",
              // Task #1318 — transient unlock password from the
              // clarification answer. Never pinned, never persisted.
              password: pdfPasswordFrom(input) ?? undefined,
            });
      } catch (err) {
        const code = err instanceof CognidocsError ? err.code : null;
        // Task #1318 — locked PDF: ask for the password and retry instead
        // of failing generically. The partial keeps the user's other
        // inputs but NEVER the password.
        if (code === "pdf_password_required" || code === "pdf_password_incorrect") {
          const partial: Record<string, unknown> = {
            attachmentId,
            ...(typeof input.bankAccountId === "string" && input.bankAccountId
              ? { bankAccountId: input.bankAccountId }
              : {}),
            ...(typeof input.statementDate === "string" ? { statementDate: input.statementDate } : {}),
            ...(typeof input.notes === "string" && input.notes.trim() ? { notes: input.notes.trim() } : {}),
          };
          return {
            ok: true,
            data: { partial },
            clarification: {
              field: "password",
              question:
                code === "pdf_password_incorrect"
                  ? "That password didn't unlock the statement PDF — please double-check it and send the exact password again."
                  : "This statement PDF is password-protected. What's the password? I'll use it once to read the document — it is never stored.",
              tool: "import_bank_statement",
              partial,
              fields: [
                { field: "password", label: "PDF password", hint: "used once to unlock the document; never stored" },
              ],
            },
          };
        }
        if (code === "not-configured" || code === "auth") {
          return {
            ok: false,
            errorCode: "parsing_unavailable",
            errorMessage:
              "Document parsing isn't available right now (the parsing service isn't configured). You can still import a CSV export from your bank.",
          };
        }
        return {
          ok: false,
          errorCode: "pdf_parse_failed",
          errorMessage: `The PDF couldn't be parsed (${err instanceof Error ? err.message : "parse error"}) — export a CSV from your bank and attach that instead.`,
        };
      }
      if (statementJob.status !== "completed") {
        return {
          ok: false,
          errorCode: "pdf_parse_failed",
          errorMessage: "The statement parse did not complete — please try again in a moment.",
        };
      }
      // Currency-independent gate (row identity does not depend on the
      // account currency; the final conversion re-runs post-selection).
      const gate = statementRowsFromJob(statementJob, "USD");
      if (!gate) {
        return {
          ok: false,
          errorCode: "not_a_statement",
          errorMessage:
            "This document did not parse as a bank statement — it may be an invoice or letter. Attach a bank/credit-card statement PDF or a CSV export.",
        };
      }
      if (gate.rows.length === 0 || gate.confidence < COGNIDOCS_STATEMENT_CONFIDENCE_FLOOR) {
        return {
          ok: false,
          errorCode: "pdf_low_confidence",
          errorMessage: `I couldn't confidently extract transaction rows from this PDF${gate.flagged.length > 0 ? ` (${gate.flagged.length} row(s) were too ambiguous to trust — I never guess amounts or directions)` : ""} — export a CSV from your bank and attach that instead.`,
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
            partial: {
              attachmentId,
              ...(typeof input.statementDate === "string" ? { statementDate: input.statementDate } : {}),
              // Task #1318 — pin the already-parsed job through the
              // clarification so the continuation re-fetches it instead of
              // re-parsing (a password-unlocked PDF would otherwise re-ask
              // for the never-persisted password).
              ...(statementJob
                ? {
                    cognidocsJobId: statementJob.id,
                    cognidocsJobToken: statementJobClarifyToken(statementJob.id, attachmentId),
                  }
                : {}),
            },
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

    // PDF path: convert the SAME CogniDocs job's rows with the account's
    // currency as default (conversion is deterministic and the job is
    // pinned, so phase 1 and phase 2 see identical rows and the
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
      const parsed = statementRowsFromJob(statementJob!, acct.currency);
      if (!parsed || parsed.rows.length === 0 || parsed.confidence < COGNIDOCS_STATEMENT_CONFIDENCE_FLOOR) {
        // Currency default cannot change the row set, but keep the guard.
        return {
          ok: false,
          errorCode: "pdf_low_confidence",
          errorMessage:
            "I couldn't confidently extract transaction rows from this PDF — export a CSV from your bank and attach that instead.",
        };
      }
      raw = rowsToCanonicalCsv(parsed.rows);
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
                // Task #1316 — bind the commit to the exact parse job the
                // preview showed (covered by the HMAC commit token).
                ...(statementJob ? { cognidocsJobId: statementJob.id } : {}),
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
        orgId: ctx.persona.orgId,
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
