/**
 * Xero Bank Statements export CSV parser.
 *
 * Xero header: `*Date,*Amount,Payee,Description,Reference,Cheque Number`
 * (the `*` prefix marks required columns). The columns are delegated to
 * the generic parser after rewriting the header so we stay DRY.
 */

import type { ParseResult } from "./index.js";
import { parseCsv } from "./csv.js";

export function parseXero(raw: string, defaultCurrency: string = "USD"): ParseResult {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0) return { rows: [], errors: [{ rowIndex: -1, message: "empty file" }] };
  // Strip leading `*` from required-column markers, lowercase the canonical names.
  const header = lines[0]
    .split(",")
    .map((h) => h.replace(/^\s*\*/, "").trim().toLowerCase())
    .map((h) => (h === "payee" ? "counterparty" : h === "description" ? "reference" : h));
  const rewritten = [header.join(","), ...lines.slice(1)].join("\n");
  return parseCsv(rewritten, defaultCurrency);
}
