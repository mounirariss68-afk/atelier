-- Task #827 — per-user display currency preference for money rollups.
ALTER TABLE "atelier_users" ADD COLUMN IF NOT EXISTS "display_currency" text NOT NULL DEFAULT 'USD';
