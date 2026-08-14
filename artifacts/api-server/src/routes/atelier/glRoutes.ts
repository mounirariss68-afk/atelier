/**
 * Task #428 — Finance GL backbone routes.
 *
 *   GET    /gl/accounts?entityId=            chart of accounts (per entity)
 *   POST   /gl/accounts/seed                 seed default chart for an entity
 *   POST   /gl/accounts                      add an account (finance roles)
 *   PATCH  /gl/accounts/:id                  rename / (de)activate an account
 *   POST   /gl/bookkeeper/run                run the Bookkeeper posting agent
 *   GET    /gl/journal?entityId&period&accountCode&engagementId
 *   POST   /gl/journal/manual                manual journal entry (lock-checked)
 *   GET    /gl/trial-balance?entityId&period
 *   GET    /gl/exceptions?status=
 *   POST   /gl/exceptions/:id/resolve
 *   GET    /gl/untagged                      money-moving rows without an entity tag
 *   POST   /gl/tag                           assign a legal entity to a record
 *
 * Reads: finance leadership + leadership rollup (same perimeter as revrec).
 * Writes: founding_partner | partner | finance only.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierGlPostingException,
  atelierInvoice,
  atelierExpenses,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierBankTransaction,
  atelierAuditEvents,
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import {
  proposeExpenseAllocation,
  proposeSupplierInvoiceAllocation,
  decideAllocation,
} from "../../lib/atelier-entity-allocation.js";
import {
  DEFAULT_CHART,
  ensureChartSeeded,
  isGlPeriodLocked,
  runBookkeeper,
} from "../../lib/atelier-agents/bookkeeper.js";
import {
  BOOKKEEPER_JOB_KINDS,
  BOOKKEEPER_LOCK_KEY,
  BOOKKEEPER_STALE_MS,
  bookkeeperJobTargetId,
  getLatestBookkeeperJob,
} from "../../lib/atelier-agents/bookkeeperAuto.js";
import {
  startBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  reapStaleRunningJob,
} from "../../lib/background-jobs.js";

/**
 * Task #1073 — drill-through: resolve a journal/exception source to the
 * app route where that document lives. Kinds without a destination
 * return null and render as plain text (never guess a URL).
 *
 * Task #1082 — list-page destinations now deep-link to the exact row via
 * a `?focus=` / `?txn=` query param the target page reads to scroll and
 * highlight. Revrec lines carry the source period so the page loads the
 * right month's schedules (posting-line ids aren't rendered client-side).
 * Contractor payments stay on the list page: paid contractor-payment rows
 * have no per-row UI (they surface as self-billed invoices downstream).
 */
export function glSourceHref(
  sourceKind: string,
  sourceRef: string,
  ctx?: { periodLabel?: string | null },
): string | null {
  const ref = encodeURIComponent(sourceRef);
  switch (sourceKind) {
    case "invoice": return `/wallet/invoices/${ref}`;
    case "expense": return `/wallet/expenses/${ref}`;
    case "revrec_line":
      return ctx?.periodLabel
        ? `/wallet/revrec?period=${encodeURIComponent(ctx.periodLabel)}&line=${ref}`
        : "/wallet/revrec";
    case "self_billed_invoice": return `/finance/payables/self-billing?focus=${ref}`;
    case "partner_firm_invoice": return `/finance/payables/partner-invoices?focus=${ref}`;
    case "contractor_payment": return "/finance/payables/subcontractors";
    case "bank_transaction": return `/wallet/cash?txn=${ref}`;
    default: return null; // manual, unknown kinds
  }
}

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

type Me = typeof atelierUsers.$inferSelect;
function ensure(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) { res.status(401).json({ error: "no-active-persona" }); return null; }
  return req.atelierPersona;
}
function isFinanceLeadership(me: Me): boolean {
  return me.role === "founding_partner" || me.role === "partner" || me.role === "finance";
}
function denyRead(req: Request, res: Response): Me | null {
  const me = ensure(req, res); if (!me) return null;
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role) || !isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "GL is limited to finance leadership." });
    return null;
  }
  return me;
}
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

const PERIOD_RE = /^\d{4}-\d{2}$/;

/**
 * Task #1081 — lazily seed the default chart for active entities that
 * have none, so GL reads never show an empty chart. Idempotent; audits
 * as `gl.chart_seed` attributed to the reading user.
 */
async function autoSeedMissingCharts(me: Me, onlyEntityId?: string): Promise<void> {
  const entities = (await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, me.orgId), eq(atelierLegalEntities.status, "active"))))
    .filter((e) => !onlyEntityId || e.id === onlyEntityId);
  if (entities.length === 0) return;
  const counts = await db
    .select({ legalEntityId: atelierGlAccount.legalEntityId, n: sql<number>`count(*)` })
    .from(atelierGlAccount)
    .where(and(
      eq(atelierGlAccount.orgId, me.orgId),
      inArray(atelierGlAccount.legalEntityId, entities.map((e) => e.id)),
      isNull(atelierGlAccount.deletedAt),
    ))
    .groupBy(atelierGlAccount.legalEntityId);
  const haveChart = new Set(counts.filter((r) => Number(r.n) > 0).map((r) => r.legalEntityId));
  for (const ent of entities) {
    if (haveChart.has(ent.id)) continue;
    await ensureChartSeeded({
      orgId: me.orgId,
      legalEntityId: ent.id,
      entityLabel: ent.shortName || ent.legalNameEn,
      actor: { kind: "human", userId: me.id, label: me.name },
      reason: "chart-of-accounts read found no chart for this active entity",
    });
  }
}

// ─────────────────────── chart of accounts ───────────────────────

// @cli-skip: pending Task #340 read-parity migration
router.get("/gl/accounts", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const entityId = String(req.query.entityId ?? "");
  await autoSeedMissingCharts(me, entityId || undefined);
  const where = entityId
    ? and(eq(atelierGlAccount.orgId, me.orgId), eq(atelierGlAccount.legalEntityId, entityId), isNull(atelierGlAccount.deletedAt))
    : and(eq(atelierGlAccount.orgId, me.orgId), isNull(atelierGlAccount.deletedAt));
  const rows = await db.select().from(atelierGlAccount).where(where)
    .orderBy(atelierGlAccount.legalEntityId, atelierGlAccount.code);
  res.json({ ok: true, data: { rows, defaultChart: DEFAULT_CHART } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/gl/accounts/seed", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const b = req.body as { entityId?: string };
  if (!b.entityId) return res.status(400).json({ error: "invalid_input" });
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, b.entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found" });
  const out = await ensureChartSeeded({
    orgId: me.orgId, legalEntityId: ent.id,
    entityLabel: ent.shortName || ent.legalNameEn,
    actor: { kind: "human", userId: me.id, label: me.name },
    reason: "explicit seed request",
  });
  return res.json({ ok: true, data: out });
});

const AccountCreateSchema = z.object({
  entityId: z.string().min(1),
  code: z.string().min(2).max(12),
  name: z.string().min(2).max(120),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  normalSide: z.enum(["debit", "credit"]),
  notes: z.string().max(500).optional(),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/gl/accounts", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const parsed = AccountCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const b = parsed.data;
  const dup = await db.select({ id: atelierGlAccount.id }).from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, me.orgId),
    eq(atelierGlAccount.legalEntityId, b.entityId),
    eq(atelierGlAccount.code, b.code),
  ));
  if (dup.length > 0) return res.status(409).json({ error: "duplicate_code" });
  const id = rid("glacct");
  await db.insert(atelierGlAccount).values({
    id, orgId: me.orgId, legalEntityId: b.entityId, code: b.code, name: b.name,
    type: b.type, normalSide: b.normalSide, notes: b.notes ?? null, createdByUserId: me.id,
  });
  await audit({ entityType: "gl_account", entityId: id, actor: me,
    action: "gl.account_create", payload: { ...b },
    summary: `Added GL account ${b.code} ${b.name}` });
  return res.status(201).json({ ok: true, data: { id } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.patch("/gl/accounts/:id", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const b = req.body as { name?: string; notes?: string; active?: boolean };
  const [acct] = await db.select().from(atelierGlAccount)
    .where(and(eq(atelierGlAccount.id, req.params.id), eq(atelierGlAccount.orgId, me.orgId)));
  if (!acct) return res.status(404).json({ error: "not_found" });
  if (b.active === false && acct.isSystem)
    return res.status(400).json({ error: "system_account", message: "System accounts are referenced by posting rules and cannot be deactivated." });
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof b.name === "string" && b.name.trim().length >= 2) set.name = b.name.trim();
  if (typeof b.notes === "string") set.notes = b.notes;
  if (typeof b.active === "boolean") set.active = b.active;
  await db.update(atelierGlAccount).set(set).where(eq(atelierGlAccount.id, acct.id));
  await audit({ entityType: "gl_account", entityId: acct.id, actor: me,
    action: "gl.account_update", payload: { changes: b },
    summary: `Updated GL account ${acct.code}` });
  return res.json({ ok: true });
});

// ─────────────────────── bookkeeper run ───────────────────────

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/gl/bookkeeper/run", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const b = req.body as { periodLabel?: string; entityId?: string };
  if (!b.periodLabel || !PERIOD_RE.test(b.periodLabel))
    return res.status(400).json({ error: "invalid_input", message: "periodLabel must be YYYY-MM" });
  if (await isGlPeriodLocked(me.orgId, b.periodLabel))
    return res.status(409).json({ error: "period_locked", message: `Period ${b.periodLabel} is locked for the GL module.` });
  // Task #1073 — claim the same per-(org, period) lock the auto sweep
  // uses so a manual run can't overlap an in-flight automatic run.
  const targetId = bookkeeperJobTargetId(me.orgId, b.periodLabel);
  await reapStaleRunningJob([...BOOKKEEPER_JOB_KINDS], targetId, me.orgId, BOOKKEEPER_STALE_MS);
  const jobId = await startBackgroundJob({
    orgId: me.orgId,
    userId: me.id,
    kind: "gl_bookkeeper_manual",
    lockKey: BOOKKEEPER_LOCK_KEY,
    targetType: "gl_period",
    targetId,
    label: `Bookkeeper run ${b.periodLabel}`,
    resultHref: "/finance/ledger",
  });
  if (!jobId)
    return res.status(409).json({ error: "run_in_progress", message: `A Bookkeeper run for ${b.periodLabel} is already in progress — it posts the same sources; refresh in a moment.` });
  try {
    const out = await runBookkeeper({
      orgId: me.orgId,
      input: { periodLabel: b.periodLabel, entityId: b.entityId || undefined },
      triggeredByUserId: me.id,
    });
    await completeBackgroundJob(jobId, {
      result: {
        entriesCreated: out.output.entriesCreated,
        entriesSkippedExisting: out.output.entriesSkippedExisting,
        exceptionsOpen: out.output.exceptionsOpen,
        sourcesScanned: out.output.sourcesScanned,
        rationaleSummary: out.output.rationaleSummary,
      },
    });
    return res.json({ ok: true, data: out.output, runId: out.runId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failBackgroundJob(jobId, msg);
    if (msg.startsWith("period-locked")) return res.status(409).json({ error: "period_locked", message: msg });
    throw err;
  }
});

// Task #1073 — last Bookkeeper run (auto or manual) for a period, so the
// Ledger page can show when the ledger was last refreshed automatically.
// @cli-skip: pending Task #340 read-parity migration
router.get("/gl/bookkeeper/status", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const period = String(req.query.period ?? "");
  if (!PERIOD_RE.test(period))
    return res.status(400).json({ error: "invalid_input", message: "period must be YYYY-MM" });
  const job = await getLatestBookkeeperJob(me.orgId, period);
  if (!job) return res.json({ ok: true, data: { lastRun: null } });
  const result = (job.result ?? null) as Record<string, unknown> | null;
  return res.json({
    ok: true,
    data: {
      lastRun: {
        mode: job.kind === "gl_bookkeeper_auto" ? "auto" : "manual",
        status: job.status, // running | done | failed
        startedAt: job.createdAt,
        finishedAt: job.finishedAt,
        error: job.error ?? null,
        entriesCreated: typeof result?.entriesCreated === "number" ? result.entriesCreated : null,
        exceptionsOpen: typeof result?.exceptionsOpen === "number" ? result.exceptionsOpen : null,
      },
    },
  });
});

// ─────────────────────── journal + trial balance ───────────────────────

// @cli-skip: pending Task #340 read-parity migration
router.get("/gl/journal", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const entityId = String(req.query.entityId ?? "");
  const period = String(req.query.period ?? "");
  const accountCode = String(req.query.accountCode ?? "");
  const engagementId = String(req.query.engagementId ?? "");
  const conds = [eq(atelierGlJournalEntry.orgId, me.orgId), isNull(atelierGlJournalEntry.deletedAt)];
  if (entityId) conds.push(eq(atelierGlJournalEntry.legalEntityId, entityId));
  if (period && PERIOD_RE.test(period)) conds.push(eq(atelierGlJournalEntry.periodLabel, period));
  const entries = await db.select().from(atelierGlJournalEntry).where(and(...conds))
    .orderBy(desc(atelierGlJournalEntry.entryDate), desc(atelierGlJournalEntry.createdAt))
    .limit(500);
  const ids = entries.map((e) => e.id);
  const lines = ids.length > 0
    ? await db.select().from(atelierGlJournalLine)
        .where(and(eq(atelierGlJournalLine.orgId, me.orgId), inArray(atelierGlJournalLine.journalEntryId, ids)))
    : [];
  let filtered = entries;
  if (accountCode || engagementId) {
    const match = new Set(
      lines.filter((l) =>
        (!accountCode || l.accountCode === accountCode) &&
        (!engagementId || l.engagementId === engagementId),
      ).map((l) => l.journalEntryId),
    );
    filtered = entries.filter((e) => match.has(e.id));
  }
  const linesByEntry = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = linesByEntry.get(l.journalEntryId) ?? [];
    arr.push(l); linesByEntry.set(l.journalEntryId, arr);
  }
  res.json({
    ok: true,
    data: {
      rows: filtered.map((e) => ({
        ...e,
        lines: linesByEntry.get(e.id) ?? [],
        // Task #1073 — drill-through to the source document (null = no page).
        sourceHref: glSourceHref(e.sourceKind, e.sourceRef, { periodLabel: e.periodLabel }),
      })),
    },
  });
});

const ManualJournalSchema = z.object({
  entityId: z.string().min(1),
  periodLabel: z.string().regex(PERIOD_RE),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().min(3).max(300),
  currency: z.string().min(3).max(3).default("USD"),
  lines: z.array(z.object({
    accountCode: z.string().min(2),
    engagementId: z.string().optional(),
    debit: z.number().min(0).default(0),
    credit: z.number().min(0).default(0),
    memo: z.string().max(300).optional(),
  })).min(2).max(50),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/gl/journal/manual", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const parsed = ManualJournalSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const b = parsed.data;
  if (b.entryDate.slice(0, 7) !== b.periodLabel)
    return res.status(400).json({ error: "invalid_input", message: "entryDate must fall inside periodLabel" });
  if (await isGlPeriodLocked(me.orgId, b.periodLabel))
    return res.status(409).json({ error: "period_locked", message: `Period ${b.periodLabel} is locked for the GL module.` });
  const totalDebit = round2(b.lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(b.lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.011)
    return res.status(400).json({ error: "unbalanced", totalDebit, totalCredit });
  if (totalDebit <= 0)
    return res.status(400).json({ error: "invalid_input", message: "Entry must move a non-zero amount." });
  const accounts = await db.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, me.orgId),
    eq(atelierGlAccount.legalEntityId, b.entityId),
    eq(atelierGlAccount.active, true),
    isNull(atelierGlAccount.deletedAt),
  ));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  for (const l of b.lines) {
    if (!byCode.has(l.accountCode))
      return res.status(400).json({ error: "missing_account", accountCode: l.accountCode });
  }
  const entryId = rid("gljrn");
  await db.transaction(async (tx) => {
    await tx.insert(atelierGlJournalEntry).values({
      id: entryId, orgId: me.orgId, legalEntityId: b.entityId,
      periodLabel: b.periodLabel, entryDate: b.entryDate, kind: "manual",
      sourceKind: "manual", sourceRef: entryId, memo: b.memo,
      currency: b.currency, totalDebit, totalCredit, createdByUserId: me.id,
    });
    for (const l of b.lines) {
      const acct = byCode.get(l.accountCode)!;
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
        accountId: acct.id, accountCode: acct.code, accountName: acct.name,
        engagementId: l.engagementId ?? null,
        debit: round2(l.debit), credit: round2(l.credit), memo: l.memo ?? null,
      });
    }
  });
  await audit({ entityType: "gl_journal_entry", entityId: entryId, actor: me,
    action: "gl.manual_journal", payload: { periodLabel: b.periodLabel, totalDebit, lines: b.lines.length },
    summary: `Manual journal ${b.periodLabel}: ${b.memo} (${b.currency} ${totalDebit})` });
  return res.status(201).json({ ok: true, data: { id: entryId } });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/gl/trial-balance", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const entityId = String(req.query.entityId ?? "");
  const period = String(req.query.period ?? "");
  if (!entityId) return res.status(400).json({ error: "invalid_input", message: "entityId required" });
  await autoSeedMissingCharts(me, entityId);
  const conds = [
    eq(atelierGlJournalEntry.orgId, me.orgId),
    eq(atelierGlJournalEntry.legalEntityId, entityId),
    isNull(atelierGlJournalEntry.deletedAt),
  ];
  if (period && PERIOD_RE.test(period)) conds.push(eq(atelierGlJournalEntry.periodLabel, period));
  const rows = await db
    .select({
      accountCode: atelierGlJournalLine.accountCode,
      accountName: atelierGlJournalLine.accountName,
      currency: atelierGlJournalEntry.currency,
      debit: sql<number>`coalesce(sum(${atelierGlJournalLine.debit}), 0)`,
      credit: sql<number>`coalesce(sum(${atelierGlJournalLine.credit}), 0)`,
    })
    .from(atelierGlJournalLine)
    .innerJoin(atelierGlJournalEntry, eq(atelierGlJournalLine.journalEntryId, atelierGlJournalEntry.id))
    .where(and(...conds))
    .groupBy(atelierGlJournalLine.accountCode, atelierGlJournalLine.accountName, atelierGlJournalEntry.currency)
    .orderBy(atelierGlJournalLine.accountCode);
  const totals = rows.reduce(
    (s, r) => ({ debit: round2(s.debit + Number(r.debit)), credit: round2(s.credit + Number(r.credit)) }),
    { debit: 0, credit: 0 },
  );
  return res.json({ ok: true, data: { rows, totals, balanced: Math.abs(totals.debit - totals.credit) <= 0.011 } });
});

// ─────────────────────── exceptions ───────────────────────

// @cli-skip: pending Task #340 read-parity migration
router.get("/gl/exceptions", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const status = String(req.query.status ?? "open");
  const conds = [eq(atelierGlPostingException.orgId, me.orgId), isNull(atelierGlPostingException.deletedAt)];
  if (status === "open" || status === "resolved") conds.push(eq(atelierGlPostingException.status, status));
  const rows = await db.select().from(atelierGlPostingException).where(and(...conds))
    .orderBy(desc(atelierGlPostingException.updatedAt)).limit(300);
  res.json({
    ok: true,
    data: {
      rows: rows.map((r) => ({ ...r, sourceHref: glSourceHref(r.sourceKind, r.sourceRef, { periodLabel: r.periodLabel }) })),
    },
  });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/gl/exceptions/:id/resolve", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const note = (req.body as { note?: string }).note;
  const [ex] = await db.select().from(atelierGlPostingException)
    .where(and(eq(atelierGlPostingException.id, req.params.id), eq(atelierGlPostingException.orgId, me.orgId)));
  if (!ex) return res.status(404).json({ error: "not_found" });
  if (ex.status === "resolved") return res.json({ ok: true, data: { alreadyResolved: true } });
  await db.update(atelierGlPostingException).set({
    status: "resolved", resolvedAt: new Date(), resolvedByUserId: me.id,
    resolutionNote: note ?? null, updatedAt: new Date(),
  }).where(eq(atelierGlPostingException.id, ex.id));
  await audit({ entityType: "gl_posting_exception", entityId: ex.id, actor: me,
    action: "gl.exception_resolve", payload: { code: ex.code, sourceKind: ex.sourceKind, sourceRef: ex.sourceRef, note },
    summary: `Resolved GL exception ${ex.code} on ${ex.sourceKind} ${ex.sourceLabel ?? ex.sourceRef}` });
  return res.json({ ok: true });
});

// ─────────────────────── entity tagging ───────────────────────

// @cli-skip: pending Task #340 read-parity migration
router.get("/gl/untagged", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const [invoices, expenses, cps, pfis, txns] = await Promise.all([
    db.select().from(atelierInvoice).where(and(
      eq(atelierInvoice.orgId, me.orgId), isNull(atelierInvoice.legalEntityId),
      inArray(atelierInvoice.status, ["issued", "paid"]), isNull(atelierInvoice.deletedAt))).limit(100),
    db.select().from(atelierExpenses).where(and(
      eq(atelierExpenses.orgId, me.orgId), isNull(atelierExpenses.entityId),
      inArray(atelierExpenses.status, ["approved", "reimbursed"]), isNull(atelierExpenses.deletedAt))).limit(100),
    db.select().from(atelierContractorPayments).where(and(
      eq(atelierContractorPayments.orgId, me.orgId), isNull(atelierContractorPayments.legalEntityId),
      eq(atelierContractorPayments.status, "paid"), isNull(atelierContractorPayments.deletedAt))).limit(100),
    db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, me.orgId), isNull(atelierPartnerFirmInvoices.legalEntityId),
      eq(atelierPartnerFirmInvoices.status, "paid"), isNull(atelierPartnerFirmInvoices.deletedAt))).limit(100),
    db.select().from(atelierBankTransaction).where(and(
      eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.legalEntityId),
      isNull(atelierBankTransaction.deletedAt))).limit(100),
  ]);
  res.json({
    ok: true,
    data: {
      rows: [
        ...invoices.map((r) => ({ kind: "invoice", id: r.id, label: r.invoiceNumber ?? r.id, amount: r.total, currency: r.currency, date: r.issuedAt?.toISOString().slice(0, 10) ?? null })),
        ...expenses.map((r) => ({ kind: "expense", id: r.id, label: `${r.merchant ?? r.category} · ${r.expenseDate}`, amount: r.usdAmount, currency: "USD", date: r.expenseDate })),
        ...cps.map((r) => ({ kind: "contractor_payment", id: r.id, label: `${r.payeeName} · ${r.weekIso}`, amount: r.usdAmount, currency: "USD", date: r.paidAt?.toISOString().slice(0, 10) ?? null })),
        ...pfis.map((r) => ({ kind: "partner_firm_invoice", id: r.id, label: `${r.partnerFirmName} · ${r.weekIso}`, amount: r.usdAmount, currency: "USD", date: r.paidAt?.toISOString().slice(0, 10) ?? null })),
        ...txns.map((r) => ({ kind: "bank_transaction", id: r.id, label: `${r.counterpartyNameRaw ?? "Bank txn"} · ${r.postedDate}`, amount: r.amount, currency: r.currency, date: r.postedDate })),
      ].map((r) => ({ ...r, sourceHref: glSourceHref(r.kind, r.id) })),
    },
  });
});

const TagSchema = z.object({
  kind: z.enum(["invoice", "expense", "contractor_payment", "partner_firm_invoice", "bank_transaction"]),
  id: z.string().min(1),
  legalEntityId: z.string().min(1),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/gl/tag", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const parsed = TagSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const b = parsed.data;
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, b.legalEntityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "entity_not_found" });
  let updated = 0;
  if (b.kind === "invoice") {
    updated = (await db.update(atelierInvoice).set({ legalEntityId: ent.id, updatedAt: new Date() })
      .where(and(eq(atelierInvoice.id, b.id), eq(atelierInvoice.orgId, me.orgId))).returning({ id: atelierInvoice.id })).length;
  } else if (b.kind === "expense" || b.kind === "partner_firm_invoice") {
    // Task #1095 — manual GL tagging IS an allocation decision: route it
    // through the shared decide path so period-close locks, mandatory
    // override reasons, and allocation.approve/override audits all apply.
    const sourceKind = b.kind;
    const [posted] = await db
      .select({ periodLabel: atelierGlJournalEntry.periodLabel })
      .from(atelierGlJournalEntry)
      .where(and(
        eq(atelierGlJournalEntry.orgId, me.orgId),
        eq(atelierGlJournalEntry.sourceKind, sourceKind),
        eq(atelierGlJournalEntry.sourceRef, b.id),
        isNull(atelierGlJournalEntry.deletedAt)))
      .limit(1);
    if (posted && (await isGlPeriodLocked(me.orgId, posted.periodLabel))) {
      return res.status(409).json({
        error: "period-locked",
        message: `Posted in close-locked period ${posted.periodLabel}; use reversal/repost instead.`,
      });
    }
    const decided = await decideAllocation({
      kind: b.kind === "expense" ? "expense" : "supplier_invoice",
      id: b.id, orgId: me.orgId,
      actor: { id: me.id, name: me.name },
      entityId: ent.id,
      overrideReason: typeof (req.body ?? {}).reason === "string" ? String((req.body as any).reason) : null,
    });
    if (!decided.ok) {
      const httpStatus = decided.error === "not_found" ? 404 : 400;
      return res.status(httpStatus).json({ error: decided.error, message: decided.message });
    }
    return res.json({ ok: true, data: { status: decided.status, entityId: decided.entityId } });
  } else if (b.kind === "contractor_payment") {
    updated = (await db.update(atelierContractorPayments).set({ legalEntityId: ent.id, updatedAt: new Date() })
      .where(and(eq(atelierContractorPayments.id, b.id), eq(atelierContractorPayments.orgId, me.orgId))).returning({ id: atelierContractorPayments.id })).length;
  } else if (b.kind === "bank_transaction") {
    updated = (await db.update(atelierBankTransaction).set({ legalEntityId: ent.id, updatedAt: new Date() })
      .where(and(eq(atelierBankTransaction.id, b.id), eq(atelierBankTransaction.orgId, me.orgId))).returning({ id: atelierBankTransaction.id })).length;
  }
  if (updated === 0) return res.status(404).json({ error: "not_found" });
  await audit({ entityType: b.kind, entityId: b.id, actor: me,
    action: "gl.entity_tag", payload: { legalEntityId: ent.id },
    summary: `Tagged ${b.kind} ${b.id} to ${ent.shortName || ent.legalNameEn}` });
  return res.json({ ok: true });
});

// ─────────────── Task #1095 — entity-allocation queue & sweep ───────────────

// Pending-allocation queue: expenses + supplier invoices whose allocation
// is proposed (awaiting approval) or needs_input (engine could not decide).
// @cli-skip: finance-leadership GL surface; read parity pending Task #340
router.get("/gl/allocations/pending", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const [expenses, pfis] = await Promise.all([
    db.select().from(atelierExpenses).where(and(
      eq(atelierExpenses.orgId, me.orgId),
      inArray(atelierExpenses.allocStatus, ["proposed", "needs_input"]),
      isNull(atelierExpenses.deletedAt))).limit(200),
    db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, me.orgId),
      inArray(atelierPartnerFirmInvoices.allocStatus, ["proposed", "needs_input"]),
      isNull(atelierPartnerFirmInvoices.deletedAt))).limit(200),
  ]);
  res.json({
    ok: true,
    data: {
      rows: [
        ...expenses.map((r) => ({
          kind: "expense", id: r.id,
          label: `${r.merchant ?? r.category} · ${r.expenseDate}`,
          amount: r.usdAmount, currency: "USD",
          allocStatus: r.allocStatus, allocRuleId: r.allocRuleId,
          allocJustification: r.allocJustification, allocConfidence: r.allocConfidence,
          allocDecidedBy: r.allocDecidedBy, entityId: r.entityId,
        })),
        ...pfis.map((r) => ({
          kind: "partner_firm_invoice", id: r.id,
          label: `${r.partnerFirmName} · ${r.weekIso}`,
          amount: r.usdAmount, currency: "USD",
          allocStatus: r.allocStatus, allocRuleId: r.allocRuleId,
          allocJustification: r.allocJustification, allocConfidence: r.allocConfidence,
          allocDecidedBy: r.allocDecidedBy, entityId: r.legalEntityId,
        })),
      ].map((r) => ({ ...r, sourceHref: glSourceHref(r.kind, r.id) })),
    },
  });
});

// Founder/finance-triggered sweep: run the allocation engine over existing
// untagged / never-allocated expenses and supplier invoices. Deterministic
// by default; pass { allowAi: true } to let the AI fallback run.
// @cli-skip: UI-workflow bulk write; founder-triggered from the GL surface
router.post("/gl/allocations/sweep", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const allowAi = (req.body ?? {}).allowAi === true;
  const [expenses, pfis] = await Promise.all([
    db.select({ id: atelierExpenses.id }).from(atelierExpenses).where(and(
      eq(atelierExpenses.orgId, me.orgId),
      isNull(atelierExpenses.allocStatus),
      isNull(atelierExpenses.entityId),
      inArray(atelierExpenses.status, ["draft", "submitted", "approved", "reimbursed"]),
      isNull(atelierExpenses.deletedAt))).limit(100),
    db.select({ id: atelierPartnerFirmInvoices.id }).from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, me.orgId),
      isNull(atelierPartnerFirmInvoices.allocStatus),
      isNull(atelierPartnerFirmInvoices.legalEntityId),
      isNull(atelierPartnerFirmInvoices.deletedAt))).limit(100),
  ]);
  let proposed = 0, needsInput = 0;
  for (const e of expenses) {
    const r = await proposeExpenseAllocation(e.id, { allowAi, actorId: me.id }).catch(() => null);
    if (r?.status === "proposed") proposed++;
    else if (r?.status === "needs_input") needsInput++;
  }
  for (const p of pfis) {
    const r = await proposeSupplierInvoiceAllocation(p.id, { allowAi, actorId: me.id }).catch(() => null);
    if (r?.status === "proposed") proposed++;
    else if (r?.status === "needs_input") needsInput++;
  }
  await audit({
    entityType: "gl", entityId: "allocation_sweep", actor: me,
    action: "allocation.propose",
    payload: { scanned: expenses.length + pfis.length, proposed, needsInput, allowAi },
    summary: `Allocation sweep: ${proposed} proposed, ${needsInput} need input (of ${expenses.length + pfis.length} scanned).`,
  });
  res.json({ ok: true, data: { scanned: expenses.length + pfis.length, proposed, needsInput } });
});

// Approve / override the allocation on a queue item (period-lock aware).
// @cli-skip: UI-workflow write; allocation decisions ride the approval surfaces
router.post("/gl/allocations/:kind/:id/decide", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const kind = req.params.kind === "expense" ? "expense" as const
    : req.params.kind === "partner_firm_invoice" ? "supplier_invoice" as const : null;
  if (!kind) return res.status(400).json({ error: "invalid_kind" });
  const b = (req.body ?? {}) as { entityId?: string; reason?: string };
  const sourceKind = req.params.kind;
  const [posted] = await db
    .select({ periodLabel: atelierGlJournalEntry.periodLabel })
    .from(atelierGlJournalEntry)
    .where(and(
      eq(atelierGlJournalEntry.orgId, me.orgId),
      eq(atelierGlJournalEntry.sourceKind, sourceKind),
      eq(atelierGlJournalEntry.sourceRef, req.params.id),
      isNull(atelierGlJournalEntry.deletedAt)))
    .limit(1);
  if (posted && (await isGlPeriodLocked(me.orgId, posted.periodLabel))) {
    return res.status(409).json({
      error: "period-locked",
      message: `Posted in close-locked period ${posted.periodLabel}; use reversal/repost instead.`,
    });
  }
  const decided = await decideAllocation({
    kind, id: req.params.id, orgId: me.orgId,
    actor: { id: me.id, name: me.name },
    entityId: typeof b.entityId === "string" && b.entityId ? b.entityId : null,
    overrideReason: b.reason ?? null,
  });
  if (!decided.ok) return res.status(400).json({ error: decided.error, message: decided.message });
  return res.json({ ok: true, data: { status: decided.status, entityId: decided.entityId } });
});

export default router;
