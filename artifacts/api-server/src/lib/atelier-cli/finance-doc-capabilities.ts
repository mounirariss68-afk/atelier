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
