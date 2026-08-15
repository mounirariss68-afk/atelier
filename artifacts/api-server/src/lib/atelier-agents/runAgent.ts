/**
 * Atelier — shared agent lifecycle helper.
 *
 * 🟡 Read `artifacts/atelier/AGENT_STANDARD.md` (§4 Lifecycle contract)
 * before changing this file. Every Atelier agent — Drafter, Sentinel,
 * Analyst, or Rule-based — should flow through `runAgent(...)` so that:
 *
 *   1. `atelier_agent_runs` start row + `agent.start` audit event always fire,
 *   2. budget is enforced before any LLM call,
 *   3. output is validated against the registry's Zod `outputSchema`,
 *   4. `agent.complete` / `agent.error` audit events always fire.
 *
 * The historical 15 hand-rolled `run<X>` functions in `runner.ts` predate
 * this helper. They use the same primitives (`startRun`, `progressRun`,
 * `completeRun`, `failRun`) and conform to the same lifecycle, but they
 * compose the calls inline. New agents — and the post-MVP agents being
 * reconciled in this task — should prefer this helper unless they need
 * custom multi-step orchestration that would be obscured by it.
 */

import { getAgent } from "@workspace/agents";
import {
  startRun,
  progressRun,
  completeRun,
  failRun,
} from "./runner.js";

export interface RunAgentContext<TInput> {
  runId: string;
  input: TInput;
  /** Push a status update + optional step record into the run's stream. */
  progress: (pct: number, message: string) => Promise<void>;
}

export interface RunAgentArgs<TInput> {
  agentId: string;
  /** Tenant org for the run row; legacy single-tenant callers may omit. */
  orgId?: string;
  input: TInput;
  triggeredByUserId: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string;
  /** Display name on audit events. Defaults to the registry `name`. */
  actorLabel?: string;
}

export interface RunAgentExecuteResult<TOutput> {
  output: TOutput;
  costUsd?: number;
  confidence?: "green" | "amber" | "red";
  sourcesCount?: number;
}

export interface RunAgentResult<TOutput> {
  runId: string;
  output: TOutput;
  costUsd: number;
  durationMs: number;
}

/**
 * Run an agent through the standard 8-phase lifecycle (start → fetch ctx
 * → call → validate → persist → audit → notify → checkpoint → commit).
 *
 * The caller supplies an `execute` function that does the LLM call (or
 * deterministic computation, for rule-based agents) and returns the raw
 * output. This helper handles everything else — input/output Zod
 * validation, audit events, error wrapping, cost accounting.
 *
 * Custom side-effects (writing to domain tables, dispatching
 * notifications) should happen *inside* `execute` after the output is
 * computed but before returning. Anything thrown bubbles into `failRun`
 * and the audit `agent.error` event.
 */
export async function runAgent<TInput, TOutput>(
  args: RunAgentArgs<TInput>,
  execute: (
    ctx: RunAgentContext<TInput>,
  ) => Promise<RunAgentExecuteResult<TOutput>>,
): Promise<RunAgentResult<TOutput>> {
  const agent = getAgent(args.agentId);
  if (!agent) {
    throw new Error(
      `runAgent: unknown agentId "${args.agentId}" — add a defineAgent({...}) entry to lib/agents/src/registry.ts (see AGENT_STANDARD.md §2).`,
    );
  }
  const actorLabel = args.actorLabel ?? agent.name;

  // 1. Validate input against the registry contract before doing any work.
  // The TS type of `input` is whatever the caller passes; the registry's
  // Zod schema is the runtime source of truth (per AGENT_STANDARD.md §5).
  // In strict mode (used by `pnpm test:agents` + CI) we throw on
  // mismatch. In normal mode we log + audit and continue, so a partner
  // never sees a v3 walkthrough break because of a schema drift.
  const inputParse = agent.inputSchema.safeParse(args.input);
  if (!inputParse.success) {
    if (process.env.ATELIER_AGENT_STRICT_OUTPUT === "1") {
      throw new Error(
        `runAgent[${agent.id}]: input failed schema validation — ${inputParse.error.message}`,
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[atelier-agent-input-warning] [${agent.id}] input failed registry schema: ${inputParse.error.message.slice(0, 200)}`,
    );
  }

  // 2. Start row + audit event (also enforces daily budget).
  const t0 = Date.now();
  const inputForRow = (inputParse.success ? inputParse.data : args.input) as Record<string, unknown>;
  const runId = await startRun({
    agentId: agent.id,
    orgId: args.orgId,
    triggeredByUserId: args.triggeredByUserId,
    targetType: args.targetType,
    targetId: args.targetId,
    targetLabel: args.targetLabel,
    inputs: inputForRow,
    actorLabel,
  });

  try {
    const ctx: RunAgentContext<TInput> = {
      runId,
      input: args.input,
      // progressRun forwards to the ambient progress sink internally, so a
      // single call here yields exactly one CLI progress frame (no double-emit).
      progress: (pct, message) => progressRun(runId, pct, message),
    };

    // 3. Run the agent body (LLM call + persistence happen here).
    const result = await execute(ctx);

    // 4. Output validation happens inside completeRun() against the same
    // registry outputSchema. Keeping it there means the 15 historical
    // run<X> functions get the same enforcement without going through
    // this helper. See `validateAgentOutput` in runner.ts.
    const durationMs = Date.now() - t0;
    await completeRun({
      runId,
      output: result.output as unknown,
      confidence: result.confidence ?? "amber",
      costUsd: result.costUsd ?? 0,
      durationMs,
      sourcesCount: result.sourcesCount,
      actorLabel,
      targetType: args.targetType,
      targetId: args.targetId,
      targetLabel: args.targetLabel,
    });

    return {
      runId,
      output: result.output,
      costUsd: result.costUsd ?? 0,
      durationMs,
    };
  } catch (err) {
    await failRun(runId, err, {
      actorLabel,
      targetType: args.targetType,
      targetId: args.targetId,
    });
    throw err;
  }
}
