-- Durable background-job registry: replaces the per-feature in-memory
-- "launch maps" (POV drafts, receipt parsing, pricing research, alliance
-- evaluation, merchant enrichment) so async agent status survives server
-- restarts, powers the global web indicator (GET /me/background-jobs),
-- and drops a self-notification card on terminal status.
CREATE TABLE IF NOT EXISTS "atelier_background_jobs" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "started_by_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "lock_key" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "label" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "error" text,
  "result_href" text,
  "result" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_bgjobs_user" ON "atelier_background_jobs" ("started_by_user_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_bgjobs_target" ON "atelier_background_jobs" ("kind", "target_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_bgjobs_status" ON "atelier_background_jobs" ("status");
-- Atomic duplicate-start guard: at most ONE running job per
-- (org, lock_key, target). lock_key defaults to the kind; kinds that must
-- be mutually exclusive on one target share a lock_key (pov_draft +
-- pov_revise → 'pov'). The loser's insert conflicts and the route answers
-- "already running".
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_bgjobs_running"
  ON "atelier_background_jobs" ("org_id", "lock_key", "target_id")
  WHERE status = 'running';

-- Org-isolation RLS, matching the shared policy in atelier-rls.sql (kept
-- here too so a migrated-but-not-re-RLS'd database is still covered).
ALTER TABLE "atelier_background_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "atelier_background_jobs" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF to_regproc('atelier_current_org') IS NOT NULL THEN
    DROP POLICY IF EXISTS atelier_background_jobs_org_isolation ON "atelier_background_jobs";
    CREATE POLICY atelier_background_jobs_org_isolation ON "atelier_background_jobs"
      USING (org_id = atelier_current_org())
      WITH CHECK (org_id = atelier_current_org());
  END IF;
END $$;
