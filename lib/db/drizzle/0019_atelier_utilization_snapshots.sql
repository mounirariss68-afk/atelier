-- Atelier v3 — Ledger: Utilization snapshots (Task #258).
-- Per-person × ISO week roll-up of timesheet entries that have reached
-- the 'lead_approved' (or 'approved') status, used by the Utilization,
-- Engagement Economics, and Firm Economics views. Computed by the
-- snapshot tick (every 15 minutes; idempotent per [person, week]) and
-- consumed read-only by the API routes so the heavy firm view stays
-- under the PRD §7.4 perf target on the seeded dataset.

CREATE TABLE IF NOT EXISTS "atelier_utilization_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "person_id" text NOT NULL,
  "person_type" text DEFAULT 'employee' NOT NULL,
  "week_iso" text NOT NULL,
  "week_start_date" text NOT NULL,
  "billable_hours" double precision DEFAULT 0 NOT NULL,
  "internal_hours" double precision DEFAULT 0 NOT NULL,
  "leave_hours" double precision DEFAULT 0 NOT NULL,
  "total_hours" double precision DEFAULT 0 NOT NULL,
  "available_hours" double precision DEFAULT 40 NOT NULL,
  "utilization_pct" double precision DEFAULT 0 NOT NULL,
  "target_pct" double precision DEFAULT 0 NOT NULL,
  "engagement_mix" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "computed_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_utilization_snap"
  ON "atelier_utilization_snapshots" ("person_id", "week_iso");
CREATE INDEX IF NOT EXISTS "idx_atelier_utilization_snap_week"
  ON "atelier_utilization_snapshots" ("week_iso");
CREATE INDEX IF NOT EXISTS "idx_atelier_utilization_snap_org"
  ON "atelier_utilization_snapshots" ("org_id");
