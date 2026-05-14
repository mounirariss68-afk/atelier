/**
 * Task #335 — `undo_last_action` capability + inverse-plan registry.
 *
 * The catalog declares some writes as `irreversible:true` (account
 * delete, outbound email/Slack send, salon publish). For everything
 * else we maintain a small static map from `toolName` → reversal
 * operation. Undo:
 *   1. finds the persona's most recent `success` turn,
 *   2. reads its `tool_calls` to find the last write step + the
 *      created entity id (returned in the tool's result `data`),
 *   3. looks up the inverse op,
 *   4. emits a confirmation diff describing the reversal,
 *   5. on `confirm:true`, executes the inverse + writes a `cli.undo`
 *      audit event that pivots back to the original turn.
 *
 * Reversals are deliberately conservative — we soft-delete created
 * rows (set `deletedAt = now()`) rather than hard-delete so the
 * existing audit trail keeps pointing at a real row.
 */

import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  atelierCliTurns,
  atelierRaidItems,
  atelierExpenses,
  atelierOpportunities,
  atelierAuditEvents,
  atelierAssets,
  atelierFirmProfile,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  findByToolName,
} from "./capability-catalog.js";
import type { ToolContext, ToolResult } from "./index.js";

interface InverseOp {
  /** Short label for the diff. */
  label: string;
  /** Run the reversal — return `{ ok, undoneEntityIds }` or fail. */
  run: (
    ctx: ToolContext,
    args: { ids: string[]; orgId: string },
  ) => Promise<{ ok: boolean; undoneEntityIds: string[]; errorMessage?: string }>;
}

/**
 * Helper — soft-delete a set of org-scoped rows + assert at least one
 * row was actually affected. Drizzle's `.update().returning()` lets us
 * count survivors so we never report a phantom undo (e.g. the user
 * already hard-deleted the row in a different surface).
 */
function ensureAffected<T extends { id: string }>(
  rows: T[],
  expectedIds: string[],
): { ok: boolean; undoneEntityIds: string[]; errorMessage?: string } {
  if (rows.length === 0) {
    return {
      ok: false,
      undoneEntityIds: [],
      errorMessage:
        "no rows were affected — the original record may have been deleted or moved out of scope",
    };
  }
  const affected = rows.map((r) => r.id);
  const missing = expectedIds.filter((id) => !affected.includes(id));
  if (missing.length > 0) {
    return {
      ok: false,
      undoneEntityIds: affected,
      errorMessage: `partial undo — ${missing.length}/${expectedIds.length} rows missing (${missing.join(", ")})`,
    };
  }
  return { ok: true, undoneEntityIds: affected };
}

/** Pull the created entity id(s) out of a tool result `data` payload. */
function entityIdsFromResult(
  toolName: string,
  data: unknown,
): string[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  // Single-id shape: { id }
  if (typeof d.id === "string") return [d.id];
  // Multi-id shape (transcript-to-raid, receipt batch): { ids: [...] }
  if (Array.isArray(d.ids)) return d.ids.filter((x): x is string => typeof x === "string");
  // Account delete returns { deleted, name }
  if (typeof d.deleted === "string") return [d.deleted];
  // ingest_rfp returns { id, opportunityName, accountId, ... }
  return [];
}

const INVERSE_OPS: Record<string, InverseOp> = {
  raid_add_v2: {
    label: "soft-delete the RAID item",
    async run(_ctx, { ids, orgId }) {
      if (ids.length === 0) return { ok: false, undoneEntityIds: [], errorMessage: "no entity id" };
      const rows = await db
        .update(atelierRaidItems)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(atelierRaidItems.id, ids),
            eq(atelierRaidItems.orgId, orgId),
            isNull(atelierRaidItems.deletedAt),
          ),
        )
        .returning({ id: atelierRaidItems.id });
      return ensureAffected(rows, ids);
    },
  },
  ingest_rfp_to_opportunity: {
    label: "soft-delete the opportunity",
    async run(_ctx, { ids, orgId }) {
      if (ids.length === 0) return { ok: false, undoneEntityIds: [], errorMessage: "no entity id" };
      const rows = await db
        .update(atelierOpportunities)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(atelierOpportunities.id, ids),
            eq(atelierOpportunities.orgId, orgId),
            isNull(atelierOpportunities.deletedAt),
          ),
        )
        .returning({ id: atelierOpportunities.id });
      return ensureAffected(rows, ids);
    },
  },
  ingest_transcript_to_raid: {
    label: "soft-delete the staged RAID items",
    async run(_ctx, { ids, orgId }) {
      if (ids.length === 0) return { ok: false, undoneEntityIds: [], errorMessage: "no entity ids" };
      const rows = await db
        .update(atelierRaidItems)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(atelierRaidItems.id, ids),
            eq(atelierRaidItems.orgId, orgId),
            isNull(atelierRaidItems.deletedAt),
          ),
        )
        .returning({ id: atelierRaidItems.id });
      return ensureAffected(rows, ids);
    },
  },
  ingest_receipts_to_expenses: {
    label: "soft-delete the staged expenses",
    async run(_ctx, { ids, orgId }) {
      if (ids.length === 0) return { ok: false, undoneEntityIds: [], errorMessage: "no entity ids" };
      const rows = await db
        .update(atelierExpenses)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(atelierExpenses.id, ids),
            eq(atelierExpenses.orgId, orgId),
            isNull(atelierExpenses.deletedAt),
          ),
        )
        .returning({ id: atelierExpenses.id });
      return ensureAffected(rows, ids);
    },
  },
  ingest_spreadsheet_summary: {
    label: "soft-delete the analyst-summary asset",
    async run(_ctx, { ids, orgId }) {
      if (ids.length === 0) return { ok: false, undoneEntityIds: [], errorMessage: "no entity id" };
      const rows = await db
        .update(atelierAssets)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(atelierAssets.id, ids),
            eq(atelierAssets.orgId, orgId),
            isNull(atelierAssets.deletedAt),
          ),
        )
        .returning({ id: atelierAssets.id });
      return ensureAffected(rows, ids);
    },
  },
  ingest_deck_to_brand_profile: {
    label: "discard the Brand Profile draft",
    async run(_ctx, { ids, orgId }) {
      if (ids.length === 0) return { ok: false, undoneEntityIds: [], errorMessage: "no entity id" };
      // Only drafts may be reversed — published versions stay. We
      // soft-delete + mark superseded so the existing audit row keeps
      // pointing at a real (but ignored) profile.
      const rows = await db
        .update(atelierFirmProfile)
        .set({ status: "superseded", deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(atelierFirmProfile.id, ids),
            eq(atelierFirmProfile.orgId, orgId),
            eq(atelierFirmProfile.status, "draft"),
            isNull(atelierFirmProfile.deletedAt),
          ),
        )
        .returning({ id: atelierFirmProfile.id });
      return ensureAffected(rows, ids);
    },
  },
};

interface IrreversibleStepReport {
  step: number;
  tool: string;
  reason: string;
  manualReversalHint: string;
}

interface LastReversibleHit {
  turnId: string;
  toolName: string;
  entityIds: string[];
  inverse: InverseOp;
  /**
   * Steps in the same source turn that we cannot reverse. Surfaced in
   * the confirmation diff so partners see exactly which writes will
   * stay even after `/undo` succeeds.
   */
  irreversibleSiblings: IrreversibleStepReport[];
}

const MANUAL_REVERSAL_HINTS: Record<string, string> = {
  account_delete:
    "Account deletion is permanent in CLI surface — restore via Admin → Accounts → soft-deleted view.",
  send_deliverable_email:
    "Outbound email cannot be recalled. Send a follow-up email or contact the recipient directly.",
  publish_brand_profile:
    "Published Brand Profile versions cannot be discarded — publish a new superseding version instead.",
};

function explainIrreversible(toolName: string): string {
  const cap = findByToolName(toolName);
  if (!cap) return "tool no longer in catalog";
  if (cap.outboundChannel) return `outbound ${cap.outboundChannel} cannot be recalled from the CLI`;
  if (cap.irreversible) return "capability is flagged as irreversible in the catalog";
  return "no inverse operation registered for this tool";
}

async function findLastReversible(
  persona: { id: string; orgId: string },
): Promise<LastReversibleHit | null> {
  const rows = await db
    .select({
      id: atelierCliTurns.id,
      toolCalls: atelierCliTurns.toolCalls,
      frames: atelierCliTurns.frames,
      status: atelierCliTurns.status,
    })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.userId, persona.id),
        eq(atelierCliTurns.orgId, persona.orgId),
      ),
    )
    .orderBy(desc(atelierCliTurns.createdAt))
    .limit(20);

  for (const row of rows) {
    if (row.status !== "success" && row.status !== "partial") continue;
    const calls = (row.toolCalls as Array<{ tool: string; ok: boolean; step?: number }> | null) ?? [];
    // First-pass: catalogue every write step in this turn so we can
    // report irreversible siblings alongside the reversal preview.
    const irreversibleSiblings: IrreversibleStepReport[] = [];
    let hit: { idx: number; cap: NonNullable<ReturnType<typeof findByToolName>>; ids: string[]; inverse: InverseOp } | null = null;
    for (let i = calls.length - 1; i >= 0; i--) {
      const c = calls[i]!;
      if (!c.ok) continue;
      const cap = findByToolName(c.tool);
      if (!cap?.isWrite) continue;
      const inverse = INVERSE_OPS[c.tool];
      if (cap.irreversible || !inverse) {
        irreversibleSiblings.unshift({
          step: typeof c.step === "number" ? c.step : i,
          tool: c.tool,
          reason: explainIrreversible(c.tool),
          manualReversalHint:
            MANUAL_REVERSAL_HINTS[c.tool] ??
            `Reverse ${c.tool} manually in the relevant workspace.`,
        });
        continue;
      }
      if (hit) continue; // already picked the most-recent reversible
      // Find the corresponding tool_result frame to extract created ids.
      const frames = (row.frames as Array<{ type: string; data?: Record<string, unknown> }> | null) ?? [];
      let data: unknown;
      for (let f = frames.length - 1; f >= 0; f--) {
        const fr = frames[f]!;
        if (fr.type !== "tool_result") continue;
        const fd = fr.data as { tool?: string; data?: unknown } | undefined;
        if (fd?.tool !== c.tool) continue;
        data = fd.data;
        if (data) break;
      }
      const ids = entityIdsFromResult(c.tool, data);
      if (ids.length === 0) continue;
      hit = { idx: i, cap, ids, inverse };
    }
    if (hit) {
      return {
        turnId: row.id,
        toolName: calls[hit.idx]!.tool,
        entityIds: hit.ids,
        inverse: hit.inverse,
        irreversibleSiblings,
      };
    }
  }
  return null;
}

defineCapability({
  id: "meta.undo_last_action",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "meta",
  toolName: "undo_last_action",
  description:
    "Undo your last reversible CLI write (RAID add, opportunity ingest, expense batch, etc.). Irreversible writes (delete account, send email) are not eligible. Always two-phase confirm.",
  slashAliases: { en: ["/undo"], fr: ["/annuler"], ar: ["/تراجع"] },
  inputSchema: {
    type: "object",
    properties: {
      confirm: { type: "boolean" },
    },
    additionalProperties: false,
  },
  isWrite: true,
  irreversible: false,
  surfaceOn: ["global"],
  examplePhrases: {
    en: ["undo my last action", "/undo"],
    fr: ["annule la dernière action"],
  },
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "undo_card",
  async run(input, ctx): Promise<ToolResult> {
    const hit = await findLastReversible({ id: ctx.persona.id, orgId: ctx.persona.orgId });
    if (!hit) {
      return {
        ok: false,
        errorCode: "no_reversible",
        errorMessage:
          "No reversible action found in your last 20 turns. Irreversible writes (delete, send) cannot be undone from the CLI.",
      };
    }
    if (input.confirm !== true) {
      const summaryParts = [
        `Undo last action — ${hit.inverse.label} (${hit.entityIds.length} record${hit.entityIds.length === 1 ? "" : "s"} from turn ${hit.turnId}).`,
      ];
      if (hit.irreversibleSiblings.length > 0) {
        summaryParts.push(
          `Note: ${hit.irreversibleSiblings.length} step${hit.irreversibleSiblings.length === 1 ? "" : "s"} from the same turn cannot be undone (${hit.irreversibleSiblings.map((s) => s.tool).join(", ")}).`,
        );
      }
      return {
        ok: true,
        data: { preview: hit },
        confirmation: {
          summary: summaryParts.join(" "),
          diff: {
            undo: {
              originalToolName: hit.toolName,
              originalTurnId: hit.turnId,
              entityIds: hit.entityIds,
              reversal: hit.inverse.label,
              irreversibleSteps: hit.irreversibleSiblings,
              partial: hit.irreversibleSiblings.length > 0,
            },
          },
          pending: { tool: "undo_last_action", input: { confirm: true } },
        },
      };
    }
    const result = await hit.inverse.run(ctx, {
      ids: hit.entityIds,
      orgId: ctx.persona.orgId,
    });
    if (!result.ok) {
      return {
        ok: false,
        errorCode: "undo_failed",
        errorMessage: result.errorMessage ?? "reversal did not affect any rows",
      };
    }
    await db.insert(atelierAuditEvents).values({
      id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      entityType: "cli_turn",
      entityId: hit.turnId,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: "cli.undo",
      payload: {
        originalToolName: hit.toolName,
        originalTurnId: hit.turnId,
        undoTurnId: ctx.turnId,
        undoneEntityIds: result.undoneEntityIds,
        reversal: hit.inverse.label,
        // Persist the irreversible-step report so audit timelines
        // explain the partial-undo truth even when nobody clicks /help.
        irreversibleSteps: hit.irreversibleSiblings,
      },
      payloadSummary:
        hit.irreversibleSiblings.length > 0
          ? `CLI undid ${hit.toolName} (${result.undoneEntityIds.length} record${result.undoneEntityIds.length === 1 ? "" : "s"}); ${hit.irreversibleSiblings.length} irreversible step${hit.irreversibleSiblings.length === 1 ? "" : "s"} left in place`
          : `CLI undid ${hit.toolName} (${result.undoneEntityIds.length} record${result.undoneEntityIds.length === 1 ? "" : "s"})`,
    });
    return {
      ok: true,
      data: {
        undone: true,
        originalTurnId: hit.turnId,
        toolName: hit.toolName,
        entityIds: result.undoneEntityIds,
        irreversibleSteps: hit.irreversibleSiblings,
        partial: hit.irreversibleSiblings.length > 0,
      },
    };
  },
});
