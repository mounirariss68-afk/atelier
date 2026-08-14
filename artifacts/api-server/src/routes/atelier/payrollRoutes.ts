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
import { and, desc, eq, isNull } from "drizzle-orm";
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
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { isGlPeriodLocked } from "../../lib/atelier-agents/bookkeeper.js";
import { buildPayrollLines } from "../../lib/atelier-payroll.js";
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
}): Promise<{ journalEntryId: string; alreadyPosted: boolean } | { error: string; message: string }> {
  const [existing] = await db.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.orgId, args.orgId),
    eq(atelierGlJournalEntry.sourceKind, args.sourceKind),
    eq(atelierGlJournalEntry.sourceRef, args.sourceRef),
    isNull(atelierGlJournalEntry.deletedAt),
  )).limit(1);
  if (existing) return { journalEntryId: existing.id, alreadyPosted: true };

  const accounts = await db.select().from(atelierGlAccount).where(and(
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
  await db.transaction(async (tx) => {
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

  const y = Number(run.periodLabel.slice(0, 4));
  const m = Number(run.periodLabel.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const posted = await postPayrollJournal({
    orgId: me.orgId, entityId: run.entityId, periodLabel: run.periodLabel,
    entryDate: `${run.periodLabel}-${String(lastDay).padStart(2, "0")}`,
    sourceKind: "payroll_run", sourceRef: run.id,
    memo: `Payroll ${run.periodLabel} — ${run.lines.length} employee(s)`,
    debitCode: "6000", creditCode: "2100", amount: run.totalAmount, userId: me.id,
  });
  if ("error" in posted) return { status: 400, body: posted };
  await db.update(atelierPayrollRun).set({
    status: "approved", approvedByUserId: me.id, approvedAt: new Date(),
    journalEntryId: posted.journalEntryId, updatedAt: new Date(),
  }).where(eq(atelierPayrollRun.id, run.id));
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
