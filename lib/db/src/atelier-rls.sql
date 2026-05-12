-- ============================================================
-- THE ATELIER — Row-Level Security policies (spec §10)
-- ============================================================
-- Enforces org_id tenant isolation across every Atelier table,
-- plus engagement_id ACL on engagement-scoped tables.
--
-- Connections set:
--   SET app.org_id     = '<org>';
--   SET app.user_id    = '<user_id>';
--   SET app.engagement_ids = 'eng_a,eng_b,...';   -- comma-list
--
-- Server middleware in artifacts/api-server/src/routes/atelier
-- sets these GUCs per-request from the authenticated persona.
--
-- The seed/admin bootstrap connects as a superuser (BYPASSRLS) so
-- TRUNCATE/INSERT in seed-atelier.ts is unaffected.
-- ============================================================

-- Helper: current org from session GUC, defaults to 'aico' for dev.
CREATE OR REPLACE FUNCTION atelier_current_org() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico');
$$ LANGUAGE sql STABLE;

-- Helper: engagement_id is in the caller's allow-list (or list is empty = all).
CREATE OR REPLACE FUNCTION atelier_engagement_allowed(eng_id text) RETURNS boolean AS $$
  SELECT
    COALESCE(NULLIF(current_setting('app.engagement_ids', true), ''), '') = ''
    OR eng_id = ANY (string_to_array(current_setting('app.engagement_ids', true), ','));
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  org_tables text[] := ARRAY[
    'atelier_users','atelier_accounts','atelier_opportunities',
    'atelier_engagements','atelier_deliverables','atelier_deliverable_versions',
    'atelier_meetings','atelier_transcripts','atelier_artifacts',
    'atelier_assets','atelier_prompts','atelier_agents','atelier_agent_runs',
    'atelier_audit_events','atelier_raid_items','atelier_hypothesis_trees',
    'atelier_processes','atelier_agent_designs','atelier_notifications',
    'atelier_pane_a_items'
  ];
  -- Tables with a direct engagement_id FK (meetings/transcripts/artifacts
  -- use a polymorphic parent_type/parent_id and are scoped through their
  -- parent's engagement ACL at the application layer).
  eng_tables text[] := ARRAY[
    'atelier_deliverables','atelier_raid_items',
    'atelier_hypothesis_trees','atelier_processes','atelier_agent_designs'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY org_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_org_isolation ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_org_isolation ON %I USING (org_id = atelier_current_org()) WITH CHECK (org_id = atelier_current_org())',
      t, t
    );
  END LOOP;

  FOREACH t IN ARRAY eng_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_eng_acl ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_eng_acl ON %I USING (atelier_engagement_allowed(engagement_id)) WITH CHECK (atelier_engagement_allowed(engagement_id))',
      t, t
    );
  END LOOP;
END $$;
