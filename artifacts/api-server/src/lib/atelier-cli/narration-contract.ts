/**
 * Task #645 — deterministic backstops against chat narration that
 * duplicates or contradicts result cards. Pure functions (no DB, no
 * Anthropic) so they can be unit-tested in isolation.
 */

/** Collect distinctive value tokens (numbers + strings ≥4 chars) from a
 * card payload, depth-limited so huge payloads stay cheap. */
export function cardPayloadTokens(data: unknown, depth = 0): Set<string> {
  const out = new Set<string>();
  if (data == null || depth > 4) return out;
  if (typeof data === "number") {
    out.add(String(data));
    return out;
  }
  if (typeof data === "string") {
    const s = data.trim();
    if (s.length >= 4 && s.length <= 120) out.add(s.toLowerCase());
    return out;
  }
  if (Array.isArray(data)) {
    for (const v of data.slice(0, 50)) {
      for (const t of cardPayloadTokens(v, depth + 1)) out.add(t);
    }
    return out;
  }
  if (typeof data === "object") {
    for (const v of Object.values(data as Record<string, unknown>)) {
      for (const t of cardPayloadTokens(v, depth + 1)) out.add(t);
    }
  }
  return out;
}

/** True when narration substantially restates the card payload: ≥3 of the
 * payload's distinctive value tokens appear verbatim in the prose (or ≥2
 * when the payload is small). */
export function narrationRestatesCard(text: string, cardData: unknown): boolean {
  const tokens = cardPayloadTokens(cardData);
  if (tokens.size === 0) return false;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const tok of tokens) {
    if (lower.includes(tok)) hits++;
    if (hits >= 3) return true;
  }
  return tokens.size <= 4 && hits >= 2;
}

/** First sentence of a prose block (fallback: first line / 200 chars). */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : t.split("\n")[0] ?? t).trim();
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/** Card-aware narration trim: when the prose restates the card payload,
 * clamp it to one framing sentence. */
export function trimNarrationForCard(text: string, cardData: unknown): string {
  if (!narrationRestatesCard(text, cardData)) return text;
  return firstSentence(text);
}

/** Stable identity key for a tool_result frame; used to drop exact
 * duplicate frames for the same step+tool within one turn. */
export function toolResultFrameKey(d: Record<string, unknown>): string {
  try {
    return JSON.stringify([d.step, d.tool, d.ok, d.errorCode, d.data]);
  } catch {
    return `${String(d.step)}:${String(d.tool)}:${String(d.ok)}`;
  }
}
