CREATE TABLE "assessment_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"slug" text NOT NULL,
	"overall_score" double precision NOT NULL,
	"tier" text NOT NULL,
	"sovereign_score" double precision DEFAULT 0 NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"profile" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"use_cases" jsonb,
	"result" jsonb NOT NULL,
	"memo" text,
	"team_token" text,
	"team_role" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_submissions_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "call_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_public_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"role" text,
	"preferred_time" text,
	"message" text,
	"language" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_token" text NOT NULL,
	"slug" text NOT NULL,
	"initiator_name" text NOT NULL,
	"initiator_email" text NOT NULL,
	"company" text NOT NULL,
	"seats" integer DEFAULT 10 NOT NULL,
	"expires_at" timestamp,
	"closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_invitations_team_token_unique" UNIQUE("team_token")
);
--> statement-breakpoint
CREATE TABLE "arcelik_calendar" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" text NOT NULL,
	"campaign_name" text NOT NULL,
	"start_month" integer NOT NULL,
	"end_month" integer NOT NULL,
	"categories" jsonb NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target_segment" text NOT NULL,
	"eligible_categories" jsonb NOT NULL,
	"promotion_type" text NOT NULL,
	"discount_detail" text NOT NULL,
	"headline" text NOT NULL,
	"body_copy" text NOT NULL,
	"messaging_tone" text NOT NULL,
	"target_cities" jsonb NOT NULL,
	"duration_pattern" text NOT NULL,
	"projected_impact" jsonb NOT NULL,
	"banner_description" text NOT NULL,
	"dealer_pos_messaging" text NOT NULL,
	"dealer_sms_notification" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_cities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"population_tier" text NOT NULL,
	"market_share_percent" double precision NOT NULL,
	"avg_price_index" double precision NOT NULL,
	"competitor_strength" jsonb NOT NULL,
	"seasonal_pattern" text NOT NULL,
	"dealer_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_competitor_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"brand" text NOT NULL,
	"competitor_model" text NOT NULL,
	"category" text NOT NULL,
	"competitor_price" integer NOT NULL,
	"arcelik_equivalent_id" text NOT NULL,
	"price_delta_percent" double precision NOT NULL,
	"positioning" text NOT NULL,
	"note" text NOT NULL,
	"source_id" text NOT NULL,
	"price_date" text NOT NULL,
	"data_provenance" text DEFAULT 'manual-verified' NOT NULL,
	"scraped_at" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text NOT NULL,
	"source_date" text NOT NULL,
	"description" text NOT NULL,
	"description_en" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_dealers" (
	"id" text PRIMARY KEY NOT NULL,
	"store_name" text NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"tier" text NOT NULL,
	"compliance_score" integer NOT NULL,
	"monthly_sales_target" integer NOT NULL,
	"current_progress" integer NOT NULL,
	"earned_commission" integer NOT NULL,
	"product_mix" jsonb NOT NULL,
	"stock_levels" jsonb NOT NULL,
	"pending_orders" integer NOT NULL,
	"last_order_date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_kpi_benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"target" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_products" (
	"id" text PRIMARY KEY NOT NULL,
	"model_code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text NOT NULL,
	"price_tier" text NOT NULL,
	"tsf_price" integer NOT NULL,
	"dealer_cost" integer NOT NULL,
	"margin_percent" double precision NOT NULL,
	"energy_class" text NOT NULL,
	"features" jsonb NOT NULL,
	"source_id" text NOT NULL,
	"price_date" text NOT NULL,
	"data_provenance" text DEFAULT 'manual-verified' NOT NULL,
	"scraped_at" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_assessment_team_token" ON "assessment_submissions" USING btree ("team_token");--> statement-breakpoint
CREATE INDEX "idx_assessment_slug" ON "assessment_submissions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_team_invitations_token" ON "team_invitations" USING btree ("team_token");--> statement-breakpoint
CREATE INDEX "idx_arcelik_cp_brand" ON "arcelik_competitor_prices" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "idx_arcelik_cp_category" ON "arcelik_competitor_prices" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_arcelik_dealers_city" ON "arcelik_dealers" USING btree ("city");--> statement-breakpoint
CREATE INDEX "idx_arcelik_products_category" ON "arcelik_products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_arcelik_products_price_tier" ON "arcelik_products" USING btree ("price_tier");