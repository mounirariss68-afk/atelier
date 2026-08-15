-- Task #1174 — partner delivery view + shared-document space.
-- Two new tables:
--   atelier_partner_engagement_grants  — mirrors atelier_partner_opp_grants
--   atelier_partner_shared_documents   — firm-scoped shared / uploaded files
-- Idempotent: safe to run against databases that already received the tables
-- via drizzle push and safe to re-run as a no-op.

-- 1. ENGAGEMENT DELIVERY GRANTS -----------------------------------------
CREATE TABLE IF NOT EXISTS "atelier_partner_engagement_grants" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "partner_firm_id" text NOT NULL,
  "engagement_id" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text NOT NULL,
  "revoked_at" timestamp,
  "revoked_by_user_id" text
);
CREATE INDEX IF NOT EXISTS "idx_atelier_partner_eng_grants_org" ON "atelier_partner_engagement_grants" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_partner_eng_grants_firm" ON "atelier_partner_engagement_grants" ("partner_firm_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_partner_eng_grants_eng" ON "atelier_partner_engagement_grants" ("engagement_id");

-- 2. SHARED-DOCUMENT SPACE ----------------------------------------------
CREATE TABLE IF NOT EXISTS "atelier_partner_shared_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "partner_firm_id" text NOT NULL,
  "direction" text NOT NULL,
  "title" text NOT NULL,
  "file_name" text NOT NULL,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text,
  "blob_ref" text NOT NULL,
  "source_document_id" text,
  "source_version_id" text,
  "note" text,
  "status" text NOT NULL,
  "shared_by_user_id" text,
  "shared_by_label" text,
  "reviewed_by_user_id" text,
  "reviewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp,
  "revoked_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_shared_docs_org" ON "atelier_partner_shared_documents" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_shared_docs_firm" ON "atelier_partner_shared_documents" ("partner_firm_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_shared_docs_status" ON "atelier_partner_shared_documents" ("status");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_shared_docs_dir" ON "atelier_partner_shared_documents" ("direction");

-- RLS: same deny-all-by-default org isolation as every other Atelier table
-- (mirrors the org_tables loop in lib/db/src/atelier-rls.sql).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'atelier_partner_engagement_grants','atelier_partner_shared_documents'
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
