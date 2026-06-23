/**
 * Task #500 — Unit tests for the CLI reducer + stream-consumer
 * navigation gate.
 *
 * Vitest is not installed in the atelier artifact (matching the
 * approach used by reference-data.test.ts). Run with:
 *
 *   pnpm --filter @workspace/atelier test:cli-reducer
 *
 * Throws on the first failed assertion.
 */
import assert from "node:assert/strict";
import { applyFrame, tryFireNavigation } from "./useCli";
import type { CliFrame, CliTurn } from "./types";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.stack : String(err)}`);
  }
}

function seedTurn(): CliTurn {
  return {
    clientTurnKey: "k_test",
    prompt: "test",
    status: "streaming",
    startedAt: 0,
    trace: [],
  };
}

console.log("applyFrame — navigateTo lift");

test("needs_confirmation lifts diff.navigateTo (on_propose)", () => {
  const frame: CliFrame = {
    type: "needs_confirmation",
    receivedAt: 1,
    data: {
      summary: "create account",
      diff: { navigateTo: { path: "/accounts/acc_1", when: "on_propose" } },
    },
  };
  const next = applyFrame(seedTurn(), frame);
  assert.equal(next.status, "needs_confirmation");
  assert.deepEqual(next.navigateTo, { path: "/accounts/acc_1", when: "on_propose" });
});

test("needs_confirmation without diff.navigateTo leaves navigateTo null", () => {
  const next = applyFrame(seedTurn(), {
    type: "needs_confirmation",
    receivedAt: 1,
    data: { summary: "x" },
  });
  assert.equal(next.navigateTo ?? null, null);
});

test("needs_confirmation ignores diff.navigateTo with invalid `when`", () => {
  const next = applyFrame(seedTurn(), {
    type: "needs_confirmation",
    receivedAt: 1,
    data: {
      summary: "x",
      diff: { navigateTo: { path: "/x", when: "later" } },
    },
  });
  assert.equal(next.navigateTo ?? null, null);
});

test("tool_result(propose_write) lifts data.navigateTo (on_commit)", () => {
  const frame: CliFrame = {
    type: "tool_result",
    receivedAt: 2,
    data: {
      tool: "propose_write",
      ok: true,
      data: { navigateTo: { path: "/opportunities/opp_1", when: "on_commit" } },
    },
  };
  const next = applyFrame(seedTurn(), frame);
  assert.deepEqual(next.navigateTo, { path: "/opportunities/opp_1", when: "on_commit" });
});

test("tool_result for a different tool does not lift navigateTo", () => {
  const next = applyFrame(seedTurn(), {
    type: "tool_result",
    receivedAt: 2,
    data: {
      tool: "list_accounts",
      ok: true,
      data: { navigateTo: { path: "/x", when: "on_commit" } },
    },
  });
  assert.equal(next.navigateTo ?? null, null);
});

test("tool_result(propose_write) with ok=false does not lift", () => {
  const next = applyFrame(seedTurn(), {
    type: "tool_result",
    receivedAt: 2,
    data: {
      tool: "propose_write",
      ok: false,
      data: { navigateTo: { path: "/x", when: "on_commit" } },
    },
  });
  assert.equal(next.navigateTo ?? null, null);
});

test("applyFrame preserves an already-lifted navigateTo across noisy frames", () => {
  const turn: CliTurn = {
    ...seedTurn(),
    navigateTo: { path: "/accounts/acc_1", when: "on_propose" },
  };
  const next = applyFrame(turn, {
    type: "narration",
    receivedAt: 3,
    data: { text: "thinking…" },
  });
  assert.deepEqual(next.navigateTo, { path: "/accounts/acc_1", when: "on_propose" });
});

console.log("\napplyFrame — progress sources");

test("progress frame attaches safe http(s) sources to the step", () => {
  const next = applyFrame(seedTurn(), {
    type: "progress",
    receivedAt: 1,
    data: {
      pct: 60,
      message: "Read 2 sources",
      sources: [
        { url: "https://example.com/a", title: "Source A" },
        { url: "http://example.org/b" },
      ],
    },
  });
  const step = next.trace[next.trace.length - 1];
  assert.equal(step.kind, "step");
  assert.equal(step.text, "Read 2 sources");
  assert.deepEqual(step.sources, [
    { url: "https://example.com/a", title: "Source A" },
    { url: "http://example.org/b", title: undefined },
  ]);
});

test("progress frame drops unsafe-scheme and malformed sources", () => {
  const next = applyFrame(seedTurn(), {
    type: "progress",
    receivedAt: 1,
    data: {
      pct: 60,
      message: "Read 1 source",
      sources: [
        { url: "javascript:alert(1)", title: "evil" },
        { title: "no url" },
        { url: "https://ok.example/x", title: "Good" },
      ],
    },
  });
  const step = next.trace[next.trace.length - 1];
  assert.deepEqual(step.sources, [{ url: "https://ok.example/x", title: "Good" }]);
});

test("progress frame with no sources leaves the step without a sources field", () => {
  const next = applyFrame(seedTurn(), {
    type: "progress",
    receivedAt: 1,
    data: { pct: 35, message: "Searching the web (1)" },
  });
  const step = next.trace[next.trace.length - 1];
  assert.equal(step.text, "Searching the web (1)");
  assert.equal(step.sources, undefined);
});

console.log("\ntryFireNavigation — stream-consumer gate");

test("fires onNavigate exactly once per unique destination", () => {
  const calls: Array<[string, string]> = [];
  const onNav = (p: string, w: "on_propose" | "on_commit") => calls.push([p, w]);
  const isActive = () => true;

  const r1 = tryFireNavigation({
    prevNavPath: null,
    navigateTo: { path: "/accounts/a", when: "on_propose" },
    isActive,
    onNavigate: onNav,
  });
  assert.equal(r1.fired, true);
  assert.equal(r1.navigatedTo, "/accounts/a");

  // Same destination on the very next frame → must not fire again.
  const r2 = tryFireNavigation({
    prevNavPath: r1.navigatedTo,
    navigateTo: { path: "/accounts/a", when: "on_propose" },
    isActive,
    onNavigate: onNav,
  });
  assert.equal(r2.fired, false);

  // New destination (commit phase) → fires again.
  const r3 = tryFireNavigation({
    prevNavPath: r2.navigatedTo,
    navigateTo: { path: "/accounts/a/edit", when: "on_commit" },
    isActive,
    onNavigate: onNav,
  });
  assert.equal(r3.fired, true);
  assert.deepEqual(calls, [
    ["/accounts/a", "on_propose"],
    ["/accounts/a/edit", "on_commit"],
  ]);
});

test("suppresses onNavigate when isActive() is false (stale turn)", () => {
  let called = 0;
  const result = tryFireNavigation({
    prevNavPath: null,
    navigateTo: { path: "/accounts/a", when: "on_propose" },
    isActive: () => false,
    onNavigate: () => called++,
  });
  assert.equal(called, 0);
  assert.equal(result.fired, false);
  assert.equal(result.navigatedTo, null);
});

test("no-op when navigateTo is null", () => {
  let called = 0;
  const result = tryFireNavigation({
    prevNavPath: "/x",
    navigateTo: null,
    isActive: () => true,
    onNavigate: () => called++,
  });
  assert.equal(called, 0);
  assert.equal(result.fired, false);
  assert.equal(result.navigatedTo, "/x");
});

test("swallows onNavigate exceptions so the stream keeps going", () => {
  const result = tryFireNavigation({
    prevNavPath: null,
    navigateTo: { path: "/accounts/a", when: "on_propose" },
    isActive: () => true,
    onNavigate: () => {
      throw new Error("router boom");
    },
  });
  assert.equal(result.fired, true);
  assert.equal(result.navigatedTo, "/accounts/a");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
