/**
 * Task #654 — explicit legal entity on engagements.
 *
 * `inferEngagementLegalEntity` picks the entity from non-void invoice
 * history when it is unambiguous (all invoices agree). Used both by the
 * idempotent boot backfill (legacy rows with NULL legal_entity_id) and
 * as a default when new engagements are auto-created.
 */

import { and, eq, isNull, inArray } from "drizzle-orm";
import { db, atelierEngagements, atelierInvoice } from "@workspace/db";

/** Entity id when every non-void invoice on the engagement agrees; else null. */
export async function inferEngagementLegalEntity(
  orgId: string,
  engagementId: string,
): Promise<string | null> {
  const invoices = await db
    .select({ legalEntityId: atelierInvoice.legalEntityId })
    .from(atelierInvoice)
    .where(and(
      eq(atelierInvoice.orgId, orgId),
      eq(atelierInvoice.engagementId, engagementId),
      isNull(atelierInvoice.deletedAt),
      isNull(atelierInvoice.voidedAt),
    ));
  const entities = new Set(invoices.map((i) => i.legalEntityId).filter((e): e is string => !!e));
  return entities.size === 1 ? [...entities][0] : null;
}

/**
 * Idempotent boot backfill: fill NULL engagement legal_entity_id from
 * unambiguous invoice history. Ambiguous / invoice-less engagements are
 * left NULL (margin reporting falls back to invoice inference).
 */
export async function backfillEngagementLegalEntities(): Promise<{ scanned: number; filled: number }> {
  const rows = await db
    .select({ id: atelierEngagements.id, orgId: atelierEngagements.orgId })
    .from(atelierEngagements)
    .where(and(isNull(atelierEngagements.legalEntityId), isNull(atelierEngagements.deletedAt)));
  if (!rows.length) return { scanned: 0, filled: 0 };

  const invoices = await db
    .select({
      engagementId: atelierInvoice.engagementId,
      legalEntityId: atelierInvoice.legalEntityId,
    })
    .from(atelierInvoice)
    .where(and(
      inArray(atelierInvoice.engagementId, rows.map((r) => r.id)),
      isNull(atelierInvoice.deletedAt),
      isNull(atelierInvoice.voidedAt),
    ));
  const byEng = new Map<string, Set<string>>();
  for (const inv of invoices) {
    if (!inv.engagementId || !inv.legalEntityId) continue;
    if (!byEng.has(inv.engagementId)) byEng.set(inv.engagementId, new Set());
    byEng.get(inv.engagementId)!.add(inv.legalEntityId);
  }
  let filled = 0;
  for (const r of rows) {
    const set = byEng.get(r.id);
    if (!set || set.size !== 1) continue;
    await db
      .update(atelierEngagements)
      .set({ legalEntityId: [...set][0], updatedAt: new Date() })
      .where(and(eq(atelierEngagements.id, r.id), isNull(atelierEngagements.legalEntityId)));
    filled += 1;
  }
  return { scanned: rows.length, filled };
}
