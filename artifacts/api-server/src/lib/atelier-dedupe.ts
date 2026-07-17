/**
 * Atelier — duplicate detection (Task #632).
 *
 * Pure, side-effect-free fuzzy matching used to warn partners before they
 * create an account or contact that probably already exists. This is a
 * warn-and-link helper only — it never merges or mutates anything. The route
 * layer is responsible for org-scoping the candidate set it feeds in.
 *
 * Matching is deliberately deterministic (no AI / network): a normalised
 * name comparison blending an edit-distance ratio with a token-overlap
 * (Jaccard) score, lightly adjusted by country agreement for accounts.
 */

export type DuplicateConfidence = "high" | "medium" | "low";

/** Strip diacritics so "Arçelik" and "Arcelik" compare equal. */
function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/ß/g, "ss");
}

// Common legal-entity / corporate suffixes stripped before comparing company
// names so "Tasama Holdings PJSC" matches "Tasama Holdings".
const LEGAL_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "limited",
  "co",
  "corp",
  "corporation",
  "company",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "srl",
  "spa",
  "bv",
  "nv",
  "plc",
  "pjsc",
  "jsc",
  "psc",
  "fzco",
  "fze",
  "llc-fz",
  "wll",
  "ksc",
  "kscp",
  "group",
  "holding",
  "holdings",
  "the",
]);

/**
 * Normalise a company name: lowercase, de-accent, drop punctuation, and remove
 * trailing/standalone legal suffixes. Returns a space-collapsed token string.
 */
export function normalizeCompanyName(raw: string): string {
  const base = stripDiacritics((raw ?? "").toLowerCase())
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = base.split(" ").filter((t) => t.length > 0 && !LEGAL_SUFFIXES.has(t));
  // Fall back to the un-stripped tokens if suffix removal nuked everything
  // (e.g. a name that is only "Group").
  const kept = tokens.length > 0 ? tokens : base.split(" ").filter(Boolean);
  return kept.join(" ");
}

/** Normalise a person name: lowercase, de-accent, drop honorifics/punctuation. */
const HONORIFICS = new Set(["mr", "mrs", "ms", "dr", "prof", "eng", "sir", "mx"]);
export function normalizePersonName(raw: string): string {
  const base = stripDiacritics((raw ?? "").toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = base.split(" ").filter((t) => t.length > 0 && !HONORIFICS.has(t));
  const kept = tokens.length > 0 ? tokens : base.split(" ").filter(Boolean);
  return kept.join(" ");
}

/** Classic Levenshtein edit distance. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Edit-distance similarity in [0,1] (1 = identical). */
function levRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Token-set Jaccard overlap in [0,1]. */
function tokenJaccard(a: string, b: string): number {
  const sa = new Set(a.split(" ").filter(Boolean));
  const sb = new Set(b.split(" ").filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Similarity in [0,1] between two already-normalised name strings, blending
 * edit-distance and token-overlap (whichever is stronger). Either signal alone
 * being high is enough — "Acme Foods" vs "Acme" scores high on token overlap
 * even though the edit ratio is modest.
 */
export function nameSimilarity(normA: string, normB: string): number {
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  return Math.max(levRatio(normA, normB), tokenJaccard(normA, normB));
}

export function confidenceFor(score: number): DuplicateConfidence {
  if (score >= 0.92) return "high";
  if (score >= 0.78) return "medium";
  return "low";
}

export interface AccountDuplicateInput {
  name: string;
  brandName?: string | null;
  country?: string | null;
}

export interface AccountDuplicateCandidateRow {
  id: string;
  name: string;
  brandName?: string | null;
  country?: string | null;
  tier?: string | null;
}

export interface ScoredAccountCandidate extends AccountDuplicateCandidateRow {
  score: number;
  confidence: DuplicateConfidence;
}

const ACCOUNT_MATCH_THRESHOLD = 0.6;

/**
 * Score a candidate account against the input. The strongest name match wins
 * across the {input name, input brand} × {candidate name, candidate brand}
 * grid. A confirmed country mismatch dampens the score (likely a different
 * legal entity in another market); a country match leaves it untouched.
 */
function scoreAccountCandidate(
  input: AccountDuplicateInput,
  cand: AccountDuplicateCandidateRow,
): number {
  const inputNames = [input.name, input.brandName]
    .map((x) => normalizeCompanyName(x ?? ""))
    .filter((x) => x.length > 0);
  const candNames = [cand.name, cand.brandName]
    .map((x) => normalizeCompanyName(x ?? ""))
    .filter((x) => x.length > 0);
  let best = 0;
  for (const a of inputNames) {
    for (const b of candNames) {
      best = Math.max(best, nameSimilarity(a, b));
    }
  }
  const inCountry = stripDiacritics((input.country ?? "").toLowerCase()).trim();
  const candCountry = stripDiacritics((cand.country ?? "").toLowerCase()).trim();
  if (inCountry && candCountry && inCountry !== candCountry) {
    best *= 0.7;
  }
  return best;
}

/**
 * Return likely-duplicate accounts from `candidates`, sorted by descending
 * confidence. `excludeId` skips the account being edited (if any). Candidates
 * must already be org-scoped and non-deleted by the caller.
 */
export function findAccountDuplicates(
  input: AccountDuplicateInput,
  candidates: AccountDuplicateCandidateRow[],
  opts?: { excludeId?: string; limit?: number },
): ScoredAccountCandidate[] {
  const limit = opts?.limit ?? 5;
  const out: ScoredAccountCandidate[] = [];
  for (const cand of candidates) {
    if (opts?.excludeId && cand.id === opts.excludeId) continue;
    const score = scoreAccountCandidate(input, cand);
    if (score >= ACCOUNT_MATCH_THRESHOLD) {
      out.push({ ...cand, score, confidence: confidenceFor(score) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------
// Opportunities (Task #30) — duplicate detection on the same account.
// Exact-normalized matches BLOCK creation without an explicit override;
// fuzzy near-matches are surfaced as warnings only.
// ---------------------------------------------------------------------

/**
 * Normalise an opportunity name for exact-duplicate comparison: lowercase,
 * de-accent, drop punctuation, collapse whitespace. Deliberately does NOT
 * strip legal suffixes — opportunity names are free-form deal titles, not
 * legal entity names.
 */
export function normalizeOpportunityName(raw: string): string {
  return stripDiacritics((raw ?? "").toLowerCase())
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface OpportunityDuplicateCandidateRow {
  id: string;
  name: string;
  salesStage?: string | null;
}

export interface ScoredOpportunityCandidate extends OpportunityDuplicateCandidateRow {
  score: number;
  confidence: DuplicateConfidence;
  /** True when the normalized names are identical (blocks without override). */
  exact: boolean;
}

const OPPORTUNITY_MATCH_THRESHOLD = 0.72;

/**
 * Return likely-duplicate opportunities (matched on name) from `candidates`,
 * which the caller must scope to a single account and exclude archived
 * (soft-deleted) rows. Sorted with exact matches first, then by descending
 * score.
 */
export function findOpportunityDuplicates(
  name: string,
  candidates: OpportunityDuplicateCandidateRow[],
  opts?: { excludeId?: string; limit?: number },
): ScoredOpportunityCandidate[] {
  const limit = opts?.limit ?? 5;
  const target = normalizeOpportunityName(name);
  if (!target) return [];
  const out: ScoredOpportunityCandidate[] = [];
  for (const cand of candidates) {
    if (opts?.excludeId && cand.id === opts.excludeId) continue;
    const candNorm = normalizeOpportunityName(cand.name);
    const exact = candNorm === target && target.length > 0;
    const score = exact ? 1 : nameSimilarity(target, candNorm);
    if (exact || score >= OPPORTUNITY_MATCH_THRESHOLD) {
      out.push({ ...cand, score, confidence: confidenceFor(score), exact });
    }
  }
  out.sort((a, b) => (a.exact === b.exact ? b.score - a.score : a.exact ? -1 : 1));
  return out.slice(0, limit);
}

export interface ContactDuplicateCandidateRow {
  id: string;
  fullName: string;
  title?: string | null;
  seniority?: string | null;
}

export interface ScoredContactCandidate extends ContactDuplicateCandidateRow {
  score: number;
  confidence: DuplicateConfidence;
}

const CONTACT_MATCH_THRESHOLD = 0.72;

/**
 * Return likely-duplicate contacts (matched on name) from `candidates`, which
 * the caller must scope to a single account. Sorted by descending confidence.
 */
export function findContactDuplicates(
  fullName: string,
  candidates: ContactDuplicateCandidateRow[],
  opts?: { excludeId?: string; limit?: number },
): ScoredContactCandidate[] {
  const limit = opts?.limit ?? 5;
  const target = normalizePersonName(fullName);
  if (!target) return [];
  const out: ScoredContactCandidate[] = [];
  for (const cand of candidates) {
    if (opts?.excludeId && cand.id === opts.excludeId) continue;
    const score = nameSimilarity(target, normalizePersonName(cand.fullName));
    if (score >= CONTACT_MATCH_THRESHOLD) {
      out.push({ ...cand, score, confidence: confidenceFor(score) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
