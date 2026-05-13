-- Task #240: Atelier v2 — Pricing & Margin Lock
-- Idempotent: safe to re-run. Creates rate cards, rate-card rows,
-- margin policies, and per-opportunity deal pricings (with override
-- + countersign + strategist-brief link columns).

CREATE TABLE IF NOT EXISTS "atelier_rate_cards" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "geography" text NOT NULL,
  "currency" text NOT NULL,
  "effective_from" timestamp NOT NULL DEFAULT now(),
  "effective_to" timestamp,
  "source_url" text,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_rate_card_rows" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "rate_card_id" text NOT NULL,
  "role" text NOT NULL,
  "seniority" text NOT NULL,
  "day_rate_internal_cost" double precision NOT NULL,
  "day_rate_client_price" double precision NOT NULL,
  "overhead_pct" double precision NOT NULL DEFAULT 0.25,
  "currency" text NOT NULL DEFAULT 'USD',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_rcrows_card" ON "atelier_rate_card_rows" USING btree ("rate_card_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_margin_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "name" text NOT NULL DEFAULT 'default',
  "target_margin_pct" double precision NOT NULL DEFAULT 0.55,
  "amber_threshold_pct" double precision NOT NULL DEFAULT 0.50,
  "red_threshold_pct" double precision NOT NULL DEFAULT 0.45,
  "two_partner_threshold_pct" double precision NOT NULL DEFAULT 0.45,
  "is_default" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_deal_pricings" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "opportunity_id" text NOT NULL,
  "rate_card_id" text NOT NULL,
  "pricing_model" text NOT NULL DEFAULT 'time_and_materials',
  "duration_weeks" double precision NOT NULL DEFAULT 8,
  "team_mix" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "computed_cost_usd" double precision NOT NULL DEFAULT 0,
  "computed_price_usd" double precision NOT NULL DEFAULT 0,
  "computed_margin_pct" double precision NOT NULL DEFAULT 0,
  "target_margin_pct" double precision NOT NULL DEFAULT 0.55,
  "margin_lock_status" text NOT NULL DEFAULT 'green',
  "partner_override_id" text,
  "partner_override_at" timestamp,
  "partner_override_rationale" text,
  "countersign_partner_id" text,
  "countersign_at" timestamp,
  "countersign_rationale" text,
  "alternative_structures" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pricing_strategist_brief_id" text,
  "pricing_strategist_run_id" text,
  "pricing_strategist_output" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_dealpricing_opp" ON "atelier_deal_pricings" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_dealpricing_status" ON "atelier_deal_pricings" USING btree ("margin_lock_status");--> statement-breakpoint

-- Defensive: if the tables already existed from a prior dev push but are
-- missing the strategist-brief link columns added later, add them now.
ALTER TABLE "atelier_deal_pricings" ADD COLUMN IF NOT EXISTS "pricing_strategist_brief_id" text;--> statement-breakpoint
ALTER TABLE "atelier_deal_pricings" ADD COLUMN IF NOT EXISTS "pricing_strategist_run_id" text;--> statement-breakpoint
ALTER TABLE "atelier_deal_pricings" ADD COLUMN IF NOT EXISTS "pricing_strategist_output" jsonb;
