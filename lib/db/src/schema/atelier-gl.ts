/**
 * THE ATELIER — Finance general-ledger backbone (Task #428).
 *
 * Chart of accounts per legal entity, append-only journal (header +
 * lines with entity / account / engagement dimensions), and posting
 * exceptions surfaced by the rule-based Bookkeeper agent.
 *
 * Conventions mirror atelier-l2c-cash.ts: text PKs, org default 'aico',
 * COMMON timestamps. RLS is org-only at the SQL layer; persona / role
 * perimeter is enforced in route handlers (finance leadership only).
 *
 * Journal is APPEND-ONLY: entries are never updated or deleted; a
 * correction is a new reversing entry (kind='reversal') plus a fresh
 * posting. Idempotency: one journal entry per (org, sourceKind,
 * sourceRef) — re-runs skip already-posted sources.
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

// ============================================================
// CHART OF ACCOUNTS (per legal entity)
// type:       asset | liability | equity | revenue | expense
// normalSide: debit | credit
// ============================================================
export const atelierGlAccount = pgTable(
  "atelier_gl_account",
  {
    id: text("id").primaryKey(), // glacct_...
    orgId: ORG("org_id"),
    legalEntityId: text("legal_entity_id").notNull(), // atelier_legal_entities.id
    code: text("code").notNull(), // e.g. "1100"
    name: text("name").notNull(),
    type: text("type").notNull(), // asset | liability | equity | revenue | expense
    normalSide: text("normal_side").notNull(), // debit | credit
    /** System accounts are referenced by posting rules and cannot be deactivated. */
    isSystem: boolean("is_system").notNull().default(false),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_glacct_entity_code").on(t.orgId, t.legalEntityId, t.code),
    index("idx_atelier_glacct_entity").on(t.legalEntityId),
  ],
);

// ============================================================
// JOURNAL ENTRY (header) — append-only
// kind:       posting | manual | reversal | adjustment
// sourceKind: invoice | revrec_posting | expense | contractor_payment |
//             partner_firm_invoice | bank_transaction | manual
// ============================================================
export const atelierGlJournalEntry = pgTable(
  "atelier_gl_journal_entry",
  {
    id: text("id").primaryKey(), // gljrn_...
    orgId: ORG("org_id"),
    legalEntityId: text("legal_entity_id").notNull(),
    periodLabel: text("period_label").notNull(), // YYYY-MM
    entryDate: text("entry_date").notNull(), // YYYY-MM-DD
    kind: text("kind").notNull().default("posting"),
    sourceKind: text("source_kind").notNull(),
    sourceRef: text("source_ref").notNull(), // source row id, or manual entry id
    memo: text("memo"),
    currency: text("currency").notNull().default("USD"),
    totalDebit: doublePrecision("total_debit").notNull().default(0),
    totalCredit: doublePrecision("total_credit").notNull().default(0),
    agentRunId: text("agent_run_id"), // atelier_agent_runs.id when posted by Bookkeeper
    /** Set on the entry being reversed; the reversal entry points back here. */
    reversesEntryId: text("reverses_entry_id"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_gljrn_source").on(t.orgId, t.sourceKind, t.sourceRef),
    index("idx_atelier_gljrn_entity_period").on(t.legalEntityId, t.periodLabel),
    index("idx_atelier_gljrn_period").on(t.periodLabel),
  ],
);

// ============================================================
// JOURNAL LINE — entity dimension inherited from header;
// engagement dimension optional per line.
// ============================================================
export const atelierGlJournalLine = pgTable(
  "atelier_gl_journal_line",
  {
    id: text("id").primaryKey(), // gljl_...
    orgId: ORG("org_id"),
    journalEntryId: text("journal_entry_id").notNull(),
    accountId: text("account_id").notNull(), // atelier_gl_account.id
    accountCode: text("account_code").notNull(), // snapshot for stable reporting
    accountName: text("account_name").notNull(),
    engagementId: text("engagement_id"), // optional dimension
    debit: doublePrecision("debit").notNull().default(0),
    credit: doublePrecision("credit").notNull().default(0),
    memo: text("memo"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_gljl_entry").on(t.journalEntryId),
    index("idx_atelier_gljl_account").on(t.accountId),
    index("idx_atelier_gljl_engagement").on(t.engagementId),
  ],
);

// ============================================================
// POSTING EXCEPTION — Bookkeeper never guesses; it records why a
// source row could not be posted. Upserted per (source, code) so
// re-runs refresh rather than duplicate. status: open | resolved
// code: untagged_entity | unmapped_category | unbalanced |
//       missing_account | ambiguous | period_locked
// ============================================================
export const atelierGlPostingException = pgTable(
  "atelier_gl_posting_exception",
  {
    id: text("id").primaryKey(), // glex_...
    orgId: ORG("org_id"),
    legalEntityId: text("legal_entity_id"), // null when the entity itself is unknown
    periodLabel: text("period_label").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceRef: text("source_ref").notNull(),
    sourceLabel: text("source_label"),
    code: text("code").notNull(),
    message: text("message").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("open"),
    agentRunId: text("agent_run_id"),
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id"),
    resolutionNote: text("resolution_note"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_glex_source_code").on(t.orgId, t.sourceKind, t.sourceRef, t.code),
    index("idx_atelier_glex_status").on(t.status),
    index("idx_atelier_glex_period").on(t.periodLabel),
  ],
);
