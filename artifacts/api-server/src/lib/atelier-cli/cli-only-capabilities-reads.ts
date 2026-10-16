/**
 * Task #341 — CLI read parity for every UI view.
 *
 * Every view Atelier UI renders gets a matching read-only CLI
 * capability so the assistant can answer plain-language questions
 * about it ("show pipeline by stage", "who's over-utilised", "burn
 * vs budget on DEWA", "what changed on Acme this week", etc).
 *
 * Pattern — every entry:
 *   - is `isWrite: false`, `twoPhaseConfirm: false`,
 *   - declares EN/AR/FR slash + example phrasings,
 *   - tags one of the new result-card shapes
 *     (kpi_strip / ranked_list / time_series / entity_card /
 *     audit_timeline) so the client renderer knows the layout,
 *   - surfaces on the page(s) that show the same data so the
 *     suggestion chips can advertise it.
 *
 * Coverage is checked at build time by tests/cli-parity (read
 * matrix) and by tests/cli-smoke (intent-router prompts).
 */

import { and, eq, gte, isNull, desc, inArray, lte, ilike, or } from "drizzle-orm";
import { agentRunIsFresh, effectiveAgentRunStatus } from "../atelier-agents/run-staleness.js";
import {
  db,
  atelierAccounts,
  atelierContacts,
  atelierOpportunities,
  atelierEngagements,
  atelierRaidItems,
  atelierAgentRuns,
  atelierAgentRunSnapshots,
  atelierAgentOutcomeEvents,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierExpenses,
  atelierAuditEvents,
  atelierComplianceRecords,
  atelierUsers,
} from "@workspace/db";
import { getAgent } from "@workspace/agents";
import {
  CATALOG_SCHEMA_VERSION,
  capabilitiesForPersona,
  defineCapability,
} from "./capability-catalog.js";
import {
  reviewedCapabilityManifestDocument,
} from "./capability-manifest.js";
import reviewedAgentManifest from "../atelier-agents/generated/crm-agent-manifest.v1.json";
import {
  SALES_STAGES,
  resolveSalesStage,
} from "../atelier-agents/pipeline.js";
import { resolveAccount, resolveEngagement } from "./resolvers/index.js";
import { loadStageAges, loadAccountCurrencies, projectDealMoney, sumWeightedUsd } from "../atelier-opportunity-facts.js";
import { loadEngagementRollups } from "../atelier-engagement-rollups.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import {
  canSeeAccount,
  readAccountDossier,
} from "../../routes/atelier/accountRoutes.js";
import { canAccessAgentRunTarget } from "../atelier-agents/agent-run-access.js";
import {
  isRestrictedPersona,
  isBoardObserver,
} from "../../routes/atelier/personaRoles.js";
import { resolveSelfPerson } from "../../routes/atelier/meRoutes.js";
import {
  isoWeekOf,
  isValidIsoDateStrict,
  isValidIsoWeek,
} from "../../routes/atelier/ledgerRoutes.js";
import type { CliPersona, ToolContext, ToolResult } from "./index.js";

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

// Task #175 — canonical 5-stage funnel + 3 terminals (mirrors SALES_STAGES).
const PIPELINE_STAGES = SALES_STAGES;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function denyForbidden(reason: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: reason };
}

const AGENT_OPERATIONS_ROLES = [
  "founding_partner",
  "partner",
  "senior_manager",
] as const;

function canInspectAgentOperations(role: string): boolean {
  return (AGENT_OPERATIONS_ROLES as readonly string[]).includes(role);
}

function reviewedSpecialistEntry(agentId: string) {
  const canonicalId = agentId.startsWith("ag_") ? agentId : `ag_${agentId}`;
  const entry = reviewedAgentManifest.entries.find((candidate) => candidate.id === canonicalId);
  if (!entry || entry.id === "ag_riser_orchestrator") return undefined;
  if (entry.classification !== "executable" && entry.classification !== "advisory") return undefined;
  return entry;
}

async function engAclOk(
  persona: CliPersona,
  engagementId: string,
): Promise<boolean> {
  const acl = await accessibleEngagementIds({
    id: persona.id,
    role: persona.role,
  } as Parameters<typeof accessibleEngagementIds>[0]);
  return acl.all === true || acl.ids.has(engagementId);
}

// ---------------------------------------------------------------------
// pipeline.by_stage — kpi_strip
// ---------------------------------------------------------------------
defineCapability({
  id: "pipeline.by_stage",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "pipeline_by_stage",
  description:
    "Summarise the open pipeline grouped by PLM stage: count, weighted USD value, and aged-red count per stage.",
  slashAliases: { en: ["/pipeline", "/pipeline-by-stage"], fr: ["/pipeline-stade"] },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home", "opportunity_workspace", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "kpi_strip",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show pipeline by stage", "What's in pursue right now?"],
    ar: ["اعرض خط الفرص حسب المرحلة"],
    fr: ["Affiche le pipeline par étape"],
  },
  async run(_input, ctx) {
    const opps = await db
      .select({
        id: atelierOpportunities.id,
        accountId: atelierOpportunities.accountId,
        salesStage: atelierOpportunities.salesStage,
        deal: atelierOpportunities.dealSizeHypothesis,
        prob: atelierOpportunities.probabilityPct,
        createdAt: atelierOpportunities.createdAt,
      })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.orgId, ctx.persona.orgId),
          isNull(atelierOpportunities.deletedAt),
        ),
      );
    // Oct 2026 audit — deal money is in the account's currency and
    // days-in-stage comes from the transition log (see atelier-opportunity-facts).
    const [ages, currencies] = await Promise.all([
      loadStageAges(opps),
      loadAccountCurrencies(opps.map((o) => o.accountId)),
    ]);
    const projected = opps.map((o) => ({
      o,
      money: projectDealMoney(o.deal, o.prob, currencies.get(o.accountId)),
      days: ages.get(o.id)?.days ?? 0,
    }));
    const stages = PIPELINE_STAGES.map((stage) => {
      const list = projected.filter(
        ({ o }) => resolveSalesStage(o.salesStage) === stage,
      );
      const sum = sumWeightedUsd(list.map((x) => x.money));
      return {
        stage,
        count: list.length,
        weightedValueUsd: sum.weightedValueUsd,
        currencies: sum.currencies,
        unconvertedCount: sum.unconvertedCount,
        agedRedCount: list.filter((x) => x.days > 30).length,
      };
    });
    const all = sumWeightedUsd(projected.map((x) => x.money));
    return {
      ok: true,
      data: {
        stages,
        totalOpps: opps.length,
        currency: "USD",
        note: `Weighted values converted to USD at the latest rate from each account's currency (${all.currencies.join(", ") || "USD"}).${all.unconvertedCount ? ` ${all.unconvertedCount} opportunit${all.unconvertedCount === 1 ? "y" : "ies"} excluded: no FX rate.` : ""}`,
      },
    };
  },
});

// ---------------------------------------------------------------------
// opportunity.list_by_stage — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "opportunity.list_by_stage",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "opportunity_list_by_stage",
  description:
    "List the top open opportunities in a given sales stage (suspect|prospect|convert|runner|contract|lost|no_decision|withdrawn), sorted by weighted USD value. Stage is required — use opportunity_search when you want results across all stages.",
  slashAliases: { en: ["/opps-in-stage", "/opps"] },
  inputSchema: {
    type: "object",
    properties: {
      // Task #769 — stage is now required; the old silent default of
      // "convert" caused stage-by-stage brute-force iteration. Use
      // opportunity_search when no specific stage is requested.
      stage: {
        type: "string",
        description:
          "Required. One of: suspect | prospect | convert | runner | contract | lost | no_decision | withdrawn.",
      },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["stage"],
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["opportunity_workspace", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["List opportunities in convert", "Top 10 deals in prospect"],
    ar: ["اعرض الفرص في مرحلة convert"],
    fr: ["Liste les opportunités en convert"],
  },
  async run(input, ctx) {
    const stageRaw = String(input.stage ?? "").toLowerCase().trim();
    if (!stageRaw) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage:
          "stage is required. Specify one of: suspect, prospect, convert, runner, contract, lost, no_decision, withdrawn. Use opportunity_search to find opportunities across all stages.",
      };
    }
    const stage = stageRaw;
    const limit = Math.max(1, Math.min(50, Number(input.limit ?? 10)));
    const rows = await db
      .select({
        id: atelierOpportunities.id,
        name: atelierOpportunities.name,
        accountId: atelierOpportunities.accountId,
        salesStage: atelierOpportunities.salesStage,
        deal: atelierOpportunities.dealSizeHypothesis,
        prob: atelierOpportunities.probabilityPct,
        createdAt: atelierOpportunities.createdAt,
        nextMilestone: atelierOpportunities.nextMilestone,
      })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.orgId, ctx.persona.orgId),
          isNull(atelierOpportunities.deletedAt),
        ),
      );
    const inStage = rows.filter(
      (r) => resolveSalesStage(r.salesStage) === stage,
    );
    const [ages, currencies] = await Promise.all([
      loadStageAges(inStage),
      loadAccountCurrencies(inStage.map((r) => r.accountId)),
    ]);
    const items = inStage
      .map((r) => {
        const money = projectDealMoney(r.deal, r.prob, currencies.get(r.accountId));
        return {
          id: r.id,
          label: r.name,
          accountId: r.accountId,
          dealSize: money.dealSize,
          currency: money.currency,
          dealSizeUsd: money.dealSizeUsd,
          weightedValue: money.weightedValue,
          weightedValueUsd: money.weightedValueUsd,
          daysInStage: ages.get(r.id)?.days ?? 0,
          nextMilestone: r.nextMilestone,
          href: `/opportunities/${r.id}`,
        };
      })
      .sort((a, b) => (b.weightedValueUsd ?? 0) - (a.weightedValueUsd ?? 0))
      .slice(0, limit);
    return { ok: true, data: { stage, items, total: inStage.length, truncated: inStage.length > items.length } };
  },
});

// ---------------------------------------------------------------------
// opportunity.search — ranked_list (Task #769)
//
// Cross-stage opportunity search: accepts a name fragment and/or an
// account reference, returns matching opportunities across ALL stages.
// Replaces the floor entry previously held by opportunity_list_by_stage,
// which had no account-scope input and silently defaulted stage to
// "convert" — driving the model to iterate stage-by-stage.
// ---------------------------------------------------------------------
defineCapability({
  id: "opportunity.search",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "opportunity_search",
  description:
    "Search opportunities across all pipeline stages. Accepts a name fragment (q), an account id (accountId), or an account name (accountName) — at least one must be provided. Returns up to 10 matching opportunities with stage, deal size, and account name.",
  slashAliases: { en: ["/opp-search", "/find-opp"], fr: ["/chercher-opportunite"] },
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Fuzzy opportunity name fragment (optional when accountId/accountName is given)." },
      accountId: { type: "string", description: "Scope results to a specific account by id." },
      accountName: { type: "string", description: "Scope results to a specific account by name when id is unknown." },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  // Global surface so mobile (null pageContext) and portal both see it.
  surfaceOn: ["opportunity_workspace", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: [
      "Find opportunities at U Mobile",
      "Search for DEWA deals",
      "What opportunities do we have with Tasama?",
    ],
    ar: ["ابحث عن الفرص مع U Mobile"],
    fr: ["Chercher des opportunités chez U Mobile"],
  },
  async run(input, ctx) {
    const q = typeof input.q === "string" ? input.q.trim() : "";
    const limitRaw = Math.max(1, Math.min(20, Number(input.limit ?? 10)));

    if (!q && !input.accountId && !input.accountName) {
      return {
        ok: false,
        errorCode: "invalid_input",
        errorMessage:
          "Provide at least one of: q (name fragment), accountId, or accountName.",
      };
    }

    // Resolve account scope.
    let scopeAccountId: string | null = null;
    let accountLabel: string | null = null;
    if (typeof input.accountId === "string" && input.accountId.trim()) {
      scopeAccountId = input.accountId.trim();
    } else if (typeof input.accountName === "string" && input.accountName.trim()) {
      const accQ = input.accountName.trim();
      const accRows = await db
        .select({ id: atelierAccounts.id, name: atelierAccounts.name })
        .from(atelierAccounts)
        .where(
          and(
            eq(atelierAccounts.orgId, ctx.persona.orgId),
            isNull(atelierAccounts.deletedAt),
            ilike(atelierAccounts.name, `%${accQ}%`),
          ),
        )
        .limit(1);
      if (accRows.length > 0) {
        scopeAccountId = accRows[0]!.id;
        accountLabel = accRows[0]!.name;
      } else {
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `No account matched "${accQ}". Check the spelling or try a shorter name fragment.`,
        };
      }
    }

    const conds = [
      eq(atelierOpportunities.orgId, ctx.persona.orgId),
      isNull(atelierOpportunities.deletedAt),
    ];
    if (scopeAccountId) {
      conds.push(eq(atelierOpportunities.accountId, scopeAccountId) as unknown as Parameters<typeof and>[0]);
    }
    if (q) {
      conds.push(ilike(atelierOpportunities.name, `%${q}%`) as unknown as Parameters<typeof and>[0]);
    }

    const rows = await db
      .select({
        id: atelierOpportunities.id,
        name: atelierOpportunities.name,
        accountId: atelierOpportunities.accountId,
        salesStage: atelierOpportunities.salesStage,
        deal: atelierOpportunities.dealSizeHypothesis,
        prob: atelierOpportunities.probabilityPct,
        createdAt: atelierOpportunities.createdAt,
        nextMilestone: atelierOpportunities.nextMilestone,
      })
      .from(atelierOpportunities)
      .where(and(...(conds as [Parameters<typeof and>[0]])))
      .limit(limitRaw);
    const [ages, currencies] = await Promise.all([
      loadStageAges(rows),
      loadAccountCurrencies(rows.map((r) => r.accountId)),
    ]);

    // Enrich with account names for multi-account result sets.
    const accIds = [...new Set(rows.map((r) => r.accountId))];
    const accs =
      accIds.length > 0
        ? await db
            .select({ id: atelierAccounts.id, name: atelierAccounts.name })
            .from(atelierAccounts)
            .where(inArray(atelierAccounts.id, accIds))
            .limit(accIds.length)
        : [];
    const accMap = new Map(accs.map((a) => [a.id, a.name]));
    if (accountLabel && scopeAccountId) accMap.set(scopeAccountId, accountLabel);

    const items = rows
      .map((r) => {
        const money = projectDealMoney(r.deal, r.prob, currencies.get(r.accountId));
        return {
          id: r.id,
          label: r.name,
          accountName: accMap.get(r.accountId) ?? r.accountId,
          stage: resolveSalesStage(r.salesStage),
          dealSize: money.dealSize,
          currency: money.currency,
          dealSizeUsd: money.dealSizeUsd,
          weightedValue: money.weightedValue,
          weightedValueUsd: money.weightedValueUsd,
          daysInStage: ages.get(r.id)?.days ?? 0,
          nextMilestone: r.nextMilestone ?? null,
          href: `/opportunities/${r.id}`,
        };
      })
      .sort((a, b) => (b.weightedValueUsd ?? 0) - (a.weightedValueUsd ?? 0));

    return {
      ok: true,
      data: {
        items,
        total: items.length,
        filters: { q: q || null, accountId: scopeAccountId },
      },
    };
  },
});

// ---------------------------------------------------------------------
// engagement.list_active — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "engagement.list_active",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "engagement",
  toolName: "engagement_list_active",
  description:
    "List the engagements currently in mobilize/deliver/compound, ordered by RAID severity then planned end date.",
  slashAliases: { en: ["/engagements", "/eng-list"] },
  inputSchema: { type: "object", properties: {} },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["List active engagements", "Show engagements in flight"],
    ar: ["اعرض الارتباطات النشطة"],
    fr: ["Liste les missions actives"],
  },
  async run(_input, ctx) {
    const rows = await db
      .select({
        id: atelierEngagements.id,
        name: atelierEngagements.name,
        accountId: atelierEngagements.accountId,
        plmStage: atelierEngagements.plmStage,
        raidStatus: atelierEngagements.raidStatus,
        plannedEndDate: atelierEngagements.plannedEndDate,
        deliverablesDueThisWeek: atelierEngagements.deliverablesDueThisWeek,
      })
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.orgId, ctx.persona.orgId),
          isNull(atelierEngagements.deletedAt),
        ),
      );
    const acl = await accessibleEngagementIds({
      id: ctx.persona.id,
      role: ctx.persona.role,
    } as Parameters<typeof accessibleEngagementIds>[0]);
    const visible = rows.filter(
      (r) => r.plmStage !== "closed" && (acl.all === true || acl.ids.has(r.id)),
    );
    // Oct 2026 audit — RAID colour and due-this-week from the live tables;
    // the engagement columns are never written after seeding.
    const rollups = await loadEngagementRollups(ctx.persona.orgId, visible.map((r) => r.id));
    const live = visible.map((r) => ({ r, roll: rollups.get(r.id)! }));
    const sevRank = (s: string): number =>
      s === "red" ? 0 : s === "amber" ? 1 : 2;
    live.sort(
      (a, b) =>
        sevRank(a.roll.raidStatus) - sevRank(b.roll.raidStatus) ||
        a.r.plannedEndDate.localeCompare(b.r.plannedEndDate),
    );
    return {
      ok: true,
      data: {
        items: live.map(({ r, roll }) => ({
          id: r.id,
          label: r.name,
          plmStage: r.plmStage,
          raidStatus: roll.raidStatus,
          openRaidCount: roll.openRaidCount,
          plannedEndDate: r.plannedEndDate,
          deliverablesDueThisWeek: roll.deliverablesDueThisWeek,
          deliverablesOverdue: roll.deliverablesOverdue,
          href: `/engagements/${r.id}`,
        })),
        total: visible.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// account.list — ranked_list (Task #390)
// ---------------------------------------------------------------------
defineCapability({
  id: "account.list",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_list",
  description:
    "List the firm's accounts (clients). Use this whenever the user asks for the list of clients, customers, or accounts. Returns name, status, tier, sector and country per account, scoped to what the caller may see.",
  slashAliases: { en: ["/accounts", "/clients"], fr: ["/comptes", "/clients"] },
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "Optional filter: 'active' (default, hides archived), 'archived', or 'all'.",
      },
      // Task #404 — firmographic filters so "accounts in Saudi Arabia"
      // and "clients in the energy sector" answer directly.
      country: {
        type: "string",
        description: "Optional country filter (name or ISO code, case-insensitive).",
      },
      sector: {
        type: "string",
        description: "Optional sector/industry filter (case-insensitive substring).",
      },
      q: {
        type: "string",
        description:
          "Optional name filter: case-insensitive substring of the account name or brand name (e.g. 'QIB', 'Tasama').",
      },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "account_workspace", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show me the list of clients", "List all accounts", "Who are our clients?"],
    ar: ["اعرض قائمة العملاء", "اعرض جميع الحسابات"],
    fr: ["Affiche la liste des clients", "Liste tous les comptes"],
  },
  async run(input, ctx) {
    const statusFilter = String(input.status ?? "active").toLowerCase();
    const rows = await db
      .select({
        id: atelierAccounts.id,
        name: atelierAccounts.name,
        status: atelierAccounts.status,
        tier: atelierAccounts.tier,
        sector: atelierAccounts.sector,
        country: atelierAccounts.country,
        partnerOwnerId: atelierAccounts.partnerOwnerId,
        brandName: atelierAccounts.brandName,
      })
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.orgId, ctx.persona.orgId),
          isNull(atelierAccounts.deletedAt),
        ),
      );
    // Same default as the REST /accounts list: archived accounts are
    // hidden unless explicitly requested.
    let filtered = rows;
    // Oct 2026 audit — the model passed `q` ("accounts matching QIB") and
    // the tool ignored it, returning every account under a card titled by
    // the query. Match on name OR brand name, case-insensitive.
    const qFilter = String(input.q ?? input.query ?? input.name ?? "").trim().toLowerCase();
    if (qFilter) {
      filtered = filtered.filter(
        (r) =>
          (r.name ?? "").toLowerCase().includes(qFilter) ||
          (r.brandName ?? "").toLowerCase().includes(qFilter),
      );
    }
    if (statusFilter === "archived") {
      filtered = filtered.filter((r) => (r.status ?? "active") === "archived");
    } else if (statusFilter !== "all") {
      filtered = filtered.filter((r) => (r.status ?? "active") !== "archived");
    }
    // Task #404 — firmographic filters (country / sector), matching the
    // Accounts list UI filters. Case-insensitive substring so "KSA",
    // "Saudi" or "SA" style inputs still land.
    const countryFilter = String(input.country ?? "").trim().toLowerCase();
    if (countryFilter) {
      filtered = filtered.filter((r) =>
        (r.country ?? "").toLowerCase().includes(countryFilter),
      );
    }
    const sectorFilter = String(input.sector ?? "").trim().toLowerCase();
    if (sectorFilter) {
      filtered = filtered.filter((r) =>
        (r.sector ?? "").toLowerCase().includes(sectorFilter),
      );
    }
    // Account-level visibility — mirrors the REST list route: partners see
    // everything; others need an engagement grant on the account or to be
    // its partner owner.
    const me = { id: ctx.persona.id, role: ctx.persona.role };
    const access = await accessibleEngagementIds(
      me as Parameters<typeof accessibleEngagementIds>[0],
    );
    const visibleFlags = await Promise.all(
      filtered.map((r) => canSeeAccount(access, me, r.id)),
    );
    const visible = filtered.filter((_, i) => visibleFlags[i]);
    visible.sort((a, b) => a.name.localeCompare(b.name));
    return {
      ok: true,
      data: {
        items: visible.map((r) => ({
          id: r.id,
          label: r.name,
          status: r.status ?? "active",
          tier: r.tier ?? null,
          sector: r.sector ?? null,
          country: r.country ?? null,
          brandName: r.brandName ?? null,
          href: `/accounts/${r.id}`,
        })),
        total: visible.length,
        ...(qFilter ? { query: qFilter } : {}),
      },
    };
  },
});

// ---------------------------------------------------------------------
// utilization.firm — kpi_strip
// ---------------------------------------------------------------------
defineCapability({
  id: "utilization.firm",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "utilization_firm",
  description:
    "Firm-wide utilisation over a window of SUBMITTED or approved timesheet weeks (default: the last 4 complete weeks): billable hours ÷ available hours (40 per person-week), with the people and weeks counted. Draft weeks are excluded and reported separately.",
  slashAliases: { en: ["/utilization", "/util-firm"] },
  inputSchema: {
    type: "object",
    properties: {
      weeks: {
        type: "integer",
        minimum: 1,
        maximum: 13,
        description: "Number of most recent complete ISO weeks to include (default 4). Use 1 for 'this week' / 'last week' questions, 4 for 'this month'.",
      },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["ledger", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "kpi_strip",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show firm utilization this week", "What's our utilisation right now?"],
    ar: ["اعرض استخدام الفريق لهذا الأسبوع"],
    fr: ["Affiche l'utilisation du cabinet cette semaine"],
  },
  async run(input, ctx) {
    // Oct 2026 audit — the previous version took the single newest week in
    // the table whatever its status, so a half-filled draft week for one
    // person was presented as "firm utilisation 0%". Now: a window of
    // complete ISO weeks, submitted/approved only, utilisation against
    // available hours (40 per person-week, the same basis as the ledger
    // route's utilisation snapshots), drafts counted but not included.
    const SUBMITTED = new Set(["submitted", "lead_approved", "approved", "locked", "finance_approved"]);
    const AVAILABLE_HOURS_PER_WEEK = 40;
    const windowWeeks = Math.max(1, Math.min(13, Number(input.weeks ?? 4)));
    // ISO weeks, newest first, starting from LAST week (the current week is
    // never complete).
    const isoWeeks: string[] = [];
    for (let i = 1; i <= windowWeeks; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i * 7);
      const day = (d.getUTCDay() + 6) % 7;
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
      const thursday = new Date(monday);
      thursday.setUTCDate(thursday.getUTCDate() + 3);
      const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
      const week =
        1 +
        Math.round(
          ((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
        );
      isoWeeks.push(`${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`);
    }
    const weeks = await db
      .select({
        id: atelierTimesheetWeeks.id,
        personId: atelierTimesheetWeeks.personId,
        status: atelierTimesheetWeeks.status,
        weekIso: atelierTimesheetWeeks.weekIso,
        total: atelierTimesheetWeeks.totalHours,
        billable: atelierTimesheetWeeks.billableHours,
      })
      .from(atelierTimesheetWeeks)
      .where(
        and(
          eq(atelierTimesheetWeeks.orgId, ctx.persona.orgId),
          isNull(atelierTimesheetWeeks.deletedAt),
          inArray(atelierTimesheetWeeks.weekIso, isoWeeks),
        ),
      );
    const counted = weeks.filter((w) => SUBMITTED.has(w.status));
    const drafts = weeks.filter((w) => !SUBMITTED.has(w.status));
    const people = new Set(counted.map((w) => w.personId));
    const weeksCovered = new Set(counted.map((w) => w.weekIso));
    const totalHours = counted.reduce((a, w) => a + (w.total ?? 0), 0);
    const billableHours = counted.reduce((a, w) => a + (w.billable ?? 0), 0);
    const availableHours = counted.length * AVAILABLE_HOURS_PER_WEEK;
    const note =
      counted.length === 0
        ? drafts.length > 0
          ? `No submitted timesheets in the last ${windowWeeks} week${windowWeeks === 1 ? "" : "s"}; ${drafts.length} draft week${drafts.length === 1 ? "" : "s"} not yet submitted. Utilisation cannot be stated.`
          : `No timesheets recorded for the last ${windowWeeks} week${windowWeeks === 1 ? "" : "s"}.`
        : `Based on ${counted.length} submitted person-week${counted.length === 1 ? "" : "s"} (${people.size} ${people.size === 1 ? "person" : "people"}, ${weeksCovered.size} of ${windowWeeks} weeks).${drafts.length ? ` ${drafts.length} draft week${drafts.length === 1 ? "" : "s"} excluded.` : ""}`;
    return {
      ok: true,
      data: {
        window: { weeks: windowWeeks, from: isoWeeks[isoWeeks.length - 1], to: isoWeeks[0] },
        weeksCovered: Array.from(weeksCovered).sort(),
        peopleCount: people.size,
        submittedPersonWeeks: counted.length,
        draftPersonWeeks: drafts.length,
        totalHours,
        billableHours,
        availableHours,
        utilizationPct: availableHours > 0 ? Math.round((billableHours / availableHours) * 1000) / 10 : null,
        billablePct: totalHours > 0 ? Math.round((billableHours / totalHours) * 1000) / 10 : null,
        basis: `billable ÷ available (${AVAILABLE_HOURS_PER_WEEK}h per person-week); submitted or approved weeks only`,
        note,
      },
    };
  },
});

// ---------------------------------------------------------------------
// utilization.person — entity_card
// ---------------------------------------------------------------------
defineCapability({
  id: "utilization.person",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "utilization_person",
  description:
    "Recent utilisation for one person across the last 8 timesheet weeks. Returns weekly billable/total hours and average billable %.",
  slashAliases: { en: ["/util-person", "/util"] },
  inputSchema: {
    type: "object",
    properties: { personId: { type: "string" } },
    required: ["personId"],
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["ledger", "roster"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show utilization for a specific person", "How's Sara's utilisation?"],
    ar: ["اعرض استخدام شخص"],
    fr: ["Utilisation de cette personne"],
  },
  async run(input, ctx) {
    const personId = String(input.personId ?? "").trim();
    if (!personId) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "personId required" };
    }
    const rows = await db
      .select({
        weekIso: atelierTimesheetWeeks.weekIso,
        total: atelierTimesheetWeeks.totalHours,
        billable: atelierTimesheetWeeks.billableHours,
        status: atelierTimesheetWeeks.status,
      })
      .from(atelierTimesheetWeeks)
      .where(
        and(
          eq(atelierTimesheetWeeks.orgId, ctx.persona.orgId),
          eq(atelierTimesheetWeeks.personId, personId),
          isNull(atelierTimesheetWeeks.deletedAt),
        ),
      )
      .orderBy(desc(atelierTimesheetWeeks.weekIso))
      .limit(8);
    const total = rows.reduce((a, r) => a + (r.total ?? 0), 0);
    const billable = rows.reduce((a, r) => a + (r.billable ?? 0), 0);
    return {
      ok: true,
      data: {
        personId,
        weeks: rows,
        averageBillablePct: total > 0 ? (billable / total) * 100 : 0,
      },
    };
  },
});

// ---------------------------------------------------------------------
// burn.engagement — time_series
// ---------------------------------------------------------------------
defineCapability({
  id: "burn.engagement",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "burn_vs_budget",
  description:
    "Burn (timesheet hours actually logged) vs budget for one engagement, broken down by ISO week. Returns week-by-week hours and a cumulative total.",
  slashAliases: { en: ["/burn", "/burn-vs-budget"] },
  inputSchema: {
    type: "object",
    properties: {
      engagementId: { type: "string" },
      engagementQuery: { type: "string" },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "ledger"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "time_series",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: [
      "Show burn versus budget for an engagement",
      "How is the DEWA engagement burning vs budget?",
      "Burn for the DEWA engagement",
    ],
    ar: ["اعرض الاستهلاك مقابل الموازنة لهذا الارتباط"],
    fr: ["Burn vs budget pour cette mission"],
  },
  async run(input, ctx) {
    let engagementId = String(input.engagementId ?? "").trim();
    if (!engagementId) {
      const q = String(input.engagementQuery ?? "").trim();
      if (q) {
        const r = await resolveEngagement(q, ctx.persona);
        if (r.kind === "match") engagementId = r.id;
        else if (r.kind === "choices") {
          return {
            ok: true,
            data: { prompt: r.prompt, options: r.options },
            disambiguation: { kind: "engagement", options: r.options },
          };
        } else {
          return { ok: false, errorCode: "not_found", errorMessage: `no engagement matched "${q}"` };
        }
      }
    }
    if (!engagementId) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "engagementId or engagementQuery required" };
    }
    if (!(await engAclOk(ctx.persona, engagementId))) {
      return denyForbidden(`engagement ${engagementId} is outside your access`);
    }
    const entries = await db
      .select({
        workDate: atelierTimesheetEntries.workDate,
        hours: atelierTimesheetEntries.hours,
        billable: atelierTimesheetEntries.billable,
      })
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.orgId, ctx.persona.orgId),
          eq(atelierTimesheetEntries.engagementId, engagementId),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      );
    // Bucket by ISO week (YYYY-Www) using Monday of the week.
    const buckets = new Map<string, { hours: number; billable: number }>();
    for (const e of entries) {
      const d = new Date(`${e.workDate}T00:00:00Z`);
      const day = d.getUTCDay() || 7;
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - (day - 1));
      const year = monday.getUTCFullYear();
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const jan4Day = jan4.getUTCDay() || 7;
      const week1Monday = new Date(jan4);
      week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
      const weekNum =
        Math.floor(
          (monday.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000),
        ) + 1;
      const key = `${year}-W${String(weekNum).padStart(2, "0")}`;
      const prev = buckets.get(key) ?? { hours: 0, billable: 0 };
      prev.hours += e.hours ?? 0;
      if (e.billable) prev.billable += e.hours ?? 0;
      buckets.set(key, prev);
    }
    const series = [...buckets.entries()]
      .map(([weekIso, v]) => ({ weekIso, ...v }))
      .sort((a, b) => a.weekIso.localeCompare(b.weekIso));
    let cumulative = 0;
    const cumulativeSeries = series.map((s) => {
      cumulative += s.hours;
      return { ...s, cumulativeHours: cumulative };
    });
    return {
      ok: true,
      data: {
        engagementId,
        series: cumulativeSeries,
        totalHours: cumulative,
      },
    };
  },
});

// ---------------------------------------------------------------------
// expense.aging — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "expense.aging",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "expense_aging",
  description:
    "List unresolved expenses (draft or submitted) older than a threshold (default 30 days), sorted by age.",
  slashAliases: { en: ["/expenses-aging", "/old-expenses"] },
  inputSchema: {
    type: "object",
    properties: {
      olderThanDays: { type: "integer", minimum: 1, maximum: 365 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["wallet", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show expenses aging over 30 days", "Old expenses still open"],
    ar: ["اعرض النفقات المتقادمة أكثر من 30 يومًا"],
    fr: ["Dépenses en attente depuis plus de 30 jours"],
  },
  async run(input, ctx) {
    const days = Math.max(1, Math.min(365, Number(input.olderThanDays ?? 30)));
    const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20)));
    const cutoff = daysAgo(days);
    const rows = await db
      .select({
        id: atelierExpenses.id,
        personId: atelierExpenses.personId,
        engagementId: atelierExpenses.engagementId,
        merchant: atelierExpenses.merchant,
        amount: atelierExpenses.amount,
        currency: atelierExpenses.currency,
        usdAmount: atelierExpenses.usdAmount,
        status: atelierExpenses.status,
        policyStatus: atelierExpenses.policyStatus,
        expenseDate: atelierExpenses.expenseDate,
        createdAt: atelierExpenses.createdAt,
      })
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.orgId, ctx.persona.orgId),
          inArray(atelierExpenses.status, ["draft", "submitted"]),
          lte(atelierExpenses.createdAt, cutoff),
          isNull(atelierExpenses.deletedAt),
        ),
      )
      .orderBy(atelierExpenses.createdAt)
      .limit(limit);
    return {
      ok: true,
      data: {
        olderThanDays: days,
        items: rows.map((r) => ({
          id: r.id,
          label: `${r.merchant ?? "expense"} · ${r.currency} ${r.amount}`,
          status: r.status,
          policyStatus: r.policyStatus,
          ageDays: Math.floor(
            (Date.now() - r.createdAt.getTime()) / (24 * 60 * 60 * 1000),
          ),
          usdAmount: r.usdAmount,
          href: `/wallet/expenses/${r.id}`,
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// wallet.policy_violations — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "wallet.policy_violations",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_policy_violations",
  description:
    "List recent expenses flagged by the policy engine (amber/red), most recent first.",
  slashAliases: { en: ["/policy-violations", "/expense-flags"] },
  inputSchema: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["wallet"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Flag any expense over policy", "Show policy violations on expenses"],
    ar: ["اعرض النفقات الخارجة عن السياسة"],
    fr: ["Dépenses hors-politique"],
  },
  async run(input, ctx) {
    const limit = Math.max(1, Math.min(100, Number(input.limit ?? 25)));
    const rows = await db
      .select({
        id: atelierExpenses.id,
        merchant: atelierExpenses.merchant,
        amount: atelierExpenses.amount,
        currency: atelierExpenses.currency,
        policyStatus: atelierExpenses.policyStatus,
        policyFindings: atelierExpenses.policyFindings,
        createdAt: atelierExpenses.createdAt,
      })
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.orgId, ctx.persona.orgId),
          inArray(atelierExpenses.policyStatus, ["amber", "red"]),
          isNull(atelierExpenses.deletedAt),
        ),
      )
      .orderBy(desc(atelierExpenses.createdAt))
      .limit(limit);
    return {
      ok: true,
      data: {
        items: rows.map((r) => ({
          id: r.id,
          label: `${r.merchant ?? "expense"} · ${r.currency} ${r.amount}`,
          policyStatus: r.policyStatus,
          findings: r.policyFindings ?? [],
          href: `/wallet/expenses/${r.id}`,
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// account.dossier — entity_card
// ---------------------------------------------------------------------
defineCapability({
  id: "account.dossier",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_dossier",
  description:
    "Snapshot of one account: identity (name/country/sector), firmographics (employees, entity role, multi-country footprint, holding / multi-brand structure, annual revenue), contact count, open opportunity count, and active engagement count.",
  slashAliases: { en: ["/dossier", "/account-summary"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      accountQuery: { type: "string" },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["account_workspace"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Summarize the Tasama dossier", "Show me the dossier for Acme"],
    ar: ["لخّص ملف الحساب لشركة Tasama"],
    fr: ["Résumé du dossier Tasama"],
  },
  async run(input, ctx) {
    let accountId = String(input.accountId ?? "").trim();
    if (!accountId) {
      const q = String(input.accountQuery ?? "").trim();
      if (!q) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "accountId or accountQuery required" };
      }
      const r = await resolveAccount(q, ctx.persona);
      if (r.kind === "match") accountId = r.id;
      else if (r.kind === "choices") {
        return {
          ok: true,
          data: { prompt: r.prompt, options: r.options },
          disambiguation: { kind: "account", options: r.options },
        };
      } else {
        return { ok: false, errorCode: "not_found", errorMessage: "no account matched" };
      }
    }
    const dossier = await readAccountDossier({
      accountId,
      persona: ctx.persona,
    });
    if (dossier.kind === "invalid_input") {
      return { ok: false, errorCode: "invalid_input", errorMessage: "accountId required" };
    }
    if (dossier.kind === "forbidden" || dossier.kind === "not_found") {
      return { ok: false, errorCode: "not_found", errorMessage: `account ${accountId} not found` };
    }
    const { account: acc, contacts, opportunities: opps, engagements: engs } =
      dossier.workspace;

    const ENTITY_ROLE_LABELS: Record<string, string> = {
      hq: "Global HQ",
      subsidiary: "Subsidiary",
      branch: "Branch",
      office: "Office",
    };
    const rev = acc.annualRevenue ?? null;
    const fmtRevenue = (r: NonNullable<typeof rev>): string | null => {
      if (r.amount == null) return null;
      const n = r.amount;
      const abs = Math.abs(n);
      let body: string;
      if (abs >= 1_000_000_000) body = `${(n / 1_000_000_000).toFixed(1)}B`;
      else if (abs >= 1_000_000) body = `${(n / 1_000_000).toFixed(1)}M`;
      else if (abs >= 1_000) body = `${(n / 1_000).toFixed(0)}K`;
      else body = `${Math.round(n)}`;
      const ccy = r.currency ? `${r.currency} ` : "";
      const asOf = r.asOf ? ` (${r.asOf})` : "";
      return `${ccy}${body}${asOf}`;
    };
    const annualRevenue = rev && rev.amount != null
      ? fmtRevenue(rev)
      : acc.annualRevenueRedacted
        ? "Restricted"
        : null;
    const holding = acc.holdingStructure ?? null;
    const structureFlags: string[] = [];
    if (holding?.isHoldingCompany) structureFlags.push("Holding company");
    if (holding?.isMultiBrand) structureFlags.push("Multi-brand");
    const countriesPresent = (acc.countryPresence ?? []).length;

    return {
      ok: true,
      data: {
        id: acc.id,
        name: acc.name,
        country: acc.country,
        sector: acc.sector,
        href: `/accounts/${acc.id}`,
        // Task #614 — firmographic block (nullable fields are omitted by the
        // entity_card renderer, so no fabricated zeros).
        employeeCount: acc.employeeCount ?? null,
        annualRevenue,
        entityRole: acc.entityRole
          ? ENTITY_ROLE_LABELS[acc.entityRole] ?? acc.entityRole
          : null,
        countriesPresent: countriesPresent > 0 ? countriesPresent : null,
        structure:
          structureFlags.length > 0 ? structureFlags.join(" · ") : null,
        contactCount: contacts.length,
        openOpportunityCount: opps.filter(
          (o) => !["contract", "lost", "no_decision", "withdrawn"].includes(o.salesStage),
        ).length,
        activeEngagementCount: engs.filter((e) => e.status !== "closed").length,
        // Task #499 — dossier resolves a single account; navigate the
        // user to the account workspace alongside the summary card.
        navigateTo: { path: `/accounts/${acc.id}`, when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// account.procurement — entity_card (Task #733)
// ---------------------------------------------------------------------
// "How do we register with X's procurement?" — surfaces the account's
// procurement registration status, channel/portal and the approved
// Procurement Navigator guide (step summary + source links). Read-only,
// gated on the same canSeeAccount perimeter as the REST account reads;
// me-lens personas never reach it (they get me.* tools only).
defineCapability({
  id: "account.procurement",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_procurement",
  description:
    "Procurement / vendor-registration guide for one account: registration status, procurement channel or portal (e.g. Etimad, Ariba, Coupa), step-by-step registration summary, required documents, fees, timeline, renewal and source links.",
  slashAliases: { en: ["/procurement", "/vendor-registration"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      accountQuery: { type: "string" },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["account_workspace"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: [
      "How do we register with DEWA's procurement?",
      "What's the vendor registration process for Acme?",
      "Are we registered as a supplier with Tasama?",
    ],
    ar: ["كيف نسجّل كمورّد لدى Acme؟"],
    fr: ["Comment s'enregistrer auprès des achats de Acme ?"],
  },
  async run(input, ctx) {
    let accountId = String(input.accountId ?? "").trim();
    if (!accountId) {
      const q = String(input.accountQuery ?? "").trim();
      if (!q) {
        return { ok: false, errorCode: "invalid_input", errorMessage: "accountId or accountQuery required" };
      }
      const r = await resolveAccount(q, ctx.persona);
      if (r.kind === "match") accountId = r.id;
      else if (r.kind === "choices") {
        return {
          ok: true,
          data: { prompt: r.prompt, options: r.options },
          disambiguation: { kind: "account", options: r.options },
        };
      } else {
        return { ok: false, errorCode: "not_found", errorMessage: "no account matched" };
      }
    }
    const [acc] = await db
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, accountId),
          eq(atelierAccounts.orgId, ctx.persona.orgId),
          isNull(atelierAccounts.deletedAt),
        ),
      )
      .limit(1);
    if (!acc) {
      return { ok: false, errorCode: "not_found", errorMessage: `account ${accountId} not found` };
    }
    // Same perimeter as the REST account reads: engagement grants,
    // partner-owner, or firm-wide access — otherwise the persona must not
    // learn anything about this account (including its existence beyond
    // the resolver match, so deny explicitly).
    const acl = await accessibleEngagementIds({
      id: ctx.persona.id,
      role: ctx.persona.role,
    } as Parameters<typeof accessibleEngagementIds>[0]);
    if (!(await canSeeAccount(acl, { id: ctx.persona.id }, acc.id))) {
      return denyForbidden("You don't have access to this account.");
    }
    const proc = acc.procurement ?? null;
    const guide = proc?.guide ?? null;
    const href = `/accounts/${acc.id}?tab=procurement`;
    const STATUS_LABELS: Record<string, string> = {
      not_registered: "Not registered",
      in_progress: "Registration in progress",
      registered: "Registered",
      renewal_due: "Renewal due",
    };
    const status = proc?.status ?? "not_registered";
    return {
      ok: true,
      data: {
        accountId: acc.id,
        accountName: acc.name,
        href,
        status,
        statusLabel: STATUS_LABELS[status] ?? status,
        statusNotes: proc?.statusNotes ?? null,
        statusUpdatedAt: proc?.statusUpdatedAt ?? null,
        lastResearchedAt: proc?.lastResearchedAt ?? null,
        hasGuide: !!guide,
        // No approved guide yet — status only; the model should say the
        // registration guide hasn't been researched/approved for this
        // account and point at the Procurement tab.
        ...(guide
          ? {
              jurisdiction: guide.jurisdiction ?? null,
              summary: guide.summary ?? null,
              channel: guide.channel
                ? {
                    name: guide.channel.name ?? null,
                    type: guide.channel.type ?? null,
                    portalUrl: guide.channel.portalUrl ?? null,
                  }
                : null,
              steps: (guide.steps ?? [])
                .slice()
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((s) => ({
                  order: s.order,
                  title: s.title,
                  detail: s.detail,
                  sourceUrls: s.sourceUrls ?? [],
                })),
              requiredInformation: guide.requiredInformation ?? [],
              requiredDocuments: guide.requiredDocuments ?? [],
              fees: guide.fees ?? null,
              timeline: guide.timeline ?? null,
              renewal: guide.renewal ?? null,
              sources: (guide.sources ?? []).map((s) => ({
                url: s.url,
                title: s.title ?? null,
              })),
              confidence: guide.confidence ?? null,
            }
          : {}),
        navigateTo: { path: href, when: "on_commit" as const },
      },
    };
  },
});

// ---------------------------------------------------------------------
// account.changes — audit_timeline
// ---------------------------------------------------------------------
defineCapability({
  id: "account.changes",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "account_changes",
  description:
    "Audit timeline for one account: every recorded action (cartographer, profile-update decisions, contact disposition, etc.) since N days ago.",
  slashAliases: { en: ["/account-changes", "/changed-on"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" },
      accountQuery: { type: "string" },
      sinceDays: { type: "integer", minimum: 1, maximum: 365 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["account_workspace"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "audit_timeline",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["What changed on Acme this week?", "Show recent changes for the Tasama account"],
    ar: ["ماذا تغيّر على حساب Acme هذا الأسبوع؟"],
    fr: ["Qu'est-ce qui a changé sur Acme cette semaine ?"],
  },
  async run(input, ctx) {
    let accountId = String(input.accountId ?? "").trim();
    if (!accountId) {
      const q = String(input.accountQuery ?? "").trim();
      if (q) {
        const r = await resolveAccount(q, ctx.persona);
        if (r.kind === "match") accountId = r.id;
        else if (r.kind === "choices") {
          return {
            ok: true,
            data: { prompt: r.prompt, options: r.options },
            disambiguation: { kind: "account", options: r.options },
          };
        }
      }
    }
    if (!accountId) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "accountId or accountQuery required" };
    }
    const sinceDays = Math.max(1, Math.min(365, Number(input.sinceDays ?? 7)));
    const limit = Math.max(1, Math.min(200, Number(input.limit ?? 50)));
    const cutoff = daysAgo(sinceDays);
    const rows = await db
      .select({
        id: atelierAuditEvents.id,
        action: atelierAuditEvents.action,
        actorLabel: atelierAuditEvents.actorLabel,
        actorType: atelierAuditEvents.actorType,
        payloadSummary: atelierAuditEvents.payloadSummary,
        ts: atelierAuditEvents.ts,
        entityType: atelierAuditEvents.entityType,
        entityId: atelierAuditEvents.entityId,
      })
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.orgId, ctx.persona.orgId),
          eq(atelierAuditEvents.entityType, "account"),
          eq(atelierAuditEvents.entityId, accountId),
          gte(atelierAuditEvents.ts, cutoff),
          isNull(atelierAuditEvents.deletedAt),
        ),
      )
      .orderBy(desc(atelierAuditEvents.ts))
      .limit(limit);
    return {
      ok: true,
      data: {
        accountId,
        sinceDays,
        events: rows.map((r) => ({
          id: r.id,
          ts: r.ts.toISOString(),
          actor: r.actorLabel,
          actorType: r.actorType,
          action: r.action,
          summary: r.payloadSummary,
        })),
      },
    };
  },
});

// ---------------------------------------------------------------------
// agent.runs_status — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "agent.runs_status",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "agent",
  toolName: "agent_runs_status",
  description:
    "List recent agent runs filtered by status (running|blocked|complete|error) and optionally by agentId, most recent first.",
  slashAliases: { en: ["/agent-runs", "/runs"] },
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string" },
      agentId: { type: "string" },
      sinceDays: { type: "integer", minimum: 1, maximum: 90 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  requiredRoles: [...AGENT_OPERATIONS_ROLES],
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show agent runs that failed yesterday", "Any blocked agent runs?"],
    ar: ["اعرض تنفيذات الوكلاء التي فشلت أمس"],
    fr: ["Runs d'agent en échec hier"],
  },
  async run(input, ctx) {
    if (!canInspectAgentOperations(ctx.persona.role)) {
      return denyForbidden("Agent operations are available to firm leaders and senior managers.");
    }
    const status = String(input.status ?? "").trim().toLowerCase();
    const agentId = String(input.agentId ?? "").trim();
    const sinceDays = Math.max(1, Math.min(90, Number(input.sinceDays ?? 7)));
    const limit = Math.max(1, Math.min(100, Number(input.limit ?? 25)));
    const where = [
      eq(atelierAgentRuns.orgId, ctx.persona.orgId),
      gte(atelierAgentRuns.createdAt, daysAgo(sinceDays)),
      isNull(atelierAgentRuns.deletedAt),
    ];
    if (status) {
      where.push(eq(atelierAgentRuns.status, status));
      // Task #1046 — asking for "running" must not surface heartbeat-dead rows.
      if (status === "running") where.push(agentRunIsFresh());
    }
    if (agentId) where.push(eq(atelierAgentRuns.agentId, agentId));
    // Fetch beyond the public limit because target ACL is applied before
    // labels and counts become observable.  The DB org predicate remains the
    // first boundary; canonical target authorization is the second.
    const candidates = await db
      .select()
      .from(atelierAgentRuns)
      .where(and(...where))
      .orderBy(desc(atelierAgentRuns.createdAt))
      .limit(Math.min(500, limit * 5));
    const rows = [];
    for (const row of candidates) {
      if (!reviewedSpecialistEntry(row.agentId)) continue;
      if (await canAccessAgentRunTarget(
        ctx.persona as Parameters<typeof canAccessAgentRunTarget>[0],
        row,
      )) {
        rows.push(row);
        if (rows.length === limit) break;
      }
    }
    return {
      ok: true,
      data: {
        items: rows.map((r) => ({
          id: r.id,
          recordType: "specialist_agent_run",
          label: `${r.agentId} · ${r.targetLabel ?? r.targetType ?? "—"}`,
          // Task #1046 — stale "running" rows (dead process) render as error.
          status: effectiveAgentRunStatus(r),
          confidence: r.confidence,
          message: r.statusMessage,
          startedAt: r.createdAt.toISOString(),
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// agent.operational_lookup — capability_list
// ---------------------------------------------------------------------
defineCapability({
  id: "agent.operational_lookup",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "agent",
  toolName: "agent_operational_lookup",
  description:
    "Identify reviewed capabilities or specialist agents that handle a task. This is descriptive and cannot launch an agent.",
  slashAliases: { en: ["/agent-capability", "/who-handles"] },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 2, maxLength: 200 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["query"],
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "capability_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Which capability handles proposal drafting?", "Who handles meeting transcripts?"],
    ar: ["ما القدرة التي تتعامل مع مسودات العروض؟"],
    fr: ["Quelle capacité gère les comptes rendus de réunion ?"],
  },
  async run(input, ctx) {
    const query = String(input.query ?? "").trim().toLowerCase();
    if (query.length < 2) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "query is required" };
    }
    const limit = Math.max(1, Math.min(20, Number(input.limit ?? 8)));
    const terms = query.split(/\s+/).filter((term) => term.length > 1);
    const score = (values: Array<string | null | undefined>) => {
      const haystack = values.filter(Boolean).join(" ").toLowerCase();
      if (haystack.includes(query)) return 100 + query.length;
      return terms.reduce((total, term) => total + (haystack.includes(term) ? 10 + term.length : 0), 0);
    };

    // Effective roles come from the live catalogue gate, but every returned
    // contract is projected from the reviewed manifest.  A graph/RAG hit can
    // therefore describe a capability but cannot grant or dispatch it.
    const authorizedIds = new Set(
      capabilitiesForPersona(ctx.persona).map((entry) => entry.id),
    );
    const capabilityMatches = reviewedCapabilityManifestDocument().entries
      .filter((entry) => authorizedIds.has(entry.capabilityId))
      .map((entry) => ({
        entry,
        score: score([entry.capabilityId, entry.toolName, entry.policyClass, entry.effectClass]),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.capabilityId.localeCompare(b.entry.capabilityId))
      .slice(0, limit)
      .map(({ entry }) => ({
        recordType: "riser_capability" as const,
        capabilityId: entry.capabilityId,
        toolName: entry.toolName,
        effect: entry.effect,
        executionStatus: entry.executionStatus,
        policyClass: entry.policyClass,
        confirmation: entry.confirmation,
        implementationVersion: entry.implementationVersion,
        inputSchemaVersion: entry.inputSchemaVersion,
        inputSchemaHash: entry.inputSchemaHash,
        resultSchemaHash: entry.resultSchemaHash,
        manifestVersion: reviewedCapabilityManifestDocument().manifestVersion,
        authorizedForCurrentRole: true,
      }));

    const agentMatches = reviewedAgentManifest.entries
      // Only reviewed executable/advisory specialists may be described as
      // operational handlers. Unsupported placeholders and utility
      // guardrails are manifest evidence, not agents that handle user work.
      .filter((entry) =>
        entry.id === "ag_riser_orchestrator" ||
        entry.classification === "executable" ||
        entry.classification === "advisory")
      .map((entry) => ({
        entry,
        score: score([
          entry.id,
          entry.name,
          ...entry.aliases,
          entry.classification,
          entry.operationalStatus,
        ]),
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
      .slice(0, limit)
      .map(({ entry }) => {
        const runtime = entry.registryId ? getAgent(entry.registryId) : undefined;
        return {
          recordType: entry.id === "ag_riser_orchestrator"
            ? "riser_orchestrator" as const
            : "specialist_agent" as const,
          agentId: entry.id,
          name: entry.name,
          purpose: runtime?.purpose ?? null,
          classification: entry.classification,
          operationalStatus: entry.operationalStatus,
          registryBacked: !!runtime,
          capabilityType: runtime?.capabilityType ?? "generic",
          operationalHref: runtime?.operationalHref ?? null,
          promptRef: entry.promptRef,
          promptHash: entry.promptHash,
          inputSchemaHash: entry.inputSchemaHash,
          outputSchemaHash: entry.outputSchemaHash,
          manifestVersion: reviewedAgentManifest.manifestVersion,
          // This lookup never claims route-level launch authorization. The
          // owned route must re-check role, target, policy and confirmation.
          launchAuthority: "owned_route_only" as const,
        };
      });

    return {
      ok: true,
      data: {
        query,
        capabilities: capabilityMatches,
        agents: agentMatches,
        authority: {
          source: "reviewed_runtime_manifests",
          retrievalCanExecute: false,
          retrievalCanWidenPolicy: false,
        },
      },
    };
  },
});

// ---------------------------------------------------------------------
// agent.run_evidence — agent_run
// ---------------------------------------------------------------------
defineCapability({
  id: "agent.run_evidence",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "agent",
  toolName: "agent_run_evidence",
  description:
    "Inspect evidence, decisions, outcomes and immutable provenance for one authorized specialist-agent run.",
  slashAliases: { en: ["/agent-run-evidence", "/run-evidence"] },
  inputSchema: {
    type: "object",
    properties: {
      runId: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["runId"],
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "agent_run",
  requiredRoles: [...AGENT_OPERATIONS_ROLES],
  promoteAsSuggestion: false,
  examplePhrases: {
    en: ["Show evidence for agent run run_123", "Why did this specialist run reach its outcome?"],
    ar: ["اعرض أدلة تنفيذ الوكيل"],
    fr: ["Afficher les preuves de cette exécution d'agent"],
  },
  async run(input, ctx) {
    if (!canInspectAgentOperations(ctx.persona.role)) {
      return denyForbidden("Agent run evidence is available to firm leaders and senior managers.");
    }
    const runId = String(input.runId ?? "").trim();
    if (!runId) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "runId is required" };
    }
    const [run] = await db.select().from(atelierAgentRuns).where(and(
      eq(atelierAgentRuns.id, runId),
      eq(atelierAgentRuns.orgId, ctx.persona.orgId),
      isNull(atelierAgentRuns.deletedAt),
    )).limit(1);
    const reviewed = run ? reviewedSpecialistEntry(run.agentId) : undefined;
    if (!run || !reviewed || !(await canAccessAgentRunTarget(
      ctx.persona as Parameters<typeof canAccessAgentRunTarget>[0],
      run,
    ))) {
      // Deliberately indistinguishable: callers cannot enumerate foreign or
      // target-inaccessible run IDs.
      return { ok: false, errorCode: "not_found", errorMessage: "run not found" };
    }

    const [[snapshot], outcomes] = await Promise.all([
      db.select().from(atelierAgentRunSnapshots).where(and(
        eq(atelierAgentRunSnapshots.runId, run.id),
        eq(atelierAgentRunSnapshots.orgId, ctx.persona.orgId),
      )).limit(1),
      db.select({
        id: atelierAgentOutcomeEvents.id,
        occurredAt: atelierAgentOutcomeEvents.occurredAt,
        outcomeKind: atelierAgentOutcomeEvents.outcomeKind,
        outcomeStatus: atelierAgentOutcomeEvents.outcomeStatus,
        priorState: atelierAgentOutcomeEvents.priorState,
        currentState: atelierAgentOutcomeEvents.currentState,
        supersedesEventId: atelierAgentOutcomeEvents.supersedesEventId,
        missingLinks: atelierAgentOutcomeEvents.missingLinks,
        dataQualityFlags: atelierAgentOutcomeEvents.dataQualityFlags,
        metadata: atelierAgentOutcomeEvents.metadata,
      }).from(atelierAgentOutcomeEvents).where(and(
        eq(atelierAgentOutcomeEvents.runId, run.id),
        eq(atelierAgentOutcomeEvents.orgId, ctx.persona.orgId),
      )).orderBy(desc(atelierAgentOutcomeEvents.occurredAt)),
    ]);
    const runtime = getAgent(run.agentId);
    const toolCalls = Array.isArray(run.toolCalls)
      ? run.toolCalls.map((raw) => {
        const call = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        return {
          id: typeof call.id === "string" ? call.id : null,
          tool: typeof call.tool === "string" ? call.tool : "unknown",
          startedAt: typeof call.startedAt === "string" ? call.startedAt : null,
          endedAt: typeof call.endedAt === "string" ? call.endedAt : null,
          succeeded: !call.error,
          error: typeof call.error === "string" ? call.error : null,
        };
      })
      : [];

    return {
      ok: true,
      data: {
        recordType: "specialist_agent_run",
        run: {
          id: run.id,
          agentId: runtime?.id ?? run.agentId,
          status: effectiveAgentRunStatus(run),
          statusMessage: run.statusMessage,
          progressPct: run.progressPct,
          confidence: run.confidence,
          targetType: run.targetType,
          targetId: run.targetId,
          targetLabel: run.targetLabel,
          createdAt: run.createdAt.toISOString(),
          updatedAt: run.updatedAt.toISOString(),
          costUsd: run.costUsd,
          durationMs: run.durationMs,
        },
        identity: {
          name: runtime?.name ?? reviewed?.name ?? run.agentId,
          purpose: runtime?.purpose ?? null,
          registryBacked: !!runtime,
          classification: reviewed?.classification ?? null,
          operationalStatus: reviewed?.operationalStatus ?? null,
        },
        evidence: {
          output: run.output,
          steps: Array.isArray(run.steps) ? run.steps : [],
          toolCalls,
          sourcesCount: run.sourcesCount,
        },
        decisions: Array.isArray(run.humanDecisions) ? run.humanDecisions : [],
        outcomes: outcomes.map((outcome) => ({
          ...outcome,
          occurredAt: outcome.occurredAt.toISOString(),
        })),
        provenance: snapshot ? {
          agentVersion: snapshot.agentVersion,
          registryVersion: snapshot.registryVersion,
          promptVersion: snapshot.promptVersion,
          promptHash: snapshot.promptHash,
          model: snapshot.model,
          entryPath: snapshot.entryPath,
          dataQualityFlags: snapshot.dataQualityFlags,
          recordedAt: snapshot.recordedAt.toISOString(),
        } : {
          agentVersion: "unknown",
          registryVersion: "unknown",
          promptVersion: "unknown",
          promptHash: null,
          model: "unknown",
          entryPath: "unknown",
          dataQualityFlags: ["run-snapshot-missing"],
          recordedAt: null,
        },
        activityNamespace: {
          kind: "specialist_agent_run",
          riserTurnId: null,
          riserActionId: null,
          metrics: "agent_run_only",
        },
      },
    };
  },
});

// ---------------------------------------------------------------------
// raid.open — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "raid.open",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "raid",
  toolName: "raid_open_list",
  description:
    "List open RAID items, optionally scoped to one engagement. Sorted by severity (red first) then most recent.",
  slashAliases: { en: ["/raid-open", "/open-raid", "/raid-list"] },
  inputSchema: {
    type: "object",
    properties: {
      engagementId: { type: "string" },
      engagementQuery: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["engagement_dashboard", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show open RAID on Riyadh Metro", "List my open RAID items"],
    ar: ["اعرض بنود RAID المفتوحة"],
    fr: ["RAID ouverts sur cette mission"],
  },
  async run(input, ctx) {
    let engagementId = String(input.engagementId ?? "").trim();
    if (!engagementId) {
      const q = String(input.engagementQuery ?? "").trim();
      if (q) {
        const r = await resolveEngagement(q, ctx.persona);
        if (r.kind === "match") engagementId = r.id;
        else if (r.kind === "choices") {
          return {
            ok: true,
            data: { prompt: r.prompt, options: r.options },
            disambiguation: { kind: "engagement", options: r.options },
          };
        }
      }
    }
    const limit = Math.max(1, Math.min(100, Number(input.limit ?? 25)));
    const acl = await accessibleEngagementIds({
      id: ctx.persona.id,
      role: ctx.persona.role,
    } as Parameters<typeof accessibleEngagementIds>[0]);
    const where = [
      eq(atelierRaidItems.orgId, ctx.persona.orgId),
      eq(atelierRaidItems.status, "open"),
      isNull(atelierRaidItems.deletedAt),
    ];
    if (engagementId) {
      if (acl.all !== true && !acl.ids.has(engagementId)) {
        return denyForbidden(`engagement ${engagementId} is outside your access`);
      }
      where.push(eq(atelierRaidItems.engagementId, engagementId));
    }
    const rows = await db
      .select({
        id: atelierRaidItems.id,
        engagementId: atelierRaidItems.engagementId,
        kind: atelierRaidItems.kind,
        severity: atelierRaidItems.severity,
        description: atelierRaidItems.description,
        dueDate: atelierRaidItems.dueDate,
        createdAt: atelierRaidItems.createdAt,
      })
      .from(atelierRaidItems)
      .where(and(...where))
      .orderBy(desc(atelierRaidItems.createdAt))
      .limit(limit * 2);
    const visible = engagementId
      ? rows
      : rows.filter((r) => acl.all === true || acl.ids.has(r.engagementId));
    const sevRank = (s: string): number =>
      s === "red" ? 0 : s === "amber" ? 1 : 2;
    visible.sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
    return {
      ok: true,
      data: {
        items: visible.slice(0, limit).map((r) => ({
          id: r.id,
          label: r.description.slice(0, 120),
          kind: r.kind,
          severity: r.severity,
          engagementId: r.engagementId,
          dueDate: r.dueDate,
          href: `/engagements/${r.engagementId}`,
        })),
        total: visible.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// approval.queue — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "approval.queue",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "approval_queue",
  description:
    "Timesheet weeks waiting for the current persona's approval (lead vs partner stage), most recent first.",
  slashAliases: { en: ["/approvals", "/queue"] },
  inputSchema: { type: "object", properties: {} },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["ledger", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my approval queue", "What needs my sign-off?"],
    ar: ["اعرض قائمة الموافقات"],
    fr: ["Mon file d'approbations"],
  },
  async run(_input, ctx) {
    const role = ctx.persona.role;
    const stage =
      role === "senior_manager" || role === "finance"
        ? "submitted"
        : role === "partner" || role === "founding_partner"
          ? "lead_approved"
          : null;
    if (!stage) {
      return { ok: true, data: { stage: null, items: [], total: 0 } };
    }
    const rows = await db
      .select({
        id: atelierTimesheetWeeks.id,
        personId: atelierTimesheetWeeks.personId,
        weekIso: atelierTimesheetWeeks.weekIso,
        totalHours: atelierTimesheetWeeks.totalHours,
        billableHours: atelierTimesheetWeeks.billableHours,
        submittedAt: atelierTimesheetWeeks.submittedAt,
        suspiciousFlags: atelierTimesheetWeeks.suspiciousFlags,
      })
      .from(atelierTimesheetWeeks)
      .where(
        and(
          eq(atelierTimesheetWeeks.orgId, ctx.persona.orgId),
          eq(atelierTimesheetWeeks.status, stage),
          isNull(atelierTimesheetWeeks.deletedAt),
        ),
      )
      .orderBy(desc(atelierTimesheetWeeks.submittedAt))
      .limit(50);
    return {
      ok: true,
      data: {
        stage,
        items: rows.map((r) => ({
          id: r.id,
          label: `${r.personId} · ${r.weekIso}`,
          totalHours: r.totalHours,
          billableHours: r.billableHours,
          flags: r.suspiciousFlags ?? [],
          submittedAt: r.submittedAt?.toISOString() ?? null,
        })),
        total: rows.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// forecast.summary — kpi_strip
// ---------------------------------------------------------------------
defineCapability({
  id: "forecast.summary",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "forecast_summary",
  description:
    "Weighted-pipeline forecast: total weighted USD across open stages, plus best-case (sum of deal size at probability ≥50%).",
  slashAliases: { en: ["/forecast"] },
  inputSchema: { type: "object", properties: {} },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home", "opportunity_workspace"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "kpi_strip",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show pipeline forecast", "What's our weighted forecast right now?"],
    ar: ["اعرض توقعات خط الفرص"],
    fr: ["Forecast pondéré du pipeline"],
  },
  async run(_input, ctx) {
    const opps = await db
      .select({
        salesStage: atelierOpportunities.salesStage,
        deal: atelierOpportunities.dealSizeHypothesis,
        prob: atelierOpportunities.probabilityPct,
      })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.orgId, ctx.persona.orgId),
          isNull(atelierOpportunities.deletedAt),
        ),
      );
    const open = opps.filter((o) => !["contract", "lost", "no_decision", "withdrawn"].includes(o.salesStage));
    const weighted = open.reduce((a, o) => a + (o.deal * o.prob) / 100, 0);
    const bestCase = open.filter((o) => o.prob >= 50).reduce((a, o) => a + o.deal, 0);
    return {
      ok: true,
      data: {
        openCount: open.length,
        weightedValueUsd: weighted,
        bestCaseUsd: bestCase,
      },
    };
  },
});

// ---------------------------------------------------------------------
// roster.compliance_due — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "roster.compliance_due",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "roster_compliance_due",
  description:
    "Compliance records (visa, certifications, master agreements) expiring within N days (default 90).",
  slashAliases: { en: ["/compliance-due", "/expiring"] },
  inputSchema: {
    type: "object",
    properties: {
      withinDays: { type: "integer", minimum: 1, maximum: 365 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["roster", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show people whose certifications expire in 90 days", "Compliance records expiring soon"],
    ar: ["اعرض الأشخاص الذين تنتهي شهاداتهم خلال 90 يومًا"],
    fr: ["Conformité expirant sous 90 jours"],
  },
  async run(input, ctx) {
    const within = Math.max(1, Math.min(365, Number(input.withinDays ?? 90)));
    const limit = Math.max(1, Math.min(200, Number(input.limit ?? 50)));
    const horizon = new Date(Date.now() + within * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select({
        id: atelierComplianceRecords.id,
        personId: atelierComplianceRecords.personId,
        kind: atelierComplianceRecords.kind,
        jurisdiction: atelierComplianceRecords.jurisdiction,
        expiryDate: atelierComplianceRecords.expiryDate,
        status: atelierComplianceRecords.status,
      })
      .from(atelierComplianceRecords)
      .where(
        and(
          eq(atelierComplianceRecords.orgId, ctx.persona.orgId),
          isNull(atelierComplianceRecords.deletedAt),
        ),
      )
      .limit(500);
    const visible = rows
      .filter(
        (r) => r.expiryDate && r.expiryDate >= today && r.expiryDate <= horizon,
      )
      .sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""))
      .slice(0, limit);
    return {
      ok: true,
      data: {
        withinDays: within,
        items: visible.map((r) => ({
          id: r.id,
          label: `${r.kind} · ${r.personId ?? "entity"}`,
          jurisdiction: r.jurisdiction,
          expiryDate: r.expiryDate,
          status: r.status,
        })),
        total: visible.length,
      },
    };
  },
});

// ---------------------------------------------------------------------
// timesheet.current — entity_card
// ---------------------------------------------------------------------
defineCapability({
  id: "timesheet.current",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "timesheet_current",
  description:
    "Timesheet week for the calling persona — the current week by default, or a past week via date (any YYYY-MM-DD inside it; the server derives the ISO week) or weekIso (YYYY-Www). Returns status, total hours, billable hours, entries and any suspicious-flag signals.",
  slashAliases: { en: ["/my-timesheet", "/timesheet"] },
  inputSchema: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "Any ISO date (YYYY-MM-DD) inside the week to show; server derives the ISO week.",
      },
      weekIso: { type: "string", description: "Exact ISO week like 2026-W12 (default: current week)." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["ledger"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my timesheet for this week", "What's my current timesheet?"],
    ar: ["اعرض جدول زمني لهذا الأسبوع"],
    fr: ["Mon timesheet de cette semaine"],
  },
  async run(input, ctx) {
    // Task #421 fix: timesheet weeks key on the ROSTER person id, not
    // ctx.persona.id (the atelier_users id — the legacy keying matched
    // nothing). Resolve the caller's own roster row first.
    const [user] = await db
      .select()
      .from(atelierUsers)
      .where(
        and(eq(atelierUsers.id, ctx.persona.id), eq(atelierUsers.orgId, ctx.persona.orgId)),
      );
    const person = user ? await resolveSelfPerson(user) : null;
    if (!person) {
      return {
        ok: true,
        data: {
          id: null,
          label: "No timesheet",
          weekIso: null,
          status: "none",
          note: "Your login is not linked to an employee or contractor record.",
        },
      };
    }
    // Task #415 fix: target the ACTUAL current ISO week (the previous
    // "latest row" query could surface an old or future week) and
    // include the week's entries so "show my timesheet for today" is
    // answerable. Task #788: optional date/weekIso resolve a PAST week
    // server-side — the model never computes ISO weeks itself.
    const dateRaw = typeof (input as any)?.date === "string" ? String((input as any).date).trim() : "";
    const weekIsoRaw =
      typeof (input as any)?.weekIso === "string" ? String((input as any).weekIso).trim().toUpperCase() : "";
    let currentWeekIso: string;
    if (weekIsoRaw) {
      if (!isValidIsoWeek(weekIsoRaw)) {
        return {
          ok: false,
          errorCode: "invalid_body",
          errorMessage: `weekIso must be a real ISO week like 2026-W12 (got "${weekIsoRaw}"). You can also pass any date inside the week instead.`,
        };
      }
      currentWeekIso = weekIsoRaw;
    } else if (dateRaw) {
      if (!isValidIsoDateStrict(dateRaw)) {
        return {
          ok: false,
          errorCode: "invalid_body",
          errorMessage: `date must be a real calendar date (YYYY-MM-DD); got "${dateRaw}".`,
        };
      }
      currentWeekIso = isoWeekOf(new Date(`${dateRaw}T00:00:00Z`)).weekIso;
    } else {
      currentWeekIso = isoWeekOf(new Date()).weekIso;
    }
    const rows = await db
      .select({
        id: atelierTimesheetWeeks.id,
        weekIso: atelierTimesheetWeeks.weekIso,
        status: atelierTimesheetWeeks.status,
        totalHours: atelierTimesheetWeeks.totalHours,
        billableHours: atelierTimesheetWeeks.billableHours,
        suspiciousFlags: atelierTimesheetWeeks.suspiciousFlags,
      })
      .from(atelierTimesheetWeeks)
      .where(
        and(
          eq(atelierTimesheetWeeks.orgId, ctx.persona.orgId),
          eq(atelierTimesheetWeeks.personId, person.id),
          eq(atelierTimesheetWeeks.weekIso, currentWeekIso),
          isNull(atelierTimesheetWeeks.deletedAt),
        ),
      )
      .limit(1);
    const week = rows[0] ?? null;
    if (!week) {
      return {
        ok: true,
        data: {
          id: null,
          label: `No hours logged yet for ${currentWeekIso}`,
          weekIso: currentWeekIso,
          status: "none",
          totalHours: 0,
          billableHours: 0,
          entries: [],
        },
      };
    }
    const entries = await db
      .select({
        id: atelierTimesheetEntries.id,
        workDate: atelierTimesheetEntries.workDate,
        activityCode: atelierTimesheetEntries.activityCode,
        engagementId: atelierTimesheetEntries.engagementId,
        hours: atelierTimesheetEntries.hours,
        billable: atelierTimesheetEntries.billable,
        narrative: atelierTimesheetEntries.narrative,
        status: atelierTimesheetEntries.status,
      })
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.weekId, week.id),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      )
      .orderBy(atelierTimesheetEntries.workDate);
    return {
      ok: true,
      data: {
        id: week.id,
        label: `Timesheet · ${week.weekIso}`,
        weekIso: week.weekIso,
        status: week.status,
        totalHours: week.totalHours,
        billableHours: week.billableHours,
        flags: week.suspiciousFlags ?? [],
        entries,
      },
    };
  },
});

// ---------------------------------------------------------------------
// activity.recent — audit_timeline
// ---------------------------------------------------------------------
defineCapability({
  id: "activity.recent",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "recent_activity",
  description:
    "Recent firm-wide activity: agent runs and audit events from the last N hours, most recent first.",
  slashAliases: { en: ["/activity", "/recent"] },
  inputSchema: {
    type: "object",
    properties: {
      sinceHours: { type: "integer", minimum: 1, maximum: 168 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "audit_timeline",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show recent activity across the firm", "What happened in the last 24 hours?"],
    ar: ["اعرض النشاط الأخير في الشركة"],
    fr: ["Activité récente du cabinet"],
  },
  async run(input, ctx) {
    const sinceHours = Math.max(1, Math.min(168, Number(input.sinceHours ?? 24)));
    const limit = Math.max(1, Math.min(100, Number(input.limit ?? 25)));
    const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const [runs, audits] = await Promise.all([
      db
        .select({
          id: atelierAgentRuns.id,
          agentId: atelierAgentRuns.agentId,
          status: atelierAgentRuns.status,
          targetLabel: atelierAgentRuns.targetLabel,
          createdAt: atelierAgentRuns.createdAt,
          updatedAt: atelierAgentRuns.updatedAt,
        })
        .from(atelierAgentRuns)
        .where(
          and(
            eq(atelierAgentRuns.orgId, ctx.persona.orgId),
            gte(atelierAgentRuns.createdAt, cutoff),
            isNull(atelierAgentRuns.deletedAt),
          ),
        )
        .orderBy(desc(atelierAgentRuns.createdAt))
        .limit(limit),
      db
        .select({
          id: atelierAuditEvents.id,
          action: atelierAuditEvents.action,
          actorLabel: atelierAuditEvents.actorLabel,
          payloadSummary: atelierAuditEvents.payloadSummary,
          ts: atelierAuditEvents.ts,
        })
        .from(atelierAuditEvents)
        .where(
          and(
            eq(atelierAuditEvents.orgId, ctx.persona.orgId),
            gte(atelierAuditEvents.ts, cutoff),
            isNull(atelierAuditEvents.deletedAt),
          ),
        )
        .orderBy(desc(atelierAuditEvents.ts))
        .limit(limit),
    ]);
    const events = [
      ...runs.map((r) => ({
        id: r.id,
        ts: r.createdAt.toISOString(),
        actor: r.agentId,
        actorType: "agent" as const,
        // Heartbeat-dead "running" rows render as error, never live.
        action: `agent.${effectiveAgentRunStatus(r)}`,
        summary: r.targetLabel ?? null,
      })),
      ...audits.map((a) => ({
        id: a.id,
        ts: a.ts.toISOString(),
        actor: a.actorLabel,
        actorType: "human" as const,
        action: a.action,
        summary: a.payloadSummary,
      })),
    ]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, limit);
    return { ok: true, data: { sinceHours, events } };
  },
});

// ---------------------------------------------------------------------
// home.summary — kpi_strip (matches /home Pane B aggregates)
// ---------------------------------------------------------------------
defineCapability({
  id: "home.summary",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "home_summary",
  description:
    "Summary numbers shown on Home: open opportunity count, active engagement count, RAID amber/red counts, deliverables due this week.",
  slashAliases: { en: ["/home", "/summary"] },
  inputSchema: { type: "object", properties: {} },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "kpi_strip",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["What needs me today?", "Show today's home summary"],
    ar: ["ما الذي يحتاج اهتمامي اليوم؟"],
    fr: ["Résumé du jour"],
  },
  async run(_input, ctx) {
    const [opps, engs] = await Promise.all([
      db
        .select({ id: atelierOpportunities.id, salesStage: atelierOpportunities.salesStage })
        .from(atelierOpportunities)
        .where(
          and(
            eq(atelierOpportunities.orgId, ctx.persona.orgId),
            isNull(atelierOpportunities.deletedAt),
          ),
        ),
      db
        .select({
          id: atelierEngagements.id,
          plmStage: atelierEngagements.plmStage,
          raidStatus: atelierEngagements.raidStatus,
          deliverablesDueThisWeek: atelierEngagements.deliverablesDueThisWeek,
        })
        .from(atelierEngagements)
        .where(
          and(
            eq(atelierEngagements.orgId, ctx.persona.orgId),
            isNull(atelierEngagements.deletedAt),
          ),
        ),
    ]);
    const activeEngs = engs.filter((e) => e.plmStage !== "closed");
    const rollups = await loadEngagementRollups(ctx.persona.orgId, activeEngs.map((e) => e.id));
    const rolls = activeEngs.map((e) => rollups.get(e.id)!);
    return {
      ok: true,
      data: {
        openOpportunityCount: opps.filter(
          (o) => !["contract", "lost", "no_decision", "withdrawn"].includes(o.salesStage),
        ).length,
        activeEngagementCount: activeEngs.length,
        raidAmberCount: rolls.filter((r) => r.raidStatus === "amber").length,
        raidRedCount: rolls.filter((r) => r.raidStatus === "red").length,
        deliverablesDueThisWeek: rolls.reduce((a, r) => a + r.deliverablesDueThisWeek, 0),
        deliverablesOverdue: rolls.reduce((a, r) => a + r.deliverablesOverdue, 0),
      },
    };
  },
});
