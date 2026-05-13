-- =====================================================================
--  THE ATELIER · v3 SEED (Task #261)
-- =====================================================================
--  Re-runnable, idempotent SQL seed for v3 fixtures that PRD §10 / §7.3
--  acceptance flows need on top of the canonical TS seed at
--  scripts/src/seed-atelier.ts.
--
--  USAGE
--  -----
--    1. Run the canonical TS seed:
--         pnpm --filter @workspace/scripts run seed:atelier
--    2. Apply this file additively (safe to re-run any number of times):
--         psql "$DATABASE_URL" -f scripts/seed_v3.sql
--
--  WHY A SEPARATE SQL FILE
--  -----------------------
--  The TS seed owns the bulk roster, opportunities, ledger weeks, etc.
--  This file owns the v3 compliance-posture / FX / Pane-A marker rows
--  the Admin posture chips and the §7.3 walkthrough rely on. Splitting
--  them keeps the TS seed deterministic for the dossier workflow while
--  letting Operations top-up a stale environment with one psql call.
--
--  IDEMPOTENCY
--  -----------
--  Every INSERT is gated by `ON CONFLICT DO NOTHING` against the table's
--  primary key, so re-running this file is a no-op once fixtures land.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
--  Compliance posture fixtures — back the v3 Admin chips
--  (WPS / Saudization / DIFC / ADGM / KSA CR).
-- ---------------------------------------------------------------------
INSERT INTO atelier_compliance_records
  (id, org_id, kind, jurisdiction, status, metadata, notes, created_at, updated_at)
VALUES
  ('cmp_v3_wps_aico',         'aico', 'wps',         'KSA',      'active', '{}'::jsonb,
     'WPS bank file generated weekly by Wallet Steward.', now(), now()),
  ('cmp_v3_saud_aico',        'aico', 'saudization', 'KSA',      'active',
     '{"saudizationQuotaRequired": 8, "saudizationQuotaActual": 9}'::jsonb,
     'Quota satisfied (PRD §10).', now(), now()),
  ('cmp_v3_difc_aico',        'aico', 'difc',        'UAE_DIFC', 'active', '{}'::jsonb,
     'DIFC commercial registration on file.', now(), now()),
  ('cmp_v3_adgm_aico',        'aico', 'adgm',        'UAE_ADGM', 'active', '{}'::jsonb,
     'ADGM commercial registration on file.', now(), now()),
  ('cmp_v3_ksa_cr_aico',      'aico', 'ksa_cr',     'KSA',       'active', '{}'::jsonb,
     'KSA Commercial Registration on file.', now(), now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
--  FX rates — Wallet posture chip needs a recent USD->SAR/AED row so the
--  freshness indicator is "ok" out of the box. Date is "today" UTC.
-- ---------------------------------------------------------------------
INSERT INTO atelier_fx_rates (id, org_id, date, base, quote, rate, source, created_at)
VALUES
  ('fx_v3_seed_sar', 'aico', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'USD', 'SAR', 3.7500, 'seed_v3', now()),
  ('fx_v3_seed_aed', 'aico', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'USD', 'AED', 3.6725, 'seed_v3', now()),
  ('fx_v3_seed_eur', 'aico', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 'USD', 'EUR', 0.9200, 'seed_v3', now())
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =====================================================================
--  VERIFICATION — read-only SELECTs Operations can use to confirm v3
--  fixtures landed.
-- =====================================================================

-- Schema presence
SELECT 'v3 schema check' AS phase, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'atelier_users','atelier_employees','atelier_contractors',
    'atelier_partner_firm_resources','atelier_engagement_access',
    'atelier_onboardings','atelier_onboarding_steps',
    'atelier_offboardings','atelier_offboarding_steps',
    'atelier_compliance_records','atelier_conflict_disclosures',
    'atelier_skill_graph_edges','atelier_timesheet_weeks',
    'atelier_timesheet_entries','atelier_timesheet_signals',
    'atelier_partner_firm_hours','atelier_expenses',
    'atelier_expense_policies','atelier_corporate_cards',
    'atelier_fx_rates','atelier_vat_register',
    'atelier_contractor_payments','atelier_partner_firm_invoices',
    'atelier_invoice_line_drafts','atelier_pane_a_items'
  )
ORDER BY tablename;

-- Roster + persona
SELECT 'roster' AS phase,
       (SELECT count(*) FROM atelier_employees)              AS employees,
       (SELECT count(*) FROM atelier_contractors)            AS contractors,
       (SELECT count(*) FROM atelier_partner_firm_resources) AS partner_firm_resources,
       (SELECT count(*) FROM atelier_users WHERE id = 'p_mounir_ariss') AS default_persona;

-- Lifecycle
SELECT 'lifecycle' AS phase,
       (SELECT count(*) FROM atelier_onboardings)       AS onboardings,
       (SELECT count(*) FROM atelier_onboarding_steps)  AS onboarding_steps,
       (SELECT count(*) FROM atelier_offboardings)      AS offboardings,
       (SELECT count(*) FROM atelier_offboarding_steps) AS offboarding_steps;

-- Compliance posture
SELECT 'compliance' AS phase, kind, count(*) AS rows
FROM atelier_compliance_records
GROUP BY kind ORDER BY kind;

-- Ledger
SELECT 'ledger' AS phase,
       (SELECT count(*) FROM atelier_timesheet_weeks)   AS weeks,
       (SELECT count(*) FROM atelier_timesheet_entries) AS entries,
       (SELECT count(*) FROM atelier_timesheet_signals) AS signals,
       (SELECT count(*) FROM atelier_partner_firm_hours) AS partner_firm_rows;

-- Wallet
SELECT 'wallet' AS phase,
       (SELECT count(*) FROM atelier_expenses)         AS expenses,
       (SELECT count(*) FROM atelier_expense_policies) AS policy_rules,
       (SELECT count(*) FROM atelier_corporate_cards)  AS cards,
       (SELECT count(*) FROM atelier_fx_rates)         AS fx_rate_rows,
       (SELECT count(*) FROM atelier_vat_register)     AS vat_register_rows;

-- Wallet payments
SELECT 'wallet_payments' AS phase,
       (SELECT count(*) FROM atelier_contractor_payments)   AS contractor_payments,
       (SELECT count(*) FROM atelier_partner_firm_invoices) AS partner_firm_invoices,
       (SELECT count(*) FROM atelier_invoice_line_drafts)   AS client_invoice_drafts;

-- Pane A producers
SELECT 'pane_a' AS phase,
       count(*) AS items,
       count(*) FILTER (WHERE id LIKE 'pane_steward_%')      AS roster_steward,
       count(*) FILTER (WHERE id LIKE 'pane_nudge_%')        AS time_steward,
       count(*) FILTER (WHERE id LIKE 'pane_burn_%')         AS burn_sentinel,
       count(*) FILTER (WHERE id LIKE 'panea_expense_red_%') AS expense_auditor,
       count(*) FILTER (WHERE id LIKE 'panea_offboarding_%') AS offboarding_sentinel
FROM atelier_pane_a_items
WHERE deleted_at IS NULL;

-- RLS sanity
SELECT 'rls' AS phase, tablename,
       (SELECT count(*) FROM pg_policies WHERE pg_policies.tablename = t.tablename) AS policies
FROM (VALUES
        ('atelier_timesheet_entries'),
        ('atelier_expenses'),
        ('atelier_employees'),
        ('atelier_engagements')
     ) AS t(tablename)
ORDER BY tablename;
