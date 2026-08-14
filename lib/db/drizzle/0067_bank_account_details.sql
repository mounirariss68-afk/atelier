-- Task #1065 — bank accounts on legal entities (bank-letter parsing).
--
-- Extends atelier_bank_account with the two identifying fields a bank
-- letter carries beyond the IBAN: the SWIFT/BIC code and the account
-- holder's legal name. Idempotent so it is safe on databases that already
-- received the columns via drizzle push.
ALTER TABLE "atelier_bank_account" ADD COLUMN IF NOT EXISTS "swift" text;
ALTER TABLE "atelier_bank_account" ADD COLUMN IF NOT EXISTS "account_holder_name" text;
