/**
 * Task #333 — CLI client-side types.
 * Task #643 — the protocol types (frames, turn state, cards) now live
 * in the shared `@workspace/chat-core` package so web and mobile
 * compile against a single source of truth. This module re-exports
 * them under their established `Cli*` names and keeps the web-only
 * types (capability catalog, attachments, locale).
 */

import type {
  ChatClarification,
  ChatClarificationField,
  ChatDisambigOption,
  ChatFrame,
  ChatFrameType,
  ChatPendingConfirmation,
  ChatPlanStep,
  ChatProactiveRecap,
  ChatRefusal,
  ChatResultCard,
  ChatResultEntity,
  ChatTurnCore,
  ChatTurnStatus,
} from "@workspace/chat-core";

export type CliFrameType = ChatFrameType;
export type CliFrame = ChatFrame;
export type CliTurnStatus = ChatTurnStatus;
export type CliClarification = ChatClarification;
export type CliClarificationField = ChatClarificationField;
export type CliRefusal = ChatRefusal;
export type CliProactiveRecap = ChatProactiveRecap;
export type CliPlanStep = ChatPlanStep;
export type CliDisambigOption = ChatDisambigOption;
export type CliPendingConfirmation = ChatPendingConfirmation;
export type CliResultEntity = ChatResultEntity;
export type CliResultCard = ChatResultCard;

/**
 * Web turn = shared frame-derived state (`ChatTurnCore`) plus the
 * web-only identity and plan-editing fields.
 */
export interface CliTurn extends ChatTurnCore {
  /** Stable client-side id; replaced by server `turnId` on the `final` frame. */
  clientTurnKey: string;
  prompt: string;
  startedAt: number;
  /** Per-step exclusion checkboxes for bulk plans (>20 steps). */
  excludedStepIndexes?: number[];
  /** Inline plan-row label edits keyed by step index, applied before
   * confirmation. Forwarded with the confirm POST as `planEdits`; the
   * server confirm route currently ignores unknown body fields, so
   * this is forward-safe for downstream Tasks #334/#335 enforcement. */
  planEdits?: Record<number, string>;
  /** Last path we already auto-navigated to for this turn — guards
   * against firing the same destination twice (e.g. propose and
   * commit phases both pointing at the same opportunity page). */
  navigatedTo?: string | null;
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
  /** Task #20 — opt-in flag: only capabilities explicitly marked
   * promotable server-side contribute suggestion chips. /help still
   * shows every capability's example phrases. */
  promoteAsSuggestion?: boolean;
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
