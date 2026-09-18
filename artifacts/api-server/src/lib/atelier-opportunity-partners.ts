import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, atelierUsers, atelierPartnerFirms, atelierAllianceJointPipeline, atelierAuditEvents } from "@workspace/db";
import { canEditPartnersLens } from "../routes/atelier/personaRoles.js";
import type { Response } from "express";

type Actor = typeof atelierUsers.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function partnerFirmSelectionError(me: Actor, ids: string[] | undefined, res: Response): Promise<boolean> {
  if (ids === undefined) return false;
  if (!canEditPartnersLens(me.role)) {
    res.status(403).json({ error: "partner-tags-forbidden", message: "You cannot edit partner associations." });
    return true;
  }
  const unique = [...new Set(ids)];
  const firms = unique.length ? await db.select({ id: atelierPartnerFirms.id }).from(atelierPartnerFirms)
    .where(and(eq(atelierPartnerFirms.orgId, me.orgId), isNull(atelierPartnerFirms.deletedAt), inArray(atelierPartnerFirms.id, unique))) : [];
  if (firms.length !== unique.length) {
    res.status(422).json({ error: "partner-firm-not-found", message: "Select active partner firms in your organization." });
    return true;
  }
  return false;
}

/** Caller holds the opportunity row lock (or has just inserted it) in this transaction. */
export async function replaceOpportunityPartners(tx: Tx, me: Actor, opportunityId: string, ids: string[] | undefined) {
  if (ids === undefined) return;
  if (!canEditPartnersLens(me.role)) throw new Error("partner-tags-forbidden");
  const wanted = new Set(ids);
  // Lock firms against concurrent archival until the entire opportunity write commits.
  const firms = wanted.size ? await tx.select({ id: atelierPartnerFirms.id }).from(atelierPartnerFirms)
    .where(and(eq(atelierPartnerFirms.orgId, me.orgId), isNull(atelierPartnerFirms.deletedAt), inArray(atelierPartnerFirms.id, [...wanted])))
    .for("share") : [];
  if (firms.length !== wanted.size) throw new Error("partner-firm-not-found");
  const existing = await tx.select().from(atelierAllianceJointPipeline).where(and(
    eq(atelierAllianceJointPipeline.orgId, me.orgId),
    eq(atelierAllianceJointPipeline.opportunityId, opportunityId),
    isNull(atelierAllianceJointPipeline.deletedAt),
  ));
  const removed = existing.filter((link) => !wanted.has(link.partnerFirmId));
  const retained = new Set(existing.map((link) => link.partnerFirmId));
  const added = [...wanted].filter((id) => !retained.has(id));
  if (!removed.length && !added.length) return;
  if (removed.length) await tx.update(atelierAllianceJointPipeline)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(inArray(atelierAllianceJointPipeline.id, removed.map((link) => link.id)));
  if (added.length) await tx.insert(atelierAllianceJointPipeline).values(added.map((partnerFirmId) => ({
    id: `jpl_${randomUUID()}`, orgId: me.orgId, opportunityId, partnerFirmId, createdByUserId: me.id,
    // Tags never imply negotiated economics or portal access. Archived links stay archived.
    cognirisePct: 0, partnerPct: 0,
  })));
  await tx.insert(atelierAuditEvents).values({
    id: `aud_${randomUUID()}`, orgId: me.orgId, entityType: "opportunity", entityId: opportunityId,
    actorType: "human", actorId: me.id, actorLabel: me.name, action: "opportunity.partners.update",
    payload: { added, removed: removed.map((link) => link.partnerFirmId) },
    payloadSummary: `${me.name} updated opportunity partner associations.`,
  });
}

export async function opportunityPartnerFirms(orgId: string, opportunityId: string) {
  const rows = await db.select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
    .from(atelierAllianceJointPipeline)
    .innerJoin(atelierPartnerFirms, eq(atelierPartnerFirms.id, atelierAllianceJointPipeline.partnerFirmId))
    .where(and(
      eq(atelierAllianceJointPipeline.orgId, orgId), eq(atelierPartnerFirms.orgId, orgId),
      eq(atelierAllianceJointPipeline.opportunityId, opportunityId),
      isNull(atelierAllianceJointPipeline.deletedAt), isNull(atelierPartnerFirms.deletedAt),
    )).orderBy(atelierPartnerFirms.name);
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}