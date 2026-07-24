/**
 * Task #643 — pending-clarification rehydration, shared by web + mobile.
 *
 * A pending clarification question used to live only in client memory,
 * so a reload (or app relaunch) made it vanish while the server kept
 * waiting for an answer. On mount, clients ask the server whether the
 * persona's most recent turn is still paused on a clarification
 * (GET /api/atelier/cli/turns/pending-clarification) and, if so,
 * restore the turn (and its session) so the question card renders again.
 */
import type { ChatClarificationField, ChatTurnCore } from "./types";

export interface PendingClarificationPayload {
  turnId: string;
  sessionId: string;
  prompt: string;
  createdAt: string;
  clarification: {
    field: string;
    question: string;
    tool: string;
    partial: Record<string, unknown>;
    suggestions: Array<{ id: string; label: string; hint?: string }>;
    fields?: ChatClarificationField[];
  };
}

export interface RestoredClarification {
  core: ChatTurnCore;
  prompt: string;
  sessionId: string;
  startedAt: number;
}

/** Map the server payload to frame-derived turn state. Each client
 * spreads `core` into its own turn type with its identity fields. */
export function restoreClarificationTurn(
  p: PendingClarificationPayload,
): RestoredClarification {
  return {
    prompt: p.prompt,
    sessionId: p.sessionId,
    startedAt: Date.parse(p.createdAt) || Date.now(),
    core: {
      status: "needs_clarification",
      text: "",
      trace: [],
      toolResults: [],
      serverTurnId: p.turnId,
      clarification: {
        field: p.clarification.field,
        question: p.clarification.question,
        tool: p.clarification.tool,
        partial: p.clarification.partial ?? {},
        suggestions: p.clarification.suggestions ?? [],
        fields: Array.isArray(p.clarification.fields) ? p.clarification.fields : [],
      },
    },
  };
}
