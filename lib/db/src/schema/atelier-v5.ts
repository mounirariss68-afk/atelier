/**
 * THE ATELIER — v5 Scale & Trust schema (Task #354).
 *
 * Persistence for Press, Alliances, Studio, Guardhouse, and IP Catalog
 * data that previously lived as TypeScript seed files in
 * artifacts/atelier/src/data/{press,alliances,studio,guardhouse,ip}-seed.ts.
 *
 * All tables follow the existing Atelier conventions:
 *   - text PKs (deterministic slugs so seed/audit traffic stays readable)
 *   - org_id default 'aico' (multi-tenant scope, enforced at app layer)
 *   - created_at / updated_at / created_by_user_id / deleted_at
 *
 * Engagement scoping: none of these v5 modules carry an engagement_id.
 * They are firm-wide knowledge surfaces. Per-engagement narrowing for
 * the IP licensing log is preserved as a free-text engagement_id ref so
 * the existing /atelier/ip page can keep showing it.
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
} from "drizzle-orm/pg-core";

const ORG = (name: string) => text(name).notNull().default("aico");
const COMMON = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: text("created_by_user_id"),
  deletedAt: timestamp("deleted_at"),
};

// ============================================================
// PRESS
// ============================================================

export const atelierPressEditorialCalendar = pgTable(
  "atelier_press_editorial_calendar",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    workingTitle: text("working_title").notNull(),
    publication: text("publication").notNull(),
    byline: text("byline").notNull(),
    publishOn: text("publish_on").notNull(),
    status: text("status").notNull(),
    thesis: text("thesis").notNull().default(""),
    themeId: text("theme_id"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_press_ec_org").on(t.orgId),
    index("idx_atelier_press_ec_status").on(t.status),
  ],
);

export const atelierPressInFlightContent = pgTable(
  "atelier_press_in_flight_content",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    byline: text("byline").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    sourceArtifact: text("source_artifact").notNull().default(""),
    phase: text("phase").notNull(),
    citationCoverage: doublePrecision("citation_coverage").notNull().default(0),
    ...COMMON,
  },
  (t) => [index("idx_atelier_press_if_org").on(t.orgId)],
);

export const atelierPressPartnerCadence = pgTable(
  "atelier_press_partner_cadence",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    partnerId: text("partner_id").notNull(),
    partnerName: text("partner_name").notNull(),
    voiceProfile: text("voice_profile").notNull(),
    targetPer90d: integer("target_per_90d").notNull().default(0),
    postsThis90d: integer("posts_this_90d").notNull().default(0),
    cadenceMet: boolean("cadence_met").notNull().default(false),
    queue: jsonb("queue")
      .$type<Array<{
        id: string;
        status: string;
        voiceMatchScore: number;
        draftBody: string;
      }>>()
      .notNull()
      .default([]),
    ...COMMON,
  },
  (t) => [index("idx_atelier_press_pc_org").on(t.orgId)],
);

export const atelierPressNewsletter = pgTable(
  "atelier_press_newsletter",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    totalSubscribers: integer("total_subscribers").notNull().default(0),
    netGrowthLast90d: integer("net_growth_last_90d").notNull().default(0),
    avgOpenRate: doublePrecision("avg_open_rate").notNull().default(0),
    avgClickRate: doublePrecision("avg_click_rate").notNull().default(0),
    currentIssue: jsonb("current_issue")
      .$type<{
        id: string;
        subjectLine: string;
        status: string;
        scheduledSendAt: string;
        sections: Array<{ id: string; label: string; summary: string }>;
      } | null>()
      .default(null),
    ...COMMON,
  },
  (t) => [index("idx_atelier_press_nl_org").on(t.orgId)],
);

export const atelierPressSpeakingOpportunities = pgTable(
  "atelier_press_speaking_opportunities",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    event: text("event").notNull(),
    kind: text("kind").notNull(),
    location: text("location").notNull(),
    date: text("date").notNull(),
    audience: text("audience").notNull().default(""),
    ask: text("ask").notNull().default(""),
    decision: text("decision").notNull(),
    owner: text("owner").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_press_sp_org").on(t.orgId)],
);

export const atelierPressMentions = pgTable(
  "atelier_press_mentions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    headline: text("headline").notNull(),
    publication: text("publication").notNull(),
    date: text("date").notNull(),
    about: text("about").notNull().default(""),
    summary: text("summary").notNull().default(""),
    sentiment: text("sentiment").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_press_pm_org").on(t.orgId)],
);

// ============================================================
// ALLIANCES
// ============================================================

// Task #513 — `atelier_alliance_partner_firms` was retired. The roster
// registry `atelier_partner_firms` (schema/atelier.ts) is the single
// canonical partner-firm table; it carries the alliance fields now.

// Identify — minimal real target-partner pipeline (pre-registry firms).
// Status: researching | outreach | intro_call | evaluating | promoted | dropped
export const atelierPartnerTargets = pgTable(
  "atelier_partner_targets",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    ecosystem: text("ecosystem"),
    country: text("country"),
    thesis: text("thesis").notNull().default(""),
    tierHypothesis: text("tier_hypothesis"), // strategic | preferred | transactional
    priority: text("priority").notNull().default("med"), // high | med | low
    status: text("status").notNull().default("researching"),
    ownerUserId: text("owner_user_id"),
    nextStep: text("next_step"),
    lastContactAt: text("last_contact_at"),
    // Set when promoted into the registry — links to atelier_partner_firms.id.
    promotedFirmId: text("promoted_firm_id"),
    ...COMMON,
  },
  (t) => [index("idx_atelier_partner_targets_org").on(t.orgId)],
);

// Co-sell — joint pipeline entries link a real CRM opportunity to a
// registry partner firm (Task #513). Client + stage + value derive from
// the opportunity; only the split economics live here.
export const atelierAllianceJointPipeline = pgTable(
  "atelier_alliance_joint_pipeline",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id").notNull(),
    partnerFirmId: text("partner_firm_id").notNull(),
    leadParty: text("lead_party").notNull().default("cognirise"), // cognirise | partner | joint
    cognirisePct: integer("cognirise_pct").notNull().default(0),
    partnerPct: integer("partner_pct").notNull().default(0),
    splitRationale: text("split_rationale").notNull().default(""),
    // none | drafting | signed
    allianceLetterStatus: text("alliance_letter_status").notNull().default("none"),
    // partner_sourced marks the attribution on the opportunity view.
    partnerSourced: boolean("partner_sourced").notNull().default(false),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_alliance_jp_org").on(t.orgId),
    index("idx_atelier_alliance_jp_opp").on(t.opportunityId),
    index("idx_atelier_alliance_jp_firm").on(t.partnerFirmId),
  ],
);

export const atelierAllianceCertifications = pgTable(
  "atelier_alliance_certifications",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(), // registry FK (Task #513)
    credential: text("credential").notNull(),
    platform: text("platform").notNull(),
    // Firm-level when null; otherwise a roster person id (employee/PFR).
    holderPersonId: text("holder_person_id"),
    holder: text("holder").notNull().default(""), // display label
    status: text("status").notNull().default("active"), // active | lapsing | lapsed
    expiresAt: text("expires_at"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_alliance_cert_org").on(t.orgId),
    index("idx_atelier_alliance_cert_firm").on(t.partnerFirmId),
  ],
);

export const atelierAllianceConflicts = pgTable(
  "atelier_alliance_conflicts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(), // registry FK (Task #513)
    headline: text("headline").notNull(),
    detectedAt: text("detected_at").notNull(),
    severity: text("severity").notNull().default("med"), // high | med | low
    detail: text("detail").notNull().default(""),
    recommendation: text("recommendation").notNull().default(""),
    status: text("status").notNull().default("open"), // open | resolved
    resolvedAt: text("resolved_at"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_alliance_conf_org").on(t.orgId),
    index("idx_atelier_alliance_conf_firm").on(t.partnerFirmId),
  ],
);

// ============================================================
// STUDIO
// ============================================================

export const atelierStudioOpenRoles = pgTable(
  "atelier_studio_open_roles",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    title: text("title").notNull(),
    level: text("level").notNull(),
    location: text("location").notNull(),
    targetStart: text("target_start").notNull(),
    urgency: text("urgency").notNull(),
    summary: text("summary").notNull().default(""),
    // Task #125 — open | closed | filled
    status: text("status").notNull().default("open"),
    activeCandidates: integer("active_candidates").notNull().default(0),
    panelTemplate: text("panel_template").notNull().default(""),
    scorecardId: text("scorecard_id").notNull().default(""),
    takeHomeId: text("take_home_id"),
    ...COMMON,
  },
  (t) => [index("idx_atelier_studio_roles_org").on(t.orgId)],
);

export const atelierStudioCandidates = pgTable(
  "atelier_studio_candidates",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    // Task #125 — contact + linkage fields for a working hiring flow.
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    notes: text("notes").notNull().default(""),
    roleId: text("role_id"),
    currentRole: text("current_role").notNull().default(""),
    currentEmployer: text("current_employer").notNull().default(""),
    source: text("source").notNull().default(""),
    roleTitle: text("role_title").notNull(),
    stage: text("stage").notNull(),
    activeOrPassive: text("active_or_passive").notNull(),
    roleMatchScore: doublePrecision("role_match_score").notNull().default(0),
    outreachHook: text("outreach_hook").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_studio_cand_org").on(t.orgId),
    index("idx_atelier_studio_cand_stage").on(t.stage),
  ],
);

export const atelierStudioInterviewPanels = pgTable(
  "atelier_studio_interview_panels",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    candidateName: text("candidate_name").notNull(),
    // Task #125 — link to atelier_studio_candidates.
    candidateId: text("candidate_id"),
    roleTitle: text("role_title").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    status: text("status").notNull(),
    stages: jsonb("stages")
      .$type<Array<{
        stage: string;
        interviewer: string;
        durationMin: number;
        focus: string;
        score: number | null;
        notes?: string | null;
      }>>()
      .notNull()
      .default([]),
    ...COMMON,
  },
  (t) => [index("idx_atelier_studio_panels_org").on(t.orgId)],
);

export const atelierStudioReferenceChecks = pgTable(
  "atelier_studio_reference_checks",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    candidateName: text("candidate_name").notNull(),
    refererName: text("referer_name").notNull(),
    relationship: text("relationship").notNull().default(""),
    callMode: text("call_mode").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    completedAt: text("completed_at"),
    wouldRehire: text("would_rehire"),
    fitForLevel: text("fit_for_level"),
    headlineQuote: text("headline_quote").notNull().default(""),
    inconsistencies: jsonb("inconsistencies")
      .$type<Array<{ claim: string; evidence: string }>>()
      .notNull()
      .default([]),
    ...COMMON,
  },
  (t) => [index("idx_atelier_studio_refs_org").on(t.orgId)],
);

export const atelierStudioOffers = pgTable(
  "atelier_studio_offers",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    candidateName: text("candidate_name").notNull(),
    // Task #125 — candidate linkage + joiner handoff traceability.
    candidateId: text("candidate_id"),
    joinerUserId: text("joiner_user_id"),
    roleTitle: text("role_title").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    startDate: text("start_date").notNull(),
    totalAtTargetUsdK: integer("total_at_target_usd_k").notNull().default(0),
    marketP25: integer("market_p25").notNull().default(0),
    marketP75: integer("market_p75").notNull().default(0),
    status: text("status").notNull(),
    bandFlag: text("band_flag"),
    ...COMMON,
  },
  (t) => [index("idx_atelier_studio_offers_org").on(t.orgId)],
);

export const atelierStudioReferrals = pgTable(
  "atelier_studio_referrals",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    referrer: text("referrer").notNull(),
    candidate: text("candidate").notNull(),
    via: text("via").notNull().default(""),
    roleTitle: text("role_title").notNull(),
    status: text("status").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_studio_refrals_org").on(t.orgId)],
);

// ============================================================
// GUARDHOUSE
// ============================================================

export const atelierGuardhouseControls = pgTable(
  "atelier_guardhouse_controls",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    title: text("title").notNull(),
    framework: text("framework").notNull(),
    owner: text("owner").notNull(),
    status: text("status").notNull(),
    lastCollectedAt: text("last_collected_at").notNull().default(""),
    remediation: text("remediation"),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_gh_controls_org").on(t.orgId),
    index("idx_atelier_gh_controls_status").on(t.status),
  ],
);

export const atelierGuardhouseEvidence = pgTable(
  "atelier_guardhouse_evidence",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    controlIds: jsonb("control_ids").$type<string[]>().notNull().default([]),
    collectedAt: text("collected_at").notNull(),
    freshness: text("freshness").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_gh_evidence_org").on(t.orgId)],
);

export const atelierGuardhousePentests = pgTable(
  "atelier_guardhouse_pentests",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagement: text("engagement").notNull(),
    vendor: text("vendor").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    findingsHigh: integer("findings_high").notNull().default(0),
    findingsMed: integer("findings_med").notNull().default(0),
    findingsLow: integer("findings_low").notNull().default(0),
    remediated: integer("remediated").notNull().default(0),
    status: text("status").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_gh_pentests_org").on(t.orgId)],
);

export const atelierGuardhouseVendors = pgTable(
  "atelier_guardhouse_vendors",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    vendor: text("vendor").notNull(),
    direction: text("direction").notNull(),
    dataClass: text("data_class").notNull(),
    owner: text("owner").notNull(),
    risk: text("risk").notNull(),
    renewsAt: text("renews_at").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_gh_vendors_org").on(t.orgId)],
);

export const atelierGuardhouseIncidents = pgTable(
  "atelier_guardhouse_incidents",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    title: text("title").notNull(),
    severity: text("severity").notNull(),
    detectedAt: text("detected_at").notNull(),
    phase: text("phase").notNull(),
    summary: text("summary").notNull().default(""),
    postmortemUrl: text("postmortem_url"),
    ...COMMON,
  },
  (t) => [index("idx_atelier_gh_incidents_org").on(t.orgId)],
);

export const atelierGuardhouseDsars = pgTable(
  "atelier_guardhouse_dsars",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    subjectMasked: text("subject_masked").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    requestKind: text("request_kind").notNull(),
    intakeAt: text("intake_at").notNull(),
    statutoryDueAt: text("statutory_due_at").notNull(),
    daysToDeadline: integer("days_to_deadline").notNull().default(0),
    phase: text("phase").notNull(),
    discoveredArtifacts: integer("discovered_artifacts").notNull().default(0),
    ...COMMON,
  },
  (t) => [index("idx_atelier_gh_dsars_org").on(t.orgId)],
);

export const atelierGuardhouseBackups = pgTable(
  "atelier_guardhouse_backups",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    store: text("store").notNull(),
    kind: text("kind").notNull(),
    lastSuccessAt: text("last_success_at").notNull(),
    status: text("status").notNull(),
    rtoMinutes: integer("rto_minutes").notNull().default(0),
    rpoMinutes: integer("rpo_minutes").notNull().default(0),
    ...COMMON,
  },
  (t) => [index("idx_atelier_gh_backups_org").on(t.orgId)],
);

// ============================================================
// IP CATALOG
// ============================================================

export const atelierIpCodeAssets = pgTable(
  "atelier_ip_code_assets",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    repoUrl: text("repo_url").notNull(),
    owner: text("owner").notNull(),
    license: text("license").notNull(),
    summary: text("summary").notNull().default(""),
    usedInEngagements: jsonb("used_in_engagements")
      .$type<string[]>()
      .notNull()
      .default([]),
    freshness: text("freshness").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_ip_code_org").on(t.orgId)],
);

export const atelierIpOssDependencies = pgTable(
  "atelier_ip_oss_dependencies",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    version: text("version").notNull(),
    ecosystem: text("ecosystem").notNull(),
    license: text("license").notNull(),
    compatibility: text("compatibility").notNull(),
    repos: jsonb("repos").$type<string[]>().notNull().default([]),
    rationale: text("rationale"),
    exceptionUntil: text("exception_until"),
    ...COMMON,
  },
  (t) => [index("idx_atelier_ip_oss_org").on(t.orgId)],
);

export const atelierIpDemoEnvironments = pgTable(
  "atelier_ip_demo_environments",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    url: text("url").notNull(),
    owner: text("owner").notNull(),
    lastDeployAt: text("last_deploy_at").notNull(),
    shows: text("shows").notNull().default(""),
    uptime30d: doublePrecision("uptime_30d").notNull().default(0),
    scriptDrift: integer("script_drift").notNull().default(0),
    freshness: text("freshness").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_ip_demos_org").on(t.orgId)],
);

export const atelierIpLicenseGrants = pgTable(
  "atelier_ip_license_grants",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    assetName: text("asset_name").notNull(),
    grantee: text("grantee").notNull(),
    engagementId: text("engagement_id").notNull().default("—"),
    grantedAt: text("granted_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    scope: text("scope").notNull().default(""),
    approvedBy: text("approved_by").notNull(),
    status: text("status").notNull(),
    ...COMMON,
  },
  (t) => [index("idx_atelier_ip_grants_org").on(t.orgId)],
);
