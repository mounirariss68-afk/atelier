-- Atelier — Engagement P&L durable persistence (Task #430).
-- Replaces the in-memory atelier-engagement-pnl-seed.ts state so that
-- re-baselining (change-order approval) and ETC overrides survive an
-- API server restart. See lib/db/src/schema/atelier-l2c.ts for the
-- Drizzle source of truth.

CREATE TABLE IF NOT EXISTS "atelier_engagement_budget" (
  "engagement_id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "contract_value_usd" double precision DEFAULT 0 NOT NULL,
  "budget_labour_hours" double precision DEFAULT 0 NOT NULL,
  "budget_labour_cost_usd" double precision DEFAULT 0 NOT NULL,
  "budget_expenses_usd" double precision DEFAULT 0 NOT NULL,
  "budget_subs_usd" double precision DEFAULT 0 NOT NULL,
  "budget_at_completion_usd" double precision DEFAULT 0 NOT NULL,
  "baselined_at" text DEFAULT '' NOT NULL,
  "partner_owner_id" text DEFAULT '' NOT NULL,
  "engagement_lead_id" text DEFAULT '' NOT NULL,
  "sector" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_eng_budget_org" ON "atelier_engagement_budget" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_engagement_cost_to_date" (
  "engagement_id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "as_of" text DEFAULT '' NOT NULL,
  "labour_hours_to_date" double precision DEFAULT 0 NOT NULL,
  "labour_cost_to_date_usd" double precision DEFAULT 0 NOT NULL,
  "expenses_to_date_usd" double precision DEFAULT 0 NOT NULL,
  "subs_to_date_usd" double precision DEFAULT 0 NOT NULL,
  "cost_to_date_usd" double precision DEFAULT 0 NOT NULL,
  "revenue_recognised_to_date_usd" double precision DEFAULT 0 NOT NULL,
  "invoiced_to_date_usd" double precision DEFAULT 0 NOT NULL,
  "cash_collected_to_date_usd" double precision DEFAULT 0 NOT NULL,
  "pct_complete" double precision DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_eng_ctd_org" ON "atelier_engagement_cost_to_date" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_engagement_etc" (
  "engagement_id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "method" text DEFAULT 'manual' NOT NULL,
  "manual_etc_usd" double precision,
  "rationale" text DEFAULT '' NOT NULL,
  "updated_at_iso" text DEFAULT '' NOT NULL,
  "updated_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_eng_etc_org" ON "atelier_engagement_etc" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_engagement_pnl_change_order" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "number" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "value_usd" double precision DEFAULT 0 NOT NULL,
  "hours_impact" double precision DEFAULT 0 NOT NULL,
  "cost_impact_usd" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "submitted_at_iso" text,
  "approved_at_iso" text,
  "rejected_at_iso" text,
  "raised_by_user_id" text DEFAULT '' NOT NULL,
  "approved_by_user_id" text,
  "rejection_reason" text,
  "created_at_iso" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_eng_pnl_co_engagement" ON "atelier_engagement_pnl_change_order" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_eng_pnl_co_status" ON "atelier_engagement_pnl_change_order" ("status");

CREATE TABLE IF NOT EXISTS "atelier_engagement_pnl_audit" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "at_iso" text DEFAULT '' NOT NULL,
  "actor_user_id" text,
  "action" text NOT NULL,
  "detail" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_atelier_eng_pnl_audit_engagement" ON "atelier_engagement_pnl_audit" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_eng_pnl_audit_at" ON "atelier_engagement_pnl_audit" ("at_iso");
