-- Smarter account auto-fill: firmographic enrichment captured on create via the
-- Account Cartographer chat "Review & Create" flow. All columns nullable (or
-- defaulted) so existing rows keep validating with no backfill. Idempotent so
-- re-running on a partially migrated DB is safe.
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "employee_count" integer;
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "annual_revenue" jsonb;
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "holding_structure" jsonb;
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "country_presence" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "entity_role" text;
