-- ============================================================
-- Task #569 — Partner & AM insights feed + account team.
--
-- Two new stores on the account surface, distinct from AI research
-- (atelier_accounts JSONB) and the immutable audit trail
-- (atelier_audit_events):
--   1. atelier_account_insights — a multi-author, attributed,
--      timestamped human insight feed. Optional category is free
--      text at the DB layer; the API/UI constrain it to
--      relationship | risk | competitive | opportunity | general.
--      Edit/delete is author-scoped in route logic; soft-deleted
--      via deleted_at.
--   2. atelier_account_team_members — owner + additional members
--      with a role_on_account (account_manager | delivery_lead |
--      partner | contributor, free text at DB layer). The account
--      owner (atelier_accounts.partner_owner_id) is always surfaced
--      by the API even without an explicit row here.
--
-- RLS: org-only isolation, matching the pattern used across the
-- Atelier surface (see 0034). Per-account visibility and the
-- partner-tier write gate are enforced in the route layer
-- (canSeeAccount + role checks in accountRoutes.ts).
-- ============================================================

-- ---------- 1. Tables ----------

CREATE TABLE IF NOT EXISTS "atelier_account_insights" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "account_id" text NOT NULL,
  "author_id" text NOT NULL,
  "body" text NOT NULL,
  "category" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);

CREATE TABLE IF NOT EXISTS "atelier_account_team_members" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "account_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role_on_account" text DEFAULT 'contributor' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);

-- ---------- 2. Indexes ----------

CREATE INDEX IF NOT EXISTS "idx_atelier_account_insights_org" ON "atelier_account_insights" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_account_insights_account" ON "atelier_account_insights" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_account_insights_author" ON "atelier_account_insights" ("author_id");

CREATE INDEX IF NOT EXISTS "idx_atelier_account_team_org" ON "atelier_account_team_members" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_account_team_account" ON "atelier_account_team_members" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_account_team_user" ON "atelier_account_team_members" ("user_id");

-- ---------- 3. RLS policies (org-only, matching 0034) ----------

ALTER TABLE atelier_account_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_account_insights FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_account_insights_rw ON atelier_account_insights;
CREATE POLICY atelier_account_insights_rw ON atelier_account_insights
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_account_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_account_team_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_account_team_members_rw ON atelier_account_team_members;
CREATE POLICY atelier_account_team_members_rw ON atelier_account_team_members
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));
