/**
 * Atelier — margin / realization reporting suite routes (Task #434).
 *
 * Surfaces:
 *   GET  /margin-reports/clients            — account-level margin rollups
 *                                             (periodFrom/periodTo/entityId/partnerId)
 *   GET  /margin-reports/net                — net-margin view with GL overhead
 *                                             allocation (basis visible, ties to GL)
 *   GET  /margin-reports/allocation-config  — current allocation config
 *   PUT  /margin-reports/allocation-config  — set basis / overhead account codes
 *   GET  /margin-reports/realization        — sold vs delivered + leakage decomposition
 *   GET  /margin-reports/sold-positions     — immutable sold-position snapshots
 *   POST /margin-reports/sold-positions/backfill — capture for contract opps missing one
 *   POST /margin-reports/sentinel/run       — run Margin Sentinel now (force)
 *
 * Persona gating mirrors revrecRoutes: restricted personas and board
 * observers are denied reads; allocation-config writes and backfill
 * require finance or leadership.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, atelierSoldPositionSnapshot } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  isLeadership,
  isFinance,
  isRestrictedPersona,
  isBoardObserver,
} from "./personaRoles";
import {
  computeClientMarginRollups,
  computeOverheadAllocation,
  computeRealizationReport,
  getAllocationConfig,
  setAllocationConfig,
  backfillSoldPositions,
} from "../../lib/atelier-margin-reporting.js";
import { runMarginSentinelTick } from "../../lib/atelier-agents/marginSentinel.js";

const router: IRouter = Router();

function ensurePersona(req: Request, res: Response) {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}
function canRead(role: string | null | undefined): boolean {
  return !!role && !isRestrictedPersona(role) && !isBoardObserver(role);
}
function canWriteFinance(role: string | null | undefined): boolean {
  return isFinance(role) || isLeadership(role);
}

const PERIOD_RE = /^\d{4}-\d{2}$/;
function periodParam(v: unknown): string | null {
  return typeof v === "string" && PERIOD_RE.test(v) ? v : null;
}
function strParam(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// @cli-skip: finance reporting read; pending CLI read-parity design
router.get("/margin-reports/clients", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canRead(me.role)) { res.status(403).json({ error: "forbidden" }); return; }
    const out = await computeClientMarginRollups({
      orgId: me.orgId,
      periodFrom: periodParam(req.query.periodFrom),
      periodTo: periodParam(req.query.periodTo),
      entityId: strParam(req.query.entityId),
      partnerId: strParam(req.query.partnerId),
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: finance reporting read; pending CLI read-parity design
router.get("/margin-reports/net", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canRead(me.role)) { res.status(403).json({ error: "forbidden" }); return; }
    const basisRaw = strParam(req.query.basis);
    const basisOverride =
      basisRaw === "revenue" || basisRaw === "direct_cost" || basisRaw === "hours" ? basisRaw : null;
    const out = await computeOverheadAllocation({
      periodFrom: periodParam(req.query.periodFrom),
      periodTo: periodParam(req.query.periodTo),
      basisOverride,
      orgId: me.orgId,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: finance reporting read; pending CLI read-parity design
router.get("/margin-reports/allocation-config", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canRead(me.role)) { res.status(403).json({ error: "forbidden" }); return; }
    res.json(await getAllocationConfig(me.orgId));
  } catch (err) {
    next(err);
  }
});

const AllocationConfigSchema = z.object({
  basis: z.enum(["revenue", "direct_cost", "hours"]),
  glAccountCodes: z.array(z.string().min(1)).max(100).default([]),
  notes: z.string().max(2000).default(""),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.put("/margin-reports/allocation-config", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canWriteFinance(me.role)) { res.status(403).json({ error: "finance-or-leadership-only" }); return; }
    const parsed = AllocationConfigSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid-body", details: parsed.error.flatten() });
      return;
    }
    const cfg = await setAllocationConfig(me.orgId, parsed.data, { id: me.id, name: me.name });
    res.json(cfg);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: finance reporting read; pending CLI read-parity design
router.get("/margin-reports/realization", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canRead(me.role)) { res.status(403).json({ error: "forbidden" }); return; }
    const out = await computeRealizationReport({
      orgId: me.orgId,
      periodFrom: periodParam(req.query.periodFrom),
      periodTo: periodParam(req.query.periodTo),
      partnerId: strParam(req.query.partnerId),
      engagementId: strParam(req.query.engagementId),
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: finance reporting read; pending CLI read-parity design
router.get("/margin-reports/sold-positions", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canRead(me.role)) { res.status(403).json({ error: "forbidden" }); return; }
    const rows = await db
      .select()
      .from(atelierSoldPositionSnapshot)
      .where(and(eq(atelierSoldPositionSnapshot.orgId, me.orgId), isNull(atelierSoldPositionSnapshot.deletedAt)));
    rows.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/margin-reports/sold-positions/backfill", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canWriteFinance(me.role)) { res.status(403).json({ error: "finance-or-leadership-only" }); return; }
    const out = await backfillSoldPositions(me.orgId, { id: me.id, name: me.name });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/margin-reports/sentinel/run", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canWriteFinance(me.role)) { res.status(403).json({ error: "finance-or-leadership-only" }); return; }
    const out = await runMarginSentinelTick({ force: true, orgId: me.orgId });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
