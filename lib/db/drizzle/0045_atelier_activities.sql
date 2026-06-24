-- Task #631 — Unified Activity & Task management.
-- First-class polymorphic activity/task entity for the Atelier account
-- workspace. Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS "atelier_activities" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "account_id" text NOT NULL,
  "parent_type" text NOT NULL DEFAULT 'account',
  "parent_id" text NOT NULL,
  "type" text NOT NULL DEFAULT 'task',
  "title" text NOT NULL,
  "body" text,
  "owner_id" text,
  "due_date" text,
  "status" text NOT NULL DEFAULT 'open',
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_atelier_activities_org" ON "atelier_activities" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_activities_account" ON "atelier_activities" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_activities_parent" ON "atelier_activities" ("parent_type","parent_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_activities_owner" ON "atelier_activities" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_activities_status" ON "atelier_activities" ("status");
