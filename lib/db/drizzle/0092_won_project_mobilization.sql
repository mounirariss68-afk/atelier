-- Task #1353 — won-project mobilization.
-- Idempotent by design: this migration is safe to apply during rolling deploys.
ALTER TABLE "atelier_engagements"
  ADD COLUMN IF NOT EXISTS "mobilization_status" text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS "charter_seed" jsonb,
  ADD COLUMN IF NOT EXISTS "commercial_snapshot_summary" jsonb;
-- Early development snapshots accidentally placed these fields on
-- opportunities; the canonical owner is the engagement.
ALTER TABLE "atelier_opportunities"
  DROP COLUMN IF EXISTS "mobilization_status",
  DROP COLUMN IF EXISTS "charter_seed",
  DROP COLUMN IF EXISTS "commercial_snapshot_summary";
ALTER TABLE "atelier_engagement_access"
  ADD COLUMN IF NOT EXISTS "mobilization_assignment_id" text;

CREATE TABLE IF NOT EXISTS "atelier_staffing_requirements" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "engagement_id" text NOT NULL,
  "role" text NOT NULL,
  "seniority" text NOT NULL,
  "allocation_pct" integer NOT NULL DEFAULT 0,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "required" boolean NOT NULL DEFAULT true,
  "rate_source" text,
  "rate_amount" double precision,
  "rate_currency" text NOT NULL DEFAULT 'USD',
  "availability_status" text NOT NULL DEFAULT 'unknown',
  "notes" text,
  "status" text NOT NULL DEFAULT 'open',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_staff_req_eng" ON "atelier_staffing_requirements" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_staff_req_status" ON "atelier_staffing_requirements" ("status");

CREATE TABLE IF NOT EXISTS "atelier_staffing_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "engagement_id" text NOT NULL,
  "requirement_id" text,
  "person_id" text NOT NULL,
  "user_id" text,
  "role" text NOT NULL,
  "seniority" text NOT NULL,
  "allocation_pct" integer NOT NULL DEFAULT 0,
  "start_date" text NOT NULL,
  "end_date" text NOT NULL,
  "required" boolean NOT NULL DEFAULT true,
  "rate_source" text,
  "rate_amount" double precision,
  "rate_currency" text NOT NULL DEFAULT 'USD',
  "availability_status" text NOT NULL DEFAULT 'unknown',
  "state" text NOT NULL DEFAULT 'proposed',
  "replaced_by_assignment_id" text,
  "state_reason" text,
  "accepted_at" timestamp,
  "ended_at" timestamp,
  "idempotency_key" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_staff_assign_eng" ON "atelier_staffing_assignments" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_staff_assign_person" ON "atelier_staffing_assignments" ("person_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_staff_assign_state" ON "atelier_staffing_assignments" ("state");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_staff_assign_idempotency"
  ON "atelier_staffing_assignments" ("org_id", "idempotency_key");

CREATE TABLE IF NOT EXISTS "atelier_mobilization_handoffs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "engagement_id" text NOT NULL,
  "assignment_id" text,
  "kind" text NOT NULL,
  "from_user_id" text,
  "to_user_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "idempotency_key" text NOT NULL,
  "completed_at" timestamp,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_mob_handoff_eng" ON "atelier_mobilization_handoffs" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_mob_handoff_to" ON "atelier_mobilization_handoffs" ("to_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_mob_handoff_idempotency"
  ON "atelier_mobilization_handoffs" ("org_id", "idempotency_key");

CREATE TABLE IF NOT EXISTS "atelier_mobilization_notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "engagement_id" text NOT NULL,
  "recipient_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "href" text,
  "dedupe_key" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "read_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_mob_notif_recipient" ON "atelier_mobilization_notifications" ("recipient_user_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_mob_notif_eng" ON "atelier_mobilization_notifications" ("engagement_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_mob_notif_dedupe"
  ON "atelier_mobilization_notifications" ("org_id", "dedupe_key");

ALTER TABLE "atelier_staffing_requirements"
  ADD CONSTRAINT "chk_atelier_staff_req_allocation" CHECK ("allocation_pct" BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT "chk_atelier_staff_req_dates" CHECK ("end_date" >= "start_date") NOT VALID;
ALTER TABLE "atelier_staffing_assignments"
  ADD CONSTRAINT "chk_atelier_staff_assign_allocation" CHECK ("allocation_pct" BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT "chk_atelier_staff_assign_dates" CHECK ("end_date" >= "start_date") NOT VALID;
ALTER TABLE "atelier_staffing_requirements"
  ADD CONSTRAINT "fk_atelier_staff_req_engagement" FOREIGN KEY ("engagement_id") REFERENCES "atelier_engagements"("id") NOT VALID;
ALTER TABLE "atelier_staffing_assignments"
  ADD CONSTRAINT "fk_atelier_staff_assign_engagement" FOREIGN KEY ("engagement_id") REFERENCES "atelier_engagements"("id") NOT VALID,
  ADD CONSTRAINT "fk_atelier_staff_assign_user" FOREIGN KEY ("user_id") REFERENCES "atelier_users"("id") NOT VALID;