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
  atelierEngagements,
} from "@workspace/db";
import {
  CATALOG_SCHEMA_VERSION,
  defineCapability,
  findByToolName,
} from "./capability-catalog.js";
import type { ToolContext, ToolResult } from "./index.js";
import { TOOL_REGISTRY } from "./index.js";

/**
 * Resolve a tool's metadata for undo purposes. The catalog
 * (`findByToolName`) only knows the capabilities registered via
 * `defineCapability` — but several legacy tools (e.g. `add_raid_item`)
 * live in `TOOL_REGISTRY` only. Fall back to the registry so undo
 * works against both worlds.
 */
function resolveToolMeta(
  toolName: string,
): { isWrite: boolean; irreversible: boolean; outboundChannel?: string | null } | null {
  const cap = findByToolName(toolName);
  if (cap) return { isWrite: cap.isWrite, irreversible: cap.irreversible, outboundChannel: cap.outboundChannel };
  const reg = TOOL_REGISTRY[toolName];
  if (!reg) return null;
  return { isWrite: Boolean(reg.isWrite), irreversible: false, outboundChannel: null };
}

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
  // add_raid_item commit returns { committed: true, raid: row }
  if (d.raid && typeof (d.raid as Record<string, unknown>).id === "string") {
    return [(d.raid as Record<string, unknown>).id as string];
  }
  // Generic nested-row shape: { row: { id } } / { item: { id } }
  for (const key of ["row", "item", "opportunity", "expense", "asset", "profile"]) {
    const nested = d[key];
    if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).id === "string") {
      return [(nested as Record<string, unknown>).id as string];
    }
  }
  return [];
}

const raidSoftDelete: InverseOp = {
  label: "soft-delete the RAID item",
  async run(_ctx, { ids, orgId }) {
    if (ids.length === 0) return { ok: false, undoneEntityIds: [], errorMessage: "no entity id" };
    // RAID items have no orgId column directly — they are scoped via
    // engagementId. To harden multi-tenant isolation (code-review iter
    // 6), we first resolve the candidate id set against the engagements
    // table filtered by orgId, then soft-delete only the survivors.
    // Without this, a forged turn referencing another tenant's RAID id
    // could in principle slip through (defence-in-depth — the calling
    // persona is already org-checked upstream).
    const scoped = await db
      .select({ id: atelierRaidItems.id })
      .from(atelierRaidItems)
      .innerJoin(
        atelierEngagements,
        eq(atelierEngagements.id, atelierRaidItems.engagementId),
      )
      .where(
        and(
          inArray(atelierRaidItems.id, ids),
          eq(atelierEngagements.orgId, orgId),
          isNull(atelierRaidItems.deletedAt),
          isNull(atelierEngagements.deletedAt),
        ),
      );
    const scopedIds = scoped.map((r) => r.id);
    if (scopedIds.length === 0) {
      return { ok: false, undoneEntityIds: [], errorMessage: "no rows in tenant scope" };
    }
    const rows = await db
      .update(atelierRaidItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          inArray(atelierRaidItems.id, scopedIds),
          isNull(atelierRaidItems.deletedAt),
        ),
      )
      .returning({ id: atelierRaidItems.id });
    return ensureAffected(rows, ids);
  },
};

/**
 * Test-only handle exposed for the cli-use-cases regression that
 * verifies partial-undo semantics (missing rows must report ok=false
 * with an explanatory errorMessage rather than silently succeed).
 * Production code uses INVERSE_OPS directly.
 */
export const raidSoftDeleteSelfTest = (args: { ids: string[]; orgId: string }) =>
  raidSoftDelete.run(
    { persona: { id: "test", name: "test", role: "founding_partner", orgId: args.orgId }, turnId: "t", sessionId: "s", stepIdx: 0 },
    args,
  );

const INVERSE_OPS: Record<string, InverseOp> = {
  // Both the v1 (`add_raid_item` — used by the mock router and the
  // current preview→commit flow) and the v2 capability point at the
  // same reversal: soft-delete the row.
  add_raid_item: raidSoftDelete,
  raid_add_v2: raidSoftDelete,
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

interface ReversibleStep {
  step: number;
  toolName: string;
  entityIds: string[];
  inverse: InverseOp;
}

interface LastReversibleHit {
  turnId: string;
  /**
   * Every reversible write step from the chosen turn, ordered LIFO so
   * we undo the latest write first (matches the persisted-step inverse
   * plan called for in the spec).
   */
  reversibleSteps: ReversibleStep[];
  /** Convenience accessor — the most-recent reversible tool name. */
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
    const frames = (row.frames as Array<{ type: string; data?: Record<string, unknown> }> | null) ?? [];

    const irreversibleSiblings: IrreversibleStepReport[] = [];
    const reversibleSteps: ReversibleStep[] = [];

    // Walk LIFO so we build the inverse plan in reverse-execution order
    // (last write first) — matches what a human would expect from undo.
    for (let i = calls.length - 1; i >= 0; i--) {
      const c = calls[i]!;
      if (!c.ok) continue;
      const cap = resolveToolMeta(c.tool);
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
      // Find the matching tool_result payload (walk frames LIFO so a
      // post-confirm tool_result wins over the pre-confirm one).
      let data: unknown;
      for (let f = frames.length - 1; f >= 0; f--) {
        const fr = frames[f]!;
        if (fr.type !== "tool_result") continue;
        const fd = fr.data as { tool?: string; data?: unknown; step?: number } | undefined;
        if (fd?.tool !== c.tool) continue;
        if (typeof fd.step === "number" && typeof c.step === "number" && fd.step !== c.step) continue;
        data = fd.data;
        if (data) break;
      }
      const ids = entityIdsFromResult(c.tool, data);
      if (ids.length === 0) continue;
      reversibleSteps.push({
        step: typeof c.step === "number" ? c.step : i,
        toolName: c.tool,
        entityIds: ids,
        inverse,
      });
    }
    if (reversibleSteps.length > 0) {
      const head = reversibleSteps[0]!;
      return {
        turnId: row.id,
        reversibleSteps,
        toolName: head.toolName,
        entityIds: head.entityIds,
        inverse: head.inverse,
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
  // The undo itself cannot be undone — and (critically for Use Case
  // #62) flagging it irreversible makes the orchestrator enforce the
  // typed-name guard at /confirm time using the value we stamp into
  // `confirmation.diff.typedNameRequired` below.
  irreversible: true,
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
    // Typed-name guard (Use Case #62) — the partner must echo this
    // short turn-handle back to us at `/cli/turn/:id/confirm` time.
    // The orchestrator (index.ts ~1755) reads `typedNameRequired` off
    // the confirmation diff and stamps `pendingWrite.typedNameExpected`
    // server-side; `confirmPendingWrite` then validates the value the
    // client sends in the confirm body against it. We deliberately do
    // NOT pre-fill `pending.input.typedName` here — that would let the
    // confirm endpoint be called with no user input and bypass the
    // safeguard.
    const typedNameExpected = `undo ${hit.turnId.slice(-6)}`;
    if (input.confirm !== true) {
      const totalRecords = hit.reversibleSteps.reduce((n, s) => n + s.entityIds.length, 0);
      const summaryParts = [
        `Undo last action — ${hit.reversibleSteps.length} reversible step${hit.reversibleSteps.length === 1 ? "" : "s"}, ${totalRecords} record${totalRecords === 1 ? "" : "s"} from turn ${hit.turnId}.`,
        `Type \`${typedNameExpected}\` in the confirm field to proceed.`,
      ];
      if (hit.irreversibleSiblings.length > 0) {
        summaryParts.push(
          `${hit.irreversibleSiblings.length} step${hit.irreversibleSiblings.length === 1 ? "" : "s"} cannot be undone (${hit.irreversibleSiblings.map((s) => s.tool).join(", ")}).`,
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
              reversibleSteps: hit.reversibleSteps.map((s) => ({
                step: s.step,
                tool: s.toolName,
                entityIds: s.entityIds,
                reversal: s.inverse.label,
              })),
              irreversibleSteps: hit.irreversibleSiblings,
              partial: hit.irreversibleSiblings.length > 0,
            },
            // Consumed by the orchestrator to stamp
            // pendingWrite.typedNameExpected — the confirm route then
            // requires the client to echo this value in its body.
            typedNameRequired: typedNameExpected,
            requiresTypedName: true,
          },
          pending: {
            tool: "undo_last_action",
            // typedName is intentionally NOT pre-filled — the user
            // must type it at confirm time.
            input: { confirm: true },
          },
        },
      };
    }
    // Replay every reversible step LIFO. We tolerate per-step failures
    // and report them honestly — this is partial-undo by design.
    const stepResults: Array<{
      step: number;
      tool: string;
      ok: boolean;
      undoneEntityIds: string[];
      errorMessage?: string;
    }> = [];
    for (const s of hit.reversibleSteps) {
      const r = await s.inverse.run(ctx, { ids: s.entityIds, orgId: ctx.persona.orgId });
      stepResults.push({
        step: s.step,
        tool: s.toolName,
        ok: r.ok,
        undoneEntityIds: r.undoneEntityIds,
        errorMessage: r.errorMessage,
      });
    }
    const allUndone = stepResults.flatMap((r) => r.undoneEntityIds);
    // Partial-success semantics (code-review iter 8): a step that
    // intended to reverse N IDs and only managed M (M>0, M<N) returns
    // ok:false from ensureAffected but still populates
    // undoneEntityIds. Treat any reverted-ID count > 0 as partial
    // success rather than total failure — otherwise we'd misreport an
    // "I reverted 2 of 3" outcome as "nothing reverted".
    const anyOk = stepResults.some((r) => r.ok);
    const anyReverted = allUndone.length > 0;
    const allFullyOk = stepResults.every((r) => r.ok);
    const result = {
      ok: anyOk || anyReverted,
      partial: !allFullyOk && anyReverted,
      undoneEntityIds: allUndone,
      errorMessage: anyReverted
        ? stepResults.find((r) => r.errorMessage)?.errorMessage
        : stepResults.find((r) => r.errorMessage)?.errorMessage ??
          "no reversible step affected any rows",
    };
    if (!result.ok) {
      return {
        ok: false,
        errorCode: "undo_failed",
        errorMessage: result.errorMessage ?? "reversal did not affect any rows",
      };
    }
    await db.insert(atelierAuditEvents).values({
      id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      // Multi-tenant correctness: stamp orgId so /cli/admin/metrics
      // and digest aggregation never mis-attribute undo events across
      // tenants.
      orgId: ctx.persona.orgId,
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
        // Per-step replay results — preserves "step 3 succeeded, step 1
        // failed" detail so the audit timeline tells the partial-undo
        // truth even when nobody clicks /help.
        stepResults,
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
        stepResults,
        irreversibleSteps: hit.irreversibleSiblings,
        partial: hit.irreversibleSiblings.length > 0 || stepResults.some((r) => !r.ok),
        // Task #511 — undo lands on whatever surface the user was on; no fixed path.
        navigateTo: null,
      },
    };
  },
});
