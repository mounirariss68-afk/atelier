-- ----------------------------------------------------------------
-- Holiday review overrides for tentative (moon-sighting-dependent)
-- TR/MENA Islamic holiday dates.
--
-- The curated holiday dataset stays immutable; HR/leadership record
-- per-org overrides here (status confirmed | adjusted) which are
-- merged at read time into /me/holidays, on-leave-today, and
-- out-of-office return-date maths.
--
-- holiday_key = country|baseDate|name (stable identity of the
-- curated dataset row being reviewed).
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "atelier_holiday_overrides" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "holiday_key" text NOT NULL,
  "country" text NOT NULL,
  "status" text NOT NULL,
  "date" text NOT NULL,
  "end_date" text NOT NULL,
  "note" text,
  "updated_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_holiday_override"
  ON "atelier_holiday_overrides" ("org_id", "holiday_key");

CREATE INDEX IF NOT EXISTS "idx_atelier_holiday_override_org"
  ON "atelier_holiday_overrides" ("org_id");
