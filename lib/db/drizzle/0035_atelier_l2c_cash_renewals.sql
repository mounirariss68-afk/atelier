-- ============================================================
-- Task #363 — L2C Wave 4: Cash application, bank reconciliation,
-- 13-week cash forecast, renewals & NRR.
--
-- Note on filename: task spec calls for "0034_atelier_l2c_cash_renewals"
-- but 0034 is taken by Wave-3 RLS (0034_atelier_l2c_invoicing_rls.sql).
-- This migration is therefore numbered 0035.
--
-- Tables:
--   atelier_bank_account
--   atelier_bank_statement_import
--   atelier_bank_transaction
--   atelier_cash_receipt
--   atelier_cash_application       (append-only; reversals as paired rows)
--   atelier_bank_recon_period
--   atelier_cash_forecast_snapshot
--   atelier_renewal
--
-- Views:
--   atelier_ar_aging_view          (round-trip from Wave 3 — paid amount
--                                  now sourced from cash_application sums)
--   atelier_firm_cash_forecast_v   (firm-wide rollup for board_observer)
--
-- RLS pattern follows Wave 3 (0034_atelier_l2c_invoicing_rls.sql):
-- org-only at the SQL layer; role/persona perimeter (deny restricted +
-- board_observer on detail; finance + leadership + compliance only on
-- cash; engagement-scoped on renewals; rollup-only on the firm forecast
-- view) is enforced in the route + CLI capability layer via
-- `denyRestricted`, `denyBoardObserver`, and per-capability
-- `requiredRoles` / `approverRoles`.
-- ============================================================

-- ----------------------------------------------------------------
-- BANK ACCOUNT
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_bank_account (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL DEFAULT 'aico',
  legal_entity_id          TEXT,
  bank_name                TEXT NOT NULL,
  account_label            TEXT NOT NULL,
  account_number_last4     TEXT NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'USD',
  opening_balance          NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id       TEXT,
  deleted_at               TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_bank_account_org    ON atelier_bank_account (org_id);
CREATE INDEX IF NOT EXISTS idx_atelier_bank_account_active ON atelier_bank_account (is_active);

-- ----------------------------------------------------------------
-- BANK STATEMENT IMPORT  (CSV upload or Xero-feed pull batch)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_bank_statement_import (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL DEFAULT 'aico',
  bank_account_id          TEXT NOT NULL,
  statement_date           DATE NOT NULL,
  source                   TEXT NOT NULL DEFAULT 'csv',   -- csv | xero
  file_url                 TEXT,                          -- enc:wallet:<key>
  file_hash                TEXT NOT NULL,                 -- sha-256 of payload — idempotency
  rows_count               INTEGER NOT NULL DEFAULT 0,
  imported_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  imported_by              TEXT,
  notes                    TEXT,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id       TEXT,
  deleted_at               TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_bank_import_acct ON atelier_bank_statement_import (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_atelier_bank_import_date ON atelier_bank_statement_import (statement_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_bank_import_hash
  ON atelier_bank_statement_import (org_id, bank_account_id, file_hash);

-- ----------------------------------------------------------------
-- BANK TRANSACTION
-- kind:          receipt | payment | fee | fx | other
-- matched_state: unmatched | proposed | matched
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_bank_transaction (
  id                        TEXT PRIMARY KEY,
  org_id                    TEXT NOT NULL DEFAULT 'aico',
  bank_account_id           TEXT NOT NULL,
  statement_import_id       TEXT NOT NULL,
  posted_date               DATE NOT NULL,
  amount                    NUMERIC(14,2) NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'USD',
  counterparty_name_raw     TEXT,
  reference_raw             TEXT,
  kind                      TEXT NOT NULL DEFAULT 'receipt',
  matched_state             TEXT NOT NULL DEFAULT 'unmatched',
  match_run_id              TEXT,                         -- agent run that proposed matches
  notes                     TEXT,
  created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id        TEXT,
  deleted_at                TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_bank_txn_acct  ON atelier_bank_transaction (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_atelier_bank_txn_date  ON atelier_bank_transaction (posted_date);
CREATE INDEX IF NOT EXISTS idx_atelier_bank_txn_state ON atelier_bank_transaction (matched_state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_bank_txn_idem
  ON atelier_bank_transaction (org_id, bank_account_id, posted_date, amount, COALESCE(reference_raw, ''));

-- ----------------------------------------------------------------
-- CASH RECEIPT
-- A receipt is the "money landed" record. It is created when Finance
-- (or the Matcher agent in proposal mode) tags a bank_transaction as
-- a customer receipt. One bank_transaction → at most one cash_receipt.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_cash_receipt (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL DEFAULT 'aico',
  bank_transaction_id TEXT NOT NULL,
  customer_id         TEXT,                              -- atelier_accounts.id
  total_amount        NUMERIC(14,2) NOT NULL,
  applied_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,  -- sum of cash_application.applied_amount (− reversals)
  currency            TEXT NOT NULL DEFAULT 'USD',
  received_at         DATE NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id  TEXT,
  deleted_at          TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_cash_receipt_txn  ON atelier_cash_receipt (bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_atelier_cash_receipt_cust ON atelier_cash_receipt (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_cash_receipt_txn
  ON atelier_cash_receipt (org_id, bank_transaction_id);

-- ----------------------------------------------------------------
-- CASH APPLICATION  (append-only ledger; reversals = paired rows)
-- A reversal row points at the row it reverses via reverses_application_id
-- and carries a negative applied_amount of equal magnitude. The original
-- row is never updated or deleted. Invoice .amount_paid is recomputed
-- from the SUM(applied_amount) for that invoice (positive + negative).
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_cash_application (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL DEFAULT 'aico',
  cash_receipt_id          TEXT NOT NULL,
  invoice_id               TEXT NOT NULL,
  applied_amount           NUMERIC(14,2) NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'USD',
  applied_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  applied_by_user_id       TEXT,
  approved_by_user_id      TEXT,
  reverses_application_id  TEXT,                         -- non-null on a reversal pair
  reversal_reason          TEXT,
  rationale_text           TEXT,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id       TEXT,
  deleted_at               TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_cash_app_receipt ON atelier_cash_application (cash_receipt_id);
CREATE INDEX IF NOT EXISTS idx_atelier_cash_app_invoice ON atelier_cash_application (invoice_id);
CREATE INDEX IF NOT EXISTS idx_atelier_cash_app_reverses ON atelier_cash_application (reverses_application_id);

-- ----------------------------------------------------------------
-- BANK RECONCILIATION PERIOD
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_bank_recon_period (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL DEFAULT 'aico',
  bank_account_id         TEXT NOT NULL,
  period_label            TEXT NOT NULL,                 -- e.g. "2026-04"
  period_start            DATE NOT NULL,
  period_end              DATE NOT NULL,
  opening_balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
  computed_receipts       NUMERIC(14,2) NOT NULL DEFAULT 0,
  computed_payments       NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance                NUMERIC(14,2) NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'open',  -- open | finalised
  finalised_at            TIMESTAMP,
  finalised_by_user_id    TEXT,
  approved_by_user_id     TEXT,
  rationale_text          TEXT,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id      TEXT,
  deleted_at              TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_bank_recon_acct ON atelier_bank_recon_period (bank_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_bank_recon_period
  ON atelier_bank_recon_period (org_id, bank_account_id, period_label);

-- ----------------------------------------------------------------
-- CASH FORECAST SNAPSHOT  (13 rows per snapshot — one per week)
-- input_evidence_ref is the sha-256 hash of the AR + AP + payroll
-- snapshot the agent ran on (per v4 Resolution 10). Same inputs →
-- same output rows.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_cash_forecast_snapshot (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL DEFAULT 'aico',
  snapshot_id             TEXT NOT NULL,                 -- groups the 13 rows together
  snapshot_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  bank_account_id         TEXT,                          -- null = firm-wide
  week_index              INTEGER NOT NULL,              -- 0..12
  week_start              DATE NOT NULL,
  expected_in             NUMERIC(14,2) NOT NULL DEFAULT 0,
  expected_out            NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
  closing_balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
  confidence_low          NUMERIC(14,2) NOT NULL DEFAULT 0,
  confidence_high         NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_cash_gap             BOOLEAN NOT NULL DEFAULT FALSE,
  currency                TEXT NOT NULL DEFAULT 'USD',
  input_evidence_ref      TEXT NOT NULL,
  computed_by_agent_run_id TEXT,
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id      TEXT,
  deleted_at              TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_cashfc_snap ON atelier_cash_forecast_snapshot (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_atelier_cashfc_acct ON atelier_cash_forecast_snapshot (bank_account_id);
CREATE INDEX IF NOT EXISTS idx_atelier_cashfc_week ON atelier_cash_forecast_snapshot (week_start);

-- ----------------------------------------------------------------
-- RENEWAL
-- risk_tier: green | amber | red
-- status:    open | won | lost | withdrawn
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_renewal (
  id                       TEXT PRIMARY KEY,
  org_id                   TEXT NOT NULL DEFAULT 'aico',
  engagement_id            TEXT,
  contract_id              TEXT,
  account_id               TEXT,
  current_arr_usd          NUMERIC(14,2) NOT NULL DEFAULT 0,
  proposed_arr_usd         NUMERIC(14,2) NOT NULL DEFAULT 0,
  expansion_target_usd     NUMERIC(14,2) NOT NULL DEFAULT 0,
  nrr_delta_pct            NUMERIC(8,3)  NOT NULL DEFAULT 0,
  renewal_due_at           DATE,
  risk_tier                TEXT NOT NULL DEFAULT 'green',
  partner_owner_id         TEXT,
  opportunity_id           TEXT,
  auto_opened_at           TIMESTAMP,
  auto_opened_by_agent_run_id TEXT,
  status                   TEXT NOT NULL DEFAULT 'open',
  closed_at                TIMESTAMP,
  closed_by_user_id        TEXT,
  lost_reason              TEXT,
  rationale_text           TEXT,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id       TEXT,
  deleted_at               TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_renewal_acct       ON atelier_renewal (account_id);
CREATE INDEX IF NOT EXISTS idx_atelier_renewal_contract   ON atelier_renewal (contract_id);
CREATE INDEX IF NOT EXISTS idx_atelier_renewal_engagement ON atelier_renewal (engagement_id);
CREATE INDEX IF NOT EXISTS idx_atelier_renewal_due        ON atelier_renewal (renewal_due_at);
CREATE INDEX IF NOT EXISTS idx_atelier_renewal_status     ON atelier_renewal (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_renewal_contract
  ON atelier_renewal (org_id, contract_id)
  WHERE contract_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- RLS — org isolation only at SQL layer (matches Wave 3 pattern)
-- ============================================================
ALTER TABLE atelier_bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_bank_account FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_bank_account_rw ON atelier_bank_account;
CREATE POLICY atelier_bank_account_rw ON atelier_bank_account
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_bank_statement_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_bank_statement_import FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_bank_import_rw ON atelier_bank_statement_import;
CREATE POLICY atelier_bank_import_rw ON atelier_bank_statement_import
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_bank_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_bank_transaction FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_bank_txn_rw ON atelier_bank_transaction;
CREATE POLICY atelier_bank_txn_rw ON atelier_bank_transaction
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_cash_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_cash_receipt FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_cash_receipt_rw ON atelier_cash_receipt;
CREATE POLICY atelier_cash_receipt_rw ON atelier_cash_receipt
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_cash_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_cash_application FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_cash_app_rw ON atelier_cash_application;
CREATE POLICY atelier_cash_app_rw ON atelier_cash_application
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_bank_recon_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_bank_recon_period FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_bank_recon_rw ON atelier_bank_recon_period;
CREATE POLICY atelier_bank_recon_rw ON atelier_bank_recon_period
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_cash_forecast_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_cash_forecast_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_cash_forecast_rw ON atelier_cash_forecast_snapshot;
CREATE POLICY atelier_cash_forecast_rw ON atelier_cash_forecast_snapshot
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

ALTER TABLE atelier_renewal ENABLE ROW LEVEL SECURITY;
ALTER TABLE atelier_renewal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_renewal_rw ON atelier_renewal;
CREATE POLICY atelier_renewal_rw ON atelier_renewal
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'));

-- ============================================================
-- AR aging view round-trip from Wave 3 (Step 12 in spec).
-- Wave 3 left amount_paid sourced from atelier_invoice.amount_paid.
-- Wave 4 keeps that column as a denormalised cache *and* exposes a
-- view that recomputes it from atelier_cash_application sums so the
-- two can be reconciled by the report layer.
-- ============================================================
CREATE OR REPLACE VIEW atelier_ar_aging_view AS
  WITH applied AS (
    SELECT invoice_id,
           org_id,
           COALESCE(SUM(applied_amount), 0)::numeric(14,2) AS applied_amount_total
    FROM atelier_cash_application
    WHERE deleted_at IS NULL
    GROUP BY org_id, invoice_id
  )
  SELECT
    i.org_id,
    i.id                                 AS invoice_id,
    i.invoice_number,
    i.account_id,
    i.engagement_id,
    i.jurisdiction,
    i.currency,
    i.status,
    i.total,
    COALESCE(a.applied_amount_total, i.amount_paid) AS amount_paid,
    GREATEST(i.total - COALESCE(a.applied_amount_total, i.amount_paid), 0) AS outstanding,
    i.due_date,
    CASE
      WHEN i.due_date IS NULL OR i.due_date::date >= CURRENT_DATE THEN 0
      ELSE (CURRENT_DATE - i.due_date::date)
    END AS days_overdue,
    i.issued_at,
    i.paid_at
  FROM atelier_invoice i
  LEFT JOIN applied a
    ON a.invoice_id = i.id AND a.org_id = i.org_id
  WHERE i.deleted_at IS NULL
    AND i.status IN ('issued', 'paid');

-- ============================================================
-- Firm-wide cash forecast rollup view (board_observer surface).
-- Aggregates the latest snapshot across bank accounts.
-- ============================================================
CREATE OR REPLACE VIEW atelier_firm_cash_forecast_v AS
  WITH latest AS (
    SELECT snapshot_id, org_id, MAX(snapshot_at) AS snapshot_at
    FROM atelier_cash_forecast_snapshot
    WHERE deleted_at IS NULL
    GROUP BY snapshot_id, org_id
    ORDER BY snapshot_at DESC
    LIMIT 1
  )
  SELECT
    s.org_id,
    s.snapshot_id,
    s.snapshot_at,
    s.week_index,
    s.week_start,
    SUM(s.expected_in)     AS expected_in,
    SUM(s.expected_out)    AS expected_out,
    SUM(s.opening_balance) AS opening_balance,
    SUM(s.closing_balance) AS closing_balance,
    SUM(s.confidence_low)  AS confidence_low,
    SUM(s.confidence_high) AS confidence_high,
    BOOL_OR(s.is_cash_gap) AS is_cash_gap,
    s.currency
  FROM atelier_cash_forecast_snapshot s
  JOIN latest l ON l.snapshot_id = s.snapshot_id AND l.org_id = s.org_id
  WHERE s.deleted_at IS NULL
  GROUP BY s.org_id, s.snapshot_id, s.snapshot_at, s.week_index, s.week_start, s.currency;
