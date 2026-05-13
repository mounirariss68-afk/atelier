-- Task #238: Atelier v2 CRM Accounts & Cartographer
-- Fully idempotent: every statement uses IF NOT EXISTS so re-running on
-- v1 databases (or partially migrated databases) is safe. Mirrors
-- lib/db/src/schema/atelier.ts (atelier_accounts extensions, atelier_contacts,
-- atelier_contact_relationships, atelier_credentials).

-- ---------- atelier_accounts: v2 columns ----------
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "parent_account_id" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "size" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "hq_city" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "primary_currency" text NOT NULL DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "primary_language" text NOT NULL DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "tier" text NOT NULL DEFAULT 'C';--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "partner_owner_id" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "relationship_strength" double precision NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "enriched_at" timestamp;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "source_signals" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "strategic_priorities" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "aico_hypothesis" text;--> statement-breakpoint
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "pending_profile_updates" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_accounts_tier" ON "atelier_accounts" USING btree ("tier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_accounts_partner" ON "atelier_accounts" USING btree ("partner_owner_id");--> statement-breakpoint

-- ---------- atelier_contacts ----------
CREATE TABLE IF NOT EXISTS "atelier_contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "account_id" text NOT NULL,
  "full_name" text NOT NULL,
  "title" text,
  "seniority" text,
  "email" text,
  "phone" text,
  "linkedin_url" text,
  "buyer_persona" text,
  "influence_score" integer NOT NULL DEFAULT 3,
  "disposition" text NOT NULL DEFAULT 'unknown',
  "last_contact_at" timestamp,
  "contact_owner_id" text,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_contacts_org" ON "atelier_contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_contacts_account" ON "atelier_contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_contacts_disposition" ON "atelier_contacts" USING btree ("disposition");--> statement-breakpoint

-- ---------- atelier_contact_relationships ----------
CREATE TABLE IF NOT EXISTS "atelier_contact_relationships" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "account_id" text NOT NULL,
  "from_contact_id" text NOT NULL,
  "to_contact_id" text NOT NULL,
  "type" text NOT NULL,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_contact_rels_org" ON "atelier_contact_relationships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_contact_rels_account" ON "atelier_contact_relationships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_contact_rels_from" ON "atelier_contact_relationships" USING btree ("from_contact_id");--> statement-breakpoint

-- ---------- atelier_credentials ----------
CREATE TABLE IF NOT EXISTS "atelier_credentials" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "title" text NOT NULL,
  "account_id" text,
  "client_name" text NOT NULL,
  "sector" text NOT NULL,
  "engagement_type" text NOT NULL,
  "outcome_metrics" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "anonymization_status" text NOT NULL DEFAULT 'redacted',
  "redacted_abstract" text NOT NULL,
  "attributed_abstract" text,
  "evidence_links" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "related_asset_id" text,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_credentials_org" ON "atelier_credentials" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_credentials_account" ON "atelier_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_credentials_sector" ON "atelier_credentials" USING btree ("sector");
