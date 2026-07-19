-- Task #221 — Sensitive-people data lockdown.
--   1. atelier_can_view_comp()  → founding_partner | hr | finance
--      (regular partners lose person-level compensation; HR gains it).
--   2. atelier_can_view_personnel(owner) → founding_partner | hr | self
--      (regular partners lose personal data / person documents).
--   3. NEW atelier_can_view_costing() → founding_partner | partner |
--      finance | hr — engagement-economics cost surfaces (rate-card
--      internal cost, deal-pricing computed cost/margin) where regular
--      partners keep visibility.
--   4. Re-point the engagement-costing views (atelier_rate_card_rows_v,
--      atelier_deal_pricings_v) from the comp gate to the costing gate.
-- All other 0025/0026 views keep using atelier_can_view_comp() /
-- atelier_can_view_personnel(), which now enforce the new allow-lists.

CREATE OR REPLACE FUNCTION atelier_can_view_comp() RETURNS boolean AS $$
  SELECT
    atelier_principle_override_active()
    OR atelier_user_role() IN ('founding_partner','hr','finance');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION atelier_can_view_personnel(owner_user_id text) RETURNS boolean AS $$
  SELECT
    atelier_principle_override_active()
    OR atelier_user_role() IN ('founding_partner','hr')
    OR (owner_user_id IS NOT NULL
        AND owner_user_id = COALESCE(NULLIF(current_setting('app.user_id', true), ''), ''));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION atelier_can_view_costing() RETURNS boolean AS $$
  SELECT
    atelier_principle_override_active()
    OR atelier_user_role() IN ('founding_partner','partner','finance','hr');
$$ LANGUAGE sql STABLE;

-- Engagement-costing views now mask on the costing gate.
DROP VIEW IF EXISTS atelier_rate_card_rows_v;
CREATE VIEW atelier_rate_card_rows_v AS
SELECT
  r.id, r.org_id, r.rate_card_id, r.role, r.seniority,
  CASE WHEN atelier_can_view_costing() THEN r.day_rate_internal_cost ELSE NULL END
    AS day_rate_internal_cost,
  r.day_rate_client_price, r.overhead_pct, r.currency,
  r.created_at, r.updated_at, r.created_by_user_id, r.deleted_at
FROM atelier_rate_card_rows r;

DROP VIEW IF EXISTS atelier_deal_pricings_v;
CREATE VIEW atelier_deal_pricings_v AS
SELECT
  p.id, p.org_id, p.opportunity_id, p.rate_card_id, p.pricing_model,
  p.duration_weeks, p.team_mix,
  CASE WHEN atelier_can_view_costing() THEN p.computed_cost_usd ELSE NULL END
    AS computed_cost_usd,
  p.computed_price_usd,
  CASE WHEN atelier_can_view_costing() THEN p.computed_margin_pct ELSE NULL END
    AS computed_margin_pct,
  p.target_margin_pct, p.margin_lock_status,
  p.partner_override_id, p.partner_override_at, p.partner_override_rationale,
  p.countersign_partner_id, p.countersign_at, p.countersign_rationale,
  p.alternative_structures,
  p.pricing_strategist_brief_id, p.pricing_strategist_run_id,
  p.pricing_strategist_output,
  p.created_at, p.updated_at, p.created_by_user_id, p.deleted_at
FROM atelier_deal_pricings p;
