-- Task #1011 — hand personal tasks to colleagues (accept/decline).
-- assigned_by_id: atelier_users.id of the assigner (NULL = self-created).
-- assignment_status: 'pending' | 'accepted' | 'declined' (NULL = self-created).
-- The assignee OWNS the row (user_id), so all existing self-scoped read
-- paths keep working; declined rows are filtered at read time.
ALTER TABLE "atelier_personal_tasks" ADD COLUMN IF NOT EXISTS "assigned_by_id" text;
ALTER TABLE "atelier_personal_tasks" ADD COLUMN IF NOT EXISTS "assignment_status" text;
CREATE INDEX IF NOT EXISTS "idx_atelier_ptask_assigner" ON "atelier_personal_tasks" ("assigned_by_id");
