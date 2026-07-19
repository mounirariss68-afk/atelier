-- Finance Comply registers — generic persistence for the five finance
-- compliance registers (internal controls, SoD conflicts, statutory
-- filings, transfer-pricing rows, insurance policies). `register`
-- discriminates; the register-specific payload lives in `data`.
-- Named distinctly from the pre-existing roster/visa table
-- "atelier_compliance_records". Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS "atelier_finance_compliance_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "register" text NOT NULL,
  "data" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_atelier_fin_comp_org" ON "atelier_finance_compliance_entries" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_fin_comp_register" ON "atelier_finance_compliance_entries" ("register");
