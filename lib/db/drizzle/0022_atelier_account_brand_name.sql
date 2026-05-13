-- Task #270: Add nullable brand_name to atelier_accounts so the CRM
-- workspace can show a friendlier display label without losing the
-- legal name. Idempotent so re-running on partially migrated DBs is safe.
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "brand_name" text;
