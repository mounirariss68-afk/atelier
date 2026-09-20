-- Finance MVP: human-reviewed bank matches and explicit payment instructions.
ALTER TABLE "atelier_bank_transaction"
  ADD COLUMN IF NOT EXISTS "match_evidence" jsonb,
  ADD COLUMN IF NOT EXISTS "matched_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "matched_at" timestamp,
  ADD COLUMN IF NOT EXISTS "match_approved_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "match_approved_at" timestamp;

ALTER TABLE "atelier_payment_runs"
  ADD COLUMN IF NOT EXISTS "instruction_reference" text,
  ADD COLUMN IF NOT EXISTS "sent_at" timestamp,
  ADD COLUMN IF NOT EXISTS "sent_by_user_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_payment_instruction_reference"
  ON "atelier_payment_runs" ("org_id", "instruction_reference")
  WHERE "instruction_reference" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_atelier_bank_txn_match_ref"
  ON "atelier_bank_transaction" ("org_id", "matched_ref_kind", "matched_ref_id");