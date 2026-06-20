/**
 * Atelier v5 — React Query hooks for the Postgres-backed Press, Alliances,
 * Studio, Guardhouse, and IP-catalog surfaces (Task #354).
 *
 * The hooks return plain arrays / objects (defaulted to empty) so the page
 * components can keep iterating directly without an extra null-guard. Cookies
 * are sent so the active persona on the API side resolves correctly.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// Atelier proxy mounts the api-server at /api/*; using a vite-base-prefixed URL
// (e.g. /atelier/api/atelier/...) gets swallowed by the SPA fallback, so target
// the API directly.
const API_BASE = "/api/atelier";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Atelier API ${path} failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

// Several finance/plan hooks below were authored against a `planGet` helper
// that historically aliased `get`. Keep the alias alive in one place so the
// callsites continue to work.
const planGet = get;

function listHook<T>(key: string, path: string) {
  return function useList(): T[] {
    const q = useQuery<{ items: T[] }>({
      queryKey: ["atelier-v5", key],
      queryFn: () => get<{ items: T[] }>(path),
      staleTime: 30_000,
    });
    return q.data?.items ?? [];
  };
}

// ============================================================
// Finance — Entities backbone (Task #372)
// ============================================================
export interface FinanceEntityRow {
  id: string;
  legalName: string;
  shortName: string;
  kind: "parent" | "subsidiary" | "branch" | "jv";
  parentId: string | null;
  status: "active" | "dormant" | "winding_down";
  country: "SA" | "AE" | "GB";
  jurisdiction: string;
  baseCurrency: string;
  reportingCurrency: string;
  incorporatedOn: string;
  commercialRegistration: { number: string; authority: string; expiresOn: string };
  taxIds: { vat: string | null; corporate: string | null; whtAgent: string | null };
  eInvoicing: Array<{
    scheme: "ZATCA" | "FTA" | "Peppol" | "HMRC_MTD";
    id: string;
    status: "live" | "sandbox" | "pending";
    enrolledAt: string;
  }>;
  tradeLicenses: Array<{
    id: string;
    authority: string;
    number: string;
    issuedOn: string;
    expiresOn: string;
    status: "active" | "expiring_soon" | "expired" | "renewal_in_progress";
    scope: string;
  }>;
  bankAccounts: Array<{
    id: string;
    bank: string;
    iban: string;
    currency: string;
    purpose: "operating" | "tax" | "payroll" | "escrow";
    signatories: string[];
    primary: boolean;
  }>;
  signatories: Array<{
    id: string;
    name: string;
    role: string;
    authorityLevel: "A" | "B" | "C";
    resolutionRef: string | null;
  }>;
  fiscal: {
    yearEnd: string;
    vatPeriod: "monthly" | "quarterly";
    ctPeriod: "annual";
    nextClose: string;
    nextVatFiling: string;
    nextCtFiling: string;
  };
  interCompany: Array<{
    counterpartyId: string;
    relationship: "subsidiary" | "branch" | "shareholder" | "service_provider";
    tpMethod: "TNMM" | "CUP" | "Cost+" | "ResalePrice";
    intercoServiceFeePct: number | null;
  }>;
  staffCount: number;
  notes: string;
}
export const useFinanceEntities = listHook<FinanceEntityRow>(
  "finance-entities",
  "/finance/entities",
);

// ============================================================
// Finance — Comply (Task #419, Wave 7)
// ============================================================
export interface InternalControlRow {
  id: string;
  title: string;
  description: string;
  area: "revenue" | "ar" | "cash" | "ap" | "payroll" | "journals" | "itgc";
  owner: string;
  ownerRole: string;
  frequency: "per_transaction" | "daily" | "monthly" | "quarterly" | "annual";
  evidenceCadence: string;
  lastTestedOn: string;
  lastResult: "pass" | "fail" | "exception" | "not_tested";
  exceptionsOpen: number;
  remediation: string | null;
  appliesToEntities: string[];
}
export const useInternalControls = listHook<InternalControlRow>(
  "finance-controls",
  "/finance/comply/controls",
);

export interface SoDConflictRow {
  id: string;
  title: string;
  description: string;
  rolesA: string[];
  rolesB: string[];
  severity: "high" | "medium" | "low";
  currentlyViolatingPeople: { name: string; role: string }[];
  mitigation: string;
  linkedControlIds: string[];
}
export const useSoDConflicts = listHook<SoDConflictRow>(
  "finance-sod",
  "/finance/comply/sod",
);

export interface StatutoryFilingRow {
  id: string;
  entityId: string;
  kind: string;
  authority: string;
  description: string;
  dueOn: string;
  status: "not_started" | "in_progress" | "filed" | "overdue";
  owner: string;
  evidenceUrl: string | null;
  notes: string;
}
export const useStatutoryFilings = listHook<StatutoryFilingRow>(
  "finance-statutory",
  "/finance/comply/statutory",
);

export interface TpFileVersionRow {
  version: string;
  publishedOn: string;
  author: string;
  notes: string;
}
export interface RelatedPartyTransactionRow {
  id: string;
  entityAId: string;
  entityBId: string;
  description: string;
  fyAmountUsdK: number;
  basis: string;
}
export interface TpRegisterRow {
  id: string;
  entityAId: string;
  entityBId: string;
  relationship: string;
  tpMethod: "TNMM" | "CUP" | "Cost+" | "ResalePrice";
  intercoServiceFeePct: number | null;
  benchmarkRange: string;
  benchmarkSource: string;
  masterFile: { current: TpFileVersionRow | null; history: TpFileVersionRow[] };
  localFile: { current: TpFileVersionRow | null; history: TpFileVersionRow[] };
  relatedPartyTransactions: RelatedPartyTransactionRow[];
  notes: string;
}
export const useTpRegister = listHook<TpRegisterRow>(
  "finance-tp",
  "/finance/comply/tp",
);

export interface InsurancePolicyRow {
  id: string;
  entityId: string;
  kind: "Professional Indemnity" | "D&O" | "Employer's Liability" | "Cyber" | "Office / Property";
  insurer: string;
  policyNumber: string;
  periodFrom: string;
  periodTo: string;
  coverageUsdK: number;
  premiumUsdK: number;
  excessUsdK: number;
  status: "active" | "expiring_soon" | "expired" | "renewal_in_progress";
  renewalOwner: string;
  notes: string;
}
export const useInsurancePolicies = listHook<InsurancePolicyRow>(
  "finance-insurance",
  "/finance/comply/insurance",
);

// ============================================================
// Finance — Plan / FP&A (Task #415, Wave 3)
// ============================================================
export type ReceiptSource = "open_ar" | "milestone" | "other";
export type DisbursementCategory =
  | "payroll" | "vendor" | "tax_vat" | "tax_ct" | "lease" | "debt_service" | "other";
export interface CashLineRow {
  id: string;
  direction: "in" | "out";
  weekIndex: number;
  weekStart: string;
  entityId: string;
  currency: string;
  amount: number;
  amountUsd: number;
  amountInPresentation: number;
  source?: ReceiptSource;
  category?: DisbursementCategory;
  counterparty?: string;
  vendor?: string;
  label: string;
  detail?: string;
  confidence: "high" | "medium" | "low";
  expectedDate: string;
  locked: boolean;
  override?: {
    lockedAmount?: number;
    lockedDate?: string;
    locked: boolean;
    note: string;
    byUserName: string;
    at: string;
  };
}
export interface CashWeekRow {
  weekIndex: number;
  weekStart: string;
  openingBalance: number;
  expectedIn: number;
  expectedOut: number;
  netMovement: number;
  closingBalance: number;
  inBySource: Record<ReceiptSource, number>;
  outByCategory: Record<DisbursementCategory, number>;
  belowMinCash: boolean;
  belowCovenant: boolean;
  lines: CashLineRow[];
}
export interface CashForecastResp {
  asOf: string;
  presentationCurrency: string;
  entityFilter: string | null;
  consolidated: boolean;
  openingBalance: number;
  minCashLine: number;
  covenantLine: number | null;
  weeks: CashWeekRow[];
  breaches: { weekIndex: number; kind: "min_cash" | "covenant"; gapAmount: number }[];
  topReceipts: CashLineRow[];
  topDisbursements: CashLineRow[];
  daysOfCash: number;
  totalIn: number;
  totalOut: number;
}
export function useCash13w(presentation: string, entity: string | null) {
  const q = useQuery<CashForecastResp>({
    queryKey: ["atelier-v5", "cash13w", presentation, entity ?? "consolidated"],
    queryFn: () => get<CashForecastResp>(
      `/finance/plan/cash-13w?currency=${presentation}${entity ? `&entity=${entity}` : ""}`,
    ),
    staleTime: 15_000,
  });
  return q;
}

export interface BacklogTotals {
  backlogUsd: number;
  weightedPipelineUsd: number;
  backlogPlusWeightedUsd: number;
  next2qPlanUsd: number;
  coverageRatio: number;
  backlogCoverageMonths: number;
}
export interface BacklogResp {
  asOf: string;
  presentationCurrency: string;
  entityFilter: string | null;
  totals: BacklogTotals;
  byEntity: { entityId: string; entityName: string; backlogUsd: number; weightedUsd: number }[];
  bySector: { sector: string; backlogUsd: number; weightedUsd: number }[];
  byPartner: { partner: string; backlogUsd: number; weightedUsd: number }[];
  byStage: { stage: string; weightedUsd: number; rawUsd: number; count: number }[];
  topDeals: { id: string; name: string; client: string; partner: string; stage: string; rawUsd: number; weightedUsd: number; expectedClose: string }[];
  contracts: { id: string; client: string; sector: string; partner: string; entityId: string; remainingUsd: number; endsOn: string; quartersOfRunway: number }[];
  revenuePlan: { quarterLabel: string; startsOn: string; endsOn: string; planUsd: number }[];
  targetCoverage: number;
}
export function useBacklogCoverage(presentation: string, entity: string | null) {
  const q = useQuery<BacklogResp>({
    queryKey: ["atelier-v5", "backlog", presentation, entity ?? "consolidated"],
    queryFn: () => get<BacklogResp>(
      `/finance/plan/backlog?currency=${presentation}${entity ? `&entity=${entity}` : ""}`,
    ),
    staleTime: 30_000,
  });
  return q;
}

export interface PlanEntityRow {
  id: string;
  shortName: string;
  baseCurrency: string;
  openingBalanceLocal: number;
  minCashPolicyLocal: number;
  covenantFloorLocal: number | null;
}
export function usePlanEntities(): PlanEntityRow[] {
  const q = useQuery<{ items: PlanEntityRow[] }>({
    queryKey: ["atelier-v5", "plan-entities"],
    queryFn: () => get<{ items: PlanEntityRow[] }>("/finance/plan/entities"),
    staleTime: 30_000,
  });
  return q.data?.items ?? [];
}

export interface CashAuditRow {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  payload: Record<string, unknown>;
}
export type RenewalKind = "subscription" | "framework" | "vendor" | "license";
export type RenewalStatus = "on_track" | "at_risk" | "in_negotiation" | "overdue";
export interface RenewalRow {
  id: string;
  kind: RenewalKind;
  counterparty: string;
  description: string;
  ownerName: string;
  ownerRole: string;
  entityId: string;
  currency: string;
  annualValueLocal: number;
  annualValueUsd: number;
  annualValuePresentation: number;
  renewsOn: string;
  noticePeriodDays: number;
  status: RenewalStatus;
  autoRenew: boolean;
  notes?: string;
  daysUntilRenewal: number;
  noticeWindowOpensInDays: number;
  inNoticeWindow: boolean;
  riskScore: number;
}
export interface RenewalsResp {
  asOf: string;
  presentationCurrency: string;
  entityFilter: string | null;
  totals: {
    countNext13w: number;
    valueNext13wPresentation: number;
    countNext26w: number;
    valueNext26wPresentation: number;
    atRiskCount: number;
    atRiskValuePresentation: number;
  };
  byKind: { kind: RenewalKind; count: number; valuePresentation: number }[];
  byOwner: { owner: string; count: number; valuePresentation: number }[];
  items: RenewalRow[];
}
export function useRenewals(presentation: string, entity: string | null) {
  return useQuery<RenewalsResp>({
    queryKey: ["atelier-v5", "renewals", presentation, entity ?? "consolidated"],
    queryFn: () => planGet<RenewalsResp>(
      `/finance/plan/renewals?currency=${presentation}${entity ? `&entity=${entity}` : ""}`,
    ),
    staleTime: 30_000,
  });
}

export interface ScenarioAssumptions {
  utilisationDelta: number;
  rateDelta: number;
  fxShock: number;
}
export interface ScenarioSnapshot {
  openingBalance: number;
  minCashLine: number;
  covenantLine: number | null;
  closingWeek12: number;
  minWeeklyClosing: number;
  minCashBreaches: number;
  covenantBreaches: number;
  totalIn: number;
  totalOut: number;
  coverageRatio: number;
  backlogPlusWeightedUsd: number;
  next2qPlanUsd: number;
}
export interface ScenarioResp {
  asOf: string;
  presentationCurrency: string;
  entityFilter: string | null;
  assumptions: ScenarioAssumptions;
  base: ScenarioSnapshot;
  scenario: ScenarioSnapshot;
  weeks: {
    weekIndex: number;
    weekStart: string;
    baseClosing: number;
    scenarioClosing: number;
    delta: number;
    scenarioBelowMinCash: boolean;
    scenarioBelowCovenant: boolean;
  }[];
  notes: string[];
}
export function useScenario(presentation: string, entity: string | null, a: ScenarioAssumptions) {
  return useQuery<ScenarioResp>({
    queryKey: ["atelier-v5", "scenarios", presentation, entity ?? "consolidated", a.utilisationDelta, a.rateDelta, a.fxShock],
    queryFn: () => planGet<ScenarioResp>(
      `/finance/plan/scenarios?currency=${presentation}${entity ? `&entity=${entity}` : ""}` +
      `&utilisationDelta=${a.utilisationDelta}&rateDelta=${a.rateDelta}&fxShock=${a.fxShock}`,
    ),
    staleTime: 5_000,
  });
}

export function useCash13wAudit() {
  const q = useQuery<{ items: CashAuditRow[] }>({
    queryKey: ["atelier-v5", "cash13w-audit"],
    queryFn: () => get<{ items: CashAuditRow[] }>("/finance/plan/cash-13w/audit"),
    staleTime: 5_000,
  });
  return q;
}

// Finance — FP&A driver-based plan (Task #420, Wave 8)
// ============================================================
export interface FpaScenario {
  id: string;
  label: string;
  utilisationDelta: number;
  rateDelta: number;
  fxDelta: number;
  attritionDelta: number;
  description: string;
}
export interface FpaMonthLine {
  monthIndex: number; iso: string; label: string; quarter: string;
  revenueUsd: number; directCostUsd: number; overheadUsd: number; ebitdaUsd: number;
  fteEquivalent: number; billableHours: number; utilisedHours: number;
}
export interface FpaEntityRollup {
  entityId: string; shortName: string; baseCurrency: string;
  totalRevenueUsd: number; totalDirectCostUsd: number; totalOverheadUsd: number;
  totalEbitdaUsd: number; ebitdaMarginPct: number; endingHeadcount: number;
}
export interface FpaRoleRollup {
  roleCode: string; roleLabel: string; totalHeadcountMonths: number;
  totalRevenueUsd: number; totalDirectCostUsd: number;
  contributionMarginUsd: number; contributionMarginPct: number;
}
export interface FpaCommittedScenarioInfo {
  scenarioId: string;
  scenarioLabel: string;
  periodLabel: string;
  note: string;
  byUserName: string;
  byRole: string;
  committedAt: string;
}
export interface FpaMonthActualLine {
  monthIndex: number; iso: string; label: string; quarter: string;
  isElapsed: boolean; isPartial: boolean; daysElapsed: number; daysInMonth: number;
  revenuePlanUsd: number; revenuePlanProratedUsd: number;
  revenueActualUsd: number | null; revenueVariancePct: number | null;
  ebitdaPlanUsd: number; ebitdaPlanProratedUsd: number;
  ebitdaActualUsd: number | null; ebitdaVariancePct: number | null;
}
export interface FpaYtdActual {
  throughIso: string; throughLabel: string; elapsedMonths: number;
  revenuePlanProrated: number; revenueActual: number; revenueVariancePct: number;
  ebitdaPlanProrated: number; ebitdaActual: number; ebitdaVariancePct: number;
}
export interface FpaBudgetResp {
  asOf: string; fyLabel: string;
  scenarioId: string; scenarioLabel: string;
  presentationCurrency: string; entityFilter: string | null;
  months: FpaMonthLine[];
  monthsActual: FpaMonthActualLine[];
  totals: { revenue: number; directCost: number; overhead: number; ebitda: number; ebitdaMarginPct: number; grossMarginPct: number };
  ytdActual: FpaYtdActual;
  byEntity: FpaEntityRollup[];
  byRole: FpaRoleRollup[];
  byQuarter: { quarter: string; revenue: number; ebitda: number }[];
  scenarios: FpaScenario[];
  driverNotes: string[];
  committedScenarioId: string | null;
  committedScenario: FpaCommittedScenarioInfo | null;
  isCommittedScenario: boolean;
}
export function useFpaBudget(scenario: string, presentation: string, entity: string | null) {
  return useQuery<FpaBudgetResp>({
    queryKey: ["atelier-v5", "fpa-budget", scenario, presentation, entity ?? "consolidated"],
    queryFn: () => planGet<FpaBudgetResp>(`/finance/plan/budget?scenario=${scenario}&currency=${presentation}${entity ? `&entity=${entity}` : ""}`),
    staleTime: 30_000,
  });
}

export interface FpaHeadcountChange { monthIndex: number; delta: number; reason: string }
export interface FpaHeadcountDetailRow {
  entityId: string; entityShortName: string; roleCode: string; roleLabel: string;
  startingHeadcount: number; endingHeadcount: number; netChange: number;
  byMonth: { monthIndex: number; iso: string; label: string; headcount: number }[];
  changes: FpaHeadcountChange[];
}
export interface FpaHeadcountResp {
  asOf: string; scenarioId: string; scenarioLabel: string; entityFilter: string | null;
  months: { index: number; iso: string; label: string; quarter: string }[];
  rows: FpaHeadcountDetailRow[];
  totals: { startingHeadcount: number; endingHeadcount: number; netHires: number; plannedHires: number; plannedExits: number };
  byEntity: { entityId: string; shortName: string; starting: number; ending: number; net: number }[];
  byRole: { roleCode: string; roleLabel: string; starting: number; ending: number; net: number }[];
  scenarios: FpaScenario[];
  asOfMonthLabel: string;
}
export function useFpaHeadcount(scenario: string, entity: string | null) {
  return useQuery<FpaHeadcountResp>({
    queryKey: ["atelier-v5", "fpa-headcount", scenario, entity ?? "consolidated"],
    queryFn: () => planGet<FpaHeadcountResp>(`/finance/plan/headcount?scenario=${scenario}${entity ? `&entity=${entity}` : ""}`),
    staleTime: 30_000,
  });
}

export interface FpaScenarioComparison {
  presentationCurrency: string; entityFilter: string | null; asOf: string;
  comparisons: {
    scenarioId: string; scenarioLabel: string; description: string;
    revenue: number; ebitda: number; ebitdaMarginPct: number; grossMarginPct: number;
    deltas: { revenuePct: number; ebitdaPct: number; ebitdaMarginPctPts: number };
    quarter: { quarter: string; revenue: number; ebitda: number }[];
  }[];
  committedScenarioId: string | null;
  committedScenario: FpaCommittedScenarioInfo | null;
  canCommit: boolean;
}

// Commit-a-scenario (Task #446): finance leadership marks one of the FP&A
// variants as the official forecast for the period. Read returns the most
// recent commit + audit trail; mutation triggers a refetch of scenarios,
// budget and firm-economics views so badges/banner update immediately.
export interface FpaCommitHistoryRow {
  id: string;
  kind: "commit" | "uncommit";
  scenarioId: string | null;
  scenarioLabel: string;
  periodLabel: string;
  note: string;
  byUserId: string;
  byUserName: string;
  byRole: string;
  committedAt: string;
  supersededByKind: "commit" | "uncommit" | null;
  supersededWithinDays: number | null;
  churn: boolean;
}
export interface FpaCommitResp {
  current: FpaCommittedScenarioInfo | null;
  history: FpaCommitHistoryRow[];
  canCommit: boolean;
  canUncommit: boolean;
  churnWindowDays: number;
}
export function useFpaCommittedScenario() {
  return useQuery<FpaCommitResp>({
    queryKey: ["atelier-v5", "fpa-scenario-commit"],
    queryFn: () => planGet<FpaCommitResp>("/finance/plan/scenarios/commit"),
    staleTime: 15_000,
  });
}
export function useCommitFpaScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { scenarioId: string; note?: string; periodLabel?: string }) =>
      postJson<{ ok: true; committed: FpaCommittedScenarioInfo }>(
        "/finance/plan/scenarios/commit",
        input,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["atelier-v5", "fpa-scenario-commit"] });
      qc.invalidateQueries({ queryKey: ["atelier-v5", "fpa-scenarios"] });
      qc.invalidateQueries({ queryKey: ["atelier-v5", "fpa-budget"] });
      qc.invalidateQueries({ queryKey: ["atelier-v5", "ledger-utilization-firm"] });
    },
  });
}
// Uncommit (Task #468) — clears the committed forecast. Persists an
// audit row so the variance / scenarios pages flag the unlock.
export function useUncommitFpaScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { note?: string; periodLabel?: string }) =>
      deleteJson<{
        ok: true; uncommitted: true; previousScenarioId: string | null;
        periodLabel: string; note: string; byUserName: string; byRole: string; committedAt: string;
      }>("/finance/plan/scenarios/commit", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["atelier-v5", "fpa-scenario-commit"] });
      qc.invalidateQueries({ queryKey: ["atelier-v5", "fpa-scenarios"] });
      qc.invalidateQueries({ queryKey: ["atelier-v5", "fpa-budget"] });
      qc.invalidateQueries({ queryKey: ["atelier-v5", "ledger-utilization-firm"] });
    },
  });
}
export function useFpaScenarios(presentation: string, entity: string | null) {
  return useQuery<FpaScenarioComparison>({
    queryKey: ["atelier-v5", "fpa-scenarios", presentation, entity ?? "consolidated"],
    queryFn: () => planGet<FpaScenarioComparison>(`/finance/plan/scenarios?currency=${presentation}${entity ? `&entity=${entity}` : ""}`),
    staleTime: 30_000,
  });
}

export interface FpaRenewalRow {
  id: string; client: string; kind: string; entityId: string; entityShortName: string;
  currency: string; arrLocal: number; arrUsd: number; expiresOn: string; daysUntil: number;
  ownerName: string; stage: string; riskBand: string; recommendation: string;
}
export interface FpaRenewalsResp {
  asOf: string; presentationCurrency: string; entityFilter: string | null;
  totalsArr: { totalUsd: number; atRiskUsd: number; lowRiskUsd: number; highRiskUsd: number };
  byMonth: { monthIso: string; label: string; arrUsd: number; count: number; highRiskUsd: number }[];
  byOwner: { owner: string; arrUsd: number; count: number }[];
  byStage: { stage: string; arrUsd: number; count: number }[];
  rows: FpaRenewalRow[];
}
export function useFpaRenewals(presentation: string, entity: string | null) {
  return useQuery<FpaRenewalsResp>({
    queryKey: ["atelier-v5", "fpa-renewals", presentation, entity ?? "consolidated"],
    queryFn: () => planGet<FpaRenewalsResp>(`/finance/plan/renewals?currency=${presentation}${entity ? `&entity=${entity}` : ""}`),
    staleTime: 30_000,
  });
}

export interface FpaBonusResp {
  asOf: string; scenarioId: string; scenarioLabel: string;
  presentationCurrency: string; entityFilter: string | null;
  marginGate: { firmGrossMarginPct: number; thresholdPct: number; gateMultiplier: number; passes: boolean };
  ytdProgressPct: number;
  totals: { bonusAccrual: number; commissionAccrual: number; combined: number; baseSalaryTotal: number };
  rows: {
    id: string; name: string; roleCode: string; roleLabel: string; entityId: string; entityShortName: string;
    baseSalary: number; bonusTargetPct: number; perfMultiplier: number; gateMultiplier: number;
    bonusAccrual: number; newArrClosed: number; commissionRate: number; commissionAccrual: number;
    combined: number;
  }[];
}
export function useFpaBonus(scenario: string, presentation: string, entity: string | null) {
  return useQuery<FpaBonusResp>({
    queryKey: ["atelier-v5", "fpa-bonus", scenario, presentation, entity ?? "consolidated"],
    queryFn: () => planGet<FpaBonusResp>(`/finance/plan/bonus?scenario=${scenario}&currency=${presentation}${entity ? `&entity=${entity}` : ""}`),
    staleTime: 30_000,
  });
}

// ============================================================
// Finance — Reports (three-statement, profitability, board pack) — Task #417
// ============================================================
export interface PnlLines {
  grossRevenue: number; intercoRevenue: number; netRevenue: number;
  directCost: number; intercoCost: number; grossProfit: number;
  payroll: number; opex: number; depreciation: number;
  ebitda: number; ebit: number; interestExpense: number;
  pretaxIncome: number; tax: number; netIncome: number;
}
export interface BsLines {
  cash: number; ar: number; intercoAr: number; wip: number;
  ppe: number; intangible: number; intercoLoanReceivable: number;
  totalAssets: number;
  ap: number; intercoAp: number; accruals: number; debt: number;
  intercoLoanPayable: number; totalLiabilities: number;
  shareCapital: number; retainedEarnings: number; fctr: number;
  totalEquity: number; totalLiabilitiesAndEquity: number;
}
export interface CfLines {
  netIncome: number; depreciation: number; workingCapitalChange: number;
  cashFromOps: number; capex: number; cashFromInvesting: number;
  debtRepayment: number; intercoFunding: number; cashFromFinancing: number;
  fxOnCash: number; netChangeInCash: number; openingCash: number; closingCash: number;
}
export interface VarianceCell {
  actual: number; budget: number; forecast: number; priorYear: number;
  vsBudget: number; vsForecast: number; vsPriorYear: number;
  vsBudgetPct: number; vsForecastPct: number; vsPriorYearPct: number;
}
export interface PnlVariance {
  netRevenue: VarianceCell; grossProfit: VarianceCell;
  ebitda: VarianceCell; ebit: VarianceCell; netIncome: VarianceCell;
}
export interface FinancePeriod { id: string; year: number; month: number; label: string; endsOn: string }
export interface ReportEliminations {
  intercoRevenueGbp: number; intercoCostGbp: number;
  intercoArGbp: number; intercoApGbp: number; intercoLoanGbp: number;
}
export interface PnlEntityRow {
  entityId: string; entityName: string; baseCurrency: string;
  actual: PnlLines; budget: PnlLines; forecast: PnlLines; priorYear: PnlLines;
  gbp: { actual: PnlLines; budget: PnlLines; forecast: PnlLines; priorYear: PnlLines };
}
export interface BsEntityRow {
  entityId: string; entityName: string; baseCurrency: string;
  local: BsLines; gbp: BsLines; display: BsLines;
}
export interface CfEntityRow {
  entityId: string; entityName: string; baseCurrency: string;
  display: CfLines; gbp: CfLines;
}
export interface PnlResp {
  period: string; scope: string; currency: string; entity: string | null;
  periodsCovered: string[];
  perEntity: PnlEntityRow[];
  consolidated: { actual: PnlLines; budget: PnlLines; forecast: PnlLines; priorYear: PnlLines } | null;
  eliminations: ReportEliminations | null;
  variance: PnlVariance | null; commentary: string[];
}
export interface BsResp {
  period: string; currency: string; entity: string | null;
  perEntity: BsEntityRow[]; consolidated: BsLines | null; eliminations: ReportEliminations | null;
}
export interface CfResp {
  period: string; scope: string; currency: string; entity: string | null;
  perEntity: CfEntityRow[]; consolidated: CfLines | null;
}
export interface CubeRow {
  engagementId: string; engagementName: string;
  client: string; partner: string; sector: string;
  engagementType: "fixed_fee" | "tm" | "subscription" | "managed_service";
  entityId: string;
  revenueGbp: number; directCostGbp: number; grossMarginGbp: number; grossMarginPct: number;
}
export interface CubeRollupRow {
  dim: string; revenueGbp: number; directCostGbp: number; grossMarginGbp: number; grossMarginPct: number; engagementCount: number;
}
export interface CubeResp {
  period: string; scope: string; periodsCovered: string[];
  rows: CubeRow[];
  byClient: CubeRollupRow[]; byPartner: CubeRollupRow[];
  bySector: CubeRollupRow[]; byEngagementType: CubeRollupRow[];
}
export interface BoardPackSection {
  id: string; title: string;
  commentary?: string[]; risks?: string[];
  consolidated?: PnlLines | BsLines | CfLines | { actual: PnlLines; budget: PnlLines; forecast: PnlLines; priorYear: PnlLines };
  variance?: PnlVariance; eliminations?: ReportEliminations;
  topRevenue?: CubeRow[]; bottomMargin?: CubeRow[];
}
export interface BoardPackResp {
  period: string; periodLabel: string; presentationCurrency: string;
  sections: BoardPackSection[];
}
export interface BoardPackSchedule {
  id: string; name: string; cron: string; nextRunOn: string;
  recipients: string[]; enabled: boolean; createdBy: string; createdAt: string;
}

export function useFinanceReportsPeriods() {
  return useQuery<{ periods: FinancePeriod[]; current: FinancePeriod }>({
    queryKey: ["atelier-v5", "finance-reports-periods"],
    queryFn: () => get("/finance/reports/periods"),
    staleTime: 60_000,
  });
}
export function useFinanceReportsPnl(period: string | null, scope: string, entity: string | null, currency: string) {
  return useQuery<PnlResp>({
    queryKey: ["atelier-v5", "finance-reports-pnl", period, scope, entity ?? "consolidated", currency],
    queryFn: () => get<PnlResp>(`/finance/reports/pnl?period=${period ?? ""}&scope=${scope}&currency=${currency}${entity ? `&entity=${entity}` : ""}`),
    staleTime: 30_000,
    enabled: !!period,
  });
}
export function useFinanceReportsBs(period: string | null, entity: string | null, currency: string) {
  return useQuery<BsResp>({
    queryKey: ["atelier-v5", "finance-reports-bs", period, entity ?? "consolidated", currency],
    queryFn: () => get<BsResp>(`/finance/reports/bs?period=${period ?? ""}&currency=${currency}${entity ? `&entity=${entity}` : ""}`),
    staleTime: 30_000,
    enabled: !!period,
  });
}
export function useFinanceReportsCf(period: string | null, scope: string, entity: string | null, currency: string) {
  return useQuery<CfResp>({
    queryKey: ["atelier-v5", "finance-reports-cf", period, scope, entity ?? "consolidated", currency],
    queryFn: () => get<CfResp>(`/finance/reports/cf?period=${period ?? ""}&scope=${scope}&currency=${currency}${entity ? `&entity=${entity}` : ""}`),
    staleTime: 30_000,
    enabled: !!period,
  });
}
export function useFinanceReportsProfitability(period: string | null, scope: string) {
  return useQuery<CubeResp>({
    queryKey: ["atelier-v5", "finance-reports-cube", period, scope],
    queryFn: () => get<CubeResp>(`/finance/reports/profitability?period=${period ?? ""}&scope=${scope}`),
    staleTime: 30_000,
    enabled: !!period,
  });
}
export function useFinanceReportsBoardPack(period: string | null) {
  return useQuery<BoardPackResp>({
    queryKey: ["atelier-v5", "finance-reports-board-pack", period],
    queryFn: () => get<BoardPackResp>(`/finance/reports/board-pack?period=${period ?? ""}`),
    staleTime: 30_000,
    enabled: !!period,
  });
}
export function useFinanceReportsSchedules() {
  return useQuery<{ items: BoardPackSchedule[] }>({
    queryKey: ["atelier-v5", "finance-reports-schedules"],
    queryFn: () => get<{ items: BoardPackSchedule[] }>("/finance/reports/schedules"),
    staleTime: 30_000,
  });
}

// ============================================================
// Press
// ============================================================
export interface EditorialCalendarRow {
  id: string;
  workingTitle: string;
  publication: string;
  byline: string;
  publishOn: string;
  status: string;
  thesis: string;
  themeId: string | null;
}
export const useEditorialCalendar = listHook<EditorialCalendarRow>(
  "press-editorial",
  "/press/editorial-calendar",
);

export interface InFlightRow {
  id: string;
  title: string;
  kind: string;
  byline: string;
  wordCount: number;
  sourceArtifact: string;
  phase: string;
  citationCoverage: number;
}
export const useInFlightContent = listHook<InFlightRow>(
  "press-inflight",
  "/press/in-flight",
);

export interface PartnerCadenceRow {
  id: string;
  partnerId: string;
  partnerName: string;
  voiceProfile: string;
  targetPer90d: number;
  postsThis90d: number;
  cadenceMet: boolean;
  queue: Array<{
    id: string;
    status: string;
    voiceMatchScore: number;
    draftBody: string;
  }>;
}
export const usePartnerCadence = listHook<PartnerCadenceRow>(
  "press-partner-cadence",
  "/press/partner-cadence",
);

export interface NewsletterRow {
  id: string;
  totalSubscribers: number;
  netGrowthLast90d: number;
  avgOpenRate: number;
  avgClickRate: number;
  currentIssue: {
    id: string;
    subjectLine: string;
    status: string;
    scheduledSendAt: string;
    sections: Array<{ id: string; label: string; summary: string }>;
  } | null;
}
export function useNewsletter(): NewsletterRow | null {
  const q = useQuery<{ newsletter: NewsletterRow | null }>({
    queryKey: ["atelier-v5", "press-newsletter"],
    queryFn: () => get<{ newsletter: NewsletterRow | null }>("/press/newsletter"),
    staleTime: 30_000,
  });
  return q.data?.newsletter ?? null;
}

export interface SpeakingOpportunityRow {
  id: string;
  event: string;
  kind: string;
  location: string;
  date: string;
  audience: string;
  ask: string;
  decision: string;
  owner: string;
}
export const useSpeakingOpportunities = listHook<SpeakingOpportunityRow>(
  "press-speaking",
  "/press/speaking-opportunities",
);

export interface PressMentionRow {
  id: string;
  headline: string;
  publication: string;
  date: string;
  about: string;
  summary: string;
  sentiment: string;
}
export const usePressMentions = listHook<PressMentionRow>(
  "press-mentions",
  "/press/mentions",
);

// ============================================================
// Alliances
// ============================================================
export interface AlliancePartnerFirmRow {
  id: string;
  name: string;
  kind: string;
  country: string;
  speciality: string;
  relationshipStrength: number;
  anchorCognirise: string;
  anchorPartner: string;
  lastTouchAt: string | null;
  openJointOpps: number;
  lifetimeJointRevenueMm: number;
  recentMoves: string[];
}
export const useAlliancePartnerFirms = listHook<AlliancePartnerFirmRow>(
  "alliance-firms",
  "/alliances/partner-firms",
);

export interface JointPipelineRow {
  id: string;
  opportunityName: string;
  client: string;
  partnerFirm: string;
  leadParty: string;
  stage: string;
  acvUsdK: number;
  cognirisePct: number;
  partnerPct: number;
  splitRationale: string;
  allianceLetterStatus: string;
}
export const useJointPipeline = listHook<JointPipelineRow>(
  "alliance-pipeline",
  "/alliances/joint-pipeline",
);

export interface CertificationRow {
  id: string;
  credential: string;
  platform: string;
  holder: string;
  status: string;
  expiresAt: string;
}
export const useCertifications = listHook<CertificationRow>(
  "alliance-certs",
  "/alliances/certifications",
);

export interface AllianceConflictRow {
  id: string;
  headline: string;
  partnerFirm: string;
  detectedAt: string;
  severity: string;
  detail: string;
  recommendation: string;
}
export const useAllianceConflicts = listHook<AllianceConflictRow>(
  "alliance-conflicts",
  "/alliances/conflicts",
);

// ============================================================
// Partners lens — lifecycle scaffolds (Task #371)
// ============================================================
export interface PartnerTargetRow {
  id: string;
  name: string;
  ecosystem: string;
  country: string;
  rationale: string;
  priority: string;
  stage: string;
  lastContact: string | null;
}
export const usePartnerTargets = listHook<PartnerTargetRow>(
  "partners-targets",
  "/partners/target-partners",
);

export interface PartnerCapabilityRow {
  id: string;
  partnerFirm: string;
  capabilities: Record<string, number>;
  ndaStatus: string;
  mutualEvalStatus: string;
  lastReviewed: string;
}
export const usePartnerCapabilities = listHook<PartnerCapabilityRow>(
  "partners-capabilities",
  "/partners/capability-matrix",
);

export interface PartnerMdfRow {
  id: string;
  partnerFirm: string;
  program: string;
  periodEnds: string;
  allocatedUsdK: number;
  spentUsdK: number;
  status: string;
  focus: string;
}
export const usePartnerMdf = listHook<PartnerMdfRow>(
  "partners-mdf",
  "/partners/mdf",
);

export interface PartnerJointMarketingRow {
  id: string;
  title: string;
  kind: string;
  partnerFirm: string;
  date: string;
  status: string;
  expectedAttendees: number;
  leadOwner: string;
}
export const usePartnerJointMarketing = listHook<PartnerJointMarketingRow>(
  "partners-joint-marketing",
  "/partners/joint-marketing",
);

export interface PartnerSubcontractRow {
  id: string;
  engagement: string;
  partnerFirm: string;
  scope: string;
  sowStatus: string;
  rateCardLockedAt: string | null;
  monthlyBurnUsdK: number;
  acceptanceGate: string;
}
export const usePartnerSubcontracts = listHook<PartnerSubcontractRow>(
  "partners-subcontracts",
  "/partners/sub-contracts",
);

export interface PartnerFrameworkRow {
  id: string;
  partnerFirm: string;
  agreementKind: string;
  effectiveFrom: string;
  effectiveTo: string;
  governingLaw: string;
  exclusivities: string[];
  status: string;
}
export const usePartnerFrameworks = listHook<PartnerFrameworkRow>(
  "partners-frameworks",
  "/partners/framework-agreements",
);

export interface PartnerQbrRow {
  id: string;
  partnerFirm: string;
  periodLabel: string;
  scheduledFor: string;
  status: string;
  attendees: string[];
  decisions: string[];
  artefactsUrl: string | null;
}
export const usePartnerQbrs = listHook<PartnerQbrRow>(
  "partners-qbrs",
  "/partners/qbrs",
);

export interface PartnerScorecardRow {
  id: string;
  partnerFirm: string;
  periodLabel: string;
  revenueUsdK: number;
  satisfaction: number;
  complianceFlags: number;
  jointWinRate: number;
  deliveryQuality: number;
  trend: string;
}
export const usePartnerScorecards = listHook<PartnerScorecardRow>(
  "partners-scorecards",
  "/partners/scorecards",
);

export interface PartnerRenewalRow {
  id: string;
  partnerFirm: string;
  agreementKind: string;
  expiresAt: string;
  daysUntil: number;
  stage: string;
  owner: string;
  recommendation: string;
  risk: string;
}
export const usePartnerRenewals = listHook<PartnerRenewalRow>(
  "partners-renewals",
  "/partners/renewals",
);

export interface PartnerTierChangeRow {
  id: string;
  partnerFirm: string;
  platform: string;
  fromTier: string;
  toTier: string;
  effectiveAt: string;
  driver: string;
  action: string;
}
export const usePartnerTierChanges = listHook<PartnerTierChangeRow>(
  "partners-tier-changes",
  "/partners/tier-changes",
);

export interface PartnerOffboardingRow {
  id: string;
  partnerFirm: string;
  reason: string;
  initiatedAt: string;
  phase: string;
  openObligationsUsdK: number;
  dataReturnDue: string;
}
export const usePartnerOffboardings = listHook<PartnerOffboardingRow>(
  "partners-offboardings",
  "/partners/offboardings",
);

// ============================================================
// Studio
// ============================================================
export interface OpenRoleRow {
  id: string;
  title: string;
  level: string;
  location: string;
  targetStart: string;
  urgency: string;
  summary: string;
  activeCandidates: number;
  panelTemplate: string;
  scorecardId: string;
  takeHomeId: string | null;
}
export const useOpenRoles = listHook<OpenRoleRow>("studio-roles", "/studio/open-roles");

export interface CandidateRow {
  id: string;
  name: string;
  currentRole: string;
  currentEmployer: string;
  source: string;
  roleTitle: string;
  stage: string;
  activeOrPassive: string;
  roleMatchScore: number;
  outreachHook: string;
}
export const useCandidates = listHook<CandidateRow>(
  "studio-candidates",
  "/studio/candidates",
);

export interface InterviewPanelRow {
  id: string;
  candidateName: string;
  roleTitle: string;
  scheduledFor: string;
  status: string;
  stages: Array<{
    stage: string;
    interviewer: string;
    durationMin: number;
    focus: string;
    score: number | null;
  }>;
}
export const useInterviewPanels = listHook<InterviewPanelRow>(
  "studio-panels",
  "/studio/interview-panels",
);

export interface ReferenceCheckRow {
  id: string;
  candidateName: string;
  refererName: string;
  relationship: string;
  callMode: string;
  scheduledFor: string;
  completedAt: string | null;
  wouldRehire: string | null;
  fitForLevel: string | null;
  headlineQuote: string;
  inconsistencies: Array<{ claim: string; evidence: string }>;
}
export const useReferenceChecks = listHook<ReferenceCheckRow>(
  "studio-refs",
  "/studio/reference-checks",
);

export interface OfferRow {
  id: string;
  candidateName: string;
  roleTitle: string;
  jurisdiction: string;
  startDate: string;
  totalAtTargetUsdK: number;
  marketP25: number;
  marketP75: number;
  status: string;
  bandFlag: string | null;
}
export const useOffers = listHook<OfferRow>("studio-offers", "/studio/offers");

export interface ReferralRow {
  id: string;
  referrer: string;
  candidate: string;
  via: string;
  roleTitle: string;
  status: string;
}
export const useReferrals = listHook<ReferralRow>(
  "studio-referrals",
  "/studio/referrals",
);

// ============================================================
// Guardhouse
// ============================================================
export interface ControlRow {
  id: string;
  title: string;
  framework: string;
  owner: string;
  status: string;
  lastCollectedAt: string;
  remediation: string | null;
}
export const useGuardhouseControls = listHook<ControlRow>(
  "gh-controls",
  "/guardhouse/controls",
);

export interface EvidenceRow {
  id: string;
  title: string;
  kind: string;
  controlIds: string[];
  collectedAt: string;
  freshness: string;
}
export const useGuardhouseEvidence = listHook<EvidenceRow>(
  "gh-evidence",
  "/guardhouse/evidence",
);

export interface PentestRow {
  id: string;
  engagement: string;
  vendor: string;
  windowStart: string;
  windowEnd: string;
  findingsHigh: number;
  findingsMed: number;
  findingsLow: number;
  remediated: number;
  status: string;
}
export const useGuardhousePentests = listHook<PentestRow>(
  "gh-pentests",
  "/guardhouse/pentests",
);

export interface VendorRow {
  id: string;
  vendor: string;
  direction: string;
  dataClass: string;
  owner: string;
  risk: string;
  renewsAt: string;
}
export const useGuardhouseVendors = listHook<VendorRow>(
  "gh-vendors",
  "/guardhouse/vendors",
);

export interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  detectedAt: string;
  phase: string;
  summary: string;
  postmortemUrl: string | null;
}
export const useGuardhouseIncidents = listHook<IncidentRow>(
  "gh-incidents",
  "/guardhouse/incidents",
);

export interface DsarRow {
  id: string;
  subjectMasked: string;
  jurisdiction: string;
  requestKind: string;
  intakeAt: string;
  statutoryDueAt: string;
  daysToDeadline: number;
  phase: string;
  discoveredArtifacts: number;
}
export const useGuardhouseDsars = listHook<DsarRow>(
  "gh-dsars",
  "/guardhouse/dsars",
);

export interface BackupRow {
  id: string;
  store: string;
  kind: string;
  lastSuccessAt: string;
  status: string;
  rtoMinutes: number;
  rpoMinutes: number;
}
export const useGuardhouseBackups = listHook<BackupRow>(
  "gh-backups",
  "/guardhouse/backups",
);

// ============================================================
// IP catalog
// ============================================================
export interface CodeAssetRow {
  id: string;
  name: string;
  repoUrl: string;
  owner: string;
  license: string;
  summary: string;
  usedInEngagements: string[];
  freshness: string;
}
export const useCodeAssets = listHook<CodeAssetRow>("ip-code", "/ip/code-assets");

export interface OssDependencyRow {
  id: string;
  name: string;
  version: string;
  ecosystem: string;
  license: string;
  compatibility: string;
  repos: string[];
  rationale: string | null;
  exceptionUntil: string | null;
}
export const useOssDependencies = listHook<OssDependencyRow>(
  "ip-oss",
  "/ip/oss-dependencies",
);

export interface DemoEnvironmentRow {
  id: string;
  name: string;
  url: string;
  owner: string;
  lastDeployAt: string;
  shows: string;
  uptime30d: number;
  scriptDrift: number;
  freshness: string;
}
export const useDemoEnvironments = listHook<DemoEnvironmentRow>(
  "ip-demos",
  "/ip/demo-environments",
);

export interface IpLicenseGrantRow {
  id: string;
  assetName: string;
  grantee: string;
  engagementId: string;
  grantedAt: string;
  expiresAt: string;
  scope: string;
  approvedBy: string;
  status: string;
}
export const useIpLicenseGrants = listHook<IpLicenseGrantRow>(
  "ip-grants",
  "/ip/license-grants",
);

// ============================================================
// Finance — Payables (Task #418, P2P hardening)
// ============================================================
export interface BankChangeRequestWire {
  id: string;
  fieldChanged: "iban" | "swift" | "bank" | "accountHolder";
  oldValue: string;
  newValue: string;
  requestedBy: string;
  requestedAt: string;
  reason: string;
  oobConfirmation: {
    method: "phone_callback" | "in_person" | "verified_email";
    contactName: string;
    contactNumber: string | null;
    confirmedAt: string | null;
    confirmedBy: string | null;
  };
  status: "pending_oob" | "pending_checker" | "approved" | "rejected";
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
}
export interface VendorRow2 {
  id: string;
  legalName: string;
  shortName: string;
  category: string;
  isSubcontractor: boolean;
  jurisdiction: string;
  country: string;
  registeredEntityId: string;
  taxIds: { vat: string | null; corporate: string | null; whtRegistered: boolean };
  defaultWhtPct: number;
  paymentTermsDays: number;
  beneficialOwners: Array<{ id: string; name: string; pctOwnership: number; nationality: string; isPep: boolean }>;
  sanctions: { lastCheckedAt: string; result: "clear" | "match_review" | "blocked"; list: string; notes: string | null };
  bankAccounts: Array<{
    id: string;
    bank: string;
    iban: string;
    swift: string;
    currency: string;
    accountHolder: string;
    primary: boolean;
    pendingChange?: BankChangeRequestWire | null;
  }>;
  primaryContact: { name: string; email: string; phone: string };
  payAgainstEntityIds: string[];
  status: "active" | "on_hold" | "blocked";
  onboardedAt: string;
  notes: string;
}
export const usePayablesVendors = listHook<VendorRow2>("pay-vendors", "/finance/payables/vendors");

export interface PoRow {
  id: string;
  number: string;
  vendorId: string;
  buyerEntityId: string;
  currency: string;
  totalUsd: number;
  status: "draft" | "approved" | "open" | "partially_received" | "received" | "closed" | "cancelled";
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  engagementId: string | null;
  engagementName: string | null;
  description: string;
  lines: Array<{ id: string; description: string; quantity: number; uom: string; unitPriceUsd: number; receivedQuantity: number; invoicedQuantity: number }>;
  goodsReceipts: Array<{ id: string; receivedAt: string; receivedBy: string; lines: Array<{ poLineId: string; quantity: number }>; notes: string | null }>;
  invoiceIds: string[];
  expectedReceiptDate: string;
}
export const usePayablesPos = listHook<PoRow>("pay-pos", "/finance/payables/po");

export interface VendorInvoiceRow {
  id: string;
  number: string;
  vendorId: string;
  buyerEntityId: string;
  poId: string | null;
  currency: string;
  amount: number;
  amountUsd: number;
  whtPct: number;
  whtAmountUsd: number;
  netPayableUsd: number;
  invoiceDate: string;
  dueDate: string;
  receivedAt: string;
  status: "received" | "matched" | "exception" | "approved_for_payment" | "scheduled" | "paid" | "rejected" | "on_hold_pwp";
  match: {
    outcome: "match" | "qty_mismatch" | "price_mismatch" | "no_grn" | "no_po" | "tolerance_override";
    poDeltaPct: number;
    grnDeltaPct: number;
    notes: string | null;
    overrideBy: string | null;
    overrideReason: string | null;
  };
  approvalAgeDays: number;
  subcontractorLinkId: string | null;
  description: string;
}
export const usePayablesInvoices = listHook<VendorInvoiceRow>("pay-invoices", "/finance/payables/invoices");

export interface PaymentRunRow {
  id: string;
  number: string;
  scheduledFor: string;
  status: "draft" | "pending_checker" | "pending_signatories" | "approved" | "exported" | "paid" | "rejected";
  createdBy: string;
  createdAt: string;
  makerName: string;
  checkerName: string | null;
  checkedAt: string | null;
  requiredSignatures: Array<{ signatoryId: string; signatoryName: string; authorityLevel: "A" | "B" | "C"; signedAt: string | null }>;
  batches: Array<{ id: string; entityId: string; bankAccountId: string; currency: string; invoiceIds: string[]; totalUsd: number; count: number }>;
  totalUsd: number;
  invoiceCount: number;
  bankFile: { filename: string; format: string; lines: number; previewBytes: string } | null;
  notes: string;
}
export const usePayablesRuns = listHook<PaymentRunRow>("pay-runs", "/finance/payables/payment-runs");

export interface WhtCertRow {
  id: string;
  jurisdiction: "SA" | "AE" | "GB" | "IN";
  vendorId: string;
  vendorName: string;
  invoiceId: string;
  invoiceNumber: string;
  paymentRunId: string | null;
  paidAt: string | null;
  grossUsd: number;
  whtPct: number;
  whtUsd: number;
  certificateNumber: string | null;
  status: "pending" | "issued" | "sent_to_vendor" | "acknowledged";
  issuedAt: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  remittancePeriod: string;
  remittanceDueAt: string;
}
export interface WhtRemittanceRow {
  jurisdiction: string;
  period: string;
  dueAt: string;
  whtUsd: number;
  certCount: number;
}
export function useWhtRegister(): { items: WhtCertRow[]; remittance: WhtRemittanceRow[] } {
  const q = useQuery<{ items: WhtCertRow[]; remittance: WhtRemittanceRow[] }>({
    queryKey: ["atelier-v5", "pay-wht"],
    queryFn: () => get<{ items: WhtCertRow[]; remittance: WhtRemittanceRow[] }>("/finance/payables/wht"),
    staleTime: 30_000,
  });
  return q.data ?? { items: [], remittance: [] };
}

export interface SubcontractorLinkRow {
  id: string;
  vendorId: string;
  engagementId: string;
  engagementName: string;
  milestoneId: string;
  milestoneLabel: string;
  scope: string;
  ratePerDayUsd: number;
  payWhenPaidArInvoiceId: string;
  arReceiptStatus: "open" | "received" | "partial";
  arReceivedAt: string | null;
}
export function useSubcontractors(): { vendors: VendorRow2[]; links: SubcontractorLinkRow[] } {
  const q = useQuery<{ vendors: VendorRow2[]; links: SubcontractorLinkRow[] }>({
    queryKey: ["atelier-v5", "pay-subs"],
    queryFn: () => get<{ vendors: VendorRow2[]; links: SubcontractorLinkRow[] }>("/finance/payables/subcontractors"),
    staleTime: 30_000,
  });
  return q.data ?? { vendors: [], links: [] };
}

export interface ExpectedDisbursementRow {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amountUsd: number;
  dueDate: string;
  status: VendorInvoiceRow["status"];
  paymentRunNumber: string | null;
}
export const useExpectedDisbursements = listHook<ExpectedDisbursementRow>(
  "pay-disb",
  "/finance/payables/dashboard/expected-disbursements?n=5",
);

export interface StalledApprovalRow {
  id: string;
  kind: "vendor_invoice_stalled" | "po_mismatch";
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  amountUsd: number;
  ageDays: number;
  detail: string;
}
export const useStalledApprovals = listHook<StalledApprovalRow>(
  "pay-stalled",
  "/finance/payables/dashboard/stalled-approvals?days=5",
);

export interface AuditEntryRow {
  id: string;
  at: string;
  actor: string;
  kind: string;
  subjectKind: string;
  subjectId: string;
  detail: string;
}
export const usePayablesAudit = listHook<AuditEntryRow>("pay-audit", "/finance/payables/audit?limit=50");

export async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const msg = (parsed as { error?: string; detail?: string } | null)?.detail ?? (parsed as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return parsed as T;
}

export async function deleteJson<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok) {
    const msg = (parsed as { error?: string; detail?: string } | null)?.detail ?? (parsed as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return parsed as T;
}
