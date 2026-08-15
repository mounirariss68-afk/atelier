-- Task #1173 — partner portal foundations: multiple logins per firm,
-- in-app notification center, preview-as-partner, session/rate hardening.
-- Idempotent: safe to run against databases that already received the
-- table via drizzle push and safe to re-run as a no-op.

-- 1. MULTI-LOGIN PER FIRM ------------------------------------------------
-- Drop the v1 one-active-login-per-firm partial unique index. Firms may
-- now have multiple concurrent active alliance-partner logins; duplicate
-- emails are still refused at the application layer.
DROP INDEX IF EXISTS "uq_atelier_users_active_partner_firm";

-- 2. PARTNER NOTIFICATION CENTER ----------------------------------------
CREATE TABLE IF NOT EXISTS "atelier_partner_notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "partner_firm_id" text NOT NULL,
  "user_id" text,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "read_at" timestamp,
  "emailed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_pnotif_org" ON "atelier_partner_notifications" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pnotif_firm" ON "atelier_partner_notifications" ("partner_firm_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pnotif_firm_read" ON "atelier_partner_notifications" ("partner_firm_id", "read_at");

-- RLS: same deny-all-by-default org isolation as every other Atelier table
-- (mirrors the org_tables loop in lib/db/src/atelier-rls.sql).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'atelier_partner_notifications'
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
