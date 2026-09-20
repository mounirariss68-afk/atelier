CREATE TABLE IF NOT EXISTS atelier_assistant_rollouts (
  id text PRIMARY KEY,
  org_id text,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'expand',
  dimensions jsonb NOT NULL,
  versions jsonb NOT NULL,
  exit_criteria jsonb NOT NULL,
  measurements jsonb NOT NULL DEFAULT '{}'::jsonb,
  alarm_thresholds jsonb NOT NULL,
  rollback_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  control_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  rollback_lineage jsonb NOT NULL DEFAULT '{"executingActionIds":[],"outboxIds":[],"blockedAttemptIds":[]}'::jsonb,
  worker_fence integer NOT NULL DEFAULT 0,
  audit_continuity_verified boolean NOT NULL DEFAULT false,
  halted_reason text,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_assistant_rollout_status CHECK (
    status IN (
      'expand','shadow','backfill_verify','cohort_canary','cutover',
      'compatibility_retention','cleanup','rollback','halted','rolled_back'
    )
  )
);

CREATE TABLE IF NOT EXISTS atelier_assistant_provider_results (
  provider_result_id text PRIMARY KEY,
  action_id text NOT NULL UNIQUE REFERENCES atelier_assistant_actions(id) ON DELETE RESTRICT,
  org_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','failed')),
  reconciled_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_provider_results_org
  ON atelier_assistant_provider_results (org_id, created_at);

ALTER TABLE atelier_assistant_provider_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_provider_results FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_provider_results_org_isolation
  ON atelier_assistant_provider_results;
CREATE POLICY atelier_assistant_provider_results_org_isolation
  ON atelier_assistant_provider_results
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

CREATE INDEX IF NOT EXISTS idx_assistant_rollouts_status
  ON atelier_assistant_rollouts (org_id, status);

ALTER TABLE atelier_assistant_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_rollouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_rollouts_org_isolation
  ON atelier_assistant_rollouts;
CREATE POLICY atelier_assistant_rollouts_org_isolation
  ON atelier_assistant_rollouts
  USING (
    org_id IS NULL
    OR org_id = current_setting('app.org_id', true)
  )
  WITH CHECK (
    org_id IS NULL
    OR org_id = current_setting('app.org_id', true)
  );

CREATE TABLE IF NOT EXISTS atelier_assistant_rollout_events (
  id text PRIMARY KEY,
  rollout_id text NOT NULL REFERENCES atelier_assistant_rollouts(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  type text NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_assistant_rollout_event_sequence UNIQUE (rollout_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_assistant_rollout_events
  ON atelier_assistant_rollout_events (rollout_id, created_at);

ALTER TABLE atelier_assistant_rollout_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_rollout_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_rollout_events_org_isolation
  ON atelier_assistant_rollout_events;
CREATE POLICY atelier_assistant_rollout_events_org_isolation
  ON atelier_assistant_rollout_events
  USING (
    EXISTS (
      SELECT 1 FROM atelier_assistant_rollouts r
      WHERE r.id = rollout_id
        AND (r.org_id IS NULL OR r.org_id = current_setting('app.org_id', true))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM atelier_assistant_rollouts r
      WHERE r.id = rollout_id
        AND (r.org_id IS NULL OR r.org_id = current_setting('app.org_id', true))
    )
  );