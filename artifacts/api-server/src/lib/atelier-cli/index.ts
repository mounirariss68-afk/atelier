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
  atelierCliAttachments,
  atelierExtractedDocuments,
  atelierCliJobs,
  atelierAuditEvents,
  atelierAccounts,
  atelierRaidItems,
  atelierUsers,
  atelierEngagements,
  atelierEngagementAccess,
} from "@workspace/db";
import { and, desc, eq, gte, ilike, isNull, ne, or, inArray } from "drizzle-orm";
import {
  composeReplayFromTurns,
  DEFAULT_REPLAY_BUDGET,
  type ReplayTurnRow,
} from "./replay.js";
import {
  shouldEmitProactiveRecap,
  composeRecapCard,
  describeTurnOutcome,
  RECAP_OUTCOME_SEP,
  PROACTIVE_RECAP_DORMANT_MS,
  clarificationDeadReason,
} from "./recap-relevance.js";
import {
  extractFactsFromToolEvent,
  factsMode,
  FACTS_CONTRACT_VERSION,
  loadSessionFacts,
  normalizeControlIntent,
  renderFactsBlock,
  writeSessionFacts,
  type SessionFact,
} from "./session-facts.js";

/**
 * Task #741 — fire-and-forget facts capture from ANY successful tool
 * event, including paths that run OUTSIDE the streamed turn loop
 * (pending-write confirm, async job completions). Never throws.
 */
function ingestSessionFacts(args: {
  orgId: string;
  userId: string;
  sessionId: string;
  turnId: string;
  tool: string;
  input: unknown;
  data?: unknown;
  source?: SessionFact["source"];
}): void {
  if (factsMode() === "off") return;
  try {
    const facts = extractFactsFromToolEvent({
      tool: args.tool,
      input: args.input,
      data: args.data,
      source: args.source,
    });
    if (facts.length === 0) return;
    void writeSessionFacts({
      orgId: args.orgId,
      userId: args.userId,
      sessionId: args.sessionId,
      sourceTurnId: args.turnId,
      facts,
    }).catch((err) =>
      console.error(
        "[atelier-cli] session facts write failed",
        args.turnId,
        err instanceof Error ? err.message : String(err),
      ),
    );
  } catch (err) {
    console.error(
      "[atelier-cli] session facts extract failed",
      args.turnId,
      err instanceof Error ? err.message : String(err),
    );
  }
}
import { runWithProgressSink } from "../atelier-agents/progress-sink.js";
import { durableAccountUpdateEnabled } from "../assistant/durable-account-update-canary.js";
import { createDurableAccountUpdatePreview } from "../assistant/durable-account-update-preview.js";
import { confirmAndExecuteDurableAccountUpdate } from "../assistant/durable-account-update-confirmation.js";
import type { Response } from "express";
// Task #332 — capability catalog + perimeter helpers. Imported lazily
// inside getToolsForPersona() so tests / sandbox tooling can stub
// individual catalog entries without circular-import warnings.
import {
  capabilitiesForPersona,
  SELF_ONLY_CHAT_ROLES,
  findByToolName,
  CATALOG_SCHEMA_VERSION,
  scrubToolIdentifiers,
  scrubKnownToolNames,
  getSessionDraft,
  recordSessionResult,
  ingestEntitiesFromToolResult,
  summarizeSessionDraft,
  pruneSessionDrafts,
} from "./capability-catalog.js";
import {
  isClientVisibleCliFrameType,
  isManagedPresentationCapability,
  synthesizePresentation,
} from "./presentation-registry.js";
// Task #795 — registry-driven honest refusals for excluded /me actions.
import { selfServiceExclusionGuidance } from "./me-chat-parity.js";
// Task #339 — single bootstrap entry point. Imports cli-only entries,
// attachment+rubric capabilities, and walks the agent registry.
import "./bootstrap-capabilities.js";
import { financeDocKindsForAttachments } from "./finance-doc-capabilities.js";
import { isValidOrgOwner } from "../atelier-owner-validate.js";
import { redactJson, redactText, statsTouched } from "./pii-redaction.js";
import {
  attachmentMentionsDestructive,
  deriveTypedNameExpected,
  LEGACY_TYPED_NAME_PLACEHOLDER,
  shouldRequireTypedNameForAttachmentTurn,
  wrapAttachment,
} from "./prompt-guard.js";
import { stripLocalePreamble } from "./locale.js";
import { normalizeLocationAnswer, normalizeTimeInput } from "./chat-normalizers.js";
import {
  clarificationResolverMode,
  matchOption,
  parseOrdinalChoice,
  resolveClarificationReply,
  resolveWithModel,
  type FactRow,
  type ResolverOutcome,
} from "./clarification-resolver.js";
import { DEFAULT_CHAT_TZ, normalizeChatTz, wallParts as tzWallParts } from "./chat-tz.js";
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

// ---------------------------------------------------------------------
// 1. Types
// ---------------------------------------------------------------------

export type CliFrameType =
  | "narration"
  /** Task #1000 — incremental model text chunk (live streaming only;
   * never persisted — replay uses the final `narration` frame). */
  | "text_delta"
  | "plan_step"
  | "tool_call"
  | "tool_result"
  | "tool_evidence"
  | "presentation"
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
  /**
   * Task #581 — device IANA timezone sent by the chat client. Drives
   * date math in the system prompt and wall-clock parsing/labels in the
   * meeting tools. Invalid/missing → Asia/Dubai.
   */
  timezone?: string | null;
  /**
   * Clarification continuation: when the client answers a restored
   * clarification card, this carries the paused turn's id so the
   * server can rehydrate the pending question even if the answer
   * lands in a different (e.g. rolled-over) session.
   */
  continuesTurnId?: string | null;
  /**
   * Multi-field clarification answers: map of clarification field name
   * (e.g. "values.fee") → user-entered value. When present alongside a
   * pending clarification, all non-blank values are merged into the
   * resumed tool arguments in one continuation instead of one field per
   * round-trip. Keys are restricted to the fields the pending
   * clarification actually asked for.
   */
  clarificationValues?: Record<string, string> | null;
  /**
   * Task #799 — deterministic disambiguation pick. When the client taps
   * an option chip after a `needs_disambiguation` frame, it sends the
   * chosen option id here (alongside the human-readable prompt). The
   * orchestrator merges the id into the pending disambiguation's
   * declared field and re-runs the originating tool server-side — no
   * model extraction involved.
   */
  disambigOptionId?: string | null;
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
   * Task #1116 — accepted for API compatibility but INERT. Historically
   * this dispatched the paused pendingWrite to a background runner that
   * committed it without user approval. Writes now commit only via the
   * /confirm endpoint's verified replay; `async:true` never bypasses it.
   */
  async?: boolean;
}

// ---------------------------------------------------------------------
// 2. IDs + util
// ---------------------------------------------------------------------

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
    "[atelier-cli] AI_INTEGRATIONS_ANTHROPIC_BASE_URL and AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Atelier chat orchestrator does not support mock mode.",
  );
}

const SESSION_DAILY_BUDGET_USD = Number(
  process.env.ATELIER_CLI_SESSION_DAILY_BUDGET_USD ?? 5,
);
const MAX_TOOL_STEPS = Number(process.env.ATELIER_CLI_MAX_STEPS ?? 12);

// Task #769 — per-turn read-flail guard. When the same read tool is
// called more than FLAIL_ESCALATION_THRESHOLD times in a single turn
// (e.g. stage-by-stage pipeline brute-force), escalate the remaining
// model steps to Sonnet so it can reason from a wider context window.
// At FLAIL_STOP_THRESHOLD, surface a candidate-list clarification and
// stop the turn instead of continuing to spin. Both are env-tunable.
const FLAIL_ESCALATION_THRESHOLD = Number(
  process.env.ATELIER_CLI_FLAIL_ESCALATION ?? 3,
);
const FLAIL_STOP_THRESHOLD = Number(
  process.env.ATELIER_CLI_FLAIL_STOP ?? 4,
);

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

// ---------------------------------------------------------------------
// 3. Tool registry
// ---------------------------------------------------------------------

export interface ToolContext {
  persona: CliPersona;
  turnId: string;
  sessionId: string;
  /** Task #581 — validated device timezone for this turn (IANA). Absent
   * on confirm replays, where the pending input carries `tz` instead. */
  timezone?: string;
  /** Step index used for idempotency keys + partial-success bookkeeping. */
  stepIdx: number;
  /**
   * Emit a live progress update for the current turn. Set by `runTurn` so any
   * tool — and any agent it dispatches (via the ambient progress sink) — can
   * stream a growing step list to the UI instead of a frozen "Thinking…".
   */
  progress?: (
    pct: number,
    message: string,
    data?: Record<string, unknown>,
  ) => void;
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
    durableAction?: { actionId: string; stateVersion: number };
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
    /**
     * Multi-field clarification: the full list of missing fields, each
     * with a machine name (merged into the resumed args), a
     * human-readable label, and an optional hint. When more than one
     * entry is present the client renders one labeled input per field
     * so the user can answer everything in a single round-trip. The
     * single-field `field`/`question` pair above remains authoritative
     * for backward compatibility (and MUST name the first entry).
     */
    fields?: Array<{
      field: string;
      label: string;
      hint?: string;
      /**
       * Task #291 / #706 — richer clarification inputs, mirrored in
       * `@workspace/chat-core` ClarificationField: `options` renders a
       * dropdown, `inputType: "date"` a date picker, `defaultValue`
       * pre-fills the input. Long-standing emitters (contract_prepare,
       * travel tools) rely on these being part of the contract.
       */
      inputType?: "date" | string;
      options?: string[];
      defaultValue?: string;
    }>;
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
  /**
   * Task #24 — deferred post-commit work (e.g. Pursuit Scout after an
   * opportunity create). The orchestrator emits the tool_result/final
   * frames FIRST, then awaits this closure and emits the frame it
   * returns, so slow follow-up work never delays the success feedback.
   * The write is already committed when this runs; a failure here is
   * surfaced as a frame, never a rollback. Not persisted by the
   * idempotency job (only `data` is), so replays skip it by design.
   */
  after?: () => Promise<CliFrame | null>;
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

    // Task #940 — mirror the REST owner validation: a supplied owner must
    // be a live org user, or the "assigned" item is invisible on every
    // assigned-to-me surface. (The default — the caller — is always valid.)
    if (
      input.ownerUserId &&
      !(await isValidOrgOwner(String(input.ownerUserId), ctx.persona.orgId))
    ) {
      return {
        ok: false,
        errorCode: "invalid_owner",
        errorMessage: `Unknown owner ${String(input.ownerUserId)} — the owner must be an active user in your organisation.`,
      };
    }
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
  // Task #422 — self-only personas (employee / contractor) never receive
  // the legacy TOOL_REGISTRY fallthrough: their chat surface is exactly
  // the identity-locked me.* catalog entries already collected above.
  if (SELF_ONLY_CHAT_ROLES.has(persona.role)) return out;
  // Task #873 — alliance partners (external firm logins) never receive the
  // legacy TOOL_REGISTRY fallthrough either: their chat surface is exactly
  // the grant-scoped partnerportal.* catalog entries collected above.
  if (persona.role === "alliance_partner") return out;
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
// Meta post-processors the turn loop itself relies on (recap, undo,
// clarification choices, feature requests). Restricted personas — self-only
// employees/contractors AND external alliance partners — may dispatch these
// even though they sit outside their clamped capability slice.
const RESTRICTED_META_ALLOW = new Set([
  "refine_last",
  "recap",
  "explain_last",
  "undo_last",
  "request_feature",
  "present_choices",
]);

export function findToolByName(
  name: string,
  persona?: CliPersona,
): ToolDef | undefined {
  if (persona) {
    const fromSurface = getToolsForPersona(persona).find((t) => t.name === name);
    if (fromSurface) return fromSurface;
    // Task #873 — alliance partners (external logins) get NO fallback
    // resolution: their dispatchable surface is exactly the clamped
    // partnerportal.* set above, plus the meta post-processors (recap,
    // clarification choices, …) that the turn loop itself invokes.
    if (persona.role === "alliance_partner") {
      if (!RESTRICTED_META_ALLOW.has(name)) return undefined;
    }
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

// ---------------------------------------------------------------------
// 4. Concurrency lock + budget
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// 5. Sessions
// ---------------------------------------------------------------------

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
      // Task #184 — pause the inactivity clock while a clarification
      // question is outstanding. If this session's most recent turn is
      // still awaiting_clarification, the user's next prompt is very
      // likely the answer; rolling the session over here would strand
      // the pending question in a soft-deleted session and the answer
      // would be misread as a brand-new request.
      const [latestTurn] = await db
        .select({ status: atelierCliTurns.status })
        .from(atelierCliTurns)
        .where(eq(atelierCliTurns.sessionId, row.id))
        .orderBy(desc(atelierCliTurns.createdAt))
        .limit(1);
      if (latestTurn?.status === "awaiting_clarification") return row;
      // Inactivity rollover: soft-delete the stale session and fall
      // through to mint a fresh one. Keeps audit history intact.
      await db
        .update(atelierCliSessions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierCliSessions.id, row.id));
      // Task #739 — session lineage: the fresh session records its
      // predecessor and carries the rolling summary forward so the
      // replay window + recap never reference facts the model can't see.
      const [fresh] = await db
        .insert(atelierCliSessions)
        .values({
          id: rid("clis"),
          orgId: persona.orgId,
          userId: persona.id,
          createdByUserId: persona.id,
          spentCentsDay: todayUtc(),
          predecessorSessionId: row.id,
          rollingSummary: row.rollingSummary ?? "",
        })
        .returning();
      return fresh;
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

// ---------------------------------------------------------------------
// 6. Loop
// ---------------------------------------------------------------------

// Task #645 — deterministic backstops against narration that duplicates
// or contradicts result cards live in ./narration-contract.ts (pure,
// unit-testable). Re-exported here for existing import sites.
import {
  trimNarrationForCard,
  toolResultFrameKey,
  looksLikeWritePromise,
  stripUnfulfilledWritePromises,
  stripDeadEndDocumentAdvice,
  classifyGroundingNote,
  extractClassifyResults,
  stripBogusLowConfidenceClaims,
} from "./narration-contract.js";
export {
  cardPayloadTokens,
  narrationRestatesCard,
  firstSentence,
  trimNarrationForCard,
  looksLikeWritePromise,
  stripUnfulfilledWritePromises,
  stripDeadEndDocumentAdvice,
  classifyGroundingNote,
  extractClassifyResults,
  stripBogusLowConfidenceClaims,
} from "./narration-contract.js";

// Hallucinated tool-name recovery — find the unique close match for a
// mistyped tool name among the menu shown to the model. Token-overlap
// based (names are snake_case): accept only when ≥2/3 of the longer
// name's tokens match AND the winner clearly beats the runner-up, so
// "request_employment_certificate" → "request_employment_letter" but
// genuinely unknown names stay unresolved.
export function closestToolName(raw: string, menu: string[]): string | null {
  const want = raw.trim().toLowerCase();
  if (!want) return null;
  const wantTokens = new Set(want.split(/[^a-z0-9]+/).filter(Boolean));
  if (wantTokens.size === 0) return null;
  let best: { name: string; score: number } | null = null;
  let second = 0;
  for (const name of menu) {
    const n = name.trim().toLowerCase();
    if (!n || n === want) continue;
    const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length === 0) continue;
    let shared = 0;
    for (const t of tokens) if (wantTokens.has(t)) shared++;
    const score = shared / Math.max(tokens.length, wantTokens.size);
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { name, score };
    } else if (score > second) {
      second = score;
    }
  }
  if (!best || best.score < 2 / 3) return null;
  // Require a clear margin over the runner-up — a marginal winner is not a
  // confident correction and should fall through to the model-side retry.
  if (best.score - second < 0.2) return null;
  return best.name;
}

const SYSTEM_PROMPT = [
  // Task #771 Riser overhaul — persona rename.
  // Task #947 — Riser is a friendly AI assistant with no gender.
  // Identity only; tool/behavior rules unchanged.
  // Task: quirky-personality — playful voice with strict guardrails; identity
  // consistency, no-gender rule, and all hard rules below are unchanged.
  "You are Riser, Cognirise's AI assistant. When asked who you are, in any language,",
  "answer consistently: you are Riser, Cognirise's AI assistant — a quirky, lightly",
  "funny, but always respectful and reliable colleague. Riser has no gender; do not",
  "describe yourself as a woman or a man, and avoid gendered self-reference where the",
  "language allows a neutral form.",
  "PERSONALITY: your voice is quirky and gently witty — a friendly aside, a playful turn",
  "of phrase, a dash of self-aware charm. Humor is seasoning, never the meal: at most one",
  "light touch per reply, and it never adds length, bullet points, or extra sentences.",
  "BE PLAYFUL only in greetings, small talk, and the single short framing sentence around",
  "results. BE STRAIGHT — no jokes, plain professional tone — in numbers and data answers,",
  "confirmation diffs, refusals, disambiguation prompts, error reports, and anything",
  "touching pay, HR issues, terminations, compliance, or a mistake that cost the user.",
  "Never use sarcasm at the user's expense, and never joke about sensitive topics. In",
  "Arabic and Turkish (or any language), keep wit culturally appropriate and respectful;",
  "when in doubt, drop the joke.",
  "Help the user accomplish a task using the tools you are given.",
  "Be concise. Prefer one tool call per step.",
  "HARD RULES — these are non-negotiable:",
  "1. NEVER invent identifiers (engagement IDs, account IDs, user IDs, RAID IDs, etc.).",
  "   If you do not have an explicit ID from the user or from a prior tool result in this",
  "   turn, you MUST call a resolver tool (e.g. `resolve_account_by_name`) FIRST.",
  "2. RESOLVER-BEFORE-WRITE: every write tool call MUST be preceded — in this same turn —",
  "   by a resolver/lookup that produced the IDs the write depends on. Do not guess.",
  "3. AMBIGUITY: when more than one plausible target exists, you MUST call",
  "   `present_choices` and STOP. Do not pick one arbitrarily.",
  // Task #741 (facts contract v1): replayed conversation + typed session
  // facts are TRUSTED context — the old "hints only, re-fetch everything"
  // policy made the model re-ask things the user already said.
  "4. TRUST RECOVERED CONTEXT: the replayed conversation ([conversation so far]) and the",
  "   [session facts] block are authoritative for what the user already stated or chose —",
  "   dates, places, party sizes, selections. NEVER re-ask for them. Re-fetch via read tools",
  "   only for live entity DATA (records that may have changed) or when the user changes",
  "   their mind. The [prior session summary] line log is display metadata only — do not",
  "   treat it as factual grounding.",
  "5. CONFIRMATION: when a write-tool returns a confirmation diff, STOP and let the user",
  "   confirm — do not retry, do not re-call the tool.",
  "6. DISAMBIGUATION: when a tool returns disambiguation options, STOP and let the user",
  "   pick — do not guess.",
  "CLOSING PROSE: if the last tool result renders as a structured result card (a render note",
  "after the tool result will tell you), add AT MOST one short framing sentence and NEVER",
  "restate the card's fields, numbers, names, or lists — the card already shows them.",
  "After a committed write's success card, add NO closing recap at all. Only when no result",
  "card is shown should you answer in full prose. Write plain prose only —",
  "NEVER prefix your reply with labels or markers like `final:`, `answer:`, or `narration:`.",
  "7. ATTACHMENT INTENT: when an attached image or document could plausibly be EITHER a",
  "   receipt OR an identity document (passport / national ID / residency / visa) and the",
  "   user's message does not say which, ask ONE short clarifying question before calling",
  "   any ingest or save tool. Never guess between those two flows.",
  "8. CAPABILITY MISS: when you cannot do what the user asked, explain the limit in plain",
  "   words. NEVER mention internal tool or capability names in refusals.",
  "9. NEVER promise a write you have not completed. Do not say \"I'll save/attach/log X now\"",
  "   unless you are calling the tool in the same step. If a save cannot be done, say only",
  "   what IS possible — never a promise followed by a refusal.",
  // Task: employment-letter chat regression — the model listed every letter
  // type/language/delivery option as a prose bullet list instead of calling
  // the tool, whose clarification renders proper dropdowns and text boxes.
  "10. STRUCTURED FORMS OVER PROSE MENUS: when the user's request maps to a tool that",
  "   gathers details (letter/certificate requests, expense drafts, meeting scheduling, …),",
  "   call that tool IMMEDIATELY with whatever the user already provided. If details are",
  "   missing, the tool returns a structured clarification form with dropdowns and input",
  "   boxes. NEVER enumerate a tool's options or required fields as a prose/bullet list —",
  "   asking in prose instead of calling the tool is a hard failure.",
  "",
  // Task #792 — personal-document uploads must consult the user's existing
  // documents before choosing create vs attach, and chat is the ONLY
  // mobile upload path (the mobile profile page is view/download only).
  "PERSONAL DOCUMENTS (passport / national ID / residency / visa uploads):",
  "- FIRST call `my_documents` to see what is already on file before saving anything.",
  "- If the uploaded file is one side (or a renewal) of a document that ALREADY exists —",
  "  e.g. the BACK of a national ID whose front is saved — call `attach_my_document_file`",
  "  with that document's id and the correct side. Do NOT create a duplicate document and",
  "  do NOT ask the user to re-upload a side that is already on file.",
  "- Only when no matching document exists, call `save_my_document` to create one (ask for",
  "  the front only if it is truly absent). If the same side seems to be uploaded twice,",
  "  ask ONE short clarifying question.",
  "- Saving, attaching and replacing personal-document scans IS available right here in",
  "  chat. NEVER claim it isn't available in this interface, and NEVER send the user to a",
  "  profile page to upload — on mobile no such upload form exists.",
  "",
  // Task #469 — person questions must route to the right domain and
  // cross-check the sibling domain before declaring anyone nonexistent.
  "PERSON LOOKUP ROUTING:",
  "- 'Who is the CEO/CFO/<title> of <company>' or any person-AT-a-company question: resolve the",
  "  company as an ACCOUNT first, then answer from its client contacts (`contact_list` /",
  "  `contact_detail` with accountName).",
  "- Named person AT a company ('Sarah at Tasama', 'find Ayşe from Acme'): ONE call to",
  "  `person_detail` with BOTH `name` and `company` — it searches that company's client",
  "  contacts AND partner-firm roster people in one step. Never split this into separate",
  "  account + contact calls, and never drop the company from the lookup.",
  "- Bare person-name questions ('phone of Mounir') may be about an internal colleague OR a client",
  "  contact. `contact_detail` and `person_detail` each auto-fall-back to the other domain, so one",
  "  call is enough — but a `not_found` from a tool that did NOT cross-check both domains is never",
  "  proof the person doesn't exist.",
  "- When a person cannot be found in either domain, say so in plain words (no error jargon) and",
  "  suggest checking the spelling or the account name.",
  "",
  // Task #426 — compound account questions resolve in ONE composed read.
  "COMPOUND ACCOUNT QUESTIONS (read-only):",
  "- When the user asks a compound question about one account — who works on it / who's",
  "  staffed there PLUS its deals, pipeline, engagements, or recent meetings — call",
  "  `account_team_and_pipeline` ONCE with the account name. It returns the team, open",
  "  opportunities, active engagements, and recent meetings together. Do NOT chain",
  "  separate roster/opportunity/meeting reads for this.",
  "- If the question is about only ONE of those facets, keep using the focused single-",
  "  entity read tool instead.",
  "",
  // Task #443 — compound person questions resolve in ONE composed read.
  "COMPOUND PERSON QUESTIONS (read-only):",
  "- When the user asks what one PERSON is working on / staffed on — their accounts,",
  "  engagements, allocations, or the deals they own, together — call `person_workload`",
  "  ONCE with the person's name. It returns their account-team roles, active engagement",
  "  staffings with allocation %, and open opportunities they own or lead. Do NOT chain",
  "  separate roster/engagement/opportunity reads for this.",
  // Task #570 — calendar-availability vs workload split: "is X free at
  // 3pm / tomorrow?" is a CALENDAR question, not a staffing question.
  "- CALENDAR availability questions — tied to a specific date/time ('is X free tomorrow",
  "  at 3pm?', 'what does my Thursday look like?', 'when are X and I both free?') — use",
  "  `check_availability` (specific time or whole-day busy blocks) or `find_free_slot`",
  "  (earliest common free slot). These check real Outlook calendars and book nothing.",
  "- WORKLOAD / capacity questions ('does X have bandwidth?', 'can X take on more",
  "  work?') are staffing questions — call `person_workload` and lead your answer",
  "  with the capacity signal from `totalAllocationPct` / `capacityStatus`: state the",
  "  total allocation plainly (e.g. '120% allocated — overallocated by 20%' or '60%",
  "  allocated — about 40% available'). If `hiddenAccountCount` > 0, note the visible",
  "  total may understate their real load.",
  "- If the question is about only ONE facet (e.g. just their profile or just one",
  "  engagement), keep using the focused single-entity read tool instead.",
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
  "- If the `{ ok: true }` result has `degraded: true`, automated research timed out or failed and the draft holds ONLY",
  "  what the user typed. Do NOT claim you researched the firm. Instead say research couldn't complete and the user can",
  "  fill in the remaining details on the proposal card via \"Review & Create\". Still STOP — do NOT call another tool.",
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

/**
 * Task #1000 — whether the model step streams text token-by-token.
 * On for live traffic; defaults OFF under NODE_ENV=test so the dozens
 * of JSON-replying stub-Anthropic probes keep working unchanged.
 * Explicit ATELIER_CLI_STREAM_TEXT=on/off always wins.
 */
function textStreamEnabled(): boolean {
  const v = (process.env.ATELIER_CLI_STREAM_TEXT ?? "").toLowerCase();
  if (v === "on") return true;
  if (v === "off") return false;
  return process.env.NODE_ENV !== "test";
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
  /**
   * Task #1000 — when set, the call uses the Anthropic STREAMING API and
   * invokes this with the full raw text accumulated so far after each
   * text chunk. Absent → the classic non-streaming request (all existing
   * stub probes rely on plain JSON responses).
   */
  onTextDelta?: (fullText: string) => void;
  /** Fired the instant a tool_use content block starts streaming, so the
   * caller can retract any tentatively streamed pre-tool prose. */
  onToolUseStart?: () => void;
  /** Fired before a transient-failure retry so the caller can clear any
   * partially streamed text. */
  onStreamReset?: () => void;
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
  // Shared tail: cost + stop_reason mapping for both transports.
  const finishStep = (s: {
    text: string;
    toolCall: ClaudeToolCall | null;
    stopReason: string | null;
    tokensIn: number;
    tokensOut: number;
    model: string;
  }): ClaudeStep => {
    const inRate = s.model.includes("haiku") ? 1 : 3;
    const outRate = s.model.includes("haiku") ? 5 : 15;
    const costUsd = (s.tokensIn * inRate + s.tokensOut * outRate) / 1_000_000;
    // Map Anthropic stop_reasons. Only `tool_use` continues the loop;
    // `end_turn` ends cleanly. `max_tokens`/`pause_turn`/`refusal`/etc.
    // surface as an explicit aborted step so the orchestrator can mark
    // the turn `partial` instead of silently succeeding.
    let stop: "tool_use" | "end_turn" | "aborted";
    if (s.stopReason === "tool_use") stop = "tool_use";
    else if (s.stopReason === "end_turn" || s.stopReason === "stop_sequence") stop = "end_turn";
    else stop = "aborted";
    // If the model emitted a tool_use block alongside an unsupported
    // stop reason (e.g. max_tokens), still execute the tool — but mark
    // aborted on the next iteration if the model bails.
    if (s.toolCall && stop === "aborted") stop = "tool_use";
    return {
      text: s.text.trim(),
      toolCall: s.toolCall,
      stop,
      costUsd,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      stopReason: s.stopReason,
      model: s.model || chosenModel,
    };
  };
  // Task #1000 — streaming transport: one SSE-driven message.create with
  // stream:true; text chunks fan out live via onTextDelta.
  const streamOnce = async (): Promise<ClaudeStep> => {
    const stream = (await anthropic.messages.create(
      {
        model: chosenModel,
        max_tokens: MAX_TOKENS,
        system: systemBlocks as MsgCreateParams["system"],
        tools: toolsForCall as MsgCreateParams["tools"],
        messages: args.history as MsgCreateParams["messages"],
        stream: true,
      },
      { signal: ac.signal },
    )) as AsyncIterable<Record<string, unknown>>;
    let text = "";
    let model = "";
    let tokensIn = 0;
    let tokensOut = 0;
    let stopReason: string | null = null;
    let tool: { id: string; name: string; json: string } | null = null;
    for await (const raw of stream) {
      const ev = raw as {
        type?: string;
        message?: { model?: string; usage?: { input_tokens?: number } };
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
        usage?: { output_tokens?: number };
      };
      if (ev.type === "message_start") {
        model = ev.message?.model ?? model;
        tokensIn = ev.message?.usage?.input_tokens ?? tokensIn;
      } else if (ev.type === "content_block_start") {
        if (ev.content_block?.type === "tool_use") {
          // Last tool_use block wins (mirrors the non-streaming path).
          tool = { id: ev.content_block.id ?? "", name: ev.content_block.name ?? "", json: "" };
          args.onToolUseStart?.();
        }
      } else if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta") {
          text += ev.delta.text ?? "";
          args.onTextDelta?.(text);
        } else if (ev.delta?.type === "input_json_delta" && tool) {
          tool.json += ev.delta.partial_json ?? "";
        }
      } else if (ev.type === "message_delta") {
        stopReason = ev.delta?.stop_reason ?? stopReason;
        tokensOut = ev.usage?.output_tokens ?? tokensOut;
      }
    }
    let toolCall: ClaudeToolCall | null = null;
    if (tool) {
      let input: Record<string, unknown> = {};
      try {
        input = tool.json ? (JSON.parse(tool.json) as Record<string, unknown>) : {};
      } catch {
        input = {};
      }
      toolCall = { id: tool.id, name: tool.name, input };
    }
    return finishStep({ text, toolCall, stopReason, tokensIn, tokensOut, model });
  };
  try {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        if (args.onTextDelta) {
          return await streamOnce();
        }
        const resp = await callOnce();
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
        return finishStep({
          text,
          toolCall,
          stopReason: resp.stop_reason ?? null,
          tokensIn: resp.usage.input_tokens,
          tokensOut: resp.usage.output_tokens,
          model: resp.model ?? "",
        });
      } catch (err) {
        if (attempt >= RETRY_MAX || !isTransient(err)) throw err;
        // A retried streaming call must clear any partially streamed text
        // before the fresh attempt re-streams from the start.
        args.onStreamReset?.();
        const baseMs = 250 * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, baseMs + jitter));
        attempt++;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------
// Task #416 — Auto-generated session titles.
//
// After a session's first completed turn we fire a tiny Haiku call that
// summarizes the user's prompt into a 3–6 word title and saves it onto
// the session row. Strictly fire-and-forget: any error, timeout, or
// garbage output is swallowed and the session simply stays untitled.
// The UPDATE is guarded on `title IS NULL` so a concurrent turn (or a
// stale in-memory session row) can never overwrite an existing title.
// ---------------------------------------------------------------------

const SESSION_TITLE_MAX_CHARS = 60;

/** Trim/strip model output down to a clean one-line title, or null. */
export function sanitizeSessionTitle(raw: string): string | null {
  let t = (raw ?? "").trim().split("\n")[0]?.trim() ?? "";
  // Strip wrapping quotes and trailing sentence punctuation.
  t = t
    .replace(/^["'“”‘’`]+/, "")
    .replace(/["'“”‘’`]+$/, "")
    .replace(/[.!?\s]+$/g, "")
    .trim();
  if (!t) return null;
  if (t.length > SESSION_TITLE_MAX_CHARS) {
    t = t.slice(0, SESSION_TITLE_MAX_CHARS).trimEnd();
  }
  return t || null;
}

export async function generateAndSaveSessionTitle(
  sessionId: string,
  prompt: string,
): Promise<void> {
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");
    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(),
      Number(process.env.ATELIER_CLI_TITLE_TIMEOUT_MS ?? 10_000),
    );
    let resp;
    try {
      resp = await anthropic.messages.create(
        {
          model: HAIKU_CLASSIFIER_MODEL,
          max_tokens: 40,
          system:
            "You title chat conversations. Reply with ONLY a short title of 3-6 plain words capturing the user's intent (e.g. \"Log timesheet for Acme\"). No quotes, no trailing punctuation, no explanation.",
          messages: [
            {
              role: "user",
              content: redactText(prompt).text.slice(0, 500) || "(empty prompt)",
            },
          ],
        },
        { signal: ac.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    let text = "";
    for (const block of resp.content) {
      if (block.type === "text") text += block.text;
    }
    const title = sanitizeSessionTitle(text);
    if (!title) return;
    await db
      .update(atelierCliSessions)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(atelierCliSessions.id, sessionId),
          isNull(atelierCliSessions.title),
        ),
      );
  } catch (err) {
    // Fire-and-forget by contract — a failed title must never surface.
    console.warn(
      "[atelier-cli] session title generation failed",
      sessionId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ---------------------------------------------------------------------
// Task #338 — Natural-language → catalog routing.
//
// `routePromptToCapability` is a pure heuristic that maps an unstructured
// prompt to a capability + extracted input. Available as a pre-filter
// for the live model. Each branch picks the first thing that matches
// and stops — keep cheap+deterministic.
// ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Task #341 — read-side intent routing.
  // Reads are dispatched by phrase patterns shared with the smoke
  // tests. None of these mutate state, so they're confidence:"high"
  // whenever the pattern matches; the orchestrator skips the
  // confirm phase entirely (isWrite:false in the catalog).
  // ---------------------------------------------------------------------

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

  // Task #390 — account / client roster. "Show me the list of clients",
  // "list all accounts", "who are our clients". Matched BEFORE the
  // engagement fallback so client/account phrasing never routes to
  // engagement_list_active.
  if (
    // Plural only, so "show me the Acme account" (single lookup) is not
    // hijacked; "list of clients", "our clients", "all accounts" match.
    /\b(list|show|display|see|view|who\s+are)\b.*\b(clients|accounts|customers)\b/i.test(promptRaw) ||
    /\b(clients?|accounts?|customers?)\s+list\b/i.test(promptRaw)
  ) {
    const archived = /\barchived\b/i.test(promptRaw);
    return {
      toolName: "account_list",
      confidence: "high",
      input: { status: archived ? "archived" : "active" },
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

  // ---------------------------------------------------------------------
  // L2C Wave 1 (Task #360, W1-S8) — Codex / CLM, change-orders,
  // deliverable-acceptance routing. Each branch matches the
  // representative prompts shipped with the catalog entries and
  // extracts the canonical id/value the corresponding tool expects.
  // Order matters: more-specific phrases (record acceptance, dispatch
  // contract) must come before broader ones (acceptance, contract).
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // L2C Wave 4 (Task #363) — cash application, bank reconciliation,
  // 13-week forecast, renewal motion. These branches must precede the
  // broader Renewal Watchdog branch below ("renewals?" catches
  // "renewal_open" / "renewal_list" otherwise).
  // ---------------------------------------------------------------------

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
/**
 * Task #978/#992 — shared open-thread detection: unresolved items from
 * prior turns (a draft that was never confirmed, a question that was
 * never answered) survive in atelierCliTurns even across restarts.
 * Used by both the proactive "Catching you up" card and the explicit
 * /recap capability so the two stay consistent. Never throws.
 */
export async function collectRecapOpenThreads(args: {
  sessionId: string;
  excludeTurnId?: string | null;
}): Promise<string[]> {
  try {
    const [sessionOwner] = await db
      .select({ userId: atelierCliSessions.userId, orgId: atelierCliSessions.orgId })
      .from(atelierCliSessions)
      .where(eq(atelierCliSessions.id, args.sessionId))
      .limit(1);
    if (!sessionOwner) return [];
    const statusFilter = inArray(atelierCliTurns.status, [
      "awaiting_confirmation",
      "awaiting_clarification",
    ]);
    const openRows = await db
      .select({
        id: atelierCliTurns.id,
        createdAt: atelierCliTurns.createdAt,
        status: atelierCliTurns.status,
        pendingWrite: atelierCliTurns.pendingWrite,
        frames: atelierCliTurns.frames,
      })
      .from(atelierCliTurns)
      .where(
        args.excludeTurnId
          ? and(
              eq(atelierCliTurns.sessionId, args.sessionId),
              ne(atelierCliTurns.id, args.excludeTurnId),
              statusFilter,
            )
          : and(eq(atelierCliTurns.sessionId, args.sessionId), statusFilter),
      )
      .orderBy(desc(atelierCliTurns.createdAt))
      .limit(50);
    const threads: string[] = [];
    for (const row of openRows) {
      if (row.status === "awaiting_clarification") {
        const [newer] = await db
          .select({ createdAt: atelierCliTurns.createdAt })
          .from(atelierCliTurns)
          .where(
            and(
              eq(atelierCliTurns.userId, sessionOwner.userId),
              eq(atelierCliTurns.orgId, sessionOwner.orgId),
              gte(atelierCliTurns.createdAt, row.createdAt),
              ne(atelierCliTurns.id, row.id),
            ),
          )
          .orderBy(desc(atelierCliTurns.createdAt))
          .limit(1);
        const dead = clarificationDeadReason({
          createdAt: row.createdAt,
          newerActivityAt: newer?.createdAt,
        });
        if (dead) {
          const now = new Date();
          await db
            .update(atelierCliTurns)
            .set({
              status: "cancelled",
              statusMessage:
                dead === "expired"
                  ? "clarification expired (older than 7 days)"
                  : "superseded by newer activity",
              finishedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(atelierCliTurns.id, row.id),
                eq(atelierCliTurns.status, "awaiting_clarification"),
              ),
            );
          continue;
        }
      }
      if (row.status === "awaiting_confirmation") {
        const pw = row.pendingWrite as { tool?: string } | null;
        const what =
          pw && typeof pw.tool === "string" ? humanizeToolName(pw.tool) : "a change";
        threads.push(
          `You were in the middle of confirming ${what} — it was never committed.`,
        );
      } else {
        const frames = Array.isArray(row.frames)
          ? (row.frames as Array<{ type?: string; data?: { question?: unknown } }>)
          : [];
        const nc = [...frames].reverse().find((f) => f?.type === "needs_clarification");
        const q = typeof nc?.data?.question === "string" ? nc.data.question.trim() : "";
        threads.push(
          q
            ? `I asked: “${q.slice(0, 140)}” — still waiting on your answer.`
            : "I asked you a question that's still waiting on an answer.",
        );
      }
    }
    return [...new Set(threads)].slice(0, 3);
  } catch (err) {
    console.error(
      "[atelier-cli] recap open-thread lookup failed",
      args.sessionId,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

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

// Continuation-gate heuristic: does a bare prompt (no `continuesTurnId`)
// plausibly answer a pending clarification question? Answers are short,
// single-line, and don't open with a fresh command verb. Anything else is
// treated as a new request that supersedes the pending question.
const COMMAND_OPENERS = new Set([
  "add", "create", "make", "new", "show", "list", "get", "find", "search",
  "open", "update", "edit", "change", "set", "rename", "move", "mark",
  "delete", "remove", "archive", "merge", "assign", "log", "schedule",
  "draft", "send", "email", "close", "approve", "reject", "override",
  "run", "generate", "export", "pull", "give", "help", "what", "whats",
  "who", "whos", "how", "why", "when", "where", "which", "can", "could",
  "please", "tell",
  // Task #567 — scheduling verbs: a fresh "setup a meeting…" /
  // "book…" / "reschedule…" / "cancel…" while a clarification is
  // pending is a NEW request, not an answer to the paused question.
  "setup", "book", "reschedule", "cancel", "invite", "plan", "check",
]);
/**
 * Task #644 — refusal-ish text detector for the widen-on-miss retry.
 * Fires only when the model's prose claims it lacks a tool/capability
 * for the request, never on normal answers. Pure + exported so the
 * offline probe suite can pin the phrasing coverage.
 */
export function looksLikeToolMiss(raw: string | null | undefined): boolean {
  const t = (raw ?? "").toLowerCase();
  if (!t) return false;
  return (
    /(don'?t|do not|doesn'?t|does not|no longer)\s+(currently\s+)?(have|see|find)\s+(access to\s+)?(a|any|the)?\s*(suitable\s+|available\s+|specific\s+)?(tool|capabilit(?:y|ies)|function|way to)/.test(t) ||
    /\bno\s+(suitable\s+|available\s+|matching\s+)?(tools?|capabilit(?:y|ies)|functions?)\b/.test(t) ||
    /\b(i'?m|i am)\s+(unable|not able)\s+to\s+(do|perform|handle|complete)\s+(this|that)\b/.test(t) ||
    // Task #792 — "isn't available in this interface/app" variants, and
    // deflections to a (nonexistent on mobile) profile-page upload.
    /\bnot\s+(currently\s+)?(supported|available)\s+(in|on|through)\s+(this|the)\s+(chat|cli|assistant|surface|interface|app)\b/.test(t) ||
    /\b(isn'?t|is not)\s+(currently\s+)?available\s+(in|on|through)\s+(this|the)\s+(chat|cli|assistant|surface|interface|app)\b/.test(t) ||
    /\b(upload|update|add|manage|do)\s+(it|this|that|them)?\s*(from|on|via|through)\s+(the\s+|your\s+)?profile\s+page\b/.test(t) ||
    /\bcannot\s+(find|locate)\s+(a|any)\s+(tool|capabilit(?:y|ies)|function)/.test(t)
  );
}

export function looksLikeClarificationAnswer(raw: string): boolean {
  const p = (raw ?? "").trim();
  if (!p) return false;
  if (p.length > 80) return false;
  if (/[\r\n]/.test(p)) return false;
  const firstWord = (p.split(/\s+/)[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z']/g, "")
    .replace(/'/g, "");
  if (COMMAND_OPENERS.has(firstWord)) return false;
  return true;
}

/**
 * Merge a single clarification answer into the resumed tool args.
 * Non-dotted field names merge at TOP-LEVEL (the long-standing
 * continuation convention — siblings of `kind`/`input`/etc). Dotted
 * names (e.g. "values.fee" from contract_prepare) expand into the
 * nested object path so the tool actually sees the value where its
 * schema expects it — a literal top-level "values.fee" key would be
 * silently ignored by the tool and re-trigger the same question.
 */
export function mergeClarificationAnswer(
  base: Record<string, unknown>,
  field: string,
  value: string,
): Record<string, unknown> {
  const dot = field.indexOf(".");
  if (dot <= 0) return { ...base, [field]: value };
  const head = field.slice(0, dot);
  const rest = field.slice(dot + 1);
  const child = base[head];
  const childObj =
    child && typeof child === "object" && !Array.isArray(child)
      ? (child as Record<string, unknown>)
      : {};
  return { ...base, [head]: mergeClarificationAnswer(childObj, rest, value) };
}

/**
 * Task #1318 — sensitive clarification inputs (PDF unlock passwords).
 * A password answered through chat must reach the TOOL byte-for-byte,
 * but never any durable surface: turn prompt, frames (streamed AND
 * persisted, and rehydrated as clarification partials), toolCalls,
 * pendingWrite pins, session rolling summary, session titles, facts.
 * These helpers deep-REMOVE sensitive keys (removal, not masking, so a
 * rehydrated partial simply re-asks instead of replaying a "[redacted]"
 * literal as the password).
 */
export const SENSITIVE_INPUT_KEYS: ReadonlySet<string> = new Set(["password"]);
export const SENSITIVE_PROMPT_PLACEHOLDER = "[password redacted — used once, never stored]";

export function containsSensitiveKey(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => containsSensitiveKey(x));
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_INPUT_KEYS.has(k)) return true;
      if (containsSensitiveKey(val)) return true;
    }
  }
  return false;
}

/**
 * Deep-copy `v` with every SENSITIVE_INPUT_KEYS property removed.
 * Returns the ORIGINAL reference when nothing sensitive is present
 * (no copy cost on the hot path), and never mutates its argument —
 * the live tool input object stays intact for `tool.run`.
 */
export function stripSensitiveValues<T>(v: T): T {
  if (!containsSensitiveKey(v)) return v;
  if (Array.isArray(v)) return v.map((x) => stripSensitiveValues(x)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_INPUT_KEYS.has(k)) continue;
      out[k] = stripSensitiveValues(val);
    }
    return out as unknown as T;
  }
  return v;
}

/** Does a pending clarification ask for a sensitive (password) field? */
function asksSensitiveField(
  pc:
    | {
        field?: string | null;
        fields?: Array<{ field?: string }> | null;
      }
    | null
    | undefined,
): boolean {
  if (!pc) return false;
  if (typeof pc.field === "string" && SENSITIVE_INPUT_KEYS.has(pc.field)) return true;
  return (pc.fields ?? []).some(
    (f) => typeof f?.field === "string" && SENSITIVE_INPUT_KEYS.has(f.field),
  );
}

/** Latest needs_clarification frame in a persisted frames array, if any. */
function latestClarificationFrame(
  frames: unknown,
): { field?: string | null; fields?: Array<{ field?: string }> | null } | null {
  if (!Array.isArray(frames)) return null;
  const nc = [...frames]
    .reverse()
    .find(
      (f) => (f as { type?: string } | null)?.type === "needs_clarification",
    ) as { data?: unknown } | undefined;
  return (nc?.data as ReturnType<typeof latestClarificationFrame>) ?? null;
}

/**
 * Does this request answer a pending clarification that asks for a
 * SENSITIVE field (e.g. a PDF unlock password)? HTTP ingress must know
 * BEFORE applying its ordinary prompt trim / length caps / value
 * truncation, or the secret is silently corrupted on the way in (a
 * trimmed leading space or a truncated tail makes a *valid* password
 * fail as "incorrect"). Checks, in order: the explicit continuesTurnId
 * row, the in-memory session draft, then the session's latest persisted
 * turn (covers answers after a process restart). Fail-closed: any
 * error or miss returns false so the normal limits stay in force.
 */
export async function awaitsSensitiveClarification(args: {
  orgId: string;
  sessionId?: string | null;
  continuesTurnId?: string | null;
}): Promise<boolean> {
  try {
    if (args.continuesTurnId) {
      const [t] = await db
        .select({
          status: atelierCliTurns.status,
          frames: atelierCliTurns.frames,
        })
        .from(atelierCliTurns)
        .where(
          and(
            eq(atelierCliTurns.id, args.continuesTurnId),
            eq(atelierCliTurns.orgId, args.orgId),
          ),
        );
      if (!t || !isClarificationResumable(t.status, t.frames)) return false;
      return asksSensitiveField(latestClarificationFrame(t.frames));
    }
    if (!args.sessionId) return false;
    const draftPc = getSessionDraft(args.sessionId).pendingClarification;
    if (draftPc) return asksSensitiveField(draftPc);
    const [last] = await db
      .select({
        status: atelierCliTurns.status,
        frames: atelierCliTurns.frames,
      })
      .from(atelierCliTurns)
      .where(
        and(
          eq(atelierCliTurns.sessionId, args.sessionId),
          eq(atelierCliTurns.orgId, args.orgId),
        ),
      )
      .orderBy(desc(atelierCliTurns.createdAt))
      .limit(1);
    if (!last || !isClarificationResumable(last.status, last.frames)) {
      return false;
    }
    return asksSensitiveField(latestClarificationFrame(last.frames));
  } catch {
    return false;
  }
}

/**
 * Task #1117 — continuation companion to the Task #1093 model-loop
 * guard. Clarification/disambiguation continuations call `tool.run`
 * DIRECTLY (they bypass the model dispatch loop and its
 * unforgeable-confirm strip), and their merged input combines the
 * server-stored partial with client-supplied answer values merged at
 * top level. A malicious/buggy client payload (or a future resolver
 * change) could therefore smuggle `confirm:true`/`commitToken` into a
 * two-phase write and commit without an approval card. Strip both keys
 * from the merged continuation input for twoPhaseConfirm write tools —
 * the tool re-runs its phase-1 preview and commits ONLY via the
 * /confirm endpoint's verified replay. Single-phase catalog writes
 * (twoPhaseConfirm:false) are left alone, mirroring #1093.
 */
export function stripContinuationApproval(args: {
  toolName: string;
  isWrite: boolean;
  merged: Record<string, unknown>;
  turnId?: string;
}): Record<string, unknown> {
  const { toolName, isWrite, merged } = args;
  if (!isWrite) return merged;
  if (merged.confirm === undefined && merged.commitToken === undefined) return merged;
  const cat = findByToolName(toolName);
  if (cat && cat.twoPhaseConfirm !== true) return merged;
  const stripped: Record<string, unknown> = { ...merged };
  delete stripped.confirm;
  delete stripped.commitToken;
  console.log(
    `[cli-telemetry] ${JSON.stringify({
      evt: "continuation_confirm_stripped",
      turnId: args.turnId ?? null,
      tool: toolName,
    })}`,
  );
  return stripped;
}
export const CLARIFICATION_REROUTE_TOOLS = new Set([
  "schedule_internal_meeting",
  "schedule_client_meeting",
]);

export function reRouteClarificationAnswer(
  askedField: string,
  raw: string,
): { field: string; value: string } | null {
  const p = (raw ?? "").trim();
  if (!p) return null;
  const lower = p.toLowerCase();
  // Correction cue — "actually…", "no,…", "wait…", "change it to…",
  // "make it…" — OR a bare re-typed value of another known field type.
  const cued = /^(actually|nope|no|wait|instead|change (it|that)|make (it|that)|move (it|that)|rather)\b/.test(lower);
  // Time correction: an explicit clock time somewhere in the answer.
  const timeMatch = lower.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\b/);
  if (askedField !== "time" && timeMatch && (cued || /\b(at|to)\s*$|\b(at|to)\s+\d/.test(lower) || lower.replace(timeMatch[0], "").trim().length <= 24)) {
    const norm = normalizeTimeInput(timeMatch[1] ?? "");
    if (norm) return { field: "time", value: norm };
  }
  // Date correction: explicit YYYY-MM-DD in the answer.
  const dateMatch = p.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (askedField !== "date" && dateMatch && cued) {
    return { field: "date", value: dateMatch[1]! };
  }
  // Location correction: "make it in person" / "actually online".
  if (askedField !== "locationType" && cued) {
    const loc = normalizeLocationAnswer(p.replace(/^(actually|no[, ]|nope|wait|instead|change (it|that) to|make (it|that)|rather)\b[:,]?\s*/i, ""));
    if (loc) return { field: "locationType", value: loc };
  }
  return null;
}

/** Validate an untrusted `fields` array from a persisted frame/body. */
export function sanitizeClarificationFields(
  raw: unknown,
): Array<{
  field: string;
  label: string;
  hint?: string;
  inputType?: string;
  options?: string[];
  defaultValue?: string;
  planner?: Record<string, unknown>;
}> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{
    field: string;
    label: string;
    hint?: string;
    inputType?: string;
    options?: string[];
    defaultValue?: string;
    planner?: Record<string, unknown>;
  }> = [];
  for (const f of raw.slice(0, 40)) {
    if (!f || typeof f !== "object") continue;
    const o = f as {
      field?: unknown;
      label?: unknown;
      hint?: unknown;
      inputType?: unknown;
      options?: unknown;
      defaultValue?: unknown;
      planner?: unknown;
    };
    if (typeof o.field !== "string" || o.field.length === 0) continue;
    // Task #721 — preserve rich-input props (date pickers, dropdowns,
    // prefills) through clarification rehydration; stripping them broke
    // restored travel date-picker cards.
    const options = Array.isArray(o.options)
      ? o.options.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 40)
      : null;
    // Task #745 — preserve the flight-planner prefill through
    // clarification rehydration (validated structurally); stripping it
    // would break restored planner cards the same way #721's date
    // pickers broke.
    const planner = sanitizePlannerMeta(o.planner);
    out.push({
      field: o.field,
      label: typeof o.label === "string" && o.label.length > 0 ? o.label : o.field,
      ...(typeof o.hint === "string" && o.hint.length > 0 ? { hint: o.hint } : {}),
      ...(typeof o.inputType === "string" && o.inputType.length > 0
        ? { inputType: o.inputType }
        : {}),
      ...(options && options.length > 0 ? { options } : {}),
      ...(typeof o.defaultValue === "string" && o.defaultValue.length > 0
        ? { defaultValue: o.defaultValue }
        : {}),
      ...(planner ? { planner } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Task #745 — structural validation for the untrusted flight-planner
 * prefill riding on a clarification field. Keeps only the documented
 * shape (tripType / segments[{origin,destination,date}] / adults /
 * cabinClass) with string-typed leaves; anything malformed is dropped
 * wholesale so a poisoned frame can't smuggle arbitrary payloads.
 */
export function sanitizePlannerMeta(
  raw: unknown,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const tripType = typeof o.tripType === "string" ? o.tripType : "";
  if (!["return", "one_way", "multi_city"].includes(tripType)) return null;
  if (!Array.isArray(o.segments)) return null;
  const airport = (v: unknown): Record<string, unknown> | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const a = v as Record<string, unknown>;
    return {
      text: typeof a.text === "string" ? a.text.slice(0, 120) : "",
      iata:
        typeof a.iata === "string" && /^[A-Za-z]{3}$/.test(a.iata)
          ? a.iata.toUpperCase()
          : null,
      label: typeof a.label === "string" ? a.label.slice(0, 160) : null,
    };
  };
  const segments: Array<Record<string, unknown>> = [];
  for (const s of o.segments.slice(0, 8)) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    const seg = s as Record<string, unknown>;
    const origin = airport(seg.origin);
    const destination = airport(seg.destination);
    if (!origin || !destination) return null;
    segments.push({
      origin,
      destination,
      date:
        typeof seg.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(seg.date)
          ? seg.date
          : "",
    });
  }
  if (segments.length === 0) return null;
  const adultsNum = Number(o.adults);
  const adults =
    Number.isInteger(adultsNum) && adultsNum >= 1 && adultsNum <= 9
      ? adultsNum
      : 1;
  const cabinClass =
    typeof o.cabinClass === "string" &&
    ["economy", "premium_economy", "business", "first"].includes(o.cabinClass)
      ? o.cabinClass
      : "economy";
  return { tripType, segments, adults, cabinClass };
}

/**
 * Task #410 — does a persisted frames array contain a `needs_clarification`
 * frame? Used to treat a turn that ASKED a question but then hit a later
 * in-turn failure (e.g. classifier abort → status `error`) as resumable:
 * the user saw the question, so their answer must still continue it.
 */
export function framesContainClarification(frames: unknown): boolean {
  if (!Array.isArray(frames)) return false;
  return frames.some(
    (f) => (f as { type?: string } | null)?.type === "needs_clarification",
  );
}

/** Task #410 — statuses under which an asked clarification is still answerable. */
export function isClarificationResumable(
  status: string | null | undefined,
  frames: unknown,
): boolean {
  if (status === "awaiting_clarification") return true;
  return (
    (status === "error" || status === "partial") &&
    framesContainClarification(frames)
  );
}

// ---------------------------------------------------------------------
// Task #799 — deterministic disambiguation continuation helpers.
// ---------------------------------------------------------------------

export interface PendingDisambigSpec {
  tool: string;
  field: string;
  kind: string;
  options: Array<{ id: string; label: string }>;
  partial: Record<string, unknown>;
  originalPrompt: string;
}

/**
 * Extract a resumable disambiguation spec from a persisted frames array.
 * Only frames that carry the Task #799 continuation payload (tool +
 * declared field + string-id options) are resumable; legacy frames
 * without it fall back to the prompt-injected model path.
 */
export function disambigSpecFromFrames(
  frames: unknown,
  originalPrompt: string,
): PendingDisambigSpec | null {
  if (!Array.isArray(frames)) return null;
  const nd = [...frames]
    .reverse()
    .find((f) => (f as { type?: string } | null)?.type === "needs_disambiguation");
  const d = (nd as { data?: Record<string, unknown> } | undefined)?.data;
  if (!d || typeof d.tool !== "string" || typeof d.field !== "string") return null;
  const rawOpts = Array.isArray(d.options) ? d.options : [];
  const options: Array<{ id: string; label: string }> = [];
  for (const o of rawOpts) {
    const oo = o as Record<string, unknown> | null;
    if (oo && typeof oo.id === "string" && oo.id) {
      options.push({ id: oo.id, label: typeof oo.label === "string" ? oo.label : oo.id });
    }
  }
  if (options.length === 0) return null;
  return {
    tool: d.tool,
    field: d.field,
    kind: typeof d.kind === "string" ? d.kind : "choice",
    options,
    partial:
      d.partial && typeof d.partial === "object"
        ? (d.partial as Record<string, unknown>)
        : {},
    originalPrompt,
  };
}

/** Keep only options with usable string ids (label falls back to id). */
export function sanitizeDisambigOptions(
  raw: Array<Record<string, unknown>> | null | undefined,
): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const o of raw ?? []) {
    if (o && typeof o.id === "string" && o.id) {
      out.push({ id: o.id, label: typeof o.label === "string" ? o.label : o.id });
    }
  }
  return out;
}

/** Statuses under which an asked disambiguation is still pickable. */
export function isDisambiguationResumable(
  status: string | null | undefined,
  frames: unknown,
): boolean {
  return (
    (status === "partial" || status === "error") &&
    Array.isArray(frames) &&
    frames.some((f) => (f as { type?: string } | null)?.type === "needs_disambiguation")
  );
}

export type DisambigPickOutcome =
  /** A declared option was picked — merge `id` into the field and re-run. */
  | { kind: "pick"; id: string; via: string }
  /** The reply names an option that is NOT in the offered set. */
  | { kind: "foreign"; token: string }
  /** Explicit cancel of the pending question. */
  | { kind: "cancel" }
  /** Not an option reply — normal orchestration (question superseded). */
  | { kind: "pass" };

/**
 * Resolve a user reply (or an explicit client pick) against a pending
 * disambiguation's options. Pure and deterministic. Accepts:
 * - explicit option id from the client chip tap,
 * - "id <x>" / "— id <x>" (the legacy prompt-injected format),
 * - a bare option id,
 * - ordinals ("the second one", "2", "ikinci", "الثاني"),
 * - unique label matches.
 * Foreign ids / out-of-range ordinals are rejected honestly instead of
 * being guessed at.
 */
export function resolveDisambigPick(args: {
  reply: string;
  explicitId?: string | null;
  options: Array<{ id: string; label: string }>;
}): DisambigPickOutcome {
  const { options } = args;
  const ids = new Set(options.map((o) => o.id));
  if (typeof args.explicitId === "string" && args.explicitId.length > 0) {
    return ids.has(args.explicitId)
      ? { kind: "pick", id: args.explicitId, via: "explicit" }
      : { kind: "foreign", token: args.explicitId };
  }
  const reply = (args.reply ?? "").trim();
  if (!reply) return { kind: "pass" };
  if (normalizeControlIntent(reply) === "cancel") return { kind: "cancel" };

  // Legacy/prompt formats: "… — id <x>", "id <x>", "the one with id <x>".
  const idTok = reply.match(/\bid[:\s]+([A-Za-z0-9_.:\-]+)/i)?.[1];
  if (idTok) {
    const cleaned = idTok.replace(/[).,;»"']+$/g, "");
    return ids.has(cleaned)
      ? { kind: "pick", id: cleaned, via: "id_token" }
      : { kind: "foreign", token: cleaned };
  }
  // Bare option id typed/pasted verbatim.
  if (ids.has(reply)) return { kind: "pick", id: reply, via: "bare_id" };

  // A reply that is a single-line, short option reference: ordinal or label.
  if (!/[\r\n]/.test(reply) && reply.length <= 120) {
    const ord = parseOrdinalChoice(reply, options.length);
    if (ord !== null) return { kind: "pick", id: options[ord]!.id, via: "ordinal" };
    // Explicit but out-of-range "option N" → honest rejection.
    if (/^(the\s+)?(option|number|no\.?|#)\s*\d{1,3}$/i.test(reply)) {
      return { kind: "foreign", token: reply };
    }
    const label = matchOption(reply, options.map((o) => o.label));
    if (label) {
      const hit = options.find((o) => o.label === label);
      if (hit) return { kind: "pick", id: hit.id, via: "label" };
    }
  }
  return { kind: "pass" };
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
  // Task #581 — device timezone for this turn (validated; Dubai fallback).
  const turnTz = normalizeChatTz(input.timezone);

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

    // Sensitive-clarification detection FIRST — before any prompt-derived
    // routing. When the turn answers a pending SENSITIVE clarification
    // (e.g. a PDF unlock password), the prompt IS the secret: it must not
    // feed entity lookups, the intent classifier, or reset detection. A
    // password that happens to read "reset" or contain "start over" would
    // otherwise force a NEW session, orphan the pending ask, and persist
    // the raw secret as an ordinary fresh prompt. Fail-closed: detection
    // errors return false and normal routing applies.
    const sensitivePendingEarly = await awaitsSensitiveClarification({
      orgId: persona.orgId,
      sessionId: input.sessionId ?? null,
      continuesTurnId: input.continuesTurnId ?? null,
    });

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
    // Task #24 — the id-token lookups and the name-hint hybrid
    // resolution are independent DB reads; run each lookup and the two
    // blocks concurrently to shave pre-LLM latency. Both still finish
    // BEFORE classifyIntentTyped (Task #411: resolver before any LLM).
    const idLookupWork = (async () => {
      const out: Array<{ kind: string; id: string; label: string }> = [];
      // Sensitive answers never feed entity lookups (see above).
      if (sensitivePendingEarly) return out;
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
      await Promise.all(
        tokens.map(async (tok) => {
          const prefix = String(tok).split("_")[0]?.toLowerCase() ?? "";
          const kind = PREFIX_TO_KIND[prefix];
          if (!kind) return;
          try {
            const hit = await directIdLookup(kind as never, String(tok), persona.orgId);
            if (hit) out.push({ kind, id: hit.id, label: hit.label });
          } catch {
            // best-effort
          }
        }),
      );
      return out;
    })();

    // Task #411 round-5 — DETERMINISTIC named-entity resolution
    // (no LLM). Run the regex-only `deterministicClassify` to derive
    // a tentative kind + entity hints, then resolve those hints
    // through the hybrid pg_trgm + pgvector resolver BEFORE invoking
    // the typed-intent classifier (Haiku). This guarantees that
    // user-typed names (e.g. "Acme Advisory") are resolved to a
    // typed entity row before any LLM call, satisfying the
    // "deterministic resolution before any LLM call" requirement
    // for both id-token and name-based hints.
    const nameHintWork = (async () => {
      const out: Array<{ kind: string; id: string; label: string }> = [];
      // Sensitive answers never feed name-hint resolution (see above).
      if (sensitivePendingEarly) return out;
      const { deterministicClassify } = await import("./intent-router.js");
      const { hybridResolveEntity, pickConfident } = await import("./entity-resolver.js");
      const det = deterministicClassify(input.prompt ?? "");
      if (det.kind !== "unknown" && det.hints.length > 0) {
        const resolved = await Promise.all(
          det.hints.slice(0, 3).map(async (hint) => {
            try {
              const candidates = await hybridResolveEntity(
                det.kind as never,
                hint,
                persona.orgId,
              );
              return pickConfident(candidates);
            } catch {
              return null; // best-effort
            }
          }),
        );
        for (const top of resolved) {
          if (top) out.push({ kind: det.kind, id: top.id, label: top.label });
        }
      }
      return out;
    })();

    // Merge with id-token hits winning and de-dup on kind:id (preserves
    // the original sequential-loop semantics).
    {
      const [idHits, nameHits] = await Promise.all([idLookupWork, nameHintWork]);
      const seen = new Set<string>();
      for (const h of [...idHits, ...nameHits]) {
        const key = `${h.kind}:${h.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        preLlmResolved.push(h);
      }
    }

    // Task #681 — an explicit clarification answer (continuesTurnId set)
    // resumes a paused tool; the typed intent is pure bookkeeping there.
    // Skip the live classifier call so a slow model can never abort the
    // turn that carries the user's answer to an expensive research run.
    // Sensitive answers classify a NEUTRAL constant instead of the real
    // prompt: no LLM sees the secret, and no prompt-derived label (in
    // particular "reset") can reroute the turn away from the pending ask.
    const earlyTypedIntent = await (await import("./intent-router.js")).classifyIntentTyped(
      sensitivePendingEarly ? "continue" : input.prompt,
      earlySurface,
      { deterministicOnly: Boolean(input.continuesTurnId) || sensitivePendingEarly },
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
    // A sensitive answer can never force a new session — the pending ask
    // must survive so the secret merges into the paused tool (belt-and-
    // braces: the neutral classify above already can't yield "reset").
    const forceNew = !sensitivePendingEarly && earlyLabel === "reset";

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
      // Task #843 — a clarification ANSWER may (legacy mobile clients)
      // reuse the asked turn's clientTurnKey because the answer streams
      // back into the same UI turn. Replaying the paused turn's
      // awaiting_clarification frames here swallowed the answer as a
      // silent no-op (Search button "did nothing"). An answer-shaped
      // request — explicit continuesTurnId or non-empty
      // clarificationValues — against a paused prev turn must RUN the
      // continuation, never dedupe-replay the question.
      const answerShaped =
        (typeof input.continuesTurnId === "string" &&
          input.continuesTurnId.length > 0) ||
        (!!input.clarificationValues &&
          typeof input.clarificationValues === "object" &&
          Object.keys(input.clarificationValues).length > 0);
      const prevPaused =
        prev &&
        (prev.status === "awaiting_clarification" ||
          prev.status === "partial" ||
          prev.status === "error");
      if (prev && answerShaped && prevPaused) {
        // (session_id, client_turn_key) is UNIQUE — the answer turn must
        // insert under a derived key, keeping the paused turn's row (and
        // future genuine retries of it) intact.
        input = { ...input, clientTurnKey: `${input.clientTurnKey}::ans-${rid("a")}` };
        console.log(
          `[cli-telemetry] ${JSON.stringify({
            evt: "clarification_answer_key_reuse",
            prevTurnId: prev.id,
            prevStatus: prev.status,
          })}`,
        );
      } else if (prev) {
        // Replay all prev frames except its own `final` (which would
        // mask the replay marker). Then emit a fresh final tagged
        // replay:true so the client knows this was a dedupe.
        for (const f of (prev.frames as CliFrame[]) ?? []) {
          if (f.type === "final" || !isClientVisibleCliFrameType(f.type)) continue;
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

    // Task #645 — deterministic dedupe: never stream/persist two identical
    // tool_result frames for the same step+tool in one turn.
    const emittedToolResultKeys = new Set<string>();

    // Declared BEFORE record() — record can run well before the model
    // loop (e.g. the "already answered" narration), and a `let` further
    // down would be a temporal-dead-zone crash, not just undefined.
    let lastModel: string | undefined;

    function record(frame: CliFrame): void {
      if (frame.type === "tool_result") {
        const key = toolResultFrameKey(frame.data as Record<string, unknown>);
        if (emittedToolResultKeys.has(key)) return;
        emittedToolResultKeys.add(key);
      }
      // Tag every frame with the real Anthropic model id observed for
      // this turn so SSE consumers see the actual Sonnet/Haiku name on
      // every step (per acceptance criterion: no implicit "claude" /
      // env-var labels). Frames emitted before the first modelStep
      // call carry `null` to make the absence explicit.
      const data = (frame as { data?: Record<string, unknown> }).data;
      if (
        frame.type !== "presentation" &&
        frame.type !== "tool_evidence" &&
        data &&
        typeof data === "object" &&
        !("model" in data)
      ) {
        (data as Record<string, unknown>).model = lastModel ?? null;
      }
      // Task #1318 — sensitive values (PDF unlock passwords) must never
      // ride a frame: frames stream to clients AND persist into
      // atelierCliTurns (replay/audit + clarification rehydration).
      // stripSensitiveValues copies — the live tool input object shared
      // with tool.run keeps the real value.
      if (containsSensitiveKey(frame.data)) {
        (frame as { data?: unknown }).data = stripSensitiveValues(frame.data);
      }
      frames.push(frame);
      if (frame.type === "final") finalEmitted = true;
      if (isClientVisibleCliFrameType(frame.type)) emit(frame);
    }

    // Task #332 — redact emails/phones/PAN/IBAN from the persisted
    // prompt + page context BEFORE they hit the audit perimeter.
    // The model still sees the raw prompt in `history` (live in
    // memory only); only the durable copy is scrubbed.
    // Task #1318 — while a sensitive clarification (PDF unlock password)
    // is pending for this session, the incoming prompt is very likely
    // the password itself: persist a fixed placeholder instead of the
    // text. Best-effort pre-insert detection via the in-memory draft;
    // the rehydrated continuation path below re-checks and repairs the
    // row for the restart/reload case.
    let sensitivePromptTurn =
      sensitivePendingEarly ||
      asksSensitiveField(getSessionDraft(session.id).pendingClarification);
    const promptRedacted = sensitivePromptTurn
      ? SENSITIVE_PROMPT_PLACEHOLDER
      : redactText(input.prompt).text;
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

    // Clarification durability — SESSION_DRAFTS is in-memory only, so a
    // server restart between the question and the answer used to strand
    // the turn (`awaiting_clarification` in the DB, but the continuation
    // path below never fired). Rehydrate pendingClarification from the
    // most recent prior turn in this session when (a) the draft has no
    // pending question and (b) that prior turn is still paused on one.
    // Task #184 — additionally, when the client sends `continuesTurnId`
    // (answer submitted through a restored clarification card), the
    // paused turn is loaded by id regardless of which session this
    // answer landed in — surviving inactivity rollover, page reloads
    // and server restarts. The source turn is tracked so it can be
    // marked resolved once the continuation consumes it; otherwise the
    // restore endpoint would resurrect an already-answered question.
    let pendingSourceTurnId: string | null = null;
    // Continuation gating — an answer submitted through the question card
    // carries `continuesTurnId` and is ALWAYS consumed as the answer. A
    // bare prompt while a question is pending is only consumed when it
    // plausibly IS an answer (short, single-line, not a fresh command);
    // otherwise the new prompt supersedes the question and runs normal
    // orchestration, so unrelated requests are never hijacked.
    let explicitContinuation = false;
    // Task #799 — source turn of a resumable disambiguation, retired once
    // the pick is consumed (mirrors pendingSourceTurnId for clarifications).
    let pendingDisambigSourceTurnId: string | null = null;
    const rehydrateDisambigFromTurnRow = (row: {
      id: string;
      prompt: string;
      frames: unknown;
    }): boolean => {
      const spec = disambigSpecFromFrames(row.frames, row.prompt);
      if (!spec) return false;
      getSessionDraft(session.id).pendingDisambiguation = spec;
      pendingDisambigSourceTurnId = row.id;
      return true;
    };
    const rehydrateFromTurnRow = (row: {
      id: string;
      prompt: string;
      frames: unknown;
    }): boolean => {
      const prevFrames = Array.isArray(row.frames)
        ? (row.frames as Array<{ type?: string; data?: Record<string, unknown> }>)
        : [];
      const nc = [...prevFrames]
        .reverse()
        .find((f) => f?.type === "needs_clarification");
      const d = nc?.data as
        | {
            field?: string;
            question?: string;
            tool?: string;
            partial?: Record<string, unknown>;
            fields?: Array<{ field?: string; label?: string; hint?: string }>;
          }
        | undefined;
      if (!d || typeof d.field !== "string" || typeof d.tool !== "string") {
        return false;
      }
      getSessionDraft(session.id).pendingClarification = {
        field: d.field,
        question: typeof d.question === "string" ? d.question : "",
        tool: d.tool,
        partial: d.partial && typeof d.partial === "object" ? d.partial : {},
        fields: sanitizeClarificationFields(d.fields),
        originalPrompt: row.prompt,
      };
      pendingSourceTurnId = row.id;
      return true;
    };
    {
      const _drRehydrate = getSessionDraft(session.id);
      // Explicit continuation takes precedence: the card the user
      // answered names its turn, so never guess from session recency.
      if (input.continuesTurnId && input.continuesTurnId !== turnId) {
        const [contTurn] = await db
          .select({
            id: atelierCliTurns.id,
            status: atelierCliTurns.status,
            prompt: atelierCliTurns.prompt,
            frames: atelierCliTurns.frames,
            userId: atelierCliTurns.userId,
            orgId: atelierCliTurns.orgId,
          })
          .from(atelierCliTurns)
          .where(eq(atelierCliTurns.id, input.continuesTurnId))
          .limit(1);
        // Task #410 — accept `error`/`partial` turns whose frames still
        // contain the asked question: a partial in-turn failure AFTER the
        // clarification was emitted (e.g. a classifier abort) must not
        // strand the question, or answering re-runs the whole prompt and
        // re-asks the same thing in a loop.
        if (
          contTurn &&
          contTurn.userId === persona.id &&
          contTurn.orgId === persona.orgId &&
          isClarificationResumable(contTurn.status, contTurn.frames)
        ) {
          explicitContinuation = rehydrateFromTurnRow(contTurn);
        } else if (
          contTurn &&
          contTurn.userId === persona.id &&
          contTurn.orgId === persona.orgId &&
          isDisambiguationResumable(contTurn.status, contTurn.frames) &&
          rehydrateDisambigFromTurnRow(contTurn)
        ) {
          // Task #799 — the answered card was a disambiguation. The pick
          // is consumed deterministically by the continuation block below.
          explicitContinuation = true;
        } else if (
          contTurn &&
          contTurn.userId === persona.id &&
          contTurn.orgId === persona.orgId
        ) {
          // Task #740 — exactly-once consumption: the named question was
          // already consumed (second tab / duplicate answer / SSE retry).
          // Say so explicitly instead of silently re-running the prompt.
          record({
            type: "narration",
            data: {
              text: "That question was already answered — I'm continuing from the latest state.",
              step: 0,
            },
          });
          console.log(
            `[cli-telemetry] ${JSON.stringify({
              evt: "clarification_already_answered",
              turnId,
              sourceTurnId: contTurn.id,
            })}`,
          );
        }
      }
      if (!getSessionDraft(session.id).pendingClarification && !_drRehydrate.pendingClarification) {
        const [prevTurn] = await db
          .select({
            id: atelierCliTurns.id,
            status: atelierCliTurns.status,
            prompt: atelierCliTurns.prompt,
            frames: atelierCliTurns.frames,
          })
          .from(atelierCliTurns)
          .where(
            and(
              eq(atelierCliTurns.sessionId, session.id),
              ne(atelierCliTurns.id, turnId),
            ),
          )
          .orderBy(desc(atelierCliTurns.createdAt))
          .limit(1);
        // Task #410 — same relaxation as the explicit path: a turn that
        // asked a question but then errored mid-orchestration is still
        // answerable by recency.
        if (prevTurn && isClarificationResumable(prevTurn.status, prevTurn.frames)) {
          rehydrateFromTurnRow(prevTurn);
        } else if (
          // Task #799 — a typed reply right after a disambiguation card
          // ("the second one", a pasted id) resumes it by recency too,
          // even across a server restart.
          prevTurn &&
          !getSessionDraft(session.id).pendingDisambiguation &&
          isDisambiguationResumable(prevTurn.status, prevTurn.frames)
        ) {
          rehydrateDisambigFromTurnRow(prevTurn);
        }
      } else if (_drRehydrate.pendingClarification && !pendingSourceTurnId) {
        // In-memory pending (no restart happened). Find its source turn
        // so cross-session answers can still resolve it below.
        const [prevTurn] = await db
          .select({ id: atelierCliTurns.id, status: atelierCliTurns.status })
          .from(atelierCliTurns)
          .where(
            and(
              eq(atelierCliTurns.sessionId, session.id),
              ne(atelierCliTurns.id, turnId),
              eq(atelierCliTurns.status, "awaiting_clarification"),
            ),
          )
          .orderBy(desc(atelierCliTurns.createdAt))
          .limit(1);
        if (prevTurn) pendingSourceTurnId = prevTurn.id;
      }
      // Task #799 — in-memory pending disambiguation (no restart): find
      // its source turn so the pick can retire it below.
      if (
        getSessionDraft(session.id).pendingDisambiguation &&
        !pendingDisambigSourceTurnId
      ) {
        const [prevDis] = await db
          .select({
            id: atelierCliTurns.id,
            status: atelierCliTurns.status,
            frames: atelierCliTurns.frames,
          })
          .from(atelierCliTurns)
          .where(
            and(
              eq(atelierCliTurns.sessionId, session.id),
              ne(atelierCliTurns.id, turnId),
              eq(atelierCliTurns.status, "partial"),
            ),
          )
          .orderBy(desc(atelierCliTurns.createdAt))
          .limit(1);
        if (prevDis && isDisambiguationResumable(prevDis.status, prevDis.frames)) {
          pendingDisambigSourceTurnId = prevDis.id;
        }
      }
    }
    // Apply the continuation gate: without an explicit `continuesTurnId`,
    // only a prompt that plausibly IS an answer gets consumed. Anything
    // else (a fresh command, a long/multi-line request) supersedes the
    // pending question — clear it so neither the primer nor the
    // deterministic continuation below fires, and let the newer-turn
    // supersession rule retire the stranded question.
    // Task #740 — resolver-driven gate. The legacy shape heuristic
    // (short/single-line/no command opener) silently DROPPED pending
    // questions on a miss. Now the shared resolver classifies the reply:
    // anything except an explicit fresh request stays on the answer
    // path, and a fresh request keeps the question RESUMABLE (source
    // turn untouched) and carries it into the model context below.
    let supersededPendingQuestion: { question: string; tool: string } | null = null;
    {
      const _drGate = getSessionDraft(session.id);
      const hasMultiFieldAnswers =
        !!input.clarificationValues &&
        typeof input.clarificationValues === "object" &&
        Object.keys(input.clarificationValues).length > 0;
      if (_drGate.pendingClarification && !explicitContinuation && !hasMultiFieldAnswers) {
        const pcGate = _drGate.pendingClarification;
        // Task #1318 — never supersede a pending PASSWORD question on a
        // bare prompt: passwords look like anything (dates, command-ish
        // words, random tokens), so freshness classifiers misroute them
        // and the raw secret would run as a fresh model prompt. The
        // user can still type "cancel" (handled in the continuation).
        const isFresh = asksSensitiveField(pcGate)
          ? false
          : clarificationResolverMode() === "on"
            ? resolveClarificationReply({
                reply: input.prompt ?? "",
                pending: {
                  tool: pcGate.tool,
                  field: pcGate.field,
                  question: pcGate.question,
                  partial: pcGate.partial ?? {},
                  fields: pcGate.fields ?? null,
                },
                // Facts load below; classification into fresh-vs-answer
                // never needs them (referential replies classify as
                // answers and resolve with facts in the continuation).
                facts: [],
                timezone: turnTz,
              }).kind === "fresh_request"
            : !looksLikeClarificationAnswer(input.prompt ?? "");
        if (isFresh) {
          supersededPendingQuestion = { question: pcGate.question, tool: pcGate.tool };
          _drGate.pendingClarification = null;
          pendingSourceTurnId = null;
          console.log(
            `[cli-telemetry] ${JSON.stringify({
              evt: "clarification_superseded",
              turnId,
              tool: pcGate.tool,
              field: pcGate.field,
              resolver: clarificationResolverMode(),
            })}`,
          );
        }
      }
    }

    // Task #340 — proactive open-state recap. Task #781 tightened the
    // trigger: only after genuine dormancy (>6h) with something worth
    // recapping. A cold in-memory draft (server restart, navigating back
    // into the session) is NOT a resume signal, and trivial turns
    // ("who are you?" etc.) never headline a recap.
    const lastTurnAt = session.lastTurnAt ? new Date(session.lastTurnAt).getTime() : 0;
    const dormantMs = lastTurnAt > 0 ? Date.now() - lastTurnAt : 0;
    const draftPriorToTurn = getSessionDraft(session.id);
    // Task #741 — typed session facts (incl. one hop of rollover lineage).
    // Loaded once per turn; used by the recap (so it only claims facts the
    // model can actually see) and rendered into the context below.
    let sessionFactRows: Array<{ kind: string; key: string; value: unknown; display: string }> =
      [];
    try {
      if (factsMode() !== "off") {
        sessionFactRows = await loadSessionFacts({
          orgId: persona.orgId,
          userId: persona.id,
          sessionId: session.id,
          predecessorSessionId: (session as { predecessorSessionId?: string | null })
            .predecessorSessionId,
        });
      }
    } catch (err) {
      console.error(
        "[atelier-cli] session facts load failed",
        turnId,
        err instanceof Error ? err.message : String(err),
      );
    }
    // Task #978 — open-thread detection: unresolved items from prior turns
    // (a draft that was never confirmed, a question that was never
    // answered) survive in atelierCliTurns even across restarts. Only
    // queried once genuine dormancy is established (cheap guard).
    let recapOpenThreads: string[] = [];
    if (lastTurnAt > 0 && dormantMs > PROACTIVE_RECAP_DORMANT_MS) {
      recapOpenThreads = await collectRecapOpenThreads({
        sessionId: session.id,
        excludeTurnId: turnId,
      });
    }
    if (
      shouldEmitProactiveRecap({
        lastTurnAtMs: lastTurnAt,
        nowMs: Date.now(),
        rollingSummary: session.rollingSummary,
        openThreads: recapOpenThreads,
      })
    ) {
      const recapCard = composeRecapCard(session.rollingSummary);
      const draftEntities = Object.values(draftPriorToTurn.entities)
        .sort((a, b) => b.at - a.at)
        .slice(0, 5)
        .map((e) => ({ kind: e.kind, id: e.id, label: e.label }));
      // Note: emit (not record) — proactive recap is informational and
      // must not be persisted into the turn frames replay buffer.
      emit({
        type: "proactive_recap",
        data: {
          // Legacy `summary` stays populated for older clients; new
          // clients render the structured lists below.
          summary: (recapCard?.accomplishments ?? []).join("\n"),
          accomplishments: recapCard?.accomplishments ?? [],
          openThreads: recapOpenThreads,
          turnCount: session.turnCount ?? 0,
          dormantMs,
          entities: draftEntities,
          // Task #741 — recap contract: only claim facts that are actually
          // available to the model this turn (additive field; clients that
          // don't know it ignore it).
          facts: sessionFactRows.slice(0, 8).map((f) => f.display),
          schemaVersion: CATALOG_SCHEMA_VERSION,
        },
      });
    }

    // Build initial history. Rolling summary (if any) goes in as a
    // synthetic system extension via the user channel — we keep the
    // system prompt fixed so the SDK caching can kick in.
    const history: Array<{ role: "user" | "assistant"; content: unknown }> = [];
    // Task #739 — verbatim replay window. Fetch the tail of this session
    // (and, when it holds fewer turns than the window, the tail of its
    // rollover predecessor — same org/user by construction) and replay
    // the recent turns verbatim under a partitioned char budget. The
    // rolling summary below then only matters for turns beyond the window.
    let replayedTurnCount = 0;
    try {
      const replayBudget = DEFAULT_REPLAY_BUDGET;
      const fetchTail = (sid: string, limit: number) =>
        db
          .select({
            prompt: atelierCliTurns.prompt,
            status: atelierCliTurns.status,
            frames: atelierCliTurns.frames,
            createdAt: atelierCliTurns.createdAt,
          })
          .from(atelierCliTurns)
          .where(
            and(
              eq(atelierCliTurns.sessionId, sid),
              eq(atelierCliTurns.orgId, persona.orgId),
              eq(atelierCliTurns.userId, persona.id),
              ne(atelierCliTurns.id, turnId),
            ),
          )
          .orderBy(desc(atelierCliTurns.createdAt))
          .limit(limit);
      // Newest-first; over-fetch by one so telemetry can tell "window full".
      let replayRows = await fetchTail(session.id, replayBudget.maxTurns + 1);
      const predecessorId = (session as { predecessorSessionId?: string | null })
        .predecessorSessionId;
      let crossSession = false;
      if (replayRows.length < replayBudget.maxTurns && predecessorId) {
        const carried = await fetchTail(
          predecessorId,
          replayBudget.maxTurns + 1 - replayRows.length,
        );
        crossSession = carried.length > 0;
        replayRows = [...replayRows, ...carried];
      }
      if (replayRows.length > 0) {
        const { history: replayHistory, telemetry } = composeReplayFromTurns(
          replayRows as ReplayTurnRow[],
          replayBudget,
        );
        replayedTurnCount = telemetry.turnsIncluded;
        if (replayHistory.length > 0) {
          history.push({
            role: "user",
            content:
              "[conversation so far] The following messages replay our recent conversation verbatim " +
              "(assistant lines may include compact tool-result digests). Treat facts the user stated " +
              "here — dates, names, places, amounts, choices — as given; do not re-ask for them.",
          });
          history.push({ role: "assistant", content: "(noted)" });
          for (const m of replayHistory) history.push(m);
        }
        console.log(
          `[cli-telemetry] ${JSON.stringify({
            evt: "replay_window",
            turnId,
            sessionId: session.id,
            turnsAvailable: telemetry.turnsAvailable,
            turnsIncluded: telemetry.turnsIncluded,
            chars: telemetry.chars,
            truncated: telemetry.truncated,
            crossSession,
          })}`,
        );
      }
    } catch (err) {
      // Replay is an enhancement — a fetch/compose failure must never
      // block the turn. Log loudly so regressions are visible.
      console.error(
        "[atelier-cli] replay window failed",
        turnId,
        err instanceof Error ? err.message : String(err),
      );
    }
    // Rolling summary covers turns beyond the replay window. Skip it for
    // short sessions fully covered by verbatim replay to save tokens.
    if (
      session.rollingSummary &&
      session.rollingSummary.length > 0 &&
      (session.rollingSummary.split("\n").length > replayedTurnCount ||
        replayedTurnCount === 0)
    ) {
      history.push({
        role: "user",
        content: `[prior session summary]\n${session.rollingSummary}`,
      });
      history.push({
        role: "assistant",
        content: "(noted)",
      });
    }
    // Task #740 — a fresh request superseding a pending clarification
    // carries the question into the model context (never silently
    // dropped): the model can answer the new request AND remind the
    // user the earlier question is still open.
    if (supersededPendingQuestion) {
      history.push({
        role: "user",
        content:
          `[pending question] Before this message you asked the user: "${supersededPendingQuestion.question}" ` +
          `(for ${supersededPendingQuestion.tool}). They have NOT answered it — this new message is a different request. ` +
          "Handle the new request, then briefly note the earlier question is still open if it remains relevant.",
      });
      history.push({ role: "assistant", content: "(noted)" });
    }
    // Task #741 — typed session facts block. In "on" mode the block is
    // rendered into context; in "shadow" mode facts are written+logged
    // but not yet read by the model (per-phase kill switch).
    if (sessionFactRows.length > 0) {
      const block = renderFactsBlock(sessionFactRows);
      if (block && factsMode() === "on") {
        history.push({ role: "user", content: `[session facts]\n${block}` });
        history.push({ role: "assistant", content: "(noted)" });
      }
      console.log(
        `[cli-telemetry] ${JSON.stringify({
          evt: "session_facts",
          turnId,
          sessionId: session.id,
          mode: factsMode(),
          contractVersion: FACTS_CONTRACT_VERSION,
          count: sessionFactRows.length,
          rendered: factsMode() === "on" && block.length > 0,
        })}`,
      );
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
    } else {
      // Task #590 — attachment continuity primer. When the model asks a
      // plain-text clarifying question about an ambiguous attachment
      // ("receipt or an ID?"), the user's answer arrives as a NEW turn
      // with no attachmentIds — and nothing else re-surfaces the opaque
      // refs (the rolling summary and session draft never carry them).
      // Without this hint the model cannot call save_my_document /
      // ingest_receipts_to_expenses with a valid id and either stalls
      // or invents one. Hint-only: list the most recent attachments
      // from this session's recent turns (own uploads only, 30-min
      // window) so the answer turn can complete the flow.
      const recentTurns = await db
        .select({
          attachmentRefs: atelierCliTurns.attachmentRefs,
          createdAt: atelierCliTurns.createdAt,
        })
        .from(atelierCliTurns)
        .where(
          and(
            eq(atelierCliTurns.sessionId, session.id),
            ne(atelierCliTurns.id, turnId),
          ),
        )
        .orderBy(desc(atelierCliTurns.createdAt))
        .limit(5);
      const cutoffMs = Date.now() - 30 * 60 * 1000;
      const priorIds: string[] = [];
      const collect = (respectCutoff: boolean) => {
        for (const tr of recentTurns) {
          if (
            respectCutoff &&
            (!tr.createdAt || new Date(tr.createdAt).getTime() < cutoffMs)
          )
            continue;
          for (const ref of (tr.attachmentRefs as string[] | null) ?? []) {
            if (typeof ref === "string" && ref.length > 0 && !priorIds.includes(ref)) {
              priorIds.push(ref);
            }
          }
        }
      };
      collect(true);
      // Task #679 — a user returning to a session after >30 min and saying
      // "save that passport scan" got a dead-end ("no attachment found").
      // If the fresh window is empty, fall back to the most recent
      // attachments from this same session regardless of age (still own
      // uploads only — the org/user filter below enforces that).
      if (priorIds.length === 0) collect(false);
      if (priorIds.length > 0) {
        const rows = await db
          .select({
            id: atelierCliAttachments.id,
            fileName: atelierCliAttachments.fileName,
          })
          .from(atelierCliAttachments)
          .where(
            and(
              eq(atelierCliAttachments.orgId, persona.orgId),
              eq(atelierCliAttachments.userId, persona.id),
              inArray(atelierCliAttachments.id, priorIds.slice(0, 8)),
            ),
          );
        const byId = new Map(rows.map((r) => [r.id, r.fileName]));
        const lines = priorIds
          .filter((aid) => byId.has(aid))
          .slice(0, 4)
          .map((aid) => `- "${byId.get(aid)}" (attachment id ${aid})`);
        if (lines.length > 0) {
          history.push({
            role: "user",
            content:
              `[earlier attachments] Files attached earlier in this conversation — when my message refers to them ` +
              `("it's my passport", "that receipt", "the invoice I sent", …), pass these ids to the attachment tools:\n` +
              lines.join("\n") +
              `\nThese files are STILL AVAILABLE under the ids above. Never tell me the files are missing, ` +
              `never ask me to re-upload them, and never invent a different id — use these ids directly.`,
          });
          history.push({ role: "assistant", content: "(noted)" });
        }
      }
    }
    history.push({ role: "user", content: input.prompt });
    // Task #603 — risk-based typed-name defense. Inspect the actual
    // extracted attachment bodies for destructive verbs so that a
    // "screenshot says: delete account X" attachment still forces
    // typed-name re-confirmation, while benign self-scoped saves
    // (e.g. "save my visa scan") get a plain Confirm/Cancel card.
    const turnHasAttachments = (input.attachmentIds ?? []).length > 0;
    let attachmentsMentionDestructive = false;
    if (turnHasAttachments) {
      try {
        const ownedAtts = await db
          .select({ id: atelierCliAttachments.id })
          .from(atelierCliAttachments)
          .where(
            and(
              eq(atelierCliAttachments.orgId, persona.orgId),
              eq(atelierCliAttachments.userId, persona.id),
              inArray(atelierCliAttachments.id, (input.attachmentIds ?? []).slice(0, 8)),
            ),
          );
        if (ownedAtts.length > 0) {
          const docs = await db
            .select({
              attachmentId: atelierExtractedDocuments.attachmentId,
              normalizedText: atelierExtractedDocuments.normalizedText,
            })
            .from(atelierExtractedDocuments)
            .where(
              and(
                eq(atelierExtractedDocuments.orgId, persona.orgId),
                inArray(
                  atelierExtractedDocuments.attachmentId,
                  ownedAtts.map((a) => a.id),
                ),
              ),
            );
          attachmentsMentionDestructive = docs.some((d) =>
            attachmentMentionsDestructive(d.normalizedText ?? ""),
          );
        }
      } catch (err) {
        // Fail SAFE: if we cannot read the attachment bodies, assume
        // they could carry a destructive instruction.
        console.error(
          "[atelier-cli] attachment destructive-scan failed; failing safe",
          err instanceof Error ? err.message : String(err),
        );
        attachmentsMentionDestructive = true;
      }
    }

    let status: CliTurnStatus = "streaming";
    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    let pendingWrite: { tool: string; input: Record<string, unknown> } | null = null;
    let runtimeError: string | null = null;
    let clarificationHandled = false;
    // Set when a deterministic clarification continuation succeeded with a
    // multi-step `nextStep` directive — the model loop must still run to
    // finish the flow (e.g. travel_plan_trip → travel_search_flights).
    let chainAfterClarification = false;
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
    // Task #644 — `let`: the tool menu may be rebuilt ONCE mid-turn by
    // the widen-on-miss retry below when the model claims no suitable
    // tool exists.
    let tools = retrieved.tools;
    let widenRetryUsed = false;
    // One model-side retry per turn for a hallucinated tool name with no
    // confident menu match (see the unknown-tool branch below).
    let unknownToolRetryUsed = false;
    // Task #644 — resolution telemetry: intent + surfaced tools, so
    // real-world "couldn't understand" cases are diagnosable from logs.
    console.log(
      `[cli-telemetry] ${JSON.stringify({
        evt: "tool_menu",
        turnId,
        kind: typedIntent.kind,
        verb: typedIntent.verb,
        tools: retrieved.selected,
      })}`,
    );
    // Tier routing — reads land on Haiku, writes / transitions on Sonnet.
    // Task #769 — `let`: may be escalated mid-turn by the flail guard.
    let turnTier: "haiku" | "sonnet" = typedIntent.tier;

    // Task #411 — DETERMINISTIC pre-LLM entity resolution + context
    // injection. Before the model loop runs, we try to resolve the
    // intent's `entityHints` against the database via the hybrid
    // pg_trgm + pgvector resolver and, when one candidate is clearly
    // ahead, walk the FK graph to build a `<context>` block. The
    // model gets the resolved id + a typed neighbourhood without
    // having to call `resolve_entity` for the obvious cases.
    // Task #553 — per-turn date/timezone context. Task #581 — the chat
    // client sends the DEVICE timezone with each turn; all date math and
    // typed times are interpreted in it (Asia/Dubai fallback).
    const buildDateContextBlock = (): string => {
      const p = tzWallParts(new Date(), turnTz);
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const tzNote =
        turnTz === DEFAULT_CHAT_TZ
          ? "Asia/Dubai, UTC+4 — the firm's default timezone"
          : `${turnTz} — the user's device timezone`;
      return [
        "<current_datetime>",
        `Today is ${days[p.weekday]}, ${p.ymd}. Local time: ${p.hm} (${tzNote}).`,
        "Resolve relative dates like \"tomorrow\" or \"next Tuesday\" against this date yourself; do not ask the user what the date is.",
        "Any times the user mentions are in this timezone — pass them through as-is (do not convert them), and echo times back in this timezone.",
        "</current_datetime>",
      ].join("\n");
    };

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
    // Task #799 — DETERMINISTIC disambiguation continuation. Runs BEFORE
    // the clarification continuation and the model loop: when a prior
    // turn paused on `needs_disambiguation` (with a declared field), the
    // user's pick — chip tap (explicit optionId), pasted/typed id,
    // ordinal, or unique label — is merged into the declared field and
    // the originating tool is re-run server-side. Foreign/unknown option
    // replies are rejected honestly (options re-shown, pending kept).
    // Anything that isn't an option reply falls through to normal
    // orchestration (the question is superseded).
    if (_draft.pendingDisambiguation && !_draft.pendingClarification) {
      const pd = _draft.pendingDisambiguation;
      const reply = stripLocalePreamble(input.prompt ?? "");
      const pick = resolveDisambigPick({
        reply,
        explicitId: input.disambigOptionId ?? null,
        options: pd.options,
      });
      console.log(
        `[cli-telemetry] ${JSON.stringify({
          evt: "disambiguation_resumed",
          turnId,
          tool: pd.tool,
          field: pd.field,
          outcome: pick.kind,
          via: pick.kind === "pick" ? pick.via : undefined,
        })}`,
      );
      const retireSource = async (message: string) => {
        if (pendingDisambigSourceTurnId && pendingDisambigSourceTurnId !== turnId) {
          await db
            .update(atelierCliTurns)
            .set({ status: "cancelled", statusMessage: message })
            .where(
              and(
                eq(atelierCliTurns.id, pendingDisambigSourceTurnId),
                inArray(atelierCliTurns.status, ["partial", "error"]),
              ),
            );
        }
      };
      if (pick.kind === "cancel") {
        getSessionDraft(session.id).pendingDisambiguation = null;
        record({
          type: "narration",
          data: {
            text: "Okay — I've dropped that choice. What would you like to do instead?",
            step: 0,
          },
        });
        status = "success";
        clarificationHandled = true;
        await retireSource(`cancelled by user in turn ${turnId}`);
      } else if (pick.kind === "foreign") {
        // Honest rejection: the reply names something that is NOT one of
        // the offered options. Re-show the options and keep the question
        // pending — never guess, never hand the reply to the model.
        record({
          type: "narration",
          data: {
            text: "That doesn't match any of the options I offered — please pick one of these.",
            step: 0,
          },
        });
        record({
          type: "needs_disambiguation",
          data: {
            step: 0,
            kind: pd.kind,
            options: pd.options,
            field: pd.field,
            tool: pd.tool,
            partial: pd.partial,
            turnId,
            continuation: true,
            rejected: pick.token,
          },
        });
        status = "partial";
        clarificationHandled = true;
        // The re-shown card lives on THIS turn now; retire the old source
        // so recency-based rehydration resumes from the newest card.
        await retireSource(`superseded by re-shown options in turn ${turnId}`);
      } else if (pick.kind === "pick") {
        const tool = findToolByName(pd.tool, persona);
        if (!tool) {
          // Tool no longer registered — drop the pending state and let
          // normal orchestration (and its honest refusal paths) handle it.
          getSessionDraft(session.id).pendingDisambiguation = null;
        } else {
          // Task #1117 — a client-influenced merge must never smuggle a
          // hidden approval past the two-phase confirm protocol.
          const mergedInput: Record<string, unknown> = stripContinuationApproval({
            toolName: pd.tool,
            isWrite: tool.isWrite === true,
            merged: {
              ...(pd.partial ?? {}),
              [pd.field]: pick.id,
            },
            turnId,
          });
          const ctx0: ToolContext = {
            persona,
            turnId,
            sessionId: session.id,
            timezone: turnTz,
            stepIdx: 0,
            progress: (pct, message, data) =>
              record({ type: "progress", data: { pct, message, ...(data ?? {}) } }),
          };
          record({
            type: "tool_call",
            data: { step: 0, tool: pd.tool, input: mergedInput, continuation: true },
          });
          let cont: ToolResult;
          try {
            cont = await runWithProgressSink(
              (pct, message, data) => ctx0.progress?.(pct, message, data),
              () => tool.run(mergedInput, ctx0),
            );
          } catch (err) {
            cont = {
              ok: false,
              errorCode: "internal",
              errorMessage: err instanceof Error ? err.message : String(err),
            };
          }
          toolCalls.push({
            step: 0,
            tool: pd.tool,
            input: stripSensitiveValues(mergedInput),
            ok: cont.ok,
            errorCode: cont.errorCode,
            continuation: true,
            ms: Date.now() - t0,
          });
          stepResults.push({
            stepIdx: 0,
            tool: pd.tool,
            ok: cont.ok,
            errorCode: cont.errorCode,
          });
          record({
            type: "tool_result",
            data: {
              step: 0,
              tool: pd.tool,
              ok: cont.ok,
              data: cont.data,
              errorCode: cont.errorCode,
              errorMessage: cont.errorMessage,
              continuation: true,
            },
          });
          if (cont.ok) {
            ingestEntitiesFromToolResult(session.id, pd.tool, cont.data);
            recordSessionResult(session.id, { lastTurnId: turnId });
            ingestSessionFacts({
              orgId: persona.orgId,
              userId: persona.id,
              sessionId: session.id,
              turnId,
              tool: pd.tool,
              input: stripSensitiveValues(mergedInput),
              data: cont.data,
              source: "clarification",
            });
          }
          // The pick was consumed — clear pending on every outcome except
          // a re-pause (a NEW disambiguation/clarification below records
          // its own fresh pending state).
          getSessionDraft(session.id).pendingDisambiguation = null;
          if (cont.clarification) {
            const cl = cont.clarification;
            recordSessionResult(session.id, {
              pendingClarification: {
                field: cl.field,
                question: cl.question,
                originalPrompt: pd.originalPrompt,
                partial: cl.partial ?? mergedInput,
                tool: cl.tool,
                fields: cl.fields ?? null,
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
                fields: cl.fields ?? [],
                continuation: true,
                turnId,
              },
            });
            status = "awaiting_clarification";
          } else if (cont.confirmation) {
            const conf = cont.confirmation;
            pendingWrite = conf.pending;
            record({
              type: "needs_confirmation",
              data: {
                step: 0,
                tool: pd.tool,
                summary: conf.summary,
                diff: conf.diff,
                continuation: true,
              },
            });
            status = "awaiting_confirmation";
          } else if (cont.disambiguation) {
            // Narrowed but still ambiguous — re-pause with the new set.
            const nd = cont.disambiguation as {
              kind: string;
              field?: string;
              options: Array<Record<string, unknown>>;
            };
            const ndField = typeof nd.field === "string" && nd.field ? nd.field : pd.field;
            recordSessionResult(session.id, {
              pendingDisambiguation: {
                tool: pd.tool,
                field: ndField,
                kind: nd.kind,
                options: sanitizeDisambigOptions(nd.options),
                partial: mergedInput,
                originalPrompt: pd.originalPrompt,
              },
            });
            record({
              type: "needs_disambiguation",
              data: {
                ...nd,
                step: 0,
                field: ndField,
                tool: pd.tool,
                partial: mergedInput,
                turnId,
                continuation: true,
              },
            });
            status = "partial";
          } else if (cont.refusal) {
            record({
              type: "refusal",
              data: {
                step: 0,
                reason: scrubToolIdentifiers(cont.refusal.reason) ?? cont.refusal.reason,
                closestCapabilityId: cont.refusal.closestCapabilityId ?? null,
                pageHref: cont.refusal.pageHref ?? null,
                suggestion: scrubToolIdentifiers(cont.refusal.suggestion ?? null),
                requestCapability: { tool: "request_feature", prompt: input.prompt },
              },
            });
            status = "success";
          } else if (cont.ok) {
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
          await retireSource(
            status === "partial"
              ? `superseded by follow-up options in turn ${turnId}`
              : `resolved by disambiguation pick in turn ${turnId}`,
          );
        }
      } else {
        // Not an option reply — the new prompt supersedes the question.
        getSessionDraft(session.id).pendingDisambiguation = null;
      }
    }
    // Task #340 — DETERMINISTIC clarification continuation. Run BEFORE
    // the model loop so a missing-field follow-up is collected
    // server-side without depending on model compliance. If the
    // originating tool re-runs successfully (or transitions into
    // confirmation/clarification/refusal), we emit canonical frames
    // and skip the Claude loop entirely. (Task #799 — skipped when the
    // disambiguation continuation above already consumed this prompt.)
    if (_draft.pendingClarification && !clarificationHandled) {
      const pc = _draft.pendingClarification;
      // Task #1318 — sensitive (password) clarifications: the answer is
      // the secret. If the pending question was rehydrated from the DB
      // (draft was empty when the turn row was inserted above), repair
      // the already-persisted prompt immediately.
      const pcSensitive = asksSensitiveField(pc);
      if (pcSensitive && !sensitivePromptTurn) {
        sensitivePromptTurn = true;
        try {
          await db
            .update(atelierCliTurns)
            .set({ prompt: SENSITIVE_PROMPT_PLACEHOLDER })
            .where(eq(atelierCliTurns.id, turnId));
        } catch {
          // Terminal persist below rewrites the prompt placeholder too.
        }
      }
      // Task #741 — normalized control intent bound to the pending
      // clarification. "cancel" deterministically clears the pending
      // question instead of raw-text-merging "never mind" into a typed
      // field; affirm/decline are surfaced via telemetry and to the
      // merge path below (additive — free-text answers behave as before).
      const controlIntent = normalizeControlIntent(input.prompt ?? "");
      // Task #740 — shared resolver: classify + type the reply against
      // the pending question and session facts BEFORE any merge.
      // Task #1318 — resolver (and the model-assisted fallback it
      // gates) is BYPASSED for sensitive fields: passwords must merge
      // byte-for-byte and never transit an LLM.
      const resolverOn = clarificationResolverMode() === "on" && !pcSensitive;
      const resolverOutcome: ResolverOutcome | null = resolverOn
        ? resolveClarificationReply({
            reply: stripLocalePreamble(input.prompt ?? ""),
            pending: {
              tool: pc.tool,
              field: pc.field,
              question: pc.question,
              partial: pc.partial ?? {},
              fields: pc.fields ?? null,
            },
            facts: sessionFactRows as FactRow[],
            timezone: turnTz,
          })
        : null;
      console.log(
        `[cli-telemetry] ${JSON.stringify({
          evt: "clarification_resumed",
          turnId,
          tool: pc.tool,
          field: pc.field,
          controlIntent,
          resolver: resolverOn ? (resolverOutcome as ResolverOutcome).kind : "off",
          via:
            resolverOutcome && "via" in resolverOutcome ? resolverOutcome.via : undefined,
        })}`,
      );
      if (controlIntent === "cancel" || resolverOutcome?.kind === "cancel") {
        const _drCancel = getSessionDraft(session.id);
        if (
          _drCancel.pendingClarification &&
          _drCancel.pendingClarification.tool === pc.tool
        ) {
          _drCancel.pendingClarification = null;
        }
        record({
          type: "narration",
          data: {
            text: "Okay — I've dropped that question. What would you like to do instead?",
            step: 0,
          },
        });
        status = "success";
        clarificationHandled = true;
        // Retire the paused source turn so rehydration can't resurrect it.
        if (pendingSourceTurnId && pendingSourceTurnId !== turnId) {
          await db
            .update(atelierCliTurns)
            .set({
              status: "cancelled",
              statusMessage: `cancelled by user in turn ${turnId}`,
            })
            .where(
              and(
                eq(atelierCliTurns.id, pendingSourceTurnId),
                inArray(atelierCliTurns.status, [
                  "awaiting_clarification",
                  "error",
                  "partial",
                ]),
              ),
            );
        }
      }
      if (!clarificationHandled) {
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
        // Multi-field answers: when the client submitted the labeled
        // multi-input form, merge every non-blank provided value —
        // restricted to the fields this clarification actually asked
        // for — in one continuation. Fields the user left blank are
        // simply not merged; the tool recomputes what's still missing
        // and re-issues a narrowed clarification. Falls back to the
        // classic single-field merge (prompt text = the answer).
        const allowedFields = new Set<string>([
          pc.field,
          ...(pc.fields ?? []).map((f) => f.field),
        ]);
        let mergedInput: Record<string, unknown> = { ...(pc.partial ?? {}) };
        let usedMultiValues = false;
        if (input.clarificationValues && typeof input.clarificationValues === "object") {
          for (const [k, v] of Object.entries(input.clarificationValues)) {
            if (!allowedFields.has(k)) continue;
            // Task #1318 — sensitive values merge byte-for-byte: no
            // preamble strip, no trim (a PDF password may legitimately
            // start/end with whitespace). Reject only the empty string.
            const raw = typeof v === "string" ? v : "";
            const val = SENSITIVE_INPUT_KEYS.has(k) ? raw : stripLocalePreamble(raw).trim();
            if (!val) continue;
            mergedInput = mergeClarificationAnswer(mergedInput, k, val);
            usedMultiValues = true;
          }
        }
        if (!usedMultiValues) {
          // Task #570 — mid-flow correction: "actually make it 9am" while
          // being asked for the topic routes to `time`, not `topic`. The
          // asked field stays unanswered, so the tool re-asks it.
          const reroute = CLARIFICATION_REROUTE_TOOLS.has(pc.tool)
            ? reRouteClarificationAnswer(pc.field, answer)
            : null;
          if (reroute) {
            mergedInput = mergeClarificationAnswer(mergedInput, reroute.field, reroute.value);
          } else if (
            resolverOutcome &&
            (resolverOutcome.kind === "values" || resolverOutcome.kind === "confirm")
          ) {
            // Task #740 — typed values from the shared resolver ("5
            // nights", "same dates I specified", relative dates, option
            // picks). `confirm` runs the tool with the confirmed partial
            // plus any fact-derived fills; an empty fill set is fine —
            // the tool re-validates and, if fields are still missing,
            // re-asks (honest, never a generic dead-end).
            for (const [k, v] of Object.entries(resolverOutcome.values)) {
              mergedInput = mergeClarificationAnswer(mergedInput, k, v);
            }
          } else if (resolverOutcome) {
            // `unparsed` (or an explicit continuation the gate never
            // saw) — try the model-assisted fallback, then degrade to
            // the legacy raw merge. NEVER clears pending on failure.
            let llmValues: Record<string, string> | null = null;
            try {
              const wall = tzWallParts(new Date(), turnTz);
              llmValues = await resolveWithModel({
                reply: answer,
                pending: {
                  tool: pc.tool,
                  field: pc.field,
                  question: pc.question,
                  partial: pc.partial ?? {},
                  fields: pc.fields ?? null,
                },
                timezone: turnTz,
                model: HAIKU_CLASSIFIER_MODEL,
                todayIso: wall.ymd,
              });
            } catch {
              llmValues = null;
            }
            if (llmValues) {
              const allowed = new Set<string>([
                pc.field,
                ...(pc.fields ?? []).map((f) => f.field),
              ]);
              let merged = false;
              for (const [k, v] of Object.entries(llmValues)) {
                if (!allowed.has(k) || !v.trim()) continue;
                mergedInput = mergeClarificationAnswer(mergedInput, k, v.trim());
                merged = true;
              }
              if (!merged) {
                mergedInput = mergeClarificationAnswer(mergedInput, pc.field, answer);
              }
              console.log(
                `[cli-telemetry] ${JSON.stringify({
                  evt: "clarification_llm_assist",
                  turnId,
                  tool: pc.tool,
                  merged,
                })}`,
              );
            } else {
              mergedInput = mergeClarificationAnswer(mergedInput, pc.field, answer);
            }
          } else {
            mergedInput = mergeClarificationAnswer(mergedInput, pc.field, answer);
          }
        }
        // Task #1117 — client-supplied clarification answers (multi-field
        // values, resolver/LLM outputs, raw merges) must never smuggle a
        // hidden approval past the two-phase confirm protocol.
        mergedInput = stripContinuationApproval({
          toolName: pc.tool,
          isWrite: tool.isWrite === true,
          merged: mergedInput,
          turnId,
        });
        const ctx0: ToolContext = {
          persona,
          turnId,
          sessionId: session.id,
          timezone: turnTz,
          stepIdx: 0,
          progress: (pct, message, data) =>
            record({ type: "progress", data: { pct, message, ...(data ?? {}) } }),
        };
        record({
          type: "tool_call",
          data: { step: 0, tool: pc.tool, input: mergedInput, continuation: true },
        });
        let cont: ToolResult;
        try {
          cont = await runWithProgressSink(
            (pct, message, data) => ctx0.progress?.(pct, message, data),
            () => tool.run(mergedInput, ctx0),
          );
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
          input: stripSensitiveValues(mergedInput),
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
          // Task #741 — clarification answers become typed session facts.
          ingestSessionFacts({
            orgId: persona.orgId,
            userId: persona.id,
            sessionId: session.id,
            turnId,
            tool: pc.tool,
            input: stripSensitiveValues(mergedInput),
            data: cont.data,
            source: "clarification",
          });
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
          // Task #740 — telemetry: same-field re-asks (answer didn't
          // land) and confirm dead-ends ("confirmed" still re-asked).
          console.log(
            `[cli-telemetry] ${JSON.stringify({
              evt: "clarification_issued",
              turnId,
              tool: cl.tool,
              field: cl.field,
              continuation: true,
              reaskSameField: cl.field === pc.field,
              confirmDeadEnd: resolverOutcome?.kind === "confirm",
            })}`,
          );
          recordSessionResult(session.id, {
            pendingClarification: {
              field: cl.field,
              question: cl.question,
              originalPrompt: pc.originalPrompt,
              partial: cl.partial ?? mergedInput,
              tool: cl.tool,
              fields: cl.fields ?? null,
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
              fields: cl.fields ?? [],
              continuation: true,
              // Task #410 — clients capture the turn id from this frame so
              // the answer carries continuesTurnId even if the turn's
              // `final` frame is lost or reports a later failure.
              turnId,
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
        } else if (cont.disambiguation) {
          // Task #799 — the clarified input is now ambiguous ("which
          // one?"). Pause on a first-class disambiguation so the pick
          // resumes deterministically instead of being dropped.
          const nd = cont.disambiguation as {
            kind: string;
            field?: string;
            options: Array<Record<string, unknown>>;
          };
          const ndOptions = sanitizeDisambigOptions(nd.options);
          if (typeof nd.field === "string" && nd.field && ndOptions.length > 0) {
            recordSessionResult(session.id, {
              pendingDisambiguation: {
                tool: pc.tool,
                field: nd.field,
                kind: nd.kind,
                options: ndOptions,
                partial: mergedInput,
                originalPrompt: pc.originalPrompt,
              },
            });
          }
          record({
            type: "needs_disambiguation",
            data: {
              ...nd,
              step: 0,
              tool: pc.tool,
              partial: mergedInput,
              turnId,
              continuation: true,
            },
          });
          status = "partial";
        } else if (cont.refusal) {
          record({
            type: "refusal",
            data: {
              step: 0,
              // Task #583 — refusal frames never leak tool identifiers.
              reason: scrubToolIdentifiers(cont.refusal.reason) ?? cont.refusal.reason,
              closestCapabilityId: cont.refusal.closestCapabilityId ?? null,
              pageHref: cont.refusal.pageHref ?? null,
              suggestion: scrubToolIdentifiers(cont.refusal.suggestion ?? null),
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
          // Multi-step chain handoff: some tools (travel_plan_trip, …)
          // succeed with a `nextStep` directive that instructs the model
          // to CONTINUE the flow (e.g. run travel_search_flights for leg
          // 1). Ending the turn here would strand the user on the
          // intermediate card with no results — so instead of finishing,
          // hand the result to the model loop and let it follow the
          // directive.
          const chainDirective =
            cont.data &&
            typeof cont.data === "object" &&
            typeof (cont.data as { nextStep?: unknown }).nextStep === "string" &&
            ((cont.data as { nextStep: string }).nextStep ?? "").trim()
              ? (cont.data as { nextStep: string }).nextStep.trim()
              : null;
          if (chainDirective) {
            chainAfterClarification = true;
            console.log(
              `[cli-telemetry] ${JSON.stringify({
                evt: "clarification_chain_to_model",
                turnId,
                tool: pc.tool,
              })}`,
            );
            history.push({
              role: "user",
              content:
                `(system continuation — not a user message) The pending question was answered and ` +
                `${pc.tool} already ran successfully with input ${JSON.stringify(mergedInput)}. ` +
                `Its result: ${JSON.stringify(cont.data)}. ` +
                `Continue the flow NOW by following this directive: ${chainDirective} ` +
                `Do NOT re-run ${pc.tool} and do NOT re-ask anything the result already answers.`,
            });
          } else {
            status = "success";
          }
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
        // Chain handoff (see above): when the continuation result carries
        // a nextStep directive, the model loop must still run — leave
        // clarificationHandled false so the loop executes with the seeded
        // history. Every other outcome ends the turn here as before.
        clarificationHandled = !chainAfterClarification;
        // Task #184 — the continuation consumed the paused question, so
        // mark its source turn resolved. Without this, the restore
        // endpoint (and the cross-session rehydration above) would
        // resurrect an already-answered question — the answer turn may
        // live in a DIFFERENT session, so "newer turn in same session"
        // supersession never fires for rollover continuations. Matches
        // the in-memory semantics: the pending state is consumed on
        // every outcome except a re-pause, where the NEW turn now holds
        // the (updated) question.
        //
        // Task #196 — we deliberately do NOT sweep sibling stale
        // awaiting_clarification turns here. The rehydration endpoint
        // (GET /cli/turns/pending-clarification) is the single
        // supersession mechanism: any newer turn by the same user, in
        // ANY session, supersedes older paused questions, so abandoned
        // questions from earlier sessions can never resurface once the
        // user has moved on.
        if (
          pendingSourceTurnId &&
          pendingSourceTurnId !== turnId
        ) {
          await db
            .update(atelierCliTurns)
            .set({
              status: "cancelled",
              statusMessage:
                status === "awaiting_clarification"
                  ? `superseded by follow-up question in turn ${turnId}`
                  : `resolved by continuation turn ${turnId}`,
            })
            .where(
              and(
                eq(atelierCliTurns.id, pendingSourceTurnId),
                // Task #410 — a source turn resumed out of `error`/`partial`
                // (asked, then failed mid-orchestration) must also be
                // retired once its question is consumed.
                inArray(atelierCliTurns.status, [
                  "awaiting_clarification",
                  "error",
                  "partial",
                ]),
              ),
            );
        }
      }
      } // end !clarificationHandled (Task #741 cancel short-circuit)
    }
    // Task #645 — narration/card output-contract state for this turn.
    let pendingNarration: { text: string; step: number } | null = null;
    // Task #1249 — classification grounding. Track the classifier's
    // verdicts this turn so prose claiming "low confidence" can be
    // deterministically scrubbed when every classification was confident.
    let sawConfidentClassify = false;
    let sawLowConfidenceClassify = false;
    let committedWriteOk = false;
    let lastCardShape: string | null = null;
    let lastCardData: unknown = null;
    // Task #769 — per-turn read-flail guard. Tracks how many times each
    // read tool has been called this turn. On FLAIL_ESCALATION_THRESHOLD
    // we switch the remaining steps to Sonnet; on FLAIL_STOP_THRESHOLD
    // we emit a clarification and stop.
    const readToolCallCount = new Map<string, number>();
    // Task #771 Riser overhaul — card budget per turn. Read-tool ok:false
    // frames are suppressed (probe noise; the model still sees the result in
    // its history and retries or finishes with prose). After MAX_CARDS_PER_TURN
    // successful read-tool cards the transcript is saturated — cap further ones.
    const MAX_CARDS_PER_TURN = 6;
    let cardsEmitted = 0;
    // Narration budget: only one mid-turn "Let me check…" flush may go out per
    // turn. The model's final closing prose (emitted at end_turn, not pre-tool)
    // is NOT subject to this counter.
    const MAX_NARRATION_FLUSHES_PER_TURN = 1;
    let narrationFlushedCount = 0;
    // A model can repeat a phase-1 write after receiving its own preview.
    // Keep the first pin/card authoritative for the rest of this turn.
    const canonicalPreviewValue = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalPreviewValue);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonicalPreviewValue(item)]),
        );
      }
      return value;
    };
    const previewKey = (tool: string, input: unknown) =>
      JSON.stringify([tool, canonicalPreviewValue(input)]);
    let pendingPreviewKey: string | null = null;
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
      // Task #1000 — live token streaming state for this model step.
      // Deltas go straight to `emit` (NEVER through record(): they are
      // presentation-only and must not be persisted — replay uses the
      // final `narration` frame). The stream applies the same marker
      // strip + tool-name scrub as the final text, incrementally: each
      // chunk re-cleans the accumulated raw text and emits the suffix,
      // or a `replace` frame when cleaning rewrote already-sent text.
      // A short hold-back keeps typical one-line pre-tool prose from
      // ever reaching the client tentatively; longer prose that turns
      // out to precede a tool call is retracted the instant the
      // tool_use block starts (empty replace), preserving the
      // narration contract's flush-only-on-tool-success behavior.
      const STREAM_HOLDBACK_CHARS = Number(
        process.env.ATELIER_CLI_STREAM_HOLDBACK ?? 120,
      );
      const streamOn = textStreamEnabled();
      let streamedSent = "";
      const cleanStreamText = (raw: string): string =>
        scrubKnownToolNames(
          raw.replace(/^\s*(?:final|answer|narration)\s*[:\-–—]\s*/i, ""),
        )?.trimStart() ?? "";
      const emitStreamDelta = (fullRaw: string): void => {
        if (aborted) return;
        const cleaned = cleanStreamText(fullRaw);
        if (streamedSent.length === 0 && cleaned.length < STREAM_HOLDBACK_CHARS) return;
        if (cleaned === streamedSent) return;
        if (cleaned.startsWith(streamedSent)) {
          emit({
            type: "text_delta",
            data: { text: cleaned.slice(streamedSent.length), step },
          });
        } else {
          emit({ type: "text_delta", data: { text: cleaned, replace: true, step } });
        }
        streamedSent = cleaned;
      };
      const resetStreamDelta = (): void => {
        if (streamedSent.length === 0) return;
        streamedSent = "";
        emit({ type: "text_delta", data: { text: "", replace: true, step } });
      };
      let claudeStep: ClaudeStep;
      try {
        claudeStep = await modelStep({
          history,
          tools,
          ...(streamOn
            ? {
                onTextDelta: emitStreamDelta,
                onToolUseStart: resetStreamDelta,
                onStreamReset: resetStreamDelta,
              }
            : {}),
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
          // Task #553 — always prepend today's date + firm timezone so
          // relative dates ("tomorrow", "next Tuesday") resolve without
          // asking. Dubai is fixed UTC+4 (no DST), so plain offset math
          // is safe. Kept out of the cached SYSTEM_PROMPT on purpose.
          contextBlock: [
            buildDateContextBlock(),
            preludeContextBlock,
            // Task #795 — self-only personas get the registry-driven
            // honest-refusal copy for the deliberately excluded /me
            // self-service actions (bank change, MS disconnect, EA
            // delegation, …) so the model names the real UI location
            // instead of inventing a workaround or a generic dead-end.
            SELF_ONLY_CHAT_ROLES.has(persona.role) ? selfServiceExclusionGuidance() : null,
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
      } catch (err) {
        // Task #1000 — retract any partially streamed text so the error
        // card is not preceded by an orphaned half-answer (and replay,
        // which never sees deltas, matches the live transcript).
        resetStreamDelta();
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
        // Task #469 — strip leaked internal markers ("final: …") from
        // the prose before it streams to any client. Task #644 — also
        // deterministically scrub registered tool names / capability
        // ids from user-facing narration (conservative scrub only:
        // entity ids and normal snake_case prose are untouched).
        const cleanText =
          scrubKnownToolNames(
            claudeStep.text.replace(
              /^\s*(?:final|answer|narration)\s*[:\-–—]\s*/i,
              "",
            ),
          )?.trim() ?? "";
        // Task #644 — widen-on-miss retry: the model claims it has no
        // suitable tool while it made no tool call this turn. Rebuild
        // the menu ONCE from the full eligible pool (same persona
        // clamp + read-intent write hiding) and let it retry, instead
        // of surfacing a refusal for a capability that exists.
        if (
          !widenRetryUsed &&
          !claudeStep.toolCall &&
          toolCalls.length === 0 &&
          looksLikeToolMiss(claudeStep.text)
        ) {
          widenRetryUsed = true;
          // Task #1000 — the miss prose may have partially streamed;
          // retract it before the retry step re-streams a fresh answer.
          resetStreamDelta();
          try {
            const widened = await retrieveCapabilities({
              persona,
              query: retrievalQuery,
              intentKind: typedIntent.kind,
              intentVerb: typedIntent.verb,
              widen: true,
            });
            tools = widened.tools;
            console.log(
              `[cli-telemetry] ${JSON.stringify({
                evt: "tool_miss_widen",
                turnId,
                kind: typedIntent.kind,
                verb: typedIntent.verb,
                tools: widened.selected,
              })}`,
            );
            history.push({
              role: "assistant",
              content: [{ type: "text", text: claudeStep.text }],
            });
            history.push({
              role: "user",
              content:
                "(system: the available tool list has been refreshed and now includes additional capabilities — re-check it and complete the original request if a suitable tool now exists. If it truly cannot be done, say so plainly without mentioning any internal tool names.)",
            });
            continue;
          } catch (err) {
            console.error(
              "[atelier-cli] widen-on-miss retry failed",
              err instanceof Error ? err.message : String(err),
            );
          }
        }
        if (cleanText) {
          if (claudeStep.toolCall) {
            // Task #645 — hold pre-tool narration ("I'll do X…") until the
            // tool result is known; if the tool fails, the optimistic prose
            // would contradict the error card, so it is dropped below.
            // Task #1000 — onToolUseStart already retracted any streamed
            // deltas the moment the tool block started; reset again
            // defensively so nothing tentative survives into the hold.
            resetStreamDelta();
            pendingNarration = { text: cleanText, step };
          } else if (committedWriteOk) {
            // Task #645 — a committed write's success card is the answer;
            // suppress the closing prose recap entirely. Task #1000 —
            // retract any streamed portion of that recap too.
            resetStreamDelta();
          } else {
            // Task #792 — promise guard: prose emitted with NO tool call
            // while no write has succeeded this turn must not promise a
            // save ("I'll save X now" + refusal in the same message).
            // Also scrub impossible-deflection advice ("not available in
            // this interface" / "upload it from the profile page").
            let guarded = stripDeadEndDocumentAdvice(cleanText);
            if (guarded && looksLikeWritePromise(guarded)) {
              guarded = stripUnfulfilledWritePromises(guarded);
            }
            // Task #1249 — when every classification this turn was
            // confident, scrub prose claiming low confidence /
            // uncertainty about the document type (a past hallucination
            // misquoted the classifier's own result).
            if (guarded && sawConfidentClassify && !sawLowConfidenceClassify) {
              guarded = stripBogusLowConfidenceClaims(guarded);
            }
            // Task #645 — final prose after a card-rendering tool result:
            // clamp anything that restates the card payload to one sentence.
            const trimmed =
              guarded && lastCardShape != null
                ? trimNarrationForCard(guarded, lastCardData)
                : guarded;
            if (trimmed) {
              // Task #1000 — the final narration frame doubles as the
              // stream finalizer: the shared reducer REPLACES the
              // delta-accumulated segment with this contract-trimmed
              // text, so persisted/replayed output stays identical.
              record({ type: "narration", data: { text: trimmed, step } });
            } else {
              // Guards dropped the prose entirely — retract whatever
              // portion may have streamed.
              resetStreamDelta();
            }
          }
        } else {
          resetStreamDelta();
        }
      }
      record({ type: "plan_step", data: { step, hasTool: !!claudeStep.toolCall } });

      // Hallucinated tool-name recovery: the model occasionally invents a
      // near-miss name (e.g. `request_employment_certificate` for
      // `request_employment_letter`), which used to kill the whole turn
      // with a red "tool not registered" error. If the mistyped name has
      // exactly one clearly-best match in the menu the model was shown,
      // silently substitute it BEFORE the history push below (so the
      // transcript stays consistent) and before the self-only clamp /
      // resolution further down.
      if (claudeStep.toolCall && !findToolByName(claudeStep.toolCall.name, persona)) {
        const corrected = closestToolName(
          claudeStep.toolCall.name,
          tools.map((t) => String((t as { name?: unknown }).name ?? "")),
        );
        if (corrected && findToolByName(corrected, persona)) {
          console.log(
            `[cli-telemetry] ${JSON.stringify({
              evt: "tool_name_corrected",
              turnId,
              from: claudeStep.toolCall.name,
              to: corrected,
            })}`,
          );
          claudeStep.toolCall.name = corrected;
        }
      }

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
          // Task #644 — the "silent miss" variant of widen-on-miss:
          // the model produced neither a tool call nor text. Rebuild
          // the menu once from the full eligible pool before refusing.
          if (!widenRetryUsed) {
            widenRetryUsed = true;
            try {
              const widened = await retrieveCapabilities({
                persona,
                query: retrievalQuery,
                intentKind: typedIntent.kind,
                intentVerb: typedIntent.verb,
                widen: true,
              });
              tools = widened.tools;
              console.log(
                `[cli-telemetry] ${JSON.stringify({
                  evt: "tool_miss_widen",
                  turnId,
                  kind: typedIntent.kind,
                  verb: typedIntent.verb,
                  silent: true,
                  tools: widened.selected,
                })}`,
              );
              history.push({
                role: "user",
                content:
                  "(system: the available tool list has been refreshed and now includes additional capabilities — re-check it and complete the original request if a suitable tool now exists. If it truly cannot be done, say so plainly without mentioning any internal tool names.)",
              });
              continue;
            } catch (err) {
              console.error(
                "[atelier-cli] widen-on-miss retry failed",
                err instanceof Error ? err.message : String(err),
              );
            }
          }
          console.log(
            `[cli-telemetry] ${JSON.stringify({
              evt: "capability_refusal",
              turnId,
              kind: typedIntent.kind,
              verb: typedIntent.verb,
              widened: widenRetryUsed,
            })}`,
          );
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
      // Hallucinated tool-name recovery: the model occasionally invents a
      // near-miss name (e.g. `request_employment_certificate` for
      // `request_employment_letter`), which used to kill the whole turn
      // with a red "tool not registered" error. If the mistyped name has
      // exactly one close match in the menu the model was shown, silently
      // substitute it BEFORE the self-only clamp and resolution below.
      if (!findToolByName(tc.name, persona)) {
        const corrected = closestToolName(
          tc.name,
          tools.map((t) => String((t as { name?: unknown }).name ?? "")),
        );
        if (corrected && findToolByName(corrected, persona)) {
          console.log(
            `[cli-telemetry] ${JSON.stringify({
              evt: "tool_name_corrected",
              turnId,
              from: tc.name,
              to: corrected,
            })}`,
          );
          tc.name = corrected;
        }
      }
      // Task #591 — self-only personas (employee / contractor) get a
      // helpful, scrubbed refusal when the model reaches for anything
      // outside their me.* surface (e-sign, HR admin, firm documents,
      // org CRM, …). Without this gate the call would either surface a
      // dead-end `unknown_tool` error (leaking the tool identifier) or
      // — worse — resolve through the Task #484 catalog fallthrough in
      // findToolByName and run an org-wide capability their clamp is
      // supposed to hide. Meta post-processors stay allowed so recap /
      // undo / request_feature keep working for these personas.
      const SELF_ONLY_META_ALLOW = RESTRICTED_META_ALLOW;
      // Task #873 — alliance partners share the same hard surface-membership
      // gate: any tool call outside their clamped partnerportal.* set (plus
      // meta post-processors) is refused BEFORE resolution, so a hallucinated
      // tool name can never reach the catalog/legacy fallthrough.
      const isAlliancePartnerChat = persona.role === "alliance_partner";
      if (
        (SELF_ONLY_CHAT_ROLES.has(persona.role) || isAlliancePartnerChat) &&
        !SELF_ONLY_META_ALLOW.has(tc.name) &&
        !getToolsForPersona(persona).some((t) => t.name === tc.name)
      ) {
        const fallbackHref = (pageCtx as { href?: string } | null)?.href ?? null;
        record({
          type: "refusal",
          data: {
            step,
            reason: isAlliancePartnerChat
              ? "That isn't available in the partner portal — here I can show the opportunities, delivery, contracts, invoices, documents and notifications shared with your firm, your firm profile, and help you request a change to your own company details."
              : "That isn't something I can help with from your workspace — here I can only work with your own timesheets, expenses, leave, documents, payslips and profile.",
            closestCapabilityId: null,
            pageHref: fallbackHref,
            suggestion:
              "For anything beyond your own records, please reach out to HR or your partner — or tell me what you wanted and I'll log it as a feature request.",
            requestCapability: { tool: "request_feature", prompt: input.prompt },
          },
        });
        status = status === "streaming" ? "success" : status;
        break;
      }
      const tool = findToolByName(tc.name, persona);
      if (!tool) {
        // No confident correction was possible. Feed the miss back to the
        // model (once) so it can pick a real tool from its menu instead of
        // killing the whole turn with a red "not registered" error card.
        if (!unknownToolRetryUsed) {
          unknownToolRetryUsed = true;
          console.log(
            `[cli-telemetry] ${JSON.stringify({ evt: "unknown_tool_retry", turnId, tool: tc.name })}`,
          );
          history.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: tc.id,
                content: JSON.stringify({
                  ok: false,
                  error: {
                    code: "unknown_tool",
                    message: `No tool named "${tc.name}" exists. Re-check the exact tool names in your tool list and call the correct one to complete the user's request.`,
                  },
                }),
                is_error: true,
              },
            ],
          });
          continue;
        }
        record({
          type: "error",
          data: { code: "unknown_tool", message: `tool ${tc.name} not registered` },
        });
        status = "error";
        break;
      }

      // Task #1093 — global unforgeable-confirm guard. The two-phase
      // confirm protocol's real gate used to be model behavior: any
      // tool_use in THIS loop whose input carried `confirm:true`
      // committed immediately, so injected instructions (attached
      // documents, emails) could steer the model into skipping the
      // approval card entirely. Model-originated `confirm:true` on a
      // twoPhaseConfirm capability is therefore stripped here — the tool
      // re-runs its phase-1 preview and the turn pauses
      // `awaiting_confirmation`. Commits happen ONLY via the /confirm
      // endpoint's verified replay of the server-persisted pendingWrite
      // (`confirmPendingWrite`), the clarification/disambiguation
      // continuations, and the async runner — all of which call
      // `tool.run` directly and never pass through this loop, so they
      // are untouched. Legacy non-catalog writes (add_raid_item) default
      // to two-phase, matching their in-file confirm handling; catalog
      // writes with twoPhaseConfirm:false (single-phase commits like
      // complete_my_task) are left alone. `commitToken` (the Task #1090
      // finance HMAC) is stripped alongside so a replayed token can
      // never ride a fresh model call.
      if (tool.isWrite && (tc.input as { confirm?: unknown }).confirm === true) {
        const catGuard = findByToolName(tc.name);
        if (!catGuard || catGuard.twoPhaseConfirm === true) {
          const stripped: Record<string, unknown> = {
            ...(tc.input as Record<string, unknown>),
          };
          delete stripped.confirm;
          delete stripped.commitToken;
          tc.input = stripped;
          console.log(
            `[cli-telemetry] ${JSON.stringify({ evt: "model_confirm_stripped", turnId, tool: tc.name, step })}`,
          );
        }
      }

      record({
        type: "tool_call",
        data: { step, tool: tc.name, input: tc.input },
      });

      // Task #1260 — finance-doc specialist guard. Uploaded invoices /
      // receipts / statements belong to the finance-doc tools, never a
      // specialist agent run: deterministically block agent-sourced tools
      // when this turn's attachments classify confidently as finance
      // documents, and steer the model to classify_finance_document.
      let financeDocAgentGuard: string | null = null;
      if (
        findByToolName(tc.name)?.source === "agent" &&
        (input.attachmentIds ?? []).length > 0
      ) {
        try {
          const kinds = await financeDocKindsForAttachments(
            input.attachmentIds ?? [],
            persona.orgId,
          );
          if (kinds.length > 0) {
            financeDocAgentGuard =
              `The attached file(s) classify as finance documents (${[...new Set(kinds)].join(", ")}) — ` +
              `specialist agents are not the right flow for them. Run classify_finance_document on the ` +
              `attachment ids instead and follow its recommended tool (supplier-invoice ingest, receipt ` +
              `pairing, or expense drafting). Do not launch a specialist for these documents.`;
            console.log(
              `[cli-telemetry] ${JSON.stringify({ evt: "finance_doc_agent_guard", turnId, tool: tc.name, kinds })}`,
            );
          }
        } catch {
          // Guard is best-effort: never let it break a legitimate agent run.
        }
      }

      // Idempotency for write-tools that reach the commit phase: one job
      // row per (turnId, step) so a retry never double-writes.
      let toolResult: ToolResult;
      const ctx: ToolContext = {
        persona,
        turnId,
        sessionId: session.id,
        timezone: turnTz,
        stepIdx: step,
        progress: (pct, message, data) =>
          record({ type: "progress", data: { pct, message, ...(data ?? {}) } }),
      };
      const progressSink = (
        pct: number,
        message: string,
        data?: Record<string, unknown>,
      ) => ctx.progress?.(pct, message, data);
      const durableAccountCanary =
        tc.name === "account_update" && durableAccountUpdateEnabled(persona.orgId);
      if (durableAccountCanary) {
        const sanitized = { ...tc.input };
        delete sanitized.confirm;
        delete sanitized.commitToken;
        tc.input = sanitized;
      }
      const isCommit = tool.isWrite && tc.input.confirm === true;
      const idemKey = `${turnId}:${step}`;
      if (financeDocAgentGuard) {
        toolResult = {
          ok: false,
          errorCode: "finance_doc_attachments",
          errorMessage: financeDocAgentGuard,
        };
      } else if (
        durableAccountCanary &&
        input.dryRun !== true
      ) {
        const preview = await createDurableAccountUpdatePreview({
          persona: persona as never,
          conversationId: session.id,
          turnId,
          step,
          input: tc.input,
        });
        toolResult = {
          ok: true,
          data: { actionId: preview.actionId, stateVersion: preview.stateVersion },
          confirmation: {
            summary: preview.summary,
            diff: preview.diff,
            pending: {
              tool: "account_update",
              input: {
                __durableActionId: preview.actionId,
                __durableStateVersion: preview.stateVersion,
              },
            },
            durableAction: {
              actionId: preview.actionId,
              stateVersion: preview.stateVersion,
            },
          },
        };
      } else if (isCommit) {
        toolResult = await runIdempotentJob({
          idemKey,
          orgId: persona.orgId,
          turnId,
          sessionId: session.id,
          userId: persona.id,
          kind: tc.name,
          input: tc.input,
          run: () => runWithProgressSink(progressSink, () => tool.run(tc.input, ctx)),
        });
      } else {
        toolResult = await runWithProgressSink(progressSink, () => tool.run(tc.input, ctx));
      }

      // Task #645 — flush the held pre-tool narration now that the outcome
      // is known: suppress it when the tool failed (the optimistic "I'll do
      // X…" prose would contradict the error card the user is about to see).
      if (pendingNarration) {
        // Task #771 Riser overhaul — narration budget. Only the first mid-turn
        // "I'll look into…" narration is flushed; subsequent ones are dropped
        // so the transcript reads as a card-first answer, not a play-by-play.
        if (toolResult.ok !== false && narrationFlushedCount < MAX_NARRATION_FLUSHES_PER_TURN) {
          // Task #792 — write-promise guard at flush time: promised-write
          // prose ("I'll save X now") may only surface once a write has
          // actually COMMITTED. Reads, previews awaiting confirmation, and
          // idempotent-replay results scrub the promise sentences; the
          // dead-end deflection scrub applies to all flushed narration.
          const wroteOk =
            tool.isWrite &&
            tc.input.confirm === true &&
            toolResult.ok === true &&
            !toolResult.confirmation;
          let flushText = stripDeadEndDocumentAdvice(pendingNarration.text);
          if (flushText && !wroteOk && !committedWriteOk && looksLikeWritePromise(flushText)) {
            flushText = stripUnfulfilledWritePromises(flushText);
          }
          // Task #1249 — pre-tool prose flushed after a confident
          // classification must not claim low confidence either.
          if (flushText && sawConfidentClassify && !sawLowConfidenceClassify) {
            flushText = stripBogusLowConfidenceClaims(flushText);
          }
          if (flushText) {
            record({
              type: "narration",
              data: { text: flushText, step: pendingNarration.step },
            });
            narrationFlushedCount++;
          }
        }
        pendingNarration = null;
      }
      // Task #645 — remember the card shape/payload the client will render
      // for this result so the closing prose can be trimmed against it.
      const presentationCapability = findByToolName(tc.name);
      const shapeHint =
        toolResult.ok
          ? (
          ((toolResult.data as { shape?: unknown } | null)?.shape as
            | string
            | undefined) ??
            presentationCapability?.resultCard ??
            null
          )
          : null;
      const managedPresentation = isManagedPresentationCapability(presentationCapability);
      const presentation =
        toolResult.ok && presentationCapability
          ? synthesizePresentation({
              turnId,
              step,
              prompt: input.prompt,
              intent: {
                verb: earlyTypedIntent.verb,
                kind: earlyTypedIntent.kind,
              },
              capability: presentationCapability,
              data: toolResult.data,
            })
          : null;
      const isReadFail = !tool.isWrite && toolResult.ok === false;
      const isOverCap =
        !tool.isWrite && toolResult.ok !== false && cardsEmitted >= MAX_CARDS_PER_TURN;
      if (toolResult.ok) {
        if (
          shapeHint &&
          !isOverCap &&
          (!managedPresentation || presentation)
        ) {
          lastCardShape = String(shapeHint);
          lastCardData = toolResult.data;
        }
        if (isCommit) committedWriteOk = true;
        // Task #1249 — remember the classifier's verdicts for this turn.
        if (tc.name === "classify_finance_document") {
          for (const r of extractClassifyResults(toolResult.data)) {
            if (r.lowConfidence) sawLowConfidenceClassify = true;
            else sawConfidentClassify = true;
          }
        }
      }

      // Task #769 — flail guard. Track read-tool call counts and
      // escalate / stop before the loop burns through all MAX_TOOL_STEPS.
      if (!tool.isWrite) {
        const prev = readToolCallCount.get(tc.name) ?? 0;
        const next = prev + 1;
        readToolCallCount.set(tc.name, next);
        if (next === FLAIL_ESCALATION_THRESHOLD) {
          turnTier = "sonnet";
          console.log(
            `[cli-telemetry] ${JSON.stringify({
              evt: "flail_escalation",
              turnId,
              tool: tc.name,
              callCount: next,
            })}`,
          );
        } else if (next >= FLAIL_STOP_THRESHOLD) {
          console.log(
            `[cli-telemetry] ${JSON.stringify({
              evt: "flail_stop",
              turnId,
              tool: tc.name,
              callCount: next,
            })}`,
          );
          recordSessionResult(session.id, {
            pendingClarification: {
              field: "query",
              question:
                "I searched in several ways but couldn't pin down exactly what you're looking for. Could you give me a bit more detail — for example, which account, a deal name, or the pipeline stage?",
              originalPrompt: input.prompt,
              partial: {},
              tool: tc.name,
              fields: null,
            },
          });
          record({
            type: "needs_clarification",
            data: {
              step,
              field: "query",
              question:
                "I searched in several ways but couldn't pin down exactly what you're looking for. Could you give me a bit more detail — for example, which account, a deal name, or the pipeline stage?",
              tool: tc.name,
              partial: {},
              suggestions: [],
              fields: [],
              turnId,
            },
          });
          status = "awaiting_clarification";
          break;
        }
      }

      toolCalls.push({
        step,
        tool: tc.name,
        input: stripSensitiveValues(tc.input),
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

      // Task #573 — the propose_write PREVIEW result is a debug echo of
      // the staged mutation (stage/verb/payload/route). It is fully
      // superseded by the confirm card emitted from `toolResult.confirmation`
      // below, so suppress its tool_result frame to keep the action turn to
      // a single Confirm/Edit/Cancel box. The committed result (a clean
      // `write_success` card) is still recorded.
      const isProposePreview =
        tc.name === "propose_write" &&
        (toolResult.data as { stage?: unknown } | null)?.stage === "preview";
      if (presentation && !isOverCap) {
        record({
          type: "presentation",
          data: presentation as unknown as Record<string, unknown>,
        });
      } else if (managedPresentation && toolResult.ok) {
        console.log(
          `[cli-telemetry] ${JSON.stringify({
            evt: "presentation_suppressed",
            turnId,
            tool: tc.name,
            cardType: shapeHint,
            intentKind: earlyTypedIntent.kind,
            intentVerb: earlyTypedIntent.verb,
            reason: isOverCap ? "card_budget" : "relevance_or_minimum_data",
          })}`,
        );
      }
      if (!isProposePreview && (!managedPresentation || presentation)) {
        // Task #771 Riser overhaul — card budget. Suppress tool_result frames
        // for failing read tools (probe noise; the model still sees the outcome
        // in its history). Also cap successful read-card frames per turn so the
        // transcript stays readable. Write results always get through.
        if (!isReadFail && !isOverCap) {
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
          if (!tool.isWrite && toolResult.ok !== false) cardsEmitted++;
        } else {
          record({
            type: "tool_evidence",
            data: {
              step,
              tool: tc.name,
              ok: toolResult.ok,
              data: toolResult.data,
              errorCode: toolResult.errorCode,
              errorMessage: toolResult.errorMessage,
            },
          });
        }
      } else if (!isProposePreview) {
        record({
          type: "tool_evidence",
          data: {
            step,
            tool: tc.name,
            ok: toolResult.ok,
            data: toolResult.data,
            errorCode: toolResult.errorCode,
            errorMessage: toolResult.errorMessage,
          },
        });
      }

      // Task #24 — deferred post-commit work (e.g. Pursuit Scout after
      // opportunity create). The write is already committed and its
      // success tool_result recorded above; run the follow-up now and
      // surface its outcome as a frame. Failure is never a rollback.
      if (toolResult.after) {
        try {
          const afterFrame = await toolResult.after();
          if (afterFrame) record(afterFrame);
        } catch (err) {
          record({
            type: "progress",
            data: {
              message: `Post-commit follow-up failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          });
        }
      }

      if (toolResult.ok) {
        ingestEntitiesFromToolResult(session.id, tc.name, toolResult.data);
        recordSessionResult(session.id, { lastTurnId: turnId });
        // Task #741 — successful tool inputs/selections become typed facts.
        ingestSessionFacts({
          orgId: persona.orgId,
          userId: persona.id,
          sessionId: session.id,
          turnId,
          tool: tc.name,
          input: stripSensitiveValues(tc.input),
          data: toolResult.data,
          source: "tool_result",
        });
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
        // Clear pending clarification/disambiguation if the originating
        // tool just ran.
        const dr = getSessionDraft(session.id);
        if (dr.pendingClarification && dr.pendingClarification.tool === tc.name) {
          dr.pendingClarification = null;
        }
        if (dr.pendingDisambiguation && dr.pendingDisambiguation.tool === tc.name) {
          dr.pendingDisambiguation = null;
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
            fields: cl.fields ?? null,
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
            fields: cl.fields ?? [],
            // Task #410 — see continuation emit site: lets clients set
            // continuesTurnId even when the final frame is degraded.
            turnId,
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
            // Task #583 — refusal frames never leak tool identifiers.
            reason: scrubToolIdentifiers(rf.reason) ?? rf.reason,
            closestCapabilityId: rf.closestCapabilityId ?? null,
            pageHref: rf.pageHref ?? null,
            suggestion: scrubToolIdentifiers(rf.suggestion ?? null),
            requestCapability: { tool: "request_feature", prompt: input.prompt },
          },
        });
        status = status === "streaming" ? "success" : status;
        break;
      }

      if (toolResult.disambiguation) {
        // Task #799 — first-class continuation: store the originating
        // tool + partial input + declared field so the user's pick is
        // merged and re-run deterministically (no model extraction).
        // Envelopes without a declared `field` stay on the legacy
        // prompt-injected path.
        const disField = (toolResult.disambiguation as { field?: unknown }).field;
        const disOptions = sanitizeDisambigOptions(toolResult.disambiguation.options);
        if (typeof disField === "string" && disField && disOptions.length > 0) {
          recordSessionResult(session.id, {
            pendingDisambiguation: {
              tool: tc.name,
              field: disField,
              kind: toolResult.disambiguation.kind,
              options: disOptions,
              partial: (tc.input ?? {}) as Record<string, unknown>,
              originalPrompt: input.prompt,
            },
          });
        }
        record({
          type: "needs_disambiguation",
          data: {
            ...toolResult.disambiguation,
            step,
            tool: tc.name,
            partial: (tc.input ?? {}) as Record<string, unknown>,
            turnId,
          },
        });
        status = "partial";
        break;
      }
      if (toolResult.confirmation) {
        const candidatePreviewKey = previewKey(tc.name, tc.input);
        if (pendingPreviewKey === candidatePreviewKey && pendingWrite) {
          // Do not emit a second needs_confirmation card or replace the pin
          // that the first card references.
          status = "awaiting_confirmation";
          break;
        }
        // Task #332 — annotate the diff with irreversibility +
        // typed-name requirement so the client renders the right
        // confirm widget (free button vs "type the name to commit").
        const catEntry = findByToolName(tc.name);
        // Task #603 — typed-name decision is per proposed write, based
        // on the risk of the write + whether the attachment bodies (or
        // the user's own prompt) carry destructive verbs.
        const forceTypedName = shouldRequireTypedNameForAttachmentTurn({
          hasAttachments: turnHasAttachments,
          prompt: input.prompt,
          attachmentsMentionDestructive,
          tool: {
            name: tc.name,
            irreversible: catEntry?.irreversible === true,
            outboundChannel: catEntry?.outboundChannel ?? null,
            // Self-scoped me.* writes only touch the caller's own data,
            // so attachment-body verbs alone don't force typed-name.
            selfScoped: catEntry?.id?.startsWith("me.") === true,
          },
        });
        const baseDiff = toolResult.confirmation.diff as Record<string, unknown>;
        const diff: Record<string, unknown> = { ...baseDiff };
        if (catEntry?.irreversible) diff.irreversible = true;
        if (forceTypedName && diff.typedNameRequired === undefined) {
          // Task #679 — the expected value MUST be typeable. The old
          // "(re-type to confirm; attachment-derived)" placeholder was
          // compared verbatim on /confirm, an impossible dead-end.
          diff.typedNameRequired = deriveTypedNameExpected(
            diff,
            toolResult.confirmation.pending?.input as
              | Record<string, unknown>
              | undefined,
          );
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
            // Web confirm card keys off a top-level `typedNameRequired`
            // string (the value to retype); mobile keys off the boolean
            // `requiresTypedName` above. Lift it out of the diff so both
            // clients render the right widget without client changes.
            typedNameRequired:
              catEntry?.irreversible === true || forceTypedName === true
                ? ((diff.typedNameRequired as string) ?? null)
                : null,
            actionId: toolResult.confirmation.durableAction?.actionId ?? null,
            stateVersion: toolResult.confirmation.durableAction?.stateVersion ?? null,
          },
        });
        pendingWrite = toolResult.confirmation.pending;
        pendingPreviewKey = candidatePreviewKey;
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
      // Task #645 — card-aware render note: when this result renders as a
      // structured card, tell the model so its closing prose stays to one
      // framing sentence instead of restating the card's data.
      const renderNote =
        toolResult.ok && lastCardShape && lastCardData === toolResult.data
          ? committedWriteOk
            ? "[render note] The success card for this committed write is already displayed to the user. Do NOT add a closing recap or restate what was changed — end your reply now, with no further prose."
            : `[render note] A "${lastCardShape}" result card showing this exact data is already displayed to the user. Reply with at most ONE short framing sentence and do NOT restate the card's fields, numbers, names, or lists.`
          : null;
      // Task #1249 — classification grounding: spell out the classifier's
      // verdict alongside the tool_result so narration cannot misquote it.
      const groundingNote =
        toolResult.ok && tc.name === "classify_finance_document"
          ? classifyGroundingNote(toolResult.data)
          : null;
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
          ...(groundingNote ? [{ type: "text", text: groundingNote }] : []),
          ...(renderNote ? [{ type: "text", text: renderNote }] : []),
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

    // Task #1116 — the async hand-off of an UNAPPROVED pendingWrite is
    // gone. Previously, a turn that paused `awaiting_confirmation` with
    // a long write plan (> ASYNC_HANDOFF_STEP_THRESHOLD committed write
    // steps) or a caller-supplied `async:true` enqueued the pendingWrite
    // into atelier_cli_jobs and a background runner replayed it via
    // `tool.run(...)` directly — committing a write the user never
    // approved and skipping the typed-name gate, approver-role
    // separation, and idempotent replay that `confirmPendingWrite`
    // enforces. The contract (mirroring Task #1093's unforgeable
    // confirm): a pendingWrite commits ONLY through the /confirm
    // endpoint's verified replay of the server-persisted pendingWrite.
    // A turn ending `awaiting_confirmation` therefore ALWAYS stays
    // awaiting_confirmation, regardless of plan length or `input.async`
    // (kept on RunTurnInput for API compatibility; it never bypasses
    // approval). Probe: tests/cli-turn/async-approval-gate.ts.
    void ASYNC_HANDOFF_STEP_THRESHOLD;
    void input.async;
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
      // Task #410 — a turn that EMITTED a clarification question must stay
      // resumable even if a later step in the same turn failed (classifier
      // abort, supersession bookkeeping error, …). The user saw the
      // question; persisting `error` here would make the answer turn fail
      // rehydration and re-run the whole prompt — re-asking the same
      // question in a loop (and re-paying the specialist research cost).
      // Emitting a clarification always ends the turn's productive work,
      // so no answered-then-errored case can be misclassified here.
      if (
        (status === "error" || status === "partial") &&
        frames.some((f) => f.type === "needs_clarification")
      ) {
        status = "awaiting_clarification";
      }
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
            // Task #1318 — belt-and-braces: terminal persist re-asserts
            // the placeholder prompt for sensitive (password) answer
            // turns and strips sensitive keys from the pendingWrite pin
            // (confirm replays re-fetch the unlocked CogniDocs job by
            // id, never the password).
            ...(sensitivePromptTurn ? { prompt: SENSITIVE_PROMPT_PLACEHOLDER } : {}),
            frames,
            toolCalls,
            pendingWrite: stripSensitiveValues(pendingWrite),
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
      const promptForSummary = sensitivePromptTurn
        ? SENSITIVE_PROMPT_PLACEHOLDER
        : redactText(input.prompt).text.slice(0, 120);
      // Task #978 — persist a plain-language outcome phrase alongside the
      // line so the proactive recap can say what was ACCOMPLISHED, not
      // replay the prompt. Built from structural signals only (tool names,
      // entity labels recorded this turn) — never from the prompt text, so
      // the PII redaction guarantee holds.
      let turnOutcome: string | null = null;
      try {
        const draftNow = getSessionDraft(session.id);
        const turnEntities = Object.values(draftNow.entities)
          .filter((e) => e.at >= t0)
          .sort((a, b) => b.at - a.at)
          .map((e) => ({ kind: e.kind, label: e.label }));
        turnOutcome = describeTurnOutcome({
          status,
          toolCalls: toolCalls.map((c) => ({
            tool: String(c.tool),
            ok: c.ok === true,
            isWrite: findToolByName(String(c.tool))?.isWrite === true,
          })),
          entities: turnEntities,
          pendingTool: (pendingWrite as { tool?: string } | null)?.tool ?? null,
          humanizeTool: humanizeToolName,
        });
      } catch {
        turnOutcome = null;
      }
      const summaryLine = `[${new Date().toISOString().slice(11, 19)}] ${promptForSummary} → ${status}${toolCalls.length ? ` (${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"})` : ""}${turnOutcome ? `${RECAP_OUTCOME_SEP}${turnOutcome}` : ""}`;
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

      // Task #416 — auto-title the session after its first completed
      // turn (also covers pre-existing untitled sessions on their next
      // turn). Fire-and-forget: it runs after the SSE response is done
      // and can never fail or delay the turn itself.
      if (!session.title) {
        const titleSessionId = session.id;
        // Task #1318 — a password answer must not seed the Haiku title
        // call (LLM input) nor a derived title.
        const titlePrompt = sensitivePromptTurn
          ? SENSITIVE_PROMPT_PLACEHOLDER
          : input.prompt;
        setImmediate(() => {
          void generateAndSaveSessionTitle(titleSessionId, titlePrompt);
        });
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
      // pass. For `awaiting_confirmation` we defer — `confirmPendingWrite`
      // / `cancelPendingWrite` write the canonical row when those flows
      // actually terminate. (Task #1116 removed the async runner, so
      // `async_dispatched` can no longer occur here.)
      const writeTerminalAudit = status !== "awaiting_confirmation";
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

// ---------------------------------------------------------------------
// 7. Confirm phase
// ---------------------------------------------------------------------

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
    let expected = (pending.typedNameExpected ?? "").trim();
    // Task #679 — turns stamped with the legacy un-typeable placeholder
    // must not dead-end: accept any non-empty typed confirmation.
    if (expected === LEGACY_TYPED_NAME_PLACEHOLDER) expected = "";
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
  const durableActionId =
    typeof pending.input.__durableActionId === "string"
      ? pending.input.__durableActionId
      : null;
  const durableStateVersion =
    typeof pending.input.__durableStateVersion === "number"
      ? pending.input.__durableStateVersion
      : undefined;
  if (
    durableActionId &&
    (pending.tool !== "account_update" || !durableAccountUpdateEnabled(persona.orgId))
  ) {
    return fail("durable_action_disabled", "This durable action is currently disabled.");
  }
  const result: ToolResult = durableActionId
    ? await confirmAndExecuteDurableAccountUpdate({
        actionId: durableActionId,
        orgId: persona.orgId,
        requesterId: persona.id,
        conversationId: turn.sessionId,
        sourceTurnId: turn.id,
        persona: persona as never,
        expectedStateVersion: durableStateVersion,
      }).then((outcome) => ({
        ok: outcome.state === "succeeded",
        data: outcome.result,
        ...(outcome.state === "succeeded"
          ? {}
          : {
              errorCode: `durable_action_${outcome.state}`,
              errorMessage: "The account update could not be completed safely.",
            }),
      }))
    : await runIdempotentJob({
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

  // Task #1248 — a committed write must never end on a bare card: when
  // the tool stamps a `closingLine` on its commit payload, emit it as a
  // narration frame right after the success card (the confirm path runs
  // OUTSIDE runTurn, so no model prose ever follows the card here).
  const closingLine =
    result.ok &&
    typeof (result.data as { closingLine?: unknown } | null)?.closingLine === "string"
      ? ((result.data as { closingLine: string }).closingLine || "").trim()
      : "";
  if (closingLine) {
    emit({ type: "narration", data: { text: closingLine, step: stepIdx } });
  }

  // Task #340 — record write metadata on session draft so the next
  // /undo or recap call can find this commit. Without this, the
  // standard two-phase confirmed write would never reach undo_last
  // because runTurn's in-loop tracker only fires when confirm===true
  // is on the original input.
  if (result.ok) {
    const dataObj = (result.data ?? {}) as Record<string, unknown>;
    // Task #741 — confirmed writes update session facts too (the confirm
    // path runs OUTSIDE runTurn, so the in-loop ingestion never fires).
    // Attribute facts to the SESSION OWNER (turn.userId), not the
    // confirmer — cross-user approver confirms must leave the facts
    // visible to the initiator's later turns.
    ingestSessionFacts({
      orgId: persona.orgId,
      userId: turn.userId,
      sessionId: turn.sessionId,
      turnId,
      tool: pending.tool,
      input: stripSensitiveValues(pending.input),
      data: result.data,
      source: "confirm",
    });
    recordSessionResult(turn.sessionId, {
      lastWriteTurnId: turnId,
      lastWriteTool: pending.tool,
      lastWriteRaidId:
        pending.tool === "raid_add_v2" && typeof dataObj.id === "string"
          ? (dataObj.id as string)
          : undefined,
    });
    // Task #978 — the confirm commit runs OUTSIDE runTurn, so the rolling
    // summary would otherwise remember this only as "awaiting_confirmation"
    // and the recap could never say the write actually landed. Append a
    // committed-outcome line (best-effort; same caps as the turn path).
    try {
      const label =
        typeof dataObj.name === "string"
          ? dataObj.name
          : typeof dataObj.title === "string"
            ? dataObj.title
            : null;
      const outcome = describeTurnOutcome({
        status: "success",
        toolCalls: [{ tool: pending.tool, ok: true, isWrite: true }],
        entities: label ? [{ kind: "entity", label }] : [],
        humanizeTool: humanizeToolName,
      });
      if (outcome) {
        const [srow] = await db
          .select({ rollingSummary: atelierCliSessions.rollingSummary })
          .from(atelierCliSessions)
          .where(eq(atelierCliSessions.id, turn.sessionId))
          .limit(1);
        const line = `[${new Date().toISOString().slice(11, 19)}] (confirmed) → success${RECAP_OUTCOME_SEP}${outcome}`;
        const next = ((srow?.rollingSummary ?? "") + "\n" + line)
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .slice(-30)
          .join("\n");
        await db
          .update(atelierCliSessions)
          .set({ rollingSummary: next.slice(0, 2000), updatedAt: new Date() })
          .where(eq(atelierCliSessions.id, turn.sessionId));
      }
    } catch (err) {
      console.error(
        "[atelier-cli] confirm rolling-summary append failed",
        turnId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const newStatus: CliTurnStatus = result.ok ? "success" : "error";
  emit({
    type: "final",
    data: { status: newStatus, turnId, sessionId: turn.sessionId, confirmed: true },
  });

  // Task #24 — deferred post-commit work (e.g. Pursuit Scout). The
  // success/final frames are already on the wire, so a slow follow-up
  // never delays confirm feedback. The write is committed; a failure
  // here is surfaced as a frame, never a rollback.
  let afterFrame: CliFrame | null = null;
  if (result.after) {
    try {
      afterFrame = await result.after();
    } catch (err) {
      afterFrame = {
        type: "progress",
        data: {
          message: `Post-commit follow-up failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
    if (afterFrame) emit(afterFrame);
  }

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
    // Task #1248 — persist the closing narration so historical turn
    // replays also end with the confirmation sentence, not a bare card.
    ...(closingLine
      ? [{ type: "narration" as const, data: { text: closingLine, step: stepIdx } }]
      : []),
    { type: "final" as const, data: { status: newStatus, confirmed: true } },
    // Task #24 — persist the deferred follow-up outcome (scout status)
    // so historical turn replays show it too.
    ...(afterFrame ? [afterFrame] : []),
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
  // Task #196 — Cancel must also kill a paused clarification question,
  // not just a pending write. Before this, cancelling a turn stuck in
  // `awaiting_clarification` was a no-op: the DB row stayed paused and
  // the in-memory session draft kept pendingClarification, so the very
  // next prompt in the same session was hijacked as the "answer" and
  // the same question re-asked forever.
  if (
    turn.status !== "awaiting_confirmation" &&
    turn.status !== "awaiting_clarification"
  ) {
    return { status: turn.status as CliTurnStatus };
  }
  const wasClarification = turn.status === "awaiting_clarification";
  await db
    .update(atelierCliTurns)
    .set({
      status: "cancelled",
      statusMessage: wasClarification
        ? "clarification cancelled by user"
        : null,
      pendingWrite: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierCliTurns.id, turnId));
  if (wasClarification) {
    // Drop the in-memory pending question so subsequent prompts in this
    // session go through the normal model loop instead of the
    // deterministic continuation path.
    getSessionDraft(turn.sessionId).pendingClarification = null;
  }
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

// ---------------------------------------------------------------------
// SSE writer helper for the route layer.
// ---------------------------------------------------------------------

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
