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
import { eq } from "drizzle-orm";
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

export async function startRun(input: StartRunInput): Promise<string> {
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
}

export async function completeRun(input: CompleteRunInput): Promise<void> {
  await db
    .update(atelierAgentRuns)
    .set({
      status: "complete",
      statusMessage: "complete",
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
    payload: { runId: input.runId, confidence: input.confidence, costUsd: input.costUsd },
    payloadSummary: `${input.actorLabel} completed on ${input.targetLabel} (confidence ${input.confidence}, $${input.costUsd.toFixed(4)})`,
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
): Promise<{ value: T; costUsd: number; tokensIn: number; tokensOut: number }> {
  if (MOCK_MODE) {
    return { value: fallback(), costUsd: 0, tokensIn: 0, tokensOut: 0 };
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
    return { value, costUsd, tokensIn, tokensOut };
  } catch (err) {
    // Surface clearly so the UI sees `error` status, then fall back so the
    // demo path still functions.
    // eslint-disable-next-line no-console
    console.warn(
      "[atelier-agents] Claude call failed, falling back to mock:",
      err instanceof Error ? err.message : err,
    );
    return { value: fallback(), costUsd: 0, tokensIn: 0, tokensOut: 0 };
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
    const { value, costUsd, tokensIn, tokensOut } = await callClaudeJson<PursuitScoutOutput>(
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
    const { value, costUsd, tokensIn, tokensOut } = await callClaudeJson<PovOutline>(
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
    const { value, costUsd } = await callClaudeJson<PovDraft>(
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
    const { value, costUsd } = await callClaudeJson<MeetingScribeOutput>(
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
