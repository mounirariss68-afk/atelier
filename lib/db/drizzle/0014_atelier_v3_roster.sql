-- Task #254 — v3 Roster foundation: Employees, Contractors, Partner-firm
-- resources, partner economics placeholder, conflict disclosures, person
-- documents. Plus engagement-access extensions (allocation/scope/lifecycle).
-- Idempotent so reruns are safe across environments.

-- ----- Engagement access extensions -----
ALTER TABLE "atelier_engagement_access"
  ADD COLUMN IF NOT EXISTS "allocation_pct" integer NOT NULL DEFAULT 0;
ALTER TABLE "atelier_engagement_access"
  ADD COLUMN IF NOT EXISTS "scope" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "atelier_engagement_access"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';
ALTER TABLE "atelier_engagement_access"
  ADD COLUMN IF NOT EXISTS "granted_by_user_id" text;
ALTER TABLE "atelier_engagement_access"
  ADD COLUMN IF NOT EXISTS "granted_at" timestamp NOT NULL DEFAULT now();
ALTER TABLE "atelier_engagement_access"
  ADD COLUMN IF NOT EXISTS "end_date" timestamp;
CREATE INDEX IF NOT EXISTS "idx_atelier_eng_access_status"
  ON "atelier_engagement_access" ("status");

-- ----- Employees -----
CREATE TABLE IF NOT EXISTS "atelier_employees" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "user_id" text,
  "employee_id_external" text,
  "full_name" text NOT NULL,
  "preferred_name" text,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "seniority" text NOT NULL DEFAULT 'consultant',
  "title" text,
  "home_office" text,
  "country" text,
  "payroll_country" text,
  "employment_type" text NOT NULL DEFAULT 'FTE',
  "start_date" text,
  "end_date" text,
  "status" text NOT NULL DEFAULT 'active',
  "iban" text,
  "swift" text,
  "notice_period_days" integer NOT NULL DEFAULT 30,
  "partner_economics_id" text,
  "avatar_url" text,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_employees_org" ON "atelier_employees" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_employees_user" ON "atelier_employees" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_employees_status" ON "atelier_employees" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_employees_email"
  ON "atelier_employees" ("org_id", "email");

-- ----- Contractors -----
CREATE TABLE IF NOT EXISTS "atelier_contractors" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "country" text,
  "vendor_entity" text,
  "master_agreement_ref" text,
  "day_rate_amount" double precision,
  "day_rate_currency" text NOT NULL DEFAULT 'USD',
  "start_date" text,
  "end_date" text,
  "status" text NOT NULL DEFAULT 'active',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_contractors_org" ON "atelier_contractors" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_contractors_status" ON "atelier_contractors" ("status");

-- ----- Partner firms -----
CREATE TABLE IF NOT EXISTS "atelier_partner_firms" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "name" text NOT NULL,
  "country" text,
  "master_agreement_ref" text,
  "master_agreement_url" text,
  "contact_name" text,
  "contact_email" text,
  "status" text NOT NULL DEFAULT 'active',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_partner_firms_org" ON "atelier_partner_firms" ("org_id");

-- ----- Partner-firm seconded resources -----
CREATE TABLE IF NOT EXISTS "atelier_partner_firm_resources" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "partner_firm_id" text NOT NULL,
  "full_name" text NOT NULL,
  "email" text,
  "role" text,
  "seniority" text,
  "country" text,
  "day_rate_amount" double precision,
  "day_rate_currency" text NOT NULL DEFAULT 'USD',
  "start_date" text,
  "end_date" text,
  "status" text NOT NULL DEFAULT 'active',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_partner_firm_res_org" ON "atelier_partner_firm_resources" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_partner_firm_res_firm" ON "atelier_partner_firm_resources" ("partner_firm_id");

-- ----- Partner economics placeholder -----
CREATE TABLE IF NOT EXISTS "atelier_partner_economics" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "employee_id" text NOT NULL,
  "profit_share_bps" integer NOT NULL DEFAULT 0,
  "vesting_schedule" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_partner_econ_org" ON "atelier_partner_economics" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_partner_econ_emp" ON "atelier_partner_economics" ("employee_id");

-- ----- Conflict disclosures -----
CREATE TABLE IF NOT EXISTS "atelier_conflict_disclosures" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "person_type" text NOT NULL,
  "person_id" text NOT NULL,
  "disclosure_text" text NOT NULL,
  "disclosed_at" timestamp NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'active',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_conflict_org" ON "atelier_conflict_disclosures" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_conflict_person" ON "atelier_conflict_disclosures" ("person_type", "person_id");

-- ----- Person documents -----
CREATE TABLE IF NOT EXISTS "atelier_person_documents" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "person_type" text NOT NULL,
  "person_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "file_url" text,
  "uploaded_by_user_id" text,
  "uploaded_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_person_docs_org" ON "atelier_person_documents" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_person_docs_person" ON "atelier_person_documents" ("person_type", "person_id");

-- ----- Backfill v1/v2 atelier_users -> atelier_employees -----
-- PRD §8.1: only INTERNAL AICo roles become employees. Non-employee
-- personas (contractor / partner_firm_resource / client_user) live in
-- atelier_contractors / atelier_partner_firm_resources / atelier_salon_users
-- respectively and must NOT be backfilled into the employee table.
INSERT INTO "atelier_employees" ("id", "org_id", "user_id", "full_name", "email", "role", "seniority", "title", "status")
SELECT
  'emp_' || u.id AS id,
  u.org_id,
  u.id,
  u.name,
  u.email,
  u.role,
  CASE u.role
    WHEN 'partner' THEN 'partner'
    WHEN 'engagement_lead' THEN 'principal'
    WHEN 'sme' THEN 'manager'
    WHEN 'ai_engineer' THEN 'senior_consultant'
    WHEN 'business_developer' THEN 'manager'
    WHEN 'operations' THEN 'manager'
    ELSE 'consultant'
  END AS seniority,
  u.title,
  'active' AS status
FROM "atelier_users" u
WHERE u.deleted_at IS NULL
  AND u.role IN ('partner', 'engagement_lead', 'sme', 'ai_engineer', 'business_developer', 'operations')
ON CONFLICT ("org_id", "email") DO NOTHING;

-- ----- Task #254 follow-up: PRD §2.1 column extensions (idempotent) -----
ALTER TABLE "atelier_employees"
  ADD COLUMN IF NOT EXISTS "employment_status" text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "employing_entity" text,
  ADD COLUMN IF NOT EXISTS "base_currency" text,
  ADD COLUMN IF NOT EXISTS "base_compensation" double precision,
  ADD COLUMN IF NOT EXISTS "utilization_target_pct" integer;

ALTER TABLE "atelier_contractors"
  ADD COLUMN IF NOT EXISTS "contract_type" text,
  ADD COLUMN IF NOT EXISTS "contract_start" text,
  ADD COLUMN IF NOT EXISTS "contract_end" text,
  ADD COLUMN IF NOT EXISTS "day_rate_internal_cost" double precision,
  ADD COLUMN IF NOT EXISTS "payment_terms_days" integer,
  ADD COLUMN IF NOT EXISTS "vat_treatment" text,
  ADD COLUMN IF NOT EXISTS "engagement_scope_default" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "contracting_entity" text,
  ADD COLUMN IF NOT EXISTS "conflicts_disclosed_json" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "atelier_partner_firms"
  ADD COLUMN IF NOT EXISTS "hq_country" text,
  ADD COLUMN IF NOT EXISTS "master_agreement_status" text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "master_agreement_end" text,
  ADD COLUMN IF NOT EXISTS "primary_contact_user_id" text,
  ADD COLUMN IF NOT EXISTS "default_payment_terms_days" integer,
  ADD COLUMN IF NOT EXISTS "rate_card_id" text,
  ADD COLUMN IF NOT EXISTS "default_billing_currency" text,
  ADD COLUMN IF NOT EXISTS "insurance_status" text;

ALTER TABLE "atelier_partner_firm_resources"
  ADD COLUMN IF NOT EXISTS "role_on_engagement" text,
  ADD COLUMN IF NOT EXISTS "seniority_band" text,
  ADD COLUMN IF NOT EXISTS "seconded_to_engagement_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "cost_to_aico_per_day" double precision,
  ADD COLUMN IF NOT EXISTS "visible_to_client_in_team_tab" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "partner_firm_pm_user_id" text;

ALTER TABLE "atelier_partner_economics"
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "revenue_share_pct" double precision,
  ADD COLUMN IF NOT EXISTS "base_amount" double precision,
  ADD COLUMN IF NOT EXISTS "currency" text,
  ADD COLUMN IF NOT EXISTS "effective_from" text,
  ADD COLUMN IF NOT EXISTS "effective_to" text;

ALTER TABLE "atelier_conflict_disclosures"
  ADD COLUMN IF NOT EXISTS "declared_party" text,
  ADD COLUMN IF NOT EXISTS "nature" text,
  ADD COLUMN IF NOT EXISTS "scope_impact" text,
  ADD COLUMN IF NOT EXISTS "declared_at" timestamp DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "last_reviewed_at" timestamp;

ALTER TABLE "atelier_person_documents"
  ADD COLUMN IF NOT EXISTS "client_account_id" text,
  ADD COLUMN IF NOT EXISTS "file_ref" text,
  ADD COLUMN IF NOT EXISTS "signed_at" timestamp;

-- Note (Task #254): an earlier revision of this migration backfilled ALL
-- atelier_users (no role filter) and then issued a DELETE to prune the
-- over-broad rows. Both have been removed: the single backfill INSERT
-- above is now strictly scoped to internal AICo roles per PRD §8.1.
-- Any pre-existing rows from the previous wide backfill are left untouched
-- and may be cleaned up by a future scoped DML script gated on
-- `atelier_employees.id LIKE 'emp\_%' AND role NOT IN (...internal...)'`.
