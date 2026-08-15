/**
 * Atelier — Payroll routes.
 *
 * Two complementary surfaces live here:
 *
 * Statutory payroll (/finance/payroll/*, Task #655):
 *
 * Payroll runs (compute draft → post to GL), the statutory regime summary
 * per legal entity, the EOSB liability report and leaver settlements, plus
 * the auto-attached statutory filing calendar backfill. All computation
 * lives in lib/atelier-payroll (rules-as-code registry + engine); routes
 * only gate, parse and shape.
 *
 * Gating: finance leadership only (founding_partner | partner | finance |
 * senior_manager) — this is compensation data. Recruiter denied firm-wide.
 *
 * Simple monthly payroll (/payroll/*, Task #654 — per legal entity):
 *
 *   GET    /payroll/runs?entityId&period        list runs
 *   POST   /payroll/runs                        build/refresh a draft run (entity + month)
 *   POST   /payroll/runs/:id/approve            partner approves → salary journal posts (Dr 6000 / Cr 2100)
 *   POST   /payroll/runs/:id/mark-paid          record the cash outflow (Dr 2100 / Cr 1000)
 *   DELETE /payroll/runs/:id                    discard a draft run
 *
 * Reads + writes: finance leadership (founding_partner | partner | finance);
 * approval requires partner tier. All postings reuse the Bookkeeper's
 * (orgId, sourceKind, sourceRef) idempotency and respect the period lock.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql as sqlRaw } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierPayrollRuns,
  atelierPayrollLines,
  atelierEosbSettlements,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierPayrollRun,
  atelierAuditEvents,
  atelierSalaryAdvances,
  atelierAdvanceRepayments,
  atelierCompChanges,
  atelierEmployees,
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import { isGlPeriodLocked } from "../../lib/atelier-agents/bookkeeper.js";
import { buildPayrollLines } from "../../lib/atelier-payroll.js";
import {
  computePayrollRun,
  postPayrollRun,
  eosbLiabilityReport,
  createEosbSettlement,
  settleEosbSettlement,
  ensureStatutoryFilings,
  issueSalaryAdvance,
  payoffSalaryAdvance,
  payrollPeriodLockKey,
  PayrollError,
  type Dbx,
} from "../../lib/atelier-payroll/payrollRun.js";
import {
  resolveRules,
  getCountryRules,
  STATUTORY_COUNTRIES,
} from "../../lib/atelier-payroll/statutoryRules.js";
import { previewWpsSif, exportWpsSif } from "../../lib/atelier-payroll/wpsSifExport.js";
import { runPayrollClerk } from "../../lib/atelier-agents/payrollClerk.js";
import { launchAgentExclusive, AGENT_SINGLETON_TARGET } from "../../lib/atelier-agents/exclusive-runs.js";
import { getLatestJob } from "../../lib/background-jobs.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";

const router: IRouter = Router();

export type Me = typeof atelierUsers.$inferSelect;

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

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

function ensure(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) { res.status(401).json({ error: "no-active-persona" }); return null; }
  return req.atelierPersona;
}
function isPartnerTier(me: Me): boolean {
  return me.role === "founding_partner" || me.role === "partner";
}
function denyRead(req: Request, res: Response): Me | null {
  const me = ensure(req, res); if (!me) return null;
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role) || !(isPartnerTier(me) || me.role === "finance")) {
    res.status(403).json({ error: "forbidden", message: "Payroll is limited to finance leadership." });
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

// @cli-skip: finance payroll export; Wio Bank bulk-payment CSV for net salary wires
router.post("/finance/payroll/runs/:id/export-wio", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  try {
    const [run] = await db.select().from(atelierPayrollRuns).where(and(
      eq(atelierPayrollRuns.orgId, me.orgId),
      eq(atelierPayrollRuns.id, String(req.params.id)),
      isNull(atelierPayrollRuns.deletedAt),
    ));
    if (!run) { res.status(404).json({ error: "not-found" }); return; }
    if (run.status !== "posted") {
      res.status(409).json({ error: "not-posted", message: "Post the payroll run to GL before downloading the Wio salary file." });
      return;
    }
    const lines = await db.select().from(atelierPayrollLines)
      .where(and(eq(atelierPayrollLines.orgId, me.orgId), eq(atelierPayrollLines.runId, run.id)));

    // Look up IBAN for each employee from atelier_employees (sole IBAN write path via HR bank-change approve)
    const employeeIds = [...new Set(lines.map((l) => l.employeeId))];
    const empRows = employeeIds.length
      ? await db.select({ id: atelierEmployees.id, iban: atelierEmployees.iban })
          .from(atelierEmployees)
          .where(and(eq(atelierEmployees.orgId, me.orgId), inArray(atelierEmployees.id, employeeIds)))
      : [];
    const employeeIban = new Map(empRows.map((r) => [r.id, r.iban ?? ""]));

    // Use persisted netPay (= monthlyGross − employeeTotal − advanceDeduction) to match the posted GL amount
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const csvLines = [
      "Beneficiary Name,IBAN,Amount,Currency,Reference,SWIFT Code,Bank Name",
      ...lines
        .sort((a, b) => a.personName.localeCompare(b.personName))
        .map((l) => {
          const iban = employeeIban.get(l.employeeId) ?? "";
          const ref = `Salary ${run.periodLabel} - ${l.personName}`.slice(0, 140);
          return [esc(l.personName), esc(iban), l.netPay.toFixed(2), l.currency, esc(ref), esc(""), esc("")].join(",");
        }),
    ];
    const missingIban = lines.filter((l) => !(employeeIban.get(l.employeeId) ?? "").trim()).map((l) => l.personName);

    // Fetch entity short name for filename
    const [entity] = await db.select({ shortName: atelierLegalEntities.shortName })
      .from(atelierLegalEntities)
      .where(and(eq(atelierLegalEntities.orgId, me.orgId), eq(atelierLegalEntities.id, run.legalEntityId)));
    const entitySlug = (entity?.shortName ?? run.legalEntityId).replace(/[^a-zA-Z0-9]/g, "-").slice(0, 20);

    await db.insert(atelierAuditEvents).values({
      id: rid("aud"), entityType: "payroll_run", entityId: run.id,
      actorType: "human", actorId: me.id, actorLabel: me.name,
      action: "payroll.run_export_wio",
      payload: { periodLabel: run.periodLabel, headcount: lines.length, missingIban },
      payloadSummary: `Exported Wio salary file for payroll ${run.periodLabel} / ${entitySlug} (${lines.length} employee(s)${missingIban.length ? `; ${missingIban.length} missing IBAN` : ""}).`,
    });

    const filename = `WIO-SALARY-${entitySlug}-${run.periodLabel}-${today}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", filename));
    res.send(csvLines.join("\r\n"));
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
  // Task #1135 — notice-pay handling and probation terminations.
  noticeDaysDue: z.number().int().min(0).max(120).nullish(),
  noticeDaysServed: z.number().int().min(0).max(365).nullish(),
  probation: z.boolean().optional(),
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
      noticeDaysDue: parsed.data.noticeDaysDue ?? null,
      noticeDaysServed: parsed.data.noticeDaysServed ?? null,
      probation: parsed.data.probation ?? false,
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

// ─────────────── Salary advances (Task #1135) ───────────────

// @cli-skip: finance payroll read; REST-only surface (Task #1135)
// Task #1146 — comp-change history for the payroll edit dialog.
router.get("/finance/payroll/comp-changes", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const employeeId = String(req.query.employeeId ?? "");
  if (!employeeId) { res.status(400).json({ error: "employeeId-required" }); return; }
  const items = await db
    .select()
    .from(atelierCompChanges)
    .where(and(
      eq(atelierCompChanges.orgId, me.orgId),
      eq(atelierCompChanges.employeeId, employeeId),
      isNull(atelierCompChanges.deletedAt),
    ))
    .orderBy(desc(atelierCompChanges.effectiveFrom))
    .limit(50);
  res.json({ items });
});

router.get("/finance/payroll/advances", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const conds = [eq(atelierSalaryAdvances.orgId, me.orgId), isNull(atelierSalaryAdvances.deletedAt)];
  const employeeId = String(req.query.employeeId ?? "");
  if (employeeId) conds.push(eq(atelierSalaryAdvances.employeeId, employeeId));
  const items = await db.select().from(atelierSalaryAdvances).where(and(...conds))
    .orderBy(desc(atelierSalaryAdvances.createdAt)).limit(200);
  const repayments = items.length > 0
    ? await db.select().from(atelierAdvanceRepayments).where(and(
        eq(atelierAdvanceRepayments.orgId, me.orgId),
        inArray(atelierAdvanceRepayments.advanceId, items.map((a) => a.id)),
      ))
    : [];
  res.json({ items, repayments });
});

const advanceBody = z.object({
  employeeId: z.string().min(1),
  amount: z.number().positive(),
  installmentAmount: z.number().positive(),
  startPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  note: z.string().max(500).nullish(),
});

// @cli-skip: finance money-out write; UI-workflow only (Task #1135)
router.post("/finance/payroll/advances", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const parsed = advanceBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "invalid body" }); return; }
  try {
    const advance = await issueSalaryAdvance({
      orgId: me.orgId,
      employeeId: parsed.data.employeeId,
      amount: parsed.data.amount,
      installmentAmount: parsed.data.installmentAmount,
      startPeriod: parsed.data.startPeriod,
      note: parsed.data.note ?? null,
      createdByUserId: me.id,
    });
    await audit({ entityType: "salary_advance", entityId: advance.id, actor: me,
      action: "payroll.advance_issue",
      payload: { employeeId: advance.employeeId, amount: advance.principal, installmentAmount: advance.installmentAmount, startPeriod: advance.startPeriod },
      summary: `Issued salary advance of ${advance.principal} ${advance.currency} to ${advance.personName} (repaid ${advance.installmentAmount}/month from ${advance.startPeriod})` });
    res.status(201).json({ advance });
  } catch (err) { fail(res, err); }
});

// @cli-skip: finance payroll write; UI-workflow only (Task #1135)
router.post("/finance/payroll/advances/:id/pause", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  await setAdvanceStatus(me, String(req.params.id), "paused", res);
});

// @cli-skip: finance payroll write; UI-workflow only (Task #1135)
router.post("/finance/payroll/advances/:id/resume", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  await setAdvanceStatus(me, String(req.params.id), "active", res);
});

async function setAdvanceStatus(me: Me, id: string, status: "paused" | "active", res: Response): Promise<void> {
  const [adv] = await db.select().from(atelierSalaryAdvances).where(and(
    eq(atelierSalaryAdvances.orgId, me.orgId),
    eq(atelierSalaryAdvances.id, id),
    isNull(atelierSalaryAdvances.deletedAt),
  ));
  if (!adv) { res.status(404).json({ error: "not_found" }); return; }
  if (adv.status === "repaid" || adv.status === "cancelled") {
    res.status(409).json({ error: "payroll", message: `advance is ${adv.status} — deductions cannot be ${status === "paused" ? "paused" : "resumed"}` });
    return;
  }
  await db.update(atelierSalaryAdvances).set({ status, updatedAt: new Date() })
    .where(eq(atelierSalaryAdvances.id, adv.id));
  await audit({ entityType: "salary_advance", entityId: adv.id, actor: me,
    action: status === "paused" ? "payroll.advance_pause" : "payroll.advance_resume",
    payload: { outstanding: adv.outstanding },
    summary: `${status === "paused" ? "Paused" : "Resumed"} salary-advance deductions for ${adv.personName} (${adv.outstanding} ${adv.currency} outstanding)` });
  const [row] = await db.select().from(atelierSalaryAdvances).where(eq(atelierSalaryAdvances.id, adv.id));
  res.json({ advance: row });
}

// @cli-skip: finance payroll write; UI-workflow only (Task #1135)
router.post("/finance/payroll/advances/:id/payoff", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  try {
    const advance = await payoffSalaryAdvance({ orgId: me.orgId, advanceId: String(req.params.id), createdByUserId: me.id });
    await audit({ entityType: "salary_advance", entityId: advance.id, actor: me,
      action: "payroll.advance_payoff",
      payload: { principal: advance.principal },
      summary: `Salary advance for ${advance.personName} paid off early (cash received)` });
    res.json({ advance });
  } catch (err) { fail(res, err); }
});

// ─────────────── Task #1136 — WPS SIF export + Payroll Clerk ───────────────
// Bank handoff is a MANUAL Wio portal upload for now; wpsSifExport.ts is
// the isolated seam a future Wio API integration replaces.

// @cli-skip: finance payroll read; REST-only surface (Task #1136)
router.get("/finance/payroll/runs/:id/wps-sif", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  try {
    const preview = await previewWpsSif(me.orgId, String(req.params.id));
    res.json({ preview });
  } catch (err) { fail(res, err); }
});

// @cli-skip: finance payroll write; UI-workflow only (Task #1136)
router.post("/finance/payroll/runs/:id/wps-sif/export", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  try {
    const out = await exportWpsSif({
      orgId: me.orgId,
      runId: String(req.params.id),
      actor: { id: me.id, name: me.name },
    });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", out.fileName));
    res.setHeader("X-Wps-Export-Id", out.exportId);
    res.send(out.content);
  } catch (err) {
    if (err instanceof PayrollError) {
      const problems = (err as PayrollError & { problems?: unknown }).problems;
      res.status(err.status).json({ error: "payroll", message: err.message, ...(problems ? { problems } : {}) });
      return;
    }
    throw err;
  }
});

// @cli-skip: finance payroll write; UI-workflow only (Task #1136)
router.post("/finance/payroll/clerk/run", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const periodLabel = typeof req.body?.periodLabel === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.body.periodLabel)
    ? req.body.periodLabel : undefined;
  const launched = await launchAgentExclusive({
    agent: "payroll_clerk", orgId: me.orgId, userId: me.id,
    label: "Payroll Clerk — manual draft", resultHref: "/finance/payroll",
    work: () => runPayrollClerk({ orgId: me.orgId, input: { periodLabel }, triggeredByUserId: me.id }),
  });
  if (!launched.started) {
    return res.status(409).json({ error: "already_running", message: "The Payroll Clerk is already running — wait for it to finish." });
  }
  return res.status(202).json({ started: true, jobId: launched.jobId });
});

// @cli-skip: finance payroll read; REST-only surface (Task #1136)
router.get("/finance/payroll/clerk/status", async (req, res) => {
  const me = ensureFinanceLeadership(req, res); if (!me) return;
  const job = await getLatestJob(["payroll_clerk"], AGENT_SINGLETON_TARGET, me.orgId);
  res.json({ job: job ?? null });
});

// ─────────────── Simple monthly payroll (Task #654) ───────────────

async function audit(args: {
  entityType: string; entityId: string; actor: Me;
  action: string; payload: Record<string, unknown>; summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), entityType: args.entityType, entityId: args.entityId,
    actorType: "human", actorId: args.actor.id, actorLabel: args.actor.name,
    action: args.action, payload: args.payload, payloadSummary: args.summary,
  });
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function loadRun(id: string, orgId: string) {
  const [run] = await db.select().from(atelierPayrollRun)
    .where(and(eq(atelierPayrollRun.id, id), eq(atelierPayrollRun.orgId, orgId), isNull(atelierPayrollRun.deletedAt)))
    .limit(1);
  return run ?? null;
}

/**
 * Post a two-line balanced journal for a payroll run, idempotent on
 * (orgId, sourceKind, sourceRef). Fails loudly on a missing account —
 * the entity's chart must be seeded first.
 */
async function postPayrollJournal(args: {
  orgId: string;
  entityId: string;
  periodLabel: string;
  entryDate: string;
  sourceKind: "payroll_run" | "payroll_payment";
  sourceRef: string;
  memo: string;
  debitCode: string;
  creditCode: string;
  amount: number;
  userId: string;
}, dbx: Dbx = db): Promise<{ journalEntryId: string; alreadyPosted: boolean } | { error: string; message: string }> {
  const [existing] = await dbx.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.orgId, args.orgId),
    eq(atelierGlJournalEntry.sourceKind, args.sourceKind),
    eq(atelierGlJournalEntry.sourceRef, args.sourceRef),
    isNull(atelierGlJournalEntry.deletedAt),
  )).limit(1);
  if (existing) return { journalEntryId: existing.id, alreadyPosted: true };

  const accounts = await dbx.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, args.orgId),
    eq(atelierGlAccount.legalEntityId, args.entityId),
    isNull(atelierGlAccount.deletedAt),
  ));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  for (const code of [args.debitCode, args.creditCode]) {
    if (!byCode.has(code))
      return { error: "missing_account", message: `Account ${code} missing — seed the entity's chart of accounts first.` };
  }
  const amount = round2(args.amount);
  const entryId = rid("gljrn");
  await dbx.transaction(async (tx) => {
    await tx.insert(atelierGlJournalEntry).values({
      id: entryId, orgId: args.orgId, legalEntityId: args.entityId,
      periodLabel: args.periodLabel, entryDate: args.entryDate, kind: "posting",
      sourceKind: args.sourceKind, sourceRef: args.sourceRef,
      memo: args.memo, currency: "USD", totalDebit: amount, totalCredit: amount,
      createdByUserId: args.userId,
    });
    const dr = byCode.get(args.debitCode)!;
    const cr = byCode.get(args.creditCode)!;
    await tx.insert(atelierGlJournalLine).values({
      id: rid("gljl"), orgId: args.orgId, journalEntryId: entryId,
      accountId: dr.id, accountCode: dr.code, accountName: dr.name,
      debit: amount, credit: 0, memo: args.memo,
    });
    await tx.insert(atelierGlJournalLine).values({
      id: rid("gljl"), orgId: args.orgId, journalEntryId: entryId,
      accountId: cr.id, accountCode: cr.code, accountName: cr.name,
      debit: 0, credit: amount, memo: args.memo,
    });
  });
  return { journalEntryId: entryId, alreadyPosted: false };
}

// ─────────────────────── runs ───────────────────────

// @cli-skip: pending Task #340 read-parity migration
router.get("/payroll/runs", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const entityId = String(req.query.entityId ?? "");
  const period = String(req.query.period ?? "");
  const conds = [eq(atelierPayrollRun.orgId, me.orgId), isNull(atelierPayrollRun.deletedAt)];
  if (entityId) conds.push(eq(atelierPayrollRun.entityId, entityId));
  if (PERIOD_RE.test(period)) conds.push(eq(atelierPayrollRun.periodLabel, period));
  const rows = await db.select().from(atelierPayrollRun).where(and(...conds))
    .orderBy(desc(atelierPayrollRun.periodLabel), atelierPayrollRun.entityId)
    .limit(200);
  res.json({ ok: true, data: { rows } });
});

const RunCreateSchema = z.object({
  entityId: z.string().min(1),
  periodLabel: z.string().regex(PERIOD_RE, "YYYY-MM required"),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/payroll/runs", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const parsed = RunCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const b = parsed.data;
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, b.entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found", message: "Legal entity not found." });
  if (await isGlPeriodLocked(me.orgId, b.periodLabel))
    return res.status(409).json({ error: "period_locked", message: `Period ${b.periodLabel} is locked for the GL module.` });

  const snapshot = await buildPayrollLines(me.orgId, ent);
  const [existing] = await db.select().from(atelierPayrollRun).where(and(
    eq(atelierPayrollRun.orgId, me.orgId),
    eq(atelierPayrollRun.entityId, b.entityId),
    eq(atelierPayrollRun.periodLabel, b.periodLabel),
    isNull(atelierPayrollRun.deletedAt),
  )).limit(1);
  if (existing) {
    if (existing.status !== "draft")
      return res.status(409).json({ error: "already_decided", status: existing.status, id: existing.id, message: "Run already approved — it cannot be rebuilt." });
    await db.update(atelierPayrollRun).set({
      lines: snapshot.lines, excluded: snapshot.excluded, totalAmount: snapshot.totalAmount, updatedAt: new Date(),
    }).where(eq(atelierPayrollRun.id, existing.id));
    return res.json({ ok: true, data: { id: existing.id, refreshed: true, ...snapshot } });
  }
  const id = rid("payrun");
  await db.insert(atelierPayrollRun).values({
    id, orgId: me.orgId, entityId: b.entityId, periodLabel: b.periodLabel,
    lines: snapshot.lines, excluded: snapshot.excluded, totalAmount: snapshot.totalAmount,
    createdByUserId: me.id,
  });
  await audit({ entityType: "payroll_run", entityId: id, actor: me,
    action: "payroll.run_build",
    payload: { entityId: b.entityId, periodLabel: b.periodLabel, employees: snapshot.lines.length, totalAmount: snapshot.totalAmount },
    summary: `Built payroll run ${b.periodLabel} for ${ent.shortName || ent.legalNameEn}: ${snapshot.lines.length} employee(s), USD ${snapshot.totalAmount}` });
  return res.status(201).json({ ok: true, data: { id, ...snapshot } });
});

/**
 * Task #1091 — shared payroll-run approve core. The REST route and the
 * Riser chat capability (finance.approve_payroll_run) BOTH run this so
 * the partner-tier gate, empty-run + GL period-lock checks, salary
 * journal posting (Dr 6000 / Cr 2100) and audit never fork. Payroll
 * approval is MONEY-OUT → the chat capability wraps this in a typed-name
 * confirm. Returns an HTTP-shaped `{ status, body }` outcome.
 */
export async function approvePayrollRunCore(args: {
  me: Me;
  id: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  if (!isPartnerTier(me))
    return { status: 403, body: { error: "forbidden", message: "Payroll approval requires partner tier." } };
  const run = await loadRun(args.id, me.orgId);
  if (!run) return { status: 404, body: { error: "not_found" } };
  if (run.status !== "draft")
    return { status: 409, body: { error: "already_decided", status: run.status, journalEntryId: run.journalEntryId } };
  if (!run.lines.length || run.totalAmount <= 0)
    return { status: 400, body: { error: "empty_run", message: "The run has no payable salary lines." } };
  if (await isGlPeriodLocked(me.orgId, run.periodLabel))
    return { status: 409, body: { error: "period_locked", message: `Period ${run.periodLabel} is locked for the GL module.` } };

  // Task #1135 — dual-path guard, serialized under the same per-
  // entity/period advisory lock the statutory post takes: the statutory
  // engine (Task #655) is the system of record for salary journals. If it
  // already posted this entity/period, approving the legacy simple run
  // would double-post Dr 6000 / Cr 2100. Guard check, journal and status
  // flip run inside one transaction holding the lock, so concurrent
  // legacy/statutory posts can never both pass their guards.
  const outcome = await db.transaction(async (tx): Promise<{ status: number; body: Record<string, unknown> } | { journalEntryId: string }> => {
    await tx.execute(sqlRaw`select pg_advisory_xact_lock(hashtext(${payrollPeriodLockKey(run.entityId, run.periodLabel)}))`);
    const [statPosted] = await tx.select({ id: atelierPayrollRuns.id }).from(atelierPayrollRuns).where(and(
      eq(atelierPayrollRuns.orgId, me.orgId),
      eq(atelierPayrollRuns.legalEntityId, run.entityId),
      eq(atelierPayrollRuns.periodLabel, run.periodLabel),
      eq(atelierPayrollRuns.status, "posted"),
      isNull(atelierPayrollRuns.deletedAt),
    )).limit(1);
    if (statPosted)
      return { status: 409, body: { error: "statutory_run_posted", message: `The statutory payroll engine already posted salaries for ${run.periodLabel} on this entity — the legacy simple run cannot double-post. Use /finance/payroll runs for this entity.` } };
    const y = Number(run.periodLabel.slice(0, 4));
    const m = Number(run.periodLabel.slice(5, 7));
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const posted = await postPayrollJournal({
      orgId: me.orgId, entityId: run.entityId, periodLabel: run.periodLabel,
      entryDate: `${run.periodLabel}-${String(lastDay).padStart(2, "0")}`,
      sourceKind: "payroll_run", sourceRef: run.id,
      memo: `Payroll ${run.periodLabel} — ${run.lines.length} employee(s)`,
      debitCode: "6000", creditCode: "2100", amount: run.totalAmount, userId: me.id,
    }, tx);
    if ("error" in posted) return { status: 400, body: posted as Record<string, unknown> };
    await tx.update(atelierPayrollRun).set({
      status: "approved", approvedByUserId: me.id, approvedAt: new Date(),
      journalEntryId: posted.journalEntryId, updatedAt: new Date(),
    }).where(eq(atelierPayrollRun.id, run.id));
    return { journalEntryId: posted.journalEntryId };
  });
  if ("status" in outcome) return outcome;
  const posted = outcome;
  await audit({ entityType: "payroll_run", entityId: run.id, actor: me,
    action: "payroll.run_approve",
    payload: { periodLabel: run.periodLabel, totalAmount: run.totalAmount, journalEntryId: posted.journalEntryId },
    summary: `Approved payroll ${run.periodLabel} (USD ${run.totalAmount}) — salary journal posted` });
  return { status: 200, body: { ok: true, data: { journalEntryId: posted.journalEntryId, periodLabel: run.periodLabel, totalAmount: run.totalAmount, employees: run.lines.length } } };
}

// @cli-skip: chat parity via finance.approve_payroll_run (financeApprovalsCapabilities, #1091); REST stays authoritative
router.post("/payroll/runs/:id/approve", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const out = await approvePayrollRunCore({ me, id: req.params.id });
  return res.status(out.status).json(out.body);
});

const MarkPaidSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD required").optional(),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/payroll/runs/:id/mark-paid", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const run = await loadRun(req.params.id, me.orgId);
  if (!run) return res.status(404).json({ error: "not_found" });
  if (run.status === "paid")
    return res.status(409).json({ error: "already_paid", paymentJournalEntryId: run.paymentJournalEntryId });
  if (run.status !== "approved")
    return res.status(409).json({ error: "not_approved", message: "Approve the run before marking it paid." });
  const parsed = MarkPaidSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const paidDate = parsed.data.paidDate ?? new Date().toISOString().slice(0, 10);
  const paidPeriod = paidDate.slice(0, 7);
  if (await isGlPeriodLocked(me.orgId, paidPeriod))
    return res.status(409).json({ error: "period_locked", message: `Payment period ${paidPeriod} is locked for the GL module.` });

  const posted = await postPayrollJournal({
    orgId: me.orgId, entityId: run.entityId, periodLabel: paidPeriod,
    entryDate: paidDate, sourceKind: "payroll_payment", sourceRef: run.id,
    memo: `Payroll ${run.periodLabel} paid ${paidDate}`,
    debitCode: "2100", creditCode: "1000", amount: run.totalAmount, userId: me.id,
  });
  if ("error" in posted) return res.status(400).json(posted);
  await db.update(atelierPayrollRun).set({
    status: "paid", paidByUserId: me.id, paidAt: new Date(), paidDate,
    paymentJournalEntryId: posted.journalEntryId, updatedAt: new Date(),
  }).where(eq(atelierPayrollRun.id, run.id));
  await audit({ entityType: "payroll_run", entityId: run.id, actor: me,
    action: "payroll.run_mark_paid",
    payload: { periodLabel: run.periodLabel, paidDate, totalAmount: run.totalAmount, paymentJournalEntryId: posted.journalEntryId },
    summary: `Payroll ${run.periodLabel} marked paid ${paidDate} (USD ${run.totalAmount})` });
  return res.json({ ok: true, data: { paymentJournalEntryId: posted.journalEntryId } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.delete("/payroll/runs/:id", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const run = await loadRun(req.params.id, me.orgId);
  if (!run) return res.status(404).json({ error: "not_found" });
  if (run.status !== "draft")
    return res.status(409).json({ error: "already_decided", status: run.status, message: "Only draft runs can be discarded." });
  await db.update(atelierPayrollRun).set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(atelierPayrollRun.id, run.id));
  await audit({ entityType: "payroll_run", entityId: run.id, actor: me,
    action: "payroll.run_discard", payload: { periodLabel: run.periodLabel, entityId: run.entityId },
    summary: `Discarded draft payroll run ${run.periodLabel}` });
  return res.json({ ok: true });
});

export default router;
