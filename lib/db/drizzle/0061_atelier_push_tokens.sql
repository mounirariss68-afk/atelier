-- Task #1010 — per-user device push tokens for reminder alerts.
-- One row per Expo push token (globally unique → primary key). Rows are
-- owned by exactly one atelier_users.id; registration/removal is strictly
-- self-scope (/me/push-tokens) and re-registering a token re-owns it.
-- Dead tokens (Expo DeviceNotRegistered) are pruned by the push sender.
CREATE TABLE IF NOT EXISTS "atelier_push_tokens" (
  "token" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "user_id" text NOT NULL,
  "platform" text NOT NULL DEFAULT 'unknown',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_atelier_pushtok_user" ON "atelier_push_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pushtok_org" ON "atelier_push_tokens" ("org_id");

-- Org-isolation RLS, matching the shared policy in atelier-rls.sql (kept
-- here too so a migrated-but-not-re-RLS'd database is still covered).
-- The policy predicate needs atelier_current_org(); guard on its presence
-- so this file also applies cleanly to a bare database where the RLS
-- bootstrap (atelier-rls.sql) hasn't run yet — that bootstrap re-creates
-- the same policy when it does run.
ALTER TABLE "atelier_push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "atelier_push_tokens" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF to_regproc('atelier_current_org') IS NOT NULL THEN
    DROP POLICY IF EXISTS atelier_push_tokens_org_isolation ON "atelier_push_tokens";
    CREATE POLICY atelier_push_tokens_org_isolation ON "atelier_push_tokens"
      USING (org_id = atelier_current_org())
      WITH CHECK (org_id = atelier_current_org());
  END IF;
END $$;
