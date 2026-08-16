// Task #1251 — Tooling spend (vendor cost allocation) UI unit tests.
//
// Covers the pure helpers (vendor detection, pct validation summing to 100,
// largest-remainder display rounding, focus-param parsing, bucket ref
// requirements) plus a static render of the mapping-queue row markup with a
// mocked data shape, mirroring PartnerPortal.change-requests.test.tsx.
//
// Run: pnpm --filter @workspace/atelier run test:tooling-ui
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  vendorKeyFromSupplier,
  bucketNeedsRef,
  sumPct,
  splitPctError,
  splitsSumTo100,
  largestRemainderPcts,
  parseFocusTarget,
  fmtUsd,
} from "./toolingSpend.helpers";

// ── vendorKeyFromSupplier ───────────────────────────────────
assert.equal(vendorKeyFromSupplier("Replit, Inc."), "replit", "matches Replit");
assert.equal(vendorKeyFromSupplier("ANTHROPIC PBC"), "anthropic", "case-insensitive");
assert.equal(vendorKeyFromSupplier("Perplexity AI"), "perplexity", "substring match");
assert.equal(vendorKeyFromSupplier("Acme Consulting"), null, "non-vendor → null");
assert.equal(vendorKeyFromSupplier(""), null, "empty → null");
assert.equal(vendorKeyFromSupplier(null), null, "null → null");
assert.equal(vendorKeyFromSupplier(undefined), null, "undefined → null");

// ── bucketNeedsRef ──────────────────────────────────────────
assert.equal(bucketNeedsRef("engagement"), true, "engagement needs ref");
assert.equal(bucketNeedsRef("opportunity"), true, "opportunity needs ref");
assert.equal(bucketNeedsRef("internal"), false, "internal takes no ref");
assert.equal(bucketNeedsRef("overhead"), false, "overhead takes no ref");

// ── pct validation ──────────────────────────────────────────
assert.equal(sumPct([25, 25, 50]), 100, "sums cleanly");
assert.equal(sumPct([10, NaN, 5]), 15, "NaN-safe");
assert.equal(splitPctError([60, 40]), 0, "exact → 0 error");
assert.equal(splitPctError([60, 50]), 10, "over → positive");
assert.ok(splitPctError([60, 30]) < 0, "under → negative");
assert.equal(splitsSumTo100([50, 50]), true, "50/50 valid");
assert.equal(splitsSumTo100([33.333, 33.333, 33.334]), true, "within ±0.01");
assert.equal(splitsSumTo100([33.33, 33.33, 33.33]), false, "0.01 short is not valid");
assert.equal(splitsSumTo100([60, 50]), false, "over-100 invalid");

// ── largestRemainderPcts (display rounding stays at 100) ─────
const lr = largestRemainderPcts([33.333, 33.333, 33.334]);
assert.equal(lr.reduce((a, b) => a + b, 0), 100, "rounded thirds still sum to 100");
assert.deepEqual(largestRemainderPcts([50, 50]), [50, 50], "exact halves unchanged");
assert.deepEqual(largestRemainderPcts([]), [], "empty → empty");
const lr2 = largestRemainderPcts([16.66, 16.66, 16.68, 50]);
assert.equal(lr2.reduce((a, b) => a + b, 0), 100, "mixed set sums to 100");

// ── parseFocusTarget ────────────────────────────────────────
assert.deepEqual(parseFocusTarget("unmapped"), { kind: "unmapped" }, "unmapped keyword");
assert.deepEqual(parseFocusTarget("inv_123"), { kind: "invoice", invoiceId: "inv_123" }, "invoice id");
assert.deepEqual(parseFocusTarget(""), { kind: "none" }, "empty → none");
assert.deepEqual(parseFocusTarget(null), { kind: "none" }, "null → none");
assert.deepEqual(parseFocusTarget(undefined), { kind: "none" }, "undefined → none");

// ── fmtUsd ──────────────────────────────────────────────────
assert.equal(fmtUsd(1234.6), "$1,235", "rounds + thousands sep");
assert.equal(fmtUsd(-500), "-$500", "negatives");
assert.equal(fmtUsd(0), "$0", "zero");
assert.equal(fmtUsd(NaN), "$0", "NaN-safe");

// ── static render of a mapping-queue row's markup ───────────
// Mirrors the shape the page renders per unmapped row (label, vendor,
// total, bucket radios). We render the plain markup (no hooks) to prove the
// row surface stays crash-free with a realistic wire row.
type UnmappedRow = {
  vendorKey: string;
  projectKey: string;
  projectLabel: string;
  invoiceCount: number;
  totalUsd: number;
};
const rows: UnmappedRow[] = [
  { vendorKey: "replit", projectKey: "atelier-web", projectLabel: "atelier-web", invoiceCount: 3, totalUsd: 1287.4 },
  { vendorKey: "anthropic", projectKey: "scout", projectLabel: "Scout research", invoiceCount: 1, totalUsd: 42 },
];
const BUCKETS = ["Client delivery", "Business development", "Internal / IP", "Overhead"];
const html = renderToStaticMarkup(
  <div data-testid="tooling-mapping-queue">
    {rows.map((row) => (
      <div key={`${row.vendorKey}:${row.projectKey}`} data-testid={`tooling-mapping-row-${row.vendorKey}-${row.projectKey}`}>
        <span>{row.projectLabel}</span>
        <span>{row.vendorKey}</span>
        <span>
          {fmtUsd(row.totalUsd)} · {row.invoiceCount} invoice(s)
        </span>
        {BUCKETS.map((b) => (
          <label key={b}>
            <input type="radio" name={`map-${row.vendorKey}-${row.projectKey}-bucket`} />
            {b}
          </label>
        ))}
      </div>
    ))}
  </div>,
);
assert.ok(html.includes("atelier-web"), "renders project label");
assert.ok(html.includes("Scout research"), "renders second project");
assert.ok(html.includes("$1,287"), "renders formatted total");
assert.ok(html.includes("Client delivery") && html.includes("Overhead"), "renders bucket options");
assert.ok(html.includes('data-testid="tooling-mapping-row-replit-atelier-web"'), "row testid present");

console.log("ToolingSpend helpers + mapping-queue render: all assertions passed");
