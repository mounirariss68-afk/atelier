/**
 * Task #410 — pure SSE-frame parsing + per-turn reducer for the mobile
 * chat, extracted from useChat.ts so it can be unit tested under Node.
 *
 * Task #643 — the parser and reducer now live in the shared
 * `@workspace/chat-core` package (single source of truth with the web
 * CLI). This module re-exports them under the established mobile names
 * and defines the mobile turn type on top of the shared core.
 *
 * Notable shared-semantics notes for mobile consumers:
 *   - `applyFrame(turn, frame)` takes a whole `ChatFrame` (the old
 *     3-arg `(turn, type, data)` form is gone).
 *   - narration frames now ALSO append `kind:"narration"` trace
 *     entries (web renders those); the activity ticker must filter
 *     them out to keep showing only step/tool breadcrumbs.
 *   - progress breadcrumbs use `kind:"step"` (was "progress") with a
 *     `phase` tag for heartbeat collapsing.
 *   - `turn.error` is a `{ code, message }` object (was a string).
 *   - single-field clarification fields are no longer fabricated by
 *     the reducer — render via `resolveClarificationFields()`.
 */

import type {
  ChatClarificationField,
  ChatDisambigOption,
  ChatPendingConfirmation,
  ChatResultCard,
  ChatToolResult,
  ChatTraceEntry,
  ChatTurnCore,
  ChatTurnStatus,
  ClarificationChoice,
} from "@workspace/chat-core";

export {
  applyFrame,
  parseFrame,
  resolveClarificationFields,
  resetForRestream,
  type ChatFrame,
} from "@workspace/chat-core";

export type { ClarificationChoice };
export type ClarificationField = ChatClarificationField;
export type PendingConfirmation = ChatPendingConfirmation;
export type ResultCard = ChatResultCard;
export type ToolResult = ChatToolResult;
export type TurnStatus = ChatTurnStatus;
export type DisambigOption = ChatDisambigOption;
export type Trace = ChatTraceEntry;

/** Mobile turn = shared frame-derived state + mobile identity fields. */
export interface ChatTurn extends ChatTurnCore {
  key: string;
  prompt: string;
  attachments?: { id: string; name: string }[];
}
