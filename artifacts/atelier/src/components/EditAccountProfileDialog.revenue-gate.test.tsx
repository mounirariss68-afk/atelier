/**
 * Task #618 — Verify revenue editing stays locked for non-financial roles.
 *
 * The annual-revenue figure is a money surface gated by account-financials
 * authority. The Edit Company Details dialog must HIDE the revenue inputs and
 * show a "restricted" note for personas without that authority (mirroring the
 * server's 403 financials-forbidden gate). This pins that client-side gate so
 * a future change can't silently re-expose revenue editing.
 *
 * Vitest is not installed in the atelier artifact (matching the approach used
 * by reference-data.test.ts / useCli.test.ts). The revenue UI is extracted as
 * the pure `RevenueProfileFields` component so it can be rendered to static
 * markup without the Dialog portal / react-query providers. Run with:
 *
 *   pnpm --filter @workspace/atelier test:revenue-gate
 *
 * Throws (non-zero exit) on the first failed assertion.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RevenueProfileFields } from "./EditAccountProfileDialog";

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

const noop = () => {};

function render(canEditFinancials: boolean): string {
  return renderToStaticMarkup(
    <RevenueProfileFields
      canEditFinancials={canEditFinancials}
      employeeCount=""
      setEmployeeCount={noop}
      revenueAmount=""
      setRevenueAmount={noop}
      revenueCurrency="USD"
      setRevenueCurrency={noop}
      revenueAsOf=""
      setRevenueAsOf={noop}
      revenueSourceUrl=""
      setRevenueSourceUrl={noop}
      revenueNote=""
      setRevenueNote={noop}
    />,
  );
}

// Every data-testid that exposes the revenue figure for editing.
const REVENUE_INPUT_TESTIDS = [
  "input-edit-account-revenue-amount",
  "select-edit-account-revenue-currency",
  "input-edit-account-revenue-asof",
  "input-edit-account-revenue-source",
  "input-edit-account-revenue-note",
];
const RESTRICTED_TESTID = "text-revenue-edit-restricted";

console.log("RevenueProfileFields \u2014 financial-authority gate");

test("restricted persona (canEditFinancials=false) sees the restricted note", () => {
  const html = render(false);
  assert(
    html.includes(`data-testid="${RESTRICTED_TESTID}"`),
    `expected the restricted note (${RESTRICTED_TESTID}) to render`,
  );
});

test("restricted persona sees NONE of the revenue editing inputs", () => {
  const html = render(false);
  for (const id of REVENUE_INPUT_TESTIDS) {
    assert(
      !html.includes(`data-testid="${id}"`),
      `revenue input "${id}" must NOT render when financial authority is absent`,
    );
  }
});

test("restricted persona still sees the (non-financial) employee count input", () => {
  const html = render(false);
  assert(
    html.includes('data-testid="input-edit-account-employees"'),
    "non-financial fields (employees) must remain editable",
  );
});

test("authorised persona (canEditFinancials=true) sees the revenue inputs", () => {
  const html = render(true);
  for (const id of REVENUE_INPUT_TESTIDS) {
    assert(
      html.includes(`data-testid="${id}"`),
      `revenue input "${id}" must render when financial authority is present`,
    );
  }
});

test("authorised persona does NOT see the restricted note", () => {
  const html = render(true);
  assert(
    !html.includes(`data-testid="${RESTRICTED_TESTID}"`),
    "the restricted note must not render when editing is allowed",
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
