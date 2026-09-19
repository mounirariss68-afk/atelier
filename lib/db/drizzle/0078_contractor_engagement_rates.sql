CREATE TABLE IF NOT EXISTS "atelier_contractor_engagement_rates" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "contractor_id" text NOT NULL,
  "engagement_id" text NOT NULL,
  "effective_from" text NOT NULL,
  "effective_to" text,
  "day_rate_amount" double precision NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "agreement_ref" text,
  "agreement_version_ref" text,
  "scope" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "allows_nep_override" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ctr_eng_rate_lookup"
  ON "atelier_contractor_engagement_rates" ("org_id","contractor_id","engagement_id","effective_from");
CREATE INDEX IF NOT EXISTS "idx_atelier_ctr_eng_rate_effective"
  ON "atelier_contractor_engagement_rates" ("engagement_id","effective_from");
DROP INDEX IF EXISTS "uq_atelier_cp_payee_eng_week";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_cp_payee_eng_week_rate"
  ON "atelier_contractor_payments" ("payee_user_id","engagement_id","week_iso","rate_per_hour","rate_currency");
DROP INDEX IF EXISTS "uq_atelier_sbi_supplier_week";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_sbi_supplier_week_currency"
  ON "atelier_self_billed_invoices" ("org_id","supplier_type","supplier_id","week_iso","currency");