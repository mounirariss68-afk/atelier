ALTER TABLE atelier_unmatched_merchants
  ADD COLUMN IF NOT EXISTS org_id text;

DROP INDEX IF EXISTS uq_atelier_unmatched_raw;

CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_unmatched_org_raw
  ON atelier_unmatched_merchants (org_id, raw_merchant_text);

CREATE INDEX IF NOT EXISTS idx_atelier_unmatched_org_status
  ON atelier_unmatched_merchants (org_id, status);