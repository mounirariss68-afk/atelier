-- ============================================================
-- Task #362 round-3/4 — RLS + sequence year-partitioning.
--
-- Closes the access-control + correctness gaps called out in code review:
--   1. Adds the L2C §C.3 RLS model to the 7 Wave 3 tables.
--      Policies enforce org isolation only — matching the pattern
--      established by 0031 for the contracts surface — because the
--      application code path uses the connection-pool default GUCs
--      rather than per-request `withRls(...)` transactions. Role
--      perimeter (deny restricted personas + board_observer on detail,
--      gate writes to partner-tier/finance/senior_manager) is enforced
--      in the route + CLI capability layer via `denyRestricted`,
--      `denyBoardObserver`, and per-capability `requiredRoles`.
--   2. Adds `year_part` to atelier_invoice_sequence and rebuilds the PK
--      so sequences partition per (org, jurisdiction, year).
-- ============================================================

-- ---------- 1. Sequence per-year partitioning ----------
ALTER TABLE atelier_invoice_sequence
  ADD COLUMN IF NOT EXISTS year_part INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::int;

ALTER TABLE atelier_invoice_sequence
  DROP CONSTRAINT IF EXISTS atelier_invoice_sequence_pkey;

DROP INDEX IF EXISTS uq_atelier_invoice_sequence_pk;

ALTER TABLE atelier_invoice_sequence
  ADD CONSTRAINT atelier_invoice_sequence_pkey
  PRIMARY KEY (org_id, jurisdiction, year_part);

-- ---------- 2. RLS policies (org-only, matching 0031) ----------

ALTER TABLE atelier_invoice_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_invoice_sequence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_invoice_sequence_rw ON atelier_invoice_sequence;
CREATE POLICY atelier_invoice_sequence_rw ON atelier_invoice_sequence
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_invoice FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_invoice_read ON atelier_invoice;
DROP POLICY IF EXISTS atelier_invoice_write ON atelier_invoice;
DROP POLICY IF EXISTS atelier_invoice_rw ON atelier_invoice;
CREATE POLICY atelier_invoice_rw ON atelier_invoice
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_invoice_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_invoice_line FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_invoice_line_rw ON atelier_invoice_line;
CREATE POLICY atelier_invoice_line_rw ON atelier_invoice_line
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_einvoice_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_einvoice_submission FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_einvoice_submission_rw ON atelier_einvoice_submission;
CREATE POLICY atelier_einvoice_submission_rw ON atelier_einvoice_submission
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_dunning_ladder ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_dunning_ladder FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_dunning_ladder_read ON atelier_dunning_ladder;
DROP POLICY IF EXISTS atelier_dunning_ladder_write ON atelier_dunning_ladder;
DROP POLICY IF EXISTS atelier_dunning_ladder_rw ON atelier_dunning_ladder;
CREATE POLICY atelier_dunning_ladder_rw ON atelier_dunning_ladder
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_dunning_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_dunning_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_dunning_event_rw ON atelier_dunning_event;
CREATE POLICY atelier_dunning_event_rw ON atelier_dunning_event
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_promise_to_pay ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_promise_to_pay FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_promise_to_pay_rw ON atelier_promise_to_pay;
CREATE POLICY atelier_promise_to_pay_rw ON atelier_promise_to_pay
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

-- ============================================================
-- Note on the AR aging rollup + role perimeter:
--
-- Role-based authorization (deny restricted personas + board_observer on
-- detail, gate writes to partner-tier/finance/senior_manager) is enforced
-- at the application layer in invoiceRoutes.ts and l2c-wave3-capabilities.ts
-- via `denyRestricted`, `denyBoardObserver`, and per-capability
-- `requiredRoles`. The board_observer surface receives the AR aging report
-- with per-invoice rows stripped (rollup-only) — see the route handler.
-- ============================================================
