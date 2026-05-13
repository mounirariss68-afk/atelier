-- Task #255 — v3 Onboarding/Offboarding sequences + Compliance + Invitations.
-- Idempotent.

-- ---------- Invitations ----------
CREATE TABLE IF NOT EXISTS "atelier_invitations" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "worker_type" text NOT NULL,
  "person_draft" jsonb NOT NULL,
  "sent_by_user_id" text NOT NULL,
  "sent_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp,
  "accepted_at" timestamp,
  "accepted_person_id" text,
  "revoked_at" timestamp,
  "revoked_by_user_id" text,
  "status" text NOT NULL DEFAULT 'sent',
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_invitations_org" ON "atelier_invitations" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_invitations_status" ON "atelier_invitations" ("status");

-- ---------- Onboardings ----------
CREATE TABLE IF NOT EXISTS "atelier_onboardings" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "person_type" text NOT NULL,
  "person_id" text NOT NULL,
  "invitation_id" text,
  "started_at" timestamp NOT NULL DEFAULT now(),
  "target_start_date" text,
  "completed_at" timestamp,
  "blocked_at" timestamp,
  "blocked_reason" text,
  "status" text NOT NULL DEFAULT 'in_flight',
  "owner_user_id" text,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_onboardings_org" ON "atelier_onboardings" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_onboardings_person" ON "atelier_onboardings" ("person_type", "person_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_onboardings_status" ON "atelier_onboardings" ("status");

CREATE TABLE IF NOT EXISTS "atelier_onboarding_steps" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "onboarding_id" text NOT NULL,
  "sort_key" integer NOT NULL DEFAULT 0,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "owner_role" text,
  "deadline" text,
  "status" text NOT NULL DEFAULT 'pending',
  "completed_at" timestamp,
  "completed_by_user_id" text,
  "blocked_reason" text,
  "is_compliance_gate" boolean NOT NULL DEFAULT false,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_onb_steps_org" ON "atelier_onboarding_steps" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_onb_steps_onb" ON "atelier_onboarding_steps" ("onboarding_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_onb_steps_status" ON "atelier_onboarding_steps" ("status");

-- ---------- Offboardings ----------
CREATE TABLE IF NOT EXISTS "atelier_offboardings" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "person_type" text NOT NULL,
  "person_id" text NOT NULL,
  "initiated_at" timestamp NOT NULL DEFAULT now(),
  "initiated_by_user_id" text,
  "last_working_date" text,
  "completed_at" timestamp,
  "blocked_at" timestamp,
  "blocked_reason" text,
  "status" text NOT NULL DEFAULT 'in_flight',
  "audit_pack_url" text,
  "audit_pack_signed_by_user_id" text,
  "audit_pack_signed_at" timestamp,
  "reason" text,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_offb_org" ON "atelier_offboardings" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_offb_person" ON "atelier_offboardings" ("person_type", "person_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_offb_status" ON "atelier_offboardings" ("status");

CREATE TABLE IF NOT EXISTS "atelier_offboarding_steps" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "offboarding_id" text NOT NULL,
  "sort_key" integer NOT NULL DEFAULT 0,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "owner_role" text,
  "deadline" text,
  "status" text NOT NULL DEFAULT 'pending',
  "completed_at" timestamp,
  "completed_by_user_id" text,
  "blocked_reason" text,
  "is_reassignment_gate" boolean NOT NULL DEFAULT false,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_offb_steps_org" ON "atelier_offboarding_steps" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_offb_steps_offb" ON "atelier_offboarding_steps" ("offboarding_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_offb_steps_status" ON "atelier_offboarding_steps" ("status");

-- ---------- Compliance records ----------
CREATE TABLE IF NOT EXISTS "atelier_compliance_records" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "person_type" text,
  "person_id" text,
  "partner_firm_id" text,
  "kind" text NOT NULL,
  "jurisdiction" text,
  "reference_number_redacted" text,
  "reference_number_last_four" text,
  "issued_date" text,
  "expiry_date" text,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_compliance_org" ON "atelier_compliance_records" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_compliance_person" ON "atelier_compliance_records" ("person_type", "person_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_compliance_kind" ON "atelier_compliance_records" ("kind");
CREATE INDEX IF NOT EXISTS "idx_atelier_compliance_expiry" ON "atelier_compliance_records" ("expiry_date");
