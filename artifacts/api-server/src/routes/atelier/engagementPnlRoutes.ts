/**
 * Atelier — Engagement P&L, EAC and Change-Order register routes
 * (Task #414, Wave 2).
 *
 * Read endpoints expose the per-engagement P&L (budget vs incurred vs
 * forecast-to-complete), the firm-level Engagement Health register, and
 * the dashboard tile aggregates (EAC variance, projects-at-risk count,
 * open change orders). Write endpoints implement a mock change-order
 * workflow (submit / approve / reject) and a manual ETC override; both
 * re-baseline the in-memory seed and append an audit-trail entry.
 *
 * Persona gate: leadership/finance/senior_manager have full access; other
 * non-restricted personas can read but not write. Recruiter is denied
 * (firm-wide convention — recruiter is /studio-only).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { db, atelierEngagements } from "@workspace/db";
import {
  approveChangeOrder,
  createChangeOrder,
  getBudget,
  getChangeOrder,
  getCost,
  getEtc,
  listAudit,
  listBudgets,
  listChangeOrders,
  listCosts,
  listEtcs,
  personName,
  rejectChangeOrder,
  setEtc,
  submitChangeOrder,
  type ChangeOrder,
  type EngagementBudget,
} from "../../data/atelier-engagement-pnl-seed.js";
import {
  computeEac,
  summariseChangeOrders,
  type EngagementHealthRow,
} from "../../lib/atelier-eac-engine.js";

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

async function loadEngagementNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: atelierEngagements.id, name: atelierEngagements.name })
    .from(atelierEngagements)
    .where(and(inArray(atelierEngagements.id, ids), isNull(atelierEngagements.deletedAt)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

function buildHealthRow(
  budget: EngagementBudget,
  cost: ReturnType<typeof getCost>,
  etcRow: ReturnType<typeof getEtc>,
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
  const budgets = listBudgets();
  const ids = budgets.map((b) => b.engagementId);
  const names = await loadEngagementNames(ids);
  const rows: EngagementHealthRow[] = [];
  for (const b of budgets) {
    const row = buildHealthRow(
      b,
      getCost(b.engagementId),
      getEtc(b.engagementId),
      listChangeOrders(b.engagementId),
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
  const budgets = listBudgets();
  const allChangeOrders = listChangeOrders();
  let projectsAtRisk = 0;
  let totalVacUsd = 0;
  let weightedForecastMarginNum = 0;
  let weightedForecastMarginDen = 0;
  for (const b of budgets) {
    const cost = getCost(b.engagementId);
    const etcRow = getEtc(b.engagementId);
    if (!cost || !etcRow) continue;
    const eac = computeEac({ budget: b, cost, etc: etcRow });
    if (eac.ragStatus !== "green") projectsAtRisk += 1;
    totalVacUsd += eac.vacUsd;
    weightedForecastMarginNum += eac.forecastFinalMarginPct * eac.contractValueUsd;
    weightedForecastMarginDen += eac.contractValueUsd;
  }
  const openChangeOrders = allChangeOrders.filter(
    (c) => c.status === "draft" || c.status === "submitted",
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
  const budget = getBudget(id);
  const cost = getCost(id);
  const etcRow = getEtc(id);
  if (!budget || !cost || !etcRow) {
    res.status(404).json({ error: "engagement-pnl-not-found" });
    return;
  }
  const names = await loadEngagementNames([id]);
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
    changeOrders: listChangeOrders(id),
    audit: listAudit(id, 50),
  });
});

// ---------------------------------------------------------------
// Change-order CRUD-ish (mock workflow)
// ---------------------------------------------------------------
router.post("/finance/engagement-pnl/:engagementId/change-orders", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canWrite(me.role)) {
    res.status(403).json({ error: "change-order-write-denied" });
    return;
  }
  const id = req.params.engagementId;
  if (!getBudget(id)) {
    res.status(404).json({ error: "engagement-not-found" });
    return;
  }
  const body = req.body ?? {};
  const description = String(body.description ?? "").trim();
  if (!description) {
    res.status(400).json({ error: "description-required" });
    return;
  }
  const valueUsd = Number(body.valueUsd ?? 0);
  const hoursImpact = Number(body.hoursImpact ?? 0);
  const costImpactUsd = Number(body.costImpactUsd ?? 0);
  if (![valueUsd, hoursImpact, costImpactUsd].every((n) => Number.isFinite(n))) {
    res.status(400).json({ error: "numeric-fields-must-be-finite" });
    return;
  }
  const co = createChangeOrder({
    engagementId: id,
    description,
    valueUsd,
    hoursImpact,
    costImpactUsd,
    raisedByUserId: me.id,
  });
  res.status(201).json({ changeOrder: co });
});

router.post(
  "/finance/engagement-pnl/change-orders/:id/submit",
  (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canWrite(me.role)) {
      res.status(403).json({ error: "change-order-write-denied" });
      return;
    }
    const co = submitChangeOrder(req.params.id, me.id);
    if (!co) {
      res.status(409).json({ error: "invalid-state-transition" });
      return;
    }
    res.json({ changeOrder: co });
  },
);

router.post(
  "/finance/engagement-pnl/change-orders/:id/approve",
  (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (me.role !== "founding_partner" && me.role !== "partner" && me.role !== "finance") {
      res.status(403).json({ error: "approval-requires-leadership-or-finance" });
      return;
    }
    const result = approveChangeOrder(req.params.id, me.id);
    if (!result) {
      res.status(409).json({ error: "invalid-state-transition" });
      return;
    }
    const cost = getCost(result.changeOrder.engagementId);
    const etcRow = getEtc(result.changeOrder.engagementId);
    const eac =
      cost && etcRow
        ? computeEac({ budget: result.budget, cost, etc: etcRow })
        : null;
    res.json({ changeOrder: result.changeOrder, budget: result.budget, eac });
  },
);

router.post(
  "/finance/engagement-pnl/change-orders/:id/reject",
  (req, res) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (me.role !== "founding_partner" && me.role !== "partner" && me.role !== "finance") {
      res.status(403).json({ error: "rejection-requires-leadership-or-finance" });
      return;
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) {
      res.status(400).json({ error: "reason-required" });
      return;
    }
    const co = rejectChangeOrder(req.params.id, me.id, reason);
    if (!co) {
      res.status(409).json({ error: "invalid-state-transition" });
      return;
    }
    res.json({ changeOrder: co });
  },
);

router.get("/finance/engagement-pnl/change-orders/:id", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const co = getChangeOrder(req.params.id);
  if (!co) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  res.json({ changeOrder: co });
});

// ---------------------------------------------------------------
// ETC override
// ---------------------------------------------------------------
router.post("/finance/engagement-pnl/:engagementId/etc", (req, res) => {
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
  const updated = setEtc({
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
  const budget = getBudget(id);
  const cost = getCost(id);
  const eac = budget && cost ? computeEac({ budget, cost, etc: updated }) : null;
  res.json({ etc: updated, eac });
});

// ---------------------------------------------------------------
// Debug-friendly listings
// ---------------------------------------------------------------
router.get("/finance/engagement-pnl-debug/budgets", (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  res.json({ items: listBudgets(), costs: listCosts(), etcs: listEtcs() });
});

export default router;
