import { z } from "zod";

export const LegacyTurnStatusSchema = z.enum([
  "streaming",
  "awaiting_confirmation",
  "awaiting_clarification",
  "partial",
  "success",
  "cancelled",
  "error",
  "read_only_no_op",
  "async_dispatched",
]);

export const AssistantTurnStateV1Schema = z.enum([
  "received",
  "running",
  "awaiting_confirmation",
  "awaiting_clarification",
  "partially_succeeded",
  "succeeded",
  "cancelled",
  "failed",
  "completed_without_effect",
  "work_dispatched",
]);

export type AssistantTurnStateV1 = z.infer<typeof AssistantTurnStateV1Schema>;

const STATUS_UPCAST: Record<z.infer<typeof LegacyTurnStatusSchema>, AssistantTurnStateV1> = {
  streaming: "running",
  awaiting_confirmation: "awaiting_confirmation",
  awaiting_clarification: "awaiting_clarification",
  partial: "partially_succeeded",
  success: "succeeded",
  cancelled: "cancelled",
  error: "failed",
  read_only_no_op: "completed_without_effect",
  async_dispatched: "work_dispatched",
};

export function upcastLegacyTurnStatus(status: unknown): AssistantTurnStateV1 {
  const parsed = LegacyTurnStatusSchema.safeParse(status);
  return parsed.success ? STATUS_UPCAST[parsed.data] : "failed";
}

export interface UpcastLegacyFrameResult {
  sourceProtocol: "legacy-cli-frame" | "assistant-v1";
  original: unknown;
  type: string;
  data: unknown;
}

const LEGACY_FRAME_TYPES = new Set([
  "narration",
  "text",
  "text_delta",
  "plan_step",
  "tool_call",
  "tool_result",
  "tool_evidence",
  "presentation",
  "needs_disambiguation",
  "needs_confirmation",
  "needs_clarification",
  "proposed_plan",
  "proactive_recap",
  "refusal",
  "budget_exceeded",
  "async_dispatched",
  "progress",
  "final",
  "error",
]);

/**
 * A lossless read adapter. Unknown legacy frames remain replayable as
 * compatibility events and never imply execution success.
 */
export function upcastLegacyFrame(frame: unknown): UpcastLegacyFrameResult {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    return {
      sourceProtocol: "legacy-cli-frame",
      original: frame,
      type: "compatibility.quarantined",
      data: null,
    };
  }
  const record = frame as Record<string, unknown>;
  const knownType =
    typeof record.type === "string" && LEGACY_FRAME_TYPES.has(record.type);
  const type = knownType ? `legacy.${record.type}` : "compatibility.quarantined";
  return {
    sourceProtocol: "legacy-cli-frame",
    original: frame,
    type,
    data: "data" in record ? record.data : null,
  };
}

export function upcastLegacyPendingWrite(input: unknown): {
  eligible: boolean;
  requiresFreshConfirmation: true;
  original: unknown;
} {
  return {
    eligible: Boolean(input && typeof input === "object" && !Array.isArray(input)),
    requiresFreshConfirmation: true,
    original: input,
  };
}

export const PersistedTurnSchemaVersion = 1 as const;

export interface PersistedTurnSourceVersionsV1 {
  protocolVersion?: string | number | null;
  promptVersion?: string | null;
  catalogVersion?: string | null;
  schemaVersion?: string | number | null;
  policyVersion?: string | null;
}

export interface PersistedFrameV1 extends UpcastLegacyFrameResult {
  schemaVersion: typeof PersistedTurnSchemaVersion;
  turnId: string;
  sequence: number;
}

export interface PersistedTurnV1 {
  schemaVersion: typeof PersistedTurnSchemaVersion;
  turnId: string;
  state: AssistantTurnStateV1;
  quarantined: boolean;
  quarantineReasons: string[];
  prompt: string;
  frames: PersistedFrameV1[];
  originalPayload: unknown;
  source: PersistedTurnSourceVersionsV1;
  clarificationRef: { turnId: string; frameSequence: number } | null;
  pendingActionCandidate: {
    sourceTurnId: string;
    idempotencyKey: string;
    requiresFreshConfirmation: true;
    eligible: boolean;
    original: unknown;
  } | null;
}

export function upcastPersistedTurnV1(input: {
  turnId: string;
  status: unknown;
  prompt: unknown;
  frames: unknown;
  pendingWrite?: unknown;
  originalPayload?: unknown;
  source?: PersistedTurnSourceVersionsV1 | null;
}): PersistedTurnV1 {
  const parsedStatus = LegacyTurnStatusSchema.safeParse(input.status);
  const sourceFrames = Array.isArray(input.frames) ? input.frames : [];
  const modern = input.source?.protocolVersion === 1;
  const frames = sourceFrames.map((frame, sequence) => {
    const upcasted = upcastLegacyFrame(frame);
    const rawType = frame && typeof frame === "object" && !Array.isArray(frame)
      ? (frame as Record<string, unknown>).type
      : null;
    return {
      ...upcasted,
      sourceProtocol: modern ? "assistant-v1" as const : upcasted.sourceProtocol,
      type:
        modern &&
        typeof rawType === "string" &&
        LEGACY_FRAME_TYPES.has(rawType)
          ? `assistant.${rawType}`
          : upcasted.type,
      schemaVersion: PersistedTurnSchemaVersion,
      turnId: input.turnId,
      sequence,
    };
  });
  let clarificationFrame: PersistedFrameV1 | undefined;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (
      frames[index].type === "legacy.needs_clarification" ||
      frames[index].type === "assistant.needs_clarification"
    ) {
      clarificationFrame = frames[index];
      break;
    }
  }
  const pending = input.pendingWrite === undefined || input.pendingWrite === null
    ? null
    : upcastLegacyPendingWrite(input.pendingWrite);
  const quarantineReasons = [
    ...(!parsedStatus.success ? ["unknown_turn_status"] : []),
    ...frames
      .filter((frame) => frame.type === "compatibility.quarantined")
      .map((frame) => `unknown_frame_type:${frame.sequence}`),
  ];
  return {
    schemaVersion: PersistedTurnSchemaVersion,
    turnId: input.turnId,
    state: upcastLegacyTurnStatus(input.status),
    quarantined: quarantineReasons.length > 0,
    quarantineReasons,
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    frames,
    originalPayload: input.originalPayload ?? {
      status: input.status,
      prompt: input.prompt,
      frames: input.frames,
      pendingWrite: input.pendingWrite ?? null,
    },
    source: { ...(input.source ?? {}) },
    clarificationRef: clarificationFrame
      ? { turnId: input.turnId, frameSequence: clarificationFrame.sequence }
      : null,
    pendingActionCandidate: pending
      ? {
          sourceTurnId: input.turnId,
          idempotencyKey: `legacy-turn:${input.turnId}:pending-write`,
          requiresFreshConfirmation: true,
          eligible: pending.eligible,
          original: pending.original,
        }
      : null,
  };
}