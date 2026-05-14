/**
 * Task #331 — Atelier CLI orchestrator (server spine).
 *
 * One file because the surface is small and the pieces lean on each
 * other tightly. Read top-to-bottom:
 *
 *   1.  Types     — SSE frames, tool registry, turn statuses.
 *   2.  IDs/util  — rid(), today UTC, mock detector, budget classes.
 *   3.  Tools     — 4 starter capabilities (present_choices,
 *                   resolve_account_by_name, list_my_open_raid_items,
 *                   add_raid_item).
 *   4.  Quotas    — per-user concurrency lock + per-session daily $.
 *   5.  Sessions  — get-or-create + rolling summary helpers.
 *   6.  Loop      — runTurn() drives Claude tool-use (or mock); emits
 *                   SSE frames; persists atelier_cli_turns row +
 *                   atelier_audit_events `cli.turn`.
 *   7.  Confirm   — confirmPendingWrite() is the second phase of the
 *                   diff/confirm protocol for write-tools (e.g.
 *                   add_raid_item with confirm:true). Idempotent.
 *
 * Mock mode (ATELIER_MOCK_AGENTS=1 or no Anthropic env) returns a
 * deterministic narration + one tool call so the integration test
 * can run without a network. Live mode mirrors `runner.ts`'s
 * callClaudeJson cost accounting.
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
  | "proposed_plan"
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

const MOCK_MODE =
  process.env.ATELIER_MOCK_AGENTS === "1" ||
  !process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ||
  !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

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
// Sonnet orchestration loop. Override via env; falls back to a
// deterministic heuristic when MOCK_MODE is on or the upstream call
// fails — the classification is advisory, never blocking.
const HAIKU_CLASSIFIER_MODEL =
  process.env.ATELIER_CLI_HAIKU_MODEL ?? "claude-haiku-4-5";

type IntentLabel =
  | "reset"
  | "read"
  | "write"
  | "ambiguous"
  | "trivial"
  | "other";

function heuristicClassify(prompt: string): IntentLabel {
  const p = prompt.toLowerCase().trim();
  if (!p) return "trivial";
  if (/^\/new\b/.test(p) || /\b(reset|start over|new session)\b/.test(p)) return "reset";
  if (/\b(add|create|update|delete|remove|edit|log|file|submit|approve)\b/.test(p)) return "write";
  if (/\b(list|show|find|search|who is|what is|view|fetch|get)\b/.test(p)) return "read";
  if (/\b(or|either|maybe|which one|choose between)\b/.test(p)) return "ambiguous";
  return "other";
}

/**
 * Classify the user's prompt with the cheap Haiku model so the loop can
 * route + budget appropriately. In MOCK_MODE or on any upstream failure
 * we fall back to a deterministic keyword heuristic. The result is
 * advisory — it is recorded in the audit payload and used to short-
 * circuit obvious cases (e.g. "reset" → start a fresh session).
 */
async function classifyIntent(
  prompt: string,
): Promise<{ label: IntentLabel; model: string; tokensIn: number; tokensOut: number; costUsd: number }> {
  const fallback = (): {
    label: IntentLabel;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  } => ({
    label: heuristicClassify(prompt),
    model: MOCK_MODE ? "mock-haiku" : `${HAIKU_CLASSIFIER_MODEL} (fallback)`,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  });
  if (MOCK_MODE) return fallback();
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5_000);
    try {
      const resp = await anthropic.messages.create(
        {
          model: HAIKU_CLASSIFIER_MODEL,
          max_tokens: 16,
          system:
            "Classify the user prompt into one of: reset, read, write, ambiguous, trivial, other. Reply with just the label.",
          messages: [{ role: "user", content: prompt }],
        },
        { signal: ac.signal },
      );
      const raw = resp.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .toLowerCase()
        .trim();
      const label: IntentLabel = (
        ["reset", "read", "write", "ambiguous", "trivial", "other"] as IntentLabel[]
      ).find((l) => raw.startsWith(l)) ?? heuristicClassify(prompt);
      const tokensIn = resp.usage.input_tokens;
      const tokensOut = resp.usage.output_tokens;
      const costUsd = (tokensIn * 1 + tokensOut * 5) / 1_000_000;
      return { label, model: resp.model ?? HAIKU_CLASSIFIER_MODEL, tokensIn, tokensOut, costUsd };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return fallback();
  }
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
    const tool = TOOL_REGISTRY[pending.tool];
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
  /** Raw stop_reason for diagnostics; null for mock. */
  stopReason?: string | null;
}

/** Abstract model dispatch — mock or live. */
async function modelStep(args: {
  history: Array<{ role: "user" | "assistant"; content: unknown }>;
  tools: ToolDef[];
  intent: string | null;
}): Promise<ClaudeStep> {
  if (MOCK_MODE) return mockModelStep(args);
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
  const callOnce = () =>
    anthropic.messages.create(
      {
        model: process.env.ATELIER_CLI_MODEL ?? "claude-sonnet-4-5",
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT + (args.intent ? `\n\nUser intent: ${args.intent}` : ""),
        tools: args.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Record<string, unknown>,
        })),
        messages: args.history as Parameters<typeof anthropic.messages.create>[0]["messages"],
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
    return { text: text.trim(), toolCall, stop, costUsd, tokensIn, tokensOut, stopReason: resp.stop_reason ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic mock so tests + dev work without Claude. Decisions are
 * keyword-based on the most recent user text:
 *   - "raid" + "list"  → list_my_open_raid_items
 *   - "raid" + ("add"|"create"|"new") → add_raid_item (preview phase)
 *   - "find" + "account" / "who is" → resolve_account_by_name
 *   - "choose"/"pick" → present_choices
 *   - else → end_turn with a friendly narration.
 *
 * After ANY tool result block in history, the mock emits an end_turn
 * narration (one tool call per turn keeps the test surface small).
 */
function mockModelStep(args: {
  history: Array<{ role: "user" | "assistant"; content: unknown }>;
}): ClaudeStep {
  let lastTool: { role: "user" | "assistant"; content: unknown } | undefined;
  for (let i = args.history.length - 1; i >= 0; i--) {
    const h = args.history[i]!;
    if (
      h.role === "user" &&
      Array.isArray(h.content) &&
      (h.content as Array<{ type?: string }>).some((b) => b?.type === "tool_result")
    ) {
      lastTool = h;
      break;
    }
  }
  if (lastTool) {
    return {
      text: "Done.",
      toolCall: null,
      stop: "end_turn",
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
    };
  }
  // Find the LAST user prompt text — the rolling-summary primer is also
  // pushed as a user message so we must scan from the end.
  const promptText = (() => {
    for (let i = args.history.length - 1; i >= 0; i--) {
      const h = args.history[i]!;
      if (h.role !== "user") continue;
      if (typeof h.content === "string") {
        const s = h.content;
        // Skip our own primer prefixes — keep walking back to find the
        // actual user prompt.
        if (s.startsWith("[prior session summary]") || s.startsWith("[page context]") || s.startsWith("[attachments]")) {
          continue;
        }
        return s;
      }
      if (Array.isArray(h.content)) {
        // Tool-result entries are arrays — skip them; we want the original
        // text prompt.
        const isToolResult = (h.content as Array<{ type?: string }>).some(
          (b) => b?.type === "tool_result",
        );
        if (isToolResult) continue;
        const txt = (h.content as Array<{ type?: string; text?: string }>).find(
          (b) => b?.type === "text" && typeof b.text === "string",
        );
        if (txt) return String(txt.text);
      }
    }
    return "";
  })().toLowerCase();

  let toolCall: ClaudeToolCall | null = null;
  let text = "On it.";
  if (promptText.includes("raid") && /(add|create|new|log)/.test(promptText)) {
    const mEng = promptText.match(/eng[-_]?[a-z0-9_]+/i);
    text = "I'll draft a RAID item for you to review.";
    toolCall = {
      id: rid("tu"),
      name: "add_raid_item",
      input: {
        engagementId: mEng ? mEng[0] : "eng_unknown",
        kind: /assumption/.test(promptText)
          ? "assumption"
          : /issue/.test(promptText)
            ? "issue"
            : /dependency/.test(promptText)
              ? "dependency"
              : "risk",
        severity: /\bred\b/.test(promptText)
          ? "red"
          : /\bgreen\b/.test(promptText)
            ? "green"
            : "amber",
        description: promptText.slice(0, 200),
      },
    };
  } else if (promptText.includes("raid")) {
    text = "Pulling your open RAID items.";
    toolCall = { id: rid("tu"), name: "list_my_open_raid_items", input: { limit: 10 } };
  } else if (/(find|who is|account)/.test(promptText)) {
    const m = promptText.match(/(?:find|account|who is)\s+([a-z0-9 _-]+)/i);
    text = "Looking that account up.";
    toolCall = {
      id: rid("tu"),
      name: "resolve_account_by_name",
      input: { query: (m?.[1] ?? promptText).trim().slice(0, 60) },
    };
  } else if (/(choose|pick|option)/.test(promptText)) {
    text = "Here are some options.";
    toolCall = {
      id: rid("tu"),
      name: "present_choices",
      input: {
        prompt: "Pick one:",
        options: [
          { id: "a", label: "Option A" },
          { id: "b", label: "Option B" },
        ],
      },
    };
  } else {
    text =
      "I can search accounts, list your open RAID items, or draft a new RAID. Tell me what you need.";
  }
  return {
    text,
    toolCall,
    stop: toolCall ? "tool_use" : "end_turn",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
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
      const result = await confirmPendingWrite(input.confirmTurnId, persona, emit);
      return result;
    }

    // --- Cheap classifier (advisory) ------------------------------------
    // Run before the expensive Sonnet loop so we can short-circuit
    // obvious resets and budget appropriately. Result is recorded on
    // the turn payload + audit but never blocks execution.
    const classification = await classifyIntent(input.prompt);
    const forceNew = classification.label === "reset";

    // --- Session + idempotency -----------------------------------------
    await ensureUserDailyQuota(persona.id);
    const session = await getOrCreateSession(persona, input.sessionId ?? null, { forceNew });
    // Persist page-context snapshot the first time the session sees one.
    if (input.pageContext && !session.pageContextSnapshot) {
      await db
        .update(atelierCliSessions)
        .set({ pageContextSnapshot: input.pageContext, updatedAt: new Date() })
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
      frames.push(frame);
      if (frame.type === "final") finalEmitted = true;
      emit(frame);
    }

    await db.insert(atelierCliTurns).values({
      id: turnId,
      orgId: persona.orgId,
      sessionId: session.id,
      userId: persona.id,
      status: "streaming",
      prompt: input.prompt,
      attachmentRefs: input.attachmentIds ?? [],
      pageContext: input.pageContext ?? null,
      dryRun: input.dryRun === true,
      intent: input.intent ?? classification.label,
      clientTurnKey: input.clientTurnKey ?? null,
      frames: [],
      toolCalls: [],
    });

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
    if ((input.attachmentIds ?? []).length > 0) {
      history.push({
        role: "user",
        content: `[attachments] ${(input.attachmentIds ?? []).join(", ")}`,
      });
      history.push({ role: "assistant", content: "(noted)" });
    }
    history.push({ role: "user", content: input.prompt });

    let status: CliTurnStatus = "streaming";
    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    let lastModel: string | undefined;
    let pendingWrite: { tool: string; input: Record<string, unknown> } | null = null;
    let runtimeError: string | null = null;
    const stepResults: Array<Record<string, unknown>> = [];
    const writeStepCount = (): number =>
      toolCalls.filter((c) => TOOL_REGISTRY[String(c.tool)]?.isWrite).length;

    const tools = Object.values(TOOL_REGISTRY);

    try {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
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
      if (elapsed > SOFT_WALL_MS) {
        record({
          type: "budget_exceeded",
          data: {
            code: "soft_wall_exceeded",
            elapsedMs: elapsed,
            softMs: SOFT_WALL_MS,
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
          intent: input.intent ?? null,
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
      lastModel = process.env.ATELIER_CLI_MODEL ?? lastModel ?? (MOCK_MODE ? "mock" : "claude");

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
        status = status === "streaming" ? "success" : status;
        break;
      }

      const tc = claudeStep.toolCall;
      const tool = TOOL_REGISTRY[tc.name];
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

      if (toolResult.disambiguation) {
        record({
          type: "needs_disambiguation",
          data: { ...toolResult.disambiguation, step },
        });
        status = "partial";
        break;
      }
      if (toolResult.confirmation) {
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
                diff: toolResult.confirmation.diff,
              },
            ],
            dryRun: input.dryRun === true,
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
            diff: toolResult.confirmation.diff,
            step,
          },
        });
        pendingWrite = toolResult.confirmation.pending;
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
      !TOOL_REGISTRY[toolCalls[0]!.tool as string]?.isWrite
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
      const summaryLine = `[${new Date().toISOString().slice(11, 19)}] ${input.prompt.slice(0, 120)} → ${status}${toolCalls.length ? ` (${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"})` : ""}`;
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
              mock: MOCK_MODE,
              dryRun: input.dryRun === true,
              attachmentCount: (input.attachmentIds ?? []).length,
              hasPageContext: !!pageCtx,
              classifier: classification,
              error: runtimeError ?? undefined,
              persistErrors: persistErrors.length ? persistErrors : undefined,
            },
            payloadSummary: `CLI turn ${status} (${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"})${input.intent ? ` · intent=${input.intent}` : ""}${input.dryRun ? " · dryRun" : ""}${runtimeError ? ` · err=${runtimeError.slice(0, 80)}` : ""}`,
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
  if (turn.userId !== persona.id) return fail("forbidden", "not your turn");
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
    | { tool: string; input: Record<string, unknown> }
    | null;
  if (!pending) return fail("no_pending", "no pending write");
  const tool = TOOL_REGISTRY[pending.tool];
  if (!tool || !tool.isWrite) {
    return fail("bad_tool", `pending tool ${pending.tool} not a registered write`);
  }

  const stepIdx = (turn.lastStepIdx ?? 0) + 1;
  const idemKey = `${turnId}:confirm:${stepIdx}`;

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

  const newStatus: CliTurnStatus = result.ok ? "success" : "error";
  emit({
    type: "final",
    data: { status: newStatus, turnId, sessionId: turn.sessionId, confirmed: true },
  });

  const newFrames = [
    ...((turn.frames as CliFrame[]) ?? []),
    {
      type: "tool_result" as const,
      data: { step: stepIdx, tool: pending.tool, ok: result.ok, confirmed: true },
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
  await db
    .update(atelierCliTurns)
    .set({
      status: newStatus,
      statusMessage: newStatus,
      frames: newFrames,
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

