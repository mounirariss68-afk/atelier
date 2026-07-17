-- Purge leftover __t542 / t627 / 1784… test data (Task: purge test data, 2026-07-17)
-- Runs inside a single transaction; psql prints DELETE <n> per statement.

\set ON_ERROR_STOP on
BEGIN;

\echo '--- BEFORE counts ---'
SELECT 'engagements' t, count(*) FROM atelier_engagements
UNION ALL SELECT 'ts_entries', count(*) FROM atelier_timesheet_entries
UNION ALL SELECT 'ts_signals', count(*) FROM atelier_timesheet_signals
UNION ALL SELECT 'invoices', count(*) FROM atelier_invoice
UNION ALL SELECT 'transcripts', count(*) FROM atelier_transcripts
UNION ALL SELECT 'debriefs', count(*) FROM atelier_winloss_debriefs
UNION ALL SELECT 'stage_transitions', count(*) FROM atelier_opportunity_stage_transitions
UNION ALL SELECT 'pane_a', count(*) FROM atelier_pane_a_items
UNION ALL SELECT 'agent_runs', count(*) FROM atelier_agent_runs
UNION ALL SELECT 'audit', count(*) FROM atelier_audit_events;

-- Children first
\echo '--- delete timesheet entries linked to test engagements (expect 9) ---'
DELETE FROM atelier_timesheet_entries
WHERE engagement_id IN (SELECT id FROM atelier_engagements WHERE name ~ 't542');

\echo '--- delete timesheet signals referencing test entities (expect 37) ---'
DELETE FROM atelier_timesheet_signals
WHERE COALESCE(engagement_hint,'') ~ 't542|1784'
   OR COALESCE(evidence_summary,'') ~ 't542|1784';

\echo '--- delete stage transitions (expect 30, all opp_t542) ---'
DELETE FROM atelier_opportunity_stage_transitions WHERE opportunity_id ~ 't542';

\echo '--- delete win/loss debriefs (expect 3) ---'
DELETE FROM atelier_winloss_debriefs WHERE opportunity_id ~ 't542';

\echo '--- delete pane A reminders (expect 3) ---'
DELETE FROM atelier_pane_a_items WHERE title ~ 't542';

\echo '--- delete transcripts (expect 28) ---'
DELETE FROM atelier_transcripts WHERE cleaned_text ~ '1784' OR id ~ '1784|t542';

\echo '--- delete agent runs targeting test entities (expect 41) ---'
DELETE FROM atelier_agent_runs
WHERE COALESCE(target_id,'') ~ 't542|1784|t627'
   OR COALESCE(target_label,'') ~ 't542|1784|t627';

\echo '--- delete audit events referencing test entities (expect 129) ---'
DELETE FROM atelier_audit_events
WHERE entity_id ~ 't542|t627|1784' OR payload::text ~ 't542|t627';

\echo '--- delete invoices (expect 10) ---'
DELETE FROM atelier_invoice WHERE id ~ 't627';

\echo '--- delete engagements (expect 20) ---'
DELETE FROM atelier_engagements WHERE name ~ 't542';

-- Recompute totals for the real timesheet week from its remaining entries
\echo '--- recompute real week totals ---'
UPDATE atelier_timesheet_weeks w SET
  total_hours = COALESCE((SELECT sum(e.hours) FROM atelier_timesheet_entries e WHERE e.week_id = w.id AND e.deleted_at IS NULL), 0),
  billable_hours = COALESCE((SELECT sum(e.hours) FROM atelier_timesheet_entries e WHERE e.week_id = w.id AND e.deleted_at IS NULL AND e.billable), 0),
  updated_at = now()
WHERE w.id = 'tsw_emp_link_p_mounir_ariss_2026-W29';

\echo '--- AFTER counts ---'
SELECT 'engagements' t, count(*) FROM atelier_engagements
UNION ALL SELECT 'ts_entries', count(*) FROM atelier_timesheet_entries
UNION ALL SELECT 'ts_signals', count(*) FROM atelier_timesheet_signals
UNION ALL SELECT 'invoices', count(*) FROM atelier_invoice
UNION ALL SELECT 'transcripts', count(*) FROM atelier_transcripts
UNION ALL SELECT 'debriefs', count(*) FROM atelier_winloss_debriefs
UNION ALL SELECT 'stage_transitions', count(*) FROM atelier_opportunity_stage_transitions
UNION ALL SELECT 'pane_a', count(*) FROM atelier_pane_a_items
UNION ALL SELECT 'agent_runs', count(*) FROM atelier_agent_runs
UNION ALL SELECT 'audit', count(*) FROM atelier_audit_events;

\echo '--- residue check (all must be 0) ---'
SELECT 'eng' t, count(*) FROM atelier_engagements WHERE name ~ 't542|t627|1784'
UNION ALL SELECT 'tse', count(*) FROM atelier_timesheet_entries WHERE COALESCE(engagement_id,'') ~ 't542|1784' OR COALESCE(narrative,'') ~ 't542'
UNION ALL SELECT 'tsig', count(*) FROM atelier_timesheet_signals WHERE COALESCE(engagement_hint,'') ~ 't542|1784' OR COALESCE(evidence_summary,'') ~ 't542|1784'
UNION ALL SELECT 'inv', count(*) FROM atelier_invoice WHERE id ~ 't627|t542'
UNION ALL SELECT 'tr', count(*) FROM atelier_transcripts WHERE cleaned_text ~ '1784' OR id ~ '1784|t542'
UNION ALL SELECT 'deb', count(*) FROM atelier_winloss_debriefs WHERE opportunity_id ~ 't542'
UNION ALL SELECT 'st', count(*) FROM atelier_opportunity_stage_transitions WHERE opportunity_id ~ 't542'
UNION ALL SELECT 'pane', count(*) FROM atelier_pane_a_items WHERE title ~ 't542'
UNION ALL SELECT 'runs', count(*) FROM atelier_agent_runs WHERE COALESCE(target_id,'') ~ 't542|1784|t627' OR COALESCE(target_label,'') ~ 't542|1784|t627'
UNION ALL SELECT 'audit', count(*) FROM atelier_audit_events WHERE entity_id ~ 't542|t627|1784' OR payload::text ~ 't542|t627';

\echo '--- keep-list spot checks ---'
SELECT id, name FROM atelier_accounts WHERE id = 'acct_mrnvk6qd_k8e5gv';
SELECT id, name FROM atelier_opportunities WHERE id = 'opp_mrnvunjj_urkbcx';
SELECT id, status, total_hours, billable_hours FROM atelier_timesheet_weeks WHERE id = 'tsw_emp_link_p_mounir_ariss_2026-W29';
SELECT count(*) kept_entries FROM atelier_timesheet_entries WHERE week_id = 'tsw_emp_link_p_mounir_ariss_2026-W29';

COMMIT;
