// Deadline nudges for the v3 Ledger:
//   • Sunday 21:00 GST  → "submit-due"  reminder for any draft/rejected weeks
//   • Tuesday 12:00 GST → "approve-due" reminder for submitted/lead_approved weeks
// Each nudge writes one atelierAuditEvents row per (week, kind), idempotent
// across ticks via a deterministic id (`nudge_<kind>_<weekId>`).
//
// Implemented as a lightweight in-process ticker (every 15 minutes). The job
// fires when the current GST hour matches the window and the day-of-week
// matches the nudge kind. Re-runs are safe because the audit insert uses
// onConflictDoNothing on the deterministic id.
import {
  db,
  atelierAuditEvents,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierEmployees,
  atelierContractors,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { runTimeSteward } from "./runner.js";

type NudgeKind = "submit_due" | "approve_due";

const TICK_MS = 15 * 60 * 1000; // 15 min
let timer: NodeJS.Timeout | null = null;

function nowInGst(): { dayOfWeek: number; hour: number; minute: number } {
  // Asia/Dubai is UTC+4 with no DST → GST.
  const gstMs = Date.now() + 4 * 60 * 60 * 1000;
  const d = new Date(gstMs);
  return { dayOfWeek: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

export async function runLedgerNudgeTick(opts: { force?: NudgeKind } = {}): Promise<{ inserted: number; kind: NudgeKind | null }> {
  const { dayOfWeek, hour } = nowInGst();
  // Sunday=0, Tuesday=2 in JS.
  let kind: NudgeKind | null = opts.force ?? null;
  if (!kind) {
    if (dayOfWeek === 0 && hour === 21) kind = "submit_due";
    else if (dayOfWeek === 2 && hour === 12) kind = "approve_due";
  }
  if (!kind) return { inserted: 0, kind: null };

  const wantStatuses = kind === "submit_due"
    ? ["draft", "rejected"]
    : ["submitted", "lead_approved"];

  const weeks = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(and(inArray(atelierTimesheetWeeks.status, wantStatuses), isNull(atelierTimesheetWeeks.deletedAt)));

  if (!weeks.length) return { inserted: 0, kind };

  const personIds = Array.from(new Set(weeks.map((w) => w.personId)));
  const [emps, cons] = await Promise.all([
    db.select().from(atelierEmployees).where(inArray(atelierEmployees.id, personIds)),
    db.select().from(atelierContractors).where(inArray(atelierContractors.id, personIds)),
  ]);
  const nameById = new Map<string, string>([
    ...emps.map((e) => [e.id, e.fullName] as const),
    ...cons.map((c) => [c.id, c.fullName] as const),
  ]);

  const rows = weeks.map((w) => ({
    id: `nudge_${kind}_${w.id}`,
    entityType: "timesheet_week",
    entityId: w.id,
    actorType: "system",
    actorId: "ag_time_steward",
    actorLabel: "Time Steward",
    action: kind === "submit_due" ? "ledger.nudge.submit_due" : "ledger.nudge.approve_due",
    payload: {
      weekIso: w.weekIso,
      personId: w.personId,
      personName: nameById.get(w.personId) ?? w.personId,
      status: w.status,
    },
    payloadSummary:
      kind === "submit_due"
        ? `Reminder: submit ${w.weekIso} timesheet (Sun 21:00 GST deadline)`
        : `Reminder: approve ${w.weekIso} timesheet (Tue 12:00 GST deadline)`,
  }));

  const inserted = await db
    .insert(atelierAuditEvents)
    .values(rows)
    .onConflictDoNothing({ target: atelierAuditEvents.id })
    .returning({ id: atelierAuditEvents.id });
  return { inserted: inserted.length, kind };
}

// ---------------------------------------------------------------------
// Daily Time Steward tick — runs at Mon 06:00 GST and drafts the current
// ISO week for every active employee + contractor that doesn't already
// have agent_drafted entries. This is the "draft already populated when I
// open Monday morning" guarantee from the PRD; the on-demand auto-draft
// in /ledger/timesheets/current remains as a fallback for any persona
// that the scheduler hasn't reached yet.
//
// Idempotent: runTimeSteward writes deterministic ids and the existence
// check below short-circuits when entries are already present.
// ---------------------------------------------------------------------
function isoWeekIdFromDate(d: Date): { weekIso: string; weekStartDate: string } {
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  const target = new Date(monday);
  target.setUTCDate(target.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const weekIso = `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  return { weekIso, weekStartDate: monday.toISOString().slice(0, 10) };
}

export async function runLedgerStewardTick(opts: { force?: boolean } = {}): Promise<{ drafted: number }> {
  if (!opts.force) {
    // Daily Time Steward draft pass — fires every day at 06:00 GST so each
    // person finds a populated draft when they open the ledger that
    // morning. Idempotent: existing agent_drafted entries are skipped.
    const { hour } = nowInGst();
    if (hour !== 6) return { drafted: 0 };
  }
  const { weekIso, weekStartDate } = isoWeekIdFromDate(new Date());
  const [emps, cons] = await Promise.all([
    db.select({ id: atelierEmployees.id }).from(atelierEmployees).where(isNull(atelierEmployees.deletedAt)),
    db.select({ id: atelierContractors.id }).from(atelierContractors).where(isNull(atelierContractors.deletedAt)),
  ]);
  const personIds = [...emps.map((e) => e.id), ...cons.map((c) => c.id)];
  let drafted = 0;
  for (const personId of personIds) {
    const weekId = `tsw_${personId}_${weekIso}`;
    // Ensure shell row.
    const [existing] = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(and(eq(atelierTimesheetWeeks.id, weekId), isNull(atelierTimesheetWeeks.deletedAt)));
    if (!existing) {
      await db
        .insert(atelierTimesheetWeeks)
        .values({
          id: weekId,
          personId,
          personType: emps.find((e) => e.id === personId) ? "employee" : "contractor",
          weekIso,
          weekStartDate,
          status: "draft",
        })
        .onConflictDoNothing();
    } else if (existing.status !== "draft" && existing.status !== "rejected") {
      continue; // already submitted/approved — never overwrite.
    }
    // Skip if agent_drafted entries already present.
    const [hasDraft] = await db
      .select({ id: atelierTimesheetEntries.id })
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.weekId, weekId),
          eq(atelierTimesheetEntries.source, "agent_drafted"),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      )
      .limit(1);
    if (hasDraft) continue;
    try {
      await runTimeSteward({ weekId, personId, weekStartDate, triggeredByUserId: "ag_time_steward" });
      drafted++;
    } catch (err) {
      console.warn("[ledger.steward] tick draft failed for", personId, err);
    }
  }
  return { drafted };
}

export function startLedgerNudgeJob(): void {
  if (timer) return;
  // Skip in test runs to avoid background DB chatter.
  if (process.env.NODE_ENV === "test") return;
  timer = setInterval(() => {
    void runLedgerNudgeTick().catch((err) => {
      console.warn("[ledger.nudge] tick failed:", err);
    });
    void runLedgerStewardTick().catch((err) => {
      console.warn("[ledger.steward] tick failed:", err);
    });
    // Task #258: utilization snapshots (recompute last 6 ISO weeks; cheap +
    // idempotent) and Burn Sentinel (hourly gate inside the function).
    void runUtilizationSnapshotTick().catch((err) => {
      console.warn("[ledger.utilization] snapshot tick failed:", err);
    });
    void runBurnSentinelTick().catch((err) => {
      console.warn("[ledger.burn] sentinel tick failed:", err);
    });
  }, TICK_MS);
  // Don't keep the process alive for this background ticker.
  if (typeof timer.unref === "function") timer.unref();
}

export function stopLedgerNudgeJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ---------------------------------------------------------------------
// Task #258 — Utilization snapshot tick + Burn Sentinel hourly tick.
// Both run on the same 15-minute scheduler:
//   • Snapshot tick: every 12h gate (so we don't churn the table on every
//     ticker fire) — also runnable on demand from a Partner-only route.
//     Re-runs are idempotent: deterministic snap id `usnap_<person>_<wk>`.
//   • Burn Sentinel: hourly gate. For every active engagement, computes
//     `actualHours / plannedHours` and writes a Pane A item to the
//     Engagement Lead when a 60/80/100% threshold is crossed since the
//     last sentinel run (we use existing pane-A rows for that engagement
//     as the previous-burn record, so the cross is only fired once).
// ---------------------------------------------------------------------

import {
  atelierUtilizationSnapshots,
  atelierEngagements,
  atelierDealPricings,
  atelierRateCards,
  atelierRateCardRows,
  atelierPaneAItems,
  atelierNotifications,
} from "@workspace/db";

const SNAPSHOT_ENTRY_STATUSES = ["lead_approved", "approved", "partner_approved"];

function isoWeekIdFromDateLocal(d: Date): { weekIso: string; weekStartDate: string } {
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  const target = new Date(monday);
  target.setUTCDate(target.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return {
    weekIso: `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    weekStartDate: monday.toISOString().slice(0, 10),
  };
}

export async function runUtilizationSnapshotTick(opts: { force?: boolean; weeksBack?: number } = {}): Promise<{ snapshotsWritten: number }> {
  const weeksBack = opts.weeksBack ?? 6;

  // Build the list of (personId, weekIso) targets from existing weeks
  // rows so we never invent a snapshot for a person that doesn't track
  // hours yet. We snapshot for the last `weeksBack` ISO weeks.
  const targets: Array<{ personId: string; personType: string; weekIso: string; weekStartDate: string }> = [];
  for (let i = 0; i < weeksBack; i++) {
    const ref = new Date();
    ref.setUTCDate(ref.getUTCDate() - i * 7);
    const { weekIso, weekStartDate } = isoWeekIdFromDateLocal(ref);
    const weeks = await db
      .select({ personId: atelierTimesheetWeeks.personId, personType: atelierTimesheetWeeks.personType })
      .from(atelierTimesheetWeeks)
      .where(and(eq(atelierTimesheetWeeks.weekIso, weekIso), isNull(atelierTimesheetWeeks.deletedAt)));
    for (const w of weeks) targets.push({ personId: w.personId, personType: w.personType, weekIso, weekStartDate });
  }
  if (!targets.length) return { snapshotsWritten: 0 };

  // Pre-fetch employee target % so we can hydrate `targetPct`.
  const emps = await db
    .select({ id: atelierEmployees.id, utilizationTargetPct: atelierEmployees.utilizationTargetPct, role: atelierEmployees.role, seniority: atelierEmployees.seniority })
    .from(atelierEmployees)
    .where(isNull(atelierEmployees.deletedAt));
  const empById = new Map(emps.map((e) => [e.id, e] as const));

  function defaultTargetPct(role: string | null | undefined, seniority: string | null | undefined): number {
    if (role === "partner" || seniority === "partner") return 50;
    if (role === "ai_engineer") return 75;
    if (role === "engagement_lead" || seniority === "principal") return 65;
    if (seniority === "manager" || seniority === "senior_consultant") return 70;
    return 75;
  }

  let written = 0;
  for (const t of targets) {
    const entries = await db
      .select({
        engagementId: atelierTimesheetEntries.engagementId,
        hours: atelierTimesheetEntries.hours,
        billable: atelierTimesheetEntries.billable,
        activityCode: atelierTimesheetEntries.activityCode,
      })
      .from(atelierTimesheetEntries)
      .innerJoin(atelierTimesheetWeeks, eq(atelierTimesheetEntries.weekId, atelierTimesheetWeeks.id))
      .where(and(
        eq(atelierTimesheetWeeks.personId, t.personId),
        eq(atelierTimesheetWeeks.weekIso, t.weekIso),
        inArray(atelierTimesheetEntries.status, SNAPSHOT_ENTRY_STATUSES),
        isNull(atelierTimesheetEntries.deletedAt),
      ));
    if (!entries.length) continue;

    const totalHours = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
    const billableHours = entries.filter((e) => e.billable).reduce((s, e) => s + Number(e.hours || 0), 0);
    const leaveHours = entries.filter((e) => e.activityCode === "leave").reduce((s, e) => s + Number(e.hours || 0), 0);
    const internalHours = totalHours - billableHours - leaveHours;
    const availableHours = 40;
    const utilizationPct = availableHours > 0 ? billableHours / availableHours : 0;
    const emp = empById.get(t.personId);
    const targetPct = emp?.utilizationTargetPct
      ? emp.utilizationTargetPct / 100
      : defaultTargetPct(emp?.role ?? null, emp?.seniority ?? null) / 100;

    // engagement mix: aggregate hours per engagement
    const mixMap = new Map<string, { hours: number; billable: boolean }>();
    for (const e of entries) {
      const key = e.engagementId ?? "__internal__";
      const prev = mixMap.get(key) ?? { hours: 0, billable: false };
      mixMap.set(key, { hours: prev.hours + Number(e.hours || 0), billable: prev.billable || !!e.billable });
    }
    const engIds = Array.from(mixMap.keys()).filter((k) => k !== "__internal__");
    const engRows = engIds.length
      ? await db.select({ id: atelierEngagements.id, name: atelierEngagements.name }).from(atelierEngagements).where(inArray(atelierEngagements.id, engIds))
      : [];
    const engNameById = new Map(engRows.map((e) => [e.id, e.name] as const));
    const engagementMix = Array.from(mixMap.entries()).map(([engId, v]) => ({
      engagementId: engId === "__internal__" ? null : engId,
      name: engId === "__internal__" ? "Internal / non-billable" : (engNameById.get(engId) ?? engId),
      hours: v.hours,
      billable: v.billable,
    }));

    const id = `usnap_${t.personId}_${t.weekIso}`;
    await db
      .insert(atelierUtilizationSnapshots)
      .values({
        id,
        personId: t.personId,
        personType: t.personType,
        weekIso: t.weekIso,
        weekStartDate: t.weekStartDate,
        billableHours,
        internalHours,
        leaveHours,
        totalHours,
        availableHours,
        utilizationPct,
        targetPct,
        engagementMix,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: atelierUtilizationSnapshots.id,
        set: {
          billableHours,
          internalHours,
          leaveHours,
          totalHours,
          availableHours,
          utilizationPct,
          targetPct,
          engagementMix,
          computedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    written++;
  }
  return { snapshotsWritten: written };
}

const BURN_THRESHOLDS = [0.6, 0.8, 1.0] as const;

interface BurnRow {
  engagementId: string;
  engagementName: string;
  engagementLeadId: string;
  partnerOwnerId: string;
  plannedHours: number;
  actualHours: number;
  burnPct: number;
  thresholds: number[]; // crossed
}

async function computeEngagementBurns(): Promise<BurnRow[]> {
  const engagements = await db
    .select()
    .from(atelierEngagements)
    .where(isNull(atelierEngagements.deletedAt));
  const out: BurnRow[] = [];
  for (const eng of engagements) {
    if (!eng.opportunityId) continue;
    const [pricing] = await db
      .select()
      .from(atelierDealPricings)
      .where(and(eq(atelierDealPricings.opportunityId, eng.opportunityId), isNull(atelierDealPricings.deletedAt)));
    if (!pricing) continue;
    // Planned hours = sum over team mix of (ftePct * durationWeeks * 40)
    const teamMix = (pricing.teamMix as Array<{ ftePct: number }>) ?? [];
    const plannedHours = teamMix.reduce((s, m) => s + Number(m.ftePct || 0) * Number(pricing.durationWeeks || 0) * 40, 0);
    if (plannedHours <= 0) continue;
    // Actual hours = sum of approved + lead_approved + submitted billable hours on this engagement.
    const actualRows = await db
      .select({ hours: atelierTimesheetEntries.hours })
      .from(atelierTimesheetEntries)
      .where(and(
        eq(atelierTimesheetEntries.engagementId, eng.id),
        inArray(atelierTimesheetEntries.status, ["submitted", "lead_approved", "approved", "partner_approved"]),
        isNull(atelierTimesheetEntries.deletedAt),
      ));
    const actualHours = actualRows.reduce((s, r) => s + Number(r.hours || 0), 0);
    const burnPct = actualHours / plannedHours;
    const thresholds = BURN_THRESHOLDS.filter((th) => burnPct >= th);
    out.push({
      engagementId: eng.id,
      engagementName: eng.name,
      engagementLeadId: eng.engagementLeadId,
      partnerOwnerId: eng.partnerOwnerId,
      plannedHours,
      actualHours,
      burnPct,
      thresholds,
    });
  }
  return out;
}

export async function runBurnSentinelTick(opts: { force?: boolean } = {}): Promise<{ alertsWritten: number; engagementsScanned: number }> {
  if (!opts.force) {
    const { minute } = nowInGst();
    // Hourly gate: only fire on the first 15-min slice of each hour.
    if (minute >= 15) return { alertsWritten: 0, engagementsScanned: 0 };
  }
  const burns = await computeEngagementBurns();
  let alertsWritten = 0;

  // Pull existing burn-threshold audit events so we can model
  // `previousBurnPct` per engagement explicitly. A threshold is only
  // "crossed" when the current burn ≥ threshold AND the highest
  // previously-recorded threshold for this engagement was strictly less.
  // This makes the contract auditable (the audit row IS the previous
  // state) and lets us distinguish first-time crosses from re-crosses
  // after replanning (which produce a fresh audit row when the plan
  // shifts and the band is re-entered).
  const prevAuditRows = await db
    .select({ entityId: atelierAuditEvents.entityId, payload: atelierAuditEvents.payload })
    .from(atelierAuditEvents)
    .where(and(eq(atelierAuditEvents.actorId, "ag_burn_sentinel"), eq(atelierAuditEvents.action, "ledger.burn.threshold_crossed")));
  const prevHighestThreshold = new Map<string, number>();
  for (const row of prevAuditRows) {
    const tp = (row.payload as { thresholdPct?: number } | null)?.thresholdPct;
    if (typeof tp !== "number") continue;
    const prev = prevHighestThreshold.get(row.entityId) ?? 0;
    if (tp > prev) prevHighestThreshold.set(row.entityId, tp);
  }

  for (const b of burns) {
    const previousHighestPct = prevHighestThreshold.get(b.engagementId) ?? 0;
    // Only fire on bands strictly above the previously-recorded high.
    const newCrossings = b.thresholds.filter((th) => Math.round(th * 100) > previousHighestPct);
    for (const th of newCrossings) {
      const id = `panea_burn_${b.engagementId}_${Math.round(th * 100)}`;
      const severityLabel = th >= 1.0 ? "OVER PLAN" : `${Math.round(th * 100)}% burn`;
      const priority = th >= 1.0 ? "high" : th >= 0.8 ? "high" : "medium";
      const inserted = await db
        .insert(atelierPaneAItems)
        .values({
          id,
          userId: b.engagementLeadId,
          title: `Burn Sentinel · ${b.engagementName} — ${severityLabel}`,
          summary: `Engagement at ${(b.burnPct * 100).toFixed(0)}% of planned hours (${b.actualHours.toFixed(0)} / ${b.plannedHours.toFixed(0)} hrs). Threshold crossed: ${Math.round(th * 100)}%.`,
          priority,
          hrefKind: "engagement_economics",
          hrefTargetId: b.engagementId,
          dueLabel: "Now",
          sortKey: th >= 1.0 ? 100 : th >= 0.8 ? 80 : 60,
        })
        .onConflictDoNothing({ target: atelierPaneAItems.id })
        .returning({ id: atelierPaneAItems.id });
      if (inserted.length) {
        alertsWritten++;
        await db.insert(atelierAuditEvents).values({
          id: `aud_burn_${b.engagementId}_${Math.round(th * 100)}`,
          entityType: "engagement",
          entityId: b.engagementId,
          actorType: "agent",
          actorId: "ag_burn_sentinel",
          actorLabel: "Burn Sentinel",
          action: "ledger.burn.threshold_crossed",
          payload: { thresholdPct: Math.round(th * 100), burnPct: b.burnPct, plannedHours: b.plannedHours, actualHours: b.actualHours },
          payloadSummary: `Burn Sentinel: ${b.engagementName} crossed ${Math.round(th * 100)}% of planned hours.`,
        }).onConflictDoNothing({ target: atelierAuditEvents.id });
        await db.insert(atelierNotifications).values({
          id: `notif_burn_${b.engagementId}_${Math.round(th * 100)}`,
          userId: b.engagementLeadId,
          kind: "burn_alert",
          payload: { engagementId: b.engagementId, thresholdPct: Math.round(th * 100), burnPct: b.burnPct },
          subject: `Burn alert: ${b.engagementName} (${Math.round(th * 100)}%)`,
          body: `Engagement at ${(b.burnPct * 100).toFixed(0)}% of planned hours.`,
          refType: "engagement",
          refId: b.engagementId,
          status: "queued",
        }).onConflictDoNothing({ target: atelierNotifications.id });
      }
    }
  }
  return { alertsWritten, engagementsScanned: burns.length };
}

export async function getEngagementBurnSummary(engagementId: string): Promise<BurnRow | null> {
  const all = await computeEngagementBurns();
  return all.find((b) => b.engagementId === engagementId) ?? null;
}
