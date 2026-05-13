-- Task #238: Atelier v2 CRM Accounts & Cartographer
-- Fully idempotent: every statement uses IF NOT EXISTS so re-running on
-- v1 databases (or partially migrated databases) is safe.

ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "parent_account_id" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "size" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "hq_city" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "primary_currency" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "primary_language" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "tier" text DEFAULT 'C';--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "partner_owner_id" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "relationship_strength" integer DEFAULT 50;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "enriched_at" timestamp;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "source_signals" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "strategic_priorities" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "aico_hypothesis" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "pending_profile_updates" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "full_name" text NOT NULL,
  "title" text,
  "seniority" text,
  "buyer_persona" text,
  "email" text,
  "phone" text,
  "linkedin_url" text,
  "influence_score" integer DEFAULT 3,
  "disposition" text DEFAULT 'neutral',
  "notes" text,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_contacts_account" ON "atelier_contacts" USING btree ("account_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_contact_relationships" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "from_contact_id" text NOT NULL,
  "to_contact_id" text NOT NULL,
  "type" text NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_contact_rels_account" ON "atelier_contact_relationships" USING btree ("account_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_credentials" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "account_id" text,
  "client_name" text NOT NULL,
  "sector" text NOT NULL,
  "engagement_type" text NOT NULL,
  "anonymization_status" text DEFAULT 'redacted' NOT NULL,
  "redacted_abstract" text NOT NULL,
  "attributed_abstract" text,
  "outcome_metrics" jsonb DEFAULT '[]'::jsonb,
  "evidence_links" jsonb DEFAULT '[]'::jsonb,
  "related_asset_id" text,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "created_by_user_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_credentials_sector" ON "atelier_credentials" USING btree ("sector");
