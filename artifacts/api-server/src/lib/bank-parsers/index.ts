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

export { parseCsv, parseXero };
