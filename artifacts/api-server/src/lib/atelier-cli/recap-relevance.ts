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
 * Task #978 — outcome segment separator inside a rolling-summary line.
 * Appended by the turn-persist path when the turn achieved something:
 *   `[HH:MM:SS] <redacted prompt> → <status> (N tools) ⇒ <outcome phrase>`
 * The prompt is redacted BEFORE the line is built and never contains a
 * "⇒", so splitting on the LAST occurrence is safe.
 */
export const RECAP_OUTCOME_SEP = " ⇒ ";

/** Max length of a persisted outcome phrase (keeps the 2KB summary cap sane). */
const OUTCOME_MAX_LEN = 140;

/**
 * Compose a plain-language outcome phrase for a finished turn from
 * structural signals (never from the prompt text — PII stays out).
 * Returns null when the turn accomplished nothing describable.
 */
export function describeTurnOutcome(args: {
  status: string;
  toolCalls: Array<{ tool: string; ok?: boolean; isWrite?: boolean }>;
  /** Entities recorded on the session draft DURING this turn. */
  entities?: Array<{ kind: string; label: string }>;
  /** Tool of an uncommitted pending write, when status is awaiting_confirmation. */
  pendingTool?: string | null;
  /** e.g. humanizeToolName from the orchestrator ("account_create" → "create an account"). */
  humanizeTool: (toolName: string) => string;
}): string | null {
  const labels = (args.entities ?? [])
    .map((e) => e.label)
    .filter((l) => typeof l === "string" && l.trim().length > 0)
    .slice(0, 3);
  const labelSuffix = labels.length ? ` — ${labels.join(", ")}` : "";
  const uniq = (xs: string[]) => [...new Set(xs)];
  const cap = (s: string) =>
    s.length > OUTCOME_MAX_LEN ? s.slice(0, OUTCOME_MAX_LEN - 1) + "…" : s;

  const okWrites = uniq(
    args.toolCalls.filter((c) => c.ok === true && c.isWrite === true).map((c) => c.tool),
  );
  if (okWrites.length > 0 && (args.status === "success" || args.status === "partial")) {
    const done = okWrites.map((t) => args.humanizeTool(t)).join("; ");
    return cap(`Done: ${done}${labelSuffix}`);
  }
  if (args.status === "awaiting_confirmation") {
    const what = args.pendingTool ? args.humanizeTool(args.pendingTool) : "a change";
    return cap(`Drafted ${what}${labelSuffix} — awaiting your confirmation`);
  }
  if (args.status === "awaiting_clarification") {
    return "Asked you a follow-up question that wasn't answered";
  }
  const okReads = uniq(
    args.toolCalls.filter((c) => c.ok === true && c.isWrite !== true).map((c) => c.tool),
  );
  if (
    okReads.length > 0 &&
    (args.status === "success" || args.status === "read_only_no_op")
  ) {
    return cap(`Looked up ${okReads.map((t) => args.humanizeTool(t)).join("; ")}${labelSuffix}`);
  }
  return null;
}

/** Extract the outcome segment of a rolling-summary line, if present. */
export function outcomeOf(line: string): string | null {
  const idx = line.lastIndexOf(RECAP_OUTCOME_SEP);
  if (idx < 0) return null;
  const out = line.slice(idx + RECAP_OUTCOME_SEP.length).trim();
  return out.length > 0 ? out : null;
}

export interface RecapCard {
  /** Plain-language outcome lines ("Done: create an expense — Marriott"). */
  accomplishments: string[];
}

/**
 * Task #978 — compose the outcome-oriented recap card from the rolling
 * summary. ONLY lines carrying a real outcome segment contribute; legacy
 * prompt-echo lines (no `⇒`) never produce a card by themselves, so the
 * card cannot degrade back into restating what the user typed. Returns
 * null when there is no substance (the frame must then be suppressed
 * unless open threads exist).
 */
export function composeRecapCard(
  rollingSummary: string | null | undefined,
  maxItems = 5,
): RecapCard | null {
  if (!rollingSummary) return null;
  const outcomes: string[] = [];
  for (const line of rollingSummary.split("\n")) {
    if (line.trim().length === 0 || isTrivialRecapLine(line)) continue;
    const out = outcomeOf(line);
    if (!out) continue;
    // Collapse immediate repeats ("Looked up …" three times in a row).
    if (outcomes[outcomes.length - 1] === out) continue;
    outcomes.push(out);
  }
  if (outcomes.length === 0) return null;
  return { accomplishments: outcomes.slice(-maxItems) };
}

/**
 * Task #992 — build the explicit /recap (meta.recap) payload. Leads with
 * the composed outcome summary (same composer as the proactive card,
 * Task #978) plus open threads; the raw rolling-summary trace lines are
 * exposed ONLY as a legacy fallback when no composed summary exists, so
 * the command can never restate raw traces alongside the outcome lines.
 */
export function buildRecapPayload(args: {
  rollingSummary: string | null | undefined;
  openThreads: string[];
  maxLegacyLines?: number;
}): { accomplishments: string[]; openThreads: string[]; recap: string[] } {
  const card = composeRecapCard(args.rollingSummary);
  const accomplishments = card?.accomplishments ?? [];
  const recap =
    accomplishments.length > 0
      ? []
      : (args.rollingSummary ?? "")
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .slice(-(args.maxLegacyLines ?? 10));
  return { accomplishments, openThreads: args.openThreads, recap };
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
  /** Task #978 — unresolved items (pending confirm / unanswered question). */
  openThreads?: string[];
  dormantThresholdMs?: number;
}): boolean {
  const threshold = args.dormantThresholdMs ?? PROACTIVE_RECAP_DORMANT_MS;
  if (args.lastTurnAtMs <= 0) return false;
  const dormantMs = args.nowMs - args.lastTurnAtMs;
  if (dormantMs <= threshold) return false;
  // Substance rule (Task #978): a card renders only when the composed
  // outcome summary has real accomplishments OR there are open threads to
  // pick back up. Legacy prompt-echo lines alone never qualify.
  if ((args.openThreads ?? []).length > 0) return true;
  return composeRecapCard(args.rollingSummary) !== null;
}
