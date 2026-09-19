import {
  AssistantFrameEnvelopeV1Schema,
} from "@workspace/assistant-protocol";
import type { ChatFrame, ChatFrameType, ChatProtocolMode } from "./types";

const KNOWN_FRAME_TYPES: ReadonlySet<string> = new Set<ChatFrameType>([
  "narration",
  "text_delta",
  "plan_step",
  "proposed_plan",
  "proactive_recap",
  "tool_call",
  "tool_result",
  "presentation",
  "needs_disambiguation",
  "needs_confirmation",
  "needs_clarification",
  "refusal",
  "async_dispatched",
  "partial_success",
  "progress",
  "final",
  "error",
  "budget_exceeded",
]);

export function isKnownChatFrameType(value: unknown): value is ChatFrameType {
  return typeof value === "string" && KNOWN_FRAME_TYPES.has(value);
}

export function inferPersistedProtocolMode(
  frames: readonly unknown[] | null | undefined,
): ChatProtocolMode {
  for (const value of frames ?? []) {
    if (value && typeof value === "object" && (value as { mode?: unknown }).mode === "semantic") {
      return "current";
    }
  }
  return "legacy";
}

export function normalizeChatFrame(
  value: unknown,
  options: { receivedAt?: number; expectedMode?: ChatProtocolMode } = {},
): ChatFrame | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ChatFrame>;
  if (!isKnownChatFrameType(raw.type) || !raw.data || typeof raw.data !== "object") return null;
  const semantic = raw.mode === "semantic";
  if (options.expectedMode === "current" && !semantic) return null;
  if (options.expectedMode === "legacy" && semantic) return null;
  if (semantic) {
    const parsed = AssistantFrameEnvelopeV1Schema.safeParse({
      protocolVersion: raw.protocolVersion,
      presentationDataVersion: raw.presentationDataVersion,
      mode: raw.mode,
      turnId: raw.turnId,
      sequence: raw.sequence,
      terminal: raw.terminal,
      ...(raw.outcome ? { outcome: raw.outcome } : {}),
    });
    if (!parsed.success) return null;
    return {
      type: raw.type,
      data: raw.data,
      receivedAt: options.receivedAt ?? raw.receivedAt ?? Date.now(),
      ...parsed.data,
    };
  }
  return {
    type: raw.type,
    data: raw.data,
    receivedAt: options.receivedAt ?? raw.receivedAt ?? Date.now(),
  };
}