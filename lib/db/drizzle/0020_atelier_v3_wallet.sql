-- Atelier v3 — Wallet: Expenses + Cards + Policies + FX + VAT (Task #259).
-- Adds the five wallet tables. Receipt encryption is an indicator field
-- (no live KMS in this build); FX rates are deterministic-seeded.

CREATE TABLE IF NOT EXISTS "atelier_corporate_cards" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "provider" text NOT NULL,
  "cardholder_user_id" text NOT NULL,
  "last4" text NOT NULL,
  "label" text,
  "currency" text DEFAULT 'USD' NOT NULL,
  "monthly_limit_amount" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "linked_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_cards_holder" ON "atelier_corporate_cards" ("cardholder_user_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_cards_org" ON "atelier_corporate_cards" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_expense_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "category" text NOT NULL,
  "applies_to_role" text,
  "applies_to_country" text,
  "cap_amount_usd" double precision,
  "cap_unit" text,
  "hard_block_amount_usd" double precision,
  "approval_threshold_usd" double precision,
  "flight_class_max" text,
  "rationale" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_policy_cat" ON "atelier_expense_policies" ("category");

CREATE TABLE IF NOT EXISTS "atelier_fx_rates" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "date" text NOT NULL,
  "base" text DEFAULT 'USD' NOT NULL,
  "quote" text NOT NULL,
  "rate" double precision NOT NULL,
  "source" text DEFAULT 'seed' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_fx_date_pair" ON "atelier_fx_rates" ("date", "base", "quote");
CREATE INDEX IF NOT EXISTS "idx_atelier_fx_date" ON "atelier_fx_rates" ("date");

CREATE TABLE IF NOT EXISTS "atelier_expenses" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "person_id" text NOT NULL,
  "person_type" text DEFAULT 'employee' NOT NULL,
  "engagement_id" text,
  "expense_date" text NOT NULL,
  "capture_source" text NOT NULL,
  "card_id" text,
  "merchant" text,
  "description" text,
  "category" text DEFAULT 'other' NOT NULL,
  "amount" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "fx_rate" double precision DEFAULT 1 NOT NULL,
  "fx_rate_date" text,
  "usd_amount" double precision DEFAULT 0 NOT NULL,
  "vat_amount" double precision DEFAULT 0 NOT NULL,
  "vat_currency" text,
  "vat_treatment" text DEFAULT 'none' NOT NULL,
  "vat_country" text,
  "client_billable" boolean DEFAULT false NOT NULL,
  "markup_pct" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "policy_status" text DEFAULT 'green' NOT NULL,
  "policy_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "override_rationale" text,
  "auditor_run_id" text,
  "auditor_proposal" jsonb DEFAULT NULL,
  "receipt_file_ref" text,
  "receipt_fixture_key" text,
  "receipt_encrypted_at_rest" boolean DEFAULT true NOT NULL,
  "ocr_payload" jsonb DEFAULT NULL,
  "ocr_payload_redacted_at" timestamp,
  "summary" text,
  "submitted_at" timestamp,
  "approved_at" timestamp,
  "approved_by_user_id" text,
  "rejected_at" timestamp,
  "rejected_reason" text,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_expense_person_date" ON "atelier_expenses" ("person_id", "expense_date");
CREATE INDEX IF NOT EXISTS "idx_atelier_expense_eng_status" ON "atelier_expenses" ("engagement_id", "status");
CREATE INDEX IF NOT EXISTS "idx_atelier_expense_status" ON "atelier_expenses" ("status");
CREATE INDEX IF NOT EXISTS "idx_atelier_expense_org" ON "atelier_expenses" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_vat_register" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "expense_id" text NOT NULL,
  "correction_of_id" text,
  "expense_date" text NOT NULL,
  "country" text NOT NULL,
  "treatment" text NOT NULL,
  "rate" double precision DEFAULT 0 NOT NULL,
  "net_amount" double precision DEFAULT 0 NOT NULL,
  "vat_amount" double precision DEFAULT 0 NOT NULL,
  "gross_amount" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "usd_net" double precision DEFAULT 0 NOT NULL,
  "usd_vat" double precision DEFAULT 0 NOT NULL,
  "usd_gross" double precision DEFAULT 0 NOT NULL,
  "merchant" text,
  "summary" text,
  "recorded_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_atelier_vat_country_treatment" ON "atelier_vat_register" ("country", "treatment");
CREATE INDEX IF NOT EXISTS "idx_atelier_vat_date" ON "atelier_vat_register" ("expense_date");
CREATE INDEX IF NOT EXISTS "idx_atelier_vat_expense" ON "atelier_vat_register" ("expense_id");
