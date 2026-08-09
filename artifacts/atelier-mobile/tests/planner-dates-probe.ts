/**
 * Task #843 — flight planner leg-date ordering probe.
 *
 * Pins the multi-city chronology rules the planner card relies on:
 *   1. firstOutOfOrderLeg flags a leg dated before an earlier leg (the
 *      Search button must stay disabled with a named hint).
 *   2. reconcileLegDates clears DOWNSTREAM dates stranded by moving an
 *      earlier leg later (the "edit leg 1 after filling leg 2" hole).
 *
 * Run: pnpm --filter @workspace/atelier-mobile exec tsx tests/planner-dates-probe.ts
 */
import { firstOutOfOrderLeg, reconcileLegDates } from "../lib/plannerDates";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// ── firstOutOfOrderLeg ──────────────────────────────────────────────
check("chronological legs pass", firstOutOfOrderLeg(["2027-03-01", "2027-03-05", "2027-03-09"]) === null);
check("equal dates allowed (same-day connection)", firstOutOfOrderLeg(["2027-03-01", "2027-03-01"]) === null);
check("out-of-order leg flagged", firstOutOfOrderLeg(["2027-03-05", "2027-03-01"]) === 1);
check(
  "blank legs skipped, later violation still flagged",
  firstOutOfOrderLeg(["2027-03-05", "", "2027-03-01"]) === 2,
);
check("all blank passes (presence checks own that)", firstOutOfOrderLeg(["", ""]) === null);

// ── reconcileLegDates ───────────────────────────────────────────────
// The reviewer's exact hole: leg 2 picked, then leg 1 moved LATER.
check(
  "moving leg 1 past leg 2 clears leg 2",
  JSON.stringify(reconcileLegDates(["2027-03-01", "2027-03-03"], 0, "2027-03-10")) ===
    JSON.stringify(["2027-03-10", ""]),
);
check(
  "cascade: both downstream legs cleared when stranded",
  JSON.stringify(
    reconcileLegDates(["2027-03-01", "2027-03-02", "2027-03-03"], 0, "2027-03-20"),
  ) === JSON.stringify(["2027-03-20", "", ""]),
);
check(
  "still-valid downstream legs kept",
  JSON.stringify(
    reconcileLegDates(["2027-03-01", "2027-03-05", "2027-03-09"], 0, "2027-03-04"),
  ) === JSON.stringify(["2027-03-04", "2027-03-05", "2027-03-09"]),
);
check(
  "editing the last leg never clears earlier legs",
  JSON.stringify(reconcileLegDates(["2027-03-01", "2027-03-05"], 1, "2027-03-06")) ===
    JSON.stringify(["2027-03-01", "2027-03-06"]),
);
check(
  "the just-picked date itself is never cleared",
  reconcileLegDates(["2027-03-10", "2027-03-05"], 1, "2027-03-05")[1] === "2027-03-05",
);
check(
  "blank legs untouched by reconciliation",
  JSON.stringify(reconcileLegDates(["2027-03-01", "", "2027-03-05"], 0, "2027-03-02")) ===
    JSON.stringify(["2027-03-02", "", "2027-03-05"]),
);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
