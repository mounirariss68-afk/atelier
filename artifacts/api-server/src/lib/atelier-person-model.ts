/**
 * Task #538 — Unified person model: structured-name helpers.
 *
 * This is the ONE place that turns free-text names into structured
 * Honorific / First / Middle / Last / Preferred fields, and turns
 * structured fields back into display / legal names + initials.
 *
 * Parsing rules (particle-aware; reuses the tokenizer vocabulary from
 * person-name.ts):
 *   - Leading honorifics ("Dr", "Sheikh", "His Excellency", …) are
 *     extracted and canonicalised.
 *   - The surname absorbs any immediately-preceding particle run:
 *     "Rania van der Berg"  → last = "van der Berg"
 *     "Khalid Al Saud"      → last = "Al Saud"
 *   - Patronymic runs that are NOT adjacent to the surname stay in the
 *     middle name: "Mohammed bin Nasser Al-Jasser" → middle "bin Nasser",
 *     last "Al-Jasser".
 *   - Ambiguous inputs (single token, 4+ significant tokens, honorific
 *     stripping leaving <2 tokens) are still parsed deterministically but
 *     flagged via `review` so the migration can report them instead of
 *     guessing silently.
 *
 * Composition rules:
 *   - fullName     = first [middle] last               (legacy column mirror)
 *   - displayName  = preferred? `${preferred} ${last}` : fullName
 *   - legalName    = [honorific] first [middle] last   (contracts / e-sign)
 *   - initials     = first letter of (preferred||first) + first letter of
 *                    the surname core (leading particles skipped).
 *
 * Deterministic, no network, no DB — DB sync helpers live beside the
 * routes that own each domain table.
 */

import { HONORIFICS, PARTICLES } from "./atelier-agents/person-name.js";

export interface StructuredName {
  honorific: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName?: string | null;
}

export type ParseReviewReason =
  | "single_token"
  | "many_tokens"
  | "honorific_only_remainder"
  | "unrecognized_honorific"
  | "empty";

export interface ParsedPersonName extends StructuredName {
  /** Set when the parse needed a judgment call — surface, don't guess silently. */
  review: ParseReviewReason | null;
  /** The original input, trimmed. */
  raw: string;
}

/** Canonical display spellings for recognised honorific token sequences. */
const HONORIFIC_CANON: Record<string, string> = {
  mr: "Mr", mrs: "Mrs", ms: "Ms", miss: "Miss", dr: "Dr", prof: "Prof",
  eng: "Eng", engr: "Eng", sir: "Sir",
  sheikh: "Sheikh", shaikh: "Sheikh", sheikha: "Sheikha",
  he: "HE", hh: "HH", hrh: "HRH",
  "his excellency": "HE", "her excellency": "HE",
  "his highness": "HH", "her highness": "HH",
  "his royal highness": "HRH", "her royal highness": "HRH",
};

/** The honorific options surfaced in forms (free text still accepted). */
export const HONORIFIC_OPTIONS = [
  "Mr", "Mrs", "Ms", "Miss", "Dr", "Prof", "Eng", "Sir",
  "Sheikh", "Sheikha", "HE", "HH", "HRH",
] as const;

function cleanToken(t: string): string {
  // Underscores are preserved: they never occur in real names but do occur
  // in synthetic/test identifiers whose fullName mirror must round-trip.
  return t.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_.'-]+$/gu, "");
}

function lowerKey(t: string): string {
  return t
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Extract leading honorific(s) from a token list. Returns the canonical
 * honorific (or null) plus the remaining tokens. Handles the two-/three-
 * word forms ("His Excellency", "His Royal Highness") and dotted
 * abbreviations ("Dr.", "H.E.").
 */
function extractHonorific(tokens: string[]): { honorific: string | null; rest: string[] } {
  if (tokens.length === 0) return { honorific: null, rest: tokens };
  // Multi-word forms first (longest match).
  for (const len of [3, 2]) {
    if (tokens.length > len) {
      const phrase = tokens.slice(0, len).map(lowerKey).join(" ");
      const canon = HONORIFIC_CANON[phrase];
      if (canon) return { honorific: canon, rest: tokens.slice(len) };
    }
  }
  const k = lowerKey(tokens[0]);
  if (HONORIFIC_CANON[k] && tokens.length > 1) {
    // "HE"/"HH" as a bare first token is only an honorific when written in
    // caps or dotted — "He Wei" is a real name. Be conservative.
    if ((k === "he" || k === "hh") && !/^(H\.?E\.?|H\.?H\.?)$/.test(tokens[0])) {
      return { honorific: null, rest: tokens };
    }
    return { honorific: HONORIFIC_CANON[k], rest: tokens.slice(1) };
  }
  return { honorific: null, rest: tokens };
}

function isParticle(t: string): boolean {
  const k = lowerKey(t);
  return PARTICLES.has(k);
}

/**
 * Parse a free-text name into structured fields. Deterministic; never
 * throws on non-empty input. First/last are always non-empty for
 * non-empty input (single-token names duplicate into both and get
 * flagged for review).
 */
export function parsePersonName(input: string): ParsedPersonName {
  const raw = (input ?? "").trim().replace(/\s+/g, " ");
  const base: ParsedPersonName = {
    honorific: null,
    firstName: "",
    middleName: null,
    lastName: "",
    preferredName: null,
    review: null,
    raw,
  };
  if (!raw) return { ...base, review: "empty" };

  // Strip trailing company/qualifier text the same way the matcher does.
  const cut = raw
    .replace(/\s*[\|\u2013\u2014]\s.*$/u, "")
    .replace(/\s+-\s.*$/u, "")
    .replace(/\s*\(.*$/u, "")
    .replace(/\s*,\s.*$/u, "")
    .trim();

  let tokens = cut.split(/\s+/).map(cleanToken).filter(Boolean);
  if (tokens.length === 0) return { ...base, review: "empty" };

  const { honorific, rest } = extractHonorific(tokens);
  tokens = rest;
  if (tokens.length === 0) {
    // Input was ONLY an honorific ("Dr.") — keep it verbatim as the name.
    const t = cut;
    return { ...base, firstName: t, lastName: t, review: "honorific_only_remainder" };
  }
  if (tokens.length === 1) {
    return {
      ...base,
      honorific,
      firstName: tokens[0],
      lastName: tokens[0],
      review: honorific ? "honorific_only_remainder" : "single_token",
    };
  }

  // Surname = final token plus any immediately-preceding particle run.
  // Never let the particle run swallow the first name.
  let lastStart = tokens.length - 1;
  while (lastStart - 1 >= 1 && isParticle(tokens[lastStart - 1])) lastStart--;
  const lastName = tokens.slice(lastStart).join(" ");
  const firstName = tokens[0];
  const middle = tokens.slice(1, lastStart).join(" ");

  // 4+ significant (non-particle) tokens → judgment call, flag it.
  const significant = tokens.filter((t) => !isParticle(t)).length;
  let review: ParseReviewReason | null = significant >= 4 ? "many_tokens" : null;
  // A leading dotted abbreviation that ISN'T a recognised honorific
  // ("Rev. John Smith", "Hon. Aisha Al-Farsi") means we probably just
  // swallowed an honorific into the first name — flag, don't guess.
  if (!honorific && !review && tokens.length >= 3 && /^\p{L}{1,6}\.$/u.test(tokens[0])) {
    review = "unrecognized_honorific";
  }

  return {
    ...base,
    honorific,
    firstName,
    middleName: middle || null,
    lastName,
    review,
  };
}

/** Legacy fullName mirror: first [middle] last. */
export function composeFullName(p: StructuredName): string {
  const first = (p.firstName ?? "").trim();
  const last = (p.lastName ?? "").trim();
  // Mononym rows (single-token migration parses) duplicate the token into
  // first+last — render it once, not "Madonna Madonna".
  if (first && first === last && !(p.middleName ?? "").trim()) return first;
  return [first, (p.middleName ?? "").trim(), last].filter(Boolean).join(" ");
}

/** Display name: preferred-name shortcut, else the full name. */
export function composeDisplayName(p: StructuredName): string {
  const pref = (p.preferredName ?? "").trim();
  if (pref) {
    const last = (p.lastName ?? "").trim();
    // Don't duplicate when the preferred name already includes the surname.
    if (last && !pref.toLowerCase().includes(last.toLowerCase())) {
      return `${pref} ${last}`;
    }
    return pref;
  }
  return composeFullName(p);
}

/** Formal/legal name for contracts, e-sign signer rows, business cards. */
export function composeLegalName(p: StructuredName): string {
  return [(p.honorific ?? "").trim(), composeFullName(p)].filter(Boolean).join(" ");
}

/**
 * Initials from structured fields: first letter of the (preferred||first)
 * name + first letter of the surname core (leading particles skipped so
 * "van der Berg" → B, "Al-Jasser" → A stays A because "Al-" is fused).
 */
export function computeInitials(p: StructuredName): string {
  const given = ((p.preferredName ?? "").trim() || p.firstName || "").trim();
  const lastTokens = (p.lastName ?? "").trim().split(/\s+/).filter(Boolean);
  let surnameCore = lastTokens[lastTokens.length - 1] ?? "";
  for (const t of lastTokens) {
    if (!isParticle(t)) {
      surnameCore = t;
      break;
    }
  }
  const a = given.charAt(0).toUpperCase();
  const b = surnameCore.charAt(0).toUpperCase();
  const out = `${a}${b}`.trim();
  return out || "?";
}

/**
 * Normalise a structured-name payload coming from a client: trims every
 * field, empties → null, validates first+last present. Throws on invalid.
 */
export function sanitizeStructuredName(input: {
  honorific?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
}): StructuredName {
  const trim = (s: string | null | undefined) => {
    const t = (s ?? "").trim().replace(/\s+/g, " ");
    return t.length > 0 ? t : null;
  };
  const firstName = trim(input.firstName);
  const lastName = trim(input.lastName);
  if (!firstName || !lastName) {
    throw new PersonNameValidationError("firstName and lastName are required");
  }
  return {
    honorific: trim(input.honorific),
    firstName,
    middleName: trim(input.middleName),
    lastName,
    preferredName: trim(input.preferredName),
  };
}

/**
 * Resolve the structured name for a write payload. Structured fields win
 * when any are present (merged over the existing person row, first+last
 * required after merge); otherwise a free-text fullName is parsed with the
 * shared particle/honorific parser. Returns null when the payload carries
 * no name information at all. Throws PersonNameValidationError on invalid.
 */
export function resolveStructuredNameInput(
  input: {
    fullName?: string;
    honorific?: string | null;
    firstName?: string;
    middleName?: string | null;
    lastName?: string;
    preferredName?: string | null;
  },
  existing?: {
    honorific: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string;
    preferredName: string | null;
  } | null,
): StructuredName | null {
  const hasStructured =
    input.firstName !== undefined ||
    input.lastName !== undefined ||
    input.middleName !== undefined ||
    input.honorific !== undefined ||
    input.preferredName !== undefined;
  if (hasStructured) {
    return sanitizeStructuredName({
      honorific: input.honorific !== undefined ? input.honorific : existing?.honorific ?? null,
      firstName: input.firstName !== undefined ? input.firstName : existing?.firstName ?? null,
      middleName: input.middleName !== undefined ? input.middleName : existing?.middleName ?? null,
      lastName: input.lastName !== undefined ? input.lastName : existing?.lastName ?? null,
      preferredName:
        input.preferredName !== undefined ? input.preferredName : existing?.preferredName ?? null,
    });
  }
  if (input.fullName !== undefined) {
    const parsed = parsePersonName(input.fullName);
    if (parsed.review === "empty") throw new PersonNameValidationError("name required");
    return { ...parsed, preferredName: existing?.preferredName ?? null };
  }
  return null;
}

export class PersonNameValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonNameValidationError";
  }
}

let personSeq = 0;
export function newPersonId(): string {
  personSeq = (personSeq + 1) % 1296;
  return `pers_${Date.now().toString(36)}_${personSeq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
