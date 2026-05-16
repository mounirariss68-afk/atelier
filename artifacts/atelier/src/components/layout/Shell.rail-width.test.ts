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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
