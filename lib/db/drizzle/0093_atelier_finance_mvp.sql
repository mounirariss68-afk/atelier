CREATE TABLE IF NOT EXISTS "atelier_shareholder_funding" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "entity_id" text NOT NULL,
  "entry_type" text NOT NULL DEFAULT 'contribution',
  "contribution_id" text NOT NULL,
  "contribution_type" text NOT NULL,
  "contributor_name" text NOT NULL,
  "contributor_user_id" text,
  "amount" double precision NOT NULL,
  "currency" text NOT NULL,
  "transaction_date" text NOT NULL,
  "period_label" text NOT NULL,
  "source_document_id" text,
  "bank_transaction_id" text,
  "bank_matched_at" timestamp,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_funding_org_entity" ON "atelier_shareholder_funding" ("org_id","entity_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_funding_contribution" ON "atelier_shareholder_funding" ("org_id","contribution_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_funding_date" ON "atelier_shareholder_funding" ("org_id","transaction_date");
CREATE INDEX IF NOT EXISTS "idx_atelier_funding_bank" ON "atelier_shareholder_funding" ("org_id","bank_transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_funding_idempotency" ON "atelier_shareholder_funding" ("org_id","idempotency_key");
ALTER TABLE "atelier_legal_entities"
  DROP CONSTRAINT IF EXISTS "atelier_legal_entities_status_check";
ALTER TABLE "atelier_legal_entities"
  ADD CONSTRAINT "atelier_legal_entities_status_check"
  CHECK ("status" IN ('planned','in_formation','active','dormant','winding_down','archived'));