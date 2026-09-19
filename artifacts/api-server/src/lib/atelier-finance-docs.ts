/**
 * Task #1090 — shared finance-document AI helpers.
 *
 * `extractBankLetterFields` is the single bank-letter digitizer used by
 * BOTH the Finance Entities REST route (vault document → proposal) and
 * the Riser chat pipeline (chat attachment → proposal). No parsing
 * logic is forked between surfaces: same system prompt, same JSON
 * contract, same normalization.
 *
 * `parseSupplierInvoiceDoc` is the chat-side supplier-invoice parser
 * (CogniDocs since Task #1316): the UI upload form takes manually keyed
 * fields, so chat prefills them from the attached PDF bytes and the user
 * confirms before anything is written. Low-confidence / missing fields
 * are surfaced — never guessed.
 */

import { extractFirstJsonObject } from "./atelier-agents/runner.js";
import { CognidocsError, parseCognidocsDocument } from "./cognidocs/client.js";
import { supplierFieldsFromJob } from "./cognidocs/convert.js";

export const BANK_LETTER_SYSTEM = `You are a treasury analyst digitizing official bank letters and account-confirmation documents (UAE and international banks: IBAN letters, account-opening confirmations, bank reference letters). Documents may be bilingual Arabic/English; prefer English strings for Latin fields.

Extract ONLY facts present in the document text. Never invent numbers or names. Omit (use null) anything the document does not state.

Return a single JSON object with this exact shape (all keys present):
{
  "confidenceNote": string,
  "fields": {
    "bankName": string|null,
    "branch": string|null,
    "accountHolderName": string|null (the account holder / customer legal name),
    "iban": string|null (full IBAN, no spaces),
    "accountNumber": string|null (the plain account number, digits as printed),
    "swift": string|null (SWIFT/BIC code),
    "currency": string|null (ISO 4217 3-letter code, e.g. AED),
    "issuedOn": string|null (letter date, YYYY-MM-DD)
  }
}`;

export interface BankLetterFields {
  bankName: string | null;
  branch: string | null;
  accountHolderName: string | null;
  iban: string | null;
  accountNumber: string | null;
  swift: string | null;
  currency: string | null;
  issuedOn: string | null;
}

export type BankLetterExtractResult =
  | { ok: true; confidenceNote: string; fields: BankLetterFields }
  | {
      ok: false;
      errorCode:
        | "extraction-non-json"
        | "extraction-empty"
        | "extraction-timeout"
        | "extraction-failed";
      errorMessage: string;
      snippet?: string;
    };

/**
 * Run the shared bank-letter AI extraction over already-extracted text.
 * Callers own text extraction (vault doc bytes vs chat attachment) and
 * any linkage/ACL checks; this helper owns ONLY the model call and
 * field normalization.
 */
export async function extractBankLetterFields(args: {
  orgId: string;
  text: string;
  /** Human context line shown to the model, e.g. file name + entity. */
  contextLabel: string;
}): Promise<BankLetterExtractResult> {
  try {
    const { anthropic } = await (
      await import("./assistant/provider-runtime.js")
    ).getPrivacyAuthorizedAnthropic({
      dataClasses: ["restricted"],
      orgId: args.orgId,
      capabilityId: "finance.bank_letter_extraction",
      model: "claude-sonnet-4-5",
    });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    const resp = await anthropic.messages
      .create(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 2048,
          system: `${BANK_LETTER_SYSTEM}\n\nIMPORTANT: Reply with ONLY a single JSON object, no prose, no code fences.`,
          messages: [
            {
              role: "user",
              content: `${args.contextLabel}\n\nExtracted document text:\n<<<\n${args.text.slice(0, 60_000)}\n>>>`,
            },
          ],
        },
        { signal: ac.signal },
      )
      .finally(() => clearTimeout(timer));
    const block = resp.content[0];
    const raw = block && block.type === "text" ? block.text.trim() : "";
    const json = extractFirstJsonObject(
      raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
    );
    if (!json) {
      return {
        ok: false,
        errorCode: "extraction-non-json",
        errorMessage: "The AI returned no structured result.",
        snippet: raw.slice(0, 200),
      };
    }
    const proposal = JSON.parse(json) as Record<string, unknown>;
    const rawFields = (proposal.fields ?? {}) as Record<string, unknown>;
    const hasContent = Object.values(rawFields).some((v) => v != null && v !== "");
    if (!hasContent) {
      return {
        ok: false,
        errorCode: "extraction-empty",
        errorMessage:
          "The AI could not find bank-account details in this document. Enter the account manually.",
      };
    }
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;
    const fields: BankLetterFields = {
      bankName: str(rawFields.bankName),
      branch: str(rawFields.branch),
      accountHolderName: str(rawFields.accountHolderName),
      iban: str(rawFields.iban)?.replace(/\s+/g, "").toUpperCase() ?? null,
      accountNumber: str(rawFields.accountNumber),
      swift: str(rawFields.swift)?.replace(/\s+/g, "").toUpperCase() ?? null,
      currency: str(rawFields.currency)?.toUpperCase().slice(0, 3) ?? null,
      issuedOn: str(rawFields.issuedOn),
    };
    return {
      ok: true,
      confidenceNote:
        typeof proposal.confidenceNote === "string" ? proposal.confidenceNote : "",
      fields,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      errorCode: aborted ? "extraction-timeout" : "extraction-failed",
      errorMessage: err instanceof Error ? err.message : "AI extraction error",
    };
  }
}

// ---------------------------------------------------------------------------
// Supplier-invoice parsing (chat pipeline only — the UI form is manual).
// ---------------------------------------------------------------------------

export interface SupplierInvoiceLineItemParsed {
  description: string;
  qty: number | null;
  unitAmount: number | null;
  amount: number | null;
}

export interface SupplierInvoiceFields {
  supplierName: string | null;
  amount: number | null;
  currency: string | null;
  reference: string | null;
  invoiceDate: string | null;
  periodLabel: string | null;
  notes: string | null;
  /** Printed line rows, as parsed; null when the document has none. */
  lineItems: SupplierInvoiceLineItemParsed[] | null;
}

export type SupplierInvoiceParseResult =
  | {
      ok: true;
      confidence: number;
      fields: SupplierInvoiceFields;
      /** Task #1316 — CogniDocs' stable invoice id: the same underlying
       *  invoice re-uploaded later yields the same id, so it is persisted
       *  as an extra duplicate-detection signal. */
      cognidocsInvoiceId?: string | null;
      /** Task #1267 — kept for wire compatibility; the CogniDocs parser
       *  never truncates itemization. */
      lineItemsTruncated?: boolean;
    }
  | {
      ok: false;
      /** The pdf_password_* codes pass through from CogniDocs verbatim
       *  (Task #1318) so callers can ask the user for the password and
       *  retry instead of dead-ending on a generic parse failure. */
      errorCode:
        | "parse-not-configured"
        | "parse-timeout"
        | "parse-failed"
        | "pdf_password_required"
        | "pdf_password_incorrect";
      errorMessage: string;
    };

/**
 * Task #1316 — parse a supplier invoice document (bytes, usually PDF)
 * through CogniDocs. Same result contract as the retired text-based
 * model parser: callers keep their confidence floor and clarification
 * flow untouched.
 */
export async function parseSupplierInvoiceDoc(args: {
  bytes: Buffer;
  fileName?: string | null;
  mimeType?: string;
  /** Cap the submit+poll budget (default is the client's own timeout).
   *  Synchronous HTTP surfaces (UI upload) pass a short budget so the
   *  request never outlives the proxy; a timeout is a normal parse-failed
   *  outcome there, not a crash. */
  timeoutMs?: number;
  /** Task #1318 — password for a protected PDF. Used transiently for this
   *  single parse call and NEVER stored or logged. */
  password?: string | null;
}): Promise<SupplierInvoiceParseResult> {
  // Safe diagnostics only: never log document-derived content — bounded
  // metadata like codes and byte counts only.
  const logFail = (errorCode: string, detail: Record<string, unknown>) =>
    console.error(`[supplier-invoice-parse] ${errorCode}`, {
      byteLength: args.bytes.length,
      ...detail,
    });
  try {
    const job = await parseCognidocsDocument({
      bytes: args.bytes,
      fileName: args.fileName?.trim() || "invoice.pdf",
      mimeType: args.mimeType ?? "application/pdf",
      // This surface is semantically an invoice upload, so declare it:
      // CogniDocs routes straight to the invoice parser. Result-shape
      // validation still applies — a document that is not actually an
      // invoice yields no invoice payload and fails loud below, instead
      // of forcing invoice fields out of, say, a bank statement.
      declaredType: "invoice",
      timeoutMs: args.timeoutMs,
      ...(args.password ? { password: args.password } : {}),
    });
    const mapped = supplierFieldsFromJob(job);
    if (!mapped) {
      logFail("parse-failed", { reason: "no-invoice-result", detectedType: job.detectedType });
      return {
        ok: false,
        errorCode: "parse-failed",
        errorMessage:
          "The document did not parse as an invoice — it may be a statement or an unreadable scan.",
      };
    }
    return {
      ok: true,
      confidence: mapped.confidence,
      fields: mapped.fields,
      cognidocsInvoiceId: mapped.cognidocsInvoiceId,
    };
  } catch (err) {
    const code = err instanceof CognidocsError ? err.code : null;
    const errorCode =
      code === "timeout"
        ? "parse-timeout"
        : code === "not-configured" || code === "auth"
          ? "parse-not-configured"
          : code === "pdf_password_required" || code === "pdf_password_incorrect"
            ? code
            : "parse-failed";
    logFail(errorCode, { cognidocsCode: code, error: err instanceof Error ? err.message : String(err) });
    return {
      ok: false,
      errorCode,
      errorMessage: err instanceof Error ? err.message : "Document parse error",
    };
  }
}

/** Sanitize a model-returned (or user/pin-supplied) lineItems payload.
 * Deterministic, shared by parse-time and commit-time consumers so the
 * phase-1 preview and the phase-2 write see identical rows. */
export function normalizeParsedLineItems(v: unknown): SupplierInvoiceLineItemParsed[] | null {
  if (!Array.isArray(v)) return null;
  const num = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) ? x : null;
  const out: SupplierInvoiceLineItemParsed[] = [];
  for (const raw of v.slice(0, 50)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const description =
      typeof r.description === "string" && r.description.trim()
        ? r.description.trim().slice(0, 300)
        : null;
    if (!description) continue;
    out.push({ description, qty: num(r.qty), unitAmount: num(r.unitAmount), amount: num(r.amount) });
  }
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Invoice ↔ receipt pairing (deterministic — no model call, probe-friendly).
// ---------------------------------------------------------------------------

/** Reference-like tokens: letters+digits with a separator or a long
 * alphanumeric run containing a digit (e.g. "YBJGOJ-00078", "INV-2026-0815"). */
export function extractReferenceTokens(text: string): Set<string> {
  const out = new Set<string>();
  const re = /\b[A-Z0-9]+(?:[-_/][A-Z0-9]+)+\b|\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b/gi;
  for (const m of (text ?? "").matchAll(re)) {
    const tok = m[0].toUpperCase();
    // Skip pure dates (2026-08-01) and pure numbers shorter than 6 digits.
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) continue;
    if (!/\d/.test(tok)) continue;
    if (tok.length < 6) continue;
    out.add(tok);
  }
  return out;
}

/** True ONLY when the receipt text visibly prints the invoice reference.
 * Amounts alone are deliberately NOT sufficient — identical totals across
 * unrelated bills are common, and a false pairing would persist a false
 * paid state that bypasses the approval/payment lifecycle. */
export function receiptMatchesInvoice(
  receiptText: string,
  invoice: { reference: string | null; amount: number | null },
): { match: boolean; matchedBy: "reference" | null } {
  const text = (receiptText ?? "").toUpperCase();
  const refChars = (invoice.reference ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (refChars.length >= 5) {
    // Delimiter-aware EXACT match: formatting characters (dashes, slashes,
    // spaces…) may vary between the two documents, but the alphanumeric
    // reference must match in full at token boundaries — a substring match
    // would let INV-12345 pair against a receipt printing INV-123456.
    const inner = refChars.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^A-Z0-9]?");
    const re = new RegExp(`(^|[^A-Z0-9])${inner}([^A-Z0-9]|$)`);
    if (re.test(text)) return { match: true, matchedBy: "reference" };
  }
  return { match: false, matchedBy: null };
}

/** Commit-grade verification that a paired attachment really is a payment
 * receipt for THIS invoice. Two independent gates, both required:
 *  1. the document classifies as a receipt (not an invoice, statement,
 *     letter…) — arbitrary reference-bearing text is not payment evidence;
 *  2. its text visibly prints the invoice reference.
 * Used by BOTH the preview and the commit phase so they always agree. */
export function verifyPairedReceipt(args: {
  receiptText: string;
  receiptFileName: string | null;
  invoice: { reference: string | null; amount: number | null };
}): { ok: true; matchedBy: "reference" } | { ok: false; reason: "not_a_receipt" | "no_reference_match" } {
  const cls = classifyFinanceDocument({ text: args.receiptText, fileName: args.receiptFileName });
  if (cls.kind !== "receipt") return { ok: false, reason: "not_a_receipt" };
  const m = receiptMatchesInvoice(args.receiptText, args.invoice);
  if (!m.match || !m.matchedBy) return { ok: false, reason: "no_reference_match" };
  return { ok: true, matchedBy: m.matchedBy };
}

export interface InvoiceReceiptPair {
  invoiceAttachmentId: string;
  receiptAttachmentId: string;
  sharedReference: string;
  matchedBy: "reference";
}

/** Detect same-bill invoice+receipt pairs among a classified batch:
 * an invoice and a receipt-looking document sharing a reference token.
 * Reference-only by design (amounts alone never pair). Deterministic. */
export function detectInvoiceReceiptPairs(
  docs: Array<{ attachmentId: string; kind: FinanceDocKind; fileName?: string | null; text: string }>,
): InvoiceReceiptPair[] {
  const invoices = docs.filter((d) => d.kind === "supplier_invoice");
  // Strictly kind === "receipt": a reference-bearing document that
  // classifies as anything else (e.g. a second invoice) never pairs,
  // matching the commit-time verifyPairedReceipt gate.
  const receipts = docs.filter((d) => d.attachmentId && d.kind === "receipt");
  const pairs: InvoiceReceiptPair[] = [];
  const used = new Set<string>();
  for (const inv of invoices) {
    const invTokens = extractReferenceTokens(inv.text);
    for (const rcpt of receipts) {
      if (rcpt.attachmentId === inv.attachmentId || used.has(rcpt.attachmentId)) continue;
      const shared = [...extractReferenceTokens(rcpt.text)].filter((t) => invTokens.has(t));
      if (shared.length > 0) {
        // Prefer the most reference-looking shared token (has a separator).
        shared.sort((a, b) => Number(b.includes("-")) - Number(a.includes("-")) || b.length - a.length);
        pairs.push({
          invoiceAttachmentId: inv.attachmentId,
          receiptAttachmentId: rcpt.attachmentId,
          sharedReference: shared[0],
          matchedBy: "reference",
        });
        used.add(rcpt.attachmentId);
        break;
      }
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Deterministic finance-document classifier (offline — no model call).
// ---------------------------------------------------------------------------

export type FinanceDocKind =
  | "supplier_invoice"
  | "bank_statement"
  | "bank_letter"
  | "receipt"
  | "client_billing"
  | "unknown";

export interface FinanceDocClassification {
  kind: FinanceDocKind;
  /** 0-1. Below ~0.6 the chat pipeline asks ONE clarifying question. */
  confidence: number;
  reasons: string[];
  /** Runner-up when the call was close — feeds the clarification chips. */
  runnerUp: FinanceDocKind | null;
}

const INVOICE_PATTERNS = [
  /\btax invoice\b/i,
  /\binvoice\s*(no|number|#|:)/i,
  /\bTRN[:\s]*\d/i,
  /\bamount due\b/i,
  /\btotal (payable|due)\b/i,
  /\bpayment terms\b/i,
  /\bbill to\b/i,
  /\bdue date\b/i,
  /\bsubtotal\b/i,
  /\bvat\b/i,
];
const STATEMENT_PATTERNS = [
  /\b(account|bank)\s+statement\b/i,
  /\bstatement (of account|period)\b/i,
  /\bopening balance\b/i,
  /\bclosing balance\b/i,
  /\b(debit|credit)\b.*\bbalance\b/i,
  /\btransaction (date|details)\b/i,
];
const BANK_LETTER_PATTERNS = [
  /\biban\b/i,
  /\bswift\b|\bbic\b/i,
  /\baccount (opening|confirmation)\b/i,
  /\bto whom it may concern\b/i,
  /\breference letter\b/i,
  /\bbank (letter|certificate)\b/i,
  /\baccount holder\b/i,
];
const RECEIPT_PATTERNS = [
  /\breceipt\b/i,
  /\bcash(ier)?\b/i,
  /\bchange due\b/i,
  /\bcard \*+\d{4}\b/i,
  /\bthank you for (shopping|your (visit|purchase))\b/i,
];
const CLIENT_BILLING_PATTERNS = [
  /\bengagement\b/i,
  /\bprofessional (fees|services)\b/i,
  /\bmilestone\b/i,
  /\bstatement of work\b/i,
  /\btimesheet\b/i,
];

function scorePatterns(text: string, patterns: RegExp[]): number {
  let s = 0;
  for (const re of patterns) if (re.test(text)) s++;
  return s;
}

/**
 * Deterministic classification over extracted text + file metadata.
 * Kept model-free so test probes run fully offline and results are
 * reproducible; the per-pipeline AI parses run AFTER routing.
 */
export function classifyFinanceDocument(args: {
  text: string;
  fileName?: string | null;
  mime?: string | null;
  /** Extractor kind hint, e.g. "csv" | "xlsx" | "pdf" | "image". */
  docKind?: string | null;
}): FinanceDocClassification {
  const text = args.text ?? "";
  const name = (args.fileName ?? "").toLowerCase();
  const scores = new Map<FinanceDocKind, { score: number; reasons: string[] }>();
  const bump = (kind: FinanceDocKind, by: number, reason: string) => {
    const cur = scores.get(kind) ?? { score: 0, reasons: [] };
    cur.score += by;
    cur.reasons.push(reason);
    scores.set(kind, cur);
  };

  // Tabular files are overwhelmingly bank statements in this flow —
  // invoices/letters arrive as PDFs.
  if (args.docKind === "csv" || args.docKind === "xlsx" || /\.(csv|xlsx?)$/.test(name)) {
    bump("bank_statement", 3, "tabular file (csv/xlsx)");
  }
  if (/statement/.test(name)) bump("bank_statement", 2, "file name mentions statement");
  if (/invoice/.test(name)) bump("supplier_invoice", 2, "file name mentions invoice");
  if (/receipt/.test(name)) bump("receipt", 2, "file name mentions receipt");
  if (/(iban|bank.?letter|confirmation)/.test(name)) bump("bank_letter", 2, "file name suggests bank letter");

  const inv = scorePatterns(text, INVOICE_PATTERNS);
  const stm = scorePatterns(text, STATEMENT_PATTERNS);
  const let_ = scorePatterns(text, BANK_LETTER_PATTERNS);
  const rec = scorePatterns(text, RECEIPT_PATTERNS);
  const cli = scorePatterns(text, CLIENT_BILLING_PATTERNS);
  if (inv) bump("supplier_invoice", inv, `${inv} invoice marker(s)`);
  if (stm) bump("bank_statement", stm * 1.5, `${stm} statement marker(s)`);
  if (let_) bump("bank_letter", let_, `${let_} bank-letter marker(s)`);
  if (rec) bump("receipt", rec * 1.5, `${rec} receipt marker(s)`);
  // Client billing only counts when invoice markers also present —
  // it disambiguates outbound vs inbound invoices.
  if (cli && inv) bump("client_billing", cli, `${cli} client-billing marker(s)`);

  // Bank letters share IBAN/SWIFT with statements & invoices; a strong
  // letter signal is the confirmation/to-whom phrasing.
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  if (ranked.length === 0 || ranked[0][1].score <= 0) {
    return { kind: "unknown", confidence: 0, reasons: ["no finance-document markers found"], runnerUp: null };
  }
  const [topKind, top] = ranked[0];
  const second = ranked[1] ?? null;
  const margin = top.score - (second?.[1].score ?? 0);
  // Confidence: absolute signal strength damped by how close the
  // runner-up is. score>=4 with margin>=2 ⇒ high confidence.
  const confidence = Math.max(
    0,
    Math.min(1, (Math.min(top.score, 6) / 6) * 0.6 + (Math.min(margin, 3) / 3) * 0.4),
  );
  return {
    kind: topKind,
    confidence,
    reasons: top.reasons,
    runnerUp: second && second[1].score > 0 ? second[0] : null,
  };
}
