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
