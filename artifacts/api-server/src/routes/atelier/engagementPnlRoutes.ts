/**
 * Atelier — Engagement P&L, EAC and Change-Order register routes
 * (Task #414, Wave 2; Task #431).
 *
 * Read endpoints expose the per-engagement P&L (budget vs incurred vs
 * forecast-to-complete), the firm-level Engagement Health register, and
 * the dashboard tile aggregates (EAC variance, projects-at-risk count,
 * open change orders).
 *
 * Change orders are sourced from the real `atelier_change_order` table
 * + `changeOrderRoutes.ts` workflow (draft → partner_approved →
 * client_proposed → client_accepted/rejected → posted). Posting a CO
 * triggers `applyPostedChangeOrder` in the seed module, which
 * re-baselines the engagement budget so EAC/VAC/forecast-margin pick
 * up the new contract value on next read.
 *
 * The only write endpoint left here is the manual ETC override.
 *
 * Persona gate: leadership/finance/senior_manager have full access; other
 * non-restricted personas can read but not write. Recruiter is denied
 * (firm-wide convention — recruiter is /studio-only).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull, inArray, desc } from "drizzle-orm";
import { db, atelierEngagements, atelierChangeOrder } from "@workspace/db";
import { withRls } from "./rls";
import { isLeadership, isFinance } from "./personaRoles";
import {
  getBudget,
  getCost,
  getEtc,
  listAudit,
  listBudgets,
  listCosts,
  listEtcs,
  personName,
  setEtc,
  type ChangeOrder,
  type EngagementBudget,
} from "../../data/atelier-engagement-pnl-seed.js";
import {
  computeEac,
  summariseChangeOrders,
  type EngagementHealthRow,
} from "../../lib/atelier-eac-engine.js";
import {
  recomputeAllEngagementCostsToDate,
  recomputeEngagementCostToDate,
} from "../../lib/atelier-engagement-pnl-recompute.js";

const router: IRouter = Router();

function ensurePersona(req: Request, res: Response) {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (me.role === "recruiter") {
    res.status(403).json({ error: "recruiter-scope" });
    return null;
  }
  return me;
}

function canWrite(role: string | null | undefined): boolean {
  return (
    role === "founding_partner" ||
    role === "partner" ||
    role === "finance" ||
    role === "senior_manager"
  );
}

function canSeeValueDelta(role: string | null | undefined): boolean {
  return isLeadership(role) || isFinance(role);
}

async function loadEngagementNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: atelierEngagements.id, name: atelierEngagements.name })
    .from(atelierEngagements)
    .where(and(inArray(atelierEngagements.id, ids), isNull(atelierEngagements.deletedAt)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

type ChangeOrderRow = typeof atelierChangeOrder.$inferSelect;

/**
 * Project a DB row down to the slim shape the EAC engine + per-engagement
 * payload need. value_delta_usd is masked to null for personas that
 * aren't allowed to see it (mirrors `changeOrderRoutes` masking).
 */
function projectChangeOrder(
  row: ChangeOrderRow,
  role: string | null | undefined,
): ChangeOrder & {
  kind: string;
  summary: string;
  rationaleText: string;
  proposedByUserId: string | null;
  partnerApproverUserId: string | null;
  clientSignerName: string | null;
  clientSignerEmail: string | null;
  clientProposedAt: string | null;
  clientResolvedAt: string | null;
  postedAt: string | null;
  evidenceUrl: string | null;
  createdAt: string;
} {
  return {
    id: row.id,
    engagementId: row.engagementId,
    status: row.status as ChangeOrder["status"],
    valueDeltaUsd: canSeeValueDelta(role) ? Number(row.valueDeltaUsd ?? 0) : null,
    labourHoursDelta: canSeeValueDelta(role) ? Number(row.labourHoursDelta ?? 0) : null,
    labourCostDeltaUsd: canSeeValueDelta(role) ? Number(row.labourCostDeltaUsd ?? 0) : null,
    expensesDeltaUsd: canSeeValueDelta(role) ? Number(row.expensesDeltaUsd ?? 0) : null,
    subsDeltaUsd: canSeeValueDelta(role) ? Number(row.subsDeltaUsd ?? 0) : null,
    kind: row.kind,
    summary: row.summary,
    rationaleText: row.rationaleText,
    proposedByUserId: row.proposedByUserId,
    partnerApproverUserId: row.partnerApproverUserId,
    clientSignerName: row.clientSignerName ?? null,
    clientSignerEmail: row.clientSignerEmail ?? null,
    clientProposedAt: row.clientProposedAt ? row.clientProposedAt.toISOString() : null,
    clientResolvedAt: row.clientResolvedAt ? row.clientResolvedAt.toISOString() : null,
    postedAt: row.postedAt ? row.postedAt.toISOString() : null,
    evidenceUrl: row.evidenceUrl ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : "",
  };
}

async function loadChangeOrders(
  req: Request,
  engagementIds?: string[],
): Promise<ChangeOrderRow[]> {
  return withRls(req, async (tx) => {
    const conds = [isNull(atelierChangeOrder.deletedAt)];
    if (engagementIds && engagementIds.length > 0) {
      conds.push(inArray(atelierChangeOrder.engagementId, engagementIds));
    }
    return tx
      .select()
      .from(atelierChangeOrder)
      .where(and(...conds))
      .orderBy(desc(atelierChangeOrder.createdAt))
      .limit(500);
  });
}

function buildHealthRow(
  budget: EngagementBudget,
  cost: Awaited<ReturnType<typeof getCost>>,
  etcRow: Awaited<ReturnType<typeof getEtc>>,
  changeOrders: ChangeOrder[],
  engagementName: string,
): EngagementHealthRow | null {
  if (!cost || !etcRow) return null;
  const eac = computeEac({ budget, cost, etc: etcRow });
  const co = summariseChangeOrders(changeOrders);
  const wip = cost.revenueRecognisedToDateUsd - cost.invoicedToDateUsd;
  const ar = cost.invoicedToDateUsd - cost.cashCollectedToDateUsd;
  const grossMarginToDate =
    cost.revenueRecognisedToDateUsd > 0
      ? (cost.revenueRecognisedToDateUsd - cost.costToDateUsd) /
        cost.revenueRecognisedToDateUsd
      : 0;
  return {
    ...eac,
    engagementName,
    partnerOwnerId: budget.partnerOwnerId,
    partnerOwnerName: personName(budget.partnerOwnerId),
    engagementLeadId: budget.engagementLeadId,
    engagementLeadName: personName(budget.engagementLeadId),
    sector: budget.sector,
    openChangeOrders: co.open,
    approvedChangeOrders: co.approved,
    changeOrderValueUsd: co.approvedValueUsd,
    revenueRecognisedToDateUsd: cost.revenueRecognisedToDateUsd,
    invoicedToDateUsd: cost.invoicedToDateUsd,
    cashCollectedToDateUsd: cost.cashCollectedToDateUsd,
    grossMarginToDatePct: grossMarginToDate,
    wipUsd: wip,
    arUsd: ar,
    lockupUsd: wip + ar,
  };
}

// ---------------------------------------------------------------
// Firm-level Engagement Health register
// GET /finance/engagement-pnl
// ---------------------------------------------------------------
router.get("/finance/engagement-pnl", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  await recomputeAllEngagementCostsToDate({ actorUserId: me.id });
  const budgets = await listBudgets();
  const ids = budgets.map((b) => b.engagementId);
  const [names, allCoRows, allCosts, allEtcs] = await Promise.all([
    loadEngagementNames(ids),
    loadChangeOrders(req, ids),
    listCosts(),
    listEtcs(),
  ]);
  const costByEng = new Map(allCosts.map((c) => [c.engagementId, c]));
  const etcByEng = new Map(allEtcs.map((e) => [e.engagementId, e]));
  const cosByEng = new Map<string, ChangeOrder[]>();
  for (const row of allCoRows) {
    const slim = projectChangeOrder(row, me.role);
    const arr = cosByEng.get(row.engagementId) ?? [];
    arr.push(slim);
    cosByEng.set(row.engagementId, arr);
  }
  const rows: EngagementHealthRow[] = [];
  for (const b of budgets) {
    const row = buildHealthRow(
      b,
      costByEng.get(b.engagementId) ?? null,
      etcByEng.get(b.engagementId) ?? null,
      cosByEng.get(b.engagementId) ?? [],
      names.get(b.engagementId) ?? b.engagementId,
    );
    if (row) rows.push(row);
  }
  // Default sort: combine EAC variance + forecast-margin slippage so the
  // most-distressed engagements rise to the top regardless of which
  // dimension is driving the pain.
  rows.sort((a, b) => {
    const score = (r: EngagementHealthRow) =>
      r.vacPctOfBac + r.marginSlippagePct;
    return score(a) - score(b);
  });
  res.json({ items: rows });
});

// ---------------------------------------------------------------
// Dashboard-tile aggregates (Wave-1 placeholders go live)
// GET /finance/engagement-pnl/summary
// ---------------------------------------------------------------
router.get("/finance/engagement-pnl/summary", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  await recomputeAllEngagementCostsToDate({ actorUserId: me.id });
  const [budgets, allCosts, allEtcs, allCoRows] = await Promise.all([
    listBudgets(),
    listCosts(),
    listEtcs(),
    loadChangeOrders(req),
  ]);
  const costByEng = new Map(allCosts.map((c) => [c.engagementId, c]));
  const etcByEng = new Map(allEtcs.map((e) => [e.engagementId, e]));
  let projectsAtRisk = 0;
  let totalVacUsd = 0;
  let weightedForecastMarginNum = 0;
  let weightedForecastMarginDen = 0;
  for (const b of budgets) {
    const cost = costByEng.get(b.engagementId) ?? null;
    const etcRow = etcByEng.get(b.engagementId) ?? null;
    if (!cost || !etcRow) continue;
    const eac = computeEac({ budget: b, cost, etc: etcRow });
    if (eac.ragStatus !== "green") projectsAtRisk += 1;
    totalVacUsd += eac.vacUsd;
    weightedForecastMarginNum += eac.forecastFinalMarginPct * eac.contractValueUsd;
    weightedForecastMarginDen += eac.contractValueUsd;
  }
  const openChangeOrders = allCoRows.filter(
    (c) =>
      c.status === "draft" ||
      c.status === "partner_approved" ||
      c.status === "client_proposed",
  ).length;
  res.json({
    summary: {
      totalEngagements: budgets.length,
      projectsAtRisk,
      openChangeOrders,
      totalVacUsd,
      weightedForecastMarginPct:
        weightedForecastMarginDen > 0
          ? weightedForecastMarginNum / weightedForecastMarginDen
          : 0,
    },
  });
});

// ---------------------------------------------------------------
// Per-engagement P&L
// GET /finance/engagement-pnl/:engagementId
// ---------------------------------------------------------------
router.get("/finance/engagement-pnl/:engagementId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const id = req.params.engagementId;
  await recomputeEngagementCostToDate(id, { actorUserId: me.id });
  const [budget, cost, etcRow, coRows, audit, names] = await Promise.all([
    getBudget(id),
    getCost(id),
    getEtc(id),
    loadChangeOrders(req, [id]),
    listAudit(id, 50),
    loadEngagementNames([id]),
  ]);
  if (!budget || !cost || !etcRow) {
    res.status(404).json({ error: "engagement-pnl-not-found" });
    return;
  }
  const eac = computeEac({ budget, cost, etc: etcRow });
  const wip = cost.revenueRecognisedToDateUsd - cost.invoicedToDateUsd;
  const ar = cost.invoicedToDateUsd - cost.cashCollectedToDateUsd;
  const grossMarginToDatePct =
    cost.revenueRecognisedToDateUsd > 0
      ? (cost.revenueRecognisedToDateUsd - cost.costToDateUsd) /
        cost.revenueRecognisedToDateUsd
      : 0;
  res.json({
    engagementId: id,
    engagementName: names.get(id) ?? id,
    budget,
    cost,
    etc: etcRow,
    eac,
    derived: {
      grossMarginToDatePct,
      wipUsd: wip,
      arUsd: ar,
      lockupUsd: wip + ar,
    },
    people: {
      partnerOwnerId: budget.partnerOwnerId,
      partnerOwnerName: personName(budget.partnerOwnerId),
      engagementLeadId: budget.engagementLeadId,
      engagementLeadName: personName(budget.engagementLeadId),
    },
    changeOrders: coRows.map((r) => projectChangeOrder(r, me.role)),
    audit,
  });
});

// ---------------------------------------------------------------
// Per-engagement change-order audit timeline
// GET /finance/engagement-pnl/:engagementId/audit
// Returns audit rows newest-first with actor display names resolved.
// Read-gate matches the per-engagement P&L (recruiter denied).
// ---------------------------------------------------------------
router.get("/finance/engagement-pnl/:engagementId/audit", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const id = req.params.engagementId;
  const limitRaw = Number(req.query.limit);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500
      ? Math.floor(limitRaw)
      : 100;
  const audit = await listAudit(id, limit);
  // listAudit already orders by atIso desc, but be defensive in case
  // callers ever reuse this with a different source.
  const items = audit
    .slice()
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((a) => ({
      ...a,
      actorName: personName(a.actorUserId),
    }));
  res.json({ engagementId: id, items });
});

// ---------------------------------------------------------------
// ETC override
// ---------------------------------------------------------------
router.post("/finance/engagement-pnl/:engagementId/etc", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWrite(me.role)) {
    res.status(403).json({ error: "etc-write-denied" });
    return;
  }
  const id = req.params.engagementId;
  const body = req.body ?? {};
  const method = body.method === "extrapolation" ? "extrapolation" : "manual";
  const manualEtcUsd = method === "manual" ? Number(body.manualEtcUsd ?? 0) : null;
  if (method === "manual" && !Number.isFinite(manualEtcUsd ?? NaN)) {
    res.status(400).json({ error: "manualEtcUsd-must-be-finite" });
    return;
  }
  const rationale = String(body.rationale ?? "").trim();
  const updated = await setEtc({
    engagementId: id,
    method,
    manualEtcUsd,
    rationale,
    actorUserId: me.id,
  });
  if (!updated) {
    res.status(404).json({ error: "engagement-etc-not-found" });
    return;
  }
  const [budget, cost] = await Promise.all([getBudget(id), getCost(id)]);
  const eac = budget && cost ? computeEac({ budget, cost, etc: updated }) : null;
  res.json({ etc: updated, eac });
});

// ---------------------------------------------------------------
// On-demand recompute of cost-to-date from live timesheet/expense data
// POST /finance/engagement-pnl/recompute
// POST /finance/engagement-pnl/:engagementId/recompute
// ---------------------------------------------------------------
router.post("/finance/engagement-pnl/recompute", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWrite(me.role)) {
    res.status(403).json({ error: "recompute-denied" });
    return;
  }
  const results = await recomputeAllEngagementCostsToDate({ actorUserId: me.id });
  res.json({ results });
});

router.post("/finance/engagement-pnl/:engagementId/recompute", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWrite(me.role)) {
    res.status(403).json({ error: "recompute-denied" });
    return;
  }
  const result = await recomputeEngagementCostToDate(req.params.engagementId, {
    actorUserId: me.id,
  });
  if (result.status === "engagement_unknown" || result.status === "no_cost_row") {
    res.status(404).json({ error: result.status, result });
    return;
  }
  res.json({ result });
});

// ---------------------------------------------------------------
// Debug-friendly listings
// ---------------------------------------------------------------
router.get("/finance/engagement-pnl-debug/budgets", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [items, costs, etcs] = await Promise.all([listBudgets(), listCosts(), listEtcs()]);
  res.json({ items, costs, etcs });
});

export default router;
