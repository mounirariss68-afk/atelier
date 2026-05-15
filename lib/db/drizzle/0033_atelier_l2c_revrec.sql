-- Atelier — Lead-to-Cash Wave 2 (Task #361).
-- Revenue recognition (POC/ratable/milestone/outcome), period postings,
-- adjustments, period-close lock, WIP snapshots, engagement margin.
-- See lib/db/src/schema/atelier-l2c-revrec.ts for the Drizzle source.

-- ============================================================
-- REVENUE METHOD
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_revenue_method" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "method" text NOT NULL,
  "basis" text DEFAULT '' NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "planned_total_amount" double precision DEFAULT 0 NOT NULL,
  "planned_hours" double precision DEFAULT 0 NOT NULL,
  "planned_cost" double precision DEFAULT 0 NOT NULL,
  "ratable_periods" integer DEFAULT 0 NOT NULL,
  "active_from" text,
  "active_to" text,
  "approved_at" timestamp,
  "approved_by_user_id" text,
  "notes" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_revmethod_org" ON "atelier_revenue_method" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revmethod_eng" ON "atelier_revenue_method" ("engagement_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_revmethod_active_per_eng" ON "atelier_revenue_method" ("org_id", "engagement_id", "active_from");

-- ============================================================
-- REVENUE MILESTONE
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_revenue_milestone" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "sequence" integer DEFAULT 0 NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "planned_date" text,
  "planned_amount" double precision DEFAULT 0 NOT NULL,
  "contract_clause_id" text,
  "deliverable_acceptance_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "claimed_at" timestamp,
  "claimed_by_user_id" text,
  "partner_attested_at" timestamp,
  "partner_attested_by_user_id" text,
  "client_accepted_at" timestamp,
  "earned_at" timestamp,
  "earned_amount" double precision DEFAULT 0 NOT NULL,
  "invoiceable_at" timestamp,
  "rationale_text" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_revmilestone_org" ON "atelier_revenue_milestone" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revmilestone_eng" ON "atelier_revenue_milestone" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revmilestone_status" ON "atelier_revenue_milestone" ("status");
CREATE INDEX IF NOT EXISTS "idx_atelier_revmilestone_acceptance" ON "atelier_revenue_milestone" ("deliverable_acceptance_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_revmilestone_seq" ON "atelier_revenue_milestone" ("org_id", "engagement_id", "sequence");

-- ============================================================
-- REVENUE SCHEDULE (period × engagement)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_revenue_schedule" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "period_label" text NOT NULL,
  "method" text NOT NULL,
  "basis_pct" double precision DEFAULT 0 NOT NULL,
  "recognised_amount" double precision DEFAULT 0 NOT NULL,
  "deferred_balance_ending" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "computation_inputs_json" jsonb DEFAULT '{}'::jsonb,
  "computed_at" timestamp DEFAULT now() NOT NULL,
  "computed_by_agent_run_id" text,
  "frozen" boolean DEFAULT false NOT NULL,
  "frozen_at" timestamp,
  "frozen_by_user_id" text,
  "posting_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_revschedule_org" ON "atelier_revenue_schedule" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revschedule_eng" ON "atelier_revenue_schedule" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revschedule_period" ON "atelier_revenue_schedule" ("period_label");
CREATE INDEX IF NOT EXISTS "idx_atelier_revschedule_posting" ON "atelier_revenue_schedule" ("posting_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_revschedule_period_eng" ON "atelier_revenue_schedule" ("org_id", "period_label", "engagement_id");

-- ============================================================
-- REVENUE PERIOD POSTING (header)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_revenue_period_posting" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "period_label" text NOT NULL,
  "initiated_at" timestamp DEFAULT now() NOT NULL,
  "initiated_by_user_id" text,
  "posted_at" timestamp,
  "posted_by_user_id" text,
  "lines_count" integer DEFAULT 0 NOT NULL,
  "gross_recognised_amount" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "rationale_text" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_revposting_org" ON "atelier_revenue_period_posting" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revposting_period" ON "atelier_revenue_period_posting" ("period_label");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_revposting_period" ON "atelier_revenue_period_posting" ("org_id", "period_label");

-- ============================================================
-- REVENUE PERIOD POSTING LINE (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_revenue_period_posting_line" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "posting_id" text NOT NULL,
  "engagement_id" text NOT NULL,
  "schedule_id" text,
  "kind" text DEFAULT 'posting' NOT NULL,
  "method" text NOT NULL,
  "recognised_amount" double precision DEFAULT 0 NOT NULL,
  "deferred_balance_ending" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "adjustment_id" text,
  "notes" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_revposting_line_posting" ON "atelier_revenue_period_posting_line" ("posting_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revposting_line_eng" ON "atelier_revenue_period_posting_line" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revposting_line_kind" ON "atelier_revenue_period_posting_line" ("kind");

-- ============================================================
-- REVENUE ADJUSTMENT (founding_partner only)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_revenue_adjustment" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "posting_id" text NOT NULL,
  "engagement_id" text NOT NULL,
  "delta_amount" double precision NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "rationale_text" text NOT NULL,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_revadj_org" ON "atelier_revenue_adjustment" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revadj_posting" ON "atelier_revenue_adjustment" ("posting_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_revadj_eng" ON "atelier_revenue_adjustment" ("engagement_id");

-- ============================================================
-- PERIOD CLOSE LOCK
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_period_close_lock" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "period_label" text NOT NULL,
  "locked_modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "locked_at" timestamp DEFAULT now() NOT NULL,
  "locked_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_periodlock_org" ON "atelier_period_close_lock" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_periodlock_period" ON "atelier_period_close_lock" ("period_label");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_periodlock_period" ON "atelier_period_close_lock" ("org_id", "period_label");

-- ============================================================
-- UNBILLED WIP SNAPSHOT
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_unbilled_wip_snapshot" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "snapshot_at" timestamp DEFAULT now() NOT NULL,
  "engagement_id" text NOT NULL,
  "hours_burned" double precision DEFAULT 0 NOT NULL,
  "expense_burned" double precision DEFAULT 0 NOT NULL,
  "recognised_revenue" double precision DEFAULT 0 NOT NULL,
  "invoiced_amount" double precision DEFAULT 0 NOT NULL,
  "unbilled_amount" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "run_log_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_wip_org" ON "atelier_unbilled_wip_snapshot" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_wip_eng" ON "atelier_unbilled_wip_snapshot" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_wip_snap" ON "atelier_unbilled_wip_snapshot" ("snapshot_at");

-- ============================================================
-- ENGAGEMENT MARGIN SNAPSHOT
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_engagement_margin_snapshot" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "snapshot_at" timestamp DEFAULT now() NOT NULL,
  "engagement_id" text NOT NULL,
  "period_label" text NOT NULL,
  "revenue_recognised" double precision DEFAULT 0 NOT NULL,
  "direct_cost" double precision DEFAULT 0 NOT NULL,
  "gross_margin_amount" double precision DEFAULT 0 NOT NULL,
  "gross_margin_pct" double precision DEFAULT 0 NOT NULL,
  "realization_rate" double precision DEFAULT 0 NOT NULL,
  "hours_billable" double precision DEFAULT 0 NOT NULL,
  "hours_billed" double precision DEFAULT 0 NOT NULL,
  "standard_revenue_at_rack" double precision DEFAULT 0 NOT NULL,
  "leakage_amount" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_marginsnap_org" ON "atelier_engagement_margin_snapshot" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_marginsnap_eng" ON "atelier_engagement_margin_snapshot" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_marginsnap_period" ON "atelier_engagement_margin_snapshot" ("period_label");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_marginsnap_period_eng" ON "atelier_engagement_margin_snapshot" ("org_id", "period_label", "engagement_id", "snapshot_at");

-- ============================================================
-- WIP SNAPSHOT RUN LOG (daemon execution audit)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_wip_snapshot_run_log" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "finished_at" timestamp,
  "engagements_scanned" integer DEFAULT 0 NOT NULL,
  "snapshots_written" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "error_text" text DEFAULT '' NOT NULL,
  "triggered_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_wiprunlog_org" ON "atelier_wip_snapshot_run_log" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_wiprunlog_started" ON "atelier_wip_snapshot_run_log" ("started_at");

-- ============================================================
-- ROW-LEVEL SECURITY POLICIES
-- ============================================================
-- Pattern mirrors 0031: org isolation + role gate + (where engagement-
-- scoped) call into atelier_l2c_engagement_allowed(eng_id).
--
-- Restricted personas (contractor / partner_firm_resource / recruiter)
-- and board_observer are denied across all Wave-2 tables EXCEPT the
-- five rollup capabilities (wip_report, leakage_report,
-- revrec_compute_schedule, ar_aging_report, cash_forecast_13w) which
-- are allow-listed in the route layer for board_observer only — those
-- routes go through the firm-wide rollup view, not the per-line tables.

-- REVENUE_METHOD: engagement-scoped read; finance/leadership/founding write.
ALTER TABLE atelier_revenue_method ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_revmethod_rw ON atelier_revenue_method;
CREATE POLICY atelier_revmethod_rw ON atelier_revenue_method
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
    AND atelier_l2c_engagement_allowed(engagement_id)
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- REVENUE_MILESTONE: engagement-scoped read; finance/leadership/founding write.
ALTER TABLE atelier_revenue_milestone ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_revmilestone_rw ON atelier_revenue_milestone;
CREATE POLICY atelier_revmilestone_rw ON atelier_revenue_milestone
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
    AND atelier_l2c_engagement_allowed(engagement_id)
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance', 'senior_manager', 'consultant')
  );

-- REVENUE_SCHEDULE: engagement-scoped read; finance writes.
ALTER TABLE atelier_revenue_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_revschedule_rw ON atelier_revenue_schedule;
CREATE POLICY atelier_revschedule_rw ON atelier_revenue_schedule
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
    AND atelier_l2c_engagement_allowed(engagement_id)
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- REVENUE_PERIOD_POSTING: firm-wide finance/leadership read+write.
ALTER TABLE atelier_revenue_period_posting ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_revposting_rw ON atelier_revenue_period_posting;
CREATE POLICY atelier_revposting_rw ON atelier_revenue_period_posting
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance', 'compliance_officer')
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- REVENUE_PERIOD_POSTING_LINE: per-engagement read narrowed; finance write.
ALTER TABLE atelier_revenue_period_posting_line ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_revposting_line_rw ON atelier_revenue_period_posting_line;
CREATE POLICY atelier_revposting_line_rw ON atelier_revenue_period_posting_line
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
    AND atelier_l2c_engagement_allowed(engagement_id)
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- REVENUE_ADJUSTMENT: founding_partner only writes; finance/compliance/leadership read.
ALTER TABLE atelier_revenue_adjustment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_revadj_rw ON atelier_revenue_adjustment;
CREATE POLICY atelier_revadj_rw ON atelier_revenue_adjustment
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance', 'compliance_officer')
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) = 'founding_partner'
  );

-- PERIOD_CLOSE_LOCK: finance/leadership read+write.
ALTER TABLE atelier_period_close_lock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_periodlock_rw ON atelier_period_close_lock;
CREATE POLICY atelier_periodlock_rw ON atelier_period_close_lock
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance', 'compliance_officer')
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- UNBILLED_WIP_SNAPSHOT: engagement-scoped read for non-restricted; firm-wide
-- rollup is computed in the route layer (board_observer goes through that).
ALTER TABLE atelier_unbilled_wip_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_wip_rw ON atelier_unbilled_wip_snapshot;
CREATE POLICY atelier_wip_rw ON atelier_unbilled_wip_snapshot
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND (
      -- Firm-wide read for finance/leadership/compliance/board_observer.
      current_setting('app.user_role', true) IN
        ('founding_partner', 'partner', 'finance', 'compliance_officer', 'board_observer')
      OR
      -- Engagement-scoped read for senior_manager/consultant.
      atelier_l2c_engagement_allowed(engagement_id)
    )
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- ENGAGEMENT_MARGIN_SNAPSHOT: per-engagement read; firm rollup in route layer.
-- board_observer denied at the line level (matrix §C.2); rollup view exposes
-- aggregates instead.
ALTER TABLE atelier_engagement_margin_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_marginsnap_rw ON atelier_engagement_margin_snapshot;
CREATE POLICY atelier_marginsnap_rw ON atelier_engagement_margin_snapshot
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
    AND atelier_l2c_engagement_allowed(engagement_id)
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- WIP_SNAPSHOT_RUN_LOG: finance/leadership read; finance write.
ALTER TABLE atelier_wip_snapshot_run_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_wiprunlog_rw ON atelier_wip_snapshot_run_log;
CREATE POLICY atelier_wiprunlog_rw ON atelier_wip_snapshot_run_log
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance', 'compliance_officer')
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- ============================================================
-- FIRM-WIDE WIP ROLLUP VIEW (used by board_observer)
-- ============================================================
-- Exposes aggregate-only WIP for the most recent snapshot per engagement.
-- Engagement_id is dropped at this aggregation level so board_observer
-- never sees per-engagement amounts they aren't authorised on.
CREATE OR REPLACE VIEW atelier_firm_wip_v AS
  WITH latest AS (
    SELECT DISTINCT ON (engagement_id)
      engagement_id, org_id, snapshot_at, recognised_revenue,
      invoiced_amount, unbilled_amount, currency
    FROM atelier_unbilled_wip_snapshot
    WHERE deleted_at IS NULL
    ORDER BY engagement_id, snapshot_at DESC
  )
  SELECT
    org_id,
    currency,
    COUNT(*)::int AS engagement_count,
    SUM(recognised_revenue) AS firm_recognised_revenue,
    SUM(invoiced_amount) AS firm_invoiced_amount,
    SUM(unbilled_amount) AS firm_unbilled_amount,
    MAX(snapshot_at) AS as_of
  FROM latest
  GROUP BY org_id, currency;
