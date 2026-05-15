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
  const [names, allCoRows] = await Promise.all([
    loadEngagementNames(ids),
    loadChangeOrders(req, ids),
  ]);
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
      getCost(b.engagementId),
      getEtc(b.engagementId),
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
  const budgets = listBudgets();
  const allCoRows = await loadChangeOrders(req);
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
  const budget = getBudget(id);
  const cost = getCost(id);
  const etcRow = getEtc(id);
  if (!budget || !cost || !etcRow) {
    res.status(404).json({ error: "engagement-pnl-not-found" });
    return;
  }
  const [names, coRows] = await Promise.all([
    loadEngagementNames([id]),
    loadChangeOrders(req, [id]),
  ]);
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
    audit: listAudit(id, 50),
  });
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
