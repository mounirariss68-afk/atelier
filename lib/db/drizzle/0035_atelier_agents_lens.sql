-- Atelier — Agents lens (Task #373).
-- Persists the Design / Build / Evaluate / Deploy / Improve / Retire stages
-- previously sourced from a client-side seed in
-- artifacts/atelier/src/lib/agents-lens-seed.ts. Firm-wide (org-scoped only).

CREATE TABLE IF NOT EXISTS "atelier_agent_specs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "name" text NOT NULL,
  "intent" text DEFAULT '' NOT NULL,
  "group_name" text DEFAULT '' NOT NULL,
  "status" text NOT NULL,
  "owner" text NOT NULL,
  "forked_from" text,
  "tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "guardrails" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "persona_binding" text DEFAULT '' NOT NULL,
  "review_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" text NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_specs_org" ON "atelier_agent_specs" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_specs_status" ON "atelier_agent_specs" ("status");

CREATE TABLE IF NOT EXISTS "atelier_agent_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "agent_id" text NOT NULL,
  "agent_name" text NOT NULL,
  "version" text NOT NULL,
  "status" text NOT NULL,
  "change_summary" text DEFAULT '' NOT NULL,
  "prompt_delta" text DEFAULT '' NOT NULL,
  "tools_added" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tools_removed" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "author" text NOT NULL,
  "committed_at" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_versions_org" ON "atelier_agent_versions" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_versions_agent" ON "atelier_agent_versions" ("agent_id");

CREATE TABLE IF NOT EXISTS "atelier_agent_eval_suites" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "name" text NOT NULL,
  "agent_id" text NOT NULL,
  "agent_name" text NOT NULL,
  "kind" text NOT NULL,
  "case_count" integer DEFAULT 0 NOT NULL,
  "pass_rate" double precision DEFAULT 0 NOT NULL,
  "last_run_at" text NOT NULL,
  "owned_by" text NOT NULL,
  "rubric" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_eval_org" ON "atelier_agent_eval_suites" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_eval_agent" ON "atelier_agent_eval_suites" ("agent_id");

CREATE TABLE IF NOT EXISTS "atelier_agent_deployments" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "agent_id" text NOT NULL,
  "agent_name" text NOT NULL,
  "version" text NOT NULL,
  "environment" text NOT NULL,
  "rollout_strategy" text DEFAULT '' NOT NULL,
  "traffic_pct" integer DEFAULT 0 NOT NULL,
  "persona_binding" text DEFAULT '' NOT NULL,
  "promoted_by" text NOT NULL,
  "promoted_at" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_deploys_org" ON "atelier_agent_deployments" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_deploys_env" ON "atelier_agent_deployments" ("environment");

CREATE TABLE IF NOT EXISTS "atelier_agent_incidents" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "agent_id" text NOT NULL,
  "agent_name" text NOT NULL,
  "title" text NOT NULL,
  "severity" text NOT NULL,
  "detected_at" text NOT NULL,
  "status" text NOT NULL,
  "cluster" text DEFAULT '' NOT NULL,
  "root_cause" text,
  "proposed_change" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_incidents_org" ON "atelier_agent_incidents" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_incidents_status" ON "atelier_agent_incidents" ("status");

CREATE TABLE IF NOT EXISTS "atelier_agent_retirements" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "agent_id" text NOT NULL,
  "agent_name" text NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "replacement_agent_id" text,
  "replacement_name" text,
  "deprecate_at" text NOT NULL,
  "archive_at" text NOT NULL,
  "status" text NOT NULL,
  "callers_to_migrate" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_retire_org" ON "atelier_agent_retirements" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_agent_retire_status" ON "atelier_agent_retirements" ("status");
