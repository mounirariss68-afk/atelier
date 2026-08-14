-- Task #1053 — per-POV depth knob ("memo" vs "full").
--
-- Partners choose at create time how deep the POV should go: a tight
-- 4–6-section memo or the full 8–12-section client-facing document. The
-- choice is frozen on the row and steers the Phase A/B run-time directives.
-- Idempotent; existing rows backfill to the prior single behaviour ("full").
ALTER TABLE "atelier_povs" ADD COLUMN IF NOT EXISTS "depth" text NOT NULL DEFAULT 'full';
