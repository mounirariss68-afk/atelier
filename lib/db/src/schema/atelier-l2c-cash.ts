/**
 * THE ATELIER — Lead-to-Cash Wave 4 schema (Task #363).
 *
 * Cash application, bank reconciliation, 13-week cash forecast,
 * renewals & NRR. SQL migration: 0035_atelier_l2c_cash_renewals.sql.
 *
 * Conventions mirror atelier-l2c.ts: text PKs, org default 'aico',
 * COMMON timestamps. RLS is org-only at the SQL layer; persona /
 * role / engagement perimeter is enforced in route + capability
 * handlers (see docs in the migration file).
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
// BANK ACCOUNT
// ============================================================
export const atelierBankAccount = pgTable(
  "atelier_bank_account",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    legalEntityId: text("legal_entity_id"),
    bankName: text("bank_name").notNull(),
    accountLabel: text("account_label").notNull(),
    accountNumberLast4: text("account_number_last4").notNull(),
    currency: text("currency").notNull().default("USD"),
    openingBalance: doublePrecision("opening_balance").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    // Task #383 — entity-register bank account definition extensions.
    iban: text("iban"),
    purpose: text("purpose"), // operating | payroll | tax | savings | client_money | other
    debitCards: jsonb("debit_cards").notNull().default([]).$type<
      Array<{ id: string; holderName: string; last4: string; label: string | null; active: boolean }>
    >(),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_bank_account_org").on(t.orgId),
    index("idx_atelier_bank_account_active").on(t.isActive),
  ],
);

// ============================================================
// BANK STATEMENT IMPORT
// source: csv | xero
// ============================================================
export const atelierBankStatementImport = pgTable(
  "atelier_bank_statement_import",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    bankAccountId: text("bank_account_id").notNull(),
    statementDate: text("statement_date").notNull(),
    source: text("source").notNull().default("csv"),
    fileUrl: text("file_url"),
    fileHash: text("file_hash").notNull(),
    rowsCount: integer("rows_count").notNull().default(0),
    importedAt: timestamp("imported_at").notNull().defaultNow(),
    importedBy: text("imported_by"),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_bank_import_acct").on(t.bankAccountId),
    index("idx_atelier_bank_import_date").on(t.statementDate),
    uniqueIndex("uq_atelier_bank_import_hash").on(t.orgId, t.bankAccountId, t.fileHash),
  ],
);

// ============================================================
// BANK TRANSACTION
// kind:          receipt | payment | fee | fx | other
// matchedState:  unmatched | proposed | matched
// ============================================================
export const atelierBankTransaction = pgTable(
  "atelier_bank_transaction",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    bankAccountId: text("bank_account_id").notNull(),
    statementImportId: text("statement_import_id").notNull(),
    postedDate: text("posted_date").notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    counterpartyNameRaw: text("counterparty_name_raw"),
    referenceRaw: text("reference_raw"),
    kind: text("kind").notNull().default("receipt"),
    matchedState: text("matched_state").notNull().default("unmatched"),
    matchRunId: text("match_run_id"),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_bank_txn_acct").on(t.bankAccountId),
    index("idx_atelier_bank_txn_date").on(t.postedDate),
    index("idx_atelier_bank_txn_state").on(t.matchedState),
  ],
);

// ============================================================
// CASH RECEIPT
// ============================================================
export const atelierCashReceipt = pgTable(
  "atelier_cash_receipt",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    bankTransactionId: text("bank_transaction_id").notNull(),
    customerId: text("customer_id"),
    totalAmount: doublePrecision("total_amount").notNull(),
    appliedAmount: doublePrecision("applied_amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    receivedAt: text("received_at").notNull(),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_cash_receipt_txn").on(t.bankTransactionId),
    index("idx_atelier_cash_receipt_cust").on(t.customerId),
    uniqueIndex("uq_atelier_cash_receipt_txn").on(t.orgId, t.bankTransactionId),
  ],
);

// ============================================================
// CASH APPLICATION (append-only; reversals as paired rows)
// ============================================================
export const atelierCashApplication = pgTable(
  "atelier_cash_application",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    cashReceiptId: text("cash_receipt_id").notNull(),
    invoiceId: text("invoice_id").notNull(),
    appliedAmount: doublePrecision("applied_amount").notNull(),
    currency: text("currency").notNull().default("USD"),
    appliedAt: timestamp("applied_at").notNull().defaultNow(),
    appliedByUserId: text("applied_by_user_id"),
    approvedByUserId: text("approved_by_user_id"),
    reversesApplicationId: text("reverses_application_id"),
    reversalReason: text("reversal_reason"),
    rationaleText: text("rationale_text"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_cash_app_receipt").on(t.cashReceiptId),
    index("idx_atelier_cash_app_invoice").on(t.invoiceId),
    index("idx_atelier_cash_app_reverses").on(t.reversesApplicationId),
  ],
);

// ============================================================
// BANK RECONCILIATION PERIOD
// status: open | finalised
// ============================================================
export const atelierBankReconPeriod = pgTable(
  "atelier_bank_recon_period",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    bankAccountId: text("bank_account_id").notNull(),
    periodLabel: text("period_label").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    openingBalance: doublePrecision("opening_balance").notNull().default(0),
    closingBalance: doublePrecision("closing_balance").notNull().default(0),
    computedReceipts: doublePrecision("computed_receipts").notNull().default(0),
    computedPayments: doublePrecision("computed_payments").notNull().default(0),
    variance: doublePrecision("variance").notNull().default(0),
    status: text("status").notNull().default("open"),
    finalisedAt: timestamp("finalised_at"),
    finalisedByUserId: text("finalised_by_user_id"),
    approvedByUserId: text("approved_by_user_id"),
    rationaleText: text("rationale_text"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_bank_recon_acct").on(t.bankAccountId),
    uniqueIndex("uq_atelier_bank_recon_period").on(t.orgId, t.bankAccountId, t.periodLabel),
  ],
);

// ============================================================
// CASH FORECAST SNAPSHOT (13 rows per snapshot)
// ============================================================
export const atelierCashForecastSnapshot = pgTable(
  "atelier_cash_forecast_snapshot",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    snapshotId: text("snapshot_id").notNull(),
    snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
    bankAccountId: text("bank_account_id"),
    weekIndex: integer("week_index").notNull(),
    weekStart: text("week_start").notNull(),
    expectedIn: doublePrecision("expected_in").notNull().default(0),
    expectedOut: doublePrecision("expected_out").notNull().default(0),
    openingBalance: doublePrecision("opening_balance").notNull().default(0),
    closingBalance: doublePrecision("closing_balance").notNull().default(0),
    confidenceLow: doublePrecision("confidence_low").notNull().default(0),
    confidenceHigh: doublePrecision("confidence_high").notNull().default(0),
    isCashGap: boolean("is_cash_gap").notNull().default(false),
    currency: text("currency").notNull().default("USD"),
    inputEvidenceRef: text("input_evidence_ref").notNull(),
    computedByAgentRunId: text("computed_by_agent_run_id"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_cashfc_snap").on(t.snapshotId),
    index("idx_atelier_cashfc_acct").on(t.bankAccountId),
    index("idx_atelier_cashfc_week").on(t.weekStart),
  ],
);

// ============================================================
// RENEWAL
// riskTier: green | amber | red
// status:   open | won | lost | withdrawn
// ============================================================
export const atelierRenewal = pgTable(
  "atelier_renewal",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id"),
    contractId: text("contract_id"),
    accountId: text("account_id"),
    currentArrUsd: doublePrecision("current_arr_usd").notNull().default(0),
    proposedArrUsd: doublePrecision("proposed_arr_usd").notNull().default(0),
    expansionTargetUsd: doublePrecision("expansion_target_usd").notNull().default(0),
    nrrDeltaPct: doublePrecision("nrr_delta_pct").notNull().default(0),
    renewalDueAt: text("renewal_due_at"),
    riskTier: text("risk_tier").notNull().default("green"),
    partnerOwnerId: text("partner_owner_id"),
    opportunityId: text("opportunity_id"),
    autoOpenedAt: timestamp("auto_opened_at"),
    autoOpenedByAgentRunId: text("auto_opened_by_agent_run_id"),
    status: text("status").notNull().default("open"),
    closedAt: timestamp("closed_at"),
    closedByUserId: text("closed_by_user_id"),
    lostReason: text("lost_reason"),
    rationaleText: text("rationale_text"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_renewal_acct").on(t.accountId),
    index("idx_atelier_renewal_contract").on(t.contractId),
    index("idx_atelier_renewal_engagement").on(t.engagementId),
    index("idx_atelier_renewal_due").on(t.renewalDueAt),
    index("idx_atelier_renewal_status").on(t.status),
  ],
);

// JSON shape returned by the AR aging view (Wave-4 round-trip).
// Used by the typed query helper in routes/cli capabilities so the
// view + the in-TS computation stay in sync.
export type AtelierArAgingViewRow = {
  orgId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  accountId: string | null;
  engagementId: string | null;
  jurisdiction: string;
  currency: string;
  status: string;
  total: number;
  amountPaid: number;
  outstanding: number;
  dueDate: string | null;
  daysOverdue: number;
  issuedAt: Date | null;
  paidAt: Date | null;
};
