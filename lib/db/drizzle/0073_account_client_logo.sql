-- Task #1191 — client logo asset on atelier_accounts.
-- Adds a nullable object-storage ref column so a partner can upload a real
-- client logo that appears on the meeting prep card.
-- Idempotent: safe to re-run against a DB that already has the column.

ALTER TABLE "atelier_accounts"
  ADD COLUMN IF NOT EXISTS "client_logo_ref" text;
