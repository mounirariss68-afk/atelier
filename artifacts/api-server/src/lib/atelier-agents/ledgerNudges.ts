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
  atelierEmployees,
  atelierContractors,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

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

export function startLedgerNudgeJob(): void {
  if (timer) return;
  // Skip in test runs to avoid background DB chatter.
  if (process.env.NODE_ENV === "test") return;
  timer = setInterval(() => {
    void runLedgerNudgeTick().catch((err) => {
      console.warn("[ledger.nudge] tick failed:", err);
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
