/**
 * Alliance-role taxonomy for the Alliance Executive Mapper (Task #526).
 *
 * When mapping a PARTNER FIRM (not a client account), the people who matter
 * are those who would own or sponsor a Cognirise alliance: partnership /
 * channel leads, practice leads for the relevant service lines, corporate
 * development, regional (MENAT / Türkiye / Gulf) leadership, delivery heads
 * and the executive apex. This module is fully deterministic — the LLM may
 * CLAIM an `allianceRole` per person, but the runner re-classifies every
 * verbatim title with `classifyAllianceRole()` and overwrites the claim,
 * mirroring the client-side critical-roles guard.
 */

import { titleSeniorityRank } from "./critical-roles.js";

export type AllianceRoleId =
  | "ceo"
  | "alliances_lead"
  | "corp_dev"
  | "cro_sales"
  | "practice_lead"
  | "regional_lead"
  | "delivery_head"
  | "cto"
  | "coo";

export interface AllianceRoleDef {
  id: AllianceRoleId;
  label: string;
  /** Minimum title-derived seniority rank (see titleSeniorityRank). */
  floor: number;
  match: RegExp;
  veto?: RegExp;
}

function norm(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[&/,+\-().|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONTEXT_VETO =
  /\b(assistant|deputy|advisor|adviser|secretary|intern|apprentice|aide)\b|office of the|\b[ep]a to\b/;

const R = (
  id: AllianceRoleId,
  label: string,
  floor: number,
  match: RegExp,
  veto?: RegExp,
): AllianceRoleDef => ({ id, label, floor, match, veto });

/**
 * The 9 alliance-critical roles, in priority order (first match wins).
 * Floors are deliberately lower than the client taxonomy for the
 * partnership-function roles: at a mid-size partner firm the alliances or
 * corp-dev owner is often director-level.
 */
export const ALLIANCE_ROLES: AllianceRoleDef[] = [
  R("ceo", "CEO / Managing Partner", 4, /\bceo\b|chief executive\b|managing partner|managing director\b/),
  R(
    "alliances_lead",
    "Alliances / Partnerships Lead",
    2,
    // NOTE: a bare consulting-rank "Partner" title does NOT match — the
    // pattern needs the alliances/partnerships/channel FUNCTION wording.
    /\balliances?\b|\bpartnerships?\b|\bchannels?\b|\becosystems?\b|partner (management|development|sales)/,
  ),
  R(
    "corp_dev",
    "Corporate Development / M&A",
    2,
    /corporate development|\bcorp dev\b|mergers|\bm a\b|business development\b|\bventures\b/,
  ),
  R(
    "cro_sales",
    "Revenue / Commercial Lead",
    3,
    /\bcro\b|chief revenue officer|chief commercial officer|chief growth officer|\bsales\b|\bgrowth\b|\bcommercial\b/,
    /communication|compliance/,
  ),
  R(
    "practice_lead",
    "Practice / Service-line Lead",
    2,
    /\bpractice\b|service line|\bai\b|artificial intelligence|\bdata\b|analytics|\bcloud\b|digital transformation|consulting\b|advisory\b|\berp\b|\bsap\b|\boracle\b|\bcrm\b/,
  ),
  R(
    "regional_lead",
    "Regional (MENAT / Gulf) Lead",
    2,
    /\bmena\b|\bmenat\b|middle east|\bgulf\b|\bgcc\b|saudi|\buae\b|emirates|qatar|t[uü]rkiye|turkey|\bemea\b|\bregion(al)?\b|country (manager|lead|head)/,
  ),
  R(
    "delivery_head",
    "Delivery / Engineering Head",
    3,
    /\bdelivery\b|\bengineering\b|\boperations\b|professional services|\bconsulting operations\b/,
  ),
  R("cto", "CTO", 5, /\bcto\b|chief technolog(y|ies) officer|chief technical officer/),
  R("coo", "COO", 5, /\bcoo\b|chief operat(ing|ions) officer/),
];

export function allianceRoleLabel(id: AllianceRoleId): string {
  return ALLIANCE_ROLES.find((r) => r.id === id)?.label ?? id;
}

/** The primary (highest-priority) alliance role a verbatim title supports, or null. */
export function classifyAllianceRole(
  rawTitle: string | null | undefined,
): AllianceRoleId | null {
  const t = norm(rawTitle);
  if (!t) return null;
  if (CONTEXT_VETO.test(t)) return null;
  const rank = titleSeniorityRank(rawTitle);
  for (const r of ALLIANCE_ROLES) {
    if (r.veto && r.veto.test(t)) continue;
    if (!r.match.test(t)) continue;
    if (rank < r.floor) continue;
    return r.id;
  }
  return null;
}

export interface AllianceRoleCoverageEntry {
  role: AllianceRoleId;
  label: string;
  found: boolean;
  personName: string | null;
  title: string | null;
  confidence: "verified" | "inferred" | null;
}

export interface AllianceGuardDrop {
  fullName: string;
  title: string | null;
  reason: string;
}

interface GuardablePerson {
  fullName: string;
  title?: string | null;
  seniority?: string | null;
  confidence: "verified" | "inferred";
  allianceRole?: AllianceRoleId | null;
}

/**
 * Why a person is below the proposal floor, or null when they pass. Board
 * members always pass. ICs never pass. Managers/directors pass only when the
 * title carries an alliance-role function (an "Alliance Manager" is exactly
 * who we want; a generic "Project Manager" is not).
 */
export function allianceGuardDropReason(p: GuardablePerson): string | null {
  if (p.seniority === "board_chair" || p.seniority === "board_member") return null;
  const rank = titleSeniorityRank(p.title);
  if (p.seniority === "ic" || rank === 0) {
    return "title reads as individual-contributor level";
  }
  if ((p.seniority === "manager" || p.seniority === "director" || rank === 1 || rank === 2) && !p.allianceRole) {
    return "manager/director-level title with no alliance-role function";
  }
  return null;
}

export function computeAllianceRoleCoverage(
  people: Array<GuardablePerson>,
): AllianceRoleCoverageEntry[] {
  return ALLIANCE_ROLES.map((r) => {
    const holders = people.filter((d) => d.allianceRole === r.id);
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

export const UNFOUND_ALLIANCE_ROLES_MARKER = "Alliance roles not yet identified";

/**
 * Deterministic post-run guard (mirrors guardExecutiveMapperCriticalRoles):
 * re-classifies every verbatim title (overwriting the model's claim), drops
 * people below the floor, recomputes coverage in code, and records unfound
 * roles in openQuestions.
 */
export function guardAllianceMapperRoles<
  T extends {
    decisionMakers: Array<GuardablePerson & Record<string, unknown>>;
    openQuestions: string[];
    allianceRoleCoverage?: AllianceRoleCoverageEntry[];
    droppedByAllianceGuard?: AllianceGuardDrop[];
  },
>(output: T): T {
  const kept: T["decisionMakers"] = [];
  const dropped: AllianceGuardDrop[] = [];
  for (const dm of output.decisionMakers ?? []) {
    dm.allianceRole = classifyAllianceRole(dm.title);
    const reason = allianceGuardDropReason(dm);
    if (reason) {
      dropped.push({ fullName: dm.fullName, title: dm.title ?? null, reason });
    } else {
      kept.push(dm);
    }
  }
  output.decisionMakers = kept;
  output.droppedByAllianceGuard = dropped;
  output.allianceRoleCoverage = computeAllianceRoleCoverage(kept);
  const unfound = output.allianceRoleCoverage.filter((c) => !c.found).map((c) => c.label);
  if (
    unfound.length > 0 &&
    !output.openQuestions.some((q) => q.includes(UNFOUND_ALLIANCE_ROLES_MARKER))
  ) {
    output.openQuestions.push(
      `${UNFOUND_ALLIANCE_ROLES_MARKER}: ${unfound.join(", ")} — left unfilled rather than stretched to a junior or adjacent person.`,
    );
  }
  return output;
}
