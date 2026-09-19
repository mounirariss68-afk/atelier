-- C19 expands legacy CLI turn persistence for deterministic, lossless upcasting.
-- Existing columns remain authoritative for rollback/dual-read.
ALTER TABLE atelier_cli_turns
  ADD COLUMN IF NOT EXISTS persisted_schema_version integer,
  ADD COLUMN IF NOT EXISTS canonical_state text,
  ADD COLUMN IF NOT EXISTS original_payload jsonb,
  ADD COLUMN IF NOT EXISTS source_versions jsonb,
  ADD COLUMN IF NOT EXISTS legacy_payload_digest text,
  ADD COLUMN IF NOT EXISTS durable_action_id text,
  ADD COLUMN IF NOT EXISTS quarantine_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS upcasted_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_read_until timestamptz,
  ADD COLUMN IF NOT EXISTS pending_write_retired_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_atelier_cli_turns_upcast
  ON atelier_cli_turns (org_id, persisted_schema_version, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_cli_turns_durable_action
  ON atelier_cli_turns (durable_action_id)
  WHERE durable_action_id IS NOT NULL;

ALTER TABLE atelier_assistant_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_actions_org_isolation ON atelier_assistant_actions;
DROP POLICY IF EXISTS atelier_assistant_actions_requester_isolation ON atelier_assistant_actions;
CREATE POLICY atelier_assistant_actions_requester_isolation ON atelier_assistant_actions
  USING (org_id = atelier_current_org()
    AND requester_id = current_setting('app.user_id', true))
  WITH CHECK (org_id = atelier_current_org()
    AND requester_id = current_setting('app.user_id', true));

ALTER TABLE atelier_assistant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_events_org_isolation ON atelier_assistant_events;
DROP POLICY IF EXISTS atelier_assistant_events_requester_isolation ON atelier_assistant_events;
CREATE POLICY atelier_assistant_events_requester_isolation ON atelier_assistant_events
  USING (org_id = atelier_current_org()
    AND requester_id = current_setting('app.user_id', true))
  WITH CHECK (org_id = atelier_current_org()
    AND requester_id = current_setting('app.user_id', true));

ALTER TABLE atelier_assistant_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_outbox_org_isolation ON atelier_assistant_outbox;
DROP POLICY IF EXISTS atelier_assistant_outbox_requester_isolation ON atelier_assistant_outbox;
CREATE POLICY atelier_assistant_outbox_requester_isolation ON atelier_assistant_outbox
  USING (EXISTS (
    SELECT 1 FROM atelier_assistant_actions action
    WHERE action.id = action_id
      AND action.org_id = atelier_current_org()
      AND action.requester_id = current_setting('app.user_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM atelier_assistant_actions action
    WHERE action.id = action_id
      AND action.org_id = atelier_current_org()
      AND action.requester_id = current_setting('app.user_id', true)
  ));