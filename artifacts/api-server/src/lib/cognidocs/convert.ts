/**
 * Task #1316 — converters from CogniDocs parse results onto the app's
 * existing wire contracts, so web/mobile clients and downstream pipelines
 * (Expense Auditor, importStatementCore, createSupplierInvoiceCore) are
 * untouched by the parsing-backend swap.
 *
 * Direction rule (statements): the explicit `direction` field is the ONLY
 * direction signal — debit → negative amount, credit → positive amount.
 * A row without a direction is FLAGGED, never guessed (this preserves the
 * "never guess" recon contract from the retired in-house PDF parser).
 */

import type { ParsedBankRow } from "../bank-parsers/index.js";
import { classifyKind } from "../bank-parsers/index.js";
import type {
  VisionReceiptExtraction,
} from "../atelier-receipt-parse.js";
import type {
  SupplierInvoiceFields,
  SupplierInvoiceLineItemParsed,
} from "../atelier-finance-docs.js";
import type {
  CognidocsInvoiceResult,
  CognidocsParseJob,
  CognidocsStatementResult,
} from "./types.js";

/** Integer ×10,000 → major units, exact to 4dp (Gulf 3-decimal currencies stay precise). */
export function amount10kToMajor(v: number): number {
  return Math.round(v) / 10_000;
}

function optAmount(v: number | null | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? amount10kToMajor(v) : undefined;
}

/** CogniDocs integer confidence (0–100) → the app's traffic-light band. */
export function confidenceBand(confidence: number | null | undefined): "green" | "amber" | "red" {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return "amber";
  if (confidence >= 80) return "green";
  if (confidence >= 50) return "amber";
  return "red";
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// ---------------------------------------------------------------------------
// Receipts / expense invoices → VisionReceiptExtraction-shaped payload
// ---------------------------------------------------------------------------

/** Best-effort mapping of a CogniDocs category key onto the legacy expense
 * category hints. Unknown keys map to undefined — the Expense Auditor owns
 * the final category call, this is only a draft hint. */
export function legacyCategoryHint(categoryKey: string | null | undefined): string | undefined {
  const k = (categoryKey ?? "").toLowerCase();
  if (!k) return undefined;
  if (/flight|airline|airfare/.test(k)) return "flight";
  if (/hotel|accommodation|lodging|stay/.test(k)) return "hotel";
  if (/meal|restaurant|food|dining|cafe|catering|grocer/.test(k)) return "meal";
  if (/software|saas|subscription|cloud|tooling/.test(k)) return "software";
  if (/taxi|ride|transport|parking|fuel|toll|transit/.test(k)) return "taxi";
  if (/gift/.test(k)) return "gift";
  return "other";
}

/** Deterministic text summary of the parsed fields + line items. This is
 * the receipt's `rawText` stand-in (CogniDocs returns structured fields,
 * not free OCR text) — composed the same way every time so preview and
 * re-parse agree. */
export function composeReceiptRawText(inv: CognidocsInvoiceResult): string {
  const lines: string[] = [];
  if (inv.vendorName) lines.push(`vendor: ${inv.vendorName}`);
  if (inv.invoiceRef) lines.push(`reference: ${inv.invoiceRef}`);
  if (inv.issueDate) lines.push(`date: ${inv.issueDate}`);
  const cur = inv.currency ?? "";
  const money = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? amount10kToMajor(v).toFixed(2) : null;
  const subtotal = money(inv.subtotalAmount10k);
  const tax = money(inv.taxAmount10k);
  const total = money(inv.totalAmount10k);
  if (subtotal) lines.push(`subtotal: ${cur} ${subtotal}`.trim());
  if (tax) lines.push(`tax: ${cur} ${tax}`.trim());
  if (total) lines.push(`total: ${cur} ${total}`.trim());
  if (inv.paymentMethod || inv.paymentReference) {
    lines.push(`payment: ${[inv.paymentMethod, inv.paymentReference].filter(Boolean).join(" ")}`);
  }
  for (const li of inv.lineItems ?? []) {
    if (!li?.description) continue;
    const qty = typeof li.quantity10k === "number" ? amount10kToMajor(li.quantity10k) : null;
    const amt = money(li.amount10k);
    lines.push(`- ${li.description}${qty != null && qty !== 1 ? ` x${qty}` : ""}${amt ? ` = ${amt}` : ""}`);
  }
  return lines.join("\n").slice(0, 8000);
}

/** Map a completed CogniDocs job onto the receipt-extraction shape the
 * Expense Auditor pipeline consumes. A job whose result carries no invoice
 * payload (e.g. the document is actually a bank statement, or nothing was
 * readable) comes back `unreadable: true` — same contract as before. */
export function receiptExtractionFromJob(job: CognidocsParseJob): VisionReceiptExtraction {
  const inv = job.result?.invoice ?? null;
  if (!inv) return { unreadable: true };
  const total = optAmount(inv.totalAmount10k);
  const merchant = str(inv.vendorName);
  if (!merchant && total === undefined) return { unreadable: true };
  return {
    merchant: merchant ?? undefined,
    date: str(inv.issueDate) ?? undefined,
    total,
    tax: optAmount(inv.taxAmount10k) ?? 0,
    subtotal: optAmount(inv.subtotalAmount10k),
    currency: str(inv.currency)?.toUpperCase().slice(0, 3) ?? undefined,
    category: legacyCategoryHint(inv.categoryKey),
    rawText: composeReceiptRawText(inv),
    confidence: confidenceBand(job.confidence),
    unreadable: false,
  };
}

// ---------------------------------------------------------------------------
// Supplier invoices → SupplierInvoiceFields (chat-ingest contract)
// ---------------------------------------------------------------------------

export function supplierLineItemsFromInvoice(
  inv: CognidocsInvoiceResult,
): SupplierInvoiceLineItemParsed[] | null {
  const items = inv.lineItems ?? [];
  const out: SupplierInvoiceLineItemParsed[] = [];
  for (const li of items.slice(0, 50)) {
    const description = str(li?.description)?.slice(0, 300) ?? null;
    if (!description) continue;
    out.push({
      description,
      qty: optAmount(li.quantity10k) ?? null,
      unitAmount: optAmount(li.unitPriceAmount10k) ?? null,
      amount: optAmount(li.amount10k) ?? null,
    });
  }
  return out.length > 0 ? out : null;
}

export function supplierFieldsFromJob(job: CognidocsParseJob): {
  confidence: number;
  fields: SupplierInvoiceFields;
  /** CogniDocs' stable invoice id — a cross-upload duplicate signal. */
  cognidocsInvoiceId: string | null;
} | null {
  const inv = job.result?.invoice ?? null;
  if (!inv) return null;
  const confidence =
    typeof job.confidence === "number" && Number.isFinite(job.confidence)
      ? Math.max(0, Math.min(1, job.confidence / 100))
      : 0;
  return {
    confidence,
    cognidocsInvoiceId: str(inv.id),
    fields: {
      supplierName: str(inv.vendorName),
      amount: optAmount(inv.totalAmount10k) ?? null,
      currency: str(inv.currency)?.toUpperCase().slice(0, 3) ?? null,
      reference: str(inv.invoiceRef),
      invoiceDate: str(inv.issueDate),
      periodLabel: null,
      notes:
        inv.reconciliation?.matchesTotal === false
          ? "Parsed line items do not sum to the printed total — review the itemization."
          : null,
      lineItems: supplierLineItemsFromInvoice(inv),
    },
  };
}

// ---------------------------------------------------------------------------
// Bank / credit-card statements → canonical import rows
// ---------------------------------------------------------------------------

export interface StatementPreviewRow extends ParsedBankRow {
  confidence: number;
}

export interface FlaggedStatementRow {
  dateToken: string;
  snippet: string;
  reason: string;
  confidence: number;
}

export interface StatementConversion {
  rows: StatementPreviewRow[];
  flagged: FlaggedStatementRow[];
  /** Overall confidence in [0,1] (CogniDocs job confidence, damped by the
   * flagged ratio so a statement full of direction-less rows still refuses). */
  confidence: number;
  /** Pass-through of CogniDocs' partial-import warning, if any. */
  warning: string | null;
}

/** Below this overall confidence the import refuses with CSV guidance. */
export const COGNIDOCS_STATEMENT_CONFIDENCE_FLOOR = 0.6;

export function statementRowsFromJob(
  job: CognidocsParseJob,
  fallbackCurrency: string,
): StatementConversion | null {
  const stmt: CognidocsStatementResult | null = job.result?.statement ?? null;
  if (!stmt) return null;
  const rows: StatementPreviewRow[] = [];
  const flagged: FlaggedStatementRow[] = [];
  for (const t of stmt.transactions ?? []) {
    const date = str(t.date);
    const desc = str(t.description) ?? str(t.rawDescription) ?? "";
    const snippet = `${date ?? "?"} ${desc}`.slice(0, 160);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      flagged.push({ dateToken: date ?? "?", snippet, reason: "unparseable posting date", confidence: 0.3 });
      continue;
    }
    if (typeof t.amount10k !== "number" || !Number.isFinite(t.amount10k) || t.amount10k === 0) {
      flagged.push({ dateToken: date, snippet, reason: "missing or zero amount", confidence: 0.3 });
      continue;
    }
    if (t.direction !== "debit" && t.direction !== "credit") {
      // The ONLY direction authority is the explicit field — a row the
      // statement did not mark debit/credit is flagged, never guessed.
      flagged.push({
        dateToken: date,
        snippet,
        reason: "direction unclear — the statement did not mark this row as debit or credit",
        confidence: 0.4,
      });
      continue;
    }
    const magnitude = Math.abs(amount10kToMajor(t.amount10k));
    const amount = t.direction === "debit" ? -magnitude : magnitude;
    const counterparty =
      str(t.normalizedMerchant) ?? str(t.parsedMerchant) ?? (desc || null);
    const reference = str(t.rawDescription) ?? (desc || null);
    rows.push({
      postedDate: date,
      amount,
      currency:
        str(t.currency)?.toUpperCase().slice(0, 3) ??
        str(stmt.currency)?.toUpperCase().slice(0, 3) ??
        fallbackCurrency,
      counterpartyNameRaw: counterparty,
      referenceRaw: reference,
      kind: classifyKind(amount, `${reference ?? ""} ${counterparty ?? ""}`),
      confidence: 1,
    });
  }
  const total = rows.length + flagged.length;
  const jobConf =
    typeof job.confidence === "number" && Number.isFinite(job.confidence)
      ? Math.max(0, Math.min(1, job.confidence / 100))
      : 0;
  const confidence = total === 0 || rows.length === 0 ? 0 : +(jobConf * (rows.length / total)).toFixed(3);
  return { rows, flagged, confidence, warning: str(stmt.partialImportWarning) };
}
