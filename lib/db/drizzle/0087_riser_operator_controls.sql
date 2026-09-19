ALTER TABLE atelier_assistant_controls
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reconciliation_error text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE atelier_assistant_controls
  DROP CONSTRAINT IF EXISTS chk_assistant_control_reconciliation_status;

ALTER TABLE atelier_assistant_controls
  ADD CONSTRAINT chk_assistant_control_reconciliation_status
  CHECK (reconciliation_status IN ('pending', 'running', 'complete', 'failed'));

UPDATE atelier_assistant_controls
SET reconciliation_status = 'complete',
    reconciled_at = COALESCE(reconciled_at, updated_at)
WHERE reconciliation_status = 'pending'
  AND created_at < now();