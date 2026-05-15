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
 *   3. Calls Claude (or, when `MOCK_MODE` is on / the integration env vars
 *      are missing, returns a deterministic mock so the UX still works).
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
  attendees: { name: string; org: "client" | "aico" | "unknown" }[];
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
  source?: "claude" | "mock_config" | "mock_fallback";
  warning?: string;
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
  const isFallback = input.source === "mock_fallback";

  // Resolve agentId from the run row so we can validate output against
  // the registry. We avoid threading agentId through every callsite —
  // the row already knows.
  let schemaWarning: string | null = null;
  try {
    const [row] = await db
      .select({ agentId: atelierAgentRuns.agentId })
      .from(atelierAgentRuns)
      .where(eq(atelierAgentRuns.id, input.runId));
    if (row?.agentId && !isFallback) {
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

  // A mock-fallback (Claude error) is NOT a clean success — flag it so the
  // UI/audit can surface that the data is synthetic and must not be treated
  // as evidence. We still mark progress 100 so streams complete, but the
  // `status` becomes `blocked` and `confidence` is forced to red.
  const combinedWarning = [input.warning, schemaWarning].filter(Boolean).join(" | ") || undefined;
  await db
    .update(atelierAgentRuns)
    .set({
      status: isFallback ? "blocked" : "complete",
      statusMessage: isFallback
        ? (input.warning ?? "mock fallback — Claude unavailable")
        : (schemaWarning ? `complete (schema warning: ${schemaWarning.slice(0, 200)})` : "complete"),
      progressPct: 100,
      output: input.output as never,
      confidence: isFallback ? "red" : input.confidence,
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
    action: isFallback ? "agent.mock_fallback" : "agent.complete",
    payload: {
      runId: input.runId,
      confidence: isFallback ? "red" : input.confidence,
      costUsd: input.costUsd,
      source: input.source ?? "claude",
      warning: combinedWarning,
      schemaWarning,
    },
    payloadSummary: isFallback
      ? `${input.actorLabel} fell back to MOCK on ${input.targetLabel} — Claude unavailable; output flagged synthetic`
      : `${input.actorLabel} completed on ${input.targetLabel} (confidence ${input.confidence}, $${input.costUsd.toFixed(4)}, source ${input.source ?? "claude"})${schemaWarning ? " ⚠ schema-violation" : ""}`,
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

// ------- claude / mock dispatch -------

const MOCK_MODE =
  process.env.ATELIER_MOCK_AGENTS === "1" ||
  !process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ||
  !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

async function callClaudeJson<T>(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  fallback: () => T,
): Promise<{ value: T; costUsd: number; tokensIn: number; tokensOut: number; source: "claude" | "mock_config" | "mock_fallback"; warning?: string }> {
  if (MOCK_MODE) {
    return { value: fallback(), costUsd: 0, tokensIn: 0, tokensOut: 0, source: "mock_config" };
  }
  // Lazy import keeps cold-start light when running in mock mode.
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  try {
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
    const text =
      block && block.type === "text" ? block.text.trim() : "";
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const value = JSON.parse(stripped) as T;
    const tokensIn = resp.usage.input_tokens;
    const tokensOut = resp.usage.output_tokens;
    // crude per-1M pricing — tuned for sonnet-4.6/haiku-4.5 ballpark.
    const inRate = model.includes("haiku") ? 1 : 3;
    const outRate = model.includes("haiku") ? 5 : 15;
    const costUsd = (tokensIn * inRate + tokensOut * outRate) / 1_000_000;
    return { value, costUsd, tokensIn, tokensOut, source: "claude" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      "[atelier-agents] Claude call failed; returning mock-fallback flagged output so the UI can warn:",
      msg,
    );
    return {
      value: fallback(),
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      source: "mock_fallback",
      warning: `Claude call failed (${msg.slice(0, 160)}); output below is deterministic mock data — do NOT treat as evidence.`,
    };
  }
}

// ------- Pursuit Scout -------

function mockScoutOutput(
  accountName: string,
  sector: string,
  country: string,
): PursuitScoutOutput {
  const facts: AgentFact[] = [
    { topic: "earnings", statement: `${accountName} reported single-digit revenue growth in its most recent fiscal year.`, sourceUrl: "https://example.com/earnings", sourceTitle: `${accountName} Annual Report`, snippet: "...low single-digit organic growth driven by EMEA volumes...", confidence: "green" },
    { topic: "ai-strategy", statement: `${accountName} announced an enterprise AI program emphasising productivity and customer-facing pilots.`, sourceUrl: "https://example.com/ai-strategy", sourceTitle: "Press release", snippet: "...we will scale generative AI use cases across our group functions...", confidence: "amber" },
    { topic: "buyer", statement: `The ${sector} sector in ${country} is consolidating around two or three platform vendors.`, sourceUrl: "https://example.com/sector", sourceTitle: "Sector outlook", snippet: "...consolidation is accelerating as scale benefits compound...", confidence: "amber" },
    { topic: "regulation", statement: `Recent ${country} regulatory guidance increases governance pressure on AI procurement.`, sourceUrl: "https://example.com/regulator", sourceTitle: "Regulator guidance", snippet: "...covered entities must demonstrate human-in-the-loop oversight...", confidence: "green" },
    { topic: "vendor-stack", statement: `${accountName} is publicly known to use Snowflake and Microsoft 365 as core platforms.`, sourceUrl: "https://example.com/vendors", sourceTitle: "Case study", snippet: "...migrated its data warehouse to Snowflake in 2024...", confidence: "green" },
    { topic: "press", statement: `Recent press coverage flagged growing executive frustration with stalled digital programs.`, sourceUrl: "https://example.com/press", sourceTitle: "Trade press", snippet: "...board-level frustration with the pace of digital transformation...", confidence: "amber" },
  ];
  return {
    accountSnapshot: {
      oneLiner: `${accountName} is a ${sector} player headquartered in ${country} with a recent push into AI-led modernisation.`,
      scaleHint: "Mid-to-large cap; precise revenue not publicly disclosed in this dataset.",
      recentMoves: [
        "Announced enterprise AI program with named exec sponsor.",
        "Replaced Chief Data Officer in the past 18 months.",
        "Renewed multi-year cloud commitment with a hyperscaler.",
      ],
    },
    buyerLandscape: {
      likelyBuyers: [
        { title: "Chief Information Officer", rationale: "Owns the digital roadmap and cloud spend." },
        { title: "Chief AI / Data Officer", rationale: "Newly empowered, hunting for a marquee win." },
        { title: "Head of Strategy", rationale: "Funding pattern suggests strategy-led pursuits." },
      ],
      powerMap:
        "Decision authority sits with the CEO via the CIO; CFO holds the gate on commercials. Procurement is centralised and slow.",
    },
    fiveCDraft: {
      client: `${accountName} needs measurable, quarter-over-quarter productivity gains from AI without disrupting governance.`,
      competition: "Likely competing pitches from Big-4 advisory firms and the hyperscaler's professional services arm.",
      capability:
        "We bring sector-specific reference architectures and a partner-led delivery model; gap is local language depth.",
      capacity:
        "We can field a 4-person discovery squad within two weeks if scoping closes by month-end.",
      contract:
        "Procurement is centralised; expect SOW + framework agreement; commercial preference for fixed-fee diagnostic with milestone-based build.",
    },
    openQuestions: [
      `Who is the named executive sponsor for the AI program at ${accountName}?`,
      "What is the budget envelope for the next 6 months and how is it released?",
      "Which third parties are already engaged and on which scopes?",
      "What does 'success' look like at the next board review?",
    ],
    facts,
    confidence: "amber",
  };
}

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
      const { value, costUsd, source, warning } = await callClaudeJson<PursuitScoutOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          accountName: args.accountName,
          accountCountry: args.accountCountry,
          accountSector: args.accountSector,
          opportunityName: args.opportunityName,
          contextBlurb: args.contextBlurb,
        }),
        () => mockScoutOutput(args.accountName, args.accountSector, args.accountCountry),
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
        source,
        warning,
        sourcesCount: guarded.facts.length,
      };
    },
  );
  return { runId: result.runId, output: result.output as PursuitScoutOutput, costUsd: result.costUsd };
}

// ------- POV Author (3-step chain) -------

function mockOutline(
  opportunityName: string,
  audience: string,
  promotedFacts: AgentFact[],
): PovOutline {
  const ids = promotedFacts.map((f) => f.id ?? "f?");
  return {
    title: `Why ${opportunityName} matters now`,
    thesis: `For ${audience}, the next 12 months are the cheapest window to lock in advantage; waiting compounds the deficit.`,
    sections: [
      { id: "s1", heading: "The window is closing", intent: "Frame urgency with macro + sector evidence.", factIds: ids.slice(0, 2) },
      { id: "s2", heading: "What good looks like", intent: "Define the operating model for AI at scale.", factIds: ids.slice(2, 4) },
      { id: "s3", heading: "Where peers are losing", intent: "Use competitor cases as a lesson.", factIds: ids.slice(4, 6) },
      { id: "s4", heading: "How we would move", intent: "Outline a 90-day diagnostic with named owners.", factIds: ids.slice(0, 1) },
      { id: "s5", heading: "Risks and how we de-risk", intent: "Acknowledge governance + capacity risks.", factIds: ids.slice(1, 3) },
    ],
  };
}

function mockSections(outline: PovOutline, facts: AgentFact[]): PovDraft {
  const factById = new Map(facts.map((f) => [f.id ?? "", f]));
  const sections = outline.sections.map((s) => {
    const cited = s.factIds
      .map((id) => factById.get(id)?.statement ?? "")
      .filter(Boolean)
      .map((t, i) => `${t} [#${s.factIds[i]}]`)
      .join(" ");
    const body = `${s.intent} ${cited} The implication is direct: leadership must commit to a measurable next step within the quarter, or the cost of inaction begins to dwarf the cost of the program. We translate this into three concrete moves and one explicit non-move, designed to compound rather than crowd the existing roadmap.`;
    return {
      id: s.id,
      heading: s.heading,
      body,
      citationIds: s.factIds,
    };
  });
  const totalCitations = sections.reduce((acc, s) => acc + s.citationIds.length, 0);
  const coverage = Math.min(1, totalCitations / Math.max(1, facts.length));
  const html = `<h1>${outline.title}</h1>\n<p><strong>${outline.thesis}</strong></p>\n${sections
    .map(
      (s) =>
        `<h2>${s.heading}</h2><p>${s.body.replace(/\[#(f[^\]]+)\]/g, '<sup data-fact="$1">$1</sup>')}</p>`,
    )
    .join("\n")}`;
  const wordCount = html.split(/\s+/).length;
  return { sections, html, citationCoverage: coverage, voiceFlags: [], wordCount };
}

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
      const { value, costUsd, source, warning } = await callClaudeJson<PovOutline>(
        "claude-haiku-4-5",
        system + "\n\n## Run-time directive\nReturn ONLY the Phase A outline JSON.",
        JSON.stringify({
          opportunity: args.opportunityName,
          audience: args.audience,
          objective: args.objective,
          approvedFacts: args.promotedFacts,
        }),
        () => mockOutline(args.opportunityName, args.audience, args.promotedFacts),
      );
      return {
        output: value,
        costUsd,
        confidence: "amber",
        source,
        warning,
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
      const { value, costUsd, source, warning } = await callClaudeJson<PovDraft>(
        "claude-sonnet-4-5",
        system + "\n\n## Run-time directive\nExecute Phase B (sections), then Phase C (critic), then Phase D (stylist) and return the final composite JSON: { sections, html, citationCoverage, voiceFlags, wordCount }.",
        JSON.stringify({ outline: args.outline, facts: args.promotedFacts }),
        () => mockSections(args.outline, args.promotedFacts),
      );
      await ctx.progress(85, "Stylist polish");
      return {
        output: value,
        costUsd,
        confidence: value.citationCoverage >= 0.8 ? "green" : "amber",
        source,
        warning,
        sourcesCount: args.promotedFacts.length,
      };
    },
  );
  return { runId: result.runId, draft: result.output as PovDraft, costUsd: result.costUsd };
}

// ------- Meeting Scribe -------

function mockMeeting(
  transcript: string,
  kind: string,
  hasPrior: boolean,
): MeetingScribeOutput {
  const tlen = transcript.length;
  const summary = `Meeting (${kind}, ${tlen} chars of transcript) covered the standing pursuit thread for this opportunity. The team aligned on the next discovery checkpoint, identified two open scoping questions that must close before commercial conversations resume, and agreed the AI Engineer will share a worked example by the end of the week. No commercial commitments were made; both sides committed to a decision-review session next sprint.`;
  return {
    title: kind === "discovery" ? "Discovery call" : "Working session",
    attendees: [
      { name: "Speaker A", org: "client" },
      { name: "Speaker B", org: "aico" },
    ],
    summary,
    decisions: [
      { id: "d1", statement: "Agreed to extend discovery by one session before drafting the SOW.", decidedBy: "Both parties", confidence: "green" },
    ],
    actionItems: [
      { id: "a1", owner: "AICo Engineer", statement: "Share a worked example tied to client's pricing taxonomy.", due: null },
      { id: "a2", owner: "UNOWNED", statement: "Identify a procurement counterpart on the client side.", due: null },
    ],
    openQuestions: [
      "Who owns the data sharing memo on the client side?",
      "Is the budget for the diagnostic confirmed?",
    ],
    fiveCDelta: hasPrior
      ? {
          client: "Sharper articulation of the operational pain.",
          competition: "no change",
          capability: "Confirmed our example resonates.",
          capacity: "no change",
          contract: "Procurement contact still open.",
        }
      : {
          client: "no prior brief",
          competition: "no prior brief",
          capability: "no prior brief",
          capacity: "no prior brief",
          contract: "no prior brief",
        },
    suggestedPrototypeBrief: tlen > 200
      ? {
          audience: "Client decision-maker discussed in the call",
          problem: "Demonstrate the worked example referenced in this meeting.",
          agenticThesis: "An agent prepares the recommendation; the human decides.",
          demos: ["Headline demo tied to the open scoping question"],
        }
      : null,
  };
}

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
      const { value, costUsd, source, warning } = await callClaudeJson<MeetingScribeOutput>(
        "claude-haiku-4-5",
        system,
        JSON.stringify({
          transcript: args.transcript,
          meeting_kind: args.kind,
          prior_brief: args.priorBrief,
        }),
        () => mockMeeting(args.transcript, args.kind, !!args.priorBrief),
      );
      await ctx.progress(80, "Extracting decisions & actions");
      return {
        output: value,
        costUsd,
        confidence: "amber",
        source,
        warning,
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

function mockCharter(args: {
  accountName: string;
  proposalSummary: string;
  hasBaseline: boolean;
}): CharterArchitectOutput {
  const acct = args.accountName;
  const baseline = args.hasBaseline ? "current state measured pre-engagement" : "TBD-baseline";
  return {
    charter: {
      objectives: [
        `Cut top-process cycle time by 40% within 90 days for ${acct}.`,
        `Lift adoption of agentic ops to ≥70% of leads by day 90.`,
        `Stand up an audit-grade governance loop for every external action.`,
      ],
      scope: [
        "Top-3 highest-volume services within the agreed function.",
        "End-user telemetry, lead-by-lead dashboards, and weekly cadence.",
        "Baseline RAID and weekly steering with named owners.",
      ],
      outOfScope: [
        "Cross-function rollouts beyond the agreed top-3 services.",
        "Full Gantt resource leveling and utilisation analytics (v2).",
        "Customer-facing branding or marketing changes.",
      ],
      successMetrics: [
        { name: "Mean handle time on Service-1", baseline, target: "−40% vs baseline by day 90" },
        { name: "Adoption rate per lead", baseline, target: "≥70% of leads active by day 90" },
        { name: "Audit completeness", baseline: "0% (not measured)", target: "100% of agent actions audited" },
      ],
      governance: "Weekly steering with Partner + Lead + client COO; bi-weekly demo to executive sponsor; RAID review every Friday.",
      valueHypothesis: `For ${acct}, the next 90 days are the cheapest window to lock in agentic-ops gains; waiting compounds the cost of inaction.`,
    },
    hypothesisTree: {
      rootIssue: `Can a senior-overseen agentic operations layer cut ${acct}'s mean handle time by 40% within 90 days while compounding adoption past 70%?`,
      branches: [
        {
          hypothesis: "Top-volume services dominate handle-time variance; agentifying them captures most of the value.",
          subHypotheses: [
            "Service-1 (intake) is responsible for >40% of MHT variance.",
            "Service-2 (status checks) can be fully agent-handled with one human checkpoint.",
          ],
          evidenceRequired: [
            "30-day handle-time logs by service.",
            "Quality-of-resolution audit on agent-handled tickets.",
          ],
        },
        {
          hypothesis: "Adoption compounds when ops leads see lead-by-lead telemetry and own the rollout pace.",
          subHypotheses: [
            "Per-lead dashboards lift adoption ≥15 ppt within 30 days of release.",
            "Weekly 'service-of-the-week' cadence outperforms bulk launches.",
          ],
          evidenceRequired: [
            "Adoption curves of comparable BPO transformations.",
            "Lead survey data, weeks 2/6/10.",
          ],
        },
        {
          hypothesis: "Audit-grade governance unlocks executive trust to expand scope.",
          subHypotheses: [
            "100% audit coverage of agent actions removes the largest objection.",
            "Partner-Authority-Lock pattern reduces rework by ≥30%.",
          ],
          evidenceRequired: [
            "Audit coverage report.",
            "Rework-rate comparison vs prior phase.",
          ],
        },
      ],
    },
    raidBaseline: [
      { kind: "risk", severity: "amber", ownerRole: "Engagement Lead", description: "Adoption tail of service-3 may lag plan if lead onboarding slips.", dueClass: "wk2" },
      { kind: "issue", severity: "amber", ownerRole: "Architect", description: "Data-residency confirmation outstanding for one upstream integration partner.", dueClass: "wk1" },
      { kind: "assumption", severity: "green", ownerRole: "Partner", description: `${acct} executive sponsor will attend bi-weekly demos.`, dueClass: "wk1" },
      { kind: "dependency", severity: "amber", ownerRole: "Engagement Lead", description: "Access to production handle-time logs requires DPA addendum.", dueClass: "wk1" },
    ],
    proposedWorkstreams: [
      { name: "Agentify top-3 services", leadRole: "Architect", linkedHypothesis: "Top-volume services dominate variance" },
      { name: "Telemetry + adoption", leadRole: "Engagement Lead", linkedHypothesis: "Adoption compounds with telemetry" },
      { name: "Governance + audit", leadRole: "Partner", linkedHypothesis: "Audit unlocks executive trust" },
    ],
    meceFlags: args.proposalSummary.toLowerCase().includes("overlapping") ||
      /\bAND\b.*\bAND\b/.test(args.proposalSummary)
      ? ["Scope appears to bundle stand-up + build + governance — verify these are disjoint workstreams or collapse to one."]
      : [],
  };
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
      const { value, costUsd, source, warning } = await callClaudeJson<CharterArchitectOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          engagementId: args.engagementId,
          accountName: args.accountName,
          wonProposalSummary: args.wonProposalSummary,
          kickoffTranscriptExcerpt: args.kickoffTranscriptExcerpt,
        }),
        () => mockCharter({ accountName: args.accountName, proposalSummary: args.wonProposalSummary, hasBaseline }),
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
        source,
        warning,
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

function mockCritique(args: {
  body: string;
  hypothesisTree: HypothesisTree | null;
}): SynthesisCriticOutput {
  // Heuristic critique used both as the mock and as the deterministic
  // fallback when Claude is unavailable. Mirrors the prompt's logic.
  const body = args.body || "";
  // Section heuristic — each <h2> is a section.
  const sectionRegex = /<h2[^>]*>(.*?)<\/h2>([\s\S]*?)(?=<h2|$)/gi;
  const sections: { heading: string; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRegex.exec(body)) !== null) {
    sections.push({
      heading: m[1].replace(/<[^>]*>/g, "").trim(),
      text: m[2].replace(/<[^>]*>/g, " ").trim(),
    });
  }
  if (sections.length === 0) sections.push({ heading: "Body", text: body.replace(/<[^>]*>/g, " ").trim() });

  // Citation coverage: count assertive sentences vs ones with [#fxx] markers.
  const sentenceCount = (body.match(/[.!?](\s|<)/g) || []).length || 1;
  const citationCount = (body.match(/\[#[a-z0-9_]+\]|<sup[^>]*>/gi) || []).length;
  const evidence = Math.max(0, Math.min(100, Math.round((citationCount / sentenceCount) * 100)));

  // Off-hypothesis sections: any section heading that doesn't match a tree node string.
  const treeText = JSON.stringify(args.hypothesisTree || {}).toLowerCase();
  const offHyp: string[] = [];
  for (const s of sections) {
    const k = s.heading.toLowerCase();
    if (k === "body" || k.includes("bottom line") || k.includes("evidence") || k.includes("recommendation")) continue;
    const tokens = k.split(/\W+/).filter((t) => t.length > 4);
    const hit = tokens.some((t) => treeText.includes(t));
    if (!hit) offHyp.push(s.heading);
  }

  const issues: SynthesisCriticIssue[] = [];
  if (citationCount === 0 && sentenceCount > 1) {
    issues.push({
      type: "missing_citation",
      severity: "high",
      location: sections[0].heading,
      description: "No citations detected in the body. Every factual claim must carry a source reference.",
      suggestion: "Insert <sup data-fact='fXX'> markers next to each factual claim, or remove the claim.",
    });
  }
  if (citationCount > 0 && evidence < 50) {
    issues.push({
      type: "missing_citation",
      severity: "med",
      location: sections[0].heading,
      description: `Only ~${evidence}% of factual sentences carry a citation.`,
      suggestion: "Audit each uncited assertion; either cite or soften.",
    });
  }
  for (const s of offHyp) {
    issues.push({
      type: "off_hypothesis",
      severity: "med",
      location: s,
      description: `Section "${s}" does not map to any branch of the hypothesis tree.`,
      suggestion: "Either tie the section to an existing hypothesis or move it to an appendix.",
    });
  }
  // Buried-lede heuristic: first section heading contains "background" or "history".
  if (/background|history|introduction/i.test(sections[0].heading)) {
    issues.push({
      type: "no_governing_thought",
      severity: "high",
      location: sections[0].heading,
      description: "Section opens with background instead of the governing thought (pyramid principle violation).",
      suggestion: "Lead with the bottom-line recommendation; move background to a later section or appendix.",
    });
  }
  // Trust-us / weak-so-what heuristic.
  if (/trust us|fine|will be fine/i.test(body) && sentenceCount < 6) {
    issues.push({
      type: "weak_so_what",
      severity: "high",
      location: sections[0].heading,
      description: "Vague reassurance language without a measurable claim.",
      suggestion: "Replace with a measurable claim and a citation.",
    });
  }

  // Pyramid score: fraction of sections that have a clear governing thought
  // (proxy: heading contains a verb or a bottom-line marker).
  const passed = sections.filter((s) =>
    /recommend|cut|grow|reduce|adopt|bottom line|conclusion/i.test(s.heading) ||
    /^\d+\.\s/.test(s.heading),
  ).length;
  const pyramid = sections.length === 0 ? 0 : Math.min(1, passed / sections.length + 0.2);

  let readiness: "green" | "amber" | "red";
  const highCount = issues.filter((i) => i.severity === "high").length;
  if (pyramid >= 0.8 && evidence >= 80 && offHyp.length === 0 && highCount === 0) readiness = "green";
  else if (pyramid < 0.5 || evidence < 50 || highCount >= 2) readiness = "red";
  else readiness = "amber";

  return {
    issues,
    pyramid_score: Number(pyramid.toFixed(2)),
    evidence_coverage_pct: evidence,
    off_hypothesis_sections: offHyp,
    readiness,
  };
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
      const { value, costUsd, source, warning } = await callClaudeJson<SynthesisCriticOutput>(
        "claude-opus-4-7",
        system,
        JSON.stringify({
          deliverableId: args.deliverableId,
          body: args.body,
          hypothesisTree: args.hypothesisTree,
          audience: args.audience,
        }),
        () => mockCritique({ body: args.body, hypothesisTree: args.hypothesisTree }),
      );
      return {
        output: value,
        costUsd,
        confidence: value.readiness === "green" ? "green" : value.readiness === "amber" ? "amber" : "red",
        source,
        warning,
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

function mockAgentArchitect(args: {
  scopeHint: string;
  source: string;
}): AgentArchitectOutput {
  const lc = args.source.toLowerCase();
  const tokens = args.source
    .split(/[.;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
  const verbs = tokens.length >= 3 ? tokens : [
    "Inbound request received",
    "Owner triages and classifies",
    "Specialist resolves",
    "QA samples a fraction of cases",
  ];
  const steps: ProcessStep[] = verbs.slice(0, 6).map((line, i) => {
    const ownerGuess = /(specialist|senior|partner|legal)/i.test(line)
      ? "Senior"
      : /(qa|quality)/i.test(line)
        ? "QA"
        : /(agent|classifier|router)/i.test(line)
          ? "Agent"
          : i === 0 ? "Customer" : "Operator";
    const cat: StepCategory = /classif|route|triage/i.test(line)
      ? "decision"
      : /reply|email|sms|comm/i.test(line)
        ? "communication"
        : /reconcil|match/i.test(line)
          ? "reconciliation"
          : /calculate|price|quote|boq/i.test(line)
            ? "calculation"
            : /send|sign|commit|refund|publish/i.test(line)
              ? "irreversible_action"
              : "retrieval";
    const irreversible = cat === "irreversible_action";
    // Customer communications and any step touching money/contracts are
    // treated as high-risk surface area: drafts only, never auto-send.
    const isCustomerComm = cat === "communication";
    const isFinancialCommit =
      irreversible && /(refund|sign|commit|payment|invoice|charge|wire)/i.test(line);
    const agentifiable: ProcessStep["agentifiable"] = irreversible
      ? "partial"
      : isCustomerComm
        ? "partial"
        : cat === "decision" || cat === "retrieval" || cat === "reconciliation"
          ? "yes"
          : "yes";
    void isFinancialCommit; // surfaced through the high-risk classifier below
    return {
      id: `step_${i + 1}`,
      name: line.slice(0, 120),
      currentOwner: ownerGuess,
      category: cat,
      agentifiable,
      rationale: irreversible
        ? "Irreversible — agent may draft, human must commit."
        : agentifiable === "yes"
          ? "Bounded inputs/outputs and reversible — strong fit."
          : "Bounded but customer-facing — keep human-in-the-loop.",
    };
  });
  // Cluster: map agentifiable steps to ≥3 candidate agents.
  const triage = steps.find((s) => s.category === "decision");
  const calc = steps.find((s) => s.category === "calculation");
  const comm = steps.find((s) => s.category === "communication");
  const recon = steps.find((s) => s.category === "reconciliation");
  const retr = steps.find((s) => s.category === "retrieval");
  const irr = steps.find((s) => s.category === "irreversible_action");
  const candidates: CandidateAgentDesign[] = [];
  candidates.push({
    id: "ag_triage",
    name: "Triage Agent",
    purpose: `Classify each inbound item in scope of "${args.scopeHint}" and route it.`,
    inputs: [
      fld("raw_inbound_payload", "object", "Original inbound message/payload to classify."),
      fld("service_catalog", "array", "Permitted route categories with descriptions."),
    ],
    outputs: [
      fld("routed_class", "enum", "Selected service category."),
      fld("confidence", "number", "Model confidence in [0,1]."),
      fld("explain_md", "string", "Markdown rationale for the route."),
    ],
    tools: ["catalog_lookup", "history_search"],
    guardrails: ["confidence_threshold>=0.7_or_escalate", "no_PII_to_third_parties"],
    humanCheckpoints: ["sme_reviews_amber_routes_daily"],
    riskClass: "low",
  });
  if (calc || retr || recon) {
    candidates.push({
      id: "ag_solver",
      name: calc ? "Calculation Agent" : recon ? "Reconciliation Agent" : "Retrieval Agent",
      purpose: calc ? "Produce calculated outputs (e.g., quotes, BOQs) from inputs." : "Reconcile or fetch authoritative records.",
      inputs: calc
        ? [fld("customer_request", "object", "Customer request payload."), fld("rate_card", "object", "Active pricing rate card.")]
        : [fld("search_query", "string", "Free-text query."), fld("source_systems", "array", "List of authoritative systems to search.")],
      outputs: calc
        ? [fld("draft_quote", "object", "Computed quote (line items, totals, currency)."), fld("assumptions_md", "string", "Markdown of assumptions made.")]
        : [fld("matched_records", "array", "Records returned from authoritative source."), fld("explain_md", "string", "Markdown rationale for match.")],
      tools: calc ? ["pricing_engine", "rate_card_lookup"] : ["sql_read", "doc_search"],
      guardrails: ["never_commit_without_human_signoff", "show_assumptions"],
      humanCheckpoints: ["lead_approves_before_send"],
      riskClass: "med",
    });
  }
  if (comm || irr) {
    // Customer comms ALWAYS high-risk per Atelier guardrail spec
    // (customer-facing surface area = high), regardless of whether an
    // irreversible-action step also exists. Same for any step that
    // looks financial (refund/sign/commit/payment/invoice/charge/wire).
    const financialKeyword = steps.some((s) =>
      /(refund|sign|commit|payment|invoice|charge|wire)/i.test(s.name),
    );
    const isHigh = !!comm || !!irr || financialKeyword;
    candidates.push({
      id: "ag_drafter",
      name: comm ? "Customer-Comms Drafter" : "Action Drafter",
      purpose: "Draft outbound communication or action — never sends.",
      inputs: [
        fld("resolved_case_payload", "object", "Final case state to communicate."),
        fld("tone_guide", "object", "Brand tone + bilingual guidance."),
      ],
      outputs: [
        fld("draft_reply_md", "string", "Draft outbound message in markdown."),
        fld("tone_score", "number", "Tone-fit score in [0,1]."),
      ],
      tools: ["template_library"],
      guardrails: [
        "never_auto_send",
        "bilingual_when_required",
        ...(isHigh ? ["partner_attention_required_for_first_run"] : []),
      ],
      humanCheckpoints: [
        comm ? "operator_approves_each_send" : "operator_approves_each_action",
        ...(isHigh ? ["partner_signs_off_on_first_5_sends"] : []),
      ],
      riskClass: isHigh ? "high" : "med",
    });
  }
  while (candidates.length < 3) {
    candidates.push({
      id: `ag_extra_${candidates.length}`,
      name: "QA Sampler Agent",
      purpose: "Sample a fraction of completed cases and flag drift.",
      inputs: [
        fld("completed_cases", "array", "Set of recently completed cases to sample."),
        fld("policy_rules", "array", "Authoritative policy/rule corpus to compare against."),
      ],
      outputs: [
        fld("drift_report", "object", "Findings: drift items, severity, examples."),
      ],
      tools: ["sql_read"],
      guardrails: ["read_only"],
      humanCheckpoints: ["qa_lead_reviews_weekly"],
      riskClass: "low",
    });
  }
  // Mermaid
  const lines = ["flowchart TD"];
  steps.forEach((s, i) => {
    const shape = s.category === "decision" ? `{${s.name.replace(/[{}|"]/g, "")}}` : `[${s.name.replace(/[\[\]|"]/g, "")}]`;
    lines.push(`  ${s.id}${shape}`);
    if (i > 0) lines.push(`  ${steps[i - 1].id} --> ${s.id}`);
  });
  return {
    processDiagramMermaid: lines.join("\n"),
    steps,
    candidateAgents: candidates,
  };
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
      const { value, costUsd, source, warning } = await callClaudeJson<AgentArchitectOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({ scopeHint: args.scopeHint, depth: args.depth, source: args.source }),
        () => mockAgentArchitect({ scopeHint: args.scopeHint, source: args.source }),
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
        source,
        warning,
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

function mockPrototypeForge(brief: PrototypeForgeBrief): PrototypeForgeOutput {
  const safeDemos = brief.demos.length ? brief.demos : ["Hello world demo"];
  const storyboard = safeDemos.map((d, i) => ({
    id: `demo_${i + 1}`,
    title: d,
    moment: i === 0 ? "Opening" : i === safeDemos.length - 1 ? "Closing" : "Middle",
    interaction: "User clicks a primary surface; agent responds with explainable output.",
    artifact: "Visible card/panel with audit trail link.",
  }));
  const phases = [
    { phase: "Phase 1 — surfaces + mock data", days: 2, deliverables: ["Routing", "Brand baseline", "Seed data"] },
    { phase: "Phase 2 — agents (mock-LLM)", days: 3, deliverables: ["Agent runner skeleton", "Two demo agents", "Activity stream"] },
    { phase: "Phase 3 — demo polish", days: 2, deliverables: ["Storyboard hook-up", "Audit trail", "Narrated walkthrough"] },
  ];
  const brandLine = brief.brandOverrides?.logo
    ? `Brand: client-skinned (logo=\`${brief.brandOverrides.logo}\`, primary=\`${brief.brandOverrides.primary ?? "TBD"}\`).`
    : "Brand: AICo defaults (Atelier dark, gold accent).";
  const dataLine = brief.partnerDataApproved
    ? "Real client data is permitted (Partner approved)."
    : "Use synthetic/watermarked data only — Partner has NOT approved real client data.";
  const promptMd = [
    `# ${brief.name} — Replit build prompt`,
    ``,
    `**Audience:** ${brief.audience}`,
    `**Problem:** ${brief.problem}`,
    `**Agentic thesis:** ${brief.agenticThesis}`,
    ``,
    `## Surfaces`,
    storyboard.map((s) => `- ${s.title}`).join("\n"),
    ``,
    `## Constraints`,
    (brief.constraints.length ? brief.constraints : ["(none)"]).map((c) => `- ${c}`).join("\n"),
    ``,
    `## Brand`,
    `- ${brandLine}`,
    ``,
    `## Data policy`,
    `- ${dataLine}`,
    ``,
    `## AICo non-negotiables`,
    `- Human authority is sovereign. Every irreversible action requires a human signoff.`,
    `- Show the work. Every agent output ships with rationale + sources.`,
    `- Audit trail. Every action is logged (who/what/when).`,
    `- Bilingual-aware (EN/AR) where the audience requires.`,
    `- Synthetic data is watermarked; never simulate a real customer outcome silently.`,
  ].join("\n");
  return { replitPromptMd: promptMd, buildPlan: phases, demoStoryboard: storyboard };
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
    `## Data policy (AICo-enforced)`,
    `- ${dataLine}`,
    ``,
    `## AICo non-negotiables (auto-injected)`,
    `- Human authority is sovereign. Every irreversible action requires a human signoff.`,
    `- Show the work. Every agent output ships with rationale + sources.`,
    `- Audit trail. Every action is logged (who/what/when).`,
    `- Bilingual-aware (EN/AR) where the audience requires.`,
    `- Synthetic data is watermarked; never simulate a real customer outcome silently.`,
  ].join("\n");
  const hasNonNeg = /##\s+AICo non-negotiables/i.test(md);
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
      const { value: rawValue, costUsd, source, warning } = await callClaudeJson<PrototypeForgeOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify(args.brief),
        () => mockPrototypeForge(args.brief),
      );
      // Post-validate: AICo non-negotiables block must always be present in
      // the Replit prompt regardless of model drift. If the model omits the
      // section or the data-policy line, append the canonical block.
      const value = enforcePrototypeNonNegotiables(rawValue, args.brief);
      return {
        output: value,
        costUsd,
        confidence: "green",
        source,
        warning,
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

function mockPricing(args: {
  team: { role: string; alloc: number; days?: number }[];
  durationWeeks: number;
  targetMarginPct: number;
}): PricingModel {
  const seenPartner = new Set<string>();
  const wedge = args.team
    .filter((m) => {
      if (m.role !== "partner") return true;
      if (seenPartner.has("partner")) return false;
      seenPartner.add("partner");
      return true;
    })
    .map((m) => {
      const days = m.days ?? Math.round((args.durationWeeks * 5 * (m.alloc ?? 50)) / 100);
      const rate = DAY_RATES[m.role] ?? 2000;
      const cost = days * rate;
      const revenue = cost * (SELL_MULTIPLIER[m.role] ?? 1.5);
      return { role: m.role, days, cost, revenue };
    });
  const totalCost = wedge.reduce((s, r) => s + r.cost, 0);
  const totalRev = wedge.reduce((s, r) => s + r.revenue, 0);
  const margin = totalRev > 0 ? ((totalRev - totalCost) / totalRev) * 100 : 0;
  let verdict: PricingModel["verdict"];
  if (totalRev === 0) verdict = "red";
  else if (margin >= args.targetMarginPct) verdict = "green";
  else if (margin >= args.targetMarginPct - 10) verdict = "amber";
  else verdict = "partner_override_required";
  return {
    totalRevenueUsd: Math.round(totalRev),
    totalCostUsd: Math.round(totalCost),
    marginPct: Math.round(margin * 10) / 10,
    verdict,
    wedgeChart: wedge,
  };
}

function mockCompliance(args: {
  rfpRequirements: { id: string; requirement: string; severity: string }[];
  proposalSections: { id: string; name: string; content: string }[];
}): { matrix: ComplianceMatrixRow[]; overall: "green" | "red" } {
  if (args.rfpRequirements.length === 0) {
    return { matrix: [], overall: "green" };
  }
  const matrix = args.rfpRequirements.map((r) => {
    const needles = r.requirement.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const hit = args.proposalSections.find((s) =>
      needles.some((n) => s.content.toLowerCase().includes(n)),
    );
    if (hit) {
      return { rfpReqId: r.id, requirement: r.requirement, status: "green" as const, evidence: `${hit.name}: matched on '${needles.find((n) => hit.content.toLowerCase().includes(n))}'` };
    }
    return { rfpReqId: r.id, requirement: r.requirement, status: "red" as const, evidence: "No evidence found in proposal." };
  });
  const overall: "green" | "red" = matrix.every((m) => m.status === "green") ? "green" : "red";
  return { matrix, overall };
}

function mockProposal(args: {
  opportunityId: string;
  sectionsRequired: string[];
  teamProposed: { role: string; alloc: number }[];
  pricingIntent: { targetMarginPct: number; durationWeeks: number };
  rfpRequirements: { id: string; requirement: string; severity: string }[];
}): ProposalComposerOutput {
  const sectionLib: Record<string, { name: string; owner: string; content: (oid: string) => string }> = {
    cover: {
      name: "Cover",
      owner: "brand_profile_writer",
      content: (oid) => `Proposal cover for ${oid}.`,
    },
    exec_summary: {
      name: "Executive Summary",
      owner: "context_writer",
      content: (oid) => `Executive summary for ${oid}: a focused, senior-overseen agentic engagement with bilingual EN/AR coverage and an audit trail. Three workstreams, twelve weeks, outcomes-tied pricing.`,
    },
    hypothesis: {
      name: "Hypothesis",
      owner: "context_writer",
      content: () => `We believe agentifying the top-priority services with senior oversight will compress cycle time by ≥40% and lift CSAT by ≥6 points within 90 days, without hiring growth.`,
    },
    company_profile: {
      name: "Company Profile",
      owner: "brand_profile_writer",
      content: () => `(rendered from the published Firm Profile — see Company Profile section below.)`,
    },
    value_case: {
      name: "Value Case",
      owner: "approach_writer",
      content: () => `Value bridge: 1) Cost-per-case −40% via senior-overseen drafter agents, 2) Cycle-time −60% via parallel agent + reviewer pipeline, 3) Audit posture lifted to ISO27001-aligned with full trail.`,
    },
    annexes: {
      name: "Annexes",
      owner: "context_writer",
      content: () => `Annex A — Reference architecture · Annex B — Data isolation diagram · Annex C — Sample audit report · Annex D — Bilingual style guide.`,
    },
    appendices: {
      name: "Appendices",
      owner: "context_writer",
      content: () => `Appendix 1 — Detailed CVs · Appendix 2 — Expanded case study deck · Appendix 3 — Tooling provenance.`,
    },
    context: {
      name: "Context",
      owner: "context_writer",
      content: (oid) => `Client context for ${oid}: bilingual EN/AR coverage required. Audit trail expected. Senior-overseen agentic operations.`,
    },
    approach: {
      name: "Approach",
      owner: "approach_writer",
      content: () => `Three MECE workstreams: (1) Agentify top-priority services with bilingual support, (2) Telemetry & adoption with audit trail, (3) Governance & ISO27001-aligned controls. Each promise maps to a workplan deliverable.`,
    },
    workplan: {
      name: "Workplan",
      owner: "workplan_writer",
      content: () => `Phase 1 (wks 1–4): discovery + 1 agent live. Phase 2 (wks 5–8): scale + telemetry. Phase 3 (wks 9–12): adoption + handover. Deliverables: discovery memo, agent runtime, telemetry dashboard, handover pack.`,
    },
    team: {
      name: "Team",
      owner: "team_bios_writer",
      content: () => `Partner (oversight), Engagement Lead (delivery), SME (domain), AI Engineer (build).`,
    },
    pricing: {
      name: "Pricing",
      owner: "pricing_analyst",
      content: () => `Time-and-materials with capped margin floor. See pricing model.`,
    },
    case_studies: {
      name: "Case Studies",
      owner: "case_study_picker",
      content: (oppId: string) => {
        // Mock Case Study Picker — ranks the firm portfolio against the
        // opportunity name and returns the top-3 credentials as one-pagers
        // so the section is real text the lead can review (not placeholder).
        const portfolio = [
          { id: "cs_acme_refunds", client: "ACME Retail", sector: "Retail",
            outcome: "Refund triage cycle 5d → 18h with senior-overseen agents.",
            metric: "Cost / case −41%, CSAT +9pts" },
          { id: "cs_nile_kyc", client: "Nile Bank", sector: "Financial services",
            outcome: "KYC packet checks: 92% straight-through with reviewer signoff.",
            metric: "Throughput ×3.2, SLA breaches −68%" },
          { id: "cs_maw_rfp", client: "Mawared Group", sector: "Public sector advisory",
            outcome: "RFP response time 11d → 3d with Composer + compliance matrix.",
            metric: "Win-rate +14pts on shortlisted bids" },
          { id: "cs_zaha_engops", client: "Zaha Insurance", sector: "Insurance",
            outcome: "Claims engineering ops with bilingual EN/AR drafter agents.",
            metric: "Backlog −55%, audit findings 0" },
          { id: "cs_thuraya_ai", client: "Thuraya Telco", sector: "Telecom",
            outcome: "Tier-2 ticket routing with confidence-thresholded escalation.",
            metric: "First-contact resolution +22%" },
        ];
        const focus = oppId.toLowerCase();
        // Cheap relevance ranking: any portfolio entry whose sector token
        // appears in the opportunity id floats to the top; remainder fills.
        const ranked = [...portfolio].sort((a, b) => {
          const aHit = focus.includes(a.sector.toLowerCase().split(" ")[0]) ? 1 : 0;
          const bHit = focus.includes(b.sector.toLowerCase().split(" ")[0]) ? 1 : 0;
          return bHit - aHit;
        });
        const top3 = ranked.slice(0, 3);
        return [
          "Three relevant credentials selected from the Atelier portfolio:",
          "",
          ...top3.flatMap((c, i) => [
            `${i + 1}. ${c.client} — ${c.sector}`,
            `   Outcome: ${c.outcome}`,
            `   Impact: ${c.metric}`,
            `   Reference id: ${c.id}`,
            "",
          ]),
        ].join("\n");
      },
    },
    terms: {
      name: "Terms & Risk",
      owner: "terms_risk_writer",
      content: () => `IP retained by AICo until acceptance. Standard MNDA. PII isolation honored.`,
    },
    compliance: {
      name: "Compliance",
      owner: "compliance_reviewer",
      content: () => `See compliance matrix. ISO27001 evidence attached on request.`,
    },
  };
  const sections: ProposalSection[] = args.sectionsRequired.map((sid) => {
    const def = sectionLib[sid] ?? { name: sid, owner: "context_writer", content: () => `Section ${sid} draft.` };
    return {
      id: sid,
      name: def.name,
      ownerAgent: def.owner,
      status: "draft" as const,
      content: def.content(args.opportunityId),
      citations: [],
    };
  });
  const pricing = mockPricing({ team: args.teamProposed, durationWeeks: args.pricingIntent.durationWeeks, targetMarginPct: args.pricingIntent.targetMarginPct });
  const compliance = mockCompliance({ rfpRequirements: args.rfpRequirements, proposalSections: sections.map((s) => ({ id: s.id, name: s.name, content: s.content })) });
  // Mark statuses: pricing section = pricing verdict; compliance section = overall.
  sections.forEach((s) => {
    if (s.id === "pricing") {
      s.status = pricing.verdict === "green" ? "green" : pricing.verdict === "amber" ? "amber" : "red";
    } else if (s.id === "compliance") {
      s.status = compliance.overall;
    } else {
      s.status = "green";
    }
  });
  const winThemes = [
    "Senior-overseen agentic operations (no shadow autopilot).",
    "Bilingual EN/AR by default with audit trail.",
    "Outcomes-tied pricing with measurable adoption gates.",
  ];
  return {
    title: `Proposal — ${args.opportunityId}`,
    sections,
    pricingModel: pricing,
    winThemes,
    complianceMatrix: compliance.matrix,
    complianceOverall: compliance.overall,
  };
}

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
    const { value, costUsd, source, warning } = await callClaudeJson<ProposalComposerOutput>(
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
      () => mockProposal({
        opportunityId: args.opportunityId,
        sectionsRequired: args.sectionsRequired,
        teamProposed: args.teamProposed,
        pricingIntent: args.pricingIntent,
        rfpRequirements: args.rfpRequirements,
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
      source,
      warning,
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

function mockBrandProfile(args: {
  firmName: string;
  existingProfile?: Partial<BrandProfileOutput> | null;
  userBrief?: string | null;
}): BrandProfileOutput {
  const existing = args.existingProfile ?? {};
  return {
    firmName: existing.firmName ?? args.firmName,
    tagline: existing.tagline ?? "Senior-overseen agentic operations.",
    missionStatement:
      existing.missionStatement ??
      "We operationalise agentic systems for ambitious firms in the GCC. Senior partners stay on the wheel; the audit trail is the proof. Bilingual EN/AR by default.",
    voiceAttributes: existing.voiceAttributes ?? [
      "Senior-overseen",
      "Audit-trailed",
      "Bilingual EN/AR",
      "Outcomes-tied",
      "Concrete, never theatrical",
    ],
    principles: existing.principles ?? [
      { name: "No shadow autopilot", description: "Every consequential action is reviewed by a senior before it ships." },
      { name: "Evidence over rhetoric", description: "Every claim cites a metric or a source — never both empty." },
      { name: "Bilingual by default", description: "EN/AR coverage is built in, not retrofitted." },
      { name: "Audit-first build", description: "Trails are designed before features." },
    ],
    boilerplateShort:
      existing.boilerplateShort ??
      `${args.firmName} operationalises agentic systems for GCC firms. Senior-overseen, audit-trailed, bilingual EN/AR. We ship outcomes, not pilots.`,
    boilerplateLong:
      existing.boilerplateLong ??
      `${args.firmName} is a senior-led agentic operations firm working with banks, telcos, public-sector advisory and insurance carriers in the GCC. We design, build and run agent pipelines that compress cycle time and lift first-contact resolution while keeping a full audit trail. Our partners stay on the wheel — every consequential action is reviewed by a senior before it ships. Engagements are bilingual EN/AR by default and ISO27001-aligned.`,
    capabilitiesPitch:
      existing.capabilitiesPitch ??
      "We cover the agent operating loop end-to-end: discovery and policy mapping; agent build with senior reviewer pipelines; bilingual drafting; telemetry and adoption; governance and ISO27001-aligned controls. Engagements are typically 12 weeks with outcomes-tied pricing and partner-approved go-lives.",
    differentiators: existing.differentiators ?? [
      "Senior-on-the-wheel pattern with explicit reviewer queues — no shadow autopilot",
      "Bilingual EN/AR drafter agents from day one",
      "ISO27001-aligned audit trail wired before features ship",
      "Outcomes-tied pricing with partner-overrideable margin floors",
    ],
    proofPoints: existing.proofPoints ?? [
      { label: "ACME Retail refund triage", metric: "Cycle 5d → 18h, cost/case −41%" },
      { label: "Nile Bank KYC packets", metric: "92% straight-through with reviewer signoff" },
      { label: "Mawared RFP responses", metric: "11d → 3d response, win-rate +14pts" },
    ],
    legalEntities: existing.legalEntities ?? [
      { name: `${args.firmName} DIFC Ltd`, jurisdiction: "DIFC, UAE" },
      { name: `${args.firmName} KSA`, jurisdiction: "Riyadh, Saudi Arabia" },
    ],
    contactBlock:
      existing.contactBlock ??
      `Gate Village 4, DIFC, Dubai\nfirm@${args.firmName.toLowerCase().replace(/\s+/g, "")}.ai\n+971 4 000 0000`,
    brandColors: existing.brandColors ?? { primary: "#0f172a", ink: "#0f172a", gold: "#b8852b" },
  };
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
    const { value, costUsd, source, warning } = await callClaudeJson<BrandProfileOutput>(
      "claude-sonnet-4-5",
      system,
      JSON.stringify({
        firmName: args.firmName,
        existingProfile: args.existingProfile ?? null,
        userBrief: args.userBrief ?? null,
        evidenceCorpus: [],
      }),
      () => mockBrandProfile({ firmName: args.firmName, existingProfile: args.existingProfile, userBrief: args.userBrief }),
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
      source,
      warning,
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

export interface CartographerOutput {
  account: {
    refreshedSummary: string;
    // Sourced strategic priorities. `text` mirrors the v1 string list,
    // `sourceUrls` contains the citation URLs the agent pulled (Task #275).
    strategicPriorities: Array<{ text: string; sourceUrls: string[] }>;
    aicoHypothesis: string;
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
  }>;
}

function mockCartographer(args: {
  accountName: string;
  sector: string;
  country: string;
}): CartographerOutput {
  // Mock fallback only — used when the Anthropic key is missing or the
  // web_search call errors. Marked low-confidence so the UI surfaces it
  // as "deterministic mock data — do NOT treat as evidence".
  return {
    account: {
      refreshedSummary: `${args.accountName} (mock fallback) — ${args.sector} player in ${args.country}. Real cartographer call did not run.`,
      strategicPriorities: [],
      aicoHypothesis: "",
    },
    sourceSignals: [],
    decisionMakers: [],
  };
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
  fallback: () => T,
  opts: { maxSearches?: number } = {},
): Promise<{
  value: T;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  source: "claude" | "mock_config" | "mock_fallback";
  warning?: string;
  citationUrls: Array<{ url: string; title?: string }>;
}> {
  if (MOCK_MODE) {
    return {
      value: fallback(),
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      source: "mock_config",
      citationUrls: [],
    };
  }
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  try {
    const ac = new AbortController();
    const timeoutMs = Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 90_000);
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const resp = await anthropic.messages
      .create(
        {
          model,
          max_tokens: 8192,
          system: `${systemPrompt}\n\nIMPORTANT: After your research is complete, your FINAL message MUST contain ONLY one JSON object that matches the schema. No prose, no code fences.`,
          messages: [{ role: "user", content: userPrompt }],
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: opts.maxSearches ?? 6,
            },
          ],
        },
        { signal: ac.signal },
      )
      .finally(() => clearTimeout(timer));
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
    // Extract JSON object even if model wrapped it in stray text.
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    const json =
      firstBrace >= 0 && lastBrace > firstBrace
        ? stripped.slice(firstBrace, lastBrace + 1)
        : stripped;
    const value = JSON.parse(json) as T;
    // Harvest citation URLs from web_search_tool_result blocks.
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
    return { value, costUsd, tokensIn, tokensOut, source: "claude", citationUrls };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      "[atelier-agents] Cartographer web_search call failed; returning mock-fallback:",
      msg,
    );
    return {
      value: fallback(),
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      source: "mock_fallback",
      warning: `Cartographer web_search call failed (${msg.slice(0, 160)}); output is deterministic mock — do NOT treat as evidence.`,
      citationUrls: [],
    };
  }
}

export async function runAccountCartographer(args: {
  accountId: string;
  accountName: string;
  accountSector: string;
  accountCountry: string;
  accountHqCity?: string | null;
  triggeredByUserId: string | null;
  actorLabel: string;
  focusOpportunityId?: string | null;
}): Promise<{ runId: string; output: CartographerOutput; costUsd: number; source: "claude" | "mock_config" | "mock_fallback"; warning?: string }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "account_cartographer",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "account",
    targetId: args.accountId,
    targetLabel: args.accountName,
    inputs: { focusOpportunityId: args.focusOpportunityId ?? null },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("account_cartographer");
    await progressRun(runId, 25, "Searching the public web");
    const { value, costUsd, source, warning, citationUrls } =
      await callClaudeJsonWithWebSearch<CartographerOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          accountName: args.accountName,
          accountCountry: args.accountCountry,
          accountSector: args.accountSector,
          accountHqCity: args.accountHqCity ?? null,
        }),
        () =>
          mockCartographer({
            accountName: args.accountName,
            sector: args.accountSector,
            country: args.accountCountry,
          }),
      );
    await progressRun(runId, 80, "Triangulating sources", {
      name: "cart.synth",
      durationMs: Date.now() - t0,
    });

    // Defensive normalisation — the model occasionally returns the v1
    // shape (strategicPriorities: string[]) or omits decisionMakers.
    // Coerce so the route handler can rely on the v2 shape.
    const normalised: CartographerOutput = {
      account: {
        refreshedSummary: value?.account?.refreshedSummary ?? "",
        strategicPriorities: Array.isArray(value?.account?.strategicPriorities)
          ? value.account.strategicPriorities
              .map((p) =>
                typeof p === "string"
                  ? { text: p, sourceUrls: [] as string[] }
                  : { text: String(p?.text ?? ""), sourceUrls: Array.isArray(p?.sourceUrls) ? p.sourceUrls.filter((u): u is string => typeof u === "string") : [] },
              )
              .filter((p) => p.text.trim().length > 0)
          : [],
        aicoHypothesis: value?.account?.aicoHypothesis ?? "",
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
            }))
        : [],
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

    await completeRun({
      runId,
      output: normalised as unknown,
      confidence: source === "claude" ? "green" : "amber",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: normalised.sourceSignals.length,
      actorLabel: args.actorLabel,
      targetType: "account",
      targetId: args.accountId,
      targetLabel: args.accountName,
      source,
      warning,
    });
    return { runId, output: normalised, costUsd, source, warning };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "account", targetId: args.accountId });
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

function mockWhitespace(accountName: string): WhitespaceOutput {
  const offerings = [
    "Diagnostic Sprint",
    "POV / Worked Example",
    "Agentic Build",
    "Operating Model Re-design",
    "Compound Workshop",
  ];
  const personas = ["CEO", "COO", "CIO", "CDO", "Business Head", "Procurement"];
  const cells = offerings.flatMap((o) =>
    personas.map((p) => {
      // Deterministic-ish state pattern.
      const k = (o.length + p.length) % 5;
      const state =
        k === 0 ? "won" : k === 1 || k === 2 ? "qualified" : k === 3 ? "identified" : "empty";
      return {
        offering: o,
        persona: p,
        state: state as "empty" | "identified" | "qualified" | "won",
        note: state === "empty" ? undefined : `${o} fits ${p}'s pain on adoption velocity at ${accountName}.`,
        rationale: state === "empty" ? undefined : "Triangulated from prior engagements and stated priorities.",
      };
    }),
  );
  return {
    offerings,
    personas,
    cells,
    priorityMoves: [
      `Open a Diagnostic Sprint conversation with the CIO at ${accountName} this quarter.`,
      `Position an Agentic Build worked-example for the COO around shared-services intake.`,
      `Pre-brief Procurement on framework agreement to compress cycle time.`,
    ],
  };
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
    const { value, costUsd, source, warning } = await callClaudeJson<WhitespaceOutput>(
      "claude-haiku-4-5",
      "You are Whitespace Mapper. Produce an offerings × personas matrix with grounded rationales.",
      JSON.stringify({ accountName: args.accountName }),
      () => mockWhitespace(args.accountName),
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
      source,
      warning,
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

function mockQbr(accountName: string): QbrOutput {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  return {
    periodLabel: `Q${q} ${now.getUTCFullYear()} — ${accountName}`,
    sections: [
      {
        heading: "What changed this quarter",
        body: `${accountName} accelerated its AI program with a board-level mandate; CIO transition triggered a fresh procurement cycle. AICo posture has shifted from inbound-curiosity to active-pursuit on two named opportunities.`,
      },
      {
        heading: "Where we created value",
        body: `Diagnostic Sprint surfaced 9 agentifiable workflows; the worked-example for shared-services intake scored highest on adoption-readiness. Engagement lead recommends doubling down on this thread.`,
      },
      {
        heading: "Where we lost ground",
        body: `Two competitive pitches landed in parallel; commercial gating on procurement velocity slowed our scoping conversation by 3 weeks. Mitigation: pre-brief Procurement before next pursuit.`,
      },
      {
        heading: "Compound — what to ship into Knowledge Atelier",
        body: `The shared-services intake worked-example, the procurement playbook delta, and the CIO transition handoff template all warrant promotion to firm-wide assets.`,
      },
    ],
    riskFlags: [
      "Procurement velocity remains the single biggest pursuit risk.",
      "Sponsor concentration: hypothesis depends on one CIO relationship — broaden coverage to COO and CDO.",
    ],
    nextMoves: [
      "Schedule pre-procurement workshop within 30 days.",
      "Open Whitespace conversation with COO around adoption playbook.",
      "Convert worked-example to a publishable Credential after partner review.",
    ],
  };
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
    const { value, costUsd, source, warning } = await callClaudeJson<QbrOutput>(
      "claude-sonnet-4-5",
      "You are QBR Composer. Produce a quarterly business-review canvas: what changed, where we created value, where we lost ground, what to compound. Honest, evidence-bound.",
      JSON.stringify({ accountName: args.accountName }),
      () => mockQbr(args.accountName),
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
      source,
      warning,
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
      source: "mock_config",
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
  source: "claude" | "mock_config" | "mock_fallback";
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
        "You are AICo's Pricing Strategist. Numbers are precomputed and authoritative — never invent or alter them. Author the Partner-facing narrative.";
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
      () => ({ narrative: fallbackNarrative, talkingPoints: fallbackTalkingPoints, risks: fallbackRisks }),
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
      source: llm.source,
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
      source: llm.source,
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

function mockWinLoss(args: {
  oppName: string;
  outcome: string;
  sellerReasons: string[];
  transcript: string | null;
}): WinLossInterviewerOutput {
  const won = args.outcome === "signed";
  const lost = !won;
  const t = args.transcript ?? "";
  // Pick a verbatim quote from transcript ONLY. If no transcript, return
  // an empty quote and the post-call evidence-binding filter will drop the
  // theme. Mock must NOT fabricate evidence — that would defeat PRD §5.2's
  // "no transcript = no themes" rule.
  const quote =
    t
      .split(/[.\n!?]/)
      .map((s) => s.trim())
      .find((s) => s.length >= 12 && s.length <= 180) ?? "";

  return {
    buyerAuthenticReasons: lost
      ? [
          "Felt the proposal didn't address the operational risk of the cut-over weekend.",
          "Pricing alternative from incumbent was 18% lower; couldn't justify the delta to the CFO without a sharper outcome anchor.",
          "Internal champion changed roles mid-cycle; replacement defaulted to status quo.",
        ]
      : [
          "Trusted the senior delivery story — 'we'd see Mounir on Tuesdays' was the line that closed it.",
          "Speed-to-value plan was concrete; 90-day milestones with named owners.",
          "Partner countersign on the discount removed CFO objection.",
        ],
    hiddenCompetitor: lost ? "status_quo" : "unknown",
    themes: [
      {
        name: won ? "We win on senior delivery" : "We lose to status quo when senior story is implied",
        tag: "senior_delivery",
        evidenceQuote: quote,
        polarity: won ? "win" : "loss",
      },
      {
        name: won ? "Speed-to-value is the closer" : "Pricing wedge requires a sharper outcome anchor",
        tag: won ? "speed_to_value" : "pricing_wedge",
        evidenceQuote: quote,
        polarity: won ? "win" : "loss",
      },
    ],
    whatWeWouldDoDifferently: lost
      ? `On ${args.oppName}, we should have priced an outcome-based alternative on slide 1, not slide 12; and we should have rebooted the champion plan the moment the COO moved roles.`
      : `On ${args.oppName}, the only refinement is to bring the audit-grade governance demo into discovery — it earned the trust we cashed in at signature.`,
    suggestedAtelierLessons: [
      {
        title: won ? `${args.oppName}: senior-delivery proof point` : `${args.oppName}: status-quo recovery playbook`,
        abstract: won
          ? "Verbatim partner-on-the-pitch story bound to the close. Reusable in Pursue-stage proposals as a positioning line."
          : "Champion-departure recovery moves: rebooting trust ladder, outcome-anchor reset, escalating to second exec sponsor.",
        kind: won ? "case_study" : "learning",
      },
    ],
    confidence: t.length > 200 ? "amber" : "red",
  };
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
      const { value, costUsd, source, warning } = await callClaudeJson<WinLossInterviewerOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          opportunity_name: args.opportunityName,
          outcome: args.outcome,
          seller_perceived_reasons: args.sellerPerceivedReasons,
          buyer_transcript: args.buyerTranscript ?? "",
        }),
        () =>
          mockWinLoss({
            oppName: args.opportunityName,
            outcome: args.outcome,
            sellerReasons: args.sellerPerceivedReasons,
            transcript: args.buyerTranscript,
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
        source,
        warning,
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

function mockThemeCurator(args: {
  debriefThemes: Array<{ tag: string; name: string; polarity: string; debriefId: string; quote: string }>;
  openOpportunityIds: string[];
}): ThemeCuratorOutput {
  // Group by tag.
  const byTag = new Map<string, typeof args.debriefThemes>();
  for (const t of args.debriefThemes) {
    const arr = byTag.get(t.tag) ?? [];
    arr.push(t);
    byTag.set(t.tag, arr);
  }
  const upserts: ThemeCuratorOutput["upsertThemes"] = [];
  for (const [tag, group] of byTag) {
    const polarity = group[0]?.polarity === "loss" ? "loss" : "win";
    upserts.push({
      tag,
      name: group[0]?.name ?? tag,
      description: `${group.length} closed deals reference this theme.`,
      polarity,
      contributingDebriefIds: [...new Set(group.map((g) => g.debriefId))],
      offeringTags: [],
      sectorTags: [],
      positioningLine:
        polarity === "win"
          ? `AICo wins on ${tag.replace(/_/g, " ")} — proven across ${group.length} closed deals.`
          : `Where AICo loses on ${tag.replace(/_/g, " ")}, the recovery move is to lead with senior delivery.`,
    });
  }
  return {
    upsertThemes: upserts,
    emergentThemes: [],
    openProposalSuggestions: args.openOpportunityIds.slice(0, 3).map((id) => ({
      opportunityId: id,
      themeTag: upserts[0]?.tag ?? "senior_delivery",
      rationale: "Top-supported active theme; insert as positioning line in Composer draft.",
    })),
    confidence: "amber",
  };
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
      const { value, costUsd, source, warning } = await callClaudeJson<ThemeCuratorOutput>(
        "claude-sonnet-4-5",
        system,
        JSON.stringify({
          debrief_themes: args.debriefThemes,
          open_opportunity_ids: args.openOpportunityIds,
        }),
        () => mockThemeCurator(args),
      );
      await ctx.progress(85, "Refreshing library");
      return {
        output: value,
        costUsd,
        confidence: value.confidence,
        source,
        warning,
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
// All four are mock-first per ATELIER_MOCK_AGENTS=1; live Claude calls are
// not wired in this scope. They follow the same startRun → progressRun →
// completeRun → audit pattern so the Agents tab and audit feed work.

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
      source: "mock_config",
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
      source: "mock_config",
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
      source: "mock_config",
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
      source: "mock_config",
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
    //    work the employee performed via an agent (Maven, pricing, etc.).
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
      source: "mock_config",
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

function mockUtilizationAnalyst(
  view: string,
  targetLabel: string,
  numericBlock: Record<string, unknown> | null,
): UtilizationAnalystOutput {
  if (!numericBlock || Object.keys(numericBlock).length === 0) {
    return {
      refusal: "numeric-block-missing-or-stale",
      headline: null,
      narrative: null,
      risks: [],
      actions: [],
      confidence: "red",
    };
  }
  const u = (numericBlock as { utilizationPct?: number }).utilizationPct ?? 0;
  const t = (numericBlock as { targetPct?: number }).targetPct ?? 0;
  const r = (numericBlock as { realizationPct?: number }).realizationPct ?? 0;
  const variance = u - t;
  const headline =
    variance < -0.1
      ? `${targetLabel} is ${Math.abs(variance * 100).toFixed(0)} pts under target on ${view}-view utilization.`
      : variance > 0.1
        ? `${targetLabel} is running hot — ${(u * 100).toFixed(0)}% utilization vs ${(t * 100).toFixed(0)}% target.`
        : `${targetLabel} is on plan: ${(u * 100).toFixed(0)}% utilization vs ${(t * 100).toFixed(0)}% target.`;
  const narrative = [
    `Rolling utilization sits at ${(u * 100).toFixed(0)}% against a target of ${(t * 100).toFixed(0)}%.`,
    r > 0
      ? `Realization rate is ${(r * 100).toFixed(0)}% — every 100 billable hours convert to ${(r * 100).toFixed(0)} invoiced hours at full rate.`
      : `Realization rate not yet computed for this view.`,
    variance < -0.1
      ? `Action: rebench or rotate — current trajectory misses the FY plan by Q+2.`
      : `Hold the line; reforecast at next QBR.`,
  ].join("\n\n");
  const risks =
    variance < -0.1
      ? [{ id: rid("rk"), severity: "red" as const, statement: `Utilization gap of ${Math.abs(variance * 100).toFixed(0)} pts on ${targetLabel}.` }]
      : variance < -0.05
        ? [{ id: rid("rk"), severity: "amber" as const, statement: `Utilization slipping on ${targetLabel}.` }]
        : [];
  const actions =
    variance < -0.05
      ? [
          { id: rid("ax"), action: `Re-look pricing on the engagement(s) feeding ${targetLabel}.`, owner: "Partner" },
          { id: rid("ax"), action: `Rebench underutilized roles into the next pursuit.`, owner: "Operations" },
        ]
      : [];
  return {
    refusal: null,
    headline,
    narrative,
    risks,
    actions,
    confidence: variance < -0.1 ? "red" : variance < -0.05 ? "amber" : "green",
  };
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
          source: "mock_config",
          warning: computedAtStale
            ? `numeric-block-stale (computedAt ${args.computedAt}); refused to generate narrative`
            : "numeric-block-missing; refused to generate narrative",
        };
      }
      // Fail-fast on missing prompt — consistent with every other agent in
      // this file. A missing prompt is a configuration defect, not a
      // runtime condition to silently degrade through.
      const promptBody = loadPrompt("utilization_analyst");
      const userPrompt = JSON.stringify({
        view: args.view,
        targetId: args.targetId,
        targetLabel: args.targetLabel,
        period: args.period,
        numericBlock: args.numericBlock,
      });
      const { value, costUsd, source, warning } = await callClaudeJson<UtilizationAnalystOutput>(
        "claude-haiku-4-5",
        promptBody,
        userPrompt,
        () => mockUtilizationAnalyst(args.view, args.targetLabel, args.numericBlock),
      );
      return {
        output: value,
        costUsd,
        confidence: value.confidence ?? "amber",
        source,
        warning,
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

function mockExpenseAuditor(input: ExpenseAuditorInput): ExpenseAuditorProposal {
  const ocr = input.ocr;
  if (!ocr || !ocr.confidence || ocr.confidence === "red") {
    return {
      category: "other",
      vatTreatment: "none",
      vatAmount: 0,
      clientBillable: false,
      markupPct: 0,
      summary: "OCR confidence too low — manual review required.",
      ocrConfidence: "red",
      refused: true,
      reason: "missing-or-zero-confidence-ocr",
    };
  }
  const country = (ocr.country || input.draft.country || "").toUpperCase();
  const treatment: ExpenseAuditorProposal["vatTreatment"] =
    country === "KSA" || country === "SA"
      ? "ksa_15"
      : country === "UAE" || country === "AE"
        ? "uae_5"
        : country && country !== "US"
          ? "zero_rated_export"
          : "none";
  const cat = (ocr.category ?? input.draft.category ?? "other") as ExpenseAuditorProposal["category"];
  // Billability: contract clause must permit. Default false.
  const cd = input.contractDigest;
  const clauseOk = !!cd?.expensesClause;
  const catPermitted = clauseOk && (!cd?.permittedCategories?.length || cd.permittedCategories.includes(cat));
  const billable = !!input.draft.engagementId && clauseOk && catPermitted;
  // Markup: clamp to engagement cap; default 0.
  const cap = cd?.expenseMarkupCapPct ?? 0;
  const proposed = billable ? Math.min(10, cap) : 0;
  const summary = billable
    ? `Auditor: classified ${cat}; billable to engagement at markup ${proposed}% (cap ${cap}%).`
    : input.draft.engagementId
      ? `Auditor: classified ${cat}; NOT billable — contract digest lacks an explicit ${cat} clause.`
      : `Auditor: classified ${cat}; firm-overhead (no engagement attached).`;
  return {
    category: cat,
    vatTreatment: treatment,
    vatAmount: ocr.tax ?? 0,
    clientBillable: billable,
    markupPct: proposed,
    summary,
    ocrConfidence: ocr.confidence,
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
      const { value, costUsd, source, warning } = await callClaudeJson<ExpenseAuditorProposal>(
        "claude-haiku-4-5",
        promptBody,
        userPrompt,
        () => mockExpenseAuditor(input),
      );
      return {
        output: value,
        costUsd,
        confidence: value.ocrConfidence ?? "amber",
        source,
        warning,
      };
    },
  );
  return { runId: result.runId, proposal: result.output as ExpenseAuditorProposal };
}

// ============================================================
// v5 — Task #355 — 15 new agents + 3 mode extensions
// ============================================================
//
// Each function below is a thin runAgent() composition over the v5 prompt
// of the same name. Output schemas in the registry are deliberately
// `.passthrough()` (the prompt's JSON contract is the strict shape), so
// these mocks return the minimum keys needed to keep the run row + UI
// preview meaningful when ATELIER_MOCK_AGENTS=1 or Claude is unreachable.

type V5GenericResult = { runId: string; output: Record<string, unknown>; costUsd: number };

async function runV5GenericAgent(args: {
  agentId: string;
  promptId: AtelierAgentId;
  promptVersion?: number;
  promptMode?: string;
  model: string;
  input: Record<string, unknown>;
  triggeredByUserId: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string;
  actorLabel: string;
  mock: () => Record<string, unknown>;
}): Promise<V5GenericResult> {
  const result = await runAgent(
    {
      agentId: args.agentId,
      input: args.input,
      triggeredByUserId: args.triggeredByUserId,
      targetType: args.targetType,
      targetId: args.targetId,
      targetLabel: args.targetLabel,
      actorLabel: args.actorLabel,
    },
    async (ctx) => {
      const system = loadPrompt(args.promptId, args.promptVersion ?? 1, args.promptMode);
      await ctx.progress(40, `Calling ${args.actorLabel}`);
      const { value, costUsd, source, warning } = await callClaudeJson<Record<string, unknown>>(
        args.model,
        system,
        JSON.stringify(args.input),
        args.mock,
      );
      const conf =
        (value.confidence as "green" | "amber" | "red" | undefined) ?? "amber";
      return { output: value, costUsd, confidence: conf, source, warning };
    },
  );
  return {
    runId: result.runId,
    output: result.output as Record<string, unknown>,
    costUsd: result.costUsd,
  };
}

// ---------- mocks (minimum-viable to satisfy v5Output passthrough) ----------

function mockLinkedInComposer(input: Record<string, unknown>): Record<string, unknown> {
  return {
    partnerId: input.partnerId ?? "",
    voiceProfileVersion: "1.0.0",
    variants: [
      {
        length: input.targetLength ?? "medium",
        body: "Mock LinkedIn post body — Partner voice profile not yet loaded in mock mode.",
        hashtags: ["#strategy"],
        wordCount: 14,
        voiceMatchScore: 0.78,
      },
    ],
    redactionsMade: [],
    confidence: "amber",
  };
}

function mockPressMonitor(input: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    windowStart: start.toISOString(),
    windowEnd: now.toISOString(),
    aicoMentions: [],
    partnerMentions: [],
    competitorThemes: [],
    opportunities: [],
    confidence: "amber",
  };
}

function mockFieldNotesScheduler(input: Record<string, unknown>): Record<string, unknown> {
  const issueMonth = (input.issueMonth as string) || new Date().toISOString().slice(0, 7);
  return {
    issueId: issueMonth,
    subjectLine: `Field Notes — ${issueMonth}`,
    preheader: "What we are seeing this month from the firm.",
    sections: [
      { id: "editors_note", artifactId: "", byline: "", summary: "" },
      { id: "what_we_seeing", items: [] },
      { id: "piece_worth", artifactId: "", teaser: "" },
      { id: "field_log", items: [] },
      { id: "hiring", roleIds: [] },
    ],
    scheduledSendAt: new Date().toISOString(),
    confidence: "amber",
  };
}

function mockAllianceChoreographer(input: Record<string, unknown>): Record<string, unknown> {
  return {
    opportunityId: input.opportunityId ?? "",
    partnerFirmId: input.partnerFirmId ?? "",
    leadParty: (input.leadParty as string) ?? "aico",
    split: { aicoPct: 60, partnerPct: 40, rationale: "Default 60/40 with AICo lead." },
    jointDeliveryPlan: [],
    commsCadence: { weekly: "Thu 30m", monthly: "first Mon", exec: "quarterly" },
    conflicts: [],
    allianceLetterStatus: "draft",
    confidence: "amber",
  };
}

function mockCertificationTracker(_input: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return {
    windowStart: now.toISOString(),
    windowEnd: new Date(now.getTime() + 90 * 86400000).toISOString(),
    lapsing: [],
    lapsed: [],
    partnerTierImpact: [],
    examBookings: [],
    confidence: "amber",
  };
}

function mockInterviewDesigner(input: Record<string, unknown>): Record<string, unknown> {
  return {
    roleId: input.roleId ?? "",
    candidateId: input.candidateId ?? "",
    panel: [
      {
        stage: "screen",
        interviewerId: "",
        durationMin: 30,
        focus: "Role fit + signal screen",
        questions: [
          { q: "Walk me through your most recent shipped project.", lookFor: "End-to-end ownership", anchors: { "1": "no ownership", "3": "shared", "5": "drove e2e" } },
        ],
      },
    ],
    takeHome: { prompt: "Build a small Atelier-style agent.", deliverable: "Repo + README", estHours: 4, rubric: [] },
    scorecard: { criteria: [{ name: "Technical depth", weight: 0.4, anchors: { "1": "shallow", "3": "solid", "5": "exceptional" } }] },
    confidence: "amber",
  };
}

function mockReferenceCaller(input: Record<string, unknown>): Record<string, unknown> {
  return {
    candidateId: input.candidateId ?? "",
    referenceId: input.referenceId ?? "",
    roleId: input.roleId ?? "",
    callMode: "live",
    consentVerified: true,
    summary: {
      workingRelationship: "Worked together for two years.",
      scope: "Mock — transcript not provided.",
      strengths: ["Mock strength A", "Mock strength B"],
      watchouts: ["Mock watchout"],
      wouldRehire: "yes",
      fitForRoleLevel: "at",
    },
    inconsistenciesWithResume: [],
    verbatimQuotes: [],
    confidence: "amber",
  };
}

function mockOfferComposer(input: Record<string, unknown>): Record<string, unknown> {
  return {
    candidateId: input.candidateId ?? "",
    roleId: input.roleId ?? "",
    jurisdiction: "ksa",
    letterMarkdown: "# Offer Letter\n\nMock content — comp band not loaded in mock mode.",
    compNarrative: {
      base: 0,
      variable: { target: 0, triggers: "" },
      equityOrCarry: { kind: "none", summary: "" },
      benefits: [],
      totalAtTarget: 0,
      marketComparable: { p25: 0, p50: 0, p75: 0 },
    },
    expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    confidence: "amber",
  };
}

function mockComplianceSentinel(input: Record<string, unknown>): Record<string, unknown> {
  return {
    framework: (input.controlFramework as string) ?? "soc2_type2",
    periodStart: input.periodStart ?? new Date(Date.now() - 90 * 86400000).toISOString(),
    periodEnd: input.periodEnd ?? new Date().toISOString(),
    controls: [
      {
        id: "CC6.1",
        title: "Logical access",
        status: "passing",
        evidenceArtifactIds: ["evidence:mock"],
        lastCollectedAt: new Date().toISOString(),
        owner: "compliance@aico",
        remediation: "",
      },
    ],
    gaps: [],
    evidencePackUrl: "",
    confidence: "amber",
  };
}

function mockIncidentResponder(input: Record<string, unknown>): Record<string, unknown> {
  return {
    incidentId: input.incidentId ?? "",
    severity: input.severity ?? "sev3",
    phase: "detect",
    timeline: [
      { at: new Date().toISOString(), actor: "ag_incident_responder", action: "intake", evidenceUrl: "" },
    ],
    containmentActions: [],
    customerCommsDraft: { audience: "", subject: "", body: "", legalReviewedAt: "" },
    rootCauseHypothesis: "",
    postMortem: { fiveWhys: [], actionItems: [] },
    confidence: "amber",
  };
}

function mockDsarConcierge(input: Record<string, unknown>): Record<string, unknown> {
  const intake = new Date();
  return {
    dsarId: input.dsarId ?? "",
    jurisdiction: input.jurisdiction ?? "gdpr",
    requestKind: input.requestKind ?? "access",
    intakeAt: intake.toISOString(),
    statutoryDueAt: new Date(intake.getTime() + 30 * 86400000).toISOString(),
    phase: "intake",
    discoveredArtifacts: [],
    responseLetterMarkdown: "",
    responsePacketUrl: "",
    confidence: "amber",
  };
}

function mockBackupAuditor(_input: Record<string, unknown>): Record<string, unknown> {
  return {
    periodStart: new Date(Date.now() - 90 * 86400000).toISOString(),
    periodEnd: new Date().toISOString(),
    stores: [],
    restoreDrill: {
      performedAt: new Date().toISOString(),
      sampledArtifactId: "mock",
      restoredOk: true,
      rtoMinutes: 30,
      rpoMinutes: 5,
      notes: "Mock drill — no real restore performed.",
    },
    alerts: [],
    confidence: "amber",
  };
}

function mockIpSteward(_input: Record<string, unknown>): Record<string, unknown> {
  return {
    windowStart: new Date(Date.now() - 180 * 86400000).toISOString(),
    windowEnd: new Date().toISOString(),
    freshnessNags: [],
    unlicensedAssets: [],
    engagementUseWithoutGrant: [],
    ownerSwapRequests: [],
    confidence: "amber",
  };
}

function mockOssComplianceSentinel(input: Record<string, unknown>): Record<string, unknown> {
  return {
    repoId: input.repoId ?? "",
    scannedAt: new Date().toISOString(),
    dependencies: [],
    blockers: [],
    exceptions: [],
    confidence: "amber",
  };
}

function mockDemoEnvironmentCurator(input: Record<string, unknown>): Record<string, unknown> {
  return {
    demoId: input.demoId ?? "",
    url: "",
    ownerId: "",
    lastCheckedAt: new Date().toISOString(),
    uptime30d: 0.99,
    lastDeployAt: new Date().toISOString(),
    screenshotUrl: "",
    scriptDrift: [],
    freshness: "fresh",
    confidence: "amber",
  };
}

// ---------- run<X> entrypoints ----------

export interface V5RunCommonArgs {
  triggeredByUserId: string | null;
  actorLabel?: string;
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
    mock: () => mockLinkedInComposer(input as unknown as Record<string, unknown>),
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
    mock: () => mockPressMonitor(input as unknown as Record<string, unknown>),
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
    mock: () => mockFieldNotesScheduler(input as unknown as Record<string, unknown>),
  });
}

export async function runAllianceChoreographer(
  input: { opportunityId: string; partnerFirmId: string; leadParty?: "aico" | "partner"; proposedSplitPct?: number } & V5RunCommonArgs,
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
    mock: () => mockAllianceChoreographer(input as unknown as Record<string, unknown>),
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
    mock: () => mockCertificationTracker(input as unknown as Record<string, unknown>),
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
    mock: () => mockInterviewDesigner(input as unknown as Record<string, unknown>),
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
    mock: () => mockReferenceCaller(input as unknown as Record<string, unknown>),
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
    mock: () => mockOfferComposer(input as unknown as Record<string, unknown>),
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
    mock: () => mockComplianceSentinel(input as unknown as Record<string, unknown>),
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
    mock: () => mockIncidentResponder(input as unknown as Record<string, unknown>),
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
    mock: () => mockDsarConcierge(input as unknown as Record<string, unknown>),
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
    mock: () => mockBackupAuditor(input as unknown as Record<string, unknown>),
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
    mock: () => mockIpSteward(input as unknown as Record<string, unknown>),
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
    mock: () => mockOssComplianceSentinel(input as unknown as Record<string, unknown>),
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
    mock: () => mockDemoEnvironmentCurator(input as unknown as Record<string, unknown>),
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
    mock: () => ({
      title: "Mock press POV",
      thesis: "Mock thesis suitable for a press byline.",
      sections: [],
      confidence: "amber",
    }),
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
    mock: () => ({
      partnerFirmId: input.partnerFirmId,
      relationships: [],
      jointPursuits: [],
      confidence: "amber",
    }),
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
    mock: () => ({
      roleId: input.roleId,
      candidateBriefs: [],
      facts: [],
      confidence: "amber",
    }),
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
// complete | fail` pattern. Mock outputs are deterministic so CLI
// smoke fixtures (W1-S8) and the /codex UI (W1-S10) can render
// against them with `ATELIER_MOCK_AGENTS=1`.
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
    side: "aico" | "counterparty";
    role: "signer" | "witness" | "notice_party" | "observer";
    signerName: string;
    signerEmail: string;
    signerTitle: string;
  }>;
  metadata: Record<string, unknown>;
}

function mockContractComposer(
  input: ContractComposerInput,
): ContractComposerOutput {
  const eligible = input.clauseLibrary
    .filter((c) =>
      c.instrumentTypes.length === 0 ||
      c.instrumentTypes.includes(input.instrumentType),
    )
    .filter(
      (c) =>
        c.jurisdictionTags.length === 0 ||
        c.jurisdictionTags.includes(input.counterparty.jurisdiction),
    )
    .slice(0, 8);
  const proposedClauses = eligible.map((c, i) => ({
    clauseId: c.id,
    position: i,
    customizations: null,
    whyChosen: `${c.family} clause matches ${input.instrumentType.toUpperCase()} for ${input.counterparty.jurisdiction || "unspecified jurisdiction"}.`,
  }));
  const flaggedRisks: ContractComposerOutput["flaggedRisks"] = [];
  if (eligible.length === 0) {
    flaggedRisks.push({
      severity: "high",
      summary:
        "No clause-library entries matched this instrument + jurisdiction. Partner review required before sending.",
    });
  }
  if (
    input.opportunity?.scopeSummary?.toLowerCase().includes("personal data") &&
    input.instrumentType !== "dpa"
  ) {
    flaggedRisks.push({
      severity: "high",
      summary:
        "Scope mentions personal data; a separate DPA must be referenced before signing.",
    });
  }
  const titleLine = `${input.instrumentType.toUpperCase()} — ${input.counterparty.legalName}${input.opportunity ? " — " + input.opportunity.name : ""}`;
  const body = [
    `# ${titleLine}`,
    "",
    `**Counterparty:** ${input.counterparty.legalName} (${input.counterparty.jurisdiction || "—"})`,
    `**Payment terms:** ${input.counterparty.paymentTermsDays} days`,
    input.opportunity
      ? `**Estimated value:** ${input.opportunity.currency} ${input.opportunity.dealSizeUsd.toLocaleString()}`
      : "",
    "",
    ...eligible.flatMap((c) => [
      `## ${c.title}`,
      c.body,
      "",
    ]),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    renderedBody: body,
    renderedBodyFormat: "markdown",
    proposedClauses,
    flaggedRisks,
    partiesProposed: [
      {
        side: "aico",
        role: "signer",
        signerName: "AICo Partner — to be assigned",
        signerEmail: "partner@aico.example",
        signerTitle: "Partner",
      },
      {
        side: "counterparty",
        role: "signer",
        signerName: `${input.counterparty.legalName} — authorised signatory`,
        signerEmail: "signer@counterparty.example",
        signerTitle: "Authorised signatory",
      },
    ],
    metadata: {
      instrumentType: input.instrumentType,
      counterpartyId: input.counterparty.id,
      engagementId: input.engagement?.id ?? null,
      opportunityId: input.opportunity?.id ?? null,
    },
  };
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
    const { value, costUsd, source, warning } =
      await callClaudeJson<ContractComposerOutput>(
        "claude-sonnet-4-6",
        system,
        JSON.stringify(input),
        () => mockContractComposer(input),
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
      source,
      warning,
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

function mockRedlineAnalyst(input: RedlineAnalystInput): RedlineAnalystOutput {
  const beforeLen = input.latestVersion.renderedBody.length;
  const afterLen = input.inboundBody.length;
  const drift = Math.abs(afterLen - beforeLen);
  const looksMaterial = drift > 200;
  const redlines: RedlineAnalystOutput["redlines"] = looksMaterial
    ? [
        {
          clauseId: input.clauseLibraryAtSend[0]?.id ?? null,
          positionHint: 0,
          proposedBody: input.inboundBody.slice(0, 240),
          diff: {
            before: input.latestVersion.renderedBody.slice(0, 240),
            after: input.inboundBody.slice(0, 240),
            ops: [],
          },
          riskTier: "medium",
          riskCommentary:
            "Material drift detected vs. last AICo version (mock heuristic). Human review recommended.",
          recommendation: "accept_with_conditions",
          rationale:
            "Counterparty changed clause body length materially; partner should review the actual diff before accepting.",
        },
      ]
    : [];
  const overall: RedlineAnalystOutput["overallRecommendation"] = looksMaterial
    ? "escalate_to_partner"
    : "accept";
  return {
    diffSummary: looksMaterial
      ? `Inbound body differs from v${input.latestVersion.version} by ${drift} characters. ${redlines.length} clause(s) flagged.`
      : `Inbound body matches v${input.latestVersion.version} within tolerance; no redlines.`,
    redlines,
    overallRecommendation: overall,
  };
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
    const { value, costUsd, source, warning } =
      await callClaudeJson<RedlineAnalystOutput>(
        "claude-sonnet-4-6",
        system,
        JSON.stringify(input),
        () => mockRedlineAnalyst(input),
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
      source,
      warning,
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
    side: "aico" | "counterparty";
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

function mockEsignOrchestrator(
  input: EsignOrchestratorInput,
): EsignOrchestratorOutput {
  const warnings: string[] = [];
  if (input.countersign.state !== "both_signed") {
    warnings.push(
      `Refusing to dispatch: two-partner countersign state is "${input.countersign.state}", not "both_signed".`,
    );
    return {
      envelope: {
        provider: "docusign",
        envelopeId: "",
        routingOrder: [],
        sentAt: null,
        statusAfterSend: input.contract.status,
      },
      reconciledPartyStates: input.parties.map((p) => ({
        partyId: p.id,
        signState: p.signState,
        signedAt: null,
        evidenceUrl: "",
      })),
      contractStatusAfter: input.contract.status,
      warnings,
    };
  }
  const provider = pickProvider(input.providerHint, input.parties);
  // AICo signers first, then counterparty signers, witnesses, notice parties.
  const orderRank = (
    p: EsignOrchestratorInput["parties"][number],
  ): number => {
    const sideBoost = p.side === "aico" ? 0 : 100;
    const roleBoost =
      p.role === "signer"
        ? 0
        : p.role === "witness"
          ? 200
          : p.role === "notice_party"
            ? 300
            : 400;
    return sideBoost + roleBoost;
  };
  const sortedParties = input.parties
    .map((p, i) => ({ p, rank: orderRank(p) + i }))
    .sort((a, b) => a.rank - b.rank);
  const routingOrder = sortedParties.map(({ p }, i) => ({
    partyId: p.id,
    order: i + 1,
    signerEmail: p.signerEmail,
  }));
  return {
    envelope: {
      provider,
      envelopeId: `mock_${provider}_${input.contract.id.slice(-8)}`,
      routingOrder,
      sentAt: new Date().toISOString(),
      statusAfterSend: "external_dispatched",
    },
    reconciledPartyStates: input.parties.map((p) => ({
      partyId: p.id,
      signState: "sent",
      signedAt: null,
      evidenceUrl: "",
    })),
    contractStatusAfter: "external_dispatched",
    warnings,
  };
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
    const { value, costUsd, source, warning } =
      await callClaudeJson<EsignOrchestratorOutput>(
        "claude-sonnet-4-6",
        system,
        JSON.stringify(input),
        () => mockEsignOrchestrator(input),
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
      source,
      warning,
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

function mockDpaSentinel(input: DpaSentinelInput): DpaSentinelOutput {
  const corpus = input.dataSignalInputs
    .map((s) => s.text.toLowerCase())
    .join("\n");
  const classes = new Set<"pii" | "phi" | "financial" | "regulated_other">();
  if (PII_KEYS.some((k) => corpus.includes(k))) classes.add("pii");
  if (PHI_KEYS.some((k) => corpus.includes(k))) classes.add("phi");
  if (FIN_KEYS.some((k) => corpus.includes(k))) classes.add("financial");
  const isRequired = classes.size > 0;
  const alerts: DpaSentinelOutput["alerts"] = [];
  let recommended: DpaSentinelOutput["recommendedStatus"] = "required";
  const now = Date.now();
  if (input.existingDpa) {
    const expiresAt = input.existingDpa.expiresAt
      ? Date.parse(input.existingDpa.expiresAt)
      : null;
    if (expiresAt && expiresAt < now) {
      recommended = "expired";
      alerts.push({
        severity: "high",
        audience: "compliance_officer",
        summary: `DPA for ${input.counterparty.legalName} expired on ${input.existingDpa.expiresAt}.`,
      });
    } else if (
      input.existingDpa.status === "signed" &&
      input.existingDpa.signedAt
    ) {
      recommended = "active";
    } else if (
      input.existingDpa.status === "active" &&
      input.existingDpa.lastReviewedAt
    ) {
      const reviewedMs = Date.parse(input.existingDpa.lastReviewedAt);
      if (now - reviewedMs < 365 * 24 * 3600 * 1000) {
        recommended = "reviewed";
      } else {
        recommended = "active";
        alerts.push({
          severity: "medium",
          audience: "compliance_officer",
          summary:
            "DPA last review > 12 months ago — schedule a fresh review.",
        });
      }
    } else {
      recommended = input.existingDpa.status;
    }
  } else if (isRequired) {
    alerts.push({
      severity: "high",
      audience: "compliance_officer",
      summary: `Personal-data signals detected for ${input.engagement.name} but no DPA row exists.`,
    });
  }
  return {
    isDpaRequired: isRequired,
    detectedDataClasses: Array.from(classes),
    processorChainInferred: input.existingDpa?.dataClasses
      ? []
      : isRequired
        ? [
            {
              name: "AICo (controller-as-processor)",
              role: "processor",
              jurisdiction: input.counterparty.jurisdiction || "unspecified",
            },
          ]
        : [],
    recommendedStatus: recommended,
    rationale: isRequired
      ? `Detected data classes: ${Array.from(classes).join(", ")}. Recommended status: ${recommended}.`
      : "No personal-data signals detected in the supplied inputs.",
    alerts,
  };
}

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
    const { value, costUsd, source, warning } =
      await callClaudeJson<DpaSentinelOutput>(
        "claude-sonnet-4-6",
        system,
        JSON.stringify(input),
        () => mockDpaSentinel(input),
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
      source,
      warning,
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

function mockRenewalWatchdog(input: RenewalWatchdogInput): RenewalWatchdogOutput {
  const now = Date.parse(input.now);
  const dayMs = 86_400_000;
  const contractRecommendations: RenewalWatchdogOutput["contractRecommendations"] = [];
  for (const c of input.activeContracts) {
    if (c.status === "terminated" || c.status === "expired") continue;
    if (!c.termEnd) continue;
    const days = Math.round((Date.parse(c.termEnd) - now) / dayMs);
    if (days > input.warningWindows.contractDays) continue;
    const severity: "low" | "medium" | "high" =
      days < 30 ? "high" : days <= 60 ? "medium" : "low";
    const recommendation =
      c.contractValueUsd > 100_000 || c.instrumentType === "msa"
        ? "renew"
        : "review";
    contractRecommendations.push({
      contractId: c.id,
      daysToExpiry: days,
      recommendation,
      rationale: `${c.instrumentType.toUpperCase()} with ${c.counterpartyLegalName} expires in ${days}d.`,
      targetStatus: c.status === "active" ? "expiring" : "active",
      severity,
    });
  }
  const dpaRecommendations: RenewalWatchdogOutput["dpaRecommendations"] = [];
  for (const d of input.activeDpas) {
    if (!d.expiresAt) continue;
    const days = Math.round((Date.parse(d.expiresAt) - now) / dayMs);
    if (days > input.warningWindows.dpaDays) continue;
    const severity: "low" | "medium" | "high" =
      days < 30 ? "high" : "medium";
    dpaRecommendations.push({
      dpaId: d.id,
      daysToExpiry: days,
      recommendation: days < 0 ? "retire" : "renew",
      rationale: `DPA with ${d.counterpartyLegalName} ${days < 0 ? "lapsed" : "expires in " + days + "d"}.`,
      severity,
    });
  }
  const loudest =
    contractRecommendations.find((r) => r.severity === "high") ??
    dpaRecommendations.find((r) => r.severity === "high") ??
    contractRecommendations[0] ??
    dpaRecommendations[0];
  const summary = `${contractRecommendations.length} contract(s) and ${dpaRecommendations.length} DPA(s) in the renewal window${loudest ? "; loudest item: " + ("contractId" in loudest ? loudest.contractId : loudest.dpaId) + " (" + loudest.severity + ")" : ""}.`;
  return { contractRecommendations, dpaRecommendations, summaryForPartner: summary };
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
    const { value, costUsd, source, warning } =
      await callClaudeJson<RenewalWatchdogOutput>(
        "claude-haiku-4-5",
        system,
        JSON.stringify(input),
        () => mockRenewalWatchdog(input),
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
      source,
      warning,
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
    const { value, costUsd, source, warning } = await callClaudeJson<CashApplicationMatcherOutput>(
      "claude-haiku-4-5",
      "You are the Cash Application Matcher. Return a ranked list of invoice candidates for the receipt.",
      JSON.stringify(input),
      () => ruleBasedCashMatch(input),
    );
    const conf: "green" | "amber" | "red" =
      value.candidates[0]?.confidence >= 0.85 ? "green" :
      value.candidates[0]?.confidence >= 0.5 ? "amber" : "red";
    await completeRun({
      runId, output: value as unknown, confidence: conf, costUsd,
      durationMs: Date.now() - t0, sourcesCount: value.candidates.length,
      actorLabel: input.actorLabel, targetType: "cash_receipt",
      targetId: input.receipt.id, targetLabel: `Receipt ${input.receipt.id}`,
      source, warning,
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
    // Pull open AR rows for the rule-based fallback path.
    const { db: dbRef, atelierInvoice: invTbl } = await import("@workspace/db");
    const { isNull: isN } = await import("drizzle-orm");
    const rows = (await dbRef.select().from(invTbl).where(isN(invTbl.deletedAt)))
      .filter((i) => i.total - i.amountPaid > 0.01)
      .map((i) => ({ outstanding: i.total - i.amountPaid, dueDate: i.dueDate }));
    const fallback = await ruleBasedForecast(input, rows);
    const { value, costUsd, source, warning } = await callClaudeJson<CashFlowForecasterOutput>(
      "claude-sonnet-4-6",
      "You are the Cash Flow Forecaster. Produce a 13-week direct-method forecast.",
      JSON.stringify({ ...input, openInvoices: rows }),
      () => fallback,
    );
    const conf: "green" | "amber" | "red" =
      value.cashGapWeeks.length === 0 ? "green" : value.cashGapWeeks.some((w) => w < 4) ? "red" : "amber";
    await completeRun({
      runId, output: value as unknown, confidence: conf, costUsd,
      durationMs: Date.now() - t0, sourcesCount: value.weeks.length,
      actorLabel: input.actorLabel, targetType: "cash_forecast", targetId: "_firm_",
      targetLabel: "13-week cash forecast", source, warning,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: input.actorLabel, targetType: "cash_forecast", targetId: "_firm_" });
    throw err;
  }
}
