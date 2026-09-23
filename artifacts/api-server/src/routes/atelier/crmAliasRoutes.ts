import { Router, type Request, type Response } from "express";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierAuditEvents,
  atelierCrmAliases,
  atelierPersons,
} from "@workspace/db";
import { z } from "zod";
import { isFoundingPartner, isPartner } from "./personaRoles.js";
import { normalizeCrmAlias } from "../../lib/atelier-cli/crm-alias-normalization.js";

const router = Router();

export const CRM_ALIAS_ROUTE_CONTRACT = [
  { method: "GET", path: "/crm/aliases" },
  { method: "POST", path: "/crm/aliases" },
  { method: "POST", path: "/crm/aliases/:id/retire" },
] as const;

export const normalizeAlias = normalizeCrmAlias;

export function canGovernCrmAliases(role: string | null | undefined): boolean {
  return isPartner(role) || isFoundingPartner(role);
}

function actor(req: Request, res: Response) {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (!canGovernCrmAliases(me.role)) {
    res.status(403).json({ error: "partner-required" });
    return null;
  }
  return me;
}

const targetBody = z.object({
  targetKind: z.enum(["account", "person"]),
  targetId: z.string().min(1).max(200),
  alias: z.string().trim().min(1).max(200),
  sourceKind: z.string().trim().min(1).max(80).default("manual"),
  sourceRef: z.string().trim().max(300).nullable().optional(),
});

type AliasActor = {
  id: string;
  name: string;
  orgId: string;
};

export async function retireCrmAlias(
  me: AliasActor,
  aliasId: string,
  hooks?: { beforeAudit?: () => Promise<void> | void },
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(atelierCrmAliases).set({
      status: "retired", retiredBy: me.id, retiredAt: new Date(),
    }).where(and(
      eq(atelierCrmAliases.id, aliasId),
      eq(atelierCrmAliases.orgId, me.orgId),
      eq(atelierCrmAliases.status, "active"),
    )).returning();

    if (!updated) {
      // A concurrent retirement may have won while this UPDATE waited. Return
      // the authoritative row instead of a stale pre-update snapshot, and do
      // not emit a second audit event.
      const [current] = await tx.select().from(atelierCrmAliases).where(and(
        eq(atelierCrmAliases.id, aliasId),
        eq(atelierCrmAliases.orgId, me.orgId),
      )).limit(1);
      return current ?? null;
    }

    await hooks?.beforeAudit?.();
    await tx.insert(atelierAuditEvents).values({
      id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      orgId: me.orgId, entityType: updated.targetKind, entityId: updated.targetId,
      actorType: "human", actorId: me.id, actorLabel: me.name,
      action: "crm.alias.retire", payload: { aliasId: updated.id },
      payloadSummary: `Retired ${updated.targetKind} alias "${updated.alias}"`,
    });
    return updated;
  });
}

export async function targetExists(orgId: string, targetKind: "account" | "person", targetId: string) {
  if (targetKind === "account") {
    const [row] = await db.select({ id: atelierAccounts.id }).from(atelierAccounts).where(and(
      eq(atelierAccounts.id, targetId), eq(atelierAccounts.orgId, orgId),
      // Archived accounts are not live semantic targets. Their retired
      // aliases remain listable for audit, but cannot receive new aliases.
      ne(atelierAccounts.status, "archived"),
      isNull(atelierAccounts.deletedAt),
    )).limit(1);
    return !!row;
  }
  const [row] = await db.select({ id: atelierPersons.id }).from(atelierPersons).where(and(
    eq(atelierPersons.id, targetId), eq(atelierPersons.orgId, orgId),
    isNull(atelierPersons.deletedAt),
  )).limit(1);
  return !!row;
}

// @cli-skip: partner-gated CRM alias governance; semantic reads consume approved aliases
router.get("/crm/aliases", async (req, res) => {
  const me = actor(req, res);
  if (!me) return;
  const targetKind = typeof req.query.targetKind === "string" ? req.query.targetKind : undefined;
  const targetId = typeof req.query.targetId === "string" ? req.query.targetId : undefined;
  const rows = await db.select().from(atelierCrmAliases).where(and(
    eq(atelierCrmAliases.orgId, me.orgId),
    ...(targetKind === "account" || targetKind === "person" ? [eq(atelierCrmAliases.targetKind, targetKind)] : []),
    ...(targetId ? [eq(atelierCrmAliases.targetId, targetId)] : []),
  ));
  res.json({ items: rows });
});

// @cli-skip: partner-gated CRM alias governance; semantic reads consume approved aliases
router.post("/crm/aliases", async (req, res) => {
  const me = actor(req, res);
  if (!me) return;
  const parsed = targetBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  const normalizedAlias = normalizeAlias(b.alias);
  if (!normalizedAlias) {
    res.status(400).json({ error: "invalid-alias" });
    return;
  }
  if (!(await targetExists(me.orgId, b.targetKind, b.targetId))) {
    res.status(404).json({ error: "target-not-found" });
    return;
  }
  try {
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"crm-aliases:" + me.orgId}))`);
      const [existing] = await tx.select({ id: atelierCrmAliases.id }).from(atelierCrmAliases).where(and(
        eq(atelierCrmAliases.orgId, me.orgId),
        eq(atelierCrmAliases.targetKind, b.targetKind),
        eq(atelierCrmAliases.targetId, b.targetId),
        eq(atelierCrmAliases.normalizedAlias, normalizedAlias),
        eq(atelierCrmAliases.status, "active"),
      )).limit(1);
      if (existing) {
        const error = new Error("alias-already-active");
        (error as Error & { code?: string }).code = "alias-already-active";
        throw error;
      }
      const [created] = await tx.insert(atelierCrmAliases).values({
        id: `calias_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        orgId: me.orgId, targetKind: b.targetKind, targetId: b.targetId,
        alias: b.alias, normalizedAlias, status: "active",
        sourceKind: b.sourceKind, sourceRef: b.sourceRef ?? null, createdBy: me.id,
      }).returning();
      await tx.insert(atelierAuditEvents).values({
        id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        orgId: me.orgId, entityType: b.targetKind, entityId: b.targetId,
        actorType: "human", actorId: me.id, actorLabel: me.name,
        action: "crm.alias.create",
        payload: { aliasId: created!.id, alias: b.alias, normalizedAlias, sourceKind: b.sourceKind, sourceRef: b.sourceRef ?? null },
        payloadSummary: `Created ${b.targetKind} alias "${b.alias}"`,
      });
      return created!;
    });
    res.status(201).json({ item: row });
  } catch (error) {
    if ((error as { code?: string }).code === "alias-already-active" || (error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "alias-already-active" });
      return;
    }
    throw error;
  }
});

// @cli-skip: partner-gated CRM alias governance; semantic reads consume approved aliases
router.post("/crm/aliases/:id/retire", async (req, res) => {
  const me = actor(req, res);
  if (!me) return;
  const row = await retireCrmAlias(me, req.params.id);
  if (!row) { res.status(404).json({ error: "alias-not-found" }); return; }
  res.json({ item: row });
});

export default router;