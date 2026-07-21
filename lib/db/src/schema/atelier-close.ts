/**
 * THE ATELIER — Period-close workflow schema (Task #432).
 *
 * Close cycles per legal entity + period (month / quarter / year) with a
 * phased checklist, two-partner sign-offs and quarter/year rollups —
 * layered on the existing `atelier_period_close_lock` (which stays the
 * lock source of truth). Also carries the Close Controller's accrual
 * proposals (approval-gated journals) and the Collections Agent's
 * draft chase communications (approval-gated sends).
 *
 * Conventions (mirrors atelier-l2c-revrec.ts):
 *   - text PKs (prefixed ids)
 *   - org_id default 'aico'
 *   - created_at / updated_at / created_by_user_id / deleted_at
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
// CLOSE CYCLE — one row per (entity, periodType, periodLabel)
// periodType: month | quarter | year
// periodLabel: YYYY-MM | YYYY-Qn | YYYY
// status: open | ready | signed_off
// ============================================================
export const atelierCloseCycle = pgTable(
  "atelier_close_cycle",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    entityId: text("entity_id").notNull(),
    periodType: text("period_type").notNull().default("month"),
    periodLabel: text("period_label").notNull(),
    status: text("status").notNull().default("open"),
    startedByUserId: text("started_by_user_id"),
    controllerRunId: text("controller_run_id"),
    /** Close Controller summary: counts, blockers, rationale. */
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    firstSignoffUserId: text("first_signoff_user_id"),
    firstSignoffAt: timestamp("first_signoff_at"),
    secondSignoffUserId: text("second_signoff_user_id"),
    secondSignoffAt: timestamp("second_signoff_at"),
    signedOffAt: timestamp("signed_off_at"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_close_cycle_org").on(t.orgId),
    index("idx_atelier_close_cycle_entity").on(t.entityId),
    index("idx_atelier_close_cycle_period").on(t.periodLabel),
    uniqueIndex("uq_atelier_close_cycle").on(t.orgId, t.entityId, t.periodType, t.periodLabel),
  ],
);

// ============================================================
// CLOSE CHECKLIST ITEM
// phase: pre_close | execution | post_close
// status: open | done | blocked | na
// ============================================================
export const atelierCloseItem = pgTable(
  "atelier_close_item",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    cycleId: text("cycle_id").notNull(),
    phase: text("phase").notNull(),
    itemKey: text("item_key").notNull(),
    title: text("title").notNull(),
    ownerRole: text("owner_role").notNull().default("finance"),
    status: text("status").notNull().default("open"),
    /** True when the Close Controller verifies this item mechanically. */
    autoCheck: boolean("auto_check").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Machine detail from the last controller check (deltas, counts). */
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    note: text("note"),
    completedByUserId: text("completed_by_user_id"),
    completedAt: timestamp("completed_at"),
    lastCheckedAt: timestamp("last_checked_at"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_close_item_cycle").on(t.cycleId),
    uniqueIndex("uq_atelier_close_item").on(t.cycleId, t.itemKey),
  ],
);

// ============================================================
// ACCRUAL PROPOSAL — Close Controller proposes; a partner approves
// (which posts the journal) or rejects. Never auto-posted.
// status: proposed | approved | rejected
// ============================================================
export const atelierCloseAccrual = pgTable(
  "atelier_close_accrual",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    cycleId: text("cycle_id").notNull(),
    entityId: text("entity_id").notNull(),
    periodLabel: text("period_label").notNull(),
    memo: text("memo").notNull(),
    rationaleText: text("rationale_text").notNull().default(""),
    currency: text("currency").notNull().default("USD"),
    lines: jsonb("lines")
      .$type<Array<{ accountCode: string; debit: number; credit: number; memo?: string }>>()
      .notNull()
      .default([]),
    amount: doublePrecision("amount").notNull().default(0),
    /** Idempotency key so controller re-runs refresh, not duplicate. */
    sourceKey: text("source_key").notNull(),
    status: text("status").notNull().default("proposed"),
    journalEntryId: text("journal_entry_id"),
    proposedByRunId: text("proposed_by_run_id"),
    decidedByUserId: text("decided_by_user_id"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_close_accrual_cycle").on(t.cycleId),
    uniqueIndex("uq_atelier_close_accrual_source").on(t.cycleId, t.sourceKey),
  ],
);

// ============================================================
// COLLECTIONS DRAFT — agent-drafted chase communication per
// (invoice, stepIndex). Approval-gated: nothing sends without a
// human approve; escalations are drafts too.
// status: draft | sent | dismissed
// ============================================================
export const atelierCollectionsDraft = pgTable(
  "atelier_collections_draft",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    invoiceId: text("invoice_id").notNull(),
    invoiceNumber: text("invoice_number"),
    customerName: text("customer_name"),
    ladderId: text("ladder_id"),
    stepIndex: integer("step_index").notNull().default(0),
    template: text("template"),
    channel: text("channel").notNull().default("email"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    daysOverdue: integer("days_overdue").notNull().default(0),
    outstandingUsd: doublePrecision("outstanding_usd").notNull().default(0),
    /** True when the ladder is exhausted → partner escalation draft. */
    escalation: boolean("escalation").notNull().default(false),
    requireApproval: boolean("require_approval").notNull().default(true),
    /** Open promise-to-pay context captured at draft time. */
    promiseContext: jsonb("promise_context").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("draft"),
    agentRunId: text("agent_run_id"),
    approvedByUserId: text("approved_by_user_id"),
    sentAt: timestamp("sent_at"),
    sentVia: text("sent_via"),
    dunningEventId: text("dunning_event_id"),
    dismissedByUserId: text("dismissed_by_user_id"),
    dismissReason: text("dismiss_reason"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_collections_draft_inv").on(t.invoiceId),
    index("idx_atelier_collections_draft_status").on(t.status),
    uniqueIndex("uq_atelier_collections_draft").on(t.orgId, t.invoiceId, t.stepIndex),
  ],
);
