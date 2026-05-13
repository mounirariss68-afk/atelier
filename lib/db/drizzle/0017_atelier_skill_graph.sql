-- Atelier v3 — Skill graph + Skill Mapper (Task #256).
-- Adds a small namespaced taxonomy and per-person proficiency table.
-- `atelier_person_skills` is restricted to employees/contractors at the
-- route layer (no partner-firm resources, by design).

CREATE TABLE IF NOT EXISTS "atelier_skills" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "parent_id" text,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_atelier_skills_org" ON "atelier_skills" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_skills_kind" ON "atelier_skills" ("kind");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_skills_slug" ON "atelier_skills" ("org_id", "slug");

CREATE TABLE IF NOT EXISTS "atelier_person_skills" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "person_type" text NOT NULL,
  "person_id" text NOT NULL,
  "skill_id" text NOT NULL,
  "proficiency" integer DEFAULT 3 NOT NULL,
  "source" text NOT NULL,
  "evidence_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence_summary" text,
  "confidence" double precision,
  "status" text DEFAULT 'active' NOT NULL,
  "verified_by_user_id" text,
  "verified_at" timestamp,
  "proposed_by_agent_id" text,
  "proposed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_atelier_person_skills_person" ON "atelier_person_skills" ("person_type", "person_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_person_skills_skill" ON "atelier_person_skills" ("skill_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_person_skills_source" ON "atelier_person_skills" ("source");
CREATE INDEX IF NOT EXISTS "idx_atelier_person_skills_status" ON "atelier_person_skills" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_person_skills" ON "atelier_person_skills" ("person_type", "person_id", "skill_id", "source");
