-- Task #242 — The Salon (client-facing workspace)

-- Extend atelier_deliverables with client visibility + last publish pointer.
ALTER TABLE "atelier_deliverables"
  ADD COLUMN IF NOT EXISTS "client_visibility" text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS "latest_publish_id" text;

CREATE TABLE IF NOT EXISTS "atelier_salon_workspaces" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "engagement_id" text NOT NULL,
  "account_id" text NOT NULL,
  "slug" text NOT NULL,
  "display_name" text NOT NULL,
  "accent_color" text NOT NULL DEFAULT '#0B5CFF',
  "client_logo_url" text,
  "aico_logo_url" text,
  "eyebrow_text" text,
  "default_locale" text NOT NULL DEFAULT 'en',
  "rtl_enabled" boolean NOT NULL DEFAULT false,
  "watermark_enabled" boolean NOT NULL DEFAULT true,
  "downloads_allowed_default" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "ux_atelier_salon_ws_eng" ON "atelier_salon_workspaces" ("engagement_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ux_atelier_salon_ws_slug" ON "atelier_salon_workspaces" ("org_id","slug");

CREATE TABLE IF NOT EXISTS "atelier_salon_users" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "account_id" text NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "initials" text NOT NULL,
  "title" text,
  "avatar_url" text,
  "locale" text NOT NULL DEFAULT 'en',
  "status" text NOT NULL DEFAULT 'active',
  "invited_by_atelier_user_id" text,
  "invited_at" timestamp,
  "activated_at" timestamp,
  "last_seen_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "ux_atelier_salon_users_email" ON "atelier_salon_users" ("org_id","account_id","email");
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_users_account" ON "atelier_salon_users" ("account_id");

CREATE TABLE IF NOT EXISTS "atelier_salon_user_engagement_access" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "salon_user_id" text NOT NULL,
  "engagement_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'viewer',
  "downloads_allowed" boolean,
  "can_approve" boolean NOT NULL DEFAULT false,
  "granted_by_atelier_user_id" text,
  "granted_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "ux_atelier_salon_access" ON "atelier_salon_user_engagement_access" ("salon_user_id","engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_access_eng" ON "atelier_salon_user_engagement_access" ("engagement_id");

CREATE TABLE IF NOT EXISTS "atelier_deliverable_publishes" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "deliverable_id" text NOT NULL,
  "deliverable_version_id" text,
  "engagement_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "published_by_atelier_user_id" text NOT NULL,
  "published_by_name" text NOT NULL,
  "published_at" timestamp NOT NULL DEFAULT now(),
  "sentinel_run_id" text,
  "sentinel_status" text NOT NULL DEFAULT 'pass',
  "sentinel_checks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "publish_allowed" boolean NOT NULL DEFAULT true,
  "override_rationale" text,
  "overridden_by_atelier_user_id" text,
  "downloads_allowed" boolean NOT NULL DEFAULT false,
  "watermark_required" boolean NOT NULL DEFAULT true,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_deliv_publish_deliv" ON "atelier_deliverable_publishes" ("deliverable_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_deliv_publish_eng" ON "atelier_deliverable_publishes" ("engagement_id");

CREATE TABLE IF NOT EXISTS "atelier_salon_decisions" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "engagement_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "deliverable_id" text,
  "publish_id" text,
  "kind" text NOT NULL,
  "headline" text NOT NULL,
  "rationale" text,
  "decided_by_salon_user_id" text NOT NULL,
  "decided_by_name" text NOT NULL,
  "decided_at" timestamp NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'recorded',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_dec_eng" ON "atelier_salon_decisions" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_dec_deliv" ON "atelier_salon_decisions" ("deliverable_id");

CREATE TABLE IF NOT EXISTS "atelier_salon_requests" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "engagement_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "detail" text,
  "related_deliverable_id" text,
  "raised_by_salon_user_id" text NOT NULL,
  "raised_by_name" text NOT NULL,
  "raised_at" timestamp NOT NULL DEFAULT now(),
  "status" text NOT NULL DEFAULT 'open',
  "assigned_to_atelier_user_id" text,
  "resolved_at" timestamp,
  "resolution_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_req_eng" ON "atelier_salon_requests" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_req_status" ON "atelier_salon_requests" ("status");

CREATE TABLE IF NOT EXISTS "atelier_salon_notifications" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "salon_user_id" text NOT NULL,
  "engagement_id" text NOT NULL,
  "kind" text NOT NULL,
  "headline" text NOT NULL,
  "body" text,
  "href" text,
  "read_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_notif_user" ON "atelier_salon_notifications" ("salon_user_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_notif_eng" ON "atelier_salon_notifications" ("engagement_id");

CREATE TABLE IF NOT EXISTS "atelier_salon_audit_events" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "engagement_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "salon_user_id" text,
  "actor_name" text NOT NULL,
  "action" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "payload_summary" text,
  "ts" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_audit_eng" ON "atelier_salon_audit_events" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_audit_user" ON "atelier_salon_audit_events" ("salon_user_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_salon_audit_ts" ON "atelier_salon_audit_events" ("ts");
