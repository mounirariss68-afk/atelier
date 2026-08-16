/**
 * Task #428 — Finance GL backbone routes.
 *
 *   GET    /gl/accounts?entityId=            chart of accounts (per entity)
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
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
  proposeGlRecordAllocation,
  decideAllocation,
  type GlProposeKind,
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
  heartbeatBackgroundJob,
} from "../../lib/background-jobs.js";
import {
  ENTITY_ALLOC_LOCK_KEY,
  ENTITY_ALLOC_MANUAL_JOB_KIND,
  ENTITY_ALLOC_JOB_KIND,
  ENTITY_ALLOC_STALE_MS,
} from "../../lib/atelier-agents/entityAllocationAuto.js";

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
 * have no per-row UI (they surface as self-billed invoices downstream), so
 * they deep-link to the Self-billing tab (the pay-when-paid Subcontractors
 * page was removed in Task #1106).
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
    case "contractor_payment": return "/finance/payables/self-billing";
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
  // Task #1091 — queryable agent-provenance filter. `postedByAgent=1`
  // (or `=<name>`) narrows to journals an agent posted (agentRunId set),
  // optionally to a specific agent name.
  const postedByAgent = String(req.query.postedByAgent ?? "").trim();
  const conds = [eq(atelierGlJournalEntry.orgId, me.orgId), isNull(atelierGlJournalEntry.deletedAt)];
  if (entityId) conds.push(eq(atelierGlJournalEntry.legalEntityId, entityId));
  if (period && PERIOD_RE.test(period)) conds.push(eq(atelierGlJournalEntry.periodLabel, period));
  if (postedByAgent) {
    if (postedByAgent === "1" || postedByAgent === "true") {
      conds.push(sql`${atelierGlJournalEntry.agentRunId} is not null`);
    } else {
      conds.push(eq(atelierGlJournalEntry.agentName, postedByAgent));
    }
  }
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

// Task #1199 — every untagged row carries its allocation proposal so the
// "Needs attention" tab can render approve/change instead of a bare picker.
// Rows never proposed yet get a deterministic (rules-only) propose pass
// inline, capped per request; the AI fallback runs via the sweep route.
const UNTAGGED_INLINE_PROPOSE_CAP = 40;
const PENDING_ALLOC = ["proposed", "needs_input"];

// @cli-skip: pending Task #340 read-parity migration
router.get("/gl/untagged", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const fetchRows = () => Promise.all([
    db.select().from(atelierInvoice).where(and(
      eq(atelierInvoice.orgId, me.orgId), isNull(atelierInvoice.legalEntityId),
      inArray(atelierInvoice.status, ["issued", "paid"]), isNull(atelierInvoice.deletedAt))).limit(100),
    // Expenses/PFIs with a pending allocation keep their row here even
    // though the propose path prefilled entityId — the human decision
    // happens on this feed.
    db.select().from(atelierExpenses).where(and(
      eq(atelierExpenses.orgId, me.orgId),
      or(isNull(atelierExpenses.entityId), inArray(atelierExpenses.allocStatus, PENDING_ALLOC)),
      inArray(atelierExpenses.status, ["approved", "reimbursed"]), isNull(atelierExpenses.deletedAt))).limit(100),
    db.select().from(atelierContractorPayments).where(and(
      eq(atelierContractorPayments.orgId, me.orgId), isNull(atelierContractorPayments.legalEntityId),
      eq(atelierContractorPayments.status, "paid"), isNull(atelierContractorPayments.deletedAt))).limit(100),
    db.select().from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, me.orgId),
      or(isNull(atelierPartnerFirmInvoices.legalEntityId), inArray(atelierPartnerFirmInvoices.allocStatus, PENDING_ALLOC)),
      eq(atelierPartnerFirmInvoices.status, "paid"), isNull(atelierPartnerFirmInvoices.deletedAt))).limit(100),
    db.select().from(atelierBankTransaction).where(and(
      eq(atelierBankTransaction.orgId, me.orgId), isNull(atelierBankTransaction.legalEntityId),
      isNull(atelierBankTransaction.deletedAt))).limit(100),
  ]);
  let [invoices, expenses, cps, pfis, txns] = await fetchRows();

  // Trigger a deterministic propose pass for rows that have no proposal
  // yet (rules only — nothing auto-applies; results land as proposed /
  // needs_input for the user to decide).
  let budget = UNTAGGED_INLINE_PROPOSE_CAP;
  let proposedAny = false;
  const sweep = async (ids: string[], run: (id: string) => Promise<unknown>) => {
    for (const id of ids) {
      if (budget <= 0) return;
      budget--;
      proposedAny = true;
      await run(id).catch(() => null);
    }
  };
  await sweep(expenses.filter((r) => r.allocStatus == null).map((r) => r.id),
    (id) => proposeExpenseAllocation(id, { allowAi: false, actorId: me.id }));
  await sweep(pfis.filter((r) => r.allocStatus == null).map((r) => r.id),
    (id) => proposeSupplierInvoiceAllocation(id, { allowAi: false, actorId: me.id }));
  await sweep(invoices.filter((r) => r.allocStatus == null).map((r) => r.id),
    (id) => proposeGlRecordAllocation("invoice", id, { allowAi: false, actorId: me.id }));
  await sweep(cps.filter((r) => r.allocStatus == null).map((r) => r.id),
    (id) => proposeGlRecordAllocation("contractor_payment", id, { allowAi: false, actorId: me.id }));
  await sweep(txns.filter((r) => r.allocStatus == null).map((r) => r.id),
    (id) => proposeGlRecordAllocation("bank_transaction", id, { allowAi: false, actorId: me.id }));
  if (proposedAny) [invoices, expenses, cps, pfis, txns] = await fetchRows();

  const alloc = (r: {
    allocStatus: string | null; allocRuleId: string | null;
    allocJustification: string | null; allocConfidence: number | null;
    allocDecidedBy: string | null;
  }, proposedEntityId: string | null) => ({
    allocStatus: r.allocStatus,
    allocRuleId: r.allocRuleId,
    allocJustification: r.allocJustification,
    allocConfidence: r.allocConfidence,
    allocDecidedBy: r.allocDecidedBy,
    proposedEntityId,
  });
  res.json({
    ok: true,
    data: {
      rows: [
        ...invoices.map((r) => ({ kind: "invoice", id: r.id, label: r.invoiceNumber ?? r.id, amount: r.total, currency: r.currency, date: r.issuedAt?.toISOString().slice(0, 10) ?? null, ...alloc(r, r.allocProposedEntityId) })),
        ...expenses.map((r) => ({ kind: "expense", id: r.id, label: `${r.merchant ?? r.category} · ${r.expenseDate}`, amount: r.usdAmount, currency: "USD", date: r.expenseDate, ...alloc(r, r.entityId) })),
        ...cps.map((r) => ({ kind: "contractor_payment", id: r.id, label: `${r.payeeName} · ${r.weekIso}`, amount: r.usdAmount, currency: "USD", date: r.paidAt?.toISOString().slice(0, 10) ?? null, ...alloc(r, r.allocProposedEntityId) })),
        ...pfis.map((r) => ({ kind: "partner_firm_invoice", id: r.id, label: `${r.partnerFirmName} · ${r.weekIso}`, amount: r.usdAmount, currency: "USD", date: r.paidAt?.toISOString().slice(0, 10) ?? null, ...alloc(r, r.legalEntityId) })),
        ...txns.map((r) => ({ kind: "bank_transaction", id: r.id, label: `${r.counterpartyNameRaw ?? "Bank txn"} · ${r.postedDate}`, amount: r.amount, currency: r.currency, date: r.postedDate, ...alloc(r, r.allocProposedEntityId) })),
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
  // Task #1095 / #1199 — manual GL tagging IS an allocation decision for
  // EVERY kind: route it through the shared decide path so period-close
  // locks, mandatory override reasons, and allocation.approve/override
  // audits all apply.
  const [posted] = await db
    .select({ periodLabel: atelierGlJournalEntry.periodLabel })
    .from(atelierGlJournalEntry)
    .where(and(
      eq(atelierGlJournalEntry.orgId, me.orgId),
      eq(atelierGlJournalEntry.sourceKind, b.kind),
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
    kind: b.kind === "partner_firm_invoice" ? "supplier_invoice" : b.kind,
    id: b.id, orgId: me.orgId,
    actor: { id: me.id, name: me.name },
    entityId: ent.id,
    overrideReason: typeof (req.body ?? {}).reason === "string" ? String((req.body as { reason?: string }).reason) : null,
  });
  if (!decided.ok) {
    const httpStatus = decided.error === "not_found" ? 404 : 400;
    return res.status(httpStatus).json({ error: decided.error, message: decided.message });
  }
  return res.json({ ok: true, data: { status: decided.status, entityId: decided.entityId } });
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
//
// Task #1202 — this route now claims the SAME org-scoped durable background-
// job lock (lockKey ENTITY_ALLOC_LOCK_KEY, targetId = orgId) that the daily
// scheduled AI sweep uses. A manual trigger and an auto tick can therefore
// never run concurrently; the caller gets 409 when a sweep is already live.
// @cli-skip: UI-workflow bulk write; founder-triggered from the GL surface
router.post("/gl/allocations/sweep", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const allowAi = (req.body ?? {}).allowAi === true;

  // Free any dead auto/manual run before attempting to claim the lock.
  // { useUpdatedAt: true } — both sweep kinds heartbeat via setInterval so a
  // still-active run keeps its updatedAt fresh and is never incorrectly reaped.
  await reapStaleRunningJob(
    [ENTITY_ALLOC_JOB_KIND, ENTITY_ALLOC_MANUAL_JOB_KIND],
    me.orgId, me.orgId, ENTITY_ALLOC_STALE_MS,
    { useUpdatedAt: true },
  );
  const jobId = await startBackgroundJob({
    orgId: me.orgId,
    userId: me.id,
    kind: ENTITY_ALLOC_MANUAL_JOB_KIND,
    lockKey: ENTITY_ALLOC_LOCK_KEY,
    targetType: "org",
    targetId: me.orgId,
    label: `Entity allocation sweep (manual${allowAi ? " + AI" : ""})`,
    resultHref: "/finance/ledger",
  });
  if (!jobId) {
    return res.status(409).json({
      error: "sweep_in_progress",
      message: "An entity allocation sweep is already running for your organisation — it will complete shortly.",
    });
  }

  // Heartbeat timer: renews the lease every 3 min independently of record
  // throughput so a slow AI call never causes the job to be reaped mid-sweep.
  // Cleared in finally so it always stops regardless of outcome.
  const heartbeatTimer = setInterval(() => {
    heartbeatBackgroundJob(jobId).catch(() => null);
  }, 3 * 60 * 1000);

  let proposed = 0, needsInput = 0;
  try {
    const [expenses, pfis, invoices, cps, txns] = await Promise.all([
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
      // Task #1199 — remaining untagged kinds join the sweep. needs_input
      // rows are retried here too when the AI fallback is on (rules alone
      // could not decide them; AI may now, still landing as proposed).
      db.select({ id: atelierInvoice.id }).from(atelierInvoice).where(and(
        eq(atelierInvoice.orgId, me.orgId),
        allowAi
          ? or(isNull(atelierInvoice.allocStatus), eq(atelierInvoice.allocStatus, "needs_input"))
          : isNull(atelierInvoice.allocStatus),
        isNull(atelierInvoice.legalEntityId),
        inArray(atelierInvoice.status, ["issued", "paid"]),
        isNull(atelierInvoice.deletedAt))).limit(100),
      db.select({ id: atelierContractorPayments.id }).from(atelierContractorPayments).where(and(
        eq(atelierContractorPayments.orgId, me.orgId),
        allowAi
          ? or(isNull(atelierContractorPayments.allocStatus), eq(atelierContractorPayments.allocStatus, "needs_input"))
          : isNull(atelierContractorPayments.allocStatus),
        isNull(atelierContractorPayments.legalEntityId),
        eq(atelierContractorPayments.status, "paid"),
        isNull(atelierContractorPayments.deletedAt))).limit(100),
      db.select({ id: atelierBankTransaction.id }).from(atelierBankTransaction).where(and(
        eq(atelierBankTransaction.orgId, me.orgId),
        allowAi
          ? or(isNull(atelierBankTransaction.allocStatus), eq(atelierBankTransaction.allocStatus, "needs_input"))
          : isNull(atelierBankTransaction.allocStatus),
        isNull(atelierBankTransaction.legalEntityId),
        isNull(atelierBankTransaction.deletedAt))).limit(100),
    ]);
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
    const glKindRows: Array<[GlProposeKind, Array<{ id: string }>]> = [
      ["invoice", invoices], ["contractor_payment", cps], ["bank_transaction", txns],
    ];
    for (const [kind, rows] of glKindRows) {
      for (const row of rows) {
        const r = await proposeGlRecordAllocation(kind, row.id, { allowAi, actorId: me.id }).catch(() => null);
        if (r?.status === "proposed") proposed++;
        else if (r?.status === "needs_input") needsInput++;
      }
    }
    const scanned = expenses.length + pfis.length + invoices.length + cps.length + txns.length;
    await audit({
      entityType: "gl", entityId: "allocation_sweep", actor: me,
      action: "allocation.propose",
      payload: { scanned, proposed, needsInput, allowAi },
      summary: `Allocation sweep: ${proposed} proposed, ${needsInput} need input (of ${scanned} scanned).`,
    });
    await completeBackgroundJob(jobId, { result: { scanned, proposed, needsInput } });
    return res.json({ ok: true, data: { scanned, proposed, needsInput } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failBackgroundJob(jobId, msg).catch(() => null);
    throw err;
  } finally {
    // Always stop the heartbeat timer so it doesn't fire after job completion.
    clearInterval(heartbeatTimer);
  }
});

// Approve / override the allocation on a queue item (period-lock aware).
// @cli-skip: UI-workflow write; allocation decisions ride the approval surfaces
router.post("/gl/allocations/:kind/:id/decide", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const kind = req.params.kind === "expense" ? "expense" as const
    : req.params.kind === "partner_firm_invoice" ? "supplier_invoice" as const
    : req.params.kind === "invoice" ? "invoice" as const
    : req.params.kind === "contractor_payment" ? "contractor_payment" as const
    : req.params.kind === "bank_transaction" ? "bank_transaction" as const
    : null;
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
