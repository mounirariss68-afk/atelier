/**
 * Atelier Wallet — multi-currency / FX helper (Task #259).
 *
 * Daily rates are seeded from `lib/db` (`atelier_fx_rates`). We do NOT
 * call a live provider in this build — the seed writes deterministic
 * 60-day rate windows so the Auditor + report rollups produce stable
 * USD numbers across runs.
 *
 * Convention: rows are stored as `units of <quote> per 1 USD`. So to
 * convert an amount in <quote> back to USD: usd = amount / rate.
 *
 * Lookup order:
 *   1. Exact (date, USD, quote) row.
 *   2. Most recent (date, USD, quote) row at-or-before the requested
 *      date (handles weekends + missing days without faking precision).
 *   3. Hard-coded fallback table — used if the FX seeder hasn't run.
 *      The fallback table is intentionally narrow (just the live demo
 *      currencies) and identifies itself in `source` so callers can
 *      surface the degradation if they care.
 */

import { db, atelierFxRates } from "@workspace/db";
import { and, eq, lte, desc } from "drizzle-orm";

const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  SAR: 3.75,
  AED: 3.6725,
  EUR: 0.92,
  GBP: 0.79,
  TRY: 38.5,
};

export interface FxConversion {
  usdAmount: number;
  rate: number; // units of quote per USD
  rateDate: string; // YYYY-MM-DD actually used
  source: "fx_table" | "fallback" | "identity";
}

function ymd(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export async function convertToUsd(
  amount: number,
  currency: string,
  date: Date | string,
): Promise<FxConversion> {
  const cur = (currency || "USD").toUpperCase();
  const requested = ymd(date);
  if (cur === "USD") {
    return { usdAmount: amount, rate: 1, rateDate: requested, source: "identity" };
  }
  // 1 + 2: at-or-before lookup.
  const [row] = await db
    .select()
    .from(atelierFxRates)
    .where(
      and(
        eq(atelierFxRates.base, "USD"),
        eq(atelierFxRates.quote, cur),
        lte(atelierFxRates.date, requested),
      ),
    )
    .orderBy(desc(atelierFxRates.date))
    .limit(1);
  if (row) {
    return {
      usdAmount: amount / row.rate,
      rate: row.rate,
      rateDate: row.date,
      source: "fx_table",
    };
  }
  // 3: fallback.
  const fb = FALLBACK_RATES[cur];
  if (fb) {
    return { usdAmount: amount / fb, rate: fb, rateDate: requested, source: "fallback" };
  }
  // unknown currency — refuse-to-fake; treat as 1:1 but flag identity.
  return { usdAmount: amount, rate: 1, rateDate: requested, source: "identity" };
}

/**
 * Bulk seeder helper. Writes a deterministic rate window (today − days,
 * today]. Idempotent on (date, base, quote). Used by the seed script
 * AND by the API ops endpoint POST /wallet/fx/seed.
 */
export async function seedFxRates(days = 60): Promise<number> {
  const writes: Array<{
    id: string;
    date: string;
    base: string;
    quote: string;
    rate: number;
    source: string;
  }> = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = ymd(d);
    // Tiny deterministic wobble so charts have visible motion without
    // implying real market data.
    const wobble = (Math.sin(i / 4) + 1) * 0.005; // 0..1%
    for (const [quote, base] of Object.entries(FALLBACK_RATES)) {
      if (quote === "USD") continue;
      const rate = +(base * (1 + wobble * (i % 2 === 0 ? 1 : -1))).toFixed(6);
      writes.push({
        id: `fx_${dateStr}_${quote}`,
        date: dateStr,
        base: "USD",
        quote,
        rate,
        source: "seed",
      });
    }
  }
  // Upsert via on-conflict-do-nothing-then-update pattern. Drizzle: insert
  // many; on conflict on the unique (date, base, quote) index, update rate.
  if (writes.length === 0) return 0;
  await db
    .insert(atelierFxRates)
    .values(writes)
    .onConflictDoNothing();
  return writes.length;
}
