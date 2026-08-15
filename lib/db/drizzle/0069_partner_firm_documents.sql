-- Task #1172 — partner registration v2: partner-firm document registry and
-- portal contact-change suggestions. Idempotent: safe to run against
-- databases that already received the tables via drizzle push.

CREATE TABLE IF NOT EXISTS "atelier_partner_firm_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "partner_firm_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text,
  "file_name" text NOT NULL,
  "mime" text NOT NULL,
  "file_ref" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text,
  "issued_date" text,
  "expiry_date" text,
  "review_status" text NOT NULL DEFAULT 'pending',
  "review_note" text,
  "reviewed_by_user_id" text,
  "reviewed_by_name" text,
  "reviewed_at" timestamp,
  "uploaded_by_user_id" text,
  "uploaded_via" text NOT NULL,
  "superseded_by_doc_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_docs_org" ON "atelier_partner_firm_documents" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_docs_firm" ON "atelier_partner_firm_documents" ("partner_firm_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_docs_status" ON "atelier_partner_firm_documents" ("review_status");

CREATE TABLE IF NOT EXISTS "atelier_partner_contact_suggestions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "partner_firm_id" text NOT NULL,
  "proposed_contacts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "note" text,
  "status" text NOT NULL DEFAULT 'pending',
  "submitted_by_user_id" text,
  "decided_by_user_id" text,
  "decided_by_name" text,
  "decision_note" text,
  "decided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_contact_sug_org" ON "atelier_partner_contact_suggestions" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_contact_sug_firm" ON "atelier_partner_contact_suggestions" ("partner_firm_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_contact_sug_status" ON "atelier_partner_contact_suggestions" ("status");

-- RLS: same deny-all-by-default org isolation as every other Atelier table
-- (mirrors the org_tables loop in lib/db/src/atelier-rls.sql).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'atelier_partner_firm_documents','atelier_partner_contact_suggestions'
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
