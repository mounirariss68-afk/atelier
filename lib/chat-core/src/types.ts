/**
 * Task #643 — single source of truth for the Atelier chat protocol
 * shared by the web CLI (artifacts/atelier) and the mobile chat
 * (artifacts/atelier-mobile).
 *
 * Shape mirrors the orchestrator SSE frames emitted from
 * artifacts/api-server/src/lib/atelier-cli/index.ts. Adding a frame
 * type or card shape on the server means updating exactly this file —
 * both clients then fail typecheck until they handle it.
 */

export type ChatFrameType =
  | "narration"
  /** Task #1000 — incremental model-text chunk streamed while the
   * assistant writes. `{ text, replace?, step? }`: append `text` to the
   * in-progress streamed segment, or when `replace` is true, swap the
   * whole segment for `text` (empty string clears it — used when the
   * server retracts pre-tool prose). A following `narration` frame
   * carries the final contract-trimmed text and REPLACES the streamed
   * segment; deltas are never persisted, so replay is unchanged. */
  | "text_delta"
  | "plan_step"
  | "proposed_plan"
  | "proactive_recap"
  | "tool_call"
  | "tool_result"
  | "presentation"
  | "needs_disambiguation"
  | "needs_confirmation"
  | "needs_clarification"
  | "refusal"
  | "async_dispatched"
  | "partial_success"
  | "progress"
  | "final"
  | "error"
  | "budget_exceeded";

export interface ChatFrame {
  type: ChatFrameType;
  data: Record<string, unknown>;
  /** Wall-clock the client received the frame (used to render timing). */
  receivedAt: number;
}

export type ChatTurnStatus =
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

/** Server-provided suggestion chip ({id,label}) — submit the id. */
export interface ClarificationChoice {
  id: string;
  label: string;
}

/* ── Task #745 — guided flight planner card (shared protocol) ────────
 * A clarification field with `inputType: "flight_planner"` carries a
 * `planner` prefill and is rendered by BOTH clients as the interactive
 * trip planner card (Return / One-way / Multi-city tabs, FROM/TO with
 * swap, dates, passengers & cabin). Submission rides the normal
 * clarification path: the confirmed plan is JSON-stringified into the
 * field's value (`clarificationValues: { plan: "<json>" }`). */
export interface ChatPlannerAirport {
  /** Free text the user typed / said ("Dubai", "IST"). */
  text: string;
  /** Resolved IATA code when known (prefill best-effort). */
  iata?: string | null;
  /** Human label for the resolved airport ("Dubai — DXB"). */
  label?: string | null;
}

export interface ChatPlannerSegment {
  origin: ChatPlannerAirport;
  destination: ChatPlannerAirport;
  /** YYYY-MM-DD, empty string when not yet chosen. */
  date: string;
}

export type ChatPlannerTripType = "return" | "one_way" | "multi_city";

export interface ChatFlightPlanner {
  tripType: ChatPlannerTripType;
  /** In travel order. Return trips carry 2 segments (out + back). */
  segments: ChatPlannerSegment[];
  adults: number;
  cabinClass: string;
}

/**
 * Clarification fields may carry richer input hints: `options` renders
 * a dropdown, `inputType: "date"` a date picker, and `defaultValue`
 * prefills the input. `choices` are tappable suggestion chips derived
 * from the server's single-field `suggestions` (see
 * resolveClarificationFields).
 */
export interface ChatClarificationField {
  field: string;
  label: string;
  hint?: string;
  options?: string[];
  choices?: ClarificationChoice[];
  inputType?: "date" | "flight_planner" | string;
  defaultValue?: string;
  /** Task #745 — prefill for `inputType: "flight_planner"` fields. */
  planner?: ChatFlightPlanner;
}

export interface ChatClarification {
  field: string;
  question: string;
  tool: string;
  partial?: Record<string, unknown>;
  suggestions?: Array<{ id: string; label: string; hint?: string }>;
  /**
   * Multi-field clarification: when more than one entry is present the
   * card renders one labeled input per field so all missing values can
   * be submitted in a single round-trip.
   */
  fields?: ChatClarificationField[];
}

export interface ChatRefusal {
  reason: string;
  closestCapabilityId?: string | null;
  pageHref?: string | null;
  suggestion?: string | null;
  requestCapability?: { tool: string; prompt: string };
}

export interface ChatProactiveRecap {
  summary: string;
  turnCount: number;
  dormantMs?: number;
  entities?: Array<{ kind: string; id: string; label: string }>;
  /** Task #978 — plain-language outcome lines ("Done: create an expense — Marriott"). */
  accomplishments?: string[];
  /** Task #978 — unresolved items to pick back up ("You were in the middle of…"). */
  openThreads?: string[];
}

export interface ChatPlanStep {
  index?: number;
  label: string;
  isWrite?: boolean;
  toolName?: string;
}

export interface ChatDisambigOption {
  id: string;
  label: string;
  hint?: string;
  secondary?: string;
}

export interface ChatPendingConfirmation {
  summary?: string;
  title?: string;
  turnId?: string;
  capability?: string;
  diff?: Record<string, unknown> | null;
  steps?: ChatPlanStep[];
  /** Present when the capability is `irreversible` (typed-name confirm). */
  typedNameRequired?: string | null;
  requiresTypedName?: boolean;
  entityName?: string;
  outboundChannel?: "email" | "slack" | "salon_publish" | null;
  [k: string]: unknown;
}

export interface ChatResultEntity {
  kind: string;
  id: string;
  label: string;
  href?: string | null;
}

export interface ChatResultCard {
  title: string;
  summary?: string;
  entities?: ChatResultEntity[];
  agentRunIds?: string[];
  auditEventId?: string | null;
  followUps?: Array<{ label: string; prompt: string }>;
}

export interface ChatToolResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  /** True for pre-confirm preview cards streamed before the write commits. */
  prelude?: boolean;
  presentation?: {
    id: string;
    answersIntentIds: string[];
    capabilityId: string;
    relationship: "primary" | "supplementary";
    cardType: string;
    minimumDataVersion: number;
    relevanceReason: string;
  };
}

export interface ChatTraceEntry {
  kind: "narration" | "step" | "tool";
  text: string;
  at: number;
  /** Optional expandable detail behind a step (e.g. web-search sources). */
  sources?: Array<{ url: string; title?: string }>;
  /** Optional phase tag for a progress step; consecutive same-phase
   * heartbeats collapse into a single updating row. */
  phase?: string;
  /** Task #1000 — true while this narration entry is being built from
   * `text_delta` frames; the final `narration` frame replaces it. */
  streaming?: boolean;
}

export interface ChatNavigateTo {
  path: string;
  when: "on_propose" | "on_commit";
}

export interface ChatPartial {
  completedSteps: number;
  failedStepIndex: number;
  error: string;
  /** Per-step status when the orchestrator reports it. Index aligns
   * with `proposedPlan`. */
  stepResults?: Array<{
    index: number;
    status: "success" | "error" | "skipped" | "pending";
    error?: string | null;
  }>;
}

/**
 * Frame-derived turn state shared by both clients. Platform turn types
 * extend this with their identity/UI-only fields (clientTurnKey vs key,
 * planEdits, offline flags, …). The shared reducer only reads/writes
 * fields declared here.
 */
export interface ChatTurnCore {
  status: ChatTurnStatus;
  /** Accumulated narration text (mobile renders this as the reply body;
   * web renders the trace entries instead — both are maintained). */
  text: string;
  /** Streamed narration lines + step/tool breadcrumbs in arrival order. */
  trace: ChatTraceEntry[];
  toolResults: ChatToolResult[];
  proposedPlan?: ChatPlanStep[];
  disambig?: { kind: string; options: ChatDisambigOption[] };
  pending?: ChatPendingConfirmation;
  clarification?: ChatClarification;
  refusal?: ChatRefusal;
  proactiveRecap?: ChatProactiveRecap;
  result?: ChatResultCard;
  partial?: ChatPartial;
  error?: { code: string; message: string };
  asyncJob?: { jobId: string; turnId: string };
  serverTurnId?: string;
  /** Explicit auto-navigation hint lifted from propose/commit frames. */
  navigateTo?: ChatNavigateTo | null;
  /** True while the client is auto-retrying a transient failure. */
  reconnecting?: boolean;
  /** Set when a terminal error is a transient connectivity failure so
   * the UI can show a friendly "check your connection" message. */
  errorKind?: "network";
}
