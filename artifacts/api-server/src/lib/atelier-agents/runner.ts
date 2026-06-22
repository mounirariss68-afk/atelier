/**
 * Atelier deep-agent runner.
 *
 * 🟡 STANDARD: every Atelier agent — Drafter, Sentinel, Analyst, or
 * Rule-based — must conform to `artifacts/atelier/AGENT_STANDARD.md`.
 * New agents should compose `runAgent(...)` from `./runAgent.ts` rather
 * than duplicating the lifecycle inline. The 15 hand-rolled `run<X>`
 * functions below predate the helper but use the same primitives
 * (`startRun`, `progressRun`, `completeRun`, `failRun`) and conform to
 * the same lifecycle contract.
 *
 * Each `run<X>` call:
 *   1. Inserts an `atelier_agent_runs` row in `running` state.
 *   2. Logs an `agent.start` audit event.
 *   3. Calls Claude (and, when integration env vars are missing,
 *      throws — no fallback is returned).
 *   4. Persists `output` + `steps` + `toolCalls` + `cost` and flips the
 *      run to `complete` (or `error`).
 *   5. Logs an `agent.complete` audit event with payload summary.
 *
 * Citation guardrail: any "fact" the agent emits without `sourceUrl` is
 * stripped and the confidence is downgraded one notch (green→amber,
 * amber→red).
 */

import { db, atelierAgentRuns, atelierAuditEvents, atelierAccounts, atelierOpportunities, atelierPaneAItems, atelierDealPricings } from "@workspace/db";
import { eq, and, gte, isNull } from "drizzle-orm";
import { getAgent } from "@workspace/agents";
import { loadPrompt, type AtelierAgentId } from "./loader.js";
import { runAgent } from "./runAgent.js";
import { reportProgress } from "./progress-sink.js";
import {
  STALLED_THRESHOLD_DAYS,
  SALES_STAGE_DEFAULT_PROB,
  type SalesStage,
} from "./pipeline.js";
import {
  computePricing as computePricingFn,
  type MarginPolicy as PricingMarginPolicy,
  type RateCardRowLite as PricingRateCardRowLite,
  type TeamMixEntry as PricingTeamMixEntry,
} from "../atelier-pricing.js";

/**
 * A probability is "miscalibrated" when it deviates from the default for its
 * stage by more than this many percentage points (e.g., a `lead` flagged at
 * 80% or a `submitted` deal still at 10%). Tunable; deliberately lenient so
 * the forecaster doesn't cry wolf on every manual override.
 */
const MISCALIBRATION_THRESHOLD_PCT = 30;

// ------- shared types -------

export interface AgentFact {
  id?: string;
  topic: string;
  statement: string;
  sourceUrl?: string;
  sourceTitle?: string;
  snippet?: string;
  confidence: "green" | "amber" | "red";
}

export interface PursuitScoutOutput {
  accountSnapshot: {
    oneLiner: string;
    scaleHint: string;
    recentMoves: string[];
  };
  buyerLandscape: {
    likelyBuyers: { title: string; rationale: string }[];
    powerMap: string;
  };
  fiveCDraft: {
    client: string;
    competition: string;
    capability: string;
    capacity: string;
    contract: string;
  };
  openQuestions: string[];
  facts: AgentFact[];
  confidence: "green" | "amber" | "red";
}

export interface PovOutline {
  title: string;
  thesis: string;
  sections: {
    id: string;
    heading: string;
    intent: string;
    factIds: string[];
  }[];
}

export interface PovDraft {
  sections: {
    id: string;
    heading: string;
    body: string;
    citationIds: string[];
  }[];
  html: string;
  citationCoverage: number;
  voiceFlags: string[];
  wordCount: number;
}

export interface MeetingScribeOutput {
  title: string;
  attendees: { name: string; org: "client" | "cognirise" | "unknown" }[];
  summary: string;
  decisions: {
    id: string;
    statement: string;
    decidedBy: string;
    confidence: "green" | "amber" | "red";
  }[];
  actionItems: {
    id: string;
    owner: string;
    statement: string;
    due: string | null;
  }[];
  openQuestions: string[];
  fiveCDelta: {
    client: string;
    competition: string;
    capability: string;
    capacity: string;
    contract: string;
  };
  // Optional prototype seed surfaced by Scribe when the conversation
  // contains a clear demo-able hypothesis. Picked up by Prototype Forge
  // on the same opportunity so the lead can forge directly from a meeting.
  suggestedPrototypeBrief?: {
    audience: string;
    problem: string;
    agenticThesis: string;
    demos: string[];
  } | null;
}

// ------- run lifecycle helpers -------

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

interface StartRunInput {
  agentId: string;
  triggeredByUserId: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string;
  inputs: Record<string, unknown>;
  actorLabel: string;
}

// Per-user-per-day token budget. Soft USD ceiling; throws BudgetExceededError
// before any Claude call so cost is bounded even with retries / parallel runs.
const DAILY_BUDGET_USD = Number(process.env.ATELIER_DAILY_BUDGET_USD ?? 10);
export class BudgetExceededError extends Error {
  spentUsd: number;
  budgetUsd: number;
  constructor(spent: number, budget: number) {
    super(`atelier-budget-exceeded: $${spent.toFixed(4)} / $${budget.toFixed(2)}`);
    this.name = "BudgetExceededError";
    this.spentUsd = spent;
    this.budgetUsd = budget;
  }
}
async function assertBudget(userId: string | null): Promise<void> {
  if (!userId) return;
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ costUsd: atelierAgentRuns.costUsd })
    .from(atelierAgentRuns)
    .where(and(eq(atelierAgentRuns.triggeredByUserId, userId), gte(atelierAgentRuns.createdAt, since)));
  const spent = rows.reduce((s, r) => s + (Number(r.costUsd) || 0), 0);
  if (spent >= DAILY_BUDGET_USD) {
    throw new BudgetExceededError(spent, DAILY_BUDGET_USD);
  }
}

export async function startRun(input: StartRunInput): Promise<string> {
  await assertBudget(input.triggeredByUserId);
  const id = rid("run");
  await db.insert(atelierAgentRuns).values({
    id,
    agentId: input.agentId,
    triggeredByUserId: input.triggeredByUserId,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    inputs: input.inputs,
    status: "running",
    statusMessage: "starting",
    progressPct: 5,
  });
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: input.targetType,
    entityId: input.targetId,
    actorType: "agent",
    actorId: input.agentId,
    actorLabel: input.actorLabel,
    action: "agent.start",
    payload: { runId: id, inputs: input.inputs },
    payloadSummary: `Started ${input.actorLabel} on ${input.targetLabel}`,
  });
  return id;
}

export async function progressRun(
  runId: string,
  pct: number,
  message: string,
  step?: { name: string; durationMs: number; tokensIn?: number; tokensOut?: number },
): Promise<void> {
  reportProgress(pct, message);
  if (step) {
    const [existing] = await db
      .select()
      .from(atelierAgentRuns)
      .where(eq(atelierAgentRuns.id, runId));
    const steps = (existing?.steps as unknown[]) ?? [];
    await db
      .update(atelierAgentRuns)
      .set({
        progressPct: pct,
        statusMessage: message,
        steps: [...steps, step],
        updatedAt: new Date(),
      })
      .where(eq(atelierAgentRuns.id, runId));
    return;
  }
  await db
    .update(atelierAgentRuns)
    .set({ progressPct: pct, statusMessage: message, updatedAt: new Date() })
    .where(eq(atelierAgentRuns.id, runId));
}

interface CompleteRunInput {
  runId: string;
  output: unknown;
  confidence: "green" | "amber" | "red";
  costUsd: number;
  durationMs: number;
  sourcesCount?: number;
  actorLabel: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
}

/**
 * Validate the agent's output against its registry `outputSchema` and
 * return a human-readable violation string if (and only if) it fails.
 *
 * Per AGENT_STANDARD.md §4–§5 the registry is the single source of
 * truth for what an agent emits. Enforcement here means *every* run<X>
 * function — even the 15 hand-rolled ones that predate runAgent.ts —
 * has its output checked at the lifecycle boundary, and any violation
 * lands on the run row + the audit event (queryable, alertable) without
 * breaking the v3 walkthrough by throwing on legacy outputs.
 *
 * Set `ATELIER_AGENT_STRICT_OUTPUT=1` (used by `pnpm test:agents` and
 * CI) to flip violations from soft (logged) to hard (thrown).
 */
function validateAgentOutput(
  agentId: string,
  output: unknown,
): { ok: true } | { ok: false; reason: string } {
  const agent = getAgent(agentId);
  if (!agent) return { ok: true }; // not in registry — caller already warns elsewhere
  const parsed = agent.outputSchema.safeParse(output);
  if (parsed.success) return { ok: true };
  // Compress the Zod issue list to a single line so it fits in
  // `statusMessage` (240 chars) and audit `payloadSummary`.
  const issues = parsed.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return {
    ok: false,
    reason: `output failed registry schema (${parsed.error.issues.length} issue${parsed.error.issues.length === 1 ? "" : "s"}): ${issues}`,
  };
}

export async function completeRun(input: CompleteRunInput): Promise<void> {
  // Resolve agentId from the run row so we can validate output against
  // the registry. We avoid threading agentId through every callsite —
  // the row already knows.
  let schemaWarning: string | null = null;
  try {
    const [row] = await db
      .select({ agentId: atelierAgentRuns.agentId })
      .from(atelierAgentRuns)
      .where(eq(atelierAgentRuns.id, input.runId));
    if (row?.agentId) {
      const check = validateAgentOutput(row.agentId, input.output);
      if (!check.ok) {
        schemaWarning = `[${row.agentId}] ${check.reason}`;
        if (process.env.ATELIER_AGENT_STRICT_OUTPUT === "1") {
          throw new Error(`atelier-agent-schema-violation: ${schemaWarning}`);
        }
        // eslint-disable-next-line no-console
        console.warn(`[atelier-agent-schema-violation] ${schemaWarning}`);
      }
    }
  } catch (e) {
    if (process.env.ATELIER_AGENT_STRICT_OUTPUT === "1") throw e;
    // Best-effort lookup — never break v3 on a registry hiccup.
  }

  await db
    .update(atelierAgentRuns)
    .set({
      status: "complete",
      statusMessage: schemaWarning
        ? `complete (schema warning: ${schemaWarning.slice(0, 200)})`
        : "complete",
      progressPct: 100,
      output: input.output as never,
      confidence: input.confidence,
      costUsd: input.costUsd,
      durationMs: input.durationMs,
      sourcesCount: input.sourcesCount,
      updatedAt: new Date(),
    })
    .where(eq(atelierAgentRuns.id, input.runId));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: input.targetType,
    entityId: input.targetId,
    actorType: "agent",
    actorLabel: input.actorLabel,
    action: "agent.complete",
    payload: {
      runId: input.runId,
      confidence: input.confidence,
      costUsd: input.costUsd,
      schemaWarning,
    },
    payloadSummary: `${input.actorLabel} completed on ${input.targetLabel} (confidence ${input.confidence}, $${input.costUsd.toFixed(4)})${schemaWarning ? " ⚠ schema-violation" : ""}`,
  });

  // Emit a dedicated audit event when the registry schema is violated so
  // a partner querying `atelier_audit_events.action='agent.schema_violation'`
  // can see every contract drift across the firm in one place.
  if (schemaWarning) {
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: input.targetType,
      entityId: input.targetId,
      actorType: "agent",
      actorLabel: input.actorLabel,
      action: "agent.schema_violation",
      payload: { runId: input.runId, schemaWarning },
      payloadSummary: schemaWarning.slice(0, 400),
    });
  }
}

export async function failRun(
  runId: string,
  err: unknown,
  ctx: { actorLabel: string; targetType: string; targetId: string },
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db
    .update(atelierAgentRuns)
    .set({
      status: "error",
      statusMessage: message.slice(0, 240),
      updatedAt: new Date(),
    })
    .where(eq(atelierAgentRuns.id, runId));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: ctx.targetType,
    entityId: ctx.targetId,
    actorType: "agent",
    actorLabel: ctx.actorLabel,
    action: "agent.error",
    payload: { runId, error: message },
    payloadSummary: `${ctx.actorLabel} errored: ${message.slice(0, 120)}`,
  });
}

// ------- citation guardrail -------

export function applyCitationGuardrail(facts: AgentFact[]): AgentFact[] {
  return facts
    .map((f) => {
      const hasUrl = !!f.sourceUrl && /^https?:\/\//.test(f.sourceUrl);
      if (hasUrl) return { ...f, id: f.id ?? rid("f") };
      const downgraded =
        f.confidence === "green"
          ? "amber"
          : f.confidence === "amber"
            ? "red"
            : "red";
      return { ...f, id: f.id ?? rid("f"), confidence: downgraded as AgentFact["confidence"] };
    })
    .filter((f) => f.statement.trim().length > 0);
}

// ------- claude dispatch -------
//
// There is no mock mode. Every agent run goes through Claude. If the
// upstream call fails we throw — silent mock fallbacks have been removed
// so synthetic placeholder data can never reach a user as if it were
// real evidence.

if (
  !process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ||
  !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
) {
  throw new Error(
    "[atelier-agents] AI_INTEGRATIONS_ANTHROPIC_BASE_URL and AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. The Atelier agent runner does not support mock mode.",
  );
}

async function callClaudeJson<T>(
  model: string,
  systemPrompt: string,
  userPrompt: string): Promise<{ value: T; costUsd: number; tokensIn: number; tokensOut: number }> {
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  const ac = new AbortController();
  const timeoutMs = Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 45000);
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const resp = await anthropic.messages
    .create(
      {
        model,
        max_tokens: 8192,
        system: `${systemPrompt}\n\nIMPORTANT: Reply with ONLY a single JSON object, no prose, no code fences.`,
        messages: [{ role: "user", content: userPrompt }],
      },
      { signal: ac.signal },
    )
    .finally(() => clearTimeout(timer));
  const block = resp.content[0];
  const text = block && block.type === "text" ? block.text.trim() : "";
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const value = JSON.parse(stripped) as T;
  const tokensIn = resp.usage.input_tokens;
  const tokensOut = resp.usage.output_tokens;
  const inRate = model.includes("haiku") ? 1 : 3;
  const outRate = model.includes("haiku") ? 5 : 15;
  const costUsd = (tokensIn * inRate + tokensOut * outRate) / 1_000_000;
  return { value, costUsd, tokensIn, tokensOut };
}

// ------- Pursuit Scout -------


/**
 * Pursuit Scout v2 governed-write — Task #238 §2.5.
 *
 * Translates Scout 5C/strategic-priority deltas into pending profile-update
 * proposals on the account's `pending_profile_updates` queue. Partners
 * approve/reject these via the Cartographer Profile tab. We never overwrite
 * live account fields here.
 */
async function proposeProfileUpdatesFromScout(args: {
  opportunityId: string;
  proposedBy: string;
  output: PursuitScoutOutput;
}): Promise<void> {
  const [opp] = await db
    .select()
    .from(atelierOpportunities)
    .where(eq(atelierOpportunities.id, args.opportunityId));
  if (!opp?.accountId) return;
  const [account] = await db
    .select()
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, opp.accountId), isNull(atelierAccounts.deletedAt)));
  if (!account) return;

  const proposals: Array<{
    id: string;
    proposedBy: string;
    proposedAt: string;
    field: string;
    fromValue: unknown;
    toValue: unknown;
    rationale: string;
    oppId?: string;
    status: "pending" | "approved" | "rejected";
  }> = [];

  const now = new Date().toISOString();
  const facts = (args.output as {
    facts?: Array<{ statement?: string; sourceUrl?: string; sourceTitle?: string; topic?: string }>;
  }).facts ?? [];

  // 1) strategicPriorities deltas
  const existingPriorities = (account.strategicPriorities as string[] | null) ?? [];
  const priorityFacts = facts.filter((f) => /priorit|strateg|initiative/i.test(f.statement ?? ""));
  for (const f of priorityFacts.slice(0, 3)) {
    if (!f.statement) continue;
    proposals.push({
      id: `pp_${rid("x").slice(2)}`,
      proposedBy: args.proposedBy,
      proposedAt: now,
      field: "strategicPriorities",
      fromValue: existingPriorities,
      toValue: [...existingPriorities, f.statement.slice(0, 200)],
      rationale: `Pursuit Scout fact: ${f.sourceTitle ?? f.sourceUrl ?? "evidence pending"}`,
      oppId: args.opportunityId,
      status: "pending",
    });
  }

  // 2) hqCity / sector enrichment
  const hqMatch = facts.find((f) => /headquarter|HQ|based in|head office/i.test(f.statement ?? ""));
  if (hqMatch?.statement && !account.hqCity) {
    proposals.push({
      id: `pp_${rid("x").slice(2)}`,
      proposedBy: args.proposedBy,
      proposedAt: now,
      field: "hqCity",
      fromValue: account.hqCity,
      toValue: hqMatch.statement.slice(0, 100),
      rationale: `Pursuit Scout HQ enrichment: ${hqMatch.sourceTitle ?? hqMatch.sourceUrl ?? "evidence pending"}`,
      oppId: args.opportunityId,
      status: "pending",
    });
  }
  const sectorMatch = facts.find((f) => /sector|industry|vertical/i.test(f.statement ?? ""));
  if (sectorMatch?.statement) {
    proposals.push({
      id: `pp_${rid("x").slice(2)}`,
      proposedBy: args.proposedBy,
      proposedAt: now,
      field: "sector",
      fromValue: account.sector,
      toValue: sectorMatch.statement.slice(0, 100),
      rationale: `Pursuit Scout sector signal: ${sectorMatch.sourceTitle ?? sectorMatch.sourceUrl ?? "evidence pending"}`,
      oppId: args.opportunityId,
      status: "pending",
    });
  }

  // 3) sourceSignals enrichment — every fact with a URL becomes a candidate signal
  const existingSignals = (account.sourceSignals as Array<{ url: string }> | null) ?? [];
  const knownUrls = new Set(existingSignals.map((s) => s.url));
  const newSignals = facts
    .filter((f) => f.sourceUrl && !knownUrls.has(f.sourceUrl))
    .slice(0, 5)
    .map((f) => ({
      kind: /linkedin/i.test(f.sourceUrl ?? "") ? "linkedin" : /press|news/i.test(f.sourceUrl ?? "") ? "news" : "press",
      title: f.sourceTitle ?? f.statement?.slice(0, 80) ?? "Pursuit Scout finding",
      url: f.sourceUrl as string,
      summary: f.statement?.slice(0, 240),
      publishedAt: now,
      confidence: "amber" as const,
    }));
  if (newSignals.length > 0) {
    proposals.push({
      id: `pp_${rid("x").slice(2)}`,
      proposedBy: args.proposedBy,
      proposedAt: now,
      field: "sourceSignals",
      fromValue: existingSignals,
      toValue: [...existingSignals, ...newSignals],
      rationale: `Pursuit Scout surfaced ${newSignals.length} new signal(s) for review.`,
      oppId: args.opportunityId,
      status: "pending",
    });
  }

  if (proposals.length === 0) return;
  const queue = ((account.pendingProfileUpdates as typeof proposals | null) ?? []).concat(proposals);
  await db
    .update(atelierAccounts)
    .set({ pendingProfileUpdates: queue, updatedAt: new Date() })
    .where(eq(atelierAccounts.id, account.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "account",
    entityId: account.id,
    actorType: "agent",
    actorId: args.proposedBy,
    actorLabel: "Pursuit Scout",
    action: "account.profile.proposeUpdate",
    payload: { count: proposals.length, oppId: args.opportunityId },
    payloadSummary: `Pursuit Scout proposed ${proposals.length} profile update(s) for "${account.name}".`,
  });
}

// ---------------------------------------------------------------------------
// Task #568 — governed AI population. The Account Cartographer no longer
// direct-writes hypothesis / priorities / research brief / signals / contacts
// on a manual refresh. Instead it PROPOSES, and a partner approves / edits /
// rejects. This builder turns a CartographerOutput into pending-proposal
// candidates, applying two filters so the queue stays clean:
//   1. no-op skip — drop candidates whose value already matches the live one;
//   2. resurface guard — drop candidates that match an existing pending OR a
//      previously-rejected proposal (so rejected items don't keep coming back
//      unless the AI materially changes its mind).
// ---------------------------------------------------------------------------
export interface PendingProfileUpdate {
  id: string;
  proposedBy: string;
  proposedAt: string;
  field: string;
  fromValue: unknown;
  toValue: unknown;
  rationale: string;
  oppId?: string;
  status: "pending" | "approved" | "rejected";
  meta?: Record<string, unknown>;
  editedAt?: string;
  editedBy?: string;
  originalToValue?: unknown;
  decidedAt?: string;
  decidedBy?: string;
}

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const norm = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = norm((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(norm(value));
}

/** True when two values are semantically equal (order-insensitive on keys). */
export function materiallyEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Dedupe key for a proposal — field-level uses field+value; contacts use
 * name+title so a renamed title is treated as a fresh candidate. */
function proposalKey(p: { field: string; toValue: unknown }): string {
  if (p.field === "contact") {
    const c = (p.toValue ?? {}) as { fullName?: string; title?: string | null };
    return `contact:${(c.fullName ?? "").toLowerCase()}:${(c.title ?? "").toLowerCase()}`;
  }
  return `${p.field}:${stableStringify(p.toValue)}`;
}

export function buildCartographerProposals(args: {
  proposedBy: string;
  output: CartographerOutput;
  account: typeof atelierAccounts.$inferSelect;
  existingContacts: Array<{ fullName: string }>;
}): PendingProfileUpdate[] {
  const { output, account } = args;
  const now = new Date().toISOString();

  // Keys already represented in the queue (pending or rejected). A candidate
  // matching one of these is dropped so we neither duplicate a live proposal
  // nor resurface a rejected one.
  const blockedKeys = new Set<string>();
  for (const u of (account.pendingProfileUpdates ?? []) as PendingProfileUpdate[]) {
    if (u.status === "pending" || u.status === "rejected") {
      blockedKeys.add(proposalKey(u));
    }
  }

  const candidates: PendingProfileUpdate[] = [];
  const push = (
    field: string,
    fromValue: unknown,
    toValue: unknown,
    rationale: string,
    meta?: Record<string, unknown>,
  ) => {
    // no-op skip: value already live
    if (materiallyEqual(toValue, fromValue)) return;
    const key = proposalKey({ field, toValue });
    if (blockedKeys.has(key)) return;
    blockedKeys.add(key);
    candidates.push({
      id: `pp_${rid("x").slice(2)}`,
      proposedBy: args.proposedBy,
      proposedAt: now,
      field,
      fromValue,
      toValue,
      rationale,
      status: "pending",
      ...(meta ? { meta } : {}),
    });
  };

  // 1) cogniriseHypothesis
  const hypo = output.account.cogniriseHypothesis?.trim();
  if (hypo) {
    push(
      "cogniriseHypothesis",
      account.cogniriseHypothesis ?? null,
      hypo,
      "Account Cartographer refreshed the Cognirise win hypothesis from public sources.",
    );
  }

  // 2) strategicPriorities (+ citation refs carried in meta)
  const priorities = output.account.strategicPriorities ?? [];
  const priorityTexts = priorities.map((p) => p.text).filter((t) => t && t.trim().length > 0);
  if (priorityTexts.length > 0) {
    const refs = priorities
      .filter((p) => p.text && p.text.trim().length > 0)
      .map((p) => ({
        text: p.text,
        sourceUrls: Array.isArray(p.sourceUrls)
          ? p.sourceUrls.filter((u) => typeof u === "string")
          : [],
      }));
    push(
      "strategicPriorities",
      (account.strategicPriorities as string[] | null) ?? [],
      priorityTexts,
      `Account Cartographer sourced ${priorityTexts.length} strategic priorit${priorityTexts.length === 1 ? "y" : "ies"}.`,
      { refs },
    );
  }

  // 3) researchBrief (complex blob — approve/reject as-is, no inline edit)
  const brief = output.researchBrief;
  const briefHasContent =
    brief &&
    ((brief.whatsChanging?.length ?? 0) > 0 ||
      (brief.executiveTensions?.length ?? 0) > 0 ||
      (brief.serviceLineFit?.length ?? 0) > 0 ||
      (brief.partnerEcosystem?.length ?? 0) > 0 ||
      (brief.mandateAngles?.length ?? 0) > 0 ||
      (brief.whyNowHypothesis?.trim().length ?? 0) > 0 ||
      (brief.openQuestions?.length ?? 0) > 0);
  if (briefHasContent) {
    push(
      "researchBrief",
      account.researchBrief ?? null,
      brief,
      "Account Cartographer refreshed the structured research brief (what's changing, tensions, service-line fit, ecosystem, mandate angles).",
    );
  }

  // 4) sourceSignals — propose existing + newly-discovered (dedupe on url)
  const incomingSignals = output.sourceSignals ?? [];
  const existingSignals =
    (account.sourceSignals as Array<{ url: string }> | null) ?? [];
  const seenUrls = new Set(existingSignals.map((s) => s.url));
  const newSignals = incomingSignals.filter((s) => s.url && !seenUrls.has(s.url));
  if (newSignals.length > 0) {
    push(
      "sourceSignals",
      existingSignals,
      [...existingSignals, ...newSignals].slice(-50),
      `Account Cartographer surfaced ${newSignals.length} new signal(s) for review.`,
    );
  }

  // 5) contacts (decision-makers) — one proposal per discovered person. The
  //    applier upserts the contact and (on approval) the reports_to edge.
  const knownNames = new Set(args.existingContacts.map((c) => c.fullName.toLowerCase()));
  for (const dm of output.decisionMakers ?? []) {
    if (!dm.fullName || !dm.fullName.trim()) continue;
    const isNew = !knownNames.has(dm.fullName.toLowerCase());
    push(
      "contact",
      null,
      {
        fullName: dm.fullName,
        title: dm.title ?? null,
        seniority: dm.seniority ?? null,
        buyerPersona: dm.buyerPersona ?? null,
        sourceUrl: dm.sourceUrl ?? null,
        confidence: dm.confidence,
        reportsToName: dm.reportsToName ?? null,
        rationale: dm.rationale ?? null,
        timeInRole: dm.timeInRole ?? null,
        careerHistory: dm.careerHistory ?? [],
        education: dm.education ?? [],
      },
      `Account Cartographer ${isNew ? "discovered" : "re-confirmed"} decision-maker ${dm.fullName}${dm.title ? ` (${dm.title})` : ""}.`,
      { reportsToName: dm.reportsToName ?? null },
    );
  }

  return candidates;
}

export async function runPursuitScout(args: {
  opportunityId: string;
  accountName: string;
  accountCountry: string;
  accountSector: string;
  opportunityName: string;
  contextBlurb: string;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: PursuitScoutOutput; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_pursuit_scout",
      input: {
        accountName: args.accountName,
        accountCountry: args.accountCountry,
        accountSector: args.accountSector,
        opportunityName: args.opportunityName,
        contextBlurb: args.contextBlurb,
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("pursuit_scout");
      await ctx.progress(25, "Planning research lines");
      const { value, costUsd } = await callClaudeJson<PursuitScoutOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          accountName: args.accountName,
          accountCountry: args.accountCountry,
          accountSector: args.accountSector,
          opportunityName: args.opportunityName,
          contextBlurb: args.contextBlurb,
        }),
      );
      await ctx.progress(70, "Synthesising 5C draft");
      const guarded: PursuitScoutOutput = { ...value, facts: applyCitationGuardrail(value.facts ?? []) };
      // Pursuit Scout v2 governed-write — Task #238 §2.5.
      // Profile deltas enqueued onto the Cartographer approval queue.
      try {
        await proposeProfileUpdatesFromScout({
          opportunityId: args.opportunityId,
          proposedBy: "ag_pursuit_scout",
          output: guarded,
        });
      } catch (e) {
        console.warn("proposeProfileUpdatesFromScout failed", e);
      }
      return {
        output: guarded,
        costUsd,
        confidence: guarded.confidence ?? "amber",
        sourcesCount: guarded.facts.length,
      };
    },
  );
  return { runId: result.runId, output: result.output as PursuitScoutOutput, costUsd: result.costUsd };
}

// ------- POV Author (3-step chain) -------



export async function runPovOutline(args: {
  opportunityId: string;
  opportunityName: string;
  audience: string;
  objective: string;
  promotedFacts: AgentFact[];
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; outline: PovOutline; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_pov_author",
      input: {
        opportunityId: args.opportunityId,
        audience: args.audience,
        objective: args.objective,
        promotedFacts: args.promotedFacts,
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("pov_author");
      await ctx.progress(30, "Drafting outline");
      const { value, costUsd } = await callClaudeJson<PovOutline>(
        "claude-haiku-4-5",
        system + "\n\n## Run-time directive\nReturn ONLY the Phase A outline JSON.",
        JSON.stringify({
          opportunity: args.opportunityName,
          audience: args.audience,
          objective: args.objective,
          approvedFacts: args.promotedFacts,
        }),
      );
      return {
        output: value,
        costUsd,
        confidence: "amber",
        sourcesCount: args.promotedFacts.length,
      };
    },
  );
  return { runId: result.runId, outline: result.output as PovOutline, costUsd: result.costUsd };
}

export async function runPovDraft(args: {
  opportunityId: string;
  opportunityName: string;
  outline: PovOutline;
  promotedFacts: AgentFact[];
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; draft: PovDraft; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_pov_draft",
      input: {
        opportunityId: args.opportunityId,
        opportunityName: args.opportunityName,
        outline: args.outline,
        promotedFacts: args.promotedFacts,
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("pov_author");
      await ctx.progress(40, "Writing sections");
      const { value, costUsd } = await callClaudeJson<PovDraft>(
        "claude-sonnet-4-5",
        system + "\n\n## Run-time directive\nExecute Phase B (sections), then Phase C (critic), then Phase D (stylist) and return the final composite JSON: { sections, html, citationCoverage, voiceFlags, wordCount }.",
        JSON.stringify({ outline: args.outline, facts: args.promotedFacts }),
      );
      await ctx.progress(85, "Stylist polish");
      return {
        output: value,
        costUsd,
        confidence: value.citationCoverage >= 0.8 ? "green" : "amber",
        sourcesCount: args.promotedFacts.length,
      };
    },
  );
  return { runId: result.runId, draft: result.output as PovDraft, costUsd: result.costUsd };
}

// ------- Meeting Scribe -------


export async function runMeetingScribe(args: {
  opportunityId: string;
  opportunityName: string;
  transcript: string;
  kind: "discovery" | "workshop" | "steering" | "kickoff";
  priorBrief: PursuitScoutOutput | null;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: MeetingScribeOutput; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_meeting_scribe",
      input: {
        opportunityId: args.opportunityId,
        transcript: args.transcript,
        kind: args.kind,
        priorBrief: args.priorBrief,
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("meeting_scribe");
      await ctx.progress(35, "Normalising speakers");
      const { value, costUsd } = await callClaudeJson<MeetingScribeOutput>(
        "claude-haiku-4-5",
        system,
        JSON.stringify({
          transcript: args.transcript,
          meeting_kind: args.kind,
          prior_brief: args.priorBrief,
        }),
      );
      await ctx.progress(80, "Extracting decisions & actions");
      return {
        output: value,
        costUsd,
        confidence: "amber",
        sourcesCount: value.decisions.length + value.actionItems.length,
      };
    },
  );
  return { runId: result.runId, output: result.output as MeetingScribeOutput, costUsd: result.costUsd };
}

// ------- decision logging (ApproveEditReject) -------

export async function recordDecision(args: {
  runId: string;
  decision: "approve" | "edit" | "reject";
  rationale: string;
  actorId: string;
  actorLabel: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
}): Promise<void> {
  const [run] = await db
    .select()
    .from(atelierAgentRuns)
    .where(eq(atelierAgentRuns.id, args.runId));
  const decisions = (run?.humanDecisions as unknown[]) ?? [];
  await db
    .update(atelierAgentRuns)
    .set({
      humanDecisions: [
        ...decisions,
        {
          decision: args.decision,
          rationale: args.rationale,
          by: args.actorId,
          ts: new Date().toISOString(),
        },
      ],
      updatedAt: new Date(),
    })
    .where(eq(atelierAgentRuns.id, args.runId));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.targetType,
    entityId: args.targetId,
    actorType: "human",
    actorId: args.actorId,
    actorLabel: args.actorLabel,
    action: `human.${args.decision}`,
    payload: { runId: args.runId, rationale: args.rationale },
    payloadSummary: `${args.actorLabel} ${args.decision}d run on ${args.targetLabel}${args.rationale ? ` — "${args.rationale.slice(0, 120)}"` : ""}`,
  });
}

// =============================================================
// Charter Architect (Sonnet 4.6, 4-sub-agent chain)
// =============================================================

export interface CharterBody {
  objectives: string[];
  scope: string[];
  outOfScope: string[];
  successMetrics: { name: string; baseline: string; target: string }[];
  governance: string;
  valueHypothesis: string;
}
export interface HypothesisTree {
  rootIssue: string;
  branches: {
    hypothesis: string;
    subHypotheses: string[];
    evidenceRequired: string[];
  }[];
}
export interface RaidBaselineItem {
  kind: "risk" | "assumption" | "issue" | "dependency";
  severity: "green" | "amber" | "red";
  ownerRole: string;
  description: string;
  dueClass: "wk1" | "wk2" | "wk4" | "monthly";
}
export interface CharterArchitectOutput {
  charter: CharterBody;
  hypothesisTree: HypothesisTree;
  raidBaseline: RaidBaselineItem[];
  proposedWorkstreams: { name: string; leadRole: string; linkedHypothesis: string }[];
  meceFlags: string[];
}


export async function runCharterArchitect(args: {
  engagementId: string;
  engagementName: string;
  accountName: string;
  wonProposalSummary: string;
  kickoffTranscriptExcerpt: string | null;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: CharterArchitectOutput; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_charter_architect",
      input: {
        engagementId: args.engagementId,
        accountName: args.accountName,
        wonProposalSummary: args.wonProposalSummary,
        kickoffTranscriptExcerpt: args.kickoffTranscriptExcerpt ?? undefined,
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "engagement",
      targetId: args.engagementId,
      targetLabel: args.engagementName,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("charter_architect");
      await ctx.progress(15, "Objective Distiller — extracting 3–5 outcome-shaped objectives");
      await ctx.progress(35, "Scope Boundarist — drawing IN/OUT scope sets (MECE)");
      await ctx.progress(60, "Hypothesis Tree Builder — building tree (max depth 3)");
      await ctx.progress(80, "RAID Baseliner — triaging baseline RAID items");
      const hasBaseline = !/no baseline/i.test(args.wonProposalSummary);
      const { value, costUsd } = await callClaudeJson<CharterArchitectOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          engagementId: args.engagementId,
          accountName: args.accountName,
          wonProposalSummary: args.wonProposalSummary,
          kickoffTranscriptExcerpt: args.kickoffTranscriptExcerpt,
        }),
      );
      if (value.hypothesisTree?.branches) {
        value.hypothesisTree.branches.forEach((b) => {
          if (Array.isArray(b.subHypotheses) && b.subHypotheses.length > 6) {
            b.subHypotheses = b.subHypotheses.slice(0, 6);
          }
        });
      }
      return {
        output: value,
        costUsd,
        confidence: value.meceFlags?.length ? "amber" : "green",
        sourcesCount: value.raidBaseline?.length ?? 0,
      };
    },
  );
  return { runId: result.runId, output: result.output as CharterArchitectOutput, costUsd: result.costUsd };
}

// =============================================================
// Synthesis Critic (Opus 4.6 — flag-only, never edits)
// =============================================================

export interface SynthesisCriticIssue {
  type:
    | "missing_citation"
    | "off_hypothesis"
    | "no_governing_thought"
    | "mece_break"
    | "weak_so_what"
    | "tone"
    | "factual_risk";
  severity: "low" | "med" | "high";
  location: string;
  description: string;
  suggestion: string;
}
export interface SynthesisCriticOutput {
  issues: SynthesisCriticIssue[];
  pyramid_score: number;
  evidence_coverage_pct: number;
  off_hypothesis_sections: string[];
  readiness: "green" | "amber" | "red";
}


export async function runSynthesisCritic(args: {
  engagementId: string;
  deliverableId: string;
  deliverableName: string;
  body: string;
  hypothesisTree: HypothesisTree | null;
  audience: string;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: SynthesisCriticOutput; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_synthesis_critic",
      input: {
        deliverableId: args.deliverableId,
        body: args.body,
        hypothesisTree: args.hypothesisTree,
        audience: args.audience,
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "deliverable",
      targetId: args.deliverableId,
      targetLabel: args.deliverableName,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("synthesis_critic");
      await ctx.progress(25, "Walking sections + checking pyramid structure");
      await ctx.progress(60, "Auditing citations + hypothesis coverage");
      const { value, costUsd } = await callClaudeJson<SynthesisCriticOutput>(
        "claude-opus-4-7",
        system,
        JSON.stringify({
          deliverableId: args.deliverableId,
          body: args.body,
          hypothesisTree: args.hypothesisTree,
          audience: args.audience,
        }),
      );
      return {
        output: value,
        costUsd,
        confidence: value.readiness === "green" ? "green" : value.readiness === "amber" ? "amber" : "red",
        sourcesCount: value.issues?.length ?? 0,
      };
    },
  );
  return { runId: result.runId, output: result.output as SynthesisCriticOutput, costUsd: result.costUsd };
}

// =============================================================
// Diagnostic Memo scaffold — deterministic writer that turns the
// engagement's hypothesis tree into a starter v1 body. Reused as the
// "Re-draft from sources" action on the deliverable workspace; the
// human edits in place after that.
// =============================================================
export function scaffoldDiagnosticMemo(args: {
  engagementName: string;
  audience: string;
  tree: HypothesisTree | null;
  // includeDefects: produce a deliberately-weak v1 so Synthesis Critic
  // has something to flag in the seeded acceptance walkthrough.
  includeDefects?: boolean;
}): string {
  const t = args.tree;
  const branches = t?.branches ?? [];
  const root = t?.rootIssue ?? `What should ${args.engagementName} do next?`;

  if (args.includeDefects) {
    // Deliberately weak v1: buried lede + uncited assertions + an
    // off-hypothesis section. The Critic is expected to flag all three.
    return [
      `<h1>Diagnostic Memo — ${args.engagementName}</h1>`,
      `<h2>Background</h2>`,
      `<p>${args.engagementName} has been running for several quarters. Many things have happened. Adoption is broadly fine and we believe it will be fine going forward.</p>`,
      `<h2>What we did</h2>`,
      `<p>We reviewed available materials and held a kickoff. Trust us that the work was thorough.</p>`,
      `<h2>Brand refresh proposal</h2>`,
      `<p>While reviewing, we also recommend updating the engagement's logo treatment and tone of voice to better resonate with the executive sponsor.</p>`,
      `<h2>Next steps</h2>`,
      `<p>We will continue.</p>`,
    ].join("\n");
  }

  const sections = branches.slice(0, 4).map((b, i) => {
    const subs = (b.subHypotheses ?? []).slice(0, 3).map((s) => `<li>${s}</li>`).join("");
    const ev = (b.evidenceRequired ?? []).slice(0, 3).map((e) => `<li>${e}</li>`).join("");
    return [
      `<h2>${i + 1}. ${b.hypothesis}</h2>`,
      subs ? `<p><em>Sub-hypotheses:</em></p><ul>${subs}</ul>` : "",
      ev ? `<p><em>Evidence required:</em></p><ul>${ev}</ul>` : "",
      `<p><strong>So what:</strong> the next decision is to fund the evidence collection above and fix a 30-day check-in to test this branch.<sup data-fact="f${i + 1}">f${i + 1}</sup></p>`,
    ].join("\n");
  }).join("\n");

  return [
    `<h1>Diagnostic Memo — ${args.engagementName}</h1>`,
    `<h2>Recommendation: pursue the three branches below in priority order</h2>`,
    `<p><strong>Audience:</strong> ${args.audience}.</p>`,
    `<p><strong>Bottom line:</strong> ${root}<sup data-fact="f0">f0</sup></p>`,
    sections,
    `<h2>Conclusion</h2>`,
    `<p>This memo is a draft. Each branch above maps to a hypothesis on the engagement tree; evidence collection is the next move.</p>`,
  ].join("\n");
}

// =============================================================
// Agent Architect — Process Reader → Step Classifier →
//                   Agentifiability Judge → Agent Designer
// (Task #223)
// =============================================================

export type StepCategory =
  | "decision"
  | "communication"
  | "reconciliation"
  | "calculation"
  | "retrieval"
  | "irreversible_action";

export interface ProcessStep {
  id: string;
  name: string;
  currentOwner: string;
  category: StepCategory;
  agentifiable: "yes" | "partial" | "no";
  rationale: string;
  candidateAgentId?: string;
}

export interface AgentSchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "enum";
  description: string;
  required?: boolean;
  enumValues?: string[];
}

export interface CandidateAgentDesign {
  id: string;
  name: string;
  purpose: string;
  /** Zod-shaped input schema (one entry per top-level field). */
  inputs: AgentSchemaField[];
  /** Zod-shaped output schema (one entry per top-level field). */
  outputs: AgentSchemaField[];
  tools: string[];
  guardrails: string[];
  humanCheckpoints: string[];
  riskClass: "low" | "med" | "high";
}

function fld(name: string, type: AgentSchemaField["type"], description: string, required = true): AgentSchemaField {
  return { name, type, description, required };
}

export interface AgentArchitectOutput {
  processDiagramMermaid: string;
  steps: ProcessStep[];
  candidateAgents: CandidateAgentDesign[];
}


export async function runAgentArchitect(args: {
  engagementId: string;
  engagementName: string;
  scopeHint: string;
  source: string;
  depth: "sketch" | "design";
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: AgentArchitectOutput; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_agent_architect",
      input: { scopeHint: args.scopeHint, depth: args.depth, source: args.source },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "engagement",
      targetId: args.engagementId,
      targetLabel: args.engagementName,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("agent_architect");
      await ctx.progress(15, "Process Reader — normalizing input into ordered steps");
      await ctx.progress(35, "Step Classifier — assigning category per step");
      await ctx.progress(60, "Agentifiability Judge — yes/partial/no with rationale");
      await ctx.progress(80, "Agent Designer — clustering into candidate designs");
      const { value, costUsd } = await callClaudeJson<AgentArchitectOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({ scopeHint: args.scopeHint, depth: args.depth, source: args.source }),
      );
      // Server-side post-validation (defense-in-depth).
      const hasComm = value.steps.some(
        (s) => s.category === "communication" || /(reply|email|sms|notify|message)/i.test(s.name),
      );
      const hasIrreversible = value.steps.some(
        (s) => s.category === "irreversible_action" || /(send|publish|commit|sign|refund)/i.test(s.name),
      );
      const hasFinancial = value.steps.some((s) =>
        /(refund|payment|invoice|charge|wire|price|quote)/i.test(s.name),
      );
      const requiresHigh = hasComm || hasIrreversible || hasFinancial;
      value.candidateAgents.forEach((c) => {
        if (!c.humanCheckpoints || c.humanCheckpoints.length === 0) {
          c.humanCheckpoints = ["lead_or_partner_signs_off"];
        }
        const touchesComm = /comm|drafter|customer|reply|notify/i.test(c.name + " " + c.purpose);
        const touchesAction = /action|publish|sign|commit|drafter/i.test(c.name + " " + c.purpose);
        if (requiresHigh && (touchesComm || touchesAction) && c.riskClass !== "high") {
          c.riskClass = "high";
          c.guardrails = Array.from(
            new Set([...(c.guardrails ?? []), "never_auto_send", "partner_attention_required_for_first_run"]),
          );
          c.humanCheckpoints = Array.from(
            new Set([...(c.humanCheckpoints ?? []), "partner_signs_off_on_first_5_sends"]),
          );
        }
      });
      return {
        output: value,
        costUsd,
        confidence: value.candidateAgents.some((c) => c.riskClass === "high") ? "amber" : "green",
        sourcesCount: value.steps.length,
      };
    },
  );
  return { runId: result.runId, output: result.output as AgentArchitectOutput, costUsd: result.costUsd };
}

// =============================================================
// Prototype Forge — Architecture Drafter → Demo Storyboarder →
//                    Brand Translator → Prompt Composer
// =============================================================

export interface PrototypeForgeBrief {
  name: string;
  audience: string;
  problem: string;
  agenticThesis: string;
  demos: string[];
  constraints: string[];
  brandOverrides?: { primary?: string; logo?: string } | null;
  partnerDataApproved?: boolean;
}

export interface PrototypeForgeOutput {
  replitPromptMd: string;
  buildPlan: { phase: string; days: number; deliverables: string[] }[];
  demoStoryboard: { id: string; title: string; moment: string; interaction: string; artifact: string }[];
}


function enforcePrototypeNonNegotiables(
  output: PrototypeForgeOutput,
  brief: PrototypeForgeBrief,
): PrototypeForgeOutput {
  const md = output.replitPromptMd ?? "";
  const dataLine = brief.partnerDataApproved
    ? "Real client data is permitted (Partner approved)."
    : "Use synthetic/watermarked data only — Partner has NOT approved real client data.";
  const canonical = [
    ``,
    `## Data policy (Cognirise-enforced)`,
    `- ${dataLine}`,
    ``,
    `## Cognirise non-negotiables (auto-injected)`,
    `- Human authority is sovereign. Every irreversible action requires a human signoff.`,
    `- Show the work. Every agent output ships with rationale + sources.`,
    `- Audit trail. Every action is logged (who/what/when).`,
    `- Bilingual-aware (EN/AR) where the audience requires.`,
    `- Synthetic data is watermarked; never simulate a real customer outcome silently.`,
  ].join("\n");
  const hasNonNeg = /##\s+Cognirise non-negotiables/i.test(md);
  const hasDataPolicy = /##\s+Data policy/i.test(md);
  if (hasNonNeg && hasDataPolicy) return output;
  return { ...output, replitPromptMd: `${md.trimEnd()}\n${canonical}\n` };
}

export async function runPrototypeForge(args: {
  opportunityId: string | null;
  engagementId: string | null;
  targetLabel: string;
  brief: PrototypeForgeBrief;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: PrototypeForgeOutput; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_prototype_forge",
      input: {
        opportunityId: args.opportunityId,
        engagementId: args.engagementId,
        targetLabel: args.targetLabel,
        brief: args.brief,
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: args.opportunityId ? "opportunity" : "engagement",
      targetId: (args.opportunityId ?? args.engagementId) as string,
      targetLabel: args.targetLabel,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("prototype_forge");
      await ctx.progress(20, "Architecture Drafter — sketching surfaces + agent topology");
      await ctx.progress(45, "Demo Storyboarder — choosing demo moments");
      await ctx.progress(70, "Brand Translator — applying brand defaults/overrides");
      await ctx.progress(90, "Prompt Composer — assembling Replit-ready prompt");
      const { value: rawValue, costUsd } = await callClaudeJson<PrototypeForgeOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify(args.brief),
      );
      // Post-validate: Cognirise non-negotiables block must always be present in
      // the Replit prompt regardless of model drift. If the model omits the
      // section or the data-policy line, append the canonical block.
      const value = enforcePrototypeNonNegotiables(rawValue, args.brief);
      return {
        output: value,
        costUsd,
        confidence: "green",
        sourcesCount: value.demoStoryboard.length,
      };
    },
  );
  return { runId: result.runId, output: result.output as PrototypeForgeOutput, costUsd: result.costUsd };
}

// =============================================================
// Proposal Composer — orchestrates 8 sub-agents
// (incl. Pricing Analyst, Case Study Picker, Compliance Reviewer)
// =============================================================

export interface ProposalSection {
  id: string;
  name: string;
  ownerAgent: string;
  status: "draft" | "amber" | "green" | "red" | "approved";
  content: string;
  citations: string[];
}

export interface PricingModel {
  totalRevenueUsd: number;
  totalCostUsd: number;
  marginPct: number;
  verdict: "green" | "amber" | "red" | "partner_override_required";
  wedgeChart: { role: string; days: number; cost: number; revenue: number }[];
}

export interface ComplianceMatrixRow {
  rfpReqId: string;
  requirement: string;
  status: "green" | "red";
  evidence: string;
}

export interface ProposalComposerOutput {
  title: string;
  sections: ProposalSection[];
  pricingModel: PricingModel;
  winThemes: string[];
  complianceMatrix: ComplianceMatrixRow[];
  complianceOverall: "green" | "red";
}

const DAY_RATES: Record<string, number> = {
  partner: 4000,
  lead: 3000,
  sme: 2500,
  ai_engineer: 2200,
  business_developer: 1800,
};
const SELL_MULTIPLIER: Record<string, number> = {
  partner: 1.6,
  lead: 1.7,
  sme: 1.6,
  ai_engineer: 1.7,
  business_developer: 1.5,
};

export async function runProposalComposer(args: {
  opportunityId: string;
  opportunityName: string;
  sectionsRequired: string[];
  teamProposed: { role: string; alloc: number }[];
  pricingIntent: { targetMarginPct: number; durationWeeks: number };
  rfpRequirements: { id: string; requirement: string; severity: string }[];
  triggeredByUserId: string | null;
  actorLabel: string;
  /** Task #241: top-3 firm-wide win themes for the opp's offering/sector. */
  curatedWinThemes?: Array<{ tag: string; name: string; positioningLine: string | null }>;
}): Promise<{ runId: string; output: ProposalComposerOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "proposal_composer",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "opportunity",
    targetId: args.opportunityId,
    targetLabel: args.opportunityName,
    inputs: { sections: args.sectionsRequired.length, team: args.teamProposed.length },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("proposal_composer");
    await progressRun(runId, 10, "Context Writer — framing situation");
    await progressRun(runId, 22, "Approach Writer — MECE workstreams");
    await progressRun(runId, 35, "Workplan Writer — phasing deliverables");
    await progressRun(runId, 48, "Team Bios Writer — proposed team");
    await progressRun(runId, 60, "Case Study Picker — top-3 credentials");
    await progressRun(runId, 72, "Pricing Analyst — building wedge");
    await progressRun(runId, 84, "Terms & Risk Writer — contractual language");
    await progressRun(runId, 95, "Compliance Reviewer — RFP matrix");
    const { value, costUsd } = await callClaudeJson<ProposalComposerOutput>(
      "claude-sonnet-4-5",
      system,
      JSON.stringify({
        opportunityId: args.opportunityId,
        sectionsRequired: args.sectionsRequired,
        teamProposed: args.teamProposed,
        pricingIntent: args.pricingIntent,
        rfpRequirements: args.rfpRequirements,
        curatedWinThemes: args.curatedWinThemes ?? [],
      }),
    );
    // Task #241: if curated firm-wide themes were supplied, fold them into
    // the output's winThemes so the proposal speaks with the firm's voice
    // rather than the per-deal mock.
    if (args.curatedWinThemes && args.curatedWinThemes.length > 0) {
      const lines = args.curatedWinThemes
        .slice(0, 3)
        .map((t) => t.positioningLine ?? t.name)
        .filter((s): s is string => Boolean(s));
      if (lines.length > 0) value.winThemes = lines;
    }
    // Guardrail: if compliance unmet, overall must be red (never silently green).
    if (value.complianceMatrix.some((r) => r.status === "red")) {
      value.complianceOverall = "red";
      const sec = value.sections.find((s) => s.id === "compliance");
      if (sec) sec.status = "red";
    }
    // Guardrail: any margin below the partner's target margin must force a
    // partner override decision — never silently amber/green it through.
    if (value.pricingModel.marginPct < args.pricingIntent.targetMarginPct) {
      value.pricingModel.verdict = "partner_override_required";
      const sec = value.sections.find((s) => s.id === "pricing");
      if (sec) sec.status = "red";
    }
    await completeRun({
      runId,
      output: value as unknown,
      confidence: value.complianceOverall === "red" || value.pricingModel.verdict === "partner_override_required" ? "amber" : "green",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.sections.length,
      actorLabel: args.actorLabel,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "opportunity", targetId: args.opportunityId });
    throw err;
  }
}

// =============================================================
// Task #297 — Brand Profile Writer (Front of House). Canonical brand
// copy source. Persisted via firmProfileRoutes (atelier_firm_profile).
// =============================================================

export interface BrandProfileOutput {
  firmName: string;
  tagline: string;
  missionStatement: string;
  voiceAttributes: string[];
  principles: { name: string; description: string }[];
  boilerplateShort: string;
  boilerplateLong: string;
  capabilitiesPitch: string;
  differentiators: string[];
  proofPoints: { label: string; metric: string }[];
  legalEntities: { name: string; jurisdiction: string }[];
  contactBlock: string;
  brandColors?: { primary?: string; ink?: string; gold?: string };
}


export async function runBrandProfileWriter(args: {
  firmName: string;
  existingProfile?: Partial<BrandProfileOutput> | null;
  userBrief?: string | null;
  triggeredByUserId: string | null;
  actorLabel: string;
  orgId?: string;
}): Promise<{ runId: string; output: BrandProfileOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "brand_profile_writer",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "firm",
    targetId: args.orgId ?? "firm_profile",
    targetLabel: args.firmName,
    inputs: { firmName: args.firmName, hasBrief: !!args.userBrief, hasExisting: !!args.existingProfile },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("brand_profile_writer");
    await progressRun(runId, 20, "Loading evidence corpus");
    await progressRun(runId, 50, "Drafting voice + boilerplate");
    await progressRun(runId, 80, "Drafting differentiators + proof points");
    const { value, costUsd } = await callClaudeJson<BrandProfileOutput>(
      "claude-sonnet-4-5",
      system,
      JSON.stringify({
        firmName: args.firmName,
        existingProfile: args.existingProfile ?? null,
        userBrief: args.userBrief ?? null,
        evidenceCorpus: [],
      }),
    );
    // Guardrails on length budgets the prompt promises.
    if ((value.boilerplateShort ?? "").length > 500) {
      value.boilerplateShort = value.boilerplateShort.slice(0, 500);
    }
    if ((value.boilerplateLong ?? "").length > 1500) {
      value.boilerplateLong = value.boilerplateLong.slice(0, 1500);
    }
    await completeRun({
      runId,
      output: value as unknown,
      confidence: "green",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: (value.proofPoints ?? []).length,
      actorLabel: args.actorLabel,
      targetType: "firm",
      targetId: args.orgId ?? "firm_profile",
      targetLabel: args.firmName,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "firm", targetId: args.orgId ?? "firm_profile" });
    throw err;
  }
}

// =============================================================
// v2 — Account Cartographer (★), Whitespace Mapper, QBR Composer
// (Task #238). Mock-first. Output JSON shapes mirror OpenAPI.
// =============================================================

// Task #560 — evidence + service-line vocabulary used by the structured
// research brief (Cognirise account-research method, Steps 1–3).
export type EvidenceLabel = "evidenced" | "inferred" | "hypothesis";
export type ServiceLine = "SL01" | "SL02" | "SL03" | "SL04" | "SL05";

export interface ResearchClaim {
  text: string;
  evidence: EvidenceLabel;
  sourceUrls: string[];
}

export interface CartographerResearchBrief {
  // A — what is changing for this client right now.
  whatsChanging: ResearchClaim[];
  // B — executive tensions / likely priorities.
  executiveTensions: ResearchClaim[];
  // C — AI & transformation posture mapped to Cognirise service lines.
  serviceLineFit: Array<{ serviceLine: ServiceLine; signal: string; sourceUrls: string[] }>;
  // D — partner & ecosystem picture (white-space hints).
  partnerEcosystem: Array<{
    partner: string;
    relationship: string;
    serviceLineGap?: string | null;
    sourceUrls: string[];
  }>;
  // Step 4 input — group / business-unit structure for the prep-card map.
  // Each unit names a major division plus 2–3 subsidiary / brand names.
  businessUnits: Array<{ name: string; brands: string[]; note?: string | null }>;
  // F — mandate-creation angles with service-line tags + why-now.
  mandateAngles: Array<{
    title: string;
    serviceLines: ServiceLine[];
    tension: string;
    whyNow: string;
    entryStakeholder: string;
    sourceUrls: string[];
  }>;
  // Step 2 — the 5-sentence "why now" origination hypothesis (issue-led).
  whyNowHypothesis: string;
  // G — open questions / what would change the picture.
  openQuestions: string[];
  // Closing line — "the single most important thing to understand …".
  singleMostImportant: string;
  // Step 3 (Task #589) — stress-test of the origination hypothesis.
  stressTest: CartographerStressTest;
}

export interface CartographerStressTest {
  // What would make the hypothesis irrelevant or wrong (2–3 scenarios).
  failureScenarios: string[];
  // Hidden assumptions bucketed by how grounded they are.
  assumptions: {
    evidenced: string[];
    untestedButLikely: string[];
    uncertain: string[];
  };
  // The 3 most likely objections a skeptical first buyer would raise.
  likelyObjections: string[];
  // 2–3 pieces of evidence that would most strengthen the hypothesis.
  evidenceToStrengthen: Array<{ evidence: string; whereToFind: string }>;
  // The tightened one-sentence hypothesis after stress-testing.
  revisedHypothesis: string;
}

const EVIDENCE_LABELS: EvidenceLabel[] = ["evidenced", "inferred", "hypothesis"];
const SERVICE_LINES: ServiceLine[] = ["SL01", "SL02", "SL03", "SL04", "SL05"];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asTrimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function asStringList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : [];
}
function asUrlList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && /^https?:\/\//.test(x))
    : [];
}
function asEvidence(v: unknown): EvidenceLabel {
  return EVIDENCE_LABELS.includes(v as EvidenceLabel) ? (v as EvidenceLabel) : "inferred";
}
function asServiceLine(v: unknown): ServiceLine | null {
  return SERVICE_LINES.includes(v as ServiceLine) ? (v as ServiceLine) : null;
}
function asServiceLineList(v: unknown): ServiceLine[] {
  return Array.isArray(v)
    ? v.map(asServiceLine).filter((s): s is ServiceLine => s !== null)
    : [];
}
function asClaims(v: unknown): ResearchClaim[] {
  return (Array.isArray(v) ? v : [])
    .map((raw) => {
      const o = asRecord(raw);
      return { text: asTrimmed(o.text), evidence: asEvidence(o.evidence), sourceUrls: asUrlList(o.sourceUrls) };
    })
    .filter((c) => c.text.length > 0);
}

// Task #560 — never throw on a missing/malformed brief; coerce to the
// typed shape so callers (proposal card, persistence) can rely on it.
function normaliseResearchBrief(v: unknown): CartographerResearchBrief {
  const r = asRecord(v);
  return {
    whatsChanging: asClaims(r.whatsChanging),
    executiveTensions: asClaims(r.executiveTensions),
    serviceLineFit: (Array.isArray(r.serviceLineFit) ? r.serviceLineFit : [])
      .map((raw) => {
        const o = asRecord(raw);
        return { serviceLine: asServiceLine(o.serviceLine), signal: asTrimmed(o.signal), sourceUrls: asUrlList(o.sourceUrls) };
      })
      .filter((s): s is { serviceLine: ServiceLine; signal: string; sourceUrls: string[] } =>
        s.serviceLine !== null && s.signal.length > 0),
    partnerEcosystem: (Array.isArray(r.partnerEcosystem) ? r.partnerEcosystem : [])
      .map((raw) => {
        const o = asRecord(raw);
        const gap = asTrimmed(o.serviceLineGap);
        return { partner: asTrimmed(o.partner), relationship: asTrimmed(o.relationship), serviceLineGap: gap.length > 0 ? gap : null, sourceUrls: asUrlList(o.sourceUrls) };
      })
      .filter((p) => p.partner.length > 0),
    businessUnits: (Array.isArray(r.businessUnits) ? r.businessUnits : [])
      .map((raw) => {
        const o = asRecord(raw);
        const note = asTrimmed(o.note);
        return { name: asTrimmed(o.name), brands: asStringList(o.brands), note: note.length > 0 ? note : null };
      })
      .filter((b) => b.name.length > 0),
    mandateAngles: (Array.isArray(r.mandateAngles) ? r.mandateAngles : [])
      .map((raw) => {
        const o = asRecord(raw);
        return {
          title: asTrimmed(o.title),
          serviceLines: asServiceLineList(o.serviceLines),
          tension: asTrimmed(o.tension),
          whyNow: asTrimmed(o.whyNow),
          entryStakeholder: asTrimmed(o.entryStakeholder),
          sourceUrls: asUrlList(o.sourceUrls),
        };
      })
      .filter((m) => m.title.length > 0),
    whyNowHypothesis: asTrimmed(r.whyNowHypothesis),
    openQuestions: asStringList(r.openQuestions),
    singleMostImportant: asTrimmed(r.singleMostImportant),
    stressTest: normaliseStressTest(r.stressTest),
  };
}

// Task #589 — coerce the Step-3 stress-test into the typed shape; never
// throw on a missing/malformed section so older briefs and partial model
// output stay safe to persist and render.
function normaliseStressTest(v: unknown): CartographerStressTest {
  const r = asRecord(v);
  const a = asRecord(r.assumptions);
  return {
    failureScenarios: asStringList(r.failureScenarios),
    assumptions: {
      evidenced: asStringList(a.evidenced),
      untestedButLikely: asStringList(a.untestedButLikely),
      uncertain: asStringList(a.uncertain),
    },
    likelyObjections: asStringList(r.likelyObjections),
    evidenceToStrengthen: (Array.isArray(r.evidenceToStrengthen) ? r.evidenceToStrengthen : [])
      .map((raw) => {
        const o = asRecord(raw);
        return { evidence: asTrimmed(o.evidence), whereToFind: asTrimmed(o.whereToFind) };
      })
      .filter((e) => e.evidence.length > 0),
    revisedHypothesis: asTrimmed(r.revisedHypothesis),
  };
}

export interface CartographerOutput {
  account: {
    refreshedSummary: string;
    // Inferred firmographics — populated when running against a sparse
    // input (e.g. chat "create account" prefill). Always present, may be
    // empty strings / null when the model could not resolve them.
    canonicalName?: string;
    country?: string;
    sector?: string;
    hqCity?: string | null;
    tier?: "A" | "B" | "C" | null;
    industryCode?: string | null;
    subIndustryCode?: string | null;
    // Sourced strategic priorities. `text` mirrors the v1 string list,
    // `sourceUrls` contains the citation URLs the agent pulled (Task #275).
    strategicPriorities: Array<{ text: string; sourceUrls: string[] }>;
    cogniriseHypothesis: string;
  };
  sourceSignals: Array<{
    kind: "news" | "linkedin" | "press" | "filing" | "manual";
    title: string;
    url: string;
    summary?: string;
    publishedAt?: string;
    confidence?: "green" | "amber" | "red";
  }>;
  // Task #275 — named decision-makers with provenance. Replaces the old
  // proposedProfileUpdates queue; cartographer now direct-writes.
  decisionMakers: Array<{
    fullName: string;
    title?: string;
    seniority?: "c_suite" | "vp" | "director" | "manager" | "ic";
    buyerPersona?: string;
    sourceUrl?: string | null;
    confidence: "verified" | "inferred";
    reportsToName?: string | null;
    rationale?: string;
    // Task #589 — deep stakeholder profile (Step 4 "Person profile").
    timeInRole?: string | null;
    careerHistory?: Array<{
      role: string;
      company: string;
      period?: string | null;
      highlight?: string | null;
    }>;
    education?: Array<{ institution: string; programme?: string | null; year?: string | null }>;
  }>;
  // Task #560 — structured research brief (Cognirise account-research
  // method, Steps 1–3). Always present after normalisation; empty arrays
  // / strings when the model omitted a section.
  researchBrief: CartographerResearchBrief;
}


/**
 * Task #275 — Anthropic web_search-grounded JSON call.
 *
 * Wires Anthropic's server-side `web_search_20250305` tool so the model
 * actually pulls public sources before answering. We then parse a single
 * JSON object out of the final `text` block. We also harvest citation
 * URLs from any `web_search_tool_result` blocks so callers can append
 * them to source signals even if the model forgot to inline them.
 */
async function callClaudeJsonWithWebSearch<T>(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts?: {
    /**
     * When set, phase updates (search / read / synthesis heartbeat) are also
     * persisted to this agent_run row's `statusMessage` + `progressPct` so a
     * background (non-chat) run surfaces a live phase on the account page,
     * not just an indefinite spinner. Omitted for research-only chat runs,
     * where the ambient progress sink already streams to the transcript.
     */
    progressRunId?: string | null;
  }): Promise<{
  value: T;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  citationUrls: Array<{ url: string; title?: string }>;
}> {
  const progressRunId = opts?.progressRunId ?? null;
  // Phase emitter — always streams to the ambient sink (chat transcript) and,
  // for a persisted run, also updates the agent_run row so the account page
  // can show the same phase. DB write is best-effort; a failure must never
  // break research.
  // Persisted run-row progress is kept monotonic (high-water mark) so the
  // account-page bar never visibly backsteps when phases interleave (e.g. the
  // heartbeat ramps to 96 during a lull, then a later search would emit 35).
  // The chat caption is unaffected — it shows the live status message, not pct.
  let maxPersistedPct = 0;
  const emitPhase = (
    pct: number,
    message: string,
    data?: Record<string, unknown>,
  ) => {
    reportProgress(pct, message, data);
    if (progressRunId) {
      maxPersistedPct = Math.max(maxPersistedPct, Math.round(pct));
      void db
        .update(atelierAgentRuns)
        .set({
          progressPct: maxPersistedPct,
          statusMessage: message.slice(0, 240),
          updatedAt: new Date(),
        })
        .where(eq(atelierAgentRuns.id, progressRunId))
        .then(undefined, () => {});
    }
  };
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  const ac = new AbortController();
  // Web-search research legitimately spends minutes when a heavy account
  // (e.g. a large conglomerate) drives the full 6-search / dozens-of-sources
  // ceiling. It gets its OWN, larger budget than the generic agent timeout
  // (ATELIER_AGENT_TIMEOUT_MS, default 90s) — otherwise the abort timer fires
  // mid-research and the cartographer prefill fails with "Request was aborted".
  const timeoutMs = Number(
    process.env.ATELIER_WEBSEARCH_TIMEOUT_MS ??
      process.env.ATELIER_AGENT_TIMEOUT_MS ??
      180_000,
  );
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  // Stream rather than `.create(...)` so the web-search agent's otherwise
  // opaque multi-minute call surfaces granular progress (search queries,
  // sources read, drafting) to the ambient progress sink. The final parsed
  // message is recovered via `stream.finalMessage()`.
  let searchCount = 0;
  // The model's final answer is one large JSON object that streams out over
  // 60–90s+ after web search ends. TWO windows used to look frozen: (a) the
  // silent gap between the last source read and the first answer token while
  // the model composes internally, and (b) the long answer stream itself.
  // A single live heartbeat covers both: it starts as "Analysing sources…"
  // once the model goes quiet after a search, then flips to "Synthesising the
  // brief…" the moment answer text begins. Both share the "synthesis" phase
  // key so the chat caption coalesces into ONE row that re-emits a fresh
  // elapsed label every 2.5s — the activity indicator never stalls.
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let heartbeatBase = "Analysing sources…";
  let heartbeatStartedAt = 0;
  let synthesisPending: ReturnType<typeof setTimeout> | null = null;
  const emitHeartbeat = () => {
    const secs = Math.round((Date.now() - heartbeatStartedAt) / 1000);
    emitPhase(
      Math.min(80 + Math.floor(secs / 5), 96),
      secs > 0 ? `${heartbeatBase} (${secs}s)` : heartbeatBase,
      { phase: "synthesis" },
    );
  };
  const startHeartbeat = (base: string) => {
    if (heartbeat && base === heartbeatBase) return; // already ticking this phase
    heartbeatBase = base;
    heartbeatStartedAt = Date.now(); // reset elapsed for the new phase label
    emitHeartbeat(); // instant transition, no 2.5s wait
    if (!heartbeat) heartbeat = setInterval(emitHeartbeat, 2500);
  };
  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  const cancelSynthesisPending = () => {
    if (synthesisPending) {
      clearTimeout(synthesisPending);
      synthesisPending = null;
    }
  };
  // Accumulate the actual sources read (deduped by URL) so the live
  // "Read N sources" progress step can be expanded to reveal the titles.
  const readSources: Array<{ url: string; title?: string }> = [];
  const seenSourceUrls = new Set<string>();
  const resp = await (async () => {
    const stream = anthropic.messages.stream(
      {
        model,
        // The web-search tool-use blocks AND search-query tokens count toward
        // output_tokens, so this budget is shared between (up to 6) searches and
        // the large final JSON brief. 8192 was too tight: heavy accounts blew
        // the ceiling and the JSON truncated mid-array, failing JSON.parse
        // ("Expected ',' or ']' after array element"). Sonnet 4.5 allows 64K
        // output; give generous headroom. Unused tokens are not billed.
        max_tokens: 32000,
        system: `${systemPrompt}\n\nIMPORTANT: After your research is complete, your FINAL message MUST contain ONLY one JSON object that matches the schema. No prose, no code fences.`,
        messages: [{ role: "user", content: userPrompt }],
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 6,
          },
        ],
      },
      { signal: ac.signal },
    );
    try {
      for await (const event of stream) {
        // A server tool (web_search) is being invoked — announce the query.
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "server_tool_use" &&
          event.content_block.name === "web_search"
        ) {
          searchCount += 1;
          // A fresh search means we are not yet composing — cancel any pending
          // "Analysing…" promotion and pause the heartbeat for the search.
          cancelSynthesisPending();
          stopHeartbeat();
          emitPhase(35, `Searching the web (${searchCount})`);
        } else if (
          event.type === "content_block_start" &&
          event.content_block.type === "web_search_tool_result"
        ) {
          const result = event.content_block.content as unknown;
          if (Array.isArray(result)) {
            for (const item of result as Array<{
              type?: string;
              url?: string;
              title?: string;
            }>) {
              if (
                item?.type === "web_search_result" &&
                typeof item.url === "string" &&
                !seenSourceUrls.has(item.url)
              ) {
                seenSourceUrls.add(item.url);
                readSources.push({
                  url: item.url,
                  title: typeof item.title === "string" ? item.title : undefined,
                });
              }
            }
          }
          const sourcesRead = readSources.length;
          emitPhase(
            60,
            `Read ${sourcesRead} source${sourcesRead === 1 ? "" : "s"}`,
            { sources: readSources.slice(0, 40) },
          );
          // If the model goes quiet after this read (no new search within a
          // beat), it has moved on to composing — promote to a live
          // "Analysing sources…" heartbeat so the caption never freezes during
          // the silent pre-answer compose gap. A subsequent search cancels it.
          cancelSynthesisPending();
          synthesisPending = setTimeout(
            () => startHeartbeat("Analysing sources…"),
            2000,
          );
        } else if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          // Answer tokens are streaming — flip the live caption to synthesis.
          cancelSynthesisPending();
          startHeartbeat("Synthesising the brief…");
        }
      }
      return await stream.finalMessage();
    } finally {
      clearTimeout(timer);
      cancelSynthesisPending();
      stopHeartbeat();
    }
  })();
  // Find the last text block (Claude returns interleaved tool-use,
  // tool-result, and text blocks; the final text is the answer).
  const textBlocks = resp.content.filter(
    (b): b is { type: "text"; text: string } & typeof b =>
      b.type === "text" && typeof (b as { text?: unknown }).text === "string",
  );
  const lastText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : "";
  const stripped = lastText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  const json =
    firstBrace >= 0 && lastBrace > firstBrace
      ? stripped.slice(firstBrace, lastBrace + 1)
      : stripped;
  let value: T;
  try {
    value = JSON.parse(json) as T;
  } catch (parseErr) {
    // If the model hit the output ceiling the JSON is truncated and parse
    // fails with a cryptic position error. Surface the real cause so the
    // failure is actionable (raise max_tokens / tighten the schema). Parse
    // first so a response that happens to complete exactly at the cap still
    // succeeds.
    if (resp.stop_reason === "max_tokens") {
      throw new Error(
        "Cartographer output exceeded the token budget and was truncated before the JSON brief completed. Increase max_tokens or reduce the requested detail.",
      );
    }
    throw parseErr;
  }
  const citationUrls: Array<{ url: string; title?: string }> = [];
  for (const block of resp.content) {
    const b = block as {
      type?: string;
      content?: Array<{ type?: string; url?: string; title?: string }>;
    };
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const item of b.content) {
        if (item?.type === "web_search_result" && typeof item.url === "string") {
          citationUrls.push({ url: item.url, title: item.title ?? undefined });
        }
      }
    }
  }
  const tokensIn = resp.usage.input_tokens;
  const tokensOut = resp.usage.output_tokens;
  const inRate = model.includes("haiku") ? 1 : 3;
  const outRate = model.includes("haiku") ? 5 : 15;
  const costUsd = (tokensIn * inRate + tokensOut * outRate) / 1_000_000;
  return { value, costUsd, tokensIn, tokensOut, citationUrls };
}

export async function runAccountCartographer(args: {
  // `null` is allowed only when `mode === "research_only"` — the run is
  // not persisted to atelier_agent_runs and no DB writes happen. Used by
  // the chat orchestrator to pre-fill the Create Account confirm card.
  accountId: string | null;
  accountName: string;
  accountSector: string;
  accountCountry: string;
  accountHqCity?: string | null;
  triggeredByUserId: string | null;
  actorLabel: string;
  focusOpportunityId?: string | null;
  mode?: "live" | "research_only";
}): Promise<{ runId: string | null; output: CartographerOutput; costUsd: number }> {
  const mode = args.mode ?? "live";
  if (mode === "live" && !args.accountId) {
    throw new Error("runAccountCartographer: accountId is required in live mode");
  }
  const t0 = Date.now();
  const runId =
    mode === "live"
      ? await startRun({
          agentId: "account_cartographer",
          triggeredByUserId: args.triggeredByUserId,
          targetType: "account",
          targetId: args.accountId as string,
          targetLabel: args.accountName,
          inputs: { focusOpportunityId: args.focusOpportunityId ?? null },
          actorLabel: args.actorLabel,
        })
      : null;
  try {
    const system = loadPrompt("account_cartographer");
    // progressRun forwards to the ambient sink in live mode; in research_only
    // (runId null) emit the same breadcrumb directly so chat still shows it.
    if (runId) await progressRun(runId, 25, "Searching the public web");
    else reportProgress(25, "Searching the public web");
    const { value, costUsd, citationUrls } =
      await callClaudeJsonWithWebSearch<CartographerOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          accountName: args.accountName,
          accountCountry: args.accountCountry,
          accountSector: args.accountSector,
          accountHqCity: args.accountHqCity ?? null,
        }),
        // Live runs persist phase to the run row so the account page shows a
        // current phase, not a bare spinner. research_only (runId null) relies
        // solely on the ambient sink streaming to the chat transcript.
        { progressRunId: runId });
    if (runId) {
      // Runs AFTER the synthesis heartbeat (which ramps to ~96%) — keep the
      // pct monotonic so the phase never visibly backsteps. This is the true
      // terminal post-processing step before the run is marked complete.
      await progressRun(runId, 98, "Finalising the brief", {
        name: "cart.synth",
        durationMs: Date.now() - t0,
      });
    }

    // Defensive normalisation — the model occasionally returns the v1
    // shape (strategicPriorities: string[]) or omits decisionMakers.
    // Coerce so the route handler can rely on the v2 shape.
    const normalised: CartographerOutput = {
      account: {
        refreshedSummary: value?.account?.refreshedSummary ?? "",
        canonicalName:
          typeof value?.account?.canonicalName === "string"
            ? value.account.canonicalName.trim()
            : undefined,
        country:
          typeof value?.account?.country === "string"
            ? value.account.country.trim()
            : undefined,
        sector:
          typeof value?.account?.sector === "string"
            ? value.account.sector.trim()
            : undefined,
        hqCity:
          typeof value?.account?.hqCity === "string"
            ? value.account.hqCity.trim()
            : null,
        tier:
          value?.account?.tier === "A" ||
          value?.account?.tier === "B" ||
          value?.account?.tier === "C"
            ? value.account.tier
            : null,
        industryCode:
          typeof value?.account?.industryCode === "string"
            ? value.account.industryCode.trim()
            : null,
        subIndustryCode:
          typeof value?.account?.subIndustryCode === "string"
            ? value.account.subIndustryCode.trim()
            : null,
        strategicPriorities: Array.isArray(value?.account?.strategicPriorities)
          ? value.account.strategicPriorities
              .map((p) =>
                typeof p === "string"
                  ? { text: p, sourceUrls: [] as string[] }
                  : { text: String(p?.text ?? ""), sourceUrls: Array.isArray(p?.sourceUrls) ? p.sourceUrls.filter((u): u is string => typeof u === "string") : [] },
              )
              .filter((p) => p.text.trim().length > 0)
          : [],
        cogniriseHypothesis: value?.account?.cogniriseHypothesis ?? "",
      },
      sourceSignals: Array.isArray(value?.sourceSignals)
        ? value.sourceSignals.filter((s) => typeof s?.url === "string" && /^https?:\/\//.test(s.url))
        : [],
      decisionMakers: Array.isArray(value?.decisionMakers)
        ? value.decisionMakers
            .filter((d) => typeof d?.fullName === "string" && d.fullName.trim().length > 0)
            .map((d) => ({
              fullName: d.fullName.trim(),
              title: d.title ?? undefined,
              seniority: d.seniority,
              buyerPersona: d.buyerPersona ?? undefined,
              sourceUrl: d.sourceUrl ?? null,
              confidence: d.confidence === "verified" ? "verified" : "inferred",
              reportsToName: d.reportsToName ?? null,
              rationale: d.rationale ?? undefined,
              timeInRole: typeof d.timeInRole === "string" ? d.timeInRole.trim() || null : null,
              careerHistory: Array.isArray(d.careerHistory)
                ? d.careerHistory
                    .map((h) => ({
                      role: String(h?.role ?? "").trim(),
                      company: String(h?.company ?? "").trim(),
                      period: typeof h?.period === "string" ? h.period.trim() || null : null,
                      highlight: typeof h?.highlight === "string" ? h.highlight.trim() || null : null,
                    }))
                    .filter((h) => h.role.length > 0 || h.company.length > 0)
                : [],
              education: Array.isArray(d.education)
                ? d.education
                    .map((e) => ({
                      institution: String(e?.institution ?? "").trim(),
                      programme: typeof e?.programme === "string" ? e.programme.trim() || null : null,
                      year: typeof e?.year === "string" ? e.year.trim() || null : null,
                    }))
                    .filter((e) => e.institution.length > 0)
                : [],
            }))
        : [],
      researchBrief: normaliseResearchBrief(
        (value as { researchBrief?: unknown } | null | undefined)?.researchBrief,
      ),
    };
    // If the model produced fewer signals than the search returned,
    // backfill with raw citation URLs so the UI still surfaces evidence.
    if (normalised.sourceSignals.length < 3 && citationUrls.length > 0) {
      const seen = new Set(normalised.sourceSignals.map((s) => s.url));
      for (const c of citationUrls) {
        if (seen.has(c.url)) continue;
        normalised.sourceSignals.push({
          kind: "news",
          title: c.title ?? c.url,
          url: c.url,
          confidence: "amber",
        });
        seen.add(c.url);
        if (normalised.sourceSignals.length >= 8) break;
      }
    }

    if (runId) {
      await completeRun({
        runId,
        output: normalised as unknown,
        confidence: "green",
        costUsd,
        durationMs: Date.now() - t0,
        sourcesCount: normalised.sourceSignals.length,
        actorLabel: args.actorLabel,
        targetType: "account",
        targetId: args.accountId as string,
        targetLabel: args.accountName,
      });
    }
    return { runId, output: normalised, costUsd };
  } catch (err) {
    if (runId) {
      await failRun(runId, err, {
        actorLabel: args.actorLabel,
        targetType: "account",
        targetId: args.accountId as string,
      });
    }
    throw err;
  }
}

// ----- Whitespace Mapper -----

export interface WhitespaceOutput {
  offerings: string[];
  personas: string[];
  cells: Array<{
    offering: string;
    persona: string;
    state: "empty" | "identified" | "qualified" | "won";
    note?: string;
    rationale?: string;
  }>;
  priorityMoves: string[];
}


export async function runWhitespaceMapper(args: {
  accountId: string;
  accountName: string;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: WhitespaceOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "whitespace_mapper",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "account",
    targetId: args.accountId,
    targetLabel: args.accountName,
    inputs: {},
    actorLabel: args.actorLabel,
  });
  try {
    await progressRun(runId, 40, "Mapping offerings × personas");
    const { value, costUsd } = await callClaudeJson<WhitespaceOutput>(
      "claude-haiku-4-5",
      "You are Whitespace Mapper. Produce an offerings × personas matrix with grounded rationales.",
      JSON.stringify({ accountName: args.accountName }),
    );
    await completeRun({
      runId,
      output: value as unknown,
      confidence: "amber",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.cells?.length ?? 0,
      actorLabel: args.actorLabel,
      targetType: "account",
      targetId: args.accountId,
      targetLabel: args.accountName,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "account", targetId: args.accountId });
    throw err;
  }
}

// ----- QBR Composer -----

export interface QbrOutput {
  periodLabel: string;
  sections: Array<{ heading: string; body: string }>;
  riskFlags: string[];
  nextMoves: string[];
}


export async function runQbrComposer(args: {
  accountId: string;
  accountName: string;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: QbrOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "qbr_composer",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "account",
    targetId: args.accountId,
    targetLabel: args.accountName,
    inputs: {},
    actorLabel: args.actorLabel,
  });
  try {
    await progressRun(runId, 50, "Composing QBR canvas");
    const { value, costUsd } = await callClaudeJson<QbrOutput>(
      "claude-sonnet-4-5",
      "You are QBR Composer. Produce a quarterly business-review canvas: what changed, where we created value, where we lost ground, what to compound. Honest, evidence-bound.",
      JSON.stringify({ accountName: args.accountName }),
    );
    await completeRun({
      runId,
      output: value as unknown,
      confidence: "amber",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.sections?.length ?? 0,
      actorLabel: args.actorLabel,
      targetType: "account",
      targetId: args.accountId,
      targetLabel: args.accountName,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "account", targetId: args.accountId });
    throw err;
  }
}

// =============================================================
// Pipeline Forecaster (Task #239 / PRD §2.3)
// Deterministic roll-up: weighted pipeline + stalled flags. Mock-first —
// no Claude call. Records an agent_run + audit event, and inserts a
// Pane A "Stalled deal" item per stalled opportunity for the partner_owner.
// =============================================================
export interface PipelineForecastSummary {
  totalCount: number;
  totalDealSumUsd: number;
  weightedPipelineUsd: number;
  stalledCount: number;
  asOf: string;
  buckets: Array<{
    stage: string;
    count: number;
    dealSumUsd: number;
    weightedSumUsd: number;
    avgDaysInStage: number;
  }>;
}

function fid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runPipelineForecaster(args: {
  actorId: string;
  actorLabel: string;
  summary: PipelineForecastSummary;
}): Promise<{ runId: string; flagged: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "ag_pipeline_forecaster",
    triggeredByUserId: args.actorId,
    targetType: "pipeline",
    targetId: "atelier-global",
    targetLabel: "Atelier Pipeline",
    actorLabel: args.actorLabel,
    inputs: { summary: args.summary },
  });
  try {
    await progressRun(runId, 60, "Computing weighted pipeline + flagging stalled deals");

    // Find stalled, in-flight deals owned by this actor and surface them in Pane A.
    const stalledRows = await db
      .select()
      .from(atelierOpportunities)
      .where(
        and(
          isNull(atelierOpportunities.deletedAt),
          eq(atelierOpportunities.partnerOwnerId, args.actorId),
        ),
      );
    const TERMINAL = new Set(["signed", "lost_no_decision", "withdrawn", "won", "lost", "no_go"]);
    let flagged = 0;
    let miscalibrated = 0;
    for (const o of stalledRows) {
      if (TERMINAL.has(o.salesStage) || TERMINAL.has(o.plmStage)) continue;

      // (a) Stalled deals — surface aging in-stage.
      if (o.daysInStage > STALLED_THRESHOLD_DAYS) {
        try {
          await db.insert(atelierPaneAItems).values({
            id: fid("pa"),
            userId: args.actorId,
            title: `Stalled: ${o.name}`,
            summary: `${o.daysInStage}d in ${o.salesStage} — ${o.nextMilestone || "no next milestone set"}.`,
            priority: o.daysInStage > 45 ? "high" : "medium",
            hrefKind: "opportunity",
            hrefTargetId: o.id,
            dueLabel: "Stalled",
            sortKey: 100 - Math.min(99, o.daysInStage),
          });
          flagged += 1;
        } catch {
          // best-effort
        }
      }

      // (b) Probability miscalibration — partner-set probability is far from the
      // stage default. Suggest the calibrated value so the partner can confirm
      // or override (audit captures both).
      const expected = SALES_STAGE_DEFAULT_PROB[o.salesStage as SalesStage] ?? null;
      if (expected !== null) {
        const delta = Math.abs(o.probabilityPct - expected);
        if (delta >= MISCALIBRATION_THRESHOLD_PCT) {
          const direction = o.probabilityPct > expected ? "high" : "low";
          try {
            await db.insert(atelierPaneAItems).values({
              id: fid("pa"),
              userId: args.actorId,
              title: `Probability looks ${direction}: ${o.name}`,
              summary: `Set to ${o.probabilityPct}% in stage ${o.salesStage} — Forecaster suggests ~${expected}%. Review or override with rationale.`,
              priority: "medium",
              hrefKind: "opportunity",
              hrefTargetId: o.id,
              dueLabel: "Calibrate",
              sortKey: 50 - Math.min(49, Math.round(delta / 2)),
            });
            miscalibrated += 1;
          } catch {
            // best-effort
          }
        }
      }
    }

    await completeRun({
      runId,
      output: { ...args.summary, flagged, miscalibrated } as unknown,
      confidence: "green",
      costUsd: 0,
      durationMs: Date.now() - t0,
      sourcesCount: args.summary.buckets.length,
      actorLabel: args.actorLabel,
      targetType: "pipeline",
      targetId: "atelier-global",
      targetLabel: "Atelier Pipeline",
    });
    return { runId, flagged };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: "pipeline",
      targetId: "atelier-global",
    });
    throw err;
  }
}

// =============================================================
// Pricing Strategist (★) — Task #240.
// Sonnet 4.6 narrative only. Deterministic SQL/server math for numbers.
// =============================================================

export interface PricingStrategistResult {
  runId: string;
  primary: {
    pricingModel: string;
    durationWeeks: number;
    teamMix: PricingTeamMixEntry[];
    cost: number;
    price: number;
    marginPct: number;
    marginLockStatus: "green" | "amber" | "red";
    narrative: string;
  };
  alternatives: Array<{
    pricingModel: string;
    durationWeeks: number;
    teamMix: PricingTeamMixEntry[];
    cost: number;
    price: number;
    marginPct: number;
    marginLockStatus: "green" | "amber" | "red";
    story: string;
  }>;
  talkingPoints: string[];
  risks: string[];
  marginLockChip: "green" | "amber" | "red";
  partnerOverrideRequired: boolean;
  twoPartnerRequired: boolean;
  confidence: "green" | "amber" | "red";
  }

export async function runPricingStrategist(args: {
  opportunity: typeof atelierOpportunities.$inferSelect;
  pricing: { id: string; teamMix: unknown; durationWeeks: number; pricingModel: string; rateCardId: string };
  policy: PricingMarginPolicy;
  rateCardRows: PricingRateCardRowLite[];
  actorId: string;
  actorLabel: string;
  /** Optional spec-contract hint forwarded to the LLM narrative prompt. */
  primaryIntent?: string;
  /** Optional spec-contract hint — restricts which alternative lenses to surface. */
  alternativeLenses?: string[];
}): Promise<PricingStrategistResult> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "ag_pricing_strategist",
    triggeredByUserId: args.actorId,
    targetType: "opportunity",
    targetId: args.opportunity.id,
    targetLabel: args.opportunity.name,
    actorLabel: args.actorLabel,
    inputs: {
      pricingModel: args.pricing.pricingModel,
      durationWeeks: args.pricing.durationWeeks,
      teamMixSize: Array.isArray(args.pricing.teamMix) ? args.pricing.teamMix.length : 0,
      targetMarginPct: args.policy.targetMarginPct,
    },
  });

  try {
    await progressRun(runId, 15, "Loading rate card + comparable closed deals");

    // Tool-contract evidence (Task #240): qualitative grounding only.
    // Numeric math stays deterministic in computePricing(). These tools
    // attach references the Partner can audit alongside the brief.
    const { knowledgeSearch, pricingRulesLookup, rateCardRead } = await import(
      "./pricing-strategist-tools.js"
    );
    const knowledgeHits = knowledgeSearch(args.opportunity.name);
    const rateCardEvidence = await rateCardRead(args.pricing.rateCardId);

    await progressRun(runId, 25, "Applying pricing rules + computing primary structure");

    const teamMix = (Array.isArray(args.pricing.teamMix) ? args.pricing.teamMix : []) as PricingTeamMixEntry[];
    const primaryCompute = computePricingFn({
      teamMix,
      durationWeeks: args.pricing.durationWeeks,
      rateCardRows: args.rateCardRows,
      policy: args.policy,
    });

    await progressRun(runId, 55, "Building alternative pricing structures");

    // Deterministic alternatives — math always server-side.
    // The full catalog of supported alternative lenses; the strategist
    // input contract `alternative_lenses?` filters this list, and the
    // empty/undefined case keeps backwards behaviour (all three).
    const fullAltSpecs: Array<{ model: string; weeks: number; mix: PricingTeamMixEntry[]; story: string }> = [
      {
        // Lens: scope discipline / fixed_fee
        model: "fixed_fee",
        weeks: Math.max(2, Math.round(args.pricing.durationWeeks * 0.85)),
        mix: teamMix,
        story:
          "Fixed-fee at a tighter scope. Buyer gets predictability; we keep margin by ring-fencing scope creep. Recommended when procurement leads the buying committee.",
      },
      {
        // Lens: pricing model / outcome_based
        model: "outcome_based",
        weeks: args.pricing.durationWeeks,
        mix: rebalanceSenior(teamMix),
        story:
          "Outcome-based pricing tied to a measurable client KPI. Senior-heavy blend signals confidence in the result and justifies a price premium. Use when the client has internal sponsorship and a clear KPI.",
      },
      {
        // Lens: cash flow / retainer
        model: "retainer",
        weeks: Math.max(args.pricing.durationWeeks, 12),
        mix: rebalanceJunior(teamMix),
        story:
          "Quarterly retainer with a senior-led core and leveraged delivery. Smooths cash flow, preserves margin via blended rate, and opens the account for follow-on work.",
      },
    ];

    const requestedLenses = (args.alternativeLenses ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
    const altSpecs = requestedLenses.length
      ? fullAltSpecs.filter((s) => requestedLenses.includes(s.model.toLowerCase()))
      : fullAltSpecs;

    const alternatives = (altSpecs.length ? altSpecs : fullAltSpecs).map((spec) => {
      const c = computePricingFn({
        teamMix: spec.mix,
        durationWeeks: spec.weeks,
        rateCardRows: args.rateCardRows,
        policy: args.policy,
      });
      return {
        pricingModel: spec.model,
        durationWeeks: spec.weeks,
        teamMix: spec.mix,
        cost: c.computedCostUsd,
        price: c.computedPriceUsd,
        marginPct: c.computedMarginPct,
        marginLockStatus: c.marginLockStatus,
        story: spec.story,
      };
    });

    const pricingRules = pricingRulesLookup({
      pricingModel: args.pricing.pricingModel,
      marginPct: primaryCompute.computedMarginPct,
      status: primaryCompute.marginLockStatus,
    });

    await progressRun(runId, 80, "Drafting Partner narrative (Sonnet)");

    // Deterministic talking-points / risks stay as the mock baseline so the
    // brief is meaningful when offline. The LLM augments narrative + adds
    // qualitative talking points around the deterministic numbers.
    const fallbackTalkingPoints = buildTalkingPoints({
      oppName: args.opportunity.name,
      primaryMargin: primaryCompute.computedMarginPct,
      targetMargin: args.policy.targetMarginPct,
      status: primaryCompute.marginLockStatus,
      alternatives,
    });
    const fallbackRisks = buildRisks(primaryCompute.marginLockStatus, args.policy);
    const intentSuffix = args.primaryIntent
      ? ` Intent: ${args.primaryIntent}.`
      : "";
    const lensSuffix = args.alternativeLenses && args.alternativeLenses.length
      ? ` Alternatives constrained to: ${args.alternativeLenses.join(", ")}.`
      : "";
    const fallbackNarrative =
      (primaryCompute.marginLockStatus === "green"
        ? `Primary structure clears the ${(args.policy.targetMarginPct * 100).toFixed(0)}% target with room. Lead with this; alternatives are negotiation levers, not fallbacks.`
        : `Primary structure lands at ${(primaryCompute.computedMarginPct * 100).toFixed(1)}% — below the ${(args.policy.targetMarginPct * 100).toFixed(0)}% target. Alternatives below recover margin via scope, model, or blend.`)
      + intentSuffix
      + lensSuffix;

    interface NarrativeJson {
      narrative: string;
      talkingPoints: string[];
      risks: string[];
    }
    let systemPrompt: string;
    try {
      systemPrompt = loadPrompt("pricing_strategist" as AtelierAgentId);
    } catch {
      systemPrompt =
        "You are Cognirise's Pricing Strategist. Numbers are precomputed and authoritative — never invent or alter them. Author the Partner-facing narrative.";
    }
    const userPrompt = JSON.stringify({
      opportunity: { id: args.opportunity.id, name: args.opportunity.name, accountId: args.opportunity.accountId },
      policy: args.policy,
      // Spec-contract hints supplied by the caller. The narrative MUST
      // reflect `primaryIntent` (e.g. "land_and_expand", "defend_margin")
      // and stay within the requested `alternativeLenses` catalog.
      strategistInput: {
        primaryIntent: args.primaryIntent ?? null,
        alternativeLenses: args.alternativeLenses ?? null,
      },
      primary: {
        pricingModel: args.pricing.pricingModel,
        durationWeeks: args.pricing.durationWeeks,
        teamMix,
        cost: primaryCompute.computedCostUsd,
        price: primaryCompute.computedPriceUsd,
        marginPct: primaryCompute.computedMarginPct,
        marginLockStatus: primaryCompute.marginLockStatus,
      },
      alternatives,
      // Tool-contract evidence — the LLM weaves these into prose, never
      // re-derives numbers from them.
      tools: {
        knowledgeHits,
        pricingRules,
        rateCard: rateCardEvidence ? { id: rateCardEvidence.cardId, name: rateCardEvidence.name } : null,
      },
      askFor: {
        narrative: "1-2 paragraph Partner-facing recommendation",
        talkingPoints: "3-5 short bullets a Partner can repeat verbatim",
        risks: "2-4 short risk bullets",
      },
    });
    const llm = await callClaudeJson<NarrativeJson>(
      "claude-sonnet-4-5",
      systemPrompt,
      userPrompt,
    );

    const result: PricingStrategistResult = {
      runId,
      primary: {
        pricingModel: args.pricing.pricingModel,
        durationWeeks: args.pricing.durationWeeks,
        teamMix,
        cost: primaryCompute.computedCostUsd,
        price: primaryCompute.computedPriceUsd,
        marginPct: primaryCompute.computedMarginPct,
        marginLockStatus: primaryCompute.marginLockStatus,
        narrative: llm.value.narrative ?? fallbackNarrative,
      },
      alternatives,
      talkingPoints: Array.isArray(llm.value.talkingPoints) && llm.value.talkingPoints.length
        ? llm.value.talkingPoints
        : fallbackTalkingPoints,
      risks: Array.isArray(llm.value.risks) && llm.value.risks.length ? llm.value.risks : fallbackRisks,
      marginLockChip: primaryCompute.marginLockStatus,
      partnerOverrideRequired: primaryCompute.marginLockStatus !== "green",
      twoPartnerRequired: primaryCompute.computedMarginPct < args.policy.twoPartnerThresholdPct,
      confidence: primaryCompute.marginLockStatus === "red" ? "amber" : "green",
    };

    // Persist brief link onto the deal pricing row so downstream callers
    // (Commercials tab, audit, send-gate) can trace which strategist run
    // informed the saved pricing.
    try {
      await db
        .update(atelierDealPricings)
        .set({
          pricingStrategistRunId: runId,
          pricingStrategistBriefId: runId,
          pricingStrategistOutput: result as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(atelierDealPricings.id, args.pricing.id));
    } catch (e) {
      // Non-fatal — brief is still returned; we don't roll back the run.
      // eslint-disable-next-line no-console
      console.warn("[pricing-strategist] failed to persist brief link:", e);
    }

    await completeRun({
      runId,
      output: result as unknown,
      confidence: result.confidence,
      costUsd: llm.costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: alternatives.length,
      actorLabel: args.actorLabel,
      targetType: "opportunity",
      targetId: args.opportunity.id,
      targetLabel: args.opportunity.name,
    });

    return result;
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: "opportunity",
      targetId: args.opportunity.id,
    });
    throw err;
  }
}

function rebalanceSenior(mix: PricingTeamMixEntry[]): PricingTeamMixEntry[] {
  if (mix.length === 0) return mix;
  return mix.map((m) => {
    if (m.seniority === "Partner" || m.seniority === "Principal") {
      return { ...m, ftePct: Math.min(1, m.ftePct * 1.25) };
    }
    if (m.seniority === "Analyst" || m.seniority === "Designer") {
      return { ...m, ftePct: m.ftePct * 0.7 };
    }
    return m;
  });
}

function rebalanceJunior(mix: PricingTeamMixEntry[]): PricingTeamMixEntry[] {
  if (mix.length === 0) return mix;
  return mix.map((m) => {
    if (m.seniority === "Analyst" || m.seniority === "AIEngineer") {
      return { ...m, ftePct: Math.min(1, m.ftePct * 1.4) };
    }
    if (m.seniority === "Partner") {
      return { ...m, ftePct: m.ftePct * 0.6 };
    }
    return m;
  });
}

function buildTalkingPoints(args: {
  oppName: string;
  primaryMargin: number;
  targetMargin: number;
  status: "green" | "amber" | "red";
  alternatives: Array<{ pricingModel: string; marginPct: number }>;
}): string[] {
  const points: string[] = [];
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  if (args.status === "green") {
    points.push(`${args.oppName}: primary structure prices at ${pct(args.primaryMargin)} margin — above target.`);
  } else if (args.status === "amber") {
    points.push(`${args.oppName}: primary structure at ${pct(args.primaryMargin)} — AMBER. Single-Partner sign-off required to send.`);
  } else {
    points.push(`${args.oppName}: primary structure at ${pct(args.primaryMargin)} — RED. Two-Partner countersign required.`);
  }
  const bestAlt = [...args.alternatives].sort((a, b) => b.marginPct - a.marginPct)[0];
  if (bestAlt) {
    points.push(`Best alternative: ${bestAlt.pricingModel.replace(/_/g, " ")} at ${pct(bestAlt.marginPct)}.`);
  }
  points.push(`Lead the room with the value story; price is the trailing edge of the conversation.`);
  return points;
}

function buildRisks(status: "green" | "amber" | "red", policy: PricingMarginPolicy): string[] {
  if (status === "green") {
    return ["Scope creep is the silent margin killer — lock SOW lines on signature."];
  }
  if (status === "amber") {
    return [
      `Margin sits ${(((policy.targetMarginPct - policy.amberThresholdPct) * 100)).toFixed(0)} pts under target. Discount precedent compounds across renewals.`,
      "Partner override is a one-shot signal, not a habit.",
    ];
  }
  return [
    "RED-zone discount erodes firm benchmark. Document the strategic rationale (logo, IP, market entry).",
    "Two-Partner sign-off is non-negotiable to protect the precedent.",
  ];
}

// =============================================================
// WIN/LOSS INTERVIEWER (Sonnet 4.6) — Task #241
// =============================================================
//
// The deal owner is the wrong person to ask the buyer (research is
// unanimous). This agent stands in for the impartial third-party
// interviewer: it ingests the buyer transcript (async upload only in
// v2 — no live meeting), distinguishes seller-perceived from
// buyer-authentic reasons, names the hidden competitor (status_quo,
// inhouse, partner_firm, direct, unknown), and binds every theme to a
// verbatim quote.

export interface WinLossInterviewerOutput {
  buyerAuthenticReasons: string[];
  hiddenCompetitor: "direct" | "partner_firm" | "status_quo" | "inhouse" | "unknown";
  themes: Array<{
    name: string;
    tag: string;
    evidenceQuote: string;
    polarity: "win" | "loss";
  }>;
  whatWeWouldDoDifferently: string;
  suggestedAtelierLessons: Array<{
    title: string;
    abstract: string;
    kind: "learning" | "framework" | "case_study";
  }>;
  confidence: "green" | "amber" | "red";
}


export async function runWinLossInterviewer(args: {
  opportunityId: string;
  opportunityName: string;
  outcome: string;
  sellerPerceivedReasons: string[];
  buyerTranscript: string | null;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; output: WinLossInterviewerOutput; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_win_loss_interviewer",
      input: {
        opportunityId: args.opportunityId,
        opportunityName: args.opportunityName,
        outcome: args.outcome as "won" | "lost" | "no_decision" | "withdrawn",
        sellerPerceivedReasons: args.sellerPerceivedReasons,
        buyerTranscript: args.buyerTranscript ?? "",
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("win_loss_interviewer");
      await ctx.progress(30, "Reading buyer transcript");
      const { value, costUsd } = await callClaudeJson<WinLossInterviewerOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          opportunity_name: args.opportunityName,
          outcome: args.outcome,
          seller_perceived_reasons: args.sellerPerceivedReasons,
          buyer_transcript: args.buyerTranscript ?? "",
        }),
      );
      await ctx.progress(80, "Binding themes to evidence");
      // Evidence-binding hard rule: drop any theme without a non-empty
      // evidenceQuote. Downgrade confidence if we drop ≥1.
      const beforeCount = value.themes.length;
      value.themes = value.themes.filter((t) => (t.evidenceQuote ?? "").trim().length > 0);
      const droppedAny = value.themes.length < beforeCount;
      const conf: "green" | "amber" | "red" = droppedAny
        ? value.confidence === "green"
          ? "amber"
          : "red"
        : value.confidence;
      return {
        output: value,
        costUsd,
        confidence: conf,
        sourcesCount: value.themes.length,
      };
    },
  );
  return { runId: result.runId, output: result.output as WinLossInterviewerOutput, costUsd: result.costUsd };
}

// =============================================================
// THEME CURATOR — Task #241
// =============================================================

export interface ThemeCuratorOutput {
  upsertThemes: Array<{
    tag: string;
    name: string;
    description: string;
    polarity: "win" | "loss";
    contributingDebriefIds: string[];
    offeringTags: string[];
    sectorTags: string[];
    positioningLine: string;
  }>;
  emergentThemes: Array<{ tag: string; name: string; supportingQuotes: string[] }>;
  openProposalSuggestions: Array<{
    opportunityId: string;
    themeTag: string;
    rationale: string;
  }>;
  confidence: "green" | "amber" | "red";
}


export async function runThemeCurator(args: {
  triggeredByUserId: string | null;
  actorLabel: string;
  debriefThemes: Array<{ tag: string; name: string; polarity: string; debriefId: string; quote: string }>;
  openOpportunityIds: string[];
}): Promise<{ runId: string; output: ThemeCuratorOutput; costUsd: number }> {
  const result = await runAgent(
    {
      agentId: "ag_theme_curator",
      input: { debriefThemes: args.debriefThemes, openOpportunityIds: args.openOpportunityIds },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "atelier",
      targetId: "win_themes",
      targetLabel: "Win Themes library",
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt("theme_curator");
      await ctx.progress(40, "Clustering themes");
      const { value, costUsd } = await callClaudeJson<ThemeCuratorOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          debrief_themes: args.debriefThemes,
          open_opportunity_ids: args.openOpportunityIds,
        }),
      );
      await ctx.progress(85, "Refreshing library");
      return {
        output: value,
        costUsd,
        confidence: value.confidence,
        sourcesCount: value.upsertThemes.length,
      };
    },
  );
  return { runId: result.runId, output: result.output as ThemeCuratorOutput, costUsd: result.costUsd };
}

// ============================================================
// THE SALON (Task #242) — 4 ★ client-realm agents
// ============================================================
//
// All four follow the same startRun → progressRun → completeRun → audit
// pattern so the Agents tab and audit feed work.

import {
  atelierDeliverablePublishes,
  atelierDeliverables,
  atelierEngagements,
  atelierSalonNotifications,
  atelierSalonUserEngagementAccess,
  atelierSalonUsers,
  atelierSalonAuditEvents,
} from "@workspace/db";

// ---------- Publish Sentinel ----------

export interface PublishSentinelCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  spans?: Array<{ pattern: string; sample: string }>;
}
export interface PublishSentinelOutput {
  publishAllowed: boolean;
  status: "pass" | "warn" | "fail";
  checks: PublishSentinelCheck[];
  redactionProposal: string | null;
  confidence: "green" | "amber" | "red";
}

// Forbidden patterns: Saudi national ID (10-digit starting 1 or 2),
// Iqama (10-digit starting 2), email + password leak, internal-only marker.
const SENTINEL_PATTERNS: Array<{
  name: string;
  re: RegExp;
  detail: string;
}> = [
  {
    name: "saudi_national_id",
    re: /\b[12]\d{9}\b/g,
    detail: "Saudi National ID / Iqama (10 digits)",
  },
  {
    name: "internal_only_marker",
    re: /\bINTERNAL[ _-]ONLY\b/gi,
    detail: "Document carries an INTERNAL-ONLY classification marker",
  },
  {
    name: "credit_card_pan",
    re: /\b(?:\d[ -]?){13,19}\b/g,
    detail: "Possible payment card PAN",
  },
  {
    name: "iban",
    re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    detail: "IBAN account number",
  },
];

export function scanForDlp(text: string): PublishSentinelCheck[] {
  const checks: PublishSentinelCheck[] = [];
  for (const p of SENTINEL_PATTERNS) {
    const matches = Array.from(text.matchAll(p.re)).slice(0, 5);
    if (matches.length === 0) {
      checks.push({ name: p.name, status: "pass", detail: `No ${p.detail} found` });
    } else {
      checks.push({
        name: p.name,
        status:
          p.name === "credit_card_pan" ||
          p.name === "iban" ||
          p.name === "internal_only_marker"
            ? "warn"
            : "fail",
        detail: `${matches.length} match(es): ${p.detail}`,
        spans: matches.map((m) => ({
          pattern: p.name,
          sample: m[0].slice(0, 64),
        })),
      });
    }
  }
  return checks;
}

interface RunPublishSentinelArgs {
  triggeredByUserId: string | null;
  actorLabel: string;
  deliverableId: string;
  deliverableLabel: string;
  body: string;
  // Task #260 — sentinel can run against deliverables (default) or
  // wallet expenses. When kind="expense", callers pre-compute the
  // expense-specific checks (markup band, category, receipt, etc.) and
  // pass them via `precomputedChecks`; the runner then bypasses the DLP
  // scan and uses those checks as the authoritative result. This keeps
  // the v2 deliverable flow untouched while extending the same agent
  // surface to the new kind.
  kind?: "deliverable" | "expense";
  precomputedChecks?: PublishSentinelCheck[];
}
export async function runPublishSentinel(
  args: RunPublishSentinelArgs,
): Promise<{ runId: string; output: PublishSentinelOutput; costUsd: number }> {
  const t0 = Date.now();
  const kind = args.kind ?? "deliverable";
  const targetType = kind === "expense" ? "expense" : "deliverable";
  const runId = await startRun({
    agentId: "ag_publish_sentinel",
    triggeredByUserId: args.triggeredByUserId,
    targetType,
    targetId: args.deliverableId,
    targetLabel: args.deliverableLabel,
    inputs: { bytes: args.body.length, kind },
    actorLabel: args.actorLabel,
  });
  try {
    await progressRun(runId, 40, kind === "expense" ? "Running expense policy checks" : "Scanning for DLP patterns");
    const checks = args.precomputedChecks ?? scanForDlp(args.body);
    const failed = checks.some((c) => c.status === "fail");
    const warned = checks.some((c) => c.status === "warn");
    const status: "pass" | "warn" | "fail" = failed ? "fail" : warned ? "warn" : "pass";
    const out: PublishSentinelOutput = {
      publishAllowed: !failed,
      status,
      checks,
      redactionProposal: failed
        ? "Auto-redact matched spans before re-publish, or invoke Partner override with rationale."
        : null,
      confidence: failed ? "red" : warned ? "amber" : "green",
    };
    await progressRun(runId, 90, status === "pass" ? "Clean" : `Found ${checks.filter((c) => c.status !== "pass").length} issue(s)`);
    await completeRun({
      runId,
      output: out as unknown,
      confidence: out.confidence,
      costUsd: 0,
      durationMs: Date.now() - t0,
      sourcesCount: checks.length,
      actorLabel: args.actorLabel,
      targetType,
      targetId: args.deliverableId,
      targetLabel: args.deliverableLabel,
    });
    return { runId, output: out, costUsd: 0 };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType,
      targetId: args.deliverableId,
    });
    throw err;
  }
}

// ---------- Salon Concierge (invitation batch) ----------

export interface SalonConciergeOutput {
  invited: Array<{ email: string; status: "queued" | "skipped"; reason?: string }>;
  message: string;
  confidence: "green" | "amber" | "red";
}

interface RunSalonConciergeArgs {
  triggeredByUserId: string | null;
  actorLabel: string;
  workspaceId: string;
  workspaceLabel: string;
  invitees: Array<{ email: string; name: string; role: "admin" | "approver" | "viewer" }>;
}
export async function runSalonConcierge(
  args: RunSalonConciergeArgs,
): Promise<{ runId: string; output: SalonConciergeOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "ag_salon_concierge",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "salon_workspace",
    targetId: args.workspaceId,
    targetLabel: args.workspaceLabel,
    inputs: { count: args.invitees.length },
    actorLabel: args.actorLabel,
  });
  try {
    await progressRun(runId, 50, `Drafting ${args.invitees.length} invitations`);
    const invited = args.invitees.map((i) =>
      /@/.test(i.email)
        ? { email: i.email, status: "queued" as const }
        : { email: i.email, status: "skipped" as const, reason: "invalid email" },
    );
    const out: SalonConciergeOutput = {
      invited,
      message: `Queued ${invited.filter((x) => x.status === "queued").length} invitations (mock IdP).`,
      confidence: "green",
    };
    await completeRun({
      runId,
      output: out as unknown,
      confidence: out.confidence,
      costUsd: 0,
      durationMs: Date.now() - t0,
      sourcesCount: invited.length,
      actorLabel: args.actorLabel,
      targetType: "salon_workspace",
      targetId: args.workspaceId,
      targetLabel: args.workspaceLabel,
    });
    return { runId, output: out, costUsd: 0 };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: "salon_workspace",
      targetId: args.workspaceId,
    });
    throw err;
  }
}

// ---------- Engagement Curator (weekly client digest) ----------

export interface EngagementCuratorOutput {
  weekOf: string;
  highlights: string[];
  upcoming: string[];
  decisionsLogged: number;
  openRequests: number;
  message: string;
  confidence: "green" | "amber" | "red";
  // Task #243 — bilingual variant flag derived from atelier_engagements.default_language.
  languageVariant?: "en" | "ar";
}
interface RunEngagementCuratorArgs {
  triggeredByUserId: string | null;
  actorLabel: string;
  engagementId: string;
  engagementLabel: string;
  decisionsLogged: number;
  openRequests: number;
  highlights: string[];
  upcoming: string[];
}
export async function runEngagementCurator(
  args: RunEngagementCuratorArgs,
): Promise<{ runId: string; output: EngagementCuratorOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "ag_engagement_curator",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "engagement",
    targetId: args.engagementId,
    targetLabel: args.engagementLabel,
    inputs: { decisionsLogged: args.decisionsLogged, openRequests: args.openRequests },
    actorLabel: args.actorLabel,
  });
  try {
    await progressRun(runId, 60, "Composing weekly digest");
    // Task #243 — bilingual variant. Read the engagement's defaultLanguage
    // ('en' by default); when 'ar', emit an AR variant flag in the run
    // output envelope so downstream rendering can route to the Arabic
    // weekly digest template + RTL chrome. Errors propagate so callers see
    // genuine DB failures instead of silently degrading to English.
    const [engRow] = await db
      .select({ lang: atelierEngagements.defaultLanguage })
      .from(atelierEngagements)
      .where(eq(atelierEngagements.id, args.engagementId));
    const languageVariant: "en" | "ar" = engRow?.lang === "ar" ? "ar" : "en";
    const out: EngagementCuratorOutput = {
      weekOf: new Date().toISOString().slice(0, 10),
      highlights: args.highlights,
      upcoming: args.upcoming,
      decisionsLogged: args.decisionsLogged,
      openRequests: args.openRequests,
      message:
        languageVariant === "ar"
          ? `[AR] الموجز الأسبوعي جاهز للمراجعة — ${args.engagementLabel}`
          : `Weekly digest queued for ${args.engagementLabel}.`,
      confidence: "green",
      languageVariant,
    };
    await completeRun({
      runId,
      output: out as unknown,
      confidence: out.confidence,
      costUsd: 0,
      durationMs: Date.now() - t0,
      sourcesCount: args.highlights.length + args.upcoming.length,
      actorLabel: args.actorLabel,
      targetType: "engagement",
      targetId: args.engagementId,
      targetLabel: args.engagementLabel,
    });
    return { runId, output: out, costUsd: 0 };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: "engagement",
      targetId: args.engagementId,
    });
    throw err;
  }
}

// ---------- Approval Choreographer ----------

export interface ApprovalChoreographerOutput {
  state: "awaiting_approver" | "approved" | "blocked";
  nextActor: { kind: "salon_user"; id: string; name: string } | null;
  reason: string;
  confidence: "green" | "amber" | "red";
}
interface RunApprovalChoreographerArgs {
  triggeredByUserId: string | null;
  actorLabel: string;
  deliverableId: string;
  deliverableLabel: string;
  publishId: string;
  approvers: Array<{ id: string; name: string; canApprove: boolean }>;
  decisionsRecorded: Array<{ decidedBySalonUserId: string; kind: string }>;
}
export async function runApprovalChoreographer(
  args: RunApprovalChoreographerArgs,
): Promise<{ runId: string; output: ApprovalChoreographerOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "ag_approval_choreographer",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "deliverable",
    targetId: args.deliverableId,
    targetLabel: args.deliverableLabel,
    inputs: { publishId: args.publishId },
    actorLabel: args.actorLabel,
  });
  try {
    await progressRun(runId, 50, "Evaluating approval chain");
    const approverIds = new Set(args.approvers.filter((a) => a.canApprove).map((a) => a.id));
    const approved = args.decisionsRecorded.find(
      (d) => d.kind === "approve" && approverIds.has(d.decidedBySalonUserId),
    );
    const blocked = args.decisionsRecorded.find((d) => d.kind === "request_change");
    const next = !approved && !blocked
      ? args.approvers.find((a) => a.canApprove) ?? null
      : null;
    const out: ApprovalChoreographerOutput = approved
      ? {
          state: "approved",
          nextActor: null,
          reason: "Approver decision recorded — chain complete.",
          confidence: "green",
        }
      : blocked
      ? {
          state: "blocked",
          nextActor: null,
          reason: "Change requested — re-publish required before re-evaluation.",
          confidence: "amber",
        }
      : {
          state: "awaiting_approver",
          nextActor: next ? { kind: "salon_user", id: next.id, name: next.name } : null,
          reason: next ? `Awaiting decision from ${next.name}.` : "No designated approver on this engagement.",
          confidence: next ? "green" : "amber",
        };
    await completeRun({
      runId,
      output: out as unknown,
      confidence: out.confidence,
      costUsd: 0,
      durationMs: Date.now() - t0,
      sourcesCount: args.decisionsRecorded.length,
      actorLabel: args.actorLabel,
      targetType: "deliverable",
      targetId: args.deliverableId,
      targetLabel: args.deliverableLabel,
    });
    return { runId, output: out, costUsd: 0 };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: "deliverable",
      targetId: args.deliverableId,
    });
    throw err;
  }
}

// Helper used by salonRoutes.ts after publish succeeds — fans out an
// in-app notification to every salon user with access to the engagement.
export async function fanoutSalonNotification(input: {
  engagementId: string;
  kind: string;
  headline: string;
  body?: string;
  href?: string;
}): Promise<number> {
  const access = await db
    .select()
    .from(atelierSalonUserEngagementAccess)
    .where(
      and(
        eq(atelierSalonUserEngagementAccess.engagementId, input.engagementId),
        isNull(atelierSalonUserEngagementAccess.revokedAt),
      ),
    );
  if (access.length === 0) return 0;
  const rows = access.map((a) => ({
    id: rid("snf"),
    salonUserId: a.salonUserId,
    engagementId: input.engagementId,
    kind: input.kind,
    headline: input.headline,
    body: input.body ?? null,
    href: input.href ?? null,
  }));
  await db.insert(atelierSalonNotifications).values(rows);
  return rows.length;
}

// =============================================================
// Task #254 — Access Sentinel agent runner
// -------------------------------------------------------------
// PRD §1 + Task §4: Sentinel is the chokepoint for every grant/revoke on
// atelier_engagement_access. The synchronous validation + audit happens in
// `runAccessSentinel` inside `routes/atelier/rosterRoutes.ts`. This file
// exposes the *event-driven* hooks that downstream tasks (engagement-close
// in #257, conflict change in #255, access-request UX in #258) call into to
// emit Sentinel proposals as side-effects of those events.
// =============================================================

export type SentinelEvent =
  | { kind: "engagement_closed"; engagementId: string; closedByUserId: string }
  | { kind: "conflict_changed"; personType: "employee" | "contractor" | "partner_firm_resource"; personId: string }
  | { kind: "access_requested"; personId: string; engagementId: string; requestedScope: string[]; requestedByUserId: string };

/**
 * Single dispatch surface every server route can call when an event happens
 * that may require a Sentinel-mediated access change. The implementation is a
 * v3-foundation stub — it logs the proposal and writes an audit row so the
 * downstream UX (Pane A items, Roster Audit feed) can already light up. The
 * real proposal emission lands with the Onboarding/Offboarding task (#257)
 * which will materialize `atelier_pane_a_items` rows; for now we keep the
 * call sites stable so #257 is a one-file change.
 */
export async function emitAccessSentinelEvent(ev: SentinelEvent): Promise<void> {
  // Lazy import to avoid circular dep with rosterRoutes.
  const mod = await import("../../routes/atelier/rosterRoutes");
  if (ev.kind === "engagement_closed") {
    const { revokeNonEmployeeAccessOnEngagementClose } = mod;
    const result = await revokeNonEmployeeAccessOnEngagementClose({
      engagementId: ev.engagementId,
      closedByUserId: ev.closedByUserId,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[access-sentinel] engagement_closed engagementId=${ev.engagementId} revokedCount=${result.revokedCount}`,
    );
    return;
  }
  // conflict_changed + access_requested are stubs in this task; #255 + #258
  // wire them to materialize Pane A proposals. For now we log so the call
  // sites land in #254 already and downstream tasks are drop-in changes.
  // eslint-disable-next-line no-console
  console.log("[access-sentinel] (stub)", ev);
}

// =============================================================
// Time Steward (Task #257) — v3 Ledger
// =============================================================
// Pulls calendar events + meeting attendance + deliverable edits + Salon
// decisions from the past week and proposes draft timesheet entries plus
// immutable signal evidence. Never auto-submits. Routes wrap this in
// startRun/completeRun so it shows up in the activity stream.
import {
  atelierCalendarEvents,
  atelierMeetings,
  atelierDeliverableVersions,
  atelierSalonDecisions,
  atelierTimesheetEntries,
  atelierTimesheetSignals,
  atelierTimesheetWeeks,
  atelierEmployees,
} from "@workspace/db";
import { sql } from "drizzle-orm";

export interface TimeStewardOutput {
  weekId: string;
  personId: string;
  signalsCreated: number;
  draftEntriesCreated: number;
  totalHoursDrafted: number;
}

export async function runTimeSteward(args: {
  weekId: string;
  personId: string;
  weekStartDate: string; // ISO date (Mon)
  triggeredByUserId: string | null;
}): Promise<TimeStewardOutput> {
  const runId = await startRun({
    agentId: "ag_time_steward",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "timesheet_week",
    targetId: args.weekId,
    targetLabel: `Timesheet ${args.weekId.slice(-12)}`,
    inputs: { personId: args.personId, weekStart: args.weekStartDate },
    actorLabel: "Time Steward",
  });

  const t0 = Date.now();
  try {
    const weekStart = new Date(`${args.weekStartDate}T00:00:00Z`);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400 * 1000);
    // Pre-load engagement-id↦accountId map so signals carry the hint
    // even when the calendar event itself doesn't carry the engagement.

    // 1) Calendar — every event in the window for this person.
    const cals = await db
      .select()
      .from(atelierCalendarEvents)
      .where(
        and(
          eq(atelierCalendarEvents.personId, args.personId),
          gte(atelierCalendarEvents.startsAt, weekStart),
          isNull(atelierCalendarEvents.deletedAt),
        ),
      );
    const calsInWeek = cals.filter((c) => c.startsAt < weekEnd);

    // 2) Meetings — atelier_meetings whose attendees JSONB contains this
    //    person's id or email. Fallback: parentType='engagement' anchor.
    const empRow = (
      await db
        .select()
        .from(atelierEmployees)
        .where(eq(atelierEmployees.id, args.personId))
    )[0];
    const personEmail = empRow?.email?.toLowerCase() ?? null;
    const personName = empRow?.fullName ?? null;
    const meetings = await db
      .select()
      .from(atelierMeetings)
      .where(isNull(atelierMeetings.deletedAt));
    const meetingsHit = meetings.filter((m) => {
      if (!m.date) return false;
      const d = new Date(`${m.date}T00:00:00Z`);
      if (d < weekStart || d >= weekEnd) return false;
      const att = (m.attendees as Array<{ email?: string; name?: string }>) ?? [];
      return att.some(
        (a) =>
          (personEmail && a.email?.toLowerCase() === personEmail) ||
          (personName && a.name && a.name.toLowerCase().includes(personName.toLowerCase())),
      );
    });

    // 3) Deliverable edits — versions authored this week by user_id matching
    //    the employee's user_id (employees may have userId; contractors don't).
    const userId = empRow?.userId ?? null;
    const deliverableEdits = userId
      ? await db
          .select({
            id: atelierDeliverableVersions.id,
            deliverableId: atelierDeliverableVersions.deliverableId,
            createdAt: atelierDeliverableVersions.createdAt,
            versionNumber: atelierDeliverableVersions.versionNumber,
          })
          .from(atelierDeliverableVersions)
          .where(
            and(
              eq(atelierDeliverableVersions.createdByUserId, userId),
              gte(atelierDeliverableVersions.createdAt, weekStart),
              isNull(atelierDeliverableVersions.deletedAt),
            ),
          )
      : [];
    const editsInWeek = deliverableEdits.filter((d) => d.createdAt < weekEnd);

    // 4) Salon decisions — client-side decisions on engagements where THIS
    //    employee is the engagement lead or partner owner (proxy for "you
    //    were on the call / you authored the deliverable being decided").
    //    Filtering by ownership avoids the prior over-attribution where
    //    every employee got credited for every salon decision firm-wide.
    const ownedEngs = userId
      ? await db
          .select({ id: atelierEngagements.id })
          .from(atelierEngagements)
          .where(
            and(
              isNull(atelierEngagements.deletedAt),
              sql`(${atelierEngagements.engagementLeadId} = ${userId} OR ${atelierEngagements.partnerOwnerId} = ${userId})`,
            ),
          )
      : [];
    const ownedEngIds = new Set(ownedEngs.map((e) => e.id));
    const salonHits: Array<{ id: string; engagementId: string; kind: string; headline: string; decidedAt: Date }> = [];
    if (ownedEngIds.size) {
      const salonRows = await db
        .select()
        .from(atelierSalonDecisions)
        .where(
          and(
            gte(atelierSalonDecisions.decidedAt, weekStart),
            isNull(atelierSalonDecisions.deletedAt),
          ),
        );
      for (const s of salonRows) {
        if (s.decidedAt >= weekEnd) continue;
        if (!ownedEngIds.has(s.engagementId)) continue;
        salonHits.push({ id: s.id, engagementId: s.engagementId, kind: s.kind, headline: s.headline, decidedAt: s.decidedAt });
      }
    }

    // 5) Agent runs triggered BY this user inside the window — these are
    //    work the employee performed via an agent (Cognirise, pricing, etc.).
    const agentRunHits = userId
      ? await db
          .select({
            id: atelierAgentRuns.id,
            agentId: atelierAgentRuns.agentId,
            targetType: atelierAgentRuns.targetType,
            targetId: atelierAgentRuns.targetId,
            targetLabel: atelierAgentRuns.targetLabel,
            createdAt: atelierAgentRuns.createdAt,
            durationMs: atelierAgentRuns.durationMs,
          })
          .from(atelierAgentRuns)
          .where(
            and(
              eq(atelierAgentRuns.triggeredByUserId, userId),
              gte(atelierAgentRuns.createdAt, weekStart),
              isNull(atelierAgentRuns.deletedAt),
            ),
          )
      : [];
    const agentRunsInWeek = agentRunHits.filter((r) => r.createdAt < weekEnd && r.agentId !== "ag_time_steward");

    // ---- Signal immutability: signals are append-only audit evidence and
    //      MUST survive across re-runs (architect: "immutable for audit").
    //      Dedupe by natural key (sourceRefType + sourceRefId + signalType +
    //      personId + weekId) — anything we've already recorded for this
    //      week is skipped, so reruns are idempotent without deleting
    //      historical evidence rows.
    const existingSignals = await db
      .select({
        signalType: atelierTimesheetSignals.signalType,
        sourceRefType: atelierTimesheetSignals.sourceRefType,
        sourceRefId: atelierTimesheetSignals.sourceRefId,
      })
      .from(atelierTimesheetSignals)
      .where(eq(atelierTimesheetSignals.weekId, args.weekId));
    const existingSigKey = new Set(
      existingSignals.map((s) => `${s.signalType}__${s.sourceRefType}__${s.sourceRefId}`),
    );
    const sigNatKey = (s: typeof atelierTimesheetSignals.$inferInsert) =>
      `${s.signalType}__${s.sourceRefType}__${s.sourceRefId}`;

    // ---- Materialize signals (immutable within a run) ----
    const signalRows: Array<typeof atelierTimesheetSignals.$inferInsert> = [];
    const sigId = (n: number) => `tsig_${args.weekId}_${n}_${Math.random().toString(36).slice(2, 6)}`;
    let n = 0;
    for (const c of calsInWeek) {
      const dateIso = c.startsAt.toISOString().slice(0, 10);
      signalRows.push({
        id: sigId(n++),
        weekId: args.weekId,
        personId: args.personId,
        workDate: dateIso,
        signalType: "calendar",
        sourceRefType: "calendar_event",
        sourceRefId: c.id,
        engagementHint: c.engagementHint ?? null,
        evidenceSummary: `${c.title} — ${Math.round(c.durationMins / 6) / 10}h calendar block`,
        weightHours: c.durationMins / 60,
        runId,
      });
    }
    for (const m of meetingsHit) {
      const att = (m.attendees as Array<unknown>) ?? [];
      const hours = Math.max(0.5, Math.min(2, att.length * 0.25 + 0.5));
      signalRows.push({
        id: sigId(n++),
        weekId: args.weekId,
        personId: args.personId,
        workDate: m.date,
        signalType: "meeting",
        sourceRefType: "meeting",
        sourceRefId: m.id,
        engagementHint: m.parentType === "engagement" ? m.parentId : null,
        evidenceSummary: `Meeting: ${m.title} (${att.length} attendees)`,
        weightHours: hours,
        runId,
      });
    }
    for (const e of editsInWeek) {
      const dateIso = e.createdAt.toISOString().slice(0, 10);
      // Look up the engagement via the deliverable
      const [del] = await db
        .select({ engagementId: atelierDeliverables.engagementId })
        .from(atelierDeliverables)
        .where(eq(atelierDeliverables.id, e.deliverableId));
      signalRows.push({
        id: sigId(n++),
        weekId: args.weekId,
        personId: args.personId,
        workDate: dateIso,
        signalType: "deliverable_edit",
        sourceRefType: "deliverable_version",
        sourceRefId: e.id,
        engagementHint: del?.engagementId ?? null,
        evidenceSummary: `Authored deliverable v${e.versionNumber}`,
        weightHours: 1.5,
        runId,
      });
    }
    for (const s of salonHits) {
      const dateIso = s.decidedAt.toISOString().slice(0, 10);
      signalRows.push({
        id: sigId(n++),
        weekId: args.weekId,
        personId: args.personId,
        workDate: dateIso,
        signalType: "salon_decision",
        sourceRefType: "salon_decision",
        sourceRefId: s.id,
        engagementHint: s.engagementId,
        evidenceSummary: `Salon ${s.kind}: ${s.headline}`,
        weightHours: 0.5,
        runId,
      });
    }
    for (const r of agentRunsInWeek) {
      const dateIso = r.createdAt.toISOString().slice(0, 10);
      // Approximate hours from observed duration, floored at 0.25h, capped 2h.
      const durHours = r.durationMs ? r.durationMs / 3_600_000 : 0;
      const hours = Math.min(2, Math.max(0.25, Math.round(durHours * 4) / 4));
      const engHint = r.targetType === "engagement" ? r.targetId : null;
      signalRows.push({
        id: sigId(n++),
        weekId: args.weekId,
        personId: args.personId,
        workDate: dateIso,
        signalType: "agent_run",
        sourceRefType: "agent_run",
        sourceRefId: r.id,
        engagementHint: engHint,
        evidenceSummary: `${r.agentId} run: ${r.targetLabel ?? r.targetType ?? "task"}`,
        weightHours: hours,
        runId,
      });
    }
    // Drop any signals we've already persisted in a prior run (signal
    // immutability + idempotent rerun) before inserting.
    const newSignalRows = signalRows.filter((s) => !existingSigKey.has(sigNatKey(s)));
    if (newSignalRows.length) {
      await db.insert(atelierTimesheetSignals).values(newSignalRows);
    }
    // Re-aggregation below operates on the FULL signal set (existing +
    // newly inserted), not just newSignalRows, so totals stay correct.

    // ---- Aggregate signals into draft entries (one per workDate × engagement)
    //      Read the FULL persisted signal set for the week so reruns
    //      reflect any historical evidence too (signal immutability).
    type Bucket = { workDate: string; engagementId: string | null; hours: number; signalIds: string[]; narratives: string[] };
    const buckets = new Map<string, Bucket>();
    const allWeekSignals = await db
      .select()
      .from(atelierTimesheetSignals)
      .where(eq(atelierTimesheetSignals.weekId, args.weekId));
    for (const s of allWeekSignals) {
      const key = `${s.workDate}__${s.engagementHint ?? "none"}`;
      const b = buckets.get(key) ?? {
        workDate: s.workDate,
        engagementId: s.engagementHint ?? null,
        hours: 0,
        signalIds: [],
        narratives: [],
      };
      b.hours += Number(s.weightHours);
      b.signalIds.push(s.id);
      b.narratives.push(s.evidenceSummary);
      buckets.set(key, b);
    }

    // Wipe prior agent-drafted rows for this week so re-runs are idempotent.
    await db
      .delete(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.weekId, args.weekId),
          eq(atelierTimesheetEntries.source, "agent_drafted"),
        ),
      );

    const entries: Array<typeof atelierTimesheetEntries.$inferInsert> = [];
    let m2 = 0;
    let totalDrafted = 0;
    for (const b of buckets.values()) {
      const hours = Math.min(10, Math.round(b.hours * 2) / 2); // round to .5, cap 10
      if (hours <= 0) continue;
      totalDrafted += hours;
      entries.push({
        id: `tse_${args.weekId}_${m2++}_${Math.random().toString(36).slice(2, 6)}`,
        weekId: args.weekId,
        personId: args.personId,
        personType: empRow ? "employee" : "contractor",
        workDate: b.workDate,
        engagementId: b.engagementId,
        activityCode: b.engagementId ? "billable" : "internal",
        hours,
        billable: !!b.engagementId,
        narrative: b.narratives.slice(0, 3).join(" · "),
        source: "agent_drafted",
        draftedByAgentId: "ag_time_steward",
        signalIds: b.signalIds,
        status: "draft",
      });
    }
    if (entries.length) {
      await db.insert(atelierTimesheetEntries).values(entries);
    }

    // Recompute week aggregate across BOTH agent-drafted and human entries
    // so the totals stay correct after a steward re-run on a partially
    // hand-edited week.
    const allEntries = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.weekId, args.weekId),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      );
    const totalAll = allEntries.reduce((s, e) => s + Number(e.hours || 0), 0);
    const billAll = allEntries.reduce((s, e) => s + (e.billable ? Number(e.hours || 0) : 0), 0);
    await db
      .update(atelierTimesheetWeeks)
      .set({ totalHours: totalAll, billableHours: billAll, updatedAt: new Date() })
      .where(eq(atelierTimesheetWeeks.id, args.weekId));

    const out: TimeStewardOutput = {
      weekId: args.weekId,
      personId: args.personId,
      signalsCreated: signalRows.length,
      draftEntriesCreated: entries.length,
      totalHoursDrafted: totalDrafted,
    };
    await completeRun({
      runId,
      output: out,
      confidence: signalRows.length === 0 ? "amber" : "green",
      costUsd: 0,
      durationMs: Date.now() - t0,
      sourcesCount: signalRows.length,
      actorLabel: "Time Steward",
      targetType: "timesheet_week",
      targetId: args.weekId,
      targetLabel: `Timesheet ${args.weekId.slice(-12)}`,
    });
    return out;
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: "Time Steward",
      targetType: "timesheet_week",
      targetId: args.weekId,
    });
    throw err;
  }
}


// =====================================================================
// Utilization Analyst — Task #258
// =====================================================================
// Translates a hydrated numeric block (utilization, realization, burn)
// into a partner-grade narrative. **Hard guardrail**: refuses generation
// when the numeric block is missing or stale (no rows, computedAt > 7d).

export interface UtilizationAnalystOutput {
  refusal: string | null;
  headline: string | null;
  narrative: string | null;
  risks: { id: string; severity: "amber" | "red"; statement: string }[];
  actions: { id: string; action: string; owner: string }[];
  confidence: "green" | "amber" | "red";
}


// Snapshots older than this are treated as stale by the analyst. The Burn
// Sentinel + snapshot ticks both run inside the 15-minute scheduler, so the
// analyst expects fresh data; anything older than 24h is almost certainly a
// dead environment, not a real read.
const SNAPSHOT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export async function runUtilizationAnalyst(args: {
  view: "person" | "engagement" | "firm";
  targetId: string;
  targetLabel: string;
  period: string;
  numericBlock: Record<string, unknown> | null;
  /** ISO-8601 timestamp of the snapshot/tick that produced numericBlock. */
  computedAt?: string | null;
  triggeredByUserId: string | null;
}): Promise<{ runId: string; output: UtilizationAnalystOutput }> {
  // Pre-flight guardrail. Three refusal conditions — all about *source*
  // freshness, not value content:
  //   1) numeric block is null or has no keys (hydrator returned nothing
  //      because there's no source data to read),
  //   2) `computedAt` is missing/null/unparseable (we cannot prove the
  //      numbers are fresh, so we refuse rather than narrate blind),
  //   3) `computedAt` is older than SNAPSHOT_FRESHNESS_MS.
  // A block whose values are all zero is *not* refused: zero billable
  // hours / zero margin can be a valid deterministic outcome and the
  // analyst is expected to narrate it ("the team didn't bill any hours
  // this period").
  const emptyBlock = !args.numericBlock || Object.keys(args.numericBlock).length === 0;
  let computedAtStale = false;
  if (!emptyBlock) {
    if (!args.computedAt) {
      computedAtStale = true;
    } else {
      const ts = Date.parse(args.computedAt);
      if (Number.isNaN(ts) || Date.now() - ts > SNAPSHOT_FRESHNESS_MS) computedAtStale = true;
    }
  }
  const blockIsStale = emptyBlock || computedAtStale;

  const result = await runAgent(
    {
      agentId: "ag_utilization_analyst",
      input: {
        view: args.view,
        targetId: args.targetId,
        targetLabel: args.targetLabel,
        period: args.period,
        numericBlock: args.numericBlock,
        computedAt: args.computedAt ?? null,
      },
      triggeredByUserId: args.triggeredByUserId,
      targetType: `utilization_${args.view}`,
      targetId: args.targetId,
      targetLabel: args.targetLabel,
      actorLabel: "Utilization Analyst",
    },
    async (_ctx) => {
      if (blockIsStale) {
        // Refusal path — numeric block is the source of truth; without
        // it the analyst returns a structured refusal rather than
        // narrate blind. The output still satisfies outputSchema.
        const output: UtilizationAnalystOutput = {
          refusal: "numeric-block-missing-or-stale",
          headline: null,
          narrative: null,
          risks: [],
          actions: [],
          confidence: "red",
        };
        return {
          output,
          costUsd: 0,
          confidence: "red",
        };
      }
      const promptBody = loadPrompt("utilization_analyst");
      const userPrompt = JSON.stringify({
        view: args.view,
        targetId: args.targetId,
        targetLabel: args.targetLabel,
        period: args.period,
        numericBlock: args.numericBlock,
      });
      const { value, costUsd } = await callClaudeJson<UtilizationAnalystOutput>(
        "claude-haiku-4-5",
        promptBody,
        userPrompt,
      );
      return {
        output: value,
        costUsd,
        confidence: value.confidence ?? "amber",
      };
    },
  );
  return { runId: result.runId, output: result.output as UtilizationAnalystOutput };
}

// =====================================================================
// Expense Auditor (Task #259) — OCR + classify + policy + VAT + billable
// =====================================================================

export interface ExpenseAuditorProposal {
  category:
    | "flight"
    | "hotel"
    | "meal"
    | "gift"
    | "software"
    | "mileage"
    | "per_diem"
    | "taxi"
    | "other";
  vatTreatment: "ksa_15" | "uae_5" | "zero_rated_export" | "none";
  vatAmount: number;
  clientBillable: boolean;
  markupPct: number;
  summary: string;
  ocrConfidence: "green" | "amber" | "red";
  refused?: boolean;
  reason?: string;
}

export interface ExpenseAuditorInput {
  expenseId: string;
  triggeredByUserId: string | null;
  ocr: {
    merchant?: string;
    date?: string;
    total?: number;
    tax?: number;
    currency?: string;
    country?: string;
    category?: string;
    rawText?: string;
    confidence?: "green" | "amber" | "red";
  } | null;
  contractDigest: {
    expensesClause?: boolean;
    expenseMarkupCapPct?: number;
    permittedCategories?: string[];
    summary?: string;
  } | null;
  draft: {
    amount: number;
    currency: string;
    country?: string;
    category?: string;
    engagementId?: string | null;
  };
}

export async function runExpenseAuditor(input: ExpenseAuditorInput): Promise<{
  runId: string;
  proposal: ExpenseAuditorProposal;
}> {
  const result = await runAgent(
    {
      agentId: "ag_expense_auditor",
      input: {
        expenseId: input.expenseId,
        ocr: input.ocr,
        contractDigest: input.contractDigest,
        draft: input.draft,
      },
      triggeredByUserId: input.triggeredByUserId,
      targetType: "expense",
      targetId: input.expenseId,
      targetLabel: `Expense ${input.expenseId}`,
      actorLabel: "Expense Auditor",
    },
    async (_ctx) => {
      const promptBody = loadPrompt("expense_auditor");
      const userPrompt = JSON.stringify({
        ocr: input.ocr,
        contractDigest: input.contractDigest,
        draft: input.draft,
      });
      const { value, costUsd } = await callClaudeJson<ExpenseAuditorProposal>(
        "claude-haiku-4-5",
        promptBody,
        userPrompt,
      );
      return {
        output: value,
        costUsd,
        confidence: value.ocrConfidence ?? "amber",
      };
    },
  );
  return { runId: result.runId, proposal: result.output as ExpenseAuditorProposal };
}

















// ---------- run<X> entrypoints ----------

export interface V5RunCommonArgs {
  triggeredByUserId: string | null;
  actorLabel?: string;
}

export interface V5GenericResult {
  runId: string;
  output: unknown;
  costUsd: number;
}

/**
 * Generic v5 agent dispatcher — wraps `runAgent` lifecycle around a
 * single live `callClaudeJson` invocation. Used by the v5 mode-extension
 * entrypoints (press, partner, recruiting, etc.) that all share the
 * same shape: load a registered prompt, send the input as JSON, return
 * whatever the model produces. There is no fallback path — if Claude
 * fails the run is marked failed and the error propagates.
 */
async function runV5GenericAgent(args: {
  agentId: AtelierAgentId | string;
  promptId: string;
  promptVersion?: number;
  promptMode?: string;
  model: string;
  input: Record<string, unknown>;
  triggeredByUserId: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string;
  actorLabel?: string;
}): Promise<V5GenericResult> {
  const result = await runAgent(
    {
      agentId: args.agentId as AtelierAgentId,
      input: args.input,
      triggeredByUserId: args.triggeredByUserId,
      targetType: args.targetType,
      targetId: args.targetId,
      targetLabel: args.targetLabel,
      actorLabel: args.actorLabel,
    },
    async (_ctx) => {
      // Honor the v5 mode-extension contract: `(promptId, version, mode)`
      // resolves to the right `vN_<mode>_mode.md` file (e.g. press,
      // partner, recruiting). Falling back to the base prompt would
      // silently regress those agents.
      const promptBody = loadPrompt(
        args.promptId as AtelierAgentId,
        args.promptVersion ?? 1,
        args.promptMode,
      );
      const userPrompt = JSON.stringify(args.input);
      const { value, costUsd } = await callClaudeJson<unknown>(
        args.model,
        promptBody,
        userPrompt,
      );
      return { output: value, costUsd, confidence: "amber" as const };
    },
  );
  return { runId: result.runId, output: result.output, costUsd: result.costUsd };
}

export async function runLinkedInComposer(
  input: { partnerId: string; sourceArtifactId: string; sourceArtifactKind: string; targetLength?: string } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_linkedin_composer",
    promptId: "linkedin_composer",
    model: "claude-sonnet-4-5",
    input: {
      partnerId: input.partnerId,
      sourceArtifactId: input.sourceArtifactId,
      sourceArtifactKind: input.sourceArtifactKind,
      targetLength: input.targetLength,
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "partner",
    targetId: input.partnerId,
    targetLabel: `LinkedIn — ${input.partnerId}`,
    actorLabel: input.actorLabel ?? "LinkedIn Composer",
  });
}

export async function runPressMonitor(
  input: { lookbackDays?: number; watchlistPartners?: string[]; watchlistCompetitors?: string[] } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_press_monitor",
    promptId: "press_monitor",
    model: "claude-sonnet-4-5",
    input: {
      lookbackDays: input.lookbackDays ?? 7,
      watchlistPartners: input.watchlistPartners ?? [],
      watchlistCompetitors: input.watchlistCompetitors ?? [],
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "atelier",
    targetId: "press_watch",
    targetLabel: "Press watch",
    actorLabel: input.actorLabel ?? "Press Monitor",
  });
}

export async function runFieldNotesScheduler(
  input: { issueMonth: string; subscriberSegment?: string; candidateArtifactIds?: string[] } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_field_notes_scheduler",
    promptId: "field_notes_scheduler",
    model: "claude-haiku-4-5",
    input: {
      issueMonth: input.issueMonth,
      subscriberSegment: input.subscriberSegment ?? "all",
      candidateArtifactIds: input.candidateArtifactIds ?? [],
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "atelier",
    targetId: `field_notes:${input.issueMonth}`,
    targetLabel: `Field Notes ${input.issueMonth}`,
    actorLabel: input.actorLabel ?? "Field Notes Scheduler",
  });
}

export async function runAllianceChoreographer(
  input: { opportunityId: string; partnerFirmId: string; leadParty?: "cognirise" | "partner"; proposedSplitPct?: number } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_alliance_choreographer",
    promptId: "alliance_choreographer",
    model: "claude-sonnet-4-5",
    input: {
      opportunityId: input.opportunityId,
      partnerFirmId: input.partnerFirmId,
      leadParty: input.leadParty,
      proposedSplitPct: input.proposedSplitPct,
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "opportunity",
    targetId: input.opportunityId,
    targetLabel: `Alliance — ${input.opportunityId}`,
    actorLabel: input.actorLabel ?? "Alliance Choreographer",
  });
}

export async function runCertificationTracker(
  input: { lookbackDays?: number; lookaheadDays?: number; firmPartnerTiers?: unknown[] } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_certification_tracker",
    promptId: "certification_tracker",
    model: "claude-haiku-4-5",
    input: {
      lookbackDays: input.lookbackDays ?? 30,
      lookaheadDays: input.lookaheadDays ?? 90,
      firmPartnerTiers: input.firmPartnerTiers ?? [],
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "atelier",
    targetId: "certifications",
    targetLabel: "Firm certification posture",
    actorLabel: input.actorLabel ?? "Certification Tracker",
  });
}

export async function runInterviewDesigner(
  input: { roleId: string; roleLevel?: string; candidateId?: string } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_interview_designer",
    promptId: "interview_designer",
    model: "claude-sonnet-4-5",
    input: {
      roleId: input.roleId,
      roleLevel: input.roleLevel ?? "ic",
      candidateId: input.candidateId ?? "",
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "role",
    targetId: input.roleId,
    targetLabel: `Interview design — ${input.roleId}`,
    actorLabel: input.actorLabel ?? "Interview Designer",
  });
}

export async function runReferenceCaller(
  input: { candidateId: string; referenceId: string; roleId: string; callTranscriptOrVideoId: string } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_reference_caller",
    promptId: "reference_caller",
    model: "claude-sonnet-4-5",
    input: {
      candidateId: input.candidateId,
      referenceId: input.referenceId,
      roleId: input.roleId,
      callTranscriptOrVideoId: input.callTranscriptOrVideoId,
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "candidate",
    targetId: input.candidateId,
    targetLabel: `Reference — ${input.candidateId}`,
    actorLabel: input.actorLabel ?? "Reference Caller",
  });
}

export async function runOfferComposer(
  input: { candidateId: string; roleId: string; approvedCompBandId: string; startDate?: string } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_offer_composer",
    promptId: "offer_composer",
    model: "claude-sonnet-4-5",
    input: {
      candidateId: input.candidateId,
      roleId: input.roleId,
      approvedCompBandId: input.approvedCompBandId,
      startDate: input.startDate,
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "candidate",
    targetId: input.candidateId,
    targetLabel: `Offer — ${input.candidateId}`,
    actorLabel: input.actorLabel ?? "Offer Composer",
  });
}

export async function runComplianceSentinel(
  input: { controlFramework?: "soc2_type2" | "iso27001"; periodStart?: string; periodEnd?: string } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  const fw = input.controlFramework ?? "soc2_type2";
  return runV5GenericAgent({
    agentId: "ag_compliance_sentinel",
    promptId: "compliance_sentinel",
    model: "claude-sonnet-4-5",
    input: {
      controlFramework: fw,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "atelier",
    targetId: `compliance:${fw}`,
    targetLabel: `Compliance — ${fw}`,
    actorLabel: input.actorLabel ?? "Compliance Sentinel",
  });
}

export async function runIncidentResponder(
  input: { incidentId: string; severity: "sev1" | "sev2" | "sev3" | "sev4"; triggerKind?: string; initialSignal?: string } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_incident_responder",
    promptId: "incident_responder",
    model: "claude-sonnet-4-5",
    input: {
      incidentId: input.incidentId,
      severity: input.severity,
      triggerKind: input.triggerKind ?? "manual",
      initialSignal: input.initialSignal ?? "",
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "incident",
    targetId: input.incidentId,
    targetLabel: `Incident ${input.incidentId} (${input.severity})`,
    actorLabel: input.actorLabel ?? "Incident Responder",
  });
}

export async function runDsarConcierge(
  input: { dsarId: string; jurisdiction: "ksa_pdpl" | "uae_difc" | "gdpr" | "other"; subjectIdentifier: string; requestKind: "access" | "rectify" | "delete" | "portability" | "object" } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_dsar_concierge",
    promptId: "dsar_concierge",
    model: "claude-sonnet-4-5",
    input: {
      dsarId: input.dsarId,
      jurisdiction: input.jurisdiction,
      subjectIdentifier: input.subjectIdentifier,
      requestKind: input.requestKind,
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "dsar",
    targetId: input.dsarId,
    targetLabel: `DSAR ${input.dsarId} (${input.jurisdiction})`,
    actorLabel: input.actorLabel ?? "DSAR Concierge",
  });
}

export async function runBackupAuditor(
  input: { periodStart?: string; periodEnd?: string; primaryStores?: unknown[] } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_backup_auditor",
    promptId: "backup_auditor",
    model: "claude-haiku-4-5",
    input: {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      primaryStores: input.primaryStores ?? [],
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "atelier",
    targetId: "backups",
    targetLabel: "Backup posture",
    actorLabel: input.actorLabel ?? "Backup Auditor",
  });
}

export async function runIpSteward(
  input: { lookbackDays?: number; assetKinds?: string[] } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_ip_steward",
    promptId: "ip_steward",
    model: "claude-haiku-4-5",
    input: {
      lookbackDays: input.lookbackDays ?? 180,
      assetKinds: input.assetKinds ?? [],
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "atelier",
    targetId: "ip_catalog",
    targetLabel: "IP catalog",
    actorLabel: input.actorLabel ?? "IP Steward",
  });
}

export async function runOssComplianceSentinel(
  input: { repoId: string; manifestPaths?: string[] } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_oss_compliance_sentinel",
    promptId: "oss_compliance_sentinel",
    model: "claude-haiku-4-5",
    input: {
      repoId: input.repoId,
      manifestPaths: input.manifestPaths ?? [],
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "repo",
    targetId: input.repoId,
    targetLabel: `OSS scan — ${input.repoId}`,
    actorLabel: input.actorLabel ?? "OSS Compliance Sentinel",
  });
}

export async function runDemoEnvironmentCurator(
  input: { demoId: string; canonicalScriptId?: string } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_demo_environment_curator",
    promptId: "demo_environment_curator",
    model: "claude-haiku-4-5",
    input: {
      demoId: input.demoId,
      canonicalScriptId: input.canonicalScriptId ?? "",
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "demo",
    targetId: input.demoId,
    targetLabel: `Demo — ${input.demoId}`,
    actorLabel: input.actorLabel ?? "Demo Environment Curator",
  });
}

// ---------- 3 mode extensions (Task #306) ----------
//
// These agents share their existing registry entry (POV Author, Account
// Cartographer, Pursuit Scout) but load a parallel `v2_<mode>_mode.md`
// prompt file. They are exposed via the generic dispatcher under the
// SAME agentId by passing `_mode` in the request body.

export async function runPovAuthorPressMode(
  input: { opportunityId: string; audience: string; objective?: string; promotedFacts?: unknown[] } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_pov_author",
    promptId: "pov_author",
    promptVersion: 2,
    promptMode: "press",
    model: "claude-sonnet-4-5",
    input: {
      opportunityId: input.opportunityId,
      audience: input.audience,
      objective: input.objective ?? "",
      promotedFacts: input.promotedFacts ?? [],
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "opportunity",
    targetId: input.opportunityId,
    targetLabel: `POV (press mode) — ${input.opportunityId}`,
    actorLabel: input.actorLabel ?? "POV Author (press mode)",
  });
}

export async function runAccountCartographerPartnerMode(
  input: { partnerFirmId: string } & Record<string, unknown> & V5RunCommonArgs,
): Promise<V5GenericResult> {
  // Strip transport/runtime fields out of the prompt payload so the
  // model only sees business inputs.
  const { triggeredByUserId: _t, actorLabel: _a, ...businessInput } = input;
  return runV5GenericAgent({
    agentId: "ag_account_cartographer",
    promptId: "account_cartographer",
    promptVersion: 2,
    promptMode: "partner",
    model: "claude-sonnet-4-5",
    input: { ...businessInput, partnerFirmId: input.partnerFirmId },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "partner",
    targetId: input.partnerFirmId,
    targetLabel: `Cartographer (partner mode) — ${input.partnerFirmId}`,
    actorLabel: input.actorLabel ?? "Account Cartographer (partner mode)",
  });
}

export async function runPursuitScoutRecruitingMode(
  input: { roleId: string; candidateId?: string; contextBlurb?: string } & V5RunCommonArgs,
): Promise<V5GenericResult> {
  return runV5GenericAgent({
    agentId: "ag_pursuit_scout",
    promptId: "pursuit_scout",
    promptVersion: 2,
    promptMode: "recruiting",
    model: "claude-sonnet-4-5",
    input: {
      roleId: input.roleId,
      candidateId: input.candidateId ?? "",
      contextBlurb: input.contextBlurb ?? "",
    },
    triggeredByUserId: input.triggeredByUserId,
    targetType: "role",
    targetId: input.roleId,
    targetLabel: `Recruiting Scout — ${input.roleId}`,
    actorLabel: input.actorLabel ?? "Pursuit Scout (recruiting mode)",
  });
}

// ---------- generic dispatcher map ----------
//
// Used by the POST /api/atelier/agents/:agentId/run route. Returns
// undefined for agents not yet wired through this dispatcher (the route
// returns 404 in that case).

export type V5DispatcherFn = (
  input: Record<string, unknown> & V5RunCommonArgs,
) => Promise<V5GenericResult>;

export const ATELIER_V5_DISPATCH: Record<string, V5DispatcherFn> = {
  ag_linkedin_composer: (i) => runLinkedInComposer(i as never),
  ag_press_monitor: (i) => runPressMonitor(i as never),
  ag_field_notes_scheduler: (i) => runFieldNotesScheduler(i as never),
  ag_alliance_choreographer: (i) => runAllianceChoreographer(i as never),
  ag_certification_tracker: (i) => runCertificationTracker(i as never),
  ag_interview_designer: (i) => runInterviewDesigner(i as never),
  ag_reference_caller: (i) => runReferenceCaller(i as never),
  ag_offer_composer: (i) => runOfferComposer(i as never),
  ag_compliance_sentinel: (i) => runComplianceSentinel(i as never),
  ag_incident_responder: (i) => runIncidentResponder(i as never),
  ag_dsar_concierge: (i) => runDsarConcierge(i as never),
  ag_backup_auditor: (i) => runBackupAuditor(i as never),
  ag_ip_steward: (i) => runIpSteward(i as never),
  ag_oss_compliance_sentinel: (i) => runOssComplianceSentinel(i as never),
  ag_demo_environment_curator: (i) => runDemoEnvironmentCurator(i as never),
};

/**
 * Mode-aware dispatcher. The generic /run route looks for a `_mode` field
 * in the request body and routes the existing-agent + mode pair to the
 * correct prompt variant. Returns undefined when the (agentId, mode)
 * pair has no extension.
 */
export function dispatchV5ModeExtension(
  agentId: string,
  mode: string,
): V5DispatcherFn | undefined {
  if (agentId === "ag_pov_author" && mode === "press") {
    return (i) => runPovAuthorPressMode(i as never);
  }
  if (agentId === "ag_account_cartographer" && mode === "partner") {
    return (i) => runAccountCartographerPartnerMode(i as never);
  }
  if (agentId === "ag_pursuit_scout" && mode === "recruiting") {
    return (i) => runPursuitScoutRecruitingMode(i as never);
  }
  return undefined;
}

// =============================================================
// Task #360 (L2C Wave 1) — Codex agents
// =============================================================
//
// Two new agents live behind the Codex routes:
//   - contract_composer  → first-draft body + clause picks for a new
//                          contract instrument.
//   - redline_analyst    → clause-by-clause risk reading on an inbound
//                          counterparty markup.
//
// Both follow the established `start → progress → callClaudeJson →
// complete | fail` pattern.
// =============================================================

export interface ContractComposerInput {
  instrumentType:
    | "msa"
    | "sow"
    | "nda"
    | "dpa"
    | "change_order"
    | "side_letter"
    | "renewal";
  counterparty: {
    id: string;
    legalName: string;
    jurisdiction: string;
    vatNumber: string;
    paymentTermsDays: number;
  };
  engagement?: {
    id: string;
    name: string;
    partnerOwnerName?: string;
    engagementLeadName?: string;
    plannedEndDate?: string | null;
  } | null;
  opportunity?: {
    id: string;
    name: string;
    dealSizeUsd: number;
    currency: string;
    scopeSummary: string;
  } | null;
  parentContractId?: string | null;
  clauseLibrary: Array<{
    id: string;
    family: string;
    title: string;
    body: string;
    riskTier: "low" | "medium" | "high";
    jurisdictionTags: string[];
    instrumentTypes: string[];
  }>;
  acceptanceHistory?: Array<{
    clauseId: string;
    counterpartyId: string;
    customizationsJson: unknown;
  }>;
  houseRules?: {
    governingLaw?: string;
    currency?: string;
    defaultPaymentTermsDays?: number;
  };
  triggeredByUserId: string | null;
  actorLabel: string;
}

export interface ContractComposerOutput {
  renderedBody: string;
  renderedBodyFormat: "markdown";
  proposedClauses: Array<{
    clauseId: string;
    position: number;
    customizations: Record<string, unknown> | null;
    whyChosen: string;
  }>;
  flaggedRisks: Array<{
    severity: "low" | "medium" | "high";
    summary: string;
  }>;
  partiesProposed: Array<{
    side: "cognirise" | "counterparty";
    role: "signer" | "witness" | "notice_party" | "observer";
    signerName: string;
    signerEmail: string;
    signerTitle: string;
  }>;
  metadata: Record<string, unknown>;
}


export async function runContractComposer(
  input: ContractComposerInput,
): Promise<{
  runId: string;
  output: ContractComposerOutput;
  costUsd: number;
}> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "contract_composer",
    triggeredByUserId: input.triggeredByUserId,
    targetType: "contract",
    targetId: input.engagement?.id ?? input.opportunity?.id ?? input.counterparty.id,
    targetLabel: `${input.instrumentType.toUpperCase()} · ${input.counterparty.legalName}`,
    inputs: {
      instrumentType: input.instrumentType,
      clauseLibrarySize: input.clauseLibrary.length,
    },
    actorLabel: input.actorLabel,
  });
  try {
    const system = loadPrompt("contract_composer");
    await progressRun(runId, 15, "Selecting clauses from library");
    await progressRun(runId, 40, "Honouring acceptance history");
    await progressRun(runId, 65, "Rendering body + flagging risks");
    const { value, costUsd } =
      await callClaudeJson<ContractComposerOutput>(
        "claude-sonnet-4-6",
        system,
        JSON.stringify(input),
      );
    const conf: "green" | "amber" =
      value.flaggedRisks.some((r) => r.severity === "high") ? "amber" : "green";
    await completeRun({
      runId,
      output: value as unknown,
      confidence: conf,
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.proposedClauses.length,
      actorLabel: input.actorLabel,
      targetType: "contract",
      targetId:
        input.engagement?.id ?? input.opportunity?.id ?? input.counterparty.id,
      targetLabel: `${input.instrumentType.toUpperCase()} · ${input.counterparty.legalName}`,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: input.actorLabel,
      targetType: "contract",
      targetId:
        input.engagement?.id ?? input.opportunity?.id ?? input.counterparty.id,
    });
    throw err;
  }
}

export interface RedlineAnalystInput {
  contract: {
    id: string;
    instrumentType: string;
    status: string;
    title: string;
  };
  latestVersion: {
    id: string;
    version: number;
    renderedBody: string;
    bodyHash: string;
  };
  inboundBody: string;
  clauseLibraryAtSend: Array<{
    id: string;
    family: string;
    title: string;
    body: string;
    riskTier: "low" | "medium" | "high";
  }>;
  houseRules: {
    nonNegotiables: string[];
    softPreferences: string[];
  };
  triggeredByUserId: string | null;
  actorLabel: string;
}

export interface RedlineAnalystOutput {
  diffSummary: string;
  redlines: Array<{
    clauseId: string | null;
    positionHint: number | null;
    proposedBody: string;
    diff: { before: string; after: string; ops: unknown[] };
    riskTier: "low" | "medium" | "high";
    riskCommentary: string;
    recommendation: "accept" | "accept_with_conditions" | "reject";
    rationale: string;
  }>;
  overallRecommendation:
    | "accept"
    | "partial_accept"
    | "reject_and_negotiate"
    | "escalate_to_partner";
}


export async function runRedlineAnalyst(
  input: RedlineAnalystInput,
): Promise<{
  runId: string;
  output: RedlineAnalystOutput;
  costUsd: number;
}> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "redline_analyst",
    triggeredByUserId: input.triggeredByUserId,
    targetType: "contract",
    targetId: input.contract.id,
    targetLabel: input.contract.title,
    inputs: {
      contractId: input.contract.id,
      latestVersion: input.latestVersion.version,
      inboundBytes: input.inboundBody.length,
    },
    actorLabel: input.actorLabel,
  });
  try {
    const system = loadPrompt("redline_analyst");
    await progressRun(runId, 20, "Diffing inbound vs. last version");
    await progressRun(runId, 55, "Binding to clauses + classifying risk");
    await progressRun(runId, 85, "Composing reviewer commentary");
    const { value, costUsd } =
      await callClaudeJson<RedlineAnalystOutput>(
        "claude-sonnet-4-6",
        system,
        JSON.stringify(input),
      );
    // Guardrail: never let recommendation=accept escape on a high-risk row.
    for (const r of value.redlines) {
      if (r.riskTier === "high" && r.recommendation === "accept") {
        r.recommendation = "accept_with_conditions";
      }
    }
    const conf: "green" | "amber" | "red" =
      value.overallRecommendation === "escalate_to_partner"
        ? "red"
        : value.overallRecommendation === "reject_and_negotiate"
          ? "amber"
          : "green";
    await completeRun({
      runId,
      output: value as unknown,
      confidence: conf,
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.redlines.length,
      actorLabel: input.actorLabel,
      targetType: "contract",
      targetId: input.contract.id,
      targetLabel: input.contract.title,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: input.actorLabel,
      targetType: "contract",
      targetId: input.contract.id,
    });
    throw err;
  }
}

// =============================================================
// Task #360 (L2C Wave 1) — E-Sign Orchestrator
// =============================================================

export interface EsignOrchestratorInput {
  contract: {
    id: string;
    instrumentType: string;
    status: string;
    title: string;
    currency: string;
    contractValue: number;
  };
  parties: Array<{
    id: string;
    side: "cognirise" | "counterparty";
    role: "signer" | "witness" | "notice_party" | "observer";
    signerName: string;
    signerEmail: string;
    signerTitle: string;
    signMethod: "docusign" | "tabellio" | "wet_ink_pdf";
    signState: "pending" | "sent" | "signed" | "declined" | "expired";
  }>;
  latestVersion: { id: string; version: number; renderedBody: string; bodyHash: string };
  countersign: {
    state: "pending" | "partner_a_signed" | "both_signed" | "declined";
  };
  providerHint: "docusign" | "tabellio" | "auto";
  triggeredByUserId: string | null;
  actorLabel: string;
}

export interface EsignOrchestratorOutput {
  envelope: {
    provider: "docusign" | "tabellio" | "wet_ink_pdf";
    envelopeId: string;
    routingOrder: Array<{ partyId: string; order: number; signerEmail: string }>;
    sentAt: string | null;
    statusAfterSend: string;
  };
  reconciledPartyStates: Array<{
    partyId: string;
    signState: "pending" | "sent" | "signed" | "declined" | "expired";
    signedAt: string | null;
    evidenceUrl: string;
  }>;
  contractStatusAfter: string;
  warnings: string[];
}

function pickProvider(
  hint: EsignOrchestratorInput["providerHint"],
  parties: EsignOrchestratorInput["parties"],
): "docusign" | "tabellio" | "wet_ink_pdf" {
  if (hint !== "auto") return hint;
  if (parties.some((p) => p.signMethod === "tabellio")) return "tabellio";
  if (parties.every((p) => p.signMethod === "wet_ink_pdf")) return "wet_ink_pdf";
  return "docusign";
}


export async function runEsignOrchestrator(
  input: EsignOrchestratorInput,
): Promise<{
  runId: string;
  output: EsignOrchestratorOutput;
  costUsd: number;
}> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "esign_orchestrator",
    triggeredByUserId: input.triggeredByUserId,
    targetType: "contract",
    targetId: input.contract.id,
    targetLabel: input.contract.title,
    inputs: {
      provider: input.providerHint,
      partyCount: input.parties.length,
      countersignState: input.countersign.state,
    },
    actorLabel: input.actorLabel,
  });
  try {
    const system = loadPrompt("esign_orchestrator");
    await progressRun(runId, 25, "Validating two-partner countersign gate");
    await progressRun(runId, 55, "Composing routing order + provider pick");
    await progressRun(runId, 85, "Reconciling party states");
    const { value, costUsd } =
      await callClaudeJson<EsignOrchestratorOutput>(
        "claude-sonnet-4-6",
        system,
        JSON.stringify(input),
      );
    const conf: "green" | "amber" | "red" =
      value.warnings.length > 0
        ? "red"
        : value.contractStatusAfter === "fully_executed"
          ? "green"
          : "amber";
    await completeRun({
      runId,
      output: value as unknown,
      confidence: conf,
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.reconciledPartyStates.length,
      actorLabel: input.actorLabel,
      targetType: "contract",
      targetId: input.contract.id,
      targetLabel: input.contract.title,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: input.actorLabel,
      targetType: "contract",
      targetId: input.contract.id,
    });
    throw err;
  }
}

// =============================================================
// Task #360 (L2C Wave 1) — DPA Sentinel
// =============================================================

export interface DpaSentinelInput {
  engagement: {
    id: string;
    name: string;
    scopeSummary: string;
    plannedEndDate: string | null;
  };
  counterparty: {
    id: string;
    legalName: string;
    jurisdiction: string;
  };
  existingDpa: {
    id: string;
    status: "required" | "drafted" | "signed" | "active" | "reviewed" | "expired";
    dataClasses: string[];
    expiresAt: string | null;
    lastReviewedAt: string | null;
    signedAt?: string | null;
  } | null;
  linkedClauses: Array<{ family: string; title: string; body: string }>;
  dataSignalInputs: Array<{
    source: "scope_summary" | "deliverable" | "clause";
    text: string;
  }>;
  triggeredByUserId: string | null;
  actorLabel: string;
}

export interface DpaSentinelOutput {
  isDpaRequired: boolean;
  detectedDataClasses: Array<"pii" | "phi" | "financial" | "regulated_other">;
  processorChainInferred: Array<{ name: string; role: string; jurisdiction: string }>;
  recommendedStatus:
    | "required"
    | "drafted"
    | "signed"
    | "active"
    | "reviewed"
    | "expired";
  rationale: string;
  alerts: Array<{
    severity: "low" | "medium" | "high";
    audience: "compliance_officer" | "partner" | "engagement_lead";
    summary: string;
  }>;
}

const PII_KEYS = [
  "personal data",
  "customer record",
  "employee record",
  "name",
  "email",
  "phone",
  "address",
  "biometric",
  "id number",
  "passport",
  "national id",
];
const PHI_KEYS = ["health", "medical", "diagnosis", "patient", "phi"];
const FIN_KEYS = ["account number", "iban", "card number", "transaction", "salary", "payroll", "kyc", "aml"];


export async function runDpaSentinel(input: DpaSentinelInput): Promise<{
  runId: string;
  output: DpaSentinelOutput;
  costUsd: number;
}> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "dpa_sentinel",
    triggeredByUserId: input.triggeredByUserId,
    targetType: "engagement",
    targetId: input.engagement.id,
    targetLabel: input.engagement.name,
    inputs: {
      counterparty: input.counterparty.legalName,
      hasExistingDpa: input.existingDpa !== null,
      signalCount: input.dataSignalInputs.length,
    },
    actorLabel: input.actorLabel,
  });
  try {
    const system = loadPrompt("dpa_sentinel");
    await progressRun(runId, 30, "Scanning data signals");
    await progressRun(runId, 65, "Classifying data classes");
    await progressRun(runId, 90, "Composing recommendations + alerts");
    const { value, costUsd } =
      await callClaudeJson<DpaSentinelOutput>(
        "claude-sonnet-4-6",
        system,
        JSON.stringify(input),
      );
    // Guardrail: never recommend `active` without a signed_at present.
    if (
      value.recommendedStatus === "active" &&
      !input.existingDpa?.signedAt
    ) {
      value.recommendedStatus = "signed";
      value.alerts.push({
        severity: "medium",
        audience: "compliance_officer",
        summary:
          "Downgraded recommendation from `active` to `signed`: existing DPA has no signed_at timestamp.",
      });
    }
    const conf: "green" | "amber" | "red" = value.alerts.some(
      (a) => a.severity === "high",
    )
      ? "red"
      : value.alerts.length > 0
        ? "amber"
        : "green";
    await completeRun({
      runId,
      output: value as unknown,
      confidence: conf,
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: input.dataSignalInputs.length,
      actorLabel: input.actorLabel,
      targetType: "engagement",
      targetId: input.engagement.id,
      targetLabel: input.engagement.name,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: input.actorLabel,
      targetType: "engagement",
      targetId: input.engagement.id,
    });
    throw err;
  }
}

// =============================================================
// Task #360 (L2C Wave 1) — Renewal Watchdog (daemon agent)
// =============================================================

export interface RenewalWatchdogInput {
  now: string;
  warningWindows: { contractDays: number; dpaDays: number };
  activeContracts: Array<{
    id: string;
    title: string;
    instrumentType: string;
    status: string;
    termEnd: string | null;
    currency: string;
    contractValueUsd: number;
    counterpartyLegalName: string;
  }>;
  activeDpas: Array<{
    id: string;
    status: string;
    expiresAt: string | null;
    counterpartyLegalName: string;
    engagementId: string;
  }>;
  triggeredByUserId: string | null;
  actorLabel: string;
}

export interface RenewalWatchdogOutput {
  contractRecommendations: Array<{
    contractId: string;
    daysToExpiry: number;
    recommendation: "renew" | "expire" | "terminate" | "review";
    rationale: string;
    targetStatus: "expiring" | "active";
    severity: "low" | "medium" | "high";
  }>;
  dpaRecommendations: Array<{
    dpaId: string;
    daysToExpiry: number;
    recommendation: "renew" | "review" | "retire";
    rationale: string;
    severity: "low" | "medium" | "high";
  }>;
  summaryForPartner: string;
}


export async function runRenewalWatchdog(
  input: RenewalWatchdogInput,
): Promise<{
  runId: string;
  output: RenewalWatchdogOutput;
  costUsd: number;
}> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "renewal_watchdog",
    triggeredByUserId: input.triggeredByUserId,
    targetType: "engagement",
    targetId: "_daemon_",
    targetLabel: "Renewal Watchdog daily sweep",
    inputs: {
      contracts: input.activeContracts.length,
      dpas: input.activeDpas.length,
      contractWindowDays: input.warningWindows.contractDays,
      dpaWindowDays: input.warningWindows.dpaDays,
    },
    actorLabel: input.actorLabel,
  });
  try {
    const system = loadPrompt("renewal_watchdog");
    await progressRun(runId, 35, "Walking active contracts");
    await progressRun(runId, 70, "Walking active DPAs");
    await progressRun(runId, 90, "Composing partner summary");
    const { value, costUsd } =
      await callClaudeJson<RenewalWatchdogOutput>(
        "claude-haiku-4-5",
        system,
        JSON.stringify(input),
      );
    const highCount =
      value.contractRecommendations.filter((r) => r.severity === "high").length +
      value.dpaRecommendations.filter((r) => r.severity === "high").length;
    const conf: "green" | "amber" | "red" =
      highCount > 0
        ? "red"
        : value.contractRecommendations.length + value.dpaRecommendations.length > 0
          ? "amber"
          : "green";
    await completeRun({
      runId,
      output: value as unknown,
      confidence: conf,
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount:
        value.contractRecommendations.length + value.dpaRecommendations.length,
      actorLabel: input.actorLabel,
      targetType: "engagement",
      targetId: "_daemon_",
      targetLabel: "Renewal Watchdog daily sweep",
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: input.actorLabel,
      targetType: "engagement",
      targetId: "_daemon_",
    });
    throw err;
  }
}

// =============================================================
// Task #363 (L2C Wave 4) — Cash Application Matcher (rule-based)
// =============================================================

export interface CashApplicationMatcherInput {
  receipt: {
    id: string;
    totalAmount: number;
    currency: string;
    counterpartyNameRaw: string | null;
    referenceRaw: string | null;
    postedDate: string;
  };
  openInvoices: Array<{
    id: string;
    invoiceNumber: string | null;
    billToName: string | null;
    currency: string;
    total: number;
    amountPaid: number;
    dueDate: string | null;
  }>;
  triggeredByUserId: string | null;
  actorLabel: string;
}

export interface CashApplicationMatcherOutput {
  recommended: "apply_full" | "apply_split" | "apply_overpayment" | "manual_review";
  candidates: Array<{
    invoiceId: string;
    invoiceNumber: string | null;
    appliedAmount: number;
    confidence: number;
    rationale: string;
  }>;
  rationaleSummary: string;
}

function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.85;
  // Token overlap (Jaccard).
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const uni = new Set([...ta, ...tb]).size;
  return uni === 0 ? 0 : inter / uni;
}

function ruleBasedCashMatch(input: CashApplicationMatcherInput): CashApplicationMatcherOutput {
  const r = input.receipt;
  const candidates: CashApplicationMatcherOutput["candidates"] = [];
  for (const inv of input.openInvoices) {
    if (inv.currency !== r.currency) continue;
    const outstanding = Math.round((inv.total - inv.amountPaid) * 100) / 100;
    if (outstanding <= 0) continue;
    const sim = nameSimilarity(r.counterpartyNameRaw, inv.billToName);
    const refMatch = !!(inv.invoiceNumber && r.referenceRaw &&
      r.referenceRaw.toLowerCase().includes(inv.invoiceNumber.toLowerCase()));
    const amtClose = Math.abs(outstanding - r.totalAmount) <= 1;
    let confidence = 0.1;
    let rationale = "weak match";
    if (refMatch) { confidence = 0.95; rationale = `Reference contains ${inv.invoiceNumber}`; }
    else if (sim >= 0.7 && amtClose) { confidence = 0.85; rationale = `Counterparty + amount match outstanding`; }
    else if (sim >= 0.7) { confidence = 0.55; rationale = `Counterparty match; amount differs`; }
    else if (amtClose) { confidence = 0.4; rationale = `Exact outstanding match; no name match`; }
    if (confidence > 0.1) {
      candidates.push({
        invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
        appliedAmount: Math.min(outstanding, r.totalAmount), confidence, rationale,
      });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const top = candidates[0];
  let recommended: CashApplicationMatcherOutput["recommended"] = "manual_review";
  let summary = "No high-confidence match; manual review.";
  if (top && top.confidence >= 0.85) {
    if (Math.abs(top.appliedAmount - r.totalAmount) <= 1) { recommended = "apply_full"; summary = `Apply full ${r.totalAmount} to ${top.invoiceNumber ?? top.invoiceId}.`; }
    else if (top.appliedAmount < r.totalAmount) { recommended = "apply_overpayment"; summary = `Apply ${top.appliedAmount} to ${top.invoiceNumber ?? top.invoiceId}; remainder is overpayment.`; }
    else { recommended = "apply_split"; summary = `Split across top candidates.`; }
  } else if (candidates.length >= 2) {
    recommended = "apply_split";
    summary = `Split across ${Math.min(3, candidates.length)} candidates.`;
  }
  return { recommended, candidates: candidates.slice(0, 5), rationaleSummary: summary };
}

export async function runCashApplicationMatcher(
  input: CashApplicationMatcherInput,
): Promise<{ runId: string; output: CashApplicationMatcherOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "ag_cash_application_matcher",
    triggeredByUserId: input.triggeredByUserId,
    targetType: "cash_receipt",
    targetId: input.receipt.id,
    targetLabel: `Receipt ${input.receipt.currency} ${input.receipt.totalAmount}`,
    inputs: { receiptId: input.receipt.id, openInvoiceCount: input.openInvoices.length },
    actorLabel: input.actorLabel,
  });
  try {
    const { value, costUsd } = await callClaudeJson<CashApplicationMatcherOutput>(
      "claude-haiku-4-5",
      "You are the Cash Application Matcher. Return a ranked list of invoice candidates for the receipt.",
      JSON.stringify(input),
    );
    const conf: "green" | "amber" | "red" =
      value.candidates[0]?.confidence >= 0.85 ? "green" :
      value.candidates[0]?.confidence >= 0.5 ? "amber" : "red";
    await completeRun({
      runId, output: value as unknown, confidence: conf, costUsd,
      durationMs: Date.now() - t0, sourcesCount: value.candidates.length,
      actorLabel: input.actorLabel, targetType: "cash_receipt",
      targetId: input.receipt.id, targetLabel: `Receipt ${input.receipt.id}`,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: input.actorLabel, targetType: "cash_receipt", targetId: input.receipt.id });
    throw err;
  }
}

// =============================================================
// Task #363 (L2C Wave 4) — Cash Flow Forecaster (rule-based)
// =============================================================

export interface CashFlowForecasterInput {
  asOf: string;
  currency: string;
  openingBalance: number;
  triggeredByUserId: string | null;
  actorLabel: string;
}

export interface CashFlowForecasterWeek {
  weekIndex: number;
  weekStart: string;
  expectedIn: number;
  expectedOut: number;
  openingBalance: number;
  closingBalance: number;
  confidenceLow: number;
  confidenceHigh: number;
  isCashGap: boolean;
}

export interface CashFlowForecasterOutput {
  snapshotId: string;
  asOf: string;
  currency: string;
  openingBalance: number;
  weeks: CashFlowForecasterWeek[];
  cashGapWeeks: number[];
  rationaleSummary: string;
}

function isoMondayOnOrAfter(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay(); // 0=Sun
  const offset = dow === 1 ? 0 : (dow === 0 ? 1 : 8 - dow);
  x.setUTCDate(x.getUTCDate() + offset);
  return x;
}

async function ruleBasedForecast(
  input: CashFlowForecasterInput,
  rows: Array<{ outstanding: number; dueDate: string | null }>,
): Promise<CashFlowForecasterOutput> {
  const start = isoMondayOnOrAfter(new Date(input.asOf));
  const weeks: CashFlowForecasterWeek[] = [];
  let opening = input.openingBalance;
  for (let i = 0; i < 13; i++) {
    const wkStart = new Date(start.getTime() + i * 7 * 86400_000);
    const wkEnd = new Date(wkStart.getTime() + 7 * 86400_000);
    const expectedIn = rows
      .filter((r) => r.dueDate && new Date(r.dueDate).getTime() >= wkStart.getTime() && new Date(r.dueDate).getTime() < wkEnd.getTime())
      .reduce((s, r) => s + r.outstanding, 0);
    // Synthetic recurring outflow (payroll-like) every 2nd week (mock).
    const expectedOut = (i % 2 === 0) ? Math.round(input.openingBalance * 0.05 * 100) / 100 : 0;
    const closing = Math.round((opening + expectedIn - expectedOut) * 100) / 100;
    weeks.push({
      weekIndex: i, weekStart: wkStart.toISOString().slice(0, 10),
      expectedIn: Math.round(expectedIn * 100) / 100, expectedOut,
      openingBalance: Math.round(opening * 100) / 100, closingBalance: closing,
      confidenceLow: Math.round(closing * 0.85 * 100) / 100,
      confidenceHigh: Math.round(closing * 1.15 * 100) / 100,
      isCashGap: closing < 0,
    });
    opening = closing;
  }
  const snapshotId = `snap_${Date.now().toString(36)}`;
  return {
    snapshotId, asOf: input.asOf, currency: input.currency,
    openingBalance: input.openingBalance, weeks,
    cashGapWeeks: weeks.filter((w) => w.isCashGap).map((w) => w.weekIndex),
    rationaleSummary: `13-week direct-method forecast from ${weeks[0].weekStart} based on ${rows.length} open AR rows.`,
  };
}

export async function runCashFlowForecaster(
  input: CashFlowForecasterInput,
): Promise<{ runId: string; output: CashFlowForecasterOutput; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "ag_cash_flow_forecaster",
    triggeredByUserId: input.triggeredByUserId,
    targetType: "cash_forecast",
    targetId: "_firm_",
    targetLabel: "13-week cash forecast",
    inputs: { asOf: input.asOf, currency: input.currency },
    actorLabel: input.actorLabel,
  });
  try {
    // Pull open AR rows so the model has grounded source data.
    const { db: dbRef, atelierInvoice: invTbl } = await import("@workspace/db");
    const { isNull: isN } = await import("drizzle-orm");
    const rows = (await dbRef.select().from(invTbl).where(isN(invTbl.deletedAt)))
      .filter((i) => i.total - i.amountPaid > 0.01)
      .map((i) => ({ outstanding: i.total - i.amountPaid, dueDate: i.dueDate }));
    const { value, costUsd } = await callClaudeJson<CashFlowForecasterOutput>(
      "claude-sonnet-4-6",
      "You are the Cash Flow Forecaster. Produce a 13-week direct-method forecast.",
      JSON.stringify({ ...input, openInvoices: rows }),
    );
    const conf: "green" | "amber" | "red" =
      value.cashGapWeeks.length === 0 ? "green" : value.cashGapWeeks.some((w) => w < 4) ? "red" : "amber";
    await completeRun({
      runId, output: value as unknown, confidence: conf, costUsd,
      durationMs: Date.now() - t0, sourcesCount: value.weeks.length,
      actorLabel: input.actorLabel, targetType: "cash_forecast", targetId: "_firm_",
      targetLabel: "13-week cash forecast",
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: input.actorLabel, targetType: "cash_forecast", targetId: "_firm_" });
    throw err;
  }
}
