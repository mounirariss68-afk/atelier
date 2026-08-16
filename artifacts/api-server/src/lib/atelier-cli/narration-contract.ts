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

// ---------------------------------------------------------------------
// Task #792 — write-promise guard. A reply must never promise a save
// ("I'll save the back side now") and then refuse in the same turn:
// promised-write prose only surfaces on tool success.
// ---------------------------------------------------------------------

const WRITE_PROMISE_RE =
  /\b(?:i(?:'|’)?ll|i\s+will|i\s+am\s+going\s+to|i(?:'|’)?m\s+going\s+to|let\s+me(?:\s+now)?|going\s+to)\s+(?:now\s+)?(save|attach|upload|file|add|record|log|update|submit|create|store)\b/i;

/** True when a sentence commits to performing a write ("I'll save X now"). */
export function looksLikeWritePromise(text: string | null | undefined): boolean {
  if (!text) return false;
  return WRITE_PROMISE_RE.test(text);
}

/** Split prose into sentences (newline- and punctuation-delimited). */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Remove sentences that promise a write from prose emitted while NO
 * write has succeeded this turn. Keeps the rest of the reply (e.g. a
 * factual explanation) intact; returns "" when everything was promise.
 */
export function stripUnfulfilledWritePromises(text: string): string {
  if (!looksLikeWritePromise(text)) return text;
  return splitSentences(text)
    .filter((s) => !WRITE_PROMISE_RE.test(s))
    .join(" ")
    .trim();
}

/**
 * Task #792 — deflection scrub: chat must never claim a document task
 * "isn't available in this interface" or direct the user to a
 * profile-page upload (which does not exist on mobile). Removes such
 * sentences; returns the remaining prose ("" when nothing survives).
 */
const DEAD_END_ADVICE_RES: readonly RegExp[] = [
  /\b(?:isn'?t|is\s+not|not)\s+(?:currently\s+)?(?:available|supported|possible)\s+(?:in|on|through|from|via)\s+(?:this|the)\s+(?:chat|cli|assistant|surface|interface|app|conversation)\b/i,
  /\b(?:upload|update|add|attach|manage|replace|do)\b[^.!?\n]*\b(?:from|on|via|through|at|in)\s+(?:the\s+|your\s+)?profile\s+(?:page|tab|section)\b/i,
  /\bprofile\s+(?:page|tab|section)\b[^.!?\n]*\b(?:to\s+)?(?:upload|attach|add|update|replace)\b/i,
];

export function stripDeadEndDocumentAdvice(text: string): string {
  if (!DEAD_END_ADVICE_RES.some((re) => re.test(text))) return text;
  return splitSentences(text)
    .filter((s) => !DEAD_END_ADVICE_RES.some((re) => re.test(s)))
    .join(" ")
    .trim();
}

// ---------------------------------------------------------------------
// Task #1249 — classification grounding. The model once narrated a
// receipt as "low confidence (42%)" while the classify tool result
// right below said lowConfidence:false. Two pure defenses:
//   1. classifyGroundingNote() — a structured text block appended to
//      the classify tool_result so the model sees the verdict spelled
//      out, with an explicit do/don't instruction per attachment.
//   2. stripBogusLowConfidenceClaims() — deterministic backstop that
//      removes prose claiming low confidence / uncertainty about the
//      document type when every classification this turn was confident.
// ---------------------------------------------------------------------

export type ClassifyResultSummary = {
  fileName?: string | null;
  kind?: string | null;
  confidence?: number | null;
  lowConfidence?: boolean;
};

/** Extract the per-attachment summaries from a classify_finance_document
 * tool result payload ({ results: [...] }). Returns [] on any shape miss. */
export function extractClassifyResults(data: unknown): ClassifyResultSummary[] {
  const results = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !("error" in r))
    .map((r) => ({
      fileName: typeof r.fileName === "string" ? r.fileName : null,
      kind: typeof r.kind === "string" ? r.kind : null,
      confidence: typeof r.confidence === "number" ? r.confidence : null,
      lowConfidence: r.lowConfidence === true,
    }));
}

/** Structured grounding note the model receives alongside the classify
 * tool_result. Spells out the verdict so narration cannot misquote it. */
export function classifyGroundingNote(data: unknown): string | null {
  const results = extractClassifyResults(data);
  if (results.length === 0) return null;
  const lines = results.map((r) => {
    const name = r.fileName ?? "attachment";
    const pct = r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "n/a";
    return r.lowConfidence
      ? `- "${name}": lowConfidence=TRUE (confidence ${pct}). Ask the user ONE clarifying question about the document type; do NOT run an ingest tool yet.`
      : `- "${name}": classified as ${r.kind ?? "unknown"} with lowConfidence=FALSE (confidence ${pct}). This is a CONFIDENT classification — do NOT describe it as low confidence, do NOT invent a different confidence number, and do NOT ask the user what kind of document it is.`;
  });
  return `[classification grounding] The classifier's verdict, verbatim:\n${lines.join("\n")}\nYour reply must be consistent with these lowConfidence flags and confidence values.`;
}

const LOW_CONFIDENCE_CLAIM_RES: readonly RegExp[] = [
  /\blow[\s-]confidence\b/i,
  /\bconfidence\s+(?:score\s+)?(?:is|was|of)?\s*\(?\d{1,3}\s*%/i,
  /\b(?:not|isn'?t|wasn'?t)\s+(?:fully\s+|very\s+|entirely\s+)?(?:sure|confident|certain)\b[^.!?\n]*\b(?:document|receipt|invoice|statement|letter|file|type|kind)\b/i,
  /\bwhat\s+(?:kind|type)\s+of\s+document\s+(?:this|that|it)\s+is\b/i,
  /\bcould(?:n'?t| not)\s+(?:confidently\s+)?(?:classify|identify|determine)\b[^.!?\n]*\b(?:document|file|type|kind)\b/i,
];

/**
 * Remove sentences that claim low confidence / uncertainty about a
 * document classification. Applied ONLY when every classification this
 * turn reported lowConfidence:false, so genuine clarifications survive.
 * Returns the remaining prose ("" when nothing survives).
 */
export function stripBogusLowConfidenceClaims(text: string): string {
  if (!LOW_CONFIDENCE_CLAIM_RES.some((re) => re.test(text))) return text;
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !LOW_CONFIDENCE_CLAIM_RES.some((re) => re.test(s)))
    .join(" ")
    .trim();
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
