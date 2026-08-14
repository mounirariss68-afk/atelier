/**
 * Task #1091 — persona-free revenue-recognition compute core for the
 * monthly Revenue Recognizer schedule.
 *
 * The interactive path lives in `POST /revrec/schedules/compute`, which
 * runs inside `withRls(req, ...)` and stamps `createdByUserId` from the
 * caller's persona. A cron run has no persona and no request-scoped RLS
 * session, so this core reproduces the SAME deterministic computation
 * against the base `db`, scoped EXPLICITLY by `orgId`, and stamps a
 * `null` createdByUserId (system-authored). Keeping it in one place means
 * the route and the scheduler can never drift.
 *
 * Idempotent + rerun-safe: an existing frozen schedule for a
 * (period, engagement) is left untouched; an existing unfrozen one is
 * updated in place; otherwise a new row is inserted. Running the monthly
 * job twice produces the same rows.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierRevenueMethod,
  atelierRevenueSchedule,
  atelierRevenueMilestone,
  atelierTimesheetEntries,
  atelierExpenses,
} from "@workspace/db";
import { runRevenueRecognizer } from "./revenue-recognizer.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Current calendar month as a YYYY-MM period label. */
export function currentPeriodLabel(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export interface RevrecComputeResult {
  periodLabel: string;
  written: number;
  skippedFrozen: number;
}

/**
 * Compute (or refresh) revenue schedules for every active method in an
 * org for a given period. Mirrors the compute route's algorithm exactly.
 */
export async function runRevenueRecognizerForOrg(args: {
  orgId: string;
  periodLabel: string;
}): Promise<RevrecComputeResult> {
  const { orgId, periodLabel } = args;
  let written = 0;
  let skippedFrozen = 0;

  const methods = await db
    .select()
    .from(atelierRevenueMethod)
    .where(and(eq(atelierRevenueMethod.orgId, orgId), isNull(atelierRevenueMethod.deletedAt)));

  for (const m of methods) {
    const [existing] = await db
      .select()
      .from(atelierRevenueSchedule)
      .where(
        and(
          eq(atelierRevenueSchedule.orgId, orgId),
          eq(atelierRevenueSchedule.engagementId, m.engagementId),
          eq(atelierRevenueSchedule.periodLabel, periodLabel),
          isNull(atelierRevenueSchedule.deletedAt),
        ),
      )
      .limit(1);
    if (existing && existing.frozen) {
      skippedFrozen++;
      continue;
    }

    const tsRows = await db
      .select({ hours: sql<number>`COALESCE(SUM(${atelierTimesheetEntries.hours}), 0)` })
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.engagementId, m.engagementId),
          eq(atelierTimesheetEntries.billable, true),
          sql`substr(${atelierTimesheetEntries.workDate}, 1, 7) <= ${periodLabel}`,
        ),
      );
    const expRows = await db
      .select({ cost: sql<number>`COALESCE(SUM(${atelierExpenses.usdAmount}), 0)` })
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.engagementId, m.engagementId),
          sql`substr(${atelierExpenses.expenseDate}, 1, 7) <= ${periodLabel}`,
        ),
      );
    const milestonesEarned = await db
      .select()
      .from(atelierRevenueMilestone)
      .where(
        and(
          eq(atelierRevenueMilestone.engagementId, m.engagementId),
          isNull(atelierRevenueMilestone.deletedAt),
        ),
      );

    const recog = runRevenueRecognizer({
      engagementId: m.engagementId,
      periodLabel,
      method: m.method,
      plannedTotalAmount: m.plannedTotalAmount,
      plannedHours: m.plannedHours,
      plannedCost: m.plannedCost,
      ratablePeriods: m.ratablePeriods,
      activeFrom: m.activeFrom,
      hoursToDate: Number(tsRows[0]?.hours ?? 0),
      costToDate: Number(expRows[0]?.cost ?? 0),
      milestones: milestonesEarned.map((x) => ({
        id: x.id,
        status: x.status,
        plannedAmount: x.plannedAmount,
        earnedAmount: x.earnedAmount,
      })),
    });

    if (existing) {
      await db
        .update(atelierRevenueSchedule)
        .set({
          method: m.method,
          basisPct: recog.basisPct,
          recognisedAmount: recog.recognisedAmount,
          deferredBalanceEnding: recog.deferredBalanceEnding,
          currency: m.currency,
          computationInputsJson: recog.inputs,
          computedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(atelierRevenueSchedule.id, existing.id));
    } else {
      await db.insert(atelierRevenueSchedule).values({
        id: rid("sched"),
        orgId,
        engagementId: m.engagementId,
        periodLabel,
        method: m.method,
        basisPct: recog.basisPct,
        recognisedAmount: recog.recognisedAmount,
        deferredBalanceEnding: recog.deferredBalanceEnding,
        currency: m.currency,
        computationInputsJson: recog.inputs,
        createdByUserId: null, // system-authored (cron)
      });
    }
    written++;
  }

  return { periodLabel, written, skippedFrozen };
}
