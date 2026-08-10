/**
 * Task #873 — Alliance-partner portal chat capabilities.
 *
 * The ONLY chat surface an `alliance_partner` login ever sees (the
 * catalog gate in `capabilitiesForPersona` returns exactly the
 * partnerportal.* slice for that role, and every internal role is
 * denied here via `requiredRoles`). Each run() re-checks the role and
 * resolves visibility through the SAME grant helpers the
 * /partner-portal REST routes use — grant revocation or firm archive
 * drops chat visibility in the same query.
 *
 * No RAG: attachment/document retrieval is never surfaced to this role
 * (and `attachment.search_documents` carries its own role deny as
 * defence-in-depth).
 */

import { db, atelierUsers, atelierAccounts } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import {
  grantedOpportunitiesForPartner,
  partnerOppWire,
  redactedAccountOverview,
} from "../../routes/atelier/partnerPortalRoutes.js";
import type { ToolContext, ToolResult } from "./index.js";

function deny(reason: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: reason };
}

async function partnerScope(ctx: ToolContext): Promise<
  | { ok: true; scope: NonNullable<Awaited<ReturnType<typeof grantedOpportunitiesForPartner>>> }
  | { ok: false; result: ToolResult }
> {
  if (ctx.persona.role !== "alliance_partner") {
    return { ok: false, result: deny("This assistant surface is only available to alliance-partner logins.") };
  }
  const [me] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, ctx.persona.id), isNull(atelierUsers.deletedAt)));
  if (!me) return { ok: false, result: deny("No active persona.") };
  const scope = await grantedOpportunitiesForPartner(me);
  if (!scope) {
    return {
      ok: false,
      result: deny("Your firm's portal access is not available right now. Please contact your Cognirise counterpart."),
    };
  }
  return { ok: true, scope };
}

defineCapability({
  id: "partnerportal.opportunities",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "partner_portal_opportunities",
  slashAliases: { en: ["/my-opportunities"] },
  description:
    "List the opportunities assigned to the caller's partner firm (alliance-partner portal). Returns name, stage, next milestone and expected close per opportunity.",
  requiredRoles: ["alliance_partner"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  promoteAsSuggestion: true,
  examplePhrases: {
    en: ["Show my assigned opportunities", "Which deals are we working on together?"],
  },
  async run(_input, ctx) {
    const s = await partnerScope(ctx);
    if (!s.ok) return s.result;
    const items = s.scope.opps.map(partnerOppWire);
    return {
      ok: true,
      data: {
        firm: s.scope.firm.name,
        count: items.length,
        items: items.map((o) => ({
          id: o.id,
          name: o.name,
          stage: o.salesStage,
          nextMilestone: o.nextMilestone,
          closeDate: o.closeDate,
          href: `/partner/opportunities/${o.id}`,
        })),
      },
    };
  },
});

defineCapability({
  id: "partnerportal.opportunity_detail",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "opportunity",
  toolName: "partner_portal_opportunity_detail",
  slashAliases: { en: ["/opportunity-status"] },
  description:
    "Detail for ONE opportunity assigned to the caller's partner firm: stage, sub-status, next milestone, expected close. Accepts the opportunity name or id.",
  requiredRoles: ["alliance_partner"],
  inputSchema: {
    type: "object",
    properties: {
      opportunity: {
        type: "string",
        description: "Opportunity name (or id) as shown in the partner portal.",
      },
    },
    required: ["opportunity"],
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["What's the status of the Falcon deal?"] },
  async run(input, ctx) {
    const s = await partnerScope(ctx);
    if (!s.ok) return s.result;
    const q = String(input.opportunity ?? "").trim().toLowerCase();
    if (!q) return { ok: false, errorCode: "not_found", errorMessage: "Which opportunity?" };
    const matches = s.scope.opps.filter(
      (o) => o.id === input.opportunity || o.name.toLowerCase().includes(q),
    );
    if (matches.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: "No assigned opportunity matches that name.",
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        disambiguation: {
          kind: "opportunity",
          options: matches.slice(0, 5).map((o) => ({ id: o.id, label: o.name })),
        },
      };
    }
    const o = partnerOppWire(matches[0]!);
    return {
      ok: true,
      data: { ...o, href: `/partner/opportunities/${o.id}` },
    };
  },
});

defineCapability({
  id: "partnerportal.account_overview",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "account",
  toolName: "partner_portal_account_overview",
  slashAliases: { en: ["/client-overview"] },
  description:
    "Redacted overview of the client account behind ONE assigned opportunity: name, sector, country, city, size. No contacts, financials or strategy are ever included.",
  requiredRoles: ["alliance_partner"],
  inputSchema: {
    type: "object",
    properties: {
      opportunity: {
        type: "string",
        description: "The assigned opportunity name (or id) whose account to summarise.",
      },
    },
    required: ["opportunity"],
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  surfaceOn: ["global", "home"],
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "entity_card",
  promoteAsSuggestion: false,
  examplePhrases: { en: ["Tell me about the client on the Falcon deal"] },
  async run(input, ctx) {
    const s = await partnerScope(ctx);
    if (!s.ok) return s.result;
    const q = String(input.opportunity ?? "").trim().toLowerCase();
    const matches = s.scope.opps.filter(
      (o) => o.id === input.opportunity || o.name.toLowerCase().includes(q),
    );
    if (matches.length !== 1) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          matches.length === 0
            ? "No assigned opportunity matches that name."
            : "Multiple assigned opportunities match — use the exact name.",
      };
    }
    const [account] = await db
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, matches[0]!.accountId),
          eq(atelierAccounts.orgId, ctx.persona.orgId),
        ),
      );
    if (!account) {
      return { ok: false, errorCode: "not_found", errorMessage: "Account not found." };
    }
    return { ok: true, data: redactedAccountOverview(account) };
  },
});
