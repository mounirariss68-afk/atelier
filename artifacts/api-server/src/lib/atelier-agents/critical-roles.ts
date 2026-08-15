/**
 * Critical-role taxonomy for the Executive Mapper.
 *
 * Cognirise sells into 15 critical buyer positions. The Mapper must find the
 * people HOLDING those functions (title variants included) while blocking
 * juniors and hallucinated role attributions from the partner review queue.
 *
 * This module is fully deterministic — the LLM may CLAIM a `criticalRole` per
 * person, but the runner re-classifies every verbatim title with
 * `classifyCriticalRole()` and overwrites the claim. The model cannot
 * self-declare a match its title text does not support, and the per-role
 * coverage summary is recomputed in code from the surviving roster so it can
 * never be hallucinated.
 */

export type CriticalRoleId =
  | "ceo"
  | "cfo"
  | "coo"
  | "caio"
  | "cto"
  | "cio"
  | "cdo"
  | "head_of_ai"
  | "cmo"
  | "cpo_product"
  | "cco_commercial"
  | "cpo_procurement"
  | "head_of_transformation"
  | "head_of_pmo"
  | "head_of_vro"
  // Government-mode functional roles (Task #1189) — ministries have no CIO/
  // CISO; the people running IT, Cybersecurity and Customer care sit at
  // Director / Head of Department level below the Assistant Undersecretary.
  // These ids classify ONLY in government mode and never join the 15-role
  // corporate coverage view.
  | "gov_it_lead"
  | "gov_cyber_lead"
  | "gov_customer_care_lead";

export interface CriticalRoleDef {
  id: CriticalRoleId;
  label: string;
  /** Minimum title-derived seniority rank (see titleSeniorityRank). */
  floor: number;
  /** Function keywords/acronym patterns (tested against the normalised title). */
  match: RegExp;
  /** Disambiguation veto — when this matches, the role does NOT match. */
  veto?: RegExp;
}

/** Normalise a verbatim title for matching: lowercase, punctuation → space. */
function norm(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[&/,+\-().|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Titles that describe someone NEAR a role, not the holder of it.
const CONTEXT_VETO =
  /\b(assistant|deputy|advisor|adviser|secretary|intern|apprentice|aide)\b|office of the|\b[ep]a to\b/;

// Government-mode veto: in ministries "Deputy Minister" / "Undersecretary" /
// "Assistant Undersecretary" are STRUCTURAL senior ranks, not aides — so the
// blanket assistant/deputy/secretary veto above would wrongly drop them. This
// narrower veto keeps only the genuinely-adjacent patterns (advisors, aides,
// "assistant TO", the minister's private office, spokespeople).
const GOV_CONTEXT_VETO =
  /\b(advisor|adviser|aide|intern|apprentice|spokesperson|spokesman|spokeswoman)\b|office of the|\b[ep]a to\b|\b(assistant|deputy|secretary) to\b|private secretary/;

/**
 * Government title hierarchy — GCC (KSA, UAE, Qatar, Kuwait, Bahrain, Oman)
 * and Türkiye. Researched against published ministry org charts (e.g. Saudi
 * MOFA hierarchy, Qatar MOFA Amiri Decision 33/2022 structure, UAE Cabinet)
 * and Türkiye's post-2018 presidential-system decrees (Müsteşar abolished,
 * replaced by Bakan Yardımcısı; Genel Müdür below that; Daire Başkanı below).
 *
 * Rank mapping onto titleSeniorityRank's scale:
 *   5 Minister / Minister of State / Prime Minister (Bakan) · Governor of an
 *     authority, central bank or province (Vali) · Secretary General of a
 *     council/authority (Genel Sekreter)
 *   4 Vice/Deputy/Assistant Minister (Bakan Yardımcısı) · Undersecretary
 *     (Wakil / Müsteşar) · Deputy/Vice Governor · Director General /
 *     General Director (Genel Müdür) · Chairman/President of a public
 *     authority, commission or agency · Deputy Secretary General
 *   3 Assistant Undersecretary (Wakil Musaid) · Deputy/Assistant Director
 *     General (Genel Müdür Yardımcısı) · Executive Director of a sector ·
 *     Head of Department (Daire Başkanı) · Advisor ranks excluded via veto
 *
 * Matching order: most-junior patterns first, because senior keywords are
 * substrings of junior titles ("Deputy Minister" contains "minister").
 */
const GOV_RANK_3 =
  /assistant undersecretary|deputy undersecretary|assistant under secretary|(deputy|assistant|vice) director general|genel m[uü]d[uü]r yard[iı]mc[iı]s[iı]|daire ba[sş]kan[iı]|acting director general|assistant secretary general|executive director/;
const GOV_RANK_4 =
  /(deputy|vice|assistant) (prime )?minister|bakan yard[iı]mc[iı]s[iı]|(deputy|vice) governor|deputy secretary general|undersecretary|under secretary|m[uü]ste[sş]ar|director general|general director|genel m[uü]d[uü]r|(chairman|chairwoman|chairperson|president) of (the )?(authority|commission|agency|board of)|kurum ba[sş]kan[iı]/;
const GOV_RANK_5 =
  /\bminister\b|\bbakan\b|\bgovernor\b|\bvali\b|secretary general|genel sekreter/;

/**
 * Seniority rank for a government-body title, or -1 when the title carries no
 * recognised government rank. Deterministic complement to titleSeniorityRank
 * for ministry / authority / municipality accounts, where CxO conventions
 * don't apply.
 */
export function governmentTitleSeniorityRank(rawTitle: string | null | undefined): number {
  const t = norm(rawTitle);
  if (!t) return -1;
  if (GOV_CONTEXT_VETO.test(t)) return -1;
  if (GOV_RANK_3.test(t)) return 3;
  if (GOV_RANK_4.test(t)) return 4;
  if (GOV_RANK_5.test(t)) return 5;
  return -1;
}

/**
 * Deterministic government-body detection from account sector + name.
 * Ministries, public authorities, municipalities, general directorates and
 * central banks across the GCC and Türkiye follow government title
 * hierarchies, not CxO conventions.
 */
export function isGovernmentAccount(args: {
  sector?: string | null;
  name?: string | null;
}): boolean {
  const sector = norm(args.sector);
  const name = norm(args.name);
  if (
    /\bgovernment\b|public sector|public administration|\bministry\b|\bmunicipal/.test(sector)
  ) {
    return true;
  }
  return /\bministry\b|bakanl[iı][gğ]|\bmunicipality\b|belediye|general directorate|genel m[uü]d[uü]rl[uü][gğ][uü]|general secretariat|presidency of|supreme council|public authority|government of|valili[gğ]i|governorate|central bank|\bauthority\b|\bcommission\b/.test(
    name,
  );
}

export interface RoleClassifyOpts {
  /** Government-body mode: ministry rank hierarchy + narrower context veto. */
  government?: boolean;
}

// Explicit C-level acronym list — a generic /c[a-z]{1,3}o/ would false-match
// words like "cairo", so we enumerate.
const C_LEVEL_ACRONYMS =
  /\b(ceo|cfo|coo|cto|cio|cdo|cmo|cpo|cco|caio|cdao|chro|cso|ciso|cro|cbo|clo|cico)\b/;

/**
 * Title-derived seniority rank:
 *   5 chief / C-level acronym
 *   4 EVP / SVP / president / managing director
 *   3 VP / head of / general manager
 *   2 director
 *   1 manager / lead / supervisor
 *   0 clearly individual-contributor (engineer, analyst, …)
 *  -1 unrecognisable — treated as unknown (never counts as senior)
 */
export function titleSeniorityRank(
  rawTitle: string | null | undefined,
  opts?: RoleClassifyOpts,
): number {
  const t = norm(rawTitle);
  if (!t) return -1;
  if (opts?.government) {
    // Government titles rank on the ministry hierarchy; a title recognised
    // there wins over the corporate reading (a "Director General" is rank 4
    // in a ministry, not a rank-2 corporate director).
    const gov = governmentTitleSeniorityRank(rawTitle);
    if (gov >= 0) {
      const corporate = titleSeniorityRank(rawTitle);
      return Math.max(gov, corporate);
    }
  }
  if (/\bchief\b/.test(t) || C_LEVEL_ACRONYMS.test(t)) return 5;
  if (
    /\b(evp|svp|executive vice president|senior vice president|managing director|managing partner|president)\b/.test(
      t,
    )
  )
    return 4;
  if (/\b(vp|vice president|general manager|gm)\b/.test(t) || /\bhead\b/.test(t)) return 3;
  if (/\bdirector\b/.test(t)) return 2;
  if (/\b(manager|lead|supervisor)\b/.test(t)) return 1;
  if (
    /\b(engineer|analyst|specialist|developer|consultant|coordinator|administrator|associate|technician|designer|scientist|officer in charge)\b/.test(
      t,
    )
  )
    return 0;
  return -1;
}

const R = (
  id: CriticalRoleId,
  label: string,
  floor: number,
  match: RegExp,
  veto?: RegExp,
): CriticalRoleDef => ({ id, label, floor, match, veto });

/**
 * The 15 canonical critical roles, in priority order (a title matching
 * several roles is tagged with the FIRST match).
 *
 * Disambiguation notes:
 *  - Bare "CPO" / "CCO" acronyms are deliberately ambiguous → match nothing;
 *    only the spelled-out or function-worded forms classify.
 *  - CCO = Commercial. Communications / compliance / customer / content /
 *    creative / culture are NOT matches.
 *  - CPO(Product) vetoes procurement/production/product-marketing;
 *    CPO(Procurement) needs procurement/sourcing/supply-chain wording.
 *  - CIO vetoes "investment"; CDO vetoes "diversity".
 */
export const CRITICAL_ROLES: CriticalRoleDef[] = [
  R("ceo", "CEO", 5, /\bceo\b|chief executive\b/),
  R("cfo", "CFO", 5, /\bcfo\b|chief financ(e|ial) officer/),
  R("coo", "COO", 5, /\bcoo\b|chief operat(ing|ions) officer/),
  R("caio", "Chief AI Officer", 5, /\bcaio\b|chief (ai|artificial intelligence)\b.*officer/),
  R("cto", "CTO", 5, /\bcto\b|chief technolog(y|ies) officer|chief technical officer/),
  R("cio", "CIO", 5, /\bcio\b|chief information officer/, /investment/),
  R("cdo", "CDO (Data / Digital)", 5, /\bcdo\b|\bcdao\b|chief (data|digital)\b.*officer/, /diversity/),
  R(
    "head_of_ai",
    "Head of AI",
    3,
    /\bai\b|artificial intelligence|machine learning|generative ai|\bgenai\b/,
  ),
  R("cmo", "CMO", 3, /\bcmo\b|chief marketing officer|\bmarketing\b/),
  R(
    "cpo_product",
    "CPO (Product)",
    3,
    /chief product officer|\bproducts?\b/,
    /procurement|production|product marketing/,
  ),
  R(
    "cco_commercial",
    "CCO (Commercial)",
    3,
    /chief commercial officer|\bcommercial\b/,
    /communication|compliance|customer|content|creative|culture/,
  ),
  R(
    "cpo_procurement",
    "CPO (Procurement)",
    2,
    /chief procurement officer|\bprocurement\b|\bsourcing\b|supply chain/,
  ),
  R("head_of_transformation", "Head of Transformation", 2, /\btransformation\b/),
  R(
    "head_of_pmo",
    "Head of PMO",
    2,
    /\bpmo\b|program(me)? management office|portfolio management office|program(me)? management\b/,
  ),
  R("head_of_vro", "Head of VRO (Value Realization)", 2, /\bvro\b|value real(is|iz)ation/),
];

/**
 * Government-mode functional-role slice (Task #1189). Cognirise sells into
 * ministry IT / Cybersecurity / AI / Digital / Customer-care departments,
 * whose named leads sit BELOW Assistant Undersecretary (Director / Head of
 * Department / Daire Başkanı). Two kinds of entries:
 *
 *  - Gov-only role ids (gov_it_lead, gov_cyber_lead, gov_customer_care_lead):
 *    functions with no corporate-taxonomy equivalent at director level.
 *  - Gov floor overrides for existing ids (head_of_ai, cdo,
 *    head_of_transformation): the corporate defs already carry the function
 *    wording but their floors/matches assume CxO conventions; in a ministry a
 *    rank-2 "Director of Artificial Intelligence" IS the functional lead.
 *
 * Active ONLY when RoleClassifyOpts.government is true; the corporate list
 * and its floors are untouched. Bare-acronym ambiguity rules stay intact —
 * "IT" only matches as a standalone word or spelled out, and bare CPO/CCO
 * still match nothing.
 */
export const GOV_FUNCTIONAL_ROLES: CriticalRoleDef[] = [
  R(
    "gov_it_lead",
    "IT Leadership (Gov)",
    2,
    /information technology|\bict\b|\bit\b|bilgi teknolojileri|bilgi i[sş]lem/,
    /\bcyber|security|siber/,
  ),
  R(
    "gov_cyber_lead",
    "Cybersecurity Leadership (Gov)",
    2,
    /cyber ?security|\bcyber\b|information security|\b(it|ict) security\b|\bciso\b|siber g[uü]venlik/,
  ),
  // Existing ids, gov-mode floor 2 (+ local-language function wording).
  R(
    "head_of_ai",
    "Head of AI",
    2,
    /\bai\b|artificial intelligence|machine learning|generative ai|\bgenai\b|yapay zeka/,
  ),
  R(
    "cdo",
    "CDO (Data / Digital)",
    2,
    /\bdigital\b|dijital|\bdata\b(?! entry)/,
    /diversity/,
  ),
  R("head_of_transformation", "Head of Transformation", 2, /\btransformation\b|d[oö]n[uü][sş][uü]m/),
  R(
    "gov_customer_care_lead",
    "Customer Care Leadership (Gov)",
    2,
    /customer (care|experience|service|services|happiness|satisfaction)|\bcx\b|m[uü][sş]teri (hizmetleri|deneyimi|memnuniyeti)/,
  ),
];

/** Gov-only coverage rows appended to the 15 corporate roles for gov accounts. */
export const GOV_ONLY_ROLES: CriticalRoleDef[] = GOV_FUNCTIONAL_ROLES.filter(
  (r) => !CRITICAL_ROLES.some((c) => c.id === r.id),
);

export const CRITICAL_ROLE_IDS = new Set<string>(CRITICAL_ROLES.map((r) => r.id));

export function criticalRoleLabel(id: CriticalRoleId): string {
  return (
    CRITICAL_ROLES.find((r) => r.id === id)?.label ??
    GOV_FUNCTIONAL_ROLES.find((r) => r.id === id)?.label ??
    id
  );
}

/** All critical roles a verbatim title supports (priority order). */
export function classifyCriticalRoles(
  rawTitle: string | null | undefined,
  opts?: RoleClassifyOpts,
): CriticalRoleId[] {
  const t = norm(rawTitle);
  if (!t) return [];
  // Government mode: "Deputy Minister for Digital Transformation" is a
  // legitimate function holder, so only the narrower gov veto applies.
  if (opts?.government ? GOV_CONTEXT_VETO.test(t) : CONTEXT_VETO.test(t)) return [];
  const rank = titleSeniorityRank(rawTitle, opts);
  const out: CriticalRoleId[] = [];
  // Government mode appends the functional-role slice (ministry IT / Cyber /
  // AI / Digital / Customer-care leads at director / head-of-department
  // level). Corporate defs run first so C-level tags keep priority; a gov
  // override for an id already matched is skipped by the dedupe below.
  const defs = opts?.government ? [...CRITICAL_ROLES, ...GOV_FUNCTIONAL_ROLES] : CRITICAL_ROLES;
  for (const r of defs) {
    if (out.includes(r.id)) continue;
    if (r.veto && r.veto.test(t)) continue;
    if (!r.match.test(t)) continue;
    if (rank < r.floor) continue;
    out.push(r.id);
  }
  return out;
}

/** The primary (highest-priority) critical role a verbatim title supports, or null. */
export function classifyCriticalRole(
  rawTitle: string | null | undefined,
  opts?: RoleClassifyOpts,
): CriticalRoleId | null {
  return classifyCriticalRoles(rawTitle, opts)[0] ?? null;
}

export interface CriticalRoleCoverageEntry {
  role: CriticalRoleId;
  label: string;
  found: boolean;
  personName: string | null;
  title: string | null;
  confidence: "verified" | "inferred" | null;
}

export interface SeniorityGuardDrop {
  fullName: string;
  title: string | null;
  reason: string;
}

interface GuardableDm {
  fullName: string;
  title?: string | null;
  seniority?: string | null;
  confidence: "verified" | "inferred";
  criticalRole?: CriticalRoleId | null;
}

/**
 * Why a person is below the proposal seniority floor, or null when they pass.
 * Board members always pass. Managers/ICs (declared OR title-derived) never
 * pass. Directors pass only when their title carries a critical-role function.
 */
export function seniorityGuardDropReason(
  dm: GuardableDm,
  opts?: RoleClassifyOpts,
): string | null {
  if (dm.seniority === "board_chair" || dm.seniority === "board_member") return null;
  if (dm.seniority === "manager" || dm.seniority === "ic") {
    return `declared seniority "${dm.seniority}" is below the proposal floor`;
  }
  // Government mode: advisors, aides and the minister's private office sit
  // NEXT TO the hierarchy, not in it — drop them explicitly (their titles
  // otherwise read as unranked and would slip through).
  if (opts?.government && GOV_CONTEXT_VETO.test(norm(dm.title))) {
    return "adjacent-to-role government title (advisor / aide / private office)";
  }
  const rank = titleSeniorityRank(dm.title, opts);
  if (rank === 0 || rank === 1) {
    return `title reads as ${rank === 1 ? "manager" : "individual-contributor"} level`;
  }
  if ((dm.seniority === "director" || rank === 2) && !dm.criticalRole) {
    return "director-level title with no critical-role function";
  }
  return null;
}

/**
 * Code-computed coverage of the critical roles across a roster. The corporate
 * view is always the 15 canonical roles; government mode appends the gov-only
 * functional roles (IT / Cyber / Customer care) so an unfound "Head of
 * Cybersecurity" at a ministry shows honestly as a gap.
 */
export function computeCriticalRoleCoverage(
  dms: Array<GuardableDm>,
  opts?: RoleClassifyOpts,
): CriticalRoleCoverageEntry[] {
  const roles = opts?.government ? [...CRITICAL_ROLES, ...GOV_ONLY_ROLES] : CRITICAL_ROLES;
  return roles.map((r) => {
    const holders = dms.filter((d) => d.criticalRole === r.id);
    const best = holders.find((h) => h.confidence === "verified") ?? holders[0] ?? null;
    return {
      role: r.id,
      label: r.label,
      found: best != null,
      personName: best?.fullName ?? null,
      title: best?.title ?? null,
      confidence: best ? best.confidence : null,
    };
  });
}

export const UNFOUND_ROLES_MARKER = "Critical roles not yet identified";

/**
 * Deterministic post-run guard. Mutates `output`:
 *  1. Re-classifies every person's verbatim title and OVERWRITES the model's
 *     `criticalRole` claim (nulled when the title text doesn't support it).
 *  2. Drops people below the seniority floor (see seniorityGuardDropReason),
 *     logging each drop for auditability.
 *  3. Recomputes the per-role coverage summary in code and records unfound
 *     roles in openQuestions instead of letting the model stretch a junior.
 */
export function guardExecutiveMapperCriticalRoles<
  T extends {
    decisionMakers: Array<GuardableDm & Record<string, unknown>>;
    openQuestions: string[];
    criticalRoleCoverage?: CriticalRoleCoverageEntry[];
    droppedBySeniorityGuard?: SeniorityGuardDrop[];
  },
>(output: T, opts?: RoleClassifyOpts): T {
  const kept: T["decisionMakers"] = [];
  const dropped: SeniorityGuardDrop[] = [];
  for (const dm of output.decisionMakers ?? []) {
    // The classifier is the sole authority on the tag — a model claim the
    // verbatim title does not support is silently corrected.
    dm.criticalRole = classifyCriticalRole(dm.title, opts);
    const reason = seniorityGuardDropReason(dm, opts);
    if (reason) {
      dropped.push({ fullName: dm.fullName, title: dm.title ?? null, reason });
    } else {
      kept.push(dm);
    }
  }
  output.decisionMakers = kept;
  output.droppedBySeniorityGuard = dropped;
  output.criticalRoleCoverage = computeCriticalRoleCoverage(kept, opts);
  const unfound = output.criticalRoleCoverage.filter((c) => !c.found).map((c) => c.label);
  if (
    unfound.length > 0 &&
    !output.openQuestions.some((q) => q.includes(UNFOUND_ROLES_MARKER))
  ) {
    output.openQuestions.push(
      `${UNFOUND_ROLES_MARKER}: ${unfound.join(", ")} — left unfilled rather than stretched to a junior or adjacent person.`,
    );
  }
  return output;
}
