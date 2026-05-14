-- =====================================================================
-- Task #295 — Atelier 5-stage sales funnel migration
--
-- Replaces the 10-value `sales_stage` lifecycle with the canonical
-- 5-stage funnel + 3 terminals:
--   suspect | prospect | convert | runner | contract
--   lost    | no_decision | withdrawn
--
-- Adds:
--   atelier_opportunities.sub_status               text
--   atelier_opportunities.runner_entered_at        timestamp
--   atelier_opportunities.contract_signed_at       timestamp
--   atelier_opportunities.final_plm_stage          text
--   atelier_opportunity_stage_transitions.legacy_stage_label    text
--   atelier_opportunity_stage_transitions.decider               text
--   atelier_opportunity_stage_transitions.verbal_commit_date    text
--   atelier_opportunity_stage_transitions.signature_path        text
--   atelier_opportunity_stage_transitions.signed_instrument_file_id text
--   atelier_opportunity_stage_transitions.reason_code           text
--
-- Idempotent: every DDL uses IF NOT EXISTS / DO-blocks; the data
-- backfill is gated on the legacy enum values, so re-running the
-- migration after the rollover is a no-op.
-- =====================================================================

-- 1) Schema additions ----------------------------------------------------

ALTER TABLE atelier_opportunities
  ADD COLUMN IF NOT EXISTS sub_status         text,
  ADD COLUMN IF NOT EXISTS runner_entered_at  timestamp,
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamp,
  ADD COLUMN IF NOT EXISTS final_plm_stage    text;

ALTER TABLE atelier_opportunity_stage_transitions
  ADD COLUMN IF NOT EXISTS legacy_stage_label        text,
  ADD COLUMN IF NOT EXISTS decider                   text,
  ADD COLUMN IF NOT EXISTS verbal_commit_date        text,
  ADD COLUMN IF NOT EXISTS signature_path            text,
  ADD COLUMN IF NOT EXISTS signed_instrument_file_id text,
  ADD COLUMN IF NOT EXISTS reason_code               text;

-- 2) Backfill opportunities ---------------------------------------------
-- Only rows still on a legacy enum value get touched. The CASE preserves
-- the legacy string in `final_plm_stage` (used by reports that want to
-- know the precise terminal flavour, e.g. submitted vs verbal_commit at
-- close) and seeds `sub_status` from the old finer-grained label.

WITH legacy AS (
  SELECT id, sales_stage AS old_stage, plm_stage AS old_plm
  FROM atelier_opportunities
  WHERE sales_stage IN (
    'lead','qualified','discovery_scheduled',
    'pov_in_flight','proposal_in_flight','submitted',
    'verbal_commit','signed','lost_no_decision'
  )
)
UPDATE atelier_opportunities o
SET
  sales_stage = CASE l.old_stage
    WHEN 'lead'                 THEN 'suspect'
    WHEN 'qualified'            THEN 'prospect'
    WHEN 'discovery_scheduled'  THEN 'prospect'
    WHEN 'pov_in_flight'        THEN 'convert'
    WHEN 'proposal_in_flight'   THEN 'convert'
    WHEN 'submitted'            THEN 'convert'
    WHEN 'verbal_commit'        THEN 'runner'
    WHEN 'signed'               THEN 'contract'
    WHEN 'lost_no_decision'     THEN 'no_decision'
    ELSE o.sales_stage
  END,
  sub_status = COALESCE(o.sub_status, CASE l.old_stage
    WHEN 'lead'                THEN 'cold'
    WHEN 'qualified'           THEN 'qualified'
    WHEN 'discovery_scheduled' THEN 'discovery_scheduled'
    WHEN 'pov_in_flight'       THEN 'pov_in_flight'
    WHEN 'proposal_in_flight'  THEN 'proposal_in_flight'
    WHEN 'submitted'           THEN 'submitted'
    WHEN 'verbal_commit'       THEN 'verbal'
    WHEN 'signed'              THEN 'in_flight'
    ELSE NULL
  END),
  runner_entered_at = CASE
    WHEN l.old_stage IN ('verbal_commit','signed') AND o.runner_entered_at IS NULL
    THEN o.updated_at
    ELSE o.runner_entered_at
  END,
  contract_signed_at = CASE
    WHEN l.old_stage = 'signed' AND o.contract_signed_at IS NULL
    THEN o.updated_at
    ELSE o.contract_signed_at
  END,
  final_plm_stage = COALESCE(o.final_plm_stage, l.old_stage),
  plm_stage = CASE l.old_stage
    WHEN 'lead'                 THEN 'identify'
    WHEN 'qualified'            THEN 'shape'
    WHEN 'discovery_scheduled'  THEN 'shape'
    WHEN 'pov_in_flight'        THEN 'pursue'
    WHEN 'proposal_in_flight'   THEN 'pursue'
    WHEN 'submitted'            THEN 'pursue'
    WHEN 'verbal_commit'        THEN 'pursue'
    WHEN 'signed'               THEN 'mobilize'
    WHEN 'lost_no_decision'     THEN 'no_decision'
    ELSE o.plm_stage
  END,
  updated_at = now()
FROM legacy l
WHERE o.id = l.id;

-- 3) Backfill transition rows ------------------------------------------
-- Preserve the partner's literal historical stage string in
-- `legacy_stage_label` (so reports that reconstruct the old funnel
-- still work) and re-key from_stage/to_stage onto the canonical 5+3.

UPDATE atelier_opportunity_stage_transitions
SET legacy_stage_label = COALESCE(legacy_stage_label, to_stage)
WHERE to_stage IN (
  'lead','qualified','discovery_scheduled',
  'pov_in_flight','proposal_in_flight','submitted',
  'verbal_commit','signed','lost_no_decision'
);

UPDATE atelier_opportunity_stage_transitions
SET to_stage = CASE to_stage
  WHEN 'lead'                THEN 'suspect'
  WHEN 'qualified'           THEN 'prospect'
  WHEN 'discovery_scheduled' THEN 'prospect'
  WHEN 'pov_in_flight'       THEN 'convert'
  WHEN 'proposal_in_flight'  THEN 'convert'
  WHEN 'submitted'           THEN 'convert'
  WHEN 'verbal_commit'       THEN 'runner'
  WHEN 'signed'              THEN 'contract'
  WHEN 'lost_no_decision'    THEN 'no_decision'
  ELSE to_stage
END
WHERE to_stage IN (
  'lead','qualified','discovery_scheduled',
  'pov_in_flight','proposal_in_flight','submitted',
  'verbal_commit','signed','lost_no_decision'
);

UPDATE atelier_opportunity_stage_transitions
SET from_stage = CASE from_stage
  WHEN 'lead'                THEN 'suspect'
  WHEN 'qualified'           THEN 'prospect'
  WHEN 'discovery_scheduled' THEN 'prospect'
  WHEN 'pov_in_flight'       THEN 'convert'
  WHEN 'proposal_in_flight'  THEN 'convert'
  WHEN 'submitted'           THEN 'convert'
  WHEN 'verbal_commit'       THEN 'runner'
  WHEN 'signed'              THEN 'contract'
  WHEN 'lost_no_decision'    THEN 'no_decision'
  ELSE from_stage
END
WHERE from_stage IN (
  'lead','qualified','discovery_scheduled',
  'pov_in_flight','proposal_in_flight','submitted',
  'verbal_commit','signed','lost_no_decision'
);

-- 4) Per-opportunity audit row -----------------------------------------
-- One audit event per migrated opportunity so a partner querying
-- atelier_audit_events.action='opportunity.funnel_migrated_5stage'
-- can prove the rollover happened, with the legacy label preserved.
-- Idempotent: only inserts if no prior migration audit exists for
-- that opportunity.

INSERT INTO atelier_audit_events (
  id, entity_type, entity_id, actor_type, actor_label,
  action, payload, payload_summary, created_at
)
SELECT
  'aud_funnel5_' || o.id,
  'opportunity',
  o.id,
  'system',
  'Atelier · Funnel rollover',
  'opportunity.funnel_migrated_5stage',
  jsonb_build_object(
    'legacyStage', o.final_plm_stage,
    'newStage',    o.sales_stage,
    'subStatus',   o.sub_status
  ),
  'Migrated "' || o.name || '" from legacy ' ||
    COALESCE(o.final_plm_stage, '?') ||
    ' → ' || o.sales_stage ||
    COALESCE(' / ' || o.sub_status, ''),
  now()
FROM atelier_opportunities o
WHERE o.final_plm_stage IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM atelier_audit_events ae
    WHERE ae.entity_id = o.id
      AND ae.action = 'opportunity.funnel_migrated_5stage'
  );

-- 5) Default for new opps -----------------------------------------------
ALTER TABLE atelier_opportunities
  ALTER COLUMN sales_stage SET DEFAULT 'suspect';
