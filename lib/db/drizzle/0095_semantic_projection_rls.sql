-- Task #1409: derived semantic indexes are tenant data and need database
-- defense in depth. Keep this migration additive and safe on installations
-- where an optional projection table has not been created yet.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'atelier_document_chunk_embeddings',
    'atelier_entity_embeddings',
    'atelier_partner_capability_chunks',
    'atelier_strategy_exemplars'
  ] LOOP
    IF to_regclass(table_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_org_isolation', table_name);
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org())',
        table_name || '_org_isolation',
        table_name
      );
    END IF;
  END LOOP;
END $$;

-- Serialize the legal-entity registry pointer with document deletion/version
-- changes. Application checks provide clear errors; these triggers are the
-- final invariant that closes the concurrent claim-vs-mutate race.
CREATE OR REPLACE FUNCTION atelier_guard_tax_registration_pointers()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  duplicate_kind text;
  registration jsonb;
  certificate_document_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('atelier-tax-certificates:' || NEW.org_id));

  SELECT kind INTO duplicate_kind
  FROM (
    SELECT item->>'type' AS kind, count(*) AS n
    FROM jsonb_array_elements(COALESCE(NEW.registrations, '[]'::jsonb)) item
    WHERE item->>'type' IN ('tax_registration_ct', 'tax_registration_vat')
    GROUP BY item->>'type'
    HAVING count(*) > 1
  ) duplicates
  LIMIT 1;
  IF duplicate_kind IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate tax registration kind: %', duplicate_kind
      USING ERRCODE = '23514';
  END IF;

  FOR registration IN
    SELECT item
    FROM jsonb_array_elements(COALESCE(NEW.registrations, '[]'::jsonb)) item
    WHERE item->>'type' IN ('tax_registration_ct', 'tax_registration_vat')
  LOOP
    certificate_document_id := NULLIF(registration->>'certificateDocumentId', '');
    IF certificate_document_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM atelier_documents document
      JOIN atelier_document_versions version
        ON version.id = document.current_version_id
       AND version.document_id = document.id
       AND version.org_id = document.org_id
      WHERE document.id = certificate_document_id
        AND document.org_id = NEW.org_id
        AND document.status = 'active'
        AND document.deleted_at IS NULL
        AND document.current_version_id IS NOT NULL
        AND (document.entity_id IS NULL OR document.entity_id = NEW.id)
        AND NULLIF(version.blob_ref, '') IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'tax certificate document is not current and active: %', certificate_document_id
        USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS atelier_legal_entities_tax_pointer_guard ON atelier_legal_entities;
CREATE TRIGGER atelier_legal_entities_tax_pointer_guard
BEFORE INSERT OR UPDATE OF registrations ON atelier_legal_entities
FOR EACH ROW EXECUTE FUNCTION atelier_guard_tax_registration_pointers();

CREATE OR REPLACE FUNCTION atelier_guard_current_tax_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pointer_entity_id text;
  pointer_type text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id
     AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
     AND NEW.doc_kind IS NOT DISTINCT FROM OLD.doc_kind THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('atelier-tax-certificates:' || NEW.org_id));
  SELECT entity.id, registration->>'type'
    INTO pointer_entity_id, pointer_type
    FROM atelier_legal_entities entity,
         jsonb_array_elements(COALESCE(entity.registrations, '[]'::jsonb)) registration
    WHERE entity.org_id = NEW.org_id
      AND entity.status <> 'archived'
      AND registration->>'type' IN ('tax_registration_ct', 'tax_registration_vat')
      AND registration->>'certificateDocumentId' = NEW.id
    LIMIT 1;
  IF pointer_entity_id IS NOT NULL AND (
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
    OR NEW.entity_id IS DISTINCT FROM pointer_entity_id
    OR NEW.doc_kind IS DISTINCT FROM pointer_type
  ) THEN
    RAISE EXCEPTION 'current tax certificate must be replaced through the legal-entity registry'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS atelier_documents_tax_pointer_guard ON atelier_documents;
CREATE TRIGGER atelier_documents_tax_pointer_guard
BEFORE UPDATE OF status, deleted_at, current_version_id, entity_id, doc_kind ON atelier_documents
FOR EACH ROW EXECUTE FUNCTION atelier_guard_current_tax_document_mutation();