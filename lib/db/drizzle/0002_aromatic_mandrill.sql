CREATE TABLE "arcelik_marketplace_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"marketplace" text NOT NULL,
	"marketplace_product_id" text NOT NULL,
	"product_url" text NOT NULL,
	"brand" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"price" integer NOT NULL,
	"capacity_liters" integer,
	"capacity_kg" double precision,
	"energy_class" text,
	"arcelik_product_id" text,
	"competitor_price_id" text,
	"match_confidence" double precision,
	"scraped_at" timestamp DEFAULT now() NOT NULL,
	"scrape_run_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_product_equivalences" (
	"id" serial PRIMARY KEY NOT NULL,
	"arcelik_product_id" text NOT NULL,
	"competitor_brand" text NOT NULL,
	"competitor_model" text NOT NULL,
	"competitor_marketplace_id" integer,
	"competitor_price_record_id" text,
	"match_confidence" double precision NOT NULL,
	"match_basis" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arcelik_product_specs" (
	"id" serial PRIMARY KEY NOT NULL,
	"marketplace_price_id" integer NOT NULL,
	"marketplace" text NOT NULL,
	"marketplace_product_id" text NOT NULL,
	"capacity_liters" integer,
	"capacity_kg" double precision,
	"energy_class" text,
	"product_type" text,
	"width_cm" double precision,
	"height_cm" double precision,
	"depth_cm" double precision,
	"noise_level_db" integer,
	"spin_rpm" integer,
	"raw_specs" jsonb,
	"extracted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_mp_prices_marketplace_pid" ON "arcelik_marketplace_prices" USING btree ("marketplace","marketplace_product_id");--> statement-breakpoint
CREATE INDEX "idx_mp_prices_marketplace" ON "arcelik_marketplace_prices" USING btree ("marketplace");--> statement-breakpoint
CREATE INDEX "idx_mp_prices_brand" ON "arcelik_marketplace_prices" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "idx_mp_prices_category" ON "arcelik_marketplace_prices" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_mp_prices_arcelik_product" ON "arcelik_marketplace_prices" USING btree ("arcelik_product_id");--> statement-breakpoint
CREATE INDEX "idx_mp_prices_competitor" ON "arcelik_marketplace_prices" USING btree ("competitor_price_id");--> statement-breakpoint
CREATE INDEX "idx_mp_prices_scraped" ON "arcelik_marketplace_prices" USING btree ("scraped_at");--> statement-breakpoint
CREATE INDEX "idx_mp_prices_run" ON "arcelik_marketplace_prices" USING btree ("scrape_run_id");--> statement-breakpoint
CREATE INDEX "idx_equiv_arcelik" ON "arcelik_product_equivalences" USING btree ("arcelik_product_id");--> statement-breakpoint
CREATE INDEX "idx_equiv_brand" ON "arcelik_product_equivalences" USING btree ("competitor_brand");--> statement-breakpoint
CREATE INDEX "idx_equiv_confidence" ON "arcelik_product_equivalences" USING btree ("match_confidence");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_specs_marketplace_pid" ON "arcelik_product_specs" USING btree ("marketplace","marketplace_product_id");--> statement-breakpoint
CREATE INDEX "idx_specs_mp_price" ON "arcelik_product_specs" USING btree ("marketplace_price_id");