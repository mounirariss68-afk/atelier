CREATE TABLE "arcelik_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"record_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"brand" text NOT NULL,
	"model_code" text NOT NULL,
	"price" integer NOT NULL,
	"previous_price" integer,
	"price_change_percent" double precision,
	"source" text NOT NULL,
	"scrape_run_id" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_scrape_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"scraped_counts" jsonb,
	"matched_products" integer,
	"matched_competitors" integer,
	"total_products" integer,
	"total_competitors" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "idx_price_history_ref" ON "arcelik_price_history" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "idx_price_history_brand" ON "arcelik_price_history" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "idx_price_history_recorded" ON "arcelik_price_history" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_price_history_type" ON "arcelik_price_history" USING btree ("record_type");--> statement-breakpoint
CREATE INDEX "idx_scrape_logs_status" ON "arcelik_scrape_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_scrape_logs_started" ON "arcelik_scrape_logs" USING btree ("started_at");