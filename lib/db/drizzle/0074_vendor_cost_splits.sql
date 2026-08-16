-- Task #1251 — vendor invoice line-item mining + project cost allocation.
-- Adds the extraction payload column to atelier_partner_firm_invoices and
-- three new org-scoped tables (project map, alloc rules, cost splits).
-- Idempotent: safe to run against databases that already received the
-- column/tables via drizzle push, and safe to re-run as a no-op.

ALTER TABLE "atelier_partner_firm_invoices"
  ADD COLUMN IF NOT EXISTS "line_items" jsonb;

CREATE TABLE IF NOT EXISTS "atelier_vendor_project_map" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "vendor_key" text NOT NULL,
  "project_key" text NOT NULL,
  "project_label" text NOT NULL,
  "bucket_type" text NOT NULL,
  "bucket_ref" text,
  "created_by_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_vpm_org" ON "atelier_vendor_project_map" ("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_vpm_org_vendor_project"
  ON "atelier_vendor_project_map" ("org_id", "vendor_key", "project_key");

CREATE TABLE IF NOT EXISTS "atelier_vendor_alloc_rules" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "vendor_key" text NOT NULL,
  "splits" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_by_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_var_org" ON "atelier_vendor_alloc_rules" ("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_var_org_vendor"
  ON "atelier_vendor_alloc_rules" ("org_id", "vendor_key");

CREATE TABLE IF NOT EXISTS "atelier_vendor_cost_splits" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "invoice_id" text NOT NULL REFERENCES "atelier_partner_firm_invoices" ("id") ON DELETE CASCADE,
  "project_key" text NOT NULL,
  "project_label" text NOT NULL,
  "bucket_type" text NOT NULL,
  "bucket_ref" text,
  "currency" text NOT NULL DEFAULT 'USD',
  "gross_amount" double precision NOT NULL DEFAULT 0,
  "credit_amount" double precision NOT NULL DEFAULT 0,
  "vat_amount" double precision NOT NULL DEFAULT 0,
  "net_amount" double precision NOT NULL DEFAULT 0,
  "usd_amount" double precision NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'proposed',
  "decided_by_user_id" text,
  "decided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_vcs_org" ON "atelier_vendor_cost_splits" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_vcs_invoice" ON "atelier_vendor_cost_splits" ("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_vcs_bucket"
  ON "atelier_vendor_cost_splits" ("org_id", "bucket_type", "bucket_ref", "status");

-- Duplicate-proposal guard (Task #1251, concurrency hardening). Two concurrent
-- extract+propose runs for the same fresh invoice (async trigger + a
-- synchronous backfill/manual /extract) could each insert a FULL proposed set,
-- double-counting the invoice on approval. Beyond the per-invoice advisory lock
-- in code, this makes a duplicate PROPOSED row for the same materialized split
-- identity impossible at the DB. Partial on status='proposed' only: approved
-- rows (immutable history) and any future superseded states are unconstrained.
-- coalesce(bucket_ref,'') so internal/overhead rows (NULL ref) also collide.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_vcs_proposed_identity"
  ON "atelier_vendor_cost_splits" ("invoice_id", "project_key", "bucket_type", (coalesce("bucket_ref", '')))
  WHERE "status" = 'proposed';

-- RLS: same deny-all-by-default org isolation as every other Atelier table
-- (mirrors the org_tables loop in lib/db/src/atelier-rls.sql).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'atelier_vendor_project_map','atelier_vendor_alloc_rules','atelier_vendor_cost_splits'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_org_isolation ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_org_isolation ON %I USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org())',
      t, t
    );
  END LOOP;
END $$;
