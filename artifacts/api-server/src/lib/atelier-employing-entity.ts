import { and, eq, isNull } from "drizzle-orm";
import { db, atelierEmployees, atelierLegalEntities } from "@workspace/db";

export type EmployingEntityIdentity = {
  id: string;
  orgId: string;
  shortName: string | null;
  legalNameEn: string;
};

export function employingEntityName(
  entity: Pick<EmployingEntityIdentity, "shortName" | "legalNameEn">,
): string {
  return entity.shortName?.trim() || entity.legalNameEn.trim();
}

function normalizedName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function matchLegacyEmployingEntity(
  legacyName: string | null | undefined,
  entities: EmployingEntityIdentity[],
): EmployingEntityIdentity | null {
  const needle = normalizedName(legacyName);
  if (!needle) return null;
  const matches = entities.filter((entity) => {
    const names = [entity.shortName, entity.legalNameEn]
      .map(normalizedName)
      .filter(Boolean);
    return names.includes(needle);
  });
  return matches.length === 1 ? matches[0] : null;
}

export async function findActiveEmployingEntity(
  orgId: string,
  legalEntityId: string,
): Promise<typeof atelierLegalEntities.$inferSelect | null> {
  const [entity] = await db
    .select()
    .from(atelierLegalEntities)
    .where(
      and(
        eq(atelierLegalEntities.id, legalEntityId),
        eq(atelierLegalEntities.orgId, orgId),
        eq(atelierLegalEntities.status, "active"),
      ),
    )
    .limit(1);
  return entity ?? null;
}

/**
 * Rerun-safe production backfill. Only NULL IDs are considered and only an
 * exact, unambiguous registered-name match is written. Legacy labels remain
 * untouched so unmatched rows can still be shown for manual correction.
 */
export async function backfillEmployeeEmployingEntityIds(): Promise<{
  scanned: number;
  filled: number;
  unmatched: number;
}> {
  const [employees, entities] = await Promise.all([
    db
      .select({
        id: atelierEmployees.id,
        orgId: atelierEmployees.orgId,
        employingEntity: atelierEmployees.employingEntity,
      })
      .from(atelierEmployees)
      .where(isNull(atelierEmployees.legalEntityId)),
    db
      .select({
        id: atelierLegalEntities.id,
        orgId: atelierLegalEntities.orgId,
        shortName: atelierLegalEntities.shortName,
        legalNameEn: atelierLegalEntities.legalNameEn,
      })
      .from(atelierLegalEntities)
      .where(eq(atelierLegalEntities.status, "active")),
  ]);
  const byOrg = new Map<string, EmployingEntityIdentity[]>();
  for (const entity of entities) {
    const rows = byOrg.get(entity.orgId) ?? [];
    rows.push(entity);
    byOrg.set(entity.orgId, rows);
  }
  let filled = 0;
  let unmatched = 0;
  for (const employee of employees) {
    if (!employee.employingEntity?.trim()) continue;
    const entity = matchLegacyEmployingEntity(
      employee.employingEntity,
      byOrg.get(employee.orgId) ?? [],
    );
    if (!entity) {
      unmatched += 1;
      continue;
    }
    const updated = await db
      .update(atelierEmployees)
      .set({ legalEntityId: entity.id, updatedAt: new Date() })
      .where(
        and(
          eq(atelierEmployees.id, employee.id),
          eq(atelierEmployees.orgId, employee.orgId),
          isNull(atelierEmployees.legalEntityId),
        ),
      )
      .returning({ id: atelierEmployees.id });
    filled += updated.length;
  }
  return { scanned: employees.length, filled, unmatched };
}