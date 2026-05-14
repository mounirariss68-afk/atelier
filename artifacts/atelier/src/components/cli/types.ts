/**
 * Task #333 — CLI client-side types. Shape mirrors the orchestrator
 * SSE frames from Task #331 (artifacts/api-server/src/lib/atelier-cli/index.ts).
 *
 * We deliberately accept `Record<string, unknown>` for the frame `data`
 * payload instead of importing server types into the client bundle. The
 * orchestrator owns the contract; this surface exists to render it.
 */

export type CliFrameType =
  | "narration"
  | "plan_step"
  | "proposed_plan"
  | "proactive_recap"
  | "tool_call"
  | "tool_result"
  | "needs_disambiguation"
  | "needs_confirmation"
  | "needs_clarification"
  | "refusal"
  | "async_dispatched"
  | "partial_success"
  | "final"
  | "error"
  | "budget_exceeded";

export interface CliFrame {
  type: CliFrameType;
  data: Record<string, unknown>;
  /** Wall-clock the client received the frame (used to render timing). */
  receivedAt: number;
}

export type CliTurnStatus =
  | "idle"
  | "streaming"
  | "needs_disambiguation"
  | "needs_confirmation"
  | "needs_clarification"
  | "async_handoff"
  | "complete"
  | "partial"
  | "error"
  | "cancelled";

export interface CliClarification {
  field: string;
  question: string;
  tool: string;
  partial?: Record<string, unknown>;
  suggestions?: Array<{ id: string; label: string; hint?: string }>;
}

export interface CliRefusal {
  reason: string;
  closestCapabilityId?: string | null;
  pageHref?: string | null;
  suggestion?: string | null;
  requestCapability?: { tool: string; prompt: string };
}

export interface CliProactiveRecap {
  summary: string;
  turnCount: number;
  dormantMs?: number;
  entities?: Array<{ kind: string; id: string; label: string }>;
}

export interface CliPlanStep {
  index?: number;
  label: string;
  isWrite?: boolean;
  toolName?: string;
}

export interface CliDisambigOption {
  id: string;
  label: string;
  hint?: string;
}

export interface CliPendingConfirmation {
  summary: string;
  diff?: Record<string, unknown> | null;
  steps?: CliPlanStep[];
  /** From Task #332 — present when the capability is `irreversible`. */
  typedNameRequired?: string | null;
  outboundChannel?: "email" | "slack" | "salon_publish" | null;
}

export interface CliResultEntity {
  kind: string;
  id: string;
  label: string;
  href?: string | null;
}

export interface CliResultCard {
  title: string;
  summary?: string;
  entities?: CliResultEntity[];
  agentRunIds?: string[];
  auditEventId?: string | null;
  followUps?: Array<{ label: string; prompt: string }>;
}

export interface CliTurn {
  /** Stable client-side id; replaced by server `turnId` on the `final` frame. */
  clientTurnKey: string;
  serverTurnId?: string;
  prompt: string;
  status: CliTurnStatus;
  startedAt: number;
  /** Streamed narration lines + tool-call breadcrumbs in arrival order. */
  trace: Array<{ kind: "narration" | "step" | "tool"; text: string; at: number }>;
  proposedPlan?: CliPlanStep[];
  disambig?: { kind: string; options: CliDisambigOption[] };
  pending?: CliPendingConfirmation;
  result?: CliResultCard;
  partial?: {
    completedSteps: number;
    failedStepIndex: number;
    error: string;
    /** Per-step status when the orchestrator reports it. Index aligns
     * with `proposedPlan`. Used by PlanCard to draw green/red chips. */
    stepResults?: Array<{
      index: number;
      status: "success" | "error" | "skipped" | "pending";
      error?: string | null;
    }>;
  };
  error?: { code: string; message: string };
  asyncJob?: { jobId: string; turnId: string };
  /** Per-step exclusion checkboxes for bulk plans (>20 steps). */
  excludedStepIndexes?: number[];
  /** Inline plan-row label edits keyed by step index, applied before
   * confirmation. Forwarded with the confirm POST as `planEdits`; the
   * server confirm route currently ignores unknown body fields, so
   * this is forward-safe for downstream Tasks #334/#335 enforcement. */
  planEdits?: Record<number, string>;
  /** Task #340 — clarification dialog state when the server pauses the
   * turn awaiting a missing required field. Cleared on next submit. */
  clarification?: CliClarification;
  /** Task #340 — graceful refusal payload, rendered as a card with a
   * "Request this capability" CTA bound to meta.request_feature. */
  refusal?: CliRefusal;
  /** Task #340 — proactive open-state recap surfaced before the model
   * loop runs on a re-opened session. Informational only. */
  proactiveRecap?: CliProactiveRecap;
}

export interface CliCapability {
  id: string;
  module: string;
  toolName: string;
  description: string;
  slashAliases: { en?: string[]; ar?: string[]; fr?: string[] };
  isWrite: boolean;
  irreversible: boolean;
  surfaceOn: string[];
  twoPhaseConfirm: boolean;
  outboundChannel: "email" | "slack" | "salon_publish" | null;
  resultCard: string;
  /** Optional per-locale example phrasings rendered in the /help drawer.
   * Falls back to the description when absent. The catalog (Task #332)
   * may populate these later — surface field is forward-safe. */
  examplePhrases?: { en?: string[]; ar?: string[]; fr?: string[] } | null;
}

export interface CliAttachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** True after server-side upload — Task D wires the actual upload pipeline. */
  uploaded: boolean;
  errorMessage?: string;
}

export type CliLocale = "en" | "ar";
