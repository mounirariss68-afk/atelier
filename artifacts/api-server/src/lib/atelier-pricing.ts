/**
 * Atelier — deterministic pricing engine (Task #240).
 *
 * PRD §2.4: server-side math is the source of truth.
 * `cost  = sum(team_mix[i].fte_pct * weeks * 5 * day_rate_internal_cost) * (1 + overhead_pct)`
 * `price = sum(team_mix[i].fte_pct * weeks * 5 * day_rate_client_price)`
 * `margin = (price - cost) / price`
 *
 * No LLM math. Strategist agent narrates around these numbers; never
 * invents them.
 */

export interface RateCardRowLite {
  seniority: string;
  dayRateInternalCost: number;
  dayRateClientPrice: number;
  overheadPct: number;
}

export interface TeamMixEntry {
  seniority: string;
  role?: string;
  ftePct: number; // 0..1
}

export interface MarginPolicy {
  targetMarginPct: number;
  amberThresholdPct: number;
  redThresholdPct: number;
  twoPartnerThresholdPct: number;
}

export interface PricingComputeResult {
  computedCostUsd: number;
  computedPriceUsd: number;
  computedMarginPct: number;
  marginLockStatus: "green" | "amber" | "red";
  twoPartnerRequired: boolean;
  perRoleBreakdown: Array<{
    seniority: string;
    role?: string;
    ftePct: number;
    days: number;
    cost: number;
    price: number;
    matched: boolean;
  }>;
}

const DAYS_PER_WEEK = 5;

export function computePricing(args: {
  teamMix: TeamMixEntry[];
  durationWeeks: number;
  rateCardRows: RateCardRowLite[];
  policy: MarginPolicy;
}): PricingComputeResult {
  const days = Math.max(0, args.durationWeeks) * DAYS_PER_WEEK;
  const breakdown: PricingComputeResult["perRoleBreakdown"] = [];
  let fullyLoadedCost = 0;
  let price = 0;
  for (const entry of args.teamMix) {
    const row = args.rateCardRows.find((r) => r.seniority === entry.seniority);
    const fte = Math.max(0, entry.ftePct);
    const personDays = fte * days;
    // PRD §2.4 — apply overhead per-row so the breakdown sums to the total.
    const lineCost = row
      ? personDays * row.dayRateInternalCost * (1 + (row.overheadPct ?? 0))
      : 0;
    const linePrice = row ? personDays * row.dayRateClientPrice : 0;
    fullyLoadedCost += lineCost;
    price += linePrice;
    breakdown.push({
      seniority: entry.seniority,
      role: entry.role,
      ftePct: fte,
      days: personDays,
      cost: round2(lineCost),
      price: round2(linePrice),
      matched: !!row,
    });
  }
  const margin = price > 0 ? (price - fullyLoadedCost) / price : 0;
  return {
    computedCostUsd: round2(fullyLoadedCost),
    computedPriceUsd: round2(price),
    computedMarginPct: round4(margin),
    marginLockStatus: classifyMarginStatus(margin, args.policy),
    twoPartnerRequired: margin < args.policy.twoPartnerThresholdPct,
    perRoleBreakdown: breakdown,
  };
}

export function classifyMarginStatus(
  margin: number,
  policy: MarginPolicy,
): "green" | "amber" | "red" {
  if (margin >= policy.targetMarginPct) return "green";
  if (margin >= policy.redThresholdPct) return "amber";
  return "red";
}

/**
 * Single source of truth for the Atelier v2 margin-lock workflow.
 *
 * - `status` — chip colour (uses targetMarginPct + redThresholdPct).
 * - `partnerOverrideRequired` — true when the deal is below target margin
 *   (AMBER or RED). Single-Partner override is always required when below
 *   target, regardless of where the two-Partner threshold sits.
 * - `twoPartnerRequired` — true when the deal is below the configurable
 *   `twoPartnerThresholdPct`. This may differ from `redThresholdPct`, and
 *   is the *only* signal used by countersign / submit-gate / Pane A escalation.
 *
 * Use this helper everywhere the margin gate is evaluated (pricingRoutes
 * override + countersign, proposalRoutes send-gate, agent runner) so that
 * non-default policy combinations cannot deadlock or escalate incorrectly.
 */
export function classifyMarginGate(
  margin: number,
  policy: MarginPolicy,
): {
  status: "green" | "amber" | "red";
  partnerOverrideRequired: boolean;
  twoPartnerRequired: boolean;
} {
  const status = classifyMarginStatus(margin, policy);
  return {
    status,
    partnerOverrideRequired: status !== "green",
    twoPartnerRequired: margin < policy.twoPartnerThresholdPct,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
