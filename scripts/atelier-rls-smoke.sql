-- =====================================================================
--  THE ATELIER · v3 RLS NEGATIVE-PATH SMOKE (Task #261)
-- =====================================================================
--  Runtime acceptance evidence for PRD §10 RLS hardening.
--
--  USAGE
--  -----
--      psql "$DATABASE_URL" -f scripts/atelier-rls-smoke.sql
--
--  WHAT IT ASSERTS
--  ---------------
--  1. A restricted persona (contractor / partner-firm resource) with NO
--     engagement grants — represented by the request middleware as
--     `app.engagement_ids = '__atelier_deny_all__'` — sees ZERO rows in
--     atelier_timesheet_entries and atelier_expenses regardless of how
--     many rows exist in the org.
--  2. A restricted persona with a grant on engagement `eng_alpha` sees
--     ONLY rows whose engagement_id matches `eng_alpha`.
--  3. The unrestricted partner persona (empty `app.engagement_ids`) sees
--     every row in the org, confirming the policy is not over-broad.
--
--  Each assertion uses `DO $$ ... ASSERT ...; END $$;` so the script
--  exits non-zero if any expectation is violated.
-- =====================================================================

\set ON_ERROR_STOP on

-- We must run as a non-superuser to exercise RLS. The seeding role is a
-- superuser (BYPASSRLS); for smoke purposes we run inside an explicit
-- LOCAL role override using SET LOCAL row_security = on, plus a
-- best-effort role swap when an `atelier_app` role exists.
-- All assertions run inside ONE explicit transaction so SET LOCAL
-- session GUCs (`app.org_id`, `app.user_id`, `app.engagement_ids`,
-- `row_security`) persist across the DO blocks below. Closing the
-- transaction at the bottom releases everything cleanly.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atelier_app') THEN
    EXECUTE 'SET LOCAL ROLE atelier_app';
  END IF;
END $$;

SET LOCAL row_security = on;
SET LOCAL app.org_id = 'aico';
SET LOCAL app.user_id = 'p_smoke_restricted';

-- -------------------------------------------------------------------
-- Case 1 — restricted persona, NO grants → deny-all sentinel.
-- Validates EVERY engagement-scoped table from atelier-rls.sql's
-- eng_tables list.
-- -------------------------------------------------------------------
SET LOCAL app.engagement_ids = '__atelier_deny_all__';

DO $$
DECLARE
  tbl text;
  visible bigint;
  eng_tables text[] := ARRAY[
    'atelier_timesheet_entries',
    'atelier_expenses',
    'atelier_deliverables',
    'atelier_raid_items',
    'atelier_hypothesis_trees',
    'atelier_processes',
    'atelier_agent_designs'
  ];
BEGIN
  FOREACH tbl IN ARRAY eng_tables LOOP
    EXECUTE format('SELECT count(*) FROM %I', tbl) INTO visible;
    RAISE NOTICE '[case1] %=%', tbl, visible;
    ASSERT visible = 0,
      format('expected 0 rows in %s for deny-all sentinel, got %s', tbl, visible);
  END LOOP;
END $$;

-- -------------------------------------------------------------------
-- Case 2 — restricted persona scoped to one engagement.
-- We don't assume `eng_alpha` exists; we pick the first engagement_id
-- present in atelier_timesheet_entries (if any) and assert the persona
-- only sees rows for THAT engagement.
-- -------------------------------------------------------------------
DO $$
DECLARE
  pick text;
  total_for_pick bigint;
  visible_for_pick bigint;
  visible_other bigint;
BEGIN
  -- Re-elevate so the lookup itself isn't gated.
  RESET app.engagement_ids;
  SELECT engagement_id INTO pick
  FROM atelier_timesheet_entries
  WHERE engagement_id IS NOT NULL
  LIMIT 1;

  IF pick IS NULL THEN
    RAISE NOTICE '[case2] no engagement_id rows in atelier_timesheet_entries — skipping scoped check';
    RETURN;
  END IF;

  SELECT count(*) INTO total_for_pick
  FROM atelier_timesheet_entries
  WHERE engagement_id = pick;

  -- Now restrict and re-check.
  EXECUTE format('SET LOCAL app.engagement_ids = %L', pick);
  SELECT count(*) INTO visible_for_pick FROM atelier_timesheet_entries;
  SELECT count(*) INTO visible_other
  FROM atelier_timesheet_entries
  WHERE engagement_id IS DISTINCT FROM pick;

  RAISE NOTICE '[case2] pick=%, total=%, visible=%, visible_other=%',
    pick, total_for_pick, visible_for_pick, visible_other;

  ASSERT visible_for_pick = total_for_pick,
    format('expected %s rows for engagement %s, got %s',
           total_for_pick, pick, visible_for_pick);
  ASSERT visible_other = 0,
    format('expected 0 cross-engagement leakage, got %s rows', visible_other);
END $$;

-- -------------------------------------------------------------------
-- Case 3 — unrestricted persona (empty engagement_ids) sees everything.
-- -------------------------------------------------------------------
RESET app.engagement_ids;

DO $$
DECLARE
  ts_visible bigint;
  ts_total   bigint;
BEGIN
  SELECT count(*) INTO ts_visible FROM atelier_timesheet_entries;
  -- Compare against an unrestricted superuser-equivalent count by
  -- temporarily disabling row_security for the comparison row.
  SET LOCAL row_security = off;
  SELECT count(*) INTO ts_total FROM atelier_timesheet_entries;
  SET LOCAL row_security = on;
  RAISE NOTICE '[case3] visible=%, total=%', ts_visible, ts_total;
  ASSERT ts_visible = ts_total,
    format('unrestricted persona expected %s rows, got %s', ts_total, ts_visible);
END $$;

-- -------------------------------------------------------------------
SELECT 'atelier-rls-smoke: PASS' AS result;

COMMIT;
