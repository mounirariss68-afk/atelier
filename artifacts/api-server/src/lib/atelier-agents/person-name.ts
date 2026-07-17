// Shared fuzzy person-identity matching (Task: Executive Mapper dedupe).
//
// The web sweep and People Data Labs spell the same human differently:
// "Mohammed bin Nasser Al-Jasser" vs "Mohammed Al Jasser", "Eng. Khalid
// AlFalih" vs "Khalid Al-Falih", "Jane Doe - Acme Corp" vs "Jane Doe".
// An exact lowercase full-name match therefore duplicates people across the
// roster, the proposal queue, and (worst) the CRM contact list when a
// proposal is approved.
//
// This module is the ONE place that decides "are these two names the same
// person?". Deterministic, no network, unit-probe friendly.

/** Honorifics/qualifications commonly prefixed to MENA/Western exec names. */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "dr", "eng", "engr", "prof", "sir",
  "sheikh", "shaikh", "sheikha", "he", "hh", "hrh",
  "his", "her", "excellency", "highness", "royal",
]);

/**
 * Patronymic / nobiliary particles that appear or vanish between sources.
 * "bin Nasser" (son of Nasser) is routinely dropped by Western databases, and
 * "Al-Jasser" appears as "Al Jasser" or "Aljasser".
 */
const PARTICLES = new Set([
  "bin", "bint", "ibn", "abu", "abd", "abdul", "al", "el", "as", "ad",
  "van", "von", "der", "den", "de", "da", "di", "del", "della", "la", "le",
]);

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Trailing company/qualifier text sneaks into name fields from search-result
 * titles: "Jane Doe - Acme Corp", "Jane Doe | LinkedIn", "Jane Doe (Acme)",
 * "Jane Doe, CFA". Cut at the first structural separator.
 */
function stripTrailingCompanyText(s: string): string {
  return s
    .replace(/\s*[\|\u2013\u2014]\s.*$/u, "") // " | X", " – X", " — X"
    .replace(/\s+-\s.*$/u, "") // " - X" (spaced hyphen only; keeps Al-Jasser)
    .replace(/\s*\(.*$/u, "") // "(Acme…"
    .replace(/\s*,\s.*$/u, ""); // ", CFA…"
}

/**
 * Normalised significant tokens for a person name: lowercase, no diacritics,
 * no honorifics, no patronymic particles, "al-jasser"/"al jasser"/"aljasser"
 * all collapse to "aljasser".
 */
export function personNameTokens(name: string): string[] {
  let s = stripDiacritics(stripTrailingCompanyText(name.trim())).toLowerCase();
  // Fuse particle prefixes into the following token: "al-jasser" -> "aljasser",
  // "al jasser" handled below via particle-fusion pass.
  s = s.replace(/[._']/g, " ").replace(/-/g, " ");
  const raw = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let pendingParticle = "";
  for (const t0 of raw) {
    const t = t0.replace(/[^a-z0-9]/g, "");
    if (!t) continue;
    if (out.length === 0 && HONORIFICS.has(t)) continue; // leading honorific(s)
    if (PARTICLES.has(t)) {
      // "al"/"el" fuse with the next token ("al jasser" -> "aljasser");
      // "bin"/"ibn"/… are dropped along with the FOLLOWING patronym token
      // only when comparing (handled by subset matching), so keep the fused
      // form for al/el and drop pure linking particles.
      if (t === "al" || t === "el") pendingParticle = t;
      continue;
    }
    out.push(pendingParticle ? pendingParticle + t : t);
    pendingParticle = "";
  }
  return out;
}

/** Canonical single-string form (join of tokens) for logging/keys. */
export function normalisePersonName(name: string): string {
  return personNameTokens(name).join(" ");
}

/**
 * True when two names plausibly refer to the same human:
 * - identical normalised token sequences, OR
 * - same first and last significant token AND one token set is a subset of
 *   the other (tolerates dropped patronymic middles: "mohammed nasser
 *   aljasser" vs "mohammed aljasser").
 */
export function samePersonName(a: string, b: string): boolean {
  const ta = personNameTokens(a);
  const tb = personNameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const ja = ta.join(" ");
  const jb = tb.join(" ");
  if (ja === jb) return true;
  if (ta.length < 2 || tb.length < 2) return false; // single token too weak
  if (ta[0] !== tb[0] || ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const largeSet = new Set(large);
  return small.every((t) => largeSet.has(t));
}

/**
 * Find the entry whose name fuzzy-matches `name`. Exact normalised match is
 * preferred over a subset match so "Ali Hassan" hits the right one of two
 * near-namesakes when an exact spelling exists.
 */
export function findPersonMatch<T>(
  name: string,
  entries: readonly T[],
  getName: (e: T) => string,
): T | undefined {
  const norm = normalisePersonName(name);
  if (!norm) return undefined;
  let fuzzy: T | undefined;
  for (const e of entries) {
    const en = normalisePersonName(getName(e));
    if (en === norm) return e;
    if (!fuzzy && samePersonName(name, getName(e))) fuzzy = e;
  }
  return fuzzy;
}

/** The "richer" of two name spellings: more tokens wins, then longer string. */
export function richerPersonName(a: string, b: string): string {
  const ta = personNameTokens(a).length;
  const tb = personNameTokens(b).length;
  if (ta !== tb) return ta > tb ? a : b;
  return a.trim().length >= b.trim().length ? a : b;
}
