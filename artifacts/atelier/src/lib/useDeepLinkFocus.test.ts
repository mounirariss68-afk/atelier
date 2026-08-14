/**
 * Task #1082 — deep-link focus helpers (pure parts).
 *
 * Covers the query-param pick used by useDeepLinkFocus (successful and
 * missing targets, param precedence) and the revrec posting-line →
 * schedule-row resolution, including the missing/adjustment-line cases.
 *
 * Run: pnpm --filter @workspace/atelier run test:deeplink-focus
 */
import assert from "node:assert/strict";
import { pickFocusParam, focusOutcome } from "./useDeepLinkFocus";
import { scheduleIdForPostingLine } from "./revrecFocus";

// ── pickFocusParam ──────────────────────────────────────────
assert.equal(pickFocusParam("?txn=abc", ["txn"]), "abc", "reads the named param");
assert.equal(pickFocusParam("?focus=f1&txn=t1", ["txn", "focus"]), "t1", "first name wins");
assert.equal(pickFocusParam("?txn=&focus=f1", ["txn", "focus"]), "f1", "empty value skipped");
assert.equal(pickFocusParam("?other=x", ["txn"]), null, "absent → null (missing target)");
assert.equal(pickFocusParam("", ["focus"]), null, "no query string → null");
assert.equal(
  pickFocusParam("?txn=a%20b%2Fc", ["txn"]),
  "a b/c",
  "URI-encoded refs decode back to the raw id",
);

// ── focusOutcome (shared list-page decision; supplier-invoices regression) ──
assert.equal(focusOutcome(true, ["a", "b"], "b"), "scroll", "present target → scroll");
assert.equal(focusOutcome(true, ["a", "b"], "gone"), "missing", "absent target → missing notice");
assert.equal(
  focusOutcome(true, [], "gone"),
  "missing",
  "EMPTY loaded list still reports missing (supplier ?focus= regression)",
);
assert.equal(focusOutcome(false, [], "gone"), null, "not loaded yet → no decision");
assert.equal(focusOutcome(false, ["gone"], "gone"), null, "not loaded beats present");
assert.equal(focusOutcome(true, ["a"], null), null, "no focus param → nothing");

// ── scheduleIdForPostingLine ────────────────────────────────
const lines = [
  { id: "rpl_1", scheduleId: "sched_1" },
  { id: "rpl_adj", scheduleId: null }, // adjustment line: no schedule linkage
];
assert.equal(scheduleIdForPostingLine(lines, "rpl_1"), "sched_1", "line resolves to its schedule row");
assert.equal(scheduleIdForPostingLine(lines, "rpl_adj"), null, "adjustment line → null (missing notice)");
assert.equal(scheduleIdForPostingLine(lines, "rpl_gone"), null, "unknown line → null (missing notice)");
assert.equal(scheduleIdForPostingLine([], "rpl_1"), null, "empty period → null (missing notice)");

console.log("All deep-link focus checks passed.");
