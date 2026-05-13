/**
 * Atelier deep-agent runner.
 *
 * Orchestrates the three star agents (Pursuit Scout, POV Author,
 * Meeting Scribe). Each call:
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

import { db, atelierAgentRuns, atelierAuditEvents } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { loadPrompt, type AtelierAgentId } from "./loader.js";

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

export async function completeRun(input: CompleteRunInput): Promise<void> {
  const isFallback = input.source === "mock_fallback";
  // A mock-fallback (Claude error) is NOT a clean success — flag it so the
  // UI/audit can surface that the data is synthetic and must not be treated
  // as evidence. We still mark progress 100 so streams complete, but the
  // `status` becomes `blocked` and `confidence` is forced to red.
  await db
    .update(atelierAgentRuns)
    .set({
      status: isFallback ? "blocked" : "complete",
      statusMessage: isFallback
        ? (input.warning ?? "mock fallback — Claude unavailable")
        : "complete",
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
      warning: input.warning,
    },
    payloadSummary: isFallback
      ? `${input.actorLabel} fell back to MOCK on ${input.targetLabel} — Claude unavailable; output flagged synthetic`
      : `${input.actorLabel} completed on ${input.targetLabel} (confidence ${input.confidence}, $${input.costUsd.toFixed(4)}, source ${input.source ?? "claude"})`,
  });
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
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "pursuit_scout",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "opportunity",
    targetId: args.opportunityId,
    targetLabel: args.opportunityName,
    inputs: { accountName: args.accountName, contextBlurb: args.contextBlurb },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("pursuit_scout");
    await progressRun(runId, 25, "Planning research lines");
    const { value, costUsd, tokensIn, tokensOut, source, warning } = await callClaudeJson<PursuitScoutOutput>(
      "claude-sonnet-4-6",
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
    await progressRun(runId, 70, "Synthesising 5C draft", { name: "scout.synth", durationMs: Date.now() - t0, tokensIn, tokensOut });
    const guarded: PursuitScoutOutput = { ...value, facts: applyCitationGuardrail(value.facts ?? []) };
    await completeRun({
      runId,
      output: guarded as unknown,
      confidence: guarded.confidence ?? "amber",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: guarded.facts.length,
      actorLabel: args.actorLabel,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
      source,
      warning,
    });
    return { runId, output: guarded, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: "opportunity",
      targetId: args.opportunityId,
    });
    throw err;
  }
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
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "pov_author",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "opportunity",
    targetId: args.opportunityId,
    targetLabel: args.opportunityName,
    inputs: { phase: "outline", audience: args.audience, objective: args.objective, factsCount: args.promotedFacts.length },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("pov_author");
    await progressRun(runId, 30, "Drafting outline");
    const { value, costUsd, tokensIn, tokensOut, source, warning } = await callClaudeJson<PovOutline>(
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
    await completeRun({
      runId,
      output: value as unknown,
      confidence: "amber",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: args.promotedFacts.length,
      actorLabel: args.actorLabel,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
      source,
      warning,
    });
    void tokensIn; void tokensOut;
    return { runId, outline: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "opportunity", targetId: args.opportunityId });
    throw err;
  }
}

export async function runPovDraft(args: {
  opportunityId: string;
  opportunityName: string;
  outline: PovOutline;
  promotedFacts: AgentFact[];
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<{ runId: string; draft: PovDraft; costUsd: number }> {
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "pov_author",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "opportunity",
    targetId: args.opportunityId,
    targetLabel: args.opportunityName,
    inputs: { phase: "draft", sectionsCount: args.outline.sections.length },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("pov_author");
    await progressRun(runId, 40, "Writing sections");
    const { value, costUsd, source, warning } = await callClaudeJson<PovDraft>(
      "claude-sonnet-4-6",
      system + "\n\n## Run-time directive\nExecute Phase B (sections), then Phase C (critic), then Phase D (stylist) and return the final composite JSON: { sections, html, citationCoverage, voiceFlags, wordCount }.",
      JSON.stringify({ outline: args.outline, facts: args.promotedFacts }),
      () => mockSections(args.outline, args.promotedFacts),
    );
    await progressRun(runId, 85, "Stylist polish");
    await completeRun({
      runId,
      output: value as unknown,
      confidence: value.citationCoverage >= 0.8 ? "green" : "amber",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: args.promotedFacts.length,
      actorLabel: args.actorLabel,
      targetType: "opportunity",
      targetId: args.opportunityId,
      targetLabel: args.opportunityName,
      source,
      warning,
    });
    return { runId, draft: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "opportunity", targetId: args.opportunityId });
    throw err;
  }
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
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "meeting_scribe",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "opportunity",
    targetId: args.opportunityId,
    targetLabel: args.opportunityName,
    inputs: { kind: args.kind, transcriptChars: args.transcript.length, hasPrior: !!args.priorBrief },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("meeting_scribe");
    await progressRun(runId, 35, "Normalising speakers");
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
    await progressRun(runId, 80, "Extracting decisions & actions");
    await completeRun({
      runId,
      output: value as unknown,
      confidence: "amber",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.decisions.length + value.actionItems.length,
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
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "charter_architect",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "engagement",
    targetId: args.engagementId,
    targetLabel: args.engagementName,
    inputs: { accountName: args.accountName, hasTranscript: !!args.kickoffTranscriptExcerpt },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("charter_architect");
    // Sub-agent chain progress beats — surfaced in the activity stream.
    await progressRun(runId, 15, "Objective Distiller — extracting 3–5 outcome-shaped objectives");
    await progressRun(runId, 35, "Scope Boundarist — drawing IN/OUT scope sets (MECE)");
    await progressRun(runId, 60, "Hypothesis Tree Builder — building tree (max depth 3)");
    await progressRun(runId, 80, "RAID Baseliner — triaging baseline RAID items");
    const hasBaseline = !/no baseline/i.test(args.wonProposalSummary);
    const { value, costUsd, tokensIn, tokensOut, source, warning } = await callClaudeJson<CharterArchitectOutput>(
      "claude-sonnet-4-6",
      system,
      JSON.stringify({
        engagementId: args.engagementId,
        accountName: args.accountName,
        wonProposalSummary: args.wonProposalSummary,
        kickoffTranscriptExcerpt: args.kickoffTranscriptExcerpt,
      }),
      () => mockCharter({ accountName: args.accountName, proposalSummary: args.wonProposalSummary, hasBaseline }),
    );
    // Hard guardrail: cap depth to 3.
    if (value.hypothesisTree?.branches) {
      value.hypothesisTree.branches.forEach((b) => {
        if (Array.isArray(b.subHypotheses) && b.subHypotheses.length > 6) {
          b.subHypotheses = b.subHypotheses.slice(0, 6);
        }
      });
    }
    void tokensIn; void tokensOut;
    await completeRun({
      runId,
      output: value as unknown,
      confidence: value.meceFlags?.length ? "amber" : "green",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.raidBaseline?.length ?? 0,
      actorLabel: args.actorLabel,
      targetType: "engagement",
      targetId: args.engagementId,
      targetLabel: args.engagementName,
      source,
      warning,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "engagement", targetId: args.engagementId });
    throw err;
  }
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
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "synthesis_critic",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "deliverable",
    targetId: args.deliverableId,
    targetLabel: args.deliverableName,
    inputs: { engagementId: args.engagementId, audience: args.audience, bodyLen: args.body.length },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("synthesis_critic");
    await progressRun(runId, 25, "Walking sections + checking pyramid structure");
    await progressRun(runId, 60, "Auditing citations + hypothesis coverage");
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
    await completeRun({
      runId,
      output: value as unknown,
      confidence: value.readiness === "green" ? "green" : value.readiness === "amber" ? "amber" : "red",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.issues?.length ?? 0,
      actorLabel: args.actorLabel,
      targetType: "deliverable",
      targetId: args.deliverableId,
      targetLabel: args.deliverableName,
      source,
      warning,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "deliverable", targetId: args.deliverableId });
    throw err;
  }
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
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "agent_architect",
    triggeredByUserId: args.triggeredByUserId,
    targetType: "engagement",
    targetId: args.engagementId,
    targetLabel: args.engagementName,
    inputs: { scopeHint: args.scopeHint, depth: args.depth, sourceChars: args.source.length },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("agent_architect");
    await progressRun(runId, 15, "Process Reader — normalizing input into ordered steps");
    await progressRun(runId, 35, "Step Classifier — assigning category per step");
    await progressRun(runId, 60, "Agentifiability Judge — yes/partial/no with rationale");
    await progressRun(runId, 80, "Agent Designer — clustering into candidate designs");
    const { value, costUsd, source, warning } = await callClaudeJson<AgentArchitectOutput>(
      "claude-sonnet-4-6",
      system,
      JSON.stringify({ scopeHint: args.scopeHint, depth: args.depth, source: args.source }),
      () => mockAgentArchitect({ scopeHint: args.scopeHint, source: args.source }),
    );
    // Server-side post-validation (defense-in-depth, runs even on
    // real-LLM output). Any candidate whose process touches customer
    // communications, financial commitments, or irreversible actions
    // MUST be classified high-risk with the partner-attention guardrail.
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
    await completeRun({
      runId,
      output: value as unknown,
      confidence: value.candidateAgents.some((c) => c.riskClass === "high") ? "amber" : "green",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.steps.length,
      actorLabel: args.actorLabel,
      targetType: "engagement",
      targetId: args.engagementId,
      targetLabel: args.engagementName,
      source,
      warning,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, { actorLabel: args.actorLabel, targetType: "engagement", targetId: args.engagementId });
    throw err;
  }
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
  const t0 = Date.now();
  const runId = await startRun({
    agentId: "prototype_forge",
    triggeredByUserId: args.triggeredByUserId,
    targetType: args.opportunityId ? "opportunity" : "engagement",
    targetId: (args.opportunityId ?? args.engagementId) as string,
    targetLabel: args.targetLabel,
    inputs: { name: args.brief.name, demos: args.brief.demos.length },
    actorLabel: args.actorLabel,
  });
  try {
    const system = loadPrompt("prototype_forge");
    await progressRun(runId, 20, "Architecture Drafter — sketching surfaces + agent topology");
    await progressRun(runId, 45, "Demo Storyboarder — choosing demo moments");
    await progressRun(runId, 70, "Brand Translator — applying brand defaults/overrides");
    await progressRun(runId, 90, "Prompt Composer — assembling Replit-ready prompt");
    const { value: rawValue, costUsd, source, warning } = await callClaudeJson<PrototypeForgeOutput>(
      "claude-sonnet-4-6",
      system,
      JSON.stringify(args.brief),
      () => mockPrototypeForge(args.brief),
    );
    // Post-validate: AICo non-negotiables block must always be present in
    // the Replit prompt regardless of model drift. If the model omits the
    // section or the data-policy line, append the canonical block.
    const value = enforcePrototypeNonNegotiables(rawValue, args.brief);
    await completeRun({
      runId,
      output: value as unknown,
      confidence: "green",
      costUsd,
      durationMs: Date.now() - t0,
      sourcesCount: value.demoStoryboard.length,
      actorLabel: args.actorLabel,
      targetType: args.opportunityId ? "opportunity" : "engagement",
      targetId: (args.opportunityId ?? args.engagementId) as string,
      targetLabel: args.targetLabel,
      source,
      warning,
    });
    return { runId, output: value, costUsd };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel: args.actorLabel,
      targetType: args.opportunityId ? "opportunity" : "engagement",
      targetId: (args.opportunityId ?? args.engagementId) as string,
    });
    throw err;
  }
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
      "claude-sonnet-4-6",
      system,
      JSON.stringify({
        opportunityId: args.opportunityId,
        sectionsRequired: args.sectionsRequired,
        teamProposed: args.teamProposed,
        pricingIntent: args.pricingIntent,
        rfpRequirements: args.rfpRequirements,
      }),
      () => mockProposal({
        opportunityId: args.opportunityId,
        sectionsRequired: args.sectionsRequired,
        teamProposed: args.teamProposed,
        pricingIntent: args.pricingIntent,
        rfpRequirements: args.rfpRequirements,
      }),
    );
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
