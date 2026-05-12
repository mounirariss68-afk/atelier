import type {
  Agent,
  AgentRun,
  AgentRunEvent,
  IntermediateStep,
  StreamSink,
} from "./types.js";

let _idCounter = 0;
const nextId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${(_idCounter++).toString(36)}`;

export interface RunnerInvokeContext {
  runId: string;
  inputs: unknown;
  emit: (step: Omit<IntermediateStep, "id" | "index" | "ts">) => Promise<void>;
}

export type RunnerInvoke<O = unknown> = (
  ctx: RunnerInvokeContext,
) => Promise<{ output: O; confidence?: AgentRun["confidence"] }>;

export interface RunOptions {
  triggeredByUserId: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  sink?: StreamSink;
  /**
   * Persistence callback — typically writes to `atelier_agent_runs` and
   * `atelier_audit_events`. The runner calls it on every state transition.
   */
  persist?: (run: AgentRun, event: AgentRunEvent) => void | Promise<void>;
}

/**
 * Execute an `Agent` with the given inputs, streaming `intermediate_steps[]`
 * to `sink` and persisting the lifecycle via `persist`. Returns the final
 * `AgentRun` regardless of success or failure.
 */
export async function runAgent<O>(
  agent: Agent,
  inputs: unknown,
  invoke: RunnerInvoke<O>,
  opts: RunOptions,
): Promise<AgentRun<O>> {
  const runId = nextId("run");
  const startedAt = new Date().toISOString();

  const parsed = agent.inputSchema.safeParse(inputs);
  if (!parsed.success) {
    const failed: AgentRun<O> = {
      id: runId,
      agentId: agent.id,
      triggeredByUserId: opts.triggeredByUserId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      targetLabel: opts.targetLabel,
      inputs,
      status: "failed",
      statusMessage: "Input validation failed",
      steps: [],
      toolCalls: [],
      humanDecisions: [],
      startedAt,
      endedAt: new Date().toISOString(),
    };
    const event: AgentRunEvent = {
      kind: "failed",
      runId,
      error: parsed.error.message,
    };
    await opts.sink?.(event);
    await opts.persist?.(failed, event);
    return failed;
  }

  const run: AgentRun<O> = {
    id: runId,
    agentId: agent.id,
    triggeredByUserId: opts.triggeredByUserId,
    targetType: opts.targetType,
    targetId: opts.targetId,
    targetLabel: opts.targetLabel,
    inputs: parsed.data,
    status: "running",
    steps: [],
    toolCalls: [],
    humanDecisions: [],
    startedAt,
  };

  const startedEvent: AgentRunEvent = {
    kind: "started",
    runId,
    agentId: agent.id,
  };
  await opts.sink?.(startedEvent);
  await opts.persist?.(run, startedEvent);

  const emit = async (s: Omit<IntermediateStep, "id" | "index" | "ts">) => {
    const step: IntermediateStep = {
      id: nextId("step"),
      index: run.steps.length,
      ts: new Date().toISOString(),
      ...s,
    };
    run.steps.push(step);
    if (step.toolCall) run.toolCalls.push(step.toolCall);
    const event: AgentRunEvent = { kind: "step", runId, step };
    await opts.sink?.(event);
    await opts.persist?.(run, event);
  };

  try {
    const { output, confidence } = await invoke({
      runId,
      inputs: parsed.data,
      emit,
    });
    const validated = agent.outputSchema.safeParse(output);
    if (!validated.success) throw new Error("Output validation failed: " + validated.error.message);
    run.status = "complete";
    run.output = validated.data as O;
    run.confidence = confidence;
    run.endedAt = new Date().toISOString();
    run.durationMs = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    const event: AgentRunEvent = {
      kind: "complete",
      runId,
      output: run.output,
      confidence,
    };
    await opts.sink?.(event);
    await opts.persist?.(run, event);
    return run;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    run.status = "failed";
    run.statusMessage = message;
    run.endedAt = new Date().toISOString();
    run.durationMs = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    const event: AgentRunEvent = { kind: "failed", runId, error: message };
    await opts.sink?.(event);
    await opts.persist?.(run, event);
    return run;
  }
}
