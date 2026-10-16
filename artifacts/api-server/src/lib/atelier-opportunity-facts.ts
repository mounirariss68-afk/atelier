/**
 * Phase 1 (Oct 2026 audit) — the two opportunity facts every pipeline card
 * got wrong, computed once and shared by chat capabilities and routes.
 *
 * 1. Days in stage. `atelier_opportunities.days_in_stage` is reset to 0 on
 *    every transition and never incremented afterwards, so every card and
 *    every "stalled" count read 0. The truth is in
 *    `atelier_opportunity_stage_transitions`: the newest row whose `to_stage`
 *    is the opportunity's current stage says when it entered it. Fallback for
 *    opportunities created before transitions were recorded: `created_at`.
 *
 * 2. Money. `deal_size_hypothesis` is in the ACCOUNT's `primary_currency`
 *    (decision 16 Oct 2026), yet every chat field was named `…Usd` and summed
 *    QAR, SAR and AED face values under a dollar sign. `projectDealMoney`
 *    returns the amount in its own currency AND the USD conversion through
 *    the single FX source; sums across accounts are done in USD only.
 */
import { and, inArray, isNull } from "drizzle-orm";
import { db, atelierAccounts, atelierOpportunityStageTransitions } from "@workspace/db";
import { FxRateMissingError, toUsdSync } from "./atelier-fx.js";

const DAY_MS = 86_400_000;

export interface StageAge {
  /** When the opportunity entered its current stage (transition row or created_at). */
  enteredAt: Date;
  /** Whole days since `enteredAt`, never negative. */
  days: number;
  /** "transition" when a stage-transition row backs the date, "created" when only created_at did. */
  source: "transition" | "created";
}

/**
 * Latest stage-entry date per opportunity. One query for any number of ids.
 * `stageOf` tells the helper which stage each opportunity is in now, so a
 * stale transition into a previous stage is never picked.
 */
export async function loadStageAges(
  opps: ReadonlyArray<{ id: string; salesStage: string; createdAt: Date }>,
  now: Date = new Date(),
): Promise<Map<string, StageAge>> {
  const out = new Map<string, StageAge>();
  if (opps.length === 0) return out;
  const ids = opps.map((o) => o.id);
  const rows = await db
    .select({
      opportunityId: atelierOpportunityStageTransitions.opportunityId,
      toStage: atelierOpportunityStageTransitions.toStage,
      createdAt: atelierOpportunityStageTransitions.createdAt,
    })
    .from(atelierOpportunityStageTransitions)
    .where(inArray(atelierOpportunityStageTransitions.opportunityId, ids));
  const latestEntry = new Map<string, Date>();
  const stageOf = new Map(opps.map((o) => [o.id, o.salesStage]));
  for (const r of rows) {
    if (r.toStage !== stageOf.get(r.opportunityId)) continue;
    const prior = latestEntry.get(r.opportunityId);
    if (!prior || r.createdAt > prior) latestEntry.set(r.opportunityId, r.createdAt);
  }
  for (const o of opps) {
    const entered = latestEntry.get(o.id);
    const enteredAt = entered ?? o.createdAt;
    out.set(o.id, {
      enteredAt,
      days: Math.max(0, Math.floor((now.getTime() - enteredAt.getTime()) / DAY_MS)),
      source: entered ? "transition" : "created",
    });
  }
  return out;
}

export interface DealMoney {
  /** Face value in `currency` (what the partner typed). */
  dealSize: number;
  currency: string;
  /** `dealSize` converted at the latest rate; null when no rate is known. */
  dealSizeUsd: number | null;
  probabilityPct: number;
  /** dealSize × probability, in `currency`. */
  weightedValue: number;
  /** Same, in USD; null when no rate is known. */
  weightedValueUsd: number | null;
  fxNote: string | null;
}

/** Project one opportunity's money into its own currency and USD. */
export function projectDealMoney(deal: number, probabilityPct: number, currency: string | null | undefined): DealMoney {
  const cur = (currency ?? "USD").toUpperCase();
  const weighted = (deal * probabilityPct) / 100;
  let dealSizeUsd: number | null = null;
  let weightedValueUsd: number | null = null;
  let fxNote: string | null = null;
  try {
    dealSizeUsd = Math.round(toUsdSync(deal, cur));
    weightedValueUsd = Math.round(toUsdSync(weighted, cur));
  } catch (err) {
    if (!(err instanceof FxRateMissingError)) throw err;
    fxNote = `No FX rate for ${cur}; USD figures unavailable.`;
  }
  return {
    dealSize: deal,
    currency: cur,
    dealSizeUsd,
    probabilityPct,
    weightedValue: Math.round(weighted),
    weightedValueUsd,
    fxNote,
  };
}

/** Account id → primary currency, one query. Missing accounts default to USD. */
export async function loadAccountCurrencies(accountIds: ReadonlyArray<string>): Promise<Map<string, string>> {
  const ids = Array.from(new Set(accountIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: atelierAccounts.id, currency: atelierAccounts.primaryCurrency })
    .from(atelierAccounts)
    .where(and(inArray(atelierAccounts.id, ids), isNull(atelierAccounts.deletedAt)));
  return new Map(rows.map((r) => [r.id, (r.currency ?? "USD").toUpperCase()]));
}

/**
 * Sum a set of projected deals in USD. Deals with no rate are counted in
 * `unconvertedCount` and excluded from the total, never added at face value.
 */
export function sumWeightedUsd(items: ReadonlyArray<DealMoney>): {
  weightedValueUsd: number;
  unconvertedCount: number;
  currencies: string[];
} {
  let total = 0;
  let unconverted = 0;
  const currencies = new Set<string>();
  for (const m of items) {
    currencies.add(m.currency);
    if (m.weightedValueUsd === null) unconverted += 1;
    else total += m.weightedValueUsd;
  }
  return { weightedValueUsd: Math.round(total), unconvertedCount: unconverted, currencies: Array.from(currencies).sort() };
}
