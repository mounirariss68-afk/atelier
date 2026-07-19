-- Contract template versions: store the previous version's REVIEWED field
-- schema reconciled against the new document (which prior fields carried
-- over vs. no longer match), so re-review after a new-version upload never
-- silently discards a confirmed schema. Nullable jsonb; null on v1 uploads
-- or when the prior version was never reviewed. Idempotent: safe to re-run.

ALTER TABLE "atelier_contract_template_versions"
  ADD COLUMN IF NOT EXISTS "prior_field_review" jsonb;
