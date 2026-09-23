CREATE TABLE IF NOT EXISTS atelier_crm_aliases (
  id text PRIMARY KEY,
  org_id text NOT NULL DEFAULT 'aico',
  target_kind text NOT NULL,
  target_id text NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source_kind text NOT NULL DEFAULT 'manual',
  source_ref text,
  created_by text NOT NULL,
  retired_by text,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE atelier_crm_aliases DROP CONSTRAINT IF EXISTS atelier_crm_aliases_target_kind_check;
ALTER TABLE atelier_crm_aliases ADD CONSTRAINT atelier_crm_aliases_target_kind_check
  CHECK (target_kind IN ('account', 'person'));
ALTER TABLE atelier_crm_aliases DROP CONSTRAINT IF EXISTS atelier_crm_aliases_status_check;
ALTER TABLE atelier_crm_aliases ADD CONSTRAINT atelier_crm_aliases_status_check
  CHECK (status IN ('active', 'retired'));
CREATE INDEX IF NOT EXISTS idx_atelier_crm_aliases_lookup
  ON atelier_crm_aliases (org_id, target_kind, normalized_alias);
CREATE INDEX IF NOT EXISTS idx_atelier_crm_aliases_target
  ON atelier_crm_aliases (org_id, target_kind, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_atelier_crm_alias_active_target
  ON atelier_crm_aliases (org_id, target_kind, target_id, normalized_alias)
  WHERE status = 'active';

ALTER TABLE atelier_crm_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_crm_aliases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_crm_aliases_org ON atelier_crm_aliases;
CREATE POLICY atelier_crm_aliases_org ON atelier_crm_aliases
  USING (org_id = atelier_current_org())
  WITH CHECK (org_id = atelier_current_org());