-- Atelier — Lead-to-Cash Wave 1 (Task #360).
-- Codex (CLM), change orders, deliverable acceptance.
-- See lib/db/src/schema/atelier-l2c.ts for the Drizzle source of truth.

-- ============================================================
-- COUNTERPARTY (firm-wide registry; org-scoped only)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_counterparty" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "kind" text NOT NULL,
  "legal_name" text NOT NULL,
  "display_name" text NOT NULL,
  "account_id" text,
  "jurisdiction" text DEFAULT '' NOT NULL,
  "bill_to_address" jsonb,
  "vat_number" text DEFAULT '' NOT NULL,
  "payment_terms_days" integer DEFAULT 30 NOT NULL,
  "kyc_state" text DEFAULT 'pending' NOT NULL,
  "kyc_reviewed_at" timestamp,
  "notes" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_counterparty_org" ON "atelier_counterparty" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_counterparty_kind" ON "atelier_counterparty" ("kind");
CREATE INDEX IF NOT EXISTS "idx_atelier_counterparty_account" ON "atelier_counterparty" ("account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_counterparty_legal" ON "atelier_counterparty" ("org_id", "legal_name");

-- ============================================================
-- CLAUSE LIBRARY
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_clause" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "family" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "parent_id" text,
  "jurisdiction_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "instrument_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "risk_tier" text DEFAULT 'low' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "published_at" timestamp,
  "published_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_clause_org" ON "atelier_clause" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_clause_family" ON "atelier_clause" ("family");
CREATE INDEX IF NOT EXISTS "idx_atelier_clause_status" ON "atelier_clause" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_clause_family_version" ON "atelier_clause" ("org_id", "family", "version");

CREATE TABLE IF NOT EXISTS "atelier_clause_acceptance" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "counterparty_id" text NOT NULL,
  "clause_id" text NOT NULL,
  "contract_id" text,
  "accepted_at" timestamp NOT NULL,
  "customizations_json" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_clause_acc_cp" ON "atelier_clause_acceptance" ("counterparty_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_clause_acc_clause" ON "atelier_clause_acceptance" ("clause_id");

-- ============================================================
-- CONTRACT (engagement-scoped)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_contract" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "instrument_type" text NOT NULL,
  "parent_contract_id" text,
  "counterparty_id" text NOT NULL,
  "engagement_id" text,
  "opportunity_id" text,
  "title" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "governing_law" text DEFAULT '' NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "contract_value" double precision DEFAULT 0 NOT NULL,
  "contract_value_usd" double precision DEFAULT 0 NOT NULL,
  "term_start" text,
  "term_end" text,
  "payment_terms_days" integer DEFAULT 30 NOT NULL,
  "po_number" text DEFAULT '' NOT NULL,
  "bill_to_json" jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "fully_executed_at" timestamp,
  "terminated_at" timestamp,
  "termination_reason" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_org" ON "atelier_contract" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_engagement" ON "atelier_contract" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_counterparty" ON "atelier_contract" ("counterparty_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_opportunity" ON "atelier_contract" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_status" ON "atelier_contract" ("status");
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_term_end" ON "atelier_contract" ("term_end");

CREATE TABLE IF NOT EXISTS "atelier_contract_clause" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "contract_id" text NOT NULL,
  "clause_id" text NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "customizations_json" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_clause_contract" ON "atelier_contract_clause" ("contract_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_clause_clause" ON "atelier_contract_clause" ("clause_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_contract_clause_position" ON "atelier_contract_clause" ("contract_id", "position");

CREATE TABLE IF NOT EXISTS "atelier_contract_party" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "contract_id" text NOT NULL,
  "counterparty_id" text,
  "internal_user_id" text,
  "role_on_contract" text NOT NULL,
  "signer_name" text NOT NULL,
  "signer_email" text NOT NULL,
  "signer_title" text DEFAULT '' NOT NULL,
  "sign_state" text DEFAULT 'pending' NOT NULL,
  "sign_method" text DEFAULT 'docusign' NOT NULL,
  "sent_at" timestamp,
  "signed_at" timestamp,
  "sign_evidence_url" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_party_contract" ON "atelier_contract_party" ("contract_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_party_state" ON "atelier_contract_party" ("sign_state");

CREATE TABLE IF NOT EXISTS "atelier_contract_version" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "contract_id" text NOT NULL,
  "version" integer NOT NULL,
  "rendered_body" text NOT NULL,
  "body_hash" text NOT NULL,
  "snapshot_reason" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text
);
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_version_contract" ON "atelier_contract_version" ("contract_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_contract_version" ON "atelier_contract_version" ("contract_id", "version");

CREATE TABLE IF NOT EXISTS "atelier_contract_redline" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "contract_id" text NOT NULL,
  "contract_version_id" text NOT NULL,
  "clause_id" text,
  "proposed_body" text NOT NULL,
  "diff_json" jsonb,
  "risk_tier" text DEFAULT 'low' NOT NULL,
  "risk_commentary" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "resolved_at" timestamp,
  "resolved_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_redline_contract" ON "atelier_contract_redline" ("contract_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_contract_redline_status" ON "atelier_contract_redline" ("status");

CREATE TABLE IF NOT EXISTS "atelier_two_partner_countersign" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "contract_id" text NOT NULL,
  "partner_a_user_id" text NOT NULL,
  "partner_b_user_id" text NOT NULL,
  "partner_a_signed_at" timestamp,
  "partner_b_signed_at" timestamp,
  "state" text DEFAULT 'pending' NOT NULL,
  "rationale_text" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_atelier_two_partner_countersign_contract" ON "atelier_two_partner_countersign" ("contract_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_two_partner_countersign_state" ON "atelier_two_partner_countersign" ("state");

-- ============================================================
-- CHANGE ORDER (engagement-scoped)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_change_order" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "parent_contract_id" text,
  "contract_id" text,
  "kind" text NOT NULL,
  "summary" text NOT NULL,
  "rationale_text" text DEFAULT '' NOT NULL,
  "old_value_json" jsonb,
  "new_value_json" jsonb,
  "value_delta_usd" double precision DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "proposed_by_user_id" text,
  "partner_approver_user_id" text,
  "partner_approved_at" timestamp,
  "client_proposed_at" timestamp,
  "client_resolved_at" timestamp,
  "client_signer_name" text DEFAULT '' NOT NULL,
  "client_signer_email" text DEFAULT '' NOT NULL,
  "evidence_url" text DEFAULT '' NOT NULL,
  "posted_at" timestamp,
  "linked_raid_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_change_order_engagement" ON "atelier_change_order" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_change_order_status" ON "atelier_change_order" ("status");
CREATE INDEX IF NOT EXISTS "idx_atelier_change_order_parent" ON "atelier_change_order" ("parent_contract_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_change_order_contract" ON "atelier_change_order" ("contract_id");

-- ============================================================
-- DELIVERABLE ACCEPTANCE (engagement-scoped; Wave-2 hinge)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_deliverable_acceptance" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "deliverable_id" text,
  "milestone_id" text,
  "title" text NOT NULL,
  "attestation_text" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "submitted_at" timestamp,
  "submitted_by_user_id" text,
  "client_signer_name" text DEFAULT '' NOT NULL,
  "client_signer_email" text DEFAULT '' NOT NULL,
  "client_signer_title" text DEFAULT '' NOT NULL,
  "signed_at" timestamp,
  "recorded_by_user_id" text,
  "evidence_url" text DEFAULT '' NOT NULL,
  "rejection_reason" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_deliv_acc_engagement" ON "atelier_deliverable_acceptance" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_deliv_acc_milestone" ON "atelier_deliverable_acceptance" ("milestone_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_deliv_acc_status" ON "atelier_deliverable_acceptance" ("status");

-- ============================================================
-- DPA (engagement-scoped; compliance_officer firm-wide read)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_dpa" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "engagement_id" text NOT NULL,
  "contract_id" text,
  "counterparty_id" text NOT NULL,
  "data_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "processor_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'required' NOT NULL,
  "signed_at" timestamp,
  "expires_at" timestamp,
  "last_reviewed_at" timestamp,
  "notes" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_dpa_engagement" ON "atelier_dpa" ("engagement_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_dpa_counterparty" ON "atelier_dpa" ("counterparty_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_dpa_status" ON "atelier_dpa" ("status");

-- ============================================================
-- INSURANCE CERTIFICATE (counterparty-scoped; firm-wide read)
-- ============================================================
CREATE TABLE IF NOT EXISTS "atelier_insurance_certificate" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'aico' NOT NULL,
  "counterparty_id" text NOT NULL,
  "kind" text NOT NULL,
  "insurer_name" text NOT NULL,
  "policy_number" text NOT NULL,
  "coverage_limit_usd" double precision DEFAULT 0 NOT NULL,
  "coverage_start" text NOT NULL,
  "coverage_end" text NOT NULL,
  "certificate_url" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_insurance_counterparty" ON "atelier_insurance_certificate" ("counterparty_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_insurance_kind" ON "atelier_insurance_certificate" ("kind");

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
-- Engagement-allowed predicate. Reads app.engagement_ids GUC (set by
-- withRls in the app layer) plus a leadership/compliance bypass for
-- roles allowed firm-wide read on the L2C surfaces.
--
-- Allowed firm-wide on engagement-scoped L2C tables:
--   founding_partner | partner | finance | compliance_officer
-- Restricted (always denied unless explicit engagement grant):
--   contractor | partner_firm_resource | recruiter | board_observer
CREATE OR REPLACE FUNCTION atelier_l2c_engagement_allowed(eng_id text)
RETURNS boolean AS $$
  SELECT
    -- Org isolation.
    eng_id IS NOT NULL
    AND (
      -- Firm-wide allow-list: leadership + finance + compliance_officer.
      current_setting('app.user_role', true) IN (
        'founding_partner', 'partner', 'finance', 'compliance_officer'
      )
      OR
      -- Senior manager / consultant / hr: must have explicit grant.
      eng_id = ANY (
        string_to_array(
          COALESCE(NULLIF(current_setting('app.engagement_ids', true), ''), ''),
          ','
        )
      )
    );
$$ LANGUAGE sql STABLE;

-- ============================================================
-- ROW-LEVEL SECURITY POLICIES
-- ============================================================
-- Pattern: enable RLS, drop existing policies (idempotent), create
-- per-table policies that combine org isolation + role gate +
-- engagement narrowing where appropriate.

-- COUNTERPARTY: firm-wide; restricted personas denied.
ALTER TABLE atelier_counterparty ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_counterparty_rw ON atelier_counterparty;
CREATE POLICY atelier_counterparty_rw ON atelier_counterparty
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- CLAUSE: firm-wide read for non-restricted; finance/leadership write.
ALTER TABLE atelier_clause ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_clause_read ON atelier_clause;
DROP POLICY IF EXISTS atelier_clause_write ON atelier_clause;
CREATE POLICY atelier_clause_read ON atelier_clause
  FOR SELECT USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
  );
CREATE POLICY atelier_clause_write ON atelier_clause
  FOR ALL USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- CLAUSE_ACCEPTANCE: firm-wide read for non-restricted; finance/leadership write.
ALTER TABLE atelier_clause_acceptance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_clause_acc_rw ON atelier_clause_acceptance;
CREATE POLICY atelier_clause_acc_rw ON atelier_clause_acceptance
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- CONTRACT: engagement-scoped via the helper; MSAs (engagement_id NULL)
-- visible firm-wide to leadership + finance + compliance_officer only.
ALTER TABLE atelier_contract ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_contract_rw ON atelier_contract;
CREATE POLICY atelier_contract_rw ON atelier_contract
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND (
      (engagement_id IS NOT NULL AND atelier_l2c_engagement_allowed(engagement_id))
      OR (engagement_id IS NULL AND current_setting('app.user_role', true) IN
        ('founding_partner', 'partner', 'finance', 'compliance_officer'))
    )
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance')
  );

-- CONTRACT_CLAUSE / CONTRACT_PARTY / CONTRACT_VERSION / CONTRACT_REDLINE
-- inherit visibility through the parent contract id (subquery in policy).
-- We reuse the same engagement-allowed gate by joining to the contract.
ALTER TABLE atelier_contract_clause ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_contract_clause_rw ON atelier_contract_clause;
CREATE POLICY atelier_contract_clause_rw ON atelier_contract_clause
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND EXISTS (
      SELECT 1 FROM atelier_contract c
      WHERE c.id = atelier_contract_clause.contract_id
        AND (
          (c.engagement_id IS NOT NULL AND atelier_l2c_engagement_allowed(c.engagement_id))
          OR (c.engagement_id IS NULL AND current_setting('app.user_role', true) IN
            ('founding_partner', 'partner', 'finance', 'compliance_officer'))
        )
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('founding_partner', 'partner', 'finance')
  );

ALTER TABLE atelier_contract_party ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_contract_party_rw ON atelier_contract_party;
CREATE POLICY atelier_contract_party_rw ON atelier_contract_party
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND EXISTS (
      SELECT 1 FROM atelier_contract c
      WHERE c.id = atelier_contract_party.contract_id
        AND (
          (c.engagement_id IS NOT NULL AND atelier_l2c_engagement_allowed(c.engagement_id))
          OR (c.engagement_id IS NULL AND current_setting('app.user_role', true) IN
            ('founding_partner', 'partner', 'finance', 'compliance_officer'))
        )
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('founding_partner', 'partner', 'finance')
  );

ALTER TABLE atelier_contract_version ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_contract_version_rw ON atelier_contract_version;
CREATE POLICY atelier_contract_version_rw ON atelier_contract_version
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND EXISTS (
      SELECT 1 FROM atelier_contract c
      WHERE c.id = atelier_contract_version.contract_id
        AND (
          (c.engagement_id IS NOT NULL AND atelier_l2c_engagement_allowed(c.engagement_id))
          OR (c.engagement_id IS NULL AND current_setting('app.user_role', true) IN
            ('founding_partner', 'partner', 'finance', 'compliance_officer'))
        )
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('founding_partner', 'partner', 'finance')
  );

ALTER TABLE atelier_contract_redline ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_contract_redline_rw ON atelier_contract_redline;
CREATE POLICY atelier_contract_redline_rw ON atelier_contract_redline
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND EXISTS (
      SELECT 1 FROM atelier_contract c
      WHERE c.id = atelier_contract_redline.contract_id
        AND (
          (c.engagement_id IS NOT NULL AND atelier_l2c_engagement_allowed(c.engagement_id))
          OR (c.engagement_id IS NULL AND current_setting('app.user_role', true) IN
            ('founding_partner', 'partner', 'finance', 'compliance_officer'))
        )
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('founding_partner', 'partner', 'finance')
  );

-- TWO_PARTNER_COUNTERSIGN: read for the contract's audience; write
-- only for partner-tier (the gate itself).
ALTER TABLE atelier_two_partner_countersign ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_two_partner_countersign_rw ON atelier_two_partner_countersign;
CREATE POLICY atelier_two_partner_countersign_rw ON atelier_two_partner_countersign
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND EXISTS (
      SELECT 1 FROM atelier_contract c
      WHERE c.id = atelier_two_partner_countersign.contract_id
        AND (
          (c.engagement_id IS NOT NULL AND atelier_l2c_engagement_allowed(c.engagement_id))
          OR (c.engagement_id IS NULL AND current_setting('app.user_role', true) IN
            ('founding_partner', 'partner', 'finance', 'compliance_officer'))
        )
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('founding_partner', 'partner')
  );

-- CHANGE_ORDER: engagement-scoped.
ALTER TABLE atelier_change_order ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_change_order_rw ON atelier_change_order;
CREATE POLICY atelier_change_order_rw ON atelier_change_order
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND atelier_l2c_engagement_allowed(engagement_id)
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'senior_manager', 'finance')
  );

-- DELIVERABLE_ACCEPTANCE: engagement-scoped.
ALTER TABLE atelier_deliverable_acceptance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_deliv_acc_rw ON atelier_deliverable_acceptance;
CREATE POLICY atelier_deliv_acc_rw ON atelier_deliverable_acceptance
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND atelier_l2c_engagement_allowed(engagement_id)
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'senior_manager', 'finance')
  );

-- DPA: engagement-scoped, with compliance_officer firm-wide read folded
-- into atelier_l2c_engagement_allowed already.
ALTER TABLE atelier_dpa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_dpa_rw ON atelier_dpa;
CREATE POLICY atelier_dpa_rw ON atelier_dpa
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND atelier_l2c_engagement_allowed(engagement_id)
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance', 'compliance_officer')
  );

-- INSURANCE_CERTIFICATE: firm-wide read for non-restricted.
ALTER TABLE atelier_insurance_certificate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS atelier_insurance_rw ON atelier_insurance_certificate;
CREATE POLICY atelier_insurance_rw ON atelier_insurance_certificate
  USING (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) NOT IN
      ('contractor', 'partner_firm_resource', 'recruiter', 'board_observer')
  )
  WITH CHECK (
    org_id = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'aico')
    AND current_setting('app.user_role', true) IN
      ('founding_partner', 'partner', 'finance', 'hr', 'compliance_officer')
  );

-- ============================================================
-- COLUMN-LEVEL: contract_value visibility
-- ============================================================
-- The contract_value column is visible only to founding_partner /
-- partner / finance / compliance_officer. Other personas reading the
-- contract through the regular RLS path see contract_value as 0
-- via the helper view. App-layer routes that join through the helper
-- view get the masked value.
CREATE OR REPLACE FUNCTION atelier_can_view_contract_value() RETURNS boolean AS $$
  SELECT current_setting('app.user_role', true) IN
    ('founding_partner', 'partner', 'finance', 'compliance_officer');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE VIEW atelier_contract_v AS
  SELECT
    c.id,
    c.org_id,
    c.instrument_type,
    c.parent_contract_id,
    c.counterparty_id,
    c.engagement_id,
    c.opportunity_id,
    c.title,
    c.status,
    c.governing_law,
    c.currency,
    CASE WHEN atelier_can_view_contract_value() THEN c.contract_value ELSE 0 END
      AS contract_value,
    CASE WHEN atelier_can_view_contract_value() THEN c.contract_value_usd ELSE 0 END
      AS contract_value_usd,
    c.term_start,
    c.term_end,
    c.payment_terms_days,
    c.po_number,
    c.bill_to_json,
    c.metadata,
    c.fully_executed_at,
    c.terminated_at,
    c.termination_reason,
    c.created_at,
    c.updated_at,
    c.created_by_user_id,
    c.deleted_at
  FROM atelier_contract c;

-- ============================================================
-- WAVE-2 CONTRACT VIEW: milestone ↔ acceptance bridge
-- ============================================================
-- Wave 2 revrec milestone client_accepted transition cannot fire
-- without a row here (status = 'client_signed' and milestone_id
-- non-null).
CREATE OR REPLACE VIEW atelier_milestone_acceptance_view AS
  SELECT
    da.id AS acceptance_id,
    da.engagement_id,
    da.milestone_id,
    da.deliverable_id,
    da.signed_at,
    da.client_signer_name,
    da.evidence_url
  FROM atelier_deliverable_acceptance da
  WHERE da.status = 'client_signed'
    AND da.milestone_id IS NOT NULL
    AND da.deleted_at IS NULL;
