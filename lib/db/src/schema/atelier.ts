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
    // Task #292 — 9-persona model: founding_partner | partner | finance | hr |
    // senior_manager | consultant | contractor | partner_firm_resource |
    // board_observer. Plain text (not pg enum) so the rolling migration in
    // scripts/src/migrate-persona-enum.ts can update values without an enum
    // ALTER. `legacy_role` preserves the pre-migration value for one release
    // for audit; `bd_active` flags personas allowed to author BD/proposal work.
    role: text("role").notNull(),
    legacyRole: text("legacy_role"),
    bdActive: boolean("bd_active").notNull().default(false),
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
    // Task #291 — FK code columns alongside legacy free-text. Nullable during
    // dual-write; backfilled by the auto-mapper at seed time. Original
    // free-text values stay in `country` / `sector` for one release as the
    // *_legacy shadow per task spec.
    countryCode: text("country_code"), // → atelier_countries.iso_alpha_2
    industryCode: text("industry_code"), // → atelier_industries.code
    subIndustryCode: text("sub_industry_code"), // → atelier_sub_industries.code
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
    // Task #275 — sourced strategic priorities. Each entry mirrors
    // `strategicPriorities[i]` and carries the citation URLs the
    // Cartographer used. Empty array means "no sources captured yet".
    strategicPriorityRefs: jsonb("strategic_priority_refs")
      .$type<Array<{ text: string; sourceUrls: string[] }>>()
      .notNull()
      .default([]),
    cogniriseHypothesis: text("cognirise_hypothesis"),
    // Task #601 — firmographic enrichment captured on create. All nullable so
    // existing rows keep validating; the Account Cartographer populates them on
    // the chat "Review & Create" flow, and the partner can edit on the dialog.
    // Approximate full-time headcount of the client firm (group-wide).
    employeeCount: integer("employee_count"),
    // Headline annual revenue + key financials. Never fabricated — left null
    // when not publicly disclosed. `currency` is the ISO-4217 code the figure
    // is reported in (may differ from the account's primaryCurrency).
    annualRevenue: jsonb("annual_revenue").$type<{
      amount?: number | null;
      currency?: string | null;
      asOf?: string | null; // fiscal year / "as of" label, e.g. "FY2025"
      sourceUrl?: string | null;
      note?: string | null; // free text for additional key financials
    }>(),
    // Multi-brand / holding-company structure. `brands` lists the key operating
    // brands/subsidiaries the partner should recognise.
    holdingStructure: jsonb("holding_structure").$type<{
      isHoldingCompany: boolean;
      isMultiBrand: boolean;
      brands: string[];
      note?: string | null;
    }>(),
    // Country footprint for multinationals. `role` flags whether the country
    // hosts the HQ, a subsidiary, or a branch/office.
    countryPresence: jsonb("country_presence")
      .$type<
        Array<{
          country: string;
          role?: "hq" | "subsidiary" | "branch" | "office" | null;
          note?: string | null;
        }>
      >()
      .notNull()
      .default([]),
    // Whether THIS account row represents the group HQ, a subsidiary, or a
    // branch — answered via the branch-vs-HQ chat clarification. Null until set.
    entityRole: text("entity_role"), // 'hq' | 'subsidiary' | 'branch'
    // Task #560 — structured research brief from the Account Cartographer
    // (Cognirise account-research method, Steps 1–3). Display-only blob that
    // sits alongside the typed firmographic fields; nullable until the
    // Cartographer enrichment hook runs.
    researchBrief: jsonb("research_brief").$type<{
      whatsChanging: Array<{ text: string; evidence: string; sourceUrls: string[] }>;
      executiveTensions: Array<{ text: string; evidence: string; sourceUrls: string[] }>;
      serviceLineFit: Array<{ serviceLine: string; signal: string; sourceUrls: string[] }>;
      partnerEcosystem: Array<{
        partner: string;
        relationship: string;
        serviceLineGap?: string | null;
        sourceUrls: string[];
      }>;
      // Task #589 — Step 4 group / business-unit structure for the prep card
      // map. Optional so briefs created before the 4-step method keep validating.
      businessUnits?: Array<{ name: string; brands: string[]; note?: string | null }>;
      mandateAngles: Array<{
        title: string;
        serviceLines: string[];
        tension: string;
        whyNow: string;
        entryStakeholder: string;
        sourceUrls: string[];
      }>;
      whyNowHypothesis: string;
      openQuestions: string[];
      singleMostImportant: string;
      // Task #589 — Step 3 stress-test of the origination hypothesis.
      // Optional so previously-researched accounts (brief without a
      // stress-test) keep validating; always written by the cartographer
      // going forward.
      stressTest?: {
        // 2–3 scenarios in which the hypothesis collapses / becomes moot.
        failureScenarios: string[];
        // Hidden assumptions, bucketed by how grounded they are.
        assumptions: {
          evidenced: string[];
          untestedButLikely: string[];
          uncertain: string[];
        };
        // The 3 most likely objections a skeptical first buyer would raise.
        likelyObjections: string[];
        // 2–3 pieces of evidence that would most strengthen the hypothesis,
        // each with where to find it.
        evidenceToStrengthen: Array<{ evidence: string; whereToFind: string }>;
        // The tightened one-sentence hypothesis after stress-testing.
        revisedHypothesis: string;
      };
    }>(),
    // Task #566 — Cognirise-authored account strategy. Distinct from the
    // AI-generated `cogniriseHypothesis`/`researchBrief`: this is the
    // partner's deliberate plan of record. Nullable until a partner fills
    // it in (or item-5 AI population proposes a draft).
    accountStrategy: jsonb("account_strategy").$type<{
      // Measurable objectives: each carries an optional target value and a
      // timeline/target date so progress is trackable (Task #571).
      objectives: Array<{
        id: string;
        text: string;
        targetValue?: string | null;
        targetDate?: string | null;
      }>;
      // Service lines Cognirise intends to lead with on this account.
      targetServiceLines: string[];
      // The single sentence that explains why Cognirise wins here.
      winHypothesis: string;
      // Concrete plays/moves the account team will run.
      keyPlays: string[];
    }>(),
    // Task #566 — competitive landscape / incumbents. Who else holds work
    // at the account and Cognirise's displacement angle for each.
    competitors: jsonb("competitors")
      .$type<
        Array<{
          id: string;
          name: string;
          holds?: string | null; // what footprint they currently hold
          displacementAngle?: string | null; // how Cognirise wins against them
        }>
      >()
      .notNull()
      .default([]),
    pendingProfileUpdates: jsonb("pending_profile_updates")
      .$type<
        Array<{
          id: string;
          proposedBy: string; // agent id, e.g. ag_pursuit_scout
          proposedAt: string;
          field: string; // dotted path: 'sector', 'hqCity', 'strategicPriorities', 'researchBrief', 'contact'
          fromValue: unknown;
          toValue: unknown;
          rationale: string;
          oppId?: string;
          status: "pending" | "approved" | "rejected";
          // Task #568 — governed AI population. Optional, jsonb-only (no
          // migration). `meta` carries side-channel data the applier needs
          // (e.g. strategicPriority citation refs, contact reportsToName).
          // The `edited*`/`originalToValue` fields record a partner inline
          // edit before approval; `decided*` record who acted and when.
          meta?: Record<string, unknown>;
          editedAt?: string;
          editedBy?: string;
          originalToValue?: unknown;
          decidedAt?: string;
          decidedBy?: string;
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
    // Task #567 — stakeholder relationship depth. `relationshipStrength`
    // is *our* relationship strength with this person (0–100), distinct
    // from `influenceScore` (their internal clout, 1–5). `nextTouchAt`
    // drives the contact-cadence prompt alongside `lastContactAt`.
    // `relationshipTrend` is a lightweight append-only history so the
    // org chart can show how sentiment/strength moved over time.
    relationshipStrength: integer("relationship_strength").notNull().default(0), // 0–100
    nextTouchAt: timestamp("next_touch_at"),
    relationshipTrend: jsonb("relationship_trend")
      .$type<
        Array<{
          at: string; // ISO timestamp
          strength: number; // 0–100 snapshot
          disposition?: string | null;
          note?: string | null;
        }>
      >()
      .notNull()
      .default([]),
    notes: text("notes"),
    // Task #589 — deep stakeholder profile (account-research skill Step 4,
    // "Person profile"). Populated by the Cartographer from LinkedIn / public
    // sources; surfaced in the Decision-Makers tab and the meeting-prep card.
    // All nullable / defaulted-empty so existing contacts keep validating.
    timeInRole: text("time_in_role"), // e.g. "16 months", "since 2022"
    careerHistory: jsonb("career_history")
      .$type<
        Array<{
          role: string;
          company: string;
          period?: string | null; // e.g. "2018–2022"
          highlight?: string | null; // what they built / owned there
        }>
      >()
      .notNull()
      .default([]),
    education: jsonb("education")
      .$type<
        Array<{
          institution: string;
          programme?: string | null; // degree / notable programme
          year?: string | null;
        }>
      >()
      .notNull()
      .default([]),
    // Task #275 — provenance for cartographer-sourced contacts.
    // sourceUrl is the canonical citation (e.g. LinkedIn profile, press
    // release, leadership page). confidence is 'verified' when at least
    // one citation backs the title + name, otherwise 'inferred'.
    sourceUrl: text("source_url"),
    confidence: text("confidence").notNull().default("inferred"),
    // Entity-scope fix — which entity this person's title sits at, so a
    // subsidiary/brand exec is never shown as group leadership. entityScope:
    // 'parent_group' | 'subsidiary' | 'division' | 'standalone'. Both nullable
    // so existing rows keep validating with no backfill.
    entityName: text("entity_name"),
    entityScope: text("entity_scope"),
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
// ACCOUNT INSIGHTS (Task #569)
// ============================================================
// Multi-author, attributed, timestamped human insight log on an account.
// Deliberately distinct from AI research (cogniriseHypothesis / researchBrief
// on atelier_accounts) and from the immutable audit trail (atelier_audit_events):
// this is the partners' / account managers' own running commentary. Entries are
// editable/deletable by their author only (enforced in route logic); soft-delete
// via deleted_at. `category` is an optional human tag.
export const atelierAccountInsights = pgTable(
  "atelier_account_insights",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    accountId: text("account_id").notNull(),
    // The persona who authored the insight (FK → atelier_users). Used to scope
    // edit/delete to the author and to attribute the entry in the feed.
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    // Optional human-chosen category. Free text at the DB layer; the API/UI
    // constrain it to: relationship | risk | competitive | opportunity | general.
    // Null = uncategorized.
    category: text("category"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_account_insights_org").on(t.orgId),
    index("idx_atelier_account_insights_account").on(t.accountId),
    index("idx_atelier_account_insights_author").on(t.authorId),
  ],
);

// ============================================================
// ACCOUNT TEAM MEMBERS (Task #569)
// ============================================================
// Additional people on an account beyond the single `partnerOwnerId` on
// atelier_accounts. Each row = one user with a role on the account. The owner
// is still the account's partnerOwnerId; this table captures account managers,
// delivery leads, and other contributors. Uniqueness of (accountId, userId)
// among non-deleted rows is enforced in route logic (soft-delete friendly).
export const atelierAccountTeamMembers = pgTable(
  "atelier_account_team_members",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    accountId: text("account_id").notNull(),
    userId: text("user_id").notNull(), // FK → atelier_users
    // account_manager | delivery_lead | partner | contributor (free text at DB
    // layer; API/UI constrain the set).
    roleOnAccount: text("role_on_account").notNull().default("contributor"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_account_team_org").on(t.orgId),
    index("idx_atelier_account_team_account").on(t.accountId),
    index("idx_atelier_account_team_user").on(t.userId),
  ],
);

// ============================================================
// ACCOUNT ACTION PLAN (Task #571)
// ============================================================
// The account-level execution backlog: discrete actions the account team
// owns to advance the account strategy. Distinct from the engagement-scoped
// task/burn surfaces — these are account-management actions (next steps,
// plays, follow-ups). Each action may link to a strategy objective (by id
// inside atelier_accounts.account_strategy.objectives) and/or a named play.
// `source` distinguishes a manually-authored action from one PROMOTED from
// an AI next-best-action; `sourceRef` carries the originating NBA id so the
// UI can mark that suggestion as actioned.
export const atelierAccountActions = pgTable(
  "atelier_account_actions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    accountId: text("account_id").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    // FK → atelier_users. The person accountable for the action. Nullable
    // (an action can be unassigned in the backlog).
    ownerId: text("owner_id"),
    // open | in_progress | done | cancelled (free text at DB layer; API/UI
    // constrain the set).
    status: text("status").notNull().default("open"),
    // high | medium | low.
    priority: text("priority").notNull().default("medium"),
    // ISO date string (text, mirrors atelier_raid_items.due_date). Nullable.
    dueDate: text("due_date"),
    // Optional link to a strategy objective id (inside the account's
    // account_strategy.objectives array). Null = not tied to a goal.
    linkedObjectiveId: text("linked_objective_id"),
    // Optional free-text link to a named play/move from the strategy.
    linkedPlay: text("linked_play"),
    // manual | promoted. `promoted` actions originated from an AI
    // next-best-action that a human accepted.
    source: text("source").notNull().default("manual"),
    // For promoted actions, the originating next-best-action id.
    sourceRef: text("source_ref"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_account_actions_org").on(t.orgId),
    index("idx_atelier_account_actions_account").on(t.accountId),
    index("idx_atelier_account_actions_owner").on(t.ownerId),
  ],
);

// ============================================================
// ACCOUNT RISK REGISTER (Task #571)
// ============================================================
// Account-level RAID, DISTINCT from atelier_raid_items (which is engagement-
// scoped). Captures strategic/commercial/relationship risks that live above
// any single engagement: severity, owner, mitigation, status. Mirrors the
// engagement RAID column shape so the two can be presented consistently.
export const atelierAccountRisks = pgTable(
  "atelier_account_risks",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    accountId: text("account_id").notNull(),
    // risk | assumption | issue | dependency (RAID), default risk.
    kind: text("kind").notNull().default("risk"),
    // green | amber | red.
    severity: text("severity").notNull().default("amber"),
    ownerId: text("owner_id"), // FK → atelier_users. Nullable.
    // open | mitigating | closed.
    status: text("status").notNull().default("open"),
    dueDate: text("due_date"),
    description: text("description").notNull(),
    mitigation: text("mitigation"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_account_risks_org").on(t.orgId),
    index("idx_atelier_account_risks_account").on(t.accountId),
  ],
);

// ============================================================
// ACCOUNT GOAL PROGRESS (Task #571)
// ============================================================
// Progress tracking for the measurable objectives defined inside
// atelier_accounts.account_strategy.objectives (each has an id + targetValue +
// targetDate). This table holds the LIVE current value + status for each
// objective so the plan can show current-vs-target and on-track/at-risk
// without mutating the strategy JSONB. One row per (accountId, objectiveId)
// among non-deleted rows (upserted by route logic).
export const atelierAccountGoalProgress = pgTable(
  "atelier_account_goal_progress",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    accountId: text("account_id").notNull(),
    // The strategy objective id this progress row tracks.
    objectiveId: text("objective_id").notNull(),
    // The current measured value (free text — mirrors targetValue which is
    // also free text, e.g. "AED 4.2M", "3 deployments").
    currentValue: text("current_value"),
    // on_track | at_risk | off_track | achieved.
    status: text("status").notNull().default("on_track"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_account_goal_progress_org").on(t.orgId),
    index("idx_atelier_account_goal_progress_account").on(t.accountId),
  ],
);

// ============================================================
// ACTIVITIES & TASKS (Task #631)
// ============================================================
// First-class, polymorphic activity / task entity. A row may hang off an
// account, a contact, or an opportunity (parentType/parentId), but always
// carries `accountId` so reads + the account-scope ACL can stay account-keyed
// without resolving the parent. `type` discriminates task | call | email |
// meeting; `status` is open | done. Tasks have an owner (assignee) + due date
// so they can be rolled up per-owner and flagged overdue. Soft-deleted.
export const atelierActivities = pgTable(
  "atelier_activities",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    // Owning account (scope key) — always set, even when the parent is a
    // contact or opportunity (resolved + denormalised at write time).
    accountId: text("account_id").notNull(),
    // account | contact | opportunity
    parentType: text("parent_type").notNull().default("account"),
    // The specific parent id (equals accountId when parentType=account).
    parentId: text("parent_id").notNull(),
    // task | call | email | meeting
    type: text("type").notNull().default("task"),
    title: text("title").notNull(),
    body: text("body"),
    ownerId: text("owner_id"), // FK → atelier_users (assignee). Nullable.
    dueDate: text("due_date"), // ISO date (free text, mirrors action plan).
    // open | done
    status: text("status").notNull().default("open"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_activities_org").on(t.orgId),
    index("idx_atelier_activities_account").on(t.accountId),
    index("idx_atelier_activities_parent").on(t.parentType, t.parentId),
    index("idx_atelier_activities_owner").on(t.ownerId),
    index("idx_atelier_activities_status").on(t.status),
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
    // Task #291 — FK code columns; legacy `sector` retained for one release.
    industryCode: text("industry_code"),
    subIndustryCode: text("sub_industry_code"),
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
    // Single source of truth for opportunity stage (Task #295/#654). The
    // legacy `plm_stage` column was retired in Task #654 — opportunities now
    // read and write `salesStage` exclusively (engagements keep plmStage).
    salesStage: text("sales_stage").notNull().default("suspect"),
    // Task #295 — 5 canonical + 3 terminal:
    // 'suspect' | 'prospect' | 'convert' | 'runner' | 'contract'
    // | 'lost' | 'no_decision' | 'withdrawn'
    // Sub-status second-level chip; valid values listed in pipeline.ts
    // SUB_STATUS_BY_STAGE. Null while no sub-status is applicable.
    subStatus: text("sub_status"),
    // Set the first time the opportunity reaches `runner`. Surfaces a
    // "days as runner" badge on the kanban so partners can spot deals
    // stuck in legal/procurement.
    runnerEnteredAt: timestamp("runner_entered_at", { withTimezone: true }),
    // Set when the signed instrument is uploaded (Runner→Contract gate).
    contractSignedAt: timestamp("contract_signed_at", { withTimezone: true }),
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
    // Task #334 — deterministic 6-dimension qualification rubric.
    // Set by `qualify_opportunity_rubric` and the `ingest_rfp_to_opportunity`
    // CLI flow. Composite is 0..100; band is `pursue` (≥70) / `watch`
    // (40–69) / `decline` (<40). Each dimension carries a 0..5 score, a
    // 1-line rationale, and the chunkIds that anchored it.
    qualificationRubric: jsonb("qualification_rubric").$type<{
      composite: number;
      band: "pursue" | "watch" | "decline";
      dimensions: Array<{
        // The exact six dimensions specified by Task #334.
        // `riskInverted` is scored 5 = clean, 0 = many risk markers.
        key:
          | "strategicFit"
          | "clientQuality"
          | "dealEconomics"
          | "winProbability"
          | "deliverability"
          | "riskInverted";
        score: number;
        weight: number;
        rationale: string;
        chunkIds: string[];
      }>;
      attachmentIds: string[];
      runId?: string;
      generatedAt: string;
    } | null>(),
    goNoGoDecision: jsonb("go_no_go_decision").$type<{
      decision: "go" | "no_go";
      decider: string;
      rationale: string;
      ts: string;
    } | null>(),
    nextMilestone: text("next_milestone").notNull(),
    nextMilestoneDate: text("next_milestone_date"),
    // Task #653 — forecast fields. `closeDate` is the partner's expected
    // close (ISO date, free text mirroring nextMilestoneDate); drives quarter
    // bucketing and the overdue-close alert. `forecastCategory` is the
    // standard sales forecast band — omitted | pipeline | best_case | commit |
    // closed — defaulting to `pipeline` for working deals.
    closeDate: text("close_date"),
    forecastCategory: text("forecast_category").notNull().default("pipeline"),
    sourceLead: text("source_lead").notNull(),
    daysInStage: integer("days_in_stage").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_opps_org").on(t.orgId),
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
    // Task #295 — funnel rollover: original 10-stage label captured on the
    // legacy→canonical hop so reports keyed on the old taxonomy still work.
    legacyStageLabel: text("legacy_stage_label"),
    // Convert→Runner gate: named decider + verbal-commit date + signature path.
    decider: text("decider"),
    verbalCommitDate: text("verbal_commit_date"),
    signaturePath: text("signature_path"),
    // Runner→Contract gate: signed instrument upload (artifact id).
    signedInstrumentFileId: text("signed_instrument_file_id"),
    // Terminal gate: reason code (lost/no_decision/withdrawn taxonomy in
    // pipeline.ts TERMINAL_REASON_CODES).
    reasonCode: text("reason_code"),
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
    notes: text("notes"),
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
    // Task #291 — industry-tag FK array (codes from atelier_industries).
    industryCodes: jsonb("industry_codes").notNull().default([]).$type<string[]>(),
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
    mitigation: text("mitigation"),
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
    // --- Seller side: multiple Cognirise team members may submit responses ---
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
    // Task #291 — FK industry-code array alongside legacy free-text tags.
    sectorIndustryCodes: jsonb("sector_industry_codes").notNull().default([]).$type<string[]>(),
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
    cogniriseLogoUrl: text("cognirise_logo_url"),
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
// so internal Cognirise persona space and client persona space cannot collide.
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

// Salon-side requests: client asks Cognirise for something (copy of artifact,
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
    // Task #291 — FK ISO alpha-2 codes; nullable during dual-write.
    countryCode: text("country_code"),
    payrollCountryCode: text("payroll_country_code"),
    employmentType: text("employment_type").notNull().default("FTE"), // FTE | fixed_term | intern
    // Task #645 — public business-card contact fields powering the offline
    // vCard QR code. `cellPhones` holds up to 3 mobile numbers, each labelled
    // by the COUNTRY the SIM/line belongs to (employees often carry local
    // cells across the GCC); at least one is required at the app layer.
    // `officeAddress` is the full postal address of the person's office.
    // These are PUBLIC fields (safe to print on a card) — never gated behind
    // the comp-policy lock.
    cellPhones: jsonb("cell_phones")
      .$type<Array<{ country: string; number: string }>>()
      .notNull()
      .default([]),
    officeAddress: text("office_address"),
    // Task #412 — self-identified demographics for the People Lens
    // Team Composition dashboard. Optional, defaulting to `unspecified` /
    // null so we never imply coverage we don't actually have.
    gender: text("gender").notNull().default("unspecified"), // female | male | non_binary | unspecified
    nationality: text("nationality"), // ISO-3166 alpha-2 country code, nullable
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
    // Task #291 — FK code (atelier_countries.iso_alpha_2); legacy `country` retained.
    countryCode: text("country_code"),
    // Task #412 — self-identified demographics, optional.
    gender: text("gender").notNull().default("unspecified"),
    nationality: text("nationality"),
    vendorEntity: text("vendor_entity"),
    masterAgreementRef: text("master_agreement_ref"),
    contractType: text("contract_type"), // T&M | fixed_fee | retainer (PRD §2.1)
    contractStart: text("contract_start"),
    contractEnd: text("contract_end"),
    // Task #293 — pointer to the signed contractor agreement document (typically
    // a row in atelier_person_documents). NULL until uploaded; the file body is
    // gated through atelier_person_documents_v + canViewPersonnelContract.
    contractFileId: text("contract_file_id"),
    dayRateAmount: doublePrecision("day_rate_amount"),
    dayRateInternalCost: doublePrecision("day_rate_internal_cost"), // PRD §2.1 (policy-locked)
    dayRateCurrency: text("day_rate_currency").notNull().default("USD"),
    paymentTermsDays: integer("payment_terms_days"), // PRD §2.1
    vatTreatment: text("vat_treatment"), // PRD §2.1 (zero_rated | standard | exempt | reverse_charge)
    engagementScopeDefault: jsonb("engagement_scope_default")
      .$type<string[]>()
      .notNull()
      .default([]), // PRD §2.1 — default scope chips applied on grant
    contractingEntity: text("contracting_entity"), // PRD §2.1 (which Cognirise entity contracts them)
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
    // Task #291 — FK ISO alpha-2 codes alongside legacy text columns.
    countryCode: text("country_code"),
    hqCountryCode: text("hq_country_code"),
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
    // Task #291 — FK ISO alpha-2 code; legacy `country` retained.
    countryCode: text("country_code"),
    // Task #412 — self-identified demographics, optional.
    gender: text("gender").notNull().default("unspecified"),
    nationality: text("nationality"),
    secondedToEngagementIds: jsonb("seconded_to_engagement_ids")
      .$type<string[]>()
      .notNull()
      .default([]), // PRD §2.1
    costToCognirisePerDay: doublePrecision("cost_to_cognirise_per_day"), // PRD §2.1 (policy-locked)
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
    // Task #291 — FK ISO alpha-2 code; legacy `jurisdiction` retained for
    // sub-jurisdictional detail (e.g. UAE_DIFC vs UAE_ADGM still matters).
    jurisdictionCountryCode: text("jurisdiction_country_code"),
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
    // Task #291 — FK ISO alpha-2 code (atelier_countries.iso_alpha_2).
    vatCountryCode: text("vat_country_code"),
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
    // Task #291 — FK ISO alpha-2 code; nullable during dual-write.
    countryCode: text("country_code"),
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

// ============================================================
// Task #293 — Principle Override (breakglass) audit ledger
// ============================================================
// Append-only ledger of every breakglass read/write that bypasses the
// column-level RLS masks defined in 0025_atelier_column_rls.sql. The
// helper SQL function `atelier_breakglass(...)` writes a row here AND
// flips the per-transaction GUC `app.principle_override = 'true'` so
// the masking helpers (`atelier_can_view_comp()` /
// `atelier_can_view_personnel(...)`) return TRUE for the rest of the
// transaction. Outside that transaction the override is gone — no
// session-wide breakglass is ever held.
export const atelierPrincipleOverride = pgTable(
  "atelier_principle_override",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    actorUserId: text("actor_user_id").notNull(),
    actorRole: text("actor_role").notNull(),
    targetTable: text("target_table").notNull(),
    targetId: text("target_id"),
    sensitivityClass: text("sensitivity_class").notNull(), // 'compensation' | 'personnel_contract'
    reason: text("reason").notNull(),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    index("idx_atelier_principle_override_actor").on(t.actorUserId),
    index("idx_atelier_principle_override_target").on(t.targetTable, t.targetId),
    index("idx_atelier_principle_override_granted").on(t.grantedAt),
  ],
);

// ============================================================
// Task #297 — FIRM PROFILE (canonical brand-copy source).
// Versioned single-row-per-version: drafts may stack, but exactly
// one row per (orgId) carries publishedAt != null + supersededAt = null
// at any time. Brand Profile Writer (front_of_house) seeds drafts;
// founding_partner / hr publish.
// ============================================================
export const atelierFirmProfile = pgTable(
  "atelier_firm_profile",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"), // draft | published | superseded
    payload: jsonb("payload").$type<{
      firmName: string;
      tagline: string;
      missionStatement: string;
      voiceAttributes: string[];
      principles: Array<{ name: string; description: string }>;
      boilerplateShort: string;
      boilerplateLong: string;
      capabilitiesPitch: string;
      differentiators: string[];
      proofPoints: Array<{ label: string; metric: string }>;
      legalEntities: Array<{ name: string; jurisdiction: string }>;
      contactBlock: string;
      brandColors?: { primary?: string; ink?: string; gold?: string };
    }>().notNull().default({} as never),
    runId: text("run_id"),
    notes: text("notes"),
    publishedAt: timestamp("published_at"),
    publishedByUserId: text("published_by_user_id"),
    publishedByName: text("published_by_name"),
    supersededAt: timestamp("superseded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_firm_profile_status").on(t.status),
    uniqueIndex("uq_atelier_firm_profile_version").on(t.orgId, t.version),
  ],
);

// ============================================================
// Task #297 — PROPOSAL RECIPIENTS. Per-recipient watermarked
// Salon URL: /salon/proposal/:proposalId/:token. Token is the
// auth — no Salon persona required. Each open is audited.
// ============================================================
export const atelierProposalRecipients = pgTable(
  "atelier_proposal_recipients",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    proposalId: text("proposal_id").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email"),
    recipientOrg: text("recipient_org"),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    openCount: integer("open_count").notNull().default(0),
    lastOpenedAt: timestamp("last_opened_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
  },
  (t) => [
    uniqueIndex("uq_atelier_proposal_recipients_token").on(t.token),
    index("idx_atelier_proposal_recipients_proposal").on(t.proposalId),
  ],
);

// ============================================================
// Task #331 — Atelier CLI: sessions / turns / async jobs.
//
// The CLI orchestrator (POST /api/atelier/cli/turn, SSE) writes one
// session row per Cmd+K conversation, one turn row per user prompt,
// and (optionally) one job row per long-running tool call that the
// orchestrator dispatches asynchronously.
//
// Org-scoped only — there is no engagement_id FK at the session/turn
// level because a single CLI session may span multiple engagements
// (the user might ask about deal X then engagement Y in the same
// chat). Tool-level writes still flow through their own table's RLS.
// ============================================================
export const atelierCliSessions = pgTable(
  "atelier_cli_sessions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    userId: text("user_id").notNull(),
    title: text("title"),
    rollingSummary: text("rolling_summary").notNull().default(""),
    recentTurnIds: jsonb("recent_turn_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    // Snapshot of the page context (route, account, engagement, ids, etc.)
    // that the CLI was opened in for this session. Used by the orchestrator
    // to bias resolvers + present_choices defaults.
    pageContextSnapshot: jsonb("page_context_snapshot")
      .$type<Record<string, unknown> | null>()
      .default(null),
    spentCentsToday: integer("spent_cents_today").notNull().default(0),
    spentCentsDay: text("spent_cents_day"),
    turnCount: integer("turn_count").notNull().default(0),
    lastTurnAt: timestamp("last_turn_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_cli_sessions_org").on(t.orgId),
    index("idx_atelier_cli_sessions_user").on(t.userId),
  ],
);

export const atelierCliTurns = pgTable(
  "atelier_cli_turns",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    // streaming | awaiting_confirmation | partial | success | cancelled |
    // error  | read_only_no_op | async_dispatched
    status: text("status").notNull().default("streaming"),
    statusMessage: text("status_message"),
    // The user's natural-language prompt for this turn.
    prompt: text("prompt").notNull(),
    // References to attachments uploaded with the prompt — opaque ids
    // resolved by Task D's extraction pipeline.
    attachmentRefs: jsonb("attachment_refs")
      .$type<string[]>()
      .notNull()
      .default([]),
    // Page context captured at submit time (overrides session snapshot).
    pageContext: jsonb("page_context")
      .$type<Record<string, unknown> | null>()
      .default(null),
    // Slash-command intent if the user used `/cmd ...` syntax.
    intent: text("intent"),
    // The model's proposed plan: ordered list of write steps with summaries
    // + diffs. Set when status='awaiting_confirmation'; replayed by confirm.
    planJson: jsonb("plan_json").$type<unknown>(),
    // SSE frame trace for replay/debugging.
    frames: jsonb("frames").$type<unknown[]>().notNull().default([]),
    toolCalls: jsonb("tool_calls").$type<unknown[]>().notNull().default([]),
    pendingWrite: jsonb("pending_write").$type<unknown>(),
    // True if this turn was submitted with dryRun=true (plan only, no
    // Confirm option offered).
    dryRun: boolean("dry_run").notNull().default(false),
    // Idempotency key for client retries (e.g. Cmd+Enter twice).
    clientTurnKey: text("client_turn_key"),
    // Cost tracked in integer cents to avoid float drift.
    costCents: integer("cost_cents").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    model: text("model"),
    latencyMs: integer("latency_ms").notNull().default(0),
    lastStepIdx: integer("last_step_idx").notNull().default(0),
    // Per-step results for partial-success bookkeeping. Each entry:
    // { stepIdx, tool, ok, errorCode?, replayed_idempotent? }.
    stepResults: jsonb("step_results")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    // Task #335 — optional per-turn 👍/👎 feedback row.
    //   thumb: 'up' | 'down'
    //   category?: 'intent_mis' | 'wrong_record' | 'missing_field' |
    //              'unsafe_write' | 'hallucinated_id' | 'other'
    //   freeText?: string
    //   recordedAt: ISO timestamp
    feedback: jsonb("feedback").$type<{
      thumb: "up" | "down";
      category?: string;
      freeText?: string;
      recordedAt: string;
    } | null>(),
    // Task #335 — optional raw model-traffic capture for the
    // founding-partner "replay this turn" mode. Only written when
    // ATELIER_CLI_RECORDING_ENABLED=1; gated by founding_partner role
    // on read.
    recordingTrace: jsonb("recording_trace").$type<unknown>(),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_cli_turns_session").on(t.sessionId),
    index("idx_atelier_cli_turns_user").on(t.userId),
    index("idx_atelier_cli_turns_status").on(t.status),
    uniqueIndex("uq_atelier_cli_turns_client_key").on(t.sessionId, t.clientTurnKey),
  ],
);

export const atelierCliJobs = pgTable(
  "atelier_cli_jobs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    turnId: text("turn_id").notNull(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    // queued | running | success | error | cancelled
    status: text("status").notNull().default("queued"),
    input: jsonb("input").$type<unknown>(),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    // Async-runner progress: { current, total, message }.
    progress: jsonb("progress")
      .$type<{ current: number; total: number; message?: string } | null>()
      .default(null),
    // Per-step results when the job replays a multi-step plan.
    stepResults: jsonb("step_results")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    // After this timestamp the job is considered abandoned and may be
    // garbage-collected by a sweeper.
    expiry: timestamp("expiry"),
    idempotencyKey: text("idempotency_key").notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_cli_jobs_turn").on(t.turnId),
    index("idx_atelier_cli_jobs_status").on(t.status),
    uniqueIndex("uq_atelier_cli_jobs_idem").on(t.idempotencyKey),
  ],
);

// ============================================================
// Task #334 — CLI attachments + extracted documents.
//
// `atelier_cli_attachments` is the durable record of a file dropped
// into the CLI composer. The raw bytes live in an opaque blob store
// (referenced as `enc:cli:<key>`) so the row itself never carries
// sensitive content; it carries metadata (mime, size, sha) and the
// final lifecycle status (`uploaded` | `extracted` | `rejected`).
//
// `atelier_extracted_documents` is the per-attachment normalisation
// produced by the extractor pipeline (PDF/DOCX/XLSX/PPTX/.eml/IMG/TXT).
// Always one row per attachment when extraction succeeds. `chunks`
// is a stable list ({chunkId, charStart, charEnd, summary, text});
// `digest` is the small per-doc TOC the model can ask for via the
// `fetch_document_chunk` tool.
// ============================================================
export const atelierCliAttachments = pgTable(
  "atelier_cli_attachments",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    userId: text("user_id").notNull(),
    sessionId: text("session_id"),
    turnId: text("turn_id"),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    encryptedRef: text("encrypted_ref").notNull(), // `enc:cli:<key>`
    // uploaded | extracted | rejected
    status: text("status").notNull().default("uploaded"),
    rejectionReason: text("rejection_reason"),
    // Detected document intent (rfp | transcript | receipt_batch |
    // brand_deck | spreadsheet | email | unknown). Hint only — the
    // capability tools verify before acting.
    intentHint: text("intent_hint"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_cli_attachments_user").on(t.userId),
    index("idx_atelier_cli_attachments_session").on(t.sessionId),
    index("idx_atelier_cli_attachments_turn").on(t.turnId),
    index("idx_atelier_cli_attachments_status").on(t.status),
  ],
);

export const atelierExtractedDocuments = pgTable(
  "atelier_extracted_documents",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    attachmentId: text("attachment_id").notNull(),
    // pdf | docx | xlsx | csv | pptx | image | eml | text | unknown
    kind: text("kind").notNull(),
    normalizedText: text("normalized_text").notNull().default(""),
    // Per-type structured extraction (sparse — only the relevant key is
    // populated for each kind).
    tableSummary: jsonb("table_summary").$type<{
      columns: string[];
      rowCount: number;
      sample: Array<Record<string, unknown>>;
    } | null>(),
    slideTexts: jsonb("slide_texts").$type<Array<{ index: number; text: string }> | null>(),
    emailHeaders: jsonb("email_headers").$type<{
      from?: string;
      to?: string[];
      subject?: string;
      date?: string;
    } | null>(),
    chunks: jsonb("chunks")
      .$type<Array<{
        chunkId: string;
        charStart: number;
        charEnd: number;
        summary: string;
        text: string;
      }>>()
      .notNull()
      .default([]),
    digest: jsonb("digest").$type<{
      toc: string;
      chunkSummaries: Array<{ chunkId: string; summary: string }>;
    }>(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_atelier_extracted_attachment").on(t.attachmentId),
    index("idx_atelier_extracted_kind").on(t.kind),
  ],
);

// ============================================================
// Task #362 — L2C Wave 3: Invoicing, e-invoicing, AR aging, Collections.
//
// Waves 1 (#360 contracts) and 2 (#361 revenue milestones / WIP) are NOT
// shipped in this build, so the schema falls back to free-text bill_to
// JSONB and time+expense-only line composition. No FKs to the missing
// upstream tables. See lib/db/drizzle/0033_atelier_l2c_invoicing.sql.
// ============================================================
export const atelierInvoiceSequence = pgTable(
  "atelier_invoice_sequence",
  {
    jurisdiction: text("jurisdiction").notNull(),
    orgId: ORG("org_id"),
    // Sequences are partitioned per (org, jurisdiction, calendar year)
    // so invoice numbers reset annually as required by L2C §C.1.
    yearPart: integer("year_part").notNull(),
    prefix: text("prefix").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_atelier_invoice_sequence_pk").on(t.orgId, t.jurisdiction, t.yearPart)],
);

export const atelierInvoice = pgTable(
  "atelier_invoice",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    engagementId: text("engagement_id"),
    accountId: text("account_id"),
    jurisdiction: text("jurisdiction").notNull(),
    invoiceNumber: text("invoice_number"),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("draft"),
    billTo: jsonb("bill_to")
      .$type<{
        name?: string;
        address?: string;
        vatId?: string;
        country?: string;
        contactEmail?: string;
      }>()
      .notNull()
      .default({}),
    subtotal: doublePrecision("subtotal").notNull().default(0),
    vatAmount: doublePrecision("vat_amount").notNull().default(0),
    vatRatePct: doublePrecision("vat_rate_pct").notNull().default(0),
    total: doublePrecision("total").notNull().default(0),
    amountPaid: doublePrecision("amount_paid").notNull().default(0),
    notes: text("notes"),
    dueDate: text("due_date"),
    issuedAt: timestamp("issued_at"),
    paidAt: timestamp("paid_at"),
    voidedAt: timestamp("voided_at"),
    voidedReason: text("voided_reason"),
    pdfRef: text("pdf_ref"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_invoice_eng").on(t.engagementId),
    index("idx_atelier_invoice_acct").on(t.accountId),
    index("idx_atelier_invoice_status").on(t.status),
  ],
);

export const atelierInvoiceLine = pgTable(
  "atelier_invoice_line",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    invoiceId: text("invoice_id").notNull(),
    ord: integer("ord").notNull().default(0),
    description: text("description").notNull(),
    qty: doublePrecision("qty").notNull().default(1),
    unitPrice: doublePrecision("unit_price").notNull().default(0),
    amount: doublePrecision("amount").notNull().default(0),
    sourceKind: text("source_kind").notNull(),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_atelier_invoice_line_invoice").on(t.invoiceId)],
);

export const atelierEinvoiceSubmission = pgTable(
  "atelier_einvoice_submission",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    invoiceId: text("invoice_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull().default("pending"),
    submissionPayloadRef: text("submission_payload_ref"),
    responsePayloadRef: text("response_payload_ref"),
    clearanceUuid: text("clearance_uuid"),
    qrCodePayload: text("qr_code_payload"),
    submittedAt: timestamp("submitted_at"),
    clearedAt: timestamp("cleared_at"),
    rejectedAt: timestamp("rejected_at"),
    rejectedReason: text("rejected_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_einvoice_invoice").on(t.invoiceId),
    index("idx_atelier_einvoice_status").on(t.status),
  ],
);

export const atelierDunningLadder = pgTable("atelier_dunning_ladder", {
  id: text("id").primaryKey(),
  orgId: ORG("org_id"),
  name: text("name").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  steps: jsonb("steps")
    .$type<
      Array<{
        offsetDays: number;
        channel: "email";
        template: string;
        requireApproval: boolean;
      }>
    >()
    .notNull()
    .default([]),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const atelierDunningEvent = pgTable(
  "atelier_dunning_event",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    invoiceId: text("invoice_id").notNull(),
    ladderId: text("ladder_id"),
    stepIndex: integer("step_index").notNull().default(0),
    channel: text("channel").notNull(),
    template: text("template"),
    messageRef: text("message_ref"),
    sentBy: text("sent_by"),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_atelier_dunning_event_invoice").on(t.invoiceId)],
);

export const atelierPromiseToPay = pgTable(
  "atelier_promise_to_pay",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    invoiceId: text("invoice_id").notNull(),
    promisedAmount: doublePrecision("promised_amount").notNull(),
    promisedDate: text("promised_date").notNull(),
    contactName: text("contact_name"),
    status: text("status").notNull().default("open"),
    recordedBy: text("recorded_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_atelier_p2p_invoice").on(t.invoiceId)],
);

// ============================================================
// REAL AUTH — credentials + server-side sessions (Task #1)
// ============================================================
export const atelierAuthCredentials = pgTable(
  "atelier_auth_credentials",
  {
    email: text("email").primaryKey(),
    userId: text("user_id").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_atelier_auth_cred_user").on(t.userId)],
);

export const atelierAuthSessions = pgTable(
  "atelier_auth_sessions",
  {
    // Stores the SHA-256 hex digest of the opaque session token, never the
    // token itself, so a DB leak cannot be replayed as a session cookie.
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    index("idx_atelier_auth_sessions_user").on(t.userId),
    index("idx_atelier_auth_sessions_exp").on(t.expiresAt),
  ],
);
