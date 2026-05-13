-- =====================================================================
--  THE ATELIER · v3 SEED MARKER (Task #261)
-- =====================================================================
--  This file is the v3 seed contract — a re-runnable, idempotent SQL
--  marker that documents the v3 fixture surface and provides verification
--  queries Operations can run against any environment to confirm the
--  v3 schema + seed are present.
--
--  HOW THE SEED ACTUALLY RUNS
--  --------------------------
--  The canonical v3 seed is the TypeScript orchestrator at:
--     scripts/src/seed-atelier.ts
--  invoked via:
--     pnpm --filter @workspace/scripts run seed:atelier
--  which is also the workflow entrypoint `Generate dossiers`.
--
--  This SQL file is NOT executed against the database directly. It exists
--  for two reasons:
--    1. As a re-runnable, version-controlled record of the v3 fixture
--       surface (mirroring how v2 maintained `seed_v2.sql`).
--    2. As a sanity-check script Operations can run after a seed:
--         psql "$DATABASE_URL" -f scripts/seed_v3.sql
--       and read the row counts to confirm v3 fixtures landed.
--
--  IDEMPOTENCY
--  -----------
--  All statements below are read-only SELECTs — running this file
--  multiple times has no side effects. The v3 TS seed is itself
--  idempotent (uses ON CONFLICT DO NOTHING / DO UPDATE on stable PKs).
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
--  Schema presence — v3 tables must all exist.
-- ---------------------------------------------------------------------
SELECT 'v3 schema check' AS phase,
       tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'atelier_users',
    'atelier_employees',
    'atelier_contractors',
    'atelier_partner_firm_resources',
    'atelier_engagement_access',
    'atelier_onboardings',
    'atelier_onboarding_steps',
    'atelier_offboardings',
    'atelier_offboarding_steps',
    'atelier_compliance_records',
    'atelier_conflict_disclosures',
    'atelier_skill_graph_edges',
    'atelier_timesheet_weeks',
    'atelier_timesheet_entries',
    'atelier_timesheet_signals',
    'atelier_partner_firm_hours',
    'atelier_expenses',
    'atelier_expense_policies',
    'atelier_corporate_cards',
    'atelier_fx_rates',
    'atelier_vat_register',
    'atelier_contractor_payments',
    'atelier_partner_firm_invoices',
    'atelier_invoice_line_drafts',
    'atelier_pane_a_items'
  )
ORDER BY tablename;

-- ---------------------------------------------------------------------
--  Roster fixtures — v3 PRD §6 (employees, contractors, partner-firm
--  resources). Default persona p_mounir_ariss must exist.
-- ---------------------------------------------------------------------
SELECT 'roster' AS phase,
       (SELECT count(*) FROM atelier_employees)             AS employees,
       (SELECT count(*) FROM atelier_contractors)           AS contractors,
       (SELECT count(*) FROM atelier_partner_firm_resources) AS partner_firm_resources,
       (SELECT count(*) FROM atelier_users WHERE id = 'p_mounir_ariss') AS default_persona;

-- ---------------------------------------------------------------------
--  Lifecycle — onboarding/offboarding sequences seeded for the demo.
-- ---------------------------------------------------------------------
SELECT 'lifecycle' AS phase,
       (SELECT count(*) FROM atelier_onboardings)       AS onboardings,
       (SELECT count(*) FROM atelier_onboarding_steps)  AS onboarding_steps,
       (SELECT count(*) FROM atelier_offboardings)      AS offboardings,
       (SELECT count(*) FROM atelier_offboarding_steps) AS offboarding_steps;

-- ---------------------------------------------------------------------
--  Compliance posture — WPS / Saudization / Iqama records back the v3
--  Admin posture chips.
-- ---------------------------------------------------------------------
SELECT 'compliance' AS phase,
       kind,
       count(*)    AS rows
FROM atelier_compliance_records
GROUP BY kind
ORDER BY kind;

-- ---------------------------------------------------------------------
--  Ledger v3 — timesheets + entries + Time Steward signals.
-- ---------------------------------------------------------------------
SELECT 'ledger' AS phase,
       (SELECT count(*) FROM atelier_timesheet_weeks)   AS weeks,
       (SELECT count(*) FROM atelier_timesheet_entries) AS entries,
       (SELECT count(*) FROM atelier_timesheet_signals) AS signals,
       (SELECT count(*) FROM atelier_partner_firm_hours) AS partner_firm_rows;

-- ---------------------------------------------------------------------
--  Wallet v3 — expenses, FX rates, policy rules, card feeds.
-- ---------------------------------------------------------------------
SELECT 'wallet' AS phase,
       (SELECT count(*) FROM atelier_expenses)          AS expenses,
       (SELECT count(*) FROM atelier_expense_policies)  AS policy_rules,
       (SELECT count(*) FROM atelier_corporate_cards)   AS cards,
       (SELECT count(*) FROM atelier_fx_rates)          AS fx_rate_rows,
       (SELECT count(*) FROM atelier_vat_register)      AS vat_register_rows;

-- ---------------------------------------------------------------------
--  Wallet payments — contractor + partner-firm invoice approvals.
-- ---------------------------------------------------------------------
SELECT 'wallet_payments' AS phase,
       (SELECT count(*) FROM atelier_contractor_payments)    AS contractor_payments,
       (SELECT count(*) FROM atelier_partner_firm_invoices)  AS partner_firm_invoices,
       (SELECT count(*) FROM atelier_invoice_line_drafts)    AS client_invoice_drafts;

-- ---------------------------------------------------------------------
--  Pane A — v3 producers (Roster Steward, Burn Sentinel, Time Steward,
--  Expense Auditor, Offboarding Sentinel).
-- ---------------------------------------------------------------------
SELECT 'pane_a' AS phase,
       count(*) AS items,
       count(*) FILTER (WHERE id LIKE 'pane_steward_%')      AS roster_steward,
       count(*) FILTER (WHERE id LIKE 'pane_nudge_%')        AS time_steward,
       count(*) FILTER (WHERE id LIKE 'pane_burn_%')         AS burn_sentinel,
       count(*) FILTER (WHERE id LIKE 'panea_expense_red_%') AS expense_auditor,
       count(*) FILTER (WHERE id LIKE 'panea_offboarding_%') AS offboarding_sentinel
FROM atelier_pane_a_items
WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
--  RLS sanity — v3 hardening adds atelier_timesheet_entries +
--  atelier_expenses to the policy set.
-- ---------------------------------------------------------------------
SELECT 'rls' AS phase,
       tablename,
       (SELECT count(*) FROM pg_policies WHERE pg_policies.tablename = t.tablename) AS policies
FROM (VALUES
        ('atelier_timesheet_entries'),
        ('atelier_expenses'),
        ('atelier_employees'),
        ('atelier_engagements')
     ) AS t(tablename)
ORDER BY tablename;

-- ---------------------------------------------------------------------
--  END.  All counts non-zero ⇒ v3 seed is in place.
-- ---------------------------------------------------------------------
