/**
 * Task #781 — proactive-recap relevance helpers.
 *
 * The "Catching you up" card used to fire whenever the in-memory session
 * draft was cold (server restart, re-entering a session from another page),
 * even at ~0h dormancy, and would happily headline trivial turns like
 * "who are you? → success". These pure helpers centralize the trigger and
 * the content filter so the orchestrator only recaps when there is genuine
 * dormancy AND something worth recapping.
 *
 * Rolling-summary line shape (see the turn-persist path in index.ts):
 *   `[HH:MM:SS] <redacted prompt ≤120 chars> → <status>( (N tools))?`
 */

/** Genuine-dormancy threshold: 6 hours. */
export const PROACTIVE_RECAP_DORMANT_MS = 6 * 60 * 60 * 1000;

/**
 * Prompts that never deserve a recap headline: identity/help/greeting
 * chatter and other content-free turns. Matched against the start of the
 * prompt portion of a rolling-summary line (case-insensitive).
 */
const TRIVIAL_PROMPT_RE =
  /^(who are you|what are you|what can you do|what do you do|how do you work|help|hi|hiya|hello|hey|yo|thanks|thank you|thx|ok(ay)?|cool|nice|test(ing)?|ping|good (morning|afternoon|evening))\b[\s?!.]*$/i;

/** Extract the prompt portion of a rolling-summary trace line. */
function promptOf(line: string): string {
  // Strip the leading `[HH:MM:SS] ` stamp if present.
  const noStamp = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
  // The prompt runs until the ` → status` arrow (arrow never appears in the
  // redacted prompt; if it's missing, treat the whole line as the prompt).
  const arrow = noStamp.lastIndexOf(" → ");
  return (arrow >= 0 ? noStamp.slice(0, arrow) : noStamp).trim();
}

/** True when a rolling-summary line is trivial chatter (never recap-worthy). */
export function isTrivialRecapLine(line: string): boolean {
  const prompt = promptOf(line);
  if (prompt.length === 0) return true;
  return TRIVIAL_PROMPT_RE.test(prompt);
}

/**
 * Compose the recap summary from the rolling summary: the last `maxLines`
 * non-trivial trace lines, or `null` when nothing is worth recapping
 * (in which case the recap frame must be suppressed entirely).
 */
export function composeRecapSummary(
  rollingSummary: string | null | undefined,
  maxLines = 5,
): string | null {
  if (!rollingSummary) return null;
  const meaningful = rollingSummary
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .filter((l) => !isTrivialRecapLine(l));
  if (meaningful.length === 0) return null;
  return meaningful.slice(-maxLines).join("\n");
}

/**
 * Trigger decision: recap only after genuine dormancy. A cold in-memory
 * draft (server restart / navigation) is NOT a resume signal — the client
 * still has the conversation on screen.
 *
 * `lastTurnAtMs === 0` means the session has no recorded activity time; we
 * cannot claim dormancy, so we stay quiet.
 */
export function shouldEmitProactiveRecap(args: {
  lastTurnAtMs: number;
  nowMs: number;
  rollingSummary: string | null | undefined;
  dormantThresholdMs?: number;
}): boolean {
  const threshold = args.dormantThresholdMs ?? PROACTIVE_RECAP_DORMANT_MS;
  if (!args.rollingSummary || args.rollingSummary.length === 0) return false;
  if (args.lastTurnAtMs <= 0) return false;
  const dormantMs = args.nowMs - args.lastTurnAtMs;
  if (dormantMs <= threshold) return false;
  return composeRecapSummary(args.rollingSummary) !== null;
}
