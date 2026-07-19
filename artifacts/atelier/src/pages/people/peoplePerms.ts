/**
 * Role gates for People lens surfaces (Task #364, Wave-4 review;
 * tightened in Task #221).
 *
 * Reward contains compensation / comp-band positioning — visible to the
 * comp-viewer set (founding_partner | hr | finance). Succession contains
 * HR assessments and slates — sensitive-people viewers only
 * (founding_partner | hr). Regular partners lost both surfaces in #221.
 * Everyone else gets a "Restricted" placeholder and the surface is
 * suppressed from the lifecycle ribbon and dossier tabs.
 */
import { useAtelierGetMe } from "@workspace/api-client-react";

const COMP_VIEWER_ROLES = new Set(["founding_partner", "hr", "finance"]);
const SENSITIVE_PEOPLE_ROLES = new Set(["founding_partner", "hr"]);

export function canSeeReward(role: string | undefined | null): boolean {
  return !!role && COMP_VIEWER_ROLES.has(role);
}

export function canSeeSuccession(role: string | undefined | null): boolean {
  return !!role && SENSITIVE_PEOPLE_ROLES.has(role);
}

/** Sensitive people data: personal details, person documents, HR notes,
 *  compliance registers. Mirrors the server's canViewSensitivePeopleData. */
export function canSeeSensitivePeople(role: string | undefined | null): boolean {
  return !!role && SENSITIVE_PEOPLE_ROLES.has(role);
}

export function useCanSeeReward(): { allowed: boolean; loading: boolean } {
  const { data: me, isLoading } = useAtelierGetMe();
  return { allowed: canSeeReward(me?.role), loading: isLoading };
}

export function useCanSeeSuccession(): { allowed: boolean; loading: boolean } {
  const { data: me, isLoading } = useAtelierGetMe();
  return { allowed: canSeeSuccession(me?.role), loading: isLoading };
}
