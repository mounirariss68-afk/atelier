CREATE TABLE IF NOT EXISTS atelier_assistant_privacy_run_items (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  org_id text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  policy_version text NOT NULL,
  disposition text NOT NULL,
  source_digest text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_privacy_run_item_source
  ON atelier_assistant_privacy_run_items (run_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_assistant_privacy_run_items_org
  ON atelier_assistant_privacy_run_items (org_id, occurred_at);

CREATE TABLE IF NOT EXISTS atelier_assistant_blob_purge_queue (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  attachment_id text NOT NULL,
  encrypted_ref text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_blob_purge_attachment
  ON atelier_assistant_blob_purge_queue (attachment_id);
CREATE INDEX IF NOT EXISTS idx_assistant_blob_purge_pending
  ON atelier_assistant_blob_purge_queue (state, queued_at);
CREATE INDEX IF NOT EXISTS idx_assistant_blob_purge_org
  ON atelier_assistant_blob_purge_queue (org_id, queued_at);

ALTER TABLE atelier_assistant_privacy_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_privacy_run_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_privacy_run_items_isolation
  ON atelier_assistant_privacy_run_items;
CREATE POLICY atelier_assistant_privacy_run_items_isolation
  ON atelier_assistant_privacy_run_items
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

ALTER TABLE atelier_assistant_blob_purge_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_blob_purge_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_blob_purge_queue_isolation
  ON atelier_assistant_blob_purge_queue;
CREATE POLICY atelier_assistant_blob_purge_queue_isolation
  ON atelier_assistant_blob_purge_queue
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

CREATE OR REPLACE FUNCTION atelier_assistant_privacy_org_ids()
RETURNS TABLE(org_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT tenant.org_id
  FROM (
    SELECT org_id FROM atelier_cli_sessions
    UNION
    SELECT org_id FROM atelier_cli_turns
    UNION
    SELECT org_id FROM atelier_cli_attachments
    UNION
    SELECT org_id FROM atelier_assistant_actions
    UNION
    SELECT org_id FROM atelier_assistant_events
    UNION
    SELECT org_id FROM atelier_work_items
    UNION
    SELECT org_id FROM atelier_assistant_blob_purge_queue
  ) AS tenant
  WHERE tenant.org_id IS NOT NULL AND tenant.org_id <> ''
$$;
REVOKE ALL ON FUNCTION atelier_assistant_privacy_org_ids() FROM PUBLIC;
DO $grant$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION atelier_assistant_privacy_org_ids() TO %I',
    current_user
  );
END
$grant$;

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'atelier_retention_executor'
  ) THEN
    CREATE ROLE atelier_retention_executor NOLOGIN NOBYPASSRLS;
  END IF;
  EXECUTE format(
    'GRANT atelier_retention_executor TO %I',
    current_user
  );
END
$role$;

GRANT USAGE ON SCHEMA public TO atelier_retention_executor;
GRANT SELECT, UPDATE ON
  atelier_cli_sessions,
  atelier_cli_turns,
  atelier_cli_session_facts,
  atelier_cli_jobs,
  atelier_cli_attachments,
  atelier_extracted_documents,
  atelier_assistant_actions,
  atelier_assistant_events,
  atelier_assistant_outbox,
  atelier_assistant_budget_events,
  atelier_work_items,
  atelier_work_plans,
  atelier_work_steps,
  atelier_work_attempts,
  atelier_work_checkpoints
TO atelier_retention_executor;
GRANT SELECT ON atelier_assistant_retention_holds
TO atelier_retention_executor;
GRANT SELECT ON atelier_assistant_budget_ledgers
TO atelier_retention_executor;
GRANT SELECT, INSERT, UPDATE ON
  atelier_assistant_privacy_runs,
  atelier_assistant_privacy_run_items,
  atelier_assistant_blob_purge_queue
TO atelier_retention_executor;

DROP POLICY IF EXISTS atelier_retention_executor_holds
  ON atelier_assistant_retention_holds;
CREATE POLICY atelier_retention_executor_holds
  ON atelier_assistant_retention_holds
  FOR SELECT
  USING (
    current_user = 'atelier_retention_executor'
    AND org_id = atelier_current_org()
  );

DROP POLICY IF EXISTS atelier_retention_executor_actions
  ON atelier_assistant_actions;
CREATE POLICY atelier_retention_executor_actions
  ON atelier_assistant_actions
  FOR ALL
  USING (
    current_user = 'atelier_retention_executor'
    AND org_id = atelier_current_org()
  )
  WITH CHECK (
    current_user = 'atelier_retention_executor'
    AND org_id = atelier_current_org()
  );

DROP POLICY IF EXISTS atelier_retention_executor_events
  ON atelier_assistant_events;
CREATE POLICY atelier_retention_executor_events
  ON atelier_assistant_events
  FOR ALL
  USING (
    current_user = 'atelier_retention_executor'
    AND org_id = atelier_current_org()
  )
  WITH CHECK (
    current_user = 'atelier_retention_executor'
    AND org_id = atelier_current_org()
  );

DROP POLICY IF EXISTS atelier_retention_executor_outbox
  ON atelier_assistant_outbox;
CREATE POLICY atelier_retention_executor_outbox
  ON atelier_assistant_outbox
  FOR ALL
  USING (
    current_user = 'atelier_retention_executor'
    AND EXISTS (
      SELECT 1
      FROM atelier_assistant_actions action
      WHERE action.id = action_id
        AND action.org_id = atelier_current_org()
    )
  )
  WITH CHECK (
    current_user = 'atelier_retention_executor'
    AND EXISTS (
      SELECT 1
      FROM atelier_assistant_actions action
      WHERE action.id = action_id
        AND action.org_id = atelier_current_org()
    )
  );