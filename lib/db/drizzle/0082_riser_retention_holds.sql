CREATE TABLE IF NOT EXISTS atelier_assistant_retention_holds (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  reason text NOT NULL,
  created_by_user_id text NOT NULL,
  expires_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_retention_hold_resource
  ON atelier_assistant_retention_holds (org_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_assistant_retention_hold_lookup
  ON atelier_assistant_retention_holds (org_id, resource_type, resource_id, expires_at);

ALTER TABLE atelier_assistant_retention_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_retention_holds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_retention_holds_isolation
  ON atelier_assistant_retention_holds;
CREATE POLICY atelier_assistant_retention_holds_isolation
  ON atelier_assistant_retention_holds
  USING (
    org_id = current_setting('app.org_id', true)
    AND created_by_user_id = current_setting('app.user_id', true)
  )
  WITH CHECK (
    org_id = current_setting('app.org_id', true)
    AND created_by_user_id = current_setting('app.user_id', true)
  );