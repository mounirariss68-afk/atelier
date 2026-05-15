/**
 * Atelier — FP&A driver-based engine (Task #420, Wave 8).
 *
 * Single source of truth for the budget/forecast that the FP&A surfaces
 * (budget, headcount plan, scenarios, renewals, bonus accrual) consume.
 * The Wave-3 backlog page, Wave-5 firm-economics variance read-outs and
 * the Wave-1 Finance home tiles call into the same compute helpers, so
 * "plan" numbers stay consistent everywhere.
 *
 * Driver primitives (per entity × role × month):
 *   billableHours = headcount × monthlyHours × utilisation
 *   revenue       = billableHours × billRate × realisation × scenarioFx
 *   directCost    = headcount × loadedCostMonthly
 *   overhead      = fixedOverheadMonthly + revenue × variableOverheadPct
 *   ebitda        = revenue − directCost − overhead
 *
 * Scenarios apply multiplicative deltas on utilisation, rate, FX and
 * attrition (which trims headcount each month after the as-of date).
 *
 * All compute is pure / synchronous and seeded — no DB calls, FX is the
 * same FX_TO_USD table as the rest of the Plan layer. Process-local
 * overrides (e.g. lock a scenario as committed) are kept in the routes
 * file so the engine remains side-effect free.
 */

import { ENTITIES_SEED } from "./financeEntitiesRoutes";

export const FX_TO_USD: Record<string, number> = {
  USD: 1.0, GBP: 1.27, AED: 0.272, SAR: 0.267, EUR: 1.08,
};
export function toUsd(amount: number, currency: string): number {
  return amount * (FX_TO_USD[currency] ?? 1);
}
export function convertUsd(amountUsd: number, target: string): number {
  return amountUsd / (FX_TO_USD[target] ?? 1);
}

export const FPA_AS_OF: string = "2026-05-11";
export const FPA_FY_LABEL: string = "FY2026";

// ──────────────────────────────────────────────────────────────
// Roles — loaded cost & target rate are USD; localised by entity FX
// when consolidating into the entity's base currency.
// ──────────────────────────────────────────────────────────────
export interface Role {
  code: "P" | "SM" | "M" | "SC" | "C" | "A";
  label: string;
  loadedCostMonthlyUsd: number;
  billRateUsd: number;
  targetUtilisation: number;
  realisation: number;
  monthlyBillableHours: number;
  bonusTargetPctOfBase: number;
  baseSalaryAnnualUsd: number;
}
export const ROLES: Role[] = [
  { code: "P",  label: "Partner",           loadedCostMonthlyUsd: 28_000, billRateUsd: 650, targetUtilisation: 0.45, realisation: 0.92, monthlyBillableHours: 152, bonusTargetPctOfBase: 0.40, baseSalaryAnnualUsd: 280_000 },
  { code: "SM", label: "Senior Manager",    loadedCostMonthlyUsd: 18_000, billRateUsd: 480, targetUtilisation: 0.65, realisation: 0.90, monthlyBillableHours: 160, bonusTargetPctOfBase: 0.30, baseSalaryAnnualUsd: 175_000 },
  { code: "M",  label: "Manager",           loadedCostMonthlyUsd: 12_500, billRateUsd: 380, targetUtilisation: 0.72, realisation: 0.90, monthlyBillableHours: 160, bonusTargetPctOfBase: 0.20, baseSalaryAnnualUsd: 125_000 },
  { code: "SC", label: "Senior Consultant", loadedCostMonthlyUsd:  9_500, billRateUsd: 290, targetUtilisation: 0.78, realisation: 0.91, monthlyBillableHours: 160, bonusTargetPctOfBase: 0.15, baseSalaryAnnualUsd:  98_000 },
  { code: "C",  label: "Consultant",        loadedCostMonthlyUsd:  7_500, billRateUsd: 230, targetUtilisation: 0.80, realisation: 0.92, monthlyBillableHours: 160, bonusTargetPctOfBase: 0.10, baseSalaryAnnualUsd:  78_000 },
  { code: "A",  label: "Analyst",           loadedCostMonthlyUsd:  5_500, billRateUsd: 175, targetUtilisation: 0.82, realisation: 0.93, monthlyBillableHours: 160, bonusTargetPctOfBase: 0.08, baseSalaryAnnualUsd:  62_000 },
];
export const ROLE_BY_CODE: Record<Role["code"], Role> = Object.fromEntries(
  ROLES.map((r) => [r.code, r]),
) as Record<Role["code"], Role>;

// ──────────────────────────────────────────────────────────────
// Headcount plan — per entity × role, with starting headcount and
// a sparse list of planned hires/exits over the 12-month horizon.
// ──────────────────────────────────────────────────────────────
export interface HeadcountChange {
  monthIndex: number;            // 0 = May 2026 (FPA_AS_OF month)
  delta: number;                 // +N hires / -N exits
  reason: string;
}
export interface HeadcountPlanRow {
  entityId: string;
  roleCode: Role["code"];
  startingHeadcount: number;
  changes: HeadcountChange[];
}

export const HEADCOUNT_PLAN: HeadcountPlanRow[] = [
  // UK parent — partner/SM heavy, lean delivery
  { entityId: "fe_aico_uk",  roleCode: "P",  startingHeadcount: 3,  changes: [{ monthIndex: 6,  delta: 1, reason: "EMEA growth — promote SM" }] },
  { entityId: "fe_aico_uk",  roleCode: "SM", startingHeadcount: 4,  changes: [{ monthIndex: 6,  delta: -1, reason: "Promotion to Partner" }, { monthIndex: 8, delta: 1, reason: "Backfill hire" }] },
  { entityId: "fe_aico_uk",  roleCode: "M",  startingHeadcount: 5,  changes: [{ monthIndex: 4,  delta: 1, reason: "AI practice growth" }] },
  { entityId: "fe_aico_uk",  roleCode: "SC", startingHeadcount: 6,  changes: [{ monthIndex: 2,  delta: 1, reason: "BP Decarb staffing" }, { monthIndex: 9, delta: 1, reason: "Q4 ramp" }] },
  { entityId: "fe_aico_uk",  roleCode: "C",  startingHeadcount: 7,  changes: [{ monthIndex: 1,  delta: 2, reason: "Grad cohort" }, { monthIndex: 7, delta: -1, reason: "Voluntary attrition" }] },
  { entityId: "fe_aico_uk",  roleCode: "A",  startingHeadcount: 4,  changes: [{ monthIndex: 1,  delta: 3, reason: "Grad cohort" }] },

  // KSA sub — flagship growth market
  { entityId: "fe_aico_ksa", roleCode: "P",  startingHeadcount: 2,  changes: [{ monthIndex: 4,  delta: 1, reason: "PIF mega-deal anchor" }] },
  { entityId: "fe_aico_ksa", roleCode: "SM", startingHeadcount: 5,  changes: [{ monthIndex: 3,  delta: 1, reason: "Aramco Phase-3 prep" }, { monthIndex: 9, delta: 1, reason: "STC ramp" }] },
  { entityId: "fe_aico_ksa", roleCode: "M",  startingHeadcount: 8,  changes: [{ monthIndex: 2,  delta: 2, reason: "Riyadh delivery hub" }, { monthIndex: 7, delta: 1, reason: "Backfill attrition" }] },
  { entityId: "fe_aico_ksa", roleCode: "SC", startingHeadcount: 12, changes: [{ monthIndex: 1,  delta: 3, reason: "NEOM Sector-Lab M3" }, { monthIndex: 5, delta: 2, reason: "PIF prep" }, { monthIndex: 8, delta: -1, reason: "Voluntary" }] },
  { entityId: "fe_aico_ksa", roleCode: "C",  startingHeadcount: 18, changes: [{ monthIndex: 2,  delta: 4, reason: "Riyadh hub" }, { monthIndex: 6, delta: 3, reason: "Aramco" }, { monthIndex: 10, delta: -2, reason: "Annual attrition" }] },
  { entityId: "fe_aico_ksa", roleCode: "A",  startingHeadcount: 9,  changes: [{ monthIndex: 1,  delta: 5, reason: "Saudisation cohort" }] },

  // UAE DIFC sub
  { entityId: "fe_aico_uae", roleCode: "P",  startingHeadcount: 2,  changes: [] },
  { entityId: "fe_aico_uae", roleCode: "SM", startingHeadcount: 3,  changes: [{ monthIndex: 5,  delta: 1, reason: "ADQ shaping" }] },
  { entityId: "fe_aico_uae", roleCode: "M",  startingHeadcount: 6,  changes: [{ monthIndex: 3,  delta: 1, reason: "Mubadala expansion" }] },
  { entityId: "fe_aico_uae", roleCode: "SC", startingHeadcount: 9,  changes: [{ monthIndex: 2,  delta: 2, reason: "Emaar engagement" }, { monthIndex: 8, delta: -1, reason: "Voluntary" }] },
  { entityId: "fe_aico_uae", roleCode: "C",  startingHeadcount: 14, changes: [{ monthIndex: 4,  delta: 3, reason: "Q3 ramp" }] },
  { entityId: "fe_aico_uae", roleCode: "A",  startingHeadcount: 6,  changes: [{ monthIndex: 1,  delta: 3, reason: "Grad cohort" }] },

  // ADGM branch (small)
  { entityId: "fe_aico_uae_branch", roleCode: "M",  startingHeadcount: 2, changes: [] },
  { entityId: "fe_aico_uae_branch", roleCode: "SC", startingHeadcount: 3, changes: [{ monthIndex: 6, delta: 1, reason: "Sov-wealth practice" }] },
  { entityId: "fe_aico_uae_branch", roleCode: "C",  startingHeadcount: 4, changes: [] },

  // NEOM JV (focused team)
  { entityId: "fe_aico_jv_neom", roleCode: "SM", startingHeadcount: 1, changes: [{ monthIndex: 4, delta: 1, reason: "JV scope expand" }] },
  { entityId: "fe_aico_jv_neom", roleCode: "M",  startingHeadcount: 3, changes: [] },
  { entityId: "fe_aico_jv_neom", roleCode: "SC", startingHeadcount: 5, changes: [{ monthIndex: 2, delta: 2, reason: "Sector-Lab M3" }] },
  { entityId: "fe_aico_jv_neom", roleCode: "C",  startingHeadcount: 7, changes: [{ monthIndex: 3, delta: 2, reason: "Phase-2 ramp" }] },
];

// ──────────────────────────────────────────────────────────────
// Overhead plan per entity (USD/month + % of revenue variable)
// ──────────────────────────────────────────────────────────────
export const OVERHEAD_PLAN: Record<string, { fixedMonthlyUsd: number; variablePctOfRevenue: number; baseCurrency: string }> = {
  fe_aico_uk:         { fixedMonthlyUsd: 145_000, variablePctOfRevenue: 0.06, baseCurrency: "GBP" },
  fe_aico_ksa:        { fixedMonthlyUsd: 280_000, variablePctOfRevenue: 0.07, baseCurrency: "SAR" },
  fe_aico_uae:        { fixedMonthlyUsd: 210_000, variablePctOfRevenue: 0.06, baseCurrency: "AED" },
  fe_aico_uae_branch: { fixedMonthlyUsd:  55_000, variablePctOfRevenue: 0.05, baseCurrency: "AED" },
  fe_aico_jv_neom:    { fixedMonthlyUsd:  90_000, variablePctOfRevenue: 0.08, baseCurrency: "SAR" },
};

export const ENTITY_BASE_CURRENCY: Record<string, string> = Object.fromEntries(
  ENTITIES_SEED.map((e) => [e.id, e.baseCurrency]),
);
export const ENTITY_SHORT_NAME: Record<string, string> = Object.fromEntries(
  ENTITIES_SEED.map((e) => [e.id, e.shortName]),
);

// ──────────────────────────────────────────────────────────────
// Months — 12 months starting May 2026
// ──────────────────────────────────────────────────────────────
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export interface PlanMonth { index: number; iso: string; label: string; quarter: string }
export const PLAN_MONTHS: PlanMonth[] = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 4 + i, 1));
  const mo = d.getUTCMonth();
  const yr = d.getUTCFullYear();
  const q = `Q${Math.floor(mo / 3) + 1} ${yr}`;
  const iso = `${yr}-${String(mo + 1).padStart(2, "0")}-01`;
  return { index: i, iso, label: `${MONTH_LABELS[mo]} ${yr}`, quarter: q };
});

// ──────────────────────────────────────────────────────────────
// Scenarios — base, upside, downside, custom
// ──────────────────────────────────────────────────────────────
export interface Scenario {
  id: string;
  label: string;
  utilisationDelta: number;    // additive on top of role target (e.g. +0.05 = +5pts)
  rateDelta: number;           // multiplicative (e.g. 0.05 = +5%)
  fxDelta: number;             // multiplicative on non-USD revenue (e.g. -0.04 = -4%)
  attritionDelta: number;      // additive monthly attrition rate (e.g. 0.005 = +0.5%/mo)
  description: string;
}
// ──────────────────────────────────────────────────────────────
// Committed scenario state (Task #446).
//
// One scenario id can be marked as the "committed" forecast for the period
// by finance leadership. Variance reporting and the budget / scenarios
// pages key off this instead of always assuming "base". The state lives
// here as a small mutable ref so consumers (engine + routes) can resolve
// it synchronously; the source of truth is Postgres
// (atelier_finance_plan_commits) and the routes layer hydrates this ref
// at boot and write-through-updates it on POST /commit.
// ──────────────────────────────────────────────────────────────
let committedScenarioId: string | null = null;
export function getCommittedScenarioId(): string | null {
  return committedScenarioId;
}
export function setCommittedScenarioId(id: string | null): void {
  if (id !== null && !SCENARIOS.some((s) => s.id === id)) return;
  committedScenarioId = id;
}

export const SCENARIOS: Scenario[] = [
  { id: "base",     label: "Base case",  utilisationDelta:  0.00, rateDelta:  0.00, fxDelta:  0.00, attritionDelta: 0.000, description: "Plan-of-record. Driver targets, FX as of plan, no incremental attrition." },
  { id: "upside",   label: "Upside",     utilisationDelta:  0.05, rateDelta:  0.04, fxDelta:  0.02, attritionDelta: 0.000, description: "+5pt utilisation, +4% rate realisation, +2% FX tailwind." },
  { id: "downside", label: "Downside",   utilisationDelta: -0.07, rateDelta: -0.03, fxDelta: -0.04, attritionDelta: 0.008, description: "-7pt utilisation, -3% rate, -4% FX, +0.8%/mo attrition (talent flight)." },
  { id: "ksa_only", label: "KSA-led",    utilisationDelta:  0.03, rateDelta:  0.02, fxDelta:  0.00, attritionDelta: 0.000, description: "Aramco/PIF anchor cases land — moderate utilisation lift, KSA-skewed." },
];

// ──────────────────────────────────────────────────────────────
// Compute headcount per entity × role × month given a scenario
// ──────────────────────────────────────────────────────────────
export function headcountAt(row: HeadcountPlanRow, monthIndex: number, attritionDelta: number): number {
  let hc = row.startingHeadcount;
  for (const ch of row.changes) {
    if (ch.monthIndex <= monthIndex) hc += ch.delta;
  }
  // Scenario attrition compounds monthly after as-of (monthIndex 0)
  if (attritionDelta > 0 && monthIndex > 0) {
    hc = hc * Math.pow(1 - attritionDelta, monthIndex);
  }
  return Math.max(0, hc);
}

export interface MonthlyPlanLine {
  monthIndex: number; iso: string; label: string; quarter: string;
  revenueUsd: number;
  directCostUsd: number;
  overheadUsd: number;
  ebitdaUsd: number;
  fteEquivalent: number;
  billableHours: number;
  utilisedHours: number;
}
/**
 * Monthly plan-vs-actual line (Task #447).
 *
 * Actuals are sourced from the same engagement-economics surface that
 * /margin/firm and the Firm Economics page consume — held here as
 * per-entity variance ratios so the FP&A engine can derive an
 * elapsed-period actual without a second DB round-trip. Future months
 * (iso > as-of month) carry `null` for actual fields.
 */
export interface MonthlyPlanVsActualLine {
  monthIndex: number; iso: string; label: string; quarter: string;
  isElapsed: boolean;          // any portion of month <= as-of
  isPartial: boolean;          // partially elapsed (today before month-end)
  daysElapsed: number;
  daysInMonth: number;
  revenuePlanUsd: number;
  revenuePlanProratedUsd: number;
  revenueActualUsd: number | null;
  revenueVariancePct: number | null;
  ebitdaPlanUsd: number;
  ebitdaPlanProratedUsd: number;
  ebitdaActualUsd: number | null;
  ebitdaVariancePct: number | null;
}
export interface EntityRollup {
  entityId: string;
  shortName: string;
  baseCurrency: string;
  totalRevenueUsd: number;
  totalDirectCostUsd: number;
  totalOverheadUsd: number;
  totalEbitdaUsd: number;
  ebitdaMarginPct: number;
  endingHeadcount: number;
}
export interface RoleRollup {
  roleCode: Role["code"];
  roleLabel: string;
  totalHeadcountMonths: number;
  totalRevenueUsd: number;
  totalDirectCostUsd: number;
  contributionMarginUsd: number;
  contributionMarginPct: number;
}
export interface BudgetResp {
  asOf: string;
  fyLabel: string;
  scenarioId: string;
  scenarioLabel: string;
  presentationCurrency: string;
  entityFilter: string | null;
  months: MonthlyPlanLine[];
  monthsActual: MonthlyPlanVsActualLine[];   // Task #447 — plan vs actual per month
  totals: {
    revenue: number;
    directCost: number;
    overhead: number;
    ebitda: number;
    ebitdaMarginPct: number;
    grossMarginPct: number;
  };
  ytdActual: {                                // Task #447 — YTD actual vs plan
    throughIso: string;
    throughLabel: string;
    elapsedMonths: number;
    revenuePlanProrated: number;
    revenueActual: number;
    revenueVariancePct: number;
    ebitdaPlanProrated: number;
    ebitdaActual: number;
    ebitdaVariancePct: number;
  };
  byEntity: EntityRollup[];
  byRole: RoleRollup[];
  byQuarter: { quarter: string; revenue: number; ebitda: number }[];
  scenarios: Scenario[];
  driverNotes: string[];
}

/**
 * Per-entity actual variance ratios applied to plan to derive Wave-5
 * actuals (matches the realised-margin posture of the firm-economics
 * page: KSA outperforming, NEOM JV under-running, UK/UAE close to plan).
 */
const ACTUAL_VARIANCE_BY_ENTITY: Record<string, { revenueVar: number; ebitdaShiftPct: number }> = {
  fe_aico_uk:         { revenueVar: -0.038, ebitdaShiftPct: -0.012 },
  fe_aico_ksa:        { revenueVar:  0.062, ebitdaShiftPct:  0.018 },
  fe_aico_uae:        { revenueVar: -0.014, ebitdaShiftPct: -0.004 },
  fe_aico_uae_branch: { revenueVar:  0.008, ebitdaShiftPct:  0.000 },
  fe_aico_jv_neom:    { revenueVar: -0.082, ebitdaShiftPct: -0.022 },
};
function daysInMonthFor(iso: string): number {
  const [yr, mo] = iso.split("-").map(Number);
  return new Date(Date.UTC(yr, mo, 0)).getUTCDate();
}

export function computeBudget(
  scenarioId: string,
  presentation: string,
  entityFilter: string | null,
): BudgetResp {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const rows = HEADCOUNT_PLAN.filter((r) => !entityFilter || r.entityId === entityFilter);
  const entityIds = entityFilter
    ? [entityFilter]
    : Array.from(new Set(HEADCOUNT_PLAN.map((r) => r.entityId)));

  // Per month accumulator
  const monthly = PLAN_MONTHS.map((m): MonthlyPlanLine => ({
    monthIndex: m.index, iso: m.iso, label: m.label, quarter: m.quarter,
    revenueUsd: 0, directCostUsd: 0, overheadUsd: 0, ebitdaUsd: 0,
    fteEquivalent: 0, billableHours: 0, utilisedHours: 0,
  }));

  const entityAgg: Record<string, EntityRollup> = {};
  const roleAgg: Record<string, RoleRollup> = {};

  for (const row of rows) {
    const role = ROLE_BY_CODE[row.roleCode];
    if (!role) continue;
    const entCurrency = ENTITY_BASE_CURRENCY[row.entityId] ?? "USD";
    const isLocalNonUsd = entCurrency !== "USD";
    const fxAdj = isLocalNonUsd ? 1 + scenario.fxDelta : 1;
    const util = Math.max(0, role.targetUtilisation + scenario.utilisationDelta);
    const rate = role.billRateUsd * (1 + scenario.rateDelta);

    entityAgg[row.entityId] = entityAgg[row.entityId] ?? {
      entityId: row.entityId, shortName: ENTITY_SHORT_NAME[row.entityId] ?? row.entityId,
      baseCurrency: entCurrency, totalRevenueUsd: 0, totalDirectCostUsd: 0, totalOverheadUsd: 0,
      totalEbitdaUsd: 0, ebitdaMarginPct: 0, endingHeadcount: 0,
    };
    roleAgg[row.roleCode] = roleAgg[row.roleCode] ?? {
      roleCode: row.roleCode, roleLabel: role.label, totalHeadcountMonths: 0,
      totalRevenueUsd: 0, totalDirectCostUsd: 0, contributionMarginUsd: 0, contributionMarginPct: 0,
    };

    for (const m of PLAN_MONTHS) {
      const hc = headcountAt(row, m.index, scenario.attritionDelta);
      const billable = hc * role.monthlyBillableHours * util;
      const revenue = billable * rate * role.realisation * fxAdj;
      const direct = hc * role.loadedCostMonthlyUsd;

      const line = monthly[m.index];
      line.revenueUsd += revenue;
      line.directCostUsd += direct;
      line.fteEquivalent += hc;
      line.billableHours += hc * role.monthlyBillableHours;
      line.utilisedHours += billable;

      entityAgg[row.entityId].totalRevenueUsd += revenue;
      entityAgg[row.entityId].totalDirectCostUsd += direct;
      roleAgg[row.roleCode].totalRevenueUsd += revenue;
      roleAgg[row.roleCode].totalDirectCostUsd += direct;
      roleAgg[row.roleCode].totalHeadcountMonths += hc;
      if (m.index === PLAN_MONTHS.length - 1) {
        entityAgg[row.entityId].endingHeadcount += hc;
      }
    }
  }

  // Overhead — per entity, per month
  for (const entId of entityIds) {
    const ovh = OVERHEAD_PLAN[entId];
    if (!ovh) continue;
    for (const m of PLAN_MONTHS) {
      const line = monthly[m.index];
      // Variable overhead is calculated against this entity's revenue this month
      // We need per-entity revenue per month — recompute quickly from rows
      const entRows = rows.filter((r) => r.entityId === entId);
      let entRev = 0;
      for (const row of entRows) {
        const role = ROLE_BY_CODE[row.roleCode];
        const hc = headcountAt(row, m.index, scenario.attritionDelta);
        const util = Math.max(0, role.targetUtilisation + scenario.utilisationDelta);
        const rate = role.billRateUsd * (1 + scenario.rateDelta);
        const fxAdj = (ENTITY_BASE_CURRENCY[entId] ?? "USD") !== "USD" ? 1 + scenario.fxDelta : 1;
        entRev += hc * role.monthlyBillableHours * util * rate * role.realisation * fxAdj;
      }
      const ovhMonthly = ovh.fixedMonthlyUsd + entRev * ovh.variablePctOfRevenue;
      line.overheadUsd += ovhMonthly;
      const e = entityAgg[entId];
      if (e) e.totalOverheadUsd += ovhMonthly;
    }
  }

  // EBITDA per month + per entity
  for (const line of monthly) {
    line.ebitdaUsd = line.revenueUsd - line.directCostUsd - line.overheadUsd;
  }
  for (const e of Object.values(entityAgg)) {
    e.totalEbitdaUsd = e.totalRevenueUsd - e.totalDirectCostUsd - e.totalOverheadUsd;
    e.ebitdaMarginPct = e.totalRevenueUsd > 0 ? e.totalEbitdaUsd / e.totalRevenueUsd : 0;
  }
  for (const r of Object.values(roleAgg)) {
    r.contributionMarginUsd = r.totalRevenueUsd - r.totalDirectCostUsd;
    r.contributionMarginPct = r.totalRevenueUsd > 0 ? r.contributionMarginUsd / r.totalRevenueUsd : 0;
  }

  const totals = monthly.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.revenueUsd,
      directCost: acc.directCost + m.directCostUsd,
      overhead: acc.overhead + m.overheadUsd,
      ebitda: acc.ebitda + m.ebitdaUsd,
    }),
    { revenue: 0, directCost: 0, overhead: 0, ebitda: 0 },
  );

  const byQuarterMap: Record<string, { quarter: string; revenue: number; ebitda: number }> = {};
  for (const m of monthly) {
    byQuarterMap[m.quarter] = byQuarterMap[m.quarter] ?? { quarter: m.quarter, revenue: 0, ebitda: 0 };
    byQuarterMap[m.quarter].revenue += m.revenueUsd;
    byQuarterMap[m.quarter].ebitda += m.ebitdaUsd;
  }

  const conv = (n: number) => convertUsd(n, presentation);
  const monthsOut: MonthlyPlanLine[] = monthly.map((m) => ({
    ...m,
    revenueUsd: conv(m.revenueUsd),
    directCostUsd: conv(m.directCostUsd),
    overheadUsd: conv(m.overheadUsd),
    ebitdaUsd: conv(m.ebitdaUsd),
  }));

  // ── Plan vs Actual (Task #447) ──────────────────────────────────
  // Per-month firm-level revenue/EBITDA actuals are derived by
  // weighting per-entity plan share against ACTUAL_VARIANCE_BY_ENTITY.
  // Per-entity per-month plan revenue is computed inline from rows.
  const asOfDate = new Date(`${FPA_AS_OF}T00:00:00Z`);
  const asOfYm = `${asOfDate.getUTCFullYear()}-${String(asOfDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const asOfDay = asOfDate.getUTCDate();

  const entityActualByMonth: Record<string, { revenue: number; ebitda: number }[]> = {};
  for (const entId of entityIds) {
    const variance = ACTUAL_VARIANCE_BY_ENTITY[entId] ?? { revenueVar: 0, ebitdaShiftPct: 0 };
    const ovh = OVERHEAD_PLAN[entId];
    const entRows = rows.filter((r) => r.entityId === entId);
    entityActualByMonth[entId] = PLAN_MONTHS.map((m) => {
      let entRev = 0, entDirect = 0;
      for (const row of entRows) {
        const role = ROLE_BY_CODE[row.roleCode];
        if (!role) continue;
        const hc = headcountAt(row, m.index, scenario.attritionDelta);
        const util = Math.max(0, role.targetUtilisation + scenario.utilisationDelta);
        const rate = role.billRateUsd * (1 + scenario.rateDelta);
        const fxAdj = (ENTITY_BASE_CURRENCY[entId] ?? "USD") !== "USD" ? 1 + scenario.fxDelta : 1;
        entRev += hc * role.monthlyBillableHours * util * rate * role.realisation * fxAdj;
        entDirect += hc * role.loadedCostMonthlyUsd;
      }
      const entOvh = ovh ? ovh.fixedMonthlyUsd + entRev * ovh.variablePctOfRevenue : 0;
      const planRev = entRev;
      const planEbitda = entRev - entDirect - entOvh;
      const planMarginPct = planRev > 0 ? planEbitda / planRev : 0;
      const actualRev = planRev * (1 + variance.revenueVar);
      const actualMarginPct = planMarginPct + variance.ebitdaShiftPct;
      const actualEbitda = actualRev * actualMarginPct;
      return { revenue: actualRev, ebitda: actualEbitda };
    });
  }

  const monthsActual: MonthlyPlanVsActualLine[] = monthly.map((m) => {
    const monthYm = m.iso.slice(0, 7);
    const dim = daysInMonthFor(m.iso);
    let isElapsed = false;
    let isPartial = false;
    let daysElapsed = 0;
    if (monthYm < asOfYm) {
      isElapsed = true; daysElapsed = dim;
    } else if (monthYm === asOfYm) {
      isElapsed = true; isPartial = asOfDay < dim; daysElapsed = Math.min(asOfDay, dim);
    }
    const ratio = daysElapsed / dim;
    const planRev = m.revenueUsd;             // USD before currency conv
    const planEbitda = m.ebitdaUsd;
    const planRevPro = planRev * ratio;
    const planEbitdaPro = planEbitda * ratio;

    let actualRev: number | null = null;
    let actualEbitda: number | null = null;
    if (isElapsed) {
      actualRev = 0; actualEbitda = 0;
      for (const entId of entityIds) {
        const a = entityActualByMonth[entId][m.monthIndex];
        actualRev += a.revenue * ratio;
        actualEbitda += a.ebitda * ratio;
      }
    }
    const revVarPct = actualRev != null && planRevPro > 0 ? (actualRev - planRevPro) / planRevPro : null;
    const ebitdaVarPct = actualEbitda != null && Math.abs(planEbitdaPro) > 0 ? (actualEbitda - planEbitdaPro) / Math.abs(planEbitdaPro) : null;
    return {
      monthIndex: m.monthIndex, iso: m.iso, label: m.label, quarter: m.quarter,
      isElapsed, isPartial, daysElapsed, daysInMonth: dim,
      revenuePlanUsd: conv(planRev),
      revenuePlanProratedUsd: conv(planRevPro),
      revenueActualUsd: actualRev != null ? conv(actualRev) : null,
      revenueVariancePct: revVarPct,
      ebitdaPlanUsd: conv(planEbitda),
      ebitdaPlanProratedUsd: conv(planEbitdaPro),
      ebitdaActualUsd: actualEbitda != null ? conv(actualEbitda) : null,
      ebitdaVariancePct: ebitdaVarPct,
    };
  });

  // YTD aggregates across elapsed months
  const elapsed = monthsActual.filter((m) => m.isElapsed);
  const ytdPlanRev = elapsed.reduce((s, m) => s + m.revenuePlanProratedUsd, 0);
  const ytdActualRev = elapsed.reduce((s, m) => s + (m.revenueActualUsd ?? 0), 0);
  const ytdPlanEbitda = elapsed.reduce((s, m) => s + m.ebitdaPlanProratedUsd, 0);
  const ytdActualEbitda = elapsed.reduce((s, m) => s + (m.ebitdaActualUsd ?? 0), 0);
  const lastElapsed = elapsed[elapsed.length - 1];
  const throughIso = lastElapsed
    ? (lastElapsed.isPartial ? `${lastElapsed.iso.slice(0, 8)}${String(lastElapsed.daysElapsed).padStart(2, "0")}` : lastElapsed.iso)
    : FPA_AS_OF;
  const throughLabel = lastElapsed
    ? (lastElapsed.isPartial ? `${lastElapsed.label} (MTD ${lastElapsed.daysElapsed}/${lastElapsed.daysInMonth}d)` : lastElapsed.label)
    : "—";
  const ytdActual = {
    throughIso, throughLabel,
    elapsedMonths: elapsed.length,
    revenuePlanProrated: ytdPlanRev,
    revenueActual: ytdActualRev,
    revenueVariancePct: ytdPlanRev > 0 ? (ytdActualRev - ytdPlanRev) / ytdPlanRev : 0,
    ebitdaPlanProrated: ytdPlanEbitda,
    ebitdaActual: ytdActualEbitda,
    ebitdaVariancePct: Math.abs(ytdPlanEbitda) > 0 ? (ytdActualEbitda - ytdPlanEbitda) / Math.abs(ytdPlanEbitda) : 0,
  };

  return {
    asOf: FPA_AS_OF, fyLabel: FPA_FY_LABEL,
    scenarioId: scenario.id, scenarioLabel: scenario.label,
    presentationCurrency: presentation, entityFilter,
    months: monthsOut,
    monthsActual,
    ytdActual,
    totals: {
      revenue: conv(totals.revenue),
      directCost: conv(totals.directCost),
      overhead: conv(totals.overhead),
      ebitda: conv(totals.ebitda),
      ebitdaMarginPct: totals.revenue > 0 ? totals.ebitda / totals.revenue : 0,
      grossMarginPct: totals.revenue > 0 ? (totals.revenue - totals.directCost) / totals.revenue : 0,
    },
    byEntity: Object.values(entityAgg)
      .map((e) => ({
        ...e,
        totalRevenueUsd: conv(e.totalRevenueUsd),
        totalDirectCostUsd: conv(e.totalDirectCostUsd),
        totalOverheadUsd: conv(e.totalOverheadUsd),
        totalEbitdaUsd: conv(e.totalEbitdaUsd),
        endingHeadcount: Math.round(e.endingHeadcount),
      }))
      .sort((a, b) => b.totalRevenueUsd - a.totalRevenueUsd),
    byRole: Object.values(roleAgg)
      .map((r) => ({
        ...r,
        totalHeadcountMonths: Math.round(r.totalHeadcountMonths),
        totalRevenueUsd: conv(r.totalRevenueUsd),
        totalDirectCostUsd: conv(r.totalDirectCostUsd),
        contributionMarginUsd: conv(r.contributionMarginUsd),
      }))
      .sort((a, b) => b.totalRevenueUsd - a.totalRevenueUsd),
    byQuarter: Object.values(byQuarterMap).map((q) => ({
      quarter: q.quarter,
      revenue: conv(q.revenue),
      ebitda: conv(q.ebitda),
    })),
    scenarios: SCENARIOS,
    driverNotes: [
      `Driver model: revenue = headcount × ${ROLES[3].monthlyBillableHours}h × utilisation × rate × realisation × FX.`,
      `Direct cost = loaded monthly cost × headcount; overhead = fixed + ${(0.06 * 100).toFixed(0)}-${(0.08 * 100).toFixed(0)}% of revenue.`,
      `Scenario "${scenario.label}": utilisation Δ ${(scenario.utilisationDelta * 100).toFixed(1)}pt, rate Δ ${(scenario.rateDelta * 100).toFixed(1)}%, FX Δ ${(scenario.fxDelta * 100).toFixed(1)}%, monthly attrition Δ ${(scenario.attritionDelta * 100).toFixed(2)}%.`,
    ],
  };
}

// ──────────────────────────────────────────────────────────────
// Headcount detail (per entity × role) — for the headcount page
// ──────────────────────────────────────────────────────────────
export interface HeadcountDetailRow {
  entityId: string; entityShortName: string;
  roleCode: Role["code"]; roleLabel: string;
  startingHeadcount: number;
  endingHeadcount: number;
  netChange: number;
  byMonth: { monthIndex: number; iso: string; label: string; headcount: number }[];
  changes: HeadcountChange[];
}
export interface HeadcountResp {
  asOf: string;
  scenarioId: string;
  scenarioLabel: string;
  entityFilter: string | null;
  months: PlanMonth[];
  rows: HeadcountDetailRow[];
  totals: {
    startingHeadcount: number;
    endingHeadcount: number;
    netHires: number;
    plannedHires: number;
    plannedExits: number;
  };
  byEntity: { entityId: string; shortName: string; starting: number; ending: number; net: number }[];
  byRole: { roleCode: string; roleLabel: string; starting: number; ending: number; net: number }[];
  scenarios: Scenario[];
  asOfMonthLabel: string;
}
export function computeHeadcount(scenarioId: string, entityFilter: string | null): HeadcountResp {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const rows = HEADCOUNT_PLAN.filter((r) => !entityFilter || r.entityId === entityFilter);

  const detail: HeadcountDetailRow[] = rows.map((row) => {
    const role = ROLE_BY_CODE[row.roleCode];
    const byMonth = PLAN_MONTHS.map((m) => ({
      monthIndex: m.index, iso: m.iso, label: m.label,
      headcount: Math.round(headcountAt(row, m.index, scenario.attritionDelta) * 10) / 10,
    }));
    const ending = byMonth[byMonth.length - 1].headcount;
    return {
      entityId: row.entityId,
      entityShortName: ENTITY_SHORT_NAME[row.entityId] ?? row.entityId,
      roleCode: row.roleCode, roleLabel: role.label,
      startingHeadcount: row.startingHeadcount,
      endingHeadcount: ending,
      netChange: ending - row.startingHeadcount,
      byMonth, changes: row.changes,
    };
  });

  let plannedHires = 0, plannedExits = 0;
  for (const r of rows) for (const c of r.changes) {
    if (c.delta > 0) plannedHires += c.delta;
    else plannedExits += -c.delta;
  }
  const starting = detail.reduce((s, r) => s + r.startingHeadcount, 0);
  const ending = detail.reduce((s, r) => s + r.endingHeadcount, 0);

  const byEntityMap: Record<string, { entityId: string; shortName: string; starting: number; ending: number; net: number }> = {};
  const byRoleMap: Record<string, { roleCode: string; roleLabel: string; starting: number; ending: number; net: number }> = {};
  for (const r of detail) {
    byEntityMap[r.entityId] = byEntityMap[r.entityId] ?? { entityId: r.entityId, shortName: r.entityShortName, starting: 0, ending: 0, net: 0 };
    byEntityMap[r.entityId].starting += r.startingHeadcount;
    byEntityMap[r.entityId].ending += r.endingHeadcount;
    byEntityMap[r.entityId].net += r.netChange;
    byRoleMap[r.roleCode] = byRoleMap[r.roleCode] ?? { roleCode: r.roleCode, roleLabel: r.roleLabel, starting: 0, ending: 0, net: 0 };
    byRoleMap[r.roleCode].starting += r.startingHeadcount;
    byRoleMap[r.roleCode].ending += r.endingHeadcount;
    byRoleMap[r.roleCode].net += r.netChange;
  }

  return {
    asOf: FPA_AS_OF, scenarioId: scenario.id, scenarioLabel: scenario.label,
    entityFilter, months: PLAN_MONTHS, rows: detail,
    totals: { startingHeadcount: starting, endingHeadcount: Math.round(ending), netHires: Math.round(ending - starting), plannedHires, plannedExits },
    byEntity: Object.values(byEntityMap),
    byRole: Object.values(byRoleMap),
    scenarios: SCENARIOS,
    asOfMonthLabel: PLAN_MONTHS[0].label,
  };
}

// ──────────────────────────────────────────────────────────────
// Renewals calendar — frameworks + subscriptions (next 12 months)
// ──────────────────────────────────────────────────────────────
export interface RenewalRow {
  id: string;
  client: string;
  kind: "framework" | "msa" | "subscription" | "retainer" | "license";
  entityId: string;
  currency: string;
  arrLocal: number;
  expiresOn: string;
  ownerName: string;
  stage: "not_started" | "discovery" | "proposal_sent" | "in_negotiation" | "verbal_yes" | "at_risk" | "lost";
  riskBand: "low" | "medium" | "high";
  recommendation: string;
}
export const RENEWALS: RenewalRow[] = [
  { id: "rn_aramco_msa",   client: "Aramco Digital",   kind: "msa",          entityId: "fe_aico_ksa", currency: "SAR", arrLocal: 12_500_000, expiresOn: "2026-09-30", ownerName: "Layla Al-Mutairi",  stage: "in_negotiation", riskBand: "medium", recommendation: "Lock 18-month extension at +6% rate." },
  { id: "rn_dewa_retainer",client: "DEWA",             kind: "retainer",     entityId: "fe_aico_uae", currency: "AED", arrLocal:  4_800_000, expiresOn: "2026-12-31", ownerName: "Faisal Al-Suwaidi", stage: "discovery",       riskBand: "low",    recommendation: "Renew at flat with 4 added utilisation days." },
  { id: "rn_hsbc_msa",     client: "HSBC PLC",         kind: "msa",          entityId: "fe_aico_uk",  currency: "GBP", arrLocal:  1_900_000, expiresOn: "2026-11-30", ownerName: "Yara Nasser",       stage: "proposal_sent",   riskBand: "medium", recommendation: "Extend 24mo, new statement-of-work for AI risk." },
  { id: "rn_lloyds_msa",   client: "Lloyds",           kind: "msa",          entityId: "fe_aico_uk",  currency: "GBP", arrLocal:  1_300_000, expiresOn: "2026-12-31", ownerName: "Yara Nasser",       stage: "not_started",     riskBand: "high",   recommendation: "Schedule QBR before Aug; competitor incumbent risk." },
  { id: "rn_emirates_sub", client: "Emirates Group",   kind: "subscription", entityId: "fe_aico_uae", currency: "USD", arrLocal:    920_000, expiresOn: "2026-10-31", ownerName: "Faisal Al-Suwaidi", stage: "verbal_yes",      riskBand: "low",    recommendation: "Auto-renew clause triggers Sep 30 — confirm scope." },
  { id: "rn_neom_jv",      client: "NEOM Authority",   kind: "framework",    entityId: "fe_aico_jv_neom", currency: "SAR", arrLocal: 8_400_000, expiresOn: "2027-03-31", ownerName: "Yara Nasser",   stage: "not_started",     riskBand: "medium", recommendation: "JV governance review Q4; reset profit-share." },
  { id: "rn_mubadala_msa", client: "Mubadala",         kind: "msa",          entityId: "fe_aico_uae", currency: "AED", arrLocal:  6_200_000, expiresOn: "2026-08-31", ownerName: "Faisal Al-Suwaidi", stage: "in_negotiation", riskBand: "medium", recommendation: "Bundle TP advisory; +12% blended uplift target." },
  { id: "rn_sdaia_msa",    client: "SDAIA",            kind: "msa",          entityId: "fe_aico_ksa", currency: "SAR", arrLocal:  3_500_000, expiresOn: "2027-01-31", ownerName: "Layla Al-Mutairi",  stage: "discovery",       riskBand: "low",    recommendation: "Anchor on AI-governance practice, 24-month extension." },
  { id: "rn_bp_pilot",     client: "BP",               kind: "subscription", entityId: "fe_aico_uk",  currency: "GBP", arrLocal:    640_000, expiresOn: "2026-07-31", ownerName: "Yara Nasser",       stage: "at_risk",         riskBand: "high",   recommendation: "Decarb pilot conversion at risk — escalate to Partner." },
  { id: "rn_stc_lic",      client: "STC",              kind: "license",      entityId: "fe_aico_ksa", currency: "SAR", arrLocal:  2_100_000, expiresOn: "2026-12-15", ownerName: "Layla Al-Mutairi",  stage: "discovery",       riskBand: "medium", recommendation: "Move from license to outcome-based; expand seats." },
  { id: "rn_etisalat_ret", client: "Etisalat",         kind: "retainer",     entityId: "fe_aico_uae", currency: "AED", arrLocal:  1_950_000, expiresOn: "2027-02-28", ownerName: "Faisal Al-Suwaidi", stage: "not_started",     riskBand: "low",    recommendation: "Renew flat; consider AI-ops add-on." },
];

export interface RenewalsResp {
  asOf: string;
  presentationCurrency: string;
  entityFilter: string | null;
  totalsArr: { totalUsd: number; atRiskUsd: number; lowRiskUsd: number; highRiskUsd: number };
  byMonth: { monthIso: string; label: string; arrUsd: number; count: number; highRiskUsd: number }[];
  byOwner: { owner: string; arrUsd: number; count: number }[];
  byStage: { stage: string; arrUsd: number; count: number }[];
  rows: (RenewalRow & { arrUsd: number; daysUntil: number; entityShortName: string })[];
}
export function computeRenewals(presentation: string, entityFilter: string | null): RenewalsResp {
  const items = RENEWALS.filter((r) => !entityFilter || r.entityId === entityFilter);
  const today = new Date(`${FPA_AS_OF}T00:00:00Z`).getTime();
  const conv = (usd: number) => convertUsd(usd, presentation);

  const enriched = items.map((r) => {
    const arrUsd = toUsd(r.arrLocal, r.currency);
    const daysUntil = Math.round((new Date(`${r.expiresOn}T00:00:00Z`).getTime() - today) / 86_400_000);
    return { ...r, arrUsd, daysUntil, entityShortName: ENTITY_SHORT_NAME[r.entityId] ?? r.entityId };
  }).sort((a, b) => a.daysUntil - b.daysUntil);

  const totalUsd = enriched.reduce((s, r) => s + r.arrUsd, 0);
  const atRiskUsd = enriched.filter((r) => r.stage === "at_risk" || r.riskBand === "high").reduce((s, r) => s + r.arrUsd, 0);
  const lowRiskUsd = enriched.filter((r) => r.riskBand === "low").reduce((s, r) => s + r.arrUsd, 0);
  const highRiskUsd = enriched.filter((r) => r.riskBand === "high").reduce((s, r) => s + r.arrUsd, 0);

  const byMonthMap: Record<string, { monthIso: string; label: string; arrUsd: number; count: number; highRiskUsd: number }> = {};
  for (const r of enriched) {
    const d = new Date(`${r.expiresOn}T00:00:00Z`);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    byMonthMap[key] = byMonthMap[key] ?? { monthIso: `${key}-01`, label, arrUsd: 0, count: 0, highRiskUsd: 0 };
    byMonthMap[key].arrUsd += r.arrUsd;
    byMonthMap[key].count += 1;
    if (r.riskBand === "high" || r.stage === "at_risk") byMonthMap[key].highRiskUsd += r.arrUsd;
  }
  const byOwnerMap: Record<string, { owner: string; arrUsd: number; count: number }> = {};
  for (const r of enriched) {
    byOwnerMap[r.ownerName] = byOwnerMap[r.ownerName] ?? { owner: r.ownerName, arrUsd: 0, count: 0 };
    byOwnerMap[r.ownerName].arrUsd += r.arrUsd;
    byOwnerMap[r.ownerName].count += 1;
  }
  const byStageMap: Record<string, { stage: string; arrUsd: number; count: number }> = {};
  for (const r of enriched) {
    byStageMap[r.stage] = byStageMap[r.stage] ?? { stage: r.stage, arrUsd: 0, count: 0 };
    byStageMap[r.stage].arrUsd += r.arrUsd;
    byStageMap[r.stage].count += 1;
  }

  return {
    asOf: FPA_AS_OF, presentationCurrency: presentation, entityFilter,
    totalsArr: { totalUsd: conv(totalUsd), atRiskUsd: conv(atRiskUsd), lowRiskUsd: conv(lowRiskUsd), highRiskUsd: conv(highRiskUsd) },
    byMonth: Object.values(byMonthMap).sort((a, b) => a.monthIso.localeCompare(b.monthIso))
      .map((r) => ({ ...r, arrUsd: conv(r.arrUsd), highRiskUsd: conv(r.highRiskUsd) })),
    byOwner: Object.values(byOwnerMap).sort((a, b) => b.arrUsd - a.arrUsd)
      .map((r) => ({ ...r, arrUsd: conv(r.arrUsd) })),
    byStage: Object.values(byStageMap).map((r) => ({ ...r, arrUsd: conv(r.arrUsd) })),
    rows: enriched.map((r) => ({ ...r, arrUsd: conv(r.arrUsd) })),
  };
}

// ──────────────────────────────────────────────────────────────
// Bonus & commission accrual — per individual, gated on engagement
// margin (firm-wide proxy: scenario gross margin vs base case).
// Commission = % of net new ARR closed; bonus = % of base ×
// performance multiplier.
// ──────────────────────────────────────────────────────────────
export interface BonusPersonRow {
  id: string;
  name: string;
  roleCode: Role["code"];
  entityId: string;
  baseSalaryAnnualUsd: number;
  bonusTargetPctOfBase: number;
  individualPerfMultiplier: number;   // 0.5x..1.5x
  newArrClosedUsd: number;            // YTD net new ARR attributable
  commissionRate: number;             // % of new ARR (sales roles)
}
export const BONUS_PEOPLE: BonusPersonRow[] = [
  { id: "p_layla",  name: "Layla Al-Mutairi",  roleCode: "P",  entityId: "fe_aico_ksa", baseSalaryAnnualUsd: 305_000, bonusTargetPctOfBase: 0.40, individualPerfMultiplier: 1.20, newArrClosedUsd: 4_200_000, commissionRate: 0.015 },
  { id: "p_yara",   name: "Yara Nasser",       roleCode: "P",  entityId: "fe_aico_uk",  baseSalaryAnnualUsd: 295_000, bonusTargetPctOfBase: 0.40, individualPerfMultiplier: 1.10, newArrClosedUsd: 2_800_000, commissionRate: 0.015 },
  { id: "p_faisal", name: "Faisal Al-Suwaidi", roleCode: "P",  entityId: "fe_aico_uae", baseSalaryAnnualUsd: 290_000, bonusTargetPctOfBase: 0.40, individualPerfMultiplier: 1.05, newArrClosedUsd: 2_100_000, commissionRate: 0.015 },
  { id: "sm_omar",  name: "Omar El-Said",      roleCode: "SM", entityId: "fe_aico_ksa", baseSalaryAnnualUsd: 178_000, bonusTargetPctOfBase: 0.30, individualPerfMultiplier: 1.15, newArrClosedUsd: 1_400_000, commissionRate: 0.010 },
  { id: "sm_priya", name: "Priya Subramanian", roleCode: "SM", entityId: "fe_aico_uae", baseSalaryAnnualUsd: 172_000, bonusTargetPctOfBase: 0.30, individualPerfMultiplier: 1.00, newArrClosedUsd:   980_000, commissionRate: 0.010 },
  { id: "sm_thom",  name: "Thomas Reed",       roleCode: "SM", entityId: "fe_aico_uk",  baseSalaryAnnualUsd: 168_000, bonusTargetPctOfBase: 0.30, individualPerfMultiplier: 0.90, newArrClosedUsd:   620_000, commissionRate: 0.010 },
  { id: "m_hala",   name: "Hala Khoury",       roleCode: "M",  entityId: "fe_aico_ksa", baseSalaryAnnualUsd: 124_000, bonusTargetPctOfBase: 0.20, individualPerfMultiplier: 1.10, newArrClosedUsd:         0, commissionRate: 0 },
  { id: "m_ahmed",  name: "Ahmed Sharif",      roleCode: "M",  entityId: "fe_aico_uae", baseSalaryAnnualUsd: 122_000, bonusTargetPctOfBase: 0.20, individualPerfMultiplier: 1.00, newArrClosedUsd:         0, commissionRate: 0 },
  { id: "m_ella",   name: "Ella Whitfield",    roleCode: "M",  entityId: "fe_aico_uk",  baseSalaryAnnualUsd: 126_000, bonusTargetPctOfBase: 0.20, individualPerfMultiplier: 1.05, newArrClosedUsd:         0, commissionRate: 0 },
  { id: "m_zayd",   name: "Zayd Al-Otaibi",    roleCode: "M",  entityId: "fe_aico_ksa", baseSalaryAnnualUsd: 120_000, bonusTargetPctOfBase: 0.20, individualPerfMultiplier: 0.95, newArrClosedUsd:         0, commissionRate: 0 },
  { id: "sc_nora",  name: "Nora Bin Hamad",    roleCode: "SC", entityId: "fe_aico_ksa", baseSalaryAnnualUsd:  96_000, bonusTargetPctOfBase: 0.15, individualPerfMultiplier: 1.10, newArrClosedUsd:         0, commissionRate: 0 },
  { id: "sc_jad",   name: "Jad Issa",          roleCode: "SC", entityId: "fe_aico_uae", baseSalaryAnnualUsd:  98_000, bonusTargetPctOfBase: 0.15, individualPerfMultiplier: 1.00, newArrClosedUsd:         0, commissionRate: 0 },
  { id: "c_aya",    name: "Aya Othman",        roleCode: "C",  entityId: "fe_aico_uk",  baseSalaryAnnualUsd:  78_000, bonusTargetPctOfBase: 0.10, individualPerfMultiplier: 1.00, newArrClosedUsd:         0, commissionRate: 0 },
];

export interface BonusResp {
  asOf: string;
  scenarioId: string;
  scenarioLabel: string;
  presentationCurrency: string;
  entityFilter: string | null;
  marginGate: { firmGrossMarginPct: number; thresholdPct: number; gateMultiplier: number; passes: boolean };
  ytdProgressPct: number;             // months elapsed in plan year (proxy)
  totals: { bonusAccrual: number; commissionAccrual: number; combined: number; baseSalaryTotal: number };
  rows: {
    id: string; name: string; roleCode: string; roleLabel: string; entityId: string; entityShortName: string;
    baseSalary: number; bonusTargetPct: number; perfMultiplier: number; gateMultiplier: number;
    bonusAccrual: number; newArrClosed: number; commissionRate: number; commissionAccrual: number;
    combined: number;
  }[];
}
export function computeBonus(scenarioId: string, presentation: string, entityFilter: string | null): BonusResp {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  // Use the scenario's gross margin to gate bonus accrual.
  const budget = computeBudget(scenario.id, "USD", null);
  const baseGross = computeBudget("base", "USD", null).totals.grossMarginPct;
  const scenarioGross = budget.totals.grossMarginPct;
  const thresholdPct = baseGross * 0.92;          // 92% of base-case GM unlocks 100% gate
  // Linear gate: 0% at 80% of base GM, 100% at base GM, 120% at 110% of base GM.
  const ratio = baseGross > 0 ? scenarioGross / baseGross : 1;
  const gateMultiplier = Math.max(0, Math.min(1.2, (ratio - 0.80) / 0.20));
  const passes = scenarioGross >= thresholdPct;

  // YTD progress: as-of is May 11 → 5 months in / 12 → 41.7% YTD accrual proxy.
  const ytdProgress = 5 / 12;
  const conv = (usd: number) => convertUsd(usd, presentation);

  const people = BONUS_PEOPLE.filter((p) => !entityFilter || p.entityId === entityFilter);
  const rows = people.map((p) => {
    const role = ROLE_BY_CODE[p.roleCode];
    const annualBonus = p.baseSalaryAnnualUsd * p.bonusTargetPctOfBase * p.individualPerfMultiplier * gateMultiplier;
    const ytdBonus = annualBonus * ytdProgress;
    const commission = p.newArrClosedUsd * p.commissionRate;
    return {
      id: p.id, name: p.name, roleCode: p.roleCode, roleLabel: role.label,
      entityId: p.entityId, entityShortName: ENTITY_SHORT_NAME[p.entityId] ?? p.entityId,
      baseSalary: conv(p.baseSalaryAnnualUsd),
      bonusTargetPct: p.bonusTargetPctOfBase,
      perfMultiplier: p.individualPerfMultiplier,
      gateMultiplier,
      bonusAccrual: conv(ytdBonus),
      newArrClosed: conv(p.newArrClosedUsd),
      commissionRate: p.commissionRate,
      commissionAccrual: conv(commission),
      combined: conv(ytdBonus + commission),
    };
  }).sort((a, b) => b.combined - a.combined);

  const totals = rows.reduce(
    (acc, r) => ({
      bonusAccrual: acc.bonusAccrual + r.bonusAccrual,
      commissionAccrual: acc.commissionAccrual + r.commissionAccrual,
      combined: acc.combined + r.combined,
      baseSalaryTotal: acc.baseSalaryTotal + r.baseSalary,
    }),
    { bonusAccrual: 0, commissionAccrual: 0, combined: 0, baseSalaryTotal: 0 },
  );

  return {
    asOf: FPA_AS_OF,
    scenarioId: scenario.id, scenarioLabel: scenario.label,
    presentationCurrency: presentation, entityFilter,
    marginGate: {
      firmGrossMarginPct: scenarioGross,
      thresholdPct,
      gateMultiplier: Math.round(gateMultiplier * 100) / 100,
      passes,
    },
    ytdProgressPct: ytdProgress,
    totals,
    rows,
  };
}

// ──────────────────────────────────────────────────────────────
// Scenario-comparison helper — returns base + each variant for the
// scenarios page.
// ──────────────────────────────────────────────────────────────
export interface ScenarioComparison {
  presentationCurrency: string;
  entityFilter: string | null;
  asOf: string;
  comparisons: {
    scenarioId: string; scenarioLabel: string; description: string;
    revenue: number; ebitda: number; ebitdaMarginPct: number; grossMarginPct: number;
    deltas: { revenuePct: number; ebitdaPct: number; ebitdaMarginPctPts: number };
    quarter: { quarter: string; revenue: number; ebitda: number }[];
  }[];
}
export function compareScenarios(presentation: string, entityFilter: string | null): ScenarioComparison {
  const baseline = computeBudget("base", presentation, entityFilter);
  const comparisons = SCENARIOS.map((s) => {
    const b = computeBudget(s.id, presentation, entityFilter);
    return {
      scenarioId: s.id, scenarioLabel: s.label, description: s.description,
      revenue: b.totals.revenue,
      ebitda: b.totals.ebitda,
      ebitdaMarginPct: b.totals.ebitdaMarginPct,
      grossMarginPct: b.totals.grossMarginPct,
      deltas: {
        revenuePct: baseline.totals.revenue > 0 ? (b.totals.revenue - baseline.totals.revenue) / baseline.totals.revenue : 0,
        ebitdaPct: baseline.totals.ebitda > 0 ? (b.totals.ebitda - baseline.totals.ebitda) / baseline.totals.ebitda : 0,
        ebitdaMarginPctPts: b.totals.ebitdaMarginPct - baseline.totals.ebitdaMarginPct,
      },
      quarter: b.byQuarter,
    };
  });
  return {
    presentationCurrency: presentation, entityFilter,
    asOf: FPA_AS_OF, comparisons,
  };
}
