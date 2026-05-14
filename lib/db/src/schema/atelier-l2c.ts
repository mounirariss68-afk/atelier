/**
 * THE ATELIER — Lead-to-Cash Wave 1 schema (Task #360).
 *
 * Codex (CLM) + change orders + deliverable acceptance. The contract
 * becomes a first-class portal artifact and the seam between delivery
 * and revenue gets bound: every Wave-2 milestone-based revenue
 * recognition keys off `atelier_deliverable_acceptance`; every Wave-3
 * milestone invoice keys off the same; backlog reads
 * `atelier_contract.contract_value`.
 *
 * Conventions (mirrors atelier-v5.ts):
 *   - text PKs (deterministic slugs so seed/audit traffic stays readable)
 *   - org_id default 'aico' (multi-tenant scope, app + RLS enforced)
 *   - created_at / updated_at / created_by_user_id / deleted_at
 *
 * Engagement scoping. Contract / change-order / deliverable-acceptance
 * / DPA tables carry an `engagement_id` and are RLS-narrowed via the
 * `app.engagement_ids` GUC + `atelier_engagement_allowed()` (defined
 * in 0031). Counterparty / clause / insurance-certificate tables are
 * firm-wide reference data (org-scoped only).
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ORG = (name: string) => text(name).notNull().default("aico");
const COMMON = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: text("created_by_user_id"),
  deletedAt: timestamp("deleted_at"),
};

// ============================================================
// COUNTERPARTY (firm-wide registry)
// ============================================================
// Counterparty kinds:
//   client | partner_firm | contractor | regulator | other
// kyc_state: pending | approved | refresh_due | blocked
export const atelierCounterparty = pgTable(
  "atelier_counterparty",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    kind: text("kind").notNull(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    accountId: text("account_id"), // back-reference to atelier_accounts when kind=client
    jurisdiction: text("jurisdiction").notNull().default(""), // ISO-3166 country code
    billToAddress: jsonb("bill_to_address")
      .$type<{
        line1: string;
        line2?: string;
        city: string;
        region?: string;
        postalCode?: string;
        country: string;
      } | null>()
      .default(null),
    vatNumber: text("vat_number").notNull().default(""), // VAT/VRN/Tax ID
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    kycState: text("kyc_state").notNull().default("pending"),
    kycReviewedAt: timestamp("kyc_reviewed_at"),
    notes: text("notes").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_counterparty_org").on(t.orgId),
    index("idx_atelier_counterparty_kind").on(t.kind),
    index("idx_atelier_counterparty_account").on(t.accountId),
    uniqueIndex("uniq_atelier_counterparty_legal").on(t.orgId, t.legalName),
  ],
);

// ============================================================
// CLAUSE LIBRARY (firm-wide; versioned)
// ============================================================
// Risk tiers: low | medium | high
// Status: draft | published | retired
export const atelierClause = pgTable(
  "atelier_clause",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    family: text("family").notNull(), // e.g. "limitation_of_liability", "ip_ownership"
    title: text("title").notNull(),
    body: text("body").notNull(),
    version: integer("version").notNull().default(1),
    parentId: text("parent_id"), // points at previous version
    jurisdictionTags: jsonb("jurisdiction_tags").$type<string[]>().notNull().default([]),
    instrumentTypes: jsonb("instrument_types").$type<string[]>().notNull().default([]), // ["msa","sow","nda","dpa"]
    riskTier: text("risk_tier").notNull().default("low"),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at"),
    publishedByUserId: text("published_by_user_id"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_clause_org").on(t.orgId),
    index("idx_atelier_clause_family").on(t.family),
    index("idx_atelier_clause_status").on(t.status),
    uniqueIndex("uniq_atelier_clause_family_version").on(t.orgId, t.family, t.version),
  ],
);

// Per-counterparty acceptance ledger so the Composer can cite
// "previously accepted by this client". Append-only.
export const atelierClauseAcceptance = pgTable(
  "atelier_clause_acceptance",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    counterpartyId: text("counterparty_id").notNull(),
    clauseId: text("clause_id").notNull(),
    contractId: text("contract_id"), // the contract this acceptance was observed in
    acceptedAt: timestamp("accepted_at").notNull(),
    customizationsJson: jsonb("customizations_json").default(null),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_clause_acc_cp").on(t.counterpartyId),
    index("idx_atelier_clause_acc_clause").on(t.clauseId),
  ],
);

// ============================================================
// CONTRACT (engagement-scoped; the master record)
// ============================================================
// Instrument types: msa | sow | nda | dpa | change_order | side_letter | renewal
// Status (state machine; transitions enforced server-side):
//   draft → internal_review → two_partner_countersigned →
//   external_dispatched → counterparty_review → fully_executed →
//   active → expiring → renewed | expired | terminated
export const atelierContract = pgTable(
  "atelier_contract",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    instrumentType: text("instrument_type").notNull(),
    parentContractId: text("parent_contract_id"), // SOW under MSA; change_order under SOW
    counterpartyId: text("counterparty_id").notNull(),
    // engagement_id is null until an opportunity converts and the contract is
    // attached to an engagement; nullable so MSAs (firm-wide framework) work.
    engagementId: text("engagement_id"),
    opportunityId: text("opportunity_id"),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    governingLaw: text("governing_law").notNull().default(""), // jurisdiction key
    currency: text("currency").notNull().default("USD"),
    contractValue: doublePrecision("contract_value").notNull().default(0),
    contractValueUsd: doublePrecision("contract_value_usd").notNull().default(0),
    termStart: text("term_start"), // ISO date — nullable until executed
    termEnd: text("term_end"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    poNumber: text("po_number").notNull().default(""),
    billToJson: jsonb("bill_to_json").default(null), // snapshot of counterparty bill-to at signing
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    fullyExecutedAt: timestamp("fully_executed_at"),
    terminatedAt: timestamp("terminated_at"),
    terminationReason: text("termination_reason").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_contract_org").on(t.orgId),
    index("idx_atelier_contract_engagement").on(t.engagementId),
    index("idx_atelier_contract_counterparty").on(t.counterpartyId),
    index("idx_atelier_contract_opportunity").on(t.opportunityId),
    index("idx_atelier_contract_status").on(t.status),
    index("idx_atelier_contract_term_end").on(t.termEnd),
  ],
);

// Contract ↔ Clause junction (positions + customizations).
export const atelierContractClause = pgTable(
  "atelier_contract_clause",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    contractId: text("contract_id").notNull(),
    clauseId: text("clause_id").notNull(),
    position: integer("position").notNull().default(0),
    customizationsJson: jsonb("customizations_json").default(null),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_contract_clause_contract").on(t.contractId),
    index("idx_atelier_contract_clause_clause").on(t.clauseId),
    uniqueIndex("uniq_atelier_contract_clause_position").on(t.contractId, t.position),
  ],
);

// Contract parties — the people / entities who sign or are notice parties.
// Roles: signer | witness | notice_party | observer
// SignState: pending | sent | signed | declined | expired
export const atelierContractParty = pgTable(
  "atelier_contract_party",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    contractId: text("contract_id").notNull(),
    counterpartyId: text("counterparty_id"), // null for internal AICo signers
    internalUserId: text("internal_user_id"), // AICo signer
    roleOnContract: text("role_on_contract").notNull(),
    signerName: text("signer_name").notNull(),
    signerEmail: text("signer_email").notNull(),
    signerTitle: text("signer_title").notNull().default(""),
    signState: text("sign_state").notNull().default("pending"),
    signMethod: text("sign_method").notNull().default("docusign"), // docusign | tabellio | wet_ink_pdf
    sentAt: timestamp("sent_at"),
    signedAt: timestamp("signed_at"),
    signEvidenceUrl: text("sign_evidence_url").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_contract_party_contract").on(t.contractId),
    index("idx_atelier_contract_party_state").on(t.signState),
  ],
);

// Immutable version snapshots (the rendered body at each transition).
export const atelierContractVersion = pgTable(
  "atelier_contract_version",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    contractId: text("contract_id").notNull(),
    version: integer("version").notNull(),
    renderedBody: text("rendered_body").notNull(),
    bodyHash: text("body_hash").notNull(),
    snapshotReason: text("snapshot_reason").notNull(), // "draft" | "internal_review" | ...
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
  },
  (t) => [
    index("idx_atelier_contract_version_contract").on(t.contractId),
    uniqueIndex("uniq_atelier_contract_version").on(t.contractId, t.version),
  ],
);

// Clause-by-clause redline diffs (Redline Analyst output).
// RiskTier: low | medium | high
// Status: open | accepted | rejected | superseded
export const atelierContractRedline = pgTable(
  "atelier_contract_redline",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    contractId: text("contract_id").notNull(),
    contractVersionId: text("contract_version_id").notNull(),
    clauseId: text("clause_id"),
    proposedBody: text("proposed_body").notNull(),
    diffJson: jsonb("diff_json").$type<{ before: string; after: string; ops: unknown[] } | null>().default(null),
    riskTier: text("risk_tier").notNull().default("low"),
    riskCommentary: text("risk_commentary").notNull().default(""),
    status: text("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_contract_redline_contract").on(t.contractId),
    index("idx_atelier_contract_redline_status").on(t.status),
  ],
);

// Two-Partner Countersign gate (per v4 Resolution 6).
// State: pending | partner_a_signed | both_signed | declined
export const atelierTwoPartnerCountersign = pgTable(
  "atelier_two_partner_countersign",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    contractId: text("contract_id").notNull(),
    partnerAUserId: text("partner_a_user_id").notNull(),
    partnerBUserId: text("partner_b_user_id").notNull(),
    partnerASignedAt: timestamp("partner_a_signed_at"),
    partnerBSignedAt: timestamp("partner_b_signed_at"),
    state: text("state").notNull().default("pending"),
    rationaleText: text("rationale_text").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    uniqueIndex("uniq_atelier_two_partner_countersign_contract").on(t.contractId),
    index("idx_atelier_two_partner_countersign_state").on(t.state),
  ],
);

// ============================================================
// CHANGE ORDER (engagement-scoped)
// ============================================================
// Kind: scope | rate | term | team
// Status: draft → partner_approved → client_proposed →
//   client_accepted | client_rejected | withdrawn → posted
export const atelierChangeOrder = pgTable(
  "atelier_change_order",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    parentContractId: text("parent_contract_id"), // the SOW being amended
    contractId: text("contract_id"), // the change_order contract once formalised
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    rationaleText: text("rationale_text").notNull().default(""),
    oldValueJson: jsonb("old_value_json").default(null),
    newValueJson: jsonb("new_value_json").default(null),
    valueDeltaUsd: doublePrecision("value_delta_usd").notNull().default(0),
    status: text("status").notNull().default("draft"),
    proposedByUserId: text("proposed_by_user_id"),
    partnerApproverUserId: text("partner_approver_user_id"),
    partnerApprovedAt: timestamp("partner_approved_at"),
    clientProposedAt: timestamp("client_proposed_at"),
    clientResolvedAt: timestamp("client_resolved_at"),
    clientSignerName: text("client_signer_name").notNull().default(""),
    clientSignerEmail: text("client_signer_email").notNull().default(""),
    evidenceUrl: text("evidence_url").notNull().default(""),
    postedAt: timestamp("posted_at"),
    linkedRaidId: text("linked_raid_id"), // for migrating existing RAID-as-change items
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_change_order_engagement").on(t.engagementId),
    index("idx_atelier_change_order_status").on(t.status),
    index("idx_atelier_change_order_parent").on(t.parentContractId),
    index("idx_atelier_change_order_contract").on(t.contractId),
  ],
);

// ============================================================
// DELIVERABLE ACCEPTANCE (engagement-scoped; Wave-2 revrec hinge)
// ============================================================
// Status: pending → submitted_to_client → client_signed | client_rejected | withdrawn
// Wave-2 milestone state machine cannot transition to client_accepted
// unless a row here exists with status = 'client_signed' bound to the
// milestone via milestone_id.
export const atelierDeliverableAcceptance = pgTable(
  "atelier_deliverable_acceptance",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    deliverableId: text("deliverable_id"), // back-ref to atelier_deliverables when one exists
    milestoneId: text("milestone_id"), // populated when bound to a Wave-2 revrec milestone
    title: text("title").notNull(),
    attestationText: text("attestation_text").notNull(),
    status: text("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at"),
    submittedByUserId: text("submitted_by_user_id"),
    clientSignerName: text("client_signer_name").notNull().default(""),
    clientSignerEmail: text("client_signer_email").notNull().default(""),
    clientSignerTitle: text("client_signer_title").notNull().default(""),
    signedAt: timestamp("signed_at"),
    recordedByUserId: text("recorded_by_user_id"), // Finance who recorded the signed PDF
    evidenceUrl: text("evidence_url").notNull().default(""),
    rejectionReason: text("rejection_reason").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_deliv_acc_engagement").on(t.engagementId),
    index("idx_atelier_deliv_acc_milestone").on(t.milestoneId),
    index("idx_atelier_deliv_acc_status").on(t.status),
  ],
);

// ============================================================
// DPA (engagement-scoped; compliance_officer firm-wide read)
// ============================================================
// Status: required → drafted → signed → active → reviewed → expired
export const atelierDpa = pgTable(
  "atelier_dpa",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    contractId: text("contract_id"), // the DPA instrument contract once signed
    counterpartyId: text("counterparty_id").notNull(),
    dataClasses: jsonb("data_classes").$type<string[]>().notNull().default([]), // ["pii","phi","financial","regulated_other"]
    processorChain: jsonb("processor_chain").$type<Array<{ name: string; role: string; jurisdiction: string }>>().notNull().default([]),
    status: text("status").notNull().default("required"),
    signedAt: timestamp("signed_at"),
    expiresAt: timestamp("expires_at"),
    lastReviewedAt: timestamp("last_reviewed_at"),
    notes: text("notes").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_dpa_engagement").on(t.engagementId),
    index("idx_atelier_dpa_counterparty").on(t.counterpartyId),
    index("idx_atelier_dpa_status").on(t.status),
  ],
);

// ============================================================
// INSURANCE CERTIFICATE (counterparty-scoped; firm-wide read)
// ============================================================
// Kind: pi | pl | cyber | workers_comp | other
export const atelierInsuranceCertificate = pgTable(
  "atelier_insurance_certificate",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    counterpartyId: text("counterparty_id").notNull(),
    kind: text("kind").notNull(),
    insurerName: text("insurer_name").notNull(),
    policyNumber: text("policy_number").notNull(),
    coverageLimitUsd: doublePrecision("coverage_limit_usd").notNull().default(0),
    coverageStart: text("coverage_start").notNull(),
    coverageEnd: text("coverage_end").notNull(),
    certificateUrl: text("certificate_url").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_insurance_counterparty").on(t.counterpartyId),
    index("idx_atelier_insurance_kind").on(t.kind),
  ],
);
