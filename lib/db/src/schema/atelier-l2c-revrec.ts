/**
 * THE ATELIER — Lead-to-Cash Wave 2 schema (Task #361).
 *
 * Revenue recognition (ASC 606 / IFRS 15), period-posting ledger,
 * unbilled-WIP snapshots, engagement-margin snapshots, and the
 * period-close lock that gates re-posts. See
 * `.local/tasks/l2c-wave-2-revrec-wip-margin.md`.
 *
 * Conventions (mirrors atelier-l2c.ts):
 *   - text PKs (deterministic slugs)
 *   - org_id default 'aico'
 *   - created_at / updated_at / created_by_user_id / deleted_at
 *
 * Engagement scoping. Method / milestone / schedule / WIP / margin
 * snapshots carry an `engagement_id` and are RLS-narrowed via the
 * `app.engagement_ids` GUC + `atelier_l2c_engagement_allowed()` (defined
 * in 0031). Period postings + lines + adjustments + period-close lock
 * are firm-wide finance/leadership artifacts.
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

// ============================================================
// REVENUE METHOD (per engagement)
// ============================================================
// method: poc_hours | poc_cost | ratable | milestone | outcome
// basis: free-form descriptor of the inputs (e.g. "consultant hours
// against budget", "monthly 1/12 over term")
export const atelierRevenueMethod = pgTable(
  "atelier_revenue_method",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    method: text("method").notNull(),
    basis: text("basis").notNull().default(""),
    currency: text("currency").notNull().default("USD"),
    plannedTotalAmount: doublePrecision("planned_total_amount").notNull().default(0),
    plannedHours: doublePrecision("planned_hours").notNull().default(0),
    plannedCost: doublePrecision("planned_cost").notNull().default(0),
    ratablePeriods: integer("ratable_periods").notNull().default(0),
    activeFrom: text("active_from"),
    activeTo: text("active_to"),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: text("approved_by_user_id"),
    notes: text("notes").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_revmethod_org").on(t.orgId),
    index("idx_atelier_revmethod_eng").on(t.engagementId),
    uniqueIndex("uniq_atelier_revmethod_active_per_eng").on(t.orgId, t.engagementId, t.activeFrom),
  ],
);

// ============================================================
// REVENUE MILESTONE (per engagement)
// ============================================================
// status: pending | claimed | partner_attested | client_accepted
//       | earned | invoiceable
//
// `client_accepted` may only be set if a row exists in
// `atelier_milestone_acceptance_view` for the same engagement +
// milestone — server-side enforced.
export const atelierRevenueMilestone = pgTable(
  "atelier_revenue_milestone",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    sequence: integer("sequence").notNull().default(0),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    plannedDate: text("planned_date"),
    plannedAmount: doublePrecision("planned_amount").notNull().default(0),
    contractClauseId: text("contract_clause_id"),
    deliverableAcceptanceId: text("deliverable_acceptance_id"),
    status: text("status").notNull().default("pending"),
    claimedAt: timestamp("claimed_at"),
    claimedByUserId: text("claimed_by_user_id"),
    partnerAttestedAt: timestamp("partner_attested_at"),
    partnerAttestedByUserId: text("partner_attested_by_user_id"),
    clientAcceptedAt: timestamp("client_accepted_at"),
    earnedAt: timestamp("earned_at"),
    earnedAmount: doublePrecision("earned_amount").notNull().default(0),
    invoiceableAt: timestamp("invoiceable_at"),
    rationaleText: text("rationale_text").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_revmilestone_org").on(t.orgId),
    index("idx_atelier_revmilestone_eng").on(t.engagementId),
    index("idx_atelier_revmilestone_status").on(t.status),
    index("idx_atelier_revmilestone_acceptance").on(t.deliverableAcceptanceId),
    uniqueIndex("uniq_atelier_revmilestone_seq").on(t.orgId, t.engagementId, t.sequence),
  ],
);

// ============================================================
// REVENUE SCHEDULE (period × engagement)
// ============================================================
// One row per (period_label, engagement) — basis_pct for POC
// methods, recognised_amount for the period, deferred_balance_ending
// for the carry-out, computation_inputs_json for traceability /
// re-run idempotence.
export const atelierRevenueSchedule = pgTable(
  "atelier_revenue_schedule",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    periodLabel: text("period_label").notNull(), // e.g. "2026-05"
    method: text("method").notNull(),
    basisPct: doublePrecision("basis_pct").notNull().default(0),
    recognisedAmount: doublePrecision("recognised_amount").notNull().default(0),
    deferredBalanceEnding: doublePrecision("deferred_balance_ending").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    computationInputsJson: jsonb("computation_inputs_json")
      .$type<Record<string, unknown>>()
      .default({}),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
    computedByAgentRunId: text("computed_by_agent_run_id"),
    frozen: boolean("frozen").notNull().default(false),
    frozenAt: timestamp("frozen_at"),
    frozenByUserId: text("frozen_by_user_id"),
    postingId: text("posting_id"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_revschedule_org").on(t.orgId),
    index("idx_atelier_revschedule_eng").on(t.engagementId),
    index("idx_atelier_revschedule_period").on(t.periodLabel),
    index("idx_atelier_revschedule_posting").on(t.postingId),
    uniqueIndex("uniq_atelier_revschedule_period_eng").on(t.orgId, t.periodLabel, t.engagementId),
  ],
);

// ============================================================
// REVENUE PERIOD POSTING (period header)
// ============================================================
// Immutable. Once `posted_at` is set the schedule lines for the
// period are sealed and may only be altered by an adjustment.
export const atelierRevenuePeriodPosting = pgTable(
  "atelier_revenue_period_posting",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    periodLabel: text("period_label").notNull(),
    initiatedAt: timestamp("initiated_at").notNull().defaultNow(),
    initiatedByUserId: text("initiated_by_user_id"),
    postedAt: timestamp("posted_at"),
    postedByUserId: text("posted_by_user_id"),
    linesCount: integer("lines_count").notNull().default(0),
    grossRecognisedAmount: doublePrecision("gross_recognised_amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    rationaleText: text("rationale_text").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_revposting_org").on(t.orgId),
    index("idx_atelier_revposting_period").on(t.periodLabel),
    uniqueIndex("uniq_atelier_revposting_period").on(t.orgId, t.periodLabel),
  ],
);

// ============================================================
// REVENUE PERIOD POSTING LINE (per engagement line)
// ============================================================
// Append-only. `kind = posting | adjustment` discriminator — original
// posting rows stay intact when an adjustment fires.
export const atelierRevenuePeriodPostingLine = pgTable(
  "atelier_revenue_period_posting_line",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    postingId: text("posting_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    scheduleId: text("schedule_id"),
    kind: text("kind").notNull().default("posting"),
    method: text("method").notNull(),
    recognisedAmount: doublePrecision("recognised_amount").notNull().default(0),
    deferredBalanceEnding: doublePrecision("deferred_balance_ending").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    adjustmentId: text("adjustment_id"),
    notes: text("notes").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_revposting_line_posting").on(t.postingId),
    index("idx_atelier_revposting_line_eng").on(t.engagementId),
    index("idx_atelier_revposting_line_kind").on(t.kind),
  ],
);

// ============================================================
// REVENUE ADJUSTMENT (founding_partner only)
// ============================================================
// Manual override after a period has been posted. Always requires
// rationale_text (server-validated). Writes a new posting line with
// `kind = 'adjustment'` to the same posting; never edits the original.
export const atelierRevenueAdjustment = pgTable(
  "atelier_revenue_adjustment",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    postingId: text("posting_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    deltaAmount: doublePrecision("delta_amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    rationaleText: text("rationale_text").notNull(),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_revadj_org").on(t.orgId),
    index("idx_atelier_revadj_posting").on(t.postingId),
    index("idx_atelier_revadj_eng").on(t.engagementId),
  ],
);

// ============================================================
// PERIOD CLOSE LOCK
// ============================================================
// Once locked, the period blocks further revrec_post_period.
// `locked_modules` is an array discriminator so a period can be
// "revrec-locked but invoicing still open" in transitional close.
export const atelierPeriodCloseLock = pgTable(
  "atelier_period_close_lock",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    periodLabel: text("period_label").notNull(),
    lockedModules: jsonb("locked_modules").$type<string[]>().notNull().default([]),
    lockedAt: timestamp("locked_at").notNull().defaultNow(),
    lockedByUserId: text("locked_by_user_id"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_periodlock_org").on(t.orgId),
    index("idx_atelier_periodlock_period").on(t.periodLabel),
    uniqueIndex("uniq_atelier_periodlock_period").on(t.orgId, t.periodLabel),
  ],
);

// ============================================================
// UNBILLED WIP SNAPSHOT (snapshot_at × engagement)
// ============================================================
export const atelierUnbilledWipSnapshot = pgTable(
  "atelier_unbilled_wip_snapshot",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
    engagementId: text("engagement_id").notNull(),
    hoursBurned: doublePrecision("hours_burned").notNull().default(0),
    expenseBurned: doublePrecision("expense_burned").notNull().default(0),
    recognisedRevenue: doublePrecision("recognised_revenue").notNull().default(0),
    invoicedAmount: doublePrecision("invoiced_amount").notNull().default(0),
    unbilledAmount: doublePrecision("unbilled_amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    runLogId: text("run_log_id"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_wip_org").on(t.orgId),
    index("idx_atelier_wip_eng").on(t.engagementId),
    index("idx_atelier_wip_snap").on(t.snapshotAt),
  ],
);

// ============================================================
// ENGAGEMENT MARGIN SNAPSHOT
// ============================================================
export const atelierEngagementMarginSnapshot = pgTable(
  "atelier_engagement_margin_snapshot",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
    engagementId: text("engagement_id").notNull(),
    periodLabel: text("period_label").notNull(),
    revenueRecognised: doublePrecision("revenue_recognised").notNull().default(0),
    directCost: doublePrecision("direct_cost").notNull().default(0),
    grossMarginAmount: doublePrecision("gross_margin_amount").notNull().default(0),
    grossMarginPct: doublePrecision("gross_margin_pct").notNull().default(0),
    realizationRate: doublePrecision("realization_rate").notNull().default(0),
    hoursBillable: doublePrecision("hours_billable").notNull().default(0),
    hoursBilled: doublePrecision("hours_billed").notNull().default(0),
    standardRevenueAtRack: doublePrecision("standard_revenue_at_rack").notNull().default(0),
    leakageAmount: doublePrecision("leakage_amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_marginsnap_org").on(t.orgId),
    index("idx_atelier_marginsnap_eng").on(t.engagementId),
    index("idx_atelier_marginsnap_period").on(t.periodLabel),
    uniqueIndex("uniq_atelier_marginsnap_period_eng").on(
      t.orgId,
      t.periodLabel,
      t.engagementId,
      t.snapshotAt,
    ),
  ],
);

// ============================================================
// WIP SNAPSHOT RUN LOG (daemon execution audit)
// ============================================================
export const atelierWipSnapshotRunLog = pgTable(
  "atelier_wip_snapshot_run_log",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    engagementsScanned: integer("engagements_scanned").notNull().default(0),
    snapshotsWritten: integer("snapshots_written").notNull().default(0),
    status: text("status").notNull().default("running"),
    errorText: text("error_text").notNull().default(""),
    triggeredByUserId: text("triggered_by_user_id"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_wiprunlog_org").on(t.orgId),
    index("idx_atelier_wiprunlog_started").on(t.startedAt),
  ],
);
