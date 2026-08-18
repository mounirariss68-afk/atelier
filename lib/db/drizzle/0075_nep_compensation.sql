-- Task #1298 — non-salaried NEP compensation (time charges + margin share).
-- Adds the effective-dated NEP comp plan and per-engagement margin-share
-- entitlement tables, plus origination/material-contribution attribution
-- columns on accounts and engagements.
-- Idempotent: safe against databases that already received the schema via
-- drizzle push, and safe to re-run as a no-op.

CREATE TABLE IF NOT EXISTS "atelier_nep_comp_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "contractor_id" text NOT NULL,
  "user_id" text,
  "effective_from" text NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "day_rate_amount" double precision NOT NULL,
  "margin_share_pct_sale" double precision NOT NULL,
  "margin_share_pct_origination_only" double precision NOT NULL,
  "origination_window_months" integer NOT NULL,
  "conversion_revenue_threshold_usd" double precision NOT NULL,
  "conversion_margin_threshold_pct" double precision NOT NULL,
  "post_conversion_salary_amount" double precision,
  "post_conversion_salary_currency" text,
  "post_conversion_variable_note" text,
  "status" text NOT NULL DEFAULT 'pre_conversion',
  "converted_at" timestamp,
  "converted_by_user_id" text,
  "ended_at" timestamp,
  "ended_by_user_id" text,
  "status_note" text,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_atelier_nep_plan_contractor"
  ON "atelier_nep_comp_plans" ("contractor_id", "effective_from");
CREATE INDEX IF NOT EXISTS "idx_atelier_nep_plan_org"
  ON "atelier_nep_comp_plans" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_nep_entitlements" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "contractor_id" text NOT NULL,
  "user_id" text,
  "plan_id" text NOT NULL,
  "engagement_id" text NOT NULL,
  "engagement_name" text,
  "account_id" text,
  "account_name" text,
  "tier" text NOT NULL,
  "tier_pct" double precision NOT NULL DEFAULT 0,
  "fees_invoiced_usd" double precision NOT NULL DEFAULT 0,
  "fees_collected_usd" double precision NOT NULL DEFAULT 0,
  "direct_costs_usd" double precision NOT NULL DEFAULT 0,
  "own_time_charges_usd" double precision NOT NULL DEFAULT 0,
  "project_profit_usd" double precision NOT NULL DEFAULT 0,
  "amount_usd" double precision NOT NULL DEFAULT 0,
  "statement" jsonb,
  "fully_collected" boolean NOT NULL DEFAULT false,
  "collected_at" timestamp,
  "client_accepted_at" timestamp,
  "client_accepted_by_user_id" text,
  "due_date" text,
  "status" text NOT NULL DEFAULT 'accruing',
  "approved_by_user_id" text,
  "approved_at" timestamp,
  "voided_by_user_id" text,
  "voided_at" timestamp,
  "void_reason" text,
  "payment_run_id" text,
  "paid_at" timestamp,
  "remittance_ref" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_nep_ent_contractor_eng"
  ON "atelier_nep_entitlements" ("org_id", "contractor_id", "engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_nep_ent_status"
  ON "atelier_nep_entitlements" ("status");
CREATE INDEX IF NOT EXISTS "idx_atelier_nep_ent_contractor"
  ON "atelier_nep_entitlements" ("contractor_id");

-- Tenant isolation: same standard org-isolation RLS as every other
-- org_id table (see lib/db/src/atelier-rls.sql, which also re-applies
-- these on boot). Idempotent.
ALTER TABLE "atelier_nep_comp_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "atelier_nep_comp_plans" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atelier_nep_comp_plans_org_isolation" ON "atelier_nep_comp_plans";
CREATE POLICY "atelier_nep_comp_plans_org_isolation" ON "atelier_nep_comp_plans"
  USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org());
ALTER TABLE "atelier_nep_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "atelier_nep_entitlements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atelier_nep_entitlements_org_isolation" ON "atelier_nep_entitlements";
CREATE POLICY "atelier_nep_entitlements_org_isolation" ON "atelier_nep_entitlements"
  USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org());

-- Origination attribution: founder-editable first-engagement date override
-- anchoring the origination-only tier window.
ALTER TABLE "atelier_accounts"
  ADD COLUMN IF NOT EXISTS "origination_first_engagement_at" text;

-- Audited material-contribution-to-the-sale flag (chooses the 20% tier).
ALTER TABLE "atelier_engagements"
  ADD COLUMN IF NOT EXISTS "material_contribution_user_id" text,
  ADD COLUMN IF NOT EXISTS "material_contribution_set_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "material_contribution_set_at" timestamp;
