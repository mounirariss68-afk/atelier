-- Task #560 — structured research brief from the Account Cartographer.
-- Display-only blob persisted alongside the typed firmographic fields;
-- nullable so existing rows need no backfill.
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "research_brief" jsonb;
