-- Task #275 — Cartographer provenance fields.
-- Adds source_url + confidence to atelier_contacts and a parallel
-- strategic_priority_refs column on atelier_accounts so cartographer
-- runs can persist citation URLs for every priority/contact.

ALTER TABLE "atelier_contacts"
  ADD COLUMN IF NOT EXISTS "source_url" text,
  ADD COLUMN IF NOT EXISTS "confidence" text NOT NULL DEFAULT 'inferred';

ALTER TABLE "atelier_accounts"
  ADD COLUMN IF NOT EXISTS "strategic_priority_refs" jsonb NOT NULL DEFAULT '[]'::jsonb;
