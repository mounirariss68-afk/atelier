ALTER TABLE atelier_cli_turns
  ADD COLUMN IF NOT EXISTS redaction_version text
  NOT NULL DEFAULT 'assistant-privacy/v1';

CREATE TABLE IF NOT EXISTS atelier_assistant_privacy_runs (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  kind text NOT NULL,
  policy_version text NOT NULL,
  rows_affected integer NOT NULL,
  created_by text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_privacy_runs_org
  ON atelier_assistant_privacy_runs (org_id, occurred_at);

ALTER TABLE atelier_assistant_privacy_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_privacy_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_privacy_runs_isolation
  ON atelier_assistant_privacy_runs;
CREATE POLICY atelier_assistant_privacy_runs_isolation
  ON atelier_assistant_privacy_runs
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));