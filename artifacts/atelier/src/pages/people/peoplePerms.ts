/**
 * Role gates for People Studio surfaces (Task #364, Wave-4 review).
 *
 * Reward and Succession contain compensation, comp-band positioning and
 * succession-slate data and must only render for Partner/Admin personas.
 * Everyone else gets a "Restricted" placeholder and the surface is
 * suppressed from the lifecycle ribbon and dossier tabs.
 */
import { useAtelierGetMe } from "@workspace/api-client-react";

const PARTNER_OR_ADMIN_ROLES = new Set([
  "founding_partner",
  "partner",
  "hr", // HR/People Ops admin can see comp + succession
]);

export function canSeeRewardAndSuccession(role: string | undefined | null): boolean {
  return !!role && PARTNER_OR_ADMIN_ROLES.has(role);
}

export function useCanSeeRewardAndSuccession(): { allowed: boolean; loading: boolean } {
  const { data: me, isLoading } = useAtelierGetMe();
  return { allowed: canSeeRewardAndSuccession(me?.role), loading: isLoading };
}
