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

/**
 * THE ATELIER — Drizzle schema (MVP foundation, spec §10)
 *
 * Every table carries id, org_id, created_at, updated_at, created_by_user_id,
 * and a soft-delete (deleted_at). Row-level security policies enforce org_id
 * (and engagement_id ACL where relevant) — RLS policies are applied via
 * `lib/db/src/atelier-rls.sql` after `pnpm --filter @workspace/db run push`.
 *
 * NOTE: For MVP we use text PKs (deterministic slugs) so seed data and
 * cross-table references stay readable in the audit feed. UUIDs can be
 * substituted later behind the same column type.
 */

const ORG = (name: string) => text(name).notNull().default("aico");

// ============================================================
// USERS / PERSONAS
// ============================================================
export const atelierUsers = pgTable(
  "atelier_users",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    initials: text("initials").notNull(),
    role: text("role").notNull(), // partner | engagement_lead | sme | ai_engineer | business_developer
    roleLabel: text("role_label").notNull(),
    title: text("title").notNull(),
    avatarUrl: text("avatar_url"),
    permissions: jsonb("permissions").notNull().$type<string[]>().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_users_org").on(t.orgId),
    index("idx_atelier_users_role").on(t.role),
  ],
);

// ============================================================
// ACCOUNTS
// ============================================================
export const atelierAccounts = pgTable(
  "atelier_accounts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    country: text("country").notNull(),
    sector: text("sector").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_accounts_org").on(t.orgId)],
);

// ============================================================
// OPPORTUNITIES
// ============================================================
export const atelierOpportunities = pgTable(
  "atelier_opportunities",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    accountId: text("account_id").notNull(),
    buyerPersona: text("buyer_persona"),
    offeringAnchor: text("offering_anchor"),
    plmStage: text("plm_stage").notNull(),
    partnerOwnerId: text("partner_owner_id").notNull(),
    engagementLeadId: text("engagement_lead_id").notNull(),
    dealSizeHypothesis: doublePrecision("deal_size_hypothesis").notNull(),
    probabilityPct: doublePrecision("probability_pct").notNull(),
    qualify5c: jsonb("qualify_5c").$type<{
      client?: string;
      competition?: string;
      capability?: string;
      capacity?: string;
      contract?: string;
    }>(),
    goNoGoDecision: jsonb("go_no_go_decision").$type<{
      decision: "go" | "no_go";
      decider: string;
      rationale: string;
      ts: string;
    } | null>(),
    nextMilestone: text("next_milestone").notNull(),
    nextMilestoneDate: text("next_milestone_date"),
    sourceLead: text("source_lead").notNull(),
    daysInStage: integer("days_in_stage").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_opps_org").on(t.orgId),
    index("idx_atelier_opps_stage").on(t.plmStage),
    index("idx_atelier_opps_account").on(t.accountId),
  ],
);

// ============================================================
// ENGAGEMENT ACCESS (engagement-id ACL partition)
// ============================================================
// Non-partner personas only see engagements they have an explicit
// access row for. Partners bypass this in route logic.
export const atelierEngagementAccess = pgTable(
  "atelier_engagement_access",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("member"), // partner_owner | lead | member
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("uniq_atelier_eng_access").on(t.engagementId, t.userId),
    index("idx_atelier_eng_access_user").on(t.userId),
  ],
);

// ============================================================
// ENGAGEMENTS
// ============================================================
export const atelierEngagements = pgTable(
  "atelier_engagements",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    opportunityId: text("opportunity_id"),
    accountId: text("account_id").notNull(),
    plmStage: text("plm_stage").notNull(), // mobilize | deliver | compound | closed
    partnerOwnerId: text("partner_owner_id").notNull(),
    engagementLeadId: text("engagement_lead_id").notNull(),
    charter: jsonb("charter").$type<{
      objectives: string[];
      scope: string[];
      outOfScope: string[];
      successMetrics: { name: string; baseline: string; target: string }[];
      governance: string;
      valueHypothesis: string;
    } | null>(),
    workstreams: jsonb("workstreams").notNull().default([]).$type<
      { name: string; lead: string; status: string }[]
    >(),
    valueCase: jsonb("value_case"),
    startDate: text("start_date").notNull(),
    plannedEndDate: text("planned_end_date").notNull(),
    raidStatus: text("raid_status").notNull().default("green"),
    deliverablesDueThisWeek: integer("deliverables_due_this_week")
      .notNull()
      .default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_eng_org").on(t.orgId),
    index("idx_atelier_eng_account").on(t.accountId),
  ],
);

// ============================================================
// DELIVERABLES + VERSIONS
// ============================================================
export const atelierDeliverables = pgTable(
  "atelier_deliverables",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    type: text("type").notNull(), // diagnostic | design | build | adoption | decision_memo | final_readout
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    hypothesisId: text("hypothesis_id"),
    currentVersionId: text("current_version_id"),
    dueDate: text("due_date"),
    // Synthesis Critic + Partner Authority Lock state. The critic populates
    // readiness ('green'|'amber'|'red'); Partner Lock then blocks
    // [Send to client] until readiness is GREEN or an explicit override
    // rationale is recorded with the partner's name + ts.
    criticReadiness: text("critic_readiness"), // null | green | amber | red
    criticReportSummary: text("critic_report_summary"),
    partnerApprovedAt: timestamp("partner_approved_at"),
    partnerApprovedByUserId: text("partner_approved_by_user_id"),
    partnerApprovedByName: text("partner_approved_by_name"),
    partnerRationale: text("partner_rationale"),
    lockOverridden: boolean("lock_overridden").notNull().default(false),
    sentAt: timestamp("sent_at"),
    sentByUserId: text("sent_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_deliv_eng").on(t.engagementId)],
);

export const atelierDeliverableVersions = pgTable(
  "atelier_deliverable_versions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    deliverableId: text("deliverable_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    body: text("body").notNull().default(""),
    format: text("format").notNull().default("html"),
    citations: jsonb("citations").notNull().default([]),
    synthesisCriticReport: jsonb("synthesis_critic_report"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_dv_deliv").on(t.deliverableId)],
);

// ============================================================
// MEETINGS + TRANSCRIPTS
// ============================================================
export const atelierMeetings = pgTable(
  "atelier_meetings",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    parentType: text("parent_type").notNull(), // opportunity | engagement
    parentId: text("parent_id").notNull(),
    mode: text("mode").notNull().default("upload"), // upload | paste | live_bot
    kind: text("kind").notNull().default("discovery"), // discovery | workshop | steering | kickoff
    title: text("title").notNull(),
    date: text("date").notNull(),
    attendees: jsonb("attendees").notNull().default([]),
    transcriptId: text("transcript_id"),
    summary: text("summary"),
    decisions: jsonb("decisions").notNull().default([]),
    actionItems: jsonb("action_items").notNull().default([]),
    runId: text("run_id"),
    status: text("status").notNull().default("draft"),
    committedAt: timestamp("committed_at"),
    committedByUserId: text("committed_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_mtg_parent").on(t.parentType, t.parentId)],
);

export const atelierTranscripts = pgTable(
  "atelier_transcripts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    sourceFileUrl: text("source_file_url"),
    cleanedText: text("cleaned_text"),
    speakerMap: jsonb("speaker_map").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
);

// ============================================================
// ARTIFACTS (per-engagement files)
// ============================================================
export const atelierArtifacts = pgTable(
  "atelier_artifacts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    parentType: text("parent_type").notNull(),
    parentId: text("parent_id").notNull(),
    fileUrl: text("file_url"),
    title: text("title").notNull(),
    abstract: text("abstract"),
    body: text("body"),
    tags: jsonb("tags").notNull().default([]).$type<string[]>(),
    source: text("source").notNull().default("upload"),
    // Bilingual flow: language detected on upload (en | ar | other),
    // translation is stubbed in MVP but the *flow* must be present so the
    // original is preserved alongside the translation in audit.
    language: text("language").notNull().default("en"),
    translatedTitle: text("translated_title"),
    translatedBody: text("translated_body"),
    translatedAt: timestamp("translated_at"),
    atelierPromoted: boolean("atelier_promoted").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_art_parent").on(t.parentType, t.parentId)],
);

// ============================================================
// ATELIER ASSETS (firm-wide reusable IP)
// ============================================================
export const atelierAssets = pgTable(
  "atelier_assets",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    kind: text("kind").notNull(), // pov | prompt | framework | case_study | template | code | learning
    title: text("title").notNull(),
    abstract: text("abstract").notNull(),
    bodyOrFileUrl: text("body_or_file_url"),
    provenance: text("provenance").notNull(),
    tags: jsonb("tags").notNull().default([]).$type<string[]>(),
    promotedFromEngagementId: text("promoted_from_engagement_id"),
    promotedByUserId: text("promoted_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_assets_org").on(t.orgId),
    index("idx_atelier_assets_kind").on(t.kind),
  ],
);

// ============================================================
// PROMPTS
// ============================================================
export const atelierPrompts = pgTable(
  "atelier_prompts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    agentId: text("agent_id").notNull(),
    version: integer("version").notNull().default(1),
    body: text("body").notNull(),
    status: text("status").notNull().default("active"), // draft | active | deprecated
    evalScore: doublePrecision("eval_score"),
    author: text("author"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_prompts_agent").on(t.agentId)],
);

// ============================================================
// AGENT REGISTRY
// ============================================================
export const atelierAgents = pgTable(
  "atelier_agents",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    group: text("group_name").notNull(),
    stage: text("stage").notNull(),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    starred: boolean("starred").notNull().default(false),
    status: text("status").notNull().default("registered"), // registered | mvp | stub
    tools: jsonb("tools").notNull().default([]).$type<string[]>(),
    guardrails: jsonb("guardrails").notNull().default([]).$type<string[]>(),
    humanCheckpoints: jsonb("human_checkpoints")
      .notNull()
      .default([])
      .$type<string[]>(),
    runsLast30d: integer("runs_last_30d").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
);

// ============================================================
// AGENT RUNS
// ============================================================
export const atelierAgentRuns = pgTable(
  "atelier_agent_runs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    agentId: text("agent_id").notNull(),
    triggeredByUserId: text("triggered_by_user_id"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    inputs: jsonb("inputs").notNull().default({}),
    output: jsonb("output"),
    steps: jsonb("steps").notNull().default([]),
    toolCalls: jsonb("tool_calls").notNull().default([]),
    humanDecisions: jsonb("human_decisions").notNull().default([]),
    confidence: text("confidence"), // green | amber | red
    status: text("status").notNull().default("running"),
    statusMessage: text("status_message"),
    progressPct: integer("progress_pct"),
    sourcesCount: integer("sources_count"),
    costUsd: doublePrecision("cost_usd"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_runs_agent").on(t.agentId),
    index("idx_atelier_runs_status").on(t.status),
  ],
);

// ============================================================
// AUDIT EVENTS (append-only)
// ============================================================
export const atelierAuditEvents = pgTable(
  "atelier_audit_events",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actorType: text("actor_type").notNull(), // human | agent | system
    actorId: text("actor_id"),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    payload: jsonb("payload").notNull().default({}),
    payloadSummary: text("payload_summary"),
    ts: timestamp("ts").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_audit_entity").on(t.entityType, t.entityId),
    index("idx_atelier_audit_ts").on(t.ts),
    index("idx_atelier_audit_org").on(t.orgId),
  ],
);

// ============================================================
// RAID, HYPOTHESIS TREES, PROCESSES, AGENT DESIGNS, NOTIFICATIONS
// ============================================================
export const atelierRaidItems = pgTable(
  "atelier_raid_items",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    kind: text("kind").notNull(), // risk | assumption | issue | dependency
    severity: text("severity").notNull(), // green | amber | red
    ownerId: text("owner_id"),
    status: text("status").notNull().default("open"),
    dueDate: text("due_date"),
    description: text("description").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_raid_eng").on(t.engagementId)],
);

export const atelierHypothesisTrees = pgTable(
  "atelier_hypothesis_trees",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    root: jsonb("root").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
);

// ============================================================
// CHARTER VERSIONS (Charter Architect output, versioned w/ diff)
// One row per re-draft. Engagement.charter (jsonb) mirrors the
// LIVE row only after Partner sign-off; intermediate drafts live
// here so the Lead and Partner can compare versions side-by-side.
// ============================================================
export const atelierCharterVersions = pgTable(
  "atelier_charter_versions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    runId: text("run_id"),
    body: jsonb("body").notNull().default({}).$type<{
      objectives: string[];
      scope: string[];
      outOfScope: string[];
      successMetrics: { name: string; baseline: string; target: string }[];
      governance: string;
      valueHypothesis: string;
    }>(),
    hypothesisTree: jsonb("hypothesis_tree").notNull().default({}),
    raidBaseline: jsonb("raid_baseline").notNull().default([]),
    proposedWorkstreams: jsonb("proposed_workstreams").notNull().default([]),
    meceFlags: jsonb("mece_flags").notNull().default([]).$type<string[]>(),
    status: text("status").notNull().default("draft"), // draft | lead_approved | live | superseded
    leadApprovedAt: timestamp("lead_approved_at"),
    leadApprovedByUserId: text("lead_approved_by_user_id"),
    partnerApprovedAt: timestamp("partner_approved_at"),
    partnerApprovedByUserId: text("partner_approved_by_user_id"),
    partnerApprovedByName: text("partner_approved_by_name"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_charterv_eng").on(t.engagementId)],
);

export const atelierProcesses = pgTable(
  "atelier_processes",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    name: text("name").notNull(),
    diagram: text("diagram"), // mermaid
    steps: jsonb("steps").notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
);

export const atelierAgentDesigns = pgTable(
  "atelier_agent_designs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    processStepId: text("process_step_id"),
    design: jsonb("design").notNull().default({}),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
);

export const atelierNotifications = pgTable(
  "atelier_notifications",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_notif_user").on(t.userId),
    index("idx_atelier_notif_org").on(t.orgId),
  ],
);

// ============================================================
// BRIEFS (Pursuit Scout output, per opportunity)
// ============================================================
export const atelierBriefs = pgTable(
  "atelier_briefs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id").notNull(),
    runId: text("run_id"),
    accountSnapshot: jsonb("account_snapshot").notNull().default({}),
    buyerLandscape: jsonb("buyer_landscape").notNull().default({}),
    fiveCDraft: jsonb("five_c_draft").notNull().default({}),
    openQuestions: jsonb("open_questions").notNull().default([]).$type<string[]>(),
    citations: jsonb("citations").notNull().default([]),
    confidence: text("confidence"),
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: text("approved_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_briefs_opp").on(t.opportunityId)],
);

// ============================================================
// RESEARCH FACTS (one row per researched fact, with promotion)
// ============================================================
export const atelierResearchFacts = pgTable(
  "atelier_research_facts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id").notNull(),
    runId: text("run_id"),
    topic: text("topic").notNull(),
    statement: text("statement").notNull(),
    sourceUrl: text("source_url"),
    sourceTitle: text("source_title"),
    retrievedAt: timestamp("retrieved_at"),
    confidence: text("confidence").notNull().default("amber"),
    snippet: text("snippet"),
    promoted: boolean("promoted").notNull().default(false),
    promotedAt: timestamp("promoted_at"),
    promotedByUserId: text("promoted_by_user_id"),
    includedInBrief: boolean("included_in_brief").notNull().default(false),
    includedInPov: boolean("included_in_pov").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_facts_opp").on(t.opportunityId)],
);

// ============================================================
// POVS + POV VERSIONS (POV Author chain output)
// ============================================================
export const atelierPovs = pgTable(
  "atelier_povs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id").notNull(),
    title: text("title").notNull(),
    audience: text("audience"),
    objective: text("objective"),
    status: text("status").notNull().default("outline"),
    outline: jsonb("outline").notNull().default([]),
    currentVersionId: text("current_version_id"),
    runId: text("run_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_povs_opp").on(t.opportunityId)],
);

export const atelierPovVersions = pgTable(
  "atelier_pov_versions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    povId: text("pov_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    body: text("body").notNull().default(""),
    sections: jsonb("sections").notNull().default([]),
    citations: jsonb("citations").notNull().default([]),
    citationCoverage: doublePrecision("citation_coverage"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_povv_pov").on(t.povId)],
);

// ============================================================
// PANE A — Triage queue (one row per "what needs me" item)
// Materialized by the Triage Agent stub; lives in DB so it
// survives reloads and feeds the audit trail.
// ============================================================
export const atelierPaneAItems = pgTable(
  "atelier_pane_a_items",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    priority: text("priority").notNull(), // high | medium | low
    hrefKind: text("href_kind").notNull(),
    hrefTargetId: text("href_target_id").notNull(),
    dueLabel: text("due_label").notNull(),
    sortKey: integer("sort_key").notNull().default(0),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_panea_user").on(t.userId),
    index("idx_atelier_panea_org").on(t.orgId),
  ],
);

// ============================================================
// PROPOSALS (Proposal Composer output, per opportunity) — Task #223
// ============================================================
export const atelierProposals = pgTable(
  "atelier_proposals",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id").notNull(),
    runId: text("run_id"),
    title: text("title").notNull(),
    sectionsRequired: jsonb("sections_required").notNull().$type<string[]>().default([]),
    teamProposed: jsonb("team_proposed").notNull().default([]),
    pricingIntent: jsonb("pricing_intent").notNull().default({}),
    pricingModel: jsonb("pricing_model").notNull().default({}),
    winThemes: jsonb("win_themes").notNull().$type<string[]>().default([]),
    complianceMatrix: jsonb("compliance_matrix").notNull().default([]),
    status: text("status").notNull().default("draft"),
    docxUrl: text("docx_url"),
    pdfUrl: text("pdf_url"),
    deadline: timestamp("deadline"),
    partnerApprovedAt: timestamp("partner_approved_at"),
    partnerApprovedByUserId: text("partner_approved_by_user_id"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_proposals_opp").on(t.opportunityId)],
);

export const atelierProposalSections = pgTable(
  "atelier_proposal_sections",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    proposalId: text("proposal_id").notNull(),
    sectionId: text("section_id").notNull(), // e.g. context, approach, workplan…
    name: text("name").notNull(),
    ownerAgent: text("owner_agent").notNull(),
    status: text("status").notNull().default("draft"), // draft|green|amber|red|approved
    content: text("content").notNull().default(""),
    citations: jsonb("citations").notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_propsec_proposal").on(t.proposalId),
    uniqueIndex("uq_atelier_propsec").on(t.proposalId, t.sectionId),
  ],
);

// ============================================================
// PROTOTYPES (Prototype Forge output) — Task #223
// ============================================================
export const atelierPrototypes = pgTable(
  "atelier_prototypes",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id"),
    engagementId: text("engagement_id"),
    runId: text("run_id"),
    name: text("name").notNull(),
    brief: jsonb("brief").notNull().default({}),
    replitPromptMd: text("replit_prompt_md").notNull().default(""),
    buildPlan: jsonb("build_plan").notNull().default([]),
    demoStoryboard: jsonb("demo_storyboard").notNull().default([]),
    status: text("status").notNull().default("draft"), // draft|lead_approved|partner_approved|sent
    leadApprovedAt: timestamp("lead_approved_at"),
    leadApprovedByUserId: text("lead_approved_by_user_id"),
    partnerApprovedAt: timestamp("partner_approved_at"),
    partnerApprovedByUserId: text("partner_approved_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_proto_opp").on(t.opportunityId),
    index("idx_atelier_proto_eng").on(t.engagementId),
  ],
);
