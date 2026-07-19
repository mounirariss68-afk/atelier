/**
 * Shared country helpers for the contract-pages "non-UAE entity" caution
 * (Task #292). Mirrors the alias logic in `lib/db/src/atelier-reference-mapping.ts`
 * (frontend can't import that server-side lib) for the one question the UI
 * needs: "is this stored country value the United Arab Emirates?".
 */

/** Lowercase, strip punctuation/diacritics, collapse whitespace. */
function normalize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Normalised keys recognised as UAE. Exported (as a readonly copy accessor)
 * only so the cross-check test can verify parity with the server-side alias
 * table in `lib/db/src/atelier-reference-mapping.ts`.
 */
export const UAE_KEYS: ReadonlySet<string> = new Set([
  "ae",
  "uae",
  "u a e",
  "emirates",
  "united arab emirates",
  "uae abu dhabi",
  "uae dubai",
  "uae sharjah",
  "abu dhabi",
  "dubai",
  "difc",
  "adgm",
  "uae difc",
  "uae adgm",
  "uae other",
]);

/**
 * True when the stored country value refers to the United Arab Emirates,
 * accepting ISO code ("AE"), aliases ("UAE", "U.A.E.") or the full name,
 * case-insensitively and ignoring punctuation.
 */
export function isUaeCountry(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const key = normalize(raw);
  return key.length > 0 && UAE_KEYS.has(key);
}

/**
 * Bare-ISO-code → human-readable English name, backed by the platform's
 * built-in CLDR data (`Intl.DisplayNames`) instead of a hand-copied table,
 * so it can never drift from the server-side ISO 3166-1 allowlist in
 * `lib/db/src/atelier-reference-mapping.ts`.
 */
const regionDisplayNames: Intl.DisplayNames | null = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

/**
 * Render a stored country value for display: bare ISO alpha-2 codes get
 * expanded to the country name when known; anything else is shown as-is.
 * Unknown codes fall back to the uppercased code.
 */
export function countryDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    try {
      return regionDisplayNames?.of(upper) ?? upper;
    } catch {
      return upper;
    }
  }
  return trimmed;
}
