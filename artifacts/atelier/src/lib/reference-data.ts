/**
 * Reference-data client helpers (Task #290).
 *
 * Pure functions used by <ReferenceCombobox/> for filtering, sorting, and
 * normalizing country / industry / sub-industry lookups. Kept side-effect
 * free so they can be unit-tested without React or fetch infrastructure.
 */

export interface CountryRow {
  isoAlpha2: string;
  isoAlpha3: string;
  isoNumeric: string;
  displayNameEn: string;
  displayNameAr?: string | null;
  displayNameTr?: string | null;
  aliases: string[];
  region: string;
  subRegion?: string | null;
  flagEmoji?: string | null;
  primaryCurrency?: string | null;
  primaryLanguage?: string | null;
  dialCode?: string | null;
  vatDefaultPct?: number | null;
  isGcc: boolean;
  isAicoTargetMarket: boolean;
  status: "active" | "deprecated";
  displayOrderOverride?: number | null;
}

export interface IndustryRow {
  code: string;
  displayNameEn: string;
  displayNameAr?: string | null;
  shortDescription?: string | null;
  displayOrder: number;
  status: "active" | "deprecated";
}

export interface SubIndustryRow {
  code: string;
  industryCode: string;
  displayNameEn: string;
  displayNameAr?: string | null;
  shortDescription?: string | null;
  displayOrder: number;
  status: "active" | "deprecated";
  defaultOfferingAnchor?: string | null;
}

export interface ReferenceBootstrap {
  countries: CountryRow[];
  industries: IndustryRow[];
  subIndustries: SubIndustryRow[];
}

// Locale used to render display labels in the combobox. We default to EN;
// the AR/TR strings are stored on each row and ready for a future i18n pass.
export type ReferenceLocale = "en" | "ar" | "tr";

/**
 * Normalize a string for accent + case insensitive search.
 * "Türkiye" → "turkiye", "São Paulo" → "sao paulo".
 */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Sort countries per the patch spec:
 *   1. GCC (in fixed display order — SA, AE, QA, KW, BH, OM via display_order_override)
 *   2. AICo target markets (TR by default)
 *   3. MENA non-GCC
 *   4. Everything else alphabetically by EN name
 *   5. Deprecated entries last (excluded by default upstream)
 */
export function sortCountries(rows: CountryRow[]): CountryRow[] {
  const bucket = (c: CountryRow): number => {
    if (c.status === "deprecated") return 9;
    if (c.isGcc) return 1;
    if (c.isAicoTargetMarket) return 2;
    if (c.region === "MENA") return 3;
    return 4;
  };
  return [...rows].sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    // Within GCC + target buckets, honour display_order_override first.
    if (a.displayOrderOverride != null || b.displayOrderOverride != null) {
      const oa = a.displayOrderOverride ?? Number.POSITIVE_INFINITY;
      const ob = b.displayOrderOverride ?? Number.POSITIVE_INFINITY;
      if (oa !== ob) return oa - ob;
    }
    return a.displayNameEn.localeCompare(b.displayNameEn);
  });
}

export function sortIndustries(rows: IndustryRow[]): IndustryRow[] {
  return [...rows].sort((a, b) => a.displayOrder - b.displayOrder);
}

export function sortSubIndustries(rows: SubIndustryRow[]): SubIndustryRow[] {
  return [...rows].sort((a, b) => {
    if (a.industryCode !== b.industryCode)
      return a.industryCode.localeCompare(b.industryCode);
    return a.displayOrder - b.displayOrder;
  });
}

/**
 * Resolve free-text input to a canonical country row. Tries, in order:
 *   1. Exact ISO alpha-2 match.
 *   2. Exact ISO alpha-3 match.
 *   3. Case + accent insensitive `display_name_en|ar|tr` match.
 *   4. Case-insensitive alias match.
 * Returns null if no confident match.
 */
export function resolveCountry(input: string, rows: CountryRow[]): CountryRow | null {
  if (!input) return null;
  const raw = input.trim();
  const upper = raw.toUpperCase();
  if (upper.length === 2) {
    const hit = rows.find((r) => r.isoAlpha2 === upper);
    if (hit) return hit;
  }
  if (upper.length === 3) {
    const hit = rows.find((r) => r.isoAlpha3 === upper);
    if (hit) return hit;
  }
  const norm = normalize(raw);
  const byName = rows.find(
    (r) =>
      normalize(r.displayNameEn) === norm ||
      (r.displayNameAr && normalize(r.displayNameAr) === norm) ||
      (r.displayNameTr && normalize(r.displayNameTr) === norm),
  );
  if (byName) return byName;
  const byAlias = rows.find((r) =>
    (r.aliases ?? []).some((a) => normalize(a) === norm),
  );
  return byAlias ?? null;
}

/**
 * Filter countries by free-text query. Used by the cmdk filter callback.
 * Returns a positive numeric score (higher = better match) or 0 if no match.
 *
 * Scoring keeps prefix matches above substring matches and prefers EN over
 * AR/TR / aliases so the Latin-script user-facing label drives ordering.
 */
export function scoreCountryMatch(country: CountryRow, query: string): number {
  if (!query) return 1; // empty query: every active row passes through
  const q = normalize(query);
  if (!q) return 1;
  const candidates = [
    country.isoAlpha2.toLowerCase(),
    country.isoAlpha3.toLowerCase(),
    normalize(country.displayNameEn),
    country.displayNameAr ? normalize(country.displayNameAr) : "",
    country.displayNameTr ? normalize(country.displayNameTr) : "",
    ...((country.aliases ?? []).map((a) => normalize(a))),
  ].filter(Boolean);
  let best = 0;
  for (const cand of candidates) {
    if (cand === q) best = Math.max(best, 1);
    else if (cand.startsWith(q)) best = Math.max(best, 0.8);
    else if (cand.includes(q)) best = Math.max(best, 0.5);
  }
  return best;
}

/**
 * Filter industries by free-text query.
 */
export function scoreIndustryMatch(row: IndustryRow, query: string): number {
  if (!query) return 1;
  const q = normalize(query);
  if (!q) return 1;
  const candidates = [
    row.code.toLowerCase(),
    normalize(row.displayNameEn),
    row.displayNameAr ? normalize(row.displayNameAr) : "",
    row.shortDescription ? normalize(row.shortDescription) : "",
  ].filter(Boolean);
  let best = 0;
  for (const cand of candidates) {
    if (cand === q) best = Math.max(best, 1);
    else if (cand.startsWith(q)) best = Math.max(best, 0.8);
    else if (cand.includes(q)) best = Math.max(best, 0.5);
  }
  return best;
}

export function scoreSubIndustryMatch(row: SubIndustryRow, query: string): number {
  if (!query) return 1;
  const q = normalize(query);
  if (!q) return 1;
  const candidates = [
    row.code.toLowerCase(),
    normalize(row.displayNameEn),
    row.displayNameAr ? normalize(row.displayNameAr) : "",
    row.shortDescription ? normalize(row.shortDescription) : "",
  ].filter(Boolean);
  let best = 0;
  for (const cand of candidates) {
    if (cand === q) best = Math.max(best, 1);
    else if (cand.startsWith(q)) best = Math.max(best, 0.8);
    else if (cand.includes(q)) best = Math.max(best, 0.5);
  }
  return best;
}

export function localizedCountryName(
  country: CountryRow,
  locale: ReferenceLocale,
): string {
  if (locale === "ar" && country.displayNameAr) return country.displayNameAr;
  if (locale === "tr" && country.displayNameTr) return country.displayNameTr;
  return country.displayNameEn;
}

export function localizedIndustryName(
  row: IndustryRow | SubIndustryRow,
  locale: ReferenceLocale,
): string {
  if (locale === "ar" && row.displayNameAr) return row.displayNameAr;
  return row.displayNameEn;
}

/**
 * Validate that a free-text value (e.g. existing text-column data preserved
 * through an edit) maps to an active reference row. Used by forms that want
 * to enforce "no unrecognised values" without performing an FK migration.
 *
 * Returns:
 *   - { ok: true, row } when the value resolves to an active entry.
 *   - { ok: false, reason: 'deprecated' | 'unknown' } otherwise.
 */
export function assertResolvableCountry(
  value: string,
  rows: CountryRow[],
): { ok: true; row: CountryRow } | { ok: false; reason: "deprecated" | "unknown" } {
  if (!value.trim()) return { ok: false, reason: "unknown" };
  const hit = resolveCountry(value, [
    ...rows.filter((r) => r.status === "active"),
    ...rows.filter((r) => r.status === "deprecated"),
  ]);
  if (!hit) return { ok: false, reason: "unknown" };
  if (hit.status === "deprecated") return { ok: false, reason: "deprecated" };
  return { ok: true, row: hit };
}
