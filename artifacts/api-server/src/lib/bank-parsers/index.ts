/**
 * Task #363 — Bank statement parsers.
 *
 * Two source kinds for Wave-4 import:
 *   - `csv`  : generic CSV with the columns
 *              `date,amount,counterparty,reference,kind?`
 *   - `xero` : Xero Bank Statements export CSV
 *              `Date,Amount,Payee,Description,Reference`
 *
 * Each parser returns a normalised row shape ready for insert into
 * `atelier_bank_transaction`. Failures are returned as `errors` so a
 * partial import can still surface what landed vs. what didn't.
 */

import { parseCsv } from "./csv.js";
import { parseXero } from "./xero.js";

export type BankTxnKind = "receipt" | "payment" | "fee" | "fx" | "other";

export interface ParsedBankRow {
  postedDate: string; // ISO date YYYY-MM-DD
  amount: number; // signed: + receipt, − payment
  currency: string;
  counterpartyNameRaw: string | null;
  referenceRaw: string | null;
  kind: BankTxnKind;
}

export interface ParseResult {
  rows: ParsedBankRow[];
  errors: Array<{ rowIndex: number; message: string }>;
}

export function parseBankStatement(
  source: "csv" | "xero",
  raw: string,
  defaultCurrency: string = "USD",
): ParseResult {
  if (source === "xero") return parseXero(raw, defaultCurrency);
  return parseCsv(raw, defaultCurrency);
}

export function classifyKind(amount: number, hint: string | null): BankTxnKind {
  if (hint) {
    const h = hint.toLowerCase();
    if (h.includes("fee") || h.includes("charge")) return "fee";
    if (h.includes("fx") || h.includes("forex")) return "fx";
  }
  if (amount > 0) return "receipt";
  if (amount < 0) return "payment";
  return "other";
}

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Task #1316 — serialise normalised rows into the canonical CSV shape the
 * shared `importStatementCore` consumes, so a parsed PDF statement runs
 * through the exact same dedupe + audit semantics as a CSV upload.
 * Deterministic: the same rows always produce the same text (and therefore
 * the same dedupe hash). Amounts serialise at 4 decimal places — CogniDocs
 * amounts are integers ×10,000, so 4dp is lossless and keeps 3-decimal
 * currencies (KWD/BHD/OMR) exact through the CSV round-trip.
 */
export function rowsToCanonicalCsv(rows: ParsedBankRow[]): string {
  const lines = ["date,amount,counterparty,reference,currency,kind"];
  for (const r of rows) {
    lines.push(
      [
        r.postedDate,
        r.amount.toFixed(4),
        csvCell(r.counterpartyNameRaw),
        csvCell(r.referenceRaw),
        r.currency,
        r.kind,
      ].join(","),
    );
  }
  return lines.join("\n");
}

export { parseCsv, parseXero };
