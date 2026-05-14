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

-- 4. Re-create atelier_contractors_v to mask the new contract_file_id
-- column (personnel-contract class — pointer to the signed agreement
-- document; only personnel-contract viewers may follow it).
DROP VIEW IF EXISTS atelier_contractors_v;
CREATE VIEW atelier_contractors_v AS
SELECT
  c.id, c.org_id, c.full_name, c.email, c.country, c.country_code,
  c.vendor_entity, c.master_agreement_ref, c.contract_type,
  c.contract_start, c.contract_end,
  CASE WHEN atelier_can_view_personnel(NULL) THEN c.contract_file_id ELSE NULL END
    AS contract_file_id,
  CASE WHEN atelier_can_view_comp() THEN c.day_rate_amount         ELSE NULL END AS day_rate_amount,
  CASE WHEN atelier_can_view_comp() THEN c.day_rate_internal_cost  ELSE NULL END AS day_rate_internal_cost,
  c.day_rate_currency,
  CASE WHEN atelier_can_view_comp() THEN c.payment_terms_days      ELSE NULL END AS payment_terms_days,
  c.vat_treatment, c.engagement_scope_default, c.contracting_entity,
  CASE WHEN atelier_can_view_personnel(NULL) THEN c.conflicts_disclosed_json ELSE '[]'::jsonb END
    AS conflicts_disclosed_json,
  c.start_date, c.end_date, c.status, c.notes,
  c.created_at, c.updated_at, c.created_by_user_id, c.deleted_at
FROM atelier_contractors c;

-- 5. Masked view: conflict disclosures. Disclosure text + scope_impact
-- + notes are personnel-contract class. Status/timestamps remain visible
-- so dashboards can show "N active disclosures" counts without leaking
-- the underlying narrative.
DROP VIEW IF EXISTS atelier_conflict_disclosures_v;
CREATE VIEW atelier_conflict_disclosures_v AS
SELECT
  d.id, d.org_id, d.person_type, d.person_id,
  CASE WHEN atelier_can_view_personnel(
    (SELECT e.user_id FROM atelier_employees e
      WHERE e.id = d.person_id AND d.person_type = 'employee')
  ) THEN d.disclosure_text ELSE NULL END AS disclosure_text,
  d.disclosed_at, d.status,
  CASE WHEN atelier_can_view_personnel(
    (SELECT e.user_id FROM atelier_employees e
      WHERE e.id = d.person_id AND d.person_type = 'employee')
  ) THEN d.notes ELSE NULL END AS notes,
  d.declared_party,
  CASE WHEN atelier_can_view_personnel(
    (SELECT e.user_id FROM atelier_employees e
      WHERE e.id = d.person_id AND d.person_type = 'employee')
  ) THEN d.nature ELSE NULL END AS nature,
  CASE WHEN atelier_can_view_personnel(
    (SELECT e.user_id FROM atelier_employees e
      WHERE e.id = d.person_id AND d.person_type = 'employee')
  ) THEN d.scope_impact ELSE NULL END AS scope_impact,
  d.declared_at, d.last_reviewed_at,
  d.created_at, d.updated_at, d.created_by_user_id, d.deleted_at
FROM atelier_conflict_disclosures d;
