-- Typed per-session chat facts: durable record of user-stated / resolved
-- facts (dates, places, quantities, selections, entities) so later turns
-- and confirmations bind to explicit values.
CREATE TABLE IF NOT EXISTS "atelier_cli_session_facts" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text NOT NULL,
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "display" text NOT NULL,
  "source_turn_id" text,
  "source" text NOT NULL DEFAULT 'tool_result',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_cli_session_facts_session" ON "atelier_cli_session_facts" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_cli_session_facts_org_user" ON "atelier_cli_session_facts" ("org_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_cli_session_facts_key" ON "atelier_cli_session_facts" ("session_id", "key");
