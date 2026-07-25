/**
 * Atelier — Period-close: Close Controller agent (Task #432).
 *
 * Rule-based like the Bookkeeper: deterministic, idempotent, auditable.
 * Per close cycle (legal entity × period) it refreshes the checklist's
 * auto-check items from live data (bank match completeness, expense
 * cutoff, revrec posted, GL exceptions, AR subledger-to-GL tie), proposes
 * accrual journals (approval-gated — never posts) and reports blockers.
 * Sign-off stays a two-distinct-partner human action enforced in
 * closeRoutes.ts; the controller only measures readiness.
 *
 * Rules documented in prompts/atelier/close_controller.v1.md.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierLegalEntities,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierGlPostingException,
  atelierInvoice,
  atelierExpenses,
  atelierBankTransaction,
  atelierBankAccount,
  atelierRevenuePeriodPosting,
  atelierPeriodCloseLock,
  atelierCloseCycle,
  atelierCloseItem,
  atelierCloseAccrual,
  atelierPayrollRuns,
} from "@workspace/db";
import { runAgent } from "./runAgent.js";
// Task #655 — statutory payroll close check (rules-as-code registry).
import { resolveRules } from "../atelier-payroll/statutoryRules.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ClosePeriodType = "month" | "quarter" | "year";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const QUARTER_RE = /^\d{4}-Q[1-4]$/;
export const YEAR_RE = /^\d{4}$/;

export function isValidPeriod(periodType: ClosePeriodType, label: string): boolean {
  if (periodType === "month") return MONTH_RE.test(label);
  if (periodType === "quarter") return QUARTER_RE.test(label);
  return YEAR_RE.test(label);
}

/** Months covered by a quarter label ("2026-Q2" → ["2026-04","2026-05","2026-06"]). */
export function monthsOfQuarter(label: string): string[] {
  const y = label.slice(0, 4);
  const q = Number(label.slice(6));
  const first = (q - 1) * 3 + 1;
  return [first, first + 1, first + 2].map((m) => `${y}-${String(m).padStart(2, "0")}`);
}
export function quartersOfYear(year: string): string[] {
  return [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
}
function monthBounds(periodLabel: string): { from: string; to: string } {
  const y = Number(periodLabel.slice(0, 4));
  const m = Number(periodLabel.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { from: `${periodLabel}-01`, to: `${ny}-${String(nm).padStart(2, "0")}-01` };
}
function tsInPeriod(ts: Date | null, from: string, to: string): boolean {
  if (!ts) return false;
  const d = ts.toISOString().slice(0, 10);
  return d >= from && d < to;
}

// ============================================================
// Checklist templates
// ============================================================
export interface CloseItemTemplate {
  itemKey: string;
  phase: "pre_close" | "execution" | "post_close";
  title: string;
  ownerRole: string;
  autoCheck: boolean;
  sortOrder: number;
}

export function checklistTemplate(
  periodType: ClosePeriodType,
  periodLabel: string,
): CloseItemTemplate[] {
  if (periodType === "month") {
    return [
      { itemKey: "bank_match", phase: "pre_close", title: "Bank transactions matched or parked", ownerRole: "finance", autoCheck: true, sortOrder: 10 },
      { itemKey: "expense_cutoff", phase: "pre_close", title: "Expense cutoff — nothing awaiting approval in period", ownerRole: "finance", autoCheck: true, sortOrder: 20 },
      { itemKey: "timesheet_review", phase: "pre_close", title: "Timesheets reviewed for the period", ownerRole: "finance", autoCheck: false, sortOrder: 30 },
      { itemKey: "revrec_posted", phase: "execution", title: "Revenue recognition posted", ownerRole: "finance", autoCheck: true, sortOrder: 40 },
      { itemKey: "gl_posted", phase: "execution", title: "Bookkeeper posted — no open GL exceptions", ownerRole: "finance", autoCheck: true, sortOrder: 50 },
      { itemKey: "payroll_statutory", phase: "execution", title: "Payroll posted — salaries, statutory contributions & EOSB accrual", ownerRole: "finance", autoCheck: true, sortOrder: 55 },
      { itemKey: "ar_tie", phase: "execution", title: "AR subledger ties to GL (1100)", ownerRole: "finance", autoCheck: true, sortOrder: 60 },
      { itemKey: "accruals_decided", phase: "execution", title: "Accrual proposals decided (approved or rejected)", ownerRole: "partner", autoCheck: true, sortOrder: 70 },
      { itemKey: "management_review", phase: "post_close", title: "Management review of results", ownerRole: "partner", autoCheck: false, sortOrder: 80 },
    ];
  }
  if (periodType === "quarter") {
    const months = monthsOfQuarter(periodLabel).map((m, i) => ({
      itemKey: `month-${m}`,
      phase: "pre_close" as const,
      title: `Monthly close ${m} signed off`,
      ownerRole: "finance",
      autoCheck: true,
      sortOrder: 10 + i * 10,
    }));
    return [
      ...months,
      { itemKey: "quarterly_review", phase: "post_close", title: "Quarterly management review", ownerRole: "partner", autoCheck: false, sortOrder: 90 },
    ];
  }
  const quarters = quartersOfYear(periodLabel).map((q, i) => ({
    itemKey: `quarter-${q}`,
    phase: "pre_close" as const,
    title: `Quarterly close ${q} signed off`,
    ownerRole: "finance",
    autoCheck: true,
    sortOrder: 10 + i * 10,
  }));
  return [
    ...quarters,
    { itemKey: "retained_earnings_rollover", phase: "execution", title: "Year-end retained-earnings rollover posted", ownerRole: "finance", autoCheck: true, sortOrder: 60 },
    { itemKey: "annual_review", phase: "post_close", title: "Annual management review", ownerRole: "partner", autoCheck: false, sortOrder: 90 },
  ];
}

/** Idempotently ensure the cycle's checklist rows exist. */
export async function ensureChecklistItems(cycle: {
  id: string;
  orgId: string;
  periodType: string;
  periodLabel: string;
}): Promise<void> {
  const tmpl = checklistTemplate(cycle.periodType as ClosePeriodType, cycle.periodLabel);
  for (const t of tmpl) {
    await db
      .insert(atelierCloseItem)
      .values({
        id: rid("clitem"),
        orgId: cycle.orgId,
        cycleId: cycle.id,
        phase: t.phase,
        itemKey: t.itemKey,
        title: t.title,
        ownerRole: t.ownerRole,
        autoCheck: t.autoCheck,
        sortOrder: t.sortOrder,
      })
      .onConflictDoNothing();
  }
}

// ============================================================
// Close Controller run
// ============================================================
export interface CloseControllerInput {
  cycleId: string;
  entityId: string;
  periodType: ClosePeriodType;
  periodLabel: string;
}

export interface CloseControllerOutput {
  cycleId: string;
  periodLabel: string;
  checksRun: number;
  itemsPassed: number;
  itemsBlocked: number;
  itemsManualOpen: number;
  accrualsProposed: number;
  readyForSignoff: boolean;
  blockers: Array<{ itemKey: string; title: string; message: string }>;
  rationaleSummary: string;
}

export async function runCloseController(args: {
  orgId: string;
  input: CloseControllerInput;
  triggeredByUserId: string | null;
}): Promise<{ runId: string; output: CloseControllerOutput }> {
  const res = await runAgent<CloseControllerInput, CloseControllerOutput>(
    {
      agentId: "ag_close_controller",
      input: args.input,
      triggeredByUserId: args.triggeredByUserId,
      targetType: "close_cycle",
      targetId: args.input.cycleId,
      targetLabel: `Close ${args.input.periodLabel} (${args.input.entityId})`,
    },
    async (ctx) => {
      const output = await executeCloseController(args.orgId, args.input, ctx.runId, ctx.progress);
      return { output, confidence: output.readyForSignoff ? "green" : "amber" };
    },
  );
  return { runId: res.runId, output: res.output };
}

interface CheckResult {
  status: "done" | "blocked";
  message: string;
  detail?: Record<string, unknown>;
}

async function executeCloseController(
  orgId: string,
  input: CloseControllerInput,
  agentRunId: string,
  progress: (pct: number, msg: string) => Promise<void>,
): Promise<CloseControllerOutput> {
  const { cycleId, entityId, periodType, periodLabel } = input;
  const [cycle] = await db
    .select()
    .from(atelierCloseCycle)
    .where(and(eq(atelierCloseCycle.id, cycleId), eq(atelierCloseCycle.orgId, orgId), isNull(atelierCloseCycle.deletedAt)))
    .limit(1);
  if (!cycle) throw new Error(`close cycle ${cycleId} not found`);
  if (cycle.status === "signed_off") throw new Error("cycle already signed off");

  await ensureChecklistItems(cycle);
  await progress(10, "Checklist ensured — running checks");

  const results = new Map<string, CheckResult>();
  let accrualsProposed = 0;

  if (periodType === "month") {
    const { from, to } = monthBounds(periodLabel);

    // ── bank_match ──
    const entityBankAccounts = await db
      .select({ id: atelierBankAccount.id })
      .from(atelierBankAccount)
      .where(and(eq(atelierBankAccount.orgId, orgId), eq(atelierBankAccount.legalEntityId, entityId), isNull(atelierBankAccount.deletedAt)));
    const acctIds = entityBankAccounts.map((a) => a.id);
    const txns = acctIds.length
      ? (await db
          .select()
          .from(atelierBankTransaction)
          .where(and(
            eq(atelierBankTransaction.orgId, orgId),
            inArray(atelierBankTransaction.bankAccountId, acctIds),
            isNull(atelierBankTransaction.deletedAt),
          ))).filter((t) => t.postedDate >= from && t.postedDate < to)
      : [];
    const unmatched = txns.filter((t) => t.matchedState === "unmatched" || t.matchedState === "proposed");
    results.set("bank_match", unmatched.length === 0
      ? { status: "done", message: `${txns.length} bank transaction(s) in period, all matched/parked/journaled.`, detail: { txns: txns.length } }
      : { status: "blocked", message: `${unmatched.length} of ${txns.length} bank transaction(s) still unmatched/proposed.`, detail: { txns: txns.length, unmatched: unmatched.length } });

    // ── expense_cutoff + accrual proposal ──
    const pendingExpenses = (await db
      .select()
      .from(atelierExpenses)
      .where(and(
        eq(atelierExpenses.orgId, orgId),
        eq(atelierExpenses.status, "submitted"),
        isNull(atelierExpenses.deletedAt),
      ))).filter((x) => x.expenseDate >= from && x.expenseDate < to && (!x.entityId || x.entityId === entityId));
    const pendingTotal = round2(pendingExpenses.reduce((s, x) => s + (x.usdAmount ?? 0), 0));
    results.set("expense_cutoff", pendingExpenses.length === 0
      ? { status: "done", message: "No expenses dated in the period awaiting approval." }
      : { status: "blocked", message: `${pendingExpenses.length} expense(s) dated in the period still awaiting approval ($${pendingTotal}). Approve/reject them, or approve the proposed accrual.`, detail: { count: pendingExpenses.length, totalUsd: pendingTotal } });

    // Accrual proposal for pending expenses (approval-gated; never posted here).
    if (pendingTotal > 0.011) {
      const sourceKey = "pending_expenses";
      const [existing] = await db
        .select()
        .from(atelierCloseAccrual)
        .where(and(eq(atelierCloseAccrual.cycleId, cycleId), eq(atelierCloseAccrual.sourceKey, sourceKey), isNull(atelierCloseAccrual.deletedAt)))
        .limit(1);
      const lines = [
        { accountCode: "6900", debit: pendingTotal, credit: 0, memo: "Accrue expenses pending approval at close" },
        { accountCode: "2100", debit: 0, credit: pendingTotal, memo: "Accrued liabilities" },
      ];
      const memo = `Accrual — ${pendingExpenses.length} expense(s) dated ${periodLabel} pending approval`;
      const rationaleText = `Deterministic proposal: expenses dated inside ${periodLabel} still in "submitted" total $${pendingTotal}. Accrue Dr 6900 / Cr 2100 so the period reflects the cost; reverses naturally when the expenses post on approval.`;
      if (!existing) {
        await db.insert(atelierCloseAccrual).values({
          id: rid("clacc"), orgId, cycleId, entityId, periodLabel,
          memo, rationaleText, lines, amount: pendingTotal,
          sourceKey, proposedByRunId: agentRunId,
        });
        accrualsProposed++;
      } else if (existing.status === "proposed" && Math.abs(existing.amount - pendingTotal) > 0.011) {
        await db.update(atelierCloseAccrual)
          .set({ memo, rationaleText, lines, amount: pendingTotal, proposedByRunId: agentRunId, updatedAt: new Date() })
          .where(eq(atelierCloseAccrual.id, existing.id));
        accrualsProposed++;
      }
    }

    await progress(40, "Bank + cutoff checks done");

    // ── revrec_posted ──
    const [revPosting] = await db
      .select()
      .from(atelierRevenuePeriodPosting)
      .where(and(
        eq(atelierRevenuePeriodPosting.orgId, orgId),
        eq(atelierRevenuePeriodPosting.periodLabel, periodLabel),
        isNull(atelierRevenuePeriodPosting.deletedAt),
      ))
      .limit(1);
    results.set("revrec_posted", !revPosting
      ? { status: "done", message: "No revenue-recognition posting exists for the period (no revrec activity)." }
      : revPosting.postedAt
        ? { status: "done", message: `Revrec posted ${revPosting.postedAt.toISOString().slice(0, 10)} (${revPosting.linesCount} lines).` }
        : { status: "blocked", message: "A revenue-recognition posting exists for the period but is not posted yet." });

    // ── gl_posted ──
    const openExceptions = (await db
      .select()
      .from(atelierGlPostingException)
      .where(and(
        eq(atelierGlPostingException.orgId, orgId),
        eq(atelierGlPostingException.status, "open"),
        isNull(atelierGlPostingException.deletedAt),
      ))).filter((x) => !x.legalEntityId || x.legalEntityId === entityId);
    const entriesInPeriod = await db
      .select({ id: atelierGlJournalEntry.id })
      .from(atelierGlJournalEntry)
      .where(and(
        eq(atelierGlJournalEntry.orgId, orgId),
        eq(atelierGlJournalEntry.legalEntityId, entityId),
        eq(atelierGlJournalEntry.periodLabel, periodLabel),
        isNull(atelierGlJournalEntry.deletedAt),
      ));
    results.set("gl_posted", openExceptions.length === 0
      ? { status: "done", message: `No open GL posting exceptions. ${entriesInPeriod.length} journal entr(ies) in period.`, detail: { entries: entriesInPeriod.length } }
      : { status: "blocked", message: `${openExceptions.length} open GL posting exception(s). Resolve them (or re-run the Bookkeeper) before close.`, detail: { openExceptions: openExceptions.length } });

    await progress(60, "GL checks done");

    // ── ar_tie: GL 1100 cumulative balance vs issued-invoice outstanding ──
    const arLines = await db
      .select({
        debit: atelierGlJournalLine.debit,
        credit: atelierGlJournalLine.credit,
        periodLabel: atelierGlJournalEntry.periodLabel,
      })
      .from(atelierGlJournalLine)
      .innerJoin(atelierGlJournalEntry, eq(atelierGlJournalLine.journalEntryId, atelierGlJournalEntry.id))
      .where(and(
        eq(atelierGlJournalEntry.orgId, orgId),
        eq(atelierGlJournalEntry.legalEntityId, entityId),
        eq(atelierGlJournalLine.accountCode, "1100"),
        isNull(atelierGlJournalEntry.deletedAt),
      ));
    const glAr = round2(arLines
      .filter((l) => l.periodLabel <= periodLabel)
      .reduce((s, l) => s + l.debit - l.credit, 0));
    const invoices = (await db
      .select()
      .from(atelierInvoice)
      .where(and(
        eq(atelierInvoice.orgId, orgId),
        inArray(atelierInvoice.status, ["issued", "paid"]),
        isNull(atelierInvoice.deletedAt),
      ))).filter((i) => !i.voidedAt
        && (!i.legalEntityId || i.legalEntityId === entityId)
        && i.issuedAt && i.issuedAt.toISOString().slice(0, 10) < to);
    const subAr = round2(invoices.reduce((s, i) => s + Math.max(0, i.total - i.amountPaid), 0));
    const glActivity = arLines.length > 0;
    const delta = round2(glAr - subAr);
    results.set("ar_tie", !glActivity && subAr === 0
      ? { status: "done", message: "No AR activity in GL or subledger — nothing to tie." }
      : Math.abs(delta) <= 0.011
        ? { status: "done", message: `AR ties: GL 1100 $${glAr} = subledger outstanding $${subAr}.`, detail: { glAr, subAr } }
        : { status: "blocked", message: `AR does not tie: GL 1100 $${glAr} vs subledger outstanding $${subAr} (Δ $${delta}). Re-run the Bookkeeper or investigate unposted receipts.`, detail: { glAr, subAr, delta } });

    // ── payroll_statutory (Task #655) ──
    // For countries with statutory rules, the month's payroll run must be
    // posted (salaries + contributions + EOSB accrual in the GL). Countries
    // without seeded rules pass as not-applicable.
    const [closeEntity] = await db
      .select()
      .from(atelierLegalEntities)
      .where(and(eq(atelierLegalEntities.orgId, orgId), eq(atelierLegalEntities.id, entityId)))
      .limit(1);
    const statRules = closeEntity ? resolveRules(closeEntity.country, `${periodLabel}-28`) : null;
    if (!statRules) {
      results.set("payroll_statutory", {
        status: "done",
        message: closeEntity
          ? `No statutory payroll rules seeded for ${closeEntity.country} — not applicable.`
          : "Entity not found in the registry — not applicable.",
      });
    } else {
      const [payRun] = await db
        .select()
        .from(atelierPayrollRuns)
        .where(and(
          eq(atelierPayrollRuns.orgId, orgId),
          eq(atelierPayrollRuns.legalEntityId, entityId),
          eq(atelierPayrollRuns.periodLabel, periodLabel),
          isNull(atelierPayrollRuns.deletedAt),
        ))
        .limit(1);
      results.set("payroll_statutory", payRun?.status === "posted"
        ? { status: "done", message: `Payroll ${periodLabel} posted (${payRun.totals.headcount} people; EOSB accrual ${payRun.totals.eosbAccrual} ${payRun.currency}).`, detail: { runId: payRun.id } }
        : payRun
          ? { status: "blocked", message: `Payroll run for ${periodLabel} is still draft — post it (or resolve its validation errors) before close.`, detail: { runId: payRun.id } }
          : { status: "blocked", message: `No payroll run exists for ${periodLabel} — compute and post it from Finance → Payroll.` });
    }

    // ── accruals_decided ──
    const undecided = await db
      .select({ id: atelierCloseAccrual.id })
      .from(atelierCloseAccrual)
      .where(and(eq(atelierCloseAccrual.cycleId, cycleId), eq(atelierCloseAccrual.status, "proposed"), isNull(atelierCloseAccrual.deletedAt)));
    results.set("accruals_decided", undecided.length === 0
      ? { status: "done", message: "No accrual proposals awaiting a decision." }
      : { status: "blocked", message: `${undecided.length} accrual proposal(s) awaiting partner approval/rejection.`, detail: { undecided: undecided.length } });
  } else {
    // ── quarter / year rollup checks ──
    const childType = periodType === "quarter" ? "month" : "quarter";
    const childLabels = periodType === "quarter" ? monthsOfQuarter(periodLabel) : quartersOfYear(periodLabel);
    const children = await db
      .select()
      .from(atelierCloseCycle)
      .where(and(
        eq(atelierCloseCycle.orgId, orgId),
        eq(atelierCloseCycle.entityId, entityId),
        eq(atelierCloseCycle.periodType, childType),
        inArray(atelierCloseCycle.periodLabel, childLabels),
        isNull(atelierCloseCycle.deletedAt),
      ));
    const byLabel = new Map(children.map((c) => [c.periodLabel, c]));
    for (const label of childLabels) {
      const key = `${childType}-${label}`;
      const child = byLabel.get(label);
      results.set(key, child?.status === "signed_off"
        ? { status: "done", message: `${label} signed off ${child.signedOffAt?.toISOString().slice(0, 10) ?? ""}.` }
        : { status: "blocked", message: child ? `${label} close is ${child.status} — sign it off first.` : `${label} close has not been started.` });
    }
    if (periodType === "year") {
      const [rollover] = await db
        .select()
        .from(atelierGlJournalEntry)
        .where(and(
          eq(atelierGlJournalEntry.orgId, orgId),
          eq(atelierGlJournalEntry.legalEntityId, entityId),
          eq(atelierGlJournalEntry.sourceKind, "year_close"),
          eq(atelierGlJournalEntry.sourceRef, `${entityId}:${periodLabel}`),
          isNull(atelierGlJournalEntry.deletedAt),
        ))
        .limit(1);
      results.set("retained_earnings_rollover", rollover
        ? { status: "done", message: `Rollover journal posted (${rollover.id}).`, detail: { journalEntryId: rollover.id } }
        : { status: "blocked", message: "Year-end retained-earnings rollover journal has not been posted." });
    }
  }

  await progress(80, "Persisting check results");

  // Persist auto-check results (manual items untouched except detail refresh).
  const items = await db
    .select()
    .from(atelierCloseItem)
    .where(and(eq(atelierCloseItem.cycleId, cycleId), isNull(atelierCloseItem.deletedAt)));
  let itemsPassed = 0;
  let itemsBlocked = 0;
  let itemsManualOpen = 0;
  const blockers: Array<{ itemKey: string; title: string; message: string }> = [];
  for (const item of items) {
    if (item.autoCheck) {
      const r = results.get(item.itemKey);
      if (!r) continue;
      await db.update(atelierCloseItem)
        .set({
          status: r.status,
          detail: { message: r.message, ...(r.detail ?? {}) },
          lastCheckedAt: new Date(),
          completedAt: r.status === "done" ? new Date() : null,
          completedByUserId: r.status === "done" ? null : item.completedByUserId,
          updatedAt: new Date(),
        })
        .where(eq(atelierCloseItem.id, item.id));
      if (r.status === "done") itemsPassed++;
      else {
        itemsBlocked++;
        blockers.push({ itemKey: item.itemKey, title: item.title, message: r.message });
      }
    } else if (item.status === "open" || item.status === "blocked") {
      itemsManualOpen++;
      blockers.push({ itemKey: item.itemKey, title: item.title, message: "Manual item awaiting completion." });
    } else if (item.status === "done" || item.status === "na") {
      itemsPassed++;
    }
  }

  const readyForSignoff = itemsBlocked === 0 && itemsManualOpen === 0;
  const summary: Record<string, unknown> = {
    checksRun: results.size,
    itemsPassed,
    itemsBlocked,
    itemsManualOpen,
    readyForSignoff,
    blockers,
    lastControllerRunAt: new Date().toISOString(),
  };
  await db.update(atelierCloseCycle)
    .set({
      controllerRunId: agentRunId,
      summary,
      status: cycle.status === "signed_off" ? cycle.status : readyForSignoff ? "ready" : "open",
      updatedAt: new Date(),
    })
    .where(eq(atelierCloseCycle.id, cycleId));

  await progress(95, "Done");
  return {
    cycleId,
    periodLabel,
    checksRun: results.size,
    itemsPassed,
    itemsBlocked,
    itemsManualOpen,
    accrualsProposed,
    readyForSignoff,
    blockers,
    rationaleSummary: readyForSignoff
      ? `All ${results.size} deterministic checks pass and no manual items remain — ${periodLabel} is ready for two-partner sign-off.`
      : `${blockers.length} blocker(s) remain for ${periodLabel}: ${blockers.map((b) => b.itemKey).join(", ")}. Sign-off is hard-blocked until they clear.`,
  };
}

// ============================================================
// Year-end retained-earnings rollover (Task #432 deliverable 5)
// ============================================================
// Closes every revenue + expense account's cumulative-year balance into
// Retained earnings (3100) with a single balanced "closing" journal dated
// 31 Dec. Idempotent via sourceKind/sourceRef. Deliberately exempt from
// the monthly GL lock (monthly closes precede year-end), but refuses to
// post once the ANNUAL lock (periodLabel = YYYY) covers the GL module.
export async function postYearEndRollover(args: {
  orgId: string;
  entityId: string;
  year: string; // YYYY
  userId: string;
}): Promise<{ journalEntryId: string; netIncome: number; alreadyPosted: boolean } | { error: string; message: string }> {
  const { orgId, entityId, year, userId } = args;
  if (!YEAR_RE.test(year)) return { error: "invalid_input", message: "year must be YYYY" };

  const [annualLock] = await db
    .select()
    .from(atelierPeriodCloseLock)
    .where(and(eq(atelierPeriodCloseLock.orgId, orgId), eq(atelierPeriodCloseLock.periodLabel, year), isNull(atelierPeriodCloseLock.deletedAt)))
    .limit(1);
  if (annualLock && (annualLock.lockedModules ?? []).includes("gl"))
    return { error: "period_locked", message: `Year ${year} is annually locked for the GL module.` };

  const sourceRef = `${entityId}:${year}`;
  const [existing] = await db
    .select()
    .from(atelierGlJournalEntry)
    .where(and(
      eq(atelierGlJournalEntry.orgId, orgId),
      eq(atelierGlJournalEntry.sourceKind, "year_close"),
      eq(atelierGlJournalEntry.sourceRef, sourceRef),
      isNull(atelierGlJournalEntry.deletedAt),
    ))
    .limit(1);
  if (existing) return { journalEntryId: existing.id, netIncome: 0, alreadyPosted: true };

  const [entity] = await db
    .select()
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.id, entityId), eq(atelierLegalEntities.orgId, orgId)))
    .limit(1);
  if (!entity) return { error: "not_found", message: "Legal entity not found." };

  const accounts = await db
    .select()
    .from(atelierGlAccount)
    .where(and(eq(atelierGlAccount.orgId, orgId), eq(atelierGlAccount.legalEntityId, entityId), isNull(atelierGlAccount.deletedAt)));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const re = byCode.get("3100");
  if (!re) return { error: "missing_account", message: "Retained earnings (3100) is not in this entity's chart. Seed the chart first." };

  // Net P&L account balances for the year (exclude prior closing entries).
  const lines = await db
    .select({
      accountCode: atelierGlJournalLine.accountCode,
      debit: atelierGlJournalLine.debit,
      credit: atelierGlJournalLine.credit,
      periodLabel: atelierGlJournalEntry.periodLabel,
      kind: atelierGlJournalEntry.kind,
    })
    .from(atelierGlJournalLine)
    .innerJoin(atelierGlJournalEntry, eq(atelierGlJournalLine.journalEntryId, atelierGlJournalEntry.id))
    .where(and(
      eq(atelierGlJournalEntry.orgId, orgId),
      eq(atelierGlJournalEntry.legalEntityId, entityId),
      isNull(atelierGlJournalEntry.deletedAt),
    ));
  const yearLines = lines.filter((l) => l.periodLabel.startsWith(`${year}-`) && l.kind !== "closing");
  const netByCode = new Map<string, number>();
  for (const l of yearLines) {
    const acct = byCode.get(l.accountCode);
    if (!acct || (acct.type !== "revenue" && acct.type !== "expense")) continue;
    netByCode.set(l.accountCode, round2((netByCode.get(l.accountCode) ?? 0) + l.debit - l.credit));
  }

  const closingLines: Array<{ code: string; debit: number; credit: number; memo: string }> = [];
  let netIncome = 0; // credit-positive
  for (const [code, net] of netByCode) {
    if (Math.abs(net) <= 0.005) continue;
    // net = Dr - Cr. Reverse it: revenue (credit balance, net<0) → debit; expense → credit.
    if (net < 0) closingLines.push({ code, debit: round2(-net), credit: 0, memo: "Close to retained earnings" });
    else closingLines.push({ code, debit: 0, credit: net, memo: "Close to retained earnings" });
    netIncome = round2(netIncome - net);
  }
  if (closingLines.length === 0)
    return { error: "nothing_to_close", message: `No P&L activity found for ${year} — nothing to roll over.` };
  // Plug to retained earnings: netIncome > 0 → credit 3100.
  if (netIncome > 0) closingLines.push({ code: "3100", debit: 0, credit: netIncome, memo: `Net income ${year}` });
  else if (netIncome < 0) closingLines.push({ code: "3100", debit: round2(-netIncome), credit: 0, memo: `Net loss ${year}` });

  const totalDebit = round2(closingLines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(closingLines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.011)
    return { error: "unbalanced", message: `Computed closing entry does not balance (Dr ${totalDebit} vs Cr ${totalCredit}).` };

  const entryId = rid("gljrn");
  await db.transaction(async (tx) => {
    await tx.insert(atelierGlJournalEntry).values({
      id: entryId, orgId, legalEntityId: entityId,
      periodLabel: `${year}-12`, entryDate: `${year}-12-31`, kind: "closing",
      sourceKind: "year_close", sourceRef,
      memo: `Year-end close ${year} — roll P&L into retained earnings`,
      currency: "USD", totalDebit, totalCredit, createdByUserId: userId,
    });
    for (const l of closingLines) {
      const acct = byCode.get(l.code)!;
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId, journalEntryId: entryId,
        accountId: acct.id, accountCode: acct.code, accountName: acct.name,
        debit: l.debit, credit: l.credit, memo: l.memo,
      });
    }
  });
  return { journalEntryId: entryId, netIncome, alreadyPosted: false };
}
