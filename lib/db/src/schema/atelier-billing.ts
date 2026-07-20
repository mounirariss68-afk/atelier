/**
 * THE ATELIER — Automated billing schedule engine (Task #429).
 *
 * Billing rules capture each engagement's commercial billing pattern
 * (milestone-triggered, periodic T&M, fixed-fee installments, retainer)
 * plus currency / payment terms / issuing legal entity. The deterministic
 * trigger engine (api-server lib/atelier-billing-engine.ts) scans rules
 * and materialises billing triggers with idempotency keys so no trigger
 * can ever bill twice. The Billing Orchestrator agent turns due triggers
 * into DRAFT invoices — issuing always remains a human (partner) action.
 *
 * Conventions (mirrors atelier-l2c-revrec.ts):
 *   - text PKs
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
// BILLING RULE (per engagement)
// ============================================================
// ruleType: milestone | periodic_tnm | fixed_fee | retainer
//
// config shape by ruleType:
//   milestone     — {} (amounts come from the milestone rows)
//   periodic_tnm  — { cadence: "monthly", defaultRateUsd?: number,
//                     anchorDate?: "YYYY-MM-DD" }
//   fixed_fee     — { installments: [{ key, dueDate, amount, label }] }
//   retainer      — { cadence: "monthly", amount: number,
//                     anchorDate?: "YYYY-MM-DD", endDate?: "YYYY-MM-DD" }
export interface BillingInstallment {
  key: string;
  dueDate: string; // YYYY-MM-DD
  amount: number;
  label: string;
}

export interface BillingRuleConfig {
  cadence?: "monthly";
  amount?: number;
  defaultRateUsd?: number;
  anchorDate?: string;
  endDate?: string;
  installments?: BillingInstallment[];
}

export const atelierBillingRule = pgTable(
  "atelier_billing_rule",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    accountId: text("account_id"),
    ruleType: text("rule_type").notNull(), // milestone | periodic_tnm | fixed_fee | retainer
    status: text("status").notNull().default("active"), // active | paused
    currency: text("currency").notNull().default("USD"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    /** Issuing legal entity — atelier_legal_entities.id (nullable = firm default). */
    legalEntityId: text("legal_entity_id"),
    jurisdiction: text("jurisdiction").notNull().default("GLOBAL"), // AE | SA | EU | GLOBAL
    billTo: jsonb("bill_to")
      .$type<{ name?: string; address?: string; vatId?: string; country?: string; contactEmail?: string }>()
      .notNull()
      .default({}),
    config: jsonb("config").$type<BillingRuleConfig>().notNull().default({}),
    notes: text("notes").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_billrule_org").on(t.orgId),
    index("idx_atelier_billrule_eng").on(t.engagementId),
    index("idx_atelier_billrule_status").on(t.status),
  ],
);

// ============================================================
// BILLING TRIGGER (materialised billing candidate)
// ============================================================
// One row per (rule × billable event). The idempotency key is
// deterministic per event, e.g.:
//   bill:<ruleId>:milestone:<milestoneId>
//   bill:<ruleId>:period:<YYYY-MM>
//   bill:<ruleId>:installment:<key>
//   bill:<ruleId>:retainer:<YYYY-MM>
// UNIQUE (org_id, idempotency_key) guarantees no double billing —
// re-scans use INSERT ... ON CONFLICT DO NOTHING.
//
// status: ready | drafted | issued | held | skipped
export const atelierBillingTrigger = pgTable(
  "atelier_billing_trigger",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    ruleId: text("rule_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    triggerType: text("trigger_type").notNull(), // milestone | period_end | installment | retainer
    idempotencyKey: text("idempotency_key").notNull(),
    dueDate: text("due_date").notNull(), // YYYY-MM-DD trigger date
    /** Estimated amount at scan time (T&M estimates may differ from drafted total). */
    amount: doublePrecision("amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("ready"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    invoiceId: text("invoice_id"),
    agentRunId: text("agent_run_id"),
    holdReason: text("hold_reason"),
    heldAt: timestamp("held_at"),
    heldByUserId: text("held_by_user_id"),
    skippedReason: text("skipped_reason"),
    skippedAt: timestamp("skipped_at"),
    skippedByUserId: text("skipped_by_user_id"),
    draftedAt: timestamp("drafted_at"),
    issuedAt: timestamp("issued_at"),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uq_atelier_billtrig_key").on(t.orgId, t.idempotencyKey),
    index("idx_atelier_billtrig_rule").on(t.ruleId),
    index("idx_atelier_billtrig_eng").on(t.engagementId),
    index("idx_atelier_billtrig_status").on(t.status),
    index("idx_atelier_billtrig_invoice").on(t.invoiceId),
  ],
);
