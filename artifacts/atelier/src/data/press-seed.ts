// Seed data for the Press route (v5). Realistic mock content used by the
// PressIndex view. When Press routes are wired into the API server, this
// file gets replaced with a `useAtelierListPressX` hook.

export const EDITORIAL_CALENDAR = [
  {
    id: "ec_001",
    workingTitle: "The GCC AI capex bubble — a four-quarter view",
    publication: "MEED",
    byline: "Gökhan",
    publishOn: "2026-06-12",
    status: "scheduled",
    thesis: "Capex commitments outran usable capacity by roughly two quarters; the correction shows up in deal renewal terms, not headlines.",
    themeId: "theme_capex_correction",
  },
  {
    id: "ec_002",
    workingTitle: "Why responsible-AI playbooks fail in family offices",
    publication: "AICo Field Notes",
    byline: "Mounir",
    publishOn: "2026-06-19",
    status: "drafting",
    thesis: "The 'committee + framework' model assumes a CIO. Family offices have a chairman; the unit of governance is different.",
    themeId: "theme_governance_misread",
  },
  {
    id: "ec_003",
    workingTitle: "What KSA PDPL actually changes for cross-border AI vendors",
    publication: "TechCrunch ME",
    byline: "Mounir",
    publishOn: "2026-07-03",
    status: "outlined",
    thesis: "The localisation read is wrong. The consequential clauses are around purpose limitation and downstream model use.",
    themeId: "theme_pdpl_misread",
  },
  {
    id: "ec_004",
    workingTitle: "Pricing AI work when the unit isn't a person-week",
    publication: "AICo Field Notes",
    byline: "Gökhan",
    publishOn: "2026-07-17",
    status: "candidate",
    thesis: "T&M assumes labour as the binding constraint. Capability density is the new binding constraint; pricing has to follow.",
    themeId: "theme_post_tm_pricing",
  },
];

export const IN_FLIGHT_CONTENT = [
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

export const PARTNER_POSTING_CADENCE = [
  {
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
        draftBody: "Everyone is talking about responsible-AI committees. The harder question: who owns the model when the committee disagrees?",
      },
      {
        id: "lq_002",
        status: "draft",
        voiceMatchScore: 0.78,
        draftBody: "Three weeks inside a family office told me what no GCC playbook will: the chairman is the policy.",
      },
    ],
  },
  {
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
        draftBody: "Q1 GCC AI deal renewals came in at 76% of original ACV; the gap shows up in scope, not price. The next datapoint to watch is Q2 utilisation.",
      },
    ],
  },
];

export const NEWSLETTER_SUBSCRIBERS = {
  totalSubscribers: 4_312,
  netGrowthLast90d: 318,
  avgOpenRate: 0.41,
  avgClickRate: 0.061,
  currentIssue: {
    id: "fn_2026_06",
    subjectLine: "Field Notes · June 2026 — the capex correction lands",
    status: "assembling",
    scheduledSendAt: "2026-06-04 08:00 GST",
    sections: [
      { id: "editor", label: "Editor's Note", summary: "Mounir · 80 words" },
      { id: "what_we_seeing", label: "What we're seeing", summary: "3 themes from Theme Curator" },
      { id: "piece", label: "A piece worth your time", summary: "Gökhan · capex feature" },
      { id: "field_log", label: "Field log", summary: "3 engagements went public" },
      { id: "hiring", label: "What we're hiring for", summary: "AI Engineer · Lead Designer" },
    ],
  },
};

export const SPEAKING_OPPORTUNITIES = [
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

export const PRESS_MENTIONS = [
  {
    id: "pm_001",
    headline: "AICo's Mounir on why GCC AI policy is being mis-read",
    publication: "MEED",
    date: "2026-05-12",
    about: "Mounir, partner_quote",
    summary: "Mounir quoted on the gap between the AI policy text and the procurement reality at GCC sovereign funds. Tone: authoritative.",
    sentiment: "positive",
  },
  {
    id: "pm_002",
    headline: "Bain pushes responsible-AI framework for the Gulf",
    publication: "FT",
    date: "2026-05-09",
    about: "competitor",
    summary: "Bain launched a 50-page responsible-AI playbook aimed at the GCC; reception muted. Implication for AICo: differentiate on engagement-tested rather than framework-first.",
    sentiment: "neutral",
  },
  {
    id: "pm_003",
    headline: "The boutique consultancies eating tier-1 AI work",
    publication: "Sifted",
    date: "2026-04-29",
    about: "AICo, named",
    summary: "Feature naming AICo among five firms displacing tier-1 incumbents on AI mandates. Tone: positive.",
    sentiment: "positive",
  },
  {
    id: "pm_004",
    headline: "AI consultancy spend: where the money actually went",
    publication: "Bloomberg ME",
    date: "2026-04-22",
    about: "industry",
    summary: "Industry-wide spend analysis. AICo not named but cited indirectly in 'boutique cohort'. Sentiment toward boutiques: neutral-positive.",
    sentiment: "neutral",
  },
];
