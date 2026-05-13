-- Atelier v3 Wallet (II) — Task #260.
-- Client-billable expense flow + weekly contractor/partner-firm payment
-- proposals + invoice-line drafts. No bank rails / accounting integrations.

CREATE TABLE IF NOT EXISTS "atelier_contractor_payments" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "payee_user_id" text NOT NULL,
  "payee_person_type" text DEFAULT 'contractor' NOT NULL,
  "payee_name" text NOT NULL,
  "engagement_id" text NOT NULL,
  "week_iso" text NOT NULL,
  "hours" double precision DEFAULT 0 NOT NULL,
  "rate_per_hour" double precision DEFAULT 0 NOT NULL,
  "rate_currency" text DEFAULT 'USD' NOT NULL,
  "cost_amount" double precision DEFAULT 0 NOT NULL,
  "cost_currency" text DEFAULT 'USD' NOT NULL,
  "fx_rate" double precision DEFAULT 1 NOT NULL,
  "usd_amount" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "requires_partner_approval" boolean DEFAULT false NOT NULL,
  "proposal_run_id" text,
  "evidence_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "partner_approved_by_user_id" text,
  "partner_approved_at" timestamp,
  "partner_rationale" text,
  "rejected_at" timestamp,
  "rejected_reason" text,
  "paid_at" timestamp,
  "paid_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_cp_eng_week" ON "atelier_contractor_payments" ("engagement_id", "week_iso");
CREATE INDEX IF NOT EXISTS "idx_atelier_cp_payee_status" ON "atelier_contractor_payments" ("payee_user_id", "status");
CREATE INDEX IF NOT EXISTS "idx_atelier_cp_status" ON "atelier_contractor_payments" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_cp_payee_eng_week" ON "atelier_contractor_payments" ("payee_user_id", "engagement_id", "week_iso");

CREATE TABLE IF NOT EXISTS "atelier_partner_firm_invoices" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "partner_firm_id" text NOT NULL,
  "partner_firm_name" text NOT NULL,
  "engagement_id" text NOT NULL,
  "week_iso" text NOT NULL,
  "hours" double precision DEFAULT 0 NOT NULL,
  "cost_amount" double precision DEFAULT 0 NOT NULL,
  "cost_currency" text DEFAULT 'USD' NOT NULL,
  "fx_rate" double precision DEFAULT 1 NOT NULL,
  "usd_amount" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "proposal_run_id" text,
  "evidence_firm_hour_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "partner_approved_by_user_id" text,
  "partner_approved_at" timestamp,
  "partner_rationale" text,
  "rejected_at" timestamp,
  "rejected_reason" text,
  "paid_at" timestamp,
  "paid_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_pfi_eng_week" ON "atelier_partner_firm_invoices" ("engagement_id", "week_iso");
CREATE INDEX IF NOT EXISTS "idx_atelier_pfi_firm_status" ON "atelier_partner_firm_invoices" ("partner_firm_id", "status");
CREATE INDEX IF NOT EXISTS "idx_atelier_pfi_status" ON "atelier_partner_firm_invoices" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_pfi_firm_eng_week" ON "atelier_partner_firm_invoices" ("partner_firm_id", "engagement_id", "week_iso");

CREATE TABLE IF NOT EXISTS "atelier_invoice_line_drafts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "composed_at" timestamp DEFAULT now() NOT NULL,
  "composed_by_user_id" text,
  "composer_run_id" text,
  "rate_card_id" text,
  "lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "exported_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ild_eng" ON "atelier_invoice_line_drafts" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_ild_status" ON "atelier_invoice_line_drafts" ("status");
