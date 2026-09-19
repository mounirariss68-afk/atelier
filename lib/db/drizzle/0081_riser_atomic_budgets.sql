ALTER TABLE atelier_assistant_budget_ledgers
  ADD COLUMN IF NOT EXISTS reserved_wall_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS committed_wall_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_concurrent_slots integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reserved_concurrent_slots integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'atelier_assistant_budget_ledgers_parent_ledger_id_fk'
  ) THEN
    ALTER TABLE atelier_assistant_budget_ledgers
      ADD CONSTRAINT atelier_assistant_budget_ledgers_parent_ledger_id_fk
      FOREIGN KEY (parent_ledger_id)
      REFERENCES atelier_assistant_budget_ledgers(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_assistant_budget_nonnegative'
  ) THEN
    ALTER TABLE atelier_assistant_budget_ledgers
      ADD CONSTRAINT chk_assistant_budget_nonnegative CHECK (
        max_cost_micros >= 0 AND reserved_cost_micros >= 0 AND committed_cost_micros >= 0
        AND max_provider_calls >= 0 AND reserved_provider_calls >= 0
        AND committed_provider_calls >= 0
        AND max_tool_calls >= 0 AND reserved_tool_calls >= 0 AND committed_tool_calls >= 0
        AND max_wall_ms >= 0 AND reserved_wall_ms >= 0 AND committed_wall_ms >= 0
        AND max_concurrent_slots >= 0 AND reserved_concurrent_slots >= 0
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION atelier_validate_budget_hierarchy()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_row atelier_assistant_budget_ledgers%ROWTYPE;
BEGIN
  IF NEW.parent_ledger_id IS NOT NULL THEN
    SELECT * INTO parent_row
    FROM atelier_assistant_budget_ledgers
    WHERE id = NEW.parent_ledger_id
    FOR SHARE;
    IF parent_row.id IS NULL OR parent_row.org_id <> NEW.org_id
      OR NEW.max_cost_micros > parent_row.max_cost_micros
      OR NEW.max_provider_calls > parent_row.max_provider_calls
      OR NEW.max_tool_calls > parent_row.max_tool_calls
      OR NEW.max_wall_ms > parent_row.max_wall_ms
      OR NEW.max_concurrent_slots > parent_row.max_concurrent_slots THEN
      RAISE EXCEPTION 'budget-child-exceeds-parent';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM atelier_assistant_budget_ledgers child
    WHERE child.parent_ledger_id = NEW.id
      AND (
        child.org_id <> NEW.org_id
        OR child.max_cost_micros > NEW.max_cost_micros
        OR child.max_provider_calls > NEW.max_provider_calls
        OR child.max_tool_calls > NEW.max_tool_calls
        OR child.max_wall_ms > NEW.max_wall_ms
        OR child.max_concurrent_slots > NEW.max_concurrent_slots
      )
  ) THEN
    RAISE EXCEPTION 'budget-parent-below-child';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_budget_hierarchy
  ON atelier_assistant_budget_ledgers;
CREATE TRIGGER trg_validate_budget_hierarchy
  BEFORE INSERT OR UPDATE OF parent_ledger_id, org_id, max_cost_micros,
    max_provider_calls, max_tool_calls, max_wall_ms, max_concurrent_slots
  ON atelier_assistant_budget_ledgers
  FOR EACH ROW EXECUTE FUNCTION atelier_validate_budget_hierarchy();

ALTER TABLE atelier_assistant_budget_reservations
  ADD COLUMN IF NOT EXISTS wall_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS concurrent_slots integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_amount jsonb;

UPDATE atelier_assistant_budget_reservations
SET lease_expires_at = created_at + interval '5 minutes'
WHERE lease_expires_at IS NULL;

ALTER TABLE atelier_assistant_budget_reservations
  ALTER COLUMN lease_expires_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS atelier_assistant_budget_events (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  ledger_id text NOT NULL,
  reservation_id text,
  type text NOT NULL,
  data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_budget_events_ledger
  ON atelier_assistant_budget_events (org_id, ledger_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_assistant_budget_events_type
  ON atelier_assistant_budget_events (org_id, type, occurred_at);

ALTER TABLE atelier_assistant_budget_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_assistant_budget_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_assistant_budget_events_org_isolation
  ON atelier_assistant_budget_events;
CREATE POLICY atelier_assistant_budget_events_org_isolation
  ON atelier_assistant_budget_events
  USING (org_id = atelier_current_org())
  WITH CHECK (org_id = atelier_current_org());