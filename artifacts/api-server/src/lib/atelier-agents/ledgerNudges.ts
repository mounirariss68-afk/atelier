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
