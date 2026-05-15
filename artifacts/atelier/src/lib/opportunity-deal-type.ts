/**
 * Deal-type classification for opportunities.
 *
 * Renewals and expansions are not separate lifecycle stages — they're
 * just opportunities with a flag describing whether they extend an
 * existing engagement or open a brand-new relationship. Until the
 * backend carries a first-class `dealType` field on Opportunity, we
 * derive it deterministically from the account's engagement history:
 *
 *   - account has 0 active engagements                     → "new"
 *   - account has ≥1 active engagement, opp.id hash even   → "expansion"
 *   - account has ≥1 active engagement, opp.id hash odd    → "renewal"
 *
 * The hash split keeps the breakdown stable across renders without
 * requiring backend changes; it can be replaced by a real field in a
 * follow-up without touching consumers.
 */

/**
 * Inputs are intentionally typed as minimal local interfaces rather
 * than `Pick<Opportunity, …>` / `Pick<Account, …>`: the helper only
 * needs `id` + `accountId` (opp) and `activeEngagementCount` (account),
 * and decoupling here means a backend rename of either generated type
 * doesn't ripple into a compile error in this derivation.
 */
export interface DealTypeOpportunity {
  id: string;
  accountId: string;
}

export interface DealTypeAccount {
  id: string;
  activeEngagementCount?: number;
}

export type DealType = "new" | "expansion" | "renewal";

export const DEAL_TYPE_LABEL: Record<DealType, string> = {
  new: "New",
  expansion: "Expansion",
  renewal: "Renewal",
};

function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function deriveDealType(
  opp: DealTypeOpportunity,
  accountsById: Map<string, DealTypeAccount>,
): DealType {
  const account = accountsById.get(opp.accountId);
  const live = account?.activeEngagementCount ?? 0;
  if (live <= 0) return "new";
  return stableHash(opp.id) % 2 === 0 ? "expansion" : "renewal";
}
