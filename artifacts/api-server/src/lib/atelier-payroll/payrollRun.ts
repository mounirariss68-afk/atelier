/**
 * Task #655 — Payroll run engine + EOSB liability/settlement + statutory
 * filing-calendar materialization.
 *
 * The run is per (legal entity, YYYY-MM): compute → draft rows (freely
 * recomputable) → post one balanced journal idempotently via the GL's
 * (orgId, sourceKind, sourceRef) unique key, respecting period-close
 * locks. EOSB accrues on a cumulative-target model: each month posts the
 * delta between the person's full entitlement at month end and what prior
 * posted runs already accrued — band crossovers and wage changes true-up
 * automatically and re-posting is a no-op.
 *
 * Missing person data (compensation, currency, hire date, entity link)
 * fails loudly as run validation errors that block posting — nobody is
 * silently skipped.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierEmployees,
  atelierLegalEntities,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierPayrollRuns,
  atelierPayrollLines,
  atelierEosbSettlements,
  atelierFinanceComplianceEntries,
  type EntityStatutory,
  type PayrollRunTotals,
  type PayrollContributionDetail,
} from "@workspace/db";
import { seedChartForEntity, isGlPeriodLocked } from "../atelier-agents/bookkeeper.js";
import {
  resolveRules,
  computeContributions,
  computeEosbEntitlement,
  computeEosbSettlement,
  eosbApplies,
  serviceYearsBetween,
  filingInstancesFor,
  type ResolvedCountryRules,
  type SeparationReason,
} from "./statutoryRules.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function monthEnd(periodLabel: string): string {
  const y = Number(periodLabel.slice(0, 4));
  const m = Number(periodLabel.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${periodLabel}-${String(last).padStart(2, "0")}`;
}
function monthStart(periodLabel: string): string {
  return `${periodLabel}-01`;
}

type EntityRow = typeof atelierLegalEntities.$inferSelect;
type EmployeeRow = typeof atelierEmployees.$inferSelect;

export class PayrollError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function loadEntity(orgId: string, entityId: string): Promise<EntityRow> {
  const [e] = await db
    .select()
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, orgId), eq(atelierLegalEntities.id, entityId)));
  if (!e || e.status === "archived") throw new PayrollError(404, "legal entity not found");
  return e;
}

/**
 * Employees attributable to an entity for a period: linked via
 * legalEntityId, or unlinked when the org has exactly one active entity
 * (same defaulting rule as the Bookkeeper). Employment overlaps the period.
 */
async function loadEntityEmployees(
  orgId: string,
  entity: EntityRow,
  periodLabel: string,
): Promise<{ employees: EmployeeRow[]; unattributed: EmployeeRow[] }> {
  const activeEntities = await db
    .select({ id: atelierLegalEntities.id })
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, orgId), eq(atelierLegalEntities.status, "active")));
  const isOnlyEntity = activeEntities.length === 1 && activeEntities[0].id === entity.id;
  const rows = await db
    .select()
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.orgId, orgId), isNull(atelierEmployees.deletedAt)));
  const from = monthStart(periodLabel);
  const to = monthEnd(periodLabel);
  const inPeriod = rows.filter((e) => {
    if (e.employmentStatus === "terminated" || e.status === "offboarded") {
      // Still payable in the month they leave.
      if (!e.endDate || e.endDate < from) return false;
    }
    if (e.startDate && e.startDate > to) return false;
    if (e.endDate && e.endDate < from) return false;
    return true;
  });
  const employees = inPeriod.filter(
    (e) => e.legalEntityId === entity.id || (!e.legalEntityId && isOnlyEntity),
  );
  const unattributed = inPeriod.filter((e) => !e.legalEntityId && !isOnlyEntity);
  return { employees, unattributed };
}

/** Sum of EOSB accruals already posted for an employee, net of releases. */
async function eosbAccruedToDate(
  orgId: string,
  entityId: string,
  employeeIds: string[],
  excludeRunId?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (employeeIds.length === 0) return out;
  const postedRuns = await db
    .select({ id: atelierPayrollRuns.id })
    .from(atelierPayrollRuns)
    .where(and(
      eq(atelierPayrollRuns.orgId, orgId),
      eq(atelierPayrollRuns.legalEntityId, entityId),
      eq(atelierPayrollRuns.status, "posted"),
      isNull(atelierPayrollRuns.deletedAt),
    ));
  const runIds = postedRuns.map((r) => r.id).filter((id) => id !== excludeRunId);
  if (runIds.length > 0) {
    const lines = await db
      .select()
      .from(atelierPayrollLines)
      .where(and(
        eq(atelierPayrollLines.orgId, orgId),
        inArray(atelierPayrollLines.runId, runIds),
        inArray(atelierPayrollLines.employeeId, employeeIds),
      ));
    for (const l of lines) out.set(l.employeeId, round2((out.get(l.employeeId) ?? 0) + l.eosbAccrual));
  }
  const settlements = await db
    .select()
    .from(atelierEosbSettlements)
    .where(and(
      eq(atelierEosbSettlements.orgId, orgId),
      eq(atelierEosbSettlements.legalEntityId, entityId),
      eq(atelierEosbSettlements.status, "settled"),
      inArray(atelierEosbSettlements.employeeId, employeeIds),
    ));
  for (const s of settlements) {
    out.set(s.employeeId, round2((out.get(s.employeeId) ?? 0) - s.provisionAccrued));
  }
  return out;
}

async function settledEmployeeIds(orgId: string, entityId: string): Promise<Set<string>> {
  const rows = await db
    .select({ employeeId: atelierEosbSettlements.employeeId })
    .from(atelierEosbSettlements)
    .where(and(
      eq(atelierEosbSettlements.orgId, orgId),
      eq(atelierEosbSettlements.legalEntityId, entityId),
      eq(atelierEosbSettlements.status, "settled"),
    ));
  return new Set(rows.map((r) => r.employeeId));
}

// ──────────────────────────────────────────────────────────────
// Compute (upsert draft run + lines)
// ──────────────────────────────────────────────────────────────

export interface ComputedRun {
  run: typeof atelierPayrollRuns.$inferSelect;
  lines: Array<typeof atelierPayrollLines.$inferSelect>;
  rules: ResolvedCountryRules | null;
}

export async function computePayrollRun(args: {
  orgId: string;
  entityId: string;
  periodLabel: string; // YYYY-MM
  createdByUserId: string | null;
}): Promise<ComputedRun> {
  const { orgId, entityId, periodLabel } = args;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodLabel)) {
    throw new PayrollError(400, "periodLabel must be YYYY-MM");
  }
  const entity = await loadEntity(orgId, entityId);
  const asOf = monthEnd(periodLabel);
  const rules = resolveRules(entity.country, asOf);
  const overrides: EntityStatutory | null = entity.statutory ?? null;
  const currency = entity.baseCurrency || rules?.currency || "USD";

  const [existing] = await db
    .select()
    .from(atelierPayrollRuns)
    .where(and(
      eq(atelierPayrollRuns.orgId, orgId),
      eq(atelierPayrollRuns.legalEntityId, entityId),
      eq(atelierPayrollRuns.periodLabel, periodLabel),
      isNull(atelierPayrollRuns.deletedAt),
    ));
  if (existing?.status === "posted") {
    const lines = await db.select().from(atelierPayrollLines)
      .where(and(eq(atelierPayrollLines.orgId, orgId), eq(atelierPayrollLines.runId, existing.id)));
    return { run: existing, lines, rules };
  }

  const { employees, unattributed } = await loadEntityEmployees(orgId, entity, periodLabel);
  const validationErrors: Array<{ employeeId: string; name: string; message: string }> = [];
  for (const u of unattributed) {
    validationErrors.push({
      employeeId: u.id,
      name: u.fullName,
      message: "Not linked to a legal entity and the org has multiple active entities — set the person's employing legal entity.",
    });
  }
  const settled = await settledEmployeeIds(orgId, entityId);
  const accrued = await eosbAccruedToDate(orgId, entityId, employees.map((e) => e.id), existing?.id);

  interface LineDraft {
    employee: EmployeeRow;
    monthlyGross: number;
    monthlyBasic: number;
    housing: number;
    serviceYears: number;
    contributions: PayrollContributionDetail[];
    employerTotal: number;
    employeeTotal: number;
    eosbTarget: number;
    eosbOpening: number;
    eosbAccrual: number;
    detail: Record<string, unknown>;
  }
  const drafts: LineDraft[] = [];

  for (const emp of employees) {
    const problems: string[] = [];
    if (!emp.baseCompensation || emp.baseCompensation <= 0) problems.push("missing annual base compensation");
    if (!emp.baseCurrency) problems.push("missing base currency");
    else if (emp.baseCurrency !== currency) {
      problems.push(`base currency ${emp.baseCurrency} differs from entity currency ${currency} — payroll runs are single-currency`);
    }
    if (!emp.startDate) problems.push("missing start date");
    if (rules && !emp.nationality) problems.push("missing nationality (drives scheme eligibility)");
    if (problems.length > 0) {
      validationErrors.push({ employeeId: emp.id, name: emp.fullName, message: problems.join("; ") });
      continue;
    }
    const monthlyGross = round2((emp.baseCompensation as number) / 12);
    const monthlyBasic = emp.basicWageMonthly != null && emp.basicWageMonthly > 0
      ? round2(Math.min(emp.basicWageMonthly, monthlyGross))
      : monthlyGross;
    const housing = emp.housingAllowanceMonthly ?? 0;
    const serviceEnd = emp.endDate && emp.endDate < asOf ? emp.endDate : asOf;
    const serviceYears = serviceYearsBetween(emp.startDate as string, serviceEnd);
    const regDate = emp.schemeRegisteredOn ?? (emp.startDate as string);

    let contributions: PayrollContributionDetail[] = [];
    let eosbTarget = 0;
    const detail: Record<string, unknown> = {};
    if (rules) {
      contributions = computeContributions({
        rules,
        nationality: emp.nationality,
        schemeRegisteredOn: regDate,
        monthlyBasic,
        monthlyGross,
        housingAllowanceMonthly: housing,
        overrides,
      });
      if (rules.eosb && eosbApplies(rules, emp.nationality) && !settled.has(emp.id)) {
        const comp = computeEosbEntitlement({
          rules: rules.eosb,
          serviceYears,
          monthlyBasic,
          monthlyGross,
          capPerYearOverride: overrides?.eosbCapPerYearOverride ?? null,
        });
        eosbTarget = comp.cappedEntitlement;
        detail.eosb = comp;
      }
    }
    const employerTotal = round2(contributions.reduce((s, c) => s + c.employerAmount, 0));
    const employeeTotal = round2(contributions.reduce((s, c) => s + c.employeeAmount, 0));
    const eosbOpening = accrued.get(emp.id) ?? 0;
    const eosbAccrual = round2(eosbTarget - eosbOpening);
    drafts.push({
      employee: emp,
      monthlyGross,
      monthlyBasic,
      housing,
      serviceYears: round2(serviceYears * 10000) / 10000,
      contributions,
      employerTotal,
      employeeTotal,
      eosbTarget,
      eosbOpening,
      eosbAccrual,
      detail,
    });
  }

  const totals: PayrollRunTotals = {
    headcount: drafts.length,
    grossSalaries: round2(drafts.reduce((s, d) => s + d.monthlyGross, 0)),
    employerContributions: round2(drafts.reduce((s, d) => s + d.employerTotal, 0)),
    employeeWithholdings: round2(drafts.reduce((s, d) => s + d.employeeTotal, 0)),
    eosbAccrual: round2(drafts.reduce((s, d) => s + d.eosbAccrual, 0)),
    netPay: round2(drafts.reduce((s, d) => s + d.monthlyGross - d.employeeTotal, 0)),
  };

  const runId = existing?.id ?? rid("payrun");
  if (existing) {
    await db.update(atelierPayrollRuns).set({
      currency,
      countryCode: entity.country,
      totals,
      validationErrors,
      computedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(atelierPayrollRuns.id, existing.id));
    await db.delete(atelierPayrollLines).where(and(
      eq(atelierPayrollLines.orgId, orgId),
      eq(atelierPayrollLines.runId, existing.id),
    ));
  } else {
    await db.insert(atelierPayrollRuns).values({
      id: runId,
      orgId,
      legalEntityId: entityId,
      periodLabel,
      status: "draft",
      currency,
      countryCode: entity.country,
      totals,
      validationErrors,
      createdByUserId: args.createdByUserId,
    });
  }
  for (const d of drafts) {
    await db.insert(atelierPayrollLines).values({
      id: rid("payln"),
      orgId,
      runId,
      employeeId: d.employee.id,
      personName: d.employee.fullName,
      nationality: d.employee.nationality,
      currency,
      monthlyGross: d.monthlyGross,
      monthlyBasic: d.monthlyBasic,
      housingAllowance: d.housing,
      serviceYears: d.serviceYears,
      contributions: d.contributions,
      employerTotal: d.employerTotal,
      employeeTotal: d.employeeTotal,
      eosbTarget: d.eosbTarget,
      eosbOpening: d.eosbOpening,
      eosbAccrual: d.eosbAccrual,
      detail: d.detail,
    });
  }
  const [run] = await db.select().from(atelierPayrollRuns).where(eq(atelierPayrollRuns.id, runId));
  const lines = await db.select().from(atelierPayrollLines)
    .where(and(eq(atelierPayrollLines.orgId, orgId), eq(atelierPayrollLines.runId, runId)));
  return { run, lines, rules };
}

// ──────────────────────────────────────────────────────────────
// Idempotent GL posting (mirrors the Bookkeeper's source-key pattern)
// ──────────────────────────────────────────────────────────────

interface LineSpec { code: string; debit?: number; credit?: number; memo?: string }

async function postJournal(args: {
  orgId: string;
  legalEntityId: string;
  periodLabel: string;
  entryDate: string;
  sourceKind: string;
  sourceRef: string;
  memo: string;
  currency: string;
  createdByUserId: string | null;
  lines: LineSpec[];
}): Promise<{ entryId: string; skippedExisting: boolean }> {
  const [existing] = await db
    .select({ id: atelierGlJournalEntry.id })
    .from(atelierGlJournalEntry)
    .where(and(
      eq(atelierGlJournalEntry.orgId, args.orgId),
      eq(atelierGlJournalEntry.sourceKind, args.sourceKind),
      eq(atelierGlJournalEntry.sourceRef, args.sourceRef),
    ));
  if (existing) return { entryId: existing.id, skippedExisting: true };

  // Ensure the statutory accounts exist (idempotent chart seed).
  await seedChartForEntity({ orgId: args.orgId, legalEntityId: args.legalEntityId, createdByUserId: args.createdByUserId });
  const accounts = await db.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, args.orgId),
    eq(atelierGlAccount.legalEntityId, args.legalEntityId),
    eq(atelierGlAccount.active, true),
  ));
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  const resolved: Array<{ acct: (typeof accounts)[number]; debit: number; credit: number; memo: string | null }> = [];
  for (const l of args.lines) {
    let debit = round2(l.debit ?? 0);
    let credit = round2(l.credit ?? 0);
    if (debit < 0) { credit = round2(credit - debit); debit = 0; }
    else if (credit < 0) { debit = round2(debit - credit); credit = 0; }
    if (debit === 0 && credit === 0) continue;
    const acct = byCode.get(l.code);
    if (!acct) throw new PayrollError(500, `GL account ${l.code} missing for entity — chart seed failed`);
    resolved.push({ acct, debit, credit, memo: l.memo ?? null });
  }
  const totalDebit = round2(resolved.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(resolved.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.011) {
    throw new PayrollError(500, `journal does not balance (Dr ${totalDebit} vs Cr ${totalCredit})`);
  }
  const entryId = rid("gljrn");
  await db.transaction(async (tx) => {
    await tx.insert(atelierGlJournalEntry).values({
      id: entryId,
      orgId: args.orgId,
      legalEntityId: args.legalEntityId,
      periodLabel: args.periodLabel,
      entryDate: args.entryDate,
      kind: "posting",
      sourceKind: args.sourceKind,
      sourceRef: args.sourceRef,
      memo: args.memo,
      currency: args.currency,
      totalDebit,
      totalCredit,
      createdByUserId: args.createdByUserId,
    });
    for (const l of resolved) {
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"),
        orgId: args.orgId,
        journalEntryId: entryId,
        accountId: l.acct.id,
        accountCode: l.acct.code,
        accountName: l.acct.name,
        debit: l.debit,
        credit: l.credit,
        memo: l.memo,
      });
    }
  });
  return { entryId, skippedExisting: false };
}

export async function postPayrollRun(args: {
  orgId: string;
  runId: string;
  postedByUserId: string | null;
}): Promise<{ run: typeof atelierPayrollRuns.$inferSelect; alreadyPosted: boolean }> {
  const [run] = await db.select().from(atelierPayrollRuns).where(and(
    eq(atelierPayrollRuns.orgId, args.orgId),
    eq(atelierPayrollRuns.id, args.runId),
    isNull(atelierPayrollRuns.deletedAt),
  ));
  if (!run) throw new PayrollError(404, "payroll run not found");
  if (run.status === "posted") return { run, alreadyPosted: true };
  if ((run.validationErrors ?? []).length > 0) {
    throw new PayrollError(409, "run has validation errors — fix the flagged people and recompute before posting");
  }
  if (run.totals.headcount === 0) throw new PayrollError(409, "run has no payable people");
  if (await isGlPeriodLocked(args.orgId, run.periodLabel)) {
    throw new PayrollError(409, `period ${run.periodLabel} is close-locked for the GL`);
  }
  const t = run.totals;
  const { entryId } = await postJournal({
    orgId: args.orgId,
    legalEntityId: run.legalEntityId,
    periodLabel: run.periodLabel,
    entryDate: monthEnd(run.periodLabel),
    sourceKind: "payroll_run",
    sourceRef: `${run.legalEntityId}:${run.periodLabel}`,
    memo: `Payroll ${run.periodLabel} — salaries, statutory contributions & EOSB accrual`,
    currency: run.currency,
    createdByUserId: args.postedByUserId,
    lines: [
      { code: "6000", debit: t.grossSalaries, memo: "Gross salaries" },
      { code: "6010", debit: t.employerContributions, memo: "Employer social contributions" },
      { code: "6020", debit: t.eosbAccrual, memo: "EOSB/severance accrual" },
      { code: "2100", credit: round2(t.grossSalaries - t.employeeWithholdings), memo: "Net pay payable" },
      { code: "2150", credit: t.employeeWithholdings, memo: "Employee withholdings" },
      { code: "2160", credit: t.employerContributions, memo: "Contributions payable" },
      { code: "2500", credit: t.eosbAccrual, memo: "EOSB provision movement" },
    ],
  });
  await db.update(atelierPayrollRuns).set({
    status: "posted",
    postedAt: new Date(),
    postedByUserId: args.postedByUserId,
    journalEntryId: entryId,
    updatedAt: new Date(),
  }).where(eq(atelierPayrollRuns.id, run.id));
  const [updated] = await db.select().from(atelierPayrollRuns).where(eq(atelierPayrollRuns.id, run.id));
  return { run: updated, alreadyPosted: false };
}

// ──────────────────────────────────────────────────────────────
// EOSB liability report
// ──────────────────────────────────────────────────────────────

export interface EosbReportRow {
  employeeId: string;
  personName: string;
  nationality: string | null;
  startDate: string | null;
  serviceYears: number;
  wageMonthly: number;
  liabilityToDate: number;
  accruedInGl: number;
  eligible: boolean;
  note: string | null;
}

export async function eosbLiabilityReport(orgId: string, entityId: string): Promise<{
  entityId: string;
  currency: string;
  country: string;
  asOf: string;
  rows: EosbReportRow[];
  totalLiability: number;
  totalAccruedInGl: number;
}> {
  const entity = await loadEntity(orgId, entityId);
  const asOf = new Date().toISOString().slice(0, 10);
  const rules = resolveRules(entity.country, asOf);
  const overrides = entity.statutory ?? null;
  const currency = entity.baseCurrency || rules?.currency || "USD";
  const { employees } = await loadEntityEmployees(orgId, entity, asOf.slice(0, 7));
  const settled = await settledEmployeeIds(orgId, entityId);
  const accrued = await eosbAccruedToDate(orgId, entityId, employees.map((e) => e.id));
  const rows: EosbReportRow[] = [];
  for (const emp of employees) {
    if (settled.has(emp.id)) continue;
    if (!rules?.eosb || !eosbApplies(rules, emp.nationality)) {
      rows.push({
        employeeId: emp.id, personName: emp.fullName, nationality: emp.nationality,
        startDate: emp.startDate, serviceYears: 0, wageMonthly: 0, liabilityToDate: 0,
        accruedInGl: accrued.get(emp.id) ?? 0, eligible: false,
        note: rules ? "Covered by national pension scheme — no EOSB accrual" : "No statutory rules for this country",
      });
      continue;
    }
    if (!emp.startDate || !emp.baseCompensation) {
      rows.push({
        employeeId: emp.id, personName: emp.fullName, nationality: emp.nationality,
        startDate: emp.startDate, serviceYears: 0, wageMonthly: 0, liabilityToDate: 0,
        accruedInGl: accrued.get(emp.id) ?? 0, eligible: false,
        note: "Missing hire date or compensation — fix roster data",
      });
      continue;
    }
    const monthlyGross = round2(emp.baseCompensation / 12);
    const monthlyBasic = emp.basicWageMonthly != null && emp.basicWageMonthly > 0
      ? Math.min(emp.basicWageMonthly, monthlyGross) : monthlyGross;
    const serviceYears = serviceYearsBetween(emp.startDate, emp.endDate && emp.endDate < asOf ? emp.endDate : asOf);
    const comp = computeEosbEntitlement({
      rules: rules.eosb,
      serviceYears,
      monthlyBasic,
      monthlyGross,
      capPerYearOverride: overrides?.eosbCapPerYearOverride ?? null,
    });
    rows.push({
      employeeId: emp.id,
      personName: emp.fullName,
      nationality: emp.nationality,
      startDate: emp.startDate,
      serviceYears: round2(serviceYears * 100) / 100,
      wageMonthly: comp.wageMonthly,
      liabilityToDate: comp.cappedEntitlement,
      accruedInGl: accrued.get(emp.id) ?? 0,
      eligible: serviceYears >= rules.eosb.minServiceYears,
      note: comp.capApplied,
    });
  }
  rows.sort((a, b) => b.liabilityToDate - a.liabilityToDate);
  return {
    entityId,
    currency,
    country: entity.country,
    asOf,
    rows,
    totalLiability: round2(rows.reduce((s, r) => s + r.liabilityToDate, 0)),
    totalAccruedInGl: round2(rows.reduce((s, r) => s + r.accruedInGl, 0)),
  };
}

// ──────────────────────────────────────────────────────────────
// EOSB settlement (draft calc → settle posts release + payment accrual)
// ──────────────────────────────────────────────────────────────

export async function createEosbSettlement(args: {
  orgId: string;
  employeeId: string;
  leaveDate: string; // YYYY-MM-DD
  reason: SeparationReason;
  createdByUserId: string | null;
}): Promise<typeof atelierEosbSettlements.$inferSelect> {
  const [emp] = await db.select().from(atelierEmployees).where(and(
    eq(atelierEmployees.orgId, args.orgId),
    eq(atelierEmployees.id, args.employeeId),
    isNull(atelierEmployees.deletedAt),
  ));
  if (!emp) throw new PayrollError(404, "employee not found");
  if (!emp.startDate) throw new PayrollError(409, "employee has no start date — fix roster data first");
  if (!emp.baseCompensation || !emp.baseCurrency) {
    throw new PayrollError(409, "employee has no compensation/currency — fix roster data first");
  }
  // Resolve the employing entity like the run does.
  const activeEntities = await db.select().from(atelierLegalEntities).where(and(
    eq(atelierLegalEntities.orgId, args.orgId),
    eq(atelierLegalEntities.status, "active"),
  ));
  const entity = emp.legalEntityId
    ? activeEntities.find((e) => e.id === emp.legalEntityId)
    : activeEntities.length === 1 ? activeEntities[0] : undefined;
  if (!entity) throw new PayrollError(409, "cannot resolve the person's employing legal entity");
  const rules = resolveRules(entity.country, args.leaveDate);
  if (!rules?.eosb || !eosbApplies(rules, emp.nationality)) {
    throw new PayrollError(409, "no EOSB scheme applies to this person (national pension coverage or unsupported country)");
  }
  const existingSettled = await db.select().from(atelierEosbSettlements).where(and(
    eq(atelierEosbSettlements.orgId, args.orgId),
    eq(atelierEosbSettlements.employeeId, emp.id),
    eq(atelierEosbSettlements.status, "settled"),
  ));
  if (existingSettled.length > 0) throw new PayrollError(409, "this person's EOSB has already been settled");

  const monthlyGross = round2(emp.baseCompensation / 12);
  const monthlyBasic = emp.basicWageMonthly != null && emp.basicWageMonthly > 0
    ? Math.min(emp.basicWageMonthly, monthlyGross) : monthlyGross;
  const serviceYears = serviceYearsBetween(emp.startDate, args.leaveDate);
  const overrides = entity.statutory ?? null;
  const comp = computeEosbSettlement({
    rules: rules.eosb,
    serviceYears,
    monthlyBasic,
    monthlyGross,
    reason: args.reason,
    capPerYearOverride: overrides?.eosbCapPerYearOverride ?? null,
  });
  const accrued = await eosbAccruedToDate(args.orgId, entity.id, [emp.id]);
  const id = rid("eosbstl");
  await db.insert(atelierEosbSettlements).values({
    id,
    orgId: args.orgId,
    legalEntityId: entity.id,
    employeeId: emp.id,
    personName: emp.fullName,
    currency: entity.baseCurrency || rules.currency,
    leaveDate: args.leaveDate,
    reason: args.reason,
    serviceYears: round2(serviceYears * 100) / 100,
    entitlementGross: comp.cappedEntitlement,
    adjustmentFactor: comp.adjustmentFactor,
    finalAmount: comp.finalAmount,
    provisionAccrued: accrued.get(emp.id) ?? 0,
    status: "draft",
    detail: { computation: comp },
    createdByUserId: args.createdByUserId,
  });
  const [row] = await db.select().from(atelierEosbSettlements).where(eq(atelierEosbSettlements.id, id));
  return row;
}

export async function settleEosbSettlement(args: {
  orgId: string;
  settlementId: string;
  settledByUserId: string | null;
}): Promise<{ settlement: typeof atelierEosbSettlements.$inferSelect; alreadySettled: boolean }> {
  const [s] = await db.select().from(atelierEosbSettlements).where(and(
    eq(atelierEosbSettlements.orgId, args.orgId),
    eq(atelierEosbSettlements.id, args.settlementId),
    isNull(atelierEosbSettlements.deletedAt),
  ));
  if (!s) throw new PayrollError(404, "settlement not found");
  if (s.status === "settled") return { settlement: s, alreadySettled: true };
  const periodLabel = s.leaveDate.slice(0, 7);
  const postPeriod = (await isGlPeriodLocked(args.orgId, periodLabel))
    ? new Date().toISOString().slice(0, 7)
    : periodLabel;
  if (await isGlPeriodLocked(args.orgId, postPeriod)) {
    throw new PayrollError(409, `period ${postPeriod} is close-locked for the GL`);
  }
  // Release the provision, expense/credit the true-up, accrue the payment.
  const { entryId } = await postJournal({
    orgId: args.orgId,
    legalEntityId: s.legalEntityId,
    periodLabel: postPeriod,
    entryDate: postPeriod === periodLabel ? s.leaveDate : monthEnd(postPeriod),
    sourceKind: "eosb_settlement",
    sourceRef: s.id,
    memo: `EOSB settlement — ${s.personName} (${s.reason}, ${s.serviceYears}y)`,
    currency: s.currency,
    createdByUserId: args.settledByUserId,
    lines: [
      { code: "2500", debit: s.provisionAccrued, memo: "Release accrued provision" },
      { code: "6020", debit: round2(s.finalAmount - s.provisionAccrued), memo: "Settlement true-up" },
      { code: "2100", credit: s.finalAmount, memo: "Final settlement payable" },
    ],
  });
  await db.update(atelierEosbSettlements).set({
    status: "settled",
    settledAt: new Date(),
    settledByUserId: args.settledByUserId,
    journalEntryId: entryId,
    updatedAt: new Date(),
  }).where(eq(atelierEosbSettlements.id, s.id));
  const [updated] = await db.select().from(atelierEosbSettlements).where(eq(atelierEosbSettlements.id, s.id));
  return { settlement: updated, alreadySettled: false };
}

// ──────────────────────────────────────────────────────────────
// Statutory filing calendar (compliance register materialization)
// ──────────────────────────────────────────────────────────────

/**
 * Idempotently materialize the entity's statutory payroll filings into the
 * Comply statutory register for the current + next `horizonMonths` wage
 * periods. Existing rows (matched on data.sourceKey) are left untouched so
 * status edits survive re-runs.
 */
export async function ensureStatutoryFilings(
  orgId: string,
  entity: Pick<EntityRow, "id" | "country" | "shortName" | "legalNameEn">,
  horizonMonths = 3,
): Promise<{ created: number }> {
  const now = new Date();
  const fromPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const instances = filingInstancesFor({
    entityId: entity.id,
    country: entity.country,
    fromPeriod,
    periods: horizonMonths,
  });
  if (instances.length === 0) return { created: 0 };
  const existing = await db
    .select()
    .from(atelierFinanceComplianceEntries)
    .where(and(
      eq(atelierFinanceComplianceEntries.orgId, orgId),
      eq(atelierFinanceComplianceEntries.register, "statutory"),
      isNull(atelierFinanceComplianceEntries.deletedAt),
    ));
  const have = new Set(
    existing.map((r) => (r.data as Record<string, unknown>).sourceKey).filter(Boolean),
  );
  let created = 0;
  for (const inst of instances) {
    if (have.has(inst.sourceKey)) continue;
    await db.insert(atelierFinanceComplianceEntries).values({
      id: rid("fcr"),
      orgId,
      register: "statutory",
      data: {
        sourceKey: inst.sourceKey,
        entityId: entity.id,
        kind: inst.kind,
        authority: inst.authority,
        description: inst.description,
        dueOn: inst.dueOn,
        status: "not_started",
        owner: "Finance",
        evidenceUrl: null,
        notes: `Auto-attached statutory payroll filing (${entity.shortName || entity.legalNameEn}).`,
      },
    });
    created++;
  }
  return { created };
}
