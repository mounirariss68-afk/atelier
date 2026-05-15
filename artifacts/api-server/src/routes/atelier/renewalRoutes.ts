/**
 * Task #363 — L2C Wave 4 renewal motion routes.
 *
 *   GET    /crm/renewals                                list renewals (scoped)
 *   POST   /crm/renewals                                open renewal
 *   POST   /crm/renewals/:id/risk                       update risk tier + ARR projections
 *   POST   /crm/renewals/:id/link-opportunity           pair with renewal opp
 *   POST   /crm/renewals/:id/won                        close won (signed renewal)
 *   POST   /crm/renewals/:id/lost                       close lost (with reason)
 *   POST   /crm/renewals/auto-open                      Renewal Watchdog T-90d sweep
 *
 * Restricted personas denied. board_observer reads firm-wide list (rollup),
 * blocked from per-renewal detail / writes.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierRenewal,
  atelierContract,
  atelierEngagements,
  atelierAuditEvents,
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { accessibleEngagementIds } from "./engagementRoutes.js";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function ensure(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) { res.status(401).json({ error: "no-active-persona" }); return null; }
  return req.atelierPersona;
}
function denyRestricted(req: Request, res: Response): boolean {
  const me = req.atelierPersona;
  if (!me) { res.status(401).json({ error: "no-active-persona" }); return true; }
  if (isRestrictedPersona(me.role)) {
    res.status(403).json({ error: "forbidden", message: "Renewals are denied for this persona." });
    return true;
  }
  return false;
}
function isPartnerTier(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "founding_partner" || me.role === "partner";
}
async function audit(args: {
  entityId: string; actor: typeof atelierUsers.$inferSelect;
  action: string; payload: Record<string, unknown>; summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), entityType: "renewal", entityId: args.entityId,
    actorType: "human", actorId: args.actor.id, actorLabel: args.actor.name,
    action: args.action, payload: args.payload, payloadSummary: args.summary,
  });
}

// ─────────────────────── list ───────────────────────
router.get("/", async (req, res) => {
  if (denyRestricted(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  const status = (req.query.status as string | undefined) ?? null;
  const where = [eq(atelierRenewal.orgId, me.orgId), isNull(atelierRenewal.deletedAt)];
  if (status) where.push(eq(atelierRenewal.status, status));
  const rows = await db.select().from(atelierRenewal).where(and(...where))
    .orderBy(desc(atelierRenewal.renewalDueAt)).limit(200);
  // board_observer sees rollup only — strip rationale + counterparty linkage.
  const includeDetail = !isBoardObserver(me.role);
  const out = includeDetail ? rows : rows.map((r) => ({
    id: r.id, accountId: r.accountId, status: r.status, riskTier: r.riskTier,
    currentArrUsd: r.currentArrUsd, proposedArrUsd: r.proposedArrUsd, nrrDeltaPct: r.nrrDeltaPct,
    renewalDueAt: r.renewalDueAt,
  }));
  return res.json({ ok: true, data: { rows: out } });
});

router.post("/", async (req, res) => {
  if (denyRestricted(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (isBoardObserver(me.role)) return res.status(403).json({ error: "forbidden" });
  const b = req.body as {
    engagementId?: string; contractId?: string; accountId?: string;
    currentArrUsd?: number; proposedArrUsd?: number; expansionTargetUsd?: number;
    renewalDueAt?: string; partnerOwnerId?: string; riskTier?: "green" | "amber" | "red";
  };
  if (!b.accountId && !b.contractId && !b.engagementId)
    return res.status(400).json({ error: "invalid_input", message: "Need accountId / contractId / engagementId." });
  const id = rid("ren");
  const cur = b.currentArrUsd ?? 0;
  const proposed = b.proposedArrUsd ?? cur;
  const nrr = cur > 0 ? Math.round(((proposed - cur) / cur) * 1000) / 10 : 0;
  await db.insert(atelierRenewal).values({
    id, orgId: me.orgId, engagementId: b.engagementId ?? null,
    contractId: b.contractId ?? null, accountId: b.accountId ?? null,
    currentArrUsd: cur, proposedArrUsd: proposed, expansionTargetUsd: b.expansionTargetUsd ?? 0,
    nrrDeltaPct: nrr, renewalDueAt: b.renewalDueAt ?? null,
    riskTier: b.riskTier ?? "green", partnerOwnerId: b.partnerOwnerId ?? me.id,
    status: "open", createdByUserId: me.id,
  });
  await audit({ entityId: id, actor: me, action: "renewal.open",
    payload: { accountId: b.accountId, currentArrUsd: cur, nrrDeltaPct: nrr },
    summary: `Opened renewal ARR $${cur} → $${proposed} (${nrr >= 0 ? "+" : ""}${nrr}% NRR)` });
  return res.json({ ok: true, data: { id } });
});

router.post("/:id/risk", async (req, res) => {
  if (denyRestricted(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (isBoardObserver(me.role)) return res.status(403).json({ error: "forbidden" });
  const id = req.params.id;
  const b = req.body as { riskTier?: "green" | "amber" | "red"; proposedArrUsd?: number; expansionTargetUsd?: number; rationale?: string };
  const [r] = await db.select().from(atelierRenewal)
    .where(and(eq(atelierRenewal.id, id), eq(atelierRenewal.orgId, me.orgId)));
  if (!r) return res.status(404).json({ error: "not_found" });
  const proposed = b.proposedArrUsd ?? r.proposedArrUsd;
  const nrr = r.currentArrUsd > 0 ? Math.round(((proposed - r.currentArrUsd) / r.currentArrUsd) * 1000) / 10 : 0;
  await db.update(atelierRenewal).set({
    riskTier: b.riskTier ?? r.riskTier, proposedArrUsd: proposed,
    expansionTargetUsd: b.expansionTargetUsd ?? r.expansionTargetUsd,
    nrrDeltaPct: nrr, rationaleText: b.rationale ?? r.rationaleText, updatedAt: new Date(),
  }).where(eq(atelierRenewal.id, id));
  await audit({ entityId: id, actor: me, action: "renewal.risk_update",
    payload: { riskTier: b.riskTier, proposedArrUsd: proposed, nrr },
    summary: `Renewal risk → ${b.riskTier ?? r.riskTier}; NRR ${nrr}%` });
  return res.json({ ok: true, data: { id, nrrDeltaPct: nrr } });
});

router.post("/:id/link-opportunity", async (req, res) => {
  if (denyRestricted(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (isBoardObserver(me.role)) return res.status(403).json({ error: "forbidden" });
  const id = req.params.id;
  const b = req.body as { opportunityId?: string };
  if (!b.opportunityId) return res.status(400).json({ error: "invalid_input" });
  const [r] = await db.select().from(atelierRenewal)
    .where(and(eq(atelierRenewal.id, id), eq(atelierRenewal.orgId, me.orgId)));
  if (!r) return res.status(404).json({ error: "not_found" });
  await db.update(atelierRenewal).set({ opportunityId: b.opportunityId, updatedAt: new Date() })
    .where(eq(atelierRenewal.id, id));
  await audit({ entityId: id, actor: me, action: "renewal.link_opportunity",
    payload: { opportunityId: b.opportunityId }, summary: `Linked renewal to opp ${b.opportunityId}` });
  return res.json({ ok: true });
});

router.post("/:id/won", async (req, res) => {
  if (denyRestricted(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isPartnerTier(me)) return res.status(403).json({ error: "forbidden", message: "partner-tier only" });
  const id = req.params.id;
  const b = req.body as { rationale?: string };
  const [r] = await db.select().from(atelierRenewal)
    .where(and(eq(atelierRenewal.id, id), eq(atelierRenewal.orgId, me.orgId)));
  if (!r) return res.status(404).json({ error: "not_found" });
  if (r.status !== "open") return res.status(409).json({ error: "already_closed" });
  await db.update(atelierRenewal).set({
    status: "won", closedAt: new Date(), closedByUserId: me.id,
    rationaleText: b.rationale ?? r.rationaleText, updatedAt: new Date(),
  }).where(eq(atelierRenewal.id, id));
  await audit({ entityId: id, actor: me, action: "renewal.close_won",
    payload: { proposedArrUsd: r.proposedArrUsd }, summary: `Renewal won @ $${r.proposedArrUsd}` });
  return res.json({ ok: true });
});

router.post("/:id/lost", async (req, res) => {
  if (denyRestricted(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isPartnerTier(me)) return res.status(403).json({ error: "forbidden", message: "partner-tier only" });
  const id = req.params.id;
  const b = req.body as { lostReason?: string; rationale?: string };
  if (!b.lostReason) return res.status(400).json({ error: "invalid_input", message: "lostReason required." });
  const [r] = await db.select().from(atelierRenewal)
    .where(and(eq(atelierRenewal.id, id), eq(atelierRenewal.orgId, me.orgId)));
  if (!r) return res.status(404).json({ error: "not_found" });
  if (r.status !== "open") return res.status(409).json({ error: "already_closed" });
  await db.update(atelierRenewal).set({
    status: "lost", closedAt: new Date(), closedByUserId: me.id,
    lostReason: b.lostReason, rationaleText: b.rationale ?? r.rationaleText, updatedAt: new Date(),
  }).where(eq(atelierRenewal.id, id));
  await audit({ entityId: id, actor: me, action: "renewal.close_lost",
    payload: { lostReason: b.lostReason }, summary: `Renewal lost: ${b.lostReason}` });
  return res.json({ ok: true });
});

// ─────────── auto-open T-90 sweep (Renewal Watchdog hook) ───────────
router.post("/auto-open", async (req, res) => {
  if (denyRestricted(req, res)) return;
  const me = ensure(req, res); if (!me) return;
  if (!isPartnerTier(me) && me.role !== "finance") return res.status(403).json({ error: "forbidden" });
  const horizonDays = Number((req.body as { horizonDays?: number })?.horizonDays ?? 90);
  const cutoffIso = new Date(Date.now() + horizonDays * 86400_000).toISOString().slice(0, 10);
  // Find active contracts with termEnd within window & no open renewal yet.
  const contracts = await db.select().from(atelierContract).where(and(
    eq(atelierContract.orgId, me.orgId),
    isNull(atelierContract.deletedAt),
    sql`${atelierContract.termEnd} IS NOT NULL`,
    sql`${atelierContract.termEnd} <= ${cutoffIso}`,
    sql`${atelierContract.status} IN ('active','expiring')`,
  ));
  const opened: string[] = [];
  for (const c of contracts) {
    const [existing] = await db.select({ id: atelierRenewal.id }).from(atelierRenewal)
      .where(and(eq(atelierRenewal.contractId, c.id), eq(atelierRenewal.status, "open")));
    if (existing) continue;
    const id = rid("ren");
    await db.insert(atelierRenewal).values({
      id, orgId: me.orgId, contractId: c.id, engagementId: c.engagementId ?? null,
      accountId: c.counterpartyId, currentArrUsd: c.contractValueUsd,
      proposedArrUsd: c.contractValueUsd, renewalDueAt: c.termEnd,
      riskTier: "amber", status: "open", autoOpenedAt: new Date(),
      partnerOwnerId: me.id, createdByUserId: me.id,
      rationaleText: `Auto-opened T-${horizonDays}d by Renewal Watchdog.`,
    });
    opened.push(id);
    await audit({ entityId: id, actor: me, action: "renewal.auto_open",
      payload: { contractId: c.id, termEnd: c.termEnd },
      summary: `Auto-opened renewal for contract ${c.title}` });
  }
  return res.json({ ok: true, data: { opened, count: opened.length, horizonDays } });
});

export default router;
