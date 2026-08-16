/**
 * Task #1183 — Pre-formation cost pool read capability.
 *
 * Finance leadership (founding_partner / partner / finance) can ask the
 * assistant for the running total and itemization of any pre-formation
 * entity pool (e.g. "how much have we spent on Istanbul so far?").
 *
 * ACL mirrors GET /api/atelier/finance/preformation/pools; restricted
 * and board_observer personas are denied.
 */

import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { isRestrictedPersona, isBoardObserver } from "../../routes/atelier/personaRoles.js";
import { buildPools } from "../../routes/atelier/preformationRoutes.js";
import { DISPLAY_CURRENCIES } from "../atelier-fx.js";
import type { CliPersona, ToolResult } from "./index.js";

function denyForbidden(msg: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: msg };
}

function isFinanceLeadership(p: CliPersona): boolean {
  return p.role === "founding_partner" || p.role === "partner" || p.role === "finance";
}

// ───────────────────── finance.preformation_pools ─────────────────────
defineCapability({
  id: "finance.preformation_pools",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "ledger",
  toolName: "finance_preformation_pools",
  description:
    "Return pre-formation entity cost pools (posted + pipeline totals, itemized sources) " +
    "in the requested display currency. Optionally filter to a single entity by name or id.",
  slashAliases: { en: ["/preformation", "/pre-formation-pools"] },
  representativePrompts: {
    en: [
      "How much have we spent on Istanbul so far?",
      "Show pre-formation pool totals",
      "What's in the Riyadh cost pool?",
    ],
  },
  inputSchema: {
    type: "object",
    properties: {
      entity: {
        type: "string",
        description:
          "Optional name or entity id to filter to a single pool (e.g. 'Istanbul', 'Riyadh').",
      },
      currency: {
        type: "string",
        description: "Display currency code (default USD). Must be a supported FX currency.",
      },
    },
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "preformation_pool",
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "finance"],
  surfaceOn: ["ledger", "home", "global"],
  async run(input, ctx) {
    if (isRestrictedPersona(ctx.persona.role)) {
      return denyForbidden("Pre-formation pools are not available for this persona.");
    }
    if (isBoardObserver(ctx.persona.role)) {
      return denyForbidden("board_observer cannot access pre-formation cost pools.");
    }
    if (!isFinanceLeadership(ctx.persona)) {
      return denyForbidden(
        "Pre-formation cost pools are visible to finance leadership only.",
      );
    }

    const i = input as { entity?: string; currency?: string };
    const wanted = (i.currency ?? "USD").toUpperCase();
    const displayCurrency =
      DISPLAY_CURRENCIES.includes(wanted) || wanted === "USD" ? wanted : "USD";

    const allPools = await buildPools(ctx.persona.orgId, displayCurrency);

    // Optional single-entity filter: match on name (case-insensitive) or id.
    const entityFilter = (i.entity ?? "").trim().toLowerCase();
    const pools = entityFilter
      ? allPools.filter(
          (p) =>
            String(p.name ?? "").toLowerCase().includes(entityFilter) ||
            String(p.legalNameEn ?? "").toLowerCase().includes(entityFilter) ||
            String(p.entityId ?? "").toLowerCase() === entityFilter,
        )
      : allPools;

    if (entityFilter && pools.length === 0) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: `No pre-formation pool found matching "${i.entity}". Try a broader name or omit the filter to see all pools.`,
      };
    }

    // Top-5 items per pool for the card summary (full list visible on the
    // linked finance page).
    const summaryPools = pools.map((p) => {
      const allItems = (p.items as unknown[]) ?? [];
      return {
        entityId: p.entityId,
        name: p.name,
        legalNameEn: p.legalNameEn,
        country: p.country,
        status: p.status,
        ownershipLabel: p.ownershipLabel,
        recommendedTreatment: p.recommendedTreatment,
        settlement: p.settlement,
        postedUsd: p.postedUsd,
        pipelineUsd: p.pipelineUsd,
        totalUsd: p.totalUsd,
        display: p.display,
        itemCount: p.itemCount,
        topItems: allItems.slice(0, 5),
        lastActivityAt: p.lastActivityAt,
        idleDays: p.idleDays,
        staleFlags: p.staleFlags,
      };
    });

    return {
      ok: true,
      data: {
        pools: summaryPools,
        displayCurrency,
        poolCount: summaryPools.length,
        navigateTo: { path: "/finance/pre-formation", when: "on_view" as const },
      },
      resultCardHint: "preformation_pool",
    };
  },
});
