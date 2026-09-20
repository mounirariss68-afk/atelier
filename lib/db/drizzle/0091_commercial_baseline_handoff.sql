-- Task 1352 — fail-closed commercial baseline handoff.
-- Idempotent: all DDL is safe to re-run during deploy retries.
ALTER TABLE "atelier_sold_position_snapshot"
  ADD COLUMN IF NOT EXISTS "pricing_inputs" jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "pricing_results" jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "pricing_provenance" jsonb NOT NULL DEFAULT '{}';

-- Exactly one live downstream artifact per opportunity. Existing duplicates
-- make the migration fail visibly rather than silently deleting commercial
-- records; operations must reconcile them before retrying.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_engagement_live_opportunity"
  ON "atelier_engagements" ("opportunity_id")
  WHERE "deleted_at" IS NULL;
-- Sold snapshots are write-once baselines, including their provenance.
CREATE OR REPLACE FUNCTION atelier_reject_sold_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sold position snapshots are immutable';
END $$;
DROP TRIGGER IF EXISTS atelier_sold_snapshot_immutable ON "atelier_sold_position_snapshot";
CREATE TRIGGER atelier_sold_snapshot_immutable
  BEFORE UPDATE ON "atelier_sold_position_snapshot"
  FOR EACH ROW EXECUTE FUNCTION atelier_reject_sold_snapshot_mutation();

-- Signed baseline economics are write-once. Lifecycle-only status changes stay
-- available, while economic amendments must be represented by a new audited
-- change-order/rebaseline record rather than rewriting the signed instrument.
CREATE OR REPLACE FUNCTION atelier_reject_signed_baseline_contract_economics()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.metadata->>'handoff' = 'commercial_baseline'
     AND (
       NEW.counterparty_id IS DISTINCT FROM OLD.counterparty_id OR
       NEW.engagement_id IS DISTINCT FROM OLD.engagement_id OR
       NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.contract_value IS DISTINCT FROM OLD.contract_value OR
       NEW.contract_value_usd IS DISTINCT FROM OLD.contract_value_usd OR
       NEW.term_start IS DISTINCT FROM OLD.term_start OR
       NEW.term_end IS DISTINCT FROM OLD.term_end OR
       NEW.payment_terms_days IS DISTINCT FROM OLD.payment_terms_days OR
       NEW.bill_to_json IS DISTINCT FROM OLD.bill_to_json
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
     )
  THEN
    RAISE EXCEPTION 'signed commercial baseline economics are immutable; use a change order';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS atelier_signed_baseline_contract_immutable ON "atelier_contract";
CREATE TRIGGER atelier_signed_baseline_contract_immutable
  BEFORE UPDATE ON "atelier_contract"
  FOR EACH ROW EXECUTE FUNCTION atelier_reject_signed_baseline_contract_economics();

CREATE OR REPLACE FUNCTION atelier_reject_baseline_billing_economics()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id LIKE 'bill\_%\_baseline' ESCAPE '\'
     AND (
       NEW.id IS DISTINCT FROM OLD.id OR
       NEW.engagement_id IS DISTINCT FROM OLD.engagement_id OR
       NEW.account_id IS DISTINCT FROM OLD.account_id OR
       NEW.rule_type IS DISTINCT FROM OLD.rule_type OR
       NEW.currency IS DISTINCT FROM OLD.currency OR
       NEW.payment_terms_days IS DISTINCT FROM OLD.payment_terms_days OR
       NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id OR
       NEW.config IS DISTINCT FROM OLD.config
     )
  THEN
    RAISE EXCEPTION 'commercial baseline billing economics are immutable; use a change order';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS atelier_baseline_billing_immutable ON "atelier_billing_rule";
CREATE TRIGGER atelier_baseline_billing_immutable
  BEFORE UPDATE ON "atelier_billing_rule"
  FOR EACH ROW EXECUTE FUNCTION atelier_reject_baseline_billing_economics();

-- Sold baselines are tenant-scoped. Contract and billing tables retain their
-- existing engagement-aware policies from the L2C/billing migrations.
ALTER TABLE "atelier_sold_position_snapshot" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atelier_commercial_org_scope" ON "atelier_sold_position_snapshot";
CREATE POLICY "atelier_commercial_org_scope" ON "atelier_sold_position_snapshot"
  USING (org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico'))
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN ('founding_partner', 'partner', 'finance')
  );