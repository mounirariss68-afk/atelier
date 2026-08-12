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
    'atelier_pane_a_items',
    'atelier_proposals','atelier_proposal_sections','atelier_prototypes',
    -- Task #261 — v3 Ledger / Wallet tables. org_id is enforced here;
    -- engagement_id ACL is added below via eng_tables for the rows that
    -- carry an engagement_id FK (nullable: non-billable internal time and
    -- firm-overhead expenses are visible to all org users).
    'atelier_timesheet_entries','atelier_expenses',
    -- Task #290 — Reference-data lookups (countries, industries, sub_industries).
    -- Org-scoped reads/writes; deprecation governance is enforced in app code.
    'atelier_countries','atelier_industries','atelier_sub_industries',
    -- Task #331 — Atelier CLI sessions / turns / async jobs. Org-scoped
    -- only; per-engagement narrowing happens inside the tool layer.
    'atelier_cli_sessions','atelier_cli_turns','atelier_cli_jobs',
    -- Task #741 — typed per-session chat facts. Org-scoped; user_id
    -- narrowing is enforced in the read/write helpers (facts are only
    -- ever queried under the stating user's own id).
    'atelier_cli_session_facts',
    -- Task #569 — human account insights + account-team membership.
    -- Org-scoped; per-account visibility is enforced in route logic.
    'atelier_account_insights','atelier_account_team_members',
    -- Task #571 — account planning & execution layer (action plan, account
    -- risk register, goal progress). Org-scoped; per-account visibility +
    -- write gating are enforced in route logic.
    'atelier_account_actions','atelier_account_risks',
    'atelier_account_goal_progress',
    -- Task #327 — per-user Microsoft 365 connections (encrypted tokens).
    'atelier_ms_connections',
    -- Task #538 — unified person model core table.
    'atelier_persons',
    -- Task #1010 — per-user device push tokens (self-scope routes; org
    -- isolation via the standard org_id policy).
    'atelier_push_tokens',
    -- Task #513 — unified partner registry + alliance lifecycle tables.
    'atelier_partner_firms','atelier_partner_firm_resources',
    'atelier_partner_targets','atelier_alliance_joint_pipeline',
    'atelier_alliance_certifications','atelier_alliance_conflicts'
  ];
  -- Tables with a direct engagement_id FK (meetings/transcripts/artifacts
  -- use a polymorphic parent_type/parent_id and are scoped through their
  -- parent's engagement ACL at the application layer).
  eng_tables text[] := ARRAY[
    'atelier_deliverables','atelier_raid_items',
    'atelier_hypothesis_trees','atelier_processes','atelier_agent_designs',
    -- Task #261 — Ledger + Wallet engagement gate. Behavior is
    -- secure-by-default: when `app.engagement_ids` is set (restricted
    -- persona) ANY row whose engagement_id is NOT in the allow-list is
    -- denied — this includes NULL engagement_id rows (internal time,
    -- firm overhead). Org-wide visibility for those NULL rows requires
    -- an unrestricted persona (founding_partner / partner / senior_manager /
    -- finance / hr — see personaRoles.isRestrictedPersona) where the
    -- middleware leaves `app.engagement_ids` empty. Task #292.
    'atelier_timesheet_entries','atelier_expenses'
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

-- ============================================================
-- Task #293 — Column-level RLS, self-service invariant, breakglass.
-- The detailed DDL lives in drizzle/0025_atelier_column_rls.sql so the
-- migration is replayable; the source-of-truth summary is mirrored here
-- for code-readers who go to atelier-rls.sql first.
--
-- 1. Sensitivity classes (column masks via SECURITY-INVOKER views):
--      compensation         -> atelier_employees_v.base_compensation,
--                              atelier_contractors_v.day_rate_internal_cost,
--                              atelier_partner_firm_resources_v.cost_to_cognirise_per_day,
--                              (partner-economics view dropped in Task #513),
--                              iban / swift / notice / payment_terms / day_rate_amount
--                              Allow-list: founding_partner | partner | finance | hr.
--      personnel_contract   -> atelier_person_documents_v.title/file_ref/file_url/notes
--                              Allow-list: founding_partner | partner | hr | self.
--    Both classes can be unmasked for one transaction by calling
--    atelier_breakglass(target_table, target_id, sensitivity, reason),
--    which writes an audit row to atelier_principle_override and sets
--    app.principle_override='true' for the calling transaction only.
--
-- 2. Self-service invariant — additive permissive policies guarantee
--    every persona can see/mutate their own row regardless of engagement
--    narrowing:
--      atelier_users.id            = app.user_id
--      atelier_expenses.person_id  = app.user_id
--      atelier_timesheet_entries.person_id ANY (atelier_caller_person_ids())
--    Read 0025_atelier_column_rls.sql for the exact DDL.
-- ============================================================
