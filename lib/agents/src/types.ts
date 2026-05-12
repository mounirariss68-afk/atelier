import { z, type ZodTypeAny } from "zod";

/**
 * THE ATELIER — Agent runtime types (spec §8).
 *
 * Every agent in the registry conforms to the `Agent<I, O>` interface.
 * The runner produces an `AgentRun` lifecycle object that streams
 * `intermediate_steps[]` to the right-rail Activity Stream and writes
 * a row to `atelier_audit_events` on every state transition.
 */

export type AgentGroup =
  | "Front of House"
  | "Engagement Memory"
  | "Mobilize"
  | "Deliver"
  | "Quality"
  | "Personal"
  | "Atelier";

export type AgentStage =
  | "Identify"
  | "Shape"
  | "Pursue"
  | "Mobilize"
  | "Deliver"
  | "Compound"
  | "Cross-cutting";

export type AgentStatus = "registered" | "mvp" | "stub";
export type AgentConfidence = "green" | "amber" | "red";

export type AgentTool = string;

export interface HumanCheckpoint {
  id: string;
  label: string;
  decider: "partner" | "engagement_lead" | "sme" | "ai_engineer" | "business_developer";
  /** Whether the run blocks here until a human acts. */
  blocking: boolean;
}

export interface AgentEval {
  id: string;
  description: string;
  /** Pass threshold (0-1). */
  threshold: number;
}

export interface Agent<I extends ZodTypeAny = ZodTypeAny, O extends ZodTypeAny = ZodTypeAny> {
  id: string;
  name: string;
  group: AgentGroup;
  stage: AgentStage;
  purpose: string;
  model: string;
  starred: boolean;
  status: AgentStatus;
  inputSchema: I;
  outputSchema: O;
  tools: AgentTool[];
  systemPromptRef: string;
  guardrails: string[];
  humanCheckpoints: HumanCheckpoint[];
  evals: AgentEval[];
}

export interface ToolCall {
  id: string;
  tool: AgentTool;
  input: unknown;
  output?: unknown;
  startedAt: string;
  endedAt?: string;
  costUsd?: number;
  error?: string;
}

export interface IntermediateStep {
  id: string;
  /** Monotonic step index for the run. */
  index: number;
  ts: string;
  kind: "thought" | "tool_call" | "tool_result" | "human_checkpoint" | "status";
  message: string;
  toolCall?: ToolCall;
  payload?: Record<string, unknown>;
}

export interface HumanDecision {
  checkpointId: string;
  decider: HumanCheckpoint["decider"];
  deciderUserId: string;
  decision: "approve" | "edit" | "reject";
  rationale: string;
  ts: string;
}

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_human"
  | "complete"
  | "failed"
  | "rejected";

export interface AgentRun<O = unknown> {
  id: string;
  agentId: string;
  triggeredByUserId: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  inputs: unknown;
  status: AgentRunStatus;
  statusMessage?: string;
  progressPct?: number;
  confidence?: AgentConfidence;
  steps: IntermediateStep[];
  toolCalls: ToolCall[];
  humanDecisions: HumanDecision[];
  output?: O;
  costUsd?: number;
  durationMs?: number;
  startedAt: string;
  endedAt?: string;
}

export type AgentRunEvent =
  | { kind: "started"; runId: string; agentId: string }
  | { kind: "step"; runId: string; step: IntermediateStep }
  | { kind: "status"; runId: string; status: AgentRunStatus; message?: string; progressPct?: number }
  | { kind: "human_checkpoint"; runId: string; checkpoint: HumanCheckpoint }
  | { kind: "complete"; runId: string; output: unknown; confidence?: AgentConfidence }
  | { kind: "failed"; runId: string; error: string };

export type StreamSink = (event: AgentRunEvent) => void | Promise<void>;

/** Helper to declare an Agent with full type inference. */
export function defineAgent<I extends ZodTypeAny, O extends ZodTypeAny>(
  spec: Agent<I, O>,
): Agent<I, O> {
  return spec;
}

/** Re-export zod for stub authors. */
export { z };
