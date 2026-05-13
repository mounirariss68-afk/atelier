-- Task #243 — engagement default language for bilingual MVP.
-- Idempotent ALTER so reruns are safe across environments.
ALTER TABLE "atelier_engagements"
  ADD COLUMN IF NOT EXISTS "default_language" text NOT NULL DEFAULT 'en';
