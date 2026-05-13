-- Atelier v3 — Ledger: Timesheets + Time Steward (Task #257).
-- Calendar event capture, weekly timesheet shells, per-day entries with
-- agent-drafted source attribution, immutable signal evidence rows, and
-- a separate partner-firm hours table fed by CSV upload (cost passthrough).

CREATE TABLE IF NOT EXISTS "atelier_calendar_events" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "person_id" text NOT NULL,
  "person_type" text DEFAULT 'employee' NOT NULL,
  "title" text NOT NULL,
  "starts_at" timestamp NOT NULL,
  "ends_at" timestamp NOT NULL,
  "duration_mins" integer NOT NULL,
  "attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "engagement_hint" text,
  "source_provider" text DEFAULT 'synthetic' NOT NULL,
  "source_event_id" text,
  "raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_cal_person_date" ON "atelier_calendar_events" ("person_id", "starts_at");
CREATE INDEX IF NOT EXISTS "idx_atelier_cal_org" ON "atelier_calendar_events" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_timesheet_weeks" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "person_id" text NOT NULL,
  "person_type" text NOT NULL,
  "week_iso" text NOT NULL,
  "week_start_date" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "submitted_at" timestamp,
  "submitted_by_user_id" text,
  "lead_approved_at" timestamp,
  "lead_approved_by_user_id" text,
  "partner_approved_at" timestamp,
  "partner_approved_by_user_id" text,
  "rejected_at" timestamp,
  "rejected_by_user_id" text,
  "rejection_reason" text,
  "total_hours" double precision DEFAULT 0 NOT NULL,
  "billable_hours" double precision DEFAULT 0 NOT NULL,
  "suspicious_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_ts_week" ON "atelier_timesheet_weeks" ("person_id", "week_iso");
CREATE INDEX IF NOT EXISTS "idx_atelier_ts_week_status" ON "atelier_timesheet_weeks" ("status");
CREATE INDEX IF NOT EXISTS "idx_atelier_ts_week_org" ON "atelier_timesheet_weeks" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_timesheet_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "week_id" text NOT NULL,
  "person_id" text NOT NULL,
  "person_type" text NOT NULL,
  "work_date" text NOT NULL,
  "engagement_id" text,
  "activity_code" text,
  "hours" double precision DEFAULT 0 NOT NULL,
  "billable" boolean DEFAULT false NOT NULL,
  "narrative" text,
  "source" text DEFAULT 'human' NOT NULL,
  "drafted_by_agent_id" text,
  "signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ts_entry_person_date" ON "atelier_timesheet_entries" ("person_id", "work_date");
CREATE INDEX IF NOT EXISTS "idx_atelier_ts_entry_eng_date" ON "atelier_timesheet_entries" ("engagement_id", "work_date");
CREATE INDEX IF NOT EXISTS "idx_atelier_ts_entry_status" ON "atelier_timesheet_entries" ("status");
CREATE INDEX IF NOT EXISTS "idx_atelier_ts_entry_week" ON "atelier_timesheet_entries" ("week_id");

CREATE TABLE IF NOT EXISTS "atelier_timesheet_signals" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "week_id" text NOT NULL,
  "person_id" text NOT NULL,
  "work_date" text NOT NULL,
  "signal_type" text NOT NULL,
  "source_ref_type" text NOT NULL,
  "source_ref_id" text NOT NULL,
  "engagement_hint" text,
  "evidence_summary" text NOT NULL,
  "weight_hours" double precision DEFAULT 0 NOT NULL,
  "observed_at" timestamp DEFAULT now() NOT NULL,
  "run_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ts_signal_week" ON "atelier_timesheet_signals" ("week_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_ts_signal_person_date" ON "atelier_timesheet_signals" ("person_id", "work_date");

CREATE TABLE IF NOT EXISTS "atelier_partner_firm_hours" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "partner_firm_id" text NOT NULL,
  "partner_firm_resource_id" text,
  "resource_name" text NOT NULL,
  "week_iso" text NOT NULL,
  "work_date" text,
  "hours" double precision DEFAULT 0 NOT NULL,
  "cost_amount" double precision DEFAULT 0 NOT NULL,
  "cost_currency" text DEFAULT 'USD' NOT NULL,
  "csv_upload_ref" text,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  "uploaded_by_user_id" text,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_pfh_eng" ON "atelier_partner_firm_hours" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pfh_firm" ON "atelier_partner_firm_hours" ("partner_firm_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_pfh_week" ON "atelier_partner_firm_hours" ("week_iso");
