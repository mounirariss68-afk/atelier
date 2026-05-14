-- Task #292 — 9-persona model (atelier_v3).
-- Adds bd_active (BD-active flag, partner-tier invariant) and legacy_role
-- (audit shadow of the prior persona before the enum sweep). Both columns
-- are idempotent so the migration can run on dev/staging/prod safely.
ALTER TABLE atelier_users
  ADD COLUMN IF NOT EXISTS bd_active boolean NOT NULL DEFAULT false;

ALTER TABLE atelier_users
  ADD COLUMN IF NOT EXISTS legacy_role text;

-- Index to support filtering BD-active partner-tier rows for the BD funnel.
CREATE INDEX IF NOT EXISTS atelier_users_bd_active_idx
  ON atelier_users (bd_active)
  WHERE bd_active = true;
