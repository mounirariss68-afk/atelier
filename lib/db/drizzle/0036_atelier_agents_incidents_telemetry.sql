-- Atelier — Close the Improve loop (Task #382).
-- Link incidents to real agent run telemetry and the candidate fix
-- version. Referential integrity is enforced at the application layer to
-- match other Atelier text-PK relationships.

ALTER TABLE "atelier_agent_incidents"
  ADD COLUMN IF NOT EXISTS "evidence_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE "atelier_agent_incidents"
  ADD COLUMN IF NOT EXISTS "fix_version_id" text;
