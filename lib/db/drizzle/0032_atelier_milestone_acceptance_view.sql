-- =========================================================================
-- L2C Wave 1, Step 7 — Deliverable Acceptance: milestone-acceptance view.
-- (Task #360 in `.local/tasks/l2c-wave-1-codex-clm.md`.)
--
-- The Wave-2 milestone state machine cannot transition a milestone to
-- `client_accepted` unless a row in atelier_deliverable_acceptance with
-- status='client_signed' is bound to that milestone via milestone_id.
-- This view is the single SQL surface Wave 2 reads to enforce the gate
-- — it returns one row per milestone that has at least one acceptance
-- row, with the most-recent acceptance row's status, signer, signedAt
-- and evidence URL.
--
-- The view inherits row-level security from the underlying
-- atelier_deliverable_acceptance table (engagement-scoped).
-- =========================================================================

CREATE OR REPLACE VIEW atelier_milestone_acceptance_v AS
WITH ranked AS (
  SELECT
    a.*,
    ROW_NUMBER() OVER (
      PARTITION BY a.milestone_id
      ORDER BY
        -- client_signed wins over any other status; then most-recent.
        CASE WHEN a.status = 'client_signed' THEN 0 ELSE 1 END,
        COALESCE(a.signed_at, a.submitted_at, a.created_at) DESC NULLS LAST
    ) AS rn
  FROM atelier_deliverable_acceptance a
  WHERE a.deleted_at IS NULL
    AND a.milestone_id IS NOT NULL
)
SELECT
  r.org_id,
  r.engagement_id,
  r.milestone_id,
  r.id                  AS acceptance_id,
  r.status              AS acceptance_status,
  r.title               AS acceptance_title,
  r.attestation_text    AS acceptance_attestation,
  r.client_signer_name,
  r.client_signer_email,
  r.client_signer_title,
  r.signed_at,
  r.evidence_url,
  r.submitted_at,
  r.recorded_by_user_id,
  -- Convenience flag for the Wave-2 gate.
  (r.status = 'client_signed') AS is_client_signed
FROM ranked r
WHERE r.rn = 1;

COMMENT ON VIEW atelier_milestone_acceptance_v IS
  'L2C W1-S7: most-recent deliverable-acceptance row per milestone, with is_client_signed gate flag for Wave-2 milestone state machine.';
