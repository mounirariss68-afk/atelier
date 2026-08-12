-- Task #1017 — per-category device-push opt-outs on the user row.
-- Missing key = enabled (opt-out model); default '{}' means all pushes on.
ALTER TABLE "atelier_users"
  ADD COLUMN IF NOT EXISTS "push_notification_prefs" jsonb NOT NULL DEFAULT '{}'::jsonb;
