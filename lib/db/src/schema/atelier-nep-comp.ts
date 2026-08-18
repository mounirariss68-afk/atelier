/**
 * Task #1298 — Non-salaried NEP compensation (time charges + margin share).
 *
 * Models the origination-based, pre-conversion compensation structure in
 * the non-equity partner agreements (Schedules B–D of the Hisham Nofal
 * agreement being the first instance):
 *
 *  - No fixed salary pre-conversion. Time Charges are paid at a personal
 *    charge-out day rate for delivery time — these flow through the
 *    EXISTING contractor day-rate → timesheet → self-billing machinery
 *    (the plan syncs atelier_contractors.day_rate_amount).
 *  - Margin Share on Project Profit (fees invoiced AND collected, less
 *    all Direct Delivery Costs including the partner's own time charges,
 *    excluding overhead/G&A): a "sale" tier (origination + material
 *    contribution to the sale, no time limit) and an "origination-only"
 *    tier limited to engagements signed within N months of the first
 *    engagement at that client.
 *  - Payable within 30 days of BOTH client acceptance and fee collection.
 *  - Conversion when rolling 12-month attributable revenue and realised
 *    delivered gross margin both meet plan thresholds (tracker only —
 *    conversion itself is a human decision that closes the plan).
 *
 * Plans are EFFECTIVE-DATED: revisions insert a new row with a later
 * effectiveFrom; the current terms for a date are the latest row with
 * effectiveFrom <= date. Lifecycle status (pre_conversion | converted |
 * ended) is stamped consistently across a contractor's rows.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
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

export const atelierNepCompPlans = pgTable(
  "atelier_nep_comp_plans",
  {
    id: text("id").primaryKey(), // nepplan_*
    orgId: ORG("org_id"),
    /** Roster person (atelier_contractors.id) — NEPs are contractor rows. */
    contractorId: text("contractor_id").notNull(),
    /** Login user (atelier_users.id) when linked; used for origination matching. */
    userId: text("user_id"),
    /** Effective date (YYYY-MM-DD). Revisions insert a new row. */
    effectiveFrom: text("effective_from").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** Personal charge-out day rate (Time Charges). */
    dayRateAmount: doublePrecision("day_rate_amount").notNull(),
    /** Margin-share % when originated + material contribution to the sale. */
    marginSharePctSale: doublePrecision("margin_share_pct_sale").notNull(),
    /** Margin-share % for origination-only engagements inside the window. */
    marginSharePctOriginationOnly: doublePrecision("margin_share_pct_origination_only").notNull(),
    /** Months from first engagement at the client during which the origination-only tier applies. */
    originationWindowMonths: integer("origination_window_months").notNull(),
    /** Conversion trigger: rolling 12-month attributable revenue (USD). */
    conversionRevenueThresholdUsd: doublePrecision("conversion_revenue_threshold_usd").notNull(),
    /** Conversion trigger: realised delivered gross margin %. */
    conversionMarginThresholdPct: doublePrecision("conversion_margin_threshold_pct").notNull(),
    /** Agreed post-conversion fixed salary. */
    postConversionSalaryAmount: doublePrecision("post_conversion_salary_amount"),
    postConversionSalaryCurrency: text("post_conversion_salary_currency"),
    /** Free-text: variable comp / benefits agreed at conversion. */
    postConversionVariableNote: text("post_conversion_variable_note"),
    /** pre_conversion | converted | ended — stamped across the contractor's rows. */
    status: text("status").notNull().default("pre_conversion"),
    convertedAt: timestamp("converted_at"),
    convertedByUserId: text("converted_by_user_id"),
    endedAt: timestamp("ended_at"),
    endedByUserId: text("ended_by_user_id"),
    statusNote: text("status_note"),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_nep_plan_contractor").on(t.contractorId, t.effectiveFrom),
    index("idx_atelier_nep_plan_org").on(t.orgId),
  ],
);

/** Statement line — one component of the Project Profit math, for display. */
export interface NepEntitlementStatementLine {
  kind:
    | "fees_invoiced"
    | "fees_collected"
    | "cost_contractor_labour"
    | "cost_own_time_charges"
    | "cost_partner_firm"
    | "cost_expenses"
    | "project_profit"
    | "margin_share";
  label: string;
  amountUsd: number;
  detail?: string | null;
}

export interface NepEntitlementStatement {
  lines: NepEntitlementStatementLine[];
  tier: "sale" | "origination_only" | "none";
  tierPct: number;
  tierReason: string;
  window: {
    firstEngagementAt: string | null;
    engagementSignedAt: string | null;
    windowMonths: number;
    insideWindow: boolean | null;
  };
  flags: {
    originated: boolean;
    materialContribution: boolean;
    fullyCollected: boolean;
    clientAccepted: boolean;
  };
}

/**
 * Per-engagement margin-share entitlement for one NEP. Recomputed
 * idempotently (unique on org+contractor+engagement); rows that have
 * been approved / scheduled / paid / voided are never overwritten by a
 * recompute — only accruing/payable rows refresh.
 *
 * Status flow:
 *   accruing  — computed, but fees not fully collected and/or client
 *               acceptance not recorded; amount is indicative.
 *   payable   — fully collected + client acceptance recorded; dueDate
 *               set to 30 days after the later of the two.
 *   approved  — finance/founder approved for payment; eligible for the
 *               next payment run (NEVER auto-paid).
 *   scheduled — claimed by a payment run.
 *   paid      — settled by a payment run.
 *   void      — manually voided (with reason).
 */
export const atelierNepEntitlements = pgTable(
  "atelier_nep_entitlements",
  {
    id: text("id").primaryKey(), // nepent_*
    orgId: ORG("org_id"),
    contractorId: text("contractor_id").notNull(),
    userId: text("user_id"),
    planId: text("plan_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    engagementName: text("engagement_name"),
    accountId: text("account_id"),
    accountName: text("account_name"),
    tier: text("tier").notNull(), // sale | origination_only | none
    tierPct: doublePrecision("tier_pct").notNull().default(0),
    feesInvoicedUsd: doublePrecision("fees_invoiced_usd").notNull().default(0),
    feesCollectedUsd: doublePrecision("fees_collected_usd").notNull().default(0),
    directCostsUsd: doublePrecision("direct_costs_usd").notNull().default(0),
    ownTimeChargesUsd: doublePrecision("own_time_charges_usd").notNull().default(0),
    projectProfitUsd: doublePrecision("project_profit_usd").notNull().default(0),
    amountUsd: doublePrecision("amount_usd").notNull().default(0),
    statement: jsonb("statement").$type<NepEntitlementStatement | null>(),
    fullyCollected: boolean("fully_collected").notNull().default(false),
    collectedAt: timestamp("collected_at"),
    clientAcceptedAt: timestamp("client_accepted_at"),
    clientAcceptedByUserId: text("client_accepted_by_user_id"),
    /** YYYY-MM-DD — 30 days after the later of collection and acceptance. */
    dueDate: text("due_date"),
    status: text("status").notNull().default("accruing"),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at"),
    voidedByUserId: text("voided_by_user_id"),
    voidedAt: timestamp("voided_at"),
    voidReason: text("void_reason"),
    paymentRunId: text("payment_run_id"),
    paidAt: timestamp("paid_at"),
    remittanceRef: text("remittance_ref"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_nep_ent_contractor_eng").on(t.orgId, t.contractorId, t.engagementId),
    index("idx_atelier_nep_ent_status").on(t.status),
    index("idx_atelier_nep_ent_contractor").on(t.contractorId),
  ],
);
