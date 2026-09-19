import type { ChatFrame, ChatFrameType } from "./types";
import {
  ASSISTANT_FRAME_ENVELOPE_KEY,
  AssistantFrameEnvelopeV1Schema,
} from "@workspace/assistant-protocol";
import { isKnownChatFrameType, normalizeChatFrame } from "./frames";

/**
 * Parse one fully-buffered SSE message block into a `ChatFrame`.
 *
 * The SSE parser deliberately stays tiny — no EventSource, no
 * dependency: EventSource doesn't allow custom POST bodies, and the
 * orchestrator emits one frame per `event:`/`data:` pair separated by
 * a blank line.
 */
export function parseFrame(block: string): ChatFrame | null {
  let event: ChatFrameType | null = null;
  const dataLines: string[] = [];
  for (const raw of block.split(/\r?\n/)) {
    if (raw.startsWith("event:")) event = raw.slice(6).trim() as ChatFrameType;
    else if (raw.startsWith("data:")) dataLines.push(raw.slice(5).trim());
  }
  if (!event || !isKnownChatFrameType(event)) return null;
  let data: Record<string, unknown> = {};
  if (dataLines.length > 0) {
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      data = { _raw: dataLines.join("\n") };
    }
  }
  const rawEnvelope = data[ASSISTANT_FRAME_ENVELOPE_KEY];
  if (rawEnvelope === undefined) {
    return { type: event, data, receivedAt: Date.now() };
  }
  const parsedEnvelope = AssistantFrameEnvelopeV1Schema.safeParse(rawEnvelope);
  if (!parsedEnvelope.success) return null;
  const payload = { ...data };
  delete payload[ASSISTANT_FRAME_ENVELOPE_KEY];
  return normalizeChatFrame({
    type: event,
    data: payload,
    receivedAt: Date.now(),
    ...parsedEnvelope.data,
  });
}

/**
 * Only http(s) URLs are safe to render as clickable anchors. Source URLs
 * arrive from untrusted web-search results, so any other scheme (notably
 * `javascript:`) must be rejected before it can become an `href`.
 */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}
