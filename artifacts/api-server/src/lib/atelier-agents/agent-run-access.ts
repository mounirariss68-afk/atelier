import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierAgentRuns,
  atelierDeliverables,
  atelierEngagements,
  atelierOpportunities,
  atelierUsers,
} from "@workspace/db";
import { canSeeAccount } from "../../routes/atelier/accountRoutes.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";

/**
 * Canonical authorization for reading a specialist-agent run target.
 *
 * Keep this outside a route module: REST, Riser capabilities and background
 * projections must all apply the same fail-closed target rules without making
 * the capability bootstrap import the agent router.
 */
export async function canAccessAgentRunTarget(
  me: typeof atelierUsers.$inferSelect,
  run: typeof atelierAgentRuns.$inferSelect,
  access?: Awaited<ReturnType<typeof accessibleEngagementIds>>,
): Promise<boolean> {
  const isFirmLeader = me.role === "founding_partner" || me.role === "partner";
  // Without a canonical target there is no record ACL to evaluate. Treat the
  // run as firm-wide operational data rather than silently authorizing every
  // authenticated persona.
  if (!run.targetId && !run.targetType) return isFirmLeader;
  if (!run.targetId || !run.targetType) return false;
  const scoped = access ?? (await accessibleEngagementIds(me));
  const type = run.targetType.toLowerCase();
  if (type === "account" || type === "atelier_account") {
    const [row] = await db.select({ id: atelierAccounts.id }).from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, run.targetId), eq(atelierAccounts.orgId, me.orgId), isNull(atelierAccounts.deletedAt)));
    return !!row && (await canSeeAccount(scoped, me, row.id));
  }
  if (type === "opportunity" || type === "atelier_opportunity") {
    const [row] = await db.select({ accountId: atelierOpportunities.accountId }).from(atelierOpportunities)
      .where(and(eq(atelierOpportunities.id, run.targetId), eq(atelierOpportunities.orgId, me.orgId), isNull(atelierOpportunities.deletedAt)));
    return !!row && (await canSeeAccount(scoped, me, row.accountId));
  }
  if (type === "engagement" || type === "atelier_engagement") {
    const [row] = await db.select({ id: atelierEngagements.id }).from(atelierEngagements)
      .where(and(eq(atelierEngagements.id, run.targetId), eq(atelierEngagements.orgId, me.orgId), isNull(atelierEngagements.deletedAt)));
    return !!row && (scoped.all || scoped.ids.has(row.id));
  }
  if (type === "deliverable" || type === "atelier_deliverable") {
    const [row] = await db.select({ engagementId: atelierDeliverables.engagementId }).from(atelierDeliverables)
      .where(and(eq(atelierDeliverables.id, run.targetId), eq(atelierDeliverables.orgId, me.orgId), isNull(atelierDeliverables.deletedAt)));
    return !!row && (scoped.all || scoped.ids.has(row.engagementId));
  }
  if (type === "firm" || type === "pipeline" || type === "atelier") {
    if (!isFirmLeader) return false;
    if (type === "firm") {
      return run.targetId === me.orgId || run.targetId === "firm_profile" || run.targetId === "_firm_";
    }
    if (type === "pipeline") return run.targetId === "atelier-global" || run.targetId === "pipeline";
    return [
      "win_themes", "press_watch", "certifications", "backups", "ip_catalog",
    ].includes(run.targetId) ||
      run.targetId.startsWith("field_notes:") ||
      run.targetId.startsWith("compliance:");
  }
  return false;
}