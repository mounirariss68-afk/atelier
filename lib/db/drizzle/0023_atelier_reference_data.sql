-- Task #290 — Reference-data lookups (atelier_countries, atelier_industries,
-- atelier_sub_industries). Additive DDL only.

CREATE TABLE IF NOT EXISTS "atelier_countries" (
  "iso_alpha2" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "iso_alpha3" text NOT NULL,
  "iso_numeric" text,
  "display_name_en" text NOT NULL,
  "display_name_ar" text,
  "display_name_tr" text,
  "region" text NOT NULL,
  "sub_region" text,
  "is_gcc" boolean DEFAULT false NOT NULL,
  "is_aico_target_market" boolean DEFAULT false NOT NULL,
  "default_currency" text,
  "default_language" text,
  "flag_emoji" text,
  "aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "display_order" integer DEFAULT 999 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deprecated_at" timestamp
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
  "display_order" integer DEFAULT 99 NOT NULL,
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
  "display_order" integer DEFAULT 99 NOT NULL,
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
