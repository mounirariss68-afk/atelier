/**
 * Task #430 — Subcontractor self-billing (RCTI) + payment runs.
 *
 * Self-billed invoices: the firm (buyer) raises the invoice on behalf of
 * the subcontractor (contractor or partner firm) from lead-approved
 * timesheet hours / uploaded partner-firm hours at the contracted day
 * rate. One invoice per (supplierType, supplierId, weekIso) with one
 * line per engagement. Rates are snapshotted on the invoice so later
 * rate edits never mutate an issued invoice. VAT is derived per issuing
 * legal entity + supplier vat_treatment; the computation inputs are
 * snapshotted in `vat` jsonb.
 *
 * Generated idempotently by the Self-Billing Clerk agent
 * (ag_self_billing_clerk) which also reconciles each invoice against
 * the pre-existing payment-proposal rows (atelier_contractor_payments /
 * atelier_partner_firm_invoices) and records mismatches in
 * `reconciliation` jsonb.
 *
 * Payment runs: batch approved self-billed invoices + approved-but-
 * unreimbursed expense reimbursements into a run against one bank
 * account; dual-signatory approval enforced via atelier_bank_signatories;
 * remittance references recorded per item at mark-paid time.
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

/** One engagement-week line on a self-billed invoice. */
export interface SelfBilledInvoiceLine {
  engagementId: string;
  engagementName: string | null;
  hours: number;
  ratePerHour: number;
  rateCurrency: string;
  amount: number; // hours × ratePerHour, invoice currency
  /** Evidence: timesheet entry ids (contractor) or firm-hour row ids (partner firm). */
  evidenceIds: string[];
}

/** Snapshot of the rate source used at generation time. */
export interface SelfBilledRateSnapshot {
  source: "contractor_day_rate" | "nep_plan" | "partner_firm_hours" | "fallback";
  dayRateAmount: number | null;
  dayRateCurrency: string | null;
  ratePerHour: number;
  capturedAt: string; // ISO timestamp
}

/** VAT computation inputs + result, snapshotted per invoice. */
export interface SelfBilledVat {
  /** standard | zero_rated | exempt | reverse_charge | out_of_scope */
  treatment: string;
  ratePct: number;
  amount: number; // invoice currency
  entityCountry: string | null;
  supplierVatTreatment: string | null;
  note: string | null;
}

/**
 * One recorded email delivery attempt to the supplier (approval or
 * remittance). status semantics: only "sent" means Resend accepted the
 * message; "not_configured" = log-only mode (NOT delivered); "failed" =
 * provider rejected; "no_email" = supplier has no email on file.
 */
export interface SelfBilledEmailEvent {
  kind: "approval" | "remittance";
  to: string | null;
  status: "sent" | "not_configured" | "failed" | "no_email";
  via: string;
  at: string; // ISO timestamp
}

/** Reconciliation vs the payment-proposal rows for the same supplier/week. */
export interface SelfBilledReconciliation {
  /** matched | mismatch | no_proposal */
  status: string;
  proposalIds: string[]; // atelier_contractor_payments / atelier_partner_firm_invoices ids
  proposalTotalUsd: number | null;
  invoiceTotalUsd: number;
  deltaUsd: number | null;
  notes: string[];
  checkedAt: string; // ISO timestamp
}

export const atelierSelfBilledInvoices = pgTable(
  "atelier_self_billed_invoices",
  {
    id: text("id").primaryKey(), // sbi_...
    orgId: ORG("org_id"),
    invoiceNumber: text("invoice_number").notNull(), // RCTI-YYYY-W##-XXXX
    supplierType: text("supplier_type").notNull(), // contractor | partner_firm
    supplierId: text("supplier_id").notNull(), // atelier_contractors.id | atelier_partner_firms.id
    supplierName: text("supplier_name").notNull(),
    supplierEmail: text("supplier_email"),
    /** Linked login (atelier_users.id) when the supplier has one — drives Me-lens self-scope. */
    payeeUserId: text("payee_user_id"),
    legalEntityId: text("legal_entity_id"), // issuing entity (atelier_legal_entities.id)
    weekIso: text("week_iso").notNull(), // billing period, ISO week
    currency: text("currency").notNull().default("USD"),
    lines: jsonb("lines").$type<SelfBilledInvoiceLine[]>().notNull().default([]),
    rateSnapshot: jsonb("rate_snapshot").$type<SelfBilledRateSnapshot | null>(),
    subtotalAmount: doublePrecision("subtotal_amount").notNull().default(0),
    vat: jsonb("vat").$type<SelfBilledVat | null>(),
    vatAmount: doublePrecision("vat_amount").notNull().default(0),
    totalAmount: doublePrecision("total_amount").notNull().default(0),
    fxRate: doublePrecision("fx_rate").notNull().default(1),
    totalUsd: doublePrecision("total_usd").notNull().default(0),
    // draft | approved | disputed | scheduled | paid | rejected
    status: text("status").notNull().default("draft"),
    /** Links back to the payment-proposal rows this invoice covers. */
    contractorPaymentIds: jsonb("contractor_payment_ids").$type<string[]>().notNull().default([]),
    partnerFirmInvoiceIds: jsonb("partner_firm_invoice_ids").$type<string[]>().notNull().default([]),
    reconciliation: jsonb("reconciliation").$type<SelfBilledReconciliation | null>(),
    /** Supplier email notifications (approval + remittance), newest last. */
    emailDelivery: jsonb("email_delivery").$type<SelfBilledEmailEvent[]>().notNull().default([]),
    agentRunId: text("agent_run_id"),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at"),
    rejectedByUserId: text("rejected_by_user_id"),
    rejectedAt: timestamp("rejected_at"),
    rejectedReason: text("rejected_reason"),
    disputedByUserId: text("disputed_by_user_id"),
    disputedAt: timestamp("disputed_at"),
    disputeReason: text("dispute_reason"),
    disputeResolvedByUserId: text("dispute_resolved_by_user_id"),
    disputeResolvedAt: timestamp("dispute_resolved_at"),
    disputeResolutionNote: text("dispute_resolution_note"),
    paymentRunId: text("payment_run_id"),
    paidAt: timestamp("paid_at"),
    remittanceRef: text("remittance_ref"),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_sbi_supplier_week_currency").on(t.orgId, t.supplierType, t.supplierId, t.weekIso, t.currency),
    index("idx_atelier_sbi_status").on(t.status),
    index("idx_atelier_sbi_payee").on(t.payeeUserId),
    index("idx_atelier_sbi_week").on(t.weekIso),
  ],
);

/** One recorded signature on a payment run. */
export interface PaymentRunSignature {
  signatoryId: string; // atelier_bank_signatories.id
  userId: string;
  name: string;
  authority: string; // sole | joint
  signedAt: string; // ISO timestamp
}

export const atelierPaymentRuns = pgTable(
  "atelier_payment_runs",
  {
    id: text("id").primaryKey(), // payrun_...
    orgId: ORG("org_id"),
    runNumber: text("run_number").notNull(), // PR-YYYYMMDD-XXXX
    bankAccountId: text("bank_account_id").notNull(), // atelier_bank_account.id
    bankAccountLabel: text("bank_account_label").notNull().default(""),
    legalEntityId: text("legal_entity_id"),
    currency: text("currency").notNull().default("USD"),
    // draft | pending_signatures | approved | exported | paid | cancelled
    status: text("status").notNull().default("draft"),
    itemCount: doublePrecision("item_count").notNull().default(0),
    totalUsd: doublePrecision("total_usd").notNull().default(0),
    makerUserId: text("maker_user_id").notNull(),
    makerName: text("maker_name").notNull().default(""),
    signatures: jsonb("signatures").$type<PaymentRunSignature[]>().notNull().default([]),
    approvedAt: timestamp("approved_at"),
    /** Stable, human-readable payment-instruction reference. */
    instructionReference: text("instruction_reference"),
    exportedAt: timestamp("exported_at"),
    /** Export means instructions were produced, never that a transfer ran. */
    sentAt: timestamp("sent_at"),
    sentByUserId: text("sent_by_user_id"),
    paidAt: timestamp("paid_at"),
    cancelledAt: timestamp("cancelled_at"),
    cancelledByUserId: text("cancelled_by_user_id"),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_payrun_status").on(t.status),
    index("idx_atelier_payrun_bank").on(t.bankAccountId),
    uniqueIndex("uq_atelier_payrun_number").on(t.orgId, t.runNumber),
    uniqueIndex("uq_atelier_payment_instruction_reference").on(t.orgId, t.instructionReference),
  ],
);

export const atelierPaymentRunItems = pgTable(
  "atelier_payment_run_items",
  {
    id: text("id").primaryKey(), // pri_...
    orgId: ORG("org_id"),
    runId: text("run_id").notNull(), // atelier_payment_runs.id
    // self_billed_invoice | expense_reimbursement
    itemType: text("item_type").notNull(),
    refId: text("ref_id").notNull(), // sbi id or expense id
    payeeName: text("payee_name").notNull(),
    description: text("description").notNull().default(""),
    amount: doublePrecision("amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    amountUsd: doublePrecision("amount_usd").notNull().default(0),
    // pending | paid | removed
    status: text("status").notNull().default("pending"),
    remittanceRef: text("remittance_ref"),
    paidAt: timestamp("paid_at"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_pri_run").on(t.runId),
    uniqueIndex("uq_atelier_pri_run_ref").on(t.runId, t.itemType, t.refId),
  ],
);

export const atelierSelfBillingSequences = pgTable(
  "atelier_self_billing_sequences",
  {
    id: text("id").primaryKey(), // scope key, e.g. "sbi:aico" | "payrun:aico"
    orgId: ORG("org_id"),
    nextValue: doublePrecision("next_value").notNull().default(1),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);
