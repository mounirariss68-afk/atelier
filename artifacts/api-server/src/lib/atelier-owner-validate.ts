/**
 * Shared owner-id validation (Task #940).
 *
 * A task/action/RAID owner must be a live atelier_users row in the same
 * org, exactly like the REST activity-create route enforces. Chat/CLI
 * write tools must use this too — otherwise an "assigned" item can point
 * at a non-user id and become invisible on every "assigned to me" surface.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, atelierUsers } from "@workspace/db";

export async function isValidOrgOwner(ownerId: string, orgId: string): Promise<boolean> {
  const [owner] = await db
    .select({ id: atelierUsers.id })
    .from(atelierUsers)
    .where(
      and(
        eq(atelierUsers.id, ownerId),
        eq(atelierUsers.orgId, orgId),
        isNull(atelierUsers.deletedAt),
      ),
    )
    .limit(1);
  return !!owner;
}
