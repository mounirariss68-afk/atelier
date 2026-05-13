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
    brandName: text("brand_name"),
    country: text("country").notNull(),
    sector: text("sector").notNull(),
    notes: text("notes"),
    // v2 CRM extensions (Task #238 — PRD §2.1).
    parentAccountId: text("parent_account_id"),
    size: text("size"), // 'enterprise' | 'large' | 'mid' | 'small' (free text for now)
    hqCity: text("hq_city"),
    primaryCurrency: text("primary_currency").notNull().default("USD"),
    primaryLanguage: text("primary_language").notNull().default("en"),
    tier: text("tier").notNull().default("C"), // 'A' | 'B' | 'C' | 'D'
    status: text("status").notNull().default("active"), // 'active' | 'dormant' | 'archived'
    partnerOwnerId: text("partner_owner_id"),
    relationshipStrength: doublePrecision("relationship_strength")
      .notNull()
      .default(0), // 0–100
    enrichedAt: timestamp("enriched_at"),
    sourceSignals: jsonb("source_signals")
      .$type<
        Array<{
          kind: "news" | "linkedin" | "press" | "filing" | "manual";
          title: string;
          url: string;
          summary?: string;
          publishedAt?: string;
          confidence?: "green" | "amber" | "red";
        }>
      >()
      .notNull()
      .default([]),
    strategicPriorities: jsonb("strategic_priorities")
      .$type<string[]>()
      .notNull()
      .default([]),
    aicoHypothesis: text("aico_hypothesis"),
    pendingProfileUpdates: jsonb("pending_profile_updates")
      .$type<
        Array<{
          id: string;
          proposedBy: string; // agent id, e.g. ag_pursuit_scout
          proposedAt: string;
          field: string; // dotted path: 'sector', 'hqCity', 'strategicPriorities'
          fromValue: unknown;
          toValue: unknown;
          rationale: string;
          oppId?: string;
          status: "pending" | "approved" | "rejected";
        }>
      >()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_accounts_org").on(t.orgId),
    index("idx_atelier_accounts_tier").on(t.tier),
    index("idx_atelier_accounts_partner").on(t.partnerOwnerId),
  ],
);

// ============================================================
// CONTACTS (v2 — PRD §2.2)
// ============================================================
export const atelierContacts = pgTable(
  "atelier_contacts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    accountId: text("account_id").notNull(),
    fullName: text("full_name").notNull(),
    title: text("title"),
    seniority: text("seniority"), // 'c_suite' | 'vp' | 'director' | 'manager' | 'ic'
    email: text("email"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    buyerPersona: text("buyer_persona"), // CEO|COO|CIO|CDO|CXO|business_head|procurement|technical_evaluator
    influenceScore: integer("influence_score").notNull().default(3), // 1–5
    disposition: text("disposition").notNull().default("unknown"),
    // 'champion' | 'supporter' | 'neutral' | 'skeptic' | 'blocker' | 'unknown'
    lastContactAt: timestamp("last_contact_at"),
    contactOwnerId: text("contact_owner_id"), // FK to atelier_users
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_contacts_org").on(t.orgId),
    index("idx_atelier_contacts_account").on(t.accountId),
    index("idx_atelier_contacts_disposition").on(t.disposition),
  ],
);

// Graph edges between contacts (org chart structure: reports_to, partners_with,
// blocks). One row = one directed edge.
export const atelierContactRelationships = pgTable(
  "atelier_contact_relationships",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    accountId: text("account_id").notNull(),
    fromContactId: text("from_contact_id").notNull(),
    toContactId: text("to_contact_id").notNull(),
    type: text("type").notNull(), // 'reports_to' | 'partners_with' | 'blocks'
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_contact_rels_org").on(t.orgId),
    index("idx_atelier_contact_rels_account").on(t.accountId),
    index("idx_atelier_contact_rels_from").on(t.fromContactId),
  ],
);

// ============================================================
// CREDENTIALS (v2 — PRD §1.1, first-class case-study workspace)
// Extends the v1 Atelier asset with structured credential metadata.
// ============================================================
export const atelierCredentials = pgTable(
  "atelier_credentials",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    title: text("title").notNull(),
    accountId: text("account_id"), // optional FK
    clientName: text("client_name").notNull(), // anonymized label allowed
    sector: text("sector").notNull(),
    engagementType: text("engagement_type").notNull(),
    // 'diagnostic' | 'pov' | 'agentic_build' | 'transformation' | 'workshop'
    outcomeMetrics: jsonb("outcome_metrics")
      .$type<Array<{ label: string; value: string }>>()
      .notNull()
      .default([]),
    anonymizationStatus: text("anonymization_status")
      .notNull()
      .default("redacted"), // 'redacted' | 'attributed' | 'pending'
    redactedAbstract: text("redacted_abstract").notNull(),
    attributedAbstract: text("attributed_abstract"),
    evidenceLinks: jsonb("evidence_links")
      .$type<Array<{ label: string; url: string }>>()
      .notNull()
      .default([]),
    relatedAssetId: text("related_asset_id"), // optional FK → atelier_assets
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_credentials_org").on(t.orgId),
    index("idx_atelier_credentials_account").on(t.accountId),
    index("idx_atelier_credentials_sector").on(t.sector),
  ],
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
    // v2 sales stage (PRD §2.3) — finer-grained 10-value lifecycle.
    // plmStage is now derived from salesStage at write-time via SALES_TO_PLM.
    salesStage: text("sales_stage").notNull().default("lead"),
    // 'lead' | 'qualified' | 'discovery_scheduled' | 'pov_in_flight'
    // | 'proposal_in_flight' | 'submitted' | 'verbal_commit' | 'signed'
    // | 'lost_no_decision' | 'withdrawn'
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
    index("idx_atelier_opps_sales_stage").on(t.salesStage),
    index("idx_atelier_opps_account").on(t.accountId),
  ],
);

// ============================================================
// OPPORTUNITY STAGE TRANSITIONS (v2 — PRD §2.3)
// First-class auditable record of every stage move.
// ============================================================
export const atelierOpportunityStageTransitions = pgTable(
  "atelier_opportunity_stage_transitions",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id").notNull(),
    fromStage: text("from_stage"), // null on initial create
    toStage: text("to_stage").notNull(),
    transitionedByUserId: text("transitioned_by_user_id").notNull(),
    rationaleText: text("rationale_text"),
    evidenceArtifactIds: jsonb("evidence_artifact_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    priorProbabilityPct: doublePrecision("prior_probability_pct"),
    newProbabilityPct: doublePrecision("new_probability_pct"),
    nextMilestone: text("next_milestone"),
    nextMilestoneDate: text("next_milestone_date"),
    agentRecommended: boolean("agent_recommended").notNull().default(false),
    partnerOverride: boolean("partner_override").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_opp_transitions_opp").on(t.opportunityId),
    index("idx_atelier_opp_transitions_created").on(t.createdAt),
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
    // PRD §2.1 contract name: roleOnEngagement. Mapped to legacy db column
    // `role` to avoid a destructive rename. Values:
    // partner_owner | lead | member | reviewer | partner_resource | contractor
    roleOnEngagement: text("role").notNull().default("member"),
    // v3 Roster extensions (Task #254).
    allocationPct: integer("allocation_pct").notNull().default(0), // 0..100
    scope: jsonb("scope") // capability tokens (e.g., ["can_view_pricing","can_view_charter"])
      .$type<string[]>()
      .notNull()
      .default([]),
    status: text("status").notNull().default("active"), // active | expired | revoked
    grantedByUserId: text("granted_by_user_id"),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    endDate: timestamp("end_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("uniq_atelier_eng_access").on(t.engagementId, t.userId),
    index("idx_atelier_eng_access_user").on(t.userId),
    index("idx_atelier_eng_access_status").on(t.status),
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
    // Task #243 — engagement default language for bilingual deliverable
    // generation. 'en' (default) routes Engagement Curator + deliverable
    // scaffolds in English; 'ar' emits an Arabic-first variant flag that
    // downstream rendering uses for RTL chrome and AR weekly digests.
    defaultLanguage: text("default_language").notNull().default("en"),
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
    // Salon (Task #242) — visibility into client workspace + last published version.
    clientVisibility: text("client_visibility").notNull().default("internal"), // internal | review | published | final
    latestPublishId: text("latest_publish_id"),
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
    inputs: jsonb("inputs").notNull().default([]).$type<Array<{
      name: string;
      type: "string" | "number" | "boolean" | "object" | "array" | "enum";
      description: string;
      required?: boolean;
      enumValues?: string[];
    }>>(),
    outputs: jsonb("outputs").notNull().default([]).$type<Array<{
      name: string;
      type: "string" | "number" | "boolean" | "object" | "array" | "enum";
      description: string;
      required?: boolean;
      enumValues?: string[];
    }>>(),
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
    kind: text("kind").notNull(), // report_scheduled | report_delivered | winloss_due | theme_suggestion | ...
    payload: jsonb("payload").notNull().default({}),
    readAt: timestamp("read_at"),
    // Task #241 — report scheduling stub. No real Slack/SMTP wired up;
    // a queued row is the entire delivery contract for v2.
    channel: text("channel").default("in_app"), // slack | email | in_app
    subject: text("subject"),
    body: text("body"),
    refType: text("ref_type"), // report | debrief | opportunity
    refId: text("ref_id"),
    scheduledFor: timestamp("scheduled_for"),
    sentAt: timestamp("sent_at"),
    status: text("status").default("queued"), // queued | sent | failed | stub_no_channel
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_notif_user").on(t.userId),
    index("idx_atelier_notif_org").on(t.orgId),
    index("idx_atelier_notifs_status").on(t.status),
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

// ============================================================
// PRICING — Rate cards, deal pricings, margin policies (Task #240)
// ============================================================
export const atelierRateCards = pgTable(
  "atelier_rate_cards",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"), // draft|active|archived
    geography: text("geography").notNull(), // KSA | UAE | KSA+UAE
    currency: text("currency").notNull(), // USD reporting; row-level may differ
    effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
    effectiveTo: timestamp("effective_to"),
    sourceUrl: text("source_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
);

export const atelierRateCardRows = pgTable(
  "atelier_rate_card_rows",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    rateCardId: text("rate_card_id").notNull(),
    role: text("role").notNull(), // freeform label
    seniority: text("seniority").notNull(), // Partner|Principal|SubjectMatterLead|AIEngineer|Designer|Analyst
    dayRateInternalCost: doublePrecision("day_rate_internal_cost").notNull(),
    dayRateClientPrice: doublePrecision("day_rate_client_price").notNull(),
    overheadPct: doublePrecision("overhead_pct").notNull().default(0.25),
    currency: text("currency").notNull().default("USD"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_rcrows_card").on(t.rateCardId)],
);

export const atelierMarginPolicies = pgTable(
  "atelier_margin_policies",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull().default("default"),
    targetMarginPct: doublePrecision("target_margin_pct").notNull().default(0.55),
    amberThresholdPct: doublePrecision("amber_threshold_pct").notNull().default(0.50),
    redThresholdPct: doublePrecision("red_threshold_pct").notNull().default(0.45),
    twoPartnerThresholdPct: doublePrecision("two_partner_threshold_pct").notNull().default(0.45),
    isDefault: boolean("is_default").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
);

export const atelierDealPricings = pgTable(
  "atelier_deal_pricings",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id").notNull(),
    rateCardId: text("rate_card_id").notNull(),
    pricingModel: text("pricing_model").notNull().default("time_and_materials"), // time_and_materials | fixed_fee | outcome_based | retainer
    durationWeeks: doublePrecision("duration_weeks").notNull().default(8),
    teamMix: jsonb("team_mix").notNull().default([]).$type<Array<{
      seniority: string;
      role?: string;
      ftePct: number; // 0..1 share of full-time across the duration
    }>>(),
    computedCostUsd: doublePrecision("computed_cost_usd").notNull().default(0),
    computedPriceUsd: doublePrecision("computed_price_usd").notNull().default(0),
    computedMarginPct: doublePrecision("computed_margin_pct").notNull().default(0),
    targetMarginPct: doublePrecision("target_margin_pct").notNull().default(0.55),
    marginLockStatus: text("margin_lock_status").notNull().default("green"), // green|amber|red
    partnerOverrideId: text("partner_override_id"),
    partnerOverrideAt: timestamp("partner_override_at"),
    partnerOverrideRationale: text("partner_override_rationale"),
    countersignPartnerId: text("countersign_partner_id"),
    countersignAt: timestamp("countersign_at"),
    countersignRationale: text("countersign_rationale"),
    alternativeStructures: jsonb("alternative_structures").notNull().default([]),
    pricingStrategistBriefId: text("pricing_strategist_brief_id"),
    pricingStrategistRunId: text("pricing_strategist_run_id"),
    pricingStrategistOutput: jsonb("pricing_strategist_output"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_atelier_dealpricing_opp").on(t.opportunityId),
    index("idx_atelier_dealpricing_status").on(t.marginLockStatus),
  ],
);

// ============================================================
// WIN/LOSS DEBRIEFS + WIN THEMES (Task #241)
// ============================================================
export const atelierWinLossDebriefs = pgTable(
  "atelier_winloss_debriefs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    opportunityId: text("opportunity_id").notNull(),
    outcome: text("outcome").notNull(), // signed | lost_no_decision | lost_to_competitor | withdrawn
    status: text("status").notNull().default("pending"),
    // pending | buyer_scheduled | buyer_done | seller_done | synthesized | closed
    // --- Seller side: multiple AICo team members may submit responses ---
    sellerInputs: jsonb("seller_inputs").notNull().default([]).$type<Array<{
      userId: string;
      name: string;
      role: string;
      perceivedReasons: string[];
      whatWeWouldDoDifferently: string;
      notes?: string;
      submittedAt: string;
    }>>(),
    sellerPerceivedReasons: jsonb("seller_perceived_reasons").notNull().default([]).$type<string[]>(),
    sellerNotes: text("seller_notes"),
    sellerDoneAt: timestamp("seller_done_at"),
    partnerOwnerUserId: text("partner_owner_user_id"),
    engagementLeadUserId: text("engagement_lead_user_id"),
    // --- Buyer interview (async only — transcript ingest) ---
    buyerInterviewScheduledAt: timestamp("buyer_interview_scheduled_at"),
    buyerInterviewConductedByAgentRunId: text("buyer_interview_conducted_by_agent_run_id"),
    buyerInterviewConductedByUserId: text("buyer_interview_conducted_by_user_id"),
    buyerTranscript: text("buyer_transcript"),
    buyerTranscriptUploadedAt: timestamp("buyer_transcript_uploaded_at"),
    buyerResponses: jsonb("buyer_responses").$type<Array<{
      question: string;
      answer: string;
      quote?: string;
    }> | null>(),
    buyerAuthenticReasons: jsonb("buyer_authentic_reasons").notNull().default([]).$type<string[]>(),
    hiddenCompetitor: text("hidden_competitor"), // direct | partner_firm | status_quo | inhouse | unknown | null
    // --- Synthesis output (Win/Loss Interviewer) ---
    themes: jsonb("themes").notNull().default([]).$type<Array<{
      name: string;
      tag: string;
      evidenceQuote: string;
      polarity: "win" | "loss";
    }>>(),
    whatWeWouldDoDifferently: text("what_we_would_do_differently"),
    lessonsToAtelierAssetIds: jsonb("lessons_to_atelier_asset_ids").notNull().default([]).$type<string[]>(),
    suggestedAtelierLessons: jsonb("suggested_atelier_lessons").notNull().default([]).$type<Array<{
      title: string;
      summary: string;
      kind: string;
    }>>(),
    interviewerRunId: text("interviewer_run_id"),
    lastRunId: text("last_run_id"),
    synthesizedAt: timestamp("synthesized_at"),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: text("approved_by_user_id"),
    // --- Conductor guardrail trail ---
    conductorRole: text("conductor_role"), // agent | partner_off_team | (blocked: deal_team)
    publishedAt: timestamp("published_at"),
    publishedByUserId: text("published_by_user_id"),
    dueAt: timestamp("due_at"), // 14d after stage transition close
    overdueRedAt: timestamp("overdue_red_at"),
    closedWithoutDebriefOverrideRationale: text("closed_without_debrief_override_rationale"),
    closedWithoutDebriefOverrideByUserId: text("closed_without_debrief_override_by_user_id"),
    closedWithoutDebriefOverrideAt: timestamp("closed_without_debrief_override_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_atelier_winloss_opp").on(t.opportunityId),
    index("idx_atelier_winloss_status").on(t.status),
    index("idx_atelier_winloss_outcome").on(t.outcome),
  ],
);

export const atelierWinThemes = pgTable(
  "atelier_win_themes",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    description: text("description").notNull(),
    tag: text("tag").notNull(), // senior_delivery | speed_to_value | pricing_wedge | partner_leverage | agentic_native | gcc_context | ...
    polarity: text("polarity").notNull().default("win"), // win | loss
    supportCount: integer("support_count").notNull().default(0),
    contributingDebriefIds: jsonb("contributing_debrief_ids").notNull().default([]).$type<string[]>(),
    offeringTags: jsonb("offering_tags").notNull().default([]).$type<string[]>(),
    sectorTags: jsonb("sector_tags").notNull().default([]).$type<string[]>(),
    positioningLine: text("positioning_line"), // ready-to-paste insertion for Composer
    lastSeenAt: timestamp("last_seen_at"),
    status: text("status").notNull().default("active"), // active | archived
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_win_themes_tag").on(t.tag),
    index("idx_atelier_win_themes_polarity").on(t.polarity),
  ],
);

// ============================================================
// REPORTS + NOTIFICATIONS (Task #241 §5)
// ============================================================
export const atelierReports = pgTable(
  "atelier_reports",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    templateId: text("template_id").notNull(),
    // pipeline_waterfall | forecast_by_partner | margin_watch | account_heatmap |
    // winloss_rate_by_offering | hidden_competitor | salon_health |
    // atelier_reuse_leaderboard | senior_delivery_proof
    description: text("description"),
    parameters: jsonb("parameters").notNull().default({}).$type<Record<string, unknown>>(),
    ownerUserId: text("owner_user_id"),
    schedule: text("schedule").notNull().default("none"), // none | weekly_monday | monthly_first
    scheduleChannels: jsonb("schedule_channels").notNull().default([]).$type<Array<"slack" | "email" | "in_app">>(),
    pinnedToHome: boolean("pinned_to_home").notNull().default(false),
    lastRunAt: timestamp("last_run_at"),
    lastRunSnapshot: jsonb("last_run_snapshot"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_reports_owner").on(t.ownerUserId),
    index("idx_atelier_reports_template").on(t.templateId),
  ],
);

// (atelierNotifications declared above — Task #241 extended its columns.)

// ============================================================
// THE SALON (Task #242) — client-facing workspace
// ============================================================

// One co-branded workspace per engagement (1:1, but in its own table to
// keep brand assets / accent / locale defaults out of atelier_engagements).
export const atelierSalonWorkspaces = pgTable(
  "atelier_salon_workspaces",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    accountId: text("account_id").notNull(),
    slug: text("slug").notNull(), // mirrors engagement slug for URL routing
    displayName: text("display_name").notNull(),
    accentColor: text("accent_color").notNull().default("#0B5CFF"),
    clientLogoUrl: text("client_logo_url"),
    aicoLogoUrl: text("aico_logo_url"),
    eyebrowText: text("eyebrow_text"),
    defaultLocale: text("default_locale").notNull().default("en"), // en | ar
    rtlEnabled: boolean("rtl_enabled").notNull().default(false),
    watermarkEnabled: boolean("watermark_enabled").notNull().default(true),
    downloadsAllowedDefault: boolean("downloads_allowed_default")
      .notNull()
      .default(false),
    status: text("status").notNull().default("active"), // active | paused | archived
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("ux_atelier_salon_ws_eng").on(t.engagementId),
    uniqueIndex("ux_atelier_salon_ws_slug").on(t.orgId, t.slug),
  ],
);

// Client-side users (role = client_user); kept separate from atelier_users
// so internal AICo persona space and client persona space cannot collide.
export const atelierSalonUsers = pgTable(
  "atelier_salon_users",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    accountId: text("account_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    initials: text("initials").notNull(),
    title: text("title"),
    avatarUrl: text("avatar_url"),
    locale: text("locale").notNull().default("en"),
    status: text("status").notNull().default("active"), // pending_invite | active | suspended
    invitedByAtelierUserId: text("invited_by_atelier_user_id"),
    invitedAt: timestamp("invited_at"),
    activatedAt: timestamp("activated_at"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("ux_atelier_salon_users_email").on(t.orgId, t.accountId, t.email),
    index("idx_atelier_salon_users_account").on(t.accountId),
  ],
);

// Per-engagement access grants for client users (admin / approver / viewer).
// downloadsAllowed honors per-grant override of workspace default.
export const atelierSalonUserEngagementAccess = pgTable(
  "atelier_salon_user_engagement_access",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    salonUserId: text("salon_user_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    role: text("role").notNull().default("viewer"), // admin | approver | viewer
    downloadsAllowed: boolean("downloads_allowed"),
    canApprove: boolean("can_approve").notNull().default(false),
    grantedByAtelierUserId: text("granted_by_atelier_user_id"),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("ux_atelier_salon_access").on(t.salonUserId, t.engagementId),
    index("idx_atelier_salon_access_eng").on(t.engagementId),
  ],
);

// Each [Publish to Salon] action snapshots a deliverable version + Publish
// Sentinel result. publish_allowed=false rows mean the publish was blocked.
export const atelierDeliverablePublishes = pgTable(
  "atelier_deliverable_publishes",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    deliverableId: text("deliverable_id").notNull(),
    deliverableVersionId: text("deliverable_version_id"),
    engagementId: text("engagement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    publishedByAtelierUserId: text("published_by_atelier_user_id").notNull(),
    publishedByName: text("published_by_name").notNull(),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
    sentinelRunId: text("sentinel_run_id"),
    sentinelStatus: text("sentinel_status").notNull().default("pass"), // pass | warn | fail
    sentinelChecks: jsonb("sentinel_checks")
      .notNull()
      .default([])
      .$type<
        Array<{
          name: string;
          status: "pass" | "warn" | "fail";
          detail: string;
          spans?: Array<{ pattern: string; sample: string }>;
        }>
      >(),
    publishAllowed: boolean("publish_allowed").notNull().default(true),
    overrideRationale: text("override_rationale"),
    overriddenByAtelierUserId: text("overridden_by_atelier_user_id"),
    downloadsAllowed: boolean("downloads_allowed").notNull().default(false),
    watermarkRequired: boolean("watermark_required").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_deliv_publish_deliv").on(t.deliverableId),
    index("idx_atelier_deliv_publish_eng").on(t.engagementId),
  ],
);

// Salon-side decisions: client approvals / change-requests / comments on
// a published deliverable. Mirrored into atelier_salon_audit_events AND
// atelier_audit_events so internal teams see the activity.
export const atelierSalonDecisions = pgTable(
  "atelier_salon_decisions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    deliverableId: text("deliverable_id"),
    publishId: text("publish_id"),
    kind: text("kind").notNull(), // approve | request_change | comment | sign_off
    headline: text("headline").notNull(),
    rationale: text("rationale"),
    decidedBySalonUserId: text("decided_by_salon_user_id").notNull(),
    decidedByName: text("decided_by_name").notNull(),
    decidedAt: timestamp("decided_at").notNull().defaultNow(),
    status: text("status").notNull().default("recorded"), // recorded | superseded
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_salon_dec_eng").on(t.engagementId),
    index("idx_atelier_salon_dec_deliv").on(t.deliverableId),
  ],
);

// Salon-side requests: client asks AICo for something (copy of artifact,
// new meeting, additional analysis). Routed to engagement lead.
export const atelierSalonRequests = pgTable(
  "atelier_salon_requests",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(), // copy_request | meeting | clarification | other
    title: text("title").notNull(),
    detail: text("detail"),
    relatedDeliverableId: text("related_deliverable_id"),
    raisedBySalonUserId: text("raised_by_salon_user_id").notNull(),
    raisedByName: text("raised_by_name").notNull(),
    raisedAt: timestamp("raised_at").notNull().defaultNow(),
    status: text("status").notNull().default("open"), // open | in_progress | resolved | declined
    assignedToAtelierUserId: text("assigned_to_atelier_user_id"),
    resolvedAt: timestamp("resolved_at"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_salon_req_eng").on(t.engagementId),
    index("idx_atelier_salon_req_status").on(t.status),
  ],
);

// Per-salon-user notification feed (in-app only for MVP).
export const atelierSalonNotifications = pgTable(
  "atelier_salon_notifications",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    salonUserId: text("salon_user_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    kind: text("kind").notNull(), // deliverable_published | decision_recorded | request_resolved | invite
    headline: text("headline").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_salon_notif_user").on(t.salonUserId),
    index("idx_atelier_salon_notif_eng").on(t.engagementId),
  ],
);

// Salon-side audit feed (every client view, download attempt, decision).
// Internal-side audit_events keeps a parallel "agent.* / publish.*" trail.
export const atelierSalonAuditEvents = pgTable(
  "atelier_salon_audit_events",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    salonUserId: text("salon_user_id"),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(), // tab.view | deliverable.view | deliverable.download_blocked | decision.record | request.raise
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    payload: jsonb("payload").notNull().default({}),
    payloadSummary: text("payload_summary"),
    ts: timestamp("ts").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_salon_audit_eng").on(t.engagementId),
    index("idx_atelier_salon_audit_user").on(t.salonUserId),
    index("idx_atelier_salon_audit_ts").on(t.ts),
  ],
);

// ============================================================
// ADMIN SETTINGS — Task #243 firm-wide config persistence.
// One row per orgId. The settings shape (model controls, PII patterns,
// compliance posture, etc.) lives in the JSONB `value` column so the
// /admin/settings + /admin/compliance endpoints can extend without a
// schema migration per field.
// ============================================================
export const atelierAdminSettings = pgTable("atelier_admin_settings", {
  orgId: text("org_id").primaryKey(),
  value: jsonb("value").notNull().default({}).$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================================
// v3 ROSTER (Task #254) — Employees / Contractors / Partner-firm
// resources, plus partner economics, conflict disclosures, and
// person documents. See PRD §2.1.
// ============================================================
export const atelierEmployees = pgTable(
  "atelier_employees",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    userId: text("user_id"), // FK → atelier_users (nullable: pre-login hires)
    employeeIdExternal: text("employee_id_external"),
    fullName: text("full_name").notNull(),
    preferredName: text("preferred_name"),
    email: text("email").notNull(),
    role: text("role").notNull(), // mirrors atelier_users.role
    seniority: text("seniority").notNull().default("consultant"),
    // 'analyst' | 'consultant' | 'senior_consultant' | 'manager' | 'principal' | 'partner'
    title: text("title"),
    homeOffice: text("home_office"),
    country: text("country"),
    payrollCountry: text("payroll_country"),
    employmentType: text("employment_type").notNull().default("FTE"), // FTE | fixed_term | intern
    employmentStatus: text("employment_status").notNull().default("active"), // active | notice | on_leave | terminated (PRD §2.1)
    employingEntity: text("employing_entity"), // DIFC | ADGM | KSA | Other (PRD §2.1)
    startDate: text("start_date"), // ISO date
    endDate: text("end_date"),
    status: text("status").notNull().default("active"), // active | on_leave | offboarded
    iban: text("iban"),
    swift: text("swift"),
    noticePeriodDays: integer("notice_period_days").notNull().default(30),
    baseCurrency: text("base_currency"), // PRD §2.1 (policy-locked)
    baseCompensation: doublePrecision("base_compensation"), // PRD §2.1 (policy-locked)
    utilizationTargetPct: integer("utilization_target_pct"), // PRD §2.1
    partnerEconomicsId: text("partner_economics_id"),
    avatarUrl: text("avatar_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_employees_org").on(t.orgId),
    index("idx_atelier_employees_user").on(t.userId),
    index("idx_atelier_employees_status").on(t.status),
    uniqueIndex("uniq_atelier_employees_email").on(t.orgId, t.email),
  ],
);

export const atelierContractors = pgTable(
  "atelier_contractors",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    country: text("country"),
    vendorEntity: text("vendor_entity"),
    masterAgreementRef: text("master_agreement_ref"),
    contractType: text("contract_type"), // T&M | fixed_fee | retainer (PRD §2.1)
    contractStart: text("contract_start"),
    contractEnd: text("contract_end"),
    dayRateAmount: doublePrecision("day_rate_amount"),
    dayRateInternalCost: doublePrecision("day_rate_internal_cost"), // PRD §2.1 (policy-locked)
    dayRateCurrency: text("day_rate_currency").notNull().default("USD"),
    paymentTermsDays: integer("payment_terms_days"), // PRD §2.1
    vatTreatment: text("vat_treatment"), // PRD §2.1 (zero_rated | standard | exempt | reverse_charge)
    engagementScopeDefault: jsonb("engagement_scope_default")
      .$type<string[]>()
      .notNull()
      .default([]), // PRD §2.1 — default scope chips applied on grant
    contractingEntity: text("contracting_entity"), // PRD §2.1 (which AICo entity contracts them)
    conflictsDisclosedJson: jsonb("conflicts_disclosed_json")
      .$type<Array<{ party: string; nature: string }>>()
      .notNull()
      .default([]), // PRD §2.1 (snapshot at contract sign)
    startDate: text("start_date"),
    endDate: text("end_date"),
    status: text("status").notNull().default("active"), // active | paused | offboarded
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_contractors_org").on(t.orgId),
    index("idx_atelier_contractors_status").on(t.status),
  ],
);

export const atelierPartnerFirms = pgTable(
  "atelier_partner_firms",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    country: text("country"),
    hqCountry: text("hq_country"), // PRD §2.1
    masterAgreementRef: text("master_agreement_ref"),
    masterAgreementUrl: text("master_agreement_url"),
    masterAgreementStatus: text("master_agreement_status").notNull().default("active"), // PRD §2.1: signed | pending | expired
    masterAgreementEnd: text("master_agreement_end"), // PRD §2.1
    primaryContactUserId: text("primary_contact_user_id"), // PRD §2.1
    defaultPaymentTermsDays: integer("default_payment_terms_days"), // PRD §2.1
    rateCardId: text("rate_card_id"), // PRD §2.1
    defaultBillingCurrency: text("default_billing_currency"), // PRD §2.1
    insuranceStatus: text("insurance_status"), // PRD §2.1
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    status: text("status").notNull().default("active"), // active | paused | terminated
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_partner_firms_org").on(t.orgId)],
);

export const atelierPartnerFirmResources = pgTable(
  "atelier_partner_firm_resources",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    role: text("role"),
    roleOnEngagement: text("role_on_engagement"), // PRD §2.1
    seniority: text("seniority"),
    seniorityBand: text("seniority_band"), // PRD §2.1
    country: text("country"),
    secondedToEngagementIds: jsonb("seconded_to_engagement_ids")
      .$type<string[]>()
      .notNull()
      .default([]), // PRD §2.1
    costToAicoPerDay: doublePrecision("cost_to_aico_per_day"), // PRD §2.1 (policy-locked)
    visibleToClientInTeamTab: boolean("visible_to_client_in_team_tab").notNull().default(false), // PRD §2.1
    partnerFirmPmUserId: text("partner_firm_pm_user_id"), // PRD §2.1
    dayRateAmount: doublePrecision("day_rate_amount"),
    dayRateCurrency: text("day_rate_currency").notNull().default("USD"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    status: text("status").notNull().default("active"), // active | paused | offboarded
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_partner_firm_res_org").on(t.orgId),
    index("idx_atelier_partner_firm_res_firm").on(t.partnerFirmId),
  ],
);

// Placeholder per PRD §2.1 — full schema lands in a later task.
export const atelierPartnerEconomics = pgTable(
  "atelier_partner_economics",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    employeeId: text("employee_id").notNull(),
    model: text("model"), // PRD §2.1: equal_partnership | eat_what_you_kill | base_plus_share
    revenueSharePct: doublePrecision("revenue_share_pct"), // PRD §2.1
    baseAmount: doublePrecision("base_amount"), // PRD §2.1
    currency: text("currency"), // PRD §2.1
    effectiveFrom: text("effective_from"), // PRD §2.1
    effectiveTo: text("effective_to"), // PRD §2.1
    profitShareBps: integer("profit_share_bps").notNull().default(0),
    vestingSchedule: jsonb("vesting_schedule")
      .$type<Array<{ date: string; bps: number }>>()
      .notNull()
      .default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_partner_econ_org").on(t.orgId),
    index("idx_atelier_partner_econ_emp").on(t.employeeId),
  ],
);

export const atelierConflictDisclosures = pgTable(
  "atelier_conflict_disclosures",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee | contractor | partner_firm_resource
    personId: text("person_id").notNull(),
    disclosureText: text("disclosure_text").notNull(),
    declaredParty: text("declared_party"), // PRD §2.1
    nature: text("nature"), // PRD §2.1
    scopeImpact: text("scope_impact"), // PRD §2.1 (which engagement-scope chips this conflict touches)
    declaredAt: timestamp("declared_at").defaultNow(),
    lastReviewedAt: timestamp("last_reviewed_at"), // PRD §2.1
    disclosedAt: timestamp("disclosed_at").notNull().defaultNow(),
    status: text("status").notNull().default("active"), // active | cleared | escalated
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_conflict_org").on(t.orgId),
    index("idx_atelier_conflict_person").on(t.personType, t.personId),
  ],
);

export const atelierPersonDocuments = pgTable(
  "atelier_person_documents",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee | contractor | partner_firm_resource
    personId: text("person_id").notNull(),
    kind: text("kind").notNull(), // PRD §2.1: contract | nda | client_nda | coi | id | tax | cert | other
    clientAccountId: text("client_account_id"), // PRD §2.1 — for client_nda etc.
    title: text("title").notNull(),
    fileRef: text("file_ref"), // PRD §2.1 (object-storage ref; signed-url infra lands later)
    fileUrl: text("file_url"),
    signedAt: timestamp("signed_at"), // PRD §2.1
    uploadedByUserId: text("uploaded_by_user_id"),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_person_docs_org").on(t.orgId),
    index("idx_atelier_person_docs_person").on(t.personType, t.personId),
  ],
);

// ============================================================
// Task #255 — Onboarding / Offboarding sequences + Compliance + Invitations
// ============================================================

// Invitations — pre-onboarding hand-off. A pending row holds the personDraft
// (full_name + email + worker_type + role) until accepted, at which point
// the Onboarding Concierge materialises the actual person row + sequence.
export const atelierInvitations = pgTable(
  "atelier_invitations",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    workerType: text("worker_type").notNull(), // employee | contractor | partner_firm_resource
    personDraft: jsonb("person_draft")
      .$type<{
        fullName: string;
        email: string;
        role?: string | null;
        seniority?: string | null;
        title?: string | null;
        country?: string | null;
        partnerFirmId?: string | null;
        startDate?: string | null;
      }>()
      .notNull(),
    sentByUserId: text("sent_by_user_id").notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
    acceptedAt: timestamp("accepted_at"),
    acceptedPersonId: text("accepted_person_id"), // FK to materialised person row
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id"),
    status: text("status").notNull().default("sent"), // sent | accepted | expired | revoked
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_invitations_org").on(t.orgId),
    index("idx_atelier_invitations_status").on(t.status),
  ],
);

export const atelierOnboardings = pgTable(
  "atelier_onboardings",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee | contractor | partner_firm_resource
    personId: text("person_id").notNull(),
    invitationId: text("invitation_id"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    targetStartDate: text("target_start_date"),
    completedAt: timestamp("completed_at"),
    blockedAt: timestamp("blocked_at"),
    blockedReason: text("blocked_reason"),
    status: text("status").notNull().default("in_flight"), // in_flight | complete | blocked | cancelled
    ownerUserId: text("owner_user_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_onboardings_org").on(t.orgId),
    index("idx_atelier_onboardings_person").on(t.personType, t.personId),
    index("idx_atelier_onboardings_status").on(t.status),
  ],
);

export const atelierOnboardingSteps = pgTable(
  "atelier_onboarding_steps",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    onboardingId: text("onboarding_id").notNull(),
    sortKey: integer("sort_key").notNull().default(0),
    code: text("code").notNull(), // e.g. nda.signed | sso.provisioned | calendar.welcome
    title: text("title").notNull(),
    description: text("description"),
    ownerRole: text("owner_role"), // operations | partner | engagement_lead | hr | itself
    deadline: text("deadline"),
    status: text("status").notNull().default("pending"), // pending | in_progress | done | blocked | skipped
    completedAt: timestamp("completed_at"),
    completedByUserId: text("completed_by_user_id"),
    blockedReason: text("blocked_reason"),
    isComplianceGate: boolean("is_compliance_gate").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_onb_steps_org").on(t.orgId),
    index("idx_atelier_onb_steps_onb").on(t.onboardingId),
    index("idx_atelier_onb_steps_status").on(t.status),
  ],
);

export const atelierOffboardings = pgTable(
  "atelier_offboardings",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(),
    personId: text("person_id").notNull(),
    initiatedAt: timestamp("initiated_at").notNull().defaultNow(),
    initiatedByUserId: text("initiated_by_user_id"),
    lastWorkingDate: text("last_working_date"),
    completedAt: timestamp("completed_at"),
    blockedAt: timestamp("blocked_at"),
    blockedReason: text("blocked_reason"),
    status: text("status").notNull().default("in_flight"), // in_flight | complete | blocked | cancelled
    auditPackUrl: text("audit_pack_url"), // signed by the Partner upon final
    auditPackSignedByUserId: text("audit_pack_signed_by_user_id"),
    auditPackSignedAt: timestamp("audit_pack_signed_at"),
    reason: text("reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_offb_org").on(t.orgId),
    index("idx_atelier_offb_person").on(t.personType, t.personId),
    index("idx_atelier_offb_status").on(t.status),
  ],
);

export const atelierOffboardingSteps = pgTable(
  "atelier_offboarding_steps",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    offboardingId: text("offboarding_id").notNull(),
    sortKey: integer("sort_key").notNull().default(0),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    ownerRole: text("owner_role"),
    deadline: text("deadline"),
    status: text("status").notNull().default("pending"),
    completedAt: timestamp("completed_at"),
    completedByUserId: text("completed_by_user_id"),
    blockedReason: text("blocked_reason"),
    isReassignmentGate: boolean("is_reassignment_gate").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_offb_steps_org").on(t.orgId),
    index("idx_atelier_offb_steps_offb").on(t.offboardingId),
    index("idx_atelier_offb_steps_status").on(t.status),
  ],
);

// Compliance records — DIFC/ADGM/KSA registrations, Iqama/visa expirations,
// WPS readiness, GOSI, master agreements. Reference numbers (visa/Iqama)
// are stored in `referenceNumberRedacted` (only the last-four digits, padded
// with •) plus `referenceNumberLastFour`. Raw numbers are NEVER persisted —
// see PII redaction wrapper in roster-lifecycle-routes.ts.
export const atelierComplianceRecords = pgTable(
  "atelier_compliance_records",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type"), // null = entity-level (e.g., master agreement)
    personId: text("person_id"),
    partnerFirmId: text("partner_firm_id"),
    kind: text("kind").notNull(), // visa | iqama | gosi | wps | difc | adgm | ksa_cr | saudization | master_agreement | cert
    jurisdiction: text("jurisdiction"), // KSA | UAE_DIFC | UAE_ADGM | UAE_OTHER | EGY | ...
    referenceNumberRedacted: text("reference_number_redacted"), // e.g. "••••1234"
    referenceNumberLastFour: text("reference_number_last_four"),
    // Indicator that the original reference value never enters this row in
    // plaintext; raw values are dropped at ingest by `redactReference()` and
    // — when a vault integration is wired — only the encrypted ciphertext
    // would ever be persisted (in a separate vault, not this row). Defaults
    // true since every write path in this codebase already strips raws.
    encryptedAtRest: boolean("encrypted_at_rest").notNull().default(true),
    issuedDate: text("issued_date"),
    expiryDate: text("expiry_date"),
    status: text("status").notNull().default("active"), // active | expiring | expired | pending | exempt
    metadata: jsonb("metadata")
      .$type<{
        saudizationQuotaRequired?: number;
        saudizationQuotaActual?: number;
        wpsBankFile?: string | null;
        gosiAmountSar?: number;
        clientName?: string;
        sponsorEntity?: string;
        agentReadable?: Record<string, string | number | boolean>;
      }>()
      .notNull()
      .default({}),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_compliance_org").on(t.orgId),
    index("idx_atelier_compliance_person").on(t.personType, t.personId),
    index("idx_atelier_compliance_kind").on(t.kind),
    index("idx_atelier_compliance_expiry").on(t.expiryDate),
  ],
);

// ============================================================
// SKILL GRAPH (Task #256 — v3 §10)
// Small namespaced taxonomy + per-person proficiency with source.
// `atelier_person_skills` is INTENTIONALLY restricted to employees and
// contractors at the route layer — partner-firm resources are never
// listed (architectural rule). Schema does not enforce this; the
// `personType` is treated as data and validated server-side.
// ============================================================
export const atelierSkills = pgTable(
  "atelier_skills",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // tech | industry | function | language | tool
    parentId: text("parent_id"),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_skills_org").on(t.orgId),
    index("idx_atelier_skills_kind").on(t.kind),
    uniqueIndex("uniq_atelier_skills_slug").on(t.orgId, t.slug),
  ],
);

export const atelierPersonSkills = pgTable(
  "atelier_person_skills",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee | contractor
    personId: text("person_id").notNull(),
    skillId: text("skill_id").notNull(),
    // 1..5 (Junior practitioner → Recognized expert)
    proficiency: integer("proficiency").notNull().default(3),
    // self | partner_attested | evidence_atelier | certification | agent_inferred
    source: text("source").notNull(),
    // Pointers to atelier_assets / atelier_deliverable_versions / atelier_engagements
    // that justify this row. Stored as opaque ids; the search endpoint hydrates
    // labels at read time.
    evidenceArtifactIds: jsonb("evidence_artifact_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    evidenceSummary: text("evidence_summary"),
    // Confidence is only meaningful for `agent_inferred` rows (0..1). For
    // human-asserted rows we leave it null and let proficiency carry the signal.
    confidence: doublePrecision("confidence"),
    // active | dismissed | superseded — soft-delete via deletedAt is reserved
    // for hard removal; dismissed keeps the negative signal so the mapper
    // does not propose the same skill again.
    status: text("status").notNull().default("active"),
    verifiedByUserId: text("verified_by_user_id"),
    verifiedAt: timestamp("verified_at"),
    proposedByAgentId: text("proposed_by_agent_id"),
    proposedAt: timestamp("proposed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_person_skills_person").on(t.personType, t.personId),
    index("idx_atelier_person_skills_skill").on(t.skillId),
    index("idx_atelier_person_skills_source").on(t.source),
    index("idx_atelier_person_skills_status").on(t.status),
    uniqueIndex("uniq_atelier_person_skills").on(
      t.personType,
      t.personId,
      t.skillId,
      t.source,
    ),
  ],
);

// ============================================================
// LEDGER — TIMESHEETS + CALENDAR + PARTNER-FIRM HOURS (Task #257)
// v3 §11 — Time Steward agent writes draft entries + immutable signals;
// humans submit, leads/partners approve. Partner-firm resources never
// appear in /ledger/timesheets — their hours land in atelier_partner_firm_hours
// via a partner-firm CSV upload (cost passthrough into engagement economics).
// Indexes per PRD: (person_id, work_date), (engagement_id, work_date), (status).
// ============================================================
export const atelierCalendarEvents = pgTable(
  "atelier_calendar_events",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personId: text("person_id").notNull(), // employee.id (emp_*) or contractor.id
    personType: text("person_type").notNull().default("employee"), // employee | contractor
    title: text("title").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    durationMins: integer("duration_mins").notNull(),
    attendees: jsonb("attendees").$type<Array<{ name: string; email?: string; org?: string }>>().notNull().default([]),
    engagementHint: text("engagement_hint"), // engagement_id if Steward could match
    sourceProvider: text("source_provider").notNull().default("synthetic"), // synthetic | google | outlook
    sourceEventId: text("source_event_id"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_cal_person_date").on(t.personId, t.startsAt),
    index("idx_atelier_cal_org").on(t.orgId),
  ],
);

export const atelierTimesheetWeeks = pgTable(
  "atelier_timesheet_weeks",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personId: text("person_id").notNull(), // employee.id or contractor.id
    personType: text("person_type").notNull(), // employee | contractor
    weekIso: text("week_iso").notNull(), // YYYY-Www (ISO 8601 week)
    weekStartDate: text("week_start_date").notNull(), // ISO date — Monday
    status: text("status").notNull().default("draft"),
    // draft | submitted | lead_approved | partner_approved | rejected
    submittedAt: timestamp("submitted_at"),
    submittedByUserId: text("submitted_by_user_id"),
    leadApprovedAt: timestamp("lead_approved_at"),
    leadApprovedByUserId: text("lead_approved_by_user_id"),
    partnerApprovedAt: timestamp("partner_approved_at"),
    partnerApprovedByUserId: text("partner_approved_by_user_id"),
    rejectedAt: timestamp("rejected_at"),
    rejectedByUserId: text("rejected_by_user_id"),
    rejectionReason: text("rejection_reason"),
    totalHours: doublePrecision("total_hours").notNull().default(0),
    billableHours: doublePrecision("billable_hours").notNull().default(0),
    suspiciousFlags: jsonb("suspicious_flags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("uniq_atelier_ts_week").on(t.personId, t.weekIso),
    index("idx_atelier_ts_week_status").on(t.status),
    index("idx_atelier_ts_week_org").on(t.orgId),
  ],
);

export const atelierTimesheetEntries = pgTable(
  "atelier_timesheet_entries",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    weekId: text("week_id").notNull(),
    personId: text("person_id").notNull(),
    personType: text("person_type").notNull(),
    workDate: text("work_date").notNull(), // ISO date
    engagementId: text("engagement_id"), // nullable for non-billable activities
    activityCode: text("activity_code"), // billable | internal | training | bench | leave | partner_firm
    hours: doublePrecision("hours").notNull().default(0),
    billable: boolean("billable").notNull().default(false),
    narrative: text("narrative"),
    source: text("source").notNull().default("human"), // human | agent_drafted
    draftedByAgentId: text("drafted_by_agent_id"),
    signalIds: jsonb("signal_ids").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("draft"), // draft | submitted | approved | rejected
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_ts_entry_person_date").on(t.personId, t.workDate),
    index("idx_atelier_ts_entry_eng_date").on(t.engagementId, t.workDate),
    index("idx_atelier_ts_entry_status").on(t.status),
    index("idx_atelier_ts_entry_week").on(t.weekId),
  ],
);

// Immutable evidence rows. The Time Steward writes one row per detected
// signal (calendar event, meeting attendance, deliverable edit, Salon
// decision) and never deletes them; entries reference them by id so the
// approval UI can show "why was this proposed?" provenance.
export const atelierTimesheetSignals = pgTable(
  "atelier_timesheet_signals",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    weekId: text("week_id").notNull(),
    personId: text("person_id").notNull(),
    workDate: text("work_date").notNull(),
    signalType: text("signal_type").notNull(), // calendar | meeting | deliverable_edit | salon_decision
    sourceRefType: text("source_ref_type").notNull(),
    sourceRefId: text("source_ref_id").notNull(),
    engagementHint: text("engagement_hint"),
    evidenceSummary: text("evidence_summary").notNull(),
    weightHours: doublePrecision("weight_hours").notNull().default(0),
    observedAt: timestamp("observed_at").notNull().defaultNow(),
    runId: text("run_id"), // atelier_agent_runs.id of the Steward run that emitted it
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_ts_signal_week").on(t.weekId),
    index("idx_atelier_ts_signal_person_date").on(t.personId, t.workDate),
  ],
);

export const atelierPartnerFirmHours = pgTable(
  "atelier_partner_firm_hours",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    partnerFirmId: text("partner_firm_id").notNull(),
    partnerFirmResourceId: text("partner_firm_resource_id"),
    resourceName: text("resource_name").notNull(),
    weekIso: text("week_iso").notNull(),
    workDate: text("work_date"), // optional per-day breakdown
    hours: doublePrecision("hours").notNull().default(0),
    costAmount: doublePrecision("cost_amount").notNull().default(0),
    costCurrency: text("cost_currency").notNull().default("USD"),
    csvUploadRef: text("csv_upload_ref"), // identifier of the upload batch
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
    uploadedByUserId: text("uploaded_by_user_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pfh_eng").on(t.engagementId),
    index("idx_atelier_pfh_firm").on(t.partnerFirmId),
    index("idx_atelier_pfh_week").on(t.weekIso),
  ],
);

// ============================================================
// Task #258 — v3 Ledger: Utilization snapshots (computed weekly)
// ============================================================
export const atelierUtilizationSnapshots = pgTable(
  "atelier_utilization_snapshots",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personId: text("person_id").notNull(),
    personType: text("person_type").notNull().default("employee"), // employee | contractor
    weekIso: text("week_iso").notNull(),
    weekStartDate: text("week_start_date").notNull(),
    billableHours: doublePrecision("billable_hours").notNull().default(0),
    internalHours: doublePrecision("internal_hours").notNull().default(0),
    leaveHours: doublePrecision("leave_hours").notNull().default(0),
    totalHours: doublePrecision("total_hours").notNull().default(0),
    availableHours: doublePrecision("available_hours").notNull().default(40),
    utilizationPct: doublePrecision("utilization_pct").notNull().default(0),
    targetPct: doublePrecision("target_pct").notNull().default(0),
    // engagement_mix: array of { engagementId, name, hours, billable }
    engagementMix: jsonb("engagement_mix").notNull().default([]).$type<
      Array<{ engagementId: string | null; name: string; hours: number; billable: boolean }>
    >(),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_atelier_utilization_snap").on(t.personId, t.weekIso),
    index("idx_atelier_utilization_snap_week").on(t.weekIso),
    index("idx_atelier_utilization_snap_org").on(t.orgId),
  ],
);

// ============================================================
// Task #259 — v3 Wallet: Expenses + Cards + Policies + FX + VAT
// ============================================================

/**
 * Corporate-card metadata stub. We DO NOT integrate a live bank API here —
 * each row records the provider (Pleo/Brex/Mesh), the cardholder, and a
 * masked PAN suffix. The seed produces synthetic card-line drafts via
 * atelierExpenses.captureSource = 'card_feed'.
 */
export const atelierCorporateCards = pgTable(
  "atelier_corporate_cards",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    provider: text("provider").notNull(), // pleo | brex | mesh | manual
    cardholderUserId: text("cardholder_user_id").notNull(),
    last4: text("last4").notNull(),
    label: text("label"),
    currency: text("currency").notNull().default("USD"),
    monthlyLimitAmount: doublePrecision("monthly_limit_amount").notNull().default(0),
    status: text("status").notNull().default("active"), // active | frozen | closed
    linkedAt: timestamp("linked_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_cards_holder").on(t.cardholderUserId),
    index("idx_atelier_cards_org").on(t.orgId),
  ],
);

/**
 * Expense policy rules. One row per (category, applies_to_role|null,
 * applies_to_country|null) tuple. The Auditor consults these on every
 * draft to flag AMBER (over-cap with rationale) or RED (hard block).
 * approvalThresholdUsd routes the expense through partner approval.
 */
export const atelierExpensePolicies = pgTable(
  "atelier_expense_policies",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    category: text("category").notNull(), // flight | hotel | meal | gift | software | mileage | per_diem | taxi | other
    appliesToRole: text("applies_to_role"), // null = all
    appliesToCountry: text("applies_to_country"), // null = all
    capAmountUsd: doublePrecision("cap_amount_usd"),
    capUnit: text("cap_unit"), // per_trip | per_day | per_month | per_item
    hardBlockAmountUsd: doublePrecision("hard_block_amount_usd"),
    approvalThresholdUsd: doublePrecision("approval_threshold_usd"),
    flightClassMax: text("flight_class_max"), // economy | premium_economy | business
    rationale: text("rationale"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_policy_cat").on(t.category),
  ],
);

/**
 * FX rates — daily quotes. Deterministic-seeded; NOT live.
 * `base` is always "USD"; one row per (date, quote).
 */
export const atelierFxRates = pgTable(
  "atelier_fx_rates",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    date: text("date").notNull(), // YYYY-MM-DD
    base: text("base").notNull().default("USD"),
    quote: text("quote").notNull(), // SAR | AED | EUR | TRY | GBP ...
    rate: doublePrecision("rate").notNull(), // units of quote per 1 base
    source: text("source").notNull().default("seed"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_atelier_fx_date_pair").on(t.date, t.base, t.quote),
    index("idx_atelier_fx_date").on(t.date),
  ],
);

/**
 * Expenses — the wallet's primary record.
 *
 * Captured via four paths:
 *   - card_feed   : synthetic draft from atelierCorporateCards
 *   - manual      : user-uploaded receipt (file blob ref + Auditor OCR)
 *   - mileage     : km × rate, no receipt required below cap
 *   - per_diem    : day-bucket allowance per country
 *
 * Multi-currency: amount/currency are the original values.
 * usdAmount + fxRate + fxRateDate snapshot the conversion at submission.
 *
 * Policy outcome: policyStatus ∈ green | amber | red. AMBER allows
 * override-with-rationale; RED is a hard block until edited.
 *
 * Receipt encryption: receiptEncryptedAtRest is an indicator field
 * (we don't run real KMS in this build); ocrPayloadRedactedAt records
 * when the 90-day OCR-payload retention job stripped the raw OCR JSON,
 * leaving only the redacted summary.
 */
export const atelierExpenses = pgTable(
  "atelier_expenses",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personId: text("person_id").notNull(), // atelier_users.id of submitter
    personType: text("person_type").notNull().default("employee"), // employee | contractor
    engagementId: text("engagement_id"), // null for non-billable / firm overhead
    expenseDate: text("expense_date").notNull(), // YYYY-MM-DD
    captureSource: text("capture_source").notNull(), // card_feed | manual | mileage | per_diem
    cardId: text("card_id"), // FK-ish to atelierCorporateCards when card_feed
    merchant: text("merchant"),
    description: text("description"),
    category: text("category").notNull().default("other"),
    amount: doublePrecision("amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    fxRate: doublePrecision("fx_rate").notNull().default(1), // amount * (1/fxRate) when base=USD; we store quote per USD, so usd = amount / rate
    fxRateDate: text("fx_rate_date"),
    usdAmount: doublePrecision("usd_amount").notNull().default(0),
    vatAmount: doublePrecision("vat_amount").notNull().default(0),
    vatCurrency: text("vat_currency"),
    vatTreatment: text("vat_treatment").notNull().default("none"), // ksa_15 | uae_5 | zero_rated_export | none
    vatCountry: text("vat_country"), // KSA | UAE | TR | ...
    clientBillable: boolean("client_billable").notNull().default(false),
    markupPct: doublePrecision("markup_pct").notNull().default(0),
    status: text("status").notNull().default("draft"), // draft | submitted | approved | rejected
    policyStatus: text("policy_status").notNull().default("green"), // green | amber | red
    policyFindings: jsonb("policy_findings").notNull().default([]).$type<
      Array<{
        ruleId: string;
        severity: "amber" | "red";
        category: string;
        message: string;
      }>
    >(),
    overrideRationale: text("override_rationale"),
    auditorRunId: text("auditor_run_id"), // atelier_agent_runs.id of the Auditor that scored this
    auditorProposal: jsonb("auditor_proposal").default(null).$type<{
      category?: string;
      vatTreatment?: string;
      vatAmount?: number;
      clientBillable?: boolean;
      markupPct?: number;
      summary?: string;
      ocrConfidence?: "green" | "amber" | "red";
    } | null>(),
    receiptFileRef: text("receipt_file_ref"), // synthetic blob ref
    receiptFixtureKey: text("receipt_fixture_key"), // deterministic OCR fixture id
    receiptEncryptedAtRest: boolean("receipt_encrypted_at_rest").notNull().default(true),
    ocrPayload: jsonb("ocr_payload").default(null).$type<unknown>(),
    ocrPayloadRedactedAt: timestamp("ocr_payload_redacted_at"),
    summary: text("summary"), // human one-liner; survives OCR redaction
    submittedAt: timestamp("submitted_at"),
    approvedAt: timestamp("approved_at"),
    approvedByUserId: text("approved_by_user_id"),
    rejectedAt: timestamp("rejected_at"),
    rejectedReason: text("rejected_reason"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_expense_person_date").on(t.personId, t.expenseDate),
    index("idx_atelier_expense_eng_status").on(t.engagementId, t.status),
    index("idx_atelier_expense_status").on(t.status),
    index("idx_atelier_expense_org").on(t.orgId),
  ],
);

/**
 * VAT register — bucketed by treatment + country. We materialise a row
 * per approved expense at approval time so the auditor view + CSV export
 * stay independent of the live expense rows (and survive OCR-payload
 * redaction). Rows are append-only; corrections are issued as new rows
 * with negative amounts and a `correctionOfId` back-reference.
 */
export const atelierVatRegister = pgTable(
  "atelier_vat_register",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    expenseId: text("expense_id").notNull(),
    correctionOfId: text("correction_of_id"),
    expenseDate: text("expense_date").notNull(),
    country: text("country").notNull(),
    treatment: text("treatment").notNull(), // ksa_15 | uae_5 | zero_rated_export | none
    rate: doublePrecision("rate").notNull().default(0),
    netAmount: doublePrecision("net_amount").notNull().default(0),
    vatAmount: doublePrecision("vat_amount").notNull().default(0),
    grossAmount: doublePrecision("gross_amount").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    usdNet: doublePrecision("usd_net").notNull().default(0),
    usdVat: doublePrecision("usd_vat").notNull().default(0),
    usdGross: doublePrecision("usd_gross").notNull().default(0),
    merchant: text("merchant"),
    summary: text("summary"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_vat_country_treatment").on(t.country, t.treatment),
    index("idx_atelier_vat_date").on(t.expenseDate),
    index("idx_atelier_vat_expense").on(t.expenseId),
  ],
);

// ============================================================
// Task #260 — v3 Wallet (II): Client-billable + payments + invoice-line drafts
// ============================================================

/**
 * Weekly contractor payment proposals composed by the Payment Proposer
 * agent. One row per (payeeUserId, engagementId, weekIso) bucket of
 * lead-approved timesheet entries. Status transitions:
 *   proposed -> partner_approved | rejected
 *   partner_approved -> paid (manual stub; v3 has no bank rails)
 * Partner approval is REQUIRED when usdAmount > 250.
 */
export const atelierContractorPayments = pgTable(
  "atelier_contractor_payments",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    payeeUserId: text("payee_user_id").notNull(),
    payeePersonType: text("payee_person_type").notNull().default("contractor"), // employee | contractor
    payeeName: text("payee_name").notNull(),
    engagementId: text("engagement_id").notNull(),
    weekIso: text("week_iso").notNull(),
    hours: doublePrecision("hours").notNull().default(0),
    ratePerHour: doublePrecision("rate_per_hour").notNull().default(0),
    rateCurrency: text("rate_currency").notNull().default("USD"),
    costAmount: doublePrecision("cost_amount").notNull().default(0),
    costCurrency: text("cost_currency").notNull().default("USD"),
    fxRate: doublePrecision("fx_rate").notNull().default(1),
    usdAmount: doublePrecision("usd_amount").notNull().default(0),
    status: text("status").notNull().default("proposed"), // proposed | partner_approved | paid | rejected
    requiresPartnerApproval: boolean("requires_partner_approval").notNull().default(false),
    proposalRunId: text("proposal_run_id"),
    evidenceEntryIds: jsonb("evidence_entry_ids").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    partnerApprovedByUserId: text("partner_approved_by_user_id"),
    partnerApprovedAt: timestamp("partner_approved_at"),
    partnerRationale: text("partner_rationale"),
    rejectedAt: timestamp("rejected_at"),
    rejectedReason: text("rejected_reason"),
    paidAt: timestamp("paid_at"),
    paidByUserId: text("paid_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_cp_eng_week").on(t.engagementId, t.weekIso),
    index("idx_atelier_cp_payee_status").on(t.payeeUserId, t.status),
    index("idx_atelier_cp_status").on(t.status),
    uniqueIndex("uq_atelier_cp_payee_eng_week").on(t.payeeUserId, t.engagementId, t.weekIso),
  ],
);

/**
 * Weekly partner-firm invoice proposals. Composed from
 * atelier_partner_firm_hours rows for a (partnerFirmId, engagementId,
 * weekIso) bucket. Partner approval is ALWAYS required (per spec:
 * any partner-firm proposal needs Partner sign-off).
 */
export const atelierPartnerFirmInvoices = pgTable(
  "atelier_partner_firm_invoices",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    partnerFirmName: text("partner_firm_name").notNull(),
    engagementId: text("engagement_id").notNull(),
    weekIso: text("week_iso").notNull(),
    hours: doublePrecision("hours").notNull().default(0),
    costAmount: doublePrecision("cost_amount").notNull().default(0),
    costCurrency: text("cost_currency").notNull().default("USD"),
    fxRate: doublePrecision("fx_rate").notNull().default(1),
    usdAmount: doublePrecision("usd_amount").notNull().default(0),
    status: text("status").notNull().default("proposed"), // proposed | partner_approved | paid | rejected
    proposalRunId: text("proposal_run_id"),
    evidenceFirmHourIds: jsonb("evidence_firm_hour_ids").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    partnerApprovedByUserId: text("partner_approved_by_user_id"),
    partnerApprovedAt: timestamp("partner_approved_at"),
    partnerRationale: text("partner_rationale"),
    rejectedAt: timestamp("rejected_at"),
    rejectedReason: text("rejected_reason"),
    paidAt: timestamp("paid_at"),
    paidByUserId: text("paid_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pfi_eng_week").on(t.engagementId, t.weekIso),
    index("idx_atelier_pfi_firm_status").on(t.partnerFirmId, t.status),
    index("idx_atelier_pfi_status").on(t.status),
    uniqueIndex("uq_atelier_pfi_firm_eng_week").on(t.partnerFirmId, t.engagementId, t.weekIso),
  ],
);

/**
 * Invoice-line draft set composed on-demand by the Invoice Composer agent
 * from (a) approved billable timesheet hours × applicable rate-card rate
 * and (b) approved client-billable expenses × markup. One row per
 * composer run; the latest non-deleted row per engagement is "current".
 * Lines payload is flattened for accountant handoff (JSON / CSV).
 */
export type InvoiceLineDraftKind = "hours" | "expense";
export interface InvoiceLineDraftLine {
  kind: InvoiceLineDraftKind;
  sourceId: string; // entry id or expense id
  description: string;
  qty: number; // hours OR 1 (per-expense)
  unitPriceUsd: number;
  amountUsd: number;
  markupPct?: number; // expenses only
  meta?: Record<string, unknown>;
}
export const atelierInvoiceLineDrafts = pgTable(
  "atelier_invoice_line_drafts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id").notNull(),
    composedAt: timestamp("composed_at").notNull().defaultNow(),
    composedByUserId: text("composed_by_user_id"),
    composerRunId: text("composer_run_id"),
    rateCardId: text("rate_card_id"),
    lines: jsonb("lines").notNull().default([]).$type<InvoiceLineDraftLine[]>(),
    totals: jsonb("totals").notNull().default({}).$type<{
      hoursUsd: number;
      expensesNetUsd: number;
      markupUsd: number;
      totalUsd: number;
      lineCount: number;
    }>(),
    status: text("status").notNull().default("draft"), // draft | exported
    exportedAt: timestamp("exported_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_ild_eng").on(t.engagementId),
    index("idx_atelier_ild_status").on(t.status),
  ],
);
