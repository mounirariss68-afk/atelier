/**
 * Task #568 — pure unit probe for lib/reminderPlan.ts (no expo imports).
 *
 *   1. CRM-matched meeting plans with its first account.
 *   2. Internal meeting (no matches) STILL plans, with null account.
 *   3. All-day, past/too-soon, and bad-date meetings are skipped.
 *   4. Identifier uses the shared prefix; lead time honored.
 *
 * Run: pnpm --filter atelier-mobile test:reminder-plan
 */
import {
  planReminders,
  REMINDER_ID_PREFIX,
  REMINDER_LEAD_MINUTES,
  type PlannableMeeting,
} from "../lib/reminderPlan";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const now = Date.UTC(2026, 6, 22, 8, 0, 0);
const inMins = (m: number) => new Date(now + m * 60_000).toISOString();

const meetings: PlannableMeeting[] = [
  {
    id: "crm1",
    subject: "Discovery with Tasama",
    start: inMins(120),
    matches: [
      { accountId: "acc1", accountName: "Tasama" },
      { accountId: "acc2", accountName: "Second" },
    ],
    joinUrl: "https://teams.test/1",
  },
  { id: "int1", subject: "Internal sync", start: inMins(90), matches: [] },
  { id: "allday", subject: "Offsite", start: inMins(200), isAllDay: true, matches: [] },
  // starts in 10 min → fire time (start-15) already past
  { id: "toosoon", subject: "Now-ish", start: inMins(10), matches: [] },
  { id: "past", subject: "Yesterday", start: inMins(-60), matches: [] },
  { id: "bad", subject: "Broken", start: "not-a-date", matches: [] },
];

const plan = planReminders(meetings, now);

check("plans exactly the two eligible meetings", plan.size === 2, [...plan.keys()]);

const crm = plan.get(`${REMINDER_ID_PREFIX}crm1`);
check("CRM meeting planned with first account", crm?.accountId === "acc1" && crm?.accountName === "Tasama", crm);
check("CRM meeting keeps joinUrl", crm?.joinUrl === "https://teams.test/1", crm);
check(
  "fires lead-minutes before start",
  crm?.fireAtMs === now + (120 - REMINDER_LEAD_MINUTES) * 60_000,
  crm?.fireAtMs,
);

const internal = plan.get(`${REMINDER_ID_PREFIX}int1`);
check("internal (no-match) meeting IS planned", Boolean(internal), [...plan.keys()]);
check("internal meeting has null account", internal?.accountId === null && internal?.accountName === null, internal);
check("internal meeting keeps subject + id", internal?.subject === "Internal sync" && internal?.meetingId === "int1", internal);

check("all-day skipped", !plan.has(`${REMINDER_ID_PREFIX}allday`));
check("too-soon skipped", !plan.has(`${REMINDER_ID_PREFIX}toosoon`));
check("past skipped", !plan.has(`${REMINDER_ID_PREFIX}past`));
check("bad date skipped", !plan.has(`${REMINDER_ID_PREFIX}bad`));

// custom lead time
const wide = planReminders([meetings[3]!], now, 5);
check("shorter lead time re-qualifies a soon meeting", wide.has(`${REMINDER_ID_PREFIX}toosoon`), [...wide.keys()]);

if (failures > 0) {
  console.error(`✗ reminder-plan-probe: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("✓ reminder-plan-probe: all checks passed");
