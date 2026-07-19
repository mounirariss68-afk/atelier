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
  | "head_of_vro";

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
export function titleSeniorityRank(rawTitle: string | null | undefined): number {
  const t = norm(rawTitle);
  if (!t) return -1;
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

export const CRITICAL_ROLE_IDS = new Set<string>(CRITICAL_ROLES.map((r) => r.id));

export function criticalRoleLabel(id: CriticalRoleId): string {
  return CRITICAL_ROLES.find((r) => r.id === id)?.label ?? id;
}

/** All critical roles a verbatim title supports (priority order). */
export function classifyCriticalRoles(rawTitle: string | null | undefined): CriticalRoleId[] {
  const t = norm(rawTitle);
  if (!t) return [];
  if (CONTEXT_VETO.test(t)) return [];
  const rank = titleSeniorityRank(rawTitle);
  const out: CriticalRoleId[] = [];
  for (const r of CRITICAL_ROLES) {
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
): CriticalRoleId | null {
  return classifyCriticalRoles(rawTitle)[0] ?? null;
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
export function seniorityGuardDropReason(dm: GuardableDm): string | null {
  if (dm.seniority === "board_chair" || dm.seniority === "board_member") return null;
  if (dm.seniority === "manager" || dm.seniority === "ic") {
    return `declared seniority "${dm.seniority}" is below the proposal floor`;
  }
  const rank = titleSeniorityRank(dm.title);
  if (rank === 0 || rank === 1) {
    return `title reads as ${rank === 1 ? "manager" : "individual-contributor"} level`;
  }
  if ((dm.seniority === "director" || rank === 2) && !dm.criticalRole) {
    return "director-level title with no critical-role function";
  }
  return null;
}

/** Code-computed coverage of the 15 critical roles across a roster. */
export function computeCriticalRoleCoverage(
  dms: Array<GuardableDm>,
): CriticalRoleCoverageEntry[] {
  return CRITICAL_ROLES.map((r) => {
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
>(output: T): T {
  const kept: T["decisionMakers"] = [];
  const dropped: SeniorityGuardDrop[] = [];
  for (const dm of output.decisionMakers ?? []) {
    // The classifier is the sole authority on the tag — a model claim the
    // verbatim title does not support is silently corrected.
    dm.criticalRole = classifyCriticalRole(dm.title);
    const reason = seniorityGuardDropReason(dm);
    if (reason) {
      dropped.push({ fullName: dm.fullName, title: dm.title ?? null, reason });
    } else {
      kept.push(dm);
    }
  }
  output.decisionMakers = kept;
  output.droppedBySeniorityGuard = dropped;
  output.criticalRoleCoverage = computeCriticalRoleCoverage(kept);
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
