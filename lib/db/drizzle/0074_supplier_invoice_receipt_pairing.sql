-- Task #1250 — invoice ↔ payment-receipt pairing at chat ingest.
-- Adds two nullable jsonb columns to atelier_partner_firm_invoices:
--   line_items       — printed invoice line rows parsed at ingest time
--   payment_receipt  — proof-of-payment receipt metadata (file name, sha256,
--                      blob ref, attached-by/at, match basis) for invoices
--                      recorded already-paid so they never enter a payment run
-- Idempotent: safe against databases that already received the columns via
-- drizzle push, and safe to re-run as a no-op.

ALTER TABLE "atelier_partner_firm_invoices"
  ADD COLUMN IF NOT EXISTS "line_items" jsonb;

ALTER TABLE "atelier_partner_firm_invoices"
  ADD COLUMN IF NOT EXISTS "payment_receipt" jsonb;
