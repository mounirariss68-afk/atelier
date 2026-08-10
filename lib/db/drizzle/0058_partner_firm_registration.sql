-- Task #874 — partner onboarding at signing: firm company-detail fields +
-- firm bank-details maker-checker table. Bank columns on the firm are the
-- APPROVED (payable) values, written only by the finance approve route;
-- partner submissions land in atelier_partner_firm_bank_change_requests.
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "legal_name" text;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "registration_number" text;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "tax_id" text;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "registered_address" text;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "registration_completed_at" timestamp;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "registration_completed_by_user_id" text;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "bank_iban" text;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "bank_swift" text;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "bank_name" text;
ALTER TABLE "atelier_partner_firms" ADD COLUMN IF NOT EXISTS "bank_currency" text;

CREATE TABLE IF NOT EXISTS "atelier_partner_firm_bank_change_requests" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "partner_firm_id" text NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "previous_iban_masked" text,
  "new_iban" text NOT NULL,
  "new_swift" text,
  "new_bank_name" text,
  "new_currency" text,
  "reason" text,
  "status" text NOT NULL DEFAULT 'pending',
  "decided_by_user_id" text,
  "decided_by_name" text,
  "decided_at" timestamp,
  "decision_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
-- One ACTIVE alliance-partner login per firm (v1); routes map 23505 → 409.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_users_active_partner_firm"
  ON "atelier_users" ("org_id", "partner_firm_id")
  WHERE "partner_firm_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_atelier_pf_bankreq_org" ON "atelier_partner_firm_bank_change_requests" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_bankreq_firm" ON "atelier_partner_firm_bank_change_requests" ("partner_firm_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pf_bankreq_status" ON "atelier_partner_firm_bank_change_requests" ("status");
