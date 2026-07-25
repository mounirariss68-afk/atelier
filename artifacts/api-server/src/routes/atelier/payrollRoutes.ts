/**
 * Atelier — Statutory payroll routes (Task #655).
 *
 * Payroll runs (compute draft → post to GL), the statutory regime summary
 * per legal entity, the EOSB liability report and leaver settlements, plus
 * the auto-attached statutory filing calendar backfill. All computation
 * lives in lib/atelier-payroll (rules-as-code registry + engine); routes
 * only gate, parse and shape.
 *
 * Gating: finance leadership only (founding_partner | partner | finance |
 * senior_manager) — this is compensation data. Recruiter denied firm-wide.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierPayrollRuns,
  atelierPayrollLines,
  atelierEosbSettlements,
} from "@workspace/db";
import {
  computePayrollRun,
  postPayrollRun,
  eosbLiabilityReport,
  createEosbSettlement,
  settleEosbSettlement,
  ensureStatutoryFilings,
  PayrollError,
} from "../../lib/atelier-payroll/payrollRun.js";
import {
  resolveRules,
  getCountryRules,
  STATUTORY_COUNTRIES,
} from "../../lib/atelier-payroll/statutoryRules.js";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function ensureFinanceLeadership(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  if (!["founding_partner", "partner", "finance", "senior_manager"].includes(me.role)) {
    res.status(403).json({ error: "forbidden", message: "Finance leadership only." });
    return null;
  }
  return me;
}

function fail(res: Response, err: unknown): void {
  if (err instanceof PayrollError) {
    res.status(err.status).json({ error: "payroll", message: err.message });
    return;
  }
  throw err;
}

// @cli-skip: finance payroll overview; REST-only surface (Task #655)
router.get("/finance/payroll/overview", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const entities = await db.select().from(atelierLegalEntities).where(and(
    eq(atelierLegalEntities.orgId, me.orgId),
    eq(atelierLegalEntities.status, "active"),
  ));
  const today = new Date().toISOString().slice(0, 10);
  let filingsCreated = 0;
  const entityCards = [];
  for (const e of entities) {
    // Idempotent filing-calendar backfill for covered countries.
    const ensured = await ensureStatutoryFilings(me.orgId, e);
    filingsCreated += ensured.created;
    const rules = resolveRules(e.country, today);
    entityCards.push({
      id: e.id,
      shortName: e.shortName || e.legalNameEn,
      country: e.country,
      baseCurrency: e.baseCurrency,
      covered: !!rules,
      regime: rules
        ? {
            effectiveFrom: rules.effectiveFrom,
            eosb: rules.eosb,
            contributions: rules.contributions,
            filings: rules.filings,
          }
        : null,
      statutory: e.statutory ?? null,
    });
  }
  const runs = await db.select().from(atelierPayrollRuns)
    .where(and(eq(atelierPayrollRuns.orgId, me.orgId), isNull(atelierPayrollRuns.deletedAt)))
    .orderBy(desc(atelierPayrollRuns.periodLabel), desc(atelierPayrollRuns.createdAt))
    .limit(36);
  res.json({
    countriesCovered: STATUTORY_COUNTRIES,
    entities: entityCards,
    runs,
    filingsCreated,
  });
});

// @cli-skip: finance payroll regime detail; REST-only surface (Task #655)
router.get("/finance/payroll/regime/:country", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const def = getCountryRules(String(req.params.country));
  if (!def) { res.status(404).json({ error: "not-found", message: "no statutory rules for this country" }); return; }
  res.json({ rules: def });
});

const runBody = z.object({
  entityId: z.string().min(1),
  periodLabel: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

// @cli-skip: finance payroll write; UI-workflow only (Task #655)
router.post("/finance/payroll/runs", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const parsed = runBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "invalid body" }); return; }
  try {
    const out = await computePayrollRun({
      orgId: me.orgId,
      entityId: parsed.data.entityId,
      periodLabel: parsed.data.periodLabel,
      createdByUserId: me.id,
    });
    res.status(201).json({ run: out.run, lines: out.lines, covered: !!out.rules });
  } catch (err) { fail(res, err); }
});

// @cli-skip: finance payroll read; REST-only surface (Task #655)
router.get("/finance/payroll/runs/:id", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const [run] = await db.select().from(atelierPayrollRuns).where(and(
    eq(atelierPayrollRuns.orgId, me.orgId),
    eq(atelierPayrollRuns.id, String(req.params.id)),
    isNull(atelierPayrollRuns.deletedAt),
  ));
  if (!run) { res.status(404).json({ error: "not-found" }); return; }
  const lines = await db.select().from(atelierPayrollLines)
    .where(and(eq(atelierPayrollLines.orgId, me.orgId), eq(atelierPayrollLines.runId, run.id)));
  lines.sort((a, b) => a.personName.localeCompare(b.personName));
  res.json({ run, lines });
});

// @cli-skip: finance payroll write; UI-workflow only (Task #655)
router.post("/finance/payroll/runs/:id/post", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  try {
    const out = await postPayrollRun({ orgId: me.orgId, runId: String(req.params.id), postedByUserId: me.id });
    res.json({ run: out.run, alreadyPosted: out.alreadyPosted });
  } catch (err) { fail(res, err); }
});

// @cli-skip: finance payroll read; REST-only surface (Task #655)
router.get("/finance/payroll/eosb/report", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : "";
  try {
    if (entityId) { res.json(await eosbLiabilityReport(me.orgId, entityId)); return; }
    // Consolidated rollup: every active entity in a covered country, with
    // group totals per currency (entities can carry different currencies).
    const entities = await db.select().from(atelierLegalEntities).where(and(
      eq(atelierLegalEntities.orgId, me.orgId),
      eq(atelierLegalEntities.status, "active"),
    ));
    const reports = [];
    for (const ent of entities) {
      if (!resolveRules(ent.country, new Date().toISOString().slice(0, 10))) continue;
      const r = await eosbLiabilityReport(me.orgId, ent.id);
      reports.push({ entityName: ent.legalNameEn, headcount: r.rows.length, ...r });
    }
    const groupTotals: Record<string, { totalLiability: number; totalAccruedInGl: number }> = {};
    for (const r of reports) {
      const g = (groupTotals[r.currency] ??= { totalLiability: 0, totalAccruedInGl: 0 });
      g.totalLiability = Math.round((g.totalLiability + r.totalLiability) * 100) / 100;
      g.totalAccruedInGl = Math.round((g.totalAccruedInGl + r.totalAccruedInGl) * 100) / 100;
    }
    res.json({ consolidated: true, entities: reports, groupTotals });
  } catch (err) { fail(res, err); }
});

// @cli-skip: finance payroll read; REST-only surface (Task #655)
router.get("/finance/payroll/eosb/settlements", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const rows = await db.select().from(atelierEosbSettlements)
    .where(and(eq(atelierEosbSettlements.orgId, me.orgId), isNull(atelierEosbSettlements.deletedAt)))
    .orderBy(desc(atelierEosbSettlements.createdAt))
    .limit(100);
  res.json({ items: rows });
});

const settlementBody = z.object({
  employeeId: z.string().min(1),
  leaveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.enum(["resignation", "termination", "end_of_contract", "retirement", "death", "mutual"]),
});

// @cli-skip: finance payroll write; UI-workflow only (Task #655)
router.post("/finance/payroll/eosb/settlements", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const parsed = settlementBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "invalid body" }); return; }
  try {
    const settlement = await createEosbSettlement({
      orgId: me.orgId,
      employeeId: parsed.data.employeeId,
      leaveDate: parsed.data.leaveDate,
      reason: parsed.data.reason,
      createdByUserId: me.id,
    });
    res.status(201).json({ settlement });
  } catch (err) { fail(res, err); }
});

// @cli-skip: finance payroll write; UI-workflow only (Task #655)
router.post("/finance/payroll/eosb/settlements/:id/settle", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  try {
    const out = await settleEosbSettlement({ orgId: me.orgId, settlementId: String(req.params.id), settledByUserId: me.id });
    res.json({ settlement: out.settlement, alreadySettled: out.alreadySettled });
  } catch (err) { fail(res, err); }
});

export default router;
