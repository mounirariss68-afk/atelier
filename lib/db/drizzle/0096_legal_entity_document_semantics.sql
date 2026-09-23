CREATE TABLE IF NOT EXISTS atelier_legal_entity_aliases (
  id text PRIMARY KEY, org_id text NOT NULL DEFAULT 'aico', entity_id text NOT NULL,
  alias text NOT NULL, normalized_alias text NOT NULL, status text NOT NULL DEFAULT 'active',
  created_by text NOT NULL, retired_by text, retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atelier_legal_entity_aliases DROP CONSTRAINT IF EXISTS atelier_legal_entity_aliases_status_check;
ALTER TABLE atelier_legal_entity_aliases ADD CONSTRAINT atelier_legal_entity_aliases_status_check
  CHECK (status IN ('active','retired'));
ALTER TABLE atelier_legal_entity_aliases DROP CONSTRAINT IF EXISTS atelier_legal_entity_aliases_entity_fk;
ALTER TABLE atelier_legal_entity_aliases ADD CONSTRAINT atelier_legal_entity_aliases_entity_fk
  FOREIGN KEY (entity_id) REFERENCES atelier_legal_entities(id);
DROP INDEX IF EXISTS uniq_legal_entity_alias_active;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_legal_entity_alias_active
  ON atelier_legal_entity_aliases (org_id, normalized_alias) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_legal_entity_aliases_entity
  ON atelier_legal_entity_aliases (org_id, entity_id);

CREATE TABLE IF NOT EXISTS atelier_legal_entity_bundle_definitions (
  id text PRIMARY KEY, org_id text NOT NULL DEFAULT 'aico', entity_id text NOT NULL,
  bundle_key text NOT NULL, version integer NOT NULL, concepts jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active', created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atelier_legal_entity_bundle_definitions DROP CONSTRAINT IF EXISTS atelier_legal_entity_bundle_definitions_status_check;
ALTER TABLE atelier_legal_entity_bundle_definitions ADD CONSTRAINT atelier_legal_entity_bundle_definitions_status_check
  CHECK (status IN ('draft','active','retired'));
ALTER TABLE atelier_legal_entity_bundle_definitions DROP CONSTRAINT IF EXISTS atelier_legal_entity_bundle_definitions_entity_fk;
ALTER TABLE atelier_legal_entity_bundle_definitions ADD CONSTRAINT atelier_legal_entity_bundle_definitions_entity_fk
  FOREIGN KEY (entity_id) REFERENCES atelier_legal_entities(id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_legal_entity_bundle_version
  ON atelier_legal_entity_bundle_definitions (org_id, entity_id, bundle_key, version);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_legal_entity_bundle_active
  ON atelier_legal_entity_bundle_definitions (org_id, entity_id, bundle_key) WHERE status = 'active';

INSERT INTO atelier_legal_entity_bundle_definitions
  (id, org_id, entity_id, bundle_key, version, concepts, status, created_by)
SELECT
  'ebundle_default_' || md5(entity.org_id || ':' || entity.id),
  entity.org_id,
  entity.id,
  'company_registration_and_tax',
  1,
  '[
    {"key":"registration","source":"entity_document","synonyms":["registration","commercial register","trade license","company registration"],"exclusions":["tax registration","vat","corporate tax"]},
    {"key":"ejari","source":"entity_document","synonyms":["ejari","tenancy","lease"],"exclusions":["tax"]},
    {"key":"constitutional","source":"entity_document","synonyms":["constitutional","memorandum","moa","articles of association"]},
    {"key":"ct","source":"registration","synonyms":["ct","corporate tax","corporate tax certificate","tax registration ct"]},
    {"key":"vat","source":"registration","synonyms":["vat","vat certificate","tax registration vat"]}
  ]'::jsonb,
  'active',
  'system:semantic-migration'
FROM atelier_legal_entities entity
WHERE entity.status <> 'archived'
ON CONFLICT (id) DO NOTHING;

WITH dubai_candidates AS (
  SELECT entity.*,
         count(*) OVER (PARTITION BY entity.org_id) AS candidate_count
  FROM atelier_legal_entities entity
  WHERE entity.status <> 'archived'
    AND entity.country = 'AE'
    AND (
      entity.jurisdiction ILIKE '%dubai%'
      OR entity.legal_name_en ILIKE '%dubai%'
      OR entity.short_name ILIKE '%dubai%'
    )
)
INSERT INTO atelier_legal_entity_aliases
  (id, org_id, entity_id, alias, normalized_alias, status, created_by)
SELECT
  'ealias_dubai_' || md5(org_id || ':' || id),
  org_id,
  id,
  'Cognirise Dubai',
  'cognirise dubai',
  'active',
  'system:semantic-migration'
FROM dubai_candidates
WHERE candidate_count = 1
  AND NOT EXISTS (
    SELECT 1
    FROM atelier_legal_entities other
    WHERE other.org_id = dubai_candidates.org_id
      AND other.id <> dubai_candidates.id
      AND other.status <> 'archived'
      AND (
        lower(regexp_replace(other.legal_name_en, '[^[:alnum:]]+', ' ', 'g')) = 'cognirise dubai'
        OR lower(regexp_replace(coalesce(other.legal_name_ar, ''), '[^[:alnum:]]+', ' ', 'g')) = 'cognirise dubai'
        OR lower(regexp_replace(other.short_name, '[^[:alnum:]]+', ' ', 'g')) = 'cognirise dubai'
      )
  )
ON CONFLICT DO NOTHING;

ALTER TABLE atelier_legal_entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_legal_entity_aliases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_legal_entity_aliases_org ON atelier_legal_entity_aliases;
CREATE POLICY atelier_legal_entity_aliases_org ON atelier_legal_entity_aliases
  USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org());
ALTER TABLE atelier_legal_entity_bundle_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_legal_entity_bundle_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_legal_entity_bundles_org ON atelier_legal_entity_bundle_definitions;
CREATE POLICY atelier_legal_entity_bundles_org ON atelier_legal_entity_bundle_definitions
  USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org());