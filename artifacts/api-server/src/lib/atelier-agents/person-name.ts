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

import { findContactDuplicates } from "../atelier-dedupe.js";

/** Honorifics/qualifications commonly prefixed to MENA/Western exec names. */
export const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "dr", "eng", "engr", "prof", "sir",
  "sheikh", "shaikh", "sheikha", "he", "hh", "hrh",
  "his", "her", "excellency", "highness", "royal",
]);

/**
 * Patronymic / nobiliary particles that appear or vanish between sources.
 * "bin Nasser" (son of Nasser) is routinely dropped by Western databases, and
 * "Al-Jasser" appears as "Al Jasser" or "Aljasser".
 */
export const PARTICLES = new Set([
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
 * Common transliteration variant groups. Each group lists the collapsed
 * (doubled-letters-removed) spellings that refer to the same underlying name;
 * all members canonicalise to the first entry. Kept deliberately small and
 * explicit — DIFFERENT names that merely sound close (Hassan vs Hussein,
 * Hamad vs Hammad-as-distinct) must NOT share a group.
 */
const TRANSLIT_GROUPS: string[][] = [
  ["mohamed", "mohamad", "muhamad", "muhamed", "mohd", "mhd"],
  ["ahmed", "ahmad"],
  ["abdula", "abdulah", "abdala", "abdalah"],
  ["husein", "husain", "husayn"],
  ["khalid", "khaled"],
  ["nasir", "naser", "naser"],
  ["rashid", "rashed", "rasheed"],
  ["yusuf", "yusef", "yousef", "yousuf", "yosef"],
  ["ibrahim", "ebrahim", "ibraheem"],
  ["omar", "umar"],
  ["osman", "othman", "uthman"],
  ["osama", "usama"],
  ["fatima", "fatimah", "fatema"],
  ["said", "saeed"],
  ["salim", "salem", "saleem"],
  ["sara", "sarah"],
  ["jasim", "jassem", "jasem"],
  ["faisal", "faysal", "feisal"],
  ["sulaiman", "suleiman", "sulayman", "soliman"],
  ["hamza", "hamzah"],
  ["aisha", "ayesha", "aishah"],
  ["catherine", "katherine", "kathryn"],
  ["stephen", "steven"],
  ["geofrey", "jefrey"],
  ["jon", "john"],
  ["marc", "mark"],
  ["eric", "erik"],
  ["sophia", "sofia"],
  ["elisabeth", "elizabeth"],
];
const TRANSLIT_CANON = new Map<string, string>();
for (const group of TRANSLIT_GROUPS) {
  for (const v of group) TRANSLIT_CANON.set(v, group[0]);
}

/** Collapse doubled letters: "mohammed" -> "mohamed", "jassim" -> "jasim". */
function collapseDoubles(t: string): string {
  return t.replace(/(.)\1+/g, "$1");
}

/**
 * Canonical comparison form of one significant token: doubled letters
 * collapsed, then folded through the transliteration alias table. This is a
 * COMPARISON key only — never surface it as a display spelling.
 */
export function canonPersonToken(t: string): string {
  const c = collapseDoubles(t);
  const direct = TRANSLIT_CANON.get(c);
  if (direct) return direct;
  // Surnames arrive with the article fused ("alrasheed"); fold the stem so
  // "Al-Rasheed" and "Al Rashid" meet at "alrashid". "el" already collapses
  // to the "al"-fused form upstream, but tolerate it here too.
  for (const prefix of ["al", "el"]) {
    if (c.length > prefix.length + 2 && c.startsWith(prefix)) {
      const stem = TRANSLIT_CANON.get(c.slice(prefix.length));
      if (stem) return "al" + stem;
    }
  }
  return c;
}

/**
 * Token equivalence with strict initial support: tokens are equivalent when
 * their canonical forms match, or when one is a single-letter initial and
 * the other starts with that letter ("m" vs "mohammed"). Initials are only
 * consulted where the CALLER decides they're safe (never for surnames).
 */
function tokensEquivalent(a: string, b: string, allowInitial: boolean): boolean {
  const ca = canonPersonToken(a);
  const cb = canonPersonToken(b);
  if (ca === cb) return true;
  if (!allowInitial) return false;
  if (ca.length === 1 && cb.length > 1) return cb.startsWith(ca);
  if (cb.length === 1 && ca.length > 1) return ca.startsWith(cb);
  return false;
}

/**
 * True when two names plausibly refer to the same human:
 * - identical normalised token sequences, OR
 * - equivalent first token (transliteration variants fold together; a bare
 *   initial matches the expanded given name: "M. Al Jasser" vs "Mohammed Al
 *   Jasser"), AND equivalent last token (transliteration only — an initial
 *   is never enough for a surname), AND one token sequence is a subset of
 *   the other under the same equivalence (tolerates dropped patronymic
 *   middles: "mohammed nasser aljasser" vs "mohammed aljasser").
 * Safeguard: when the given-name match relied on an initial, the names must
 * agree on at least the surname plus that initial — two-token-vs-two-token
 * only ("M. Jasser" vs "Mohammed Jasser" matches; "M. Jasser" vs some
 * unrelated "Maria Jasser" also canonically matches, which is the accepted
 * cost of honouring initials at all).
 */
export function samePersonName(a: string, b: string): boolean {
  const ta = personNameTokens(a);
  const tb = personNameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const ja = ta.join(" ");
  const jb = tb.join(" ");
  if (ja === jb) return true;
  if (ta.length < 2 || tb.length < 2) return false; // single token too weak
  // Name-order swap: "AlSaghir Hamad" vs "Hamad Al-Saghir". Only full-token
  // multiset equality under canonicalisation counts — no initials, no subset
  // tolerance — so reordering can never widen the ordinary matching rules.
  if (ta.length === tb.length) {
    const sortedCanon = (ts: string[]) =>
      ts.map(canonPersonToken).sort().join(" ");
    if (sortedCanon(ta) === sortedCanon(tb)) return true;
  }
  // Given name: transliteration + initial tolerated.
  if (!tokensEquivalent(ta[0], tb[0], true)) return false;
  // Surname: transliteration tolerated, initials never.
  if (!tokensEquivalent(ta[ta.length - 1], tb[tb.length - 1], false)) return false;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((t) =>
    large.some((u) => tokensEquivalent(t, u, t.length === 1 || u.length === 1)),
  );
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

/**
 * Belt-and-braces person matching (Task #958 / #971): the structural matcher
 * (findPersonMatch) first, then the shared contact-duplicate scorer as a
 * fallback net for near-miss spellings it can't see ("Al-Falih" vs
 * "Al-Faleh"). Only HIGH-confidence scores count — medium/low similarity
 * must never silently merge two different humans. Shared by the Executive
 * Mapper and Alliance Cartographer/Mapper proposal builders.
 */
export function findPersonMatchLoose<T>(
  name: string,
  entries: readonly T[],
  getName: (e: T) => string,
): T | undefined {
  const structural = findPersonMatch(name, entries, getName);
  if (structural) return structural;
  const scored = findContactDuplicates(
    name,
    entries.map((e, i) => ({ id: String(i), fullName: getName(e) })),
    { limit: 1 },
  );
  if (scored[0] && scored[0].confidence === "high") {
    return entries[Number(scored[0].id)];
  }
  return undefined;
}

/**
 * Collapse duplicate spellings of the same human within one research sweep
 * (Task #975). Uses findPersonMatchLoose so near-miss spellings the
 * structural matcher can't see ("Al-Falih" vs "Al-Faleh") also collapse —
 * high-confidence only, same net as the proposal builders. First sighting
 * wins position; `merge(existing, dup)` folds the duplicate's fields in.
 */
export function dedupeSweepRoster<T>(
  entries: readonly T[],
  getName: (e: T) => string,
  merge: (existing: T, dup: T) => void,
): T[] {
  const deduped: T[] = [];
  for (const d of entries) {
    const existing = findPersonMatchLoose(getName(d), deduped, getName);
    if (!existing) {
      deduped.push(d);
      continue;
    }
    merge(existing, d);
  }
  return deduped;
}

/** The "richer" of two name spellings: more tokens wins, then longer string. */
export function richerPersonName(a: string, b: string): string {
  const ta = personNameTokens(a).length;
  const tb = personNameTokens(b).length;
  if (ta !== tb) return ta > tb ? a : b;
  return a.trim().length >= b.trim().length ? a : b;
}
