/**
 * Task #1094 — Guarded PDF bank-statement extraction.
 *
 * Banks' PDF layouts vary and a mis-parsed amount is worse than a polite
 * refusal, so this parser is deliberately conservative:
 *
 *   - Rows are anchored on date tokens in the extracted text (the pdfjs
 *     text layer often loses line structure, so we segment the flat text
 *     between consecutive dates instead of trusting newlines).
 *   - Each candidate row gets a CONFIDENCE score. A row is importable
 *     only when it has exactly ONE unambiguous amount (multiple amounts
 *     usually means debit/credit/balance columns we cannot tell apart —
 *     those rows are FLAGGED, never guessed).
 *   - Overall extraction confidence combines the importable ratio with
 *     the mean row confidence; below the floor the caller refuses and
 *     asks for a CSV export instead.
 *
 * Importable rows are re-serialised into the canonical CSV shape so the
 * commit path runs through the exact same `importStatementCore` (and
 * therefore the same dedupe + audit semantics) as a CSV upload.
 */

import type { ParsedBankRow } from "./index.js";
import { classifyKind } from "./index.js";

/** Rows below this confidence are flagged (shown, never imported). */
export const PDF_ROW_CONFIDENCE_FLOOR = 0.7;
/** Overall extraction confidence below this refuses with CSV guidance. */
export const PDF_STATEMENT_CONFIDENCE_FLOOR = 0.6;

export interface PdfStatementRow extends ParsedBankRow {
  confidence: number;
}

export interface FlaggedPdfRow {
  dateToken: string;
  snippet: string;
  reason: string;
  confidence: number;
}

export interface PdfStatementParse {
  /** Importable rows (confidence ≥ PDF_ROW_CONFIDENCE_FLOOR). */
  rows: PdfStatementRow[];
  /** Candidate rows that were too ambiguous to trust. */
  flagged: FlaggedPdfRow[];
  /** Overall extraction confidence in [0, 1]. */
  confidence: number;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// ISO | DD/MM/YYYY (EU default, same as the CSV parser) | "5 Aug 2026".
const DATE_TOKEN =
  /\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b|\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{4})\b/gi;

function normaliseDateMatch(m: RegExpExecArray): string | null {
  if (m[1]) return m[1];
  if (m[2] && m[3] && m[4]) {
    const dd = String(Number(m[2])).padStart(2, "0");
    const mm = String(Number(m[3])).padStart(2, "0");
    if (Number(m[3]) > 12 || Number(m[2]) > 31) return null;
    return `${m[4]}-${mm}-${dd}`;
  }
  if (m[5] && m[6] && m[7]) {
    const mm = MONTHS[m[6].toLowerCase().slice(0, 3)];
    if (!mm) return null;
    return `${m[7]}-${mm}-${String(Number(m[5])).padStart(2, "0")}`;
  }
  return null;
}

// Money amounts require a 2-decimal fraction — bare integers in prose
// (account numbers, reference codes) must not look like amounts.
const AMOUNT_TOKEN = /(\()?([-+])?\s?(\d{1,3}(?:,\d{3})*\.\d{2})(\))?(\s*(?:CR|DR))?/gi;

const CURRENCY_TOKEN =
  /\b(AED|USD|EUR|GBP|SAR|QAR|KWD|BHD|OMR|TRY|CHF|JPY|INR|CAD|AUD|SGD|HKD)\b/;

const NON_TXN_SEGMENT =
  /(opening|closing)\s+balance|balance\s+(brought|carried)\s+forward|statement\s+(date|period)|total\s+(debits|credits|withdrawals|deposits)/i;

// Task #1112 — statements laid out with separate Debit / Credit columns and a
// trailing Balance column. We cannot see x-coordinates in the flat text
// layer, so column-position guessing is off the table. Instead:
//   1. The HEADER must explicitly declare debit-ish and credit-ish columns
//     followed by a balance column (balance last). That tells us a
//     two-amount row is [transaction amount, running balance].
//   2. The transaction's direction is derived by ARITHMETIC, never by
//     position: previous balance ± amount must equal this row's balance
//     exactly (to the cent). One exact match → sign is proven; no match or
//     an ambiguous zero amount → the row is flagged as before.
// This keeps the "never guess" contract: every imported sign is verified
// against the bank's own running balance.
const DEBIT_CREDIT_BALANCE_HEADER = new RegExp(
  [
    String.raw`\b(?:debits?|withdrawals?|money\s+out|paid\s+out)\b[^\n]{0,60}?\b(?:credits?|deposits?|money\s+in|paid\s+in)\b`,
    String.raw`\b(?:credits?|deposits?|money\s+in|paid\s+in)\b[^\n]{0,60}?\b(?:debits?|withdrawals?|money\s+out|paid\s+out)\b`,
  ]
    .map((pair) => `(?:${pair})[^\n]{0,60}?\\b(?:running\\s+)?balance\\b`)
    .join("|"),
  "i",
);

const OPENING_BALANCE_LINE =
  /(?:opening\s+balance|balance\s+(?:brought|b\/?)\s*(?:forward|fwd))[^0-9(+-]{0,40}(\()?([-+])?\s?(\d{1,3}(?:,\d{3})*\.\d{2})(\))?/i;

/** Find an explicitly labelled opening balance anywhere in `text`. */
function findOpeningBalance(text: string): number | null {
  const m = text.match(OPENING_BALANCE_LINE);
  if (!m) return null;
  const abs = Number(m[3].replace(/,/g, ""));
  if (!Number.isFinite(abs)) return null;
  const negative = Boolean(m[1] && m[4]) || m[2] === "-";
  return negative ? -abs : abs;
}

const toCents = (v: number): number => Math.round(v * 100);

interface AmountHit {
  value: number;
  signed: boolean;
  index: number;
}

function findAmounts(seg: string): AmountHit[] {
  const out: AmountHit[] = [];
  AMOUNT_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_TOKEN.exec(seg)) !== null) {
    const abs = Number(m[3].replace(/,/g, ""));
    if (!Number.isFinite(abs)) continue;
    const paren = Boolean(m[1] && m[4]);
    const suffix = (m[5] ?? "").trim().toUpperCase();
    const negative = paren || m[2] === "-" || suffix === "DR";
    const positive = m[2] === "+" || suffix === "CR";
    out.push({
      value: negative ? -abs : abs,
      signed: negative || positive,
      index: m.index,
    });
  }
  return out;
}

// Conservative direction grammar for rows whose single amount carries no
// explicit sign marker (+/-/CR/DR/parens). Only unmistakable direction
// words count; anything else is AMBIGUOUS and the row is flagged, never
// defaulted to a sign.
const OUTFLOW_WORDS =
  /\b(payment|paid|debit(?:ed)?|withdrawal|withdrawn|purchase|pos\b|fee|charge[sd]?|transfer\s+(?:to|out)|outgoing|standing\s+order|direct\s+debit)\b/i;
const INFLOW_WORDS =
  /\b(deposit(?:ed)?|credit(?:ed)?|received|incoming|refund(?:ed)?|reversal|salary|interest\s+(?:paid|earned|credit)|transfer\s+(?:from|in)\b)\b/i;

/** Strip leftover separators/labels from a counterparty snippet. */
function cleanCounterparty(s: string): string {
  return s
    .replace(/\b(?:ref|reference)[.:#\s]+\S+/gi, " ")
    .replace(/[|•·]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, "")
    .trim();
}

function extractReference(seg: string): string | null {
  const m = seg.match(/\b(?:ref|reference)[.:#\s]+([A-Za-z0-9/_-]{3,64})/i);
  return m ? m[1] : null;
}

/**
 * Parse the flat text extracted from a PDF bank statement into candidate
 * transaction rows with per-row confidence. Deterministic — phase 1 and
 * phase 2 of the chat confirm flow must see identical output.
 */
export function parsePdfStatementText(
  text: string,
  defaultCurrency: string = "USD",
): PdfStatementParse {
  const rows: PdfStatementRow[] = [];
  const flagged: FlaggedPdfRow[] = [];
  if (!text.trim()) return { rows, flagged, confidence: 0 };

  // Task #1112 — debit/credit-column layout support (see header comment).
  const hasDebitCreditBalanceHeader = DEBIT_CREDIT_BALANCE_HEADER.test(text);
  // Running balance in cents; null whenever the chain of custody is broken
  // (unknown starting point, or a row whose effect on the balance we could
  // not verify). A two-amount row re-anchors the chain from its own printed
  // balance even when the row itself is flagged.
  let prevBalanceCents: number | null = hasDebitCreditBalanceHeader
    ? (() => {
        const opening = findOpeningBalance(text);
        return opening == null ? null : toCents(opening);
      })()
    : null;

  // Collect date anchors.
  const anchors: Array<{ date: string; token: string; start: number; end: number }> = [];
  DATE_TOKEN.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = DATE_TOKEN.exec(text)) !== null) {
    const date = normaliseDateMatch(dm);
    if (date) anchors.push({ date, token: dm[0], start: dm.index, end: dm.index + dm[0].length });
  }

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const segEnd = i + 1 < anchors.length ? anchors[i + 1].start : text.length;
    const seg = text.slice(a.end, segEnd);
    const snippet = `${a.token} ${seg.trim()}`.slice(0, 160);
    if (NON_TXN_SEGMENT.test(seg) || NON_TXN_SEGMENT.test(text.slice(Math.max(0, a.start - 40), a.start))) {
      continue; // balances/summary lines are not transactions — skip silently.
    }
    const amounts = findAmounts(seg);
    if (amounts.length === 0) {
      // A date with no amount is usually prose (value dates, headers) — skip
      // silently rather than flagging noise, unless the segment is short and
      // row-like (then it's a real row we failed to read).
      if (seg.trim().length > 0 && seg.trim().length <= 80) {
        flagged.push({ dateToken: a.token, snippet, reason: "no readable amount", confidence: 0.2 });
        prevBalanceCents = null; // possibly a real row we failed to read
      }
      continue;
    }
    let resolvedFromBalance = false;
    let amt = amounts[0];
    if (amounts.length > 1) {
      // Task #1112 — with a recognised Debit|Credit|Balance header, a
      // two-amount row is [transaction, running balance]. The direction is
      // taken ONLY from exact balance arithmetic — never from position.
      if (hasDebitCreditBalanceHeader && amounts.length === 2) {
        const txn = amounts[0];
        const bal = amounts[1];
        const balCents = toCents(bal.value);
        const txnCents = toCents(Math.abs(txn.value));
        const prev = prevBalanceCents;
        // Re-anchor the chain on this row's printed balance either way.
        prevBalanceCents = balCents;
        if (prev == null) {
          flagged.push({
            dateToken: a.token,
            snippet,
            reason:
              "debit/credit columns detected but no prior balance to verify this row's direction against",
            confidence: 0.4,
          });
          continue;
        }
        const isDebit = prev - txnCents === balCents;
        const isCredit = prev + txnCents === balCents;
        if (txnCents === 0 || isDebit === isCredit) {
          // No match (mis-read row) or ambiguous zero — never guess.
          flagged.push({
            dateToken: a.token,
            snippet,
            reason:
              "balance arithmetic does not confirm this row's direction — flagged, not guessed",
            confidence: 0.4,
          });
          continue;
        }
        const derived = isDebit ? -Math.abs(txn.value) : Math.abs(txn.value);
        if (txn.signed && toCents(txn.value) !== toCents(derived)) {
          // Printed sign marker contradicts the balance arithmetic.
          flagged.push({
            dateToken: a.token,
            snippet,
            reason: "printed sign marker contradicts the running balance — flagged, not guessed",
            confidence: 0.3,
          });
          continue;
        }
        amt = { value: derived, signed: true, index: txn.index };
        resolvedFromBalance = true;
      } else {
        // Columns we cannot tell apart — never guess.
        flagged.push({
          dateToken: a.token,
          snippet,
          reason: `ambiguous — ${amounts.length} amounts in one row (debit/credit/balance columns?)`,
          confidence: 0.4,
        });
        continue;
      }
    }
    const counterparty = cleanCounterparty(seg.slice(0, amt.index));
    const reference = extractReference(seg);
    const ccyMatch = seg.match(CURRENCY_TOKEN);
    let confidence = 0.95;
    let value = amt.value;
    if (resolvedFromBalance) {
      // Direction proven by exact running-balance arithmetic — strong, but
      // not a printed sign marker on the amount itself.
      confidence = 0.9;
    }
    if (!amt.signed) {
      // No printed sign marker — direction must come from an unmistakable
      // direction word; both/neither is ambiguous → flag, NEVER default a
      // direction (an outflow imported as a receipt corrupts recon).
      const out = OUTFLOW_WORDS.test(seg);
      const inn = INFLOW_WORDS.test(seg);
      if (out === inn) {
        flagged.push({
          dateToken: a.token,
          snippet,
          reason: "direction unclear — amount has no sign marker or unmistakable debit/credit wording",
          confidence: 0.4,
        });
        prevBalanceCents = null; // unknown effect on the running balance
        continue;
      }
      value = out ? -Math.abs(amt.value) : Math.abs(amt.value);
      confidence -= 0.15; // direction inferred from wording, not printed
    }
    if (!counterparty) confidence -= 0.25;
    const row: PdfStatementRow = {
      postedDate: a.date,
      amount: value,
      currency: ccyMatch ? ccyMatch[1].toUpperCase() : defaultCurrency,
      counterpartyNameRaw: counterparty || null,
      referenceRaw: reference,
      // Classify on the FINAL signed value (after direction inference),
      // never the raw token — an inferred outflow must land as a payment.
      kind: classifyKind(value, reference ?? counterparty),
      confidence: Math.max(0, Math.min(1, confidence)),
    };
    if (row.confidence >= PDF_ROW_CONFIDENCE_FLOOR) {
      rows.push(row);
      // Single-amount rows have no printed balance; propagate their known,
      // signed effect through the running-balance chain so a following
      // two-amount row can still verify itself.
      if (!resolvedFromBalance && prevBalanceCents != null) {
        prevBalanceCents += toCents(value);
      }
    } else {
      flagged.push({ dateToken: a.token, snippet, reason: "low row confidence", confidence: row.confidence });
      if (!resolvedFromBalance) prevBalanceCents = null; // unknown effect on balance
    }
  }

  const total = rows.length + flagged.length;
  if (rows.length === 0 || total === 0) return { rows, flagged, confidence: 0 };
  const meanConf = rows.reduce((s, r) => s + r.confidence, 0) / rows.length;
  const confidence = (rows.length / total) * meanConf;
  return { rows, flagged, confidence: +confidence.toFixed(3) };
}

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialise importable rows into the canonical CSV the shared
 * `importStatementCore` understands. Deterministic, so the statement
 * dedupe hash (sha256 of the raw text) is stable for the same PDF.
 */
export function pdfRowsToCanonicalCsv(rows: PdfStatementRow[]): string {
  const lines = ["date,amount,counterparty,reference,currency,kind"];
  for (const r of rows) {
    lines.push(
      [
        r.postedDate,
        r.amount.toFixed(2),
        csvCell(r.counterpartyNameRaw),
        csvCell(r.referenceRaw),
        r.currency,
        r.kind,
      ].join(","),
    );
  }
  return lines.join("\n");
}
