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

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
  atelierPayrollRun,
  atelierCompChanges,
  atelierSalaryAdvances,
  atelierAdvanceRepayments,
  atelierLeaveRequests,
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
  prorateMonth,
  computeNoticePay,
  calendarOverlapDays,
  type CompSegment,
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
// Task #1135 — comp history, unpaid leave, advances (shared loaders)
// ──────────────────────────────────────────────────────────────

/** Approved unpaid-leave requests for the given roster people. */
async function loadUnpaidLeave(
  orgId: string,
  personIds: string[],
): Promise<Map<string, Array<{ startDate: string; endDate: string }>>> {
  const out = new Map<string, Array<{ startDate: string; endDate: string }>>();
  if (personIds.length === 0) return out;
  const rows = await db
    .select()
    .from(atelierLeaveRequests)
    .where(and(
      eq(atelierLeaveRequests.orgId, orgId),
      inArray(atelierLeaveRequests.personId, personIds),
      eq(atelierLeaveRequests.leaveType, "unpaid"),
      eq(atelierLeaveRequests.status, "approved"),
      isNull(atelierLeaveRequests.deletedAt),
    ));
  for (const r of rows) {
    const list = out.get(r.personId) ?? [];
    list.push({ startDate: r.startDate, endDate: r.endDate });
    out.set(r.personId, list);
  }
  return out;
}

/** Total approved unpaid-leave calendar days inside [start, end]. */
function unpaidDaysWithin(
  ranges: Array<{ startDate: string; endDate: string }>,
  start: string,
  end: string,
): number {
  return ranges.reduce((s, r) => s + calendarOverlapDays(r.startDate, r.endDate, start, end), 0);
}

/** Effective-dated comp segments for an employee (falls back to the roster row). */
function compSegmentsFor(
  emp: EmployeeRow,
  changes: Array<typeof atelierCompChanges.$inferSelect>,
): CompSegment[] {
  const toSeg = (c: {
    effectiveFrom: string;
    baseCompensation: number;
    basicWageMonthly: number | null;
    housingAllowanceMonthly: number | null;
  }): CompSegment => {
    const gross = round2(c.baseCompensation / 12);
    return {
      effectiveFrom: c.effectiveFrom,
      monthlyGross: gross,
      monthlyBasic: c.basicWageMonthly != null && c.basicWageMonthly > 0
        ? round2(Math.min(c.basicWageMonthly, gross))
        : gross,
      housingAllowanceMonthly: c.housingAllowanceMonthly ?? 0,
    };
  };
  const segs = changes
    .filter((c) => c.employeeId === emp.id && !c.deletedAt)
    .map(toSeg);
  if (segs.length === 0 && emp.baseCompensation) {
    segs.push(toSeg({
      effectiveFrom: emp.startDate ?? "1970-01-01",
      baseCompensation: emp.baseCompensation,
      basicWageMonthly: emp.basicWageMonthly,
      housingAllowanceMonthly: emp.housingAllowanceMonthly,
    }));
  }
  return segs.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

async function loadCompChanges(
  orgId: string,
  employeeIds: string[],
): Promise<Array<typeof atelierCompChanges.$inferSelect>> {
  if (employeeIds.length === 0) return [];
  return db
    .select()
    .from(atelierCompChanges)
    .where(and(
      eq(atelierCompChanges.orgId, orgId),
      inArray(atelierCompChanges.employeeId, employeeIds),
      isNull(atelierCompChanges.deletedAt),
    ));
}

export async function outstandingAdvances(
  orgId: string,
  employeeIds: string[],
  /**
   * Recovery paths MUST pass the entity whose books are being posted: the
   * 1150 asset lives on the ISSUING entity's ledger, so a run/settlement on
   * another entity must never deduct or clear it (employee transfers).
   */
  legalEntityId?: string,
): Promise<Array<typeof atelierSalaryAdvances.$inferSelect>> {
  if (employeeIds.length === 0) return [];
  const rows = await db
    .select()
    .from(atelierSalaryAdvances)
    .where(and(
      eq(atelierSalaryAdvances.orgId, orgId),
      inArray(atelierSalaryAdvances.employeeId, employeeIds),
      ...(legalEntityId ? [eq(atelierSalaryAdvances.legalEntityId, legalEntityId)] : []),
      isNull(atelierSalaryAdvances.deletedAt),
    ));
  return rows.filter((a) => a.status === "active" && a.outstanding > 0.005);
}

/** Apply one recovery to an advance, idempotent on (advance, kind, ref). */
/** Either the global db or an open transaction — money-moving paths pass their tx. */
export type Dbx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Advisory-lock key shared by EVERY path that posts salary journals for an
 * entity/period (statutory post, legacy simple approve). Both take
 * pg_advisory_xact_lock(hashtext(key)) before their cross-path guard so
 * concurrent posts serialize and can never both pass.
 */
export function payrollPeriodLockKey(legalEntityId: string, periodLabel: string): string {
  return `atelier-payroll-period:${legalEntityId}:${periodLabel}`;
}

export async function applyAdvanceRepayment(args: {
  orgId: string;
  advance: typeof atelierSalaryAdvances.$inferSelect;
  amount: number;
  sourceKind: "run_deduction" | "early_payoff" | "settlement_offset";
  sourceRef: string;
  periodLabel?: string | null;
  createdByUserId: string | null;
}, dbx: Dbx = db): Promise<void> {
  const amount = round2(Math.min(args.amount, args.advance.outstanding));
  if (amount <= 0) return;
  const inserted = await dbx
    .insert(atelierAdvanceRepayments)
    .values({
      id: rid("advrep"),
      orgId: args.orgId,
      advanceId: args.advance.id,
      employeeId: args.advance.employeeId,
      sourceKind: args.sourceKind,
      sourceRef: args.sourceRef,
      periodLabel: args.periodLabel ?? null,
      amount,
      createdByUserId: args.createdByUserId,
    })
    .onConflictDoNothing()
    .returning({ id: atelierAdvanceRepayments.id });
  if (inserted.length === 0) return; // already applied (re-post)
  const remaining = round2(args.advance.outstanding - amount);
  await dbx.update(atelierSalaryAdvances).set({
    outstanding: Math.max(0, remaining),
    status: remaining <= 0.005 ? "repaid" : args.advance.status,
    repaidAt: remaining <= 0.005 ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(atelierSalaryAdvances.id, args.advance.id));
}

/**
 * Task #1135 — issue a salary advance: cash goes out immediately and the
 * amount sits on 1150 (Salary advances receivable) until payroll
 * deductions or a final settlement draw it down. Finance-gated at the
 * route; validation + journal + ledger row here.
 */
export async function issueSalaryAdvance(args: {
  orgId: string;
  employeeId: string;
  amount: number;
  installmentAmount: number;
  startPeriod: string; // YYYY-MM
  note?: string | null;
  createdByUserId: string | null;
}): Promise<typeof atelierSalaryAdvances.$inferSelect> {
  if (!(args.amount > 0)) throw new PayrollError(400, "amount must be positive");
  if (!(args.installmentAmount > 0) || args.installmentAmount > args.amount) {
    throw new PayrollError(400, "installmentAmount must be positive and not exceed the advance amount");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.startPeriod)) throw new PayrollError(400, "startPeriod must be YYYY-MM");
  const [emp] = await db.select().from(atelierEmployees).where(and(
    eq(atelierEmployees.orgId, args.orgId),
    eq(atelierEmployees.id, args.employeeId),
    isNull(atelierEmployees.deletedAt),
  ));
  if (!emp) throw new PayrollError(404, "employee not found");
  if (emp.employmentStatus === "terminated" || emp.status === "offboarded") {
    throw new PayrollError(409, "cannot issue an advance to a terminated person");
  }
  const activeEntities = await db.select().from(atelierLegalEntities).where(and(
    eq(atelierLegalEntities.orgId, args.orgId),
    eq(atelierLegalEntities.status, "active"),
  ));
  const entity = emp.legalEntityId
    ? activeEntities.find((e) => e.id === emp.legalEntityId)
    : activeEntities.length === 1 ? activeEntities[0] : undefined;
  if (!entity) throw new PayrollError(409, "cannot resolve the person's employing legal entity");
  const currency = entity.baseCurrency || emp.baseCurrency || "USD";
  const today = new Date().toISOString().slice(0, 10);
  const id = rid("salvadv");
  const { entryId } = await postJournal({
    orgId: args.orgId,
    legalEntityId: entity.id,
    periodLabel: today.slice(0, 7),
    entryDate: today,
    sourceKind: "salary_advance",
    sourceRef: id,
    memo: `Salary advance — ${emp.fullName}`,
    currency,
    createdByUserId: args.createdByUserId,
    lines: [
      { code: "1150", debit: args.amount, memo: "Salary advance issued" },
      { code: "1000", credit: args.amount, memo: "Cash paid out" },
    ],
  });
  await db.insert(atelierSalaryAdvances).values({
    id,
    orgId: args.orgId,
    legalEntityId: entity.id,
    employeeId: emp.id,
    personName: emp.fullName,
    currency,
    principal: round2(args.amount),
    installmentAmount: round2(args.installmentAmount),
    startPeriod: args.startPeriod,
    outstanding: round2(args.amount),
    status: "active",
    issuedOn: today,
    note: args.note ?? null,
    journalEntryId: entryId,
    createdByUserId: args.createdByUserId,
  });
  const [row] = await db.select().from(atelierSalaryAdvances).where(eq(atelierSalaryAdvances.id, id));
  return row;
}

/** Task #1135 — early payoff: cash received back, asset drawn to zero. */
export async function payoffSalaryAdvance(args: {
  orgId: string;
  advanceId: string;
  createdByUserId: string | null;
}): Promise<typeof atelierSalaryAdvances.$inferSelect> {
  const [adv] = await db.select().from(atelierSalaryAdvances).where(and(
    eq(atelierSalaryAdvances.orgId, args.orgId),
    eq(atelierSalaryAdvances.id, args.advanceId),
    isNull(atelierSalaryAdvances.deletedAt),
  ));
  if (!adv) throw new PayrollError(404, "advance not found");
  if (adv.status === "repaid" || adv.outstanding <= 0.005) throw new PayrollError(409, "advance is already repaid");
  const today = new Date().toISOString().slice(0, 10);
  // Atomic vs run posting/settlement: re-read the row FOR UPDATE inside a
  // tx so a concurrent run post or settlement can't recover the same
  // balance while we journal the payoff.
  return await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(atelierSalaryAdvances)
      .where(eq(atelierSalaryAdvances.id, adv.id)).for("update");
    if (!locked || locked.status === "repaid" || locked.outstanding <= 0.005) {
      throw new PayrollError(409, "advance is already repaid");
    }
    const { entryId } = await postJournal({
      orgId: args.orgId,
      legalEntityId: locked.legalEntityId,
      periodLabel: today.slice(0, 7),
      entryDate: today,
      sourceKind: "salary_advance_payoff",
      sourceRef: locked.id,
      memo: `Salary advance early payoff — ${locked.personName}`,
      currency: locked.currency,
      createdByUserId: args.createdByUserId,
      lines: [
        { code: "1000", debit: locked.outstanding, memo: "Cash received" },
        { code: "1150", credit: locked.outstanding, memo: "Advance repaid in full" },
      ],
    }, tx);
    await applyAdvanceRepayment({
      orgId: args.orgId,
      advance: locked,
      amount: locked.outstanding,
      sourceKind: "early_payoff",
      sourceRef: locked.id,
      createdByUserId: args.createdByUserId,
    }, tx);
    await tx.update(atelierSalaryAdvances).set({
      payoffJournalEntryId: entryId,
      updatedAt: new Date(),
    }).where(eq(atelierSalaryAdvances.id, locked.id));
    const [row] = await tx.select().from(atelierSalaryAdvances).where(eq(atelierSalaryAdvances.id, locked.id));
    return row;
  });
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
  // Leavers whose SETTLED final pay already included this month's salary
  // must not draw a salary line here too (the settlement journaled it).
  const salarySettledRows = await db.select({ employeeId: atelierEosbSettlements.employeeId })
    .from(atelierEosbSettlements)
    .where(and(
      eq(atelierEosbSettlements.orgId, orgId),
      eq(atelierEosbSettlements.legalEntityId, entityId),
      eq(atelierEosbSettlements.status, "settled"),
      eq(atelierEosbSettlements.salaryIncluded, true),
      sql`left(${atelierEosbSettlements.leaveDate}, 7) = ${periodLabel}`,
      isNull(atelierEosbSettlements.deletedAt),
    ));
  const salarySettled = new Set(salarySettledRows.map((r) => r.employeeId));
  const empIds = employees.map((e) => e.id);
  const accrued = await eosbAccruedToDate(orgId, entityId, empIds, existing?.id);
  const compChanges = await loadCompChanges(orgId, empIds);
  const unpaidLeave = await loadUnpaidLeave(orgId, empIds);
  const advances = await outstandingAdvances(orgId, empIds, entityId);

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
    daysInMonth: number;
    payableDays: number;
    unpaidLeaveDays: number;
    prorationFactor: number;
    prorationBasis: string;
    advanceDeduction: number;
    netPay: number;
    detail: Record<string, unknown>;
  }
  const drafts: LineDraft[] = [];

  for (const emp of employees) {
    if (salarySettled.has(emp.id)) continue; // final salary paid via settlement
    const problems: string[] = [];
    if (!emp.baseCompensation || emp.baseCompensation <= 0) problems.push("missing annual base compensation");
    if (!emp.baseCurrency) problems.push("missing base currency");
    else if (emp.baseCurrency !== currency) {
      problems.push(`base currency ${emp.baseCurrency} differs from entity currency ${currency} — payroll runs are single-currency`);
    }
    if (!emp.startDate) problems.push("missing start date");
    if (rules && !emp.nationality) problems.push("missing nationality (drives scheme eligibility)");
    if (!emp.iban) problems.push("missing IBAN (net pay cannot be disbursed)");
    if (problems.length > 0) {
      validationErrors.push({ employeeId: emp.id, name: emp.fullName, message: problems.join("; ") });
      continue;
    }

    // Task #1135 — calendar-day proration with comp-change splitting and
    // approved unpaid-leave days removed from pay.
    const empUnpaid = unpaidLeave.get(emp.id) ?? [];
    const pro = prorateMonth({
      periodLabel,
      startDate: emp.startDate as string,
      endDate: emp.endDate,
      unpaidRanges: empUnpaid,
      comp: compSegmentsFor(emp, compChanges),
    });
    if (pro.payableDays <= 0) {
      // Fully unpaid month (or joined after month end) — nothing payable,
      // but the person is not an error; skip with an explicit note.
      continue;
    }
    // Contract wage in effect at the person's last employed day of the
    // month — EOSB and contribution ceilings work off the contract wage,
    // pay works off the prorated amounts.
    const monthlyGross = pro.compAtEnd.monthlyGross;
    const monthlyBasic = pro.compAtEnd.monthlyBasic;
    // Line/payslip housing is the PRORATED amount actually paid this month
    // (pro.housing) — never the contractual monthly figure, which could
    // exceed a prorated gross on joiner/leaver/unpaid-leave months.
    const housing = pro.housing;
    const serviceEnd = emp.endDate && emp.endDate < asOf ? emp.endDate : asOf;
    // Unpaid leave over the WHOLE employment is excluded from EOSB service
    // (AE Art. 51(6)); other countries keep full calendar service.
    const excludeDays = rules?.labor?.unpaidLeaveExcludedFromService
      ? unpaidDaysWithin(empUnpaid, emp.startDate as string, serviceEnd)
      : 0;
    const serviceYears = serviceYearsBetween(emp.startDate as string, serviceEnd, excludeDays);
    const regDate = emp.schemeRegisteredOn ?? (emp.startDate as string);

    let contributions: PayrollContributionDetail[] = [];
    let eosbTarget = 0;
    const detail: Record<string, unknown> = { proration: { ...pro, compAtEnd: undefined, segments: undefined } };
    if (rules) {
      // Contributions per comp segment, weighted by the PAID days each
      // package covered (a mid-month raise splits the contribution base by
      // effective date — never end-of-month wage × factor). Ceilings and
      // ILOE tiers are evaluated per segment on that segment's contract
      // wage; fixed premiums prorate with the same day weight.
      const merged = new Map<string, PayrollContributionDetail>();
      for (const seg of pro.segments) {
        const w = seg.paidDays / pro.daysInMonth;
        for (const c of computeContributions({
          rules,
          nationality: emp.nationality,
          schemeRegisteredOn: regDate,
          monthlyBasic: seg.comp.monthlyBasic,
          monthlyGross: seg.comp.monthlyGross,
          housingAllowanceMonthly: seg.comp.housingAllowanceMonthly,
          overrides,
        })) {
          const prev = merged.get(c.schemeKey);
          if (prev) {
            prev.base = prev.base + c.base * w;
            prev.employerAmount = prev.employerAmount + c.employerAmount * w;
            prev.employeeAmount = prev.employeeAmount + c.employeeAmount * w;
          } else {
            merged.set(c.schemeKey, {
              ...c,
              base: c.base * w,
              employerAmount: c.employerAmount * w,
              employeeAmount: c.employeeAmount * w,
            });
          }
        }
      }
      contributions = [...merged.values()].map((c) => ({
        ...c,
        base: round2(c.base),
        employerAmount: round2(c.employerAmount),
        employeeAmount: round2(c.employeeAmount),
      }));
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
        if (excludeDays > 0) detail.eosbServiceExcludedDays = excludeDays;
      }
    }
    const employerTotal = round2(contributions.reduce((s, c) => s + c.employerAmount, 0));
    const employeeTotal = round2(contributions.reduce((s, c) => s + c.employeeAmount, 0));
    const eosbOpening = accrued.get(emp.id) ?? 0;
    const eosbAccrual = round2(eosbTarget - eosbOpening);

    // Task #1135 — salary-advance installment, capped by law and floored
    // so net pay never goes negative; the shortfall rolls forward.
    const netBeforeAdvance = round2(pro.gross - employeeTotal);
    let advanceDeduction = 0;
    const advanceSplit: Array<{ advanceId: string; amount: number; scheduled: number }> = [];
    const empAdvances = advances.filter(
      (a) => a.employeeId === emp.id && a.startPeriod <= periodLabel,
    );
    if (empAdvances.length > 0 && netBeforeAdvance > 0) {
      const advCapPct = rules?.labor?.advanceDeductionCapPct ?? 20;
      const totalCapPct = rules?.labor?.totalDeductionCapPct ?? 50;
      const advCap = round2((pro.gross * advCapPct) / 100);
      const totalCapRoom = round2(Math.max(0, (pro.gross * totalCapPct) / 100 - employeeTotal));
      let room = Math.min(advCap, totalCapRoom, netBeforeAdvance);
      for (const a of empAdvances) {
        const take = round2(Math.min(a.installmentAmount, a.outstanding, Math.max(0, room)));
        if (take <= 0) continue;
        advanceSplit.push({ advanceId: a.id, amount: take, scheduled: a.installmentAmount });
        advanceDeduction = round2(advanceDeduction + take);
        room = round2(room - take);
      }
      if (advanceSplit.length > 0) {
        detail.advances = advanceSplit;
        detail.advanceCaps = { advCapPct, totalCapPct, advCap, totalCapRoom };
      }
    }
    const netPay = round2(netBeforeAdvance - advanceDeduction);
    if (netPay < 0) {
      validationErrors.push({
        employeeId: emp.id,
        name: emp.fullName,
        message: `net pay would be negative (${netPay} ${currency}) — withholdings exceed prorated pay`,
      });
      continue;
    }

    drafts.push({
      employee: emp,
      monthlyGross: pro.gross,
      monthlyBasic,
      housing,
      serviceYears: round2(serviceYears * 10000) / 10000,
      contributions,
      employerTotal,
      employeeTotal,
      eosbTarget,
      eosbOpening,
      eosbAccrual,
      daysInMonth: pro.daysInMonth,
      payableDays: pro.payableDays,
      unpaidLeaveDays: pro.unpaidLeaveDays,
      prorationFactor: round2(pro.factor * 10000) / 10000,
      prorationBasis: pro.basis,
      advanceDeduction,
      netPay,
      detail,
    });
  }

  const totals: PayrollRunTotals = {
    headcount: drafts.length,
    grossSalaries: round2(drafts.reduce((s, d) => s + d.monthlyGross, 0)),
    employerContributions: round2(drafts.reduce((s, d) => s + d.employerTotal, 0)),
    employeeWithholdings: round2(drafts.reduce((s, d) => s + d.employeeTotal, 0)),
    eosbAccrual: round2(drafts.reduce((s, d) => s + d.eosbAccrual, 0)),
    advanceRecovery: round2(drafts.reduce((s, d) => s + d.advanceDeduction, 0)),
    netPay: round2(drafts.reduce((s, d) => s + d.netPay, 0)),
  };

  const runId = existing?.id ?? rid("payrun");
  // Task #1135 — recompute writes are ATOMIC and serialized against
  // posting: take the same per-entity/period advisory lock the post path
  // holds, and only touch the run while it is still a draft. Without this,
  // a recompute finishing while a post is in flight could swap the totals
  // and lines out from under the posted journal.
  await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${payrollPeriodLockKey(entityId, periodLabel)}))`);
  if (existing) {
    const updatedRows = await tx.update(atelierPayrollRuns).set({
      currency,
      countryCode: entity.country,
      totals,
      validationErrors,
      computedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(atelierPayrollRuns.id, existing.id),
      eq(atelierPayrollRuns.status, "draft"),
    )).returning({ id: atelierPayrollRuns.id });
    if (updatedRows.length === 0) {
      // Posted while we were computing — keep the posted snapshot intact.
      throw new PayrollError(409, `payroll ${periodLabel} was posted while this recompute was running — reload the run`);
    }
    await tx.delete(atelierPayrollLines).where(and(
      eq(atelierPayrollLines.orgId, orgId),
      eq(atelierPayrollLines.runId, existing.id),
    ));
  } else {
    await tx.insert(atelierPayrollRuns).values({
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
    await tx.insert(atelierPayrollLines).values({
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
      daysInMonth: d.daysInMonth,
      payableDays: d.payableDays,
      unpaidLeaveDays: d.unpaidLeaveDays,
      prorationFactor: d.prorationFactor,
      prorationBasis: d.prorationBasis,
      advanceDeduction: d.advanceDeduction,
      netPay: d.netPay,
      detail: d.detail,
    });
  }
  });
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
}, dbx: Dbx = db): Promise<{ entryId: string; skippedExisting: boolean }> {
  const [existing] = await dbx
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
  const accounts = await dbx.select().from(atelierGlAccount).where(and(
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
  await dbx.transaction(async (tx) => {
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
  const [preRun] = await db.select({
    id: atelierPayrollRuns.id,
    legalEntityId: atelierPayrollRuns.legalEntityId,
    periodLabel: atelierPayrollRuns.periodLabel,
  }).from(atelierPayrollRuns).where(and(
    eq(atelierPayrollRuns.orgId, args.orgId),
    eq(atelierPayrollRuns.id, args.runId),
    isNull(atelierPayrollRuns.deletedAt),
  ));
  if (!preRun) throw new PayrollError(404, "payroll run not found");
  if (await isGlPeriodLocked(args.orgId, preRun.periodLabel)) {
    throw new PayrollError(409, `period ${preRun.periodLabel} is close-locked for the GL`);
  }
  // Task #1135 — ATOMIC posting: journal, advance repayments and the status
  // flip commit or roll back together, inside a per-entity/period advisory
  // lock shared with the legacy approve path AND the recompute path
  // (payrollPeriodLockKey), so concurrent statutory/legacy posts serialize,
  // can never both pass their cross-path guards, and a recompute can never
  // swap totals/lines out from under the journal. The run and its lines are
  // (re)read ONLY after the lock is held, so the journal always matches the
  // exact snapshot that ends up posted.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${payrollPeriodLockKey(preRun.legalEntityId, preRun.periodLabel)}))`);
    const [run] = await tx.select().from(atelierPayrollRuns)
      .where(and(
        eq(atelierPayrollRuns.orgId, args.orgId),
        eq(atelierPayrollRuns.id, args.runId),
        isNull(atelierPayrollRuns.deletedAt),
      ))
      .for("update");
    if (!run) throw new PayrollError(404, "payroll run not found");
    const lines = await tx.select().from(atelierPayrollLines)
      .where(and(eq(atelierPayrollLines.orgId, args.orgId), eq(atelierPayrollLines.runId, run.id)));
    if (run.status === "posted") {
      return { run, lines, alreadyPosted: true as const };
    }
    if ((run.validationErrors ?? []).length > 0) {
      throw new PayrollError(409, "run has validation errors — fix the flagged people and recompute before posting");
    }
    if (run.totals.headcount === 0) throw new PayrollError(409, "run has no payable people");
    const t = run.totals;
    const advanceRecovery = round2(t.advanceRecovery ?? 0);
    // Dual-path guard (authoritative, under the lock): the legacy "simple
    // monthly" path posts Dr 6000 / Cr 2100 for the same entity/period.
    // Decision: the statutory engine is the system of record; the legacy
    // path survives only where the statutory engine has not posted (see
    // UAE-RULES-REVIEW.md §Dual-path consolidation).
    const legacyRuns = await tx.select({ id: atelierPayrollRun.id, status: atelierPayrollRun.status })
      .from(atelierPayrollRun)
      .where(and(
        eq(atelierPayrollRun.orgId, args.orgId),
        eq(atelierPayrollRun.entityId, run.legalEntityId),
        eq(atelierPayrollRun.periodLabel, run.periodLabel),
        isNull(atelierPayrollRun.deletedAt),
      ));
    if (legacyRuns.some((r) => r.status !== "draft")) {
      throw new PayrollError(409, `the legacy monthly payroll already posted salaries for ${run.periodLabel} on this entity — reverse that journal before posting the statutory run`);
    }
    // Settlement guard (under the same lock the settle path takes for this
    // entity/leave-month): if a leaver on this draft was SETTLED with their
    // final-month salary included — for THIS period — after the run was
    // computed, posting the draft would pay that salary twice. Require a
    // recompute (which excludes settled employees).
    const lineEmpIds = [...new Set(lines.map((l) => l.employeeId))];
    if (lineEmpIds.length > 0) {
      const settledNow = await tx.select({ employeeId: atelierEosbSettlements.employeeId, personName: atelierEosbSettlements.personName })
        .from(atelierEosbSettlements)
        .where(and(
          eq(atelierEosbSettlements.orgId, args.orgId),
          eq(atelierEosbSettlements.legalEntityId, run.legalEntityId),
          eq(atelierEosbSettlements.status, "settled"),
          eq(atelierEosbSettlements.salaryIncluded, true),
          sql`left(${atelierEosbSettlements.leaveDate}, 7) = ${run.periodLabel}`,
          inArray(atelierEosbSettlements.employeeId, lineEmpIds),
          isNull(atelierEosbSettlements.deletedAt),
        ));
      if (settledNow.length > 0) {
        throw new PayrollError(409, `final pay for ${settledNow.map((c) => c.personName).join(", ")} was settled (including the final-month salary) after this run was computed — recompute the run before posting`);
      }
    }
    // Stale-draft protection under row locks: the draft's advance
    // deductions were computed against balances that may have changed
    // since (early payoff, settlement offset, pause). Lock the advance
    // rows FOR UPDATE — serializing against payoff/settlement — and
    // verify every scheduled deduction is still covered by the CURRENT
    // active, entity-scoped outstanding balance before journaling.
    // Repayment rows already applied for THIS run (partial retry) count
    // as satisfied, not as shrinkage.
    const empIdsWithAdv = lines.filter((l) => l.advanceDeduction > 0).map((l) => l.employeeId);
    let advRows: Array<typeof atelierSalaryAdvances.$inferSelect> = [];
    if (empIdsWithAdv.length > 0) {
      advRows = await tx.select().from(atelierSalaryAdvances)
        .where(and(
          eq(atelierSalaryAdvances.orgId, args.orgId),
          eq(atelierSalaryAdvances.legalEntityId, run.legalEntityId),
          inArray(atelierSalaryAdvances.employeeId, empIdsWithAdv),
          isNull(atelierSalaryAdvances.deletedAt),
        ))
        .for("update");
    }
    const appliedForRun = advRows.length > 0
      ? await tx.select().from(atelierAdvanceRepayments).where(and(
          eq(atelierAdvanceRepayments.orgId, args.orgId),
          eq(atelierAdvanceRepayments.sourceKind, "run_deduction"),
          eq(atelierAdvanceRepayments.sourceRef, run.id),
        ))
      : [];
    const alreadyApplied = new Set(appliedForRun.map((r) => r.advanceId));
    const byId = new Map(advRows.filter((a) => a.status === "active" || alreadyApplied.has(a.id)).map((a) => [a.id, a]));
    const avail = new Map(advRows.map((a) => [a.id, a.outstanding]));
    for (const line of lines) {
      for (const part of (line.detail?.advances ?? []) as Array<{ advanceId: string; amount: number }>) {
        if (alreadyApplied.has(part.advanceId)) continue; // idempotent retry
        const adv = byId.get(part.advanceId);
        const left = avail.get(part.advanceId) ?? 0;
        if (!adv || part.amount > left + 0.005) {
          throw new PayrollError(409, "advance balances changed since this run was computed (payoff/settlement/pause) — recompute the run before posting");
        }
        avail.set(part.advanceId, round2(left - part.amount));
      }
    }
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
        { code: "2100", credit: round2(t.grossSalaries - t.employeeWithholdings - advanceRecovery), memo: "Net pay payable" },
        { code: "2150", credit: t.employeeWithholdings, memo: "Employee withholdings" },
        { code: "2160", credit: t.employerContributions, memo: "Contributions payable" },
        { code: "2500", credit: t.eosbAccrual, memo: "EOSB provision movement" },
        { code: "1150", credit: advanceRecovery, memo: "Salary-advance recovery (asset drawdown)" },
      ],
    }, tx);
    // Draw down the advance ledger — same tx as the journal, idempotent
    // per (advance, run).
    for (const line of lines) {
      const split = (line.detail?.advances ?? []) as Array<{ advanceId: string; amount: number }>;
      for (const part of split) {
        const adv = byId.get(part.advanceId);
        if (!adv) continue;
        await applyAdvanceRepayment({
          orgId: args.orgId,
          advance: adv,
          amount: part.amount,
          sourceKind: "run_deduction",
          sourceRef: run.id,
          periodLabel: run.periodLabel,
          createdByUserId: args.postedByUserId,
        }, tx);
        adv.outstanding = round2(adv.outstanding - part.amount);
      }
    }
    await tx.update(atelierPayrollRuns).set({
      status: "posted",
      postedAt: new Date(),
      postedByUserId: args.postedByUserId,
      journalEntryId: entryId,
      updatedAt: new Date(),
    }).where(eq(atelierPayrollRuns.id, run.id));
    const [row] = await tx.select().from(atelierPayrollRuns).where(eq(atelierPayrollRuns.id, run.id));
    return { run: row, lines, alreadyPosted: false as const };
  });
  // Task #1135 — publish per-employee payslips into the pay hub. Runs after
  // the tx commits; failures propagate loudly, and a re-invocation of post
  // (idempotent, including the alreadyPosted path above) regenerates only
  // the missing documents.
  const { generateRunPayslips } = await import("./payslips.js");
  await generateRunPayslips({ orgId: args.orgId, run: result.run, lines: result.lines, createdByUserId: args.postedByUserId });
  return { run: result.run, alreadyPosted: result.alreadyPosted };
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
  // Approved unpaid leave is excluded from EOSB service duration (AE rule),
  // so the finance-facing liability figure matches the run/settlement paths.
  const unpaidByEmp = await loadUnpaidLeave(orgId, employees.map((e) => e.id));
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
    const svcEnd = emp.endDate && emp.endDate < asOf ? emp.endDate : asOf;
    const excludeDays = rules.labor?.unpaidLeaveExcludedFromService
      ? unpaidDaysWithin(unpaidByEmp.get(emp.id) ?? [], emp.startDate, svcEnd)
      : 0;
    const serviceYears = serviceYearsBetween(emp.startDate, svcEnd, excludeDays);
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
  /** Notice days contractually due (defaults: labor.noticeDaysMin, or probation rules). */
  noticeDaysDue?: number | null;
  /** Notice days actually served (default = due, i.e. no in-lieu amount). */
  noticeDaysServed?: number | null;
  /** Separation during probation (caps notice at probationNoticeDays; gratuity is nil anyway under min service). */
  probation?: boolean;
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

  // Task #1135 — final pay is assembled from the effective-dated comp
  // history (last basic wage per AE law), unpaid-leave-adjusted service,
  // actual leave balance, notice handling, and the advance ledger.
  const compChanges = await loadCompChanges(args.orgId, [emp.id]);
  const empUnpaid = (await loadUnpaidLeave(args.orgId, [emp.id])).get(emp.id) ?? [];
  const leaveMonth = args.leaveDate.slice(0, 7);
  const pro = prorateMonth({
    periodLabel: leaveMonth,
    startDate: emp.startDate,
    endDate: emp.endDate && emp.endDate < args.leaveDate ? emp.endDate : args.leaveDate,
    unpaidRanges: empUnpaid,
    comp: compSegmentsFor(emp, compChanges),
  });
  const monthlyGross = pro.compAtEnd.monthlyGross;
  const monthlyBasic = pro.compAtEnd.monthlyBasic;
  const excludeDays = rules.labor?.unpaidLeaveExcludedFromService
    ? unpaidDaysWithin(empUnpaid, emp.startDate, args.leaveDate)
    : 0;
  const serviceYears = serviceYearsBetween(emp.startDate, args.leaveDate, excludeDays);
  const overrides = entity.statutory ?? null;
  const comp = computeEosbSettlement({
    rules: rules.eosb,
    serviceYears,
    monthlyBasic,
    monthlyGross,
    reason: args.reason,
    capPerYearOverride: overrides?.eosbCapPerYearOverride ?? null,
  });

  // Annual-leave encashment from the ACTUAL accrued balance in the leave
  // module, valued at the daily basic wage (AE Art. 29(9)).
  const { computeLeaveBalance } = await import("../../routes/atelier/meSelfServiceRoutes.js");
  const balance = await computeLeaveBalance(args.orgId, emp.id, Number(args.leaveDate.slice(0, 4)));
  const encashDays = Math.max(0, balance.remainingAnnual);
  const encashWage = rules.labor?.leaveEncashmentBasis === "gross" ? monthlyGross : monthlyBasic;
  const leaveEncashment = round2((encashWage / 30) * encashDays);

  // Notice pay per the law review (Art. 43; Art. 9 during probation).
  const labor = rules.labor;
  const defaultDue = args.probation
    ? (labor?.probationNoticeDays ?? 14)
    : (labor?.noticeDaysMin ?? 30);
  let noticeDaysDue = args.noticeDaysDue ?? defaultDue;
  if (labor) {
    noticeDaysDue = args.probation
      ? Math.min(noticeDaysDue, labor.probationNoticeDays)
      : Math.min(Math.max(noticeDaysDue, labor.noticeDaysMin), labor.noticeDaysMax);
  }
  const noticeDaysServed = args.noticeDaysServed ?? noticeDaysDue;
  const notice = computeNoticePay({
    monthlyGross,
    noticeDaysDue,
    noticeDaysServed,
    reason: args.reason,
  });

  // Outstanding salary advances offset against final pay.
  const advRows = await outstandingAdvances(args.orgId, [emp.id], entity.id);
  const advanceOffset = round2(advRows.reduce((s, a) => s + a.outstanding, 0));

  // Final-month prorated salary: included in the settlement payable only
  // when a posted statutory run already pays THIS employee for the leave
  // month (a posted run that excluded them — e.g. fully unpaid month or
  // added after compute — must not suppress their final salary).
  const [postedLineForEmp] = await db
    .select({ lineId: atelierPayrollLines.id })
    .from(atelierPayrollRuns)
    .innerJoin(atelierPayrollLines, and(
      eq(atelierPayrollLines.runId, atelierPayrollRuns.id),
      eq(atelierPayrollLines.orgId, atelierPayrollRuns.orgId),
      eq(atelierPayrollLines.employeeId, emp.id),
    ))
    .where(and(
      eq(atelierPayrollRuns.orgId, args.orgId),
      eq(atelierPayrollRuns.legalEntityId, entity.id),
      eq(atelierPayrollRuns.periodLabel, leaveMonth),
      eq(atelierPayrollRuns.status, "posted"),
      isNull(atelierPayrollRuns.deletedAt),
    ))
    .limit(1);
  const lastSalary = pro.gross;
  const salaryIncluded = !postedLineForEmp;
  const finalPayTotal = round2(
    comp.finalAmount + leaveEncashment + notice.amount + (salaryIncluded ? lastSalary : 0) - advanceOffset,
  );

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
    leaveEncashment,
    noticePay: notice.amount,
    lastSalary,
    salaryIncluded,
    advanceOffset,
    finalPayTotal,
    status: "draft",
    detail: {
      computation: comp,
      proration: { ...pro, compAtEnd: undefined },
      leaveBalance: balance,
      encashDays,
      encashWageBasis: rules.labor?.leaveEncashmentBasis ?? "basic",
      notice: { ...notice, noticeDaysDue, noticeDaysServed, probation: !!args.probation },
      eosbServiceExcludedDays: excludeDays,
      advances: advRows.map((a) => ({ advanceId: a.id, outstanding: a.outstanding })),
      salaryIncluded,
    },
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
  // Task #1135 — full final-pay journal: gratuity (provision release +
  // true-up), leave encashment + notice ± + final salary as salary expense,
  // advance offset drawing down the 1150 asset, net payable to 2100.
  // The draft's advanceOffset and salaryIncluded flags are snapshots — a
  // payroll run posting, recoveries or an early payoff after drafting can
  // change both. Inside ONE transaction: take the SAME per-entity/leave-
  // month advisory lock the run post/recompute paths hold (so a statutory
  // run can't concurrently pay the final month), re-derive salary
  // inclusion from the CURRENT posted-line state, lock the advance rows
  // FOR UPDATE, and derive the journal + payable from exactly what is
  // applied — journal + repayments + status commit or roll back together.
  const outcome = await db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${payrollPeriodLockKey(s.legalEntityId, periodLabel)}))`);
  // Re-read the settlement FOR UPDATE under the lock: a concurrent settle
  // (double-click/retry) may have committed while we waited. All figures
  // below derive from this locked fresh row, never the pre-lock snapshot.
  const [sNow] = await tx.select().from(atelierEosbSettlements)
    .where(and(
      eq(atelierEosbSettlements.orgId, args.orgId),
      eq(atelierEosbSettlements.id, args.settlementId),
      isNull(atelierEosbSettlements.deletedAt),
    ))
    .for("update");
  if (!sNow) throw new PayrollError(404, "settlement not found");
  if (sNow.status === "settled") return { settlement: sNow, alreadySettled: true as const };
  const encash = round2(sNow.leaveEncashment ?? 0);
  const noticeAmt = round2(sNow.noticePay ?? 0); // signed; negative debit flips to credit in postJournal
  const [postedLineNow] = await tx
    .select({ lineId: atelierPayrollLines.id })
    .from(atelierPayrollRuns)
    .innerJoin(atelierPayrollLines, and(
      eq(atelierPayrollLines.runId, atelierPayrollRuns.id),
      eq(atelierPayrollLines.orgId, atelierPayrollRuns.orgId),
      eq(atelierPayrollLines.employeeId, sNow.employeeId),
    ))
    .where(and(
      eq(atelierPayrollRuns.orgId, args.orgId),
      eq(atelierPayrollRuns.legalEntityId, sNow.legalEntityId),
      eq(atelierPayrollRuns.periodLabel, periodLabel),
      eq(atelierPayrollRuns.status, "posted"),
      isNull(atelierPayrollRuns.deletedAt),
    ))
    .limit(1);
  const salaryIncludedNow = !postedLineNow;
  const salaryPart = salaryIncludedNow ? round2(sNow.lastSalary ?? 0) : 0;
  const advRows = (await tx.select().from(atelierSalaryAdvances)
    .where(and(
      eq(atelierSalaryAdvances.orgId, args.orgId),
      eq(atelierSalaryAdvances.legalEntityId, sNow.legalEntityId),
      eq(atelierSalaryAdvances.employeeId, sNow.employeeId),
      isNull(atelierSalaryAdvances.deletedAt),
    ))
    .for("update")).filter((a) => a.status === "active" && a.outstanding > 0.005);
  const advOffset = round2(advRows.reduce((sum, a) => sum + a.outstanding, 0));
  const payable = round2(sNow.finalAmount + encash + noticeAmt + salaryPart - advOffset);
  if (payable < 0) {
    throw new PayrollError(409, `final pay is negative (${payable} ${sNow.currency}) — outstanding advances/notice owed exceed the settlement; recover the balance separately before settling`);
  }
  const { entryId } = await postJournal({
    orgId: args.orgId,
    legalEntityId: sNow.legalEntityId,
    periodLabel: postPeriod,
    // (posted within the settlement tx below)
    entryDate: postPeriod === periodLabel ? sNow.leaveDate : monthEnd(postPeriod),
    sourceKind: "eosb_settlement",
    sourceRef: sNow.id,
    memo: `Final pay — ${sNow.personName} (${sNow.reason}, ${sNow.serviceYears}y)`,
    currency: sNow.currency,
    createdByUserId: args.settledByUserId,
    lines: [
      { code: "2500", debit: sNow.provisionAccrued, memo: "Release accrued provision" },
      { code: "6020", debit: round2(sNow.finalAmount - sNow.provisionAccrued), memo: "Gratuity settlement true-up" },
      { code: "6000", debit: encash, memo: "Annual-leave encashment" },
      { code: "6000", debit: noticeAmt, memo: noticeAmt >= 0 ? "Notice pay in lieu" : "Unserved-notice recovery" },
      { code: "6000", debit: salaryPart, memo: "Final-month prorated salary" },
      { code: "1150", credit: advOffset, memo: "Salary-advance offset (asset drawdown)" },
      { code: "2100", credit: payable, memo: "Final settlement payable" },
    ],
  }, tx);
  // Draw the advance ledger down by the exact amounts credited above —
  // same tx as the journal; idempotent per settlement (postJournal is also
  // idempotent on sourceKind+sourceRef, so a retry never double-posts).
  if (advOffset > 0) {
    for (const adv of advRows) {
      await applyAdvanceRepayment({
        orgId: args.orgId,
        advance: adv,
        amount: adv.outstanding,
        sourceKind: "settlement_offset",
        sourceRef: sNow.id,
        periodLabel: postPeriod,
        createdByUserId: args.settledByUserId,
      }, tx);
    }
  }
  await tx.update(atelierEosbSettlements).set({
    status: "settled",
    settledAt: new Date(),
    settledByUserId: args.settledByUserId,
    journalEntryId: entryId,
    // Persist the ACTUAL settle-time figures (may differ from the draft
    // snapshot when advances were recovered or a payroll run posted the
    // final month between draft and settle).
    salaryIncluded: salaryIncludedNow,
    advanceOffset: advOffset,
    finalPayTotal: payable,
    updatedAt: new Date(),
  }).where(eq(atelierEosbSettlements.id, sNow.id));
  const [row] = await tx.select().from(atelierEosbSettlements).where(eq(atelierEosbSettlements.id, sNow.id));
  return { settlement: row, alreadySettled: false as const };
  });
  return outcome;
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
