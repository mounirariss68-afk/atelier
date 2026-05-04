CREATE TABLE "arcelik_marketplace_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"marketplace" text NOT NULL,
	"marketplace_product_id" text NOT NULL,
	"brand" text NOT NULL,
	"category" text NOT NULL,
	"price" integer NOT NULL,
	"previous_price" integer,
	"price_change_percent" double precision,
	"arcelik_product_id" text,
	"scrape_run_id" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_mp_history_marketplace" ON "arcelik_marketplace_price_history" USING btree ("marketplace");--> statement-breakpoint
CREATE INDEX "idx_mp_history_pid" ON "arcelik_marketplace_price_history" USING btree ("marketplace_product_id");--> statement-breakpoint
CREATE INDEX "idx_mp_history_brand" ON "arcelik_marketplace_price_history" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "idx_mp_history_recorded" ON "arcelik_marketplace_price_history" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_mp_history_run" ON "arcelik_marketplace_price_history" USING btree ("scrape_run_id");--> statement-breakpoint
CREATE INDEX "idx_mp_history_arcelik_product" ON "arcelik_marketplace_price_history" USING btree ("arcelik_product_id");