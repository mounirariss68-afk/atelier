CREATE TABLE "atelier_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"name" text NOT NULL,
	"brand_name" text,
	"country" text NOT NULL,
	"sector" text NOT NULL,
	"notes" text,
	"parent_account_id" text,
	"size" text,
	"hq_city" text,
	"primary_currency" text DEFAULT 'USD' NOT NULL,
	"primary_language" text DEFAULT 'en' NOT NULL,
	"tier" text DEFAULT 'C' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"partner_owner_id" text,
	"relationship_strength" double precision DEFAULT 0 NOT NULL,
	"enriched_at" timestamp,
	"source_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strategic_priorities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strategic_priority_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aico_hypothesis" text,
	"pending_profile_updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_admin_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atelier_agent_designs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"process_step_id" text,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"agent_id" text NOT NULL,
	"triggered_by_user_id" text,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"human_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text,
	"status" text DEFAULT 'running' NOT NULL,
	"status_message" text,
	"progress_pct" integer,
	"sources_count" integer,
	"cost_usd" double precision,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"name" text NOT NULL,
	"group_name" text NOT NULL,
	"stage" text NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guardrails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"human_checkpoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runs_last_30d" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"parent_type" text NOT NULL,
	"parent_id" text NOT NULL,
	"file_url" text,
	"title" text NOT NULL,
	"abstract" text,
	"body" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"translated_title" text,
	"translated_body" text,
	"translated_at" timestamp,
	"atelier_promoted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"abstract" text NOT NULL,
	"body_or_file_url" text,
	"provenance" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"promoted_from_engagement_id" text,
	"promoted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_summary" text,
	"ts" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"opportunity_id" text NOT NULL,
	"run_id" text,
	"account_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"buyer_landscape" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"five_c_draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"open_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp,
	"approved_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_calendar_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_id" text NOT NULL,
	"person_type" text DEFAULT 'employee' NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"duration_mins" integer NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engagement_hint" text,
	"source_provider" text DEFAULT 'synthetic' NOT NULL,
	"source_event_id" text,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_charter_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"run_id" text,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hypothesis_tree" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raid_baseline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_workstreams" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mece_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lead_approved_at" timestamp,
	"lead_approved_by_user_id" text,
	"partner_approved_at" timestamp,
	"partner_approved_by_user_id" text,
	"partner_approved_by_name" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_compliance_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_type" text,
	"person_id" text,
	"partner_firm_id" text,
	"kind" text NOT NULL,
	"jurisdiction" text,
	"reference_number_redacted" text,
	"reference_number_last_four" text,
	"encrypted_at_rest" boolean DEFAULT true NOT NULL,
	"issued_date" text,
	"expiry_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_conflict_disclosures" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_type" text NOT NULL,
	"person_id" text NOT NULL,
	"disclosure_text" text NOT NULL,
	"declared_party" text,
	"nature" text,
	"scope_impact" text,
	"declared_at" timestamp DEFAULT now(),
	"last_reviewed_at" timestamp,
	"disclosed_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_contact_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"account_id" text NOT NULL,
	"from_contact_id" text NOT NULL,
	"to_contact_id" text NOT NULL,
	"type" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"account_id" text NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"seniority" text,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"buyer_persona" text,
	"influence_score" integer DEFAULT 3 NOT NULL,
	"disposition" text DEFAULT 'unknown' NOT NULL,
	"last_contact_at" timestamp,
	"contact_owner_id" text,
	"notes" text,
	"source_url" text,
	"confidence" text DEFAULT 'inferred' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_contractor_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"payee_user_id" text NOT NULL,
	"payee_person_type" text DEFAULT 'contractor' NOT NULL,
	"payee_name" text NOT NULL,
	"engagement_id" text NOT NULL,
	"week_iso" text NOT NULL,
	"hours" double precision DEFAULT 0 NOT NULL,
	"rate_per_hour" double precision DEFAULT 0 NOT NULL,
	"rate_currency" text DEFAULT 'USD' NOT NULL,
	"cost_amount" double precision DEFAULT 0 NOT NULL,
	"cost_currency" text DEFAULT 'USD' NOT NULL,
	"fx_rate" double precision DEFAULT 1 NOT NULL,
	"usd_amount" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"requires_partner_approval" boolean DEFAULT false NOT NULL,
	"proposal_run_id" text,
	"evidence_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"partner_approved_by_user_id" text,
	"partner_approved_at" timestamp,
	"partner_rationale" text,
	"rejected_at" timestamp,
	"rejected_reason" text,
	"paid_at" timestamp,
	"paid_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_contractors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"country" text,
	"vendor_entity" text,
	"master_agreement_ref" text,
	"contract_type" text,
	"contract_start" text,
	"contract_end" text,
	"day_rate_amount" double precision,
	"day_rate_internal_cost" double precision,
	"day_rate_currency" text DEFAULT 'USD' NOT NULL,
	"payment_terms_days" integer,
	"vat_treatment" text,
	"engagement_scope_default" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contracting_entity" text,
	"conflicts_disclosed_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" text,
	"end_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_corporate_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"provider" text NOT NULL,
	"cardholder_user_id" text NOT NULL,
	"last4" text NOT NULL,
	"label" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"monthly_limit_amount" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"title" text NOT NULL,
	"account_id" text,
	"client_name" text NOT NULL,
	"sector" text NOT NULL,
	"engagement_type" text NOT NULL,
	"outcome_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"anonymization_status" text DEFAULT 'redacted' NOT NULL,
	"redacted_abstract" text NOT NULL,
	"attributed_abstract" text,
	"evidence_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_asset_id" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_deal_pricings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"opportunity_id" text NOT NULL,
	"rate_card_id" text NOT NULL,
	"pricing_model" text DEFAULT 'time_and_materials' NOT NULL,
	"duration_weeks" double precision DEFAULT 8 NOT NULL,
	"team_mix" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_cost_usd" double precision DEFAULT 0 NOT NULL,
	"computed_price_usd" double precision DEFAULT 0 NOT NULL,
	"computed_margin_pct" double precision DEFAULT 0 NOT NULL,
	"target_margin_pct" double precision DEFAULT 0.55 NOT NULL,
	"margin_lock_status" text DEFAULT 'green' NOT NULL,
	"partner_override_id" text,
	"partner_override_at" timestamp,
	"partner_override_rationale" text,
	"countersign_partner_id" text,
	"countersign_at" timestamp,
	"countersign_rationale" text,
	"alternative_structures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pricing_strategist_brief_id" text,
	"pricing_strategist_run_id" text,
	"pricing_strategist_output" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_deliverable_publishes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"deliverable_id" text NOT NULL,
	"deliverable_version_id" text,
	"engagement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"published_by_atelier_user_id" text NOT NULL,
	"published_by_name" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"sentinel_run_id" text,
	"sentinel_status" text DEFAULT 'pass' NOT NULL,
	"sentinel_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publish_allowed" boolean DEFAULT true NOT NULL,
	"override_rationale" text,
	"overridden_by_atelier_user_id" text,
	"downloads_allowed" boolean DEFAULT false NOT NULL,
	"watermark_required" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_deliverable_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"deliverable_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'html' NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synthesis_critic_report" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_deliverables" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"hypothesis_id" text,
	"current_version_id" text,
	"due_date" text,
	"critic_readiness" text,
	"critic_report_summary" text,
	"partner_approved_at" timestamp,
	"partner_approved_by_user_id" text,
	"partner_approved_by_name" text,
	"partner_rationale" text,
	"lock_overridden" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp,
	"sent_by_user_id" text,
	"client_visibility" text DEFAULT 'internal' NOT NULL,
	"latest_publish_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_employees" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"user_id" text,
	"employee_id_external" text,
	"full_name" text NOT NULL,
	"preferred_name" text,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"seniority" text DEFAULT 'consultant' NOT NULL,
	"title" text,
	"home_office" text,
	"country" text,
	"payroll_country" text,
	"employment_type" text DEFAULT 'FTE' NOT NULL,
	"employment_status" text DEFAULT 'active' NOT NULL,
	"employing_entity" text,
	"start_date" text,
	"end_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"iban" text,
	"swift" text,
	"notice_period_days" integer DEFAULT 30 NOT NULL,
	"base_currency" text,
	"base_compensation" double precision,
	"utilization_target_pct" integer,
	"partner_economics_id" text,
	"avatar_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_engagement_access" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"allocation_pct" integer DEFAULT 0 NOT NULL,
	"scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"granted_by_user_id" text,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"opportunity_id" text,
	"account_id" text NOT NULL,
	"plm_stage" text NOT NULL,
	"partner_owner_id" text NOT NULL,
	"engagement_lead_id" text NOT NULL,
	"charter" jsonb,
	"workstreams" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"value_case" jsonb,
	"start_date" text NOT NULL,
	"planned_end_date" text NOT NULL,
	"raid_status" text DEFAULT 'green' NOT NULL,
	"deliverables_due_this_week" integer DEFAULT 0 NOT NULL,
	"default_language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_expense_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"category" text NOT NULL,
	"applies_to_role" text,
	"applies_to_country" text,
	"cap_amount_usd" double precision,
	"cap_unit" text,
	"hard_block_amount_usd" double precision,
	"approval_threshold_usd" double precision,
	"flight_class_max" text,
	"rationale" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_id" text NOT NULL,
	"person_type" text DEFAULT 'employee' NOT NULL,
	"engagement_id" text,
	"expense_date" text NOT NULL,
	"capture_source" text NOT NULL,
	"card_id" text,
	"merchant" text,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"fx_rate" double precision DEFAULT 1 NOT NULL,
	"fx_rate_date" text,
	"usd_amount" double precision DEFAULT 0 NOT NULL,
	"vat_amount" double precision DEFAULT 0 NOT NULL,
	"vat_currency" text,
	"vat_treatment" text DEFAULT 'none' NOT NULL,
	"vat_country" text,
	"client_billable" boolean DEFAULT false NOT NULL,
	"markup_pct" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"policy_status" text DEFAULT 'green' NOT NULL,
	"policy_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"override_rationale" text,
	"auditor_run_id" text,
	"auditor_proposal" jsonb DEFAULT 'null'::jsonb,
	"receipt_file_ref" text,
	"receipt_fixture_key" text,
	"receipt_encrypted_at_rest" boolean DEFAULT true NOT NULL,
	"ocr_payload" jsonb DEFAULT 'null'::jsonb,
	"ocr_payload_redacted_at" timestamp,
	"summary" text,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"approved_by_user_id" text,
	"rejected_at" timestamp,
	"rejected_reason" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_fx_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"date" text NOT NULL,
	"base" text DEFAULT 'USD' NOT NULL,
	"quote" text NOT NULL,
	"rate" double precision NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atelier_hypothesis_trees" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"root" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"worker_type" text NOT NULL,
	"person_draft" jsonb NOT NULL,
	"sent_by_user_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"accepted_at" timestamp,
	"accepted_person_id" text,
	"revoked_at" timestamp,
	"revoked_by_user_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_invoice_line_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"composed_at" timestamp DEFAULT now() NOT NULL,
	"composed_by_user_id" text,
	"composer_run_id" text,
	"rate_card_id" text,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"exported_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_margin_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"name" text DEFAULT 'default' NOT NULL,
	"target_margin_pct" double precision DEFAULT 0.55 NOT NULL,
	"amber_threshold_pct" double precision DEFAULT 0.5 NOT NULL,
	"red_threshold_pct" double precision DEFAULT 0.45 NOT NULL,
	"two_partner_threshold_pct" double precision DEFAULT 0.45 NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"parent_type" text NOT NULL,
	"parent_id" text NOT NULL,
	"mode" text DEFAULT 'upload' NOT NULL,
	"kind" text DEFAULT 'discovery' NOT NULL,
	"title" text NOT NULL,
	"date" text NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript_id" text,
	"summary" text,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"committed_at" timestamp,
	"committed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp,
	"channel" text DEFAULT 'in_app',
	"subject" text,
	"body" text,
	"ref_type" text,
	"ref_id" text,
	"scheduled_for" timestamp,
	"sent_at" timestamp,
	"status" text DEFAULT 'queued',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_offboarding_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"offboarding_id" text NOT NULL,
	"sort_key" integer DEFAULT 0 NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_role" text,
	"deadline" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp,
	"completed_by_user_id" text,
	"blocked_reason" text,
	"is_reassignment_gate" boolean DEFAULT false NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_offboardings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_type" text NOT NULL,
	"person_id" text NOT NULL,
	"initiated_at" timestamp DEFAULT now() NOT NULL,
	"initiated_by_user_id" text,
	"last_working_date" text,
	"completed_at" timestamp,
	"blocked_at" timestamp,
	"blocked_reason" text,
	"status" text DEFAULT 'in_flight' NOT NULL,
	"audit_pack_url" text,
	"audit_pack_signed_by_user_id" text,
	"audit_pack_signed_at" timestamp,
	"reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_onboarding_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"onboarding_id" text NOT NULL,
	"sort_key" integer DEFAULT 0 NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_role" text,
	"deadline" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp,
	"completed_by_user_id" text,
	"blocked_reason" text,
	"is_compliance_gate" boolean DEFAULT false NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_onboardings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_type" text NOT NULL,
	"person_id" text NOT NULL,
	"invitation_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"target_start_date" text,
	"completed_at" timestamp,
	"blocked_at" timestamp,
	"blocked_reason" text,
	"status" text DEFAULT 'in_flight' NOT NULL,
	"owner_user_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"account_id" text NOT NULL,
	"buyer_persona" text,
	"offering_anchor" text,
	"plm_stage" text NOT NULL,
	"sales_stage" text DEFAULT 'lead' NOT NULL,
	"partner_owner_id" text NOT NULL,
	"engagement_lead_id" text NOT NULL,
	"deal_size_hypothesis" double precision NOT NULL,
	"probability_pct" double precision NOT NULL,
	"qualify_5c" jsonb,
	"go_no_go_decision" jsonb,
	"next_milestone" text NOT NULL,
	"next_milestone_date" text,
	"source_lead" text NOT NULL,
	"days_in_stage" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_opportunity_stage_transitions" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"transitioned_by_user_id" text NOT NULL,
	"rationale_text" text,
	"evidence_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prior_probability_pct" double precision,
	"new_probability_pct" double precision,
	"next_milestone" text,
	"next_milestone_date" text,
	"agent_recommended" boolean DEFAULT false NOT NULL,
	"partner_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atelier_pane_a_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"priority" text NOT NULL,
	"href_kind" text NOT NULL,
	"href_target_id" text NOT NULL,
	"due_label" text NOT NULL,
	"sort_key" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_partner_economics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"employee_id" text NOT NULL,
	"model" text,
	"revenue_share_pct" double precision,
	"base_amount" double precision,
	"currency" text,
	"effective_from" text,
	"effective_to" text,
	"profit_share_bps" integer DEFAULT 0 NOT NULL,
	"vesting_schedule" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_partner_firm_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"partner_firm_id" text NOT NULL,
	"partner_firm_resource_id" text,
	"resource_name" text NOT NULL,
	"week_iso" text NOT NULL,
	"work_date" text,
	"hours" double precision DEFAULT 0 NOT NULL,
	"cost_amount" double precision DEFAULT 0 NOT NULL,
	"cost_currency" text DEFAULT 'USD' NOT NULL,
	"csv_upload_ref" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_user_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_partner_firm_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"partner_firm_id" text NOT NULL,
	"partner_firm_name" text NOT NULL,
	"engagement_id" text NOT NULL,
	"week_iso" text NOT NULL,
	"hours" double precision DEFAULT 0 NOT NULL,
	"cost_amount" double precision DEFAULT 0 NOT NULL,
	"cost_currency" text DEFAULT 'USD' NOT NULL,
	"fx_rate" double precision DEFAULT 1 NOT NULL,
	"usd_amount" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposal_run_id" text,
	"evidence_firm_hour_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"partner_approved_by_user_id" text,
	"partner_approved_at" timestamp,
	"partner_rationale" text,
	"rejected_at" timestamp,
	"rejected_reason" text,
	"paid_at" timestamp,
	"paid_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_partner_firm_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"partner_firm_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"role" text,
	"role_on_engagement" text,
	"seniority" text,
	"seniority_band" text,
	"country" text,
	"seconded_to_engagement_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_to_aico_per_day" double precision,
	"visible_to_client_in_team_tab" boolean DEFAULT false NOT NULL,
	"partner_firm_pm_user_id" text,
	"day_rate_amount" double precision,
	"day_rate_currency" text DEFAULT 'USD' NOT NULL,
	"start_date" text,
	"end_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_partner_firms" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"hq_country" text,
	"master_agreement_ref" text,
	"master_agreement_url" text,
	"master_agreement_status" text DEFAULT 'active' NOT NULL,
	"master_agreement_end" text,
	"primary_contact_user_id" text,
	"default_payment_terms_days" integer,
	"rate_card_id" text,
	"default_billing_currency" text,
	"insurance_status" text,
	"contact_name" text,
	"contact_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_person_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_type" text NOT NULL,
	"person_id" text NOT NULL,
	"kind" text NOT NULL,
	"client_account_id" text,
	"title" text NOT NULL,
	"file_ref" text,
	"file_url" text,
	"signed_at" timestamp,
	"uploaded_by_user_id" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_person_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_type" text NOT NULL,
	"person_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"proficiency" integer DEFAULT 3 NOT NULL,
	"source" text NOT NULL,
	"evidence_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_summary" text,
	"confidence" double precision,
	"status" text DEFAULT 'active' NOT NULL,
	"verified_by_user_id" text,
	"verified_at" timestamp,
	"proposed_by_agent_id" text,
	"proposed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_pov_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"pov_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citation_coverage" double precision,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_povs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"opportunity_id" text NOT NULL,
	"title" text NOT NULL,
	"audience" text,
	"objective" text,
	"status" text DEFAULT 'outline' NOT NULL,
	"outline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_version_id" text,
	"run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_processes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"name" text NOT NULL,
	"diagram" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"agent_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"eval_score" double precision,
	"author" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_proposal_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"proposal_id" text NOT NULL,
	"section_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_agent" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"opportunity_id" text NOT NULL,
	"run_id" text,
	"title" text NOT NULL,
	"sections_required" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"team_proposed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pricing_intent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pricing_model" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"win_themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compliance_matrix" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"docx_url" text,
	"pdf_url" text,
	"deadline" timestamp,
	"partner_approved_at" timestamp,
	"partner_approved_by_user_id" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_prototypes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"opportunity_id" text,
	"engagement_id" text,
	"run_id" text,
	"name" text NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"replit_prompt_md" text DEFAULT '' NOT NULL,
	"build_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"demo_storyboard" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lead_approved_at" timestamp,
	"lead_approved_by_user_id" text,
	"partner_approved_at" timestamp,
	"partner_approved_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_raid_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"owner_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"due_date" text,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_rate_card_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"rate_card_id" text NOT NULL,
	"role" text NOT NULL,
	"seniority" text NOT NULL,
	"day_rate_internal_cost" double precision NOT NULL,
	"day_rate_client_price" double precision NOT NULL,
	"overhead_pct" double precision DEFAULT 0.25 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_rate_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"geography" text NOT NULL,
	"currency" text NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"source_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"description" text,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_user_id" text,
	"schedule" text DEFAULT 'none' NOT NULL,
	"schedule_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned_to_home" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"last_run_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_research_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"opportunity_id" text NOT NULL,
	"run_id" text,
	"topic" text NOT NULL,
	"statement" text NOT NULL,
	"source_url" text,
	"source_title" text,
	"retrieved_at" timestamp,
	"confidence" text DEFAULT 'amber' NOT NULL,
	"snippet" text,
	"promoted" boolean DEFAULT false NOT NULL,
	"promoted_at" timestamp,
	"promoted_by_user_id" text,
	"included_in_brief" boolean DEFAULT false NOT NULL,
	"included_in_pov" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_salon_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"salon_user_id" text,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_summary" text,
	"ts" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_salon_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"deliverable_id" text,
	"publish_id" text,
	"kind" text NOT NULL,
	"headline" text NOT NULL,
	"rationale" text,
	"decided_by_salon_user_id" text NOT NULL,
	"decided_by_name" text NOT NULL,
	"decided_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_salon_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"salon_user_id" text NOT NULL,
	"engagement_id" text NOT NULL,
	"kind" text NOT NULL,
	"headline" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_salon_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"related_deliverable_id" text,
	"raised_by_salon_user_id" text NOT NULL,
	"raised_by_name" text NOT NULL,
	"raised_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to_atelier_user_id" text,
	"resolved_at" timestamp,
	"resolution_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_salon_user_engagement_access" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"salon_user_id" text NOT NULL,
	"engagement_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"downloads_allowed" boolean,
	"can_approve" boolean DEFAULT false NOT NULL,
	"granted_by_atelier_user_id" text,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_salon_users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"account_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"title" text,
	"avatar_url" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by_atelier_user_id" text,
	"invited_at" timestamp,
	"activated_at" timestamp,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_salon_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"engagement_id" text NOT NULL,
	"account_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"accent_color" text DEFAULT '#0B5CFF' NOT NULL,
	"client_logo_url" text,
	"aico_logo_url" text,
	"eyebrow_text" text,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"rtl_enabled" boolean DEFAULT false NOT NULL,
	"watermark_enabled" boolean DEFAULT true NOT NULL,
	"downloads_allowed_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_timesheet_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"week_id" text NOT NULL,
	"person_id" text NOT NULL,
	"person_type" text NOT NULL,
	"work_date" text NOT NULL,
	"engagement_id" text,
	"activity_code" text,
	"hours" double precision DEFAULT 0 NOT NULL,
	"billable" boolean DEFAULT false NOT NULL,
	"narrative" text,
	"source" text DEFAULT 'human' NOT NULL,
	"drafted_by_agent_id" text,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_timesheet_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"week_id" text NOT NULL,
	"person_id" text NOT NULL,
	"work_date" text NOT NULL,
	"signal_type" text NOT NULL,
	"source_ref_type" text NOT NULL,
	"source_ref_id" text NOT NULL,
	"engagement_hint" text,
	"evidence_summary" text NOT NULL,
	"weight_hours" double precision DEFAULT 0 NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atelier_timesheet_weeks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_id" text NOT NULL,
	"person_type" text NOT NULL,
	"week_iso" text NOT NULL,
	"week_start_date" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"submitted_by_user_id" text,
	"lead_approved_at" timestamp,
	"lead_approved_by_user_id" text,
	"partner_approved_at" timestamp,
	"partner_approved_by_user_id" text,
	"rejected_at" timestamp,
	"rejected_by_user_id" text,
	"rejection_reason" text,
	"total_hours" double precision DEFAULT 0 NOT NULL,
	"billable_hours" double precision DEFAULT 0 NOT NULL,
	"suspicious_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_transcripts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"source_file_url" text,
	"cleaned_text" text,
	"speaker_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"role" text NOT NULL,
	"role_label" text NOT NULL,
	"title" text NOT NULL,
	"avatar_url" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_utilization_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"person_id" text NOT NULL,
	"person_type" text DEFAULT 'employee' NOT NULL,
	"week_iso" text NOT NULL,
	"week_start_date" text NOT NULL,
	"billable_hours" double precision DEFAULT 0 NOT NULL,
	"internal_hours" double precision DEFAULT 0 NOT NULL,
	"leave_hours" double precision DEFAULT 0 NOT NULL,
	"total_hours" double precision DEFAULT 0 NOT NULL,
	"available_hours" double precision DEFAULT 40 NOT NULL,
	"utilization_pct" double precision DEFAULT 0 NOT NULL,
	"target_pct" double precision DEFAULT 0 NOT NULL,
	"engagement_mix" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atelier_vat_register" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"expense_id" text NOT NULL,
	"correction_of_id" text,
	"expense_date" text NOT NULL,
	"country" text NOT NULL,
	"treatment" text NOT NULL,
	"rate" double precision DEFAULT 0 NOT NULL,
	"net_amount" double precision DEFAULT 0 NOT NULL,
	"vat_amount" double precision DEFAULT 0 NOT NULL,
	"gross_amount" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"usd_net" double precision DEFAULT 0 NOT NULL,
	"usd_vat" double precision DEFAULT 0 NOT NULL,
	"usd_gross" double precision DEFAULT 0 NOT NULL,
	"merchant" text,
	"summary" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "atelier_winloss_debriefs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"opportunity_id" text NOT NULL,
	"outcome" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"seller_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seller_perceived_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seller_notes" text,
	"seller_done_at" timestamp,
	"partner_owner_user_id" text,
	"engagement_lead_user_id" text,
	"buyer_interview_scheduled_at" timestamp,
	"buyer_interview_conducted_by_agent_run_id" text,
	"buyer_interview_conducted_by_user_id" text,
	"buyer_transcript" text,
	"buyer_transcript_uploaded_at" timestamp,
	"buyer_responses" jsonb,
	"buyer_authentic_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden_competitor" text,
	"themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"what_we_would_do_differently" text,
	"lessons_to_atelier_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_atelier_lessons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interviewer_run_id" text,
	"last_run_id" text,
	"synthesized_at" timestamp,
	"approved_at" timestamp,
	"approved_by_user_id" text,
	"conductor_role" text,
	"published_at" timestamp,
	"published_by_user_id" text,
	"due_at" timestamp,
	"overdue_red_at" timestamp,
	"closed_without_debrief_override_rationale" text,
	"closed_without_debrief_override_by_user_id" text,
	"closed_without_debrief_override_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_win_themes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"tag" text NOT NULL,
	"polarity" text DEFAULT 'win' NOT NULL,
	"support_count" integer DEFAULT 0 NOT NULL,
	"contributing_debrief_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offering_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sector_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"positioning_line" text,
	"last_seen_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "atelier_countries" (
	"iso_alpha_2" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"iso_alpha_3" text NOT NULL,
	"iso_numeric" text NOT NULL,
	"display_name_en" text NOT NULL,
	"display_name_ar" text,
	"display_name_tr" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"region" text NOT NULL,
	"sub_region" text,
	"flag_emoji" text,
	"primary_currency" text,
	"primary_language" text,
	"dial_code" text,
	"vat_default_pct" integer,
	"is_gcc" boolean DEFAULT false NOT NULL,
	"is_aico_target_market" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"display_order_override" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "atelier_industries" (
	"code" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"display_name_en" text NOT NULL,
	"display_name_ar" text,
	"short_description" text,
	"display_order" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "atelier_sub_industries" (
	"code" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'aico' NOT NULL,
	"industry_code" text NOT NULL,
	"display_name_en" text NOT NULL,
	"display_name_ar" text,
	"short_description" text,
	"display_order" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"default_offering_anchor" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_user_id" text
);
--> statement-breakpoint
CREATE INDEX "idx_atelier_accounts_org" ON "atelier_accounts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_accounts_tier" ON "atelier_accounts" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "idx_atelier_accounts_partner" ON "atelier_accounts" USING btree ("partner_owner_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_runs_agent" ON "atelier_agent_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_runs_status" ON "atelier_agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_art_parent" ON "atelier_artifacts" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_assets_org" ON "atelier_assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_assets_kind" ON "atelier_assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_atelier_audit_entity" ON "atelier_audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_audit_ts" ON "atelier_audit_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "idx_atelier_audit_org" ON "atelier_audit_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_briefs_opp" ON "atelier_briefs" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_cal_person_date" ON "atelier_calendar_events" USING btree ("person_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_atelier_cal_org" ON "atelier_calendar_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_charterv_eng" ON "atelier_charter_versions" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_compliance_org" ON "atelier_compliance_records" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_compliance_person" ON "atelier_compliance_records" USING btree ("person_type","person_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_compliance_kind" ON "atelier_compliance_records" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_atelier_compliance_expiry" ON "atelier_compliance_records" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "idx_atelier_conflict_org" ON "atelier_conflict_disclosures" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_conflict_person" ON "atelier_conflict_disclosures" USING btree ("person_type","person_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_contact_rels_org" ON "atelier_contact_relationships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_contact_rels_account" ON "atelier_contact_relationships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_contact_rels_from" ON "atelier_contact_relationships" USING btree ("from_contact_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_contacts_org" ON "atelier_contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_contacts_account" ON "atelier_contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_contacts_disposition" ON "atelier_contacts" USING btree ("disposition");--> statement-breakpoint
CREATE INDEX "idx_atelier_cp_eng_week" ON "atelier_contractor_payments" USING btree ("engagement_id","week_iso");--> statement-breakpoint
CREATE INDEX "idx_atelier_cp_payee_status" ON "atelier_contractor_payments" USING btree ("payee_user_id","status");--> statement-breakpoint
CREATE INDEX "idx_atelier_cp_status" ON "atelier_contractor_payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_atelier_cp_payee_eng_week" ON "atelier_contractor_payments" USING btree ("payee_user_id","engagement_id","week_iso");--> statement-breakpoint
CREATE INDEX "idx_atelier_contractors_org" ON "atelier_contractors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_contractors_status" ON "atelier_contractors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_cards_holder" ON "atelier_corporate_cards" USING btree ("cardholder_user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_cards_org" ON "atelier_corporate_cards" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_credentials_org" ON "atelier_credentials" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_credentials_account" ON "atelier_credentials" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_credentials_sector" ON "atelier_credentials" USING btree ("sector");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_atelier_dealpricing_opp" ON "atelier_deal_pricings" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_dealpricing_status" ON "atelier_deal_pricings" USING btree ("margin_lock_status");--> statement-breakpoint
CREATE INDEX "idx_atelier_deliv_publish_deliv" ON "atelier_deliverable_publishes" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_deliv_publish_eng" ON "atelier_deliverable_publishes" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_dv_deliv" ON "atelier_deliverable_versions" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_deliv_eng" ON "atelier_deliverables" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_employees_org" ON "atelier_employees" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_employees_user" ON "atelier_employees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_employees_status" ON "atelier_employees" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_atelier_employees_email" ON "atelier_employees" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_atelier_eng_access" ON "atelier_engagement_access" USING btree ("engagement_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_eng_access_user" ON "atelier_engagement_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_eng_access_status" ON "atelier_engagement_access" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_eng_org" ON "atelier_engagements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_eng_account" ON "atelier_engagements" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_policy_cat" ON "atelier_expense_policies" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_atelier_expense_person_date" ON "atelier_expenses" USING btree ("person_id","expense_date");--> statement-breakpoint
CREATE INDEX "idx_atelier_expense_eng_status" ON "atelier_expenses" USING btree ("engagement_id","status");--> statement-breakpoint
CREATE INDEX "idx_atelier_expense_status" ON "atelier_expenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_expense_org" ON "atelier_expenses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_atelier_fx_date_pair" ON "atelier_fx_rates" USING btree ("date","base","quote");--> statement-breakpoint
CREATE INDEX "idx_atelier_fx_date" ON "atelier_fx_rates" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_atelier_invitations_org" ON "atelier_invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_invitations_status" ON "atelier_invitations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_ild_eng" ON "atelier_invoice_line_drafts" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_ild_status" ON "atelier_invoice_line_drafts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_mtg_parent" ON "atelier_meetings" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_notif_user" ON "atelier_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_notif_org" ON "atelier_notifications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_notifs_status" ON "atelier_notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_offb_steps_org" ON "atelier_offboarding_steps" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_offb_steps_offb" ON "atelier_offboarding_steps" USING btree ("offboarding_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_offb_steps_status" ON "atelier_offboarding_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_offb_org" ON "atelier_offboardings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_offb_person" ON "atelier_offboardings" USING btree ("person_type","person_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_offb_status" ON "atelier_offboardings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_onb_steps_org" ON "atelier_onboarding_steps" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_onb_steps_onb" ON "atelier_onboarding_steps" USING btree ("onboarding_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_onb_steps_status" ON "atelier_onboarding_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_onboardings_org" ON "atelier_onboardings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_onboardings_person" ON "atelier_onboardings" USING btree ("person_type","person_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_onboardings_status" ON "atelier_onboardings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_opps_org" ON "atelier_opportunities" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_opps_stage" ON "atelier_opportunities" USING btree ("plm_stage");--> statement-breakpoint
CREATE INDEX "idx_atelier_opps_sales_stage" ON "atelier_opportunities" USING btree ("sales_stage");--> statement-breakpoint
CREATE INDEX "idx_atelier_opps_account" ON "atelier_opportunities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_opp_transitions_opp" ON "atelier_opportunity_stage_transitions" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_opp_transitions_created" ON "atelier_opportunity_stage_transitions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_atelier_panea_user" ON "atelier_pane_a_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_panea_org" ON "atelier_pane_a_items" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_partner_econ_org" ON "atelier_partner_economics" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_partner_econ_emp" ON "atelier_partner_economics" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_pfh_eng" ON "atelier_partner_firm_hours" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_pfh_firm" ON "atelier_partner_firm_hours" USING btree ("partner_firm_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_pfh_week" ON "atelier_partner_firm_hours" USING btree ("week_iso");--> statement-breakpoint
CREATE INDEX "idx_atelier_pfi_eng_week" ON "atelier_partner_firm_invoices" USING btree ("engagement_id","week_iso");--> statement-breakpoint
CREATE INDEX "idx_atelier_pfi_firm_status" ON "atelier_partner_firm_invoices" USING btree ("partner_firm_id","status");--> statement-breakpoint
CREATE INDEX "idx_atelier_pfi_status" ON "atelier_partner_firm_invoices" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_atelier_pfi_firm_eng_week" ON "atelier_partner_firm_invoices" USING btree ("partner_firm_id","engagement_id","week_iso");--> statement-breakpoint
CREATE INDEX "idx_atelier_partner_firm_res_org" ON "atelier_partner_firm_resources" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_partner_firm_res_firm" ON "atelier_partner_firm_resources" USING btree ("partner_firm_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_partner_firms_org" ON "atelier_partner_firms" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_person_docs_org" ON "atelier_person_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_person_docs_person" ON "atelier_person_documents" USING btree ("person_type","person_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_person_skills_person" ON "atelier_person_skills" USING btree ("person_type","person_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_person_skills_skill" ON "atelier_person_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_person_skills_source" ON "atelier_person_skills" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_atelier_person_skills_status" ON "atelier_person_skills" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_atelier_person_skills" ON "atelier_person_skills" USING btree ("person_type","person_id","skill_id","source");--> statement-breakpoint
CREATE INDEX "idx_atelier_povv_pov" ON "atelier_pov_versions" USING btree ("pov_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_povs_opp" ON "atelier_povs" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_prompts_agent" ON "atelier_prompts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_propsec_proposal" ON "atelier_proposal_sections" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_atelier_propsec" ON "atelier_proposal_sections" USING btree ("proposal_id","section_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_proposals_opp" ON "atelier_proposals" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_proto_opp" ON "atelier_prototypes" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_proto_eng" ON "atelier_prototypes" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_raid_eng" ON "atelier_raid_items" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_rcrows_card" ON "atelier_rate_card_rows" USING btree ("rate_card_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_reports_owner" ON "atelier_reports" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_reports_template" ON "atelier_reports" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_facts_opp" ON "atelier_research_facts" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_audit_eng" ON "atelier_salon_audit_events" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_audit_user" ON "atelier_salon_audit_events" USING btree ("salon_user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_audit_ts" ON "atelier_salon_audit_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_dec_eng" ON "atelier_salon_decisions" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_dec_deliv" ON "atelier_salon_decisions" USING btree ("deliverable_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_notif_user" ON "atelier_salon_notifications" USING btree ("salon_user_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_notif_eng" ON "atelier_salon_notifications" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_req_eng" ON "atelier_salon_requests" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_req_status" ON "atelier_salon_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_atelier_salon_access" ON "atelier_salon_user_engagement_access" USING btree ("salon_user_id","engagement_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_access_eng" ON "atelier_salon_user_engagement_access" USING btree ("engagement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_atelier_salon_users_email" ON "atelier_salon_users" USING btree ("org_id","account_id","email");--> statement-breakpoint
CREATE INDEX "idx_atelier_salon_users_account" ON "atelier_salon_users" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_atelier_salon_ws_eng" ON "atelier_salon_workspaces" USING btree ("engagement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_atelier_salon_ws_slug" ON "atelier_salon_workspaces" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "idx_atelier_skills_org" ON "atelier_skills" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_skills_kind" ON "atelier_skills" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_atelier_skills_slug" ON "atelier_skills" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "idx_atelier_ts_entry_person_date" ON "atelier_timesheet_entries" USING btree ("person_id","work_date");--> statement-breakpoint
CREATE INDEX "idx_atelier_ts_entry_eng_date" ON "atelier_timesheet_entries" USING btree ("engagement_id","work_date");--> statement-breakpoint
CREATE INDEX "idx_atelier_ts_entry_status" ON "atelier_timesheet_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_ts_entry_week" ON "atelier_timesheet_entries" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_ts_signal_week" ON "atelier_timesheet_signals" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_ts_signal_person_date" ON "atelier_timesheet_signals" USING btree ("person_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_atelier_ts_week" ON "atelier_timesheet_weeks" USING btree ("person_id","week_iso");--> statement-breakpoint
CREATE INDEX "idx_atelier_ts_week_status" ON "atelier_timesheet_weeks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_ts_week_org" ON "atelier_timesheet_weeks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_users_org" ON "atelier_users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_users_role" ON "atelier_users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_atelier_utilization_snap" ON "atelier_utilization_snapshots" USING btree ("person_id","week_iso");--> statement-breakpoint
CREATE INDEX "idx_atelier_utilization_snap_week" ON "atelier_utilization_snapshots" USING btree ("week_iso");--> statement-breakpoint
CREATE INDEX "idx_atelier_utilization_snap_org" ON "atelier_utilization_snapshots" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_vat_country_treatment" ON "atelier_vat_register" USING btree ("country","treatment");--> statement-breakpoint
CREATE INDEX "idx_atelier_vat_date" ON "atelier_vat_register" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "idx_atelier_vat_expense" ON "atelier_vat_register" USING btree ("expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_atelier_winloss_opp" ON "atelier_winloss_debriefs" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_winloss_status" ON "atelier_winloss_debriefs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_winloss_outcome" ON "atelier_winloss_debriefs" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "idx_atelier_win_themes_tag" ON "atelier_win_themes" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "idx_atelier_win_themes_polarity" ON "atelier_win_themes" USING btree ("polarity");--> statement-breakpoint
CREATE INDEX "idx_atelier_countries_org" ON "atelier_countries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_countries_region" ON "atelier_countries" USING btree ("region");--> statement-breakpoint
CREATE INDEX "idx_atelier_countries_status" ON "atelier_countries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_industries_org" ON "atelier_industries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_industries_status" ON "atelier_industries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_atelier_sub_industries_org" ON "atelier_sub_industries" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_atelier_sub_industries_industry" ON "atelier_sub_industries" USING btree ("industry_code");--> statement-breakpoint
CREATE INDEX "idx_atelier_sub_industries_status" ON "atelier_sub_industries" USING btree ("status");