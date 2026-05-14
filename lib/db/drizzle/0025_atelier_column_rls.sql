-- ============================================================
-- Task #293 — Column-level RLS for compensation + personnel-contract
-- sensitivity classes, self-service invariant in RLS, and the
-- principle_override (breakglass) audit pattern.
--
-- The DB is now the source of truth for "who can read base_compensation /
-- day_rate_internal_cost / partner_economics / personnel-contract docs".
-- Route handlers keep their `canSeeComp` / `canViewPersonnelContract`
-- guards as defense-in-depth, but a buggy/missing guard can no longer
-- leak raw values: every read for a non-privileged persona that goes
-- through the masked views (`atelier_employees_v`, `atelier_contractors_v`,
-- `atelier_partner_firm_resources_v`, `atelier_partner_economics_v`,
-- `atelier_person_documents_v`) returns NULL for the masked column.
-- ============================================================

-- ---------- 1. Principle Override (breakglass) ledger ----------
CREATE TABLE IF NOT EXISTS atelier_principle_override (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL DEFAULT 'aico',
  actor_user_id       text NOT NULL,
  actor_role          text NOT NULL,
  target_table        text NOT NULL,
  target_id           text,
  sensitivity_class   text NOT NULL,  -- 'compensation' | 'personnel_contract'
  reason              text NOT NULL,
  granted_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_atelier_principle_override_actor
  ON atelier_principle_override (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_atelier_principle_override_target
  ON atelier_principle_override (target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_atelier_principle_override_granted
  ON atelier_principle_override (granted_at);

ALTER TABLE atelier_principle_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_principle_override FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_principle_override_org_isolation
  ON atelier_principle_override;
CREATE POLICY atelier_principle_override_org_isolation
  ON atelier_principle_override
  USING (org_id = atelier_current_org())
  WITH CHECK (org_id = atelier_current_org());

-- ---------- 2. Helper functions ----------
-- Resolve the caller's role from session GUC (set by withRls). Empty/
-- missing GUC means "no role" → no privileged access.
CREATE OR REPLACE FUNCTION atelier_user_role() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('app.user_role', true), ''), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION atelier_principle_override_active() RETURNS boolean AS $$
  SELECT COALESCE(NULLIF(current_setting('app.principle_override', true), ''), '') = 'true';
$$ LANGUAGE sql STABLE;

-- Compensation reader allow-list (mirrors personaRoles.canViewCompensation):
-- founding_partner | partner | finance | hr. Plus active breakglass.
CREATE OR REPLACE FUNCTION atelier_can_view_comp() RETURNS boolean AS $$
  SELECT
    atelier_principle_override_active()
    OR atelier_user_role() IN ('founding_partner','partner','finance','hr');
$$ LANGUAGE sql STABLE;

-- Personnel-contract reader allow-list: founding_partner | partner | hr |
-- the subject themselves (when owner_user_id matches the caller's user_id).
-- Plus active breakglass.
CREATE OR REPLACE FUNCTION atelier_can_view_personnel(owner_user_id text) RETURNS boolean AS $$
  SELECT
    atelier_principle_override_active()
    OR atelier_user_role() IN ('founding_partner','partner','hr')
    OR (owner_user_id IS NOT NULL
        AND owner_user_id = COALESCE(NULLIF(current_setting('app.user_id', true), ''), ''));
$$ LANGUAGE sql STABLE;

-- atelier_breakglass(target_table, target_id, sensitivity_class, reason)
-- writes an audit row AND flips the per-transaction GUC. Restricted to
-- partner-tier (founding_partner | partner). Returns the override row id.
-- The GUC is set with is_local=true so it cannot leak past COMMIT/ROLLBACK
-- of the calling transaction.
CREATE OR REPLACE FUNCTION atelier_breakglass(
  p_target_table     text,
  p_target_id        text,
  p_sensitivity      text,
  p_reason           text
) RETURNS text AS $$
DECLARE
  v_role  text := atelier_user_role();
  v_uid   text := COALESCE(NULLIF(current_setting('app.user_id', true), ''), '');
  v_org   text := atelier_current_org();
  v_id    text;
BEGIN
  IF v_role NOT IN ('founding_partner','partner') THEN
    RAISE EXCEPTION 'breakglass requires partner-tier role (got %)', v_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sensitivity NOT IN ('compensation','personnel_contract') THEN
    RAISE EXCEPTION 'invalid sensitivity_class: %', p_sensitivity;
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'breakglass reason is required';
  END IF;
  -- Avoid the pgcrypto dependency: build a short id from clock_timestamp +
  -- a 64-bit random scaled to base36-ish hex. Collisions across the same
  -- microsecond are mitigated by the random suffix.
  v_id := 'po_' || to_hex((extract(epoch FROM clock_timestamp()) * 1000000)::bigint)
              || '_' || to_hex((random() * 9223372036854775807)::bigint);
  INSERT INTO atelier_principle_override
    (id, org_id, actor_user_id, actor_role, target_table, target_id,
     sensitivity_class, reason, granted_at, expires_at)
  VALUES
    (v_id, v_org, v_uid, v_role, p_target_table, p_target_id,
     p_sensitivity, p_reason, now(), now() + interval '15 minutes');
  PERFORM set_config('app.principle_override', 'true', true);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ---------- 3. Masked views (compensation class) ----------
DROP VIEW IF EXISTS atelier_employees_v;
CREATE VIEW atelier_employees_v AS
SELECT
  e.id, e.org_id, e.user_id, e.employee_id_external, e.full_name,
  e.preferred_name, e.email, e.role, e.seniority, e.title, e.home_office,
  e.country, e.payroll_country, e.country_code, e.payroll_country_code,
  e.employment_type, e.employment_status, e.employing_entity,
  e.start_date, e.end_date, e.status,
  CASE WHEN atelier_can_view_comp() THEN e.iban                ELSE NULL END AS iban,
  CASE WHEN atelier_can_view_comp() THEN e.swift               ELSE NULL END AS swift,
  CASE WHEN atelier_can_view_comp() THEN e.notice_period_days  ELSE NULL END AS notice_period_days,
  CASE WHEN atelier_can_view_comp() THEN e.base_currency       ELSE NULL END AS base_currency,
  CASE WHEN atelier_can_view_comp() THEN e.base_compensation   ELSE NULL END AS base_compensation,
  CASE WHEN atelier_can_view_comp() THEN e.utilization_target_pct ELSE NULL END AS utilization_target_pct,
  CASE WHEN atelier_can_view_comp() THEN e.partner_economics_id ELSE NULL END AS partner_economics_id,
  e.avatar_url, e.notes, e.created_at, e.updated_at,
  e.created_by_user_id, e.deleted_at
FROM atelier_employees e;

DROP VIEW IF EXISTS atelier_contractors_v;
CREATE VIEW atelier_contractors_v AS
SELECT
  c.id, c.org_id, c.full_name, c.email, c.country, c.country_code,
  c.vendor_entity, c.master_agreement_ref, c.contract_type,
  c.contract_start, c.contract_end,
  CASE WHEN atelier_can_view_comp() THEN c.day_rate_amount         ELSE NULL END AS day_rate_amount,
  CASE WHEN atelier_can_view_comp() THEN c.day_rate_internal_cost  ELSE NULL END AS day_rate_internal_cost,
  c.day_rate_currency,
  CASE WHEN atelier_can_view_comp() THEN c.payment_terms_days      ELSE NULL END AS payment_terms_days,
  c.vat_treatment, c.engagement_scope_default, c.contracting_entity,
  c.conflicts_disclosed_json,
  c.start_date, c.end_date, c.status, c.notes,
  c.created_at, c.updated_at, c.created_by_user_id, c.deleted_at
FROM atelier_contractors c;

DROP VIEW IF EXISTS atelier_partner_firm_resources_v;
CREATE VIEW atelier_partner_firm_resources_v AS
SELECT
  r.id, r.org_id, r.partner_firm_id, r.full_name, r.email, r.role,
  r.role_on_engagement, r.seniority, r.seniority_band, r.country,
  r.country_code, r.seconded_to_engagement_ids,
  CASE WHEN atelier_can_view_comp() THEN r.cost_to_aico_per_day ELSE NULL END AS cost_to_aico_per_day,
  r.visible_to_client_in_team_tab, r.partner_firm_pm_user_id,
  CASE WHEN atelier_can_view_comp() THEN r.day_rate_amount      ELSE NULL END AS day_rate_amount,
  r.day_rate_currency, r.start_date, r.end_date, r.status, r.notes,
  r.created_at, r.updated_at, r.created_by_user_id, r.deleted_at
FROM atelier_partner_firm_resources r;

DROP VIEW IF EXISTS atelier_partner_economics_v;
CREATE VIEW atelier_partner_economics_v AS
SELECT
  pe.id, pe.org_id, pe.employee_id,
  CASE WHEN atelier_can_view_comp() THEN pe.model              ELSE NULL END AS model,
  CASE WHEN atelier_can_view_comp() THEN pe.revenue_share_pct  ELSE NULL END AS revenue_share_pct,
  CASE WHEN atelier_can_view_comp() THEN pe.base_amount        ELSE NULL END AS base_amount,
  CASE WHEN atelier_can_view_comp() THEN pe.currency           ELSE NULL END AS currency,
  pe.effective_from, pe.effective_to,
  CASE WHEN atelier_can_view_comp() THEN pe.profit_share_bps   ELSE NULL END AS profit_share_bps,
  CASE WHEN atelier_can_view_comp() THEN pe.vesting_schedule   ELSE NULL END AS vesting_schedule,
  pe.notes, pe.created_at, pe.updated_at,
  pe.created_by_user_id, pe.deleted_at
FROM atelier_partner_economics pe;

-- ---------- 4. Masked view (personnel-contract class) ----------
-- A person's contract / NDA / COI / ID / tax docs are visible to
-- founding_partner | partner | hr, plus the subject themselves. We resolve
-- "the subject" by joining person_documents to the underlying person row's
-- linked atelier_users.id (employees only — contractors and partner-firm
-- resources have no atelier_users FK; their dossier docs remain visible
-- only to the leadership/HR allow-list).
DROP VIEW IF EXISTS atelier_person_documents_v;
CREATE VIEW atelier_person_documents_v AS
SELECT
  d.id, d.org_id, d.person_type, d.person_id, d.kind, d.client_account_id,
  CASE
    WHEN atelier_can_view_personnel(
      (SELECT e.user_id FROM atelier_employees e
        WHERE e.id = d.person_id AND d.person_type = 'employee')
    ) THEN d.title ELSE NULL END AS title,
  CASE
    WHEN atelier_can_view_personnel(
      (SELECT e.user_id FROM atelier_employees e
        WHERE e.id = d.person_id AND d.person_type = 'employee')
    ) THEN d.file_ref ELSE NULL END AS file_ref,
  CASE
    WHEN atelier_can_view_personnel(
      (SELECT e.user_id FROM atelier_employees e
        WHERE e.id = d.person_id AND d.person_type = 'employee')
    ) THEN d.file_url ELSE NULL END AS file_url,
  d.signed_at, d.uploaded_by_user_id, d.uploaded_at, d.expires_at,
  CASE
    WHEN atelier_can_view_personnel(
      (SELECT e.user_id FROM atelier_employees e
        WHERE e.id = d.person_id AND d.person_type = 'employee')
    ) THEN d.notes ELSE NULL END AS notes,
  d.created_at, d.updated_at, d.created_by_user_id, d.deleted_at
FROM atelier_person_documents d;

-- ---------- 5. Self-service invariant in RLS ----------
-- A person can ALWAYS see/mutate their own timesheet entries / expenses /
-- profile row, even when restricted-persona engagement narrowing would
-- otherwise hide them. Implemented as additional permissive policies that
-- get OR-combined with the org_isolation + eng_acl policies already on
-- these tables (see atelier-rls.sql).
--
-- For timesheet_entries the `person_id` column refers to the
-- employee/contractor primary key (not atelier_users.id), so we resolve
-- it through atelier_employees.user_id / atelier_contractors.email per the
-- pattern in ledgerRoutes.resolvePersonForCaller.
CREATE OR REPLACE FUNCTION atelier_caller_person_ids() RETURNS text[] AS $$
  WITH uid AS (
    SELECT COALESCE(NULLIF(current_setting('app.user_id', true), ''), '') AS v
  )
  SELECT COALESCE(array_agg(pid) FILTER (WHERE pid IS NOT NULL), ARRAY[]::text[])
  FROM (
    SELECT e.id AS pid FROM atelier_employees e, uid
      WHERE e.user_id = uid.v AND uid.v <> ''
    UNION
    SELECT c.id AS pid FROM atelier_contractors c, atelier_users u, uid
      WHERE u.id = uid.v AND uid.v <> '' AND lower(c.email) = lower(u.email)
  ) s;
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS atelier_timesheet_entries_self_service
  ON atelier_timesheet_entries;
CREATE POLICY atelier_timesheet_entries_self_service
  ON atelier_timesheet_entries
  USING (person_id = ANY (atelier_caller_person_ids()))
  WITH CHECK (person_id = ANY (atelier_caller_person_ids()));

DROP POLICY IF EXISTS atelier_expenses_self_service
  ON atelier_expenses;
CREATE POLICY atelier_expenses_self_service
  ON atelier_expenses
  USING (person_id = COALESCE(NULLIF(current_setting('app.user_id', true), ''), ''))
  WITH CHECK (person_id = COALESCE(NULLIF(current_setting('app.user_id', true), ''), ''));

DROP POLICY IF EXISTS atelier_users_self_service
  ON atelier_users;
CREATE POLICY atelier_users_self_service
  ON atelier_users
  USING (id = COALESCE(NULLIF(current_setting('app.user_id', true), ''), ''))
  WITH CHECK (id = COALESCE(NULLIF(current_setting('app.user_id', true), ''), ''));
