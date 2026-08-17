/**
 * Task #432 — Period-close workflow + Collections routes.
 *
 *   GET    /close/cycles?entityId&periodType         list close cycles
 *   POST   /close/cycles                             start a cycle (entity + period)
 *   GET    /close/cycles/:id                         cycle + checklist + accruals
 *   POST   /close/cycles/:id/run                     run the Close Controller
 *   POST   /close/cycles/:id/items/:itemId           complete / reopen a manual item
 *   POST   /close/cycles/:id/signoff                 two-distinct-partner sign-off (2nd locks)
 *   POST   /close/accruals/:id/approve               partner approves → journal posts
 *   POST   /close/accruals/:id/reject                partner rejects proposal
 *   POST   /close/rollover                           year-end retained-earnings rollover
 *   GET    /collections/drafts?status                list collections drafts
 *   POST   /collections/run                          run the Collections Agent (drafts only)
 *   POST   /collections/drafts/:id/approve-send      human approves → email sends + dunning event
 *   POST   /collections/drafts/:id/dismiss           dismiss a draft
 *
 * Reads + writes: finance leadership (founding_partner | partner | finance),
 * same perimeter as the GL routes. Sign-off, accrual decisions and
 * approve-send of approval-gated steps require partner tier.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierUsers,
  atelierLegalEntities,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierInvoice,
  atelierDunningLadder,
  atelierDunningEvent,
  atelierPromiseToPay,
  atelierPeriodCloseLock,
  atelierCloseCycle,
  atelierCloseItem,
  atelierCloseAccrual,
  atelierCollectionsDraft,
  atelierAuditEvents,
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import { isGlPeriodLocked } from "../../lib/atelier-agents/bookkeeper.js";
import {
  runCloseController,
  postYearEndRollover,
  ensureChecklistItems,
  isValidPeriod,
  type ClosePeriodType,
} from "../../lib/atelier-agents/closeController.js";
import { runCollectionsAgent } from "../../lib/atelier-agents/collections.js";
import { runAgentExclusive } from "../../lib/atelier-agents/exclusive-runs.js";
import { sendEmail } from "../../lib/email.js";
import { buildCogniriseEmail } from "../../lib/cognirise-email-templates.js";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

export type Me = typeof atelierUsers.$inferSelect;
function ensure(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) { res.status(401).json({ error: "no-active-persona" }); return null; }
  return req.atelierPersona;
}
function isPartnerTier(me: Me): boolean {
  return me.role === "founding_partner" || me.role === "partner";
}
function isFinanceLeadership(me: Me): boolean {
  return isPartnerTier(me) || me.role === "finance";
}
function denyRead(req: Request, res: Response): Me | null {
  const me = ensure(req, res); if (!me) return null;
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role) || !isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "Period close is limited to finance leadership." });
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

const PERIOD_TYPES = new Set(["month", "quarter", "year"]);
const LOCK_MODULES = ["revrec", "gl", "bank_rec"];

async function loadCycle(id: string, orgId: string) {
  const [cycle] = await db.select().from(atelierCloseCycle)
    .where(and(eq(atelierCloseCycle.id, id), eq(atelierCloseCycle.orgId, orgId), isNull(atelierCloseCycle.deletedAt)))
    .limit(1);
  return cycle ?? null;
}

// ─────────────────────── cycles ───────────────────────

// @cli-skip: pending Task #340 read-parity migration
router.get("/close/cycles", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const entityId = String(req.query.entityId ?? "");
  const periodType = String(req.query.periodType ?? "");
  const conds = [eq(atelierCloseCycle.orgId, me.orgId), isNull(atelierCloseCycle.deletedAt)];
  if (entityId) conds.push(eq(atelierCloseCycle.entityId, entityId));
  if (PERIOD_TYPES.has(periodType)) conds.push(eq(atelierCloseCycle.periodType, periodType));
  const rows = await db.select().from(atelierCloseCycle).where(and(...conds))
    .orderBy(desc(atelierCloseCycle.periodLabel), atelierCloseCycle.entityId)
    .limit(300);
  res.json({ ok: true, data: { rows } });
});

const CycleCreateSchema = z.object({
  entityId: z.string().min(1),
  periodType: z.enum(["month", "quarter", "year"]),
  periodLabel: z.string().min(4).max(8),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/close/cycles", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const parsed = CycleCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const b = parsed.data;
  if (!isValidPeriod(b.periodType, b.periodLabel))
    return res.status(400).json({ error: "invalid_input", message: `periodLabel must be YYYY-MM / YYYY-Qn / YYYY for ${b.periodType}` });
  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, b.entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found", message: "Legal entity not found." });
  const [existing] = await db.select().from(atelierCloseCycle).where(and(
    eq(atelierCloseCycle.orgId, me.orgId),
    eq(atelierCloseCycle.entityId, b.entityId),
    eq(atelierCloseCycle.periodType, b.periodType),
    eq(atelierCloseCycle.periodLabel, b.periodLabel),
    isNull(atelierCloseCycle.deletedAt),
  ));
  if (existing) return res.json({ ok: true, data: { id: existing.id, alreadyExists: true } });
  const id = rid("clcyc");
  await db.insert(atelierCloseCycle).values({
    id, orgId: me.orgId, entityId: b.entityId, periodType: b.periodType,
    periodLabel: b.periodLabel, startedByUserId: me.id, createdByUserId: me.id,
  });
  await ensureChecklistItems({ id, orgId: me.orgId, periodType: b.periodType, periodLabel: b.periodLabel });
  await audit({ entityType: "close_cycle", entityId: id, actor: me,
    action: "close.cycle_start", payload: { ...b },
    summary: `Started ${b.periodType} close ${b.periodLabel} for ${ent.shortName || ent.legalNameEn}` });
  return res.status(201).json({ ok: true, data: { id } });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/close/cycles/:id", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const cycle = await loadCycle(req.params.id, me.orgId);
  if (!cycle) return res.status(404).json({ error: "not_found" });
  const items = await db.select().from(atelierCloseItem)
    .where(and(eq(atelierCloseItem.cycleId, cycle.id), isNull(atelierCloseItem.deletedAt)))
    .orderBy(atelierCloseItem.sortOrder);
  const accruals = await db.select().from(atelierCloseAccrual)
    .where(and(eq(atelierCloseAccrual.cycleId, cycle.id), isNull(atelierCloseAccrual.deletedAt)))
    .orderBy(desc(atelierCloseAccrual.createdAt));
  const [lock] = await db.select().from(atelierPeriodCloseLock)
    .where(and(eq(atelierPeriodCloseLock.orgId, me.orgId), eq(atelierPeriodCloseLock.periodLabel, cycle.periodLabel), isNull(atelierPeriodCloseLock.deletedAt)))
    .limit(1);
  return res.json({ ok: true, data: { cycle, items, accruals, lock: lock ?? null } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/close/cycles/:id/run", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const cycle = await loadCycle(req.params.id, me.orgId);
  if (!cycle) return res.status(404).json({ error: "not_found" });
  if (cycle.status === "signed_off")
    return res.status(409).json({ error: "signed_off", message: "This period is already signed off and locked." });
  const out = await runCloseController({
    orgId: me.orgId,
    input: {
      cycleId: cycle.id, entityId: cycle.entityId,
      periodType: cycle.periodType as ClosePeriodType, periodLabel: cycle.periodLabel,
    },
    triggeredByUserId: me.id,
  });
  await audit({ entityType: "close_cycle", entityId: cycle.id, actor: me,
    action: "close.controller_run",
    payload: { periodLabel: cycle.periodLabel, blockers: out.output.blockers.length, accrualsProposed: out.output.accrualsProposed },
    summary: `Close Controller run for ${cycle.periodLabel}: ${out.output.readyForSignoff ? "ready for sign-off" : `${out.output.blockers.length} blocker(s)`}` });
  return res.json({ ok: true, data: out.output, runId: out.runId });
});

const ItemUpdateSchema = z.object({
  status: z.enum(["done", "na", "open"]),
  note: z.string().max(500).optional(),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/close/cycles/:id/items/:itemId", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const cycle = await loadCycle(req.params.id, me.orgId);
  if (!cycle) return res.status(404).json({ error: "not_found" });
  if (cycle.status === "signed_off")
    return res.status(409).json({ error: "signed_off", message: "This period is already signed off and locked." });
  const parsed = ItemUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const [item] = await db.select().from(atelierCloseItem)
    .where(and(eq(atelierCloseItem.id, req.params.itemId), eq(atelierCloseItem.cycleId, cycle.id), isNull(atelierCloseItem.deletedAt)));
  if (!item) return res.status(404).json({ error: "not_found" });
  if (item.autoCheck)
    return res.status(400).json({ error: "auto_check_item", message: "This item is verified by the Close Controller — re-run it instead." });
  const b = parsed.data;
  await db.update(atelierCloseItem).set({
    status: b.status,
    note: b.note ?? item.note,
    completedByUserId: b.status === "open" ? null : me.id,
    completedAt: b.status === "open" ? null : new Date(),
    updatedAt: new Date(),
  }).where(eq(atelierCloseItem.id, item.id));
  await audit({ entityType: "close_item", entityId: item.id, actor: me,
    action: "close.item_update", payload: { cycleId: cycle.id, itemKey: item.itemKey, status: b.status, note: b.note ?? null },
    summary: `Close item "${item.title}" (${cycle.periodLabel}) marked ${b.status}` });
  return res.json({ ok: true });
});

// ─────────────────────── two-partner sign-off ───────────────────────

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/close/cycles/:id/signoff", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  if (!isPartnerTier(me))
    return res.status(403).json({ error: "forbidden", message: "Sign-off requires partner tier (founding_partner | partner)." });
  const cycle = await loadCycle(req.params.id, me.orgId);
  if (!cycle) return res.status(404).json({ error: "not_found" });
  if (cycle.status === "signed_off")
    return res.json({ ok: true, data: { alreadySignedOff: true } });

  // Hard block: every checklist item must be done/na and no accrual undecided.
  const items = await db.select().from(atelierCloseItem)
    .where(and(eq(atelierCloseItem.cycleId, cycle.id), isNull(atelierCloseItem.deletedAt)));
  const openItems = items.filter((i) => i.status === "open" || i.status === "blocked");
  const accruals = await db.select().from(atelierCloseAccrual)
    .where(and(eq(atelierCloseAccrual.cycleId, cycle.id), eq(atelierCloseAccrual.status, "proposed"), isNull(atelierCloseAccrual.deletedAt)));
  if (openItems.length > 0 || accruals.length > 0) {
    return res.status(409).json({
      error: "not_ready",
      message: `Sign-off is blocked: ${openItems.length} open checklist item(s), ${accruals.length} undecided accrual proposal(s).`,
      openItems: openItems.map((i) => ({ itemKey: i.itemKey, title: i.title, status: i.status })),
      undecidedAccruals: accruals.map((a) => ({ id: a.id, memo: a.memo, amount: a.amount })),
    });
  }

  if (!cycle.firstSignoffUserId) {
    await db.update(atelierCloseCycle).set({
      firstSignoffUserId: me.id, firstSignoffAt: new Date(), status: "ready", updatedAt: new Date(),
    }).where(eq(atelierCloseCycle.id, cycle.id));
    await audit({ entityType: "close_cycle", entityId: cycle.id, actor: me,
      action: "close.signoff_first", payload: { periodLabel: cycle.periodLabel },
      summary: `First sign-off on ${cycle.periodType} close ${cycle.periodLabel} — awaiting a second distinct partner` });
    return res.json({ ok: true, data: { signoff: "first", awaitingSecond: true } });
  }
  if (cycle.firstSignoffUserId === me.id)
    return res.status(409).json({ error: "distinct_partner_required", message: "The second sign-off must come from a different partner." });

  // Second distinct partner: sign off + engage the period lock.
  const now = new Date();
  await db.update(atelierCloseCycle).set({
    secondSignoffUserId: me.id, secondSignoffAt: now,
    signedOffAt: now, status: "signed_off", updatedAt: now,
  }).where(eq(atelierCloseCycle.id, cycle.id));
  const [lock] = await db.select().from(atelierPeriodCloseLock)
    .where(and(eq(atelierPeriodCloseLock.orgId, me.orgId), eq(atelierPeriodCloseLock.periodLabel, cycle.periodLabel), isNull(atelierPeriodCloseLock.deletedAt)))
    .limit(1);
  if (lock) {
    const merged = Array.from(new Set([...(lock.lockedModules ?? []), ...LOCK_MODULES]));
    await db.update(atelierPeriodCloseLock)
      .set({ lockedModules: merged, updatedAt: now })
      .where(eq(atelierPeriodCloseLock.id, lock.id));
  } else {
    await db.insert(atelierPeriodCloseLock).values({
      id: rid("pcl"), orgId: me.orgId, periodLabel: cycle.periodLabel,
      lockedModules: LOCK_MODULES, lockedByUserId: me.id, createdByUserId: me.id,
    }).onConflictDoNothing();
  }
  await audit({ entityType: "close_cycle", entityId: cycle.id, actor: me,
    action: "close.signoff_final",
    payload: { periodLabel: cycle.periodLabel, firstSignoffUserId: cycle.firstSignoffUserId, secondSignoffUserId: me.id, lockedModules: LOCK_MODULES },
    summary: `${cycle.periodType === "year" ? "Annual" : cycle.periodType === "quarter" ? "Quarterly" : "Monthly"} close ${cycle.periodLabel} signed off by two partners — period locked` });
  return res.json({ ok: true, data: { signoff: "final", locked: true, lockedModules: LOCK_MODULES } });
});

// ─────────────────────── founding-partner reopen (Task #654) ───────────────────────

const ReopenSchema = z.object({
  reason: z.string().trim().min(10, "A substantive reason (min 10 chars) is required").max(1000),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/close/cycles/:id/reopen", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  if (me.role !== "founding_partner")
    return res.status(403).json({ error: "forbidden", message: "Reopening a signed-off period requires a founding partner." });
  const cycle = await loadCycle(req.params.id, me.orgId);
  if (!cycle) return res.status(404).json({ error: "not_found" });
  if (cycle.status !== "signed_off")
    return res.status(409).json({ error: "not_signed_off", status: cycle.status, message: "Only a signed-off cycle can be reopened." });
  const parsed = ReopenSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const reason = parsed.data.reason;

  const now = new Date();
  const prior = {
    firstSignoffUserId: cycle.firstSignoffUserId,
    secondSignoffUserId: cycle.secondSignoffUserId,
    signedOffAt: cycle.signedOffAt,
  };
  await db.update(atelierCloseCycle).set({
    status: "open",
    firstSignoffUserId: null, firstSignoffAt: null,
    secondSignoffUserId: null, secondSignoffAt: null,
    signedOffAt: null, updatedAt: now,
  }).where(eq(atelierCloseCycle.id, cycle.id));

  // The period lock is org-wide per periodLabel, shared across entities:
  // only release it when no OTHER entity's cycle for the same period is
  // still signed off.
  const others = await db.select({ id: atelierCloseCycle.id }).from(atelierCloseCycle).where(and(
    eq(atelierCloseCycle.orgId, me.orgId),
    eq(atelierCloseCycle.periodLabel, cycle.periodLabel),
    eq(atelierCloseCycle.status, "signed_off"),
    isNull(atelierCloseCycle.deletedAt),
  ));
  let lockReleased = false;
  if (others.length === 0) {
    const [lock] = await db.select().from(atelierPeriodCloseLock)
      .where(and(eq(atelierPeriodCloseLock.orgId, me.orgId), eq(atelierPeriodCloseLock.periodLabel, cycle.periodLabel), isNull(atelierPeriodCloseLock.deletedAt)))
      .limit(1);
    if (lock) {
      await db.update(atelierPeriodCloseLock)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(atelierPeriodCloseLock.id, lock.id));
      lockReleased = true;
    }
  }
  await audit({ entityType: "close_cycle", entityId: cycle.id, actor: me,
    action: "close.reopen",
    payload: { periodLabel: cycle.periodLabel, entityId: cycle.entityId, reason, priorSignoffs: prior, lockReleased, otherSignedOffCycles: others.length },
    summary: `Reopened ${cycle.periodType} close ${cycle.periodLabel} (${lockReleased ? "period lock released" : "lock kept — other signed-off cycles share the period"}): ${reason}` });
  return res.json({ ok: true, data: { reopened: true, lockReleased, otherSignedOffCycles: others.length } });
});

// ─────────────────────── CT provision (Task #654) ───────────────────────

function monthsOfPeriod(periodType: string, periodLabel: string): string[] {
  if (periodType === "month") return [periodLabel];
  if (periodType === "quarter") {
    const y = periodLabel.slice(0, 4);
    const q = Number(periodLabel.slice(6));
    return [1, 2, 3].map((i) => `${y}-${String((q - 1) * 3 + i).padStart(2, "0")}`);
  }
  return Array.from({ length: 12 }, (_, i) => `${periodLabel}-${String(i + 1).padStart(2, "0")}`);
}

/** Pre-tax profit for an entity over a set of months, from posted GL journals (excludes 6950 CT expense). */
async function computePreTaxProfit(orgId: string, entityId: string, months: string[]) {
  const entries = await db.select({ id: atelierGlJournalEntry.id, periodLabel: atelierGlJournalEntry.periodLabel })
    .from(atelierGlJournalEntry)
    .where(and(
      eq(atelierGlJournalEntry.orgId, orgId),
      eq(atelierGlJournalEntry.legalEntityId, entityId),
      isNull(atelierGlJournalEntry.deletedAt),
    ));
  const monthSet = new Set(months);
  const entryIds = new Set(entries.filter((e) => monthSet.has(e.periodLabel)).map((e) => e.id));
  if (entryIds.size === 0) return { revenue: 0, expenses: 0, preTaxProfit: 0 };
  const accounts = await db.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, orgId), eq(atelierGlAccount.legalEntityId, entityId), isNull(atelierGlAccount.deletedAt),
  ));
  const typeByAcct = new Map(accounts.map((a) => [a.id, { type: a.type, code: a.code }]));
  const lines = await db.select().from(atelierGlJournalLine)
    .where(and(eq(atelierGlJournalLine.orgId, orgId), isNull(atelierGlJournalLine.deletedAt)));
  let revenue = 0, expenses = 0;
  for (const l of lines) {
    if (!entryIds.has(l.journalEntryId)) continue;
    const meta = typeByAcct.get(l.accountId);
    if (!meta) continue;
    if (meta.type === "revenue") revenue += (l.credit || 0) - (l.debit || 0);
    else if (meta.type === "expense" && meta.code !== "6950") expenses += (l.debit || 0) - (l.credit || 0);
  }
  revenue = round2(revenue); expenses = round2(expenses);
  return { revenue, expenses, preTaxProfit: round2(revenue - expenses) };
}

const CtProvisionSchema = z.object({
  ratePct: z.number().min(0).max(100).optional(),
  preview: z.boolean().optional(),
});

// Compute + record the corporate-tax provision for a close cycle as a
// non-reversing accrual proposal (Dr 6950 / Cr 2400) that then flows
// through the normal partner approve path.
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/close/cycles/:id/ct-provision", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const cycle = await loadCycle(req.params.id, me.orgId);
  if (!cycle) return res.status(404).json({ error: "not_found" });
  if (cycle.status === "signed_off")
    return res.status(409).json({ error: "signed_off", message: "This period is already signed off and locked." });
  const parsed = CtProvisionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });

  const [ent] = await db.select().from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, cycle.entityId), eq(atelierLegalEntities.orgId, me.orgId)));
  if (!ent) return res.status(404).json({ error: "not_found", message: "Legal entity not found." });
  const ratePct = parsed.data.ratePct ?? ent.fiscal?.ctRatePct ?? 9;

  const months = monthsOfPeriod(cycle.periodType, cycle.periodLabel);
  const profit = await computePreTaxProfit(me.orgId, cycle.entityId, months);
  const provision = round2(Math.max(0, profit.preTaxProfit) * (ratePct / 100));

  if (parsed.data.preview)
    return res.json({ ok: true, data: { ...profit, ratePct, provision, preview: true } });
  if (provision <= 0)
    return res.status(400).json({ error: "no_taxable_profit", ...profit, ratePct,
      message: `Pre-tax profit for ${cycle.periodLabel} is USD ${profit.preTaxProfit} — no CT provision to record. Mark the checklist item N/A instead.` });

  const lastMonth = months[months.length - 1];
  const sourceKey = "ct_provision";
  const memo = `Corporate tax provision ${cycle.periodLabel} (${ratePct}% of pre-tax profit USD ${profit.preTaxProfit})`;
  const lines = [
    { accountCode: "6950", debit: provision, credit: 0, memo: "Corporate tax expense" },
    { accountCode: "2400", debit: 0, credit: provision, memo: "Corporate tax payable" },
  ];
  const [existing] = await db.select().from(atelierCloseAccrual).where(and(
    eq(atelierCloseAccrual.cycleId, cycle.id), eq(atelierCloseAccrual.sourceKey, sourceKey), isNull(atelierCloseAccrual.deletedAt),
  )).limit(1);
  let accrualId: string;
  if (existing) {
    if (existing.status !== "proposed")
      return res.status(409).json({ error: "already_decided", status: existing.status, id: existing.id, message: "The CT provision was already decided for this cycle." });
    accrualId = existing.id;
    await db.update(atelierCloseAccrual).set({
      memo, rationaleText: `Rate ${ratePct}% applied to pre-tax profit USD ${profit.preTaxProfit} (revenue ${profit.revenue} − expenses ${profit.expenses}).`,
      amount: provision, lines, autoReverse: false, updatedAt: new Date(),
    }).where(eq(atelierCloseAccrual.id, existing.id));
  } else {
    accrualId = rid("clacc");
    await db.insert(atelierCloseAccrual).values({
      id: accrualId, orgId: me.orgId, cycleId: cycle.id, entityId: cycle.entityId,
      periodLabel: lastMonth, memo,
      rationaleText: `Rate ${ratePct}% applied to pre-tax profit USD ${profit.preTaxProfit} (revenue ${profit.revenue} − expenses ${profit.expenses}).`,
      currency: "USD", amount: provision, lines, sourceKey, autoReverse: false,
      createdByUserId: me.id,
    });
  }
  await audit({ entityType: "close_accrual", entityId: accrualId, actor: me,
    action: "close.ct_provision_propose",
    payload: { cycleId: cycle.id, periodLabel: cycle.periodLabel, ratePct, ...profit, provision },
    summary: `CT provision proposed for ${cycle.periodLabel}: USD ${provision} (${ratePct}% of pre-tax profit USD ${profit.preTaxProfit}) — awaiting partner approval` });
  return res.status(existing ? 200 : 201).json({ ok: true, data: { accrualId, ...profit, ratePct, provision, refreshed: !!existing } });
});

// ─────────────────────── accrual decisions ───────────────────────

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
/**
 * Task #1091 — shared close-accrual approve core. The REST route and the
 * Riser chat capability (finance.approve_close_accrual) BOTH run this so
 * the partner-tier gate, GL period-lock check, balance validation,
 * journal posting (+ auto-reversal) and audit never fork. Returns an
 * HTTP-shaped `{ status, body }` outcome. Covers both close accruals and
 * CT provisions (same table / status machine).
 */
export async function approveCloseAccrualCore(args: {
  me: Me;
  id: string;
  note?: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  if (!isPartnerTier(me))
    return { status: 403, body: { error: "forbidden", message: "Accrual approval requires partner tier." } };
  const [acc] = await db.select().from(atelierCloseAccrual)
    .where(and(eq(atelierCloseAccrual.id, args.id), eq(atelierCloseAccrual.orgId, me.orgId), isNull(atelierCloseAccrual.deletedAt)));
  if (!acc) return { status: 404, body: { error: "not_found" } };
  if (acc.status !== "proposed")
    return { status: 409, body: { error: "already_decided", status: acc.status, journalEntryId: acc.journalEntryId } };
  if (await isGlPeriodLocked(me.orgId, acc.periodLabel))
    return { status: 409, body: { error: "period_locked", message: `Period ${acc.periodLabel} is locked for the GL module.` } };

  const lines = acc.lines ?? [];
  const totalDebit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  if (lines.length < 2 || Math.abs(totalDebit - totalCredit) > 0.011 || totalDebit <= 0)
    return { status: 400, body: { error: "unbalanced", totalDebit, totalCredit } };

  const accounts = await db.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, me.orgId),
    eq(atelierGlAccount.legalEntityId, acc.entityId),
    isNull(atelierGlAccount.deletedAt),
  ));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  for (const l of lines) {
    if (!byCode.has(l.accountCode))
      return { status: 400, body: { error: "missing_account", accountCode: l.accountCode, message: "Seed the entity's chart of accounts first." } };
  }

  const y = Number(acc.periodLabel.slice(0, 4));
  const m = Number(acc.periodLabel.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Task #654 — approved accruals auto-post a reversing journal dated the
  // 1st of the next period. Fail loudly (409) if the next period is already
  // GL-locked rather than silently skipping the reversal.
  const nextPeriod = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`;
  if (acc.autoReverse && (await isGlPeriodLocked(me.orgId, nextPeriod)))
    return { status: 409, body: {
      error: "next_period_locked",
      message: `Cannot approve: the reversing journal would post into ${nextPeriod}, which is locked for the GL module. Reopen ${nextPeriod} first or disable auto-reverse for this accrual.`,
    } };

  const entryId = rid("gljrn");
  const reversalId = acc.autoReverse ? rid("gljrn") : null;
  await db.transaction(async (tx) => {
    await tx.insert(atelierGlJournalEntry).values({
      id: entryId, orgId: me.orgId, legalEntityId: acc.entityId,
      periodLabel: acc.periodLabel, entryDate: `${acc.periodLabel}-${String(lastDay).padStart(2, "0")}`,
      kind: "accrual", sourceKind: "close_accrual", sourceRef: acc.id,
      memo: acc.memo, currency: acc.currency, totalDebit, totalCredit, createdByUserId: me.id,
    });
    for (const l of lines) {
      const acct = byCode.get(l.accountCode)!;
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId: me.orgId, journalEntryId: entryId,
        accountId: acct.id, accountCode: acct.code, accountName: acct.name,
        debit: round2(l.debit || 0), credit: round2(l.credit || 0), memo: l.memo ?? null,
      });
    }
    if (reversalId) {
      // Reversal: same lines with debit/credit swapped, dated the 1st of
      // the next period, pointing back at the accrual entry.
      await tx.insert(atelierGlJournalEntry).values({
        id: reversalId, orgId: me.orgId, legalEntityId: acc.entityId,
        periodLabel: nextPeriod, entryDate: `${nextPeriod}-01`,
        kind: "reversal", sourceKind: "close_accrual_reversal", sourceRef: acc.id,
        memo: `Reversal of accrual: ${acc.memo}`, currency: acc.currency,
        totalDebit: totalCredit, totalCredit: totalDebit,
        reversesEntryId: entryId, createdByUserId: me.id,
      });
      for (const l of lines) {
        const acct = byCode.get(l.accountCode)!;
        await tx.insert(atelierGlJournalLine).values({
          id: rid("gljl"), orgId: me.orgId, journalEntryId: reversalId,
          accountId: acct.id, accountCode: acct.code, accountName: acct.name,
          debit: round2(l.credit || 0), credit: round2(l.debit || 0),
          memo: l.memo ? `Reversal: ${l.memo}` : null,
        });
      }
    }
    await tx.update(atelierCloseAccrual).set({
      status: "approved", journalEntryId: entryId, reversalEntryId: reversalId,
      decidedByUserId: me.id, decidedAt: new Date(),
      decisionNote: args.note ?? null,
      updatedAt: new Date(),
    }).where(eq(atelierCloseAccrual.id, acc.id));
  });
  await audit({ entityType: "close_accrual", entityId: acc.id, actor: me,
    action: "close.accrual_approve",
    payload: { cycleId: acc.cycleId, periodLabel: acc.periodLabel, amount: acc.amount, journalEntryId: entryId, reversalEntryId: reversalId, reversalPeriod: reversalId ? nextPeriod : null },
    summary: `Approved accrual "${acc.memo}" (${acc.currency} ${acc.amount}) — journal posted${reversalId ? ` with auto-reversal on ${nextPeriod}-01` : ""}` });
  return { status: 200, body: { ok: true, data: { journalEntryId: entryId, reversalEntryId: reversalId, memo: acc.memo, amount: acc.amount, currency: acc.currency, periodLabel: acc.periodLabel, isCt: acc.sourceKey === "ct_provision" } } };
}

// @cli-skip: chat parity via finance.approve_close_accrual (financeApprovalsCapabilities, #1091); REST stays authoritative
router.post("/close/accruals/:id/approve", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const out = await approveCloseAccrualCore({ me, id: req.params.id, note: (req.body as { note?: string })?.note ?? null });
  return res.status(out.status).json(out.body);
});

/** Task #1091 — shared close-accrual reject core (see approveCloseAccrualCore). */
export async function rejectCloseAccrualCore(args: {
  me: Me;
  id: string;
  note?: string | null;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  if (!isPartnerTier(me))
    return { status: 403, body: { error: "forbidden", message: "Accrual rejection requires partner tier." } };
  const [acc] = await db.select().from(atelierCloseAccrual)
    .where(and(eq(atelierCloseAccrual.id, args.id), eq(atelierCloseAccrual.orgId, me.orgId), isNull(atelierCloseAccrual.deletedAt)));
  if (!acc) return { status: 404, body: { error: "not_found" } };
  if (acc.status !== "proposed")
    return { status: 409, body: { error: "already_decided", status: acc.status } };
  await db.update(atelierCloseAccrual).set({
    status: "rejected", decidedByUserId: me.id, decidedAt: new Date(),
    decisionNote: args.note ?? null, updatedAt: new Date(),
  }).where(eq(atelierCloseAccrual.id, acc.id));
  await audit({ entityType: "close_accrual", entityId: acc.id, actor: me,
    action: "close.accrual_reject", payload: { cycleId: acc.cycleId, amount: acc.amount },
    summary: `Rejected accrual proposal "${acc.memo}"` });
  return { status: 200, body: { ok: true, memo: acc.memo, amount: acc.amount, currency: acc.currency, isCt: acc.sourceKey === "ct_provision" } };
}

// @cli-skip: chat parity via finance.reject_close_accrual (financeApprovalsCapabilities, #1091); REST stays authoritative
router.post("/close/accruals/:id/reject", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const out = await rejectCloseAccrualCore({ me, id: req.params.id, note: (req.body as { note?: string })?.note ?? null });
  return res.status(out.status).json(out.body);
});

// ─────────────────────── year-end rollover ───────────────────────

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/close/rollover", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  if (!isPartnerTier(me))
    return res.status(403).json({ error: "forbidden", message: "Year-end rollover requires partner tier." });
  const b = req.body as { entityId?: string; year?: string };
  if (!b.entityId || !b.year)
    return res.status(400).json({ error: "invalid_input", message: "entityId and year (YYYY) are required" });
  const out = await postYearEndRollover({ orgId: me.orgId, entityId: b.entityId, year: b.year, userId: me.id });
  if ("error" in out) {
    const code = out.error === "not_found" ? 404 : out.error === "period_locked" ? 409 : 400;
    return res.status(code).json({ error: out.error, message: out.message });
  }
  if (!out.alreadyPosted) {
    await audit({ entityType: "gl_journal_entry", entityId: out.journalEntryId, actor: me,
      action: "close.year_rollover",
      payload: { entityId: b.entityId, year: b.year, netIncome: out.netIncome },
      summary: `Year-end ${b.year} retained-earnings rollover posted (net income USD ${out.netIncome})` });
  }
  return res.json({ ok: true, data: out });
});

// ─────────────────────── collections ───────────────────────

// @cli-skip: pending Task #340 read-parity migration
router.get("/collections/drafts", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const status = String(req.query.status ?? "");
  const conds = [eq(atelierCollectionsDraft.orgId, me.orgId), isNull(atelierCollectionsDraft.deletedAt)];
  if (status === "draft" || status === "sent" || status === "dismissed")
    conds.push(eq(atelierCollectionsDraft.status, status));
  const rows = await db.select().from(atelierCollectionsDraft).where(and(...conds))
    .orderBy(desc(atelierCollectionsDraft.updatedAt)).limit(300);
  res.json({ ok: true, data: { rows } });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/collections/run", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const b = req.body as { asOf?: string; invoiceId?: string };
  // Task #1105 — single-flight through the SHARED per-agent lock the cron
  // scheduler also uses; a manual trigger during an in-flight run returns 409.
  const ex = await runAgentExclusive({
    agent: "collections_agent", orgId: me.orgId, userId: me.id,
    label: "Collections Agent — manual run", resultHref: "/finance/collections",
    work: () => runCollectionsAgent({
      orgId: me.orgId,
      input: { asOf: b?.asOf, invoiceId: b?.invoiceId },
      triggeredByUserId: me.id,
    }),
  });
  if (!ex.ran)
    return res.status(409).json({ error: "already_running", message: "A Collections Agent run is already in progress — try again once it finishes." });
  const out = ex.result;
  await audit({ entityType: "collections_run", entityId: out.runId, actor: me,
    action: "collections.run",
    payload: { drafts: out.output.draftsCreated, refreshed: out.output.draftsRefreshed, escalations: out.output.escalationsDrafted },
    summary: `Collections Agent run: ${out.output.draftsCreated} draft(s), ${out.output.escalationsDrafted} escalation(s) — nothing sent` });
  return res.json({ ok: true, data: out.output, runId: out.runId });
});

/**
 * Task #1091 — shared collections approve-send core. The REST route and
 * the Riser chat capability (finance.approve_send_collections) BOTH run
 * this so the partner-approval gate, the internal-escalation branch, the
 * send-time re-validation (invoice state, cadence/ladder position,
 * open promise-to-pay) and the OUTBOUND client email never fork.
 *
 * OUTBOUND note: for the client-email branch (escalation === false) the
 * chat capability wraps this in a typed-name confirm — the message leaves
 * the building. The escalation branch is internal-only (no client email).
 * Returns an HTTP-shaped `{ status, body }` outcome.
 */
export async function approveSendCollectionsDraftCore(args: {
  me: Me;
  id: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  const [draft] = await db.select().from(atelierCollectionsDraft)
    .where(and(eq(atelierCollectionsDraft.id, args.id), eq(atelierCollectionsDraft.orgId, me.orgId), isNull(atelierCollectionsDraft.deletedAt)));
  if (!draft) return { status: 404, body: { error: "not_found" } };
  if (draft.status !== "draft")
    return { status: 409, body: { error: "not_draft", status: draft.status } };
  if (draft.requireApproval && !isPartnerTier(me))
    return { status: 403, body: { error: "forbidden", message: "This step requires partner approval." } };

  // Escalations are internal: acknowledging marks them handled — no client
  // email, no dunning event.
  if (draft.escalation) {
    await db.update(atelierCollectionsDraft).set({
      status: "sent", sentAt: new Date(), sentVia: "internal",
      approvedByUserId: me.id, updatedAt: new Date(),
    }).where(eq(atelierCollectionsDraft.id, draft.id));
    await audit({ entityType: "collections_draft", entityId: draft.id, actor: me,
      action: "collections.escalation_ack",
      payload: { invoiceId: draft.invoiceId, daysOverdue: draft.daysOverdue, outstandingUsd: draft.outstandingUsd },
      summary: `Escalation acknowledged for invoice ${draft.invoiceNumber ?? draft.invoiceId}` });
    return { status: 200, body: { ok: true, data: { sentVia: "internal", escalation: true, invoiceNumber: draft.invoiceNumber } } };
  }

  // Re-validate the invoice, cadence and promise-to-pay at send time.
  const [inv] = await db.select().from(atelierInvoice)
    .where(and(eq(atelierInvoice.id, draft.invoiceId), eq(atelierInvoice.orgId, me.orgId), isNull(atelierInvoice.deletedAt)));
  if (!inv || inv.status !== "issued" || inv.voidedAt)
    return { status: 409, body: { error: "invalid_state", message: "Invoice is no longer issued/outstanding." } };
  if (round2(inv.total - inv.amountPaid) <= 0.011)
    return { status: 409, body: { error: "already_paid", message: "Invoice has no outstanding balance." } };
  const events = await db.select().from(atelierDunningEvent).where(eq(atelierDunningEvent.invoiceId, inv.id));
  if (events.length !== draft.stepIndex)
    return { status: 409, body: { error: "step_out_of_date", message: `Ladder position moved (now at step ${events.length}, draft is step ${draft.stepIndex}). Re-run the Collections Agent.` } };
  const openPromises = await db.select().from(atelierPromiseToPay)
    .where(and(eq(atelierPromiseToPay.invoiceId, inv.id), eq(atelierPromiseToPay.status, "open")));
  const now = new Date();
  const future = openPromises.find((p) => new Date(p.promisedDate).getTime() >= now.getTime());
  if (future)
    return { status: 409, body: { error: "promise_open", message: `Open promise-to-pay through ${future.promisedDate} — dunning is suppressed.` } };

  const recipient = inv.billTo?.contactEmail;
  if (!recipient)
    return { status: 400, body: { error: "no_recipient", message: "Invoice bill-to has no contact email. Add one before sending." } };

  const chase = buildCogniriseEmail({
    title: draft.subject,
    bodyHtml: `<div style="font-family:'Inter','Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#3a4360;white-space:pre-wrap;">${draft.bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`,
    footerText: "Cognirise Finance",
    bodyText: draft.bodyText,
  });
  const sendResult = await sendEmail({
    sender: { actor: { name: me.name, email: me.email } },
    to: recipient,
    subject: draft.subject,
    html: chase.html,
    text: chase.text,
    attachments: chase.attachments,
  });
  const via = sendResult.ok ? sendResult.via : "log-only";

  const eventId = rid("dun");
  await db.insert(atelierDunningEvent).values({
    id: eventId, orgId: me.orgId, invoiceId: inv.id,
    ladderId: draft.ladderId, stepIndex: draft.stepIndex,
    channel: draft.channel, template: draft.template,
    messageRef: `collections:draft/${draft.id}`, sentBy: me.id,
  });
  await db.update(atelierCollectionsDraft).set({
    status: "sent", sentAt: new Date(), sentVia: via,
    approvedByUserId: me.id, dunningEventId: eventId, updatedAt: new Date(),
  }).where(eq(atelierCollectionsDraft.id, draft.id));
  await audit({ entityType: "collections_draft", entityId: draft.id, actor: me,
    action: "collections.approve_send",
    payload: { invoiceId: inv.id, stepIndex: draft.stepIndex, recipient, via, dunningEventId: eventId },
    summary: `Approved + sent chase step ${draft.stepIndex + 1} for invoice ${inv.invoiceNumber ?? inv.id} via ${via}` });
  return { status: 200, body: { ok: true, data: { dunningEventId: eventId, via, delivered: via === "resend", recipient, invoiceNumber: inv.invoiceNumber ?? inv.id } } };
}

// @cli-skip: chat parity via finance.approve_send_collections (financeApprovalsCapabilities, #1091); REST stays authoritative
router.post("/collections/drafts/:id/approve-send", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const out = await approveSendCollectionsDraftCore({ me, id: req.params.id });
  return res.status(out.status).json(out.body);
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/collections/drafts/:id/dismiss", async (req, res) => {
  const me = denyRead(req, res); if (!me) return;
  const [draft] = await db.select().from(atelierCollectionsDraft)
    .where(and(eq(atelierCollectionsDraft.id, req.params.id), eq(atelierCollectionsDraft.orgId, me.orgId), isNull(atelierCollectionsDraft.deletedAt)));
  if (!draft) return res.status(404).json({ error: "not_found" });
  if (draft.status !== "draft")
    return res.status(409).json({ error: "not_draft", status: draft.status });
  const reason = (req.body as { reason?: string })?.reason ?? null;
  await db.update(atelierCollectionsDraft).set({
    status: "dismissed", dismissedByUserId: me.id, dismissReason: reason, updatedAt: new Date(),
  }).where(eq(atelierCollectionsDraft.id, draft.id));
  await audit({ entityType: "collections_draft", entityId: draft.id, actor: me,
    action: "collections.dismiss",
    payload: { invoiceId: draft.invoiceId, stepIndex: draft.stepIndex, reason },
    summary: `Dismissed collections draft for invoice ${draft.invoiceNumber ?? draft.invoiceId}` });
  return res.json({ ok: true });
});

export default router;
