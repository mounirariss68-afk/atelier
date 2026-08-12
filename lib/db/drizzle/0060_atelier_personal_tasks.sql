-- Task #1002 — personal tasks & reminders (self-scoped to the owning user).
-- Rows are keyed on atelier_users.id; every read/write path puts ownership
-- in the WHERE clause. due_at is a UTC instant resolved server-side from
-- the caller's wall time; soft-delete via deleted_at.
CREATE TABLE IF NOT EXISTS "atelier_personal_tasks" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "user_id" text NOT NULL,
  "title" text NOT NULL,
  "notes" text,
  "due_at" timestamp,
  "status" text NOT NULL DEFAULT 'open',
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ptask_user" ON "atelier_personal_tasks" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_ptask_org" ON "atelier_personal_tasks" ("org_id");
