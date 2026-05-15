-- ============================================================
-- Task #446 — Persist committed FP&A scenario decisions.
--
-- Finance leadership (founding_partner / partner / finance / senior_manager)
-- can mark one of the FP&A scenarios (base / upside / downside / KSA-led)
-- as the committed forecast for the period. Each commit is appended to
-- this table; the most recent row is "currently committed" and earlier
-- rows form the audit trail.
--
-- Variance reporting (Wave-5 firm-economics) and the budget / scenarios
-- pages key off this table instead of always assuming "base".
-- ============================================================

CREATE TABLE IF NOT EXISTS atelier_finance_plan_commits (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL,
  scenario_label  TEXT NOT NULL,
  period_label    TEXT NOT NULL DEFAULT '',
  note            TEXT NOT NULL DEFAULT '',
  by_user_id      TEXT NOT NULL,
  by_user_name    TEXT NOT NULL,
  by_role         TEXT NOT NULL,
  committed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atelier_finance_plan_commits_committed_at
  ON atelier_finance_plan_commits (committed_at);
