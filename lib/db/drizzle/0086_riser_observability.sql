CREATE TABLE IF NOT EXISTS atelier_assistant_observations (
  id text PRIMARY KEY,
  version text NOT NULL,
  org_id text NOT NULL,
  stage text NOT NULL,
  outcome text NOT NULL,
  security_event boolean NOT NULL DEFAULT false,
  sampling_mode text NOT NULL DEFAULT 'always',
  sample_rate_basis_points integer NOT NULL DEFAULT 10000,
  conversation_id text,
  turn_id text,
  intent_id text,
  action_id text,
  work_item_id text,
  step_id text,
  attempt_id text,
  capability_id text,
  catalog_version text,
  schema_version text,
  policy_version text,
  model_version text,
  deployment_version text,
  reason_code text,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_assistant_observation_correlation CHECK (
    conversation_id IS NOT NULL OR turn_id IS NOT NULL OR action_id IS NOT NULL
    OR work_item_id IS NOT NULL OR attempt_id IS NOT NULL
  ),
  CONSTRAINT chk_assistant_observation_sampling CHECK (
    sampling_mode IN ('always','deterministic')
    AND sample_rate_basis_points BETWEEN 0 AND 10000
    AND (
      NOT security_event
      OR (sampling_mode = 'always' AND sample_rate_basis_points = 10000)
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_assistant_observations_org_time
  ON atelier_assistant_observations (org_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_assistant_observations_turn
  ON atelier_assistant_observations (org_id, turn_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_assistant_observations_action
  ON atelier_assistant_observations (org_id, action_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_assistant_observations_work
  ON atelier_assistant_observations (org_id, work_item_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_assistant_observations_stage
  ON atelier_assistant_observations (org_id, stage, occurred_at);

ALTER TABLE atelier_assistant_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_observations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_observations_isolation
  ON atelier_assistant_observations;
CREATE POLICY atelier_assistant_observations_isolation
  ON atelier_assistant_observations
  USING (org_id = atelier_current_org())
  WITH CHECK (org_id = atelier_current_org());

GRANT SELECT, INSERT, DELETE ON atelier_assistant_observations
  TO atelier_retention_executor;