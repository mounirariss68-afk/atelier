/**
 * Task #782 — friendly-miss helpers shared by the meeting lookup
 * surfaces (and reusable elsewhere): when a name lookup finds nothing,
 * offer the closest real candidates instead of a bare "not found".
 *
 * Pure — no DB, no LLM — so the meeting-chat probes cover it offline.
 */
import { foldRosterName } from "./chat-normalizers.js";

/** Small, dependency-free Levenshtein distance (words are short). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Type alias (not interface) so it stays assignable to the
 * `Record<string, unknown>` option envelopes in ToolResult. */
export type NearestCandidate = {
  id: string;
  label: string;
  secondary?: string;
};

/**
 * Rank candidates by closeness of their (folded) label to the (folded)
 * needle. A candidate qualifies when any of its name tokens is a
 * prefix/near-typo of the needle (or vice versa). Returns at most `max`
 * candidates, best first — empty when nothing is plausibly close, so
 * callers can fall back to plain friendly copy.
 */
export function rankNearestNames(
  needle: string,
  candidates: NearestCandidate[],
  max = 3,
): NearestCandidate[] {
  const n = foldRosterName(needle.trim());
  if (n.length < 2) return [];
  const scored = candidates
    .map((c) => {
      const tokens = foldRosterName(c.label).split(/\s+/).filter(Boolean);
      let best = Number.POSITIVE_INFINITY;
      for (const t of tokens.concat(foldRosterName(c.label))) {
        if (!t) continue;
        // Prefix either way is a strong signal ("gok" → "gokhan").
        if (t.startsWith(n) || n.startsWith(t)) {
          best = Math.min(best, 0.1);
          continue;
        }
        const d = levenshtein(n, t);
        const rel = d / Math.max(n.length, t.length);
        best = Math.min(best, rel);
      }
      return { c, best };
    })
    // Allow roughly one typo per 3 characters, capped sensibly.
    .filter((x) => x.best <= Math.min(0.45, Math.max(0.34, 2 / Math.max(3, n.length))))
    .sort((a, b) => a.best - b.best);
  const out: NearestCandidate[] = [];
  for (const { c } of scored) {
    if (!out.some((o) => o.id === c.id)) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Extract an attendee-name needle from a meeting lookup phrase:
 * "my meeting with Sarah" → "sarah"; "catch-up w/ Gökhan tomorrow" →
 * "gokhan". Returns null when the phrase has no with-clause.
 */
export function attendeeNeedleFromQuery(cleanedQuery: string): string | null {
  const m = /\b(?:with|w\/|avec)\s+(.+)$/i.exec(cleanedQuery.trim());
  if (!m) return null;
  // Drop trailing filler the temporal stripper may have left behind.
  const needle = m[1]!
    .replace(/\b(?:and|et)\b/gi, " ")
    .replace(/[.,;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return needle.length >= 2 ? needle : null;
}
