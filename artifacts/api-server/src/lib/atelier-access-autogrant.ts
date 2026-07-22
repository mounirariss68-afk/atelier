/**
 * Task #509 — assignment-driven auto-grants.
 *
 * Assigning a person to an opportunity or engagement (partner owner /
 * engagement lead) must leave them able to actually see the work, so the
 * assignment paths call ensureAssignmentGrant() to create an active
 * engagement access grant when one is missing.
 *
 * Deliberately narrower than the Access Sentinel (rosterRoutes): this is a
 * system side-effect of an assignment the actor was already authorized to
 * make, not a manual grant, so it writes directly with a distinct audit
 * action ("access.grant.auto"). Firm-wide roles (founding_partner, partner)
 * are skipped — they need no grants. Idempotent: an existing active grant
 * short-circuits.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEngagementAccess,
  atelierAuditEvents,
} from "@workspace/db";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const FIRM_WIDE_ROLES = new Set(["founding_partner", "partner"]);

export async function ensureAssignmentGrant(args: {
  userId: string;
  engagementId: string;
  roleOnEngagement: "lead" | "member";
  actor: { id: string; name: string } | null; // null = system transition
  reason: string; // e.g. "opportunity-lead-assignment"
}): Promise<{ created: boolean; grantId?: string }> {
  const [user] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, args.userId), isNull(atelierUsers.deletedAt)));
  if (!user) return { created: false };
  if (FIRM_WIDE_ROLES.has(user.role)) return { created: false };

  // The table has a unique index on (engagementId, userId), so a prior
  // revoked/expired grant row must be reactivated rather than duplicated.
  // Reactivation is intentional: assigning the person is an explicit act
  // that implies access, and it is audited below.
  const [existing] = await db
    .select({ id: atelierEngagementAccess.id, status: atelierEngagementAccess.status })
    .from(atelierEngagementAccess)
    .where(
      and(
        eq(atelierEngagementAccess.engagementId, args.engagementId),
        eq(atelierEngagementAccess.userId, args.userId),
      ),
    );
  if (existing && existing.status === "active") {
    return { created: false, grantId: existing.id };
  }

  let grantId: string;
  if (existing) {
    grantId = existing.id;
    await db
      .update(atelierEngagementAccess)
      .set({
        status: "active",
        roleOnEngagement: args.roleOnEngagement,
        grantedByUserId: args.actor?.id ?? null,
        grantedAt: new Date(),
        deletedAt: null,
        endDate: null,
      })
      .where(eq(atelierEngagementAccess.id, existing.id));
  } else {
    grantId = rid("acc");
    await db.insert(atelierEngagementAccess).values({
      id: grantId,
      engagementId: args.engagementId,
      userId: args.userId,
      roleOnEngagement: args.roleOnEngagement,
      status: "active",
      grantedByUserId: args.actor?.id ?? null,
    });
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "engagement_access",
    entityId: grantId,
    actorType: args.actor ? "human" : "system",
    actorId: args.actor?.id ?? "system",
    actorLabel: args.actor?.name ?? "System",
    action: "access.grant.auto",
    payload: {
      engagementId: args.engagementId,
      userId: args.userId,
      roleOnEngagement: args.roleOnEngagement,
      reason: args.reason,
    },
    payloadSummary: `Access grant auto-created for ${user.name} on engagement ${args.engagementId} (${args.reason}).`,
  });
  return { created: true, grantId };
}
