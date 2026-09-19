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
  sourceProtocol: "legacy-cli-frame";
  original: unknown;
  type: string;
  data: unknown;
}

/**
 * A lossless read adapter. Unknown legacy frames remain replayable as
 * compatibility events and never imply execution success.
 */
export function upcastLegacyFrame(frame: unknown): UpcastLegacyFrameResult {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    return {
      sourceProtocol: "legacy-cli-frame",
      original: frame,
      type: "compatibility.unknown",
      data: null,
    };
  }
  const record = frame as Record<string, unknown>;
  const type =
    typeof record.type === "string" && record.type.length > 0
      ? `legacy.${record.type}`
      : "compatibility.unknown";
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