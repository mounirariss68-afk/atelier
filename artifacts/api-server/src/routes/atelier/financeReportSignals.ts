/**
 * Atelier — P&L "silent zero" signals (Task #1069).
 *
 * Pure helpers the P&L route uses to explain empty GL periods instead of
 * showing bare zeros:
 *   - computeGlPresence: which entities have posted journals for the
 *     periods in scope (missing → the UI shows a "run the Bookkeeper"
 *     notice with a Finance → Ledger deep link).
 *   - sumUnpostedActivity: facts-derived revenue/cost totals for the
 *     scope, surfaced as a "not yet posted" hint when GL is empty —
 *     posted GL remains the accounting source of truth.
 *   - sumPendingApproval: submitted-but-unapproved expense spend for the
 *     scope (correctly excluded from facts), surfaced as an
 *     "awaiting approval — not included" indicator.
 */
import type { GlEntityStatements } from "./financeGlStatements";
import type { FactMonth } from "./financeRealFacts";

export interface GlPresence {
  /** True when legal entities are registered (GL is the P&L source). */
  entitiesRegistered: boolean;
  /** True when ANY in-scope entity has journals in ANY scope period. */
  anyJournalsInScope: boolean;
  /** Scope periods (YYYY-MM) with no journals across all in-scope entities. */
  missingPeriods: string[];
  /** In-scope entity ids with no journals in any scope period. */
  entitiesWithoutJournals: string[];
  /** Per-entity scope periods (YYYY-MM) with no journals — includes
   *  PARTIAL absence (some months posted, others not). */
  missingByEntity: Record<string, string[]>;
}

export function computeGlPresence(
  byEntity: Record<string, GlEntityStatements>,
  entityIds: string[],
  periodIds: string[],
): GlPresence {
  const missingPeriods: string[] = [];
  for (const pid of periodIds) {
    const has = entityIds.some((eid) => byEntity[eid]?.flows[pid] !== undefined);
    if (!has) missingPeriods.push(pid);
  }
  const entitiesWithoutJournals = entityIds.filter(
    (eid) => !periodIds.some((pid) => byEntity[eid]?.flows[pid] !== undefined),
  );
  const missingByEntity: Record<string, string[]> = {};
  for (const eid of entityIds) {
    missingByEntity[eid] = periodIds.filter((pid) => byEntity[eid]?.flows[pid] === undefined);
  }
  return {
    entitiesRegistered: true,
    anyJournalsInScope: missingPeriods.length < periodIds.length,
    missingPeriods,
    entitiesWithoutJournals,
    missingByEntity,
  };
}

export interface UnpostedActivity {
  revenueUsd: number;
  costUsd: number; // direct + payroll + opex
  netUsd: number;
}

/** Facts-derived totals over the scope periods (USD, rounded). */
export function sumUnpostedActivity(
  monthly: Record<string, FactMonth>,
  periodIds: string[],
): UnpostedActivity {
  let revenue = 0;
  let cost = 0;
  for (const pid of periodIds) {
    const m = monthly[pid];
    if (!m) continue;
    revenue += m.revenueUsd;
    cost += m.directCostUsd + m.payrollUsd + m.opexUsd;
  }
  return {
    revenueUsd: Math.round(revenue),
    costUsd: Math.round(cost),
    netUsd: Math.round(revenue - cost),
  };
}

/** Submitted-but-unapproved expense spend (USD) over the scope periods. */
export function sumPendingApproval(
  pendingByMonth: Record<string, number>,
  periodIds: string[],
): number {
  return Math.round(periodIds.reduce((s, pid) => s + (pendingByMonth[pid] ?? 0), 0));
}
