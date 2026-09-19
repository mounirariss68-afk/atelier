import { Router, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db, atelierAuditEvents, atelierAdminPersonMappings, atelierPersonRelationshipClassifications, atelierPersons, atelierEmployees, atelierContractors, atelierPartnerFirmResources } from "@workspace/db";
const router = Router();
type Me = NonNullable<Request["atelierPersona"]>;
const rid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const s = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const admin = (req: Request, res: Response): Me | null => {
 const me = req.atelierPersona;
 if (!me) { res.status(401).json({ error: "no-active-persona" }); return null; }
 if (!["founding_partner", "hr", "finance"].includes(me.role)) { res.status(403).json({ error: "admin-role-required" }); return null; }
 return me;
};
async function audit(me: Me, entityId: string, action: string, payload: Record<string, unknown>) {
 await db.insert(atelierAuditEvents).values({ id: rid("aud"), orgId: me.orgId, entityType: "person_relationship_classification", entityId, actorType: "human", actorId: me.id, actorLabel: me.name, action, payload, payloadSummary: action });
}
const types = ["employee", "contractor", "equity_partner", "non_equity_partner", "partner_firm_resource"];
// @cli-skip: admin-only identity mapping write; no assistant authority is intended
router.put("/admin/roster/mappings/:stableKey", async (req, res, next) => {
 try {
  const me = admin(req, res); if (!me) return;
  const stableKey = req.params.stableKey.trim(), personId = s(req.body?.personId);
  if (!stableKey || !personId) { res.status(400).json({ error: "stable-key-and-person-required" }); return; }
  const [old] = await db.select().from(atelierAdminPersonMappings).where(and(eq(atelierAdminPersonMappings.orgId, me.orgId), eq(atelierAdminPersonMappings.stableKey, stableKey), isNull(atelierAdminPersonMappings.deletedAt)));
  if (old) { if (old.personId !== personId) { res.status(409).json({ error: "stable-key-mapped", mapping: old }); return; } res.json({ mapping: old, idempotent: true }); return; }
  const row = { id: rid("map"), orgId: me.orgId, stableKey, personId, metadata: req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}, createdByUserId: me.id };
  await db.insert(atelierAdminPersonMappings).values(row); res.status(201).json({ mapping: row, idempotent: false });
 } catch (e) { next(e); }
});
// @cli-skip: admin-only identity mapping read; no assistant surface is intended
router.get("/admin/roster/mappings", async (req, res, next) => { try { const me = admin(req, res); if (!me) return; res.json({ items: await db.select().from(atelierAdminPersonMappings).where(and(eq(atelierAdminPersonMappings.orgId, me.orgId), isNull(atelierAdminPersonMappings.deletedAt))) }); } catch (e) { next(e); } });

// @cli-skip: HR roster classification write remains route-authoritative until shared executor conformance exists
router.patch(["/roster/people/:id", "/roster/people/:id/classification"], async (req, res, next) => {
 try {
  const isDedicatedClassificationRoute = req.path.endsWith("/classification");
  if (!isDedicatedClassificationRoute && !("relationshipType" in (req.body ?? {}))) {
   next();
   return;
  }
  const me = admin(req, res); if (!me) return;
  const relationshipType = s(req.body.relationshipType), effectiveFrom = s(req.body.effectiveFrom) ?? new Date().toISOString().slice(0, 10);
  if (!relationshipType || !types.includes(relationshipType) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) { res.status(400).json({ error: "invalid-relationship-classification" }); return; }
  const requestedId = String(req.params.id);
  let target = (await db.select({ id: atelierPersons.id, displayName: atelierPersons.displayName }).from(atelierPersons).where(and(eq(atelierPersons.orgId, me.orgId), eq(atelierPersons.id, requestedId), isNull(atelierPersons.deletedAt))))[0];
  if (!target) {
   const [e] = await db.select({ personId: atelierEmployees.personId }).from(atelierEmployees).where(and(eq(atelierEmployees.orgId, me.orgId), eq(atelierEmployees.id, requestedId)));
   const [c] = await db.select({ personId: atelierContractors.personId }).from(atelierContractors).where(and(eq(atelierContractors.orgId, me.orgId), eq(atelierContractors.id, requestedId)));
   const [r] = await db.select({ personId: atelierPartnerFirmResources.personId }).from(atelierPartnerFirmResources).where(and(eq(atelierPartnerFirmResources.orgId, me.orgId), eq(atelierPartnerFirmResources.id, requestedId)));
   const stable = e?.personId ?? c?.personId ?? r?.personId;
   if (stable) target = (await db.select({ id: atelierPersons.id, displayName: atelierPersons.displayName }).from(atelierPersons).where(and(eq(atelierPersons.orgId, me.orgId), eq(atelierPersons.id, stable), isNull(atelierPersons.deletedAt))))[0];
  }
  if (!target) { res.status(404).json({ error: "person-not-found" }); return; }
  const basis = relationshipType === "equity_partner" ? "profit_sharing" : s(req.body.compensationBasis);
  const [row] = await db.insert(atelierPersonRelationshipClassifications).values({ id: rid("rel"), orgId: me.orgId, personId: target.id, relationshipType, compensationBasis: basis, status: relationshipType === "equity_partner" ? "rules_pending" : (s(req.body.status) ?? "active"), effectiveFrom, source: "admin", provenanceId: s(req.body.provenanceId), createdByUserId: me.id }).onConflictDoUpdate({ target: [atelierPersonRelationshipClassifications.orgId, atelierPersonRelationshipClassifications.personId, atelierPersonRelationshipClassifications.effectiveFrom], set: { relationshipType, compensationBasis: basis, status: relationshipType === "equity_partner" ? "rules_pending" : (s(req.body.status) ?? "active"), updatedAt: new Date(), createdByUserId: me.id } }).returning();
  await audit(me, row.id, "roster.relationship_classification_update", { personId: target.id, relationshipType, compensationBasis: basis });
  res.json({ relationship: row, person: { personId: target.id, relationshipType: row.relationshipType, compensationBasis: row.compensationBasis, compensationStatus: row.status } });
 } catch (e) { next(e); }
});
export async function loadRelationshipClassification(orgId: string, personId: string, asOf = new Date().toISOString().slice(0, 10)) {
 const [row] = await db.select().from(atelierPersonRelationshipClassifications).where(and(
  eq(atelierPersonRelationshipClassifications.orgId, orgId),
  eq(atelierPersonRelationshipClassifications.personId, personId),
  isNull(atelierPersonRelationshipClassifications.deletedAt),
  inArray(atelierPersonRelationshipClassifications.status, ["active", "rules_pending"]),
  lte(atelierPersonRelationshipClassifications.effectiveFrom, asOf),
  or(isNull(atelierPersonRelationshipClassifications.effectiveTo), gte(atelierPersonRelationshipClassifications.effectiveTo, asOf)),
 )).orderBy(desc(atelierPersonRelationshipClassifications.effectiveFrom));
 return row ?? null;
}
export default router;