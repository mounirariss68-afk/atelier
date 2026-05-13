-- Task #239: Atelier v2 — Opportunities sales-stage spine + transitions log
-- Idempotent: safe to re-run. Adds sales_stage column to atelier_opportunities,
-- back-fills from existing plm_stage, and creates the
-- atelier_opportunity_stage_transitions table.

ALTER TABLE "atelier_opportunities" ADD COLUMN IF NOT EXISTS "sales_stage" text;--> statement-breakpoint
-- Back-fill sales_stage from existing plm_stage when null
UPDATE "atelier_opportunities" SET "sales_stage" = CASE
  WHEN "plm_stage" = 'identify' AND ("probability_pct" IS NULL OR "probability_pct" < 10) THEN 'lead'
  WHEN "plm_stage" = 'identify' THEN 'qualified'
  WHEN "plm_stage" = 'shape' AND ("probability_pct" IS NULL OR "probability_pct" < 30) THEN 'discovery_scheduled'
  WHEN "plm_stage" = 'shape' THEN 'pov_in_flight'
  WHEN "plm_stage" = 'pursue' AND ("probability_pct" IS NULL OR "probability_pct" < 60) THEN 'proposal_in_flight'
  WHEN "plm_stage" = 'pursue' AND "probability_pct" < 75 THEN 'submitted'
  WHEN "plm_stage" = 'pursue' THEN 'verbal_commit'
  WHEN "plm_stage" = 'won' THEN 'signed'
  WHEN "plm_stage" = 'lost' THEN 'lost_no_decision'
  WHEN "plm_stage" = 'no_go' THEN 'withdrawn'
  ELSE 'lead'
END WHERE "sales_stage" IS NULL;--> statement-breakpoint
ALTER TABLE "atelier_opportunities" ALTER COLUMN "sales_stage" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "atelier_opportunities" ALTER COLUMN "sales_stage" SET DEFAULT 'lead';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_opps_sales_stage" ON "atelier_opportunities" USING btree ("sales_stage");--> statement-breakpoint

-- ---------- atelier_opportunity_stage_transitions ----------
CREATE TABLE IF NOT EXISTS "atelier_opportunity_stage_transitions" (
  "id" text PRIMARY KEY NOT NULL,
  "opportunity_id" text NOT NULL,
  "from_stage" text,
  "to_stage" text NOT NULL,
  "transitioned_by_user_id" text NOT NULL,
  "rationale_text" text,
  "evidence_artifact_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "prior_probability_pct" double precision,
  "new_probability_pct" double precision,
  "next_milestone" text,
  "next_milestone_date" text,
  "agent_recommended" boolean NOT NULL DEFAULT false,
  "partner_override" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_opp_transitions_opp" ON "atelier_opportunity_stage_transitions" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_opp_transitions_created" ON "atelier_opportunity_stage_transitions" USING btree ("created_at");
