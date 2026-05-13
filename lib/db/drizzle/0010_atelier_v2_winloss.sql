-- Task #241: Atelier v2 — Win/Loss Debriefs, Win Themes, Reports, Notifications
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "atelier_winloss_debriefs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "opportunity_id" text NOT NULL,
  "outcome" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "seller_inputs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "seller_perceived_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "seller_done_at" timestamp,
  "buyer_interview_scheduled_at" timestamp,
  "buyer_interview_conducted_by_agent_run_id" text,
  "buyer_interview_conducted_by_user_id" text,
  "buyer_transcript" text,
  "buyer_transcript_uploaded_at" timestamp,
  "buyer_responses" jsonb,
  "buyer_authentic_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "hidden_competitor" text,
  "themes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "what_we_would_do_differently" text,
  "lessons_to_atelier_asset_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "interviewer_run_id" text,
  "conductor_role" text,
  "published_at" timestamp,
  "published_by_user_id" text,
  "due_at" timestamp,
  "overdue_red_at" timestamp,
  "closed_without_debrief_override_rationale" text,
  "closed_without_debrief_override_by_user_id" text,
  "closed_without_debrief_override_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_winloss_opp" ON "atelier_winloss_debriefs" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_winloss_status" ON "atelier_winloss_debriefs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_winloss_outcome" ON "atelier_winloss_debriefs" USING btree ("outcome");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_win_themes" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "name" text NOT NULL,
  "description" text NOT NULL,
  "tag" text NOT NULL,
  "polarity" text NOT NULL DEFAULT 'win',
  "support_count" integer NOT NULL DEFAULT 0,
  "contributing_debrief_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "offering_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sector_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "positioning_line" text,
  "last_seen_at" timestamp,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_win_themes_tag" ON "atelier_win_themes" USING btree ("tag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_win_themes_polarity" ON "atelier_win_themes" USING btree ("polarity");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_reports" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'aico',
  "name" text NOT NULL,
  "template_id" text NOT NULL,
  "description" text,
  "parameters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "owner_user_id" text,
  "schedule" text NOT NULL DEFAULT 'none',
  "schedule_channels" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pinned_to_home" boolean NOT NULL DEFAULT false,
  "last_run_at" timestamp,
  "last_run_snapshot" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by_user_id" text,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_reports_owner" ON "atelier_reports" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_reports_template" ON "atelier_reports" USING btree ("template_id");--> statement-breakpoint

-- Extend the pre-existing atelier_notifications table with Task #241 columns.
ALTER TABLE "atelier_notifications" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'in_app';--> statement-breakpoint
ALTER TABLE "atelier_notifications" ADD COLUMN IF NOT EXISTS "subject" text;--> statement-breakpoint
ALTER TABLE "atelier_notifications" ADD COLUMN IF NOT EXISTS "body" text;--> statement-breakpoint
ALTER TABLE "atelier_notifications" ADD COLUMN IF NOT EXISTS "ref_type" text;--> statement-breakpoint
ALTER TABLE "atelier_notifications" ADD COLUMN IF NOT EXISTS "ref_id" text;--> statement-breakpoint
ALTER TABLE "atelier_notifications" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp;--> statement-breakpoint
ALTER TABLE "atelier_notifications" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "atelier_notifications" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'queued';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_notifs_status" ON "atelier_notifications" USING btree ("status");

-- Round 2: extend atelier_winloss_debriefs with fields written by routes/seed
ALTER TABLE "atelier_winloss_debriefs" ADD COLUMN IF NOT EXISTS "seller_notes" text;--> statement-breakpoint
ALTER TABLE "atelier_winloss_debriefs" ADD COLUMN IF NOT EXISTS "partner_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "atelier_winloss_debriefs" ADD COLUMN IF NOT EXISTS "engagement_lead_user_id" text;--> statement-breakpoint
ALTER TABLE "atelier_winloss_debriefs" ADD COLUMN IF NOT EXISTS "suggested_atelier_lessons" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "atelier_winloss_debriefs" ADD COLUMN IF NOT EXISTS "last_run_id" text;--> statement-breakpoint
ALTER TABLE "atelier_winloss_debriefs" ADD COLUMN IF NOT EXISTS "synthesized_at" timestamp;--> statement-breakpoint
ALTER TABLE "atelier_winloss_debriefs" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "atelier_winloss_debriefs" ADD COLUMN IF NOT EXISTS "approved_by_user_id" text;
