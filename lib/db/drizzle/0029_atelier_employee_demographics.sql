-- Task #412 — People Lens Team Composition dashboard.
-- Adds optional self-identified demographic fields (gender, nationality)
-- to all three roster tables. Defaults to `unspecified` / NULL so we never
-- imply coverage we don't actually have. Nationality stores ISO-3166
-- alpha-2 country codes.

ALTER TABLE "atelier_employees"
  ADD COLUMN IF NOT EXISTS "gender" text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS "nationality" text;

ALTER TABLE "atelier_contractors"
  ADD COLUMN IF NOT EXISTS "gender" text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS "nationality" text;

ALTER TABLE "atelier_partner_firm_resources"
  ADD COLUMN IF NOT EXISTS "gender" text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS "nationality" text;
