/**
 * Task #741 — typed per-session facts & intent normalization.
 *
 * Captures the concrete facts a user states or resolves during a chat
 * session (dates, destinations, party sizes, chosen options, resolved
 * entities) into a dedicated org/user-scoped table, and renders a
 * compact facts block into every later turn's context so the model can
 * reuse them deterministically ("same dates I specified", "the flight
 * I picked") instead of re-deriving them from prose.
 *
 * Design rules:
 * - Extraction is PURE (`extractFactsFromToolEvent`, `normalizeControlIntent`,
 *   `resolveFactsTimezone`, `renderFactsBlock`) so the offline probe runs
 *   without a DB.
 * - Writers are fire-and-forget with loud logging — a facts failure must
 *   never block a turn, a confirm, or an async job.
 * - Rolling summaries and auto-titles are display metadata only; facts
 *   are written exclusively from user-stated values, clarification
 *   answers, and tool successes.
 * - Rollout mode via ATELIER_CLI_FACTS_MODE: "off" (no writes/reads),
 *   "shadow" (writes + telemetry, block NOT rendered), "on" (default).
 */

import { db, atelierCliSessionFacts } from "@workspace/db";
import { and, eq, inArray, lt } from "drizzle-orm";

/** Bumped together with the system-prompt wording that references facts. */
export const FACTS_CONTRACT_VERSION = 1;

/** Facts older than this are purged opportunistically (per-session TTL). */
const FACTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard cap on facts surfaced per turn (newest first). */
const FACTS_RENDER_CAP = 24;
/** Char cap on the rendered block. */
const FACTS_BLOCK_CHAR_CAP = 2_000;

export type FactsMode = "off" | "shadow" | "on";

export function factsMode(): FactsMode {
  const v = String(process.env.ATELIER_CLI_FACTS_MODE ?? "on").toLowerCase();
  return v === "off" || v === "shadow" ? v : "on";
}

export type FactKind =
  | "date"
  | "place"
  | "person"
  | "entity"
  | "quantity"
  | "selection"
  | "other";

export interface SessionFact {
  kind: FactKind;
  /** Stable per-session key, e.g. "travel_search_flights.segments.0.date". */
  key: string;
  value: unknown;
  display: string;
  source: "user_stated" | "tool_result" | "clarification" | "confirm" | "async_job";
}

// ---------------------------------------------------------------------
// Timezone precedence — relative dates are interpreted ONCE and the
// RESOLVED value is what gets stored. Precedence: turn timezone >
// session page-context snapshot timezone > org default.
// ---------------------------------------------------------------------

export const ORG_DEFAULT_TIMEZONE = "Asia/Dubai";

export function resolveFactsTimezone(
  turnTz?: string | null,
  sessionSnapshotTz?: string | null,
  orgDefault: string = ORG_DEFAULT_TIMEZONE,
): string {
  const valid = (tz: unknown): tz is string => {
    if (typeof tz !== "string" || tz.length === 0) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  };
  if (valid(turnTz)) return turnTz;
  if (valid(sessionSnapshotTz)) return sessionSnapshotTz;
  return orgDefault;
}

// ---------------------------------------------------------------------
// Control-intent normalization — confirm/decline/continue as explicit
// enum values instead of free-text shape heuristics. Deterministic and
// multi-lingual (EN/TR/AR + common variants); anything ambiguous is null
// so callers fall back to the existing path.
// ---------------------------------------------------------------------

export type ControlIntent = "affirm" | "decline" | "cancel";

const AFFIRM_WORDS = new Set([
  "yes", "y", "yes please", "yep", "yeah", "sure", "ok", "okay", "confirm",
  "confirmed", "correct", "right", "exactly", "go ahead", "proceed", "do it",
  "sounds good", "that works", "please do", "affirmative",
  "evet", "tamam", "onayla", "onaylıyorum", "olur", "aynen",
  "نعم", "اجل", "أجل", "تمام", "موافق", "اكيد", "أكيد",
]);
const DECLINE_WORDS = new Set([
  "no", "n", "nope", "no thanks", "no thank you", "decline", "reject",
  "don't", "dont", "negative", "not now",
  "hayır", "hayir", "yok", "istemiyorum", "iptal etme",
  "لا", "كلا", "لا شكرا", "لا شكراً",
]);
const CANCEL_WORDS = new Set([
  "cancel", "stop", "abort", "never mind", "nevermind", "forget it",
  "iptal", "vazgeç", "vazgec", "dur",
  "الغاء", "إلغاء", "توقف",
]);

/**
 * Normalize a short reply to an explicit control intent. Returns null
 * unless the ENTIRE prompt (minus punctuation) is an unambiguous
 * affirm/decline/cancel token — partial matches never fire, so ordinary
 * sentences can't be swallowed.
 */
export function normalizeControlIntent(prompt: string): ControlIntent | null {
  const norm = prompt
    .trim()
    .toLowerCase()
    .replace(/[.!?،؟\u200f\u200e]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm || norm.length > 24) return null;
  if (AFFIRM_WORDS.has(norm)) return "affirm";
  if (DECLINE_WORDS.has(norm)) return "decline";
  if (CANCEL_WORDS.has(norm)) return "cancel";
  return null;
}

// ---------------------------------------------------------------------
// Fact extraction from tool events (pure)
// ---------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

const DATE_KEY_RE = /(^|_|\.)(date|check_?in|check_?out|start|end|due|when|deadline)($|_|s\b)/i;
const PLACE_KEY_RE = /(^|_|\.)(origin|destination|city|location|place|airport|country|venue)($|_)/i;
const QTY_KEY_RE = /(^|_|\.)(adults|children|guests|nights|party_?size|passengers|quantity|seats|attendees|count|rooms)($|_)/i;
const PERSON_KEY_RE = /(^|_|\.)(attendee|person|contact|recipient|assignee|owner)_?(name|email)?s?($|_)/i;
const IGNORED_KEY_RE = /(^|_|\.)(id|ids|token|cursor|page|offset|limit|hash|key|url|href)($|_)/i;

const kindForKey = (key: string, value: unknown): FactKind | null => {
  if (IGNORED_KEY_RE.test(key)) return null;
  if (DATE_KEY_RE.test(key) && typeof value === "string" && ISO_DATE_RE.test(value)) return "date";
  if (PLACE_KEY_RE.test(key) && typeof value === "string" && value.length <= 80) return "place";
  if (QTY_KEY_RE.test(key) && typeof value === "number" && Number.isFinite(value)) return "quantity";
  if (PERSON_KEY_RE.test(key) && typeof value === "string" && value.length <= 120) return "person";
  return null;
};

const displayFor = (key: string, value: unknown): string => {
  const short = key.split(".").slice(-2).join(".");
  return `${short} = ${typeof value === "string" ? value : JSON.stringify(value)}`;
};

/**
 * Extract typed facts from a successful tool event: user-provided INPUT
 * fields (the stated facts) plus selected/chosen entities from result
 * data. Generic and domain-agnostic — key-shape driven, so any new
 * capability gets facts capture for free.
 */
export function extractFactsFromToolEvent(evt: {
  tool: string;
  input: unknown;
  data?: unknown;
  source?: SessionFact["source"];
}): SessionFact[] {
  const out: SessionFact[] = [];
  const seen = new Set<string>();
  const push = (f: SessionFact) => {
    if (seen.has(f.key) || out.length >= 32) return;
    seen.add(f.key);
    out.push(f);
  };
  const source = evt.source ?? "tool_result";

  const walkInput = (v: unknown, path: string, depth: number): void => {
    if (depth > 3 || v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.slice(0, 6).forEach((item, i) => walkInput(item, `${path}.${i}`, depth + 1));
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        walkInput(val, path ? `${path}.${k}` : k, depth + 1);
      }
      return;
    }
    const kind = kindForKey(path, v);
    if (kind) {
      push({
        kind,
        key: `${evt.tool}.${path}`,
        value: v,
        display: displayFor(path, v),
        source,
      });
    }
  };
  walkInput(evt.input, "", 0);

  // Selections: results that represent a single chosen thing (entity /
  // selection payloads) — e.g. resolve_entity hits, travel_select_flight.
  const d = evt.data as Record<string, unknown> | null | undefined;
  if (d && typeof d === "object") {
    const ent = d.entity as Record<string, unknown> | undefined;
    if (ent && typeof ent === "object" && (ent.id || ent.label)) {
      push({
        kind: "entity",
        key: `${evt.tool}.entity`,
        value: { kind: ent.kind, id: ent.id, label: ent.label },
        display: `chosen ${String(ent.kind ?? "entity")}: "${String(ent.label ?? ent.id)}"`,
        source,
      });
    }
    const sel = (d.selected ?? d.selection ?? d.flight ?? d.choice) as
      | Record<string, unknown>
      | undefined;
    if (sel && typeof sel === "object" && (sel.id || sel.label)) {
      push({
        kind: "selection",
        key: `${evt.tool}.selected`,
        value: { id: sel.id, label: sel.label },
        display: `selected: "${String(sel.label ?? sel.id)}"`,
        source,
      });
    }
  }
  return out;
}

/** Compact context block; empty string when nothing to show. */
export function renderFactsBlock(
  facts: Array<{ kind: string; display: string }>,
): string {
  if (facts.length === 0) return "";
  const lines = facts
    .slice(0, FACTS_RENDER_CAP)
    .map((f) => `- [${f.kind}] ${f.display}`);
  let block =
    "Facts stated or chosen earlier in this conversation (authoritative — reuse them; " +
    "do not re-ask; re-fetch only if the user changes them):\n" + lines.join("\n");
  if (block.length > FACTS_BLOCK_CHAR_CAP) block = `${block.slice(0, FACTS_BLOCK_CHAR_CAP - 1)}…`;
  return block;
}

// ---------------------------------------------------------------------
// DB writers / readers (org/user-scoped; fire-and-forget at call sites)
// ---------------------------------------------------------------------

const ridFact = (): string =>
  `clif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export async function writeSessionFacts(args: {
  orgId: string;
  userId: string;
  sessionId: string;
  sourceTurnId?: string | null;
  facts: SessionFact[];
}): Promise<void> {
  if (factsMode() === "off" || args.facts.length === 0) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + FACTS_TTL_MS);
  for (const f of args.facts) {
    await db
      .insert(atelierCliSessionFacts)
      .values({
        id: ridFact(),
        orgId: args.orgId,
        userId: args.userId,
        sessionId: args.sessionId,
        kind: f.kind,
        key: f.key,
        value: f.value as never,
        display: f.display.slice(0, 300),
        sourceTurnId: args.sourceTurnId ?? null,
        source: f.source,
        createdAt: now,
        updatedAt: now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [atelierCliSessionFacts.sessionId, atelierCliSessionFacts.key],
        set: {
          value: f.value as never,
          display: f.display.slice(0, 300),
          kind: f.kind,
          source: f.source,
          sourceTurnId: args.sourceTurnId ?? null,
          updatedAt: now,
          expiresAt,
        },
      });
  }
}

/**
 * Load the session's facts (newest-updated first), including one hop of
 * rollover lineage. Strictly org/user-scoped — for self-only personas
 * the userId scope IS the me.* perimeter: facts can never surface
 * another person's data because they are only ever written and read
 * under the stating user's own id.
 */
export async function loadSessionFacts(args: {
  orgId: string;
  userId: string;
  sessionId: string;
  predecessorSessionId?: string | null;
}): Promise<Array<{ kind: string; key: string; value: unknown; display: string }>> {
  if (factsMode() === "off") return [];
  const sessionIds = [args.sessionId];
  if (args.predecessorSessionId) sessionIds.push(args.predecessorSessionId);
  // Opportunistic TTL purge for this user (bounded by index).
  await db
    .delete(atelierCliSessionFacts)
    .where(
      and(
        eq(atelierCliSessionFacts.orgId, args.orgId),
        eq(atelierCliSessionFacts.userId, args.userId),
        lt(atelierCliSessionFacts.expiresAt, new Date()),
      ),
    );
  const rows = await db
    .select({
      kind: atelierCliSessionFacts.kind,
      key: atelierCliSessionFacts.key,
      value: atelierCliSessionFacts.value,
      display: atelierCliSessionFacts.display,
      updatedAt: atelierCliSessionFacts.updatedAt,
    })
    .from(atelierCliSessionFacts)
    .where(
      and(
        eq(atelierCliSessionFacts.orgId, args.orgId),
        eq(atelierCliSessionFacts.userId, args.userId),
        inArray(atelierCliSessionFacts.sessionId, sessionIds),
      ),
    );
  return rows
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, FACTS_RENDER_CAP * 2)
    .map(({ kind, key, value, display }) => ({ kind, key, value, display }));
}
