-- Task #243 — persist firm-wide admin settings + compliance posture so the
-- /admin/compliance toggles survive server restarts. Idempotent so reruns
-- are safe across environments.
CREATE TABLE IF NOT EXISTS "atelier_admin_settings" (
  "org_id" text PRIMARY KEY,
  "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
