/**
 * Pure unit tests for deriveReadinessIssues — the client-side mirror of the
 * server's POST /mobilization/activate readiness gate.
 *
 * Key invariants tested:
 *   1. Warnings (pending proposals) never block activation (severity "warn").
 *   2. Error conditions: no required requirements, no accepted assignments,
 *      unavailable assignee, missing role link, under-allocation, date gaps.
 *   3. A team that satisfies all server checks emits no error-severity issues.
 *
 * No DOM / React / network required — deriveReadinessIssues is a pure function.
 *
 * Run with:
 *   pnpm --filter @workspace/atelier test:mobilization-readiness
 */
import assert from "node:assert/strict";
import { deriveReadinessIssues } from "./ReadinessPanel";
import type { StaffingRequirement, StaffingAssignment } from "./types";

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(
      `  ✗ ${name}\n      ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Builders ────────────────────────────────────────────────────────────────
// Both default to id="req-1" / requirementId="req-1" so they're always
// linked unless you explicitly override.

function req(
  overrides: Partial<StaffingRequirement> = {},
): StaffingRequirement {
  return {
    id: "req-1",
    role: "Project Manager",
    seniority: "manager",
    allocationPct: 100,
    startDate: "2025-01-01",
    endDate: "2025-06-30",
    required: true,
    status: "open",
    availabilityStatus: "available",
    notes: null,
    ...overrides,
  };
}

function asg(
  overrides: Partial<StaffingAssignment> = {},
): StaffingAssignment {
  return {
    id: "asg-1",
    requirementId: "req-1", // matches req() default
    personId: "p-1",
    personName: "Alice Smith",
    userId: "u-1",
    role: "Project Manager",
    seniority: "manager",
    allocationPct: 100,
    startDate: "2025-01-01",
    endDate: "2025-06-30",
    availabilityStatus: "available",
    state: "accepted",
    stateReason: null,
    ...overrides,
  };
}

// ─── Check 1: no required requirements ───────────────────────────────────────

console.log("\nCheck 1 — no required requirements");

test("emits error when there are no required requirements", () => {
  const issues = deriveReadinessIssues([], [asg()]);
  const errors = issues.filter((i) => i.severity === "error");
  assert.ok(errors.some((i) => i.key === "no-required-requirements"), JSON.stringify(issues));
});

test("does not emit no-required-requirements when one exists", () => {
  const issues = deriveReadinessIssues([req()], [asg()]);
  assert.ok(!issues.some((i) => i.key === "no-required-requirements"), JSON.stringify(issues));
});

test("optional requirements do not satisfy the required-requirement check", () => {
  const issues = deriveReadinessIssues([req({ required: false })], [asg()]);
  assert.ok(issues.some((i) => i.key === "no-required-requirements"), JSON.stringify(issues));
});

test("closed requirements do not satisfy the required-requirement check", () => {
  const issues = deriveReadinessIssues([req({ status: "closed" })], [asg()]);
  assert.ok(issues.some((i) => i.key === "no-required-requirements"), JSON.stringify(issues));
});

// ─── Check 2: no accepted assignments ────────────────────────────────────────

console.log("\nCheck 2 — no accepted assignments");

test("emits error when there are no assignments at all", () => {
  const issues = deriveReadinessIssues([req()], []);
  assert.ok(issues.some((i) => i.key === "no-accepted-assignments"), JSON.stringify(issues));
});

test("only proposed assignments do not satisfy the accepted-assignment check", () => {
  // proposed state → acceptedAsgs is empty → no-accepted-assignments fires
  const issues = deriveReadinessIssues(
    [req()],
    [asg({ state: "proposed" })],
  );
  assert.ok(issues.some((i) => i.key === "no-accepted-assignments"), JSON.stringify(issues));
});

test("does not emit no-accepted-assignments when one accepted assignment exists", () => {
  const issues = deriveReadinessIssues([req()], [asg()]);
  assert.ok(!issues.some((i) => i.key === "no-accepted-assignments"), JSON.stringify(issues));
});

// ─── Check 3: availability ────────────────────────────────────────────────────

console.log("\nCheck 3 — availability");

test("emits avail-* error for each accepted assignment that is not available", () => {
  const a = asg({ id: "asg-avail", state: "accepted", availabilityStatus: "unknown" });
  const issues = deriveReadinessIssues([req()], [a]);
  assert.ok(issues.some((i) => i.key === `avail-${a.id}`), JSON.stringify(issues));
});

test("does not emit avail-* for an accepted assignment with status=available", () => {
  const issues = deriveReadinessIssues([req()], [asg({ availabilityStatus: "available" })]);
  assert.ok(!issues.some((i) => i.key.startsWith("avail-")), JSON.stringify(issues));
});

test("declined assignments are not checked for availability", () => {
  const a = asg({ id: "asg-dec", state: "declined", availabilityStatus: "unknown" });
  const issues = deriveReadinessIssues([req()], [a]);
  assert.ok(!issues.some((i) => i.key.startsWith("avail-")), JSON.stringify(issues));
});

// ─── Check 5a: missing role link ─────────────────────────────────────────────

console.log("\nCheck 5a — missing role link");

test("emits missing-* error when no accepted assignment links to a required requirement", () => {
  const r = req({ id: "req-miss" });
  // The accepted asg links to a different req
  const a = asg({ requirementId: "req-other", state: "accepted" });
  const issues = deriveReadinessIssues([r], [a]);
  assert.ok(issues.some((i) => i.key === "missing-req-miss"), JSON.stringify(issues));
});

test("does not emit missing-* when an accepted assignment links to the requirement", () => {
  // req and asg share the same default id "req-1"
  const issues = deriveReadinessIssues([req()], [asg()]);
  assert.ok(!issues.some((i) => i.key === "missing-req-1"), JSON.stringify(issues));
});

// ─── Check 5b: allocation sum ─────────────────────────────────────────────────

console.log("\nCheck 5b — allocation sum");

test("emits allocation-* error when accepted assignment is under-allocated", () => {
  // req expects 100%, assignment provides 50%
  const issues = deriveReadinessIssues(
    [req({ allocationPct: 100 })],
    [asg({ id: "asg-low", allocationPct: 50 })],
  );
  assert.ok(issues.some((i) => i.key === "allocation-req-1"), JSON.stringify(issues));
});

test("does not emit allocation-* when sum of accepted allocationPct meets requirement", () => {
  const issues = deriveReadinessIssues(
    [req({ allocationPct: 100 })],
    [
      asg({ id: "asg-a", allocationPct: 60 }),
      asg({ id: "asg-b", allocationPct: 40 }),
    ],
  );
  assert.ok(!issues.some((i) => i.key === "allocation-req-1"), JSON.stringify(issues));
});

test("proposed assignments do not count toward allocation sum", () => {
  // Only proposed; no accepted → missing-* fires (not allocation-*)
  const issues = deriveReadinessIssues(
    [req({ allocationPct: 100 })],
    [asg({ state: "proposed", allocationPct: 100 })],
  );
  // Should not see an allocation error (missing-* fires instead)
  assert.ok(!issues.some((i) => i.key === "allocation-req-1"), JSON.stringify(issues));
});

// ─── Check 5c: date coverage ─────────────────────────────────────────────────

console.log("\nCheck 5c — date coverage");

test("emits dates-* error when accepted assignments leave a gap", () => {
  const issues = deriveReadinessIssues(
    [req({ startDate: "2025-01-01", endDate: "2025-06-30" })],
    [
      asg({ id: "asg-g1", startDate: "2025-01-01", endDate: "2025-03-14" }),
      asg({ id: "asg-g2", startDate: "2025-03-17", endDate: "2025-06-30" }), // gap 15–16
    ],
  );
  assert.ok(issues.some((i) => i.key === "dates-req-1"), JSON.stringify(issues));
});

test("does not emit dates-* when contiguous assignments cover the full requirement window", () => {
  const issues = deriveReadinessIssues(
    [req({ startDate: "2025-01-01", endDate: "2025-06-30" })],
    [
      asg({ id: "asg-c1", startDate: "2025-01-01", endDate: "2025-03-31" }),
      asg({ id: "asg-c2", startDate: "2025-03-31", endDate: "2025-06-30" }), // overlap on boundary
    ],
  );
  assert.ok(!issues.some((i) => i.key === "dates-req-1"), JSON.stringify(issues));
});

test("single assignment spanning the full window passes date coverage", () => {
  const issues = deriveReadinessIssues(
    [req({ startDate: "2025-01-01", endDate: "2025-06-30" })],
    [asg({ startDate: "2025-01-01", endDate: "2025-06-30" })],
  );
  assert.ok(!issues.some((i) => i.key === "dates-req-1"), JSON.stringify(issues));
});

// ─── Pending proposals: warn only, never block activation ────────────────────

console.log("\nPending proposals — warn severity, never block");

test("pending proposals produce a warn-severity issue, not error", () => {
  // One accepted (satisfies all errors) + one proposed (warns)
  const accepted = asg({ id: "asg-acc" });
  const proposed = asg({ id: "asg-prop", state: "proposed" });
  const issues = deriveReadinessIssues([req()], [accepted, proposed]);
  const proposalIssue = issues.find((i) => i.key === "pending-proposals");
  assert.ok(proposalIssue !== undefined, "pending-proposals issue should be present");
  assert.equal(proposalIssue!.severity, "warn");
});

test("pending proposals alone produce no error-severity issues when all errors are resolved", () => {
  const accepted = asg({ id: "asg-acc2" });
  const proposed = asg({ id: "asg-prop2", state: "proposed" });
  const issues = deriveReadinessIssues([req()], [accepted, proposed]);
  const errors = issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
});

test("with only proposals (no accepted) there IS a no-accepted error, not a warn", () => {
  const issues = deriveReadinessIssues([req()], [asg({ state: "proposed" })]);
  assert.ok(issues.some((i) => i.key === "no-accepted-assignments" && i.severity === "error"));
});

// ─── Happy-path: all checks pass ─────────────────────────────────────────────

console.log("\nHappy path — no errors");

test("fully-staffed, available, contiguous assignment emits zero errors", () => {
  const issues = deriveReadinessIssues(
    [req({ startDate: "2025-01-01", endDate: "2025-06-30", allocationPct: 100 })],
    [
      asg({
        state: "accepted",
        availabilityStatus: "available",
        allocationPct: 100,
        startDate: "2025-01-01",
        endDate: "2025-06-30",
      }),
    ],
  );
  const errors = issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
});

test("multiple requirements all satisfied emits zero errors", () => {
  const r1 = req({ id: "req-A" });
  const r2 = req({ id: "req-B", role: "Developer", seniority: "senior" });
  const a1 = asg({ id: "asg-A", requirementId: "req-A" });
  const a2 = asg({
    id: "asg-B",
    requirementId: "req-B",
    role: "Developer",
    seniority: "senior",
  });
  const issues = deriveReadinessIssues([r1, r2], [a1, a2]);
  const errors = issues.filter((i) => i.severity === "error");
  assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
