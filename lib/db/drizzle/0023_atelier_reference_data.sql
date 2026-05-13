-- Task #290 — Reference-data lookups (atelier_countries, atelier_industries,
-- atelier_sub_industries). Additive DDL only. Mirrors the Drizzle schema
-- in lib/db/src/schema/atelier-reference.ts exactly.

CREATE TABLE IF NOT EXISTS "atelier_countries" (
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
CREATE INDEX IF NOT EXISTS "idx_atelier_countries_org" ON "atelier_countries" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_countries_region" ON "atelier_countries" ("region");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_countries_status" ON "atelier_countries" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_industries" (
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
CREATE INDEX IF NOT EXISTS "idx_atelier_industries_org" ON "atelier_industries" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_industries_status" ON "atelier_industries" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "atelier_sub_industries" (
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
CREATE INDEX IF NOT EXISTS "idx_atelier_sub_industries_org" ON "atelier_sub_industries" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_sub_industries_industry" ON "atelier_sub_industries" ("industry_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_atelier_sub_industries_status" ON "atelier_sub_industries" ("status");
