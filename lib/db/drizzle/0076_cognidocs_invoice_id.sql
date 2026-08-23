-- Task #1316 — CogniDocs parsing migration.
-- Adds one nullable text column to atelier_partner_firm_invoices:
--   cognidocs_invoice_id — CogniDocs' stable invoice id from the parse job.
--     The same underlying invoice re-uploaded later yields the same id, so
--     it joins sha256 and firm+reference as a third duplicate signal.
--     NULL for manually entered invoices and rows created before the
--     migration; NULLs never match each other in the dedupe check.
-- Idempotent: safe against databases that already received the column via
-- drizzle push, and safe to re-run as a no-op.
ALTER TABLE "atelier_partner_firm_invoices"
  ADD COLUMN IF NOT EXISTS "cognidocs_invoice_id" text;
