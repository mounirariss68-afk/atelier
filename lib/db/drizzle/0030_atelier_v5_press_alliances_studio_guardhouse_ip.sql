-- Atelier v5 — Persist Press, Alliances, Studio, Guardhouse, IP catalog (Task #354).
-- All tables are firm-wide (org-scoped only); no engagement_id ACL columns.

-- ============================================================
-- PRESS
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_press_editorial_calendar" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "working_title" text NOT NULL,
  "publication" text NOT NULL,
  "byline" text NOT NULL,
  "publish_on" text NOT NULL,
  "status" text NOT NULL,
  "thesis" text DEFAULT '' NOT NULL,
  "theme_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_press_ec_org" ON "atelier_press_editorial_calendar" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_press_ec_status" ON "atelier_press_editorial_calendar" ("status");

CREATE TABLE IF NOT EXISTS "atelier_press_in_flight_content" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "byline" text NOT NULL,
  "word_count" integer DEFAULT 0 NOT NULL,
  "source_artifact" text DEFAULT '' NOT NULL,
  "phase" text NOT NULL,
  "citation_coverage" double precision DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_press_if_org" ON "atelier_press_in_flight_content" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_press_partner_cadence" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "partner_id" text NOT NULL,
  "partner_name" text NOT NULL,
  "voice_profile" text NOT NULL,
  "target_per_90d" integer DEFAULT 0 NOT NULL,
  "posts_this_90d" integer DEFAULT 0 NOT NULL,
  "cadence_met" boolean DEFAULT false NOT NULL,
  "queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_press_pc_org" ON "atelier_press_partner_cadence" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_press_newsletter" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "total_subscribers" integer DEFAULT 0 NOT NULL,
  "net_growth_last_90d" integer DEFAULT 0 NOT NULL,
  "avg_open_rate" double precision DEFAULT 0 NOT NULL,
  "avg_click_rate" double precision DEFAULT 0 NOT NULL,
  "current_issue" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_press_nl_org" ON "atelier_press_newsletter" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_press_speaking_opportunities" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "event" text NOT NULL,
  "kind" text NOT NULL,
  "location" text NOT NULL,
  "date" text NOT NULL,
  "audience" text DEFAULT '' NOT NULL,
  "ask" text DEFAULT '' NOT NULL,
  "decision" text NOT NULL,
  "owner" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_press_sp_org" ON "atelier_press_speaking_opportunities" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_press_mentions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "headline" text NOT NULL,
  "publication" text NOT NULL,
  "date" text NOT NULL,
  "about" text DEFAULT '' NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "sentiment" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_press_pm_org" ON "atelier_press_mentions" ("org_id");

-- ============================================================
-- ALLIANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_alliance_partner_firms" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL,
  "country" text NOT NULL,
  "speciality" text DEFAULT '' NOT NULL,
  "relationship_strength" integer DEFAULT 0 NOT NULL,
  "anchor_aico" text DEFAULT '' NOT NULL,
  "anchor_partner" text DEFAULT '' NOT NULL,
  "last_touch_at" text,
  "open_joint_opps" integer DEFAULT 0 NOT NULL,
  "lifetime_joint_revenue_mm" double precision DEFAULT 0 NOT NULL,
  "recent_moves" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_alliance_pf_org" ON "atelier_alliance_partner_firms" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_alliance_joint_pipeline" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "opportunity_name" text NOT NULL,
  "client" text NOT NULL,
  "partner_firm" text NOT NULL,
  "lead_party" text NOT NULL,
  "stage" text NOT NULL,
  "acv_usd_k" integer DEFAULT 0 NOT NULL,
  "aico_pct" integer DEFAULT 0 NOT NULL,
  "partner_pct" integer DEFAULT 0 NOT NULL,
  "split_rationale" text DEFAULT '' NOT NULL,
  "alliance_letter_status" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_alliance_jp_org" ON "atelier_alliance_joint_pipeline" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_alliance_certifications" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "credential" text NOT NULL,
  "platform" text NOT NULL,
  "holder" text NOT NULL,
  "status" text NOT NULL,
  "expires_at" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_alliance_cert_org" ON "atelier_alliance_certifications" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_alliance_conflicts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "headline" text NOT NULL,
  "partner_firm" text NOT NULL,
  "detected_at" text NOT NULL,
  "severity" text NOT NULL,
  "detail" text DEFAULT '' NOT NULL,
  "recommendation" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_alliance_conf_org" ON "atelier_alliance_conflicts" ("org_id");

-- ============================================================
-- STUDIO
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_studio_open_roles" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "title" text NOT NULL,
  "level" text NOT NULL,
  "location" text NOT NULL,
  "target_start" text NOT NULL,
  "urgency" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "active_candidates" integer DEFAULT 0 NOT NULL,
  "panel_template" text DEFAULT '' NOT NULL,
  "scorecard_id" text DEFAULT '' NOT NULL,
  "take_home_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_studio_roles_org" ON "atelier_studio_open_roles" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_studio_candidates" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "name" text NOT NULL,
  "current_role" text DEFAULT '' NOT NULL,
  "current_employer" text DEFAULT '' NOT NULL,
  "source" text DEFAULT '' NOT NULL,
  "role_title" text NOT NULL,
  "stage" text NOT NULL,
  "active_or_passive" text NOT NULL,
  "role_match_score" double precision DEFAULT 0 NOT NULL,
  "outreach_hook" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_studio_cand_org" ON "atelier_studio_candidates" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_studio_cand_stage" ON "atelier_studio_candidates" ("stage");

CREATE TABLE IF NOT EXISTS "atelier_studio_interview_panels" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "candidate_name" text NOT NULL,
  "role_title" text NOT NULL,
  "scheduled_for" text NOT NULL,
  "status" text NOT NULL,
  "stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_studio_panels_org" ON "atelier_studio_interview_panels" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_studio_reference_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "candidate_name" text NOT NULL,
  "referer_name" text NOT NULL,
  "relationship" text DEFAULT '' NOT NULL,
  "call_mode" text NOT NULL,
  "scheduled_for" text NOT NULL,
  "completed_at" text,
  "would_rehire" text,
  "fit_for_level" text,
  "headline_quote" text DEFAULT '' NOT NULL,
  "inconsistencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_studio_refs_org" ON "atelier_studio_reference_checks" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_studio_offers" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "candidate_name" text NOT NULL,
  "role_title" text NOT NULL,
  "jurisdiction" text NOT NULL,
  "start_date" text NOT NULL,
  "total_at_target_usd_k" integer DEFAULT 0 NOT NULL,
  "market_p25" integer DEFAULT 0 NOT NULL,
  "market_p75" integer DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "band_flag" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_studio_offers_org" ON "atelier_studio_offers" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_studio_referrals" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "referrer" text NOT NULL,
  "candidate" text NOT NULL,
  "via" text DEFAULT '' NOT NULL,
  "role_title" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_studio_refrals_org" ON "atelier_studio_referrals" ("org_id");

-- ============================================================
-- GUARDHOUSE
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_guardhouse_controls" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "title" text NOT NULL,
  "framework" text NOT NULL,
  "owner" text NOT NULL,
  "status" text NOT NULL,
  "last_collected_at" text DEFAULT '' NOT NULL,
  "remediation" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_gh_controls_org" ON "atelier_guardhouse_controls" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_gh_controls_status" ON "atelier_guardhouse_controls" ("status");

CREATE TABLE IF NOT EXISTS "atelier_guardhouse_evidence" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "control_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "collected_at" text NOT NULL,
  "freshness" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_gh_evidence_org" ON "atelier_guardhouse_evidence" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_guardhouse_pentests" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement" text NOT NULL,
  "vendor" text NOT NULL,
  "window_start" text NOT NULL,
  "window_end" text NOT NULL,
  "findings_high" integer DEFAULT 0 NOT NULL,
  "findings_med" integer DEFAULT 0 NOT NULL,
  "findings_low" integer DEFAULT 0 NOT NULL,
  "remediated" integer DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_gh_pentests_org" ON "atelier_guardhouse_pentests" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_guardhouse_vendors" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "vendor" text NOT NULL,
  "direction" text NOT NULL,
  "data_class" text NOT NULL,
  "owner" text NOT NULL,
  "risk" text NOT NULL,
  "renews_at" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_gh_vendors_org" ON "atelier_guardhouse_vendors" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_guardhouse_incidents" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "title" text NOT NULL,
  "severity" text NOT NULL,
  "detected_at" text NOT NULL,
  "phase" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "postmortem_url" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_gh_incidents_org" ON "atelier_guardhouse_incidents" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_guardhouse_dsars" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "subject_masked" text NOT NULL,
  "jurisdiction" text NOT NULL,
  "request_kind" text NOT NULL,
  "intake_at" text NOT NULL,
  "statutory_due_at" text NOT NULL,
  "days_to_deadline" integer DEFAULT 0 NOT NULL,
  "phase" text NOT NULL,
  "discovered_artifacts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_gh_dsars_org" ON "atelier_guardhouse_dsars" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_guardhouse_backups" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "store" text NOT NULL,
  "kind" text NOT NULL,
  "last_success_at" text NOT NULL,
  "status" text NOT NULL,
  "rto_minutes" integer DEFAULT 0 NOT NULL,
  "rpo_minutes" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_gh_backups_org" ON "atelier_guardhouse_backups" ("org_id");

-- ============================================================
-- IP CATALOG
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_ip_code_assets" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "name" text NOT NULL,
  "repo_url" text NOT NULL,
  "owner" text NOT NULL,
  "license" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "used_in_engagements" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "freshness" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ip_code_org" ON "atelier_ip_code_assets" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_ip_oss_dependencies" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "name" text NOT NULL,
  "version" text NOT NULL,
  "ecosystem" text NOT NULL,
  "license" text NOT NULL,
  "compatibility" text NOT NULL,
  "repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rationale" text,
  "exception_until" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ip_oss_org" ON "atelier_ip_oss_dependencies" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_ip_demo_environments" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "owner" text NOT NULL,
  "last_deploy_at" text NOT NULL,
  "shows" text DEFAULT '' NOT NULL,
  "uptime_30d" double precision DEFAULT 0 NOT NULL,
  "script_drift" integer DEFAULT 0 NOT NULL,
  "freshness" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ip_demos_org" ON "atelier_ip_demo_environments" ("org_id");

CREATE TABLE IF NOT EXISTS "atelier_ip_license_grants" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "asset_name" text NOT NULL,
  "grantee" text NOT NULL,
  "engagement_id" text DEFAULT '—' NOT NULL,
  "granted_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "scope" text DEFAULT '' NOT NULL,
  "approved_by" text NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_ip_grants_org" ON "atelier_ip_license_grants" ("org_id");
