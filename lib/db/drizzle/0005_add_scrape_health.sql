ALTER TABLE "arcelik_scrape_logs" ADD COLUMN IF NOT EXISTS "health_status" text;--> statement-breakpoint
ALTER TABLE "arcelik_scrape_logs" ADD COLUMN IF NOT EXISTS "health_alerts" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scrape_logs_health" ON "arcelik_scrape_logs" USING btree ("health_status");
