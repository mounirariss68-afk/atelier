/**
 * Task #1090 — shared finance-document AI helpers.
 *
 * `extractBankLetterFields` is the single bank-letter digitizer used by
 * BOTH the Finance Entities REST route (vault document → proposal) and
 * the Riser chat pipeline (chat attachment → proposal). No parsing
 * logic is forked between surfaces: same system prompt, same JSON
 * contract, same normalization.
 *
 * `parseSupplierInvoiceText` is the chat-side supplier-invoice parser:
 * the UI upload form takes manually keyed fields, so chat prefills them
 * from the attached PDF's extracted text and the user confirms before
 * anything is written. Low-confidence / missing fields are surfaced —
 * never guessed.
 */

import { extractFirstJsonObject } from "./atelier-agents/runner.js";

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
  text: string;
  /** Human context line shown to the model, e.g. file name + entity. */
  contextLabel: string;
}): Promise<BankLetterExtractResult> {
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
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

const SUPPLIER_INVOICE_SYSTEM = `You are an accounts-payable clerk digitizing supplier invoices (UAE and international; possibly bilingual Arabic/English — prefer English strings for Latin fields).

Extract ONLY facts present in the invoice text. Never invent amounts, references, or names. Use null for anything the document does not state. The "amount" must be the TOTAL payable (including VAT) as printed.

Return a single JSON object with this exact shape (all keys present):
{
  "confidence": number (0-1, your overall confidence that this is a supplier invoice AND the key fields are correct),
  "fields": {
    "supplierName": string|null (the issuing supplier's legal/trading name — NOT the bill-to party),
    "amount": number|null (total payable, numeric),
    "currency": string|null (ISO 4217 3-letter code),
    "reference": string|null (invoice number / reference as printed),
    "invoiceDate": string|null (YYYY-MM-DD),
    "periodLabel": string|null (billing period if stated, e.g. "2026-07" or "Jul 2026"),
    "notes": string|null (one short line of anything a reviewer should know, else null)
  }
}`;

export interface SupplierInvoiceFields {
  supplierName: string | null;
  amount: number | null;
  currency: string | null;
  reference: string | null;
  invoiceDate: string | null;
  periodLabel: string | null;
  notes: string | null;
}

export type SupplierInvoiceParseResult =
  | { ok: true; confidence: number; fields: SupplierInvoiceFields }
  | { ok: false; errorCode: "parse-non-json" | "parse-timeout" | "parse-failed"; errorMessage: string };

export async function parseSupplierInvoiceText(args: {
  text: string;
  contextLabel: string;
}): Promise<SupplierInvoiceParseResult> {
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    const resp = await anthropic.messages
      .create(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 1024,
          system: `${SUPPLIER_INVOICE_SYSTEM}\n\nIMPORTANT: Reply with ONLY a single JSON object, no prose, no code fences.`,
          messages: [
            {
              role: "user",
              content: `${args.contextLabel}\n\nExtracted invoice text:\n<<<\n${args.text.slice(0, 60_000)}\n>>>`,
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
      return { ok: false, errorCode: "parse-non-json", errorMessage: "The AI returned no structured result." };
    }
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const f = (parsed.fields ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;
    return {
      ok: true,
      confidence,
      fields: {
        supplierName: str(f.supplierName),
        amount: num(f.amount),
        currency: str(f.currency)?.toUpperCase().slice(0, 3) ?? null,
        reference: str(f.reference),
        invoiceDate: str(f.invoiceDate),
        periodLabel: str(f.periodLabel),
        notes: str(f.notes),
      },
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      errorCode: aborted ? "parse-timeout" : "parse-failed",
      errorMessage: err instanceof Error ? err.message : "AI parse error",
    };
  }
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
