-- Durable Riser workflow hardening. This migration is additive and preserves
-- existing lineage; legacy rows remain fail-closed until explicitly replanned.

ALTER TABLE atelier_work_items
  ADD COLUMN IF NOT EXISTS budget_ledger_id text REFERENCES atelier_assistant_budget_ledgers(id),
  ADD COLUMN IF NOT EXISTS aggregate_result jsonb,
  ADD COLUMN IF NOT EXISTS aggregate_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE atelier_work_steps
  ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT 'legacy-fail-closed',
  ADD COLUMN IF NOT EXISTS policy_obligations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tools_data_perimeter jsonb NOT NULL
    DEFAULT '{"toolIds":[],"dataClasses":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS budget_grant jsonb NOT NULL
    DEFAULT '{"maxCostMicros":0,"maxToolCalls":0,"maxProviderCalls":0}'::jsonb,
  ADD COLUMN IF NOT EXISTS checkpoint_spec jsonb,
  ADD COLUMN IF NOT EXISTS parent_step_id text,
  ADD COLUMN IF NOT EXISTS evidence_lineage jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE atelier_work_attempts
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_micros integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tool_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_calls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_reservation_id text
    REFERENCES atelier_assistant_budget_reservations(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'atelier_work_steps_parent_step_id_atelier_work_steps_id_fk'
  ) THEN
    ALTER TABLE atelier_work_steps
      ADD CONSTRAINT atelier_work_steps_parent_step_id_atelier_work_steps_id_fk
      FOREIGN KEY (parent_step_id) REFERENCES atelier_work_steps(id) ON DELETE CASCADE;
  END IF;
  ALTER TABLE atelier_work_items DROP CONSTRAINT IF EXISTS chk_work_item_status;
  ALTER TABLE atelier_work_items ADD CONSTRAINT chk_work_item_status CHECK (
    status IN ('draft','planned','blocked','cancellation_settling','recovery_settling',
      'awaiting_aggregation','succeeded','failed','cancelled',
      'compensation_required','compensated')
  );
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_work_step_status') THEN
    ALTER TABLE atelier_work_steps ADD CONSTRAINT chk_work_step_status CHECK (
      status IN ('blocked','ready','running','succeeded','failed','cancelled',
        'compensation_required','compensated')
    );
  END IF;
  ALTER TABLE atelier_work_attempts DROP CONSTRAINT IF EXISTS chk_work_attempt_status;
  ALTER TABLE atelier_work_attempts ADD CONSTRAINT chk_work_attempt_status CHECK (
    status IN ('queued','running','committing','succeeded','retryable','permanent',
      'ambiguous','blocked','cancelled','compensation_required','compensated')
  );
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_work_checkpoint_decision') THEN
    ALTER TABLE atelier_work_checkpoints ADD CONSTRAINT chk_work_checkpoint_decision
      CHECK (decision IS NULL OR decision IN ('approve','reject'));
  END IF;
END $$;

ALTER TABLE atelier_assistant_budget_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_budget_ledgers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_budget_ledgers_org_isolation
  ON atelier_assistant_budget_ledgers;
CREATE POLICY atelier_assistant_budget_ledgers_org_isolation
  ON atelier_assistant_budget_ledgers
  USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org());

ALTER TABLE atelier_assistant_budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_budget_reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_budget_reservations_org_isolation
  ON atelier_assistant_budget_reservations;
CREATE POLICY atelier_assistant_budget_reservations_org_isolation
  ON atelier_assistant_budget_reservations
  USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org());

ALTER TABLE atelier_assistant_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_controls FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_controls_org_isolation ON atelier_assistant_controls;
CREATE POLICY atelier_assistant_controls_org_isolation ON atelier_assistant_controls
  USING (org_id IS NULL OR org_id = atelier_current_org())
  WITH CHECK (org_id IS NULL OR org_id = atelier_current_org());

ALTER TABLE atelier_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_work_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_work_items_org_isolation ON atelier_work_items;
CREATE POLICY atelier_work_items_org_isolation ON atelier_work_items
  USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org());

ALTER TABLE atelier_work_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_work_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_work_plans_org_isolation ON atelier_work_plans;
CREATE POLICY atelier_work_plans_org_isolation ON atelier_work_plans
  USING (EXISTS (
    SELECT 1 FROM atelier_work_items wi
    WHERE wi.id = work_item_id AND wi.org_id = atelier_current_org()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM atelier_work_items wi
    WHERE wi.id = work_item_id AND wi.org_id = atelier_current_org()
  ));

ALTER TABLE atelier_work_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_work_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_work_steps_org_isolation ON atelier_work_steps;
CREATE POLICY atelier_work_steps_org_isolation ON atelier_work_steps
  USING (EXISTS (
    SELECT 1 FROM atelier_work_items wi
    WHERE wi.id = work_item_id AND wi.org_id = atelier_current_org()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM atelier_work_items wi
    WHERE wi.id = work_item_id AND wi.org_id = atelier_current_org()
  ));

ALTER TABLE atelier_work_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_work_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_work_attempts_org_isolation ON atelier_work_attempts;
CREATE POLICY atelier_work_attempts_org_isolation ON atelier_work_attempts
  USING (EXISTS (
    SELECT 1 FROM atelier_work_steps ws
    JOIN atelier_work_items wi ON wi.id = ws.work_item_id
    WHERE ws.id = step_id AND wi.org_id = atelier_current_org()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM atelier_work_steps ws
    JOIN atelier_work_items wi ON wi.id = ws.work_item_id
    WHERE ws.id = step_id AND wi.org_id = atelier_current_org()
  ));

ALTER TABLE atelier_work_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_work_checkpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_work_checkpoints_org_isolation ON atelier_work_checkpoints;
CREATE POLICY atelier_work_checkpoints_org_isolation ON atelier_work_checkpoints
  USING (EXISTS (
    SELECT 1 FROM atelier_work_items wi
    WHERE wi.id = work_item_id AND wi.org_id = atelier_current_org()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM atelier_work_items wi
    WHERE wi.id = work_item_id AND wi.org_id = atelier_current_org()
  ));