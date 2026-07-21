/**
 * Atelier — engagement pricing-structure simulation engine (Task #435).
 *
 * Extends the deterministic pricing core (atelier-pricing.ts) with the full
 * catalog of engagement pricing structures:
 *
 *   tnm            — classic time & materials (revenue = effort × client rate)
 *   capped_tnm     — T&M with a revenue cap; overruns burn cost past the cap
 *   fixed_fee      — fixed fee with an installment schedule
 *   milestone      — milestone-triggered payments
 *   retainer       — periodic retainer (monthly, in advance)
 *   outcome_based  — base fee + fee-at-risk paid on outcome achievement
 *   hybrid         — base fee + success fee (base+success blend)
 *
 * Every structure simulates three margin-band scenarios (best / expected /
 * worst), a risk-adjusted margin (probability-weighted across bands and,
 * where applicable, outcome-success probability), and a cash-receipt
 * profile (week-indexed expected receipts, net of payment terms).
 *
 * All math is deterministic and server-side (PRD §2.4). The Pricing
 * Analyst agent narrates around these numbers; it never invents them.
 */

import {
  computePricing,
  classifyMarginGate,
  type MarginPolicy,
  type RateCardRowLite,
  type TeamMixEntry,
} from "./atelier-pricing.js";

// ------------------------------------------------------------------ types

export type PricingStructureKind =
  | "tnm"
  | "capped_tnm"
  | "fixed_fee"
  | "milestone"
  | "retainer"
  | "outcome_based"
  | "hybrid";

export const PRICING_STRUCTURE_KINDS: PricingStructureKind[] = [
  "tnm",
  "capped_tnm",
  "fixed_fee",
  "milestone",
  "retainer",
  "outcome_based",
  "hybrid",
];

export const STRUCTURE_LABELS: Record<PricingStructureKind, string> = {
  tnm: "Time & Materials",
  capped_tnm: "Capped T&M",
  fixed_fee: "Fixed Fee",
  milestone: "Milestone-Based",
  retainer: "Retainer",
  outcome_based: "Outcome-Based (Fee at Risk)",
  hybrid: "Hybrid (Base + Success Fee)",
};

/** Legacy pricing_model values map onto structure kinds. */
export function normalizeStructureKind(model: string): PricingStructureKind {
  const m = (model || "").toLowerCase().trim();
  if (m === "time_and_materials" || m === "tnm" || m === "t&m") return "tnm";
  if ((PRICING_STRUCTURE_KINDS as string[]).includes(m)) return m as PricingStructureKind;
  return "tnm";
}

export interface InstallmentSpec {
  label: string;
  /** Fraction of the total fee (0..1). All installments should sum to ~1. */
  pctOfFee: number;
  /** Week offset (from engagement start) when the installment is invoiced. */
  offsetWeeks: number;
}

export interface StructureParams {
  /** capped_tnm — revenue cap as a fraction of base T&M price (e.g. 1.1). */
  capPctOfBase?: number;
  /** capped_tnm — absolute revenue cap (overrides capPctOfBase when set). */
  capUsd?: number;
  /** fixed_fee / milestone / outcome_based / hybrid — total fee. Defaults to base price. */
  feeUsd?: number;
  /** fixed_fee — installment schedule. Defaults to 40/40/20. */
  installments?: InstallmentSpec[];
  /** milestone — milestone payments (same shape as installments). */
  milestones?: InstallmentSpec[];
  /** retainer — monthly retainer amount. Defaults to base price / months. */
  monthlyAmountUsd?: number;
  /** retainer — number of months. Defaults to ceil(durationWeeks / 4). */
  months?: number;
  /** outcome_based / hybrid — fraction of the fee at risk / success-based (0..0.9). */
  feeAtRiskPct?: number;
  /** outcome_based / hybrid — probability the outcome/success fee pays out (0..1). */
  successProbabilityPct?: number;
  /** outcome_based / hybrid — success fee multiplier on the at-risk tranche (>= 1). */
  successMultiplier?: number;
  /** Delivery overrun applied to cost in the worst case (default 0.20). */
  worstCaseOverrunPct?: number;
  /** Delivery efficiency applied to cost in the best case (default 0.05). */
  bestCaseUnderrunPct?: number;
  /** Client payment terms in days (default 30) — shifts the cash profile. */
  paymentTermsDays?: number;
}

export interface ScenarioBand {
  revenueUsd: number;
  costUsd: number;
  marginPct: number;
}

export interface CashReceipt {
  week: number;
  amountUsd: number;
  label: string;
}

export interface StructureSimulation {
  kind: PricingStructureKind;
  label: string;
  scenarios: { best: ScenarioBand; expected: ScenarioBand; worst: ScenarioBand };
  /** Probability-weighted margin — this is what the margin lock gates on. */
  riskAdjustedMarginPct: number;
  marginLockStatus: "green" | "amber" | "red";
  partnerOverrideRequired: boolean;
  twoPartnerRequired: boolean;
  /** Expected-case cash receipts, week-indexed, net of payment terms. */
  cashProfile: CashReceipt[];
  cashTotalUsd: number;
  /** Weeks until 80% of expected cash has been received. */
  weeksToCash80: number;
  assumptions: Required<
    Pick<
      StructureParams,
      | "worstCaseOverrunPct"
      | "bestCaseUnderrunPct"
      | "paymentTermsDays"
    >
  > & {
    feeUsd: number;
    successProbabilityPct?: number;
    feeAtRiskPct?: number;
  };
  notes: string[];
}

// ------------------------------------------------------------------ helpers

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
function marginOf(revenue: number, cost: number): number {
  return revenue > 0 ? round4((revenue - cost) / revenue) : 0;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const DEFAULT_INSTALLMENTS: InstallmentSpec[] = [
  { label: "Mobilization (40%)", pctOfFee: 0.4, offsetWeeks: 0 },
  { label: "Midpoint (40%)", pctOfFee: 0.4, offsetWeeks: -1 }, // -1 = mid, resolved at runtime
  { label: "Completion (20%)", pctOfFee: 0.2, offsetWeeks: -2 }, // -2 = end
];

function resolveOffset(offset: number, durationWeeks: number): number {
  if (offset === -1) return Math.round(durationWeeks / 2);
  if (offset === -2) return Math.round(durationWeeks);
  return Math.max(0, Math.round(offset));
}

/** Band weights used for the risk-adjusted (probability-weighted) margin. */
const BAND_WEIGHTS = { best: 0.2, expected: 0.6, worst: 0.2 } as const;

// ------------------------------------------------------------------ engine

export function defaultStructureParams(
  kind: PricingStructureKind,
  basePriceUsd: number,
  durationWeeks: number,
): StructureParams {
  const months = Math.max(1, Math.ceil(durationWeeks / 4));
  switch (kind) {
    case "capped_tnm":
      return { capPctOfBase: 1.1 };
    case "fixed_fee":
      return { feeUsd: round2(basePriceUsd), installments: DEFAULT_INSTALLMENTS };
    case "milestone":
      return {
        feeUsd: round2(basePriceUsd),
        milestones: [
          { label: "Milestone 1 (30%)", pctOfFee: 0.3, offsetWeeks: Math.round(durationWeeks * 0.25) },
          { label: "Milestone 2 (40%)", pctOfFee: 0.4, offsetWeeks: Math.round(durationWeeks * 0.6) },
          { label: "Milestone 3 (30%)", pctOfFee: 0.3, offsetWeeks: Math.round(durationWeeks) },
        ],
      };
    case "retainer":
      return { months, monthlyAmountUsd: round2(basePriceUsd / months) };
    case "outcome_based":
      return { feeUsd: round2(basePriceUsd), feeAtRiskPct: 0.3, successProbabilityPct: 0.7, successMultiplier: 1.5 };
    case "hybrid":
      return { feeUsd: round2(basePriceUsd), feeAtRiskPct: 0.25, successProbabilityPct: 0.65, successMultiplier: 1.6 };
    case "tnm":
    default:
      return {};
  }
}

/**
 * Simulate one pricing structure against the deterministic effort baseline.
 * Baseline effort/cost/price come from computePricing (team mix × rate card).
 */
export function simulateStructure(args: {
  kind: PricingStructureKind;
  params?: StructureParams | null;
  teamMix: TeamMixEntry[];
  durationWeeks: number;
  rateCardRows: RateCardRowLite[];
  policy: MarginPolicy;
}): StructureSimulation {
  const kind = args.kind;
  const base = computePricing({
    teamMix: args.teamMix,
    durationWeeks: args.durationWeeks,
    rateCardRows: args.rateCardRows,
    policy: args.policy,
  });
  const p: StructureParams = {
    ...defaultStructureParams(kind, base.computedPriceUsd, args.durationWeeks),
    ...(args.params ?? {}),
  };
  const overrun = clamp(p.worstCaseOverrunPct ?? 0.2, 0, 1);
  const underrun = clamp(p.bestCaseUnderrunPct ?? 0.05, 0, 0.5);
  const terms = Math.max(0, Math.round(p.paymentTermsDays ?? 30));
  const termsWeeks = Math.round(terms / 7);
  const dur = Math.max(1, args.durationWeeks);

  const baseCost = base.computedCostUsd;
  const basePrice = base.computedPriceUsd;
  const costBest = round2(baseCost * (1 - underrun));
  const costExp = baseCost;
  const costWorst = round2(baseCost * (1 + overrun));

  const notes: string[] = [];
  let best: ScenarioBand;
  let expected: ScenarioBand;
  let worst: ScenarioBand;
  let cashProfile: CashReceipt[] = [];
  let riskAdjusted: number | null = null;
  const fee = round2(p.feeUsd ?? basePrice);

  switch (kind) {
    case "tnm": {
      // Revenue scales with effort — margin is stable across bands.
      best = { revenueUsd: round2(basePrice * (1 - underrun)), costUsd: costBest, marginPct: 0 };
      expected = { revenueUsd: basePrice, costUsd: costExp, marginPct: 0 };
      worst = { revenueUsd: round2(basePrice * (1 + overrun)), costUsd: costWorst, marginPct: 0 };
      cashProfile = monthlyArrearsProfile(basePrice, dur, termsWeeks, "T&M invoice");
      notes.push("Revenue tracks effort — overruns are billable, margin holds across bands.");
      break;
    }
    case "capped_tnm": {
      const cap = round2(p.capUsd ?? basePrice * (p.capPctOfBase ?? 1.1));
      best = { revenueUsd: round2(Math.min(cap, basePrice * (1 - underrun))), costUsd: costBest, marginPct: 0 };
      expected = { revenueUsd: round2(Math.min(cap, basePrice)), costUsd: costExp, marginPct: 0 };
      // Worst case: effort overruns but revenue stops at the cap.
      worst = { revenueUsd: round2(Math.min(cap, basePrice * (1 + overrun))), costUsd: costWorst, marginPct: 0 };
      cashProfile = monthlyArrearsProfile(expected.revenueUsd, dur, termsWeeks, "Capped T&M invoice");
      notes.push(`Revenue capped at ${cap.toLocaleString()} — overrun beyond the cap erodes margin directly.`);
      break;
    }
    case "fixed_fee":
    case "milestone": {
      best = { revenueUsd: fee, costUsd: costBest, marginPct: 0 };
      expected = { revenueUsd: fee, costUsd: costExp, marginPct: 0 };
      worst = { revenueUsd: fee, costUsd: costWorst, marginPct: 0 };
      const specs = (kind === "fixed_fee" ? p.installments : p.milestones) ?? DEFAULT_INSTALLMENTS;
      cashProfile = specs.map((s) => ({
        week: resolveOffset(s.offsetWeeks, dur) + termsWeeks,
        amountUsd: round2(fee * s.pctOfFee),
        label: s.label,
      }));
      notes.push(
        kind === "fixed_fee"
          ? "Fee is locked — delivery overrun is absorbed entirely by Cognirise."
          : "Payments trigger on milestone acceptance — slippage delays cash, overrun erodes margin.",
      );
      break;
    }
    case "retainer": {
      const months = Math.max(1, Math.round(p.months ?? Math.ceil(dur / 4)));
      const monthly = round2(p.monthlyAmountUsd ?? basePrice / months);
      const revenue = round2(monthly * months);
      best = { revenueUsd: revenue, costUsd: costBest, marginPct: 0 };
      expected = { revenueUsd: revenue, costUsd: costExp, marginPct: 0 };
      worst = { revenueUsd: revenue, costUsd: costWorst, marginPct: 0 };
      cashProfile = Array.from({ length: months }, (_, i) => ({
        week: i * 4 + termsWeeks, // invoiced in advance at month start
        amountUsd: monthly,
        label: `Retainer month ${i + 1}`,
      }));
      notes.push("Retainer smooths cash and locks capacity; demand spikes beyond the blend erode margin.");
      break;
    }
    case "outcome_based":
    case "hybrid": {
      const atRiskPct = clamp(p.feeAtRiskPct ?? (kind === "outcome_based" ? 0.3 : 0.25), 0, 0.9);
      const prob = clamp(p.successProbabilityPct ?? 0.7, 0, 1);
      const mult = Math.max(1, p.successMultiplier ?? 1.5);
      const baseFee = round2(fee * (1 - atRiskPct));
      const successFee = round2(fee * atRiskPct * mult);
      // Best: success fee pays, delivery efficient. Worst: no success fee, overrun.
      best = { revenueUsd: round2(baseFee + successFee), costUsd: costBest, marginPct: 0 };
      expected = { revenueUsd: round2(baseFee + successFee * prob), costUsd: costExp, marginPct: 0 };
      worst = { revenueUsd: baseFee, costUsd: costWorst, marginPct: 0 };
      cashProfile = [
        { week: termsWeeks, amountUsd: round2(baseFee * 0.5), label: "Base fee — mobilization (50%)" },
        { week: Math.round(dur / 2) + termsWeeks, amountUsd: round2(baseFee * 0.5), label: "Base fee — midpoint (50%)" },
        {
          week: Math.round(dur) + termsWeeks + 4, // outcome verification lag ~1 month
          amountUsd: round2(successFee * prob),
          label: `${kind === "hybrid" ? "Success" : "Outcome"} fee (expected value @ ${(prob * 100).toFixed(0)}%)`,
        },
      ];
      notes.push(
        `${(atRiskPct * 100).toFixed(0)}% of fee at risk at ${mult.toFixed(1)}x multiplier; ` +
          `expected payout probability ${(prob * 100).toFixed(0)}%. Gate uses the risk-adjusted margin.`,
      );
      break;
    }
    default: {
      best = { revenueUsd: basePrice, costUsd: costBest, marginPct: 0 };
      expected = { revenueUsd: basePrice, costUsd: costExp, marginPct: 0 };
      worst = { revenueUsd: basePrice, costUsd: costWorst, marginPct: 0 };
      cashProfile = monthlyArrearsProfile(basePrice, dur, termsWeeks, "Invoice");
    }
  }

  best.marginPct = marginOf(best.revenueUsd, best.costUsd);
  expected.marginPct = marginOf(expected.revenueUsd, expected.costUsd);
  worst.marginPct = marginOf(worst.revenueUsd, worst.costUsd);

  if (riskAdjusted === null) {
    riskAdjusted = round4(
      best.marginPct * BAND_WEIGHTS.best +
        expected.marginPct * BAND_WEIGHTS.expected +
        worst.marginPct * BAND_WEIGHTS.worst,
    );
  }
  const gate = classifyMarginGate(riskAdjusted, args.policy);

  cashProfile = cashProfile
    .filter((c) => c.amountUsd > 0)
    .sort((a, b) => a.week - b.week);
  const cashTotal = round2(cashProfile.reduce((s, c) => s + c.amountUsd, 0));
  let cum = 0;
  let weeksToCash80 = cashProfile.length ? cashProfile[cashProfile.length - 1].week : 0;
  for (const c of cashProfile) {
    cum += c.amountUsd;
    if (cashTotal > 0 && cum >= cashTotal * 0.8) {
      weeksToCash80 = c.week;
      break;
    }
  }

  return {
    kind,
    label: STRUCTURE_LABELS[kind],
    scenarios: { best, expected, worst },
    riskAdjustedMarginPct: riskAdjusted,
    marginLockStatus: gate.status,
    partnerOverrideRequired: gate.partnerOverrideRequired,
    twoPartnerRequired: gate.twoPartnerRequired,
    cashProfile,
    cashTotalUsd: cashTotal,
    weeksToCash80,
    assumptions: {
      worstCaseOverrunPct: overrun,
      bestCaseUnderrunPct: underrun,
      paymentTermsDays: terms,
      feeUsd: fee,
      ...(kind === "outcome_based" || kind === "hybrid"
        ? {
            successProbabilityPct: clamp(p.successProbabilityPct ?? 0.7, 0, 1),
            feeAtRiskPct: clamp(p.feeAtRiskPct ?? 0.3, 0, 0.9),
          }
        : {}),
    },
    notes,
  };
}

function monthlyArrearsProfile(
  totalUsd: number,
  durationWeeks: number,
  termsWeeks: number,
  label: string,
): CashReceipt[] {
  const months = Math.max(1, Math.ceil(durationWeeks / 4));
  const per = round2(totalUsd / months);
  return Array.from({ length: months }, (_, i) => ({
    week: (i + 1) * 4 + termsWeeks, // invoiced in arrears at month end
    amountUsd: i === months - 1 ? round2(totalUsd - per * (months - 1)) : per,
    label: `${label} — month ${i + 1}`,
  }));
}

/** Simulate every structure for side-by-side comparison. */
export function simulateAllStructures(args: {
  teamMix: TeamMixEntry[];
  durationWeeks: number;
  rateCardRows: RateCardRowLite[];
  policy: MarginPolicy;
  paramsByKind?: Partial<Record<PricingStructureKind, StructureParams>>;
}): StructureSimulation[] {
  return PRICING_STRUCTURE_KINDS.map((kind) =>
    simulateStructure({
      kind,
      params: args.paramsByKind?.[kind] ?? null,
      teamMix: args.teamMix,
      durationWeeks: args.durationWeeks,
      rateCardRows: args.rateCardRows,
      policy: args.policy,
    }),
  );
}

// ------------------------------------------------------------------ billing handoff

export interface BillingHandoffPlan {
  ruleType: "milestone" | "periodic_tnm" | "fixed_fee" | "retainer";
  config: {
    cadence?: "monthly";
    amount?: number;
    anchorDate?: string;
    endDate?: string;
    installments?: Array<{ key: string; dueDate: string; amount: number; label: string }>;
  };
  notes: string;
}

/**
 * Map a chosen pricing structure onto the billing engine's rule contract
 * (atelier_billing_rule ruleType + config). Deterministic — the caller
 * supplies the engagement start date to anchor installment due dates.
 */
export function buildBillingHandoff(args: {
  kind: PricingStructureKind;
  sim: StructureSimulation;
  startDate: string; // YYYY-MM-DD
}): BillingHandoffPlan {
  const start = new Date(`${args.startDate}T00:00:00Z`);
  const dateAtWeek = (week: number): string => {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(week)) * 7);
    return d.toISOString().slice(0, 10);
  };
  const slug = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "item";

  switch (args.kind) {
    case "tnm":
    case "capped_tnm":
      return {
        ruleType: "periodic_tnm",
        config: { cadence: "monthly", anchorDate: args.startDate },
        notes:
          args.kind === "capped_tnm"
            ? `Capped T&M — monthly in arrears from actuals. Cumulative invoicing must not exceed the cap (${args.sim.assumptions.feeUsd ? "" : ""}see pricing structure params).`
            : "T&M — monthly in arrears from timesheet actuals.",
      };
    case "retainer": {
      const monthly = args.sim.cashProfile[0]?.amountUsd ?? 0;
      const months = args.sim.cashProfile.length;
      return {
        ruleType: "retainer",
        config: {
          cadence: "monthly",
          amount: monthly,
          anchorDate: args.startDate,
          endDate: dateAtWeek(months * 4),
        },
        notes: `Retainer — ${months} months at ${monthly.toLocaleString()} invoiced in advance.`,
      };
    }
    case "milestone":
      return {
        ruleType: "milestone",
        config: {},
        notes:
          "Milestone-triggered billing — amounts ride on engagement milestone rows; " +
          "mirror the pricing milestone schedule when creating milestones.",
      };
    case "fixed_fee":
    case "outcome_based":
    case "hybrid":
    default: {
      const installments = args.sim.cashProfile.map((c, i) => ({
        key: `${slug(c.label)}-${i + 1}`,
        dueDate: dateAtWeek(c.week),
        amount: c.amountUsd,
        label: c.label,
      }));
      return {
        ruleType: "fixed_fee",
        config: { installments },
        notes:
          args.kind === "fixed_fee"
            ? "Fixed fee — installment schedule from the pricing structure."
            : "Base fee installments scheduled; the success/outcome tranche is included at expected value — adjust the final installment to actuals when the outcome is verified.",
      };
    }
  }
}
