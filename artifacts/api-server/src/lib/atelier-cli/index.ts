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
  userText: string;
  intent?: string | null;
  clientTurnKey?: string | null;
  /** Two-phase confirm: when set, replays the saved pendingWrite. */
  confirmTurnId?: string | null;
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
const MAX_TOOL_STEPS = Number(process.env.ATELIER_CLI_MAX_STEPS ?? 8);

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
    return { ok: true, data: { prompt: input.prompt, options: input.options } };
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

const inflight = new Map<string, number>(); // userId -> startedAt ms

function acquireSlot(userId: string): void {
  const now = Date.now();
  const prev = inflight.get(userId);
  // 60s stale lock release — if a turn crashed without releasing, don't
  // wedge the user forever.
  if (prev && now - prev < 60_000) {
    throw new CliConcurrencyError();
  }
  inflight.set(userId, now);
}

function releaseSlot(userId: string): void {
  inflight.delete(userId);
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
}): Promise<ToolResult> {
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
        return { ok: true, data: existing.result as unknown };
      }
      if (existing && existing.status === "error") {
        return {
          ok: false,
          errorCode: "prior_attempt_failed",
          errorMessage: existing.error ?? "prior attempt failed",
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
  spent: number;
  limit: number;
}> {
  const [row] = await db
    .select({
      spent: atelierCliSessions.spentUsdToday,
      day: atelierCliSessions.spentUsdDay,
    })
    .from(atelierCliSessions)
    .where(eq(atelierCliSessions.id, sessionId))
    .limit(1);
  if (!row) return { spent: 0, limit: SESSION_DAILY_BUDGET_USD };
  const today = todayUtc();
  if (row.day !== today) {
    // Rotate the daily counter lazily.
    await db
      .update(atelierCliSessions)
      .set({ spentUsdToday: 0, spentUsdDay: today })
      .where(eq(atelierCliSessions.id, sessionId));
    return { spent: 0, limit: SESSION_DAILY_BUDGET_USD };
  }
  const spent = Number(row.spent) || 0;
  if (spent >= SESSION_DAILY_BUDGET_USD)
    throw new CliBudgetExceededError(spent, SESSION_DAILY_BUDGET_USD);
  return { spent, limit: SESSION_DAILY_BUDGET_USD };
}

async function chargeSession(sessionId: string, costUsd: number): Promise<void> {
  if (!costUsd) return;
  const today = todayUtc();
  const [row] = await db
    .select({
      spent: atelierCliSessions.spentUsdToday,
      day: atelierCliSessions.spentUsdDay,
    })
    .from(atelierCliSessions)
    .where(eq(atelierCliSessions.id, sessionId))
    .limit(1);
  if (!row) return;
  const sameDay = row.day === today;
  const next = (sameDay ? Number(row.spent) || 0 : 0) + costUsd;
  await db
    .update(atelierCliSessions)
    .set({ spentUsdToday: next, spentUsdDay: today, updatedAt: new Date() })
    .where(eq(atelierCliSessions.id, sessionId));
}

// =====================================================================
// 5. Sessions
// =====================================================================

export async function getOrCreateSession(
  persona: CliPersona,
  sessionId: string | null | undefined,
): Promise<typeof atelierCliSessions.$inferSelect> {
  if (sessionId) {
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
    if (row) return row;
  }
  const id = sessionId ?? rid("clis");
  const [row] = await db
    .insert(atelierCliSessions)
    .values({
      id,
      orgId: persona.orgId,
      userId: persona.id,
      createdByUserId: persona.id,
      spentUsdDay: todayUtc(),
    })
    .returning();
  return row;
}

// =====================================================================
// 6. Loop
// =====================================================================

const SYSTEM_PROMPT = [
  "You are the Atelier CLI orchestrator. Help the user accomplish a task using the tools you are given.",
  "Be concise. Prefer one tool call per step. Do not invent data.",
  "When a write-tool returns a confirmation diff, STOP and let the user confirm — do not retry.",
  "When a tool returns disambiguation options, STOP and let the user pick — do not guess.",
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
  try {
    const resp = await anthropic.messages.create(
      {
        model: process.env.ATELIER_CLI_MODEL ?? "claude-sonnet-4-5",
        max_tokens: 2048,
        system: SYSTEM_PROMPT + (args.intent ? `\n\nUser intent: ${args.intent}` : ""),
        tools: args.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as never,
        })),
        // `messages` is typed broadly — we rely on Anthropic SDK's content-block runtime parsing.
        messages: args.history as never,
      },
      { signal: ac.signal },
    );
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
  // Find first user prompt text.
  const userText = (() => {
    for (const h of args.history) {
      if (h.role !== "user") continue;
      if (typeof h.content === "string") return h.content;
      if (Array.isArray(h.content)) {
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
  if (userText.includes("raid") && /(add|create|new|log)/.test(userText)) {
    const mEng = userText.match(/eng[-_]?[a-z0-9_]+/i);
    text = "I'll draft a RAID item for you to review.";
    toolCall = {
      id: rid("tu"),
      name: "add_raid_item",
      input: {
        engagementId: mEng ? mEng[0] : "eng_unknown",
        kind: /assumption/.test(userText)
          ? "assumption"
          : /issue/.test(userText)
            ? "issue"
            : /dependency/.test(userText)
              ? "dependency"
              : "risk",
        severity: /\bred\b/.test(userText)
          ? "red"
          : /\bgreen\b/.test(userText)
            ? "green"
            : "amber",
        description: userText.slice(0, 200),
      },
    };
  } else if (userText.includes("raid")) {
    text = "Pulling your open RAID items.";
    toolCall = { id: rid("tu"), name: "list_my_open_raid_items", input: { limit: 10 } };
  } else if (/(find|who is|account)/.test(userText)) {
    const m = userText.match(/(?:find|account|who is)\s+([a-z0-9 _-]+)/i);
    text = "Looking that account up.";
    toolCall = {
      id: rid("tu"),
      name: "resolve_account_by_name",
      input: { query: (m?.[1] ?? userText).trim().slice(0, 60) },
    };
  } else if (/(choose|pick|option)/.test(userText)) {
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

  acquireSlot(persona.id);
  try {
    // --- Confirm replay path -------------------------------------------
    if (input.confirmTurnId) {
      const result = await confirmPendingWrite(input.confirmTurnId, persona, emit);
      return result;
    }

    // --- Session + idempotency -----------------------------------------
    const session = await getOrCreateSession(persona, input.sessionId ?? null);
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
      userText: input.userText,
      intent: input.intent ?? null,
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
    history.push({ role: "user", content: input.userText });

    let status: CliTurnStatus = "streaming";
    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    let lastModel: string | undefined;
    let pendingWrite: { tool: string; input: Record<string, unknown> } | null = null;
    let runtimeError: string | null = null;

    const tools = Object.values(TOOL_REGISTRY);

    try {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const claudeStep = await modelStep({
        history,
        tools,
        intent: input.intent ?? null,
      });
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
      const durationMs = Date.now() - t0;
      if (!finalEmitted) {
        record({
          type: "final",
          data: {
            status,
            turnId,
            sessionId: session.id,
            costUsd: Number(totalCost.toFixed(6)),
            tokensIn: totalIn,
            tokensOut: totalOut,
            durationMs,
            error: runtimeError ?? undefined,
          },
        });
      }
      // Best-effort persistence — never let DB hiccups mask the original
      // error path or skip the audit row.
      await db
        .update(atelierCliTurns)
        .set({
          status,
          statusMessage: pendingWrite ? "awaiting confirmation" : runtimeError ?? status,
          frames,
          toolCalls,
          pendingWrite,
          costUsd: totalCost,
          tokensIn: totalIn,
          tokensOut: totalOut,
          model: lastModel,
          durationMs,
          lastStepIdx: toolCalls.length,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(atelierCliTurns.id, turnId))
        .catch(() => undefined);

      await db
        .update(atelierCliSessions)
        .set({
          turnCount: (session.turnCount ?? 0) + 1,
          recentTurnIds: [...((session.recentTurnIds as string[]) ?? []), turnId].slice(-20),
          lastTurnAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(atelierCliSessions.id, session.id))
        .catch(() => undefined);

      if (totalCost > 0) {
        await chargeSession(session.id, totalCost).catch(() => undefined);
      }

      // Audit ALWAYS runs — success, error, or partial.
      await db
        .insert(atelierAuditEvents)
        .values({
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
            costUsd: Number(totalCost.toFixed(6)),
            tokensIn: totalIn,
            tokensOut: totalOut,
            model: lastModel,
            mock: MOCK_MODE,
            error: runtimeError ?? undefined,
          },
          payloadSummary: `CLI turn ${status} (${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"})${input.intent ? ` · intent=${input.intent}` : ""}${runtimeError ? ` · err=${runtimeError.slice(0, 80)}` : ""}`,
        })
        .catch(() => undefined);
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
  await db
    .update(atelierCliTurns)
    .set({
      status: newStatus,
      statusMessage: newStatus,
      frames: newFrames,
      pendingWrite: null,
      lastStepIdx: stepIdx,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierCliTurns.id, turnId));

  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "cli_turn",
    entityId: turnId,
    actorType: "human",
    actorId: persona.id,
    actorLabel: persona.name,
    action: "cli.turn.confirmed",
    payload: { sessionId: turn.sessionId, tool: pending.tool, ok: result.ok },
    payloadSummary: `CLI confirm ${pending.tool} ${result.ok ? "ok" : "fail"}`,
  });

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
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "cli_turn",
    entityId: turnId,
    actorType: "human",
    actorId: persona.id,
    actorLabel: persona.name,
    action: "cli.turn.cancelled",
    payload: { sessionId: turn.sessionId },
    payloadSummary: "CLI confirm cancelled",
  });
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

// Avoid unused warnings for helpers used only in tests.
export const _unused = { atelierUsers, gte };
