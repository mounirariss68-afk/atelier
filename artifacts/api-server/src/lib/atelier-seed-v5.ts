/**
 * Atelier v5 — Idempotent demo seed for the Press / Alliances / Studio /
 * Guardhouse / IP catalog tables (Task #354).
 *
 * Mirrors the TypeScript seed previously hard-coded into
 * `artifacts/atelier/src/data/{press,alliances,studio,guardhouse,ip}-seed.ts`
 * so the demo path stays identical across reloads. Safe to call on every
 * cold start — every insert is gated on existence so re-runs are no-ops.
 */
import { eq, sql, type InferInsertModel } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  atelierPressEditorialCalendar,
  atelierPressInFlightContent,
  atelierPressPartnerCadence,
  atelierPressNewsletter,
  atelierPressSpeakingOpportunities,
  atelierPressMentions,
  atelierAlliancePartnerFirms,
  atelierAllianceJointPipeline,
  atelierAllianceCertifications,
  atelierAllianceConflicts,
  atelierStudioOpenRoles,
  atelierStudioCandidates,
  atelierStudioInterviewPanels,
  atelierStudioReferenceChecks,
  atelierStudioOffers,
  atelierStudioReferrals,
  atelierGuardhouseControls,
  atelierGuardhouseEvidence,
  atelierGuardhousePentests,
  atelierGuardhouseVendors,
  atelierGuardhouseIncidents,
  atelierGuardhouseDsars,
  atelierGuardhouseBackups,
  atelierIpCodeAssets,
  atelierIpOssDependencies,
  atelierIpDemoEnvironments,
  atelierIpLicenseGrants,
} from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Idempotent insert helper. Constrained so the table must expose an `id`
 * text column and the row payload must satisfy the table's insert model —
 * Drizzle still gives us full compile-time checking on row shape.
 */
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

const PRESS_EDITORIAL = [
  {
    id: "ec_001",
    workingTitle: "The GCC AI capex bubble — a four-quarter view",
    publication: "MEED",
    byline: "Gökhan",
    publishOn: "2026-06-12",
    status: "scheduled",
    thesis:
      "Capex commitments outran usable capacity by roughly two quarters; the correction shows up in deal renewal terms, not headlines.",
    themeId: "theme_capex_correction",
  },
  {
    id: "ec_002",
    workingTitle: "Why responsible-AI playbooks fail in family offices",
    publication: "AICo Field Notes",
    byline: "Mounir",
    publishOn: "2026-06-19",
    status: "drafting",
    thesis:
      "The 'committee + framework' model assumes a CIO. Family offices have a chairman; the unit of governance is different.",
    themeId: "theme_governance_misread",
  },
  {
    id: "ec_003",
    workingTitle: "What KSA PDPL actually changes for cross-border AI vendors",
    publication: "TechCrunch ME",
    byline: "Mounir",
    publishOn: "2026-07-03",
    status: "outlined",
    thesis:
      "The localisation read is wrong. The consequential clauses are around purpose limitation and downstream model use.",
    themeId: "theme_pdpl_misread",
  },
  {
    id: "ec_004",
    workingTitle: "Pricing AI work when the unit isn't a person-week",
    publication: "AICo Field Notes",
    byline: "Gökhan",
    publishOn: "2026-07-17",
    status: "candidate",
    thesis:
      "T&M assumes labour as the binding constraint. Capability density is the new binding constraint; pricing has to follow.",
    themeId: "theme_post_tm_pricing",
  },
];

const PRESS_IN_FLIGHT = [
  {
    id: "if_001",
    title: "The GCC AI capex bubble — a four-quarter view",
    kind: "feature",
    byline: "Gökhan",
    wordCount: 1740,
    sourceArtifact: "POV/2026-Q2-capex",
    phase: "stylist",
    citationCoverage: 0.86,
  },
  {
    id: "if_002",
    title: "Why responsible-AI playbooks fail in family offices",
    kind: "feature",
    byline: "Mounir",
    wordCount: 1320,
    sourceArtifact: "POV/2026-Q2-family-office",
    phase: "section_writer",
    citationCoverage: 0.71,
  },
  {
    id: "if_003",
    title: "Three lessons from a failed AI control-tower",
    kind: "column",
    byline: "Mounir",
    wordCount: 880,
    sourceArtifact: "WinLoss/eng_alpha_2026q1",
    phase: "outline",
    citationCoverage: 0.92,
  },
];

const PRESS_PARTNER_CADENCE = [
  {
    id: "ppc_mounir",
    partnerId: "p_mounir",
    partnerName: "Mounir",
    voiceProfile: "partner_voice_mounir/v1",
    targetPer90d: 8,
    postsThis90d: 6,
    cadenceMet: false,
    queue: [
      {
        id: "lq_001",
        status: "awaiting partner approval",
        voiceMatchScore: 0.83,
        draftBody:
          "Everyone is talking about responsible-AI committees. The harder question: who owns the model when the committee disagrees?",
      },
      {
        id: "lq_002",
        status: "draft",
        voiceMatchScore: 0.78,
        draftBody:
          "Three weeks inside a family office told me what no GCC playbook will: the chairman is the policy.",
      },
    ],
  },
  {
    id: "ppc_gokhan",
    partnerId: "p_gokhan",
    partnerName: "Gökhan",
    voiceProfile: "partner_voice_gokhan/v1",
    targetPer90d: 6,
    postsThis90d: 7,
    cadenceMet: true,
    queue: [
      {
        id: "lq_003",
        status: "scheduled · 2026-05-19 09:00 GST",
        voiceMatchScore: 0.91,
        draftBody:
          "Q1 GCC AI deal renewals came in at 76% of original ACV; the gap shows up in scope, not price. The next datapoint to watch is Q2 utilisation.",
      },
    ],
  },
];

const PRESS_NEWSLETTER = [
  {
    id: "fn_singleton",
    totalSubscribers: 4312,
    netGrowthLast90d: 318,
    avgOpenRate: 0.41,
    avgClickRate: 0.061,
    currentIssue: {
      id: "fn_2026_06",
      subjectLine:
        "Field Notes · June 2026 — the capex correction lands",
      status: "assembling",
      scheduledSendAt: "2026-06-04 08:00 GST",
      sections: [
        { id: "editor", label: "Editor's Note", summary: "Mounir · 80 words" },
        {
          id: "what_we_seeing",
          label: "What we're seeing",
          summary: "3 themes from Theme Curator",
        },
        {
          id: "piece",
          label: "A piece worth your time",
          summary: "Gökhan · capex feature",
        },
        {
          id: "field_log",
          label: "Field log",
          summary: "3 engagements went public",
        },
        {
          id: "hiring",
          label: "What we're hiring for",
          summary: "AI Engineer · Lead Designer",
        },
      ],
    },
  },
];

const PRESS_SPEAKING = [
  {
    id: "sp_001",
    event: "GCC AI Summit · Riyadh",
    kind: "conference keynote",
    location: "Riyadh, KSA",
    date: "2026-09-22",
    audience: "300 CIOs / CDOs",
    ask: "Opening keynote — '12 months in, what the GCC got right'",
    decision: "accepted",
    owner: "Mounir",
  },
  {
    id: "sp_002",
    event: "Bank of the Middle East · Closed Roundtable",
    kind: "roundtable",
    location: "Dubai, UAE",
    date: "2026-07-08",
    audience: "12 BoME senior partners",
    ask: "AI in private banking — 90 min off-record",
    decision: "accepted",
    owner: "Gökhan",
  },
  {
    id: "sp_003",
    event: "Al Arabiya Business · podcast",
    kind: "podcast guest",
    location: "Remote",
    date: "2026-06-30",
    audience: "regional business listeners",
    ask: "30-min conversation on PDPL impact on AI vendors",
    decision: "considering",
    owner: "Mounir",
  },
  {
    id: "sp_004",
    event: "Slush · Helsinki",
    kind: "panel",
    location: "Helsinki, Finland",
    date: "2026-11-19",
    audience: "European founders",
    ask: "GCC corridor for European AI startups",
    decision: "considering",
    owner: "Gökhan",
  },
];

const PRESS_MENTIONS = [
  {
    id: "pm_001",
    headline: "AICo's Mounir on why GCC AI policy is being mis-read",
    publication: "MEED",
    date: "2026-05-12",
    about: "Mounir, partner_quote",
    summary:
      "Mounir quoted on the gap between the AI policy text and the procurement reality at GCC sovereign funds. Tone: authoritative.",
    sentiment: "positive",
  },
  {
    id: "pm_002",
    headline: "Bain pushes responsible-AI framework for the Gulf",
    publication: "FT",
    date: "2026-05-09",
    about: "competitor",
    summary:
      "Bain launched a 50-page responsible-AI playbook aimed at the GCC; reception muted. Implication for AICo: differentiate on engagement-tested rather than framework-first.",
    sentiment: "neutral",
  },
  {
    id: "pm_003",
    headline: "The boutique consultancies eating tier-1 AI work",
    publication: "Sifted",
    date: "2026-04-29",
    about: "AICo, named",
    summary:
      "Feature naming AICo among five firms displacing tier-1 incumbents on AI mandates. Tone: positive.",
    sentiment: "positive",
  },
  {
    id: "pm_004",
    headline: "AI consultancy spend: where the money actually went",
    publication: "Bloomberg ME",
    date: "2026-04-22",
    about: "industry",
    summary:
      "Industry-wide spend analysis. AICo not named but cited indirectly in 'boutique cohort'. Sentiment toward boutiques: neutral-positive.",
    sentiment: "neutral",
  },
];

const ALLIANCE_FIRMS = [
  {
    id: "pf_001",
    name: "Quanta Systems",
    kind: "system_integrator",
    country: "UAE",
    speciality: "Cloud landing zones, data platforms",
    relationshipStrength: 4,
    anchorAico: "Gökhan",
    anchorPartner: "Reem Al-Suwaidi",
    lastTouchAt: "2026-05-08",
    openJointOpps: 3,
    lifetimeJointRevenueMm: 2.1,
    recentMoves: [
      "Hired ex-AWS regional lead as new CTO (2026-04)",
      "Snowflake Elite tier achieved Q1",
    ],
  },
  {
    id: "pf_002",
    name: "Lumen Strategic",
    kind: "niche_specialist",
    country: "KSA",
    speciality: "AI governance, KSA PDPL",
    relationshipStrength: 5,
    anchorAico: "Mounir",
    anchorPartner: "Khalid Al-Ghamdi",
    lastTouchAt: "2026-05-13",
    openJointOpps: 2,
    lifetimeJointRevenueMm: 1.4,
    recentMoves: ["Published joint POV with AICo on PDPL (2026-Q1)"],
  },
  {
    id: "pf_003",
    name: "Anchorline Advisors",
    kind: "boutique_strategy",
    country: "UK",
    speciality: "Operating model, post-merger integration",
    relationshipStrength: 3,
    anchorAico: "Mounir",
    anchorPartner: "Helena Park",
    lastTouchAt: "2026-04-19",
    openJointOpps: 1,
    lifetimeJointRevenueMm: 0.8,
    recentMoves: ["Hired two ex-AICo associates (flag — informational)"],
  },
  {
    id: "pf_004",
    name: "Northstar Cloud",
    kind: "system_integrator",
    country: "Türkiye",
    speciality: "Azure delivery, FSI workloads",
    relationshipStrength: 3,
    anchorAico: "Gökhan",
    anchorPartner: "Cem Aydın",
    lastTouchAt: "2026-04-30",
    openJointOpps: 2,
    lifetimeJointRevenueMm: 0.6,
    recentMoves: ["Lost Azure Advanced Specialty for Data — needs joint recert push"],
  },
];

const ALLIANCE_PIPELINE = [
  {
    id: "jo_001",
    opportunityName: "Sovereign data fabric — Phase 1",
    client: "GCC sovereign fund (named in CRM)",
    partnerFirm: "Quanta Systems",
    leadParty: "AICo",
    stage: "Proposal",
    acvUsdK: 1400,
    aicoPct: 65,
    partnerPct: 35,
    splitRationale:
      "AICo leads strategy + governance; Quanta executes landing zone build.",
    allianceLetterStatus: "signed",
  },
  {
    id: "jo_002",
    opportunityName: "PDPL readiness program",
    client: "Riyadh-based bank (named in CRM)",
    partnerFirm: "Lumen Strategic",
    leadParty: "Lumen",
    stage: "Discovery",
    acvUsdK: 620,
    aicoPct: 40,
    partnerPct: 60,
    splitRationale:
      "Lumen leads regulatory interface + KSA-resident delivery; AICo delivers controls library + agent build.",
    allianceLetterStatus: "draft",
  },
  {
    id: "jo_003",
    opportunityName: "Operating-model redesign + AI overlay",
    client: "UK FSI (named in CRM)",
    partnerFirm: "Anchorline Advisors",
    leadParty: "AICo",
    stage: "Discovery",
    acvUsdK: 880,
    aicoPct: 55,
    partnerPct: 45,
    splitRationale:
      "AICo leads AI overlay; Anchorline leads org redesign and PMI playbook.",
    allianceLetterStatus: "draft",
  },
  {
    id: "jo_004",
    opportunityName: "Azure FSI control-tower",
    client: "İstanbul-based bank (named in CRM)",
    partnerFirm: "Northstar Cloud",
    leadParty: "Northstar",
    stage: "Proposal",
    acvUsdK: 410,
    aicoPct: 35,
    partnerPct: 65,
    splitRationale:
      "Northstar holds prime; AICo delivers control-tower design + agent integration.",
    allianceLetterStatus: "signed",
  },
];

const ALLIANCE_CERTS = [
  { id: "c_001", credential: "AWS Solutions Architect — Professional", platform: "AWS", holder: "Gökhan", status: "active", expiresAt: "2027-02-04" },
  { id: "c_002", credential: "AWS Machine Learning — Specialty", platform: "AWS", holder: "Yusuf Ç.", status: "lapsing", expiresAt: "2026-06-08" },
  { id: "c_003", credential: "Azure Solutions Architect Expert", platform: "Azure", holder: "Mounir", status: "active", expiresAt: "2026-11-30" },
  { id: "c_004", credential: "Azure Data Engineer Associate", platform: "Azure", holder: "Aisha M.", status: "lapsed", expiresAt: "2026-04-19" },
  { id: "c_005", credential: "Anthropic Builder — Advanced", platform: "Anthropic", holder: "Hamza R.", status: "active", expiresAt: "2027-01-22" },
  { id: "c_006", credential: "Databricks Data Engineer Pro", platform: "Databricks", holder: "Yusuf Ç.", status: "active", expiresAt: "2026-12-04" },
  { id: "c_007", credential: "Snowflake SnowPro Advanced — Architect", platform: "Snowflake", holder: "Aisha M.", status: "lapsing", expiresAt: "2026-06-21" },
  { id: "c_008", credential: "GCP Professional Cloud Architect", platform: "GCP", holder: "Hamza R.", status: "active", expiresAt: "2027-03-11" },
];

const ALLIANCE_CONFLICTS = [
  {
    id: "co_001",
    headline: "Quanta Systems pursuing the same sovereign-fund mandate solo",
    partnerFirm: "Quanta Systems",
    detectedAt: "2026-05-11",
    severity: "block",
    detail:
      "Quanta sales rep contacted the same buying-centre lead at the sovereign fund directly on 2026-05-09, after the joint discovery call. Conflicts with the signed alliance letter on jo_001.",
    recommendation:
      "Pause joint pursuit; Gökhan to escalate to Reem Al-Suwaidi this week. Re-confirm split or void the letter.",
  },
  {
    id: "co_002",
    headline: "Anchorline hired two ex-AICo associates — informational",
    partnerFirm: "Anchorline Advisors",
    detectedAt: "2026-04-22",
    severity: "inform",
    detail:
      "Anchorline's UK office hired two associates from AICo's London delivery pod over the last 6 months. No client-conflict signal yet; flagged for awareness only.",
    recommendation: "Note in next quarterly Alliance review. No action.",
  },
];

const STUDIO_ROLES = [
  {
    id: "ro_001",
    title: "AI Engineer — Lead",
    level: "Lead",
    location: "Dubai · hybrid",
    targetStart: "2026-08-01",
    urgency: "high",
    summary:
      "Owns the agent orchestration layer for client engagements. Lives inside the Atelier, ships to client.",
    activeCandidates: 6,
    panelTemplate: "ai_lead_v3",
    scorecardId: "sc_ai_lead_v3",
    takeHomeId: "th_atelier_agent_build",
  },
  {
    id: "ro_002",
    title: "Senior Manager — GCC Public Sector",
    level: "Senior Manager",
    location: "Riyadh · onsite",
    targetStart: "2026-09-15",
    urgency: "high",
    summary:
      "Engagement leadership for KSA sovereign-fund + ministry mandates. Arabic + English; PDPL fluency required.",
    activeCandidates: 4,
    panelTemplate: "sm_gcc_v2",
    scorecardId: "sc_sm_gcc_v2",
    takeHomeId: null,
  },
  {
    id: "ro_003",
    title: "Lead Designer — Product & Comms",
    level: "Lead",
    location: "Remote (GMT±3)",
    targetStart: "2026-07-15",
    urgency: "medium",
    summary:
      "Owns the Atelier UI plus client-facing artifacts. Equal parts product + comms design.",
    activeCandidates: 5,
    panelTemplate: "design_lead_v1",
    scorecardId: "sc_design_lead_v1",
    takeHomeId: "th_design_critique",
  },
  {
    id: "ro_004",
    title: "Consultant — AI Strategy",
    level: "Consultant",
    location: "Istanbul · hybrid",
    targetStart: "2026-10-01",
    urgency: "medium",
    summary:
      "Pursuit support + delivery on Türkiye-region engagements. 3–6 yrs strategy or applied AI experience.",
    activeCandidates: 8,
    panelTemplate: "consultant_v2",
    scorecardId: "sc_consultant_v2",
    takeHomeId: "th_case_2hr",
  },
];

const STUDIO_CANDIDATES = [
  { id: "ca_001", name: "Layla Mansour", currentRole: "Staff ML Engineer", currentEmployer: "Careem", source: "Pursuit Scout · GitHub talk", roleTitle: "AI Engineer — Lead", stage: "interview", activeOrPassive: "passive", roleMatchScore: 0.88, outreachHook: "Your KubeCon talk on agent eval harnesses is exactly the layer we're rebuilding next quarter." },
  { id: "ca_002", name: "Ahmed Saleh", currentRole: "Principal AI Engineer", currentEmployer: "STC Pay", source: "Referral · Hamza R.", roleTitle: "AI Engineer — Lead", stage: "reference", activeOrPassive: "active", roleMatchScore: 0.92, outreachHook: "Hamza pointed me to your work on the STC Pay routing redesign." },
  { id: "ca_003", name: "Nora Al-Otaibi", currentRole: "Senior Engagement Manager", currentEmployer: "BCG Riyadh", source: "Pursuit Scout · LinkedIn", roleTitle: "Senior Manager — GCC Public Sector", stage: "interview", activeOrPassive: "passive", roleMatchScore: 0.84, outreachHook: "Your Vision 2030 piece in Asharq mapped exactly to the mandate we're staffing." },
  { id: "ca_004", name: "Selin Yılmaz", currentRole: "Product Designer", currentEmployer: "Trendyol", source: "Pursuit Scout · Dribbble", roleTitle: "Lead Designer — Product & Comms", stage: "screening", activeOrPassive: "active", roleMatchScore: 0.79, outreachHook: "Your work on Trendyol's seller console reads like our Atelier brief." },
  { id: "ca_005", name: "Omar Halabi", currentRole: "Consultant", currentEmployer: "McKinsey Dubai", source: "Pursuit Scout · LinkedIn", roleTitle: "Consultant — AI Strategy", stage: "offer", activeOrPassive: "active", roleMatchScore: 0.86, outreachHook: "Saw you published on agent-orchestration cost models — same problem we're sizing." },
  { id: "ca_006", name: "Yara Khoury", currentRole: "Senior Consultant", currentEmployer: "Accenture", source: "Pursuit Scout · LinkedIn", roleTitle: "Consultant — AI Strategy", stage: "sourced", activeOrPassive: "passive", roleMatchScore: 0.71, outreachHook: "" },
  { id: "ca_007", name: "Burak Demir", currentRole: "Engineering Manager", currentEmployer: "Hepsiburada", source: "Referral · Yusuf Ç.", roleTitle: "AI Engineer — Lead", stage: "sourced", activeOrPassive: "passive", roleMatchScore: 0.74, outreachHook: "Yusuf flagged your work on the Hepsiburada search-ranking platform." },
];

const STUDIO_PANELS = [
  {
    id: "ip_001",
    candidateName: "Layla Mansour",
    roleTitle: "AI Engineer — Lead",
    scheduledFor: "2026-05-20",
    status: "scheduled",
    stages: [
      { stage: "screen", interviewer: "Hamza R.", durationMin: 45, focus: "scope + working style", score: null },
      { stage: "technical", interviewer: "Yusuf Ç.", durationMin: 75, focus: "agent eval harness deep-dive", score: null },
      { stage: "case", interviewer: "Aisha M.", durationMin: 60, focus: "scoping ambiguous client request", score: null },
      { stage: "partner", interviewer: "Mounir", durationMin: 45, focus: "judgment + bar-raise", score: null },
    ],
  },
  {
    id: "ip_002",
    candidateName: "Ahmed Saleh",
    roleTitle: "AI Engineer — Lead",
    scheduledFor: "2026-05-12",
    status: "completed",
    stages: [
      { stage: "screen", interviewer: "Hamza R.", durationMin: 45, focus: "scope + working style", score: 5 },
      { stage: "technical", interviewer: "Yusuf Ç.", durationMin: 75, focus: "agent orchestration design", score: 4 },
      { stage: "case", interviewer: "Aisha M.", durationMin: 60, focus: "scoping ambiguous client request", score: 5 },
      { stage: "partner", interviewer: "Gökhan", durationMin: 45, focus: "judgment + bar-raise", score: 4 },
    ],
  },
  {
    id: "ip_003",
    candidateName: "Nora Al-Otaibi",
    roleTitle: "Senior Manager — GCC Public Sector",
    scheduledFor: "2026-05-22",
    status: "scheduled",
    stages: [
      { stage: "screen", interviewer: "Mounir", durationMin: 45, focus: "scope + GCC context", score: null },
      { stage: "case", interviewer: "Gökhan", durationMin: 90, focus: "live mandate scoping", score: null },
      { stage: "partner", interviewer: "Mounir", durationMin: 45, focus: "trust + leadership", score: null },
    ],
  },
];

const STUDIO_REFS = [
  {
    id: "rf_001",
    candidateName: "Ahmed Saleh",
    refererName: "Khalid B. (former director, STC Pay)",
    relationship: "Direct manager · 2.5 years",
    callMode: "live",
    scheduledFor: "2026-05-15",
    completedAt: "2026-05-15",
    wouldRehire: "yes",
    fitForLevel: "above",
    headlineQuote:
      "If we'd held him a year longer he'd have been my deputy. He raised the bar of every engineer we put next to him.",
    inconsistencies: [],
  },
  {
    id: "rf_002",
    candidateName: "Ahmed Saleh",
    refererName: "Mariam F. (peer, STC Pay)",
    relationship: "Peer engineer · 1.5 years",
    callMode: "async_video",
    scheduledFor: "2026-05-16",
    completedAt: "2026-05-16",
    wouldRehire: "yes",
    fitForLevel: "at",
    headlineQuote:
      "Strong on systems thinking; can be quiet in larger rooms — but his writing is what wins arguments.",
    inconsistencies: [
      {
        claim: "Led 12-person team",
        evidence: "Mariam recalls 7 directs + 5 dotted-line.",
      },
    ],
  },
  {
    id: "rf_003",
    candidateName: "Layla Mansour",
    refererName: "(scheduled)",
    relationship: "Direct manager · Careem",
    callMode: "live",
    scheduledFor: "2026-05-23",
    completedAt: null,
    wouldRehire: null,
    fitForLevel: null,
    headlineQuote: "",
    inconsistencies: [],
  },
];

const STUDIO_OFFERS = [
  {
    id: "of_001",
    candidateName: "Omar Halabi",
    roleTitle: "Consultant — AI Strategy",
    jurisdiction: "UAE",
    startDate: "2026-07-15",
    totalAtTargetUsdK: 165,
    marketP25: 145,
    marketP75: 180,
    status: "sent",
    bandFlag: null,
  },
  {
    id: "of_002",
    candidateName: "Ahmed Saleh",
    roleTitle: "AI Engineer — Lead",
    jurisdiction: "KSA",
    startDate: "2026-08-15",
    totalAtTargetUsdK: 240,
    marketP25: 200,
    marketP75: 245,
    status: "draft",
    bandFlag: null,
  },
  {
    id: "of_003",
    candidateName: "Selin Yılmaz",
    roleTitle: "Lead Designer — Product & Comms",
    jurisdiction: "Türkiye",
    startDate: "2026-08-01",
    totalAtTargetUsdK: 92,
    marketP25: 88,
    marketP75: 110,
    status: "draft",
    bandFlag: "Below market p50 — Mounir to confirm before sending",
  },
];

const STUDIO_REFERRALS = [
  { id: "rr_001", referrer: "Hamza R.", candidate: "Ahmed Saleh", via: "ex-colleague at STC Pay", roleTitle: "AI Engineer — Lead", status: "interviewing" },
  { id: "rr_002", referrer: "Yusuf Ç.", candidate: "Burak Demir", via: "ex-colleague at Hepsiburada", roleTitle: "AI Engineer — Lead", status: "sourced" },
  { id: "rr_003", referrer: "Aisha M.", candidate: "Hala Khoury", via: "MIT cohort", roleTitle: "Consultant — AI Strategy", status: "hired" },
];

const GH_CONTROLS = [
  { id: "CC1.1", title: "Code of conduct exists, signed by every employee", framework: "SOC2", owner: "HR", status: "passing", lastCollectedAt: "2026-05-12", remediation: null },
  { id: "CC2.1", title: "Information security policy reviewed annually", framework: "SOC2", owner: "Compliance Officer", status: "passing", lastCollectedAt: "2026-05-01", remediation: null },
  { id: "CC6.1", title: "Logical access provisioning + deprovisioning controls", framework: "SOC2", owner: "Engineering", status: "passing", lastCollectedAt: "2026-05-13", remediation: null },
  { id: "CC6.2", title: "Quarterly user access review", framework: "SOC2", owner: "Compliance Officer", status: "stale", lastCollectedAt: "2026-04-08", remediation: "Q2 review due 2026-05-30" },
  { id: "CC6.6", title: "Encryption in transit + at rest enforced", framework: "SOC2", owner: "Engineering", status: "passing", lastCollectedAt: "2026-05-13", remediation: null },
  { id: "CC7.2", title: "System monitoring + anomaly detection", framework: "SOC2", owner: "Engineering", status: "passing", lastCollectedAt: "2026-05-13", remediation: null },
  { id: "CC7.3", title: "Incident response plan tested annually", framework: "SOC2", owner: "Compliance Officer", status: "gap", lastCollectedAt: "2025-11-04", remediation: "Tabletop scheduled 2026-06-12" },
  { id: "CC8.1", title: "Change management approval workflow", framework: "SOC2", owner: "Engineering", status: "passing", lastCollectedAt: "2026-05-13", remediation: null },
  { id: "A.5.1", title: "Information security policies (ISO)", framework: "ISO27001", owner: "Compliance Officer", status: "passing", lastCollectedAt: "2026-05-01", remediation: null },
  { id: "A.8.2", title: "Asset classification + handling", framework: "ISO27001", owner: "Compliance Officer", status: "gap", lastCollectedAt: "—", remediation: "Classification scheme drafted, rollout 2026-Q3" },
  { id: "A.12.3", title: "Backup integrity tested quarterly", framework: "ISO27001", owner: "Engineering", status: "passing", lastCollectedAt: "2026-04-15", remediation: null },
  { id: "A.16.1", title: "Incident management procedures", framework: "ISO27001", owner: "Compliance Officer", status: "passing", lastCollectedAt: "2026-05-09", remediation: null },
];

const GH_EVIDENCE = [
  { id: "ev_001", title: "Quarterly access review · 2026-Q1", kind: "access_review", controlIds: ["CC6.2"], collectedAt: "2026-04-08", freshness: "stale" },
  { id: "ev_002", title: "AWS CloudTrail logs · last 90d", kind: "audit_log", controlIds: ["CC6.1", "CC7.2"], collectedAt: "2026-05-13", freshness: "fresh" },
  { id: "ev_003", title: "Mandatory security training completion · 2026-Q2", kind: "training", controlIds: ["CC1.1"], collectedAt: "2026-05-10", freshness: "fresh" },
  { id: "ev_004", title: "Backup verification log · daily", kind: "backup_log", controlIds: ["A.12.3"], collectedAt: "2026-05-13", freshness: "fresh" },
  { id: "ev_005", title: "Pentest 2025-Q4 final report", kind: "pentest_report", controlIds: ["CC7.2"], collectedAt: "2025-12-15", freshness: "expired" },
  { id: "ev_006", title: "Encryption-at-rest config snapshot", kind: "config", controlIds: ["CC6.6"], collectedAt: "2026-05-13", freshness: "fresh" },
];

const GH_PENTESTS = [
  { id: "pt_001", engagement: "Atelier portal · external pentest 2026-Q1", vendor: "Bishop Fox", windowStart: "2026-02-10", windowEnd: "2026-02-28", findingsHigh: 2, findingsMed: 6, findingsLow: 9, remediated: 14, status: "remediating" },
  { id: "pt_002", engagement: "API server + Comms Indexer 2025-Q4", vendor: "NCC Group", windowStart: "2025-10-12", windowEnd: "2025-11-02", findingsHigh: 1, findingsMed: 4, findingsLow: 11, remediated: 16, status: "complete" },
];

const GH_VENDORS = [
  { id: "vd_001", vendor: "Anthropic", direction: "outbound", dataClass: "Confidential (no PII)", owner: "Engineering", risk: "low", renewsAt: "2026-09-30" },
  { id: "vd_002", vendor: "AWS (Bahrain region)", direction: "outbound", dataClass: "Confidential", owner: "Engineering", risk: "low", renewsAt: "2026-12-31" },
  { id: "vd_003", vendor: "Linear", direction: "outbound", dataClass: "Internal", owner: "Operations", risk: "low", renewsAt: "2026-08-12" },
  { id: "vd_004", vendor: "Notion", direction: "outbound", dataClass: "Internal", owner: "Operations", risk: "medium", renewsAt: "2026-07-04" },
  { id: "vd_005", vendor: "Quanta Systems (partner firm)", direction: "inbound+outbound", dataClass: "Confidential (joint engagements)", owner: "Compliance Officer", risk: "medium", renewsAt: "2027-01-15" },
];

const GH_INCIDENTS = [
  { id: "in_001", title: "Anomalous Atelier login from new geo · auto-contained", severity: "sev3", detectedAt: "2026-04-29 02:14", phase: "closed", summary: "Access Sentinel detected a successful login from Lagos, NG for a partner whose travel calendar showed Riyadh. Session revoked within 4 min; reset forced. Root cause: credential shared via WhatsApp screenshot during travel.", postmortemUrl: "/incidents/in_001/postmortem" },
  { id: "in_002", title: "Backup verification failure · object storage replica", severity: "sev2", detectedAt: "2026-03-11 06:42", phase: "closed", summary: "Cross-region replica fell behind by 4h after a misconfigured retention policy. Restored within RPO; remediation: replication monitor added.", postmortemUrl: "/incidents/in_002/postmortem" },
  { id: "in_003", title: "Customer-reported data export anomaly", severity: "sev2", detectedAt: "2026-05-08 10:22", phase: "eradicate", summary: "Engagement deliverable export included a row from a different engagement. Containment in progress; comms drafted, pending Partner sign-off.", postmortemUrl: null },
];

const GH_DSARS = [
  { id: "ds_001", subjectMasked: "subject_5b8…f12", jurisdiction: "KSA PDPL", requestKind: "access", intakeAt: "2026-05-08", statutoryDueAt: "2026-06-07", daysToDeadline: 24, phase: "discovery", discoveredArtifacts: 14 },
  { id: "ds_002", subjectMasked: "subject_a91…03c", jurisdiction: "UAE DIFC", requestKind: "delete", intakeAt: "2026-04-26", statutoryDueAt: "2026-05-26", daysToDeadline: 12, phase: "redact", discoveredArtifacts: 7 },
  { id: "ds_003", subjectMasked: "subject_1d4…7e9", jurisdiction: "GDPR", requestKind: "portability", intakeAt: "2026-04-19", statutoryDueAt: "2026-05-19", daysToDeadline: 5, phase: "respond", discoveredArtifacts: 21 },
];

const GH_BACKUPS = [
  { id: "bk_001", store: "Postgres · Atelier primary", kind: "postgres", lastSuccessAt: "2026-05-13 04:00", status: "ok", rtoMinutes: 30, rpoMinutes: 5 },
  { id: "bk_002", store: "Postgres · Comms Indexer", kind: "postgres", lastSuccessAt: "2026-05-13 04:15", status: "ok", rtoMinutes: 45, rpoMinutes: 5 },
  { id: "bk_003", store: "Object storage · engagement deliverables", kind: "object_storage", lastSuccessAt: "2026-05-13 03:30", status: "ok", rtoMinutes: 60, rpoMinutes: 60 },
  { id: "bk_004", store: "Object storage · Atelier IP catalog", kind: "object_storage", lastSuccessAt: "2026-05-12 03:30", status: "warning", rtoMinutes: 60, rpoMinutes: 60 },
  { id: "bk_005", store: "Code repos · GitHub mirror to S3", kind: "repo", lastSuccessAt: "2026-05-13 02:00", status: "ok", rtoMinutes: 120, rpoMinutes: 1440 },
];

const IP_CODE = [
  { id: "ipca_001", name: "atelier-agents (runner + lifecycle helper)", repoUrl: "github.com/aico/atelier-agents", owner: "Hamza R.", license: "AICo Internal", summary: "Shared lifecycle runner that every Atelier agent composes against.", usedInEngagements: ["eng_alpha", "eng_beta", "eng_arcelik"], freshness: "fresh" },
  { id: "ipca_002", name: "comms-indexer", repoUrl: "github.com/aico/comms-indexer", owner: "Yusuf Ç.", license: "AICo Internal", summary: "Mail / IM corpus indexer used by Pursuit Scout, DSAR Concierge, and Theme Curator.", usedInEngagements: ["eng_alpha", "eng_gamma"], freshness: "fresh" },
  { id: "ipca_003", name: "pricing-sandbox (margin + bundle simulator)", repoUrl: "github.com/aico/pricing-sandbox", owner: "Aisha M.", license: "AICo Internal", summary: "Standalone simulator the Pricing Strategist composes against. Reused on Arçelik demo.", usedInEngagements: ["eng_arcelik", "eng_delta"], freshness: "stale" },
  { id: "ipca_004", name: "audit-pdf", repoUrl: "github.com/aico/audit-pdf", owner: "Yusuf Ç.", license: "MIT (open-sourced)", summary: "PDF generator for engagement audit packs. Open-sourced 2025-Q4.", usedInEngagements: ["eng_alpha", "eng_beta", "eng_gamma", "eng_delta"], freshness: "fresh" },
  { id: "ipca_005", name: "winloss-clusterer", repoUrl: "github.com/aico/winloss-clusterer", owner: "Mounir", license: "AICo Internal", summary: "Theme Curator's clustering primitive over win/loss debriefs.", usedInEngagements: [], freshness: "stale" },
];

const IP_OSS = [
  { id: "od_001", name: "react", version: "19.0.0", ecosystem: "npm", license: "MIT", compatibility: "ok", repos: ["atelier", "maven-ai"], rationale: null, exceptionUntil: null },
  { id: "od_002", name: "drizzle-orm", version: "0.40.0", ecosystem: "npm", license: "Apache-2.0", compatibility: "ok", repos: ["api-server"], rationale: null, exceptionUntil: null },
  { id: "od_003", name: "marked", version: "12.0.2", ecosystem: "npm", license: "MIT", compatibility: "ok", repos: ["api-server"], rationale: null, exceptionUntil: null },
  { id: "od_004", name: "node-postgres", version: "8.11.0", ecosystem: "npm", license: "MIT", compatibility: "ok", repos: ["api-server"], rationale: null, exceptionUntil: null },
  { id: "od_005", name: "nice-pkg-with-gpl", version: "1.4.2", ecosystem: "npm", license: "GPL-3.0", compatibility: "block", repos: ["pricing-sandbox"], rationale: "Strong copyleft incompatible with proprietary client deliverable scope.", exceptionUntil: null },
  { id: "od_006", name: "icu4c-bindings", version: "0.7.1", ecosystem: "npm", license: "Unknown", compatibility: "block", repos: ["atelier"], rationale: "License classification missing — pending vendor response.", exceptionUntil: null },
  { id: "od_007", name: "weak-copyleft-lib", version: "2.0.0", ecosystem: "npm", license: "MPL-2.0", compatibility: "warn", repos: ["audit-pdf"], rationale: "Permitted with notice — notice block needs to be added to release.", exceptionUntil: "2026-08-01" },
];

const IP_DEMOS = [
  { id: "de_001", name: "Arçelik · Pricing Intelligence", url: "demo.aico.com/arcelik", owner: "Aisha M.", lastDeployAt: "2026-05-10", shows: "Margin simulator, bundle optimiser, dealer portal — full demo path.", uptime30d: 0.998, scriptDrift: 0, freshness: "fresh" },
  { id: "de_002", name: "Atelier · Employee Portal", url: "demo.aico.com/atelier", owner: "Hamza R.", lastDeployAt: "2026-05-13", shows: "Full-firm Atelier walkthrough including v4 Comms Indexer.", uptime30d: 0.991, scriptDrift: 1, freshness: "fresh" },
  { id: "de_003", name: "Maven AI · public marketing", url: "maven.ai", owner: "Mounir", lastDeployAt: "2026-04-22", shows: "Public-facing brand site with case index.", uptime30d: 1.0, scriptDrift: 0, freshness: "fresh" },
  { id: "de_004", name: "Pricing Strategist · standalone POV", url: "demo.aico.com/pricing-pov", owner: "Aisha M.", lastDeployAt: "2026-02-18", shows: "Pricing Strategist agent in isolation with sample mandate.", uptime30d: 0.967, scriptDrift: 3, freshness: "stale" },
  { id: "de_005", name: "Win-Loss Library · sample", url: "demo.aico.com/winloss-sample", owner: "Mounir", lastDeployAt: "2025-11-04", shows: "Win-Loss debrief flow with 6 sample debriefs.", uptime30d: 0.882, scriptDrift: 5, freshness: "broken" },
];

const IP_GRANTS = [
  { id: "ig_001", assetName: "atelier-agents (runner)", grantee: "Arçelik", engagementId: "eng_arcelik", grantedAt: "2026-03-12", expiresAt: "2027-03-12", scope: "Internal use within Arçelik for the duration of the engagement; no redistribution.", approvedBy: "Mounir", status: "active" },
  { id: "ig_002", assetName: "pricing-sandbox", grantee: "Arçelik", engagementId: "eng_arcelik", grantedAt: "2026-03-12", expiresAt: "2026-09-12", scope: "Single-tenant deployment; source escrow on engagement end.", approvedBy: "Mounir", status: "expiring" },
  { id: "ig_003", assetName: "comms-indexer", grantee: "GCC sovereign fund (engagement alpha)", engagementId: "eng_alpha", grantedAt: "2025-09-04", expiresAt: "2026-09-04", scope: "Internal use within engagement scope; no third-party access.", approvedBy: "Gökhan", status: "expiring" },
  { id: "ig_004", assetName: "audit-pdf", grantee: "Open source · MIT", engagementId: "—", grantedAt: "2025-11-15", expiresAt: "perpetual", scope: "MIT release; firm retains copyright on reference brand assets used in templates.", approvedBy: "Mounir", status: "active" },
];

export async function ensureAtelierV5Seed(): Promise<void> {
  try {
    await upsertById(atelierPressEditorialCalendar, PRESS_EDITORIAL);
    await upsertById(atelierPressInFlightContent, PRESS_IN_FLIGHT);
    await upsertById(atelierPressPartnerCadence, PRESS_PARTNER_CADENCE);
    await upsertById(atelierPressNewsletter, PRESS_NEWSLETTER);
    await upsertById(atelierPressSpeakingOpportunities, PRESS_SPEAKING);
    await upsertById(atelierPressMentions, PRESS_MENTIONS);

    await upsertById(atelierAlliancePartnerFirms, ALLIANCE_FIRMS);
    await upsertById(atelierAllianceJointPipeline, ALLIANCE_PIPELINE);
    await upsertById(atelierAllianceCertifications, ALLIANCE_CERTS);
    await upsertById(atelierAllianceConflicts, ALLIANCE_CONFLICTS);

    await upsertById(atelierStudioOpenRoles, STUDIO_ROLES);
    await upsertById(atelierStudioCandidates, STUDIO_CANDIDATES);
    await upsertById(atelierStudioInterviewPanels, STUDIO_PANELS);
    await upsertById(atelierStudioReferenceChecks, STUDIO_REFS);
    await upsertById(atelierStudioOffers, STUDIO_OFFERS);
    await upsertById(atelierStudioReferrals, STUDIO_REFERRALS);

    await upsertById(atelierGuardhouseControls, GH_CONTROLS);
    await upsertById(atelierGuardhouseEvidence, GH_EVIDENCE);
    await upsertById(atelierGuardhousePentests, GH_PENTESTS);
    await upsertById(atelierGuardhouseVendors, GH_VENDORS);
    await upsertById(atelierGuardhouseIncidents, GH_INCIDENTS);
    await upsertById(atelierGuardhouseDsars, GH_DSARS);
    await upsertById(atelierGuardhouseBackups, GH_BACKUPS);

    await upsertById(atelierIpCodeAssets, IP_CODE);
    await upsertById(atelierIpOssDependencies, IP_OSS);
    await upsertById(atelierIpDemoEnvironments, IP_DEMOS);
    await upsertById(atelierIpLicenseGrants, IP_GRANTS);

    logger.info("[atelier] v5 seed (press/alliances/studio/guardhouse/ip) complete");
  } catch (err) {
    logger.error({ err }, "[atelier] v5 seed failed");
  }
}
