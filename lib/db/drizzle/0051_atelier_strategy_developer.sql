-- ----------------------------------------------------------------
-- Account Strategy Developer agent + partner guidance.
--
-- 1) atelier_accounts.strategy_guidance — free-text partner guidance
--    steering the account strategy (kept OUTSIDE the account_strategy
--    jsonb so guidance survives when the strategy is cleared).
--
-- 2) atelier_strategy_exemplars — one row per account holding the
--    serialized + embedded account strategy so Strategy Developer
--    drafts on OTHER accounts retrieve org-scoped exemplars of how
--    partners actually write strategy. Refreshed on strategy edits
--    and agent-draft approvals; deleted when the strategy is cleared.
-- ----------------------------------------------------------------

ALTER TABLE "atelier_accounts"
  ADD COLUMN IF NOT EXISTS "strategy_guidance" text;

CREATE TABLE IF NOT EXISTS "atelier_strategy_exemplars" (
  "account_id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "account_name" text NOT NULL,
  "sector" text,
  "text" text NOT NULL,
  "provider" text NOT NULL,
  "dim" integer NOT NULL,
  "vec" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_atelier_strategy_exemplar_org"
  ON "atelier_strategy_exemplars" ("org_id");
