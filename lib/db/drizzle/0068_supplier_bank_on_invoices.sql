-- Tasks #1075 / #1144 / #1145 — record the supplier's bank details directly
-- on the partner-firm invoice so that finance can prefill them from prior
-- invoices and the payment-run export can include them without a separate
-- lookup. Idempotent: safe to run against databases that already received
-- the columns via drizzle push.
ALTER TABLE "atelier_partner_firm_invoices" ADD COLUMN IF NOT EXISTS "supplier_bank_iban" text;
ALTER TABLE "atelier_partner_firm_invoices" ADD COLUMN IF NOT EXISTS "supplier_bank_holder" text;
