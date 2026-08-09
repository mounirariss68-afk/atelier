/**
 * Pure date-ordering helpers for the flight planner card (Task #843).
 * Kept free of React/RN imports so they can be regression-tested under
 * plain Node (tests/planner-dates-probe.ts).
 */

export const PLANNER_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Index of the first leg dated before an earlier valid leg, or null when
 * the itinerary is chronological. Blank/invalid dates are skipped — the
 * presence checks report those separately.
 */
export function firstOutOfOrderLeg(dates: string[]): number | null {
  let prev: string | null = null;
  for (let i = 0; i < dates.length; i++) {
    const d = (dates[i] ?? "").trim();
    if (!PLANNER_DATE_RE.test(d)) continue;
    if (prev !== null && d < prev) return i;
    prev = d;
  }
  return null;
}

/**
 * Apply `newDate` at `idx`, then clear any DOWNSTREAM date that now
 * precedes an earlier leg. Moving leg 1 later must not leave leg 2 with a
 * silently-invalid earlier date — the cleared field re-prompts the user
 * (the picker's minimumDate then enforces the new floor).
 */
export function reconcileLegDates(
  dates: string[],
  idx: number,
  newDate: string,
): string[] {
  const out = [...dates];
  out[idx] = newDate;
  let prev: string | null = null;
  for (let i = 0; i < out.length; i++) {
    const d = (out[i] ?? "").trim();
    if (!PLANNER_DATE_RE.test(d)) continue;
    if (prev !== null && d < prev) {
      // Never clear the date the user just picked; earlier legs win only
      // for legs AFTER the edited one.
      if (i === idx) continue;
      out[i] = "";
      continue;
    }
    prev = d;
  }
  return out;
}
