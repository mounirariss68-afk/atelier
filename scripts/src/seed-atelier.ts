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
  atelierDeliverables,
  atelierDeliverableVersions,
  atelierMeetings,
  atelierAssets,
  atelierPrompts,
  atelierAgents,
  atelierAgentRuns,
  atelierAuditEvents,
  atelierRaidItems,
  atelierHypothesisTrees,
  atelierProcesses,
  atelierPaneAItems,
} from "@workspace/db";
import { sql } from "drizzle-orm";

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
    partnerOwnerId: "p_mounir_ariss",
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
    partnerOwnerId: "p_mounir_ariss",
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
    partnerOwnerId: "p_mounir_ariss",
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
    partnerOwnerId: "p_mounir_ariss",
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
    "atelier_pane_a_items",
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
    ACCOUNTS.map((a) => ({
      id: a.id,
      name: a.name,
      country: a.country,
      sector: a.sector,
      notes: a.notes,
    })),
  );

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
    })),
  );

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
  ];
  await db.insert(atelierAuditEvents).values(auditRows);

  console.log(
    `[seed-atelier] done — ${PERSONAS.length} personas · ${ACCOUNTS.length} accounts · ${AGENTS.length} agents · ${OPPORTUNITIES.length} opportunities · ${ENGAGEMENTS.length} engagements · ${ASSETS.length} assets · ${PANE_A.length} pane A · ${AGENT_RUNS.length} runs.`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
