/**
 * Task #39 — Duplicate-opportunity warning in the chat confirm card UI.
 *
 * The backend embeds `duplicateWarning` (exact + similar matches) into the
 * opportunity_create confirmation diff, and returns errorCode
 * `duplicate_opportunity` when a bare commit is blocked. These tests pin:
 *
 *  1. DuplicateWarningBlock renders a prominent, warning-styled block from
 *     `diff.duplicateWarning` (exact → danger styling, similar-only →
 *     warning styling), including a link to the existing deal.
 *  2. The duplicate_opportunity rejection renders as a friendly card (via
 *     ToolResultCardList errorCode routing) with a working link to the
 *     existing deal — not a raw error dump.
 *
 * Vitest is not installed in the atelier artifact (matching the approach
 * of useCli.test.ts / reference-data.test.ts). Run with:
 *
 *   pnpm --filter @workspace/atelier test:cli-duplicate-card
 *
 * Exits non-zero if any assertion fails.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DuplicateWarningBlock,
  DuplicateRejectionCard,
  ToolResultCardList,
} from "./ResultCardRenderers";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    fail++;
    console.error(`  \u2717 ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const exact = { id: "opp_1", name: "Falcon Transformation", salesStage: "qualified", exact: true };
const similar = { id: "opp_2", name: "Falcon Transformation II", salesStage: "prospecting", exact: false };

console.log("DuplicateWarningBlock \u2014 confirm-card duplicate warning");

test("exact duplicate renders a danger-styled warning with a link to the existing deal", () => {
  const html = renderToStaticMarkup(
    <DuplicateWarningBlock warning={{ exact, similar: [exact, similar] }} locale="en" />,
  );
  assert(html.includes('data-testid="cli-duplicate-warning"'), "warning block missing");
  assert(html.includes('data-dup-kind="exact"'), "exact match should use danger styling");
  assert(html.includes('data-testid="cli-duplicate-exact"'), "exact callout missing");
  assert(html.includes("Possible duplicate"), "warning title missing");
  assert(
    html.includes('href="/opportunities/opp_1"'),
    "link to existing exact-match deal missing",
  );
  // The exact match must not be repeated in the similar list.
  const rows = html.split('data-testid="cli-duplicate-similar-row"').length - 1;
  assert(rows === 1, `expected 1 similar row (exact deduped), got ${rows}`);
  assert(html.includes('href="/opportunities/opp_2"'), "similar-match link missing");
});

test("similar-only duplicates render a warning-styled (non-danger) block", () => {
  const html = renderToStaticMarkup(
    <DuplicateWarningBlock warning={{ exact: null, similar: [similar] }} locale="en" />,
  );
  assert(html.includes('data-testid="cli-duplicate-warning"'), "warning block missing");
  assert(html.includes('data-dup-kind="similar"'), "similar-only should not use danger styling");
  assert(!html.includes('data-testid="cli-duplicate-exact"'), "no exact callout expected");
  assert(html.includes("Falcon Transformation II"), "similar deal name missing");
});

test("no warning payload renders nothing", () => {
  const html = renderToStaticMarkup(
    <DuplicateWarningBlock warning={{ exact: null, similar: [] }} locale="en" />,
  );
  assert(html === "", `expected empty render, got: ${html.slice(0, 120)}`);
});

test("arabic locale renders localized copy", () => {
  const html = renderToStaticMarkup(
    <DuplicateWarningBlock warning={{ exact, similar: [] }} locale="ar" />,
  );
  assert(html.includes("احتمال تكرار"), "arabic warning title missing");
});

console.log("DuplicateRejectionCard \u2014 friendly blocked-commit card");

const rejectionData = {
  duplicate: { existing: exact, similar: [exact] },
  navigateTo: { path: "/opportunities/opp_1", when: "on_commit" },
};

test("rejection card renders friendly copy and a link to the existing deal", () => {
  const html = renderToStaticMarkup(
    <DuplicateRejectionCard data={rejectionData} locale="en" />,
  );
  assert(html.includes('data-testid="cli-duplicate-rejection"'), "rejection card missing");
  assert(html.includes("Duplicate deal blocked"), "friendly title missing");
  assert(html.includes("Falcon Transformation"), "existing deal name missing");
  assert(
    html.includes('data-testid="cli-duplicate-rejection-link"') &&
      html.includes('href="/opportunities/opp_1"'),
    "link to existing deal missing",
  );
});

test("ToolResultCardList routes errorCode duplicate_opportunity to the friendly card", () => {
  const html = renderToStaticMarkup(
    <ToolResultCardList
      toolResults={[
        {
          tool: "opportunity_create",
          ok: false,
          errorCode: "duplicate_opportunity",
          errorMessage: "An open opportunity named ... already exists",
          data: rejectionData,
        },
      ]}
      capabilities={[]}
      locale="en"
    />,
  );
  assert(html.includes('data-testid="cli-duplicate-rejection"'), "friendly card not routed");
  assert(!html.includes('data-testid="cli-tool-error"'), "raw error dump should not render");
});

test("other errors still render the generic error card", () => {
  const html = renderToStaticMarkup(
    <ToolResultCardList
      toolResults={[
        { tool: "opportunity_create", ok: false, errorCode: "forbidden", errorMessage: "no" },
      ]}
      capabilities={[]}
      locale="en"
    />,
  );
  assert(html.includes('data-testid="cli-tool-error"'), "generic error card missing");
  assert(!html.includes('data-testid="cli-duplicate-rejection"'), "should not render dup card");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
