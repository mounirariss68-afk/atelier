-- Task #1199 — GL "Needs attention" tab: entity-allocation lifecycle columns
-- for the three untagged kinds newly covered by the propose/decide engine
-- (client invoices, contractor payments, bank transactions).
--
-- Unlike expenses/pfis, the proposed entity for these kinds lives in
-- alloc_proposed_entity_id; legal_entity_id stays NULL until a human decides
-- (the Bookkeeper posts these kinds whenever legal_entity_id is set, so
-- writing it at propose time would auto-post an unapproved proposal).
--
-- Idempotent: safe against databases that already received the columns via
-- drizzle push, and safe to re-run as a no-op.

ALTER TABLE "atelier_invoice"
  ADD COLUMN IF NOT EXISTS "alloc_status" text,
  ADD COLUMN IF NOT EXISTS "alloc_proposed_entity_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_rule_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_justification" text,
  ADD COLUMN IF NOT EXISTS "alloc_confidence" double precision,
  ADD COLUMN IF NOT EXISTS "alloc_decided_by" text,
  ADD COLUMN IF NOT EXISTS "alloc_shared" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "alloc_approved_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "alloc_override_reason" text;

ALTER TABLE "atelier_contractor_payments"
  ADD COLUMN IF NOT EXISTS "alloc_status" text,
  ADD COLUMN IF NOT EXISTS "alloc_proposed_entity_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_rule_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_justification" text,
  ADD COLUMN IF NOT EXISTS "alloc_confidence" double precision,
  ADD COLUMN IF NOT EXISTS "alloc_decided_by" text,
  ADD COLUMN IF NOT EXISTS "alloc_shared" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "alloc_approved_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "alloc_override_reason" text;

ALTER TABLE "atelier_bank_transaction"
  ADD COLUMN IF NOT EXISTS "alloc_status" text,
  ADD COLUMN IF NOT EXISTS "alloc_proposed_entity_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_rule_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_justification" text,
  ADD COLUMN IF NOT EXISTS "alloc_confidence" double precision,
  ADD COLUMN IF NOT EXISTS "alloc_decided_by" text,
  ADD COLUMN IF NOT EXISTS "alloc_shared" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "alloc_approved_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "alloc_approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "alloc_override_reason" text;
