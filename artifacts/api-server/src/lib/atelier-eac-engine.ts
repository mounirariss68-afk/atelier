/**
 * Atelier — Engagement EAC Engine (Task #414, Wave 2).
 *
 * Pure deterministic functions. Inputs are budget, cost-to-date, and ETC
 * (either a manual override or driver-based via %complete extrapolation).
 *
 * Definitions:
 *   - BAC  Budget at Completion (sum of labour + expenses + subs)
 *   - CTD  Costs to Date (labour at cost rate + expenses + subs)
 *   - ETC  Estimate to Complete (forward-looking)
 *   - EAC  Estimate at Completion (CTD + ETC)
 *   - VAC  Variance at Completion (BAC − EAC). Negative → over-run.
 *   - Forecast margin = (Contract value − EAC) / Contract value
 *
 * RAG bands match the firm's reporting convention used elsewhere in the
 * portal:
 *   green: forecast margin ≥ 0.40 AND VAC ≥ 0
 *   amber: forecast margin between 0.30 and 0.40, OR VAC slips up to 5% of BAC
 *   red:   forecast margin < 0.30 OR VAC slips more than 5% of BAC
 */

import {
  type EngagementBudget,
  type EngagementCostToDate,
  type EngagementEtc,
  type ChangeOrder,
} from "../data/atelier-engagement-pnl-seed.js";

export type RagStatus = "green" | "amber" | "red";

export interface EacResult {
  engagementId: string;
  contractValueUsd: number;
  bacUsd: number;
  ctdUsd: number;
  etcUsd: number;
  etcMethod: "manual" | "extrapolation";
  eacUsd: number;
  vacUsd: number; // BAC − EAC
  vacPctOfBac: number; // VAC / BAC
  varianceVsOriginalBudgetUsd: number; // alias for VAC for the page header
  forecastFinalMarginPct: number; // (contract − EAC) / contract
  plannedMarginPct: number; // (contract − BAC) / contract
  marginSlippagePct: number; // forecast − planned (negative = slipping)
  pctComplete: number;
  pctBilled: number; // invoiced / contract
  ragStatus: RagStatus;
}

export interface EngagementHealthRow extends EacResult {
  engagementName: string;
  partnerOwnerId: string;
  partnerOwnerName: string;
  engagementLeadId: string;
  engagementLeadName: string;
  sector: string;
  openChangeOrders: number;
  approvedChangeOrders: number;
  changeOrderValueUsd: number;
  // Cash / revenue snapshot for the register
  revenueRecognisedToDateUsd: number;
  invoicedToDateUsd: number;
  cashCollectedToDateUsd: number;
  grossMarginToDatePct: number;
  wipUsd: number; // recognised but not invoiced
  arUsd: number;  // invoiced but not collected
  lockupUsd: number; // wip + ar
}

export function safeDiv(num: number, denom: number): number {
  if (!denom || !isFinite(denom)) return 0;
  return num / denom;
}

/**
 * Compute ETC. If method === "manual" and a manualEtcUsd is set, use it.
 * Otherwise extrapolate: remaining_pct = (1 − pctComplete); ETC = CTD ×
 * remaining/done. If pctComplete ≤ 0 or 1, fall back to BAC − CTD.
 */
export function computeEtc(args: {
  budget: EngagementBudget;
  cost: EngagementCostToDate;
  etc: EngagementEtc;
}): { etcUsd: number; method: "manual" | "extrapolation" } {
  const { budget, cost, etc } = args;
  if (etc.method === "manual" && etc.manualEtcUsd != null) {
    return { etcUsd: Math.max(0, etc.manualEtcUsd), method: "manual" };
  }
  const done = cost.pctComplete;
  if (done <= 0) {
    return { etcUsd: Math.max(0, budget.budgetAtCompletionUsd - cost.costToDateUsd), method: "extrapolation" };
  }
  if (done >= 1) {
    return { etcUsd: 0, method: "extrapolation" };
  }
  const remaining = 1 - done;
  const extrapolated = cost.costToDateUsd * (remaining / done);
  return { etcUsd: Math.max(0, extrapolated), method: "extrapolation" };
}

export function ragFor(forecastMarginPct: number, vacPctOfBac: number): RagStatus {
  if (forecastMarginPct < 0.30 || vacPctOfBac < -0.05) return "red";
  if (forecastMarginPct < 0.40 || vacPctOfBac < 0) return "amber";
  return "green";
}

export function computeEac(args: {
  budget: EngagementBudget;
  cost: EngagementCostToDate;
  etc: EngagementEtc;
}): EacResult {
  const { budget, cost } = args;
  const { etcUsd, method } = computeEtc(args);
  const eac = cost.costToDateUsd + etcUsd;
  const vac = budget.budgetAtCompletionUsd - eac;
  const vacPct = safeDiv(vac, budget.budgetAtCompletionUsd);
  const forecastMargin = safeDiv(budget.contractValueUsd - eac, budget.contractValueUsd);
  const plannedMargin = safeDiv(
    budget.contractValueUsd - budget.budgetAtCompletionUsd,
    budget.contractValueUsd,
  );
  return {
    engagementId: budget.engagementId,
    contractValueUsd: budget.contractValueUsd,
    bacUsd: budget.budgetAtCompletionUsd,
    ctdUsd: cost.costToDateUsd,
    etcUsd,
    etcMethod: method,
    eacUsd: eac,
    vacUsd: vac,
    vacPctOfBac: vacPct,
    varianceVsOriginalBudgetUsd: vac,
    forecastFinalMarginPct: forecastMargin,
    plannedMarginPct: plannedMargin,
    marginSlippagePct: forecastMargin - plannedMargin,
    pctComplete: cost.pctComplete,
    pctBilled: safeDiv(cost.invoicedToDateUsd, budget.contractValueUsd),
    ragStatus: ragFor(forecastMargin, vacPct),
  };
}

export function summariseChangeOrders(cos: ChangeOrder[]): {
  open: number;
  approved: number;
  approvedValueUsd: number;
} {
  let open = 0;
  let approved = 0;
  let approvedValueUsd = 0;
  for (const c of cos) {
    if (c.status === "submitted" || c.status === "draft") open += 1;
    if (c.status === "approved") {
      approved += 1;
      approvedValueUsd += c.valueUsd;
    }
  }
  return { open, approved, approvedValueUsd };
}
