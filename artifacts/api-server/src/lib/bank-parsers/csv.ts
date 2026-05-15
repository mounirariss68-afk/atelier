/**
 * Generic CSV bank statement parser.
 *
 * Required header: `date,amount,counterparty,reference` (any order;
 * case-insensitive). Optional `kind` overrides the amount-sign heuristic.
 */

import type { ParseResult, ParsedBankRow, BankTxnKind } from "./index.js";
import { classifyKind } from "./index.js";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normaliseDate(s: string): string | null {
  if (!s) return null;
  // Accept YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY (best-effort).
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = slash[3];
    // If first field > 12 it must be DD/MM; else assume DD/MM (EU default)
    const dd = String(a).padStart(2, "0");
    const mm = String(b).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^\d.\-+]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(raw: string, defaultCurrency: string = "USD"): ParseResult {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: [{ rowIndex: -1, message: "empty file" }] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  const dateI = idx("date");
  const amtI = idx("amount");
  const cpI = idx("counterparty") >= 0 ? idx("counterparty") : idx("payee");
  const refI = idx("reference") >= 0 ? idx("reference") : idx("description");
  const kindI = idx("kind");
  const ccyI = idx("currency");
  if (dateI < 0 || amtI < 0) {
    return { rows: [], errors: [{ rowIndex: 0, message: "header must include date,amount" }] };
  }
  const rows: ParsedBankRow[] = [];
  const errors: Array<{ rowIndex: number; message: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const date = normaliseDate(cells[dateI] ?? "");
    const amount = parseAmount(cells[amtI] ?? "");
    if (!date) { errors.push({ rowIndex: i, message: `bad date: ${cells[dateI]}` }); continue; }
    if (amount === null) { errors.push({ rowIndex: i, message: `bad amount: ${cells[amtI]}` }); continue; }
    const cp = cpI >= 0 ? (cells[cpI] || null) : null;
    const ref = refI >= 0 ? (cells[refI] || null) : null;
    const ccy = (ccyI >= 0 && cells[ccyI]) ? cells[ccyI].toUpperCase() : defaultCurrency;
    const hintedKind = (kindI >= 0 ? cells[kindI] : "")?.toLowerCase() as BankTxnKind | "";
    const kind: BankTxnKind = (hintedKind === "receipt" || hintedKind === "payment" || hintedKind === "fee" || hintedKind === "fx" || hintedKind === "other")
      ? hintedKind : classifyKind(amount, ref);
    rows.push({ postedDate: date, amount, currency: ccy, counterpartyNameRaw: cp, referenceRaw: ref, kind });
  }
  return { rows, errors };
}
