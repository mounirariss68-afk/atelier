/**
 * Task #484 — server-side locale preamble strip.
 *
 * The Atelier client wraps every chat prompt with a locale instruction
 * ("Respond in English." / "أجب بالعربيّة.") followed by a blank line so
 * the model picks the response language. That preamble is transport
 * metadata — it must never reach a content consumer (entity-hint
 * extractor, regex router, fallback slice, redaction, rolling summary).
 *
 * This is the single server-side source of truth. The matching client
 * helper lives at `artifacts/atelier/src/components/cli/locale.ts:166`.
 * Keep both in sync if a new locale is added.
 */
const LOCALE_PREAMBLES = [
  "Respond in English.",
  "أجب بالعربيّة.",
  "أجب بالعربية.",
] as const;

export function stripLocalePreamble(text: string): string {
  let t = text ?? "";
  for (const p of LOCALE_PREAMBLES) {
    if (t.startsWith(p)) {
      t = t.slice(p.length).replace(/^\r?\n+/, "");
      break;
    }
  }
  return t;
}
