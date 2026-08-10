-- Task #872 — alliance-partner opportunity-fit flags on Scout briefs.
-- Snapshot at brief-creation time; jsonb array, empty by default.
ALTER TABLE "atelier_briefs" ADD COLUMN IF NOT EXISTS "partner_fit" jsonb NOT NULL DEFAULT '[]'::jsonb;
