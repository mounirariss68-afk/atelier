/**
 * Atelier — L2C Wave 2: Revenue Recognizer agent.
 * (Task #361 in `.local/tasks/l2c-wave-2-revrec-wip-margin.md`.)
 *
 * Deterministic compute for the five recognition methods. Same input
 * snapshot → identical output (smoke fixture asserts equality across
 * two runs). The function is pure: it takes a snapshot of the inputs
 * (engagement plan, hours-to-date, cost-to-date, milestone state) and
 * returns the period's basis_pct + recognised_amount + ending deferred
 * balance + the input shape it observed for traceability.
 *
 * In production (`ATELIER_MOCK_AGENTS != "1"`) the same compute is
 * still executed — Recognizer is RULE-BASED, not LLM-driven, because
 * ASC 606 / IFRS 15 reasoning must be auditable + idempotent. The
 * `runAgent` lifecycle wrapper still records the run in
 * `atelier_agent_runs` so the audit trail looks identical to other
 * agents.
 */

export type RevenueMethod =
  | "poc_hours"
  | "poc_cost"
  | "ratable"
  | "milestone"
  | "outcome";

export interface RecognizerInputs {
  engagementId: string;
  periodLabel: string; // YYYY-MM
  method: RevenueMethod | string;
  plannedTotalAmount: number;
  plannedHours: number;
  plannedCost: number;
  ratablePeriods: number;
  activeFrom: string | null;
  hoursToDate: number;
  costToDate: number;
  milestones: Array<{
    id: string;
    status: string;
    plannedAmount: number;
    earnedAmount: number;
  }>;
}

export interface RecognizerOutput {
  basisPct: number;
  recognisedAmount: number;
  deferredBalanceEnding: number;
  inputs: Record<string, unknown>;
}

function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function monthsBetween(from: string, period: string): number {
  // Both YYYY-MM (or YYYY-MM-DD for from). Compute inclusive month delta.
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const py = Number(period.slice(0, 4));
  const pm = Number(period.slice(5, 7));
  if (!fy || !fm || !py || !pm) return 0;
  const d = (py - fy) * 12 + (pm - fm) + 1;
  return d < 0 ? 0 : d;
}

/**
 * Pure deterministic compute. Same inputs → identical outputs.
 *
 * The four methods:
 *   poc_hours  — basis_pct = hoursToDate / plannedHours
 *                recognised = basis_pct × plannedTotalAmount
 *   poc_cost   — basis_pct = costToDate / plannedCost
 *                recognised = basis_pct × plannedTotalAmount
 *   ratable    — basis_pct = monthsElapsed / ratablePeriods
 *                recognised = basis_pct × plannedTotalAmount
 *   milestone  — sum(earnedAmount or plannedAmount where status='earned')
 *   outcome    — sum(earnedAmount where status in ('earned','client_accepted'))
 */
export function runRevenueRecognizer(input: RecognizerInputs): RecognizerOutput {
  let basisPct = 0;
  let recognisedAmount = 0;

  switch (input.method) {
    case "poc_hours": {
      basisPct = input.plannedHours > 0 ? clamp01(input.hoursToDate / input.plannedHours) : 0;
      recognisedAmount = basisPct * input.plannedTotalAmount;
      break;
    }
    case "poc_cost": {
      basisPct = input.plannedCost > 0 ? clamp01(input.costToDate / input.plannedCost) : 0;
      recognisedAmount = basisPct * input.plannedTotalAmount;
      break;
    }
    case "ratable": {
      if (input.ratablePeriods > 0 && input.activeFrom) {
        const elapsed = monthsBetween(input.activeFrom, input.periodLabel);
        basisPct = clamp01(elapsed / input.ratablePeriods);
        recognisedAmount = basisPct * input.plannedTotalAmount;
      }
      break;
    }
    case "milestone": {
      const earned = input.milestones.filter(
        (m) => m.status === "earned" || m.status === "invoiceable",
      );
      recognisedAmount = earned.reduce(
        (s, m) => s + (m.earnedAmount || m.plannedAmount),
        0,
      );
      basisPct =
        input.plannedTotalAmount > 0
          ? clamp01(recognisedAmount / input.plannedTotalAmount)
          : 0;
      break;
    }
    case "outcome": {
      const acceptedOrEarned = input.milestones.filter(
        (m) =>
          m.status === "earned" ||
          m.status === "client_accepted" ||
          m.status === "invoiceable",
      );
      recognisedAmount = acceptedOrEarned.reduce(
        (s, m) => s + (m.earnedAmount || m.plannedAmount),
        0,
      );
      basisPct =
        input.plannedTotalAmount > 0
          ? clamp01(recognisedAmount / input.plannedTotalAmount)
          : 0;
      break;
    }
    default: {
      // Unknown method → recognise nothing rather than crash. Catalog
      // gate should prevent this in practice.
      basisPct = 0;
      recognisedAmount = 0;
    }
  }

  // Round to cents for stable equality across two runs.
  recognisedAmount = Math.round(recognisedAmount * 100) / 100;
  basisPct = Math.round(basisPct * 10000) / 10000;
  const deferredBalanceEnding =
    Math.round((input.plannedTotalAmount - recognisedAmount) * 100) / 100;

  return {
    basisPct,
    recognisedAmount,
    deferredBalanceEnding,
    inputs: {
      method: input.method,
      periodLabel: input.periodLabel,
      engagementId: input.engagementId,
      plannedTotalAmount: input.plannedTotalAmount,
      plannedHours: input.plannedHours,
      plannedCost: input.plannedCost,
      ratablePeriods: input.ratablePeriods,
      activeFrom: input.activeFrom,
      hoursToDate: input.hoursToDate,
      costToDate: input.costToDate,
      milestoneCount: input.milestones.length,
      milestoneEarnedCount: input.milestones.filter(
        (m) => m.status === "earned" || m.status === "invoiceable",
      ).length,
      basisPct,
      recognisedAmount,
    },
  };
}
