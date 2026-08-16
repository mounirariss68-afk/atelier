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
import { sql } from "drizzle-orm";

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
// PERSONS — Task #538 unified person model.
//
// One row per human, org-scoped. Domain tables (users, CRM contacts,
// employees, contractors, partner-firm resources) each carry a nullable
// `person_id` pointing here while keeping their own PKs — no downstream
// FK changed. Structured name fields:
//   honorific     — Mr | Ms | Dr | Sheikh | HE … (the user-facing "Title";
//                   deliberately NOT named `title`, which means JOB title
//                   on contacts/employees and would collide in joins).
//   first_name    — required
//   middle_name   — optional (patronymics like "bin Nasser" live here)
//   last_name     — required (particles like "Al-" attach to the surname)
//   preferred_name— optional; display falls back to first name
//   display_name  — stored, ALWAYS recomputed server-side on write via the
//                   shared helper (never trusted from clients).
// Legacy fullName/name columns on domain tables stay synced from this
// record during the transition and are derived read-only.
// RLS: org-isolation policy applied via lib/db/src/atelier-rls.sql.
// ============================================================
export const atelierPersons = pgTable(
  "atelier_persons",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    honorific: text("honorific"),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    displayName: text("display_name").notNull(),
    // Migration provenance — which domain row first created this person
    // ("user" | "contact" | "employee" | "contractor" | "partner_firm_resource"
    //  | "partner_firm_contact" | "manual"). Informational only.
    sourceKind: text("source_kind"),
    // Ambiguous-parse flag set by the one-time migration when the original
    // free-text name needed a judgment call (single token, 4+ tokens,
    // unrecognised leading honorific). Cleared on the first manual edit.
    parseReview: text("parse_review"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_persons_org").on(t.orgId),
    index("idx_atelier_persons_display").on(t.displayName),
    index("idx_atelier_persons_last_first").on(t.lastName, t.firstName),
  ],
);

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
    // Task #538 — unified person model. Nullable during rollout; `name` and
    // `initials` become derived read-only mirrors of the person record.
    personId: text("person_id"),
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
    // Task #827 — user-chosen display currency for money rollups (mobile
    // expense charts / month totals). Original claim currencies stay the
    // source of truth; this only affects display conversion.
    displayCurrency: text("display_currency").notNull().default("USD"),
    // Task #1017 — per-category device-push opt-outs. Keys are push
    // categories (tasks/expenses/timesheets/approvals/agreements/other);
    // a missing key means enabled (opt-out model, default all on).
    pushNotificationPrefs: jsonb("push_notification_prefs")
      .notNull()
      .$type<Record<string, boolean>>()
      .default({}),
    permissions: jsonb("permissions").notNull().$type<string[]>().default([]),
    // Task #873 — alliance-partner portal logins. Set ONLY for
    // role="alliance_partner" users: links the login to its firm in
    // atelier_partner_firms. Every partner-portal read resolves the
    // caller's firm through this column; NULL for every internal role.
    partnerFirmId: text("partner_firm_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_users_org").on(t.orgId),
    index("idx_atelier_users_role").on(t.role),
    // Task #1173 — the v1 one-active-login-per-firm partial unique index
    // (uq_atelier_users_active_partner_firm) was DROPPED: firms may now have
    // multiple concurrent active alliance-partner logins. Duplicate emails
    // are still refused by provisionPortalLogin's collision check.
  ],
);

// ============================================================
// PARTNER-PORTAL OPPORTUNITY GRANTS (Task #873)
// ============================================================
// Explicit firm ↔ opportunity visibility grants for the alliance-partner
// portal. A partner login (atelier_users.role = "alliance_partner",
// partner_firm_id set) may see an opportunity IFF an unrevoked grant row
// links their firm to it AND the firm itself is not archived AND the
// opportunity is not deleted. Revocation is soft (revoked_at) so the
// assignment history is retained internally while visibility drops
// immediately. Assign/revoke are leadership-only and audited.
export const atelierPartnerOppGrants = pgTable(
  "atelier_partner_opp_grants",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id").notNull(),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id"),
  },
  (t) => [
    index("idx_atelier_partner_opp_grants_org").on(t.orgId),
    index("idx_atelier_partner_opp_grants_firm").on(t.partnerFirmId),
    index("idx_atelier_partner_opp_grants_opp").on(t.opportunityId),
  ],
);

// Task #1174 — partner delivery grants. Mirrors atelier_partner_opp_grants
// exactly (soft-revoke, org isolation) but scopes an engagement to a firm's
// portal delivery view rather than an opportunity.
export const atelierPartnerEngagementGrants = pgTable(
  "atelier_partner_engagement_grants",
  {
    id: text("id").primaryKey(), // ppeg_...
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    engagementId: text("engagement_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id").notNull(),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id"),
  },
  (t) => [
    index("idx_atelier_partner_eng_grants_org").on(t.orgId),
    index("idx_atelier_partner_eng_grants_firm").on(t.partnerFirmId),
    index("idx_atelier_partner_eng_grants_eng").on(t.engagementId),
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
      // Task #1188 — cached suggested talking points for the prep card's
      // watch-outs. Derived at card build time (keyed on the distilled
      // watch-out list) and invalidated implicitly whenever the Cartographer
      // rewrites the whole researchBrief blob. Optional/display-only.
      watchOutTalkingPoints?: {
        key: string;
        points: Array<{ watchOut: string; answer: string }>;
      };
    }>(),
    // Task #1191 — uploaded client logo (private object-storage ref).
    // Null until a partner uploads a real logo via POST /accounts/:id/logo.
    // Bytes served through an authenticated endpoint and embedded as a data
    // URI in downloaded prep cards.
    clientLogoRef: text("client_logo_ref"),
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
    // Task #722 — vendor/procurement registration intelligence. Written by
    // the Procurement Navigator agent (on partner approval) and by the
    // manual status-tracking PATCH. `status`/`statusNotes` are human-owned;
    // the rest is the approved research guide (citations required).
    procurement: jsonb("procurement").$type<{
      // Human-tracked registration state.
      status: "not_registered" | "in_progress" | "registered" | "renewal_due";
      statusNotes?: string | null;
      statusUpdatedAt?: string | null;
      statusUpdatedBy?: string | null;
      // Agent-researched guide (present after a partner approves a run).
      guide?: {
        jurisdiction: string; // e.g. "saudi_gov", "uae_federal_gov", "dubai_gov", "abu_dhabi_gov", "qatar_gov", "private_sector"
        summary: string;
        channel: {
          name: string; // e.g. "Etimad", "SAP Ariba"
          type: "government_portal" | "eprocurement_platform" | "direct" | "prequalification" | "other";
          portalUrl?: string | null;
        };
        responsibleContact?: {
          department?: string | null;
          title?: string | null;
          email?: string | null;
          phone?: string | null;
          notes?: string | null;
        } | null;
        steps: Array<{ order: number; title: string; detail: string; sourceUrls?: string[] }>;
        requiredInformation: string[];
        requiredDocuments: string[];
        fees?: string | null;
        timeline?: string | null;
        renewal?: string | null;
        sources: Array<{ url: string; title?: string | null }>;
        confidence: "green" | "amber" | "red";
      } | null;
      lastResearchedAt?: string | null;
      lastResearchRunId?: string | null;
    }>(),
    // Task #699 — free-text partner guidance on the account strategy. The
    // account partner's thoughts / direction that steer the Strategy
    // Developer agent's drafts. Lives OUTSIDE the accountStrategy jsonb so
    // guidance survives when the strategy itself is cleared/null.
    strategyGuidance: text("strategy_guidance"),
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
    // Task #538 — unified person model. Nullable during rollout; `fullName`
    // becomes a derived read-only mirror of the linked person record.
    personId: text("person_id"),
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
    // FK with ON DELETE CASCADE (Task: opportunity-child orphan cleanup) —
    // hard deletes of an opportunity (tests/scripts) take stage history along.
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => atelierOpportunities.id, { onDelete: "cascade" }),
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
    // FK with ON DELETE SET NULL — an engagement outlives its originating
    // opportunity; a hard opp delete must not destroy the engagement, only
    // detach the pointer so reads never dangle.
    opportunityId: text("opportunity_id").references(() => atelierOpportunities.id, {
      onDelete: "set null",
    }),
    accountId: text("account_id").notNull(),
    // Task #654 — explicit invoicing/delivery legal entity. Backfilled from
    // invoice history where unambiguous; margin + entity reports read this
    // first and only fall back to invoice inference for legacy null rows.
    legalEntityId: text("legal_entity_id"),
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
    parentType: text("parent_type").notNull(), // opportunity | engagement | internal
    parentId: text("parent_id").notNull(), // for internal meetings: literal "internal"
    mode: text("mode").notNull().default("upload"), // upload | paste | live_bot | scheduled
    kind: text("kind").notNull().default("discovery"), // discovery | workshop | steering | kickoff | internal
    title: text("title").notNull(),
    date: text("date").notNull(),
    attendees: jsonb("attendees").notNull().default([]),
    // ---- Task #553: standalone internal meetings (scheduled via chat) ----
    /** Precise start/end (UTC) for scheduled internal meetings. */
    startAt: timestamp("start_at"),
    endAt: timestamp("end_at"),
    /** "online" | "in_person" (internal meetings only). */
    locationType: text("location_type"),
    /** Teams join link when booked online. */
    joinUrl: text("join_url"),
    webLink: text("web_link"),
    /** Graph event id on the organizer's calendar (per-mailbox id space). */
    msEventId: text("ms_event_id"),
    /** Graph iCalUId — identical across every attendee's mailbox copy;
     *  used to de-dupe calendar views + the meeting auto-logger. */
    msEventUid: text("ms_event_uid"),
    /** Roster attendees: [{ userId, name, email }] (internal meetings). */
    internalAttendees: jsonb("internal_attendees")
      .$type<Array<{ userId: string; name: string; email: string | null }>>(),
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
    // Tenancy: defaults to the request's RLS org (app.org_id GUC, set by the
    // api-server connection defaults / withRls) so audit writers that do not
    // stamp orgId explicitly still attribute the event to the right tenant.
    orgId: text("org_id")
      .notNull()
      .default(sql`coalesce(nullif(current_setting('app.org_id'::text, true), ''::text), 'aico'::text)`),
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
    // FK with ON DELETE CASCADE (Task: opportunity-child orphan cleanup).
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => atelierOpportunities.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    accountSnapshot: jsonb("account_snapshot").notNull().default({}),
    buyerLandscape: jsonb("buyer_landscape").notNull().default({}),
    fiveCDraft: jsonb("five_c_draft").notNull().default({}),
    openQuestions: jsonb("open_questions").notNull().default([]).$type<string[]>(),
    // Task #872 — alliance-partner opportunity-fit flags. Snapshot at brief
    // creation time: later partner archival never mutates persisted briefs.
    partnerFit: jsonb("partner_fit")
      .notNull()
      .default([])
      .$type<
        Array<{
          partnerName: string;
          capabilityDomain: string;
          rationale: string;
          sourceUrls: string[];
        }>
      >(),
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
    // FK with ON DELETE CASCADE (Task: opportunity-child orphan cleanup).
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => atelierOpportunities.id, { onDelete: "cascade" }),
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
    // Task #1027 — re-verify flow: set when a stale fact's source could not
    // be re-confirmed (query returned no supporting citations). Cleared when
    // a later re-verify succeeds. Never touched by read-time hygiene.
    sourceDeadAt: timestamp("source_dead_at"),
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
    // FK with ON DELETE CASCADE (Task: opportunity-child orphan cleanup).
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => atelierOpportunities.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    audience: text("audience"),
    objective: text("objective"),
    // Task #1053 — per-POV depth knob: "memo" (tight 4–6 section memo) vs
    // "full" (the rich 8–12 section client document, the default).
    depth: text("depth").notNull().default("full"),
    status: text("status").notNull().default("outline"),
    outline: jsonb("outline").notNull().default([]),
    // Task #1022 — evidence snapshot. The promoted-fact set the CURRENT
    // outline was built from, frozen at outline creation/regeneration so the
    // draft/revise chain always runs on exactly the evidence the approved
    // outline used (no silent drift when facts are promoted/demoted later).
    factSnapshot: jsonb("fact_snapshot"),
    factSnapshotAt: timestamp("fact_snapshot_at"),
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
  (t) => [
    index("idx_atelier_povv_pov").on(t.povId),
    // Task #1022 — race-safe version numbering: concurrent draft/revise
    // launches can no longer mint duplicate version numbers; the insert
    // path retries on unique-violation with a freshly computed max+1.
    uniqueIndex("uq_atelier_povv_num").on(t.povId, t.versionNumber),
  ],
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
// SELF NOTIFICATIONS (Me lens) — Task #50
// Per-user self-service cards ("timesheet due Friday", "expense
// approved", "review cycle opens Monday"). Written by emitSelfNotification
// on the server; read + dismissed only by the owning user via /me routes.
// ============================================================
export const atelierSelfNotifications = pgTable(
  "atelier_self_notifications",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    // Owning atelier_users.id — the ONLY user who may read/dismiss it.
    userId: text("user_id").notNull(),
    // Machine kind, e.g. timesheet_due | expense_status | review_cycle | generic
    kind: text("kind").notNull().default("generic"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // Optional in-app link (always under /me/... for self-scope).
    href: text("href"),
    status: text("status").notNull().default("unread"), // unread | dismissed
    dismissedAt: timestamp("dismissed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_selfnotif_user").on(t.userId),
    index("idx_atelier_selfnotif_org").on(t.orgId),
  ],
);

// ============================================================
// DEVICE PUSH TOKENS (Me lens) — Task #1010
// Per-user opt-in Expo push tokens. One row per device token; a user
// may have several (phone + tablet). Registration/removal is strictly
// self-scope (/me/push-tokens). Tokens that Expo reports as
// DeviceNotRegistered are pruned by the push sender.
// ============================================================
export const atelierPushTokens = pgTable(
  "atelier_push_tokens",
  {
    // The Expo push token itself is the natural key (globally unique).
    token: text("token").primaryKey(),
    orgId: ORG("org_id"),
    // Owning atelier_users.id — the ONLY user pushes go to.
    userId: text("user_id").notNull(),
    platform: text("platform").notNull().default("unknown"), // ios | android | unknown
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_pushtok_user").on(t.userId),
    index("idx_atelier_pushtok_org").on(t.orgId),
  ],
);

// ============================================================
// BACKGROUND JOBS — Task #1020
// Durable registry for long-running background agent work (POV drafts,
// receipt parsing, pricing research, alliance evaluation, merchant
// enrichment…). Replaces the per-feature in-memory launch maps so job
// status survives restarts, is visible from any page, and can notify
// the starter on completion. Status is running | done | failed; a boot
// sweep marks orphaned "running" rows failed ("interrupted") so the UI
// never waits forever after a restart.
// ============================================================
export const atelierBackgroundJobs = pgTable(
  "atelier_background_jobs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    // atelier_users.id who started the job — the only user who sees it
    // in /me/background-jobs and receives the completion notification.
    startedByUserId: text("started_by_user_id").notNull(),
    // Machine kind, e.g. pov_draft | pov_revise | receipt_parse |
    // pricing_research | alliance_cartographer | alliance_mapper |
    // merchant_enrichment
    kind: text("kind").notNull(),
    // Concurrency key: kinds that must be mutually exclusive on the same
    // target share a lockKey (e.g. pov_draft + pov_revise → "pov").
    // Defaults to the kind for everything else.
    lockKey: text("lock_key").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    // Human label shown in the global indicator ("POV draft — Acme…").
    label: text("label").notNull(),
    status: text("status").notNull().default("running"), // running | done | failed
    error: text("error"),
    // Deep link to the result once done (web route).
    resultHref: text("result_href"),
    // Kind-specific result payload for per-feature status endpoints.
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("idx_atelier_bgjobs_user").on(t.startedByUserId),
    index("idx_atelier_bgjobs_target").on(t.kind, t.targetId),
    index("idx_atelier_bgjobs_status").on(t.status),
    // Atomic duplicate-start guard: at most ONE running job per
    // (org, lockKey, target). Concurrent launches race on this index and
    // the loser gets a unique violation → startBackgroundJob returns null.
    uniqueIndex("uq_atelier_bgjobs_running")
      .on(t.orgId, t.lockKey, t.targetId)
      .where(sql`status = 'running'`),
  ],
);

// ============================================================
// PERSONAL TASKS & REMINDERS (Me lens) — Task #1002
// Lightweight self-scoped to-dos / timed reminders. Owned by ONE
// atelier_users row; every read/write predicates on org + userId.
// dueAt is a UTC instant (natural-language times resolve to the
// caller's timezone server-side before storage).
// ============================================================
export const atelierPersonalTasks = pgTable(
  "atelier_personal_tasks",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    // Owning atelier_users.id — the ONLY user who may see/mutate it.
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    // Optional due instant (UTC). Reminders fire when now >= dueAt.
    dueAt: timestamp("due_at"),
    status: text("status").notNull().default("open"), // open | done
    completedAt: timestamp("completed_at"),
    // Task #1011 — delegation. When another user handed this task over:
    // assignedById = the assigner's atelier_users.id (NULL for self-created)
    // assignmentStatus = pending | accepted | declined (NULL for self-created).
    // Declined tasks stay for the assigner's status view but drop out of the
    // assignee's list / roll-up / reminder tick.
    assignedById: text("assigned_by_id"),
    assignmentStatus: text("assignment_status"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_ptask_user").on(t.userId),
    index("idx_atelier_ptask_org").on(t.orgId),
    index("idx_atelier_ptask_assigner").on(t.assignedById),
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
    // FK with ON DELETE CASCADE (Task: opportunity-child orphan cleanup).
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => atelierOpportunities.id, { onDelete: "cascade" }),
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
    // FK with ON DELETE SET NULL — prototype may also hang off an engagement,
    // so an opp hard-delete detaches rather than destroys it.
    opportunityId: text("opportunity_id").references(() => atelierOpportunities.id, {
      onDelete: "set null",
    }),
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
    /** Effective-dated versioning (Task #435): monotonically increasing per lineage. */
    version: integer("version").notNull().default(1),
    /** Prior version of this card in the same lineage (null = first version). */
    supersedesId: text("supersedes_id"),
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
    // FK with ON DELETE CASCADE (Task: opportunity-child orphan cleanup).
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => atelierOpportunities.id, { onDelete: "cascade" }),
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
    // Task #435 — engagement pricing structures. structureParams shape is
    // StructureParams (api-server lib/atelier-pricing-structures.ts).
    structureParams: jsonb("structure_params").$type<Record<string, unknown> | null>(),
    /** Persisted simulation snapshot for the chosen structure (bands + cash profile). */
    structureSim: jsonb("structure_sim").$type<Record<string, unknown> | null>(),
    /** Risk-adjusted (probability-weighted) margin — what the margin lock gates on. */
    riskAdjustedMarginPct: doublePrecision("risk_adjusted_margin_pct"),
    /** Billing handoff — set when the chosen structure was pushed to a billing rule. */
    billingRuleId: text("billing_rule_id"),
    billingHandoffAt: timestamp("billing_handoff_at"),
    pricingAnalystRunId: text("pricing_analyst_run_id"),
    pricingAnalystOutput: jsonb("pricing_analyst_output"),
    pricingStrategistBriefId: text("pricing_strategist_brief_id"),
    pricingStrategistRunId: text("pricing_strategist_run_id"),
    pricingStrategistOutput: jsonb("pricing_strategist_output"),
    // Task #663 — typed non-labor cost lines (CostLine[] in
    // api-server lib/atelier-pricing-structures.ts). Absorbed lines fold into
    // delivery cost; pass-through lines ride the cash/invoice schedule only.
    costLines: jsonb("cost_lines").notNull().default([]).$type<Array<Record<string, unknown>>>(),
    // Task #663 — Pricing Researcher agent (async web-search run; review-only).
    pricingResearcherRunId: text("pricing_researcher_run_id"),
    pricingResearcherOutput: jsonb("pricing_researcher_output"),
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
    // FK with ON DELETE CASCADE (Task: orphaned Win/Loss cleanup) — hard
    // deletes of an opportunity (e.g. test-harness DB deletes) must take the
    // dependent debrief rows with them so no orphans can linger.
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => atelierOpportunities.id, { onDelete: "cascade" }),
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
    // Task #538 — unified person model. Nullable during rollout; fullName /
    // preferredName become derived read-only mirrors of the person record.
    personId: text("person_id"),
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
    // Task #744 — travel loyalty programs + preferences (EMPLOYEES ONLY;
    // contractors/partner-firm resources never carry this field). Shaped for
    // a future Amadeus traveler-profile mapper: airline programs keyed by the
    // operating airline's 2-letter IATA code + membership id, hotel programs
    // by chain code, tier stored as a label. Membership numbers are personal
    // data — read surfaces redact them unless the viewer is the person
    // themself or holds the sensitive-people gate.
    travelProfile: jsonb("travel_profile").$type<{
      airlinePrograms: Array<{
        airlineIata: string; // 2-letter IATA carrier code (e.g. "EK")
        programName: string; // e.g. "Emirates Skywards"
        membershipNumber: string;
        tier?: string | null; // label, e.g. "Gold"
      }>;
      hotelPrograms: Array<{
        chainCode: string; // chain code (e.g. "MC" Marriott, "HH" Hilton)
        programName: string; // e.g. "Marriott Bonvoy"
        membershipNumber: string;
        tier?: string | null;
      }>;
      preferences: {
        preferredAirlines: string[]; // IATA codes or names
        preferredHotelChains: string[];
        cabinClass?: string | null; // economy | premium_economy | business | first
        seatPreference?: string | null; // aisle | window | middle | no_preference
        mealPreference?: string | null;
        departureTimeWindow?: string | null; // free text, e.g. "08:00–12:00"
        arrivalTimeWindow?: string | null;
        notes?: string | null;
      };
    }>(),
    // Task #412 — self-identified demographics for the People Lens
    // Team Composition dashboard. Optional, defaulting to `unspecified` /
    // null so we never imply coverage we don't actually have.
    gender: text("gender").notNull().default("unspecified"), // female | male | unspecified
    nationality: text("nationality"), // ISO-3166 alpha-2 country code, nullable
    employmentStatus: text("employment_status").notNull().default("active"), // active | notice | on_leave | terminated (PRD §2.1)
    employingEntity: text("employing_entity"), // DIFC | ADGM | KSA | Other (PRD §2.1)
    // Task #1095 — home country (ISO-3166 alpha-2) for the entity-allocation
    // travel rules (home vs destination). Editable by HR/founding via the
    // roster PATCH; the home *entity* resolves via legalEntityId first.
    homeCountry: text("home_country"),
    startDate: text("start_date"), // ISO date
    endDate: text("end_date"),
    status: text("status").notNull().default("active"), // active | on_leave | offboarded
    // Task #655 — statutory payroll linkage. `legalEntityId` FKs the employing
    // atelier_legal_entities row (payroll runs group by it; falls back to the
    // org's single active entity when null). Wage split: `basicWageMonthly`
    // (contractual basic, excl. allowances — EOSB basis in AE/QA) and
    // `housingAllowanceMonthly` (GOSI/GRSIA base add-on). When basic is null
    // the whole monthly wage (baseCompensation/12) is treated as basic.
    // `schemeRegisteredOn` = first social-security registration date driving
    // old-vs-new scheme selection (GPSSA Oct-2023, GOSI Jul-2024); falls back
    // to startDate when null.
    legalEntityId: text("legal_entity_id"),
    basicWageMonthly: doublePrecision("basic_wage_monthly"),
    housingAllowanceMonthly: doublePrecision("housing_allowance_monthly"),
    schemeRegisteredOn: text("scheme_registered_on"), // ISO date
    iban: text("iban"),
    swift: text("swift"),
    // Task #1136 — WPS (UAE Wage Protection System) identifiers. Written
    // ONLY via the audited payroll PATCH (applyPayrollUpdate in
    // rosterRoutes); the general roster PATCH field-locks them. IBAN/SWIFT
    // writes stay exclusively on the HR-approved bank-change flow (pay hub)
    // — the SIF builder only ever READS them.
    mohrePersonId: text("mohre_person_id"), // 14-digit MOHRE Person ID / labour card number
    bankRoutingCode: text("bank_routing_code"), // 9-digit UAE agent-bank routing code
    noticePeriodDays: integer("notice_period_days").notNull().default(30),
    baseCurrency: text("base_currency"), // PRD §2.1 (policy-locked)
    baseCompensation: doublePrecision("base_compensation"), // PRD §2.1 (policy-locked)
    utilizationTargetPct: integer("utilization_target_pct"), // PRD §2.1
    partnerEconomicsId: text("partner_economics_id"),
    avatarUrl: text("avatar_url"),
    // Task #51 — self-service profile fields (Me lens). Personal data the
    // person maintains themself; never HR-locked.
    personalEmail: text("personal_email"),
    homeAddress: text("home_address"),
    bio: text("bio"),
    notes: text("notes"),
    // Task #386 — Executive Assistant designation. EAs can be delegated
    // partner admin work (timesheets/expenses/meetings) via
    // atelier_ea_delegations.
    isExecutiveAssistant: boolean("is_executive_assistant").notNull().default(false),
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
    // Task #538 — unified person model. Nullable during rollout.
    personId: text("person_id"),
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
    // Task #1095 — home country (ISO alpha-2) for entity-allocation travel
    // rules; mirrors the employee column.
    homeCountry: text("home_country"),
    conflictsDisclosedJson: jsonb("conflicts_disclosed_json")
      .$type<Array<{ party: string; nature: string }>>()
      .notNull()
      .default([]), // PRD §2.1 (snapshot at contract sign)
    startDate: text("start_date"),
    endDate: text("end_date"),
    status: text("status").notNull().default("active"), // active | paused | offboarded
    // Task #51 — self-service profile fields (Me lens), mirroring the
    // employee columns so contractors get the same self-service surface.
    cellPhones: jsonb("cell_phones")
      .$type<Array<{ country: string; number: string }>>()
      .notNull()
      .default([]),
    officeAddress: text("office_address"),
    avatarUrl: text("avatar_url"),
    personalEmail: text("personal_email"),
    homeAddress: text("home_address"),
    bio: text("bio"),
    notes: text("notes"),
    // Task #386 — Executive Assistant designation (fractional EAs are
    // contractors; they keep the normal contractor weekly timesheet).
    isExecutiveAssistant: boolean("is_executive_assistant").notNull().default(false),
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
    // Task #874 — partner self-registration: company legal details submitted
    // by the partner via the token-gated registration page.
    legalName: text("legal_name"),
    registrationNumber: text("registration_number"),
    taxId: text("tax_id"),
    registeredAddress: text("registered_address"),
    registrationCompletedAt: timestamp("registration_completed_at"),
    registrationCompletedByUserId: text("registration_completed_by_user_id"),
    // Task #874 — APPROVED payable bank details. Written ONLY by the
    // finance approval route over atelier_partner_firm_bank_change_requests
    // (maker-checker) — never directly by the partner.
    bankIban: text("bank_iban"),
    bankSwift: text("bank_swift"),
    bankName: text("bank_name"),
    bankCurrency: text("bank_currency"),
    // Task #513 — unified partner-firm registry. The alliance-lens fields
    // previously on `atelier_alliance_partner_firms` (now retired) live
    // here so roster flows and the Partners lens read the same record.
    kind: text("kind"), // e.g. hyperscaler | boutique_si | strategy | staffing
    speciality: text("speciality"),
    tier: text("tier"), // strategic | preferred | transactional
    relationshipStrength: integer("relationship_strength"), // 1..5
    anchorCognirise: text("anchor_cognirise"), // named anchor on our side
    anchorPartner: text("anchor_partner"), // named anchor on their side
    lastTouchAt: text("last_touch_at"), // ISO date of last meaningful touch
    // Qualify — per-dimension capability scores (1..5), editable in the lens.
    capabilities: jsonb("capabilities")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    // Lightweight partner contacts (NOT a parallel CRM): name/role/email.
    contacts: jsonb("contacts")
      .$type<Array<{ id: string; name: string; role?: string | null; email?: string | null }>>()
      .notNull()
      .default([]),
    // Renew — tier-change history, append-only.
    tierHistory: jsonb("tier_history")
      .$type<Array<{ fromTier: string | null; toTier: string; at: string; byUserId: string; reason?: string | null }>>()
      .notNull()
      .default([]),
    // Task #526 — Alliance Partner Evaluation Framework v2.0 fields.
    // One of the six framework archetypes:
    // reference_brand | delivery_backbone | platform_capability |
    // niche_subcontractor | market_access_jv | competitor_monitor
    archetype: text("archetype"),
    // Task #871 — two-dimensional stage model. Partnership stage:
    // consideration → exploration → agreed. (Legacy value "candidate"
    // migrates to "consideration" at boot.) Distinct from `status`
    // (ops lifecycle).
    partnershipStage: text("partnership_stage").notNull().default("consideration"),
    // Agreement stage — only meaningful once partnershipStage = "agreed":
    // preparing → negotiating → reviewing → signing → signed. NULL for
    // non-agreed firms. Legacy "agreed" rows backfill to "signed" at boot
    // (agreed previously meant signed/active).
    agreementStage: text("agreement_stage"),
    // Task #871 — approved capability profile (narrative + domain map),
    // written ONLY via the pendingUpdates approval path. Drives the
    // partner-firm RAG chunks Riser cites from.
    capabilityProfile: jsonb("capability_profile")
      .$type<{
        summary: string;
        domains: Array<{
          id: string;
          label: string;
          description: string;
          evidence: "evidenced" | "inferred" | "unverified";
          sourceUrls?: string[];
        }>;
        researchedAt: string;
        researchedBy: string;
      } | null>()
      .default(null),
    // Stage 1 — nine-dimension weighted fit scorecard. Scores 1–5, weights
    // sum to 1.0; weightedTotal + verdict computed in code, never trusted
    // from the model.
    fitScorecard: jsonb("fit_scorecard")
      .$type<{
        dimensions: Array<{
          id: string; // e.g. service_alignment
          label: string;
          weight: number; // 0..1
          score: number; // 1..5
          evidence: "evidenced" | "inferred" | "unverified";
          rationale?: string | null;
          sourceUrls?: string[];
          // Task #530 — manual dimension adjustment stamp (absent on
          // agent-produced scores; set whenever a user overrides the score).
          adjustedByUserId?: string;
          adjustedAt?: string;
        }>;
        weightedTotal: number;
        verdict: "proceed" | "limited" | "decline";
        watchouts: string[]; // two weakest dimension labels
        scoredAt: string;
        scoredBy: string; // agent id or user id
        // Task #530 — last manual adjustment (top-level convenience stamp).
        adjustedAt?: string;
        adjustedByUserId?: string;
      } | null>()
      .default(null),
    // Stage 2 — due-diligence gates (pass | conditional | fail | to_verify).
    dueDiligence: jsonb("due_diligence")
      .$type<{
        gates: Array<{
          id: string; // e.g. legal_standing
          label: string;
          status: "pass" | "conditional" | "fail" | "to_verify";
          evidence: "evidenced" | "inferred" | "unverified";
          notes?: string | null;
          sourceUrls?: string[];
        }>;
        overall: "pass" | "conditional" | "fail" | "to_verify";
        assessedAt: string;
        assessedBy: string;
      } | null>()
      .default(null),
    // Stage 8 — risk register (top risks + mitigations).
    riskRegister: jsonb("risk_register")
      .$type<
        Array<{
          id: string;
          risk: string;
          mitigation: string;
          severity: "high" | "med" | "low";
          evidence: "evidenced" | "inferred" | "unverified";
          sourceUrls?: string[];
        }>
      >()
      .notNull()
      .default([]),
    // Stage 9 — phasing: current phase + milestone to convert.
    phasing: jsonb("phasing")
      .$type<{
        phase: "verify" | "pilot" | "convert";
        milestone: string;
        note?: string | null;
      } | null>()
      .default(null),
    // Agent proposal queue — mirrors accounts.pendingProfileUpdates. Agents
    // NEVER write archetype/scorecard/DD/risks/phasing/capabilities directly;
    // everything lands here for partner review (approve applies + audits).
    pendingUpdates: jsonb("pending_updates")
      .$type<
        Array<{
          id: string;
          proposedBy: string; // e.g. ag_alliance_cartographer
          proposedAt: string;
          field: string; // 'archetype' | 'fitScorecard' | 'dueDiligence' | 'riskRegister' | 'phasing' | 'capabilities' | 'tier' | 'contact' | 'speciality' | 'notes'
          fromValue: unknown;
          toValue: unknown;
          rationale: string;
          status: "pending" | "approved" | "rejected";
          meta?: Record<string, unknown>;
          decidedAt?: string;
          decidedByUserId?: string;
        }>
      >()
      .notNull()
      .default([]),
    // Lifecycle: active | renewal_due | paused | offboarded | terminated
    status: text("status").notNull().default("active"),
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
    // Task #538 — unified person model. Nullable during rollout. Promoted
    // partner-firm jsonb contacts land here as real rows backed by persons.
    personId: text("person_id"),
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

// Task #513 — `atelier_partner_economics` (a never-built placeholder) was
// dropped; see docs/PARTNERS_BACKLOG.md for the real-build notes.

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
    // Task #51 — self-service ID/residency detail fields + real object-
    // storage upload metadata. `fileRef` now carries `persondoc:<key>`
    // for self-uploaded scans (streamed via the owner-or-HR download
    // routes). `dependentId` links a scan to an atelier_dependents row.
    docNumber: text("doc_number"),
    issuedAt: text("issued_at"), // ISO date
    issuingCountry: text("issuing_country"),
    dependentId: text("dependent_id"),
    fileName: text("file_name"),
    mime: text("mime"),
    sizeBytes: integer("size_bytes"),
    // Task #531 — national ID cards carry a second labeled scan (the back
    // side). `fileRef` stays the front (or a single combined PDF); these
    // columns hold the back side. NULL for every other document kind and
    // for legacy single-scan rows, so existing records stay valid.
    backFileRef: text("back_file_ref"),
    backFileName: text("back_file_name"),
    backMime: text("back_mime"),
    backSizeBytes: integer("back_size_bytes"),
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
// Task #54 — Personal pay hub (Me lens Pay & Benefits)
// ============================================================

// Pay/benefit documents HR publishes to one person: contracts, salary /
// bonus / other comp letters, payslips (remittances for contractors) and
// insurance documents. File bytes live in-row (base64) — small PDFs only,
// capped at the route layer — so the hub works without object-storage
// configuration and downloads stream through the ACL-gated route only.
export const atelierPayDocuments = pgTable(
  "atelier_pay_documents",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee | contractor
    personId: text("person_id").notNull(),
    // contract | salary_letter | bonus_letter | comp_letter | payslip |
    // remittance | insurance
    category: text("category").notNull(),
    title: text("title").notNull(),
    // Pay period / letter date (ISO date or YYYY-MM), display + sort key.
    periodDate: text("period_date"),
    published: boolean("published").notNull().default(false),
    publishedAt: timestamp("published_at"),
    publishedByUserId: text("published_by_user_id"),
    retractedAt: timestamp("retracted_at"),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    // Base64-encoded file body. Never returned by list endpoints.
    fileData: text("file_data").notNull(),
    uploadedByUserId: text("uploaded_by_user_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pay_docs_org").on(t.orgId),
    index("idx_atelier_pay_docs_person").on(t.personType, t.personId),
    index("idx_atelier_pay_docs_category").on(t.category),
  ],
);

// Per-person insurance scheme details (display-only; HR-maintained).
export const atelierPersonInsurance = pgTable(
  "atelier_person_insurance",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee | contractor
    personId: text("person_id").notNull(),
    provider: text("provider").notNull().default(""),
    policyNumber: text("policy_number").notNull().default(""),
    memberNumber: text("member_number").notNull().default(""),
    coverageSummary: text("coverage_summary").notNull().default(""),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_person_ins_org").on(t.orgId),
    uniqueIndex("uniq_atelier_person_ins_person").on(t.personType, t.personId),
  ],
);

// Bank-detail change requests. Self-submit only; applied to the roster
// row exclusively by an HR/leadership approval — direct self-edit of
// banking data is never allowed. Both sides are audited.
export const atelierBankChangeRequests = pgTable(
  "atelier_bank_change_requests",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee (contractors have no stored IBAN)
    personId: text("person_id").notNull(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    // Masked snapshot of the IBAN on file when the request was made.
    previousIbanMasked: text("previous_iban_masked"),
    newIban: text("new_iban").notNull(),
    newSwift: text("new_swift"),
    reason: text("reason"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    decidedByUserId: text("decided_by_user_id"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_bankreq_org").on(t.orgId),
    index("idx_atelier_bankreq_person").on(t.personType, t.personId),
    index("idx_atelier_bankreq_status").on(t.status),
  ],
);

export const atelierPartnerFirmBankChangeRequests = pgTable(
  "atelier_partner_firm_bank_change_requests",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    // The alliance-partner login (or internal user) who submitted it.
    requestedByUserId: text("requested_by_user_id").notNull(),
    previousIbanMasked: text("previous_iban_masked"),
    newIban: text("new_iban").notNull(),
    newSwift: text("new_swift"),
    newBankName: text("new_bank_name"),
    newCurrency: text("new_currency"),
    reason: text("reason"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    decidedByUserId: text("decided_by_user_id"),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pf_bankreq_org").on(t.orgId),
    index("idx_atelier_pf_bankreq_firm").on(t.partnerFirmId),
    index("idx_atelier_pf_bankreq_status").on(t.status),
  ],
);
// Task #1172 — Partner firm document library. Trade licenses, certificates,
// insurance, VAT/TRN, signatory IDs uploaded during registration or via the
// partner portal (or internally). Bytes live in object storage
// (partnerDocStorage; fileRef = "partnerdoc:<key>") and are ONLY served
// through ACL'd download routes. Plain text ids, no FK constraints (matches
// the rest of the atelier partner tables). Accepted, non-deleted docs with an
// expiryDate surface read-time in /roster/compliance (never persisted as
// compliance_records rows).
export const atelierPartnerFirmDocuments = pgTable(
  "atelier_partner_firm_documents",
  {
    id: text("id").primaryKey(), // pfdoc_...
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    // trade_license | certificate | insurance | vat_trn | signatory_id | other
    kind: text("kind").notNull(),
    title: text("title"),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    fileRef: text("file_ref").notNull(), // object-storage ref ("partnerdoc:<key>")
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256"),
    issuedDate: text("issued_date"), // ISO date
    expiryDate: text("expiry_date"), // ISO date
    // pending | accepted | rejected
    reviewStatus: text("review_status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedByName: text("reviewed_by_name"),
    reviewedAt: timestamp("reviewed_at"),
    uploadedByUserId: text("uploaded_by_user_id"),
    // registration | portal | internal
    uploadedVia: text("uploaded_via").notNull(),
    supersededByDocId: text("superseded_by_doc_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pf_docs_org").on(t.orgId),
    index("idx_atelier_pf_docs_firm").on(t.partnerFirmId),
    index("idx_atelier_pf_docs_status").on(t.reviewStatus),
  ],
);

// Task #1172 — post-registration portal contact updates are NOT applied
// directly; they land here as a pending suggestion that an internal reviewer
// approves (applied via the shared contacts-update path incl. roster
// promotion) or rejects. Registration-time contacts are applied directly.
export const atelierPartnerContactSuggestions = pgTable(
  "atelier_partner_contact_suggestions",
  {
    id: text("id").primaryKey(), // pfcsug_...
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    proposedContacts: jsonb("proposed_contacts")
      .$type<Array<{ id: string; name: string; role?: string | null; email?: string | null }>>()
      .notNull()
      .default([]),
    note: text("note"),
    // pending | approved | rejected
    status: text("status").notNull().default("pending"),
    submittedByUserId: text("submitted_by_user_id"),
    decidedByUserId: text("decided_by_user_id"),
    decidedByName: text("decided_by_name"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pf_contact_sug_org").on(t.orgId),
    index("idx_atelier_pf_contact_sug_firm").on(t.partnerFirmId),
    index("idx_atelier_pf_contact_sug_status").on(t.status),
  ],
);

// Task #1174 — shared-document space for the partner delivery portal.
// Two directions:
//   'shared'          internal → firm. A SNAPSHOT of a library document
//                     version copied into firm-scoped partner storage at
//                     share time (later library edits never leak). Always
//                     status 'active' until revoked (revokedAt stamped).
//   'partner_upload'  firm → internal. A file a partner uploaded for internal
//                     review; status pending_review | accepted | rejected.
// Bytes live in the private bucket under a FIRM-SCOPED key prefix; the row
// carries the opaque blobRef. blobRef/sha256/source ids are NEVER exposed to
// the portal. Deny-all RLS; org-isolated like every table.
export const atelierPartnerSharedDocuments = pgTable(
  "atelier_partner_shared_documents",
  {
    id: text("id").primaryKey(), // ppsd_...
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    // 'shared' (internal→firm) | 'partner_upload' (firm→internal)
    direction: text("direction").notNull(),
    title: text("title").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256"),
    blobRef: text("blob_ref").notNull(),
    // Library doc/version this was copied from (shared direction only).
    sourceDocumentId: text("source_document_id"),
    sourceVersionId: text("source_version_id"),
    note: text("note"),
    // 'active' (shared) | 'pending_review' | 'accepted' | 'rejected' (uploads)
    status: text("status").notNull(),
    sharedByUserId: text("shared_by_user_id"),
    sharedByLabel: text("shared_by_label"),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pf_shared_docs_org").on(t.orgId),
    index("idx_atelier_pf_shared_docs_firm").on(t.partnerFirmId),
    index("idx_atelier_pf_shared_docs_status").on(t.status),
    index("idx_atelier_pf_shared_docs_dir").on(t.direction),
  ],
);

// ============================================================
// PARTNER NOTIFICATION CENTER (Task #1173)
// ============================================================
// In-portal notifications for alliance-partner firms. A row with a null
// userId targets the WHOLE firm (every active login sees it); a non-null
// userId targets one login. `emailedAt` is stamped after the (fire-after-
// commit) branded email fan-out. `href` is a portal-relative deep link
// (e.g. "/partner/billing"). Deny-all RLS; org-isolated like every table.
export const atelierPartnerNotifications = pgTable(
  "atelier_partner_notifications",
  {
    id: text("id").primaryKey(), // pnotif_...
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    // null = whole firm; set = a single login within the firm.
    userId: text("user_id"),
    // grant_shared | grant_revoked | contract_shared | contract_renewal |
    // contract_signature | bank_change_decided | invoice_status
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at"),
    emailedAt: timestamp("emailed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_pnotif_org").on(t.orgId),
    index("idx_atelier_pnotif_firm").on(t.partnerFirmId),
    index("idx_atelier_pnotif_firm_read").on(t.partnerFirmId, t.readAt),
  ],
);

export const atelierDependents = pgTable(
  "atelier_dependents",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee | contractor
    personId: text("person_id").notNull(),
    fullName: text("full_name").notNull(),
    relationship: text("relationship").notNull(), // spouse | child | parent | other
    dateOfBirth: text("date_of_birth"), // ISO date
    nationality: text("nationality"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_dependents_org").on(t.orgId),
    index("idx_atelier_dependents_person").on(t.personType, t.personId),
  ],
);

export const atelierEmergencyContacts = pgTable(
  "atelier_emergency_contacts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personType: text("person_type").notNull(), // employee | contractor
    personId: text("person_id").notNull(),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(),
    phones: jsonb("phones").notNull().default([]).$type<string[]>(),
    email: text("email"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_emergency_contacts_org").on(t.orgId),
    index("idx_atelier_emergency_contacts_person").on(t.personType, t.personId),
  ],
);

// ============================================================
// Task #255 — Onboarding / Offboarding sequences + Compliance + Invitations
// ============================================================

// Invitations — pre-onboarding hand-off. A pending row holds the personDraft
// (full_name + email + worker_type + role) until accepted, at which point
// the Onboarding Concierge materialises the actual person row + sequence.
// Task #509 — Titles definition registry: maps display titles → canonical
// seniority values (the same strings rate cards / pricing gates key on).
// Managed by HR / founding partners in the Org admin area; all seniority
// dropdowns across HR read from this table (falling back to the legacy
// hardcoded list when empty — production policy forbids seeding).
export const atelierTitles = pgTable(
  "atelier_titles",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    title: text("title").notNull(), // display title, e.g. "Founding Partner"
    seniority: text("seniority").notNull(), // canonical seniority value (rate-card compatible)
    rank: integer("rank").notNull().default(0), // sort order, higher = more senior
    workerTypes: jsonb("worker_types").$type<string[]>().notNull().default([]), // empty = all
    status: text("status").notNull().default("active"), // active | deprecated
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_titles_org").on(t.orgId),
    index("idx_atelier_titles_status").on(t.status),
    uniqueIndex("uniq_atelier_titles_org_title").on(t.orgId, t.title),
  ],
);

export const atelierInvitations = pgTable(
  "atelier_invitations",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    workerType: text("worker_type").notNull(), // employee | contractor | partner_firm_resource
    personDraft: jsonb("person_draft")
      .$type<{
        fullName: string;
        // Task #538 — structured name fields captured at invitation time.
        honorific?: string | null;
        firstName?: string | null;
        middleName?: string | null;
        lastName?: string | null;
        preferredName?: string | null;
        email: string;
        role?: string | null;
        seniority?: string | null;
        title?: string | null;
        country?: string | null;
        partnerFirmId?: string | null;
        startDate?: string | null;
        employingEntity?: string | null;
      }>()
      .notNull(),
    // Task #509 — invitations may only be created from a hiring source:
    // a hired candidate, an accepted offer, or a contracted partner-firm
    // resource. These record the provenance.
    sourceKind: text("source_kind"), // hired_candidate | accepted_offer | partner_firm_resource
    sourceId: text("source_id"),
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

// ============================================================
// LEAVE (Task #53) — self-service leave requests + per-person
// entitlements. Requests are owned by an atelier_users id (the signed-in
// person) AND carry the resolved roster person id so the timesheet and
// leave views can never disagree about who took the time.
// ============================================================
export const atelierLeaveRequests = pgTable(
  "atelier_leave_requests",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    userId: text("user_id").notNull(), // atelier_users.id of the requester
    personId: text("person_id").notNull(), // employee.id or contractor.id
    personType: text("person_type").notNull(), // employee | contractor
    leaveType: text("leave_type").notNull(), // annual | sick | unpaid | other
    startDate: text("start_date").notNull(), // ISO date, inclusive
    endDate: text("end_date").notNull(), // ISO date, inclusive
    // Working days (Mon–Fri) covered by the range, computed at request time
    // so balance arithmetic is stable even if the calendar rules evolve.
    workingDays: doublePrecision("working_days").notNull().default(0),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    // pending | approved | rejected | cancelled
    decidedAt: timestamp("decided_at"),
    decidedByUserId: text("decided_by_user_id"),
    decisionReason: text("decision_reason"),
    cancelledAt: timestamp("cancelled_at"),
    // Task #602 — partner/founding_partner requests auto-approve on
    // submission; the stamp distinguishes them from manager decisions.
    autoApproved: boolean("auto_approved").notNull().default(false),
    // Task #602 — id of the all-day Outlook OOF event created on approval
    // (on the leave-taker's own calendar) so revocation can remove it.
    msOofEventId: text("ms_oof_event_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_leave_req_person").on(t.personId, t.startDate),
    index("idx_atelier_leave_req_user").on(t.userId),
    index("idx_atelier_leave_req_status").on(t.status),
    index("idx_atelier_leave_req_org").on(t.orgId),
  ],
);

// Per-person, per-year leave entitlement (HR-configured). When absent, the
// app-level defaults apply (annual 25, sick 10 working days).
export const atelierLeaveEntitlements = pgTable(
  "atelier_leave_entitlements",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personId: text("person_id").notNull(),
    personType: text("person_type").notNull(), // employee | contractor
    year: integer("year").notNull(),
    annualDays: doublePrecision("annual_days").notNull().default(25),
    sickDays: doublePrecision("sick_days").notNull().default(10),
    notes: text("notes"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_atelier_leave_ent").on(t.personId, t.year),
    index("idx_atelier_leave_ent_org").on(t.orgId),
  ],
);

// Task #606 — HR/leadership review decisions over the curated public-holiday
// dataset (lib atelierHolidays.ts). One row per reviewed dataset entry,
// keyed by the base entry's stable key (country|date|name). "confirmed"
// keeps the curated dates; "adjusted" replaces them (Islamic dates are
// moon-sighting dependent, so official announcements may shift them).
// Effective date/endDate are ALWAYS stored so readers never need to
// branch on status. Absence of a row = not yet reviewed.
export const atelierHolidayOverrides = pgTable(
  "atelier_holiday_overrides",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    holidayKey: text("holiday_key").notNull(), // country|baseDate|name
    country: text("country").notNull(),
    status: text("status").notNull(), // confirmed | adjusted
    date: text("date").notNull(), // effective start (YYYY-MM-DD)
    endDate: text("end_date").notNull(), // effective end, inclusive
    note: text("note"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_atelier_holiday_override").on(t.orgId, t.holidayKey),
    index("idx_atelier_holiday_override_org").on(t.orgId),
  ],
);

// Internal roster reporting lines (org chart for approval routing). A
// person may hold MULTIPLE live edges (multiple managers) — deliberately
// no uniqueness on personId alone; approval logic must accept any of them.
export const atelierRosterReportsTo = pgTable(
  "atelier_roster_reports_to",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    personId: text("person_id").notNull(), // employee.id or contractor.id
    managerPersonId: text("manager_person_id").notNull(), // employee.id
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_atelier_roster_reports_edge").on(t.personId, t.managerPersonId),
    index("idx_atelier_roster_reports_person").on(t.personId),
    index("idx_atelier_roster_reports_mgr").on(t.managerPersonId),
    index("idx_atelier_roster_reports_org").on(t.orgId),
  ],
);

// Per-employment-type, per-year leave entitlement defaults (HR-configured).
// Precedence: per-person row > employment-type row > app defaults.
export const atelierLeaveTypeEntitlements = pgTable(
  "atelier_leave_type_entitlements",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    employmentType: text("employment_type").notNull(), // FTE | fixed_term | intern | contractor
    year: integer("year").notNull(),
    annualDays: doublePrecision("annual_days").notNull().default(25),
    sickDays: doublePrecision("sick_days").notNull().default(10),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_atelier_leave_type_ent").on(t.orgId, t.employmentType, t.year),
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
    // Task #396 — normalized merchant text + how the category was resolved
    // (merchant_memory | exact_db | token | keyword | ai | manual).
    merchantNormalized: text("merchant_normalized"),
    merchantResolution: text("merchant_resolution"),
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
    status: text("status").notNull().default("draft"), // draft | submitted | approved | rejected | reimbursed
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
    // Task #53 — Me lens self-service expense claims.
    // Every claim must be tagged to a context: business development, a
    // client account, an engagement, or a named internal project. Legacy
    // wallet rows predate this and default to 'bd' (engagement-bound rows
    // read as context via engagementId).
    contextType: text("context_type").notNull().default("bd"), // bd | account | engagement | internal
    accountId: text("account_id"), // when contextType='account'
    internalProjectLabel: text("internal_project_label"), // when contextType='internal'
    // Task #383 — two-axis taxonomy + attribution + funding source.
    // `category` (above) stays the flat POLICY key; these are the new tree.
    categoryCode: text("category_code"), // atelier_expense_categories.code (top-level)
    subCategoryCode: text("sub_category_code"), // atelier_expense_categories.code (child)
    categorySource: text("category_source"), // merchant_memory | ai | manual
    bdIndustry: text("bd_industry"), // BD context: account industry (defaulted, overridable)
    entityId: text("entity_id"), // internal context: atelier_legal_entities.id
    costCenter: text("cost_center"), // internal context: management | operations | marketing
    fundingSource: text("funding_source").notNull().default("personal_claim"), // personal_claim | partner_paid | company_account
    fundingBankAccountId: text("funding_bank_account_id"), // atelier_bank_account.id when company_account
    timesheetWeekId: text("timesheet_week_id"), // optional link to a ledger week (auto-approve opt-in)
    approvalRoute: text("approval_route"), // engagement_lead | line_manager | hr | leadership (stamped at first approval)
    // Task #1095 — entity-allocation engine (benefit principle). `entityId`
    // above stays the allocated legal entity; these fields carry the
    // proposal lifecycle: proposed (agent prefill) | approved | overridden
    // (human picked a different entity) | needs_input (engine could not
    // decide — never a guess). Null allocStatus = legacy/explicit tag.
    allocStatus: text("alloc_status"),
    allocRuleId: text("alloc_rule_id"), // explicit_choice | engagement_entity | registry_match | travel_destination | travel_home | person_home | default_entity | ai
    allocJustification: text("alloc_justification"),
    allocConfidence: doublePrecision("alloc_confidence"),
    allocDecidedBy: text("alloc_decided_by"), // deterministic | ai | human
    allocShared: boolean("alloc_shared").notNull().default(false), // firm-wide cost flagged for future intercompany recharge
    allocApprovedByUserId: text("alloc_approved_by_user_id"),
    allocApprovedAt: timestamp("alloc_approved_at"),
    allocOverrideReason: text("alloc_override_reason"),
    // Task #1095 — lightweight trip context feeding the travel rules.
    tripDestinationCountry: text("trip_destination_country"), // ISO-3166 alpha-2
    tripPurpose: text("trip_purpose"), // bd | client_project | internal_meeting | training_deliver | training_attend | personal_dev | other
    tripContextSource: text("trip_context_source"), // user | ai
    reimbursedAt: timestamp("reimbursed_at"),
    reimbursedByUserId: text("reimbursed_by_user_id"),
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
    // Task #1114 — explicit VAT classification for the FTA VAT 201 boxes:
    // "reverse_charge_import" (box 3 + 10) | "goods_import" (box 6 + 10) |
    // "import_adjustment" (box 7 + 10). Metadata only (amounts stay
    // append-only); set via the finance-gated POST /vat/classification
    // route on all register rows of an expense. Null = unclassified.
    vatClassification: text("vat_classification"),
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
    // Task #428 — legal-entity tag for GL posting (atelier_legal_entities.id).
    legalEntityId: text("legal_entity_id"),
    weekIso: text("week_iso").notNull(),
    hours: doublePrecision("hours").notNull().default(0),
    ratePerHour: doublePrecision("rate_per_hour").notNull().default(0),
    rateCurrency: text("rate_currency").notNull().default("USD"),
    costAmount: doublePrecision("cost_amount").notNull().default(0),
    costCurrency: text("cost_currency").notNull().default("USD"),
    fxRate: doublePrecision("fx_rate").notNull().default(1),
    usdAmount: doublePrecision("usd_amount").notNull().default(0),
    status: text("status").notNull().default("proposed"), // proposed | partner_approved | paid | rejected
    // Task #1199 — entity-allocation lifecycle (see atelierExpenses.allocStatus).
    // Unlike expenses, the proposed entity is kept in allocProposedEntityId and
    // legalEntityId is written ONLY on human approval, so the Bookkeeper never
    // posts an undecided proposal.
    allocStatus: text("alloc_status"),
    allocProposedEntityId: text("alloc_proposed_entity_id"),
    allocRuleId: text("alloc_rule_id"),
    allocJustification: text("alloc_justification"),
    allocConfidence: doublePrecision("alloc_confidence"),
    allocDecidedBy: text("alloc_decided_by"),
    allocShared: boolean("alloc_shared").notNull().default(false),
    allocApprovedByUserId: text("alloc_approved_by_user_id"),
    allocApprovedAt: timestamp("alloc_approved_at"),
    allocOverrideReason: text("alloc_override_reason"),
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
/** Task #1250 — a printed invoice line row parsed at chat ingest time. */
export interface SupplierInvoiceLineItem {
  description: string;
  qty: number | null;
  unitAmount: number | null;
  amount: number | null;
}

/**
 * Weekly partner-firm invoice proposals. Composed from
 * atelier_partner_firm_hours rows for a (partnerFirmId, engagementId,
 * weekIso) bucket. Partner approval is ALWAYS required (per spec:
 * any partner-firm proposal needs Partner sign-off).
 */
/**
 * Task #1251 — vendor invoice line-item mining extraction payload. Stored
 * on atelier_partner_firm_invoices.line_items for detected tooling vendors
 * (Replit/Anthropic/Perplexity). `status`:
 *   ok            — extracted + reconciled to the cent (splits can propose).
 *   unreconciled  — extracted but sums don't tie; stored for review, NO splits.
 *   failed        — extraction threw / model error; stored for a re-run.
 */
export interface VendorInvoiceExtractionItem {
  /** lowercased/trimmed/squashed projectLabel; "__vendor_default__" for flat. */
  projectKey: string;
  projectLabel: string;
  category: string | null;
  amount: number;
}
export interface VendorInvoiceExtraction {
  status: "ok" | "unreconciled" | "failed";
  extractedAt: string; // ISO
  currency: string;
  subtotal: number;
  vatAmount: number;
  creditsTotal: number; // credits/discounts as a positive number
  items: VendorInvoiceExtractionItem[];
  note: string | null;
}

export const atelierPartnerFirmInvoices = pgTable(
  "atelier_partner_firm_invoices",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    partnerFirmId: text("partner_firm_id").notNull(),
    partnerFirmName: text("partner_firm_name").notNull(),
    // Task #875 — nullable: partner-submitted AP invoices (source
    // "partner_submitted") arrive from the portal without an engagement.
    // Weekly RCTI proposal rows (source "proposal") always set it.
    engagementId: text("engagement_id"),
    // Task #428 — legal-entity tag for GL posting (atelier_legal_entities.id).
    legalEntityId: text("legal_entity_id"),
    // Task #1095 — entity-allocation lifecycle (see atelierExpenses.allocStatus).
    allocStatus: text("alloc_status"),
    allocRuleId: text("alloc_rule_id"),
    allocJustification: text("alloc_justification"),
    allocConfidence: doublePrecision("alloc_confidence"),
    allocDecidedBy: text("alloc_decided_by"),
    allocShared: boolean("alloc_shared").notNull().default(false),
    allocApprovedByUserId: text("alloc_approved_by_user_id"),
    allocApprovedAt: timestamp("alloc_approved_at"),
    allocOverrideReason: text("alloc_override_reason"),
    weekIso: text("week_iso").notNull(),
    hours: doublePrecision("hours").notNull().default(0),
    costAmount: doublePrecision("cost_amount").notNull().default(0),
    costCurrency: text("cost_currency").notNull().default("USD"),
    fxRate: doublePrecision("fx_rate").notNull().default(1),
    usdAmount: doublePrecision("usd_amount").notNull().default(0),
    // Proposal rows: proposed | partner_approved | paid | rejected.
    // Partner-submitted AP rows (Task #875, source "partner_submitted"):
    //   submitted | under_review | approved | scheduled | paid | rejected.
    status: text("status").notNull().default("proposed"),
    // Task #875 — where this row came from. "proposal" = weekly RCTI
    // proposal composed from partner-firm hours; "partner_submitted" =
    // AP invoice submitted by the firm through the partner portal.
    source: text("source").notNull().default("proposal"),
    // Task #1075 — recorded payee bank details for UNLINKED suppliers
    // (partnerFirmId = ""). Registered partner firms keep their bank
    // details on the firm registry (maker-checker); these columns are the
    // one-off supplier equivalent so payment-run exports carry verified
    // details instead of finance keying IBANs into the bank file by hand.
    // Exposure follows the bank-credential rule: fp/partner/finance only.
    supplierBankIban: text("supplier_bank_iban"),
    supplierBankHolder: text("supplier_bank_holder"),
    // Task #875 — partner-submitted invoice metadata + PDF blob.
    reference: text("reference"),
    // Task #1250 — parsed invoice line items (chat ingest captures them
    // when the document prints an itemization; null = not itemizable).
    lineItems: jsonb("line_items").$type<SupplierInvoiceLineItem[]>(),
    // Task #1250 — proof-of-payment receipt paired at ingest time. When
    // set, the invoice was recorded already-paid (status "paid") so it
    // never enters a payment run and the same bill can't be paid twice.
    paymentReceipt: jsonb("payment_receipt").$type<SupplierInvoicePaymentReceipt>(),
    periodLabel: text("period_label"),
    invoiceDate: text("invoice_date"),
    // Task #1251 — vendor invoice line-item mining. Extraction payload for
    // tooling vendors (Replit/Anthropic/Perplexity): itemized per-project
    // spend, reconciliation status, credits/VAT. NULL until extraction runs
    // (fire-and-forget after upload for detected tooling vendors) or when
    // the supplier is not a tooling vendor. Own column (tooling_extraction) —
    // line_items above belongs to the chat-ingest itemization (Task #1250).
    toolingExtraction: jsonb("tooling_extraction").$type<VendorInvoiceExtraction | null>(),
    submittedByUserId: text("submitted_by_user_id"),
    submittedAt: timestamp("submitted_at"),
    fileName: text("file_name"),
    mime: text("mime"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    blobRef: text("blob_ref"),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at"),
    paymentRunId: text("payment_run_id"),
    remittanceRef: text("remittance_ref"),
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

// ============================================================
// Task #1251 — vendor invoice line-item mining + project cost allocation.
//
// Replit invoices itemize spend per Replit project; Anthropic/Perplexity
// invoices are flat. These three tables let finance map each vendor's
// project lines onto the firm's cost buckets (engagement / opportunity /
// internal / overhead) and materialize per-invoice cost splits.
// ============================================================

export type VendorCostBucketType = "engagement" | "opportunity" | "internal" | "overhead";

/**
 * Per-org mapping of a vendor's project (exact projectKey — never fuzzy)
 * onto a cost bucket. `bucket_ref` is the engagement/opportunity id for
 * those bucket types; NULL for internal/overhead. Soft-delete on remap.
 */
export const atelierVendorProjectMap = pgTable(
  "atelier_vendor_project_map",
  {
    id: text("id").primaryKey(), // vpm_...
    orgId: ORG("org_id"),
    vendorKey: text("vendor_key").notNull(),
    /** lowercased/trimmed/squashed project label from extraction. Exact match only. */
    projectKey: text("project_key").notNull(),
    projectLabel: text("project_label").notNull(),
    bucketType: text("bucket_type").notNull().$type<VendorCostBucketType>(),
    bucketRef: text("bucket_ref"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_vpm_org").on(t.orgId),
    uniqueIndex("uq_atelier_vpm_org_vendor_project").on(t.orgId, t.vendorKey, t.projectKey),
  ],
);

/**
 * Per-org percentage-split rule for a vendor's FLAT invoices (no per-project
 * lines — the "__vendor_default__" item resolves through this). `splits` is
 * a jsonb array of { bucketType, bucketRef, pct } summing to 100.
 */
export interface VendorAllocSplit {
  bucketType: VendorCostBucketType;
  bucketRef: string | null;
  pct: number;
}
export const atelierVendorAllocRules = pgTable(
  "atelier_vendor_alloc_rules",
  {
    id: text("id").primaryKey(), // var_...
    orgId: ORG("org_id"),
    vendorKey: text("vendor_key").notNull(),
    splits: jsonb("splits").$type<VendorAllocSplit[]>().notNull().default([]),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_var_org").on(t.orgId),
    uniqueIndex("uq_atelier_var_org_vendor").on(t.orgId, t.vendorKey),
  ],
);

/**
 * Materialized per-invoice cost splits. One row per extracted item once
 * ALL items on an invoice resolve to a mapping. Credits + VAT are pro-rated
 * by item gross share with largest-remainder rounding so the split figures
 * sum EXACTLY to the invoice figures. Splits NEVER auto-approve.
 */
export type VendorCostSplitStatus = "proposed" | "approved";
export const atelierVendorCostSplits = pgTable(
  "atelier_vendor_cost_splits",
  {
    id: text("id").primaryKey(), // vcs_...
    orgId: ORG("org_id"),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => atelierPartnerFirmInvoices.id, { onDelete: "cascade" }),
    projectKey: text("project_key").notNull(),
    projectLabel: text("project_label").notNull(),
    bucketType: text("bucket_type").notNull().$type<VendorCostBucketType>(),
    bucketRef: text("bucket_ref"),
    currency: text("currency").notNull().default("USD"),
    grossAmount: doublePrecision("gross_amount").notNull().default(0),
    creditAmount: doublePrecision("credit_amount").notNull().default(0),
    vatAmount: doublePrecision("vat_amount").notNull().default(0),
    netAmount: doublePrecision("net_amount").notNull().default(0),
    usdAmount: doublePrecision("usd_amount").notNull().default(0),
    status: text("status").notNull().default("proposed").$type<VendorCostSplitStatus>(),
    decidedByUserId: text("decided_by_user_id"),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_vcs_org").on(t.orgId),
    index("idx_atelier_vcs_invoice").on(t.invoiceId),
    index("idx_atelier_vcs_bucket").on(t.orgId, t.bucketType, t.bucketRef, t.status),
    // Duplicate-proposal guard (Task #1251): a materialized split identity is
    // unique among PROPOSED rows, so two concurrent extract+propose runs can
    // never both insert a full set (double-count on approval). Partial on
    // status='proposed'; approved/other statuses unconstrained. coalesce so
    // internal/overhead rows (NULL bucketRef) still collide.
    uniqueIndex("uq_atelier_vcs_proposed_identity")
      .on(t.invoiceId, t.projectKey, t.bucketType, sql`coalesce(${t.bucketRef}, '')`)
      .where(sql`status = 'proposed'`),
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
  // Task #383 — taxonomy categorization of invoice lines (same tree as expenses).
  categoryCode?: string | null;
  subCategoryCode?: string | null;
  categorySource?: "merchant_memory" | "ai" | "manual" | null;
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
      /**
       * Task #232 — signing-entity registry. Legacy rows may carry only
       * {name, jurisdiction}; the richer fields power contract preparation
       * (entity picker, governing-law autofill). Exactly one isDefault
       * entity is enforced server-side.
       */
      legalEntities: Array<{
        id?: string;
        name: string;
        jurisdiction: string;
        registeredAddress?: string;
        country?: string;
        governingLaw?: string;
        courts?: string;
        isDefault?: boolean;
      }>;
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
// FINANCE AUTOPILOT SETTINGS — Task #1091 (blueprint D1).
//
// Founder-editable thresholds that drive the auto-post policy engine
// (src/lib/atelier-finance-autopolicy.ts). One row per org. Production
// no-seed policy: the READ path returns the blueprint defaults when no
// row exists, so this table is NEVER seeded — a row only appears after a
// founding_partner/partner PATCHes it. PATCH is audited.
//
// Defaults (blueprint §4 / §9 D1):
//   journalAutoConfidence      0.9   (≥ this clears the confidence bar)
//   supplierInvoiceAutoMaxAed  1000  (auto to "ready to pay" ceiling)
//   journalAutoMaxAed          5000  (AI-coded journal auto-post ceiling)
// ============================================================
export const atelierFinanceAutopilotSettings = pgTable(
  "atelier_finance_autopilot_settings",
  {
    id: text("id").primaryKey(), // fas_<orgId>
    orgId: ORG("org_id"),
    journalAutoConfidence: doublePrecision("journal_auto_confidence").notNull().default(0.9),
    supplierInvoiceAutoMaxAed: doublePrecision("supplier_invoice_auto_max_aed").notNull().default(1000),
    journalAutoMaxAed: doublePrecision("journal_auto_max_aed").notNull().default(5000),
    updatedByUserId: text("updated_by_user_id"),
    updatedByName: text("updated_by_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_atelier_finance_autopilot_org").on(t.orgId),
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
    // Task #739 — session lineage. When an inactivity rollover mints a
    // fresh session, this points at the soft-deleted predecessor so the
    // verbatim replay window can seed from its tail (same org/user).
    predecessorSessionId: text("predecessor_session_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_cli_sessions_org").on(t.orgId),
    index("idx_atelier_cli_sessions_user").on(t.userId),
  ],
);

/**
 * Typed per-session chat facts — durable, org/user-scoped record of the
 * concrete facts a user states or resolves during a session (dates,
 * destinations, party sizes, selected options, resolved entities), so
 * later turns and confirmations can bind to explicit values instead of
 * re-deriving them from prose. Facts are session-scoped with a TTL;
 * lineage rides on atelier_cli_sessions.predecessor_session_id.
 */
export const atelierCliSessionFacts = pgTable(
  "atelier_cli_session_facts",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    /** Fact category: date | place | person | entity | quantity | selection | other */
    kind: text("kind").notNull(),
    /** Stable key within the session, e.g. "travel.departure_date". */
    key: text("key").notNull(),
    /** Resolved, typed value (dates stored as resolved ISO strings). */
    value: jsonb("value").$type<unknown>().notNull(),
    /** Human-readable one-line rendering for the model context block. */
    display: text("display").notNull(),
    /** Turn that stated/resolved this fact. */
    sourceTurnId: text("source_turn_id"),
    /** Where the fact came from: user_stated | tool_result | clarification | confirm | async_job */
    source: text("source").notNull().default("tool_result"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /** Retention cutoff — rows past this are purged opportunistically. */
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    index("idx_atelier_cli_session_facts_session").on(t.sessionId),
    index("idx_atelier_cli_session_facts_org_user").on(t.orgId, t.userId),
    uniqueIndex("uq_atelier_cli_session_facts_key").on(t.sessionId, t.key),
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
    // Task #428 — legal-entity tag for GL posting (atelier_legal_entities.id).
    legalEntityId: text("legal_entity_id"),
    // Task #1199 — entity-allocation lifecycle (see atelierExpenses.allocStatus).
    // Proposed entity lives in allocProposedEntityId; legalEntityId is written
    // only on human approval so the Bookkeeper never posts a proposal.
    allocStatus: text("alloc_status"),
    allocProposedEntityId: text("alloc_proposed_entity_id"),
    allocRuleId: text("alloc_rule_id"),
    allocJustification: text("alloc_justification"),
    allocConfidence: doublePrecision("alloc_confidence"),
    allocDecidedBy: text("alloc_decided_by"),
    allocShared: boolean("alloc_shared").notNull().default(false),
    allocApprovedByUserId: text("alloc_approved_by_user_id"),
    allocApprovedAt: timestamp("alloc_approved_at"),
    allocOverrideReason: text("alloc_override_reason"),
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
    // Task #1114 — explicit VAT classification for the FTA VAT 201 boxes.
    // Only "exempt_supply" is valid on AR invoices today (box 5); set via
    // the finance-gated POST /vat/classification route. Null = unclassified
    // (0%-rated AE invoices stay a blocking data gap on the VAT 201).
    vatClassification: text("vat_classification"),
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
    // Task #2 — set to true when the user changes their own password;
    // the boot seed must never overwrite a user-managed hash.
    userManaged: boolean("user_managed").notNull().default(false),
    // Task #5 — set to true when a partner resets a colleague's password;
    // the next login must change the temporary password before using the app.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // Task #59 — why the change is forced: "joiner" (first-ever login on a
    // temp password) or "reset" (partner reset). Cleared on successful
    // change. Drives the copy on the forced-change interstitial.
    mustChangeReason: text("must_change_reason"),
    // Task #50 — leaver deactivation. Disabled credentials cannot sign in
    // (login returns the generic invalid-credentials error) and all sessions
    // are revoked at deactivation time. Reversible by HR / founding partner.
    disabled: boolean("disabled").notNull().default(false),
    // Task #820 — persisted per-account lockout. Consecutive failed logins
    // increment failedLoginCount; at the threshold the account locks until
    // lockedUntil (generic 401 preserved — no lockout enumeration). Reset on
    // successful login, partner reset/unlock, or self-service reset.
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until"),
    // Task #821 — TOTP two-factor auth. The secret is AES-256-GCM encrypted
    // at rest (never plaintext); enrolment stores it with enabled=false until
    // the first code is confirmed. Backup codes are stored as scrypt hashes
    // with a usedAt stamp (single-use). totpLastStep prevents replay of the
    // last accepted 30-second code window.
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpSecretEnc: text("totp_secret_enc"),
    totpLastStep: integer("totp_last_step"),
    // Array of { hash: string, usedAt: string | null }
    totpBackupCodes: jsonb("totp_backup_codes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_atelier_auth_cred_user").on(t.userId)],
);

/**
 * One-time login activation tokens for newly onboarded joiners. The
 * create-login onboarding step no longer reveals a temporary password;
 * instead it mints a short-lived, single-use token whose SHA-256 hash is
 * stored here. The joiner opens the activation link, chooses their own
 * password, and the token is consumed. Raw tokens are never stored.
 */
export const atelierLoginActivationTokens = pgTable(
  "atelier_login_activation_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    userId: text("user_id").notNull(),
    createdByUserId: text("created_by_user_id"),
    // Task #820 — what the link does: "activation" (joiner chooses first
    // password) or "reset" (self-service forgot-password / partner reset).
    purpose: text("purpose").notNull().default("activation"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_atelier_login_activation_email").on(t.email)],
);

export const atelierAuthSessions = pgTable(
  "atelier_auth_sessions",
  {
    // Stores the SHA-256 hex digest of the opaque session token, never the
    // token itself, so a DB leak cannot be replayed as a session cookie.
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    // Task #5 — copied from the credential at login; while true the global
    // auth gate blocks data routes until the password is changed.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // Task #821 — step-up verification: set every time this session passes a
    // TOTP/backup-code check (at 2FA login or an explicit /2fa/verify).
    // Sensitive actions require it to be fresh (within a short window).
    totpVerifiedAt: timestamp("totp_verified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    index("idx_atelier_auth_sessions_user").on(t.userId),
    index("idx_atelier_auth_sessions_exp").on(t.expiresAt),
  ],
);

// ============================================================
// PERFORMANCE & LEARNING (Task #55) — Me lens "My Performance"
// and the training-material library.
// ============================================================

/**
 * Employee performance reviews — employee-facing read model with an HR
 * release switch. `status`: draft (HR-only) | released (visible to the
 * subject employee via /me/reviews). `hrNotes` is internal and is NEVER
 * included in the self-scope wire shape.
 */
export const atelierPerformanceReviews = pgTable(
  "atelier_performance_reviews",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    // atelier_employees.id — reviews are employee-only by design.
    employeeId: text("employee_id").notNull(),
    cycle: text("cycle").notNull(), // e.g. "FY26 H1"
    reviewedOn: text("reviewed_on"), // ISO date (YYYY-MM-DD)
    selfRating: text("self_rating"),
    managerRating: text("manager_rating"), // exceeds | meets | developing
    // Shareable narrative — released to the employee with the review.
    strengths: text("strengths").notNull().default(""),
    growthAreas: text("growth_areas").notNull().default(""),
    managerSummary: text("manager_summary").notNull().default(""),
    // Internal HR notes — never in the /me wire shape.
    hrNotes: text("hr_notes").notNull().default(""),
    status: text("status").notNull().default("draft"), // draft | released
    releasedAt: timestamp("released_at"),
    releasedByUserId: text("released_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_perf_reviews_org").on(t.orgId),
    index("idx_atelier_perf_reviews_emp").on(t.employeeId),
  ],
);

/** Employee goals for a review cycle — released reviews' companion data. */
export const atelierPerformanceGoals = pgTable(
  "atelier_performance_goals",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    employeeId: text("employee_id").notNull(), // atelier_employees.id
    cycle: text("cycle").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    weightPct: integer("weight_pct").notNull().default(0), // 0-100
    status: text("status").notNull().default("on_track"), // on_track | at_risk | complete
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_perf_goals_org").on(t.orgId),
    index("idx_atelier_perf_goals_emp").on(t.employeeId),
  ],
);

/**
 * Training-material library — HR-managed; audience-targeted. `kind`:
 * link (external URL) | file (object-storage blob referenced by
 * `objectKey`, streamed via the download route — bytes never live in DB).
 */
export const atelierTrainingMaterials = pgTable(
  "atelier_training_materials",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    topic: text("topic").notNull().default(""), // free-text topic/track
    kind: text("kind").notNull(), // link | file
    url: text("url"), // kind=link
    objectKey: text("object_key"), // kind=file — key under the training blob subdir
    fileName: text("file_name"),
    mime: text("mime"),
    sizeBytes: integer("size_bytes"),
    audience: text("audience").notNull().default("all"), // all | employees | contractors
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [index("idx_atelier_training_mat_org").on(t.orgId)],
);

/**
 * Manager/HR check-ins — lightweight 1:1 records for the People Perform
 * lens. `managerName` is free text (check-ins may be run by partners who
 * are not roster employees).
 */
export const atelierCheckIns = pgTable(
  "atelier_check_ins",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    employeeId: text("employee_id").notNull(), // atelier_employees.id
    managerName: text("manager_name").notNull().default(""),
    scheduledFor: text("scheduled_for").notNull(), // ISO date (YYYY-MM-DD)
    status: text("status").notNull().default("scheduled"), // scheduled | completed | missed
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_check_ins_org").on(t.orgId),
    index("idx_atelier_check_ins_emp").on(t.employeeId),
  ],
);

/**
 * Professional certifications held by employees — People Develop lens.
 * Status (active / expiring / expired) is derived from `expiresOn` at
 * read time, never stored.
 */
export const atelierCertifications = pgTable(
  "atelier_certifications",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    employeeId: text("employee_id").notNull(), // atelier_employees.id
    certName: text("cert_name").notNull(),
    issuer: text("issuer").notNull().default(""),
    issuedOn: text("issued_on").notNull(), // ISO date (YYYY-MM-DD)
    expiresOn: text("expires_on"), // ISO date or null = never expires
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_certifications_org").on(t.orgId),
    index("idx_atelier_certifications_emp").on(t.employeeId),
  ],
);

/** Per-person completion marks — one row per (material, user). */
export const atelierTrainingCompletions = pgTable(
  "atelier_training_completions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    materialId: text("material_id").notNull(),
    userId: text("user_id").notNull(), // atelier_users.id
    completedAt: timestamp("completed_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_training_done_org").on(t.orgId),
    index("idx_atelier_training_done_mat").on(t.materialId),
    uniqueIndex("uq_atelier_training_done").on(t.materialId, t.userId),
  ],
);

/* ============================================================
   Finance Comply registers (Task #177).

   One generic table backs all five Comply registers (internal
   controls, SoD conflicts, statutory filings, transfer-pricing
   rows, insurance policies). `register` discriminates; the
   register-specific payload lives in `data` (validated at the
   route layer against the register's interface). Manual entry
   by finance leadership replaces the removed demo seed.
   ============================================================ */
export const atelierFinanceComplianceEntries = pgTable(
  "atelier_finance_compliance_entries",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    register: text("register").notNull(), // controls | sod | statutory | tp | insurance
    data: jsonb("data").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_fin_comp_org").on(t.orgId),
    index("idx_atelier_fin_comp_register").on(t.register),
  ],
);

/* ============================================================
   EA delegation (Task #386) — partners delegate admin work
   (timesheets, expenses, meetings/tasks) to Executive
   Assistants. Grants are explicit, scoped, many-to-many and
   revocable; delegated entries land as pending items the
   partner must approve/reject before they enter the normal
   downstream approval ladders.
   ============================================================ */
export const atelierEaDelegations = pgTable(
  "atelier_ea_delegations",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    // atelier_users.id of the delegating partner (principal).
    partnerUserId: text("partner_user_id").notNull(),
    // atelier_users.id of the Executive Assistant (delegate).
    eaUserId: text("ea_user_id").notNull(),
    // Delegated task areas: subset of timesheets | expenses | meetings_tasks.
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("active"), // active | revoked
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id"),
    // manual | partner_deactivated | ea_deactivated
    revokedReason: text("revoked_reason"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_atelier_ea_deleg_partner").on(t.partnerUserId),
    index("idx_atelier_ea_deleg_ea").on(t.eaUserId),
    index("idx_atelier_ea_deleg_org").on(t.orgId),
  ],
);

export const atelierEaPendingItems = pgTable(
  "atelier_ea_pending_items",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    delegationId: text("delegation_id").notNull(),
    partnerUserId: text("partner_user_id").notNull(),
    eaUserId: text("ea_user_id").notNull(),
    // timesheet_entry | expense | meeting_task
    kind: text("kind").notNull(),
    // The proposed artifact, validated at the route layer per kind.
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    // EA-uploaded receipt (expense kind) — private object path owned by
    // the EA; the download route additionally admits partner + HR.
    receiptFileRef: text("receipt_file_ref"),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    rejectionReason: text("rejection_reason"),
    decidedAt: timestamp("decided_at"),
    decidedByUserId: text("decided_by_user_id"),
    // Id of the artifact created at approval (timesheet entry id /
    // expense id / self-notification id) — the idempotency token.
    appliedRef: text("applied_ref"),
    resubmittedAt: timestamp("resubmitted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_ea_pending_partner").on(t.partnerUserId, t.status),
    index("idx_atelier_ea_pending_ea").on(t.eaUserId, t.status),
    index("idx_atelier_ea_pending_org").on(t.orgId),
  ],
);

// ============================================================
// Task #845 — Employment & salary letter issuances (self-service)
// ============================================================

// Every letter/certificate issued through the self-service flow gets one
// row: type + language + addressee + delivery mode + unique reference
// number. Powers the employee's request history and the wet-signature
// status trail. The generated PDF itself is stored as a person document
// (kind "employment_letter"); `documentId` links to it.
export const atelierLetterIssuances = pgTable(
  "atelier_letter_issuances",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    // Requesting employee (self-service only: userId is the login row,
    // personId the atelier_employees roster row).
    userId: text("user_id").notNull(),
    personId: text("person_id").notNull(),
    // Catalog id, e.g. salary_cert_bank_loan | employment_verification | ...
    letterType: text("letter_type").notNull(),
    language: text("language").notNull(), // en | ar | tr
    deliveryMode: text("delivery_mode").notNull(), // digital | wet_signature
    addresseeName: text("addressee_name"), // null => "To Whom It May Concern"
    addresseeInstitution: text("addressee_institution"),
    purpose: text("purpose"),
    travelStart: text("travel_start"), // ISO date, visa letters only
    travelEnd: text("travel_end"), // ISO date, visa letters only
    // Unique human-quotable reference printed on the letter.
    refNumber: text("ref_number").notNull(),
    // Signing entity snapshot at issue time.
    entityId: text("entity_id"),
    entityName: text("entity_name"),
    signatoryName: text("signatory_name"),
    signatoryTitle: text("signatory_title"),
    // issued (digital, delivered/stored) | sent_to_signatory (wet, awaiting
    // print+sign+hand-over) | handed_over (future manual close-out)
    status: text("status").notNull().default("issued"),
    // Honest delivery channel: "resend" (delivered) | "log-only" (not
    // actually delivered — Resend testing mode) | null (no email attempted).
    emailVia: text("email_via"),
    emailTo: text("email_to"),
    // Person-document row holding the generated PDF (self re-download).
    documentId: text("document_id"),
    fileName: text("file_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("idx_atelier_letter_issuances_org").on(t.orgId),
    index("idx_atelier_letter_issuances_person").on(t.personId),
    uniqueIndex("uq_atelier_letter_issuances_ref").on(t.orgId, t.refNumber),
  ],
);

/** Task #1250 — proof-of-payment receipt paired with the invoice at ingest. */
export interface SupplierInvoicePaymentReceipt {
  fileName: string;
  mime: string | null;
  sizeBytes: number;
  sha256: string;
  blobRef: string;
  attachedAt: string;
  attachedByUserId: string;
  /** Pairing basis — reference-only by design: identical amounts across
   * unrelated bills are common, so amounts alone never mark a bill paid. */
  matchedBy: "reference";
}
