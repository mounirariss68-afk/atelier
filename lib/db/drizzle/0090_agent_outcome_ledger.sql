-- Immutable, tenant-scoped CRM agent outcome evidence.
-- Kept content-free: only attribution, linkage quality, and aggregate measures.

CREATE TABLE IF NOT EXISTS atelier_agent_run_snapshots (
  run_id text PRIMARY KEY,
  org_id text NOT NULL DEFAULT 'aico',
  agent_id text NOT NULL,
  agent_version text NOT NULL,
  registry_version text NOT NULL,
  prompt_version text NOT NULL,
  prompt_hash text,
  model text NOT NULL,
  entry_path text NOT NULL,
  data_quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_snapshot_org
  ON atelier_agent_run_snapshots (org_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_snapshot_agent
  ON atelier_agent_run_snapshots (org_id, agent_id);

CREATE TABLE IF NOT EXISTS atelier_agent_outcome_events (
  id text PRIMARY KEY,
  org_id text NOT NULL DEFAULT 'aico',
  event_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  run_id text NOT NULL,
  agent_id text NOT NULL,
  agent_version text NOT NULL,
  registry_version text NOT NULL,
  prompt_version text NOT NULL,
  prompt_hash text,
  model text NOT NULL,
  actor_user_id text,
  origin_entity_type text NOT NULL,
  origin_entity_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  entry_path text NOT NULL,
  outcome_kind text NOT NULL,
  outcome_status text NOT NULL,
  prior_state text,
  current_state text,
  edit_distance double precision,
  rework_count integer,
  source_accepted_count integer,
  source_rejected_count integer,
  predicted_value double precision,
  actual_value double precision,
  supersedes_event_id text,
  missing_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_quality_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_outcome_org_event_key
  ON atelier_agent_outcome_events (org_id, event_key);
CREATE INDEX IF NOT EXISTS idx_agent_outcome_org_time
  ON atelier_agent_outcome_events (org_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_agent_outcome_org_agent
  ON atelier_agent_outcome_events (org_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_outcome_org_entity
  ON atelier_agent_outcome_events (org_id, entity_type, entity_id);

ALTER TABLE atelier_agent_run_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_agent_run_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_agent_run_snapshots_org_isolation
  ON atelier_agent_run_snapshots;
CREATE POLICY atelier_agent_run_snapshots_org_isolation
  ON atelier_agent_run_snapshots
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

ALTER TABLE atelier_agent_outcome_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_agent_outcome_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_agent_outcome_events_org_isolation
  ON atelier_agent_outcome_events;
CREATE POLICY atelier_agent_outcome_events_org_isolation
  ON atelier_agent_outcome_events
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

CREATE OR REPLACE FUNCTION reject_agent_outcome_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'agent outcome evidence is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_run_snapshots_immutable
  ON atelier_agent_run_snapshots;
CREATE TRIGGER trg_agent_run_snapshots_immutable
  BEFORE UPDATE OR DELETE ON atelier_agent_run_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_agent_outcome_mutation();

DROP TRIGGER IF EXISTS trg_agent_outcome_events_immutable
  ON atelier_agent_outcome_events;
CREATE TRIGGER trg_agent_outcome_events_immutable
  BEFORE UPDATE OR DELETE ON atelier_agent_outcome_events
  FOR EACH ROW EXECUTE FUNCTION reject_agent_outcome_mutation();