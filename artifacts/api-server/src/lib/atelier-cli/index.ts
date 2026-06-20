/**
 * Task #331 — Atelier CLI orchestrator (server spine).
 *
 * One file because the surface is small and the pieces lean on each
 * other tightly. Read top-to-bottom:
 *
 *   1.  Types     — SSE frames, tool registry, turn statuses.
 *   2.  IDs/util  — rid(), today UTC, budget classes.
 *   3.  Tools     — 4 starter capabilities (present_choices,
 *                   resolve_account_by_name, list_my_open_raid_items,
 *                   add_raid_item).
 *   4.  Quotas    — per-user concurrency lock + per-session daily $.
 *   5.  Sessions  — get-or-create + rolling summary helpers.
 *   6.  Loop      — runTurn() drives Claude tool-use; emits SSE frames;
 *                   persists atelier_cli_turns row +
 *                   atelier_audit_events `cli.turn`.
 *   7.  Confirm   — confirmPendingWrite() is the second phase of the
 *                   diff/confirm protocol for write-tools (e.g.
 *                   add_raid_item with confirm:true). Idempotent.
 *
 * There is no mock mode. Every turn calls Claude (Sonnet for writes,
 * Haiku for reads). If the Anthropic credentials are missing the module
 * throws at import time so misconfigured deployments fail loudly
 * instead of silently serving fake data.
 */

import {
  db,
  atelierCliSessions,
  atelierCliTurns,
  atelierCliJobs,
  atelierAuditEvents,
  atelierAccounts,
  atelierRaidItems,
  atelierUsers,
  atelierEngagements,
  atelierEngagementAccess,
} from "@workspace/db";
import { and, desc, eq, gte, ilike, isNull, or, inArray } from "drizzle-orm";
import type { Response } from "express";
// Task #332 — capability catalog + perimeter helpers. Imported lazily
// inside getToolsForPersona() so tests / sandbox tooling can stub
// individual catalog entries without circular-import warnings.
import {
  capabilitiesForPersona,
  findByToolName,
  CATALOG_SCHEMA_VERSION,
  getSessionDraft,
  recordSessionResult,
  ingestEntitiesFromToolResult,
  summarizeSessionDraft,
  pruneSessionDrafts,
} from "./capability-catalog.js";
// Task #339 — single bootstrap entry point. Imports cli-only entries,
// attachment+rubric capabilities, and walks the agent registry.
import "./bootstrap-capabilities.js";
import { redactJson, redactText, statsTouched } from "./pii-redaction.js";
import {
  shouldRequireTypedNameForAttachmentTurn,
  wrapAttachment,
} from "./prompt-guard.js";
import { stripLocalePreamble } from "./locale.js";
// Task #484 — static import of DISPATCH_TABLE so getToolsForPersona can
// strip legacy chat-writes whose (kind, verb) is now owned by
// propose_write. The capability-retriever filter at line 215 only
// applies inside retrieveCapabilities; the chat surface that Sonnet
// actually sees is built here, so the filter must live here too.
import { DISPATCH_TABLE } from "./write-dispatch.js";

// Pre-compute the set of legacy tool names that propose_write now owns.
// Built once at module load — DISPATCH_TABLE is static.
const LEGACY_DISPATCH_TARGETS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  for (const verbs of Object.values(DISPATCH_TABLE)) {
    for (const t of Object.values(verbs as Record<string, string>)) {
      if (typeof t === "string" && t) out.add(t);
    }
  }
  return out;
})();
// Meta tools (propose_write, evaluate_gate, undo_last_action, etc.)
// are never stripped even when their toolName collides with a dispatch
// target — they ARE the orchestrator surface.
const ALWAYS_INCLUDE_TOOLS: ReadonlySet<string> = new Set([
  "propose_write",
  "evaluate_gate",
  "undo_last_action",
  "present_choices",
]);

// =====================================================================
// 1. Types
// =====================================================================

export type CliFrameType =
  | "narration"
  | "plan_step"
  | "tool_call"
  | "tool_result"
  | "needs_disambiguation"
  | "needs_confirmation"
  | "needs_clarification"
  | "proposed_plan"
  | "proactive_recap"
  | "refusal"
  | "budget_exceeded"
  | "async_dispatched"
  | "progress"
  | "final"
  | "error";

export interface CliFrame {
  type: CliFrameType;
  data: Record<string, unknown>;
}

export type CliTurnStatus =
  | "streaming"
  | "awaiting_confirmation"
  | "awaiting_clarification"
  | "partial"
  | "success"
  | "cancelled"
  | "error"
  | "read_only_no_op"
  | "async_dispatched";

export interface CliPersona {
  id: string;
  name: string;
  role: string;
  orgId: string;
}

export interface RunTurnInput {
  sessionId?: string | null;
  prompt: string;
  /** Opaque attachment ids resolved by Task D's extraction pipeline. */
  attachmentIds?: string[];
  /** Page context captured at submit time (route, account, engagement, ids). */
  pageContext?: Record<string, unknown> | null;
  /** When true, stop at the proposed plan and never offer Confirm. */
  dryRun?: boolean;
  /** When true, cancel any in-flight turn for this user before queuing. */
  cancelInflight?: boolean;
  intent?: string | null;
  clientTurnKey?: string | null;
  /** Two-phase confirm: when set, replays the saved pendingWrite. */
  confirmTurnId?: string | null;
  /**
   * Task #332 — for irreversible writes the second `/confirm` body
   * MUST include `typedName` matching the entity name captured in the
   * pendingWrite hint (`diff.typedNameRequired`). Missing/wrong values
   * surface a `typed_name_required` error frame instead of running
   * the commit callback.
   */
  typedName?: string;
  /**
   * Explicit async hand-off: skip the synchronous loop, dispatch the
   * plan to the background runner and return `async_dispatched`. Caller
   * receives a `job` notification when complete.
   */
  async?: boolean;
}

// =====================================================================
// 2. IDs + util
// =====================================================================

export function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Hard-fail at import time if Anthropic credentials are missing. The
// orchestrator MUST drive every turn through Claude; there is no mock
// fallback. Failing here surfaces the misconfiguration in the workflow
// logs instead of silently serving deterministic fake data to users.
if (
  !process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ||
  !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
) {
  throw new Error(
    "[atelier-cli] AI_INTEGRATIONS_ANTHROPIC_BASE_URL and AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. The Atelier chat orchestrator does not support mock mode.",
  );
}

const SESSION_DAILY_BUDGET_USD = Number(
  process.env.ATELIER_CLI_SESSION_DAILY_BUDGET_USD ?? 5,
);
const MAX_TOOL_STEPS = Number(process.env.ATELIER_CLI_MAX_STEPS ?? 12);

// Wall-clock budgets per turn. Soft = emit budget_exceeded + ask the user
// (continue / hand off to async / cancel). Hard = abort.
const SOFT_WALL_MS = Number(process.env.ATELIER_CLI_SOFT_WALL_MS ?? 60_000);
const HARD_WALL_MS = Number(process.env.ATELIER_CLI_HARD_WALL_MS ?? 120_000);

// Per-user concurrent turn cap (per-day quota lives in the session row).
const PER_USER_DAILY_TURN_CAP = Number(
  process.env.ATELIER_CLI_PER_USER_DAILY_TURNS ?? 500,
);

// A plan with more than this many write steps is auto-handed off async.
const ASYNC_HANDOFF_STEP_THRESHOLD = Number(
  process.env.ATELIER_CLI_ASYNC_STEP_THRESHOLD ?? 10,
);

// Cheap-classifier (Haiku) model used for intent routing before the
// Sonnet orchestration loop. Override via env. The advisory label is
// derived from the typed router (intent-router.ts) — this constant is
// kept only for places that still need a model id string.
const HAIKU_CLASSIFIER_MODEL =
  process.env.ATELIER_CLI_HAIKU_MODEL ?? "claude-haiku-4-5";

type IntentLabel =
  | "reset"
  | "read"
  | "write"
  // Task #406 — distinct label for stage-transition verbs so the
  // Chat Orchestrator can short-circuit straight to evaluate_gate +
  // propose_write without reasoning through a generic write loop.
  // Advisory only (per the existing comment) — never blocking.
  | "transition"
  | "ambiguous"
  | "trivial"
  | "other";

function heuristicClassify(prompt: string): IntentLabel {
  const p = prompt.toLowerCase().trim();
  if (!p) return "trivial";
  if (/^\/new\b/.test(p) || /\b(reset|start over|new session)\b/.test(p)) return "reset";
  // Task #406 — transition-flavoured verbs. Checked BEFORE the generic
  // write match so "move opp to runner" routes to `transition` instead
  // of the broader `write` bucket.
  if (
    /\b(move|advance|promote|transition|push (it )?(to|into)|mark (as )?(lost|no[- ]?decision|withdrawn|won)|close (as|won|lost))\b/.test(
      p,
    )
  )
    return "transition";
  if (/\b(add|create|update|delete|remove|edit|log|file|submit|approve|link)\b/.test(p)) return "write";
  if (/\b(list|show|find|search|who is|what is|view|fetch|get)\b/.test(p)) return "read";
  if (/\b(or|either|maybe|which one|choose between)\b/.test(p)) return "ambiguous";
  return "other";
}

/**
 * Background runner for async-dispatched turns. Executes the deferred
 * pending write idempotently, updates the job + turn rows, writes the
 * canonical terminal `cli.turn` audit and a `cli.turn.notification`
 * audit so the originating user/UI can pick the result up via the
 * existing audit-event timeline.
 */
async function runAsyncJob(args: {
  jobId: string;
  turnId: string;
  sessionId: string;
  persona: CliPersona;
  pending: { tool: string; input: Record<string, unknown> } | null;
}): Promise<void> {
  const { jobId, turnId, sessionId, persona, pending } = args;
  const startedAt = new Date();
  await db
    .update(atelierCliJobs)
    .set({ status: "running", startedAt, updatedAt: new Date() })
    .where(eq(atelierCliJobs.id, jobId));

  let ok = false;
  let errorMessage: string | null = null;
  let result: unknown = null;
  if (pending) {
    // Task #332 — async write dispatch must resolve through the same
    // catalog-aware lookup the sync path uses, otherwise catalog-only
    // writes (e.g. raid_add_v2, account_delete) would never execute.
    const tool = findToolByName(pending.tool, persona);
    if (tool && tool.isWrite) {
      try {
        const out = await tool.run(pending.input, { persona, turnId, sessionId, stepIdx: 0 });
        ok = out.ok;
        result = out.data ?? null;
        errorMessage = out.ok ? null : (out.errorMessage ?? out.errorCode ?? null);
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    } else {
      errorMessage = `tool ${pending.tool} not registered as a write`;
    }
  } else {
    errorMessage = "no pending write captured for async dispatch";
  }
  const newStatus: CliTurnStatus = ok ? "success" : "error";
  await db
    .update(atelierCliJobs)
    .set({
      status: ok ? "success" : "error",
      result,
      error: errorMessage,
      progress: { current: 1, total: 1 },
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierCliJobs.id, jobId));
  await db
    .update(atelierCliTurns)
    .set({
      status: newStatus,
      statusMessage: errorMessage ?? newStatus,
      pendingWrite: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierCliTurns.id, turnId));
  await db.insert(atelierAuditEvents).values([
    {
      id: rid("aud"),
      entityType: "cli_turn",
      entityId: turnId,
      actorType: "system",
      actorId: persona.id,
      actorLabel: persona.name,
      action: "cli.turn.notification",
      payload: { jobId, sessionId, ok, errorMessage },
      payloadSummary: `Async job ${ok ? "completed" : "failed"} (${pending?.tool ?? "n/a"})`,
    },
    {
      id: rid("aud"),
      entityType: "cli_turn",
      entityId: turnId,
      actorType: "system",
      actorId: persona.id,
      actorLabel: persona.name,
      action: "cli.turn",
      payload: {
        sessionId,
        status: newStatus,
        terminal: true,
        async: true,
        jobId,
        tool: pending?.tool ?? null,
        ok,
        errorMessage,
      },
      payloadSummary: `CLI turn ${newStatus} (async ${pending?.tool ?? "n/a"})`,
    },
  ]);
}

export class CliBudgetExceededError extends Error {
  spent: number;
  limit: number;
  constructor(spent: number, limit: number) {
    super(
      `cli-session-budget-exceeded: $${spent.toFixed(4)} / $${limit.toFixed(2)}`,
    );
    this.name = "CliBudgetExceededError";
    this.spent = spent;
    this.limit = limit;
  }
}

export class CliConcurrencyError extends Error {
  constructor() {
    super("cli-turn-already-running-for-user");
    this.name = "CliConcurrencyError";
  }
}

export class CliQuotaExceededError extends Error {
  constructor(public used: number, public cap: number) {
    super(`cli-per-user-daily-quota-exceeded: ${used}/${cap}`);
    this.name = "CliQuotaExceededError";
  }
}

// =====================================================================
// 3. Tool registry
// =====================================================================

export interface ToolContext {
  persona: CliPersona;
  turnId: string;
  sessionId: string;
  /** Step index used for idempotency keys + partial-success bookkeeping. */
  stepIdx: number;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Anthropic tool-use input schema (JSON Schema). */
  input_schema: Record<string, unknown>;
  /** True = mutation. Mutations route through the confirm protocol. */
  isWrite: boolean;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolResult {
  ok: boolean;
  /** Free-form result returned to the model + UI. */
  data?: unknown;
  /** When ok=false: short machine code (e.g. "ambiguous", "not_found"). */
  errorCode?: string;
  errorMessage?: string;
  /** When set, the orchestrator emits `needs_disambiguation` and stops. */
  disambiguation?: { kind: string; options: Array<Record<string, unknown>> };
  /** When set, the orchestrator emits `needs_confirmation` and stops. */
  confirmation?: {
    summary: string;
    diff: Record<string, unknown>;
    /** The exact pending mutation to replay on confirm. */
    pending: { tool: string; input: Record<string, unknown> };
  };
  /**
   * Task #340 — when set, the orchestrator emits a `needs_clarification`
   * SSE frame and pauses the turn `awaiting_clarification`. The next
   * user message is treated as the missing field's value and re-merged
   * into `partial` before re-invoking the originating tool.
   */
  clarification?: {
    field: string;
    question: string;
    tool: string;
    partial?: Record<string, unknown>;
    suggestions?: Array<{ id: string; label: string; hint?: string }>;
  };
  /**
   * Task #340 — graceful refusal envelope. The orchestrator emits a
   * `refusal` frame that the client renders with a "Request this
   * capability" CTA bound to meta.request_feature.
   */
  refusal?: {
    reason: string;
    closestCapabilityId?: string | null;
    pageHref?: string | null;
    suggestion?: string | null;
  };
}

// ---- Tool: present_choices (no-op, used by the model to surface chips) ----

const presentChoices: ToolDef = {
  name: "present_choices",
  description:
    "Display a small set of chips/buttons for the user to pick from. Returns the same options unchanged so the UI can render them; the user's pick comes back as the next turn.",
  input_schema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "One-line question to the user." },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            sub: { type: "string", description: "Optional subtitle / hint." },
          },
          required: ["id", "label"],
        },
      },
    },
    required: ["prompt", "options"],
  },
  isWrite: false,
  async run(input) {
    const options = (input.options ?? []) as Array<Record<string, unknown>>;
    return {
      ok: true,
      data: { prompt: input.prompt, options },
      disambiguation: { kind: "choice", options },
    };
  },
};

// ---- Tool: resolve_account_by_name ----

const resolveAccountByName: ToolDef = {
  name: "resolve_account_by_name",
  description:
    "Resolve a free-text account name to an account row. Returns disambiguation when more than one matches.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  isWrite: false,
  async run(input, ctx) {
    const q = String(input.query ?? "").trim();
    if (!q) return { ok: false, errorCode: "empty_query", errorMessage: "query required" };
    const rows = await db
      .select({
        id: atelierAccounts.id,
        name: atelierAccounts.name,
        sector: atelierAccounts.sector,
        country: atelierAccounts.country,
      })
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.orgId, ctx.persona.orgId),
          isNull(atelierAccounts.deletedAt),
          or(
            ilike(atelierAccounts.name, `%${q}%`),
            ilike(atelierAccounts.brandName, `%${q}%`),
          ),
        ),
      )
      .limit(6);
    if (rows.length === 0)
      return { ok: false, errorCode: "not_found", errorMessage: `no account matching "${q}"` };
    if (rows.length > 1) {
      return {
        ok: true,
        data: { matched: rows },
        disambiguation: {
          kind: "account",
          options: rows.map((r) => ({
            id: r.id,
            label: r.name,
            sub: `${r.sector} · ${r.country}`,
          })),
        },
      };
    }
    return { ok: true, data: { account: rows[0] } };
  },
};

// ---- Tool: list_my_open_raid_items ----

const listMyOpenRaidItems: ToolDef = {
  name: "list_my_open_raid_items",
  description:
    "List open RAID items owned by the current user across engagements they have access to.",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    },
  },
  isWrite: false,
  async run(input, ctx) {
    const limit = Math.min(50, Math.max(1, Number(input.limit ?? 10)));
    const accessRows = await db
      .select({ engagementId: atelierEngagementAccess.engagementId })
      .from(atelierEngagementAccess)
      .where(
        and(
          eq(atelierEngagementAccess.userId, ctx.persona.id),
          eq(atelierEngagementAccess.status, "active"),
          isNull(atelierEngagementAccess.deletedAt),
        ),
      );
    const engIds = accessRows.map((r) => r.engagementId);
    // For partner/leadership we don't narrow by engagement_access.
    const isLeadership =
      ctx.persona.role === "founding_partner" || ctx.persona.role === "partner";
    const baseFilters = [
      eq(atelierRaidItems.orgId, ctx.persona.orgId),
      eq(atelierRaidItems.ownerId, ctx.persona.id),
      eq(atelierRaidItems.status, "open"),
      isNull(atelierRaidItems.deletedAt),
    ];
    const whereExpr =
      isLeadership || engIds.length === 0
        ? and(...baseFilters)
        : and(...baseFilters, inArray(atelierRaidItems.engagementId, engIds));
    const rows = await db
      .select({
        id: atelierRaidItems.id,
        kind: atelierRaidItems.kind,
        severity: atelierRaidItems.severity,
        engagementId: atelierRaidItems.engagementId,
        description: atelierRaidItems.description,
        dueDate: atelierRaidItems.dueDate,
      })
      .from(atelierRaidItems)
      .where(whereExpr)
      .orderBy(desc(atelierRaidItems.createdAt))
      .limit(limit);
    return { ok: true, data: { items: rows, count: rows.length } };
  },
};

// ---- Tool: add_raid_item (write — uses confirm protocol) ----

const RAID_KINDS = ["risk", "assumption", "issue", "dependency"] as const;
const RAID_SEVERITY = ["green", "amber", "red"] as const;

const addRaidItem: ToolDef = {
  name: "add_raid_item",
  description:
    "Add a RAID item (risk/assumption/issue/dependency) to an engagement. Two-phase: first call returns a confirmation diff, second call (with confirm=true) commits.",
  input_schema: {
    type: "object",
    properties: {
      engagementId: { type: "string" },
      kind: { type: "string", enum: [...RAID_KINDS] },
      severity: { type: "string", enum: [...RAID_SEVERITY] },
      description: { type: "string", minLength: 1 },
      ownerUserId: { type: "string" },
      dueDate: { type: "string", description: "YYYY-MM-DD" },
      confirm: {
        type: "boolean",
        description: "Set true on the second call to commit.",
      },
    },
    required: ["engagementId", "kind", "severity", "description"],
  },
  isWrite: true,
  async run(input, ctx) {
    const engagementId = String(input.engagementId ?? "");
    const kind = String(input.kind ?? "");
    const severity = String(input.severity ?? "");
    const description = String(input.description ?? "").trim();
    if (!engagementId || !description)
      return { ok: false, errorCode: "invalid_input", errorMessage: "engagementId + description required" };
    if (!(RAID_KINDS as readonly string[]).includes(kind))
      return { ok: false, errorCode: "invalid_input", errorMessage: `kind must be one of ${RAID_KINDS.join("/")}` };
    if (!(RAID_SEVERITY as readonly string[]).includes(severity))
      return { ok: false, errorCode: "invalid_input", errorMessage: `severity must be one of ${RAID_SEVERITY.join("/")}` };
    // Engagement must exist + be in the persona's org.
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.id, engagementId),
          eq(atelierEngagements.orgId, ctx.persona.orgId),
          isNull(atelierEngagements.deletedAt),
        ),
      )
      .limit(1);
    if (!eng)
      return { ok: false, errorCode: "not_found", errorMessage: `engagement ${engagementId} not found` };

    const ownerUserId = (input.ownerUserId as string | undefined) ?? ctx.persona.id;
    const dueDate = (input.dueDate as string | undefined) ?? null;
    const confirmed = input.confirm === true;

    if (!confirmed) {
      // First phase — return a confirmation diff.
      return {
        ok: true,
        data: { phase: "preview" },
        confirmation: {
          summary: `Add ${kind} (${severity}) to ${eng.name}: ${description.slice(0, 120)}`,
          diff: {
            engagementId,
            engagementName: eng.name,
            kind,
            severity,
            description,
            ownerUserId,
            dueDate,
          },
          pending: {
            tool: "add_raid_item",
            input: { ...input, confirm: true },
          },
        },
      };
    }

    // Second phase — commit. Idempotency via atelier_cli_jobs is recorded
    // by the orchestrator before this point; here we just insert.
    const id = rid("raid");
    const [row] = await db
      .insert(atelierRaidItems)
      .values({
        id,
        engagementId,
        kind,
        severity,
        status: "open",
        ownerId: ownerUserId,
        description,
        dueDate,
        createdByUserId: ctx.persona.id,
      })
      .returning();
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "engagement",
      entityId: engagementId,
      actorType: "human",
      actorId: ctx.persona.id,
      actorLabel: ctx.persona.name,
      action: `raid.create.${kind}`,
      payload: { id, severity, description, viaCli: true, turnId: ctx.turnId },
      payloadSummary: `${kind} (${severity}) via CLI: ${description.slice(0, 120)}`,
    });
    return { ok: true, data: { committed: true, raid: row } };
  },
};

export const TOOL_REGISTRY: Record<string, ToolDef> = {
  [presentChoices.name]: presentChoices,
  [resolveAccountByName.name]: resolveAccountByName,
  [listMyOpenRaidItems.name]: listMyOpenRaidItems,
  [addRaidItem.name]: addRaidItem,
};

/**
 * Task #332 — Per-turn tool list. Merges the legacy starter
 * TOOL_REGISTRY (Task #331 contract) with the new catalog entries,
 * filtered by the persona's role perimeter. The catalog is the long-
 * term source of truth; TOOL_REGISTRY remains exported for tests +
 * for any consumer the spine has already grown.
 */
export function getToolsForPersona(persona: CliPersona): ToolDef[] {
  const seenNames = new Set<string>();
  const out: ToolDef[] = [];
  for (const entry of capabilitiesForPersona(persona)) {
    if (seenNames.has(entry.toolName)) continue;
    // Task #484 — strip legacy chat-write tools whose (kind, verb) is
    // now owned by propose_write. Without this gate, the chat surface
    // that Sonnet sees still includes account_create, opportunity_create,
    // etc., and the system-prompt instruction "use propose_write" is
    // brittle under the synthetic-history bias documented in #484.
    // Slash-command and direct-typed routes still resolve these via
    // findToolByName (which falls back to the catalog when no persona
    // is supplied), so undo, /new, and the typed dispatcher all keep
    // working.
    if (
      entry.isWrite &&
      entry.module !== "meta" &&
      !ALWAYS_INCLUDE_TOOLS.has(entry.toolName) &&
      LEGACY_DISPATCH_TARGETS.has(entry.toolName)
    ) {
      continue;
    }
    seenNames.add(entry.toolName);
    out.push({
      name: entry.toolName,
      description: entry.description,
      input_schema: entry.inputSchema,
      isWrite: entry.isWrite,
      run: entry.run,
    });
  }
  // Legacy registry is appended last while the catalog is still being
  // rolled out (downstream tasks #333-335 graduate the rest). Read
  // tools fall through to every persona; legacy writes are denied to
  // strictly read-only roles (board_observer). New writes must always
  // declare themselves in the catalog so their irreversibility +
  // outbound channel + typed-name policy is explicit — but until the
  // catalog covers the entire surface we keep the existing guarantee
  // that pre-Task-332 writes still work for the personas that had
  // them.
  const READ_ONLY_ROLES = new Set(["board_observer"]);
  for (const t of Object.values(TOOL_REGISTRY)) {
    if (seenNames.has(t.name)) continue;
    if (t.isWrite && READ_ONLY_ROLES.has(persona.role)) continue;
    // Same legacy-chat-write strip as above (TOOL_REGISTRY currently
    // holds only reads, but kept here as defense-in-depth in case a
    // future contributor adds a legacy write).
    if (
      t.isWrite &&
      !ALWAYS_INCLUDE_TOOLS.has(t.name) &&
      LEGACY_DISPATCH_TARGETS.has(t.name)
    ) {
      continue;
    }
    seenNames.add(t.name);
    out.push(t);
  }
  return out;
}

/**
 * Task #332 — Resolve a tool by name, scoped to a persona's allowed
 * surface. Used by the confirm-phase replay and by the per-tool-call
 * lookup inside runTurn so the model can never invoke a capability
 * its persona was not granted (defense-in-depth for the catalog).
 */
export function findToolByName(
  name: string,
  persona?: CliPersona,
): ToolDef | undefined {
  if (persona) {
    const fromSurface = getToolsForPersona(persona).find((t) => t.name === name);
    if (fromSurface) return fromSurface;
    // Task #484 — fall through to the catalog when the persona-filtered
    // chat surface misses. `getToolsForPersona` strips legacy
    // chat-write tools (account_create, opportunity_create, …) so they
    // never reach the model's tool list, but the propose_write commit
    // dispatcher still needs to RUN those tools in-process. Resolving
    // them via the catalog here preserves chat-surface filtering AND
    // dispatch resolution simultaneously.
  }
  const cat = findByToolName(name);
  if (cat) {
    return {
      name: cat.toolName,
      description: cat.description,
      input_schema: cat.inputSchema,
      isWrite: cat.isWrite,
      run: cat.run,
    };
  }
  return TOOL_REGISTRY[name];
}

/** Returns true iff the tool is registered as irreversible in the catalog. */
export function isIrreversibleTool(name: string): boolean {
  return findByToolName(name)?.irreversible === true;
}

// =====================================================================
// 4. Concurrency lock + budget
// =====================================================================

/**
 * Per-user FIFO queue. The CLI must serialize turns per user (so a slow
 * write does not race a follow-up edit), but we never want to outright
 * reject — the spec calls for FIFO with an opt-in "cancel current and run
 * instead" path.
 *
 *   inflight    : userId -> { startedAt, abort }   currently-running turn
 *   waiters     : userId -> Array<resolver>        FIFO queue tail
 */
type InflightSlot = { startedAt: number; abort: () => void };
const inflight = new Map<string, InflightSlot>();
const waiters = new Map<string, Array<() => void>>();
const STALE_INFLIGHT_MS = Math.max(HARD_WALL_MS + 30_000, 180_000);

function takeSlotImmediate(userId: string, abort: () => void): void {
  inflight.set(userId, { startedAt: Date.now(), abort });
}

async function enterQueue(
  userId: string,
  opts: { cancelInflight?: boolean; abort: () => void },
): Promise<void> {
  const cur = inflight.get(userId);
  if (cur && Date.now() - cur.startedAt > STALE_INFLIGHT_MS) {
    inflight.delete(userId);
  }
  if (!inflight.get(userId)) {
    takeSlotImmediate(userId, opts.abort);
    return;
  }
  if (opts.cancelInflight) {
    try {
      cur?.abort?.();
    } catch {
      /* ignore */
    }
    // Wait briefly for the cancelled turn to release.
    const deadline = Date.now() + 5_000;
    while (inflight.get(userId) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!inflight.get(userId)) {
      takeSlotImmediate(userId, opts.abort);
      return;
    }
  }
  // FIFO wait.
  await new Promise<void>((resolve) => {
    const arr = waiters.get(userId) ?? [];
    arr.push(resolve);
    waiters.set(userId, arr);
  });
  takeSlotImmediate(userId, opts.abort);
}

function releaseSlot(userId: string): void {
  inflight.delete(userId);
  const arr = waiters.get(userId);
  if (arr && arr.length > 0) {
    const next = arr.shift()!;
    if (arr.length === 0) waiters.delete(userId);
    else waiters.set(userId, arr);
    next();
  }
}

/**
 * Atomic idempotent job runner.
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING RETURNING to claim ownership of an
 * idempotencyKey. Only the claimer executes the underlying tool — concurrent
 * losers poll the existing row until it reaches a terminal state (success
 * or error) and replay the recorded result. Prevents duplicate side effects
 * under concurrent retry.
 */
async function runIdempotentJob(args: {
  idemKey: string;
  orgId: string;
  turnId: string;
  sessionId: string;
  userId: string;
  kind: string;
  input: Record<string, unknown>;
  run: () => Promise<ToolResult>;
}): Promise<ToolResult & { replayedIdempotent?: boolean }> {
  // Try to atomically claim the slot.
  const claimed = await db
    .insert(atelierCliJobs)
    .values({
      id: rid("clij"),
      orgId: args.orgId,
      turnId: args.turnId,
      sessionId: args.sessionId,
      userId: args.userId,
      kind: args.kind,
      status: "running",
      input: args.input,
      idempotencyKey: args.idemKey,
      startedAt: new Date(),
    })
    .onConflictDoNothing({ target: atelierCliJobs.idempotencyKey })
    .returning({ id: atelierCliJobs.id });

  if (claimed.length === 0) {
    // Lost the race. Poll the existing row until terminal, then replay.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const [existing] = await db
        .select()
        .from(atelierCliJobs)
        .where(eq(atelierCliJobs.idempotencyKey, args.idemKey))
        .limit(1);
      if (existing && existing.status === "success") {
        return { ok: true, data: existing.result as unknown, replayedIdempotent: true };
      }
      if (existing && existing.status === "error") {
        return {
          ok: false,
          errorCode: "prior_attempt_failed",
          errorMessage: existing.error ?? "prior attempt failed",
          replayedIdempotent: true,
        };
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return {
      ok: false,
      errorCode: "idem_timeout",
      errorMessage: "concurrent job did not complete within 30s",
    };
  }

  // We own the claim — execute exactly once and persist outcome.
  try {
    const out = await args.run();
    await db
      .update(atelierCliJobs)
      .set({
        status: out.ok ? "success" : "error",
        result: out.data ?? null,
        error: out.ok ? null : out.errorMessage ?? null,
        finishedAt: new Date(),
      })
      .where(eq(atelierCliJobs.idempotencyKey, args.idemKey));
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(atelierCliJobs)
      .set({ status: "error", error: msg, finishedAt: new Date() })
      .where(eq(atelierCliJobs.idempotencyKey, args.idemKey))
      .catch(() => undefined);
    throw err;
  }
}

async function ensureSessionBudget(sessionId: string): Promise<{
  spentCents: number;
  limitCents: number;
}> {
  const limitCents = Math.round(SESSION_DAILY_BUDGET_USD * 100);
  const [row] = await db
    .select({
      spent: atelierCliSessions.spentCentsToday,
      day: atelierCliSessions.spentCentsDay,
    })
    .from(atelierCliSessions)
    .where(eq(atelierCliSessions.id, sessionId))
    .limit(1);
  if (!row) return { spentCents: 0, limitCents };
  const today = todayUtc();
  if (row.day !== today) {
    await db
      .update(atelierCliSessions)
      .set({ spentCentsToday: 0, spentCentsDay: today })
      .where(eq(atelierCliSessions.id, sessionId));
    return { spentCents: 0, limitCents };
  }
  const spentCents = Number(row.spent) || 0;
  if (spentCents >= limitCents)
    throw new CliBudgetExceededError(spentCents / 100, limitCents / 100);
  return { spentCents, limitCents };
}

async function chargeSession(sessionId: string, costCents: number): Promise<void> {
  if (!costCents) return;
  const today = todayUtc();
  const [row] = await db
    .select({
      spent: atelierCliSessions.spentCentsToday,
      day: atelierCliSessions.spentCentsDay,
    })
    .from(atelierCliSessions)
    .where(eq(atelierCliSessions.id, sessionId))
    .limit(1);
  if (!row) return;
  const sameDay = row.day === today;
  const next = (sameDay ? Number(row.spent) || 0 : 0) + costCents;
  await db
    .update(atelierCliSessions)
    .set({ spentCentsToday: next, spentCentsDay: today, updatedAt: new Date() })
    .where(eq(atelierCliSessions.id, sessionId));
}

/**
 * Per-user, per-day turn cap. Counts terminal turn rows for `userId` since
 * UTC midnight; throws CliQuotaExceededError when the cap is reached. This
 * is a coarse guardrail meant to catch runaway clients.
 */
async function ensureUserDailyQuota(userId: string): Promise<void> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: atelierCliTurns.id })
    .from(atelierCliTurns)
    .where(
      and(
        eq(atelierCliTurns.userId, userId),
        gte(atelierCliTurns.createdAt, since),
      ),
    );
  if (rows.length >= PER_USER_DAILY_TURN_CAP) {
    throw new CliQuotaExceededError(rows.length, PER_USER_DAILY_TURN_CAP);
  }
}

// =====================================================================
// 5. Sessions
// =====================================================================

/**
 * Inactivity-reset window: after this many ms of silence, the next call
 * with the same sessionId rolls over to a brand-new session row. Default
 * 30 minutes; override via `ATELIER_CLI_SESSION_INACTIVITY_MS`.
 */
const SESSION_INACTIVITY_MS = Number(
  process.env.ATELIER_CLI_SESSION_INACTIVITY_MS ?? 30 * 60_000,
);

export async function getOrCreateSession(
  persona: CliPersona,
  sessionId: string | null | undefined,
  opts?: { forceNew?: boolean },
): Promise<typeof atelierCliSessions.$inferSelect> {
  if (sessionId && !opts?.forceNew) {
    const [row] = await db
      .select()
      .from(atelierCliSessions)
      .where(
        and(
          eq(atelierCliSessions.id, sessionId),
          eq(atelierCliSessions.orgId, persona.orgId),
          eq(atelierCliSessions.userId, persona.id),
          isNull(atelierCliSessions.deletedAt),
        ),
      )
      .limit(1);
    if (row) {
      const lastTouch = (row.lastTurnAt ?? row.updatedAt ?? row.createdAt) as Date | null;
      const idleMs = lastTouch ? Date.now() - new Date(lastTouch).getTime() : 0;
      if (idleMs <= SESSION_INACTIVITY_MS) return row;
      // Inactivity rollover: soft-delete the stale session and fall
      // through to mint a fresh one. Keeps audit history intact.
      await db
        .update(atelierCliSessions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierCliSessions.id, row.id));
    }
  }
  const id = rid("clis");
  const [row] = await db
    .insert(atelierCliSessions)
    .values({
      id,
      orgId: persona.orgId,
      userId: persona.id,
      createdByUserId: persona.id,
      spentCentsDay: todayUtc(),
    })
    .returning();
  return row;
}

// =====================================================================
// 6. Loop
// =====================================================================

const SYSTEM_PROMPT = [
  "You are the Atelier CLI orchestrator. Help the user accomplish a task using the tools you are given.",
  "Be concise. Prefer one tool call per step.",
  "HARD RULES — these are non-negotiable:",
  "1. NEVER invent identifiers (engagement IDs, account IDs, user IDs, RAID IDs, etc.).",
  "   If you do not have an explicit ID from the user or from a prior tool result in this",
  "   turn, you MUST call a resolver tool (e.g. `resolve_account_by_name`) FIRST.",
  "2. RESOLVER-BEFORE-WRITE: every write tool call MUST be preceded — in this same turn —",
  "   by a resolver/lookup that produced the IDs the write depends on. Do not guess.",
  "3. AMBIGUITY: when more than one plausible target exists, you MUST call",
  "   `present_choices` and STOP. Do not pick one arbitrarily.",
  "4. PREFER LIVE LOOKUP: rolling-summary primers and prior-turn context are hints only.",
  "   When acting on entities, re-fetch via the appropriate read tool rather than relying",
  "   on summarized or stale data.",
  "5. CONFIRMATION: when a write-tool returns a confirmation diff, STOP and let the user",
  "   confirm — do not retry, do not re-call the tool.",
  "6. DISAMBIGUATION: when a tool returns disambiguation options, STOP and let the user",
  "   pick — do not guess.",
  "Wrap up with a one-line `final` narration that summarises what happened.",
  "",
  // Task #406 — Chat Orchestrator policy. When the user's prompt is a
  // create | update | link | transition verb, follow this loop:
  //   1) resolve_entity (fuzzy → id; STOP on disambiguation)
  //   2) prefill_from_specialist (advisory; once per turn, before create)
  //   3) evaluate_gate (transitions ONLY; never auto-set partnerOverride)
  //   4) propose_write (two-phase confirm; commit returns dispatch hint)
  // The orchestrator NEVER writes directly — propose_write hands off to
  // the existing entity route on commit.
  "ORCHESTRATOR POLICY (create | update | link | transition):",
  "- For any verb that mentions an entity by fuzzy name, call `resolve_entity` FIRST.",
  "  If it returns disambiguation options, STOP and let the user pick.",
  "- For ANY stage transition, call `evaluate_gate` BEFORE `propose_write`. If a gate is",
  "  unmet, ask the user for the missing evidence. NEVER set `partnerOverride: true` on",
  "  the user's behalf — partner override is a deliberate human action.",
  "- Wrap every mutation in `propose_write` with a clear one-line summary so the user",
  "  reviews the diff and clicks Commit. Do not call entity write routes directly.",
  "- Terminal-stage transitions (lost / no_decision / withdrawn) ALWAYS need a `reasonCode`.",
  "",
  "ACCOUNT CREATION — RESEARCH-THEN-PROPOSE FLOW (terminal at prefill):",
  "- For verb=`create` + kind=`account`, call EXACTLY ONE tool and then STOP:",
  "  1. Call `prefill_from_specialist` with `{ kind: \"account\", input: { name: <user fragment>, country: <user country if stated> } }`.",
  "     This dispatches the Account Cartographer in research-only mode (real web search via Claude). It typically takes",
  "     30–70 seconds — this latency is REQUIRED for the user to get real research. It returns a `draft` (canonical",
  "     `name`, `country`, `sector`, `hqCity`, `tier`, `industryCode`, `strategicPriorities`, `sourceSignals`,",
  "     `decisionMakers`, `cogniriseHypothesis`, `researchBrief`) and renders an `account_proposal` card in the UI.",
  "  2. DO NOT call `propose_write`, `account_create`, or any write tool for an account create. The proposal card itself",
  "     carries a \"Review & Create\" button: the partner reviews the researched draft, the pre-populated CreateAccountDialog",
  "     opens (partner-owner defaulted to them), and the row is written through the standard account route. Your job ends",
  "     at the research step.",
  "- After `prefill_from_specialist` returns `{ ok: true }`, write a SHORT final message (1–2 sentences) summarising what",
  "  the Cartographer found (canonical name + sector + the sharpest mandate angle or why-now) and tell the user to review",
  "  the proposal card and click \"Review & Create\". Do NOT call another tool.",
  "- If `prefill_from_specialist` returns `{ ok: false }`, surface the error to the user and STOP. Do not fall back to",
  "  a name-only write.",
  "",
  "WORKED EXAMPLE — \"Add new account: ministry of energy in uae\":",
  "  Step 1 → prefill_from_specialist({ kind: \"account\", input: { name: \"ministry of energy in uae\" } })",
  "  Step 2 → STOP. Reply: \"Researched the UAE Ministry of Energy and Infrastructure (Government — Energy). Review the",
  "  proposal card below and click Review & Create to add it.\" Never call a write tool for an account create.",
  "",
  "ENTITY NORMALISATION (account creation — fallback only if prefill is unavailable):",
  "- The Cartographer normally produces the canonical name and country, so use the prefill draft values.",
  "- If you ever have to construct a name yourself, expand abbreviations (uae → United Arab Emirates, ksa → Saudi Arabia,",
  "  etc.) and use English title-case. Never propagate the raw lowercase fragment.",
  "- If the user-provided fragment is genuinely ambiguous between two real entities, call `present_choices` first.",
].join("\n");

interface ClaudeToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ClaudeStep {
  text: string;
  toolCall: ClaudeToolCall | null;
  /** Stop reason from the model: end_turn | tool_use | aborted. */
  stop: "end_turn" | "tool_use" | "aborted";
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  /** Raw stop_reason for diagnostics. */
  stopReason?: string | null;
  /** Real model identifier returned by the Anthropic API for this step. */
  model: string;
}

/** Abstract model dispatch (live Sonnet/Haiku via Anthropic SDK). */
async function modelStep(args: {
  history: Array<{ role: "user" | "assistant"; content: unknown }>;
  tools: ToolDef[];
  intent: string | null;
  /** Task #411 — tier router: "haiku" for reads, "sonnet" for writes/transitions. */
  tier?: "haiku" | "sonnet";
  /** Task #411 — extra context block (entity neighbourhood) appended to the system prompt. */
  contextBlock?: string | null;
}): Promise<ClaudeStep> {
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Number(process.env.ATELIER_CLI_TIMEOUT_MS ?? 30_000));
  // Retry-with-jitter on transient upstream failures (5xx / network / 429).
  // Permanent errors (4xx other than 429) bubble up immediately.
  const MAX_TOKENS = Number(process.env.ATELIER_CLI_MAX_TOKENS ?? 2048);
  const RETRY_MAX = Number(process.env.ATELIER_CLI_RETRY_MAX ?? 2);
  const isTransient = (e: unknown): boolean => {
    const err = e as { status?: number; name?: string; message?: string };
    if (err?.name === "AbortError") return false;
    const s = err?.status ?? 0;
    if (s === 429) return true;
    if (s >= 500 && s < 600) return true;
    const msg = String(err?.message ?? "");
    return /ECONNRESET|ETIMEDOUT|ENETUNREACH|fetch failed/i.test(msg);
  };
  // Task #411 — tier router. Reads land on Haiku (cheap), writes /
  // transitions on Sonnet. Override via ATELIER_CLI_MODEL still wins.
  const tier = args.tier ?? "sonnet";
  const haikuModel = process.env.ATELIER_CLI_HAIKU_MODEL ?? "claude-haiku-4-5";
  const sonnetModel = process.env.ATELIER_CLI_MODEL ?? "claude-sonnet-4-5";
  const chosenModel = tier === "haiku" ? haikuModel : sonnetModel;
  // Task #411 — prompt caching. The system prompt + tool block are
  // stable per turn (and across most turns within a session), so we
  // mark each as `cache_control: { type: "ephemeral" }` to amortise
  // the input-token cost. Tools change per-turn via the retriever so
  // the cache prefix only matches when the surfaced set repeats; the
  // anthropic SDK silently ignores the marker when caching is off.
  const systemText =
    SYSTEM_PROMPT +
    (args.contextBlock ? `\n\n${args.contextBlock}` : "") +
    (args.intent ? `\n\nUser intent: ${args.intent}` : "");
  const systemBlocks = [
    { type: "text" as const, text: systemText, cache_control: { type: "ephemeral" as const } },
  ];
  const toolsForCall = args.tools.map((t, i) => {
    const base = {
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Record<string, unknown>,
    };
    // Mark only the LAST tool with cache_control — that creates one
    // cache breakpoint covering the whole tool block.
    return i === args.tools.length - 1
      ? { ...base, cache_control: { type: "ephemeral" as const } }
      : base;
  });
  type MsgCreateParams = Parameters<typeof anthropic.messages.create>[0];
  const callOnce = () =>
    anthropic.messages.create(
      {
        model: chosenModel,
        max_tokens: MAX_TOKENS,
        // The Anthropic SDK accepts either `string` or
        // `TextBlockParam[]` as the `system` field. We pass an array
        // here so we can attach `cache_control` to the system block.
        system: systemBlocks as MsgCreateParams["system"],
        tools: toolsForCall as MsgCreateParams["tools"],
        messages: args.history as MsgCreateParams["messages"],
      },
      { signal: ac.signal },
    );
  try {
    let resp;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        resp = await callOnce();
        break;
      } catch (err) {
        if (attempt >= RETRY_MAX || !isTransient(err)) throw err;
        const baseMs = 250 * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, baseMs + jitter));
        attempt++;
      }
    }
    let text = "";
    let toolCall: ClaudeToolCall | null = null;
    for (const block of resp.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCall = {
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) ?? {},
        };
      }
    }
    const tokensIn = resp.usage.input_tokens;
    const tokensOut = resp.usage.output_tokens;
    const model = resp.model ?? "";
    const inRate = model.includes("haiku") ? 1 : 3;
    const outRate = model.includes("haiku") ? 5 : 15;
    const costUsd = (tokensIn * inRate + tokensOut * outRate) / 1_000_000;
    // Map Anthropic stop_reasons. Only `tool_use` continues the loop;
    // `end_turn` ends cleanly. `max_tokens`/`pause_turn`/`refusal`/etc.
    // surface as an explicit aborted step so the orchestrator can mark
    // the turn `partial` instead of silently succeeding.
    let stop: "tool_use" | "end_turn" | "aborted";
    if (resp.stop_reason === "tool_use") stop = "tool_use";
    else if (resp.stop_reason === "end_turn" || resp.stop_reason === "stop_sequence") stop = "end_turn";
    else stop = "aborted";
    // If the model emitted a tool_use block alongside an unsupported
    // stop reason (e.g. max_tokens), still execute the tool — but mark
    // aborted on the next iteration if the model bails.
    if (toolCall && stop === "aborted") stop = "tool_use";
    return { text: text.trim(), toolCall, stop, costUsd, tokensIn, tokensOut, stopReason: resp.stop_reason ?? null, model: model || chosenModel };
  } finally {
    clearTimeout(timer);
  }
}

// =====================================================================
// Task #338 — Natural-language → catalog routing.
//
// `routePromptToCapability` is a pure heuristic that maps an unstructured
// prompt to a capability + extracted input. Available as a pre-filter
// for the live model. Each branch picks the first thing that matches
// and stops — keep cheap+deterministic.
// =====================================================================

export interface RoutedCapability {
  toolName: string;
  input: Record<string, unknown>;
  /** Confidence: 'high' = strong keyword + entity, 'low' = best-effort. */
  confidence: "high" | "low";
}

function captureAfter(text: string, ...keys: string[]): string | null {
  for (const k of keys) {
    const re = new RegExp(`${k}\\s+(?:for\\s+)?["']?([\\p{L}0-9 ._@'’\\-]{2,80})["']?`, "iu");
    const m = text.match(re);
    if (m && m[1]) return m[1].trim().replace(/[.?!]+$/, "");
  }
  return null;
}

function findEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : null;
}

function findIdLike(text: string, prefixes: string[]): string | null {
  for (const p of prefixes) {
    const m = text.match(new RegExp(`\\b${p}[-_][a-z0-9_]+\\b`, "i"));
    if (m) return m[0];
  }
  return null;
}

function findMoney(text: string): { amount: number; currency: string } | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(usd|aed|sar|eur|gbp|mad|try|jpy|inr|cny)\b/i);
  if (m) return { amount: Number(m[1]), currency: m[2]!.toUpperCase() };
  const m2 = text.match(/\b(usd|aed|sar|eur|gbp|mad|try)\s*(\d+(?:\.\d+)?)/i);
  if (m2) return { amount: Number(m2[2]), currency: m2[1]!.toUpperCase() };
  return null;
}

export function routePromptToCapability(promptRaw: string): RoutedCapability | null {
  const p = promptRaw.toLowerCase().trim();
  if (!p) return null;

  // ---- Account create ----------------------------------------------
  // Two phrasings supported:
  //   (a) "Add Ministry of Energy in the UAE as a new account"
  //   (b) "Create account Ministry of Energy" / "New account for Acme"
  if (/(add|create|new|register)\s+(a\s+)?(new\s+)?account\b/.test(p) ||
      /(add|create|register)\b.+\bas\s+(a\s+)?(new\s+)?account\b/i.test(promptRaw)) {
    // Prefer the "X as a new account" pattern — it carries the entity
    // name in the head rather than the tail.
    const asAccountMatch = promptRaw.match(
      /(?:add|create|register)\s+(?:a\s+|the\s+)?(.+?)\s+(?:as\s+(?:a\s+)?(?:new\s+)?)?account\b/i,
    );
    let name =
      (asAccountMatch?.[1] ?? "").trim() ||
      captureAfter(promptRaw, "account") ||
      captureAfter(promptRaw, "for") ||
      "";
    // Strip a trailing "in <country>" so we can lift it into its own field.
    const countryMatch =
      name.match(/\s+in\s+(?:the\s+)?([\p{L} ]{2,40})$/iu) ??
      promptRaw.match(/\bin\s+(?:the\s+)?([A-Z][\p{L} ]{2,40})/u);
    if (countryMatch && name) {
      name = name.replace(/\s+in\s+(?:the\s+)?[\p{L} ]{2,40}$/iu, "").trim();
    }
    name = name.replace(/^a\s+new\s+/i, "").replace(/^new\s+/i, "").trim();
    const sectorMatch = promptRaw.match(/\b(?:sector|industry)\s+([\p{L} &/-]{2,40})/iu);
    return {
      toolName: "account_create",
      confidence: name ? "high" : "low",
      input: {
        name,
        country: countryMatch?.[1]?.trim() ?? "",
        sector: sectorMatch?.[1]?.trim() ?? "",
      },
    };
  }

  // ---- Opportunity create ------------------------------------------
  if (/(create|new|add)\s+(an?\s+)?(opp(ortunity)?|deal)\b/.test(p)) {
    const accName = captureAfter(promptRaw, "for") ?? "";
    const named = captureAfter(promptRaw, "opportunity", "opp") ?? "";
    return {
      toolName: "opportunity_create",
      confidence: accName ? "high" : "low",
      input: {
        name: named || `Opportunity for ${accName || "—"}`,
        accountQuery: accName,
      },
    };
  }

  // ---- Move stage ---------------------------------------------------
  if (/(move|change|set|advance|mark)\b.*\b(to|as)\s+(suspect|prospect|pursue|convert|propose|runner|negoti\w*|contract|won|lost|withdrawn|no\s+decision)/i.test(promptRaw)) {
    const oppId = findIdLike(promptRaw, ["opp"]);
    const m = promptRaw.match(/\b(?:to|as)\s+([A-Za-z _-]+?)(?:\.|$|\s*on\s|\s*because)/i);
    const stageWord = m?.[1]?.trim() ?? "";
    return {
      toolName: "opportunity_move_stage",
      confidence: oppId && stageWord ? "high" : "low",
      input: { opportunityId: oppId ?? "", toStage: stageWord },
    };
  }

  // ---- Capture meeting ---------------------------------------------
  if (/(log|capture|record|add)\s+(a\s+)?(discovery|workshop|kickoff|steering|meeting)/i.test(promptRaw)) {
    const oppId = findIdLike(promptRaw, ["opp", "eng"]);
    const parentType = oppId?.startsWith("eng") ? "engagement" : "opportunity";
    const dateMatch = promptRaw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    return {
      toolName: "opportunity_capture_meeting",
      confidence: oppId ? "high" : "low",
      input: {
        parentType,
        parentId: oppId ?? "",
        title: promptRaw.slice(0, 80),
        kind: /workshop/i.test(promptRaw) ? "workshop" : /kickoff/i.test(promptRaw) ? "kickoff" : /steering/i.test(promptRaw) ? "steering" : "discovery",
        date: dateMatch?.[1] ?? "",
      },
    };
  }

  // ---- Draft POV ----------------------------------------------------
  if (/(draft|start|new|create)\s+(a\s+)?(pov|point\s*of\s*view)/i.test(promptRaw)) {
    const oppId = findIdLike(promptRaw, ["opp"]) ?? "";
    const onMatch = promptRaw.match(/\bon\s+([\p{L}0-9 _-]{3,80})/iu);
    return {
      toolName: "opportunity_draft_pov",
      confidence: oppId ? "high" : "low",
      input: { opportunityId: oppId, title: onMatch?.[1]?.trim() ?? "POV draft" },
    };
  }

  // ---- Update qualifier --------------------------------------------
  if (/\b(qualify|qualifier|5c|five\s*c)\b/i.test(promptRaw)) {
    const oppId = findIdLike(promptRaw, ["opp"]) ?? "";
    return { toolName: "opportunity_update_qualifier", confidence: oppId ? "high" : "low", input: { opportunityId: oppId } };
  }

  // ---- Compose proposal --------------------------------------------
  if (/(compose|build|draft|create)\s+(a\s+)?proposal\b/i.test(promptRaw)) {
    const oppId = findIdLike(promptRaw, ["opp"]) ?? "";
    const forMatch = promptRaw.match(/for\s+(?:the\s+)?([A-Z0-9][\p{L}0-9 _-]{1,40})/u);
    return {
      toolName: "proposal_compose",
      confidence: oppId || forMatch ? "high" : "low",
      input: { opportunityId: oppId, title: `Proposal for ${forMatch?.[1]?.trim() ?? "opportunity"}` },
    };
  }

  // ---- Send proposal -----------------------------------------------
  if (/\bsend\b.*\bproposal\b/i.test(promptRaw)) {
    const proposalId = findIdLike(promptRaw, ["prop"]) ?? "";
    const email = findEmail(promptRaw) ?? "";
    return { toolName: "proposal_send", confidence: email ? "high" : "low", input: { proposalId, recipientEmail: email } };
  }

  // ---- Approve / reject / edit section -----------------------------
  if (/\b(approve|sign\s*off)\b.*\bsection\b/i.test(promptRaw)) {
    const sectionId = findIdLike(promptRaw, ["sec"]) ?? "";
    return { toolName: "proposal_approve_section", confidence: sectionId ? "high" : "low", input: { sectionId } };
  }
  if (/\breject\b.*\bsection\b/i.test(promptRaw)) {
    const sectionId = findIdLike(promptRaw, ["sec"]) ?? "";
    const rationale = promptRaw.split(/section[^:]*:/i)[1]?.trim() ?? "needs rework";
    return { toolName: "proposal_reject_section", confidence: sectionId ? "high" : "low", input: { sectionId, rationale } };
  }
  if (/\bedit\b.*\bsection\b/i.test(promptRaw)) {
    const sectionId = findIdLike(promptRaw, ["sec"]) ?? "";
    return { toolName: "proposal_edit_section", confidence: "low", input: { sectionId, content: promptRaw } };
  }

  // ---- Confirm assignments / partner final read / pricing ---------
  if (/\bconfirm\b.*\b(assignments|section\s+assignments)\b/i.test(promptRaw)) {
    const proposalId = findIdLike(promptRaw, ["prop"]) ?? "";
    return { toolName: "proposal_confirm_assignments", confidence: proposalId ? "high" : "low", input: { proposalId } };
  }
  if (/\b(partner\s+)?final\s+read\b/i.test(promptRaw)) {
    const proposalId = findIdLike(promptRaw, ["prop"]) ?? "";
    return { toolName: "proposal_final_read", confidence: proposalId ? "high" : "low", input: { proposalId } };
  }
  if (/\b(approve|sign\s*off)\b.*\bpricing\b/i.test(promptRaw)) {
    const proposalId = findIdLike(promptRaw, ["prop"]) ?? "";
    return { toolName: "proposal_approve_pricing", confidence: proposalId ? "high" : "low", input: { proposalId } };
  }
  if (/\boverride\b.*\bpricing\b/i.test(promptRaw)) {
    const proposalId = findIdLike(promptRaw, ["prop"]) ?? "";
    const rationale = promptRaw.split(/pricing[^:]*:/i)[1]?.trim() ?? "strategic override";
    return { toolName: "proposal_override_pricing", confidence: proposalId ? "high" : "low", input: { proposalId, rationale } };
  }

  // ---- Charter -----------------------------------------------------
  if (/\bredraft\b.*\bcharter\b/i.test(promptRaw) || /\b(re-?do)\b.*\bcharter\b/i.test(promptRaw)) {
    const engId = findIdLike(promptRaw, ["eng"]) ?? "";
    return { toolName: "engagement_redraft_charter", confidence: engId ? "high" : "low", input: { engagementId: engId } };
  }
  if (/\bapprove\b.*\bcharter\b/i.test(promptRaw)) {
    const engId = findIdLike(promptRaw, ["eng"]) ?? "";
    const versionId = findIdLike(promptRaw, ["chart", "v"]) ?? "";
    const role = /partner/i.test(promptRaw) ? "partner" : "lead";
    return { toolName: "engagement_approve_charter", confidence: engId ? "high" : "low", input: { engagementId: engId, versionId, role } };
  }

  // ---- RAID close --------------------------------------------------
  if (/\bclose\b.*\braid\b/i.test(promptRaw) || /\bclose\s+(item|risk|issue|raid)\s+/i.test(promptRaw)) {
    const raidId = findIdLike(promptRaw, ["raid", "r"]) ?? "";
    return { toolName: "raid_close", confidence: raidId ? "high" : "low", input: { raidId } };
  }

  // ---- Deliverable -------------------------------------------------
  if (/(create|new|add)\s+(a\s+)?(deliverable|decision\s*memo|diagnostic|final\s*readout)/i.test(promptRaw)) {
    const engId = findIdLike(promptRaw, ["eng"]) ?? "";
    const typeMap: Array<[RegExp, string]> = [
      [/decision\s*memo/i, "decision_memo"],
      [/diagnostic/i, "diagnostic"],
      [/final\s*readout/i, "final_readout"],
      [/design/i, "design"],
      [/build/i, "build"],
      [/adoption/i, "adoption"],
    ];
    let type = "diagnostic";
    for (const [re, t] of typeMap) if (re.test(promptRaw)) { type = t; break; }
    const dueMatch = promptRaw.match(/due\s+(\d{4}-\d{2}-\d{2}|tomorrow|today|next\s+week)/i);
    return {
      toolName: "engagement_create_deliverable",
      confidence: engId ? "high" : "low",
      input: { engagementId: engId, type, name: type.replace(/_/g, " "), dueDate: dueMatch?.[1] ?? "" },
    };
  }

  // ---- Timesheet approve / reject ----------------------------------
  if (/(approve|sign\s*off)\b.*\btimesheet\b/i.test(promptRaw)) {
    const weekId = findIdLike(promptRaw, ["ts", "tsweek", "week"]) ?? "";
    const role = /partner/i.test(promptRaw) ? "partner" : "lead";
    return { toolName: "ledger_approve_timesheet", confidence: "low", input: { weekId, role } };
  }
  if (/\breject\b.*\btimesheet\b/i.test(promptRaw)) {
    const weekId = findIdLike(promptRaw, ["ts", "tsweek", "week"]) ?? "";
    const reason = promptRaw.split(/timesheet[^:]*:/i)[1]?.trim() ?? "needs rework";
    return { toolName: "ledger_reject_timesheet", confidence: "low", input: { weekId, reason } };
  }

  // ---- Wallet expense ----------------------------------------------
  if (
    /\b(expense|client\s*lunch|taxi|hotel|per\s*diem|mileage)\b/i.test(promptRaw) &&
    /\b(add|log|new|create|enter|record|capture)\b/i.test(promptRaw)
  ) {
    const money = findMoney(promptRaw);
    const dateMatch = promptRaw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const merchMatch = promptRaw.match(/\bat\s+([A-Z][\p{L}0-9 &.'-]{1,40})/u);
    const categoryMap: Record<string, string> = { lunch: "meals", taxi: "ground_transport", hotel: "lodging", "per diem": "per_diem" };
    let category = "other";
    for (const [k, v] of Object.entries(categoryMap)) if (promptRaw.toLowerCase().includes(k)) { category = v; break; }
    return {
      toolName: "wallet_create_expense",
      confidence: money ? "high" : "low",
      input: {
        amount: money?.amount ?? 0,
        currency: money?.currency ?? "USD",
        merchant: merchMatch?.[1]?.trim() ?? "",
        expenseDate: dateMatch?.[1] ?? "",
        category,
        description: promptRaw.slice(0, 160),
      },
    };
  }

  // ---- Cartographer / profile-update / disposition ----------------
  if (/(refresh|re-?run)\b.*\b(cartographer|carto)\b/i.test(promptRaw)) {
    const accId = findIdLike(promptRaw, ["acct", "acc"]) ?? "";
    const accQuery = captureAfter(promptRaw, "for", "on") ?? "";
    return { toolName: "account_refresh_cartographer", confidence: accId || accQuery ? "high" : "low", input: { accountId: accId, accountQuery: accQuery } };
  }
  if (/(approve|reject)\b.*\bprofile\s*update\b/i.test(promptRaw)) {
    const accId = findIdLike(promptRaw, ["acct", "acc"]) ?? "";
    const upId = findIdLike(promptRaw, ["ppu", "pu"]) ?? "";
    const decision = /approve/i.test(promptRaw) ? "approve" : "reject";
    return { toolName: "account_profile_update_decision", confidence: accId && upId ? "high" : "low", input: { accountId: accId, updateId: upId, decision } };
  }
  if (/(mark|set)\b.*\b(as\s+)?(champion|supporter|skeptic|blocker|neutral)\b/i.test(promptRaw) || /\bdisposition\b/i.test(promptRaw)) {
    const contactId = findIdLike(promptRaw, ["ctc", "contact"]) ?? "";
    const dispMatch = promptRaw.toLowerCase().match(/\b(champion|supporter|skeptic|blocker|neutral|unknown)\b/);
    return { toolName: "contact_update_disposition", confidence: contactId && dispMatch ? "high" : "low", input: { contactId, disposition: dispMatch?.[1] ?? "" } };
  }

  // ===================================================================
  // Task #341 — read-side intent routing.
  // Reads are dispatched by phrase patterns shared with the smoke
  // tests. None of these mutate state, so they're confidence:"high"
  // whenever the pattern matches; the orchestrator skips the
  // confirm phase entirely (isWrite:false in the catalog).
  // ===================================================================

  // Pipeline by stage / forecast.
  if (/\b(pipeline\s+forecast|weighted\s+forecast|forecast\s+summary)\b/i.test(promptRaw)) {
    return { toolName: "forecast_summary", confidence: "high", input: {} };
  }
  if (/\b(pipeline\s+by\s+stage|show\s+(?:the\s+)?pipeline|(my|our|the)\s+pipeline|in\s+pursue\s+right\s+now)\b/i.test(promptRaw)) {
    return { toolName: "pipeline_by_stage", confidence: "high", input: {} };
  }
  if (/\b(top\s+\d+\s+)?(opps?|opportunit\w+|deals?)\b.*\b(in|under|at)\s+(suspect|prospect|pursue|shape|identify|convert|propose|runner|negoti\w*|contract|won|lost|withdrawn)\b/i.test(promptRaw)) {
    const m = promptRaw.match(/\b(?:in|under|at)\s+(suspect|prospect|pursue|shape|identify|convert|propose|runner|negoti\w*|contract|won|lost|withdrawn)\b/i);
    const limMatch = promptRaw.match(/\btop\s+(\d{1,2})\b/i);
    return {
      toolName: "opportunity_list_by_stage",
      confidence: "high",
      input: { stage: (m?.[1] ?? "pursue").toLowerCase(), limit: limMatch ? Number(limMatch[1]) : 10 },
    };
  }

  // Active engagements.
  if (/\b(list|show)\s+(?:the\s+)?(active|in[- ]flight|current)\s+engagements?\b/i.test(promptRaw) || /\bengagements?\s+in\s+flight\b/i.test(promptRaw)) {
    return { toolName: "engagement_list_active", confidence: "high", input: {} };
  }

  // Utilization (firm vs person). Also matches "over-utilized",
  // "under-utilized", "bench" style questions which are firm-wide
  // by default.
  if (/\b((utilis|utiliz)ation|(over|under)[- ]?(utilis|utiliz)ed|on\s+the\s+bench)\b/i.test(promptRaw)) {
    const personId = findIdLike(promptRaw, ["person", "usr", "user"]) ?? "";
    if (personId) {
      return { toolName: "utilization_person", confidence: "high", input: { personId } };
    }
    if (/\bfor\s+(?!the\s+firm\b)\w+/i.test(promptRaw) && !/\b(firm|everyone|across)\b/i.test(promptRaw)) {
      return { toolName: "utilization_person", confidence: "low", input: { personId: "" } };
    }
    return { toolName: "utilization_firm", confidence: "high", input: {} };
  }

  // Burn vs budget. Accepts "burn", "burning", "burnrate" and the
  // common phrasings "burn vs budget", "burning against plan", etc.
  // Engagement name is extracted from "<name> engagement" or via the
  // generic "for"/"on" capture; the capability also resolves the
  // query server-side.
  if (/\bburn(?:ing|rate)?\b/i.test(promptRaw) && /\b(budget|plan|engagement|eng_)\b/i.test(promptRaw)) {
    const engId = findIdLike(promptRaw, ["eng"]) ?? "";
    let engQuery = captureAfter(promptRaw, "for", "on") ?? "";
    if (!engQuery && !engId) {
      const m = promptRaw.match(/\b(?:the\s+)?([A-Za-z][A-Za-z0-9&\- ]{1,40}?)\s+engagement\b/i);
      if (m) engQuery = m[1].trim();
    }
    return {
      toolName: "burn_vs_budget",
      confidence: engId || engQuery ? "high" : "low",
      input: { engagementId: engId, engagementQuery: engQuery },
    };
  }

  // Expense aging / policy violations.
  if (/\b(expense|expenses)\b.*\b(aging|aged|older|over\s+\d+\s+days?)\b/i.test(promptRaw) || /\bold\s+expenses\b/i.test(promptRaw)) {
    const days = promptRaw.match(/\b(\d{1,3})\s+days?\b/i);
    return {
      toolName: "expense_aging",
      confidence: "high",
      input: { olderThanDays: days ? Number(days[1]) : 30 },
    };
  }
  if (/\b(policy\s+violations?|out[- ]of[- ]policy|over\s+policy|expense\s+flags)\b/i.test(promptRaw) || /\bflag\b.*\bexpense\b/i.test(promptRaw)) {
    return { toolName: "wallet_policy_violations", confidence: "high", input: {} };
  }

  // Account dossier / changes.
  if (/\b(dossier|account\s+summary)\b/i.test(promptRaw) || /\bsummariz?e\b.*\b(dossier|account)\b/i.test(promptRaw)) {
    const accId = findIdLike(promptRaw, ["acct", "acc"]) ?? "";
    const accQuery = captureAfter(promptRaw, "dossier", "for", "on") ?? "";
    return {
      toolName: "account_dossier",
      confidence: accId || accQuery ? "high" : "low",
      input: { accountId: accId, accountQuery: accQuery },
    };
  }
  if (/\b(what\s+changed|changes?\s+(on|for)|recent\s+changes?)\b/i.test(promptRaw) && /\b(account|acct|on)\b/i.test(promptRaw)) {
    const accId = findIdLike(promptRaw, ["acct", "acc"]) ?? "";
    const accQuery = captureAfter(promptRaw, "on", "for") ?? "";
    return {
      toolName: "account_changes",
      confidence: accId || accQuery ? "high" : "low",
      input: { accountId: accId, accountQuery: accQuery },
    };
  }

  // Agent runs.
  if (/\b(agent\s+runs?|runs?\b.*\b(blocked|failed|errored|complete))\b/i.test(promptRaw)) {
    let status = "";
    if (/\b(failed|errored|error)\b/i.test(promptRaw)) status = "error";
    else if (/\bblocked\b/i.test(promptRaw)) status = "blocked";
    else if (/\bcomplete\b/i.test(promptRaw)) status = "complete";
    else if (/\brunning\b/i.test(promptRaw)) status = "running";
    return { toolName: "agent_runs_status", confidence: "high", input: { status } };
  }

  // RAID open list.
  if (/\b(open\s+raid|raid\s+open|raid\s+items?\s+open|list\s+(?:my\s+)?(?:open\s+)?raid)\b/i.test(promptRaw) || /\b(show|list)\b.*\braid\b/i.test(promptRaw)) {
    const engId = findIdLike(promptRaw, ["eng"]) ?? "";
    const engQuery = captureAfter(promptRaw, "on", "for") ?? "";
    return {
      toolName: "raid_open_list",
      confidence: "high",
      input: { engagementId: engId, engagementQuery: engQuery },
    };
  }

  // Approval queue. Includes the natural "what's waiting on me"
  // phrasing as well as explicit "approval queue" / "sign-off"
  // requests.
  if (/\b(approval\s+queue|needs\s+my\s+sign[- ]?off|what\s+do\s+i\s+need\s+to\s+approve|what'?s\s+waiting\s+on\s+me|waiting\s+on\s+my\s+approval)\b/i.test(promptRaw)) {
    return { toolName: "approval_queue", confidence: "high", input: {} };
  }

  // Task #362 — AR aging (read).
  if (/\b(ar\s+aging|aging\s+report|accounts?\s+receivable|outstanding\s+invoices?|where\s+is\s+the\s+cash|cash\s+sitting)\b/i.test(promptRaw)) {
    return { toolName: "wallet_ar_aging", confidence: "high", input: {} };
  }

  // Roster compliance due.
  if (/\b(certifications?|compliance|visas?|iqamas?)\b.*\b(expir\w+|renew\w+|due)\b/i.test(promptRaw) || /\bexpir\w+\b.*\b(certification|visa|iqama|compliance)\b/i.test(promptRaw)) {
    const days = promptRaw.match(/\b(\d{1,3})\s+days?\b/i);
    return {
      toolName: "roster_compliance_due",
      confidence: "high",
      input: { withinDays: days ? Number(days[1]) : 90 },
    };
  }

  // Timesheet (mine).
  if (/\b(my\s+timesheet|current\s+timesheet|timesheet\s+for\s+this\s+week)\b/i.test(promptRaw)) {
    return { toolName: "timesheet_current", confidence: "high", input: {} };
  }

  // Recent activity.
  if (/\b(recent\s+activity|what\s+happened\s+(in|across))\b/i.test(promptRaw)) {
    const hours = promptRaw.match(/\b(\d{1,3})\s+hours?\b/i);
    return {
      toolName: "recent_activity",
      confidence: "high",
      input: { sinceHours: hours ? Number(hours[1]) : 24 },
    };
  }

  // Home summary.
  if (/\b(home\s+summary|today's\s+summary|what\s+needs\s+me\s+today)\b/i.test(promptRaw)) {
    return { toolName: "home_summary", confidence: "high", input: {} };
  }

  // =====================================================================
  // L2C Wave 1 (Task #360, W1-S8) — Codex / CLM, change-orders,
  // deliverable-acceptance routing. Each branch matches the
  // representative prompts shipped with the catalog entries and
  // extracts the canonical id/value the corresponding tool expects.
  // Order matters: more-specific phrases (record acceptance, dispatch
  // contract) must come before broader ones (acceptance, contract).
  // =====================================================================

  // Counterparty create — "Add … as a (new) counterparty (in <country>)"
  // /  "Create … counterparty …".
  if (/\bcounterpart(?:y|ies)\b/i.test(promptRaw) && /\b(add|create|new|register)\b/i.test(promptRaw)) {
    const m = promptRaw.match(/(?:add|create|register)\s+(?:a\s+|the\s+)?(.+?)\s+(?:as\s+(?:a\s+)?(?:new\s+)?)?(?:vendor\s+|client\s+|partner[-\s]firm\s+)?counterparty\b/i)
      ?? promptRaw.match(/counterparty\s+(?:named\s+)?([\p{L}0-9 .'’&\-]+)/iu);
    let name = (m?.[1] ?? "").trim();
    const countryMatch = name.match(/\s+in\s+(?:the\s+)?([\p{L} ]{2,40})$/iu);
    if (countryMatch) name = name.replace(/\s+in\s+(?:the\s+)?[\p{L} ]{2,40}$/iu, "").trim();
    const kind = /vendor/i.test(promptRaw) ? "vendor" : /partner[-\s]firm/i.test(promptRaw) ? "partner_firm" : "client";
    return {
      toolName: "codex_counterparty_create",
      confidence: name ? "high" : "low",
      input: {
        kind,
        legalName: name,
        displayName: name,
        jurisdiction: countryMatch?.[1]?.trim() ?? "",
      },
    };
  }

  // Clause publish — "Publish the … clause [version N]".
  if (/\bpublish\b.*\bclause\b/i.test(promptRaw)) {
    const v = promptRaw.match(/\bversion\s+(\d+)\b/i);
    return {
      toolName: "codex_clause_publish",
      confidence: "low",
      input: { clauseId: "", versionHint: v ? Number(v[1]) : null },
    };
  }

  // Contract dispatch — must precede "compose" because "send" is broader.
  if (/(dispatch|send)\b.*\b(contract|sow|msa|nda)\b/i.test(promptRaw) && /\b(signature|sign|procurement|client|counterparty)\b/i.test(promptRaw)) {
    const contractId = findIdLike(promptRaw, ["ct", "contract", "sow", "msa"]) ?? "";
    return { toolName: "codex_contract_dispatch", confidence: contractId ? "high" : "low", input: { contractId } };
  }

  // Contract redline — "Record … redline on …".
  if (/\bredline\b/i.test(promptRaw)) {
    const contractId = findIdLike(promptRaw, ["ct", "contract", "sow", "msa"]) ?? "";
    return {
      toolName: "codex_contract_record_redline",
      confidence: contractId ? "high" : "low",
      input: { contractId, redlineBody: promptRaw },
    };
  }

  // Contract compose — "Compose / draft / build the … contract|sow|msa|nda".
  if (/(compose|draft|build|generate)\b.*\b(contract|sow|msa|nda)\b/i.test(promptRaw)) {
    const contractId = findIdLike(promptRaw, ["ct", "contract", "sow", "msa"]) ?? "";
    return { toolName: "codex_contract_compose", confidence: contractId ? "high" : "low", input: { contractId } };
  }

  // DPA review — "Review the … DPA …".
  if (/\bdpa\b/i.test(promptRaw) && /(review|check|scan|run)/i.test(promptRaw)) {
    const dpaId = findIdLike(promptRaw, ["dpa"]) ?? "";
    return { toolName: "codex_dpa_review", confidence: dpaId ? "high" : "low", input: { dpaId } };
  }

  // =====================================================================
  // L2C Wave 4 (Task #363) — cash application, bank reconciliation,
  // 13-week forecast, renewal motion. These branches must precede the
  // broader Renewal Watchdog branch below ("renewals?" catches
  // "renewal_open" / "renewal_list" otherwise).
  // =====================================================================

  // Bank statement import — "Import the bank statement".
  if (/\bimport\b.*\bbank\s+statement\b/i.test(promptRaw) || /\bbank\s+statement\b.*\bimport\b/i.test(promptRaw)) {
    const acctId = findIdLike(promptRaw, ["bank", "ba"]) ?? "";
    return { toolName: "bank_import", confidence: acctId ? "high" : "low", input: { bankAccountId: acctId, format: "csv", payload: "" } };
  }

  // Bank reconciliation finalise — "Finalise the bank reconciliation".
  if (/\b(finalis|finaliz)e\b.*\bbank\s+(reconciliation|recon)\b/i.test(promptRaw) || /\bbank\s+(reconciliation|recon)\b.*\b(finalis|finaliz)e\b/i.test(promptRaw)) {
    const acctId = findIdLike(promptRaw, ["bank", "ba"]) ?? "";
    const period = promptRaw.match(/\b(\d{4}-\d{2})\b/)?.[1] ?? "";
    return { toolName: "bank_recon_finalise", confidence: acctId ? "high" : "low", input: { bankAccountId: acctId, period } };
  }

  // Cash application — match (suggest) — must precede apply.
  if (/\bmatch\b.*\bcash\s+receipt\b/i.test(promptRaw) || /\bcash\s+receipt\b.*\bmatch\b/i.test(promptRaw)) {
    const rcptId = findIdLike(promptRaw, ["rcpt", "receipt"]) ?? "";
    return { toolName: "cash_match", confidence: rcptId ? "high" : "low", input: { receiptId: rcptId } };
  }

  // Cash application — apply.
  if (/\bapply\s+cash\b/i.test(promptRaw) || (/\bcash\b.*\bapply\b/i.test(promptRaw) && /\binvoice\b/i.test(promptRaw))) {
    const rcptId = findIdLike(promptRaw, ["rcpt", "receipt"]) ?? "";
    const invId = findIdLike(promptRaw, ["inv", "invoice"]) ?? "";
    return { toolName: "cash_apply", confidence: rcptId && invId ? "high" : "low", input: { receiptId: rcptId, invoiceId: invId } };
  }

  // 13-week cash forecast.
  if (/\b13[-\s]?week\b.*\b(cash\s+forecast|forecast)\b/i.test(promptRaw) || /\bcash\s+forecast(?:er)?\b/i.test(promptRaw) || /\brun\s+the\s+cash\s+forecaster\b/i.test(promptRaw)) {
    return { toolName: "cash_forecast_13w", confidence: "high", input: {} };
  }

  // Renewal — list (read).
  if (/\b(list|show)\s+(?:the\s+)?(open|active)?\s*renewals?\b/i.test(promptRaw)) {
    return { toolName: "renewal_list", confidence: "high", input: { status: /\bopen\b/i.test(promptRaw) ? "open" : "" } };
  }

  // Renewal — open (write).
  if (/\bopen\s+(?:a\s+)?renewal\b/i.test(promptRaw) || /\bcreate\s+(?:a\s+)?renewal\b/i.test(promptRaw)) {
    const acctId = findIdLike(promptRaw, ["acct", "acc"]) ?? "";
    const ctId = findIdLike(promptRaw, ["ct", "contract"]) ?? "";
    return { toolName: "renewal_open", confidence: acctId || ctId ? "high" : "low", input: { accountId: acctId, contractId: ctId } };
  }

  // Renewal Watchdog — "Show contracts expiring …" / "Run renewal watchdog".
  if (/(contracts?\s+expiring|expiring\s+contracts?|renewal\s+watchdog|expiry)\b/i.test(promptRaw) && !/\bredline\b/i.test(promptRaw)) {
    const days = promptRaw.match(/\b(\d{1,3})\s*(?:days?|d)\b/i);
    return {
      toolName: "codex_renewal_watchdog_run",
      confidence: "high",
      input: { windowDays: days ? Number(days[1]) : 90 },
    };
  }

  // Change-order record acceptance — must precede broader "acceptance" routing.
  if (/\bchange[-\s]order\b/i.test(promptRaw) && /(record|capture|log)\b.*\bacceptance\b/i.test(promptRaw)) {
    const coId = findIdLike(promptRaw, ["co", "chgord"]) ?? "";
    return {
      toolName: "change_order_record_acceptance",
      confidence: coId ? "high" : "low",
      input: { changeOrderId: coId, acceptanceEvidenceUrl: "" },
    };
  }

  // Change-order dispatch — "Send change order … to the client".
  if (/\bchange[-\s]order\b/i.test(promptRaw) && /(send|dispatch|forward)\b/i.test(promptRaw)) {
    const coId = findIdLike(promptRaw, ["co", "chgord"]) ?? "";
    return { toolName: "change_order_dispatch", confidence: coId ? "high" : "low", input: { changeOrderId: coId } };
  }

  // Change-order partner approve.
  if (/\bchange[-\s]order\b/i.test(promptRaw) && /\bapprove\b/i.test(promptRaw)) {
    const coId = findIdLike(promptRaw, ["co", "chgord"]) ?? "";
    return { toolName: "change_order_partner_approve", confidence: coId ? "high" : "low", input: { changeOrderId: coId } };
  }

  // Change-order propose — "Propose a $25k change order on eng_xxx for …".
  if (/(propose|new|add|create)\b.*\bchange[-\s]order\b/i.test(promptRaw)) {
    const engId = findIdLike(promptRaw, ["eng"]) ?? "";
    const money = findMoney(promptRaw)
      ?? (() => {
        const m = promptRaw.match(/\$?\s*(\d+(?:[\.,]\d+)?)\s*k\b/i);
        return m ? { amount: Number(m[1].replace(",", ".")) * 1000, currency: "USD" } : null;
      })();
    const forMatch = promptRaw.match(/\bfor\s+(.+?)$/i);
    return {
      toolName: "change_order_propose",
      confidence: engId && money ? "high" : "low",
      input: {
        engagementId: engId,
        title: forMatch?.[1]?.trim().replace(/[.?!]+$/, "") ?? "Change order",
        valueDeltaUsd: money?.amount ?? 0,
        scopeDelta: forMatch?.[1]?.trim() ?? promptRaw,
      },
    };
  }

  // Deliverable-acceptance: record signed — must precede "submit".
  if (/\bacceptance\b/i.test(promptRaw) && /(record|capture|log)\b.*\b(sign|signed|evidence)\b/i.test(promptRaw)) {
    const accId = findIdLike(promptRaw, ["dlacc", "acc"]) ?? "";
    const url = promptRaw.match(/https?:\/\/\S+/)?.[0] ?? "";
    return {
      toolName: "deliverable_acceptance_record_signed",
      confidence: accId ? "high" : "low",
      input: { acceptanceId: accId, evidenceUrl: url },
    };
  }

  // Deliverable-acceptance: submit — "Send the … acceptance to <email>".
  if (/\bacceptance\b/i.test(promptRaw) && /(send|submit|dispatch)\b/i.test(promptRaw)) {
    const accId = findIdLike(promptRaw, ["dlacc", "acc"]) ?? "";
    const email = findEmail(promptRaw) ?? "";
    return {
      toolName: "deliverable_acceptance_submit",
      confidence: email ? "high" : "low",
      input: {
        acceptanceId: accId,
        clientSignerName: "",
        clientSignerEmail: email,
      },
    };
  }

  // Deliverable-acceptance: create — "Draft an acceptance attestation …".
  if (/\b(acceptance|attestation)\b/i.test(promptRaw) && /(draft|create|new|prepare)\b/i.test(promptRaw)) {
    const engId = findIdLike(promptRaw, ["eng"]) ?? "";
    const forMatch = promptRaw.match(/\bfor\s+(.+?)$/i);
    return {
      toolName: "deliverable_acceptance_create",
      confidence: engId || forMatch ? "high" : "low",
      input: {
        engagementId: engId,
        title: forMatch?.[1]?.trim().replace(/[.?!]+$/, "") ?? "Deliverable acceptance",
        attestationText: forMatch?.[1]?.trim() ?? promptRaw,
      },
    };
  }

  return null;
}

/**
 * Task #338 — context-aware no-tool fallback. Replaces the static
 * three-item menu with a message that names the closest catalog entry
 * (if any) or explicitly says the action isn't available from the
 * assistant yet and points to the UI surface that does it.
 */
/**
 * Convert a snake_case tool name into a human-readable verb phrase
 * for assistant narration. "account_create" → "create an account",
 * "opportunity_move_stage" → "move the opportunity stage". Falls
 * back to a simple space-joined form if no verb is recognized.
 */
export function humanizeToolName(toolName: string): string {
  const parts = toolName.split("_");
  const verbObjectMap: Record<string, string> = {
    create: "create",
    add: "add",
    update: "update",
    move: "move",
    set: "set",
    send: "send",
    compose: "compose",
    draft: "draft",
    approve: "approve",
    close: "close",
    log: "log",
    capture: "capture",
    delete: "delete",
    refresh: "refresh",
    archive: "archive",
  };
  // Common shape: <noun>_<verb>[_<extra>] e.g. account_create, raid_add,
  // opportunity_move_stage. Detect the verb and re-order.
  if (parts.length >= 2) {
    const noun = parts[0]!;
    const verbIdx = parts.findIndex((p) => verbObjectMap[p]);
    if (verbIdx > 0) {
      const verb = verbObjectMap[parts[verbIdx]!]!;
      const article = /^[aeiou]/i.test(noun) ? "an" : "a";
      const tail = parts.slice(verbIdx + 1).join(" ");
      return tail
        ? `${verb} the ${noun.replace(/-/g, " ")} ${tail}`
        : `${verb} ${article} ${noun.replace(/-/g, " ")}`;
    }
  }
  return toolName.replace(/_/g, " ");
}

export function noToolFallbackMessage(promptText: string): string {
  const routed = routePromptToCapability(promptText);
  if (routed) {
    return `I can do that with \`${routed.toolName}\` — ${routed.confidence === "low" ? "I need a bit more detail (try naming the entity by id) to be sure." : "type your request again with confirm and I'll prepare the change."}`;
  }
  // Surface-pointing fallbacks
  const p = promptText.toLowerCase();
  if (/admin|billing|invoice|payment/.test(p))
    return "I can't run admin/billing actions from the assistant yet — please use the Billing tab.";
  if (/dashboard|kpi|chart|forecast/.test(p))
    return "I can't compose dashboard widgets from the assistant — open the Forecast tab to view those metrics.";
  if (/upload|import|csv/.test(p))
    return "Bulk uploads aren't available from the assistant yet — use the relevant import screen in the UI.";
  return "I can search accounts, list your open RAID items, draft a RAID, create accounts/opportunities, move stages, compose & send proposals, approve charters and timesheets, close RAID items, and log expenses. Tell me which one you mean — naming the entity (e.g. `opp_dewa`, `eng_acme`) helps a lot.";
}

export interface RunTurnDeps {
  persona: CliPersona;
  emit: (frame: CliFrame) => void;
}

export async function runTurn(
  input: RunTurnInput,
  deps: RunTurnDeps,
): Promise<{
  turnId: string;
  sessionId: string;
  status: CliTurnStatus;
}> {
  const { persona, emit } = deps;

  let aborted = false;
  await enterQueue(persona.id, {
    cancelInflight: input.cancelInflight === true,
    abort: () => {
      aborted = true;
    },
  });
  try {
    // --- Confirm replay path -------------------------------------------
    if (input.confirmTurnId) {
      const result = await confirmPendingWrite(input.confirmTurnId, persona, emit, {
        typedName: input.typedName,
      });
      return result;
    }

    pruneSessionDrafts();
    // Task #340 — DO NOT clear pendingClarification at turn start.
    // The current user prompt is the answer to that pending field; we
    // want it to flow into the originating tool. The directive is
    // injected into history below and the orchestrator clears the
    // draft only after the originating tool runs successfully.

    // --- Cheap classifier (advisory) ------------------------------------
    // Task #411 — sole intent classifier. The legacy `classifyIntent`
    // Haiku/heuristic pass has been retired; we derive the advisory
    // label directly from the typed intent (which is the same source
    // the retriever and tier router consume below).
    const earlySurface =
      ((input.pageContext as { surface?: string } | null | undefined)?.surface) ??
      "global";

    // Task #411 round-3 — DETERMINISTIC pre-LLM entity resolution.
    // Before any LLM call (including the typed-intent classifier on
    // Haiku), scan the prompt for explicit id-prefix tokens and run
    // them through the typed `directIdLookup` table. This guarantees
    // that "find opp_xyz" or "show inv_abc" resolves the entity
    // before any Anthropic call, satisfying the "resolver before
    // LLM" requirement even when ATELIER_CLI_HAIKU is enabled.
    const { directIdLookup } = await import("./entity-resolver.js");
    // Round-6 — widen prefix regex to 2..6 chars so longer rid()
    // prefixes like "acct", "deliv", "invl" match. Map keys MUST
    // mirror the actual `rid("<prefix>")` tags used at insert time
    // throughout the atelier-cli capability files.
    const ID_TOKEN_RE = /\b([a-z]{2,6})_[a-z0-9_]{3,}/gi;
    const preLlmResolved: Array<{ kind: string; id: string; label: string }> = [];
    {
      const tokens = Array.from(new Set((input.prompt ?? "").match(ID_TOKEN_RE) ?? []));
      const PREFIX_TO_KIND: Record<string, string> = {
        // Reads + standard entities (matches `rid("<prefix>")` tags
        // in parity-capabilities.ts / coverage-capabilities.ts /
        // l2c-wave*-capabilities.ts).
        opp: "opportunity",
        acct: "account",
        eng: "engagement",
        del: "deliverable",
        deliv: "deliverable",
        co: "contact",
        cp: "contact",
        inv: "invoice",
        invl: "invoice",
        rnw: "renewal",
        ren: "renewal",
        cco: "change_order",
        wt: "win_theme",
        brf: "brief",
        agd: "agent_design",
        wld: "win_loss_debrief",
        mtg: "meeting",
        raid: "raid_item",
        prop: "proposal",
        pov: "pov",
        rc: "rate_card",
        pf: "partner_firm",
        tse: "timesheet_entry",
        exp: "expense",
      };
      for (const tok of tokens) {
        const prefix = String(tok).split("_")[0]?.toLowerCase() ?? "";
        const kind = PREFIX_TO_KIND[prefix];
        if (!kind) continue;
        try {
          const hit = await directIdLookup(kind as never, String(tok), persona.orgId);
          if (hit) preLlmResolved.push({ kind, id: hit.id, label: hit.label });
        } catch {
          // best-effort
        }
      }
    }

    // Task #411 round-5 — DETERMINISTIC named-entity resolution
    // (no LLM). Run the regex-only `deterministicClassify` to derive
    // a tentative kind + entity hints, then resolve those hints
    // through the hybrid pg_trgm + pgvector resolver BEFORE invoking
    // the typed-intent classifier (Haiku). This guarantees that
    // user-typed names (e.g. "Acme Advisory") are resolved to a
    // typed entity row before any LLM call, satisfying the
    // "deterministic resolution before any LLM call" requirement
    // for both id-token and name-based hints.
    {
      const { deterministicClassify } = await import("./intent-router.js");
      const { hybridResolveEntity, pickConfident } = await import("./entity-resolver.js");
      const det = deterministicClassify(input.prompt ?? "");
      if (det.kind !== "unknown" && det.hints.length > 0) {
        const seen = new Set(preLlmResolved.map((h) => `${h.kind}:${h.id}`));
        for (const hint of det.hints.slice(0, 3)) {
          try {
            const candidates = await hybridResolveEntity(
              det.kind as never,
              hint,
              persona.orgId,
            );
            const top = pickConfident(candidates);
            if (top && !seen.has(`${det.kind}:${top.id}`)) {
              preLlmResolved.push({ kind: det.kind, id: top.id, label: top.label });
              seen.add(`${det.kind}:${top.id}`);
            }
          } catch {
            // best-effort
          }
        }
      }
    }

    const earlyTypedIntent = await (await import("./intent-router.js")).classifyIntentTyped(
      input.prompt,
      earlySurface,
    );
    const earlyLabel: IntentLabel = (() => {
      const v = earlyTypedIntent.verb;
      if (v === "reset") return "reset";
      if (v === "read") return "read";
      if (v === "transition") return "transition";
      if (v === "create" || v === "update" || v === "link" || v === "delete") return "write";
      if (v === "trivial") return "trivial";
      return "other";
    })();
    const classification = {
      label: earlyLabel,
      model: "typed-intent",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
    const forceNew = earlyLabel === "reset";

    // --- Session + idempotency -----------------------------------------
    await ensureUserDailyQuota(persona.id);
    const session = await getOrCreateSession(persona, input.sessionId ?? null, { forceNew });
    // Persist page-context snapshot the first time the session sees one.
    if (input.pageContext && !session.pageContextSnapshot) {
      // Task #332 — redact emails/phones/PAN/IBAN before the page
      // context becomes a durable session row.
      const snapshotRedacted = redactJson(input.pageContext).value as Record<
        string,
        unknown
      >;
      await db
        .update(atelierCliSessions)
        .set({ pageContextSnapshot: snapshotRedacted, updatedAt: new Date() })
        .where(eq(atelierCliSessions.id, session.id));
    }
    await ensureSessionBudget(session.id);

    // Idempotency: if clientTurnKey is reused on the same session AND the
    // prior turn reached a terminal status, replay its frames + status.
    // If the prior turn is still `streaming`, surface a conflict rather
    // than replay a half-written frame stream.
    const TERMINAL_STATUSES: ReadonlySet<CliTurnStatus> = new Set([
      "success",
      "error",
      "partial",
      "cancelled",
      "read_only_no_op",
      "awaiting_confirmation",
      "awaiting_clarification",
      "async_dispatched",
    ]);
    if (input.clientTurnKey) {
      const [prev] = await db
        .select()
        .from(atelierCliTurns)
        .where(
          and(
            eq(atelierCliTurns.sessionId, session.id),
            eq(atelierCliTurns.clientTurnKey, input.clientTurnKey),
          ),
        )
        .limit(1);
      if (prev && !TERMINAL_STATUSES.has(prev.status as CliTurnStatus)) {
        emit({
          type: "error",
          data: {
            code: "in_flight",
            message: "previous turn with this clientTurnKey is still in flight",
          },
        });
        emit({
          type: "final",
          data: {
            status: "error",
            replay: false,
            turnId: prev.id,
            sessionId: session.id,
          },
        });
        return { turnId: prev.id, sessionId: session.id, status: "error" };
      }
      if (prev) {
        // Replay all prev frames except its own `final` (which would
        // mask the replay marker). Then emit a fresh final tagged
        // replay:true so the client knows this was a dedupe.
        for (const f of (prev.frames as CliFrame[]) ?? []) {
          if (f.type === "final") continue;
          emit(f);
        }
        emit({
          type: "final",
          data: {
            replay: true,
            status: prev.status,
            turnId: prev.id,
            sessionId: session.id,
          },
        });
        return {
          turnId: prev.id,
          sessionId: session.id,
          status: prev.status as CliTurnStatus,
        };
      }
    }

    const turnId = rid("clit");
    const frames: CliFrame[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];
    const t0 = Date.now();
    let finalEmitted = false;

    function record(frame: CliFrame): void {
      // Tag every frame with the real Anthropic model id observed for
      // this turn so SSE consumers see the actual Sonnet/Haiku name on
      // every step (per acceptance criterion: no implicit "claude" /
      // env-var labels). Frames emitted before the first modelStep
      // call carry `null` to make the absence explicit.
      const data = (frame as { data?: Record<string, unknown> }).data;
      if (data && typeof data === "object" && !("model" in data)) {
        (data as Record<string, unknown>).model = lastModel ?? null;
      }
      frames.push(frame);
      if (frame.type === "final") finalEmitted = true;
      emit(frame);
    }

    // Task #332 — redact emails/phones/PAN/IBAN from the persisted
    // prompt + page context BEFORE they hit the audit perimeter.
    // The model still sees the raw prompt in `history` (live in
    // memory only); only the durable copy is scrubbed.
    const promptRedacted = redactText(input.prompt).text;
    const pageContextRedacted = input.pageContext
      ? (redactJson(input.pageContext).value as Record<string, unknown>)
      : null;
    await db.insert(atelierCliTurns).values({
      id: turnId,
      orgId: persona.orgId,
      sessionId: session.id,
      userId: persona.id,
      status: "streaming",
      prompt: promptRedacted,
      attachmentRefs: input.attachmentIds ?? [],
      pageContext: pageContextRedacted,
      dryRun: input.dryRun === true,
      intent: input.intent ?? classification.label,
      clientTurnKey: input.clientTurnKey ?? null,
      frames: [],
      toolCalls: [],
    });

    // Task #340 — proactive open-state recap. When a session is being
    // re-opened after >6h dormant or this is the first turn against an
    // existing rolling-summary, emit a `proactive_recap` frame so the
    // user lands on what they were doing without asking.
    const lastTurnAt = session.lastTurnAt ? new Date(session.lastTurnAt).getTime() : 0;
    const dormantMs = lastTurnAt > 0 ? Date.now() - lastTurnAt : 0;
    const PROACTIVE_RECAP_DORMANT_MS = 6 * 60 * 60 * 1000;
    const draftPriorToTurn = getSessionDraft(session.id);
    if (
      session.rollingSummary &&
      session.rollingSummary.length > 0 &&
      (dormantMs > PROACTIVE_RECAP_DORMANT_MS || (session.turnCount ?? 0) > 0 && !draftPriorToTurn.lastTurnId)
    ) {
      const draftEntities = Object.values(draftPriorToTurn.entities)
        .sort((a, b) => b.at - a.at)
        .slice(0, 5)
        .map((e) => ({ kind: e.kind, id: e.id, label: e.label }));
      // Note: emit (not record) — proactive recap is informational and
      // must not be persisted into the turn frames replay buffer.
      emit({
        type: "proactive_recap",
        data: {
          summary: session.rollingSummary.split("\n").slice(-5).join("\n"),
          turnCount: session.turnCount ?? 0,
          dormantMs,
          entities: draftEntities,
          schemaVersion: CATALOG_SCHEMA_VERSION,
        },
      });
    }

    // Build initial history. Rolling summary (if any) goes in as a
    // synthetic system extension via the user channel — we keep the
    // system prompt fixed so the SDK caching can kick in.
    const history: Array<{ role: "user" | "assistant"; content: unknown }> = [];
    if (session.rollingSummary && session.rollingSummary.length > 0) {
      history.push({
        role: "user",
        content: `[prior session summary]\n${session.rollingSummary}`,
      });
      history.push({
        role: "assistant",
        content: "(noted)",
      });
    }
    // Page-context priming + attachment hint, then the actual prompt.
    const pageCtx = input.pageContext ?? session.pageContextSnapshot ?? null;
    if (pageCtx && Object.keys(pageCtx).length > 0) {
      history.push({
        role: "user",
        content: `[page context]\n${JSON.stringify(pageCtx).slice(0, 1000)}`,
      });
      history.push({ role: "assistant", content: "(noted)" });
    }
    // Task #340 — pronoun + draft primer. Inject the most-recently
    // referenced entities so phrases like "it"/"that one"/"the same
    // engagement" resolve deterministically without a fresh resolver
    // round-trip. Also surfaces any pending clarification fields the
    // model should fill from the next user turn.
    const draftSummary = summarizeSessionDraft(session.id);
    if (draftSummary.length > 0) {
      history.push({
        role: "user",
        content: `[recent context]\n${draftSummary}`,
      });
      history.push({ role: "assistant", content: "(noted)" });
    }
    // Task #340 — clarification continuation context primer. When a prior
    // turn paused with `awaiting_clarification`, surface the pending
    // field to the model as well. The orchestrator handles the
    // continuation deterministically below, but if the deterministic
    // path is bypassed (tool deregistered, etc.) the model still has
    // enough context to do the right thing.
    const _draft = getSessionDraft(session.id);
    if (_draft.pendingClarification) {
      const pc = _draft.pendingClarification;
      history.push({
        role: "user",
        content:
          `[clarification continuation] Previous turn paused awaiting "${pc.field}" for tool "${pc.tool}". ` +
          `My next message is the answer to that field.`,
      });
      history.push({ role: "assistant", content: "(noted)" });
    }
    if ((input.attachmentIds ?? []).length > 0) {
      // Task #332 — wrap attachment refs in <attachment> blocks with
      // an explicit "data only" instruction so prompt-injected verbs
      // inside the attachment body cannot hijack the model.
      const wrapped = (input.attachmentIds ?? [])
        .map((aid) => wrapAttachment(aid, `(opaque attachment ref ${aid})`))
        .join("\n");
      history.push({ role: "user", content: wrapped });
      history.push({ role: "assistant", content: "(noted; attachment is data only)" });
    }
    history.push({ role: "user", content: input.prompt });
    // Task #332 — defense-in-depth: if attachments are present and
    // the user prompt itself does NOT name a destructive verb, force
    // typed-name confirmation on any write derived during this turn.
    const forceTypedName = shouldRequireTypedNameForAttachmentTurn({
      hasAttachments: (input.attachmentIds ?? []).length > 0,
      prompt: input.prompt,
    });

    let status: CliTurnStatus = "streaming";
    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    let lastModel: string | undefined;
    let pendingWrite: { tool: string; input: Record<string, unknown> } | null = null;
    let runtimeError: string | null = null;
    let clarificationHandled = false;
    const stepResults: Array<Record<string, unknown>> = [];
    const writeStepCount = (): number =>
      toolCalls.filter((c) => findToolByName(String(c.tool), persona)?.isWrite).length;

    // Task #411 — typed intent router + per-turn capability retriever.
    // Replaces the unscoped `getToolsForPersona(persona)` call with a
    // ranked top-K slice of the persona's surface plus the four
    // orchestrator meta-tools. Falls back to the full surface when
    // the embeddings table hasn't been backfilled yet.
    const { intentToQueryString } = await import("./intent-router.js");
    const { retrieveCapabilities } = await import("./capability-retriever.js");
    const { hybridResolveEntity, pickConfident } = await import("./entity-resolver.js");
    type ResolverKind = import("./entity-resolver.js").ResolverKind;
    const { getEntityContext, formatContextForPrompt } = await import("./entity-context.js");
    type ContextKind = import("./entity-context.js").ContextKind;
    // Reuse the typed intent already classified up top — single source
    // of truth for the verb/kind/tier/hints used everywhere below.
    const typedIntent = earlyTypedIntent;
    const retrievalQuery = intentToQueryString(typedIntent, input.prompt);
    const retrieved = await retrieveCapabilities({
      persona,
      query: retrievalQuery,
      intentKind: typedIntent.kind,
      intentVerb: typedIntent.verb,
    });
    const tools = retrieved.tools;
    // Tier routing — reads land on Haiku, writes / transitions on Sonnet.
    const turnTier: "haiku" | "sonnet" = typedIntent.tier;

    // Task #411 — DETERMINISTIC pre-LLM entity resolution + context
    // injection. Before the model loop runs, we try to resolve the
    // intent's `entityHints` against the database via the hybrid
    // pg_trgm + pgvector resolver and, when one candidate is clearly
    // ahead, walk the FK graph to build a `<context>` block. The
    // model gets the resolved id + a typed neighbourhood without
    // having to call `resolve_entity` for the obvious cases.
    let preludeContextBlock: string | null = null;
    let preludeResolved: { kind: string; id: string; label: string; via: string; score: number } | null = null;
    const CONTEXT_KINDS: ReadonlySet<ContextKind> = new Set([
      "account", "opportunity", "engagement", "contact", "deliverable",
    ] as const);

    // Task #411 round-4 — wire the pre-LLM id-token resolution
    // (`preLlmResolved`, computed before classifyIntentTyped above)
    // as the AUTHORITATIVE seed: an exact id token always beats fuzzy
    // hybrid resolution. When the typed intent kind matches one of
    // the pre-LLM hits, short-circuit the hybrid resolver and use the
    // exact id directly; otherwise still emit each pre-LLM hit as a
    // tool_result frame so the model sees what we resolved before
    // any inference happened.
    for (const hit of preLlmResolved) {
      record({
        type: "tool_result",
        data: {
          step: -2,
          tool: "resolve_entity",
          prelude: true,
          preLlm: true,
          ok: true,
          data: { entity: { kind: hit.kind, id: hit.id, label: hit.label, via: "exact_id" } },
        },
      });
    }
    const preLlmMatch = preLlmResolved.find((h) => h.kind === typedIntent.kind) ?? preLlmResolved[0];
    try {
      if (preLlmMatch) {
        preludeResolved = {
          kind: preLlmMatch.kind,
          id: preLlmMatch.id,
          label: preLlmMatch.label,
          via: "exact_id",
          score: 1,
        };
        if (CONTEXT_KINDS.has(preLlmMatch.kind as ContextKind)) {
          const ctxNode = await getEntityContext(
            preLlmMatch.kind as ContextKind,
            preLlmMatch.id,
            persona.orgId,
            typedIntent.verb === "transition" || typedIntent.verb === "update" ? 2 : 1,
          );
          preludeContextBlock = formatContextForPrompt(ctxNode);
        }
      } else if (
        typedIntent.kind !== "unknown" &&
        typedIntent.entityHints.length > 0
      ) {
        const candidates = await hybridResolveEntity(
          typedIntent.kind as ResolverKind,
          typedIntent.entityHints[0],
          persona.orgId,
        );
        const top = pickConfident(candidates);
        if (top) {
          preludeResolved = {
            kind: typedIntent.kind,
            id: top.id,
            label: top.label,
            via: top.via,
            score: top.score,
          };
          if (CONTEXT_KINDS.has(typedIntent.kind as ContextKind)) {
            const ctxNode = await getEntityContext(
              typedIntent.kind as ContextKind,
              top.id,
              persona.orgId,
              typedIntent.verb === "transition" || typedIntent.verb === "update" ? 2 : 1,
            );
            preludeContextBlock = formatContextForPrompt(ctxNode);
          }
          record({
            type: "tool_result",
            data: {
              step: -1,
              tool: "resolve_entity",
              prelude: true,
              ok: true,
              data: { entity: { kind: top.id ? typedIntent.kind : "unknown", id: top.id, label: top.label, score: top.score, via: top.via } },
            },
          });
        }
      }
    } catch (err) {
      // Non-fatal — the model can still call resolve_entity itself.
      record({
        type: "tool_result",
        data: {
          step: -1,
          tool: "resolve_entity",
          prelude: true,
          ok: false,
          errorCode: "prelude_failed",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    }

    try {
    // Task #340 — DETERMINISTIC clarification continuation. Run BEFORE
    // the model loop so a missing-field follow-up is collected
    // server-side without depending on model compliance. If the
    // originating tool re-runs successfully (or transitions into
    // confirmation/clarification/refusal), we emit canonical frames
    // and skip the Claude loop entirely.
    if (_draft.pendingClarification) {
      const pc = _draft.pendingClarification;
      const tool = findToolByName(pc.tool, persona);
      if (tool) {
        // Task #484 — defense-in-depth strip. The HTTP ingress in
        // cliRoutes.ts already strips the locale preamble before the
        // prompt reaches runTurn, so this is a no-op for normal
        // sessions. We keep the call so future entry points
        // (test fixtures, internal callers, future RPC surfaces) that
        // bypass cliRoutes still get the same treatment before raw
        // text is merged into a tool field.
        const answer = stripLocalePreamble(input.prompt ?? "");
        const mergedInput: Record<string, unknown> = {
          ...(pc.partial ?? {}),
          [pc.field]: answer,
        };
        const ctx0: ToolContext = {
          persona,
          turnId,
          sessionId: session.id,
          stepIdx: 0,
        };
        record({
          type: "tool_call",
          data: { step: 0, tool: pc.tool, input: mergedInput, continuation: true },
        });
        let cont: ToolResult;
        try {
          cont = await tool.run(mergedInput, ctx0);
        } catch (err) {
          cont = {
            ok: false,
            errorCode: "internal",
            errorMessage: err instanceof Error ? err.message : String(err),
          };
        }
        toolCalls.push({
          step: 0,
          tool: pc.tool,
          input: mergedInput,
          ok: cont.ok,
          errorCode: cont.errorCode,
          continuation: true,
          ms: Date.now() - t0,
        });
        stepResults.push({
          stepIdx: 0,
          tool: pc.tool,
          ok: cont.ok,
          errorCode: cont.errorCode,
        });
        record({
          type: "tool_result",
          data: {
            step: 0,
            tool: pc.tool,
            ok: cont.ok,
            data: cont.data,
            errorCode: cont.errorCode,
            errorMessage: cont.errorMessage,
            continuation: true,
          },
        });
        if (cont.ok) {
          ingestEntitiesFromToolResult(session.id, pc.tool, cont.data);
          recordSessionResult(session.id, { lastTurnId: turnId });
        }
        // Clear stale pendingClarification on EVERY continuation outcome
        // except the "still missing more fields" case below — otherwise
        // a follow-up prompt could be hijacked into re-running this tool.
        const _drClear = getSessionDraft(session.id);
        if (
          _drClear.pendingClarification &&
          _drClear.pendingClarification.tool === pc.tool
        ) {
          _drClear.pendingClarification = null;
        }
        if (cont.clarification) {
          // Still missing more fields — re-pause with updated partial.
          const cl = cont.clarification;
          recordSessionResult(session.id, {
            pendingClarification: {
              field: cl.field,
              question: cl.question,
              originalPrompt: pc.originalPrompt,
              partial: cl.partial ?? mergedInput,
              tool: cl.tool,
            },
          });
          record({
            type: "needs_clarification",
            data: {
              step: 0,
              field: cl.field,
              question: cl.question,
              tool: cl.tool,
              partial: cl.partial ?? mergedInput,
              suggestions: cl.suggestions ?? [],
              continuation: true,
            },
          });
          status = "awaiting_clarification";
        } else if (cont.confirmation) {
          // Continuation produced a confirmation request (e.g. raid_add_v2
          // first pass). Hand off to the existing confirm protocol.
          const conf = cont.confirmation;
          pendingWrite = conf.pending;
          record({
            type: "needs_confirmation",
            data: {
              step: 0,
              tool: pc.tool,
              summary: conf.summary,
              diff: conf.diff,
              continuation: true,
            },
          });
          status = "awaiting_confirmation";
        } else if (cont.refusal) {
          record({
            type: "refusal",
            data: {
              step: 0,
              reason: cont.refusal.reason,
              closestCapabilityId: cont.refusal.closestCapabilityId ?? null,
              pageHref: cont.refusal.pageHref ?? null,
              suggestion: cont.refusal.suggestion ?? null,
              requestCapability: { tool: "request_feature", prompt: input.prompt },
            },
          });
          status = "success";
        } else if (cont.ok) {
          // Originating tool ran clean — clear the pending clarification.
          const dr = getSessionDraft(session.id);
          if (dr.pendingClarification && dr.pendingClarification.tool === pc.tool) {
            dr.pendingClarification = null;
          }
          status = "success";
        } else {
          record({
            type: "error",
            data: {
              code: cont.errorCode ?? "tool_error",
              message: cont.errorMessage ?? "continuation tool failed",
            },
          });
          status = "error";
          runtimeError = cont.errorMessage ?? cont.errorCode ?? "tool_error";
        }
        clarificationHandled = true;
      }
    }
    for (let step = 0; step < MAX_TOOL_STEPS && !clarificationHandled; step++) {
      const elapsed = Date.now() - t0;
      if (aborted) {
        record({
          type: "error",
          data: { code: "cancelled", message: "turn cancelled by newer request" },
        });
        status = "cancelled";
        break;
      }
      if (elapsed > HARD_WALL_MS) {
        record({
          type: "error",
          data: {
            code: "hard_wall_exceeded",
            message: `turn exceeded hard wall (${HARD_WALL_MS}ms)`,
          },
        });
        status = "partial";
        break;
      }
      // Task #492 — research-heavy specialists (Account Cartographer,
      // Pursuit Scout) routinely run 30-70s on real Sonnet web-search
      // calls. If one already ran this turn the model still needs a
      // follow-up step to call `propose_write`, otherwise the user
      // sees the prefill card with no gold confirm card. Extend the
      // soft wall (still under HARD_WALL_MS) so the propose_write
      // follow-through fits in the same turn.
      const ranLongSpecialist = toolCalls.some(
        (c) => c.tool === "prefill_from_specialist",
      );
      const sawProposeWrite = toolCalls.some((c) => c.tool === "propose_write");
      const effectiveSoftWall =
        ranLongSpecialist && !sawProposeWrite
          ? Math.min(HARD_WALL_MS - 10_000, SOFT_WALL_MS + 60_000)
          : SOFT_WALL_MS;
      if (elapsed > effectiveSoftWall) {
        record({
          type: "budget_exceeded",
          data: {
            code: "soft_wall_exceeded",
            elapsedMs: elapsed,
            softMs: effectiveSoftWall,
            hardMs: HARD_WALL_MS,
            options: ["continue", "handoff_async", "cancel"],
            message:
              "this turn is taking longer than expected — continue, hand off to async, or cancel?",
          },
        });
        status = "partial";
        break;
      }
      let claudeStep: ClaudeStep;
      try {
        claudeStep = await modelStep({
          history,
          tools,
          // Round-7 — drive policy context from the SINGLE typed
          // intent computed pre-LLM (not the legacy `input.intent`
          // which was a free-form caller hint). This satisfies the
          // "single typed Intent drives retrieval, tier routing,
          // AND policy context" task requirement: retrieval already
          // uses typedIntent.kind/verb (line ~2629), tier routing
          // already uses turnTier=typedIntent.tier (line ~2634),
          // and now policy context does too.
          intent: typedIntent.label ?? input.intent ?? null,
          tier: turnTier,
          contextBlock: preludeContextBlock,
        });
      } catch (err) {
        // Upstream model failed after retry budget — surface a typed
        // `temporarily_unavailable` frame and end the turn `partial` rather
        // than collapsing into a generic internal error.
        record({
          type: "error",
          data: {
            code: "temporarily_unavailable",
            message: "AI temporarily unavailable — please retry shortly",
            detail: String((err as { message?: string })?.message ?? err),
          },
        });
        status = "partial";
        break;
      }
      totalCost += claudeStep.costUsd;
      totalIn += claudeStep.tokensIn;
      totalOut += claudeStep.tokensOut;
      lastModel = claudeStep.model;

      if (claudeStep.text) {
        record({ type: "narration", data: { text: claudeStep.text, step } });
      }
      record({ type: "plan_step", data: { step, hasTool: !!claudeStep.toolCall } });

      // Build the assistant turn we send back to the model on the next step.
      const assistantContent: Array<Record<string, unknown>> = [];
      if (claudeStep.text) assistantContent.push({ type: "text", text: claudeStep.text });
      if (claudeStep.toolCall) {
        assistantContent.push({
          type: "tool_use",
          id: claudeStep.toolCall.id,
          name: claudeStep.toolCall.name,
          input: claudeStep.toolCall.input,
        });
      }
      history.push({ role: "assistant", content: assistantContent });

      if (claudeStep.stop === "aborted") {
        record({
          type: "error",
          data: {
            code: "model_stop",
            message: `model stopped with reason ${claudeStep.stopReason ?? "unknown"}`,
          },
        });
        status = "partial";
        break;
      }
      if (claudeStep.stop === "end_turn" || !claudeStep.toolCall) {
        if (
          toolCalls.length === 0 &&
          classification.label === "other" &&
          (claudeStep.text ?? "").trim().length === 0
        ) {
          // Task #340 — refusal pageHref fallback: prefer the page the
          // user is currently on (so "open the right page" returns them
          // to the most relevant surface), else null.
          const fallbackHref =
            (pageCtx as { href?: string } | null)?.href ?? null;
          record({
            type: "refusal",
            data: {
              step,
              reason:
                "I couldn't match this to a capability available on your CLI surface.",
              closestCapabilityId: null,
              pageHref: fallbackHref,
              suggestion:
                "Tell me what you wanted to do and I'll log it as a feature request.",
              requestCapability: { tool: "request_feature", prompt: input.prompt },
            },
          });
        }
        status = status === "streaming" ? "success" : status;
        break;
      }

      const tc = claudeStep.toolCall;
      const tool = findToolByName(tc.name, persona);
      if (!tool) {
        record({
          type: "error",
          data: { code: "unknown_tool", message: `tool ${tc.name} not registered` },
        });
        status = "error";
        break;
      }

      record({
        type: "tool_call",
        data: { step, tool: tc.name, input: tc.input },
      });

      // Idempotency for write-tools that reach the commit phase: one job
      // row per (turnId, step) so a retry never double-writes.
      let toolResult: ToolResult;
      const ctx: ToolContext = {
        persona,
        turnId,
        sessionId: session.id,
        stepIdx: step,
      };
      const isCommit = tool.isWrite && tc.input.confirm === true;
      const idemKey = `${turnId}:${step}`;
      if (isCommit) {
        toolResult = await runIdempotentJob({
          idemKey,
          orgId: persona.orgId,
          turnId,
          sessionId: session.id,
          userId: persona.id,
          kind: tc.name,
          input: tc.input,
          run: () => tool.run(tc.input, ctx),
        });
      } else {
        toolResult = await tool.run(tc.input, ctx);
      }

      toolCalls.push({
        step,
        tool: tc.name,
        input: tc.input,
        ok: toolResult.ok,
        errorCode: toolResult.errorCode,
        ms: Date.now() - t0,
      });
      stepResults.push({
        stepIdx: step,
        tool: tc.name,
        ok: toolResult.ok,
        errorCode: toolResult.errorCode,
        replayedIdempotent: Boolean(
          (toolResult as { replayedIdempotent?: boolean }).replayedIdempotent,
        ),
      });

      record({
        type: "tool_result",
        data: {
          step,
          tool: tc.name,
          ok: toolResult.ok,
          data: toolResult.data,
          errorCode: toolResult.errorCode,
          errorMessage: toolResult.errorMessage,
        },
      });

      if (toolResult.ok) {
        ingestEntitiesFromToolResult(session.id, tc.name, toolResult.data);
        recordSessionResult(session.id, { lastTurnId: turnId });
        if (tool.isWrite && (tc.input as { confirm?: unknown }).confirm === true) {
          const dataObj = (toolResult.data ?? {}) as Record<string, unknown>;
          recordSessionResult(session.id, {
            lastWriteTurnId: turnId,
            lastWriteTool: tc.name,
            lastWriteRaidId:
              tc.name === "raid_add_v2" && typeof dataObj.id === "string"
                ? (dataObj.id as string)
                : undefined,
          });
        } else if (!tool.isWrite) {
          // Task #340 — capture last read tool + args so meta.refine_last
          // can re-invoke the originating capability with adjusted args
          // instead of only filtering cached rows. Skip meta
          // post-processors so a refine_last call does not become its
          // own next "source read".
          const META_TOOL_NAMES = new Set([
            "refine_last",
            "recap",
            "explain_last",
            "undo_last",
            "request_feature",
          ]);
          if (!META_TOOL_NAMES.has(tc.name)) {
            recordSessionResult(session.id, {
              lastReadTool: tc.name,
              lastReadArgs: tc.input as Record<string, unknown>,
            });
          }
        }
        // Clear pending clarification if the originating tool just ran.
        const dr = getSessionDraft(session.id);
        if (dr.pendingClarification && dr.pendingClarification.tool === tc.name) {
          dr.pendingClarification = null;
        }
      }

      if (toolResult.clarification) {
        const cl = toolResult.clarification;
        recordSessionResult(session.id, {
          pendingClarification: {
            field: cl.field,
            question: cl.question,
            originalPrompt: input.prompt,
            partial: cl.partial ?? {},
            tool: cl.tool,
          },
        });
        record({
          type: "needs_clarification",
          data: {
            step,
            field: cl.field,
            question: cl.question,
            tool: cl.tool,
            partial: cl.partial ?? {},
            suggestions: cl.suggestions ?? [],
          },
        });
        status = "awaiting_clarification";
        break;
      }

      if (toolResult.refusal) {
        const rf = toolResult.refusal;
        record({
          type: "refusal",
          data: {
            step,
            reason: rf.reason,
            closestCapabilityId: rf.closestCapabilityId ?? null,
            pageHref: rf.pageHref ?? null,
            suggestion: rf.suggestion ?? null,
            requestCapability: { tool: "request_feature", prompt: input.prompt },
          },
        });
        status = status === "streaming" ? "success" : status;
        break;
      }

      if (toolResult.disambiguation) {
        record({
          type: "needs_disambiguation",
          data: { ...toolResult.disambiguation, step },
        });
        status = "partial";
        break;
      }
      if (toolResult.confirmation) {
        // Task #332 — annotate the diff with irreversibility +
        // typed-name requirement so the client renders the right
        // confirm widget (free button vs "type the name to commit").
        const catEntry = findByToolName(tc.name);
        const baseDiff = toolResult.confirmation.diff as Record<string, unknown>;
        const diff: Record<string, unknown> = { ...baseDiff };
        if (catEntry?.irreversible) diff.irreversible = true;
        if (forceTypedName && diff.typedNameRequired === undefined) {
          diff.typedNameRequired = "(re-type to confirm; attachment-derived)";
          diff.requiresTypedName = true;
        }
        if (catEntry?.outboundChannel) diff.outboundChannel = catEntry.outboundChannel;
        // Always emit `proposed_plan` first so clients see the structured
        // plan even before the confirm UI is shown.
        record({
          type: "proposed_plan",
          data: {
            steps: [
              {
                stepIdx: step,
                tool: tc.name,
                summary: toolResult.confirmation.summary,
                diff,
              },
            ],
            dryRun: input.dryRun === true,
            schemaVersion: CATALOG_SCHEMA_VERSION,
          },
        });
        if (input.dryRun === true) {
          // Dry-run: do not stash pendingWrite, do not offer Confirm.
          status = "success";
          break;
        }
        record({
          type: "needs_confirmation",
          data: {
            summary: toolResult.confirmation.summary,
            diff,
            step,
            irreversible: catEntry?.irreversible === true,
            requiresTypedName:
              catEntry?.irreversible === true || forceTypedName === true,
          },
        });
        pendingWrite = toolResult.confirmation.pending;
        // Stash the typed-name requirement on the pending write itself
        // so the confirm phase has it without re-running the tool.
        if (catEntry?.irreversible || forceTypedName) {
          (pendingWrite as Record<string, unknown>).requiresTypedName = true;
          (pendingWrite as Record<string, unknown>).typedNameExpected =
            (diff.typedNameRequired as string) ?? null;
        }
        status = "awaiting_confirmation";
        break;
      }

      // Feed the tool result back to the model.
      history.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: tc.id,
            content: JSON.stringify({
              ok: toolResult.ok,
              data: toolResult.data,
              error: toolResult.ok
                ? undefined
                : { code: toolResult.errorCode, message: toolResult.errorMessage },
            }),
            is_error: !toolResult.ok,
          },
        ],
      });

      // After a successful read on a non-write tool with no further model
      // input, downgrade to read_only_no_op iff this is a one-shot read.
      // The loop continues until the model emits end_turn though.
    }

    // If the model never wrote anything, mark explicit no-op for clarity.
    if (status === "streaming") status = "success";
    if (
      status === "success" &&
      toolCalls.length === 1 &&
      // Task #484 — catalog-aware lookup. The previous check only
      // consulted the legacy starter TOOL_REGISTRY, so successful
      // catalog writes (account_create, opportunity_create, …) were
      // mislabelled `read_only_no_op` because the lookup returned
      // undefined and `!undefined === true`. findToolByName falls
      // through to the catalog when no persona is supplied.
      !findToolByName(toolCalls[0]!.tool as string)?.isWrite
    ) {
      status = "read_only_no_op";
    }

    // Async hand-off: long write plans (>threshold) OR explicit
    // `async:true` are dispatched to a background job row + worker. The
    // worker runs out-of-band, updates the job + turn, and writes a
    // notification audit when complete.
    const explicitAsync = input.async === true && writeStepCount() > 0;
    if (
      status === "awaiting_confirmation" &&
      (writeStepCount() > ASYNC_HANDOFF_STEP_THRESHOLD || explicitAsync)
    ) {
      const jobId = rid("clij");
      const totalSteps = writeStepCount();
      await db
        .insert(atelierCliJobs)
        .values({
          id: jobId,
          orgId: persona.orgId,
          turnId,
          sessionId: session.id,
          userId: persona.id,
          kind: "async_plan",
          status: "queued",
          input: { plan: stepResults, pending: pendingWrite },
          stepResults,
          progress: { current: 0, total: totalSteps },
          expiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
          idempotencyKey: `${turnId}:async_plan`,
        })
        .onConflictDoNothing({ target: atelierCliJobs.idempotencyKey });
      record({
        type: "async_dispatched",
        data: { jobId, totalSteps, explicit: explicitAsync },
      });
      status = "async_dispatched";
      // Kick the in-process background worker (fire-and-forget).
      const dispatchPending = pendingWrite;
      const dispatchSessionId = session.id;
      setImmediate(() => {
        void runAsyncJob({
          jobId,
          turnId,
          sessionId: dispatchSessionId,
          persona,
          pending: dispatchPending,
        }).catch((err) => {
          console.error(
            "[atelier-cli] runAsyncJob crashed",
            jobId,
            err instanceof Error ? err.message : String(err),
          );
        });
      });
      pendingWrite = null;
    }
    } catch (err) {
      // Loop-time failure (model error, tool throw, etc). Surface as an
      // error frame and mark the turn `error`. Do NOT rethrow — we still
      // need the finally block to persist + audit, and the route layer
      // should not emit a duplicate error frame.
      runtimeError = err instanceof Error ? err.message : String(err);
      record({
        type: "error",
        data: { code: "internal", message: runtimeError },
      });
      status = "error";
    } finally {
      const latencyMs = Date.now() - t0;
      const costCents = Math.round(totalCost * 100);
      // Build planJson from the proposed_plan frame (if any) for replay.
      const planFrame = frames.find((f) => f.type === "proposed_plan");
      const planJson = planFrame ? planFrame.data : null;
      if (!finalEmitted) {
        record({
          type: "final",
          data: {
            status,
            turnId,
            sessionId: session.id,
            costCents,
            tokensIn: totalIn,
            tokensOut: totalOut,
            latencyMs,
            error: runtimeError ?? undefined,
          },
        });
      }
      // Persist terminal state. We attempt every write so a failure on
      // one (e.g. transient DB error during the audit insert) does not
      // skip the others, but if ANY persist fails we mark the turn
      // `error`, log the failures, and surface an error frame so the
      // caller is not misled by a phantom success.
      const persistErrors: string[] = [];
      try {
        await db
          .update(atelierCliTurns)
          .set({
            status,
            statusMessage: pendingWrite ? "awaiting confirmation" : runtimeError ?? status,
            frames,
            toolCalls,
            pendingWrite,
            planJson,
            stepResults,
            costCents,
            tokensIn: totalIn,
            tokensOut: totalOut,
            model: lastModel,
            latencyMs,
            lastStepIdx: toolCalls.length,
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(atelierCliTurns.id, turnId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[atelier-cli] turn persist failed", turnId, msg);
        persistErrors.push(`turn:${msg}`);
      }

      // Update session bookkeeping. Maintain a short rolling summary by
      // appending a one-line trace per turn (capped at ~2KB).
      // Task #332 — strip PII out of the prompt before it lands in
      // the durable rolling session summary.
      const promptForSummary = redactText(input.prompt).text.slice(0, 120);
      const summaryLine = `[${new Date().toISOString().slice(11, 19)}] ${promptForSummary} → ${status}${toolCalls.length ? ` (${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"})` : ""}`;
      const nextSummary = ((session.rollingSummary ?? "") + "\n" + summaryLine)
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .slice(-30)
        .join("\n");
      try {
        await db
          .update(atelierCliSessions)
          .set({
            turnCount: (session.turnCount ?? 0) + 1,
            recentTurnIds: [...((session.recentTurnIds as string[]) ?? []), turnId].slice(-20),
            rollingSummary: nextSummary.slice(0, 2000),
            lastTurnAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(atelierCliSessions.id, session.id));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[atelier-cli] session bookkeeping failed", session.id, msg);
        persistErrors.push(`session:${msg}`);
      }

      if (costCents > 0) {
        try {
          await chargeSession(session.id, costCents);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[atelier-cli] chargeSession failed", session.id, msg);
          persistErrors.push(`charge:${msg}`);
        }
      }

      // Single canonical `cli.turn` audit row per turn. We only write it
      // here when this turn reaches a truly terminal state in the initial
      // pass. For `awaiting_confirmation` and `async_dispatched` we defer
      // — `confirmPendingWrite` / `cancelPendingWrite` / the async runner
      // write the canonical row when those flows actually terminate.
      const writeTerminalAudit =
        status !== "awaiting_confirmation" && status !== "async_dispatched";
      if (writeTerminalAudit) {
        try {
          await db.insert(atelierAuditEvents).values({
            id: rid("aud"),
            entityType: "cli_turn",
            entityId: turnId,
            actorType: "human",
            actorId: persona.id,
            actorLabel: persona.name,
            action: "cli.turn",
            payload: {
              sessionId: session.id,
              intent: input.intent ?? null,
              status,
              toolCount: toolCalls.length,
              writeStepCount: writeStepCount(),
              costCents,
              tokensIn: totalIn,
              tokensOut: totalOut,
              latencyMs,
              model: lastModel,
              dryRun: input.dryRun === true,
              attachmentCount: (input.attachmentIds ?? []).length,
              hasPageContext: !!pageCtx,
              classifier: classification,
              // Task #411 round-4 — telemetry the reviewer requires
              // for the ≤12-tools and deterministic-resolution
              // verification criteria.
              retrieval: {
                selected: retrieved.selected,
                scores: retrieved.scores,
                ranked: retrieved.ranked,
                toolCount: retrieved.tools.length,
              },
              preLlmResolved: preLlmResolved.length ? preLlmResolved : undefined,
              preludeResolved: preludeResolved ?? undefined,
              error: runtimeError ?? undefined,
              persistErrors: persistErrors.length ? persistErrors : undefined,
              schemaVersion: CATALOG_SCHEMA_VERSION,
            },
            payloadSummary: redactText(
              `CLI turn ${status} (${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"})${input.intent ? ` · intent=${input.intent}` : ""}${input.dryRun ? " · dryRun" : ""}${runtimeError ? ` · err=${runtimeError.slice(0, 80)}` : ""}`,
            ).text,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[atelier-cli] audit insert failed", turnId, msg);
          persistErrors.push(`audit:${msg}`);
        }
      }

      // If any critical persistence failed, demote the reported status
      // to `error` and surface an error frame so the caller cannot mis-
      // interpret a phantom success.
      if (persistErrors.length) {
        const summary = persistErrors.join("; ");
        if (!frames.some((f) => f.type === "error")) {
          record({ type: "error", data: { code: "persistence", message: summary } });
        }
        status = "error";
        runtimeError = runtimeError ?? `persistence: ${summary}`;
      }
    }

    return { turnId, sessionId: session.id, status };
  } finally {
    releaseSlot(persona.id);
  }
}

// =====================================================================
// 7. Confirm phase
// =====================================================================

export async function confirmPendingWrite(
  turnId: string,
  persona: CliPersona,
  emit: (frame: CliFrame) => void,
  opts: { typedName?: string } = {},
): Promise<{ turnId: string; sessionId: string; status: CliTurnStatus }> {
  const [turn] = await db
    .select()
    .from(atelierCliTurns)
    .where(eq(atelierCliTurns.id, turnId))
    .limit(1);
  // Helper: emit a single error frame + a single terminal final frame,
  // then return without throwing. Mirrors the runTurn contract so the
  // route layer never double-emits.
  const fail = (
    code: string,
    message: string,
  ): { turnId: string; sessionId: string; status: CliTurnStatus } => {
    emit({ type: "error", data: { code, message } });
    emit({
      type: "final",
      data: {
        status: "error",
        turnId,
        sessionId: turn?.sessionId ?? "",
        confirmed: false,
        error: message,
      },
    });
    return {
      turnId,
      sessionId: turn?.sessionId ?? "",
      status: "error" as CliTurnStatus,
    };
  };

  if (!turn) return fail("not_found", `turn ${turnId} not found`);
  // Task #361 — capability `approverRoles` enables initiator/approver
  // separation on irreversible writes (e.g. revrec_post_period: initiated
  // by finance, posted by founding_partner). When set, the confirming
  // persona must (a) match an approverRole and (b) NOT be the initiator
  // of the turn (cross-user attestation). Otherwise fall back to the
  // pre-Wave-2 behaviour: same-user confirmation.
  const pendingTool = (turn.pendingWrite as { tool?: string } | null)?.tool;
  const approverEntry = pendingTool ? findByToolName(pendingTool) : null;
  const approverRoles = approverEntry?.approverRoles ?? [];
  if (approverRoles.length > 0) {
    if (!(approverRoles as string[]).includes(persona.role)) {
      return fail("forbidden", `confirm requires one of: ${approverRoles.join(", ")}`);
    }
    if (turn.userId === persona.id) {
      return fail("forbidden", "approver must differ from initiator");
    }
  } else if (turn.userId !== persona.id) {
    return fail("forbidden", "not your turn");
  }
  if (turn.status !== "awaiting_confirmation") {
    // Idempotent re-confirm: if it already succeeded, replay final frame.
    if (turn.status === "success" || turn.status === "partial") {
      emit({
        type: "final",
        data: { status: turn.status, turnId, sessionId: turn.sessionId, replay: true },
      });
      return {
        turnId,
        sessionId: turn.sessionId,
        status: turn.status as CliTurnStatus,
      };
    }
    return fail("wrong_state", `turn is ${turn.status}, cannot confirm`);
  }
  const pending = turn.pendingWrite as
    | {
        tool: string;
        input: Record<string, unknown>;
        requiresTypedName?: boolean;
        typedNameExpected?: string | null;
      }
    | null;
  if (!pending) return fail("no_pending", "no pending write");
  const tool = findToolByName(pending.tool, persona);
  if (!tool || !tool.isWrite) {
    return fail("bad_tool", `pending tool ${pending.tool} not a registered write`);
  }

  // Task #332 — irreversible / attachment-derived writes require the
  // client to retype the entity name on /confirm. We compare against
  // the value the catalog stamped onto pendingWrite at preview time.
  const needsTypedName =
    pending.requiresTypedName === true || isIrreversibleTool(pending.tool);
  if (needsTypedName) {
    const expected = (pending.typedNameExpected ?? "").trim();
    const got = (opts.typedName ?? "").trim();
    if (!got || (expected && got.toLowerCase() !== expected.toLowerCase())) {
      emit({
        type: "needs_confirmation",
        data: {
          step: (turn.lastStepIdx ?? 0) + 1,
          requiresTypedName: true,
          irreversible: isIrreversibleTool(pending.tool),
          typedNameExpected: expected || null,
          message:
            "this action is irreversible — please retype the name to confirm",
        },
      });
      emit({
        type: "final",
        data: {
          status: "awaiting_confirmation",
          turnId,
          sessionId: turn.sessionId,
          confirmed: false,
          typedNameRequired: true,
        },
      });
      return {
        turnId,
        sessionId: turn.sessionId,
        status: "awaiting_confirmation" as CliTurnStatus,
      };
    }
  }

  const stepIdx = (turn.lastStepIdx ?? 0) + 1;
  const idemKey = `${turnId}:confirm:${stepIdx}`;

  // Task #340 — track the just-confirmed write so meta.undo_last can
  // find it. We update session draft AFTER the tool runs successfully
  // below; this comment marks the intent.
  const result = await runIdempotentJob({
    idemKey,
    orgId: persona.orgId,
    turnId,
    sessionId: turn.sessionId,
    userId: persona.id,
    kind: pending.tool,
    input: pending.input,
    run: () =>
      tool.run(pending.input, {
        persona,
        turnId,
        sessionId: turn.sessionId,
        stepIdx,
      }),
  });

  emit({
    type: "tool_result",
    data: {
      step: stepIdx,
      tool: pending.tool,
      ok: result.ok,
      data: result.data,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      confirmed: true,
    },
  });

  // Task #340 — record write metadata on session draft so the next
  // /undo or recap call can find this commit. Without this, the
  // standard two-phase confirmed write would never reach undo_last
  // because runTurn's in-loop tracker only fires when confirm===true
  // is on the original input.
  if (result.ok) {
    const dataObj = (result.data ?? {}) as Record<string, unknown>;
    recordSessionResult(turn.sessionId, {
      lastWriteTurnId: turnId,
      lastWriteTool: pending.tool,
      lastWriteRaidId:
        pending.tool === "raid_add_v2" && typeof dataObj.id === "string"
          ? (dataObj.id as string)
          : undefined,
    });
  }

  const newStatus: CliTurnStatus = result.ok ? "success" : "error";
  emit({
    type: "final",
    data: { status: newStatus, turnId, sessionId: turn.sessionId, confirmed: true },
  });

  const newFrames = [
    ...((turn.frames as CliFrame[]) ?? []),
    {
      // Task #335 — persist `data` so the `meta.undo_last_action`
      // capability can recover the created entity IDs without
      // re-running the tool. Without this the confirm path silently
      // strips the IDs the orchestrator just wrote.
      type: "tool_result" as const,
      data: {
        step: stepIdx,
        tool: pending.tool,
        ok: result.ok,
        data: result.data,
        errorCode: result.errorCode,
        confirmed: true,
      },
    },
    { type: "final" as const, data: { status: newStatus, confirmed: true } },
  ];
  const priorStepResults = Array.isArray(turn.stepResults)
    ? (turn.stepResults as Array<Record<string, unknown>>)
    : [];
  const mergedStepResults = [
    ...priorStepResults,
    {
      stepIdx,
      tool: pending.tool,
      ok: result.ok,
      errorCode: result.errorCode,
      confirmed: true,
      replayedIdempotent: Boolean(
        (result as { replayedIdempotent?: boolean }).replayedIdempotent,
      ),
    },
  ];
  // Task #335 — `meta.undo_last_action` walks `toolCalls` to find the
  // last reversible write. The preview run that produced this pending
  // write never made it into `toolCalls` (the orchestrator breaks out
  // of its loop on `awaiting_confirmation` before the push site at
  // index.ts ~1667), so without this append the committed write would
  // be invisible to undo and `/undo` would falsely report
  // `no_reversible` for two-phase writes — exactly the regression the
  // code review caught. Persist the commit step here.
  const priorToolCalls = Array.isArray(turn.toolCalls)
    ? (turn.toolCalls as Array<Record<string, unknown>>)
    : [];
  const mergedToolCalls = [
    ...priorToolCalls,
    {
      step: stepIdx,
      tool: pending.tool,
      input: pending.input,
      ok: result.ok,
      errorCode: result.errorCode,
      confirmed: true,
    },
  ];
  await db
    .update(atelierCliTurns)
    .set({
      status: newStatus,
      statusMessage: newStatus,
      frames: newFrames,
      toolCalls: mergedToolCalls,
      stepResults: mergedStepResults,
      pendingWrite: null,
      lastStepIdx: stepIdx,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierCliTurns.id, turnId));

  await db.insert(atelierAuditEvents).values([
    {
      id: rid("aud"),
      entityType: "cli_turn",
      entityId: turnId,
      actorType: "human",
      actorId: persona.id,
      actorLabel: persona.name,
      action: "cli.turn.confirmed",
      payload: { sessionId: turn.sessionId, tool: pending.tool, ok: result.ok },
      payloadSummary: `CLI confirm ${pending.tool} ${result.ok ? "ok" : "fail"}`,
    },
    // Canonical terminal `cli.turn` row — runTurn deferred this when it
    // ended `awaiting_confirmation`, so we write the single row now.
    {
      id: rid("aud"),
      entityType: "cli_turn",
      entityId: turnId,
      actorType: "human",
      actorId: persona.id,
      actorLabel: persona.name,
      action: "cli.turn",
      payload: {
        sessionId: turn.sessionId,
        status: newStatus,
        terminal: true,
        confirmed: true,
        tool: pending.tool,
        ok: result.ok,
        replayedIdempotent: Boolean(
          (result as { replayedIdempotent?: boolean }).replayedIdempotent,
        ),
      },
      payloadSummary: `CLI turn ${newStatus} (confirm ${pending.tool})`,
    },
  ]);

  return { turnId, sessionId: turn.sessionId, status: newStatus };
}

export async function cancelPendingWrite(
  turnId: string,
  persona: CliPersona,
): Promise<{ status: CliTurnStatus }> {
  const [turn] = await db
    .select()
    .from(atelierCliTurns)
    .where(eq(atelierCliTurns.id, turnId))
    .limit(1);
  if (!turn || turn.userId !== persona.id) throw new Error("forbidden");
  if (turn.status !== "awaiting_confirmation") return { status: turn.status as CliTurnStatus };
  await db
    .update(atelierCliTurns)
    .set({
      status: "cancelled",
      pendingWrite: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierCliTurns.id, turnId));
  await db.insert(atelierAuditEvents).values([
    {
      id: rid("aud"),
      entityType: "cli_turn",
      entityId: turnId,
      actorType: "human",
      actorId: persona.id,
      actorLabel: persona.name,
      action: "cli.turn.cancelled",
      payload: { sessionId: turn.sessionId },
      payloadSummary: "CLI confirm cancelled",
    },
    // Canonical terminal `cli.turn` row — runTurn deferred this when it
    // ended `awaiting_confirmation`, so we write the single row now.
    {
      id: rid("aud"),
      entityType: "cli_turn",
      entityId: turnId,
      actorType: "human",
      actorId: persona.id,
      actorLabel: persona.name,
      action: "cli.turn",
      payload: {
        sessionId: turn.sessionId,
        status: "cancelled" as const,
        terminal: true,
        cancelled: true,
      },
      payloadSummary: "CLI turn cancelled",
    },
  ]);
  return { status: "cancelled" };
}

// =====================================================================
// SSE writer helper for the route layer.
// =====================================================================

export function writeSseFrame(res: Response, frame: CliFrame): void {
  res.write(`event: ${frame.type}\n`);
  res.write(`data: ${JSON.stringify(frame.data)}\n\n`);
  const flush = (res as unknown as { flush?: () => void }).flush;
  if (typeof flush === "function") flush.call(res);
}

// Used by tests / future analytics.
export function _internalGetInflightSize(): number {
  return inflight.size;
}

