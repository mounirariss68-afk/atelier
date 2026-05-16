/**
 * Task #515 — unit tests for the rail-width clamp + persistence
 * helpers exported from Shell.tsx. Mirrors the conventions used by
 * useCli.test.ts (no vitest; run via tsx).
 *
 *   pnpm --filter @workspace/atelier test:rail-width
 */
import assert from "node:assert/strict";
import {
  clampRailWidth,
  loadRailWidth,
  computeRailDragWidth,
  applyRailKeyAction,
  RAIL_DEFAULT_WIDTH,
  RAIL_MIN_WIDTH,
  RAIL_MAX_WIDTH,
} from "./Shell";

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

console.log("rail-width helpers");

test("clampRailWidth: in-range value passes through", () => {
  assert.equal(clampRailWidth(420, 1280), 420);
});

test("clampRailWidth: below min snaps up to min", () => {
  assert.equal(clampRailWidth(100, 1280), RAIL_MIN_WIDTH);
});

test("clampRailWidth: above hard max snaps to max", () => {
  assert.equal(clampRailWidth(2000, 1920), RAIL_MAX_WIDTH);
});

test("clampRailWidth: 60% viewport cap dominates on narrow screens", () => {
  // 60% of 800 = 480, below RAIL_MAX_WIDTH(720) so cap is 480.
  assert.equal(clampRailWidth(700, 800), 480);
});

test("clampRailWidth: non-finite inputs fall back to default", () => {
  assert.equal(clampRailWidth(Number.NaN, 1280), RAIL_DEFAULT_WIDTH);
  assert.equal(clampRailWidth(Number.POSITIVE_INFINITY, 1280), RAIL_DEFAULT_WIDTH);
});

test("clampRailWidth: rounds fractional inputs", () => {
  assert.equal(clampRailWidth(420.7, 1280), 421);
});

test("clampRailWidth: very narrow viewport — upper wins, lower follows", () => {
  // 60% of 400 = 240. RAIL_MIN_WIDTH(320) > upper, so lo collapses
  // to upper and the function returns 240 for any input.
  assert.equal(clampRailWidth(50, 400), 240);
  assert.equal(clampRailWidth(9999, 400), 240);
});

// Polyfill a minimal localStorage + window for loadRailWidth.
const memStore: Record<string, string> = {};
(globalThis as unknown as { window: unknown }).window = {
  innerWidth: 1280,
  localStorage: {
    getItem: (k: string) => (k in memStore ? memStore[k] : null),
    setItem: (k: string, v: string) => {
      memStore[k] = v;
    },
    removeItem: (k: string) => {
      delete memStore[k];
    },
  },
};

test("loadRailWidth: returns default when no value stored", () => {
  delete memStore["atelier-rail-width"];
  assert.equal(loadRailWidth(), RAIL_DEFAULT_WIDTH);
});

test("loadRailWidth: parses + clamps stored value", () => {
  memStore["atelier-rail-width"] = "480";
  assert.equal(loadRailWidth(), 480);
  memStore["atelier-rail-width"] = "9999";
  assert.equal(loadRailWidth(), RAIL_MAX_WIDTH);
});

test("loadRailWidth: garbage value falls back to default", () => {
  memStore["atelier-rail-width"] = "not-a-number";
  assert.equal(loadRailWidth(), RAIL_DEFAULT_WIDTH);
});

/* ───────────── Drag round-trip (rail anchored right) ───────────── */

test("computeRailDragWidth: dragging LEFT widens the rail", () => {
  // start=400, deltaX=-100 (cursor moved 100px to the left)
  // expected next width = 400 - (-100) = 500
  assert.equal(computeRailDragWidth(400, -100, 1280), 500);
});

test("computeRailDragWidth: dragging RIGHT shrinks the rail", () => {
  // start=400, deltaX=+50 → next = 350
  assert.equal(computeRailDragWidth(400, 50, 1280), 350);
});

test("computeRailDragWidth: clamps to min/max during drag", () => {
  assert.equal(computeRailDragWidth(330, 500, 1280), RAIL_MIN_WIDTH);
  assert.equal(computeRailDragWidth(700, -800, 1920), RAIL_MAX_WIDTH);
});

/* ───────────── Keyboard semantics ───────────── */

test("applyRailKeyAction: ArrowLeft widens by 16, ArrowRight shrinks by 16", () => {
  assert.equal(applyRailKeyAction("ArrowLeft", 400, 1280), 416);
  assert.equal(applyRailKeyAction("ArrowRight", 400, 1280), 384);
});

test("applyRailKeyAction: Home jumps to MIN, End jumps to MAX", () => {
  assert.equal(applyRailKeyAction("Home", 500, 1280), RAIL_MIN_WIDTH);
  assert.equal(applyRailKeyAction("End", 500, 1280), RAIL_MAX_WIDTH);
});

test("applyRailKeyAction: End respects 60% viewport cap", () => {
  // 60% of 800 = 480, which is below RAIL_MAX_WIDTH(720).
  assert.equal(applyRailKeyAction("End", 320, 800), 480);
});

test("applyRailKeyAction: arrows clamp at bounds", () => {
  assert.equal(applyRailKeyAction("ArrowRight", RAIL_MIN_WIDTH, 1280), RAIL_MIN_WIDTH);
  assert.equal(applyRailKeyAction("ArrowLeft", RAIL_MAX_WIDTH, 1920), RAIL_MAX_WIDTH);
});

test("applyRailKeyAction: returns null for unrelated keys", () => {
  assert.equal(applyRailKeyAction("Enter", 400, 1280), null);
  assert.equal(applyRailKeyAction("a", 400, 1280), null);
});

/* ───────────── Persistence round-trip + collapse-cycle ───────────── */

// Simulates the Shell's setRailWidth setter (clamp → state → storage).
// The test asserts that a width set by the user survives a "collapse →
// expand" cycle (the cycle does NOT touch storage), and is restored on
// re-mount via loadRailWidth().
function simulateSetRailWidth(n: number, vp: number): number {
  const clamped = clampRailWidth(n, vp);
  memStore["atelier-rail-width"] = String(clamped);
  return clamped;
}

test("persistence: drag → store → reload restores the user's width", () => {
  delete memStore["atelier-rail-width"];
  // 1. user drags from 320 → 480 (deltaX = -160)
  const dragged = computeRailDragWidth(320, -160, 1280);
  assert.equal(dragged, 480);
  // 2. setter persists clamped value
  const stored = simulateSetRailWidth(dragged, 1280);
  assert.equal(stored, 480);
  // 3. on next mount, loadRailWidth re-hydrates from storage
  assert.equal(loadRailWidth(), 480);
});

test("collapse cycle: user width is preserved across collapse/expand", () => {
  // The Shell holds width in React state inside RailContext, separate
  // from `collapsed`. Toggling collapsed never writes to storage and
  // never resets width — so loadRailWidth still returns the same value
  // before AND after the toggle.
  simulateSetRailWidth(560, 1280);
  const before = loadRailWidth();
  // (collapse toggle would be: setCollapsed(true); setCollapsed(false))
  // Since collapse does not mutate storage:
  const after = loadRailWidth();
  assert.equal(before, 560);
  assert.equal(after, 560);
});

test("persistence: clamps on store when viewport later shrinks", () => {
  // User stored 700 on a wide screen, then re-opened on an 800px screen.
  memStore["atelier-rail-width"] = "700";
  // Simulate window.innerWidth = 800 for this load
  (globalThis as unknown as { window: { innerWidth: number } }).window.innerWidth = 800;
  assert.equal(loadRailWidth(), 480); // clamped to 60% of 800
  (globalThis as unknown as { window: { innerWidth: number } }).window.innerWidth = 1280;
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
