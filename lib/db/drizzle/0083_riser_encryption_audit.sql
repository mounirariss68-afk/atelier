ALTER TABLE atelier_work_items
  ADD COLUMN IF NOT EXISTS goal_encrypted text;
ALTER TABLE atelier_work_plans
  ADD COLUMN IF NOT EXISTS rationale_encrypted text;

CREATE TABLE IF NOT EXISTS atelier_assistant_key_access_events (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  requester_id text NOT NULL,
  actor_id text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  purpose text NOT NULL,
  key_version text NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_key_access_resource
  ON atelier_assistant_key_access_events (org_id, resource_type, resource_id, accessed_at);
CREATE INDEX IF NOT EXISTS idx_assistant_key_access_requester
  ON atelier_assistant_key_access_events (org_id, requester_id, accessed_at);

ALTER TABLE atelier_assistant_key_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_key_access_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_key_access_events_isolation
  ON atelier_assistant_key_access_events;
CREATE POLICY atelier_assistant_key_access_events_isolation
  ON atelier_assistant_key_access_events
  USING (
    org_id = current_setting('app.org_id', true)
    AND requester_id = current_setting('app.user_id', true)
  )
  WITH CHECK (
    org_id = current_setting('app.org_id', true)
    AND requester_id = current_setting('app.user_id', true)
  );