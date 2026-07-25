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

// ------------------------------------------------------------------ cost stack (Task #663)

export type CostLineType =
  | "llm_ai"
  | "hardware_infra"
  | "alliance_partner_quote"
  | "travel"
  | "other";

export const COST_LINE_TYPES: CostLineType[] = [
  "llm_ai",
  "hardware_infra",
  "alliance_partner_quote",
  "travel",
  "other",
];

export const COST_LINE_TYPE_LABELS: Record<CostLineType, string> = {
  llm_ai: "LLM / AI usage",
  hardware_infra: "Hardware / infrastructure",
  alliance_partner_quote: "Alliance partner quote",
  travel: "Travel",
  other: "Other",
};

/**
 * A typed non-labor cost line attached to a deal pricing. Amounts are USD.
 * `passThrough: true` lines are re-invoiced to the client at cost — they are
 * EXCLUDED from margin math but INCLUDED in the cash/invoice schedule.
 * Absorbed (default) lines are folded into delivery cost and eat margin.
 */
export interface CostLine {
  id?: string;
  type: CostLineType;
  label?: string;
  amountUsd: number;
  /** one_time (default) | weekly | monthly — recurring lines expand over the duration. */
  recurrence?: "one_time" | "weekly" | "monthly";
  /** one_time only — week offset from engagement start (default 0). */
  offsetWeeks?: number;
  passThrough?: boolean;
  /** alliance_partner_quote — linked partner-firm registry id. */
  partnerFirmId?: string | null;
  /** alliance_partner_quote — the partner's quoted amount (informational; amountUsd is what we cost). */
  quotedAmountUsd?: number | null;
}

/** Defensive normalization of persisted/user-supplied cost lines. */
export function normalizeCostLines(raw: unknown): CostLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CostLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = (COST_LINE_TYPES as string[]).includes(String(o.type))
      ? (String(o.type) as CostLineType)
      : "other";
    const amountUsd = Number(o.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd < 0) continue;
    const recurrence =
      o.recurrence === "weekly" || o.recurrence === "monthly" ? o.recurrence : "one_time";
    out.push({
      id: typeof o.id === "string" ? o.id : undefined,
      type,
      label: typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 120) : undefined,
      amountUsd: round2(amountUsd),
      recurrence,
      offsetWeeks:
        Number.isFinite(Number(o.offsetWeeks)) && Number(o.offsetWeeks) >= 0
          ? Math.round(Number(o.offsetWeeks))
          : 0,
      passThrough: o.passThrough === true,
      partnerFirmId: typeof o.partnerFirmId === "string" ? o.partnerFirmId : null,
      quotedAmountUsd:
        Number.isFinite(Number(o.quotedAmountUsd)) && Number(o.quotedAmountUsd) >= 0
          ? round2(Number(o.quotedAmountUsd))
          : null,
    });
  }
  return out.slice(0, 50);
}

export interface CostLineOccurrence {
  line: CostLine;
  week: number;
  amountUsd: number;
}

/** Expand cost lines into week-indexed occurrences over the duration. */
export function expandCostLines(lines: CostLine[], durationWeeks: number): CostLineOccurrence[] {
  const dur = Math.max(1, Math.round(durationWeeks));
  const out: CostLineOccurrence[] = [];
  for (const line of lines) {
    if (line.amountUsd <= 0) continue;
    if (line.recurrence === "weekly") {
      for (let w = 0; w < dur; w++) out.push({ line, week: w, amountUsd: line.amountUsd });
    } else if (line.recurrence === "monthly") {
      const months = Math.max(1, Math.ceil(dur / 4));
      for (let m = 0; m < months; m++) out.push({ line, week: m * 4, amountUsd: line.amountUsd });
    } else {
      out.push({ line, week: Math.min(dur, Math.max(0, line.offsetWeeks ?? 0)), amountUsd: line.amountUsd });
    }
  }
  return out;
}

export interface CostStackSummary {
  laborCostUsd: number;
  absorbedNonLaborUsd: number;
  passThroughUsd: number;
  lines: Array<{
    type: CostLineType;
    label: string;
    totalUsd: number;
    passThrough: boolean;
    partnerFirmId: string | null;
    quotedAmountUsd: number | null;
    recurrence: "one_time" | "weekly" | "monthly";
  }>;
}

export function summarizeCostStack(
  lines: CostLine[],
  durationWeeks: number,
  laborCostUsd: number,
): CostStackSummary {
  const occ = expandCostLines(lines, durationWeeks);
  const totals = new Map<CostLine, number>();
  for (const o of occ) totals.set(o.line, (totals.get(o.line) ?? 0) + o.amountUsd);
  let absorbed = 0;
  let passThrough = 0;
  const outLines: CostStackSummary["lines"] = [];
  for (const line of lines) {
    const total = round2(totals.get(line) ?? 0);
    if (total <= 0) continue;
    if (line.passThrough) passThrough += total;
    else absorbed += total;
    outLines.push({
      type: line.type,
      label: line.label ?? COST_LINE_TYPE_LABELS[line.type],
      totalUsd: total,
      passThrough: line.passThrough === true,
      partnerFirmId: line.partnerFirmId ?? null,
      quotedAmountUsd: line.quotedAmountUsd ?? null,
      recurrence: line.recurrence ?? "one_time",
    });
  }
  return {
    laborCostUsd: round2(laborCostUsd),
    absorbedNonLaborUsd: round2(absorbed),
    passThroughUsd: round2(passThrough),
    lines: outLines,
  };
}

// ------------------------------------------------------------------ outcome variants (Task #663)

export type OutcomeVariant =
  | "generic"
  | "gain_share"
  | "volume_unit"
  | "sla_based"
  | "success_fee";

export const OUTCOME_VARIANTS: OutcomeVariant[] = [
  "generic",
  "gain_share",
  "volume_unit",
  "sla_based",
  "success_fee",
];

export const OUTCOME_VARIANT_LABELS: Record<OutcomeVariant, string> = {
  generic: "Generic fee-at-risk",
  gain_share: "Value / gain-share",
  volume_unit: "Volume / per-unit",
  sla_based: "SLA credit / penalty",
  success_fee: "Success fee",
};

export interface GainShareParams {
  /** Agreed baseline the improvement is measured against (informational). */
  baselineUsd?: number;
  /** Cognirise's share of measured improvement (0..1). */
  sharePct: number;
  capUsd?: number;
  floorUsd?: number;
  improvementBestUsd: number;
  improvementExpectedUsd: number;
  improvementWorstUsd: number;
  /** Fixed base fee alongside the gain-share tranche (default 60% of fee). */
  baseFeeUsd?: number;
}

export interface VolumeUnitParams {
  unitLabel?: string;
  pricePerUnit: number;
  /** Tier breaks — marginal price per unit from `fromUnits` upward, ascending. */
  tiers?: Array<{ fromUnits: number; pricePerUnit: number }>;
  unitsBest: number;
  unitsExpected: number;
  unitsWorst: number;
  minimumFeeUsd?: number;
}

export interface SlaBandSpec {
  label?: string;
  /** Credit (positive) applied against the base fee when this band lands (0..1). */
  creditPct: number;
}

export interface SlaParams {
  baseFeeUsd?: number;
  bands: SlaBandSpec[];
  /** Which band index applies per scenario (default best=0, expected=0, worst=last). */
  scenarioBandIndex?: { best?: number; expected?: number; worst?: number };
}

export interface SuccessFeeParams {
  baseFeeUsd?: number;
  successFeeUsd: number;
  successProbabilityPct?: number;
}

export interface BandWeights {
  best: number;
  expected: number;
  worst: number;
}

/** Normalize user-supplied band weights; falls back to 0.2/0.6/0.2. */
export function normalizeBandWeights(raw: unknown): BandWeights {
  const fallback = { ...BAND_WEIGHTS };
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const best = Number(o.best);
  const expected = Number(o.expected);
  const worst = Number(o.worst);
  if (![best, expected, worst].every((n) => Number.isFinite(n) && n >= 0)) return fallback;
  const sum = best + expected + worst;
  if (sum <= 0) return fallback;
  return {
    best: round4(best / sum),
    expected: round4(expected / sum),
    worst: round4(worst / sum),
  };
}

/** Tiered (marginal) revenue for volume/unit pricing. */
export function tieredVolumeRevenue(p: VolumeUnitParams, units: number): number {
  const u = Math.max(0, units);
  const tiers = (p.tiers ?? [])
    .filter((t) => Number.isFinite(t.fromUnits) && t.fromUnits > 0 && Number.isFinite(t.pricePerUnit))
    .sort((a, b) => a.fromUnits - b.fromUnits);
  let revenue = 0;
  let prevBreak = 0;
  let prevPrice = Math.max(0, p.pricePerUnit);
  for (const t of tiers) {
    const span = Math.min(u, t.fromUnits) - prevBreak;
    if (span > 0) revenue += span * prevPrice;
    if (u <= t.fromUnits) {
      prevBreak = u;
      prevPrice = 0;
      break;
    }
    prevBreak = t.fromUnits;
    prevPrice = Math.max(0, t.pricePerUnit);
  }
  if (u > prevBreak && prevPrice > 0) revenue += (u - prevBreak) * prevPrice;
  return Math.max(round2(revenue), round2(p.minimumFeeUsd ?? 0));
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
  /** Scenario probability weights (normalized; default 0.2/0.6/0.2). */
  bandWeights?: Partial<BandWeights>;
  /** outcome_based / hybrid — which outcome mechanic applies (default "generic" = legacy math). */
  outcomeVariant?: OutcomeVariant;
  /** outcome variant params — only the one matching `outcomeVariant` is read. */
  gainShare?: GainShareParams;
  volume?: VolumeUnitParams;
  sla?: SlaParams;
  successFee?: SuccessFeeParams;
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
  /** Contingent on outcome/SLA/volume verification — billing must confirm manually. */
  contingent?: boolean;
  /** Pass-through cost re-invoiced at cost — excluded from margin math. */
  passThrough?: boolean;
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
    bandWeights: BandWeights;
    outcomeVariant?: OutcomeVariant;
  };
  /** Non-labor cost breakdown (labor + absorbed + pass-through). */
  costStack: CostStackSummary;
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
  /** Typed non-labor cost lines (Task #663). Absorbed lines add to cost; pass-through only to cash. */
  costLines?: CostLine[] | null;
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

  // Non-labor cost stack (Task #663). Absorbed lines add to delivery cost in
  // every band (they don't scale with labor over/underrun — they're committed
  // spend). Pass-through lines stay out of margin math entirely and are
  // appended to the cash profile as re-invoiced receipts.
  const costLines = normalizeCostLines(args.costLines ?? []);
  const laborCost = base.computedCostUsd;
  const costStack = summarizeCostStack(costLines, args.durationWeeks, laborCost);
  const absorbed = costStack.absorbedNonLaborUsd;

  const baseCost = round2(laborCost + absorbed);
  const basePrice = base.computedPriceUsd;
  const costBest = round2(laborCost * (1 - underrun) + absorbed);
  const costExp = baseCost;
  const costWorst = round2(laborCost * (1 + overrun) + absorbed);

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
      const variant: OutcomeVariant =
        p.outcomeVariant && OUTCOME_VARIANTS.includes(p.outcomeVariant)
          ? p.outcomeVariant
          : "generic";
      if (variant !== "generic") {
        const v = simulateOutcomeVariant(variant, p, fee, dur, termsWeeks, kind);
        best = { revenueUsd: v.revenueBest, costUsd: costBest, marginPct: 0 };
        expected = { revenueUsd: v.revenueExpected, costUsd: costExp, marginPct: 0 };
        worst = { revenueUsd: v.revenueWorst, costUsd: costWorst, marginPct: 0 };
        cashProfile = v.cashProfile;
        notes.push(...v.notes);
        break;
      }
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
          contingent: true,
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

  const weights = normalizeBandWeights(p.bandWeights);
  if (riskAdjusted === null) {
    riskAdjusted = round4(
      best.marginPct * weights.best +
        expected.marginPct * weights.expected +
        worst.marginPct * weights.worst,
    );
  }
  const gate = classifyMarginGate(riskAdjusted, args.policy);

  // Pass-through cost lines ride the invoice/cash schedule at cost (net of
  // payment terms) but never touch the margin bands above.
  for (const occ of expandCostLines(costLines, args.durationWeeks)) {
    if (!occ.line.passThrough) continue;
    cashProfile.push({
      week: occ.week + termsWeeks,
      amountUsd: occ.amountUsd,
      label: `Pass-through — ${occ.line.label ?? COST_LINE_TYPE_LABELS[occ.line.type]}`,
      passThrough: true,
    });
  }
  if (costStack.passThroughUsd > 0) {
    notes.push(
      `${costStack.passThroughUsd.toLocaleString()} of pass-through costs are re-invoiced at cost (excluded from margin).`,
    );
  }
  if (costStack.absorbedNonLaborUsd > 0) {
    notes.push(
      `${costStack.absorbedNonLaborUsd.toLocaleString()} of absorbed non-labor cost is folded into delivery cost across all bands.`,
    );
  }

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
            outcomeVariant:
              p.outcomeVariant && OUTCOME_VARIANTS.includes(p.outcomeVariant)
                ? p.outcomeVariant
                : "generic",
          }
        : {}),
      bandWeights: weights,
    },
    costStack,
    notes,
  };
}

/**
 * Outcome-based variant band revenues + cash (Task #663). The "generic"
 * variant never reaches here — legacy math is preserved verbatim in
 * simulateStructure so existing simulations are bit-identical.
 */
function simulateOutcomeVariant(
  variant: Exclude<OutcomeVariant, "generic">,
  p: StructureParams,
  fee: number,
  dur: number,
  termsWeeks: number,
  kind: PricingStructureKind,
): {
  revenueBest: number;
  revenueExpected: number;
  revenueWorst: number;
  cashProfile: CashReceipt[];
  notes: string[];
} {
  const notes: string[] = [];
  const baseFeeCash = (baseFee: number): CashReceipt[] => [
    { week: termsWeeks, amountUsd: round2(baseFee * 0.5), label: "Base fee — mobilization (50%)" },
    { week: Math.round(dur / 2) + termsWeeks, amountUsd: round2(baseFee * 0.5), label: "Base fee — midpoint (50%)" },
  ];
  const verifyWeek = Math.round(dur) + termsWeeks + 4; // outcome verification lag ~1 month

  switch (variant) {
    case "gain_share": {
      const g = p.gainShare;
      const share = clamp(g?.sharePct ?? 0.2, 0, 1);
      const cap = g?.capUsd != null && g.capUsd >= 0 ? g.capUsd : Number.POSITIVE_INFINITY;
      const floor = Math.max(0, g?.floorUsd ?? 0);
      const baseFee = round2(g?.baseFeeUsd ?? fee * 0.6);
      const tranche = (impr: number) =>
        round2(clamp(Math.max(0, impr) * share, floor, cap));
      const tBest = tranche(g?.improvementBestUsd ?? 0);
      const tExp = tranche(g?.improvementExpectedUsd ?? 0);
      const tWorst = tranche(g?.improvementWorstUsd ?? 0);
      notes.push(
        `Gain-share: ${(share * 100).toFixed(0)}% of measured improvement vs baseline` +
          `${g?.baselineUsd != null ? ` (${g.baselineUsd.toLocaleString()})` : ""}` +
          `${Number.isFinite(cap) ? `, capped at ${cap.toLocaleString()}` : ""}` +
          `${floor > 0 ? `, floor ${floor.toLocaleString()}` : ""}. Tranche is contingent on verified value.`,
      );
      return {
        revenueBest: round2(baseFee + tBest),
        revenueExpected: round2(baseFee + tExp),
        revenueWorst: round2(baseFee + tWorst),
        cashProfile: [
          ...baseFeeCash(baseFee),
          { week: verifyWeek, amountUsd: tExp, label: "Gain-share tranche (expected, contingent)", contingent: true },
        ],
        notes,
      };
    }
    case "volume_unit": {
      const v = p.volume;
      const params: VolumeUnitParams = {
        unitLabel: v?.unitLabel ?? "unit",
        pricePerUnit: Math.max(0, v?.pricePerUnit ?? 0),
        tiers: v?.tiers ?? [],
        unitsBest: Math.max(0, v?.unitsBest ?? 0),
        unitsExpected: Math.max(0, v?.unitsExpected ?? 0),
        unitsWorst: Math.max(0, v?.unitsWorst ?? 0),
        minimumFeeUsd: Math.max(0, v?.minimumFeeUsd ?? 0),
      };
      const rBest = tieredVolumeRevenue(params, params.unitsBest);
      const rExp = tieredVolumeRevenue(params, params.unitsExpected);
      const rWorst = tieredVolumeRevenue(params, params.unitsWorst);
      notes.push(
        `Volume-based: ${params.pricePerUnit.toLocaleString()} per ${params.unitLabel}` +
          `${(params.tiers?.length ?? 0) > 0 ? ` with ${params.tiers!.length} tier break(s)` : ""}` +
          `${params.minimumFeeUsd ? `, minimum fee ${params.minimumFeeUsd.toLocaleString()}` : ""}. Invoices ride verified volumes.`,
      );
      // Monthly in arrears on expected volumes; every receipt is contingent
      // on actual verified volume.
      const months = Math.max(1, Math.ceil(dur / 4));
      const per = round2(rExp / months);
      const cash: CashReceipt[] = Array.from({ length: months }, (_, i) => ({
        week: (i + 1) * 4 + termsWeeks,
        amountUsd: i === months - 1 ? round2(rExp - per * (months - 1)) : per,
        label: `Volume invoice — month ${i + 1} (expected volume, contingent)`,
        contingent: true,
      }));
      return { revenueBest: rBest, revenueExpected: rExp, revenueWorst: rWorst, cashProfile: cash, notes };
    }
    case "sla_based": {
      const s = p.sla;
      const baseFee = round2(s?.baseFeeUsd ?? fee);
      const bands: SlaBandSpec[] =
        s?.bands && s.bands.length > 0
          ? s.bands.map((b) => ({ label: b.label, creditPct: clamp(b.creditPct ?? 0, 0, 1) }))
          : [
              { label: "Met", creditPct: 0 },
              { label: "Minor breach", creditPct: 0.05 },
              { label: "Major breach", creditPct: 0.15 },
            ];
      const idx = (n: number | undefined, fallback: number) =>
        clamp(Math.round(n ?? fallback), 0, bands.length - 1);
      const iBest = idx(s?.scenarioBandIndex?.best, 0);
      const iExp = idx(s?.scenarioBandIndex?.expected, 0);
      const iWorst = idx(s?.scenarioBandIndex?.worst, bands.length - 1);
      const rev = (i: number) => round2(baseFee * (1 - bands[i].creditPct));
      notes.push(
        `SLA-based: fee ${baseFee.toLocaleString()} with ${bands.length} credit band(s); ` +
          `worst case assumes "${bands[iWorst].label ?? `band ${iWorst + 1}`}" (${(bands[iWorst].creditPct * 100).toFixed(0)}% credit). Credits settle after attainment review.`,
      );
      const months = Math.max(1, Math.ceil(dur / 4));
      const per = round2(rev(iExp) / months);
      const cash: CashReceipt[] = Array.from({ length: months }, (_, i) => ({
        week: (i + 1) * 4 + termsWeeks,
        amountUsd: i === months - 1 ? round2(rev(iExp) - per * (months - 1)) : per,
        label: `Service fee — month ${i + 1} (net of expected SLA credits, contingent)`,
        contingent: true,
      }));
      return { revenueBest: rev(iBest), revenueExpected: rev(iExp), revenueWorst: rev(iWorst), cashProfile: cash, notes };
    }
    case "success_fee": {
      const sf = p.successFee;
      const baseFee = round2(sf?.baseFeeUsd ?? fee * 0.7);
      const successFee = round2(Math.max(0, sf?.successFeeUsd ?? fee * 0.3));
      const prob = clamp(sf?.successProbabilityPct ?? p.successProbabilityPct ?? 0.7, 0, 1);
      notes.push(
        `Success fee: ${successFee.toLocaleString()} payable on the defined success event ` +
          `(expected probability ${(prob * 100).toFixed(0)}%)${kind === "hybrid" ? " on top of the base fee" : ""}.`,
      );
      return {
        revenueBest: round2(baseFee + successFee),
        revenueExpected: round2(baseFee + successFee * prob),
        revenueWorst: baseFee,
        cashProfile: [
          ...baseFeeCash(baseFee),
          {
            week: verifyWeek,
            amountUsd: round2(successFee * prob),
            label: `Success fee (expected value @ ${(prob * 100).toFixed(0)}%, contingent)`,
            contingent: true,
          },
        ],
        notes,
      };
    }
  }
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
  costLines?: CostLine[] | null;
}): StructureSimulation[] {
  return PRICING_STRUCTURE_KINDS.map((kind) =>
    simulateStructure({
      kind,
      params: args.paramsByKind?.[kind] ?? null,
      teamMix: args.teamMix,
      durationWeeks: args.durationWeeks,
      rateCardRows: args.rateCardRows,
      policy: args.policy,
      costLines: args.costLines ?? null,
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
    installments?: Array<{ key: string; dueDate: string; amount: number; label: string; passThrough?: boolean }>;
    /** Contingent (outcome/SLA/volume) components — flagged for MANUAL verification at billing time, never auto-invoiced. */
    contingentComponents?: Array<{ key: string; dueDate: string; expectedAmount: number; label: string }>;
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

  // Contingent receipts (outcome/SLA/volume tranches) are never auto-invoiced —
  // they are handed off as flagged components for manual verification.
  const contingentComponents = args.sim.cashProfile
    .filter((c) => c.contingent)
    .map((c, i) => ({
      key: `contingent-${slug(c.label)}-${i + 1}`,
      dueDate: dateAtWeek(c.week),
      expectedAmount: c.amountUsd,
      label: c.label,
    }));
  const contingentNote =
    contingentComponents.length > 0
      ? ` ${contingentComponents.length} contingent component(s) flagged for manual verification before invoicing.`
      : "";
  const passThroughInstallments = args.sim.cashProfile
    .filter((c) => c.passThrough)
    .map((c, i) => ({
      key: `passthrough-${slug(c.label)}-${i + 1}`,
      dueDate: dateAtWeek(c.week),
      amount: c.amountUsd,
      label: c.label,
      passThrough: true as const,
    }));
  const withContingent = (cfg: BillingHandoffPlan["config"]): BillingHandoffPlan["config"] =>
    contingentComponents.length > 0 ? { ...cfg, contingentComponents } : cfg;

  switch (args.kind) {
    case "tnm":
    case "capped_tnm":
      return {
        ruleType: "periodic_tnm",
        config: withContingent(
          passThroughInstallments.length > 0
            ? { cadence: "monthly", anchorDate: args.startDate, installments: passThroughInstallments }
            : { cadence: "monthly", anchorDate: args.startDate },
        ),
        notes:
          args.kind === "capped_tnm"
            ? `Capped T&M — monthly in arrears from actuals. Cumulative invoicing must not exceed the cap (${args.sim.assumptions.feeUsd ? "" : ""}see pricing structure params).${passThroughInstallments.length > 0 ? " Pass-through cost installments included at cost." : ""}${contingentNote}`
            : `T&M — monthly in arrears from timesheet actuals.${passThroughInstallments.length > 0 ? " Pass-through cost installments included at cost." : ""}${contingentNote}`,
      };
    case "retainer": {
      const nonFlagged = args.sim.cashProfile.filter((c) => !c.contingent && !c.passThrough);
      const monthly = nonFlagged[0]?.amountUsd ?? 0;
      const months = nonFlagged.length;
      return {
        ruleType: "retainer",
        config: withContingent({
          cadence: "monthly",
          amount: monthly,
          anchorDate: args.startDate,
          endDate: dateAtWeek(months * 4),
          ...(passThroughInstallments.length > 0 ? { installments: passThroughInstallments } : {}),
        }),
        notes: `Retainer — ${months} months at ${monthly.toLocaleString()} invoiced in advance.${passThroughInstallments.length > 0 ? " Pass-through cost installments included at cost." : ""}${contingentNote}`,
      };
    }
    case "milestone":
      return {
        ruleType: "milestone",
        config: withContingent(
          passThroughInstallments.length > 0 ? { installments: passThroughInstallments } : {},
        ),
        notes:
          "Milestone-triggered billing — amounts ride on engagement milestone rows; " +
          "mirror the pricing milestone schedule when creating milestones." +
          `${passThroughInstallments.length > 0 ? " Pass-through cost installments included at cost." : ""}${contingentNote}`,
      };
    case "fixed_fee":
    case "outcome_based":
    case "hybrid":
    default: {
      // Auto-invoiced installments = firm receipts (base fee + pass-through
      // at cost). Contingent tranches are EXCLUDED here and flagged for
      // manual verification via config.contingentComponents.
      const installments = args.sim.cashProfile
        .filter((c) => !c.contingent)
        .map((c, i) => ({
          key: `${slug(c.label)}-${i + 1}`,
          dueDate: dateAtWeek(c.week),
          amount: c.amountUsd,
          label: c.label,
          ...(c.passThrough ? { passThrough: true as const } : {}),
        }));
      return {
        ruleType: "fixed_fee",
        config: withContingent({ installments }),
        notes:
          (args.kind === "fixed_fee"
            ? "Fixed fee — installment schedule from the pricing structure."
            : "Base fee installments scheduled; contingent success/outcome tranches are flagged for manual verification — invoice on verified actuals, not expected value.") +
          contingentNote,
      };
    }
  }
}
