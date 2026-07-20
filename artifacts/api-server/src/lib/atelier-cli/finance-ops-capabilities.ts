/**
 * Task #406 — read-only chat/CLI capabilities for:
 *
 *   1. Finance reports (P&L, Balance Sheet, Cash Flow, profitability
 *      cube) — thin wrappers over the exact REST internals
 *      (`cliFinanceReportSummary` in financeReportsRoutes) so chat
 *      answers always tie out with the Reports UI.
 *   2. Legal-entity registration/lease expiries (`listEntityExpiries`).
 *   3. Win/Loss knowledge — debrief-by-opportunity + win-theme library.
 *   4. Manager-scoped leave approval queue + team leave calendar,
 *      re-using the org-chart routing filter (`canDecideLeaveFor`).
 *   5. Contract browsing (row-level `canSeeContract` ACL, self-scope
 *      fallback identical to /me/contracts) + template catalogue
 *      (partner-tier only, mirroring `ensureContractManager`).
 *
 * ACL policy — mirrors the REST router exactly, but with EXPLICIT
 * refusals instead of silent empty lists:
 *   - recruiter → refused everywhere here ("recruiter-scope").
 *   - employee / contractor / partner_firm_resource → self-scope
 *     personas; refused on org-wide finance / win-loss / leave-queue
 *     surfaces (the Atelier router locks them to /me/*). The contract
 *     list degrades to the caller's OWN contracts (like /me/contracts)
 *     instead of refusing outright.
 *   - leave queue/calendar → canApproveAsLead || isHr (same gate as
 *     /roster/leave-requests).
 *   - templates → canApproveAsPartner (same gate as /contract-templates).
 *
 * Everything is `isWrite: false`, no confirms, no outbound channels.
 */

import { and, eq, desc, ilike, inArray, isNull, gte, lte } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierOpportunities,
  atelierWinLossDebriefs,
  atelierWinThemes,
  atelierLeaveRequests,
  atelierEmployees,
  atelierContractors,
  atelierContractRecords,
  atelierContractTemplates,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
} from "./capability-catalog.js";
import {
  cliFinanceReportSummary,
  type CliFinanceReportKind,
} from "../../routes/atelier/financeReportsRoutes.js";
import { listEntityExpiries } from "../../routes/atelier/financeEntitiesRoutes.js";
import {
  canDecideLeaveFor,
  canReachApproverSurface,
} from "../../routes/atelier/meSelfServiceRoutes.js";
import { canSeeContract } from "../../routes/atelier/contractLifecycleRoutes.js";
import { canApproveAsPartner } from "../../routes/atelier/personaRoles.js";
import type { CliPersona, ToolResult } from "./index.js";

type Me = typeof atelierUsers.$inferSelect;

/** Only id / role / orgId are ever read by the shared ACL helpers. */
function asMe(persona: CliPersona): Me {
  return {
    id: persona.id,
    role: persona.role,
    orgId: persona.orgId,
    name: persona.name,
  } as Me;
}

function denyForbidden(reason: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: reason };
}

const SELF_SCOPE_ROLES = new Set([
  "employee",
  "contractor",
  "partner_firm_resource",
]);

/**
 * Mirrors the REST middleware chain for org-wide finance / win-loss /
 * roster surfaces: recruiter is denied by the route gate, and the
 * self-only personas never reach these routers at all (locked to /me/*).
 * Returns a refusal ToolResult, or null when the persona may proceed.
 */
function refuseOrgWideRead(persona: CliPersona, surface: string): ToolResult | null {
  if (persona.role === "recruiter") {
    return denyForbidden(
      `Recruiter persona is limited to recruiting surfaces and cannot read ${surface}.`,
    );
  }
  if (SELF_SCOPE_ROLES.has(persona.role)) {
    return denyForbidden(
      `Your persona is self-scope (Me lens only) and cannot read ${surface}.`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------
// Finance reports — pnl / bs / cf / profitability
// ---------------------------------------------------------------------

const FINANCE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      enum: ["mtd", "qtd", "ytd", "r12"],
      description: "Reporting window (defaults to ytd).",
    },
    currency: {
      type: "string",
      enum: ["USD", "GBP", "EUR", "AED", "SAR"],
      description: "Presentation currency (defaults to USD).",
    },
  },
  additionalProperties: false,
} as const;

function financeReportCapability(opts: {
  id: string;
  toolName: string;
  kind: CliFinanceReportKind;
  description: string;
  slashEn: string[];
  card: "kpi_strip" | "ranked_list";
  phrasesEn: string[];
  surfaceLabel: string;
}): void {
  defineCapability({
    id: opts.id,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    module: "ledger",
    toolName: opts.toolName,
    description: opts.description,
    slashAliases: { en: opts.slashEn },
    inputSchema: FINANCE_INPUT_SCHEMA as unknown as Record<string, unknown>,
    isWrite: false,
    irreversible: false,
    surfaceOn: ["ledger", "home", "global"],
    twoPhaseConfirm: false,
    outboundChannel: null,
    resultCard: opts.card,
    promoteAsSuggestion: false,
    examplePhrases: { en: opts.phrasesEn },
    async run(input, ctx) {
      const refusal = refuseOrgWideRead(ctx.persona, opts.surfaceLabel);
      if (refusal) return refusal;
      const scope = typeof input.scope === "string" ? input.scope : undefined;
      const currency =
        typeof input.currency === "string" ? input.currency : undefined;
      const data = await cliFinanceReportSummary(
        ctx.persona.orgId,
        opts.kind,
        { scope, currency },
      );
      return { ok: true, data };
    },
  });
}

financeReportCapability({
  id: "ledger.finance_report_pnl",
  toolName: "finance_report_pnl",
  kind: "pnl",
  description:
    "Consolidated P&L summary (actual vs budget vs forecast vs prior year) with variance commentary and per-entity net revenue / EBITDA / net income. Same numbers as the Finance Reports UI.",
  slashEn: ["/pnl", "/profit-and-loss"],
  card: "kpi_strip",
  phrasesEn: [
    "Show the P&L",
    "How is revenue vs budget year to date?",
    "What's our EBITDA this quarter?",
  ],
  surfaceLabel: "firm-wide financial reports",
});

financeReportCapability({
  id: "ledger.finance_report_bs",
  toolName: "finance_report_bs",
  kind: "bs",
  description:
    "Consolidated Balance Sheet summary (assets, liabilities, equity, intercompany eliminations) with per-entity cash / total assets / equity. Same numbers as the Finance Reports UI.",
  slashEn: ["/balance-sheet", "/bs"],
  card: "kpi_strip",
  phrasesEn: [
    "Show the balance sheet",
    "What's our consolidated cash position?",
    "Total assets per entity",
  ],
  surfaceLabel: "firm-wide financial reports",
});

financeReportCapability({
  id: "ledger.finance_report_cf",
  toolName: "finance_report_cf",
  kind: "cf",
  description:
    "Consolidated indirect Cash Flow summary (operating / investing / financing, opening → closing cash) with per-entity cash-from-ops and net change. Same numbers as the Finance Reports UI.",
  slashEn: ["/cashflow", "/cf"],
  card: "kpi_strip",
  phrasesEn: [
    "Show the cash flow statement",
    "How much cash did we generate from operations this year?",
  ],
  surfaceLabel: "firm-wide financial reports",
});

financeReportCapability({
  id: "ledger.finance_report_profitability",
  toolName: "finance_report_profitability",
  kind: "profitability",
  description:
    "Profitability cube rollups: revenue / direct cost / gross margin by client, partner, and sector, plus the top engagements by revenue. Same numbers as the Finance Reports UI.",
  slashEn: ["/profitability", "/margin-by-client"],
  card: "ranked_list",
  phrasesEn: [
    "Which clients are most profitable?",
    "Show gross margin by partner",
    "Profitability by sector",
  ],
  surfaceLabel: "firm-wide financial reports",
});

// ---------------------------------------------------------------------
// ledger.finance_entity_expiries — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "ledger.finance_entity_expiries",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "finance_entity_expiries",
  description:
    "Upcoming (and recently overdue) legal-entity registration and lease expiries across the firm's entities, sorted soonest-first with overdue/critical/upcoming severity.",
  slashAliases: { en: ["/entity-expiries", "/expiries"] },
  inputSchema: {
    type: "object",
    properties: {
      windowDays: {
        type: "integer",
        minimum: 1,
        maximum: 365,
        description: "Look-ahead window in days (default 90).",
      },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["ledger", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "Which entity registrations expire soon?",
      "Any licences overdue for renewal?",
      "Show lease expiries in the next 6 months",
    ],
  },
  async run(input, ctx) {
    const refusal = refuseOrgWideRead(ctx.persona, "legal-entity compliance expiries");
    if (refusal) return refusal;
    const windowDays =
      typeof input.windowDays === "number" ? input.windowDays : undefined;
    const data = await listEntityExpiries(ctx.persona.orgId, windowDays);
    return { ok: true, data };
  },
});

// ---------------------------------------------------------------------
// win_loss.debrief_by_opportunity — entity_card
// ---------------------------------------------------------------------
defineCapability({
  id: "win_loss.debrief_by_opportunity",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "win_loss",
  toolName: "winloss_debrief_by_opportunity",
  description:
    "Fetch the Win/Loss debrief for a specific opportunity (by name or id): outcome, status, seller-perceived vs buyer-authentic reasons, hidden competitor, synthesized themes, and lessons.",
  slashAliases: { en: ["/debrief", "/win-loss-debrief"] },
  inputSchema: {
    type: "object",
    properties: {
      opportunity: {
        type: "string",
        description: "Opportunity name (fuzzy) or exact opportunity id.",
      },
    },
    required: ["opportunity"],
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["opportunity_workspace", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "Why did we lose the DEWA deal?",
      "Show the win/loss debrief for Acme",
      "What did the buyer say about the NEOM pursuit?",
    ],
  },
  async run(input, ctx) {
    const refusal = refuseOrgWideRead(ctx.persona, "Win/Loss debriefs");
    if (refusal) return refusal;
    const q = String(input.opportunity ?? "").trim();
    if (!q) {
      return {
        ok: false,
        errorCode: "invalid-input",
        errorMessage: "Provide an opportunity name or id.",
      };
    }
    // Deterministic resolution: exact id first, then name substring.
    const orgCond = and(
      eq(atelierOpportunities.orgId, ctx.persona.orgId),
      isNull(atelierOpportunities.deletedAt),
    );
    let [opp] = await db
      .select()
      .from(atelierOpportunities)
      .where(and(orgCond, eq(atelierOpportunities.id, q)))
      .limit(1);
    if (!opp) {
      const matches = await db
        .select()
        .from(atelierOpportunities)
        .where(and(orgCond, ilike(atelierOpportunities.name, `%${q}%`)))
        .orderBy(desc(atelierOpportunities.updatedAt))
        .limit(5);
      if (matches.length === 0) {
        return {
          ok: false,
          errorCode: "not-found",
          errorMessage: `No opportunity matched "${q}".`,
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          errorCode: "ambiguous",
          errorMessage: `Multiple opportunities matched "${q}": ${matches
            .map((m) => m.name)
            .join(", ")}. Please be more specific.`,
        };
      }
      opp = matches[0];
    }
    const [debrief] = await db
      .select()
      .from(atelierWinLossDebriefs)
      .where(
        and(
          eq(atelierWinLossDebriefs.orgId, ctx.persona.orgId),
          eq(atelierWinLossDebriefs.opportunityId, opp.id),
          isNull(atelierWinLossDebriefs.deletedAt),
        ),
      )
      .orderBy(desc(atelierWinLossDebriefs.createdAt))
      .limit(1);
    if (!debrief) {
      return {
        ok: false,
        errorCode: "not-found",
        errorMessage: `No Win/Loss debrief exists for "${opp.name}" yet.`,
      };
    }
    return {
      ok: true,
      data: {
        opportunity: { id: opp.id, name: opp.name, salesStage: opp.salesStage },
        debrief: {
          id: debrief.id,
          outcome: debrief.outcome,
          status: debrief.status,
          sellerPerceivedReasons: debrief.sellerPerceivedReasons,
          sellerNotes: debrief.sellerNotes,
          buyerAuthenticReasons: debrief.buyerAuthenticReasons,
          buyerResponses: debrief.buyerResponses ?? [],
          hiddenCompetitor: debrief.hiddenCompetitor,
          themes: debrief.themes,
          createdAt: debrief.createdAt,
          updatedAt: debrief.updatedAt,
        },
      },
    };
  },
});

// ---------------------------------------------------------------------
// win_loss.theme_library — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "win_loss.theme_library",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "win_loss",
  toolName: "winloss_theme_library",
  description:
    "Browse the Win-Theme library: recurring win/loss themes with support counts, sector tags, and ready-to-paste positioning lines, sorted by evidence strength.",
  slashAliases: { en: ["/win-themes", "/theme-library"] },
  inputSchema: {
    type: "object",
    properties: {
      polarity: {
        type: "string",
        enum: ["win", "loss"],
        description: "Filter to win or loss themes.",
      },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["opportunity_workspace", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "What are our strongest win themes?",
      "Why do we usually lose deals?",
      "Show the win theme library",
    ],
  },
  async run(input, ctx) {
    const refusal = refuseOrgWideRead(ctx.persona, "the Win-Theme library");
    if (refusal) return refusal;
    const polarity =
      input.polarity === "win" || input.polarity === "loss"
        ? input.polarity
        : null;
    const limit = Math.min(
      50,
      Math.max(1, typeof input.limit === "number" ? Math.round(input.limit) : 20),
    );
    const rows = await db
      .select()
      .from(atelierWinThemes)
      .where(
        and(
          eq(atelierWinThemes.orgId, ctx.persona.orgId),
          isNull(atelierWinThemes.deletedAt),
          eq(atelierWinThemes.status, "active"),
          polarity ? eq(atelierWinThemes.polarity, polarity) : undefined,
        ),
      )
      .orderBy(desc(atelierWinThemes.supportCount))
      .limit(limit);
    return {
      ok: true,
      data: {
        themes: rows.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          tag: t.tag,
          polarity: t.polarity,
          supportCount: t.supportCount,
          sectorTags: t.sectorTags,
          positioningLine: t.positioningLine,
          lastSeenAt: t.lastSeenAt,
        })),
      },
    };
  },
});

// ---------------------------------------------------------------------
// roster.leave_pending_queue — ranked_list
// ---------------------------------------------------------------------

function refuseLeaveApprover(persona: CliPersona): ToolResult | null {
  const orgWide = refuseOrgWideRead(persona, "the leave approval queue");
  if (orgWide) return orgWide;
  if (!canReachApproverSurface(asMe(persona))) {
    return denyForbidden(
      "The leave approval queue is only visible to managers (engagement-lead tier and above) and HR.",
    );
  }
  return null;
}

async function leaveNameMap(personIds: string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const [emps, cons] = await Promise.all([
    db.select().from(atelierEmployees).where(inArray(atelierEmployees.id, personIds)),
    db.select().from(atelierContractors).where(inArray(atelierContractors.id, personIds)),
  ]);
  return new Map<string, string>([
    ...emps.map((e) => [e.id, e.fullName] as const),
    ...cons.map((c) => [c.id, c.fullName] as const),
  ]);
}

defineCapability({
  id: "roster.leave_pending_queue",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "leave_pending_queue",
  description:
    "The caller's leave approval queue: requests routed to them by the org chart (their direct/indirect reports; HR and founders see only people with no manager). Defaults to pending.",
  slashAliases: { en: ["/leave-queue", "/pending-leave"] },
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["pending", "approved", "declined", "cancelled", "all"],
        description: "Status filter (default pending).",
      },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["roster", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "Any leave requests waiting on me?",
      "Show my leave approval queue",
      "Who has asked for time off?",
    ],
  },
  async run(input, ctx) {
    const refusal = refuseLeaveApprover(ctx.persona);
    if (refusal) return refusal;
    const me = asMe(ctx.persona);
    const status = typeof input.status === "string" ? input.status : "pending";
    const allRows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, me.orgId),
          status === "all" ? undefined : eq(atelierLeaveRequests.status, status),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      )
      .orderBy(desc(atelierLeaveRequests.createdAt));
    const routable = await Promise.all(
      allRows.map(async (r) => ((await canDecideLeaveFor(me, r.personId)) ? r : null)),
    );
    const rows = routable.filter((r): r is NonNullable<typeof r> => r !== null);
    const nameById = await leaveNameMap(
      Array.from(new Set(rows.map((r) => r.personId))),
    );
    return {
      ok: true,
      data: {
        status,
        requests: rows.map((r) => ({
          id: r.id,
          personId: r.personId,
          personName: nameById.get(r.personId) ?? r.personId,
          leaveType: r.leaveType,
          startDate: r.startDate,
          endDate: r.endDate,
          workingDays: r.workingDays,
          status: r.status,
          note: r.note,
          isOwn: r.userId === me.id,
          createdAt: r.createdAt,
        })),
      },
    };
  },
});

// ---------------------------------------------------------------------
// roster.leave_calendar — ranked_list
// ---------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

defineCapability({
  id: "roster.leave_calendar",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "roster",
  toolName: "leave_team_calendar",
  description:
    "Team availability for a date window: every pending or approved leave across the roster that intersects [start, end], so an approver can spot double-booked absences. Defaults to the next 30 days.",
  slashAliases: { en: ["/leave-calendar", "/who-is-off"] },
  inputSchema: {
    type: "object",
    properties: {
      start: { type: "string", description: "Window start (YYYY-MM-DD)." },
      end: { type: "string", description: "Window end (YYYY-MM-DD)." },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["roster", "home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "Who is off next week?",
      "Show the team leave calendar for August",
      "Any overlapping absences this month?",
    ],
  },
  async run(input, ctx) {
    const refusal = refuseLeaveApprover(ctx.persona);
    if (refusal) return refusal;
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const start = typeof input.start === "string" && ISO_DATE.test(input.start) ? input.start : today;
    const end = typeof input.end === "string" && ISO_DATE.test(input.end) ? input.end : in30;
    if (start > end) {
      return {
        ok: false,
        errorCode: "invalid-input",
        errorMessage: "start must be on or before end (YYYY-MM-DD).",
      };
    }
    const rows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, ctx.persona.orgId),
          inArray(atelierLeaveRequests.status, ["pending", "approved"]),
          isNull(atelierLeaveRequests.deletedAt),
          lte(atelierLeaveRequests.startDate, end),
          gte(atelierLeaveRequests.endDate, start),
        ),
      )
      .orderBy(atelierLeaveRequests.startDate);
    const nameById = await leaveNameMap(
      Array.from(new Set(rows.map((r) => r.personId))),
    );
    return {
      ok: true,
      data: {
        window: { start, end },
        entries: rows.map((r) => ({
          id: r.id,
          personId: r.personId,
          personName: nameById.get(r.personId) ?? r.personId,
          leaveType: r.leaveType,
          startDate: r.startDate,
          endDate: r.endDate,
          workingDays: r.workingDays,
          status: r.status,
        })),
      },
    };
  },
});

// ---------------------------------------------------------------------
// codex.contract_list — ranked_list
// ---------------------------------------------------------------------

function contractSummary(c: typeof atelierContractRecords.$inferSelect) {
  return {
    id: c.id,
    title: c.title,
    contractType: c.contractType,
    counterpartyLabel: c.counterpartyLabel,
    counterpartyKind: c.counterpartyKind,
    status: c.status,
    signingEntityLabel: c.signingEntityLabel,
    ownerLabel: c.ownerLabel,
    effectiveDate: c.effectiveDate,
    expiryDate: c.expiryDate,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

defineCapability({
  id: "codex.contract_list",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "contract_list",
  description:
    "List contracts the caller may see (partner tier: all; others: owned, own-person, or visible-account contracts — same row ACL as the Contracts UI). Optional status / type / counterparty filters.",
  slashAliases: { en: ["/contracts", "/contract-list"] },
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Contract status filter (e.g. draft, sent, signed, expired)." },
      contractType: { type: "string", description: "Contract type filter (e.g. employment, nda, msa, sow)." },
      counterparty: { type: "string", description: "Counterparty name contains-filter." },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "Show my contracts",
      "Which contracts are still awaiting signature?",
      "List NDAs with Acme",
    ],
  },
  async run(input, ctx) {
    if (ctx.persona.role === "recruiter") {
      return denyForbidden(
        "Recruiter persona is limited to recruiting surfaces and cannot browse contracts.",
      );
    }
    const me = asMe(ctx.persona);
    const limit = Math.min(
      100,
      Math.max(1, typeof input.limit === "number" ? Math.round(input.limit) : 25),
    );
    const conds = [eq(atelierContractRecords.orgId, me.orgId)];
    if (typeof input.status === "string" && input.status) {
      conds.push(eq(atelierContractRecords.status, input.status));
    }
    if (typeof input.contractType === "string" && input.contractType) {
      conds.push(eq(atelierContractRecords.contractType, input.contractType));
    }
    if (typeof input.counterparty === "string" && input.counterparty.trim()) {
      conds.push(
        ilike(
          atelierContractRecords.counterpartyLabel,
          `%${input.counterparty.trim()}%`,
        ),
      );
    }

    // Self-scope personas mirror GET /me/contracts exactly: only contracts
    // attached to their OWN roster person row. Explicit note in the payload
    // (never a silently-narrowed org list).
    if (SELF_SCOPE_ROLES.has(me.role)) {
      const emps = await db
        .select({ id: atelierEmployees.id })
        .from(atelierEmployees)
        .where(
          and(
            eq(atelierEmployees.orgId, me.orgId),
            eq(atelierEmployees.userId, me.id),
          ),
        );
      const ids = emps.map((e) => e.id);
      if (ids.length === 0) {
        return {
          ok: true,
          data: {
            scope: "self",
            note: "Self-scope persona: only your own contracts are listed. No roster record is linked to your login, so no contracts are visible.",
            contracts: [],
          },
        };
      }
      const rows = await db
        .select()
        .from(atelierContractRecords)
        .where(and(...conds, inArray(atelierContractRecords.personId, ids)))
        .orderBy(desc(atelierContractRecords.createdAt))
        .limit(limit);
      return {
        ok: true,
        data: {
          scope: "self",
          note: "Self-scope persona: only your own contracts are listed.",
          contracts: rows.map(contractSummary),
        },
      };
    }

    const rows = await db
      .select()
      .from(atelierContractRecords)
      .where(and(...conds))
      .orderBy(desc(atelierContractRecords.createdAt));
    const visible: Array<typeof atelierContractRecords.$inferSelect> = [];
    for (const c of rows) {
      if (await canSeeContract(me, c)) visible.push(c);
      if (visible.length >= limit) break;
    }
    return {
      ok: true,
      data: {
        scope: canApproveAsPartner(me.role) ? "all" : "visible",
        contracts: visible.map(contractSummary),
      },
    };
  },
});

// ---------------------------------------------------------------------
// codex.contract_template_list — ranked_list
// ---------------------------------------------------------------------
defineCapability({
  id: "codex.contract_template_list",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "codex",
  toolName: "contract_template_list",
  description:
    "List the contract template catalogue (name, type, status, current version). Partner-tier only — the same gate as the Templates UI.",
  slashAliases: { en: ["/contract-templates", "/templates"] },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["home", "global"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: false,
  examplePhrases: {
    en: [
      "What contract templates do we have?",
      "List the template catalogue",
      "Do we have an NDA template?",
    ],
  },
  async run(_input, ctx) {
    if (ctx.persona.role === "recruiter") {
      return denyForbidden(
        "Recruiter persona is limited to recruiting surfaces and cannot browse contract templates.",
      );
    }
    if (!canApproveAsPartner(ctx.persona.role)) {
      return denyForbidden(
        "Contract templates are managed by partner-tier roles only (same gate as the Templates UI).",
      );
    }
    const templates = await db
      .select()
      .from(atelierContractTemplates)
      .where(eq(atelierContractTemplates.orgId, ctx.persona.orgId))
      .orderBy(desc(atelierContractTemplates.createdAt));
    return {
      ok: true,
      data: {
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          contractType: t.contractType,
          status: t.status,
          currentVersionId: t.currentVersionId,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
      },
    };
  },
});
