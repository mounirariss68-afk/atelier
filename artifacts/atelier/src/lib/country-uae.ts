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

/** Bare-ISO-code → human-readable name for the caution copy. */
const ISO_DISPLAY: Record<string, string> = {
  AE: "United Arab Emirates", SA: "Saudi Arabia", GB: "United Kingdom",
  US: "United States", QA: "Qatar", KW: "Kuwait", BH: "Bahrain",
  OM: "Oman", EG: "Egypt", JO: "Jordan", LB: "Lebanon", TR: "Türkiye",
  DE: "Germany", FR: "France", NL: "Netherlands", CH: "Switzerland",
  LU: "Luxembourg", IE: "Ireland", ES: "Spain", IT: "Italy", PT: "Portugal",
  BE: "Belgium", AT: "Austria", SE: "Sweden", DK: "Denmark", NO: "Norway",
  FI: "Finland", PL: "Poland", CZ: "Czechia", GR: "Greece", CY: "Cyprus",
  MT: "Malta", IN: "India", PK: "Pakistan", SG: "Singapore", HK: "Hong Kong",
  JP: "Japan", KR: "South Korea", CN: "China", AU: "Australia",
  NZ: "New Zealand", CA: "Canada", BR: "Brazil", MX: "Mexico",
  ZA: "South Africa", NG: "Nigeria", KE: "Kenya", MA: "Morocco",
  TN: "Tunisia", DM: "Dominica", IL: "Israel",
};

/**
 * Render a stored country value for display: bare ISO alpha-2 codes get
 * expanded to the country name when known; anything else is shown as-is.
 */
export function countryDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return ISO_DISPLAY[trimmed.toUpperCase()] ?? trimmed.toUpperCase();
  }
  return trimmed;
}
