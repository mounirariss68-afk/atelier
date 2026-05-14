-- Task #293 (addendum) — close the gaps flagged by reviewer:
--   1. Add `contract_file_id` column to atelier_contractors (signed agreement
--      pointer; body is gated through atelier_person_documents_v).
--   2. Add masked views for atelier_rate_card_rows + atelier_deal_pricings so
--      DB is the source of truth for day_rate_internal_cost and
--      computed_cost_usd, not just route handlers.
-- The base helpers (atelier_can_view_comp / breakglass) live in
-- 0025_atelier_column_rls.sql and are unchanged.

-- 1. Schema add (idempotent)
ALTER TABLE atelier_contractors
  ADD COLUMN IF NOT EXISTS contract_file_id text;

-- 2. Masked view: rate card rows. Internal cost is comp-class.
DROP VIEW IF EXISTS atelier_rate_card_rows_v;
CREATE VIEW atelier_rate_card_rows_v AS
SELECT
  r.id, r.org_id, r.rate_card_id, r.role, r.seniority,
  CASE WHEN atelier_can_view_comp() THEN r.day_rate_internal_cost ELSE NULL END
    AS day_rate_internal_cost,
  r.day_rate_client_price, r.overhead_pct, r.currency,
  r.created_at, r.updated_at, r.created_by_user_id, r.deleted_at
FROM atelier_rate_card_rows r;

-- 3. Masked view: deal pricings. Computed cost (and the implicit margin %
-- derived from cost) is comp-class. Price stays visible to all.
DROP VIEW IF EXISTS atelier_deal_pricings_v;
CREATE VIEW atelier_deal_pricings_v AS
SELECT
  p.id, p.org_id, p.opportunity_id, p.rate_card_id, p.pricing_model,
  p.duration_weeks, p.team_mix,
  CASE WHEN atelier_can_view_comp() THEN p.computed_cost_usd ELSE NULL END
    AS computed_cost_usd,
  p.computed_price_usd,
  CASE WHEN atelier_can_view_comp() THEN p.computed_margin_pct ELSE NULL END
    AS computed_margin_pct,
  p.target_margin_pct, p.margin_lock_status,
  p.partner_override_id, p.partner_override_at, p.partner_override_rationale,
  p.countersign_partner_id, p.countersign_at, p.countersign_rationale,
  p.alternative_structures,
  p.pricing_strategist_brief_id, p.pricing_strategist_run_id,
  p.pricing_strategist_output,
  p.created_at, p.updated_at, p.created_by_user_id, p.deleted_at
FROM atelier_deal_pricings p;
