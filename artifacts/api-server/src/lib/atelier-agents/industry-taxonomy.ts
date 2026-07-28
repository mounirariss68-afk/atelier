/**
 * Task #698 — map Cartographer industry output onto the app's own industry
 * taxonomy (atelier_industries / atelier_sub_industries reference data).
 *
 * The agent historically emitted NAICS-style numeric codes which leaked
 * straight into `accounts.industry_code` (or were dropped). This resolver is
 * the single choke point every persistence path goes through:
 *   - exact Cognirise code match (industry or sub-industry, case-insensitive)
 *   - display-name / label match (folded)
 *   - legacy NAICS 2-digit prefix → Cognirise sector mapping
 * Anything unmappable resolves to null so callers fail gracefully to
 * "no industry write / no proposal" instead of storing a raw NAICS code.
 */
import { INDUSTRIES, SUB_INDUSTRIES } from "../data/atelier-reference-data.js";

export interface ResolvedIndustry {
  industryCode: string;
  subIndustryCode: string | null;
}

const INDUSTRY_CODES = new Set<string>(INDUSTRIES.map((i) => i.code));

/** Fold a label for tolerant comparison: lowercase, strip non-alphanumerics. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const INDUSTRY_BY_LABEL = new Map<string, string>(
  INDUSTRIES.map((i) => [fold(i.displayNameEn), i.code]),
);
const SUB_BY_CODE = new Map<string, { code: string; industryCode: string }>(
  SUB_INDUSTRIES.map((s) => [s.code, { code: s.code, industryCode: s.industryCode }]),
);
const SUB_BY_LABEL = new Map<string, { code: string; industryCode: string }>(
  SUB_INDUSTRIES.map((s) => [
    fold(s.displayNameEn),
    { code: s.code, industryCode: s.industryCode },
  ]),
);

/**
 * NAICS 2-digit sector prefixes → closest Cognirise industry. Kept
 * deliberately coarse: NAICS input only ever resolves the top-level industry,
 * never a sub-industry. Unlisted prefixes are unmappable (null).
 */
const NAICS_PREFIX_TO_INDUSTRY: Record<string, string> = {
  "21": "ER", // mining / oil & gas
  "22": "ER", // utilities
  "23": "IGR", // construction
  "31": "IGR", // manufacturing
  "32": "IGR",
  "33": "IGR",
  "42": "RC", // wholesale trade
  "44": "RC", // retail trade
  "45": "RC",
  "48": "TTH", // transportation
  "49": "TTH",
  "51": "TMT", // information
  "52": "FS", // finance & insurance
  "53": "IGR", // real estate
  "55": "XSEC", // management of companies (holdings)
  "61": "HPS", // education
  "62": "HPS", // health care
  "71": "TMT", // arts / entertainment (media)
  "72": "TTH", // accommodation & food services
  "92": "HPS", // public administration
};

function resolveIndustryOnly(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const upper = t.toUpperCase();
  if (INDUSTRY_CODES.has(upper)) return upper;
  const byLabel = INDUSTRY_BY_LABEL.get(fold(t));
  if (byLabel) return byLabel;
  // NAICS-style numeric code: use the 2-digit sector prefix.
  const digits = t.match(/^\d{2,6}$/) ? t.slice(0, 2) : null;
  if (digits) return NAICS_PREFIX_TO_INDUSTRY[digits] ?? null;
  return null;
}

function resolveSubOnly(raw: string): { code: string; industryCode: string } | null {
  const t = raw.trim();
  if (!t) return null;
  return SUB_BY_CODE.get(t.toUpperCase()) ?? SUB_BY_LABEL.get(fold(t)) ?? null;
}

/**
 * Resolve raw agent output (industry + optional sub-industry, each possibly a
 * Cognirise code, a label, or a NAICS number) to valid taxonomy codes.
 * Returns null when nothing maps — callers must then skip the industry write.
 * A sub-industry that maps always wins (it implies its parent industry); a
 * sub-industry that contradicts the resolved industry is dropped, not forced.
 */
export function resolveIndustryTaxonomy(
  rawIndustry: string | null | undefined,
  rawSubIndustry?: string | null,
): ResolvedIndustry | null {
  const sub = rawSubIndustry ? resolveSubOnly(rawSubIndustry) : null;
  if (sub) return { industryCode: sub.industryCode, subIndustryCode: sub.code };
  const ind = rawIndustry ? resolveIndustryOnly(rawIndustry) : null;
  if (ind) return { industryCode: ind, subIndustryCode: null };
  return null;
}
