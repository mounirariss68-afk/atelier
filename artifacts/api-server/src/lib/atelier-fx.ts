/**
 * Atelier — single FX source (Phase 0, Oct 2026 audit).
 *
 * Decision (16 Oct 2026): one rate table, `atelier_fx_rates`, fed by a daily
 * import; rate at transaction date for ledgers, latest rate for pipeline and
 * display. The former `seedFxRates` (synthetic rates with a sine "wobble"),
 * the `/wallet/fx/seed` route, and the four hard-coded tables scattered
 * through the finance reports, the FP&A engine and the travel tools are
 * gone; every module reads from here.
 *
 * Sources, in order:
 *   1. `atelier_fx_rates` — exact date, else the most recent row at or
 *      before the requested date (weekends and holidays).
 *   2. Official pegs for the Gulf currencies (AED, SAR, QAR, BHD, OMR). These
 *      are fixed by the central banks and are legitimately constant.
 *   3. Nothing. An unknown currency, or a floating currency with no imported
 *      rate, throws `FxRateMissingError`. Callers surface the error; they do
 *      not invent a number.
 *
 * Convention: rows are `units of <quote> per 1 USD`; usd = amount / rate.
 *
 * Import: `refreshFxRatesFromEcb()` reads the ECB daily reference rates
 * (EUR base, ~30 currencies, no API key) and stores USD-based cross rates
 * for the ECB date. It runs at boot and on the daily cron. The ECB publishes
 * around 16:00 CET on TARGET business days; on other days the at-or-before
 * lookup serves the last published rate.
 *
 * A synchronous snapshot (`usdPerUnitSync`) is kept for the report modules
 * that compute in plain functions; it is refreshed after every import and
 * on demand through `refreshFxSnapshot()`.
 */

import { db, atelierFxRates } from "@workspace/db";
import { and, eq, lte, desc, inArray, sql } from "drizzle-orm";
import { logger } from "./logger.js";

/** Central-bank pegs, units per USD. Constant by policy, not by assumption. */
export const PEGGED_PER_USD: Record<string, number> = {
  AED: 3.6725,
  SAR: 3.75,
  QAR: 3.64,
  BHD: 0.376,
  OMR: 0.3845,
};

/** Floating currencies the import must cover for the firm's work. */
export const FLOATING_CURRENCIES = ["EUR", "GBP", "TRY", "CHF", "JPY", "INR", "AUD", "CAD", "SGD"] as const;

/** Currencies the display-preference pickers offer. */
export const DISPLAY_CURRENCIES = ["USD", ...Object.keys(PEGGED_PER_USD), "EUR", "GBP", "TRY"];

export class FxRateMissingError extends Error {
  readonly currency: string;
  readonly date: string;
  constructor(currency: string, date: string) {
    super(`No FX rate for ${currency} at or before ${date}. Run the FX import or add the currency.`);
    this.name = "FxRateMissingError";
    this.currency = currency;
    this.date = date;
  }
}

export type FxSource = "fx_table" | "peg" | "identity";

export interface FxConversion {
  usdAmount: number;
  rate: number; // units of quote per USD
  rateDate: string; // YYYY-MM-DD actually used
  source: FxSource;
}

export interface FxDisplayConversion {
  amount: number;
  rate: number; // units of target per USD
  rateDate: string;
  source: FxSource;
}

function ymd(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

async function lookup(cur: string, requested: string): Promise<{ rate: number; rateDate: string; source: FxSource }> {
  if (cur === "USD") return { rate: 1, rateDate: requested, source: "identity" };
  const [row] = await db
    .select({ rate: atelierFxRates.rate, date: atelierFxRates.date })
    .from(atelierFxRates)
    .where(and(eq(atelierFxRates.base, "USD"), eq(atelierFxRates.quote, cur), lte(atelierFxRates.date, requested)))
    .orderBy(desc(atelierFxRates.date))
    .limit(1);
  if (row) return { rate: row.rate, rateDate: row.date, source: "fx_table" };
  const peg = PEGGED_PER_USD[cur];
  if (peg) return { rate: peg, rateDate: requested, source: "peg" };
  throw new FxRateMissingError(cur, requested);
}

/** Convert an amount in `currency` to USD at the rate on/before `date`. */
export async function convertToUsd(amount: number, currency: string, date: Date | string): Promise<FxConversion> {
  const cur = (currency || "USD").toUpperCase();
  const requested = ymd(date);
  const r = await lookup(cur, requested);
  return { usdAmount: amount / r.rate, rate: r.rate, rateDate: r.rateDate, source: r.source };
}

/** Convert a USD amount into a display currency at the rate on/before `date`. */
export async function convertUsdTo(usdAmount: number, currency: string, date: Date | string): Promise<FxDisplayConversion> {
  const cur = (currency || "USD").toUpperCase();
  const requested = ymd(date);
  const r = await lookup(cur, requested);
  return { amount: usdAmount * r.rate, rate: r.rate, rateDate: r.rateDate, source: r.source };
}

/** Convert between any two currencies through USD at the rate on/before `date`. */
export async function convertBetween(amount: number, from: string, to: string, date: Date | string): Promise<{ amount: number; rateDate: string }> {
  const usd = await convertToUsd(amount, from, date);
  const out = await convertUsdTo(usd.usdAmount, to, date);
  return { amount: out.amount, rateDate: out.rateDate < usd.rateDate ? out.rateDate : usd.rateDate };
}

// ─────────────────────── synchronous snapshot ───────────────────────

let snapshot: Record<string, number> = { USD: 1, ...PEGGED_PER_USD };
let snapshotDate: string | null = null;

/**
 * Reload the in-memory latest-rate snapshot from the table. Called after
 * every import and at boot; cheap enough to call from a request when the
 * snapshot is older than a day.
 */
export async function refreshFxSnapshot(): Promise<{ date: string | null; currencies: number }> {
  const rows = await db
    .select({ quote: atelierFxRates.quote, rate: atelierFxRates.rate, date: atelierFxRates.date })
    .from(atelierFxRates)
    .where(eq(atelierFxRates.base, "USD"))
    .orderBy(desc(atelierFxRates.date));
  const next: Record<string, number> = { USD: 1, ...PEGGED_PER_USD };
  let newest: string | null = null;
  // Rows are newest-first, so the first row per quote wins. Pegs stay fixed.
  const seen = new Set<string>();
  for (const r of rows) {
    if (!newest || r.date > newest) newest = r.date;
    if (seen.has(r.quote) || r.quote in PEGGED_PER_USD) continue;
    next[r.quote] = r.rate;
    seen.add(r.quote);
  }
  snapshot = next;
  snapshotDate = newest;
  return { date: newest, currencies: Object.keys(next).length };
}

/** Latest known units-per-USD for `currency`; throws when unknown. */
export function usdPerUnitSync(currency: string): number {
  const cur = (currency || "USD").toUpperCase();
  const r = snapshot[cur];
  if (r === undefined) throw new FxRateMissingError(cur, snapshotDate ?? "latest");
  return r;
}

/** `amount` in `currency` → USD, latest snapshot. */
export function toUsdSync(amount: number, currency: string | null | undefined): number {
  return amount / usdPerUnitSync(currency ?? "USD");
}

/** USD → `currency`, latest snapshot. */
export function fromUsdSync(usdAmount: number, currency: string | null | undefined): number {
  return usdAmount * usdPerUnitSync(currency ?? "USD");
}

/** Any → any through USD, latest snapshot. */
export function convertSync(amount: number, from: string, to: string): number {
  return fromUsdSync(toUsdSync(amount, from), to);
}

export function fxSnapshotInfo(): { date: string | null; currencies: string[] } {
  return { date: snapshotDate, currencies: Object.keys(snapshot).sort() };
}

// ─────────────────────── ECB import ───────────────────────

const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/**
 * Parse the ECB daily XML without an XML library: one `Cube time=...`
 * element and ~30 `Cube currency=... rate=...` children.
 */
export function parseEcbDaily(xml: string): { date: string; eurPer: Record<string, number> } | null {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) return null;
  const eurPer: Record<string, number> = { EUR: 1 };
  const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) eurPer[m[1]] = Number(m[2]);
  if (!eurPer.USD) return null;
  return { date, eurPer };
}

/**
 * Fetch the ECB daily reference rates and upsert USD-based cross rates for
 * that date. Returns the number of rows written. Never throws into the
 * scheduler: failures are logged and the previous rates stay in force.
 */
export async function refreshFxRatesFromEcb(fetchImpl: typeof fetch = fetch): Promise<{ date: string | null; written: number }> {
  let xml: string;
  try {
    const res = await fetchImpl(ECB_DAILY_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`ECB ${res.status}`);
    xml = await res.text();
  } catch (err) {
    logger.error({ err }, "FX import: ECB fetch failed — previous rates stay in force");
    return { date: null, written: 0 };
  }
  const parsed = parseEcbDaily(xml);
  if (!parsed) {
    logger.error("FX import: ECB payload did not parse");
    return { date: null, written: 0 };
  }
  const usdPerEur = parsed.eurPer.USD;
  const rows = Object.entries(parsed.eurPer)
    .filter(([q]) => q !== "USD" && !(q in PEGGED_PER_USD))
    .map(([quote, eurRate]) => ({
      id: `fx_${parsed.date}_${quote}`,
      date: parsed.date,
      base: "USD",
      quote,
      rate: +(eurRate / usdPerEur).toFixed(8), // units of quote per USD
      source: "ecb",
    }));
  if (rows.length === 0) return { date: parsed.date, written: 0 };
  await db
    .insert(atelierFxRates)
    .values(rows)
    .onConflictDoUpdate({
      target: [atelierFxRates.date, atelierFxRates.base, atelierFxRates.quote],
      set: { rate: sql`excluded.rate`, source: "ecb" },
    });
  await refreshFxSnapshot();
  logger.info({ date: parsed.date, written: rows.length }, "FX import: ECB daily rates stored");
  return { date: parsed.date, written: rows.length };
}

/** Remove the synthetic rows the old seeder wrote so they cannot win an at-or-before lookup. */
export async function purgeSyntheticFxRows(): Promise<number> {
  const deleted = await db
    .delete(atelierFxRates)
    .where(inArray(atelierFxRates.source, ["seed", "fallback"]))
    .returning({ id: atelierFxRates.id });
  if (deleted.length) logger.info({ deleted: deleted.length }, "FX: synthetic seed rows removed");
  return deleted.length;
}
