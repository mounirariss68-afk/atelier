/* eslint-disable no-console */
/**
 * The Atelier — deterministic seed.
 *
 * Pre-loads the firm's working context (synthetic where required, anonymized
 * where not) so the portal is never empty on first paint:
 *   - 5 named personas (one per role)
 *   - 7 accounts (Tasama, Dubai Municipality, DGE, Tahakom, NHC, STC, Aldrees)
 *   - 22 named agents (8 starred MVP, 14 registered/stub)
 *   - At least one opportunity per account across PLM stages
 *   - One fully-populated Tasama Agentic BPO engagement
 *   - Atelier assets (POVs, prompts, frameworks, learnings)
 *   - Pane A triage items addressed to the Founding Partner
 *   - Recent agent runs feeding the Activity Stream
 *   - Audit trail rows for every entity created
 *
 * Safe to re-run: TRUNCATE-then-INSERT in dependency order.
 */

import {
  db,
  pool,
  atelierUsers,
  atelierAccounts,
  atelierOpportunities,
  atelierEngagements,
  atelierEngagementAccess,
  atelierDeliverables,
  atelierDeliverableVersions,
  atelierMeetings,
  atelierAssets,
  atelierPrompts,
  atelierAgents,
  atelierSkills,
  atelierPersonSkills,
  atelierAgentRuns,
  atelierAuditEvents,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirms,
  atelierCalendarEvents,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierTimesheetSignals,
  atelierPartnerFirmHours,
  atelierPartnerFirmResources,
  atelierPersonDocuments,
  atelierConflictDisclosures,
  atelierInvitations,
  atelierOnboardings,
  atelierOnboardingSteps,
  atelierOffboardings,
  atelierOffboardingSteps,
  atelierComplianceRecords,
  atelierRaidItems,
  atelierHypothesisTrees,
  atelierProcesses,
  atelierPaneAItems,
  atelierContacts,
  atelierContactRelationships,
  atelierCredentials,
  atelierWinLossDebriefs,
  atelierWinThemes,
  atelierReports,
  atelierNotifications,
  atelierSalonWorkspaces,
  atelierSalonUsers,
  atelierSalonUserEngagementAccess,
  atelierSalonDecisions,
  atelierSalonRequests,
  atelierDeliverablePublishes,
  atelierUtilizationSnapshots,
  atelierCorporateCards,
  atelierExpensePolicies,
  atelierFxRates,
  atelierExpenses,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierInvoiceLineDrafts,
  atelierVatRegister,
} from "@workspace/db";
import { sql, eq, and, isNull, inArray } from "drizzle-orm";

const NOW = new Date();
const HOURS_AGO = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);
const MINS_AGO = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);
const DAYS_AGO = (d: number) => new Date(NOW.getTime() - d * 86400 * 1000);
const DAYS_FROM_NOW = (d: number) => new Date(NOW.getTime() + d * 86400 * 1000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// ============================================================
// 1) PERSONAS — five named accounts (spec §9.2)
// ============================================================
const PERSONAS = [
  {
    id: "p_mounir_ariss",
    email: "mounir@aico.ai",
    name: "Mounir Ariss",
    initials: "MA",
    role: "partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
    permissions: ["partner.approve", "partner.override", "admin"],
  },
  {
    id: "p_gokhan_guney",
    email: "gokhan@aico.ai",
    name: "Gökhan Güney",
    initials: "GG",
    role: "partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
    permissions: ["partner.approve", "partner.override", "admin"],
  },
  {
    id: "p_layla_haddad",
    email: "layla@aico.ai",
    name: "Layla Haddad",
    initials: "LH",
    role: "engagement_lead",
    roleLabel: "Engagement Lead",
    title: "Principal · Engagements",
    permissions: ["engagement.lead", "deliverable.draft"],
  },
  {
    id: "p_omar_najjar",
    email: "omar@aico.ai",
    name: "Omar Najjar",
    initials: "ON",
    role: "sme",
    roleLabel: "Domain SME",
    title: "Senior SME · Public Sector",
    permissions: ["sme.review"],
  },
  {
    id: "p_sara_qureshi",
    email: "sara@aico.ai",
    name: "Sara Qureshi",
    initials: "SQ",
    role: "ai_engineer",
    roleLabel: "AI Engineer",
    title: "Lead Engineer · Agent Runtime",
    permissions: ["agent.deploy", "prompt.author"],
  },
  {
    id: "p_khaled_aziz",
    email: "khaled@aico.ai",
    name: "Khaled Aziz",
    initials: "KA",
    role: "business_developer",
    roleLabel: "Business Development",
    title: "Director · Pursuit",
    permissions: ["pipeline.write"],
  },
] as const;

// ============================================================
// 2) ACCOUNTS — firm working context (spec §9.2)
// ============================================================
const ACCOUNTS = [
  {
    id: "acc_tasama",
    name: "Tasama",
    country: "KSA",
    sector: "Shared Services / BPO",
    notes:
      "Saudi shared-services operator. Anchor account for Agentic BPO program; Maven AI marketplace pilot already in production.",
  },
  {
    id: "acc_dubai_municipality",
    name: "Dubai Municipality",
    country: "UAE",
    sector: "Government / Smart City",
    notes:
      "Service-design transformation across municipal touchpoints. Strong cabinet sponsor.",
  },
  {
    id: "acc_dge",
    name: "Department of Government Enablement",
    country: "UAE · Abu Dhabi",
    sector: "Government Enablement",
    notes:
      "DGE Effortless agent program. Shipped first prototype Q4 2025; expanding scope.",
  },
  {
    id: "acc_tahakom",
    name: "Tahakom",
    country: "KSA",
    sector: "Mobility / Public Safety",
    notes:
      "National traffic operator. Greenfield POV around incident-response copilots.",
  },
  {
    id: "acc_nhc",
    name: "NHC — National Housing Company",
    country: "KSA",
    sector: "Real Estate / Public",
    notes:
      "Customer journey + design intelligence. Procurement cycles tied to fiscal year.",
  },
  {
    id: "acc_stc",
    name: "STC",
    country: "KSA",
    sector: "Telecom",
    notes:
      "Inbound RFP for an enterprise B2B agent platform. Highly competitive.",
  },
  {
    id: "acc_aldrees",
    name: "Aldrees",
    country: "KSA",
    sector: "Retail Energy / Logistics",
    notes:
      "BOQ workshop completed; learnings being harvested into the Atelier as a delivery learning.",
  },
] as const;

// ============================================================
// 2.5) ACCOUNT EXT (Task #238) — tier, owner, hypothesis, signals
// ============================================================
type AccountExt = {
  size?: string;
  hqCity?: string;
  primaryCurrency?: string;
  primaryLanguage?: string;
  tier?: "A" | "B" | "C" | "D";
  status?: string;
  partnerOwnerId?: string;
  relationshipStrength?: number;
  enrichedAt?: Date;
  sourceSignals?: Array<{
    kind: "news" | "linkedin" | "press" | "filing" | "manual";
    title: string;
    summary?: string;
    url: string;
    publishedAt?: string;
    confidence?: "green" | "amber" | "red";
  }>;
  strategicPriorities?: string[];
  aicoHypothesis?: string;
  pendingProfileUpdates?: Array<{
    id: string;
    proposedBy: string;
    proposedAt: string;
    field: string;
    fromValue: unknown;
    toValue: unknown;
    rationale: string;
    oppId?: string;
    status: "pending" | "approved" | "rejected";
  }>;
};

const ACCOUNT_EXT: Record<string, AccountExt> = {
  acc_tasama: {
    size: "enterprise",
    hqCity: "Riyadh",
    primaryCurrency: "SAR",
    primaryLanguage: "ar",
    tier: "A",
    status: "active",
    partnerOwnerId: "p_mounir_ariss",
    relationshipStrength: 88,
    enrichedAt: HOURS_AGO(36),
    strategicPriorities: [
      "Scale Agentic BPO marketplace to 12 verticals by FY27",
      "Lift utilization on Maven AI agent fleet from 38% to 65%",
      "Lock in Saudi public-sector logos as anchor tenants",
    ],
    aicoHypothesis:
      "Tasama is the marquee proof-point that an Agentic BPO can outperform conventional BPO economics by 3–4x. AICo's role is to graduate the marketplace from pilot into a defensible operating system.",
    sourceSignals: [
      {
        kind: "press",
        title: "Tasama announces FY26 expansion of shared-services platform",
        summary: "Highlights three new sectors and Maven AI integration.",
        url: "https://www.example.com/tasama-fy26",
        publishedAt: HOURS_AGO(72).toISOString(),
        confidence: "green",
      },
      {
        kind: "news",
        title: "New COO appointment at Tasama",
        summary: "Ex-Aramco operations leader joins; mandate is digitalisation.",
        url: "https://www.example.com/tasama-coo",
        publishedAt: HOURS_AGO(120).toISOString(),
        confidence: "amber",
      },
    ],
    pendingProfileUpdates: [
      {
        id: "ppu_tasama_priority",
        proposedBy: "ag_account_cartographer",
        proposedAt: HOURS_AGO(2).toISOString(),
        field: "strategicPriorities",
        fromValue: [
          "Scale Agentic BPO marketplace to 12 verticals by FY27",
          "Lift utilization on Maven AI agent fleet from 38% to 65%",
          "Lock in Saudi public-sector logos as anchor tenants",
        ],
        toValue: [
          "Scale Agentic BPO marketplace to 12 verticals by FY27",
          "Lift utilization on Maven AI agent fleet from 38% to 65%",
          "Lock in Saudi public-sector logos as anchor tenants",
          "Establish Tasama Academy for agent operators",
        ],
        rationale:
          "Cartographer ★ found three press mentions of an Academy concept across Q1 2026.",
        status: "pending",
      },
    ],
  },
  acc_dubai_municipality: {
    hqCity: "Dubai",
    primaryCurrency: "AED",
    primaryLanguage: "ar",
    tier: "A",
    partnerOwnerId: "p_mounir_ariss",
    relationshipStrength: 82,
    enrichedAt: HOURS_AGO(60),
    strategicPriorities: [
      "Service-design transformation across 60+ touchpoints",
      "Citizen NPS lift of +20 by year-end",
      "Single-window digital concierge across departments",
    ],
    aicoHypothesis:
      "DM is the lighthouse smart-city service-design account in the GCC. Win two more departments to convert into multi-year retainer.",
  },
  acc_dge: {
    hqCity: "Abu Dhabi",
    primaryCurrency: "AED",
    primaryLanguage: "en",
    tier: "A",
    partnerOwnerId: "p_mounir_ariss",
    relationshipStrength: 79,
    enrichedAt: HOURS_AGO(48),
    strategicPriorities: [
      "Effortless agent program scale to 8 ministries",
      "Federation across UAE government data spines",
    ],
    aicoHypothesis:
      "DGE is our most replicable agentic-government story. Codify the playbook so other emirates buy on rails.",
  },
  acc_tahakom: {
    hqCity: "Riyadh",
    primaryCurrency: "SAR",
    primaryLanguage: "ar",
    tier: "B",
    partnerOwnerId: "p_mounir_ariss",
    relationshipStrength: 64,
  },
  acc_nhc: {
    hqCity: "Riyadh",
    primaryCurrency: "SAR",
    primaryLanguage: "ar",
    tier: "B",
    partnerOwnerId: "p_mounir_ariss",
    relationshipStrength: 58,
  },
  acc_stc: {
    hqCity: "Riyadh",
    primaryCurrency: "SAR",
    primaryLanguage: "ar",
    tier: "B",
    partnerOwnerId: "p_mounir_ariss",
    relationshipStrength: 52,
  },
  acc_aldrees: {
    hqCity: "Riyadh",
    primaryCurrency: "SAR",
    primaryLanguage: "ar",
    tier: "C",
    partnerOwnerId: "p_mounir_ariss",
    relationshipStrength: 46,
  },
};

// ============================================================
// 2.6) CONTACTS (Task #238) — Tier-A account org charts
// ============================================================
type ContactSeed = {
  id: string;
  accountId: string;
  fullName: string;
  email?: string | null;
  title?: string | null;
  seniority?: string | null;
  buyerPersona?: string | null;
  influenceScore: number;
  disposition:
    | "champion"
    | "supporter"
    | "neutral"
    | "skeptic"
    | "blocker"
    | "unknown";
  notes?: string | null;
  source?: string | null;
  ownerUserId?: string | null;
};

const CONTACTS: ContactSeed[] = [
  // Tasama
  {
    id: "ct_tasama_ceo",
    accountId: "acc_tasama",
    fullName: "Faisal Al-Otaibi",
    title: "CEO",
    seniority: "c_suite",
    buyerPersona: "Economic Buyer",
    influenceScore: 5,
    disposition: "champion",
    notes: "Personally sponsors the Agentic BPO platform.",
  },
  {
    id: "ct_tasama_coo",
    accountId: "acc_tasama",
    fullName: "Hala Mansour",
    title: "COO",
    seniority: "c_suite",
    buyerPersona: "Operations Sponsor",
    influenceScore: 4,
    disposition: "supporter",
    notes: "New hire — owns operational scale-up. First QBR in 6 weeks.",
  },
  {
    id: "ct_tasama_cto",
    accountId: "acc_tasama",
    fullName: "Bader Al-Harbi",
    title: "CTO",
    seniority: "c_suite",
    buyerPersona: "Technical Buyer",
    influenceScore: 4,
    disposition: "supporter",
  },
  {
    id: "ct_tasama_cfo",
    accountId: "acc_tasama",
    fullName: "Reema Al-Saud",
    title: "CFO",
    seniority: "c_suite",
    buyerPersona: "Economic Approver",
    influenceScore: 4,
    disposition: "skeptic",
    notes: "Pushes hard on unit economics. Needs proof of margin uplift.",
  },
  {
    id: "ct_tasama_head_ai",
    accountId: "acc_tasama",
    fullName: "Tariq Younis",
    title: "Head of AI Programs",
    seniority: "vp",
    buyerPersona: "Champion",
    influenceScore: 5,
    disposition: "champion",
    notes: "Day-to-day partner. Joined Maven AI co-design sessions.",
  },
  // Dubai Municipality
  {
    id: "ct_dm_dg",
    accountId: "acc_dubai_municipality",
    fullName: "Khalifa Al-Marri",
    title: "Director General",
    seniority: "c_suite",
    buyerPersona: "Economic Buyer",
    influenceScore: 5,
    disposition: "supporter",
  },
  {
    id: "ct_dm_chiefdigital",
    accountId: "acc_dubai_municipality",
    fullName: "Noura Al-Falasi",
    title: "Chief Digital Officer",
    seniority: "vp",
    buyerPersona: "Champion",
    influenceScore: 5,
    disposition: "champion",
    notes: "Driving the citizen-NPS program. Weekly working sessions.",
  },
  {
    id: "ct_dm_servicedesign",
    accountId: "acc_dubai_municipality",
    fullName: "Yasmin Hashemi",
    title: "Head of Service Design",
    seniority: "director",
    buyerPersona: "Practitioner",
    influenceScore: 3,
    disposition: "supporter",
  },
  {
    id: "ct_dm_procurement",
    accountId: "acc_dubai_municipality",
    fullName: "Salem Al-Nuaimi",
    title: "Head of Procurement",
    seniority: "director",
    buyerPersona: "Approver",
    influenceScore: 3,
    disposition: "neutral",
  },
  // DGE
  {
    id: "ct_dge_chair",
    accountId: "acc_dge",
    fullName: "Mohammed Al-Hashimi",
    title: "Chairman",
    seniority: "c_suite",
    buyerPersona: "Economic Buyer",
    influenceScore: 5,
    disposition: "supporter",
  },
  {
    id: "ct_dge_dg",
    accountId: "acc_dge",
    fullName: "Aisha Al-Romaithi",
    title: "Director General",
    seniority: "c_suite",
    buyerPersona: "Economic Buyer",
    influenceScore: 5,
    disposition: "champion",
    notes: "Personally championed the Effortless rollout.",
  },
  {
    id: "ct_dge_headai",
    accountId: "acc_dge",
    fullName: "Omar Khoury",
    title: "Head of AI",
    seniority: "vp",
    buyerPersona: "Technical Buyer",
    influenceScore: 4,
    disposition: "champion",
  },
  // Tahakom (KSA traffic / smart-mobility authority)
  {
    id: "ct_tahakom_ceo",
    accountId: "acc_tahakom",
    fullName: "Abdulrahman Al-Qahtani",
    title: "Chief Executive Officer",
    seniority: "c_suite",
    buyerPersona: "CEO",
    influenceScore: 5,
    disposition: "neutral",
  },
  {
    id: "ct_tahakom_coo",
    accountId: "acc_tahakom",
    fullName: "Maha Al-Sudairi",
    title: "Chief Operations Officer",
    seniority: "c_suite",
    buyerPersona: "COO",
    influenceScore: 4,
    disposition: "supporter",
  },
  {
    id: "ct_tahakom_cdo",
    accountId: "acc_tahakom",
    fullName: "Ziyad Al-Ghamdi",
    title: "Chief Data Officer",
    seniority: "c_suite",
    buyerPersona: "CDO",
    influenceScore: 4,
    disposition: "champion",
  },
  {
    id: "ct_tahakom_proc",
    accountId: "acc_tahakom",
    fullName: "Faris Al-Mutairi",
    title: "Head of Procurement",
    seniority: "director",
    buyerPersona: "procurement",
    influenceScore: 3,
    disposition: "skeptic",
  },
  // Aldrees (KSA logistics / fuel retail)
  {
    id: "ct_aldrees_ceo",
    accountId: "acc_aldrees",
    fullName: "Hamad Al-Drees",
    title: "Chief Executive Officer",
    seniority: "c_suite",
    buyerPersona: "CEO",
    influenceScore: 5,
    disposition: "champion",
  },
  {
    id: "ct_aldrees_cfo",
    accountId: "acc_aldrees",
    fullName: "Sultan Al-Subaie",
    title: "Chief Financial Officer",
    seniority: "c_suite",
    buyerPersona: "CFO",
    influenceScore: 4,
    disposition: "skeptic",
  },
  {
    id: "ct_aldrees_cio",
    accountId: "acc_aldrees",
    fullName: "Lina Al-Faisal",
    title: "Chief Information Officer",
    seniority: "c_suite",
    buyerPersona: "CIO",
    influenceScore: 4,
    disposition: "supporter",
  },
  {
    id: "ct_aldrees_ops",
    accountId: "acc_aldrees",
    fullName: "Yousef Al-Harthi",
    title: "VP Logistics Operations",
    seniority: "vp",
    buyerPersona: "business_head",
    influenceScore: 3,
    disposition: "neutral",
  },
];

const CONTACT_RELATIONSHIPS: Array<{
  id: string;
  accountId: string;
  fromContactId: string;
  toContactId: string;
  type: "reports_to" | "partners_with" | "blocks" | "mentors";
  notes?: string | null;
}> = [
  // Tasama
  { id: "cr_tasama_coo_ceo", accountId: "acc_tasama", fromContactId: "ct_tasama_coo", toContactId: "ct_tasama_ceo", type: "reports_to" },
  { id: "cr_tasama_cto_ceo", accountId: "acc_tasama", fromContactId: "ct_tasama_cto", toContactId: "ct_tasama_ceo", type: "reports_to" },
  { id: "cr_tasama_cfo_ceo", accountId: "acc_tasama", fromContactId: "ct_tasama_cfo", toContactId: "ct_tasama_ceo", type: "reports_to" },
  { id: "cr_tasama_headai_cto", accountId: "acc_tasama", fromContactId: "ct_tasama_head_ai", toContactId: "ct_tasama_cto", type: "reports_to" },
  { id: "cr_tasama_cfo_blocks", accountId: "acc_tasama", fromContactId: "ct_tasama_cfo", toContactId: "ct_tasama_head_ai", type: "blocks", notes: "Margin scrutiny on AI program." },
  // DM
  { id: "cr_dm_cdo_dg", accountId: "acc_dubai_municipality", fromContactId: "ct_dm_chiefdigital", toContactId: "ct_dm_dg", type: "reports_to" },
  { id: "cr_dm_sd_cdo", accountId: "acc_dubai_municipality", fromContactId: "ct_dm_servicedesign", toContactId: "ct_dm_chiefdigital", type: "reports_to" },
  { id: "cr_dm_proc_dg", accountId: "acc_dubai_municipality", fromContactId: "ct_dm_procurement", toContactId: "ct_dm_dg", type: "reports_to" },
  // DGE
  { id: "cr_dge_dg_chair", accountId: "acc_dge", fromContactId: "ct_dge_dg", toContactId: "ct_dge_chair", type: "reports_to" },
  { id: "cr_dge_ai_dg", accountId: "acc_dge", fromContactId: "ct_dge_headai", toContactId: "ct_dge_dg", type: "reports_to" },
  // Tahakom
  { id: "cr_tahakom_coo_ceo", accountId: "acc_tahakom", fromContactId: "ct_tahakom_coo", toContactId: "ct_tahakom_ceo", type: "reports_to" },
  { id: "cr_tahakom_cdo_ceo", accountId: "acc_tahakom", fromContactId: "ct_tahakom_cdo", toContactId: "ct_tahakom_ceo", type: "reports_to" },
  { id: "cr_tahakom_proc_coo", accountId: "acc_tahakom", fromContactId: "ct_tahakom_proc", toContactId: "ct_tahakom_coo", type: "reports_to" },
  { id: "cr_tahakom_proc_blocks_cdo", accountId: "acc_tahakom", fromContactId: "ct_tahakom_proc", toContactId: "ct_tahakom_cdo", type: "blocks", notes: "Procurement holds the AI program until SLA terms are signed." },
  // Aldrees
  { id: "cr_aldrees_cfo_ceo", accountId: "acc_aldrees", fromContactId: "ct_aldrees_cfo", toContactId: "ct_aldrees_ceo", type: "reports_to" },
  { id: "cr_aldrees_cio_ceo", accountId: "acc_aldrees", fromContactId: "ct_aldrees_cio", toContactId: "ct_aldrees_ceo", type: "reports_to" },
  { id: "cr_aldrees_ops_ceo", accountId: "acc_aldrees", fromContactId: "ct_aldrees_ops", toContactId: "ct_aldrees_ceo", type: "reports_to" },
  { id: "cr_aldrees_cio_partners_ops", accountId: "acc_aldrees", fromContactId: "ct_aldrees_cio", toContactId: "ct_aldrees_ops", type: "partners_with", notes: "Co-sponsors of the BOQ digitisation initiative." },
];

// ============================================================
// 2.7) CREDENTIALS (Task #238) — case-study seeds
// ============================================================
const CREDENTIALS = [
  {
    id: "cred_tasama_marketplace",
    title: "Agentic BPO Marketplace launched in MENA",
    accountId: "acc_tasama",
    clientName: "Tasama",
    sector: "Shared Services / BPO",
    engagementType: "agentic_build",
    redactedAbstract:
      "Spun up the first Agentic BPO marketplace in MENA — 14 production agents, 38% utilization in 90 days, 3.2x cost-to-serve improvement.",
    attributedAbstract:
      "Tasama × AICo: first Agentic BPO marketplace in MENA, 14 agents in production within 90 days.",
    anonymizationStatus: "attributed",
    outcomeMetrics: [
      { label: "Cost-to-serve", value: "−68%" },
      { label: "Time-to-launch", value: "11 weeks" },
      { label: "Production agents", value: "14" },
    ],
    evidenceLinks: [
      { label: "Tasama press release", url: "https://www.example.com/tasama-marketplace" },
    ],
    tags: ["agentic-bpo", "ksa", "marketplace"],
    createdByUserId: "p_mounir_ariss",
  },
  {
    id: "cred_dge_effortless",
    title: "DGE Effortless — Agentic Government POC",
    accountId: "acc_dge",
    clientName: "Department of Government Enablement",
    sector: "Government Enablement",
    engagementType: "pov",
    redactedAbstract:
      "Designed and shipped the first agentic citizen-services prototype for a UAE government enablement body in 8 weeks, mapping 22 service journeys to a single concierge agent.",
    attributedAbstract:
      "DGE × AICo: agentic concierge POC across 22 citizen journeys in 8 weeks.",
    anonymizationStatus: "attributed",
    outcomeMetrics: [
      { label: "Journeys covered", value: "22" },
      { label: "Time-to-prototype", value: "8 weeks" },
      { label: "Citizen NPS lift", value: "+19" },
    ],
    evidenceLinks: [
      { label: "DGE Effortless brief", url: "https://www.example.com/dge-effortless" },
    ],
    tags: ["government", "uae", "pov"],
    createdByUserId: "p_mounir_ariss",
  },
  {
    id: "cred_dm_concierge",
    title: "Citizen Concierge service design — 60+ touchpoints",
    accountId: "acc_dubai_municipality",
    clientName: "Dubai Municipality",
    sector: "Government / Smart City",
    engagementType: "transformation",
    redactedAbstract:
      "60-touchpoint service-design transformation feeding a unified citizen concierge for a major GCC municipality — first phase delivered in 14 weeks.",
    attributedAbstract:
      "Dubai Municipality × AICo: 60-touchpoint service-design transformation, phase one in 14 weeks.",
    anonymizationStatus: "attributed",
    outcomeMetrics: [
      { label: "Touchpoints redesigned", value: "60+" },
      { label: "Departments aligned", value: "9" },
      { label: "Phase-1 duration", value: "14 weeks" },
    ],
    evidenceLinks: [
      { label: "DM concierge case", url: "https://www.example.com/dm-concierge" },
    ],
    tags: ["smart-city", "uae", "service-design"],
    createdByUserId: "p_mounir_ariss",
  },
  {
    id: "cred_aldrees_boq",
    title: "Aldrees BOQ digitisation — Logistics control tower",
    accountId: "acc_aldrees",
    clientName: "Aldrees Petroleum & Transport Services",
    sector: "Logistics / Fuel Retail",
    engagementType: "transformation",
    redactedAbstract:
      "Digitised end-to-end Bills-of-Quantities and route-cost workflows for a top-3 KSA fuel-retail operator, replacing 14 spreadsheets with a single agentic control tower.",
    attributedAbstract:
      "Aldrees × AICo: BOQ digitisation + logistics control tower across 320 service stations in 18 weeks.",
    anonymizationStatus: "attributed",
    outcomeMetrics: [
      { label: "Spreadsheets retired", value: "14" },
      { label: "Stations onboarded", value: "320" },
      { label: "BOQ cycle time", value: "−72%" },
    ],
    evidenceLinks: [
      { label: "Aldrees control-tower case", url: "https://www.example.com/aldrees-boq" },
    ],
    tags: ["logistics", "ksa", "control-tower", "boq"],
    createdByUserId: "p_mounir_ariss",
  },
];

// ============================================================
// 3) AGENTS — full 22-agent registry (spec §8)
// ============================================================
type AgentSeed = {
  id: string;
  name: string;
  group: string;
  stage: string;
  purpose: string;
  model: string;
  starred: boolean;
  status: "registered" | "mvp" | "stub";
  tools: string[];
  guardrails: string[];
  humanCheckpoints: string[];
  runsLast30d: number;
};

const AGENTS: AgentSeed[] = [
  // ---- 8 starred MVP agents (spec §8.4.1 – §8.4.8) ----
  {
    id: "ag_pursuit_scout",
    name: "Pursuit Scout",
    group: "Front of House",
    stage: "Identify",
    purpose:
      "Live, citable opportunity briefs from one-line client + context inputs.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["web_search", "knowledge.search", "file.read"],
    guardrails: [
      "Citations required on every claim",
      "Synthetic figures clearly watermarked",
      "Deal-size hypothesis is a band, never a single number",
    ],
    humanCheckpoints: ["Partner reviews and either Approves, Edits, or Rejects"],
    runsLast30d: 41,
  },
  {
    id: "ag_pov_author",
    name: "POV Author",
    group: "Front of House",
    stage: "Shape",
    purpose:
      "Brand-correct, citation-bound POV deliverables in HTML, ready for the client meeting.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["knowledge.search", "web_search", "html.generate"],
    guardrails: [
      "Pyramid structure enforced",
      "Every section bound to ≥1 evidence row",
      "AICo brand chrome locked",
    ],
    humanCheckpoints: [
      "Engagement Lead approves prompt sheet",
      "Partner approves before client send",
    ],
    runsLast30d: 18,
  },
  {
    id: "ag_proposal_composer",
    name: "Proposal Composer",
    group: "Front of House",
    stage: "Pursue",
    purpose:
      "Formal proposal with workplan, team, pricing, terms, compliance matrix.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["knowledge.search", "web_search", "file.read", "docx.generate"],
    guardrails: [
      "Every promise maps to a workplan deliverable",
      "Pricing must hit target margin or trigger Partner override",
      "Compliance matrix 100% green or rendered red",
    ],
    humanCheckpoints: [
      "Section assignments confirmed",
      "Pricing approved by Partner",
      "Final Partner read",
      "Explicit Send-to-client click",
    ],
    runsLast30d: 7,
  },
  {
    id: "ag_meeting_scribe",
    name: "Meeting Scribe",
    group: "Engagement Memory",
    stage: "Cross-cutting",
    purpose:
      "Turn a meeting recording or transcript into structured engagement memory.",
    model: "claude-haiku-4-5",
    starred: true,
    status: "mvp",
    tools: ["transcribe.audio", "knowledge.search", "web_search"],
    guardrails: [
      "Speaker attribution preserved or marked unclear",
      "Confidential terms flagged before any cross-engagement write",
    ],
    humanCheckpoints: [
      "Summary + action items reviewed before push to engagement",
      "Prototype brief, if generated, requires explicit click",
    ],
    runsLast30d: 33,
  },
  {
    id: "ag_charter_architect",
    name: "Charter Architect",
    group: "Mobilize",
    stage: "Mobilize",
    purpose:
      "Engagement charter and hypothesis tree within 24h of signature.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["knowledge.search", "file.read"],
    guardrails: [
      "Every objective paired with a measurable success metric",
      "Scope and out-of-scope MECE",
      "Hypothesis tree limited to 3 levels by default",
    ],
    humanCheckpoints: ["Engagement Lead review", "Partner sign-off"],
    runsLast30d: 5,
  },
  {
    id: "ag_agent_architect",
    name: "Agent Architect",
    group: "Deliver",
    stage: "Deliver",
    purpose:
      "Process diagram + agentifiability annotations + candidate agent designs.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["bpmn.render", "knowledge.search"],
    guardrails: [
      "Agentifiability classification includes rationale",
      "No candidate agent without a human checkpoint",
      "High-risk agents flagged for Partner attention",
    ],
    humanCheckpoints: ["Partner / Engagement Lead reviews each design"],
    runsLast30d: 9,
  },
  {
    id: "ag_prototype_forge",
    name: "Prototype Forge",
    group: "Deliver",
    stage: "Deliver",
    purpose:
      "Replit-ready build prompts (DGE Effortless pattern) for viable prototype ideas.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["knowledge.search", "replit.scaffold"],
    guardrails: [
      "Generated prompts include AICo non-negotiables block",
      "No real client data without Partner approval",
    ],
    humanCheckpoints: [
      "Lead approves brief",
      "Partner approves the generated prompt",
    ],
    runsLast30d: 3,
  },
  {
    id: "ag_synthesis_critic",
    name: "Synthesis Critic",
    group: "Quality",
    stage: "Cross-cutting",
    purpose:
      "Quality-gate every external deliverable before client release.",
    model: "claude-opus-4-6",
    starred: true,
    status: "mvp",
    tools: ["knowledge.search", "file.read"],
    guardrails: [
      "Critic does not edit; only flags",
      "Send-to-client blocked unless GREEN or Partner override logged",
    ],
    humanCheckpoints: ["Engagement Lead reviews issues"],
    runsLast30d: 14,
  },

  // ---- 14 registered/stub agents ----
  {
    id: "ag_triage",
    name: "Triage Agent",
    group: "Personal",
    stage: "Cross-cutting",
    purpose: "Composes the persona's Pane A 'what needs me today' queue.",
    model: "claude-haiku-4-5",
    starred: false,
    status: "registered",
    tools: ["knowledge.search"],
    guardrails: ["Never re-orders Partner-flagged items"],
    humanCheckpoints: ["Implicit via Approve/Snooze on each item"],
    runsLast30d: 28,
  },
  {
    id: "ag_raid_watchdog",
    name: "RAID Watchdog",
    group: "Deliver",
    stage: "Deliver",
    purpose: "Flags risks/assumptions/issues/dependencies on every engagement.",
    model: "claude-haiku-4-5",
    starred: false,
    status: "registered",
    tools: ["knowledge.search"],
    guardrails: ["Severity escalation requires Engagement Lead acknowledgement"],
    humanCheckpoints: ["Lead triages weekly"],
    runsLast30d: 12,
  },
  {
    id: "ag_knowledge_concierge",
    name: "Knowledge Concierge",
    group: "Atelier",
    stage: "Compound",
    purpose: "Answers firm-wide search with citations from the Atelier.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "registered",
    tools: ["knowledge.search"],
    guardrails: ["Cross-engagement reads logged"],
    humanCheckpoints: [],
    runsLast30d: 22,
  },
  {
    id: "ag_atelier_curator",
    name: "Atelier Curator",
    group: "Atelier",
    stage: "Compound",
    purpose: "Identifies reusable IP candidates and proposes Atelier promotions.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "registered",
    tools: ["knowledge.search"],
    guardrails: ["Partner approves every promotion"],
    humanCheckpoints: ["Partner approves promotion"],
    runsLast30d: 4,
  },
  {
    id: "ag_prompt_librarian",
    name: "Prompt Librarian",
    group: "Atelier",
    stage: "Compound",
    purpose: "Watches for repeating prompt patterns; proposes library entries.",
    model: "claude-haiku-4-5",
    starred: false,
    status: "registered",
    tools: ["knowledge.search"],
    guardrails: ["Eval suite must pass at or above current active version"],
    humanCheckpoints: ["AI Engineer activates"],
    runsLast30d: 6,
  },
  {
    id: "ag_diagnostic_memo",
    name: "Diagnostic Memo Author",
    group: "Deliver",
    stage: "Deliver",
    purpose: "Drafts diagnostic deliverables from hypothesis tree + evidence.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: ["knowledge.search", "file.read"],
    guardrails: ["Off-hypothesis sections flagged"],
    humanCheckpoints: ["Lead reviews", "Partner approves"],
    runsLast30d: 2,
  },
  {
    id: "ag_workplan_architect",
    name: "Workplan Architect",
    group: "Mobilize",
    stage: "Mobilize",
    purpose: "Builds the engagement workplan from the charter.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: ["No undated workstreams"],
    humanCheckpoints: ["Lead approves"],
    runsLast30d: 1,
  },
  {
    id: "ag_adoption_coach",
    name: "Adoption Coach",
    group: "Compound",
    stage: "Compound",
    purpose: "Drives change adoption and value tracking post-launch.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: ["Adoption metrics tied to value case"],
    humanCheckpoints: ["Lead reviews monthly"],
    runsLast30d: 0,
  },
  {
    id: "ag_value_case_tracker",
    name: "Value Case Tracker",
    group: "Compound",
    stage: "Compound",
    purpose: "Tracks realised value vs. case across the engagement lifecycle.",
    model: "claude-haiku-4-5",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: ["Calls out drift > 15% to Partner"],
    humanCheckpoints: ["Partner reviews monthly"],
    runsLast30d: 0,
  },
  {
    id: "ag_compliance_reviewer",
    name: "Compliance Reviewer",
    group: "Pursue",
    stage: "Pursue",
    purpose: "Builds the compliance matrix for proposal responses.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: ["file.read"],
    guardrails: ["Red rows surfaced before submission"],
    humanCheckpoints: ["Partner reviews"],
    runsLast30d: 0,
  },
  {
    id: "ag_pricing_analyst",
    name: "Pricing Analyst",
    group: "Pursue",
    stage: "Pursue",
    purpose: "Models proposal pricing against firm margin targets.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: ["Below-target prices block submission"],
    humanCheckpoints: ["Partner overrides if needed"],
    runsLast30d: 0,
  },
  {
    id: "ag_bench_planner",
    name: "Bench Planner",
    group: "Personal",
    stage: "Cross-cutting",
    purpose: "Skill-graph + bench planning (v2 — registered for visibility).",
    model: "claude-haiku-4-5",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: [],
    humanCheckpoints: ["Partner reviews"],
    runsLast30d: 0,
  },
  {
    id: "ag_brand_translator",
    name: "Brand Translator",
    group: "Deliver",
    stage: "Deliver",
    purpose: "Inherits AICo brand defaults; supports per-engagement overrides.",
    model: "claude-haiku-4-5",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: ["Brand chrome locked unless overridden"],
    humanCheckpoints: [],
    runsLast30d: 0,
  },
  {
    id: "ag_storyboarder",
    name: "Storyboarder",
    group: "Deliver",
    stage: "Deliver",
    purpose: "Demo storyboards for prototype briefs.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: [],
    humanCheckpoints: ["Lead approves"],
    runsLast30d: 0,
  },
  // ---- Task #238: CRM Accounts & Cartographer ----
  {
    id: "ag_account_cartographer",
    name: "Account Cartographer",
    group: "CRM",
    stage: "Identify",
    purpose:
      "Re-map an account's reality — leadership changes, strategic priorities, signals — and propose governed updates to the account profile.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: [
      "web_search",
      "web_fetch",
      "linkedin.lookup",
      "news.feed",
      "knowledge.search",
      "file.read",
    ],
    guardrails: [
      "Every proposed update must include a citation",
      "Writes only to pendingProfileUpdates queue (never live fields)",
      "Partner approval required before any field is overwritten",
    ],
    humanCheckpoints: [
      "Partner reviews each proposed delta and Approves / Rejects",
    ],
    runsLast30d: 9,
  },
  {
    id: "ag_whitespace_mapper",
    name: "Whitespace Mapper",
    group: "CRM",
    stage: "Shape",
    purpose:
      "Cross-tabulate AICo offerings × buyer personas inside an account to surface the next 3 priority moves.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: [
      "Only personas already mapped on the account can be scored",
      "Priority moves capped at 3 per refresh",
    ],
    humanCheckpoints: ["Lead reviews canvas before sharing"],
    runsLast30d: 4,
  },
  {
    id: "ag_qbr_composer",
    name: "QBR Composer",
    group: "CRM",
    stage: "Steward",
    purpose:
      "Compose a quarterly business-review canvas — wins, risks, next moves — bound to the account's engagements + signals.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: ["knowledge.search"],
    guardrails: [
      "Sections must cite engagements or signals — no ungrounded claims",
      "Risk flags rendered amber, not buried",
    ],
    humanCheckpoints: ["Partner approves before client send"],
    runsLast30d: 3,
  },
  // ---- Task #239: Pipeline Forecaster ----
  {
    id: "ag_pipeline_forecaster",
    name: "Pipeline Forecaster",
    group: "CRM",
    stage: "Pursue",
    purpose:
      "Roll up the 10-stage sales pipeline into a weighted forecast and flag stalled deals into Pane A for the partner-owner.",
    model: "deterministic",
    starred: true,
    status: "mvp",
    tools: ["sql.read", "knowledge.search"],
    guardrails: [
      "Probabilities use the published stage defaults unless explicitly overridden",
      "Stalled = >21 days in stage, in-flight stages only",
      "Read-only with respect to opportunity records — only writes Pane A items + agent runs",
    ],
    humanCheckpoints: ["Partner reviews stalled-deal Pane A items"],
    runsLast30d: 12,
  },
  // ---- Task #241: Win/Loss + Theme Curator + Feedback Distiller stub ----
  {
    id: "ag_win_loss_interviewer",
    name: "Win/Loss Interviewer",
    group: "After-Action",
    stage: "Closed",
    purpose:
      "Impartial third-party interviewer. Synthesizes async buyer transcript into buyer-authentic reasons + themes bound to verbatim evidence.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["transcript.read", "knowledge.search"],
    guardrails: [
      "Conductor: never identifies as the deal owner",
      "Distinguish seller-perceived from buyer-authentic reasons",
      "Every theme must be bound to a verbatim quote",
      "Hidden competitor: name one of {direct, partner_firm, status_quo, inhouse, unknown}",
    ],
    humanCheckpoints: ["Partner reviews and approves before themes feed the curator"],
    runsLast30d: 4,
  },
  {
    id: "ag_theme_curator",
    name: "Theme Curator",
    group: "After-Action",
    stage: "Atelier",
    purpose:
      "Clusters approved debrief themes into the firm-wide Win Themes library. Suggests where to insert positioning lines into open proposals.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "mvp",
    tools: ["knowledge.search", "vector.cluster"],
    guardrails: [
      "Only ingests themes from APPROVED debriefs (never draft)",
      "Emergent themes flagged separately from upserts",
    ],
    humanCheckpoints: ["Atelier curator reviews emergent themes"],
    runsLast30d: 2,
  },
  {
    id: "ag_feedback_distiller",
    name: "Feedback Distiller",
    group: "After-Action",
    stage: "Engagement",
    purpose:
      "Stub (Task #241 OOS). Will distill in-flight engagement feedback into RAID + lessons.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "stub",
    tools: [],
    guardrails: ["Stub — not wired in v2"],
    humanCheckpoints: [],
    runsLast30d: 0,
  },
  // ---- 4 ★ Salon agents (Task #242) ----
  {
    id: "ag_publish_sentinel",
    name: "Publish Sentinel",
    group: "The Salon",
    stage: "Deliver",
    purpose: "DLP scan of every deliverable before it is published to a client workspace.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["regex.scan", "deliverable.read"],
    guardrails: [
      "Hard-block on Saudi national ID, IBAN, PAN; soft-warn on INTERNAL-ONLY markers",
      "Never auto-redact — surface findings to a human",
    ],
    humanCheckpoints: ["Engagement Lead reviews Sentinel output before publish"],
    runsLast30d: 17,
  },
  {
    id: "ag_salon_concierge",
    name: "Salon Concierge",
    group: "The Salon",
    stage: "Deliver",
    purpose: "Onboards client users to a Salon workspace; drafts invite copy and IdP records.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["salon.invite", "email.draft"],
    guardrails: ["Engagement Lead approves the invitation batch before send"],
    humanCheckpoints: ["Lead approves invite list"],
    runsLast30d: 4,
  },
  {
    id: "ag_engagement_curator",
    name: "Engagement Curator",
    group: "The Salon",
    stage: "Deliver",
    purpose: "Weekly synthesis of decisions, deliverables, and next steps for the client view.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["salon.read", "summary.compose"],
    guardrails: ["Synthesised facts always cited to a Salon record"],
    humanCheckpoints: ["Engagement Lead signs off the weekly digest"],
    runsLast30d: 6,
  },
  {
    id: "ag_approval_choreographer",
    name: "Approval Choreographer",
    group: "The Salon",
    stage: "Deliver",
    purpose: "Drives the approval chain state machine — request → reviewers → decision → audit.",
    model: "claude-sonnet-4-6",
    starred: true,
    status: "mvp",
    tools: ["salon.decisions", "notify"],
    guardrails: ["Approver role required for any 'approve' transition"],
    humanCheckpoints: ["Approver decision is final"],
    runsLast30d: 9,
  },
  // Task #254 — v3 Roster: the Access Sentinel.
  {
    id: "ag_access_sentinel",
    name: "Access Sentinel",
    group: "Operations",
    stage: "Govern",
    purpose:
      "Validates engagement-access grants. Blocks pricing/margin scope for non-employees, freezes grants on closed engagements, and writes an audit row for every grant or revoke.",
    model: "claude-sonnet-4-6",
    starred: false,
    status: "mvp",
    tools: ["roster.grant", "roster.revoke", "audit.write"],
    guardrails: [
      "Pricing and margin scope are denied for contractors and partner-firm resources",
      "Grants on closed engagements are frozen — Sentinel proposes revocation instead",
      "Only Partner / Operations / Engagement Lead may write grants",
    ],
    humanCheckpoints: [
      "Operations confirms revocation when an engagement closes",
    ],
    runsLast30d: 0,
  },
];

// ============================================================
// 4) OPPORTUNITIES — at least one per account, varied PLM stages
// ============================================================
const OPPORTUNITIES = [
  {
    id: "opp_tasama_bpo_expansion",
    slug: "tasama-bpo-expansion",
    name: "Tasama Agentic BPO — phase 2 expansion",
    accountId: "acc_tasama",
    plmStage: "won",
    buyerPersona: "Chief Operating Officer",
    offeringAnchor: "Agentic Operations",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    dealSizeHypothesis: 1_400_000,
    probabilityPct: 100,
    nextMilestone: "Mobilize phase-2 charter",
    sourceLead: "Existing relationship",
    daysInStage: 4,
  },
  {
    id: "opp_dge_effortless_v2",
    slug: "dge-effortless-v2",
    name: "DGE Effortless v2 — service-pack expansion",
    accountId: "acc_dge",
    plmStage: "pursue",
    buyerPersona: "Director of Government Enablement",
    offeringAnchor: "Citizen Service Agents",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    dealSizeHypothesis: 820_000,
    probabilityPct: 65,
    nextMilestone: "Submit proposal · 18 May",
    sourceLead: "Past engagement",
    daysInStage: 11,
  },
  {
    id: "opp_stc_b2b_platform",
    slug: "stc-b2b-platform",
    name: "STC — enterprise B2B agent platform RFP",
    accountId: "acc_stc",
    plmStage: "pursue",
    buyerPersona: "VP Enterprise Solutions",
    offeringAnchor: "Agentic Platform",
    partnerOwnerId: "p_gokhan_guney",
    engagementLeadId: "p_omar_najjar",
    dealSizeHypothesis: 2_100_000,
    probabilityPct: 45,
    nextMilestone: "Go/no-go decision today",
    sourceLead: "Inbound RFP",
    daysInStage: 6,
  },
  {
    id: "opp_aldrees_boq",
    slug: "aldrees-boq",
    name: "Aldrees BOQ workshop · scoping",
    accountId: "acc_aldrees",
    plmStage: "shape",
    buyerPersona: "Head of Procurement",
    offeringAnchor: "Process Discovery",
    partnerOwnerId: "p_gokhan_guney",
    engagementLeadId: "p_layla_haddad",
    dealSizeHypothesis: 320_000,
    probabilityPct: 55,
    nextMilestone: "Scope letter · 16 May",
    sourceLead: "Workshop follow-up",
    daysInStage: 9,
  },
  {
    id: "opp_dubai_muni_servicedesign",
    slug: "dubai-muni-servicedesign",
    name: "Dubai Municipality — service design transformation",
    accountId: "acc_dubai_municipality",
    plmStage: "shape",
    buyerPersona: "Director General",
    offeringAnchor: "Service Design + Agents",
    partnerOwnerId: "p_gokhan_guney",
    engagementLeadId: "p_layla_haddad",
    dealSizeHypothesis: 1_650_000,
    probabilityPct: 40,
    nextMilestone: "Draft PRT for ED · 14 May",
    sourceLead: "Cabinet introduction",
    daysInStage: 17,
  },
  {
    id: "opp_tahakom_incident_copilot",
    slug: "tahakom-incident-copilot",
    name: "Tahakom — incident-response copilot POV",
    accountId: "acc_tahakom",
    plmStage: "identify",
    buyerPersona: "Chief Operating Officer",
    offeringAnchor: "Operations Copilots",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_omar_najjar",
    dealSizeHypothesis: 480_000,
    probabilityPct: 25,
    nextMilestone: "POV brief draft",
    sourceLead: "Conference",
    daysInStage: 3,
  },
  {
    id: "opp_nhc_journey",
    slug: "nhc-journey",
    name: "NHC — customer journey + design intelligence",
    accountId: "acc_nhc",
    plmStage: "identify",
    buyerPersona: "Chief Customer Officer",
    offeringAnchor: "Design Intelligence",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    dealSizeHypothesis: 720_000,
    probabilityPct: 20,
    nextMilestone: "Discovery call · 19 May",
    sourceLead: "Outbound",
    daysInStage: 38,
  },
  {
    id: "opp_dge_passport",
    slug: "dge-passport",
    name: "DGE — citizen-passport renewal pilot",
    accountId: "acc_dge",
    plmStage: "lost",
    buyerPersona: "Director of Service Design",
    offeringAnchor: "Citizen Service Agents",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_omar_najjar",
    dealSizeHypothesis: 290_000,
    probabilityPct: 0,
    nextMilestone: "Post-mortem written-up",
    sourceLead: "Existing relationship",
    daysInStage: 22,
  },
  // Task #243 — explicit lost_no_decision and withdrawn opportunities so the
  // 10-stage v2 sales-stage lifecycle has at least one example per stage and
  // the walkthrough hits the no-decision debrief path.
  {
    id: "opp_aldrees_workshop_followup",
    slug: "aldrees-workshop-followup",
    name: "Aldrees — supplier-portal copilot · no-decision",
    accountId: "acc_aldrees",
    plmStage: "lost",
    salesStage: "lost_no_decision",
    buyerPersona: "VP Procurement",
    offeringAnchor: "Operations Copilots",
    partnerOwnerId: "p_gokhan_guney",
    engagementLeadId: "p_omar_najjar",
    dealSizeHypothesis: 410_000,
    probabilityPct: 0,
    nextMilestone: "Buyer transcript pending; debrief queued",
    sourceLead: "Workshop follow-up",
    daysInStage: 41,
  },
  {
    id: "opp_nhc_arabic_pilot",
    slug: "nhc-arabic-pilot",
    name: "NHC — Arabic-first chat pilot · withdrawn",
    accountId: "acc_nhc",
    plmStage: "lost",
    salesStage: "withdrawn",
    buyerPersona: "Chief Customer Officer",
    offeringAnchor: "Citizen Service Agents",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    dealSizeHypothesis: 540_000,
    probabilityPct: 0,
    nextMilestone: "Buyer requested deferral to FY27 — withdrawn by AICo",
    sourceLead: "Outbound",
    daysInStage: 12,
  },
];

// ============================================================
// 5) ENGAGEMENTS — Tasama Agentic BPO is the showcase
// ============================================================
const TASAMA_ENG_ID = "eng_tasama_bpo_phase1";
const ENGAGEMENTS = [
  {
    id: TASAMA_ENG_ID,
    slug: "tasama-bpo-phase1",
    name: "Tasama Agentic BPO — phase 1",
    opportunityId: "opp_tasama_bpo_expansion",
    accountId: "acc_tasama",
    plmStage: "deliver",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    charter: {
      objectives: [
        "Stand up the Maven AI marketplace as Tasama's primary agentic operations channel",
        "Reduce mean handle time for top-3 shared services by 40% within 90 days",
        "Embed an Agent Architect cadence so every new process candidate is evaluated weekly",
      ],
      scope: [
        "Marketplace front-end + ops back-office",
        "Agent runtime for first 6 services",
        "Adoption + change program for ops leads",
      ],
      outOfScope: [
        "Finance and HRIS integration (phase 2)",
        "Arabic-language client deliverables (UI chrome only)",
      ],
      successMetrics: [
        {
          name: "Mean handle time",
          baseline: "11 min",
          target: "< 7 min",
        },
        {
          name: "First-contact resolution",
          baseline: "62%",
          target: "≥ 80%",
        },
        {
          name: "Cost-per-service",
          baseline: "SAR 38",
          target: "≤ SAR 22",
        },
      ],
      governance:
        "Weekly steering with COO sponsor; bi-weekly Partner readout; daily Lead/AICo standup.",
      valueHypothesis:
        "If Tasama's top-volume services are handled by named agents with senior human oversight, mean handle time drops 40% and adoption compounds to >70% of inbound by day 90.",
    },
    workstreams: [
      { name: "Marketplace front-end", lead: "Sara Qureshi", status: "on-track" },
      { name: "Agent runtime", lead: "Sara Qureshi", status: "on-track" },
      { name: "Service-by-service rollout", lead: "Layla Haddad", status: "amber" },
      { name: "Adoption + change", lead: "Omar Najjar", status: "on-track" },
    ],
    valueCase: {
      monthlyRunRateSar: 1_320_000,
      adoptionPct: 41,
      breakeven: "Month 6",
    },
    startDate: isoDate(DAYS_AGO(60)),
    plannedEndDate: isoDate(DAYS_FROM_NOW(120)),
    raidStatus: "amber" as const,
    deliverablesDueThisWeek: 2,
  },
  {
    id: "eng_dge_effortless_v1",
    slug: "dge-effortless-v1",
    name: "DGE Effortless v1 — pilot delivery",
    opportunityId: null,
    accountId: "acc_dge",
    plmStage: "compound",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_omar_najjar",
    charter: null,
    workstreams: [
      { name: "Service-pack v1", lead: "Omar Najjar", status: "complete" },
    ],
    valueCase: null,
    startDate: isoDate(DAYS_AGO(180)),
    plannedEndDate: isoDate(DAYS_AGO(20)),
    raidStatus: "green" as const,
    deliverablesDueThisWeek: 0,
  },
  {
    id: "eng_aldrees_workshop",
    slug: "aldrees-workshop",
    name: "Aldrees · BOQ workshop · learning harvest",
    opportunityId: null,
    accountId: "acc_aldrees",
    plmStage: "compound",
    partnerOwnerId: "p_gokhan_guney",
    engagementLeadId: "p_layla_haddad",
    charter: null,
    workstreams: [
      { name: "Workshop facilitation", lead: "Layla Haddad", status: "complete" },
    ],
    valueCase: null,
    startDate: isoDate(DAYS_AGO(45)),
    plannedEndDate: isoDate(DAYS_AGO(15)),
    raidStatus: "green" as const,
    deliverablesDueThisWeek: 0,
  },
  // Task #243 — Synthetic Arabic-first engagement, distinct from Tasama
  // (which remains EN). Exercises the bilingual code path end-to-end so
  // the Engagement Curator emits an AR languageVariant + Arabic message
  // for this engagement only.
  {
    id: "eng_nhc_ar_pilot",
    slug: "nhc-ar-pilot",
    name: "NHC — Arabic-first chat pilot · synthetic",
    opportunityId: "opp_nhc_arabic_pilot",
    accountId: "acc_nhc",
    plmStage: "deliver",
    partnerOwnerId: "p_mounir_ariss",
    engagementLeadId: "p_layla_haddad",
    charter: null,
    workstreams: [
      { name: "Arabic-first conversation design", lead: "Layla Haddad", status: "on-track" },
    ],
    valueCase: null,
    startDate: isoDate(DAYS_AGO(20)),
    plannedEndDate: isoDate(DAYS_FROM_NOW(60)),
    raidStatus: "green" as const,
    deliverablesDueThisWeek: 0,
    defaultLanguage: "ar" as const,
  },
];

// ============================================================
// 6) ATELIER ASSETS — reusable IP (spec §9.2)
// ============================================================
const ASSETS = [
  {
    id: "ast_tasama_pov",
    kind: "pov",
    title: "Tasama AICo Business Case (POV)",
    abstract:
      "Citation-bound POV deliverable that anchored the Tasama Agentic BPO program. Sets the pyramid pattern for HTML POVs.",
    provenance: "Used in Tasama 2026 · authored by POV Author v3",
    tags: ["pov-pattern", "tasama", "bpo", "html"],
    bodyOrFileUrl: null,
    promotedFromEngagementId: TASAMA_ENG_ID,
    promotedByUserId: "p_mounir_ariss",
  },
  {
    id: "ast_maven_ai_brand",
    kind: "framework",
    title: "Maven AI website — brand reference",
    abstract:
      "Live Maven AI marketplace site. Brand voice, layout, and componentry reference for every external deliverable.",
    provenance: "Public site · brand canonical",
    tags: ["brand", "maven-ai", "reference"],
    bodyOrFileUrl: null,
    promotedFromEngagementId: null,
    promotedByUserId: null,
  },
  {
    id: "ast_dge_replit_prompt",
    kind: "prompt",
    title: "DGE Effortless · Replit build prompt",
    abstract:
      "Reference Replit-ready build prompt for prototype delivery. Pattern source for Prototype Forge.",
    provenance: "Used in DGE Q4 2025 · authored by Prototype Forge v1",
    tags: ["prototype", "replit", "dge", "prompt-pattern"],
    bodyOrFileUrl: null,
    promotedFromEngagementId: "eng_dge_effortless_v1",
    promotedByUserId: "p_mounir_ariss",
  },
  {
    id: "ast_aldrees_learning",
    kind: "learning",
    title: "Aldrees BOQ workshop · delivery learnings",
    abstract:
      "Five hard-won learnings from the Aldrees BOQ workshop, formatted as a reusable delivery memo.",
    provenance: "Promoted from Aldrees workshop · 18 days ago",
    tags: ["delivery", "workshop", "aldrees", "learning"],
    bodyOrFileUrl: null,
    promotedFromEngagementId: "eng_aldrees_workshop",
    promotedByUserId: "p_layla_haddad",
  },
  {
    id: "ast_diagnostic_memo_v3",
    kind: "prompt",
    title: "Prompt · Diagnostic Memo v3",
    abstract:
      "Latest active prompt for Diagnostic Memo Author. Eval score 0.91; supersedes v2.",
    provenance: "Authored by Sara Qureshi · activated 6 days ago",
    tags: ["prompt", "diagnostic", "active"],
    bodyOrFileUrl: null,
    promotedFromEngagementId: null,
    promotedByUserId: "p_sara_qureshi",
  },
  {
    id: "ast_pyramid_framework",
    kind: "framework",
    title: "Pyramid framework · partner-grade deliverables",
    abstract:
      "Top-down pyramid structure with answer-first synthesis, used by every external deliverable.",
    provenance: "Atelier canonical · maintained by Mounir Ariss",
    tags: ["framework", "pyramid", "synthesis"],
    bodyOrFileUrl: null,
    promotedFromEngagementId: null,
    promotedByUserId: "p_mounir_ariss",
  },
  {
    id: "ast_spec_from_legacy",
    kind: "pov",
    title: "POV pattern · spec-from-legacy",
    abstract:
      "Newly captured POV pattern for legacy modernization mandates. Three sections, four citations, ready for re-use.",
    provenance: "Captured 2 days ago · candidate for Atelier promotion",
    tags: ["pov-pattern", "modernization", "candidate"],
    bodyOrFileUrl: null,
    promotedFromEngagementId: null,
    promotedByUserId: null,
  },
];

// ============================================================
// 7) PANE A items (addressed to founding Partner)
// ============================================================
const PANE_A = [
  {
    id: "pa_tasama_pov_approve",
    userId: "p_mounir_ariss",
    title: "Approve POV — Tasama phase 2 expansion",
    summary:
      "POV Author v3 produced a draft, Synthesis Critic returned GREEN with one amber on the value-realisation slide. Ready for your read.",
    priority: "high",
    hrefKind: "opportunity",
    hrefTargetId: "opp_tasama_bpo_expansion",
    dueLabel: "Today, 4:00 PM",
    sortKey: 1,
  },
  {
    id: "pa_stc_gono_go",
    userId: "p_mounir_ariss",
    title: "Sign go/no-go — STC RFP",
    summary:
      "Pursuit Scout flagged margin compression and a 6-week clock. Lead recommends GO with senior staffing only.",
    priority: "high",
    hrefKind: "opportunity",
    hrefTargetId: "opp_stc_b2b_platform",
    dueLabel: "Today, EOD",
    sortKey: 2,
  },
  {
    id: "pa_aldrees_charter",
    userId: "p_mounir_ariss",
    title: "Review charter v2 — Aldrees scoping",
    summary:
      "Charter Architect tightened scope after the workshop debrief. Three success metrics now paired; one objective awaits your call.",
    priority: "medium",
    hrefKind: "opportunity",
    hrefTargetId: "opp_aldrees_boq",
    dueLabel: "Tomorrow",
    sortKey: 3,
  },
  {
    id: "pa_dubai_prt",
    userId: "p_mounir_ariss",
    title: "Send PRT — Dubai Municipality",
    summary:
      "Proposal Composer prepared the partner-ready transmittal. Compliance matrix is GREEN. Pricing within target margin.",
    priority: "medium",
    hrefKind: "opportunity",
    hrefTargetId: "opp_dubai_muni_servicedesign",
    dueLabel: "Wed, 14 May",
    sortKey: 4,
  },
  {
    id: "pa_tasama_deliverable",
    userId: "p_mounir_ariss",
    title: "Approve deliverable — Tasama service-pack v2 readout",
    summary:
      "Synthesis Critic flagged one issue on adoption metric framing. Lead has staged the override rationale.",
    priority: "medium",
    hrefKind: "engagement",
    hrefTargetId: TASAMA_ENG_ID,
    dueLabel: "Fri, 16 May",
    sortKey: 5,
  },

  // Layla Haddad — Engagement Lead
  {
    id: "pa_layla_charter",
    userId: "p_layla_haddad",
    title: "Tasama charter v3 — your sign-off needed",
    summary:
      "Charter Architect tightened the success metrics. Two amber items remain on the Steering RACI.",
    priority: "high",
    hrefKind: "engagement",
    hrefTargetId: TASAMA_ENG_ID,
    dueLabel: "Today, 5:00 PM",
    sortKey: 1,
  },
  {
    id: "pa_layla_raid",
    userId: "p_layla_haddad",
    title: "RAID review — Tasama week 4",
    summary:
      "RAID Watchdog escalated 2 risks to red after vendor delay. Recommend mitigations attached.",
    priority: "high",
    hrefKind: "engagement",
    hrefTargetId: TASAMA_ENG_ID,
    dueLabel: "Today, EOD",
    sortKey: 2,
  },
  {
    id: "pa_layla_workplan",
    userId: "p_layla_haddad",
    title: "Approve workplan re-baseline — Aldrees scoping",
    summary:
      "Workplan Architect produced revised milestones; critical path slipped by 4 working days.",
    priority: "medium",
    hrefKind: "opportunity",
    hrefTargetId: "opp_aldrees_boq",
    dueLabel: "Tomorrow",
    sortKey: 3,
  },
  {
    id: "pa_layla_meeting",
    userId: "p_layla_haddad",
    title: "Steering deck for Tasama — review draft",
    summary:
      "Meeting Scribe prepared the steering pack with last-week decisions and open RAID items.",
    priority: "medium",
    hrefKind: "engagement",
    hrefTargetId: TASAMA_ENG_ID,
    dueLabel: "Wed, 14 May",
    sortKey: 4,
  },

  // Omar Najjar — SME (sector / domain expert)
  {
    id: "pa_omar_pov_review",
    userId: "p_omar_najjar",
    title: "SME review — STC RFP point-of-view",
    summary:
      "POV Author wants your sector lens on the B2B platform pricing argument before partner read.",
    priority: "high",
    hrefKind: "opportunity",
    hrefTargetId: "opp_stc_b2b_platform",
    dueLabel: "Today, 3:00 PM",
    sortKey: 1,
  },
  {
    id: "pa_omar_diagnostic",
    userId: "p_omar_najjar",
    title: "Diagnostic memo — Dubai Municipality service design",
    summary:
      "Diagnostic Memo agent drafted findings; needs your benchmarks against UAE peers.",
    priority: "medium",
    hrefKind: "opportunity",
    hrefTargetId: "opp_dubai_muni_servicedesign",
    dueLabel: "Tomorrow",
    sortKey: 2,
  },
  {
    id: "pa_omar_atelier",
    userId: "p_omar_najjar",
    title: "Promote new framework to Atelier — Service Blueprint v2",
    summary:
      "Atelier Curator queued your authored framework for promotion. Approve and add tags.",
    priority: "low",
    hrefKind: "atelier",
    hrefTargetId: "atelier_assets",
    dueLabel: "This week",
    sortKey: 3,
  },

  // Sara Qureshi — AI Engineer
  {
    id: "pa_sara_agent_design",
    userId: "p_sara_qureshi",
    title: "Approve agent design — Pricing Analyst v2",
    summary:
      "Agent Architect produced an updated tool/guardrail spec. Eval pack staged for review.",
    priority: "high",
    hrefKind: "atelier",
    hrefTargetId: "atelier_agents",
    dueLabel: "Today, 6:00 PM",
    sortKey: 1,
  },
  {
    id: "pa_sara_prototype",
    userId: "p_sara_qureshi",
    title: "Prototype Forge — Tasama action-tracker UI",
    summary:
      "First buildable prototype is up; you marked critique items in last review — ready to re-run.",
    priority: "high",
    hrefKind: "engagement",
    hrefTargetId: TASAMA_ENG_ID,
    dueLabel: "Tomorrow",
    sortKey: 2,
  },
  {
    id: "pa_sara_eval",
    userId: "p_sara_qureshi",
    title: "Eval failures — Synthesis Critic regressions",
    summary:
      "Two regression cases flagged amber after model swap. Suggested prompt diff attached.",
    priority: "medium",
    hrefKind: "atelier",
    hrefTargetId: "atelier_agents",
    dueLabel: "Wed, 14 May",
    sortKey: 3,
  },

  // Khaled Aziz — Business Developer
  {
    id: "pa_khaled_pursuit",
    userId: "p_khaled_aziz",
    title: "Triage — 4 new pursuits scouted overnight",
    summary:
      "Pursuit Scout returned 4 candidates above threshold. Decide promote / park / reject.",
    priority: "high",
    hrefKind: "atelier",
    hrefTargetId: "pipeline",
    dueLabel: "Today, 10:00 AM",
    sortKey: 1,
  },
  {
    id: "pa_khaled_proposal",
    userId: "p_khaled_aziz",
    title: "Proposal Composer — Aldrees BoQ commercial pack",
    summary:
      "Composer prepared sections A–F; pricing window narrowed. Needs your final margin call.",
    priority: "high",
    hrefKind: "opportunity",
    hrefTargetId: "opp_aldrees_boq",
    dueLabel: "Today, EOD",
    sortKey: 2,
  },
  {
    id: "pa_khaled_pipeline_review",
    userId: "p_khaled_aziz",
    title: "Weekly pipeline hygiene — 3 opps aged red",
    summary:
      "Three opportunities have been in stage > 30 days. Triage agent suggests next actions per row.",
    priority: "medium",
    hrefKind: "atelier",
    hrefTargetId: "pipeline",
    dueLabel: "Tomorrow",
    sortKey: 3,
  },
  {
    id: "pa_khaled_dubai_prt",
    userId: "p_khaled_aziz",
    title: "Confirm PRT recipients — Dubai Municipality",
    summary:
      "Partner-Ready Transmittal staged by Proposal Composer. Distribution list awaits your review.",
    priority: "low",
    hrefKind: "opportunity",
    hrefTargetId: "opp_dubai_muni_servicedesign",
    dueLabel: "This week",
    sortKey: 4,
  },
];

// ============================================================
// 8) RECENT AGENT RUNS (drives the Activity Stream)
// ============================================================
const AGENT_RUNS = [
  {
    id: "run_pursuit_tahakom",
    agentId: "ag_pursuit_scout",
    targetType: "opportunity",
    targetId: "opp_tahakom_incident_copilot",
    targetLabel: "Tahakom · incident-response copilot",
    status: "running",
    confidence: "amber",
    statusMessage: "Scanning Tahakom news — 12 sources",
    progressPct: 64,
    sourcesCount: 12,
    createdAt: MINS_AGO(2),
  },
  {
    id: "run_meeting_aldrees",
    agentId: "ag_meeting_scribe",
    targetType: "engagement",
    targetId: "eng_aldrees_workshop",
    targetLabel: "Aldrees BOQ workshop",
    status: "running",
    confidence: "green",
    statusMessage: "Transcribing workshop · 41% complete",
    progressPct: 41,
    sourcesCount: null,
    createdAt: MINS_AGO(7),
  },
  {
    id: "run_critic_tasama",
    agentId: "ag_synthesis_critic",
    targetType: "deliverable",
    targetId: "del_tasama_pov_v2",
    targetLabel: "Tasama POV v2",
    status: "complete",
    confidence: "amber",
    statusMessage: "1 amber issue on value-realisation slide",
    progressPct: 100,
    sourcesCount: 4,
    createdAt: MINS_AGO(18),
  },
  {
    id: "run_charter_aldrees",
    agentId: "ag_charter_architect",
    targetType: "opportunity",
    targetId: "opp_aldrees_boq",
    targetLabel: "Aldrees scoping charter",
    status: "complete",
    confidence: "green",
    statusMessage: "Charter v2 staged for Partner review",
    progressPct: 100,
    sourcesCount: 6,
    createdAt: HOURS_AGO(2),
  },
  {
    id: "run_proposal_dubai",
    agentId: "ag_proposal_composer",
    targetType: "opportunity",
    targetId: "opp_dubai_muni_servicedesign",
    targetLabel: "Dubai Muni · partner-ready transmittal",
    status: "complete",
    confidence: "green",
    statusMessage: "PRT drafted; compliance GREEN",
    progressPct: 100,
    sourcesCount: 9,
    createdAt: HOURS_AGO(4),
  },
  {
    id: "run_agent_arch_tasama",
    agentId: "ag_agent_architect",
    targetType: "engagement",
    targetId: TASAMA_ENG_ID,
    targetLabel: "Tasama process discovery sketch",
    status: "complete",
    confidence: "green",
    statusMessage: "3 candidate agents proposed; one flagged high-risk",
    progressPct: 100,
    sourcesCount: 14,
    createdAt: HOURS_AGO(7),
  },
  {
    id: "run_pursuit_nhc",
    agentId: "ag_pursuit_scout",
    targetType: "opportunity",
    targetId: "opp_nhc_journey",
    targetLabel: "NHC discovery brief",
    status: "blocked",
    confidence: "red",
    statusMessage: "Awaiting Partner go-ahead — 38 days in stage",
    progressPct: 100,
    sourcesCount: 8,
    createdAt: HOURS_AGO(20),
  },
  {
    id: "run_critic_stc",
    agentId: "ag_synthesis_critic",
    targetType: "opportunity",
    targetId: "opp_stc_b2b_platform",
    targetLabel: "STC compliance pre-flight",
    status: "error",
    confidence: "red",
    statusMessage: "Insufficient evidence on residency clause",
    progressPct: 100,
    sourcesCount: 3,
    createdAt: HOURS_AGO(24),
  },
  {
    id: "run_curator",
    agentId: "ag_atelier_curator",
    targetType: "atelier",
    targetId: "ast_spec_from_legacy",
    targetLabel: "spec-from-legacy POV pattern",
    status: "complete",
    confidence: "green",
    statusMessage: "Promotion candidate staged for Partner",
    progressPct: 100,
    sourcesCount: 5,
    createdAt: DAYS_AGO(2),
  },
  {
    id: "run_meeting_tasama",
    agentId: "ag_meeting_scribe",
    targetType: "engagement",
    targetId: TASAMA_ENG_ID,
    targetLabel: "Tasama steering · 11 May",
    status: "complete",
    confidence: "green",
    statusMessage: "12 decisions, 8 actions captured",
    progressPct: 100,
    sourcesCount: null,
    createdAt: DAYS_AGO(1),
  },
];

// ============================================================
// 9) PROMPTS for the 8 starred agents (one active version each)
// ============================================================
const PROMPTS = AGENTS.filter((a) => a.starred).map((a, i) => ({
  id: `pr_${a.id}_v1`,
  agentId: a.id,
  version: 1,
  body: `# ${a.name} · v1\n\n## Purpose\n${a.purpose}\n\n## Tools\n${a.tools.map((t) => `- ${t}`).join("\n")}\n\n## Guardrails\n${a.guardrails.map((g) => `- ${g}`).join("\n")}\n\n## Human checkpoints\n${a.humanCheckpoints.map((h) => `- ${h}`).join("\n")}\n\n## Voice\nConfident, commercial, partner-grade. Mirror the AICo non-negotiables: human authority sovereign; show the work; audit trail; bilingual-aware; watermark synthetic data.\n`,
  status: "active" as const,
  evalScore: 0.85 + (i % 5) * 0.02,
  author: "p_sara_qureshi",
}));

// ============================================================
// 10) Tasama supporting data (deliverables, meetings, RAID, hyp tree, process)
// ============================================================
const TASAMA_DELIVERABLES = [
  {
    id: "del_tasama_pov_v2",
    type: "design",
    name: "Tasama POV — phase 2 expansion",
    status: "in_review",
    hypothesisId: "hyp_tasama_root",
    dueDate: isoDate(DAYS_FROM_NOW(2)),
    versions: [
      {
        id: "delv_tasama_pov_v2_v1",
        versionNumber: 1,
        body: "Pyramid v1 — value at the bottom, adoption at the top.",
        format: "html",
      },
      {
        id: "delv_tasama_pov_v2_v2",
        versionNumber: 2,
        body: "Pyramid v2 — refined value-realisation slide; one amber from Critic.",
        format: "html",
      },
    ],
  },
  {
    id: "del_tasama_servicepack_v2",
    type: "build",
    name: "Tasama Service-pack v2 readout",
    status: "draft",
    hypothesisId: null,
    dueDate: isoDate(DAYS_FROM_NOW(4)),
    versions: [
      {
        id: "delv_tasama_servicepack_v1",
        versionNumber: 1,
        body: "Service-by-service adoption snapshot, top-3 services delta.",
        format: "html",
      },
    ],
  },
  {
    id: "del_tasama_value_readout",
    type: "design",
    name: "Tasama 30-day Value Readout",
    status: "approved",
    hypothesisId: null,
    dueDate: isoDate(DAYS_AGO(2)),
    versions: [
      {
        id: "delv_tasama_value_readout_v1",
        versionNumber: 1,
        body: "<h2>30-day value readout</h2><p>Mean handle time down 22% across the top-3 services; adoption tracking ahead of plan on services 1 and 2.</p>",
        format: "html",
      },
    ],
  },
  {
    id: "del_tasama_residency_brief",
    type: "design",
    name: "Tasama Residency & Identity Brief",
    status: "draft",
    hypothesisId: null,
    dueDate: isoDate(DAYS_FROM_NOW(7)),
    versions: [
      {
        id: "delv_tasama_residency_brief_v1",
        versionNumber: 1,
        // INTENTIONAL DLP TRAP for Publish Sentinel demo (Saudi national ID + INTERNAL-ONLY marker).
        body: "<h2>Residency &amp; Identity</h2><p>INTERNAL-ONLY draft. Sample operator profile: Saudi national ID 1234567890, IBAN SA0380000000608010167519.</p>",
        format: "html",
      },
    ],
  },
];

const TASAMA_MEETINGS = [
  {
    id: "mtg_tasama_kickoff",
    parentType: "engagement",
    parentId: TASAMA_ENG_ID,
    mode: "upload",
    kind: "kickoff",
    title: "Tasama phase-1 kickoff",
    date: isoDate(DAYS_AGO(58)),
    attendees: ["Tasama COO", "Tasama Ops Director", "Mounir Ariss", "Layla Haddad"],
    summary:
      "Confirmed phase-1 scope, named the first 6 services, agreed on weekly steering cadence.",
  },
  {
    id: "mtg_tasama_discovery",
    parentType: "engagement",
    parentId: TASAMA_ENG_ID,
    mode: "upload",
    kind: "discovery",
    title: "Tasama shared services intake — discovery",
    date: isoDate(DAYS_AGO(40)),
    attendees: ["Tasama Ops Director", "Tasama Service Leads ×3", "Layla Haddad", "Sara Qureshi"],
    summary:
      "Captured the as-is intake flow for the top-3 services; identified 9 candidate agentifiable steps.",
  },
  {
    id: "mtg_tasama_steering_may",
    parentType: "engagement",
    parentId: TASAMA_ENG_ID,
    mode: "upload",
    kind: "steering",
    title: "Tasama steering · 11 May",
    date: isoDate(DAYS_AGO(1)),
    attendees: ["Tasama COO", "Mounir Ariss", "Layla Haddad"],
    summary:
      "Approved Pyramid v2 of the POV; agreed to revisit value-realisation slide before client send.",
  },
];

const TASAMA_RAID = [
  {
    id: "raid_tasama_adoption",
    kind: "risk",
    severity: "amber",
    ownerId: "p_layla_haddad",
    status: "open",
    dueDate: isoDate(DAYS_FROM_NOW(7)),
    description:
      "Adoption tail of service-3 lagging plan by 11 percentage points; need targeted change loop.",
  },
  {
    id: "raid_tasama_residency",
    kind: "issue",
    severity: "amber",
    ownerId: "p_omar_najjar",
    status: "open",
    dueDate: isoDate(DAYS_FROM_NOW(10)),
    description:
      "Data-residency confirmation outstanding for one upstream integration partner.",
  },
];

const TASAMA_HYPOTHESIS = {
  id: "hyp_tasama_root",
  engagementId: TASAMA_ENG_ID,
  root: {
    rootIssue:
      "Can a senior-overseen agentic operations layer cut Tasama's mean handle time by 40% within 90 days while compounding adoption past 70%?",
    branches: [
      {
        hypothesis:
          "Top-volume services dominate handle-time variance; agentifying them captures most of the value.",
        subHypotheses: [
          "Service-1 (intake) is responsible for >40% of MHT variance.",
          "Service-2 (status checks) can be fully agent-handled with a single human checkpoint.",
        ],
        evidenceRequired: [
          "30-day handle-time logs by service",
          "Quality-of-resolution audit on agent-handled tickets",
        ],
      },
      {
        hypothesis:
          "Adoption compounds when ops leads see clear telemetry and own the rollout pace.",
        subHypotheses: [
          "Per-lead dashboards lift adoption by ≥15 ppt within 30 days of release.",
          "Weekly 'service-of-the-week' rollout cadence outperforms bulk launches.",
        ],
        evidenceRequired: [
          "Adoption curves of comparable BPO transformations",
          "Tasama lead survey data",
        ],
      },
    ],
  },
};

const TASAMA_PROCESS = {
  id: "proc_tasama_intake",
  engagementId: TASAMA_ENG_ID,
  name: "Tasama shared-services intake",
  diagram: `flowchart TD
  A[Inbound request] --> B[Validate identity]
  B --> C{Service category?}
  C -->|Standard| D[Auto-fulfill via service agent]
  C -->|Complex| E[Human triage]
  D --> F[Confirm + log]
  E --> F`,
  steps: [
    {
      id: "s1",
      name: "Inbound request",
      currentOwner: "system",
      agentifiable: "yes",
      rationale: "Pure ingestion; no judgment required.",
      candidateAgentId: "ag_meeting_scribe",
    },
    {
      id: "s2",
      name: "Validate identity",
      currentOwner: "ops_lead",
      agentifiable: "partial",
      rationale: "Document validation can be agent-handled; edge cases need a human.",
      candidateAgentId: null,
    },
    {
      id: "s3",
      name: "Service category triage",
      currentOwner: "ops_lead",
      agentifiable: "yes",
      rationale: "Deterministic classification with audit trail.",
      candidateAgentId: null,
    },
  ],
};

// ============================================================
// SEED RUNNER
// ============================================================
async function truncateAll() {
  // Truncate child tables before parents to avoid FK weirdness even though
  // the schema does not declare hard FKs (text PKs let us be loose).
  const tables = [
    "atelier_salon_audit_events",
    "atelier_salon_notifications",
    "atelier_salon_requests",
    "atelier_salon_decisions",
    "atelier_deliverable_publishes",
    "atelier_salon_user_engagement_access",
    "atelier_salon_users",
    "atelier_salon_workspaces",
    "atelier_reports",
    "atelier_winloss_debriefs",
    "atelier_win_themes",
    "atelier_pane_a_items",
    "atelier_engagement_access",
    "atelier_audit_events",
    "atelier_agent_runs",
    "atelier_notifications",
    "atelier_agent_designs",
    "atelier_processes",
    "atelier_hypothesis_trees",
    "atelier_raid_items",
    "atelier_artifacts",
    "atelier_meetings",
    "atelier_transcripts",
    "atelier_deliverable_versions",
    "atelier_deliverables",
    "atelier_engagements",
    "atelier_opportunities",
    "atelier_assets",
    "atelier_prompts",
    "atelier_agents",
    "atelier_credentials",
    "atelier_contact_relationships",
    "atelier_contacts",
    "atelier_accounts",
    "atelier_users",
  ];
  for (const t of tables) {
    await db.execute(sql.raw(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`));
  }
}

function aud(
  entityType: string,
  entityId: string,
  actorType: "human" | "agent" | "system",
  actorLabel: string,
  action: string,
  payloadSummary: string,
  ts: Date,
  actorId?: string,
) {
  return {
    id: `aud_${entityId}_${action}_${ts.getTime()}`,
    entityType,
    entityId,
    actorType,
    actorId: actorId ?? null,
    actorLabel,
    action,
    payload: {},
    payloadSummary,
    ts,
  };
}

async function main() {
  console.log("[seed-atelier] truncating…");
  await truncateAll();

  console.log("[seed-atelier] personas…");
  await db.insert(atelierUsers).values(
    PERSONAS.map((p) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      initials: p.initials,
      role: p.role,
      roleLabel: p.roleLabel,
      title: p.title,
      permissions: p.permissions as unknown as string[],
    })),
  );

  console.log("[seed-atelier] accounts…");
  await db.insert(atelierAccounts).values(
    ACCOUNTS.map((a) => {
      const ext = ACCOUNT_EXT[a.id] ?? {};
      return {
        id: a.id,
        name: a.name,
        country: a.country,
        sector: a.sector,
        notes: a.notes,
        size: ext.size ?? "enterprise",
        hqCity: ext.hqCity ?? null,
        primaryCurrency: ext.primaryCurrency ?? "USD",
        primaryLanguage: ext.primaryLanguage ?? "en",
        tier: ext.tier ?? "C",
        status: ext.status ?? "active",
        partnerOwnerId: ext.partnerOwnerId ?? "p_mounir_ariss",
        relationshipStrength: ext.relationshipStrength ?? 50,
        enrichedAt: ext.enrichedAt ?? null,
        sourceSignals: ext.sourceSignals ?? [],
        strategicPriorities: ext.strategicPriorities ?? [],
        aicoHypothesis: ext.aicoHypothesis ?? null,
        pendingProfileUpdates: ext.pendingProfileUpdates ?? [],
      };
    }),
  );

  console.log("[seed-atelier] contacts…");
  if (CONTACTS.length > 0) {
    await db.insert(atelierContacts).values(CONTACTS);
  }
  if (CONTACT_RELATIONSHIPS.length > 0) {
    await db.insert(atelierContactRelationships).values(CONTACT_RELATIONSHIPS);
  }

  console.log("[seed-atelier] credentials…");
  if (CREDENTIALS.length > 0) {
    await db.insert(atelierCredentials).values(CREDENTIALS);
  }

  console.log("[seed-atelier] agents…");
  await db.insert(atelierAgents).values(
    AGENTS.map((a) => ({
      id: a.id,
      name: a.name,
      group: a.group,
      stage: a.stage,
      purpose: a.purpose,
      model: a.model,
      starred: a.starred,
      status: a.status,
      tools: a.tools,
      guardrails: a.guardrails,
      humanCheckpoints: a.humanCheckpoints,
      runsLast30d: a.runsLast30d,
    })),
  );

  console.log("[seed-atelier] prompts…");
  await db.insert(atelierPrompts).values(PROMPTS);

  console.log("[seed-atelier] opportunities…");
  await db.insert(atelierOpportunities).values(
    OPPORTUNITIES.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      accountId: o.accountId,
      buyerPersona: o.buyerPersona,
      offeringAnchor: o.offeringAnchor,
      plmStage: o.plmStage,
      // Task #243 — explicit salesStage when supplied (no_decision/withdrawn);
      // otherwise let the column default to 'lead'.
      ...("salesStage" in o && o.salesStage ? { salesStage: o.salesStage } : {}),
      partnerOwnerId: o.partnerOwnerId,
      engagementLeadId: o.engagementLeadId,
      dealSizeHypothesis: o.dealSizeHypothesis,
      probabilityPct: o.probabilityPct,
      nextMilestone: o.nextMilestone,
      sourceLead: o.sourceLead,
      daysInStage: o.daysInStage,
    })),
  );

  console.log("[seed-atelier] engagements…");
  await db.insert(atelierEngagements).values(
    ENGAGEMENTS.map((e) => ({
      id: e.id,
      slug: e.slug,
      name: e.name,
      opportunityId: e.opportunityId,
      accountId: e.accountId,
      plmStage: e.plmStage,
      partnerOwnerId: e.partnerOwnerId,
      engagementLeadId: e.engagementLeadId,
      charter: e.charter,
      workstreams: e.workstreams,
      valueCase: e.valueCase,
      startDate: e.startDate,
      plannedEndDate: e.plannedEndDate,
      raidStatus: e.raidStatus,
      deliverablesDueThisWeek: e.deliverablesDueThisWeek,
      // Task #243 — pass through defaultLanguage when set on a seed entry,
      // otherwise the column default ('en') applies.
      ...("defaultLanguage" in e && e.defaultLanguage
        ? { defaultLanguage: e.defaultLanguage }
        : {}),
    })),
  );

  console.log("[seed-atelier] engagement access grants…");
  // Engagement-id ACL: every non-partner persona must have an explicit
  // grant per engagement they can see. Partner has firm-wide access via
  // route logic and does NOT need rows here. We grant access to the
  // engagement's named lead, plus the SME (Omar) and AI engineer (Sara)
  // on their staffed Tasama engagement.
  // Task #254 — schema field is `roleOnEngagement` (mapped to legacy db
  // column `role`); using the new name keeps seed in sync with PRD §2.1.
  const accessRows: { id: string; engagementId: string; userId: string; roleOnEngagement: string }[] = [];
  for (const e of ENGAGEMENTS) {
    if (e.engagementLeadId && e.engagementLeadId !== "p_mounir_ariss") {
      accessRows.push({
        id: `access_${e.id}_${e.engagementLeadId}`,
        engagementId: e.id,
        userId: e.engagementLeadId,
        roleOnEngagement: "lead",
      });
    }
  }
  // SME + AI engineer staffed on Tasama (the showcase engagement).
  for (const uid of ["p_omar_najjar", "p_sara_qureshi"]) {
    accessRows.push({
      id: `access_${TASAMA_ENG_ID}_${uid}`,
      engagementId: TASAMA_ENG_ID,
      userId: uid,
      roleOnEngagement: "member",
    });
  }
  if (accessRows.length) await db.insert(atelierEngagementAccess).values(accessRows);

  console.log("[seed-atelier] deliverables + versions…");
  await db.insert(atelierDeliverables).values(
    TASAMA_DELIVERABLES.map((d) => ({
      id: d.id,
      engagementId: TASAMA_ENG_ID,
      type: d.type,
      name: d.name,
      status: d.status,
      hypothesisId: d.hypothesisId ?? null,
      currentVersionId: d.versions[d.versions.length - 1].id,
      dueDate: d.dueDate,
    })),
  );
  await db.insert(atelierDeliverableVersions).values(
    TASAMA_DELIVERABLES.flatMap((d) =>
      d.versions.map((v) => ({
        id: v.id,
        deliverableId: d.id,
        versionNumber: v.versionNumber,
        body: v.body,
        format: v.format,
      })),
    ),
  );

  console.log("[seed-atelier] meetings…");
  await db.insert(atelierMeetings).values(
    TASAMA_MEETINGS.map((m) => ({
      id: m.id,
      parentType: m.parentType,
      parentId: m.parentId,
      mode: m.mode,
      kind: m.kind,
      title: m.title,
      date: m.date,
      attendees: m.attendees,
      summary: m.summary,
    })),
  );

  console.log("[seed-atelier] hypothesis tree, process, RAID…");
  await db.insert(atelierHypothesisTrees).values([TASAMA_HYPOTHESIS]);
  await db.insert(atelierProcesses).values([TASAMA_PROCESS]);
  await db.insert(atelierRaidItems).values(
    TASAMA_RAID.map((r) => ({
      id: r.id,
      engagementId: TASAMA_ENG_ID,
      kind: r.kind,
      severity: r.severity,
      ownerId: r.ownerId,
      status: r.status,
      dueDate: r.dueDate,
      description: r.description,
    })),
  );

  console.log("[seed-atelier] atelier assets…");
  await db.insert(atelierAssets).values(
    ASSETS.map((a, i) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      abstract: a.abstract,
      bodyOrFileUrl: a.bodyOrFileUrl,
      provenance: a.provenance,
      tags: a.tags,
      promotedFromEngagementId: a.promotedFromEngagementId,
      promotedByUserId: a.promotedByUserId,
      createdAt: DAYS_AGO(i + 1),
    })),
  );

  console.log("[seed-atelier] pane A…");
  await db.insert(atelierPaneAItems).values(PANE_A);

  console.log("[seed-atelier] agent runs…");
  await db.insert(atelierAgentRuns).values(
    AGENT_RUNS.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      triggeredByUserId: "p_mounir_ariss",
      targetType: r.targetType,
      targetId: r.targetId,
      targetLabel: r.targetLabel,
      status: r.status,
      confidence: r.confidence,
      statusMessage: r.statusMessage,
      progressPct: r.progressPct,
      sourcesCount: r.sourcesCount,
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    })),
  );

  console.log("[seed-atelier] audit events…");
  const auditRows = [
    ...PERSONAS.map((p) =>
      aud("user", p.id, "system", "system", "user.create", `Persona seeded: ${p.name}`, DAYS_AGO(90)),
    ),
    ...ACCOUNTS.map((a) =>
      aud("account", a.id, "system", "system", "account.create", `Account seeded: ${a.name}`, DAYS_AGO(60)),
    ),
    ...OPPORTUNITIES.map((o) =>
      aud(
        "opportunity",
        o.id,
        "human",
        "Khaled Aziz",
        "opportunity.create",
        `Opportunity created at PLM stage ${o.plmStage}`,
        DAYS_AGO(o.daysInStage + 2),
        "p_khaled_aziz",
      ),
    ),
    ...ENGAGEMENTS.map((e) =>
      aud(
        "engagement",
        e.id,
        "human",
        "Mounir Ariss",
        "engagement.create",
        `Engagement mobilized: ${e.name}`,
        DAYS_AGO(60),
        "p_mounir_ariss",
      ),
    ),
    aud(
      "engagement",
      TASAMA_ENG_ID,
      "agent",
      "Charter Architect",
      "charter.draft",
      "Charter v1 drafted within 24h of mobilize.",
      DAYS_AGO(58),
      "ag_charter_architect",
    ),
    aud(
      "engagement",
      TASAMA_ENG_ID,
      "human",
      "Mounir Ariss",
      "charter.approve",
      "Charter approved with three success metrics.",
      DAYS_AGO(56),
      "p_mounir_ariss",
    ),
    aud(
      "deliverable",
      "del_tasama_pov_v2",
      "agent",
      "POV Author",
      "deliverable.draft",
      "POV v2 drafted with 6 sections, 14 citations.",
      HOURS_AGO(6),
      "ag_pov_author",
    ),
    aud(
      "deliverable",
      "del_tasama_pov_v2",
      "agent",
      "Synthesis Critic",
      "deliverable.review",
      "Critic returned AMBER on value-realisation slide.",
      HOURS_AGO(2),
      "ag_synthesis_critic",
    ),
    aud(
      "atelier",
      "ast_tasama_pov",
      "human",
      "Mounir Ariss",
      "atelier.promote",
      "POV pattern promoted to Atelier (used in Tasama 2026).",
      DAYS_AGO(20),
      "p_mounir_ariss",
    ),
    aud(
      "atelier",
      "ast_aldrees_learning",
      "human",
      "Layla Haddad",
      "atelier.promote",
      "Aldrees BOQ workshop learnings promoted.",
      DAYS_AGO(18),
      "p_layla_haddad",
    ),
    // Per-agent-run audit trail so the AgentRun audit tab is verifiably
    // populated for at least one canonical run from each starred agent.
    aud(
      "agent_run",
      "run_critic_tasama",
      "agent",
      "Synthesis Critic",
      "run.start",
      "Run started against del_tasama_pov_v2; 14 sources loaded.",
      HOURS_AGO(3),
      "ag_synthesis_critic",
    ),
    aud(
      "agent_run",
      "run_critic_tasama",
      "agent",
      "Synthesis Critic",
      "run.tool_call",
      "Tool: retrieve_evidence(scope=value_realisation) → 6 hits.",
      HOURS_AGO(3),
      "ag_synthesis_critic",
    ),
    aud(
      "agent_run",
      "run_critic_tasama",
      "system",
      "guardrail",
      "guardrail.pass",
      "All 4 guardrails passed (PII, sourcing, scope, evidence).",
      HOURS_AGO(2),
    ),
    aud(
      "agent_run",
      "run_critic_tasama",
      "agent",
      "Synthesis Critic",
      "run.complete",
      "Verdict AMBER on value-realisation slide; 1 issue raised.",
      HOURS_AGO(2),
      "ag_synthesis_critic",
    ),
    aud(
      "agent_run",
      "run_pursuit_tahakom",
      "agent",
      "Pursuit Scout",
      "run.start",
      "Scouting Tahakom against pursuit thresholds.",
      DAYS_AGO(2),
      "ag_pursuit_scout",
    ),
    aud(
      "agent_run",
      "run_pursuit_tahakom",
      "agent",
      "Pursuit Scout",
      "run.complete",
      "Promoted to opp_tahakom_aiops; confidence GREEN.",
      DAYS_AGO(2),
      "ag_pursuit_scout",
    ),
    aud(
      "agent_run",
      "run_charter_aldrees",
      "agent",
      "Charter Architect",
      "run.complete",
      "Charter v2 drafted; 3 success metrics paired with objectives.",
      DAYS_AGO(1),
      "ag_charter_architect",
    ),
    aud(
      "agent_run",
      "run_proposal_dubai",
      "agent",
      "Proposal Composer",
      "run.complete",
      "Proposal sections A–F drafted; compliance matrix GREEN.",
      DAYS_AGO(1),
      "ag_proposal_composer",
    ),
  ];
  await db.insert(atelierAuditEvents).values(auditRows);

  // ============================================================
  // Task #241 — Win Themes + closed-deal debrief + Mounir's Monday morning report
  // ============================================================
  console.log("[seed-atelier] win themes (PRD §7.2)…");
  const WIN_THEMES = [
    {
      tag: "senior_delivery",
      name: "We win on senior delivery",
      description: "Partner-on-the-pitch presence is the closer in the GCC.",
      polarity: "win",
      positioningLine:
        "AICo partners stay on the engagement — not just the pitch.",
    },
    {
      tag: "speed_to_value",
      name: "Speed-to-value beats scope",
      description: "90-day milestones with named owners win over 12-month roadmaps.",
      polarity: "win",
      positioningLine: "Production agents in 90 days, not slideware in 12 months.",
    },
    {
      tag: "pricing_wedge",
      name: "Pricing wedge requires outcome anchor",
      description: "Without a sharp outcome anchor we lose the CFO conversation.",
      polarity: "loss",
      positioningLine:
        "Outcome-based pricing on slide 1, not slide 12.",
    },
    {
      tag: "partner_leverage",
      name: "Partner leverage on incumbent stack",
      description: "Co-sell with hyperscaler/SI partners removes incumbent objection.",
      polarity: "win",
      positioningLine:
        "AICo brings the partner ecosystem; the incumbent brings the tower.",
    },
    {
      tag: "agentic_native",
      name: "Agentic-native, not bolted-on",
      description: "Buyers reject 'AI feature' overlays in favor of agentic operating models.",
      polarity: "win",
      positioningLine: "Agentic operations from day one — not a chatbot bolted to the side.",
    },
    {
      tag: "gcc_context",
      name: "GCC regulatory + cultural fluency",
      description: "On-the-ground context (Arabic, KSA/UAE governance) is non-negotiable.",
      polarity: "win",
      positioningLine: "Senior team on the ground in Riyadh + Dubai. Not a flyover model.",
    },
  ];
  await db.insert(atelierWinThemes).values(
    WIN_THEMES.map((t) => ({
      id: `wth_${t.tag}`,
      tag: t.tag,
      name: t.name,
      description: t.description,
      polarity: t.polarity,
      contributingDebriefIds: [],
      supportCount: 0,
      offeringTags: [],
      sectorTags: [],
      positioningLine: t.positioningLine,
      lastSeenAt: DAYS_AGO(7),
      createdByUserId: "p_mounir_ariss",
    })),
  );

  console.log("[seed-atelier] closed-deal Win/Loss debrief (DGE passport)…");
  await db.insert(atelierWinLossDebriefs).values([
    {
      id: "wld_dge_passport",
      opportunityId: "opp_dge_passport",
      outcome: "lost_no_decision",
      status: "pending",
      sellerPerceivedReasons: [
        "Champion changed roles mid-cycle.",
        "Procurement froze on incumbent contract terms.",
      ],
      sellerNotes: "Lost momentum after the COO transition; never rebooted the trust ladder.",
      partnerOwnerUserId: "p_mounir_ariss",
      engagementLeadUserId: "p_omar_najjar",
      dueAt: DAYS_FROM_NOW(7),
      createdByUserId: "p_mounir_ariss",
    },
  ]);
  await db.insert(atelierPaneAItems).values([
    {
      id: "pane_wld_dge",
      userId: "p_mounir_ariss",
      priority: "high",
      title: "Win/Loss debrief due — DGE passport",
      summary:
        "DGE passport closed as lost (no decision). Capture seller view, schedule buyer interview within 7 days.",
      hrefKind: "opportunity",
      hrefTargetId: "opp_dge_passport",
      dueLabel: "7 days",
      sortKey: 15,
    },
  ]);

  console.log("[seed-atelier] Mounir's Monday morning report…");
  await db.insert(atelierReports).values([
    {
      id: "rpt_mounir_monday_morning",
      ownerUserId: "p_mounir_ariss",
      templateId: "forecast_by_partner",
      name: "Mounir's Monday morning",
      parameters: {
        _schedule: { cron: "0 7 * * 1", recipientUserIds: ["p_mounir_ariss"] },
      },
      schedule: "weekly_monday",
      scheduleChannels: ["in_app"],
      createdByUserId: "p_mounir_ariss",
    },
  ]);
  await db.insert(atelierNotifications).values([
    {
      id: "ntf_mounir_monday_seed",
      userId: "p_mounir_ariss",
      kind: "report_scheduled",
      payload: { reportId: "rpt_mounir_monday_morning", cron: "0 7 * * 1" },
      channel: "in_app",
      subject: "Scheduled: Mounir's Monday morning",
      body: "Atelier will deliver the partner forecast each Monday at 07:00. (Slack/SMTP not wired in v2.)",
      refType: "report",
      refId: "rpt_mounir_monday_morning",
      scheduledFor: NOW,
      status: "queued",
      createdByUserId: "p_mounir_ariss",
    },
  ]);

  // ============================================================
  // The Salon (Task #242) — Tasama client workspace
  // ============================================================
  console.log("[seed-atelier] salon workspace + users + access…");
  const SALON_WS_ID = "salonws_tasama";
  await db.insert(atelierSalonWorkspaces).values([
    {
      id: SALON_WS_ID,
      slug: "tasama-bpo-phase1",
      engagementId: TASAMA_ENG_ID,
      accountId: "acc_tasama",
      displayName: "Tasama × AICo — Agentic BPO",
      eyebrowText: "Tasama Agentic BPO · Phase 1",
      accentColor: "#0F4C5C",
      defaultLocale: "en",
      watermarkEnabled: true,
      rtlEnabled: false,
      downloadsAllowedDefault: false,
    },
  ]);
  const SALON_USERS = [
    { id: "su_tasama_admin",   email: "coo@tasama.example",         name: "Faisal Al-Otaibi", initials: "FA", title: "Chief Operating Officer", role: "admin",    canApprove: true },
    { id: "su_tasama_approver",email: "ops.director@tasama.example",name: "Reem Al-Harbi",    initials: "RA", title: "Operations Director",     role: "approver", canApprove: true },
    { id: "su_tasama_viewer",  email: "service.lead@tasama.example",name: "Khaled Al-Mutairi",initials: "KA", title: "Service Lead — Intake",   role: "viewer",   canApprove: false },
  ];
  await db.insert(atelierSalonUsers).values(
    SALON_USERS.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      initials: u.initials,
      title: u.title,
      accountId: "acc_tasama",
      locale: "en",
      status: "active" as const,
    })),
  );
  await db.insert(atelierSalonUserEngagementAccess).values(
    SALON_USERS.map((u) => ({
      id: `sa_${u.id}_${SALON_WS_ID}`,
      workspaceId: SALON_WS_ID,
      engagementId: TASAMA_ENG_ID,
      salonUserId: u.id,
      role: u.role,
      canApprove: u.canApprove,
      downloadsAllowed: u.role === "admin",
    })),
  );

  console.log("[seed-atelier] salon publishes (3 of 4 deliverables; residency brief blocked by Sentinel)…");
  await db
    .update(atelierDeliverables)
    .set({ clientVisibility: "published" })
    .where(sql`id in ('del_tasama_pov_v2','del_tasama_servicepack_v2','del_tasama_value_readout')`);
  await db.insert(atelierDeliverablePublishes).values([
    {
      id: "pub_tasama_pov_v2_1",
      deliverableId: "del_tasama_pov_v2",
      deliverableVersionId: "delv_tasama_pov_v2_v2",
      engagementId: TASAMA_ENG_ID,
      workspaceId: SALON_WS_ID,
      publishedByAtelierUserId: "p_layla_haddad",
      publishedByName: "Layla Haddad",
      publishedAt: HOURS_AGO(20),
      sentinelStatus: "pass",
      sentinelChecks: [{ name: "pii_scan", status: "pass" as const, detail: "No PII detected." }],
      publishAllowed: true,
      downloadsAllowed: false,
      watermarkRequired: true,
    },
    {
      id: "pub_tasama_servicepack_1",
      deliverableId: "del_tasama_servicepack_v2",
      deliverableVersionId: "delv_tasama_servicepack_v1",
      engagementId: TASAMA_ENG_ID,
      workspaceId: SALON_WS_ID,
      publishedByAtelierUserId: "p_layla_haddad",
      publishedByName: "Layla Haddad",
      publishedAt: HOURS_AGO(40),
      sentinelStatus: "warn",
      sentinelChecks: [{ name: "internal_only_marker", status: "warn" as const, detail: "Watermark required; no PII detected." }],
      publishAllowed: true,
      downloadsAllowed: false,
      watermarkRequired: true,
    },
    {
      id: "pub_tasama_value_readout_1",
      deliverableId: "del_tasama_value_readout",
      deliverableVersionId: "delv_tasama_value_readout_v1",
      engagementId: TASAMA_ENG_ID,
      workspaceId: SALON_WS_ID,
      publishedByAtelierUserId: "p_mounir_ariss",
      publishedByName: "Mounir Ariss",
      publishedAt: DAYS_AGO(2),
      sentinelStatus: "pass",
      sentinelChecks: [{ name: "pii_scan", status: "pass" as const, detail: "Clean." }],
      publishAllowed: true,
      downloadsAllowed: true,
      watermarkRequired: true,
    },
  ]);
  await db.execute(sql`update atelier_deliverables set latest_publish_id = 'pub_tasama_pov_v2_1' where id = 'del_tasama_pov_v2'`);
  await db.execute(sql`update atelier_deliverables set latest_publish_id = 'pub_tasama_servicepack_1' where id = 'del_tasama_servicepack_v2'`);
  await db.execute(sql`update atelier_deliverables set latest_publish_id = 'pub_tasama_value_readout_1' where id = 'del_tasama_value_readout'`);

  console.log("[seed-atelier] salon decisions + requests…");
  const NAME_OF: Record<string, string> = {
    su_tasama_admin: "Faisal Al-Otaibi",
    su_tasama_approver: "Reem Al-Harbi",
    su_tasama_viewer: "Khaled Al-Mutairi",
  };
  await db.insert(atelierSalonDecisions).values([
    { id: "sd_1", workspaceId: SALON_WS_ID, engagementId: TASAMA_ENG_ID, deliverableId: "del_tasama_pov_v2",        kind: "approve",        headline: "POV pyramid v2 approved",                        rationale: "Aligned with phase-1 value targets.",                       decidedBySalonUserId: "su_tasama_admin",    decidedByName: NAME_OF.su_tasama_admin,    decidedAt: HOURS_AGO(18) },
    { id: "sd_2", workspaceId: SALON_WS_ID, engagementId: TASAMA_ENG_ID, deliverableId: "del_tasama_pov_v2",        kind: "comment",        headline: "Add Arabic captions to value chart",             rationale: "Steering audience prefers bilingual readouts.",             decidedBySalonUserId: "su_tasama_approver", decidedByName: NAME_OF.su_tasama_approver, decidedAt: HOURS_AGO(17) },
    { id: "sd_3", workspaceId: SALON_WS_ID, engagementId: TASAMA_ENG_ID, deliverableId: "del_tasama_servicepack_v2",kind: "request_change", headline: "Re-cut adoption tail for service-3",             rationale: "Need a 30-day projection, not a snapshot.",                  decidedBySalonUserId: "su_tasama_admin",    decidedByName: NAME_OF.su_tasama_admin,    decidedAt: HOURS_AGO(36) },
    { id: "sd_4", workspaceId: SALON_WS_ID, engagementId: TASAMA_ENG_ID, deliverableId: "del_tasama_value_readout",  kind: "approve",        headline: "30-day value readout approved",                  rationale: "Numbers reconcile with our internal MIS.",                   decidedBySalonUserId: "su_tasama_admin",    decidedByName: NAME_OF.su_tasama_admin,    decidedAt: DAYS_AGO(2) },
    { id: "sd_5", workspaceId: SALON_WS_ID, engagementId: TASAMA_ENG_ID, deliverableId: null,                        kind: "comment",        headline: "Add a quarterly cadence for steering",           rationale: "Weekly is the right rhythm for ops, monthly for steering.",  decidedBySalonUserId: "su_tasama_approver", decidedByName: NAME_OF.su_tasama_approver, decidedAt: DAYS_AGO(3) },
    { id: "sd_6", workspaceId: SALON_WS_ID, engagementId: TASAMA_ENG_ID, deliverableId: null,                        kind: "approve",        headline: "Phase-1 charter ratified",                        rationale: "All workstream leads confirmed.",                            decidedBySalonUserId: "su_tasama_admin",    decidedByName: NAME_OF.su_tasama_admin,    decidedAt: DAYS_AGO(45) },
  ]);
  await db.insert(atelierSalonRequests).values([
    { id: "sr_1", workspaceId: SALON_WS_ID, engagementId: TASAMA_ENG_ID, kind: "copy_request", title: "Copy of POV v2 for COO offline review",   detail: "Need a watermarked PDF I can share inside Tasama.",         status: "open",       raisedBySalonUserId: "su_tasama_admin",    raisedByName: NAME_OF.su_tasama_admin,    raisedAt: HOURS_AGO(5) },
    { id: "sr_2", workspaceId: SALON_WS_ID, engagementId: TASAMA_ENG_ID, kind: "meeting",      title: "Workshop on residency & identity controls",detail: "Block 90 minutes with Layla and Omar in the next two weeks.",status: "in_progress",raisedBySalonUserId: "su_tasama_approver", raisedByName: NAME_OF.su_tasama_approver, raisedAt: DAYS_AGO(1) },
  ]);

  // ============================================================
  // Task #254 — v3 Roster: employees, contractors, partner-firm resources.
  // ============================================================
  console.log("[seed-atelier] v3 roster: employees…");
  // Backfill the 5 v1/v2 personas as employees with sensible defaults.
  // Comp/banking fields are populated so Partner/Operations personas have
  // realistic data to view; non-Partner personas see them stripped.
  const EMPLOYEES = [
    {
      id: "emp_p_mounir_ariss",
      userId: "p_mounir_ariss",
      fullName: "Mounir Ariss",
      email: "mounir@aico.example",
      role: "partner",
      seniority: "founding_partner",
      title: "Founding Partner",
      country: "AE",
      employmentType: "FTE",
      homeOffice: "Dubai",
      payrollCountry: "AE",
      employeeIdExternal: "AICO-0001",
      iban: "AE070331234567890123456",
      swift: "EBILAEAD",
      noticePeriodDays: 90,
      startDate: "2023-01-15",
      status: "active",
    },
    {
      id: "emp_p_layla_haddad",
      userId: "p_layla_haddad",
      fullName: "Layla Haddad",
      email: "layla@aico.example",
      role: "engagement_lead",
      seniority: "principal",
      title: "Engagement Lead",
      country: "SA",
      employmentType: "FTE",
      homeOffice: "Riyadh",
      payrollCountry: "SA",
      employeeIdExternal: "AICO-0002",
      iban: "SA0380000000608010167519",
      swift: "RJHISARI",
      noticePeriodDays: 60,
      startDate: "2023-04-01",
      status: "active",
    },
    {
      id: "emp_p_omar_najjar",
      userId: "p_omar_najjar",
      fullName: "Omar Najjar",
      email: "omar@aico.example",
      role: "sme",
      seniority: "senior_consultant",
      title: "Subject-Matter Expert — Operations",
      country: "AE",
      employmentType: "FTE",
      homeOffice: "Dubai",
      payrollCountry: "AE",
      employeeIdExternal: "AICO-0003",
      iban: "AE070331234567890999111",
      swift: "EBILAEAD",
      noticePeriodDays: 30,
      startDate: "2024-02-12",
      status: "active",
    },
    {
      id: "emp_p_sara_qureshi",
      userId: "p_sara_qureshi",
      fullName: "Sara Qureshi",
      email: "sara@aico.example",
      role: "ai_engineer",
      seniority: "consultant",
      title: "AI Engineer",
      country: "AE",
      employmentType: "FTE",
      homeOffice: "Dubai",
      payrollCountry: "AE",
      employeeIdExternal: "AICO-0004",
      iban: "AE070331234567899911234",
      swift: "EBILAEAD",
      noticePeriodDays: 30,
      startDate: "2024-08-19",
      status: "active",
    },
    {
      id: "emp_p_youssef_idrissi",
      userId: "p_youssef_idrissi",
      fullName: "Youssef Idrissi",
      email: "youssef@aico.example",
      role: "business_developer",
      seniority: "associate",
      title: "Business Developer",
      country: "SA",
      employmentType: "FTE",
      homeOffice: "Riyadh",
      payrollCountry: "SA",
      employeeIdExternal: "AICO-0005",
      iban: "SA0380000000608010189999",
      swift: "RJHISARI",
      noticePeriodDays: 30,
      startDate: "2025-01-06",
      status: "active",
    },
  ];
  // Only insert employees whose userId actually exists in atelier_users.
  const existingUserIds = new Set(
    (await db.select({ id: atelierUsers.id }).from(atelierUsers)).map(
      (u) => u.id,
    ),
  );
  const employeesToInsert = EMPLOYEES.filter((e) =>
    existingUserIds.has(e.userId),
  );
  if (employeesToInsert.length > 0) {
    // Migration 0014 also backfills 'emp_' || user.id rows from atelier_users;
    // those collide on PK with our richer seeded rows. Skip silently so the
    // seed remains re-runnable.
    await db
      .insert(atelierEmployees)
      .values(employeesToInsert)
      .onConflictDoNothing();
  }

  console.log("[seed-atelier] v3 roster: contractors…");
  const CONTRACTORS = [
    {
      id: "ct_hadeel_aljarrah",
      fullName: "Hadeel Al-Jarrah",
      email: "hadeel.contract@aico.example",
      vendorEntity: "Al-Jarrah Consulting LLC",
      country: "SA",
      dayRateAmount: 12500_00, // SAR cents
      dayRateCurrency: "SAR",
      startDate: "2025-09-01",
      endDate: "2026-02-28",
      status: "active",
      notes:
        "Six-month contractor on Tasama phase-1 — operations design support.",
    },
    {
      id: "ct_rami_haddad",
      fullName: "Rami Haddad",
      email: "rami.contract@aico.example",
      vendorEntity: "Levant Digital FZ-LLC",
      country: "AE",
      dayRateAmount: 9800_00, // AED cents
      dayRateCurrency: "AED",
      startDate: "2025-11-15",
      endDate: "2026-05-15",
      status: "active",
      notes:
        "Frontend contractor on Aldrees workshop tooling.",
    },
  ];
  await db.insert(atelierContractors).values(CONTRACTORS).onConflictDoNothing();

  console.log("[seed-atelier] v3 roster: partner firms…");
  const PARTNER_FIRMS = [
    {
      id: "pf_bgts",
      name: "BGTS",
      country: "SA",
      status: "active",
      notes: "Saudi delivery partner — agentic operations.",
    },
    {
      id: "pf_thoughtworks",
      name: "Thoughtworks",
      country: "AE",
      status: "active",
      notes: "Global engineering partner — embedded squads.",
    },
    {
      id: "pf_mobven",
      name: "Mobven",
      country: "TR",
      status: "active",
      notes: "Turkish mobile-first partner — front-of-house apps.",
    },
  ];
  await db.insert(atelierPartnerFirms).values(PARTNER_FIRMS).onConflictDoNothing();

  console.log("[seed-atelier] v3 roster: partner-firm resources…");
  const PARTNER_RESOURCES = [
    {
      id: "pfr_bgts_yara",
      partnerFirmId: "pf_bgts",
      fullName: "Yara Al-Suwaidi",
      email: "yara.suwaidi@bgts.example",
      role: "Senior Consultant",
      seniority: "senior_consultant",
      country: "SA",
      dayRateAmount: 15000_00,
      dayRateCurrency: "SAR",
      startDate: "2025-09-01",
      endDate: "2026-08-31",
      status: "active",
      secondedToEngagementIds: ["eng_tasama_bpo_phase1"],
      // Link to the atelier_users persona for this partner-firm PM so
      // resolvePartnerFirmScope() in ledgerRoutes can attach object-level
      // ACL (own firm + own seconded engagements) to /ledger/partner-firm-hours.
      partnerFirmPmUserId: "u_yara_bgts",
    },
    {
      id: "pfr_bgts_khalid",
      partnerFirmId: "pf_bgts",
      fullName: "Khalid Al-Otaibi",
      email: "khalid.otaibi@bgts.example",
      role: "Solution Architect",
      seniority: "principal",
      country: "SA",
      dayRateAmount: 18500_00,
      dayRateCurrency: "SAR",
      startDate: "2025-10-15",
      endDate: "2026-04-15",
      status: "active",
      secondedToEngagementIds: ["eng_tasama_bpo_phase1"],
    },
    {
      id: "pfr_tw_priya",
      partnerFirmId: "pf_thoughtworks",
      fullName: "Priya Iyer",
      email: "priya.iyer@thoughtworks.example",
      role: "Lead Engineer",
      seniority: "principal",
      country: "AE",
      dayRateAmount: 14800_00,
      dayRateCurrency: "AED",
      startDate: "2025-11-01",
      endDate: "2026-10-31",
      status: "active",
      secondedToEngagementIds: ["eng_tasama_bpo_phase1"],
    },
    {
      id: "pfr_mobven_can",
      partnerFirmId: "pf_mobven",
      fullName: "Can Demir",
      email: "can.demir@mobven.example",
      role: "Mobile Engineer",
      seniority: "consultant",
      country: "TR",
      dayRateAmount: 6800_00,
      dayRateCurrency: "EUR",
      startDate: "2026-01-15",
      endDate: "2026-12-31",
      status: "active",
      secondedToEngagementIds: ["eng_tasama_bpo_phase1"],
    },
  ];
  await db.insert(atelierPartnerFirmResources).values(PARTNER_RESOURCES).onConflictDoNothing();

  // Task #254 — Provision a partner-firm USER persona + scoped engagement-access
  // grant. Required so the cross-realm test ("partner-firm staff in seed only
  // see assigned engagement routes") has a concrete subject.
  console.log("[seed-atelier] v3 roster: partner-firm persona + scoped grant…");
  await db
    .insert(atelierUsers)
    .values({
      id: "u_yara_bgts",
      orgId: "aico",
      name: "Yara Al-Suwaidi",
      initials: "YA",
      email: "yara.suwaidi@bgts.example",
      role: "partner_firm_resource",
      roleLabel: "Senior Consultant — BGTS",
      title: "Senior Consultant — BGTS",
    })
    .onConflictDoNothing();
  await db
    .insert(atelierEngagementAccess)
    .values({
      id: "ea_yara_tasama",
      engagementId: "eng_tasama_bpo_phase1",
      userId: "u_yara_bgts",
      roleOnEngagement: "partner_resource",
      allocationPct: 60,
      scope: ["can_view_engagement", "can_view_artifacts"],
      status: "active",
      grantedByUserId: "p_mounir_ariss",
      grantedAt: new Date(),
    })
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 lifecycle (Task #255): agents…");
  await db
    .insert(atelierAgents)
    .values([
      {
        id: "ag_onboarding_concierge",
        name: "Onboarding Concierge",
        group: "Operations",
        stage: "Govern",
        purpose:
          "Generates onboarding sequences from invitations. Holds the sequence open while any compliance gate (NDA, payroll, MSA) is blocked.",
        model: "claude-sonnet-4-6",
        starred: false,
        status: "mvp",
        tools: ["roster.invite", "roster.onboarding.advance", "audit.write"],
        guardrails: [
          "Only Partner / Operations can initiate invitations",
          "Compliance-gate steps cannot be skipped — only blocked or done",
          "Sequence cannot complete while any compliance step is blocked",
        ],
        humanCheckpoints: ["Operations marks each step done"],
        runsLast30d: 0,
      },
      {
        id: "ag_offboarding_sentinel",
        name: "Offboarding Sentinel",
        group: "Operations",
        stage: "Govern",
        purpose:
          "Generates 11-step offboarding sequences. Blocks completion until reassignments are clear (no remaining engagement_access grants), then collects the Partner-signed audit pack.",
        model: "claude-sonnet-4-6",
        starred: false,
        status: "mvp",
        tools: ["roster.offboarding.advance", "roster.offboarding.finalize", "audit.write"],
        guardrails: [
          "Reassignment-gate step blocks until all active grants on the person are revoked",
          "Audit-pack signing is Partner-only",
          "On finalize, person status flips to `former` and remaining grants are revoked",
        ],
        humanCheckpoints: ["Partner signs the audit pack"],
        runsLast30d: 0,
      },
      {
        id: "ag_roster_steward",
        name: "Roster Steward",
        group: "Operations",
        stage: "Govern",
        purpose:
          "Daily compliance scan. Emits Pane A items for visa, Iqama, GOSI, WPS, and master-agreement expirations at 30/60/90 day windows.",
        model: "claude-sonnet-4-6",
        starred: false,
        status: "mvp",
        tools: ["roster.compliance.scan", "pane.a.emit"],
        guardrails: [
          "Reference numbers are read in redacted form only — raw values never leave the database",
          "Pane A item ids are deterministic per (record, bucket, user) — no duplicates",
        ],
        humanCheckpoints: [],
        runsLast30d: 0,
      },
    ])
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 lifecycle: in-flight Principal onboarding…");
  // New Principal joining in 14 days. Materialised + sequence in flight.
  await db
    .insert(atelierEmployees)
    .values({
      id: "emp_p_amal_haddad",
      fullName: "Amal Haddad",
      email: "amal.candidate@aico.example",
      role: "engagement_lead",
      seniority: "principal",
      title: "Principal — Engagement Lead",
      country: "AE",
      employmentType: "FTE",
      homeOffice: "Dubai",
      payrollCountry: "AE",
      employeeIdExternal: "AICO-0011",
      noticePeriodDays: 60,
      startDate: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
      status: "onboarding",
    })
    .onConflictDoNothing();
  const onbId = "onb_amal_haddad_seed";
  await db
    .insert(atelierOnboardings)
    .values({
      id: onbId,
      personType: "employee",
      personId: "emp_p_amal_haddad",
      targetStartDate: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
      status: "in_flight",
      ownerUserId: "p_mounir_ariss",
    })
    .onConflictDoNothing();
  // Generate the 11 employee onboarding steps inline so we don't depend on
  // route handlers being live during seed.
  const onbSteps: {
    code: string;
    title: string;
    ownerRole: string;
    days: number;
    isComplianceGate: boolean;
    status: "pending" | "in_progress" | "done";
  }[] = [
    { code: "nda.signed", title: "NDA signed", ownerRole: "operations", days: 0, isComplianceGate: true, status: "done" },
    { code: "contract.signed", title: "Employment contract signed", ownerRole: "partner", days: 0, isComplianceGate: true, status: "done" },
    { code: "payroll.registered", title: "Payroll registered (GOSI / WPS)", ownerRole: "operations", days: 1, isComplianceGate: true, status: "in_progress" },
    { code: "sso.provisioned", title: "SSO + email provisioned", ownerRole: "operations", days: 2, isComplianceGate: false, status: "pending" },
    { code: "slack.invited", title: "Invited to Slack workspaces", ownerRole: "operations", days: 2, isComplianceGate: false, status: "pending" },
    { code: "calendar.welcome", title: "Welcome calendar block", ownerRole: "operations", days: 3, isComplianceGate: false, status: "pending" },
    { code: "equipment.shipped", title: "Equipment shipped", ownerRole: "operations", days: 3, isComplianceGate: false, status: "pending" },
    { code: "benefits.enrolled", title: "Benefits enrollment", ownerRole: "operations", days: 5, isComplianceGate: false, status: "pending" },
    { code: "security.training", title: "Security & data-handling training", ownerRole: "operations", days: 7, isComplianceGate: false, status: "pending" },
    { code: "manager.intro", title: "Manager intro session", ownerRole: "engagement_lead", days: 7, isComplianceGate: false, status: "pending" },
    { code: "atelier.tour", title: "The Atelier walkthrough", ownerRole: "engagement_lead", days: 7, isComplianceGate: false, status: "pending" },
  ];
  await db
    .insert(atelierOnboardingSteps)
    .values(
      onbSteps.map((s, i) => ({
        id: `onbs_amal_${s.code.replace(/\./g, "_")}`,
        onboardingId: onbId,
        sortKey: i,
        code: s.code,
        title: s.title,
        ownerRole: s.ownerRole,
        deadline: new Date(Date.now() + s.days * 86400_000).toISOString().slice(0, 10),
        status: s.status,
        isComplianceGate: s.isComplianceGate,
      })),
    )
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 lifecycle: in-flight contractor offboarding (Hadeel)…");
  const offId = "off_hadeel_seed";
  await db
    .insert(atelierOffboardings)
    .values({
      id: offId,
      personType: "contractor",
      personId: "ct_hadeel_aljarrah",
      initiatedByUserId: "p_mounir_ariss",
      lastWorkingDate: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
      reason: "Engagement scope wrap — contract end of period",
      status: "in_flight",
    })
    .onConflictDoNothing();
  const offSteps: {
    code: string;
    title: string;
    ownerRole: string;
    days: number;
    isReassignmentGate: boolean;
    status: "pending" | "in_progress" | "done";
  }[] = [
    { code: "intent.recorded", title: "Intent to roll off recorded", ownerRole: "operations", days: 0, isReassignmentGate: false, status: "done" },
    { code: "reassignments.identified", title: "Engagement reassignments identified", ownerRole: "engagement_lead", days: 1, isReassignmentGate: true, status: "in_progress" },
    { code: "knowledge.transfer", title: "Knowledge transfer sessions", ownerRole: "engagement_lead", days: 3, isReassignmentGate: false, status: "pending" },
    { code: "client.notify", title: "Clients notified", ownerRole: "partner", days: 4, isReassignmentGate: false, status: "pending" },
    { code: "sso.revoked", title: "SSO revoked", ownerRole: "operations", days: 5, isReassignmentGate: false, status: "pending" },
    { code: "email.disabled", title: "Email disabled", ownerRole: "operations", days: 5, isReassignmentGate: false, status: "pending" },
    { code: "slack.disabled", title: "Slack disabled", ownerRole: "operations", days: 5, isReassignmentGate: false, status: "pending" },
    { code: "salon.rename", title: "Salon team-member entries renamed", ownerRole: "operations", days: 5, isReassignmentGate: false, status: "pending" },
    { code: "ip.assignment.signed", title: "IP assignment + return of property", ownerRole: "operations", days: 5, isReassignmentGate: false, status: "pending" },
    { code: "final.payment", title: "Final invoice paid", ownerRole: "operations", days: 14, isReassignmentGate: false, status: "pending" },
    { code: "audit.pack.signed", title: "Partner-signed audit pack issued", ownerRole: "partner", days: 14, isReassignmentGate: false, status: "pending" },
  ];
  await db
    .insert(atelierOffboardingSteps)
    .values(
      offSteps.map((s, i) => ({
        id: `offs_hadeel_${s.code.replace(/\./g, "_")}`,
        offboardingId: offId,
        sortKey: i,
        code: s.code,
        title: s.title,
        ownerRole: s.ownerRole,
        deadline: new Date(Date.now() + s.days * 86400_000).toISOString().slice(0, 10),
        status: s.status,
        isReassignmentGate: s.isReassignmentGate,
      })),
    )
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 lifecycle: planted Conflict-of-Interest (Rami → Tasama)…");
  await db
    .insert(atelierConflictDisclosures)
    .values({
      id: "conf_rami_tasama_seed",
      personType: "contractor",
      personId: "ct_rami_haddad",
      disclosureText:
        "Sibling is a Director of Operations at Tasama. Self-recused from any Tasama-touching engagement-access until cleared by the Partner.",
      declaredParty: "Tasama",
      nature: "family",
      scopeImpact: "no engagement_access on any Tasama-account engagement",
      status: "active",
      createdByUserId: "p_mounir_ariss",
    })
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 lifecycle: compliance records…");
  // Iqama expiring in 25 days (will land in the 30d Steward bucket).
  await db
    .insert(atelierComplianceRecords)
    .values([
      {
        id: "cmp_layla_iqama_seed",
        personType: "employee",
        personId: "emp_p_layla_haddad",
        kind: "iqama",
        jurisdiction: "KSA",
        // Redacted-only — raw number never persisted.
        referenceNumberRedacted: "••••4471",
        referenceNumberLastFour: "4471",
        issuedDate: "2024-06-01",
        expiryDate: new Date(Date.now() + 25 * 86400_000).toISOString().slice(0, 10),
        status: "active",
        metadata: { sponsorEntity: "AICo KSA" },
        createdByUserId: "p_mounir_ariss",
      },
      {
        id: "cmp_aico_difc_seed",
        personType: null,
        personId: null,
        kind: "difc",
        jurisdiction: "UAE_DIFC",
        referenceNumberRedacted: "••••2018",
        referenceNumberLastFour: "2018",
        issuedDate: "2023-01-15",
        expiryDate: new Date(Date.now() + 70 * 86400_000).toISOString().slice(0, 10),
        status: "active",
        metadata: { sponsorEntity: "AICo Holdings DIFC" },
        createdByUserId: "p_mounir_ariss",
      },
      {
        id: "cmp_bgts_saudization_seed",
        personType: null,
        personId: null,
        partnerFirmId: "pf_bgts",
        kind: "saudization",
        jurisdiction: "KSA",
        status: "active",
        metadata: { saudizationQuotaRequired: 30, saudizationQuotaActual: 34 },
        createdByUserId: "p_mounir_ariss",
      },
    ])
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 roster: a placeholder document on Mounir…");
  await db.insert(atelierPersonDocuments).values([
    {
      id: "doc_mounir_nda_2025",
      personType: "employee",
      personId: "emp_p_mounir_ariss",
      kind: "nda",
      title: "Founder NDA — 2025",
      fileUrl: null,
      uploadedByUserId: "p_mounir_ariss",
    },
  ]).onConflictDoNothing();

  // ============================================================
  // v3 Skill graph (Task #256) — taxonomy + per-person skills.
  // Hard rule: NEVER seed rows for partner_firm_resource workers.
  // ============================================================
  console.log("[seed-atelier] v3 skill graph (Task #256): agent registry…");
  await db
    .insert(atelierAgents)
    .values({
      id: "ag_skill_mapper",
      name: "Skill Mapper",
      group: "Roster",
      stage: "Govern",
      purpose:
        "On-demand: scans engagements, deliverable versions, and Atelier asset authorship/promotion to propose agent_inferred skill rows on employees. Never auto-verifies; never proposes for partner-firm resources.",
      model: "claude-sonnet-4-6",
      starred: false,
      status: "mvp",
      tools: [
        "skill_graph.scan",
        "skill_graph.propose",
        "audit.write",
      ],
      guardrails: [
        "Hard exclusion: partner_firm_resource workers never receive proposals",
        "Skips rows that are blocked by stronger human sources or prior dismissals",
        "Confidence is capped at 0.85 — verification stays a human decision",
      ],
      humanCheckpoints: [
        "Engagement Lead / Operations / Partner verifies or dismisses each proposed row",
      ],
      runsLast30d: 0,
    })
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 skill graph: taxonomy…");
  const SKILLS: Array<{
    id: string;
    slug: string;
    name: string;
    kind: string;
    description: string;
  }> = [
    { id: "sk_databricks", slug: "databricks", name: "Databricks", kind: "tech", description: "Lakehouse platform, Delta, Unity Catalog" },
    { id: "sk_snowflake", slug: "snowflake", name: "Snowflake", kind: "tech", description: "Cloud data warehouse" },
    { id: "sk_langgraph", slug: "langgraph", name: "LangGraph", kind: "tech", description: "Agent orchestration framework" },
    { id: "sk_python", slug: "python", name: "Python", kind: "tech", description: "Programming language for data and ML" },
    { id: "sk_typescript", slug: "typescript", name: "TypeScript", kind: "tech", description: "Typed JavaScript" },
    { id: "sk_dbt", slug: "dbt", name: "dbt", kind: "tool", description: "Data build tool" },
    { id: "sk_replit", slug: "replit", name: "Replit", kind: "tool", description: "Cloud development environment" },
    { id: "sk_figma", slug: "figma", name: "Figma", kind: "tool", description: "Collaborative design" },
    { id: "sk_powerbi", slug: "powerbi", name: "Power BI", kind: "tool", description: "Microsoft BI" },
    { id: "sk_pricing_strategy", slug: "pricing_strategy", name: "Pricing strategy", kind: "function", description: "B2B and consumer pricing" },
    { id: "sk_forecasting", slug: "forecasting", name: "Forecasting", kind: "function", description: "Demand and revenue forecasting" },
    { id: "sk_change_management", slug: "change_management", name: "Change management", kind: "function", description: "Operating-model and adoption" },
    { id: "sk_ksa_public_sector", slug: "ksa_public_sector", name: "KSA public sector", kind: "industry", description: "Saudi Arabia government and PIF entities" },
    { id: "sk_gcc_banking", slug: "gcc_banking", name: "GCC banking", kind: "industry", description: "Retail and corporate banking across the GCC" },
    { id: "sk_telco", slug: "telco", name: "Telco", kind: "industry", description: "Mobile and broadband operators" },
    { id: "sk_arabic", slug: "arabic", name: "Arabic", kind: "language", description: "Modern Standard Arabic" },
    { id: "sk_english", slug: "english", name: "English", kind: "language", description: "" },
    { id: "sk_french", slug: "french", name: "French", kind: "language", description: "" },
  ];
  await db
    .insert(atelierSkills)
    .values(
      SKILLS.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        kind: s.kind,
        description: s.description,
        createdByUserId: "p_mounir_ariss",
      })),
    )
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 skill graph: person_skills…");
  // Mix of sources spanning all kinds. Five FTE employees only — no
  // contractors, no partner-firm resources. The Skill Mapper run will
  // additionally produce agent_inferred rows from the seeded
  // engagements/deliverables/assets.
  const PSK: Array<{
    person: string;
    skill: string;
    proficiency: number;
    source: "self" | "partner_attested" | "evidence_atelier" | "certification";
    summary?: string;
    confidence?: number | null;
  }> = [
    // Mounir — Founder/Partner
    { person: "emp_p_mounir_ariss", skill: "sk_pricing_strategy", proficiency: 5, source: "partner_attested", summary: "Founder; long career in pricing" },
    { person: "emp_p_mounir_ariss", skill: "sk_ksa_public_sector", proficiency: 4, source: "evidence_atelier", summary: "Owner on PIF / Aramco engagements" },
    { person: "emp_p_mounir_ariss", skill: "sk_arabic", proficiency: 5, source: "self" },
    { person: "emp_p_mounir_ariss", skill: "sk_french", proficiency: 5, source: "self" },
    { person: "emp_p_mounir_ariss", skill: "sk_change_management", proficiency: 4, source: "partner_attested" },
    { person: "emp_p_mounir_ariss", skill: "sk_english", proficiency: 5, source: "self" },
    // Layla — Operations Lead
    { person: "emp_p_layla_haddad", skill: "sk_change_management", proficiency: 5, source: "certification", summary: "Prosci certified" },
    { person: "emp_p_layla_haddad", skill: "sk_gcc_banking", proficiency: 4, source: "evidence_atelier" },
    { person: "emp_p_layla_haddad", skill: "sk_powerbi", proficiency: 3, source: "self" },
    { person: "emp_p_layla_haddad", skill: "sk_figma", proficiency: 3, source: "self" },
    { person: "emp_p_layla_haddad", skill: "sk_arabic", proficiency: 5, source: "self" },
    { person: "emp_p_layla_haddad", skill: "sk_english", proficiency: 5, source: "self" },
    // Omar — Engagement Lead (Pricing)
    { person: "emp_p_omar_najjar", skill: "sk_pricing_strategy", proficiency: 5, source: "evidence_atelier", summary: "Lead on Arçelik pricing engagement" },
    { person: "emp_p_omar_najjar", skill: "sk_databricks", proficiency: 4, source: "certification", summary: "Databricks Certified Data Engineer Pro" },
    { person: "emp_p_omar_najjar", skill: "sk_langgraph", proficiency: 4, source: "self", summary: "Built LangGraph workflows for in-house agents" },
    { person: "emp_p_omar_najjar", skill: "sk_python", proficiency: 4, source: "self" },
    { person: "emp_p_omar_najjar", skill: "sk_telco", proficiency: 3, source: "evidence_atelier" },
    { person: "emp_p_omar_najjar", skill: "sk_arabic", proficiency: 4, source: "self" },
    { person: "emp_p_omar_najjar", skill: "sk_english", proficiency: 5, source: "self" },
    // Sara — Senior Consultant (Forecast/Analytics)
    { person: "emp_p_sara_qureshi", skill: "sk_forecasting", proficiency: 5, source: "evidence_atelier", summary: "Authored forecast deliverables" },
    { person: "emp_p_sara_qureshi", skill: "sk_python", proficiency: 5, source: "self" },
    { person: "emp_p_sara_qureshi", skill: "sk_dbt", proficiency: 4, source: "certification", summary: "dbt Analytics Engineering certified" },
    { person: "emp_p_sara_qureshi", skill: "sk_snowflake", proficiency: 4, source: "self" },
    { person: "emp_p_sara_qureshi", skill: "sk_replit", proficiency: 3, source: "self", summary: "Prototyping notebooks and Streamlit apps on Replit" },
    { person: "emp_p_sara_qureshi", skill: "sk_powerbi", proficiency: 3, source: "evidence_atelier" },
    { person: "emp_p_sara_qureshi", skill: "sk_english", proficiency: 5, source: "self" },
    // Youssef — Business Developer
    { person: "emp_p_youssef_idrissi", skill: "sk_gcc_banking", proficiency: 4, source: "partner_attested" },
    { person: "emp_p_youssef_idrissi", skill: "sk_telco", proficiency: 3, source: "self" },
    { person: "emp_p_youssef_idrissi", skill: "sk_typescript", proficiency: 3, source: "self" },
    { person: "emp_p_youssef_idrissi", skill: "sk_figma", proficiency: 3, source: "self" },
    { person: "emp_p_youssef_idrissi", skill: "sk_arabic", proficiency: 4, source: "self" },
    { person: "emp_p_youssef_idrissi", skill: "sk_english", proficiency: 5, source: "self" },
    { person: "emp_p_youssef_idrissi", skill: "sk_french", proficiency: 4, source: "self" },
  ];
  const now = new Date();
  await db
    .insert(atelierPersonSkills)
    .values(
      PSK.map((p) => ({
        id: `psk_seed_${p.person}_${p.skill}_${p.source}`,
        personType: "employee",
        personId: p.person,
        skillId: p.skill,
        proficiency: p.proficiency,
        source: p.source,
        evidenceArtifactIds: [],
        evidenceSummary: p.summary ?? null,
        confidence: null,
        status: "active",
        verifiedByUserId:
          p.source === "self" ? null : "p_mounir_ariss",
        verifiedAt: p.source === "self" ? null : now,
        createdByUserId: "p_mounir_ariss",
      })),
    )
    .onConflictDoNothing();

  // ============================================================
  // v3 Ledger (Task #257) — Time Steward agent + calendar events,
  // timesheet weeks across statuses, partner-firm hours.
  // Idempotent via deterministic ids + onConflictDoNothing.
  // ============================================================
  console.log("[seed-atelier] v3 ledger (Task #257): Time Steward agent…");
  await db
    .insert(atelierAgents)
    .values({
      id: "ag_time_steward",
      name: "Time Steward",
      group: "Ledger",
      stage: "Govern",
      purpose:
        "Drafts weekly timesheets from calendar events, meeting attendance, deliverable edits, and Salon decisions. Writes immutable signal rows so approvers can trace every proposed hour back to its evidence. Never auto-submits.",
      model: "claude-haiku-4-5",
      starred: false,
      status: "mvp",
      tools: ["calendar.scan", "meeting.scan", "deliverable.scan", "salon.scan", "audit.write"],
      guardrails: [
        "Never auto-submits — humans always click Submit",
        "Never proposes for partner-firm resources (their hours come via partner-firm CSV)",
        "Caps any single day at 10 drafted hours; routes >14h to suspicious-pattern flag at submit",
      ],
      humanCheckpoints: [
        "Submitter reviews + edits before Submit",
        "Engagement Lead approves",
        "Partner approves",
      ],
      runsLast30d: 0,
    })
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 ledger: calendar events…");
  // Anchor everything to the Monday of the most recent fully-completed ISO
  // week so the seed is stable from day to day. We seed two consecutive
  // weeks: weekA (older) and weekB (current).
  function isoWeekOfDate(d: Date): { weekIso: string; monday: Date } {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const monday = new Date(d);
    const md = monday.getUTCDay() || 7;
    monday.setUTCDate(monday.getUTCDate() - (md - 1));
    monday.setUTCHours(0, 0, 0, 0);
    return { weekIso: `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`, monday };
  }
  const today = new Date();
  const weekB = isoWeekOfDate(today);
  const lastWeekDate = new Date(today);
  lastWeekDate.setUTCDate(lastWeekDate.getUTCDate() - 7);
  const weekA = isoWeekOfDate(lastWeekDate);

  // Seed calendar events + 2 weeks of timesheets for ALL eligible seeded
  // employees so downstream tasks (approvals, partner ledger summary, agent
  // tick coverage) have broad data — not just the four named personas.
  const LEDGER_PEOPLE = employeesToInsert.filter((e) => e.role !== "partner_firm_resource");

  type CalSeed = typeof atelierCalendarEvents.$inferInsert;
  const calRows: CalSeed[] = [];
  for (const emp of LEDGER_PEOPLE) {
    for (const wk of [weekA, weekB]) {
      // 3 calendar events per week per person
      for (let day = 0; day < 5; day += 2) {
        const start = new Date(wk.monday);
        start.setUTCDate(start.getUTCDate() + day);
        start.setUTCHours(10, 0, 0, 0);
        const end = new Date(start);
        end.setUTCHours(11, 0, 0, 0);
        calRows.push({
          id: `cal_seed_${emp.id}_${wk.weekIso}_${day}`,
          personId: emp.id,
          personType: "employee",
          title: `Tasama working session ${wk.weekIso} d${day}`,
          startsAt: start,
          endsAt: end,
          durationMins: 60,
          attendees: [{ name: emp.fullName, email: emp.email }],
          engagementHint: TASAMA_ENG_ID,
          sourceProvider: "synthetic",
        });
      }
    }
  }
  if (calRows.length) await db.insert(atelierCalendarEvents).values(calRows).onConflictDoNothing();

  console.log("[seed-atelier] v3 ledger: timesheet weeks + entries…");
  // Status matrix:
  //   - Mounir (partner) weekA: partner_approved, weekB: draft
  //   - Layla (lead) weekA: lead_approved, weekB: submitted (with 1 flag)
  //   - Omar (sme) weekA: rejected, weekB: draft
  //   - Sara (ai_engineer) weekA: submitted (suspicious >14h day), weekB: draft
  type WkSeed = typeof atelierTimesheetWeeks.$inferInsert;
  type EntrySeed = typeof atelierTimesheetEntries.$inferInsert;
  type SigSeed = typeof atelierTimesheetSignals.$inferInsert;
  const weeks: WkSeed[] = [];
  const entries: EntrySeed[] = [];
  const signals: SigSeed[] = [];
  const seedDate = new Date("2026-01-01T00:00:00Z");

  function pushWeek(opts: {
    person: (typeof LEDGER_PEOPLE)[number];
    wk: { weekIso: string; monday: Date };
    status: string;
    entrySpecs: Array<{ dayOffset: number; eng: string | null; hours: number; billable: boolean; narrative: string }>;
    flags?: string[];
    rejectionReason?: string;
  }) {
    const weekId = `tsw_seed_${opts.person.id}_${opts.wk.weekIso}`;
    const total = opts.entrySpecs.reduce((s, e) => s + e.hours, 0);
    const billable = opts.entrySpecs.filter((e) => e.billable).reduce((s, e) => s + e.hours, 0);
    weeks.push({
      id: weekId,
      personId: opts.person.id,
      personType: "employee",
      weekIso: opts.wk.weekIso,
      weekStartDate: opts.wk.monday.toISOString().slice(0, 10),
      status: opts.status,
      submittedAt: ["submitted", "lead_approved", "partner_approved", "rejected"].includes(opts.status) ? seedDate : null,
      submittedByUserId: ["submitted", "lead_approved", "partner_approved", "rejected"].includes(opts.status) ? opts.person.userId : null,
      leadApprovedAt: ["lead_approved", "partner_approved"].includes(opts.status) ? seedDate : null,
      leadApprovedByUserId: ["lead_approved", "partner_approved"].includes(opts.status) ? "p_layla_haddad" : null,
      partnerApprovedAt: opts.status === "partner_approved" ? seedDate : null,
      partnerApprovedByUserId: opts.status === "partner_approved" ? "p_mounir_ariss" : null,
      rejectedAt: opts.status === "rejected" ? seedDate : null,
      rejectedByUserId: opts.status === "rejected" ? "p_layla_haddad" : null,
      rejectionReason: opts.rejectionReason ?? null,
      totalHours: total,
      billableHours: billable,
      suspiciousFlags: opts.flags ?? [],
    });
    opts.entrySpecs.forEach((spec, i) => {
      const d = new Date(opts.wk.monday);
      d.setUTCDate(d.getUTCDate() + spec.dayOffset);
      const workDate = d.toISOString().slice(0, 10);
      const entryId = `tse_seed_${opts.person.id}_${opts.wk.weekIso}_${i}`;
      const sigId = `tsig_seed_${opts.person.id}_${opts.wk.weekIso}_${i}`;
      // One synthetic signal per agent-drafted entry
      const isAgentDrafted = i === 0;
      if (isAgentDrafted && spec.eng) {
        signals.push({
          id: sigId,
          weekId,
          personId: opts.person.id,
          workDate,
          signalType: "calendar",
          sourceRefType: "calendar_event",
          sourceRefId: `cal_seed_${opts.person.id}_${opts.wk.weekIso}_0`,
          engagementHint: spec.eng,
          evidenceSummary: `Synthetic seed: working session block`,
          weightHours: spec.hours,
        });
      }
      entries.push({
        id: entryId,
        weekId,
        personId: opts.person.id,
        personType: "employee",
        workDate,
        engagementId: spec.eng,
        activityCode: spec.eng ? "billable" : "internal",
        hours: spec.hours,
        billable: spec.billable,
        narrative: spec.narrative,
        source: isAgentDrafted ? "agent_drafted" : "human",
        draftedByAgentId: isAgentDrafted ? "ag_time_steward" : null,
        signalIds: isAgentDrafted && spec.eng ? [sigId] : [],
        status: opts.status === "partner_approved" ? "approved" : opts.status === "rejected" ? "draft" : opts.status === "submitted" || opts.status === "lead_approved" ? "submitted" : "draft",
        createdByUserId: opts.person.userId,
      });
    });
  }

  // Find the named seeded employees if present.
  const findEmp = (id: string) => LEDGER_PEOPLE.find((e) => e.id === id);
  const standardWeek = (eng: string) => [
    { dayOffset: 0, eng, hours: 8, billable: true, narrative: "Working session + standup (auto)" },
    { dayOffset: 1, eng, hours: 8, billable: true, narrative: "Stakeholder review" },
    { dayOffset: 2, eng, hours: 7.5, billable: true, narrative: "Synthesis + writeup" },
    { dayOffset: 3, eng, hours: 8, billable: true, narrative: "Workshop facilitation" },
    { dayOffset: 4, eng: null, hours: 4, billable: false, narrative: "Internal — pursuit support" },
  ];
  const mounir = findEmp("emp_p_mounir_ariss");
  const layla = findEmp("emp_p_layla_haddad");
  const omar = findEmp("emp_p_omar_najjar");
  const sara = findEmp("emp_p_sara_qureshi");

  if (mounir) {
    pushWeek({ person: mounir, wk: weekA, status: "partner_approved", entrySpecs: standardWeek(TASAMA_ENG_ID) });
    pushWeek({ person: mounir, wk: weekB, status: "draft", entrySpecs: standardWeek(TASAMA_ENG_ID).slice(0, 3) });
  }
  if (layla) {
    pushWeek({ person: layla, wk: weekA, status: "lead_approved", entrySpecs: standardWeek(TASAMA_ENG_ID) });
    pushWeek({
      person: layla,
      wk: weekB,
      status: "submitted",
      entrySpecs: standardWeek(TASAMA_ENG_ID),
      flags: ["double_booked:" + weekB.monday.toISOString().slice(0, 10) + ":" + TASAMA_ENG_ID],
    });
  }
  if (omar) {
    pushWeek({
      person: omar,
      wk: weekA,
      status: "rejected",
      entrySpecs: standardWeek(TASAMA_ENG_ID),
      rejectionReason: "Friday hours need a narrative — please redraft.",
    });
    pushWeek({ person: omar, wk: weekB, status: "draft", entrySpecs: standardWeek(TASAMA_ENG_ID).slice(0, 2) });
  }
  if (sara) {
    // Suspicious: 16h on Wed (>14h), fully billable, no meetings.
    pushWeek({
      person: sara,
      wk: weekA,
      status: "submitted",
      entrySpecs: [
        { dayOffset: 0, eng: TASAMA_ENG_ID, hours: 8, billable: true, narrative: "Heads-down build" },
        { dayOffset: 1, eng: TASAMA_ENG_ID, hours: 8, billable: true, narrative: "Heads-down build" },
        { dayOffset: 2, eng: TASAMA_ENG_ID, hours: 16, billable: true, narrative: "All-nighter for demo" },
        { dayOffset: 3, eng: TASAMA_ENG_ID, hours: 8, billable: true, narrative: "Polish + bugfix" },
        { dayOffset: 4, eng: TASAMA_ENG_ID, hours: 6, billable: true, narrative: "Demo support" },
      ],
      flags: [
        `day_overload:${(() => { const d = new Date(weekA.monday); d.setUTCDate(d.getUTCDate() + 2); return d.toISOString().slice(0, 10); })()}:16h`,
        "fully_billable_no_meetings",
      ],
    });
    pushWeek({ person: sara, wk: weekB, status: "draft", entrySpecs: [] });
  }

  // Coverage backfill: for every other LEDGER_PEOPLE row not in the named
  // matrix above, seed two standard weeks (weekA submitted, weekB draft) so
  // approvers + the steward tick have realistic data across the roster.
  const namedIds = new Set(["emp_p_mounir_ariss", "emp_p_layla_haddad", "emp_p_omar_najjar", "emp_p_sara_qureshi"]);
  for (const emp of LEDGER_PEOPLE) {
    if (namedIds.has(emp.id)) continue;
    pushWeek({ person: emp, wk: weekA, status: "submitted", entrySpecs: standardWeek(TASAMA_ENG_ID) });
    pushWeek({ person: emp, wk: weekB, status: "draft", entrySpecs: standardWeek(TASAMA_ENG_ID).slice(0, 3) });
  }

  if (weeks.length) await db.insert(atelierTimesheetWeeks).values(weeks).onConflictDoNothing();
  if (signals.length) await db.insert(atelierTimesheetSignals).values(signals).onConflictDoNothing();
  if (entries.length) await db.insert(atelierTimesheetEntries).values(entries).onConflictDoNothing();

  console.log("[seed-atelier] v3 ledger: partner-firm hours…");
  await db
    .insert(atelierPartnerFirmHours)
    .values([
      {
        id: `pfh_seed_bgts_${weekA.weekIso}`,
        engagementId: TASAMA_ENG_ID,
        partnerFirmId: "pf_bgts",
        partnerFirmResourceId: "pfr_bgts_yara",
        resourceName: "Yara Al-Suwaidi",
        weekIso: weekA.weekIso,
        hours: 38,
        costAmount: 57000,
        costCurrency: "SAR",
        csvUploadRef: "pfh_seed_batch_001",
        uploadedByUserId: "p_mounir_ariss",
        notes: "Seed — week A partner-firm passthrough",
      },
    ])
    .onConflictDoNothing();

  // ============================================================
  // Task #258 — v3 Ledger: utilization targets, Utilization Analyst +
  // Burn Sentinel agents, and computed utilization snapshots.
  // Idempotent (UPDATE / onConflictDoNothing / onConflictDoUpdate).
  // ============================================================
  console.log("[seed-atelier] v3 ledger (Task #258): utilization targets…");
  // role/seniority → target % (whole numbers stored as percent points)
  const TARGETS: Array<{ predicate: (e: { role: string; seniority?: string | null }) => boolean; pct: number }> = [
    { predicate: (e) => e.role === "partner" || e.seniority === "partner", pct: 50 },
    { predicate: (e) => e.role === "ai_engineer", pct: 75 },
    { predicate: (e) => e.role === "engagement_lead" || e.seniority === "principal", pct: 65 },
    { predicate: (e) => e.seniority === "manager" || e.seniority === "senior_consultant", pct: 70 },
  ];
  for (const emp of employeesToInsert) {
    const t = TARGETS.find((t) => t.predicate(emp))?.pct ?? 75;
    await db
      .update(atelierEmployees)
      .set({ utilizationTargetPct: t, updatedAt: new Date() })
      .where(eq(atelierEmployees.id, emp.id));
  }

  console.log("[seed-atelier] v3 ledger (Task #258): Utilization Analyst + Burn Sentinel agents…");
  await db
    .insert(atelierAgents)
    .values([
      {
        id: "ag_utilization_analyst",
        name: "Utilization Analyst",
        group: "Ledger",
        stage: "Govern",
        purpose:
          "Translates the firm's deterministic utilization, realization, and burn numbers into a partner-grade narrative. Refuses generation when the numeric block is missing or stale.",
        model: "claude-haiku-4-5",
        starred: false,
        status: "mvp",
        tools: ["snapshots.read", "engagement.read"],
        guardrails: [
          "Refuses when numeric_block is missing or all-zero (no rows yet)",
          "Never invents numbers — every claim is anchored to a snapshot value",
          "Recommends concrete actions (re-look pricing, rebench), not 'communicate'",
        ],
        humanCheckpoints: ["Partner reviews narrative before sharing externally"],
        runsLast30d: 0,
      },
      {
        id: "ag_burn_sentinel",
        name: "Burn Sentinel",
        group: "Ledger",
        stage: "Govern",
        purpose:
          "Watches every active engagement; emits a Pane A item to the Engagement Lead the moment burn-rate crosses 60 / 80 / 100 % of planned hours.",
        model: "deterministic",
        starred: false,
        status: "mvp",
        tools: ["engagement.read", "panea.write", "notifications.write", "audit.write"],
        guardrails: [
          "Idempotent: one alert per (engagement, threshold-band) — never re-fires",
          "Hourly gate to avoid alert spam",
          "100% crosses are always priority=high",
        ],
        humanCheckpoints: ["Engagement Lead acknowledges the Pane A item"],
        runsLast30d: 0,
      },
    ])
    .onConflictDoNothing();

  console.log("[seed-atelier] v3 ledger (Task #258): computing utilization snapshots…");
  // Pull the actual entries we just seeded and roll up by (person, week).
  // We materialise snapshots so the new pages have data on the very first
  // page-load (no need to wait 15 minutes for the ticker to fire).
  const SNAP_STATUSES = ["lead_approved", "approved", "partner_approved"];
  const allWeeks = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(isNull(atelierTimesheetWeeks.deletedAt));
  const allEntries = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(and(inArray(atelierTimesheetEntries.status, SNAP_STATUSES), isNull(atelierTimesheetEntries.deletedAt)));
  const allEngs = await db.select({ id: atelierEngagements.id, name: atelierEngagements.name }).from(atelierEngagements);
  const engNameById = new Map(allEngs.map((e) => [e.id, e.name] as const));
  const empById = new Map(employeesToInsert.map((e) => [e.id, e] as const));
  function targetFor(emp: typeof employeesToInsert[number] | undefined): number {
    if (!emp) return 0.75;
    return (TARGETS.find((t) => t.predicate(emp))?.pct ?? 75) / 100;
  }

  const snapshotsToInsert: Array<typeof atelierUtilizationSnapshots.$inferInsert> = [];
  for (const wk of allWeeks) {
    const wkEntries = allEntries.filter((e) => e.weekId === wk.id);
    if (!wkEntries.length) continue;
    const totalHours = wkEntries.reduce((s, e) => s + Number(e.hours || 0), 0);
    const billableHours = wkEntries.filter((e) => e.billable).reduce((s, e) => s + Number(e.hours || 0), 0);
    const leaveHours = wkEntries.filter((e) => e.activityCode === "leave").reduce((s, e) => s + Number(e.hours || 0), 0);
    const internalHours = totalHours - billableHours - leaveHours;
    const availableHours = 40;
    const utilizationPct = availableHours > 0 ? billableHours / availableHours : 0;
    const emp = empById.get(wk.personId);
    const targetPct = targetFor(emp);
    const mixMap = new Map<string, { hours: number; billable: boolean }>();
    for (const e of wkEntries) {
      const k = e.engagementId ?? "__internal__";
      const prev = mixMap.get(k) ?? { hours: 0, billable: false };
      mixMap.set(k, { hours: prev.hours + Number(e.hours || 0), billable: prev.billable || !!e.billable });
    }
    const engagementMix = Array.from(mixMap.entries()).map(([engId, v]) => ({
      engagementId: engId === "__internal__" ? null : engId,
      name: engId === "__internal__" ? "Internal / non-billable" : (engNameById.get(engId) ?? engId),
      hours: v.hours,
      billable: v.billable,
    }));
    snapshotsToInsert.push({
      id: `usnap_${wk.personId}_${wk.weekIso}`,
      personId: wk.personId,
      personType: wk.personType,
      weekIso: wk.weekIso,
      weekStartDate: wk.weekStartDate,
      billableHours,
      internalHours,
      leaveHours,
      totalHours,
      availableHours,
      utilizationPct,
      targetPct,
      engagementMix,
    });
  }
  if (snapshotsToInsert.length) {
    await db.insert(atelierUtilizationSnapshots).values(snapshotsToInsert).onConflictDoNothing();
  }
  console.log(`[seed-atelier] v3 ledger (Task #258): ${snapshotsToInsert.length} utilization snapshots written.`);

  // ============================================================
  // Task #259 — v3 Wallet seed (cards, FX, policies, expenses)
  // ============================================================
  await seedV3Wallet();

  console.log(
    `[seed-atelier] done — ${PERSONAS.length} personas · ${ACCOUNTS.length} accounts · ${AGENTS.length} agents · ${OPPORTUNITIES.length} opportunities · ${ENGAGEMENTS.length} engagements · ${ASSETS.length} assets · ${PANE_A.length} pane A · ${AGENT_RUNS.length} runs · ${WIN_THEMES.length} win themes · 1 debrief · 1 scheduled report · 1 salon workspace · ${SALON_USERS.length} salon users · 4 salon deliverables (3 published) · ${employeesToInsert.length} employees · ${CONTRACTORS.length} contractors · ${PARTNER_FIRMS.length} partner firms · ${PARTNER_RESOURCES.length} partner-firm resources · ${snapshotsToInsert.length} utilization snapshots.`,
  );
}

// ============================================================
// Task #259 — v3 Wallet seed
// ============================================================
async function seedV3Wallet() {
  // Wipe wallet tables for idempotency.
  await db.delete(atelierVatRegister);
  await db.delete(atelierExpenses);
  await db.delete(atelierExpensePolicies);
  await db.delete(atelierCorporateCards);
  await db.delete(atelierFxRates);

  // --- FX rates (deterministic, last 60 days) -----------------
  const fxQuotes: Array<{ q: string; r: number }> = [
    { q: "SAR", r: 3.75 },
    { q: "AED", r: 3.6725 },
    { q: "EUR", r: 0.92 },
    { q: "GBP", r: 0.79 },
    { q: "TRY", r: 32.5 },
  ];
  const fxRows: Array<typeof atelierFxRates.$inferInsert> = [];
  for (let d = 0; d < 60; d++) {
    const date = isoDate(DAYS_AGO(d));
    for (const { q, r } of fxQuotes) {
      const jitter = 1 + ((d % 7) - 3) * 0.0015;
      fxRows.push({
        id: `fx_${q}_${date}`,
        base: "USD",
        quote: q,
        date,
        rate: +(r * jitter).toFixed(6),
        source: "deterministic",
      });
    }
  }
  await db.insert(atelierFxRates).values(fxRows).onConflictDoNothing();
  console.log(`[seed-atelier] v3 wallet: ${fxRows.length} FX rates seeded.`);

  // --- 4 Corporate cards ---------------------------------------
  const cards = [
    { id: "card_mounir_amex", cardholderUserId: "p_mounir_ariss", label: "Mounir Ariss · Amex Plat",   last4: "1004", provider: "manual",     currency: "USD", monthlyLimitAmount: 50000 },
    { id: "card_layla_visa",  cardholderUserId: "p_layla_haddad", label: "Layla Haddad · ENBD Visa",    last4: "8821", provider: "manual",     currency: "AED", monthlyLimitAmount: 25000 },
    { id: "card_omar_visa",   cardholderUserId: "p_omar_najjar",  label: "Omar Najjar · SNB Visa",       last4: "5510", provider: "manual",     currency: "SAR", monthlyLimitAmount: 25000 },
    { id: "card_sara_mc",     cardholderUserId: "p_sara_qureshi", label: "Sara Qureshi · Mesh MC",       last4: "3370", provider: "mesh",       currency: "USD", monthlyLimitAmount: 15000 },
  ];
  await db.insert(atelierCorporateCards).values(
    cards.map((c) => ({ ...c, status: "active", linkedAt: DAYS_AGO(180) })),
  );
  console.log(`[seed-atelier] v3 wallet: ${cards.length} corporate cards.`);

  // --- 7 Default policies (mirror DEFAULT_POLICIES from policy.ts) ---
  await db.insert(atelierExpensePolicies).values([
    { id: "pol_meal",         category: "meal",     capAmountUsd: 75,   capUnit: "per_person_per_meal", hardBlockAmountUsd: 250, approvalThresholdUsd: 100, rationale: "Standard meal cap; > $100 needs leadership approval." },
    { id: "pol_hotel",        category: "hotel",    capAmountUsd: 350,  capUnit: "per_night",           hardBlockAmountUsd: 800, approvalThresholdUsd: 400, rationale: "Hotel cap aligned with mid-tier business properties in Riyadh/Dubai." },
    { id: "pol_taxi",         category: "taxi",     capAmountUsd: 150,  capUnit: "per_trip",            hardBlockAmountUsd: 400, rationale: "Single-trip cap; airport runs typically < $80." },
    { id: "pol_flight_emp",   category: "flight",   appliesToRole: "employee",      capAmountUsd: 2500, capUnit: "per_segment", hardBlockAmountUsd: 8000, approvalThresholdUsd: 3000, flightClassMax: "business", rationale: "Employees: business max for long-haul; economy preferred regional." },
    { id: "pol_flight_part",  category: "flight",   appliesToRole: "partner",       capAmountUsd: 6000, capUnit: "per_segment", hardBlockAmountUsd: 12000, flightClassMax: "first", rationale: "Partners may fly first on long-haul." },
    { id: "pol_gift",         category: "gift",     capAmountUsd: 250,  capUnit: "per_gift",            hardBlockAmountUsd: 500, approvalThresholdUsd: 200, rationale: "Client gifts: stay under FCPA / KSA anti-corruption thresholds." },
    { id: "pol_software",     category: "software", capAmountUsd: 500,  capUnit: "per_month",           hardBlockAmountUsd: 2000, approvalThresholdUsd: 300, rationale: "SaaS spend; > $300 routes through ops." },
  ]);
  console.log("[seed-atelier] v3 wallet: 7 default policies seeded.");

  // --- 20 expenses across personas/states ----------------------
  // Helpers to compute USD via the FX rate we just seeded.
  function fxFor(currency: string, date: string): number {
    if (currency === "USD") return 1;
    const row = fxRows.find((r) => r.quote === currency && r.date === date);
    return row ? row.rate as number : (fxQuotes.find((q) => q.q === currency)?.r ?? 1);
  }
  function usd(amount: number, currency: string, date: string): number {
    if (currency === "USD") return amount;
    return +(amount / fxFor(currency, date)).toFixed(2);
  }

  type ExpSeed = {
    id: string; personId: string; personType: "employee" | "contractor"; engagementId: string | null;
    daysAgo: number; captureSource: "card_feed" | "manual" | "mileage" | "per_diem"; cardId?: string;
    merchant: string; description: string; category: string; amount: number; currency: string;
    vatTreatment: string; vatAmount: number; vatCountry: string | null;
    clientBillable: boolean; markupPct: number;
    fixtureKey?: string;
    status: "draft" | "submitted" | "approved" | "rejected";
    policyStatus?: "green" | "amber" | "red";
    overrideRationale?: string | null;
    findings?: Array<{ severity: "amber" | "red"; ruleId: string; category: string; message: string }>;
  };

  const ENG = TASAMA_ENG_ID;
  const ENG_DGE = "eng_dge_effortless_v1";

  const seeds: ExpSeed[] = [
    // Mounir — Riyadh client trip (approved, billable)
    { id: "exp_001", personId: "p_mounir_ariss", personType: "employee", engagementId: ENG, daysAgo: 14, captureSource: "card_feed", cardId: "card_mounir_amex", merchant: "Careem KSA", description: "Airport → DQ", category: "taxi", amount: 180, currency: "SAR", vatTreatment: "ksa_15", vatAmount: 23.48, vatCountry: "KSA", clientBillable: true, markupPct: 10, fixtureKey: "riyadh_taxi_01", status: "approved", policyStatus: "green" },
    { id: "exp_002", personId: "p_mounir_ariss", personType: "employee", engagementId: ENG, daysAgo: 13, captureSource: "manual", merchant: "Four Seasons Riyadh", description: "2 nights (client visit)", category: "hotel", amount: 2300, currency: "SAR", vatTreatment: "ksa_15", vatAmount: 300, vatCountry: "KSA", clientBillable: true, markupPct: 10, fixtureKey: "riyadh_hotel_01", status: "approved", policyStatus: "green" },
    { id: "exp_003", personId: "p_mounir_ariss", personType: "employee", engagementId: ENG, daysAgo: 12, captureSource: "manual", merchant: "Najd Village", description: "Dinner with Tasama CEO + COO", category: "meal", amount: 540, currency: "SAR", vatTreatment: "ksa_15", vatAmount: 70.43, vatCountry: "KSA", clientBillable: true, markupPct: 10, fixtureKey: "riyadh_dinner_clientmeal", status: "approved", policyStatus: "green" },
    { id: "exp_004", personId: "p_mounir_ariss", personType: "employee", engagementId: ENG, daysAgo: 11, captureSource: "card_feed", cardId: "card_mounir_amex", merchant: "Saudia SV", description: "RUH → DXB business one-way", category: "flight", amount: 4200, currency: "SAR", vatTreatment: "ksa_15", vatAmount: 547.83, vatCountry: "KSA", clientBillable: true, markupPct: 10, fixtureKey: "flight_riyadh_dubai_business", status: "approved", policyStatus: "green" },

    // Layla — Dubai trip (approved, billable)
    { id: "exp_005", personId: "p_layla_haddad", personType: "employee", engagementId: ENG_DGE, daysAgo: 9, captureSource: "card_feed", cardId: "card_layla_visa", merchant: "Careem UAE", description: "DXB → DIFC", category: "taxi", amount: 95, currency: "AED", vatTreatment: "uae_5", vatAmount: 4.52, vatCountry: "UAE", clientBillable: true, markupPct: 10, fixtureKey: "dubai_taxi_01", status: "approved", policyStatus: "green" },
    { id: "exp_006", personId: "p_layla_haddad", personType: "employee", engagementId: ENG_DGE, daysAgo: 8, captureSource: "manual", merchant: "Address Downtown", description: "1 night (DGE workshop)", category: "hotel", amount: 1450, currency: "AED", vatTreatment: "uae_5", vatAmount: 69.05, vatCountry: "UAE", clientBillable: true, markupPct: 10, fixtureKey: "dubai_hotel_01", status: "approved", policyStatus: "green" },
    { id: "exp_007", personId: "p_layla_haddad", personType: "employee", engagementId: ENG_DGE, daysAgo: 7, captureSource: "manual", merchant: "Pierchic", description: "Working dinner — DGE leads", category: "meal", amount: 620, currency: "AED", vatTreatment: "uae_5", vatAmount: 29.52, vatCountry: "UAE", clientBillable: true, markupPct: 10, fixtureKey: "dubai_dinner_01", status: "approved", policyStatus: "green" },

    // Omar — submitted, awaiting approval
    { id: "exp_008", personId: "p_omar_najjar", personType: "employee", engagementId: ENG, daysAgo: 4, captureSource: "card_feed", cardId: "card_omar_visa", merchant: "Careem KSA", description: "Hotel → Tasama HQ", category: "taxi", amount: 95, currency: "SAR", vatTreatment: "ksa_15", vatAmount: 12.39, vatCountry: "KSA", clientBillable: true, markupPct: 10, fixtureKey: "riyadh_taxi_01", status: "submitted", policyStatus: "green" },
    { id: "exp_009", personId: "p_omar_najjar", personType: "employee", engagementId: ENG, daysAgo: 3, captureSource: "per_diem", merchant: "Per-diem 3 days (Riyadh)", description: "Field per-diem", category: "per_diem", amount: 225, currency: "USD", vatTreatment: "none", vatAmount: 0, vatCountry: null, clientBillable: true, markupPct: 0, status: "submitted", policyStatus: "green" },

    // Sara — software (firm overhead)
    { id: "exp_010", personId: "p_sara_qureshi", personType: "employee", engagementId: null, daysAgo: 6, captureSource: "manual", merchant: "OpenAI ChatGPT Team", description: "Team subscription · 5 seats", category: "software", amount: 150, currency: "USD", vatTreatment: "none", vatAmount: 0, vatCountry: null, clientBillable: false, markupPct: 0, fixtureKey: "software_chatgpt_team", status: "approved", policyStatus: "green" },
    { id: "exp_011", personId: "p_sara_qureshi", personType: "employee", engagementId: null, daysAgo: 6, captureSource: "manual", merchant: "Figma", description: "Org plan · 12 seats", category: "software", amount: 540, currency: "USD", vatTreatment: "none", vatAmount: 0, vatCountry: null, clientBillable: false, markupPct: 0, fixtureKey: "software_figma_org", status: "submitted", policyStatus: "amber", overrideRationale: "Renewal of org plan; pre-approved at planning kickoff (Q1 ops review).", findings: [{ severity: "amber", ruleId: "pol_software", category: "software", message: "Software charge $540 exceeds approval threshold $300; needs ops review." }] },

    // Layla — mileage internal
    { id: "exp_012", personId: "p_layla_haddad", personType: "employee", engagementId: ENG, daysAgo: 5, captureSource: "mileage", merchant: "DXB → AUH (round trip)", description: "Client visit Abu Dhabi", category: "mileage", amount: 173.6, currency: "USD", vatTreatment: "none", vatAmount: 0, vatCountry: null, clientBillable: true, markupPct: 0, status: "approved", policyStatus: "green" },

    // Mounir — RED block: first-class flight beyond hard cap (rejected then re-edited would normally happen; here keep as 'rejected' for audit trail).
    { id: "exp_013", personId: "p_mounir_ariss", personType: "employee", engagementId: ENG_DGE, daysAgo: 2, captureSource: "card_feed", cardId: "card_mounir_amex", merchant: "Emirates EK", description: "DXB → LHR first class", category: "flight", amount: 14800, currency: "USD", vatTreatment: "none", vatAmount: 0, vatCountry: null, clientBillable: false, markupPct: 0, fixtureKey: "flight_dubai_london_first", status: "rejected", policyStatus: "red", findings: [{ severity: "red", ruleId: "pol_flight_part", category: "flight", message: "Flight $14,800 exceeds hard cap $12,000 for partner segment." }] },

    // Omar — small client gift (green)
    { id: "exp_014", personId: "p_omar_najjar", personType: "employee", engagementId: ENG, daysAgo: 10, captureSource: "manual", merchant: "Patchi", description: "Gift box for Tasama PM (project close)", category: "gift", amount: 600, currency: "SAR", vatTreatment: "ksa_15", vatAmount: 78.26, vatCountry: "KSA", clientBillable: false, markupPct: 0, fixtureKey: "gift_client_riyadh", status: "approved", policyStatus: "green" },

    // Sara — Eurozone vendor (no VAT register)
    { id: "exp_015", personId: "p_sara_qureshi", personType: "employee", engagementId: null, daysAgo: 20, captureSource: "manual", merchant: "Hetzner Online GmbH", description: "Compute · Q1 invoice", category: "software", amount: 320, currency: "EUR", vatTreatment: "none", vatAmount: 0, vatCountry: "EU", clientBillable: false, markupPct: 0, status: "approved", policyStatus: "green" },

    // Mounir — small TRY meal (no VAT register)
    { id: "exp_016", personId: "p_mounir_ariss", personType: "employee", engagementId: null, daysAgo: 25, captureSource: "manual", merchant: "Karaköy Lokantası", description: "Dinner Istanbul stopover", category: "meal", amount: 1850, currency: "TRY", vatTreatment: "none", vatAmount: 0, vatCountry: "TR", clientBillable: false, markupPct: 0, status: "approved", policyStatus: "green" },

    // Layla — drafts
    { id: "exp_017", personId: "p_layla_haddad", personType: "employee", engagementId: ENG_DGE, daysAgo: 1, captureSource: "manual", merchant: "Costa Coffee DXB", description: "Workshop coffees", category: "meal", amount: 145, currency: "AED", vatTreatment: "uae_5", vatAmount: 6.9, vatCountry: "UAE", clientBillable: true, markupPct: 10, status: "draft", policyStatus: "green" },

    // Omar — draft mileage
    { id: "exp_018", personId: "p_omar_najjar", personType: "employee", engagementId: ENG, daysAgo: 1, captureSource: "mileage", merchant: "Riyadh → Jeddah", description: "Driver visit", category: "mileage", amount: 595.2, currency: "USD", vatTreatment: "none", vatAmount: 0, vatCountry: null, clientBillable: true, markupPct: 0, status: "draft", policyStatus: "green" },

    // Sara — submitted hotel approval-threshold (green but >approval)
    { id: "exp_019", personId: "p_sara_qureshi", personType: "employee", engagementId: ENG, daysAgo: 4, captureSource: "card_feed", cardId: "card_sara_mc", merchant: "Hilton Riyadh Hotel & Residences", description: "1 night", category: "hotel", amount: 1500, currency: "SAR", vatTreatment: "ksa_15", vatAmount: 195.65, vatCountry: "KSA", clientBillable: true, markupPct: 10, fixtureKey: "riyadh_hotel_01", status: "submitted", policyStatus: "green" },

    // Mounir — approved meal in USD (firm overhead)
    { id: "exp_020", personId: "p_mounir_ariss", personType: "employee", engagementId: null, daysAgo: 30, captureSource: "manual", merchant: "Cipriani DXB", description: "Recruiting dinner", category: "meal", amount: 480, currency: "USD", vatTreatment: "none", vatAmount: 0, vatCountry: null, clientBillable: false, markupPct: 0, status: "approved", policyStatus: "green" },
  ];

  const expenseRows: Array<typeof atelierExpenses.$inferInsert> = seeds.map((s) => {
    const date = isoDate(DAYS_AGO(s.daysAgo));
    const usdAmount = usd(s.amount, s.currency, date);
    const submittedAt = s.status === "submitted" || s.status === "approved" || s.status === "rejected" ? DAYS_AGO(Math.max(s.daysAgo - 1, 0)) : null;
    const approvedAt  = s.status === "approved" ? DAYS_AGO(Math.max(s.daysAgo - 2, 0)) : null;
    const rejectedAt  = s.status === "rejected" ? DAYS_AGO(Math.max(s.daysAgo - 1, 0)) : null;
    return {
      id: s.id,
      personId: s.personId,
      personType: s.personType,
      engagementId: s.engagementId,
      expenseDate: date,
      captureSource: s.captureSource,
      cardId: s.cardId ?? null,
      merchant: s.merchant,
      description: s.description,
      category: s.category,
      amount: s.amount,
      currency: s.currency,
      fxRate: s.currency === "USD" ? 1 : fxFor(s.currency, date),
      fxRateDate: date,
      usdAmount,
      vatAmount: s.vatAmount,
      vatTreatment: s.vatTreatment,
      vatCountry: s.vatCountry,
      vatCurrency: s.currency,
      clientBillable: s.clientBillable,
      markupPct: s.markupPct,
      status: s.status,
      policyStatus: s.policyStatus ?? "green",
      policyFindings: s.findings ?? [],
      overrideRationale: s.overrideRationale ?? null,
      receiptFixtureKey: s.fixtureKey ?? null,
      receiptFileRef: s.fixtureKey ? `enc:wallet:${s.fixtureKey}.pdf` : null,
      receiptEncryptedAtRest: !!s.fixtureKey,
      summary: s.description,
      submittedAt,
      approvedAt,
      approvedByUserId: approvedAt ? "p_mounir_ariss" : null,
      rejectedAt,
      rejectedReason: s.status === "rejected" ? "Exceeds hard cap (first-class long-haul beyond $12k)." : null,
      createdByUserId: s.personId,
      createdAt: DAYS_AGO(s.daysAgo),
    };
  });
  await db.insert(atelierExpenses).values(expenseRows);

  // --- VAT register for approved expenses ---------------------
  const approved = seeds.filter((s) => s.status === "approved" && s.vatCountry && s.vatTreatment !== "none");
  if (approved.length > 0) {
    await db.insert(atelierVatRegister).values(
      approved.map((s) => {
        const date = isoDate(DAYS_AGO(s.daysAgo));
        const usdAmount = usd(s.amount, s.currency, date);
        const rate = s.vatTreatment === "ksa_15" ? 0.15 : s.vatTreatment === "uae_5" ? 0.05 : 0;
        const net = +(s.amount - s.vatAmount).toFixed(2);
        const usdNet = +(usdAmount * (net / Math.max(s.amount, 0.0001))).toFixed(2);
        const usdVat = +(usdAmount - usdNet).toFixed(2);
        return {
          id: `vat_${s.id}`,
          expenseId: s.id,
          expenseDate: date,
          country: s.vatCountry!,
          treatment: s.vatTreatment,
          rate,
          netAmount: net,
          vatAmount: s.vatAmount,
          grossAmount: s.amount,
          currency: s.currency,
          usdNet,
          usdVat,
          usdGross: usdAmount,
          merchant: s.merchant,
          summary: s.description,
        };
      }),
    );
  }
  console.log(`[seed-atelier] v3 wallet (Task #259): ${expenseRows.length} expenses, ${approved.length} VAT register rows.`);

  // ============================================================
  // Task #260 — v3 Wallet (II): payment proposals + invoice drafts
  // Walkthrough fixtures so the partner pane lights up on first load.
  // ============================================================
  console.log("[seed-atelier] v3 wallet (Task #260): payment proposals + invoice draft…");
  await db.delete(atelierContractorPayments);
  await db.delete(atelierPartnerFirmInvoices);
  await db.delete(atelierInvoiceLineDrafts);
  // Recompute the same weekA/weekB anchors used by the v3 ledger block
  // (those identifiers are scoped to the helper above). Keeping the math
  // here local avoids a refactor of the prior block.
  const wpToday = new Date();
  function wpIsoWeek(d: Date): { weekIso: string; monday: Date } {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const monday = new Date(d);
    const md = monday.getUTCDay() || 7;
    monday.setUTCDate(monday.getUTCDate() - (md - 1));
    monday.setUTCHours(0, 0, 0, 0);
    return { weekIso: `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`, monday };
  }
  const weekB = wpIsoWeek(wpToday);
  const wpLastWeek = new Date(wpToday);
  wpLastWeek.setUTCDate(wpLastWeek.getUTCDate() - 7);
  const weekA = wpIsoWeek(wpLastWeek);

  // 1) Contractor payment proposal awaiting Partner approval (>$250).
  await db.insert(atelierContractorPayments).values([
    {
      id: "cp_seed_demo_thresh",
      payeeUserId: "c_omar_haddad",
      payeePersonType: "contractor",
      payeeName: "Omar Haddad",
      engagementId: TASAMA_ENG_ID,
      weekIso: weekA.weekIso,
      hours: 32,
      ratePerHour: 75,
      rateCurrency: "USD",
      costAmount: 2400,
      costCurrency: "USD",
      fxRate: 1,
      usdAmount: 2400,
      status: "proposed",
      requiresPartnerApproval: true,
      proposalRunId: "ppr_seed_demo",
      evidenceEntryIds: ["ts_seed_demo_a", "ts_seed_demo_b"],
      notes: "Seed walkthrough — contractor week awaiting Partner sign-off ($250 threshold).",
    },
    {
      id: "cp_seed_demo_small",
      payeeUserId: "c_omar_haddad",
      payeePersonType: "contractor",
      payeeName: "Omar Haddad",
      engagementId: TASAMA_ENG_ID,
      weekIso: weekB.weekIso,
      hours: 2,
      ratePerHour: 75,
      rateCurrency: "USD",
      costAmount: 150,
      costCurrency: "USD",
      fxRate: 1,
      usdAmount: 150,
      status: "proposed",
      requiresPartnerApproval: false,
      proposalRunId: "ppr_seed_demo",
      evidenceEntryIds: ["ts_seed_demo_c"],
      notes: "Seed walkthrough — small contractor proposal under threshold.",
    },
  ]);

  // 2) Partner-firm invoice proposal (always partner-approval).
  await db.insert(atelierPartnerFirmInvoices).values([
    {
      id: "pfi_seed_demo",
      partnerFirmId: "pf_bgts",
      partnerFirmName: "Boutique Growth & Tech Studio",
      engagementId: TASAMA_ENG_ID,
      weekIso: weekA.weekIso,
      hours: 38,
      costAmount: 57000,
      costCurrency: "SAR",
      fxRate: 3.75,
      usdAmount: 15200,
      status: "proposed",
      proposalRunId: "ppr_seed_demo",
      evidenceFirmHourIds: [`pfh_seed_bgts_${weekA.weekIso}`],
      notes: "Seed walkthrough — partner-firm invoice for Tasama week A.",
    },
  ]);

  // 3) Invoice-line draft for the Tasama engagement (one composer run).
  await db.insert(atelierInvoiceLineDrafts).values([
    {
      id: "ild_seed_demo",
      engagementId: TASAMA_ENG_ID,
      composedByUserId: "p_mounir_ariss",
      composerRunId: "icr_seed_demo",
      rateCardId: null,
      lines: [
        {
          kind: "hours",
          sourceId: "ts_seed_demo_a",
          description: "Billable hours — Mounir Ariss (rolling 4 weeks)",
          qty: 120,
          unitPriceUsd: 250,
          amountUsd: 30000,
          meta: { personId: "p_mounir_ariss" },
        },
        {
          kind: "hours",
          sourceId: "ts_seed_demo_b",
          description: "Billable hours — Senior consultant team",
          qty: 92,
          unitPriceUsd: 220,
          amountUsd: 20240,
          meta: { personId: "team_sc" },
        },
        {
          kind: "expense",
          sourceId: "exp_001",
          description: "Careem KSA — taxi (2026-04-29)",
          qty: 1,
          unitPriceUsd: 52.8,
          amountUsd: 58.08,
          markupPct: 10,
          meta: { merchant: "Careem KSA", category: "taxi" },
        },
        {
          kind: "expense",
          sourceId: "exp_002",
          description: "Four Seasons Riyadh — hotel (2026-04-30)",
          qty: 1,
          unitPriceUsd: 674.96,
          amountUsd: 742.46,
          markupPct: 10,
          meta: { merchant: "Four Seasons Riyadh", category: "hotel" },
        },
      ],
      totals: {
        hoursUsd: 50240,
        expensesNetUsd: 727.76,
        markupUsd: 72.78,
        totalUsd: 51040.54,
        lineCount: 4,
      },
      status: "draft",
    },
  ]);

  console.log("[seed-atelier] v3 wallet (Task #260): 2 contractor + 1 partner-firm proposal + 1 invoice draft.");
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
