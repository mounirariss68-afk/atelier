-- ============================================================
-- Task #455 — Track scope and effort changes on each change order.
--
-- Add first-class delta columns to atelier_change_order so Finance and
-- delivery leads can query/aggregate change-order impact (hours +
-- cost) instead of parsing rationale_text. `applyPostedChangeOrder`
-- now uses these to rebaseline the matching budget lines, not just
-- the headline contract value.
-- ============================================================

ALTER TABLE atelier_change_order
  ADD COLUMN IF NOT EXISTS labour_hours_delta     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labour_cost_delta_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expenses_delta_usd     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subs_delta_usd         DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill the four demo change orders. The deltas were previously only
-- expressed as free text in rationale_text; values mirror those encoded
-- in artifacts/api-server/src/lib/atelier-seed-l2c.ts so existing
-- environments converge to the same baseline as a fresh seed.
UPDATE atelier_change_order
   SET labour_hours_delta = 720, labour_cost_delta_usd = 100800
 WHERE id = 'co_tasama_001';

UPDATE atelier_change_order
   SET labour_hours_delta = 240, labour_cost_delta_usd = 33600, subs_delta_usd = 16800
 WHERE id = 'co_tasama_002';

UPDATE atelier_change_order
   SET labour_hours_delta = 240, labour_cost_delta_usd = 33600
 WHERE id = 'co_nhc_001';

UPDATE atelier_change_order
   SET labour_hours_delta = -150, labour_cost_delta_usd = -21000
 WHERE id = 'co_dge_001';
