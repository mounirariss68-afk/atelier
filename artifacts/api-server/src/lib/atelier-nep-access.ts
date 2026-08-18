/**
 * Task #1297 — Non-Equity Partner (NEP) scoped-access helpers.
 *
 * NEPs are restricted personas (role `non_equity_partner`) whose CRM world
 * is deliberately tiny:
 *   - accounts they OWN (partnerOwnerId — they created them),
 *   - accounts a founder/partner explicitly GRANTED (atelier_nep_account_grants),
 *   - opportunities they OWN or were INVITED into (atelier_nep_opp_invites),
 *   - parent accounts of invited opportunities (read-limited view so they
 *     can work the opportunity).
 *
 * Every account / opportunity read-write surface for an NEP must resolve
 * through these helpers — never duplicate the visibility logic inline.
 * Grants and invites are soft-revoked (revokedAt), so revocation takes
 * effect immediately on the next request.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierNepAccountGrants,
  atelierNepOppInvites,
  atelierOpportunities,
} from "@workspace/db";

export interface NepAccountAccess {
  /** Accounts with FULL detail: owned + explicitly granted. */
  fullIds: Set<string>;
  /** Parent accounts of invited opportunities (read-limited view). */
  invitedParentIds: Set<string>;
  /** Opportunity ids explicitly invited (unrevoked). */
  invitedOppIds: Set<string>;
}

/** Resolve the complete NEP access set for one user in one query pass. */
export async function nepAccessFor(userId: string): Promise<NepAccountAccess> {
  const [grants, invites, owned] = await Promise.all([
    db
      .select({ accountId: atelierNepAccountGrants.accountId })
      .from(atelierNepAccountGrants)
      .where(
        and(
          eq(atelierNepAccountGrants.userId, userId),
          isNull(atelierNepAccountGrants.revokedAt),
        ),
      ),
    db
      .select({ opportunityId: atelierNepOppInvites.opportunityId })
      .from(atelierNepOppInvites)
      .where(
        and(
          eq(atelierNepOppInvites.userId, userId),
          isNull(atelierNepOppInvites.revokedAt),
        ),
      ),
    db
      .select({ id: atelierAccounts.id })
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.partnerOwnerId, userId),
          isNull(atelierAccounts.deletedAt),
        ),
      ),
  ]);
  const fullIds = new Set<string>([
    ...owned.map((a) => a.id),
    ...grants.map((g) => g.accountId),
  ]);
  const invitedOppIds = new Set<string>(invites.map((i) => i.opportunityId));
  const invitedParentIds = new Set<string>();
  if (invitedOppIds.size > 0) {
    const opps = await db
      .select({
        id: atelierOpportunities.id,
        accountId: atelierOpportunities.accountId,
      })
      .from(atelierOpportunities)
      .where(isNull(atelierOpportunities.deletedAt));
    for (const o of opps) {
      if (invitedOppIds.has(o.id) && !fullIds.has(o.accountId)) {
        invitedParentIds.add(o.accountId);
      }
    }
  }
  return { fullIds, invitedParentIds, invitedOppIds };
}

/** Account visible to the NEP at all (full or invited-parent read view). */
export function nepCanSeeAccountId(
  access: NepAccountAccess,
  accountId: string,
): boolean {
  return access.fullIds.has(accountId) || access.invitedParentIds.has(accountId);
}

/**
 * Opportunity visible to the NEP: they own it, they were invited, or it
 * belongs to an account they hold full access on (owned/granted).
 */
export function nepCanSeeOpportunity(
  access: NepAccountAccess,
  opp: { id: string; accountId: string; partnerOwnerId?: string | null },
  userId: string,
): boolean {
  return (
    opp.partnerOwnerId === userId ||
    access.invitedOppIds.has(opp.id) ||
    access.fullIds.has(opp.accountId)
  );
}
