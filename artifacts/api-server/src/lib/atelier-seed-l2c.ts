/**
 * THE ATELIER — Lead-to-Cash Wave 1 demo seed (Task #360).
 *
 * Idempotent seed for Codex (CLM): counterparties + clause library +
 * three live contracts + one DPA + one signed deliverable acceptance.
 * Bound to the existing demo engagements (eng_tasama_bpo_phase1,
 * eng_dge_effortless_v1, eng_nhc_ar_pilot) and accounts (acc_tasama,
 * acc_dge, acc_nhc) so the /codex workspace, change-order modal, and
 * deliverable acceptance UI all show real data on cold start.
 *
 * Mirrors the upsertById pattern in atelier-seed-v5.ts. Safe to call on
 * every cold start — every insert is gated on existence.
 */
import { sql, inArray, eq, and, isNull, type InferInsertModel } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  atelierAccounts,
  atelierEngagements,
  atelierCounterparty,
  atelierClause,
  atelierContract,
  atelierContractClause,
  atelierContractParty,
  atelierDpa,
  atelierDeliverableAcceptance,
  atelierChangeOrder,
} from "@workspace/db";
import { logger } from "./logger.js";
import { applyPostedChangeOrder } from "../data/atelier-engagement-pnl-seed.js";

type WithIdColumn = PgTable & { id: PgColumn };

async function upsertById<T extends WithIdColumn>(
  table: T,
  rows: Array<InferInsertModel<T> & { id: string }>,
): Promise<void> {
  for (const row of rows) {
    const existing = await db.execute(
      sql`select 1 from ${table} where ${table.id} = ${row.id} limit 1`,
    );
    if (existing.rows.length === 0) {
      await db.insert(table).values(row);
    }
  }
}

const REQUIRED_ACCOUNT_IDS = ["acc_tasama", "acc_dge", "acc_nhc"] as const;
const REQUIRED_ENGAGEMENT_IDS = [
  "eng_tasama_bpo_phase1",
  "eng_dge_effortless_v1",
] as const;

async function preflightReferentialIntegrity(): Promise<void> {
  const [accountRows, engagementRows] = await Promise.all([
    db
      .select({ id: atelierAccounts.id })
      .from(atelierAccounts)
      .where(inArray(atelierAccounts.id, [...REQUIRED_ACCOUNT_IDS])),
    db
      .select({ id: atelierEngagements.id })
      .from(atelierEngagements)
      .where(inArray(atelierEngagements.id, [...REQUIRED_ENGAGEMENT_IDS])),
  ]);
  const haveAccounts = new Set(accountRows.map((r) => r.id));
  const haveEngagements = new Set(engagementRows.map((r) => r.id));
  const missingAccounts = REQUIRED_ACCOUNT_IDS.filter(
    (id) => !haveAccounts.has(id),
  );
  const missingEngagements = REQUIRED_ENGAGEMENT_IDS.filter(
    (id) => !haveEngagements.has(id),
  );
  if (missingAccounts.length > 0 || missingEngagements.length > 0) {
    throw new Error(
      `atelier-seed-l2c preflight failed — missing accounts=[${missingAccounts.join(",")}] engagements=[${missingEngagements.join(",")}]`,
    );
  }
}

const COUNTERPARTIES: CounterpartyRow[] = [
  {
    id: "cp_tasama",
    kind: "client",
    legalName: "Tasama Business Services Co. Ltd.",
    displayName: "Tasama",
    accountId: "acc_tasama",
    jurisdiction: "SA",
    vatNumber: "300123456700003",
    paymentTermsDays: 30,
    kycState: "approved",
    notes: "Primary BPO client; Riyadh HQ. KYC refreshed 2026-Q1.",
  },
  {
    id: "cp_dge",
    kind: "client",
    legalName: "Department of Government Enablement — Abu Dhabi",
    displayName: "DGE",
    accountId: "acc_dge",
    jurisdiction: "AE",
    vatNumber: "100987654300003",
    paymentTermsDays: 45,
    kycState: "approved",
    notes: "Effortless v1 pilot delivery counterparty.",
  },
  {
    id: "cp_nhc",
    kind: "client",
    legalName: "National Housing Company",
    displayName: "NHC",
    accountId: "acc_nhc",
    jurisdiction: "SA",
    vatNumber: "300555444200003",
    paymentTermsDays: 30,
    kycState: "approved",
    notes: "Arabic-first chat pilot — synthetic data scope.",
  },
];

const PUBLISHED_AT = new Date("2026-01-15T09:00:00Z");

type CounterpartyRow = InferInsertModel<typeof atelierCounterparty> & {
  id: string;
};
type ClauseRow = InferInsertModel<typeof atelierClause> & { id: string };
type ContractRow = InferInsertModel<typeof atelierContract> & { id: string };
type ContractClauseRow = InferInsertModel<typeof atelierContractClause> & {
  id: string;
};
type ContractPartyRow = InferInsertModel<typeof atelierContractParty> & {
  id: string;
};
type DpaRow = InferInsertModel<typeof atelierDpa> & { id: string };
type AcceptanceRow = InferInsertModel<typeof atelierDeliverableAcceptance> & {
  id: string;
};
type ChangeOrderRow = InferInsertModel<typeof atelierChangeOrder> & {
  id: string;
};

const CLAUSES: ClauseRow[] = [
  {
    id: "cl_lol_v1",
    family: "limitation_of_liability",
    title: "Limitation of Liability — 1× fees, 12 mo",
    body: "Each party's aggregate liability shall not exceed the fees paid in the twelve (12) months preceding the claim. Excluded: indemnities, confidentiality breach, gross negligence.",
    version: 1,
    instrumentTypes: ["msa", "sow"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "medium",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_lol_v2",
    family: "limitation_of_liability",
    title: "Limitation of Liability — 1.5× fees, 24 mo",
    body: "Each party's aggregate liability shall not exceed 1.5× the fees paid in the twenty-four (24) months preceding the claim. Excluded: indemnities, confidentiality breach, gross negligence, willful misconduct.",
    version: 2,
    parentId: "cl_lol_v1",
    instrumentTypes: ["msa", "sow"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "medium",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_ip_v1",
    family: "ip_ownership",
    title: "IP Ownership — Client owns Deliverables; AICo retains Tools",
    body: "Client owns all custom Deliverables on full payment. AICo retains all rights in pre-existing Tools, methodologies, and reusable components, granting Client a perpetual, royalty-free license to use them embedded within the Deliverables.",
    version: 1,
    instrumentTypes: ["msa", "sow"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "high",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_conf_v1",
    family: "confidentiality",
    title: "Confidentiality — 5 yr post-term",
    body: "Each party shall keep Confidential Information confidential for five (5) years after termination. Standard exclusions for public domain, independently developed, and lawfully received from third parties.",
    version: 1,
    instrumentTypes: ["msa", "nda", "sow"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "low",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_indem_v1",
    family: "indemnification",
    title: "Indemnification — IP infringement (mutual)",
    body: "Each party shall indemnify the other against third-party claims of IP infringement arising from materials it provides, subject to prompt notice, sole control of defense, and reasonable cooperation.",
    version: 1,
    instrumentTypes: ["msa", "sow"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "high",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_indem_v2",
    family: "indemnification",
    title: "Indemnification — IP + data breach (mutual, capped)",
    body: "Each party shall indemnify the other against third-party claims of IP infringement and data-breach liabilities, capped at 2× contract value. Excluded: indirect, consequential, or punitive damages.",
    version: 2,
    parentId: "cl_indem_v1",
    instrumentTypes: ["msa", "sow", "dpa"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "high",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_law_uae_v1",
    family: "governing_law_uae",
    title: "Governing Law — UAE (DIFC courts)",
    body: "This Agreement is governed by the laws of the United Arab Emirates as applied in the Dubai International Financial Centre. The DIFC Courts shall have exclusive jurisdiction.",
    version: 1,
    instrumentTypes: ["msa", "sow", "nda", "dpa"],
    jurisdictionTags: ["AE"],
    riskTier: "low",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_law_ksa_v1",
    family: "governing_law_ksa",
    title: "Governing Law — KSA (Riyadh commercial courts)",
    body: "This Agreement is governed by the laws of the Kingdom of Saudi Arabia. Disputes shall be referred to the commercial courts of Riyadh.",
    version: 1,
    instrumentTypes: ["msa", "sow", "nda", "dpa"],
    jurisdictionTags: ["SA"],
    riskTier: "low",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_dpa_v1",
    family: "data_processing",
    title: "Data Processing — controller/processor (GDPR-aligned)",
    body: "AICo acts as Processor for Personal Data on documented instructions from Client (Controller). Sub-processors require 30-day prior written notice. Cross-border transfers under SCCs.",
    version: 1,
    instrumentTypes: ["dpa"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "high",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_dpa_v2",
    family: "data_processing",
    title: "Data Processing — controller/processor (GDPR + UAE PDPL)",
    body: "AICo acts as Processor for Personal Data under both GDPR and UAE PDPL. Sub-processors require 30-day notice. Cross-border transfers limited to AE/SA/EEA. Annual audit right for Client.",
    version: 2,
    parentId: "cl_dpa_v1",
    instrumentTypes: ["dpa"],
    jurisdictionTags: ["AE"],
    riskTier: "high",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_term_v1",
    family: "termination_for_convenience",
    title: "Termination for Convenience — 30 days notice",
    body: "Either party may terminate this Agreement for convenience on thirty (30) days' written notice. Client shall pay for Services performed and Deliverables accepted through the effective date of termination.",
    version: 1,
    instrumentTypes: ["msa", "sow"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "medium",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
  {
    id: "cl_pay_v1",
    family: "payment_terms_net30",
    title: "Payment Terms — Net 30 from invoice",
    body: "Invoices are payable within thirty (30) days of receipt. Late payments accrue interest at 1.0% per month or the maximum rate permitted by law, whichever is lower.",
    version: 1,
    instrumentTypes: ["msa", "sow"],
    jurisdictionTags: ["AE", "SA"],
    riskTier: "low",
    status: "published",
    publishedAt: PUBLISHED_AT,
  },
];

const CONTRACTS: ContractRow[] = [
  {
    id: "ct_msa_tasama",
    instrumentType: "msa",
    counterpartyId: "cp_tasama",
    engagementId: null,
    opportunityId: null,
    title: "MSA — AICo ↔ Tasama (2026)",
    status: "active",
    governingLaw: "SA",
    currency: "USD",
    contractValue: 0,
    contractValueUsd: 0,
    termStart: "2026-01-15",
    termEnd: "2029-01-14",
    paymentTermsDays: 30,
    fullyExecutedAt: new Date("2026-01-12T14:30:00Z"),
  },
  {
    id: "ct_sow_tasama_p1",
    instrumentType: "sow",
    parentContractId: "ct_msa_tasama",
    counterpartyId: "cp_tasama",
    engagementId: "eng_tasama_bpo_phase1",
    opportunityId: null,
    title: "SOW — Tasama Agentic BPO Phase 1",
    status: "active",
    governingLaw: "SA",
    currency: "USD",
    contractValue: 1_850_000,
    contractValueUsd: 1_850_000,
    termStart: "2026-02-01",
    termEnd: "2026-09-30",
    paymentTermsDays: 30,
    poNumber: "PO-TSM-2026-0117",
    fullyExecutedAt: new Date("2026-01-28T11:15:00Z"),
  },
  {
    id: "ct_sow_dge_v1",
    instrumentType: "sow",
    counterpartyId: "cp_dge",
    engagementId: "eng_dge_effortless_v1",
    opportunityId: null,
    title: "SOW — DGE Effortless v1 Pilot Delivery",
    status: "fully_executed",
    governingLaw: "AE",
    currency: "USD",
    contractValue: 740_000,
    contractValueUsd: 740_000,
    termStart: "2026-03-01",
    termEnd: "2026-08-31",
    paymentTermsDays: 45,
    poNumber: "PO-DGE-2026-A284",
    fullyExecutedAt: new Date("2026-02-22T09:45:00Z"),
  },
];

const CONTRACT_CLAUSES: ContractClauseRow[] = [
  // MSA Tasama: 6 standard clauses
  { id: "cc_msa_tas_1", contractId: "ct_msa_tasama", clauseId: "cl_law_ksa_v1", position: 1 },
  { id: "cc_msa_tas_2", contractId: "ct_msa_tasama", clauseId: "cl_conf_v1", position: 2 },
  { id: "cc_msa_tas_3", contractId: "ct_msa_tasama", clauseId: "cl_lol_v2", position: 3 },
  { id: "cc_msa_tas_4", contractId: "ct_msa_tasama", clauseId: "cl_ip_v1", position: 4 },
  { id: "cc_msa_tas_5", contractId: "ct_msa_tasama", clauseId: "cl_indem_v2", position: 5 },
  { id: "cc_msa_tas_6", contractId: "ct_msa_tasama", clauseId: "cl_pay_v1", position: 6 },
  // SOW Tasama Phase 1: 3 SOW-specific
  { id: "cc_sow_tas_1", contractId: "ct_sow_tasama_p1", clauseId: "cl_term_v1", position: 1 },
  { id: "cc_sow_tas_2", contractId: "ct_sow_tasama_p1", clauseId: "cl_lol_v2", position: 2 },
  { id: "cc_sow_tas_3", contractId: "ct_sow_tasama_p1", clauseId: "cl_pay_v1", position: 3 },
  // SOW DGE: 4 clauses
  { id: "cc_sow_dge_1", contractId: "ct_sow_dge_v1", clauseId: "cl_law_uae_v1", position: 1 },
  { id: "cc_sow_dge_2", contractId: "ct_sow_dge_v1", clauseId: "cl_conf_v1", position: 2 },
  { id: "cc_sow_dge_3", contractId: "ct_sow_dge_v1", clauseId: "cl_lol_v1", position: 3 },
  { id: "cc_sow_dge_4", contractId: "ct_sow_dge_v1", clauseId: "cl_ip_v1", position: 4 },
];

const CONTRACT_PARTIES: ContractPartyRow[] = [
  // MSA Tasama — AICo Founding Partner + Tasama CEO
  {
    id: "cp_party_msa_tas_aico",
    contractId: "ct_msa_tasama",
    counterpartyId: null,
    roleOnContract: "signer",
    signerName: "Gökhan Yılmaz",
    signerEmail: "gokhan@aico.studio",
    signerTitle: "Founding Partner",
    signState: "signed",
    signMethod: "docusign",
    signedAt: new Date("2026-01-12T14:25:00Z"),
    signEvidenceUrl: "https://docusign.example.com/envelope/msa-tas-2026-aico",
  },
  {
    id: "cp_party_msa_tas_client",
    contractId: "ct_msa_tasama",
    counterpartyId: "cp_tasama",
    roleOnContract: "signer",
    signerName: "Khalid Al-Sayed",
    signerEmail: "khalid.alsayed@tasama.sa",
    signerTitle: "Chief Operating Officer",
    signState: "signed",
    signMethod: "docusign",
    signedAt: new Date("2026-01-12T14:30:00Z"),
    signEvidenceUrl: "https://docusign.example.com/envelope/msa-tas-2026-client",
  },
  // SOW DGE — AICo Senior Manager + DGE Director
  {
    id: "cp_party_sow_dge_aico",
    contractId: "ct_sow_dge_v1",
    counterpartyId: null,
    roleOnContract: "signer",
    signerName: "Lina Haddad",
    signerEmail: "lina@aico.studio",
    signerTitle: "Senior Manager — Public Sector",
    signState: "signed",
    signMethod: "docusign",
    signedAt: new Date("2026-02-22T09:40:00Z"),
    signEvidenceUrl: "https://docusign.example.com/envelope/sow-dge-2026-aico",
  },
  {
    id: "cp_party_sow_dge_client",
    contractId: "ct_sow_dge_v1",
    counterpartyId: "cp_dge",
    roleOnContract: "signer",
    signerName: "Dr. Mariam Al-Mansouri",
    signerEmail: "m.almansouri@dge.gov.ae",
    signerTitle: "Director — Service Transformation",
    signState: "signed",
    signMethod: "docusign",
    signedAt: new Date("2026-02-22T09:45:00Z"),
    signEvidenceUrl: "https://docusign.example.com/envelope/sow-dge-2026-client",
  },
];

const DPAS: DpaRow[] = [
  {
    id: "dpa_dge_v1",
    engagementId: "eng_dge_effortless_v1",
    contractId: "ct_sow_dge_v1",
    counterpartyId: "cp_dge",
    dataClasses: ["pii", "regulated_other"],
    processorChain: [
      { name: "AICo", role: "processor", jurisdiction: "AE" },
      { name: "Anthropic (Claude)", role: "subprocessor", jurisdiction: "US" },
      { name: "AWS Bahrain", role: "subprocessor", jurisdiction: "BH" },
    ],
    status: "active",
    signedAt: new Date("2026-02-22T09:50:00Z"),
    expiresAt: new Date("2027-02-22T00:00:00Z"),
    lastReviewedAt: new Date("2026-04-01T10:00:00Z"),
    notes: "GDPR + UAE PDPL aligned. Annual audit window: April.",
  },
];

const DELIVERABLE_ACCEPTANCES: AcceptanceRow[] = [
  {
    id: "dlacc_dge_phase1_report",
    engagementId: "eng_dge_effortless_v1",
    deliverableId: null,
    milestoneId: null,
    title: "DGE Effortless v1 — Phase 1 Final Report",
    attestationText:
      "DGE confirms receipt and acceptance of the Phase 1 Final Report dated 2026-04-15, including the customer-effort baseline, agent-impact analysis, and forward roadmap.",
    status: "client_signed",
    submittedAt: new Date("2026-04-16T08:00:00Z"),
    clientSignerName: "Dr. Mariam Al-Mansouri",
    clientSignerEmail: "m.almansouri@dge.gov.ae",
    clientSignerTitle: "Director — Service Transformation",
    signedAt: new Date("2026-04-18T13:22:00Z"),
    evidenceUrl: "https://docusign.example.com/envelope/dlacc-dge-phase1-2026",
  },
];

// ============================================================
// CHANGE ORDERS — Task #431
// Migrate the Wave-2 in-memory seed into the real
// `atelier_change_order` table so the engagement-pnl pages can read
// from the workflow-of-record.
//
// Status mapping from the old mock workflow:
//   approved  → posted              (terminal, re-baselined)
//   submitted → partner_approved    (awaiting dispatch — closest open
//                                    state in the real machine)
//   draft     → draft
//   rejected  → client_rejected
// ============================================================
const CHANGE_ORDERS: ChangeOrderRow[] = [
  {
    id: "co_tasama_001",
    engagementId: "eng_tasama_bpo_phase1",
    parentContractId: null,
    kind: "scope",
    summary:
      "Add Arabic-language conversational coverage for top-3 services (out-of-scope in original SOW).",
    rationaleText:
      "Δ hours +720 · Δ cost impact +$100,800. Approved & posted; engagement re-baselined.",
    valueDeltaUsd: 180_000,
    // Task #455 — encoded from the rationale text above.
    labourHoursDelta: 720,
    labourCostDeltaUsd: 100_800,
    expensesDeltaUsd: 0,
    subsDeltaUsd: 0,
    status: "posted",
    proposedByUserId: "p_layla_haddad",
    partnerApproverUserId: "p_mounir_ariss",
    partnerApprovedAt: new Date("2026-04-12T10:00:00Z"),
    clientProposedAt: new Date("2026-04-12T11:00:00Z"),
    clientResolvedAt: new Date("2026-04-15T14:00:00Z"),
    clientSignerName: "Faisal Al-Otaibi",
    clientSignerEmail: "f.alotaibi@tasama.sa",
    evidenceUrl: "https://docusign.example.com/envelope/co-tasama-001",
    postedAt: new Date("2026-04-17T09:00:00Z"),
    createdAt: new Date("2026-04-05T08:00:00Z"),
  },
  {
    id: "co_tasama_002",
    engagementId: "eng_tasama_bpo_phase1",
    parentContractId: null,
    kind: "term",
    summary:
      "Extend rollout cadence by two weeks to absorb client's holiday freeze; partner-firm subs to bridge.",
    rationaleText:
      "Δ hours +240 · Δ cost impact +$50,400. Partner-approved; awaiting dispatch to client.",
    valueDeltaUsd: 60_000,
    // Task #455 — encoded from the rationale text. The 240h × $140
    // blended cost rate accounts for $33,600 of labour cost; the
    // remaining $16,800 is the partner-firm subs bridge called out in
    // the summary.
    labourHoursDelta: 240,
    labourCostDeltaUsd: 33_600,
    expensesDeltaUsd: 0,
    subsDeltaUsd: 16_800,
    status: "partner_approved",
    proposedByUserId: "p_layla_haddad",
    partnerApproverUserId: "p_mounir_ariss",
    partnerApprovedAt: new Date("2026-05-11T16:00:00Z"),
    clientSignerName: "",
    clientSignerEmail: "",
    evidenceUrl: "",
    createdAt: new Date("2026-05-09T08:00:00Z"),
  },
  {
    id: "co_nhc_001",
    engagementId: "eng_nhc_ar_pilot",
    parentContractId: null,
    kind: "scope",
    summary:
      "Add CRM hand-off integration discovered during week-2 walkthrough; client agreed in steering.",
    rationaleText:
      "Δ hours +240 · Δ cost impact +$33,600. Partner-approved; awaiting dispatch.",
    valueDeltaUsd: 72_000,
    // Task #455 — encoded from the rationale text (240h × $140 = $33,600).
    labourHoursDelta: 240,
    labourCostDeltaUsd: 33_600,
    expensesDeltaUsd: 0,
    subsDeltaUsd: 0,
    status: "partner_approved",
    proposedByUserId: "p_layla_haddad",
    partnerApproverUserId: "p_mounir_ariss",
    partnerApprovedAt: new Date("2026-05-13T09:00:00Z"),
    clientSignerName: "",
    clientSignerEmail: "",
    evidenceUrl: "",
    createdAt: new Date("2026-05-12T08:00:00Z"),
  },
  {
    id: "co_dge_001",
    engagementId: "eng_dge_effortless_v1",
    parentContractId: null,
    kind: "scope",
    summary: "Carve-out of compliance dashboard scope; client deferred to phase 2.",
    rationaleText:
      "Δ hours -150 · Δ cost impact -$21,000. Posted; engagement re-baselined down.",
    valueDeltaUsd: -45_000,
    // Task #455 — encoded from the rationale text (-150h × $140 = -$21,000).
    labourHoursDelta: -150,
    labourCostDeltaUsd: -21_000,
    expensesDeltaUsd: 0,
    subsDeltaUsd: 0,
    status: "posted",
    proposedByUserId: "p_omar_najjar",
    partnerApproverUserId: "p_mounir_ariss",
    partnerApprovedAt: new Date("2026-01-18T10:00:00Z"),
    clientProposedAt: new Date("2026-01-18T11:00:00Z"),
    clientResolvedAt: new Date("2026-01-20T15:00:00Z"),
    clientSignerName: "Dr. Mariam Al-Mansouri",
    clientSignerEmail: "m.almansouri@dge.gov.ae",
    evidenceUrl: "https://docusign.example.com/envelope/co-dge-001",
    postedAt: new Date("2026-01-21T09:00:00Z"),
    createdAt: new Date("2026-01-15T08:00:00Z"),
  },
];

let l2cSeedPromise: Promise<void> | null = null;

export async function ensureAtelierL2cSeed(): Promise<void> {
  if (l2cSeedPromise) return l2cSeedPromise;
  l2cSeedPromise = (async () => {
    await preflightReferentialIntegrity();
    await upsertById(atelierCounterparty, COUNTERPARTIES);
    await upsertById(atelierClause, CLAUSES);
    await upsertById(atelierContract, CONTRACTS);
    await upsertById(atelierContractClause, CONTRACT_CLAUSES);
    await upsertById(atelierContractParty, CONTRACT_PARTIES);
    await upsertById(atelierDpa, DPAS);
    await upsertById(atelierDeliverableAcceptance, DELIVERABLE_ACCEPTANCES);
    await upsertById(atelierChangeOrder, CHANGE_ORDERS);
    // Task #455 — backfill the 4 demo CO rows with the new scope/effort
    // delta columns. `upsertById` is insert-only, so existing
    // environments (whose rows pre-date the 0038 migration's column
    // defaults of 0) need an explicit update to converge to the same
    // baseline as a fresh seed. Idempotent: safe to re-run on every boot.
    for (const co of CHANGE_ORDERS) {
      await db
        .update(atelierChangeOrder)
        .set({
          labourHoursDelta: Number(co.labourHoursDelta ?? 0),
          labourCostDeltaUsd: Number(co.labourCostDeltaUsd ?? 0),
          expensesDeltaUsd: Number(co.expensesDeltaUsd ?? 0),
          subsDeltaUsd: Number(co.subsDeltaUsd ?? 0),
        })
        .where(eq(atelierChangeOrder.id, co.id));
    }
    // Task #431 — boot-time reconciliation. Engagement P&L baselines
    // live in-memory (see `atelier-engagement-pnl-seed.ts`). Any CO row
    // that's already in the `posted` terminal state must have its delta
    // folded into the baseline at startup so EAC / VAC / contract value
    // are consistent with the workflow-of-record.
    //
    // We scan the *entire* `atelier_change_order` table — not just the
    // hardcoded seed array — so non-seed posted COs (e.g. ones created
    // by Finance through the UI in a previous boot) are also picked up.
    // `applyPostedChangeOrder` is idempotent via its `APPLIED_POSTED_COS`
    // guard, so re-running this on every boot is safe.
    const postedRows = await db
      .select()
      .from(atelierChangeOrder)
      .where(
        and(
          eq(atelierChangeOrder.status, "posted"),
          isNull(atelierChangeOrder.deletedAt),
        ),
      );
    let reconciled = 0;
    let unknownEng = 0;
    for (const co of postedRows) {
      const result = applyPostedChangeOrder({
        engagementId: co.engagementId,
        changeOrderId: co.id,
        valueDeltaUsd: Number(co.valueDeltaUsd ?? 0),
        labourHoursDelta: Number(co.labourHoursDelta ?? 0),
        labourCostDeltaUsd: Number(co.labourCostDeltaUsd ?? 0),
        expensesDeltaUsd: Number(co.expensesDeltaUsd ?? 0),
        subsDeltaUsd: Number(co.subsDeltaUsd ?? 0),
        actorUserId: co.partnerApproverUserId ?? co.proposedByUserId ?? null,
        baselinedAtIso: co.postedAt ? co.postedAt.toISOString() : undefined,
      });
      if (result.status === "applied") reconciled += 1;
      else if (result.status === "engagement_unknown") unknownEng += 1;
    }
    if (unknownEng > 0) {
      logger.warn(
        { module: "atelier-seed-l2c", unknownEng },
        "Posted change orders reference engagement IDs with no in-memory P&L baseline; their deltas were not reconciled.",
      );
    }
    logger.info(
      { module: "atelier-seed-l2c" },
      "Wave-1 L2C demo seed verified " +
        `(${COUNTERPARTIES.length} counterparties, ${CLAUSES.length} clauses, ` +
        `${CONTRACTS.length} contracts, ${CONTRACT_PARTIES.length} parties, ` +
        `${DPAS.length} DPA, ${DELIVERABLE_ACCEPTANCES.length} acceptance, ` +
        `${CHANGE_ORDERS.length} change orders, ${reconciled} posted-CO baselines reconciled).`,
    );
  })().catch((err) => {
    l2cSeedPromise = null; // allow retry on next call
    logger.error(
      { module: "atelier-seed-l2c", err },
      "Wave-1 L2C demo seed failed",
    );
    throw err;
  });
  return l2cSeedPromise;
}

