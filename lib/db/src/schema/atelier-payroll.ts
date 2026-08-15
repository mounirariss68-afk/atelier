/**
 * THE ATELIER — Statutory payroll runs (Task #655; basic payroll run per
 * Task #654 design).
 *
 * A payroll run is per (legal entity, YYYY-MM period): computes each
 * person's gross salary, statutory employer contributions, employee
 * withholdings and the month's EOSB/severance accrual from the code-seeded
 * country rules registry (api-server statutoryRules.ts), then posts one
 * balanced journal idempotently (sourceKind 'payroll_run', sourceRef
 * '<entityId>:<period>'). Runs stay recomputable while draft; posting
 * freezes them. EOSB settlements release the accrued provision on leave
 * (sourceKind 'eosb_settlement').
 *
 * Conventions mirror atelier-gl.ts: text PKs, org default 'aico', COMMON.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ORG = (name: string) => text(name).notNull().default("aico");
const COMMON = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: text("created_by_user_id"),
  deletedAt: timestamp("deleted_at"),
};

export interface PayrollRunTotals {
  headcount: number;
  grossSalaries: number;
  employerContributions: number;
  employeeWithholdings: number;
  eosbAccrual: number;
  netPay: number;
  /** Task #1135 — salary-advance installments recovered in this run. */
  advanceRecovery?: number;
}

/** One computation of a scheme against a person's wage for the period. */
export interface PayrollContributionDetail {
  schemeKey: string;
  name: string;
  authority: string;
  /** Wage base after basis + ceiling application (entity currency). */
  base: number;
  employerPct: number;
  employeePct: number;
  employerAmount: number;
  employeeAmount: number;
  notes?: string | null;
}

export const atelierPayrollRuns = pgTable(
  "atelier_payroll_runs",
  {
    id: text("id").primaryKey(), // payrun_...
    orgId: ORG("org_id"),
    legalEntityId: text("legal_entity_id").notNull(),
    periodLabel: text("period_label").notNull(), // YYYY-MM
    /** draft | posted */
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull(),
    countryCode: text("country_code").notNull(),
    totals: jsonb("totals").$type<PayrollRunTotals>().notNull(),
    /** Loud per-person validation failures; posting is blocked while non-empty. */
    validationErrors: jsonb("validation_errors")
      .$type<Array<{ employeeId: string; name: string; message: string }>>()
      .notNull()
      .default([]),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
    postedAt: timestamp("posted_at"),
    postedByUserId: text("posted_by_user_id"),
    journalEntryId: text("journal_entry_id"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_payrun_entity_period").on(t.orgId, t.legalEntityId, t.periodLabel),
    index("idx_atelier_payrun_period").on(t.periodLabel),
  ],
);

export const atelierPayrollLines = pgTable(
  "atelier_payroll_lines",
  {
    id: text("id").primaryKey(), // payln_...
    orgId: ORG("org_id"),
    runId: text("run_id").notNull(),
    employeeId: text("employee_id").notNull(),
    personName: text("person_name").notNull(),
    nationality: text("nationality"),
    currency: text("currency").notNull(),
    monthlyGross: doublePrecision("monthly_gross").notNull(),
    monthlyBasic: doublePrecision("monthly_basic").notNull(),
    housingAllowance: doublePrecision("housing_allowance").notNull().default(0),
    serviceYears: doublePrecision("service_years").notNull(),
    contributions: jsonb("contributions")
      .$type<PayrollContributionDetail[]>()
      .notNull()
      .default([]),
    employerTotal: doublePrecision("employer_total").notNull().default(0),
    employeeTotal: doublePrecision("employee_total").notNull().default(0),
    /** Full EOSB entitlement at period end (unscaled accrual target). */
    eosbTarget: doublePrecision("eosb_target").notNull().default(0),
    /** Provision already accrued via prior posted runs (net of releases). */
    eosbOpening: doublePrecision("eosb_opening").notNull().default(0),
    /** This month's accrual delta (target − opening; may be negative). */
    eosbAccrual: doublePrecision("eosb_accrual").notNull().default(0),
    // Task #1135 — calendar-day proration + deductions.
    /** Calendar days in the period month (28–31). */
    daysInMonth: doublePrecision("days_in_month").notNull().default(30),
    /** Employed calendar days minus approved unpaid-leave days. */
    payableDays: doublePrecision("payable_days").notNull().default(30),
    /** Approved unpaid-leave calendar days inside the employed span. */
    unpaidLeaveDays: doublePrecision("unpaid_leave_days").notNull().default(0),
    /** payableDays / daysInMonth (1 for a full month). */
    prorationFactor: doublePrecision("proration_factor").notNull().default(1),
    /** Human-readable proration basis, e.g. "18/31 days (joined 2026-06-13)". */
    prorationBasis: text("proration_basis"),
    /** Salary-advance installment deducted from this month's net pay. */
    advanceDeduction: doublePrecision("advance_deduction").notNull().default(0),
    /** monthlyGross − employeeTotal − advanceDeduction. */
    netPay: doublePrecision("net_pay").notNull().default(0),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_payln_run_emp").on(t.runId, t.employeeId),
    index("idx_atelier_payln_emp").on(t.employeeId),
  ],
);

export const atelierEosbSettlements = pgTable(
  "atelier_eosb_settlements",
  {
    id: text("id").primaryKey(), // eosbstl_...
    orgId: ORG("org_id"),
    legalEntityId: text("legal_entity_id").notNull(),
    employeeId: text("employee_id").notNull(),
    personName: text("person_name").notNull(),
    currency: text("currency").notNull(),
    leaveDate: text("leave_date").notNull(), // ISO date
    /** resignation | termination | end_of_contract | retirement | death | mutual */
    reason: text("reason").notNull(),
    serviceYears: doublePrecision("service_years").notNull(),
    /** Unscaled entitlement per the country formula. */
    entitlementGross: doublePrecision("entitlement_gross").notNull(),
    /** e.g. Saudi resignation scaling factor, TR resignation forfeiture (0). */
    adjustmentFactor: doublePrecision("adjustment_factor").notNull().default(1),
    finalAmount: doublePrecision("final_amount").notNull(),
    /** Provision accrued to date, released on settlement. */
    provisionAccrued: doublePrecision("provision_accrued").notNull().default(0),
    // Task #1135 — final-pay assembly on top of the gratuity amount.
    /** Annual-leave encashment (remaining balance × daily basic wage). */
    leaveEncashment: doublePrecision("leave_encashment").notNull().default(0),
    /** Signed notice pay: >0 employer pays in lieu; <0 employee owes. */
    noticePay: doublePrecision("notice_pay").notNull().default(0),
    /** Prorated final-month salary (informational when paid via the run). */
    lastSalary: doublePrecision("last_salary").notNull().default(0),
    /** Whether lastSalary is included in the settlement payable (no posted run covers it). */
    salaryIncluded: boolean("salary_included").notNull().default(false),
    /** Outstanding salary-advance balance offset against final pay. */
    advanceOffset: doublePrecision("advance_offset").notNull().default(0),
    /** Total cash payable: gratuity + encashment + notice(±) + included salary − advances. */
    finalPayTotal: doublePrecision("final_pay_total").notNull().default(0),
    /** draft | settled */
    status: text("status").notNull().default("draft"),
    settledAt: timestamp("settled_at"),
    settledByUserId: text("settled_by_user_id"),
    journalEntryId: text("journal_entry_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_eosbstl_entity").on(t.legalEntityId),
    index("idx_atelier_eosbstl_emp").on(t.employeeId),
  ],
);

// ──────────────────────────────────────────────────────────────
// Task #1135 — comp-change history, salary advances, repayments
// ──────────────────────────────────────────────────────────────

/**
 * Effective-dated compensation events. Written alongside the audited
 * roster payroll PATCH (applyPayrollUpdate) whenever comp fields change.
 * The payroll run computes each day's pay from the record in effect,
 * splitting mid-month changes; EOSB uses the wage in effect at period
 * end (UAE: last basic wage). Employee-row columns stay the mirror of
 * the LATEST record.
 */
export const atelierCompChanges = pgTable(
  "atelier_comp_changes",
  {
    id: text("id").primaryKey(), // compchg_...
    orgId: ORG("org_id"),
    employeeId: text("employee_id").notNull(),
    /** First day the new package applies (ISO date, inclusive). */
    effectiveFrom: text("effective_from").notNull(),
    /** Annual base compensation in baseCurrency. */
    baseCompensation: doublePrecision("base_compensation").notNull(),
    baseCurrency: text("base_currency").notNull(),
    basicWageMonthly: doublePrecision("basic_wage_monthly"),
    housingAllowanceMonthly: doublePrecision("housing_allowance_monthly"),
    /** promotion | raise | adjustment | correction | initial */
    reason: text("reason").notNull().default("adjustment"),
    note: text("note"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_compchg_emp").on(t.employeeId, t.effectiveFrom),
    index("idx_atelier_compchg_org").on(t.orgId),
  ],
);

/**
 * Salary advances: finance-gated cash-out at issuance (Dr 1150 advance
 * asset / Cr 1000 cash), recovered as per-run net-pay deductions that
 * draw the asset down (never an expense). Deductions respect the UAE
 * legal caps and never push net pay negative; the shortfall rolls
 * forward. `outstanding` is the single source of truth for the balance.
 */
export const atelierSalaryAdvances = pgTable(
  "atelier_salary_advances",
  {
    id: text("id").primaryKey(), // salvadv_...
    orgId: ORG("org_id"),
    legalEntityId: text("legal_entity_id").notNull(),
    employeeId: text("employee_id").notNull(),
    personName: text("person_name").notNull(),
    currency: text("currency").notNull(),
    principal: doublePrecision("principal").notNull(),
    /** Scheduled deduction per monthly run (subject to legal caps). */
    installmentAmount: doublePrecision("installment_amount").notNull(),
    /** First payroll period (YYYY-MM) deductions apply to. */
    startPeriod: text("start_period").notNull(),
    outstanding: doublePrecision("outstanding").notNull(),
    /** active | paused | repaid | cancelled */
    status: text("status").notNull().default("active"),
    issuedOn: text("issued_on").notNull(), // ISO date
    note: text("note"),
    /** Issuance journal (Dr 1150 / Cr 1000). */
    journalEntryId: text("journal_entry_id"),
    /** Early-payoff journal (Dr 1000 / Cr 1150), when paid off outside a run. */
    payoffJournalEntryId: text("payoff_journal_entry_id"),
    repaidAt: timestamp("repaid_at"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_salvadv_emp").on(t.employeeId),
    index("idx_atelier_salvadv_entity").on(t.legalEntityId),
  ],
);

/**
 * One recovery applied to an advance: a posted payroll-run deduction, an
 * early payoff, or a final-settlement offset. Idempotency key
 * (advanceId, sourceKind, sourceRef) lets posting be safely re-run.
 */
export const atelierAdvanceRepayments = pgTable(
  "atelier_advance_repayments",
  {
    id: text("id").primaryKey(), // advrep_...
    orgId: ORG("org_id"),
    advanceId: text("advance_id").notNull(),
    employeeId: text("employee_id").notNull(),
    /** run_deduction | early_payoff | settlement_offset */
    sourceKind: text("source_kind").notNull(),
    /** runId | advanceId | settlementId */
    sourceRef: text("source_ref").notNull(),
    periodLabel: text("period_label"),
    amount: doublePrecision("amount").notNull(),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_advrep_source").on(t.advanceId, t.sourceKind, t.sourceRef),
    index("idx_atelier_advrep_adv").on(t.advanceId),
  ],
);

/**
 * Task #1136 — WPS SIF export audit trail. One row per generated SIF file
 * (who / when / run / file hash), linked to the WPS row in the statutory
 * comply register (`complianceEntryId`) so marking it filed is one step.
 * The file bytes themselves are handed to Wio via manual portal upload for
 * now — only the deterministic content hash is kept.
 */
export const atelierWpsSifExports = pgTable(
  "atelier_wps_sif_exports",
  {
    id: text("id").primaryKey(), // wpssif_...
    orgId: ORG("org_id"),
    runId: text("run_id").notNull(),
    legalEntityId: text("legal_entity_id").notNull(),
    periodLabel: text("period_label").notNull(), // YYYY-MM
    fileName: text("file_name").notNull(), // <EmployerUniqueID><DDMMYYYY><HHMMSS>.SIF
    sha256: text("sha256").notNull(),
    employerUniqueId: text("employer_unique_id").notNull(),
    recordCount: doublePrecision("record_count").notNull(),
    totalNetPay: doublePrecision("total_net_pay").notNull(),
    currency: text("currency").notNull().default("AED"),
    /** Linked WPS filing row in atelier_finance_compliance_entries. */
    complianceEntryId: text("compliance_entry_id"),
    exportedByUserId: text("exported_by_user_id").notNull(),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_wpssif_run").on(t.runId),
    index("idx_atelier_wpssif_entity_period").on(t.legalEntityId, t.periodLabel),
  ],
);
