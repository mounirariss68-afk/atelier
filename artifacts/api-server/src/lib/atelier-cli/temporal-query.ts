/**
 * Task #644 — temporal normalization for entity lookup queries.
 *
 * Chat phrases like "the weekly catch up meeting today" used to pass
 * the WHOLE phrase into a literal ILIKE title match, which can never
 * hit ("today" is not part of the meeting title). This pure helper
 * extracts and strips temporal tokens (today / tonight / tomorrow,
 * weekday names, explicit ISO dates) from a lookup query, returning
 * the cleaned text plus the resolved wall date (YYYY-MM-DD in the
 * user's timezone) so the caller can narrow by DATE instead of
 * poisoning the title match.
 *
 * Pure + deterministic (Intl only via chat-tz) so probes cover it
 * offline without a DB.
 */

import { wallParts, todayInTz, tomorrowInTz } from "./chat-tz.js";

const WEEKDAYS: ReadonlyArray<[name: string, idx: number]> = [
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
];

/** Wall date N days after `now` in `tz`. */
function plusDaysInTz(tz: string, now: Date, days: number): string {
  return wallParts(new Date(now.getTime() + days * 24 * 3600 * 1000), tz).ymd;
}

export interface TemporalHints {
  /** Query with temporal tokens (and dangling connectors) stripped. */
  cleaned: string;
  /** Resolved wall date (YYYY-MM-DD, user tz) or null when none found. */
  ymd: string | null;
  /** True when any temporal token was found and stripped. */
  hadTemporal: boolean;
}

/**
 * Extract + strip temporal tokens from `query`.
 * Handles: explicit YYYY-MM-DD, "today"/"tonight", "tomorrow"
 * (incl. possessive "tomorrow's"), and weekday names with optional
 * "on / this / next" prefixes. "next <weekday>" resolves to the
 * occurrence in the FOLLOWING week when the nearest one is within
 * this week; a bare weekday resolves to the nearest upcoming
 * occurrence (today counts).
 */
export function extractTemporalHints(
  query: string,
  tz: string,
  now: Date = new Date(),
): TemporalHints {
  let s = ` ${query ?? ""} `;
  let ymd: string | null = null;
  let had = false;

  // Explicit ISO date.
  s = s.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (_m, d: string) => {
    ymd = ymd ?? d;
    had = true;
    return " ";
  });

  // tomorrow / today / tonight (possessive tolerated).
  s = s.replace(/\btomorrow(?:'s|s)?\b/gi, () => {
    ymd = ymd ?? tomorrowInTz(tz, now);
    had = true;
    return " ";
  });
  s = s.replace(/\b(?:today(?:'s|s)?|tonight(?:'s|s)?)\b/gi, () => {
    ymd = ymd ?? todayInTz(tz, now);
    had = true;
    return " ";
  });

  // Weekday names with optional on/this/next prefix.
  const todayIdx = wallParts(now, tz).weekday;
  for (const [name, idx] of WEEKDAYS) {
    const re = new RegExp(`\\b(?:(on|this|next)\\s+)?${name}(?:'s|s)?\\b`, "gi");
    s = s.replace(re, (_m, prefix: string | undefined) => {
      had = true;
      if (ymd === null) {
        let ahead = (idx - todayIdx + 7) % 7;
        const p = (prefix ?? "").toLowerCase();
        if (p === "next") {
          // "next friday" — the occurrence in the following week when
          // the nearest one falls inside this week (or is today).
          if (ahead === 0) ahead = 7;
          else if (idx > todayIdx) ahead += 7;
        } else if (ahead === 0 && p !== "this") {
          // Bare weekday matching today → keep today.
          ahead = 0;
        }
        ymd = plusDaysInTz(tz, now, ahead);
      }
      return " ";
    });
  }

  // Sweep dangling connectors left behind by the strips
  // ("meeting on", "catch up at ."), then collapse whitespace.
  const cleaned = s
    .replace(/\s+(on|at|for|this|next)\s+(?=\s|$)/gi, " ")
    .replace(/\b(on|at|for|this|next)\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,.\-–—:;]+|[,.\-–—:;]+$/g, "")
    .trim()
    // Leading articles never help a title match ("the weekly catch up").
    .replace(/^(?:the|a|an|my|our)\s+/i, "")
    .trim();

  return { cleaned, ymd, hadTemporal: had };
}

/** Words too generic to identify a meeting by title. */
const TITLE_STOPWORDS = new Set([
  "the", "a", "an", "my", "our", "your", "his", "her", "their",
  "meeting", "meetings", "mtg", "call", "session", "with", "and",
  "to", "of", "for", "on", "at", "in", "that", "this", "it", "please",
]);

/** Lowercase, de-punctuate, split into significant words. */
export function significantTitleWords(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !TITLE_STOPWORDS.has(w));
}

/**
 * Word-level, order-insensitive, punctuation-insensitive title match.
 * Returns the fraction of significant query words found in the title
 * (0..1); 1 means every significant query word matched. Hyphen/space
 * variants ("catch-up" / "catch up" / "catchup") match via the
 * squashed (space-less) forms in both directions.
 */
export function scoreTitleWordMatch(query: string, title: string): number {
  const qWords = significantTitleWords(query);
  if (qWords.length === 0) return 0;
  const tWords = new Set(significantTitleWords(title));
  const tSquashed = Array.from(tWords).join("");
  let hit = 0;
  for (const w of qWords) {
    if (tWords.has(w)) {
      hit++;
      continue;
    }
    // "catchup" ⊆ "weeklycatchup"; or query word is a piece of a
    // squashed title word run ("catch" + "up" handled word-wise above).
    if (w.length >= 4 && tSquashed.includes(w)) {
      hit++;
      continue;
    }
    // A title word may itself be a squash of adjacent query words
    // ("catch up" in the query vs "Catchup" in the title): the query
    // word counts as matched when it is a piece of such a title word.
    if (w.length >= 3 && Array.from(tWords).some((t) => t.length > w.length && t.includes(w))) {
      hit++;
      continue;
    }
  }
  return hit / qWords.length;
}

/** True when every significant query word matches the title. */
export function titleWordsAllMatch(query: string, title: string): boolean {
  return significantTitleWords(query).length > 0 && scoreTitleWordMatch(query, title) >= 1;
}
