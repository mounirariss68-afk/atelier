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
