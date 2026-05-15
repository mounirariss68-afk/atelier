-- ============================================================
-- Task #439 — Persist 13-week cash forecast line overrides + audit.
--
-- The treasurer can override a forecasted line's amount / expected date,
-- or lock a line so the engine stops re-forecasting it. Previously these
-- lived in process memory only; this migration moves both the override
-- state and the audit trail into Postgres so they survive an API server
-- restart and stay visible to all personas.
--
-- Tables:
--   atelier_cash_line_overrides   (one row per overridden cash line)
--   atelier_cash_audit            (append-only audit trail)
-- ============================================================

CREATE TABLE IF NOT EXISTS atelier_cash_line_overrides (
  line_id        TEXT PRIMARY KEY,
  locked_amount  DOUBLE PRECISION,
  locked_date    TEXT,
  locked         BOOLEAN NOT NULL DEFAULT FALSE,
  note           TEXT NOT NULL DEFAULT '',
  by_user_id     TEXT NOT NULL,
  by_user_name   TEXT NOT NULL,
  by_role        TEXT NOT NULL,
  at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS atelier_cash_audit (
  id       TEXT PRIMARY KEY,
  ts       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor    TEXT NOT NULL,
  action   TEXT NOT NULL,
  target   TEXT NOT NULL,
  payload  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_atelier_cash_audit_ts ON atelier_cash_audit (ts);
CREATE INDEX IF NOT EXISTS idx_atelier_cash_audit_target ON atelier_cash_audit (target);
