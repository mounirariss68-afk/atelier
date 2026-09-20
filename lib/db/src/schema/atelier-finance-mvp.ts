/**
 * Finance MVP — shareholder funding register.
 *
 * The contribution row is the durable funding instrument. Repayments and
 * reversals are separate immutable rows, linked to the original contribution;
 * the original is never deleted or overwritten to rewrite history.
 */
import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const COMMON = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: text("created_by_user_id"),
  deletedAt: timestamp("deleted_at"),
};

export const atelierShareholderFunding = pgTable(
  "atelier_shareholder_funding",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().default("aico"),
    /** The entity receiving the funds; org-wide rollups use this column. */
    entityId: text("entity_id").notNull(),
    /** contribution | repayment | reversal */
    entryType: text("entry_type").notNull().default("contribution"),
    /** Root contribution id; equal to id for contribution rows. */
    contributionId: text("contribution_id").notNull(),
    /** equity | shareholder_loan (required on root rows). */
    contributionType: text("contribution_type").notNull(),
    contributorName: text("contributor_name").notNull(),
    contributorUserId: text("contributor_user_id"),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull(),
    transactionDate: text("transaction_date").notNull(),
    periodLabel: text("period_label").notNull(),
    sourceDocumentId: text("source_document_id"),
    bankTransactionId: text("bank_transaction_id"),
    bankMatchedAt: timestamp("bank_matched_at"),
    /** pending | confirmed | partially_repaid | repaid | reversed */
    status: text("status").notNull().default("pending"),
    /** Required for repayments/reversals and useful in the review queue. */
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_funding_org_entity").on(t.orgId, t.entityId),
    index("idx_atelier_funding_contribution").on(t.orgId, t.contributionId),
    index("idx_atelier_funding_date").on(t.orgId, t.transactionDate),
    index("idx_atelier_funding_bank").on(t.orgId, t.bankTransactionId),
    uniqueIndex("uq_atelier_funding_idempotency").on(t.orgId, t.idempotencyKey),
  ],
);