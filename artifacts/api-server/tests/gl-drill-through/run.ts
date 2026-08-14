/**
 * Task #1082 — glSourceHref drill-through URL contract.
 *
 * Pure unit test: asserts every GL source kind resolves to the app route
 * (and row-focus query param) the target pages consume, so a rename on
 * either side fails loudly here instead of silently breaking drill-through.
 *
 * Run: pnpm --filter @workspace/api-server run test:gl-drill-through
 */
import assert from "node:assert/strict";
import { glSourceHref } from "../../src/routes/atelier/glRoutes.js";

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL ${name}: ${(err as Error).message}`);
  }
}

check("invoice → detail page", () =>
  assert.equal(glSourceHref("invoice", "inv_1"), "/wallet/invoices/inv_1"));

check("expense → detail page", () =>
  assert.equal(glSourceHref("expense", "exp_1"), "/wallet/expenses/exp_1"));

check("bank_transaction → cash page with ?txn=", () =>
  assert.equal(glSourceHref("bank_transaction", "txn_1"), "/wallet/cash?txn=txn_1"));

check("self_billed_invoice → self-billing with ?focus=", () =>
  assert.equal(
    glSourceHref("self_billed_invoice", "sbi_1"),
    "/finance/payables/self-billing?focus=sbi_1",
  ));

check("partner_firm_invoice → partner invoices with ?focus=", () =>
  assert.equal(
    glSourceHref("partner_firm_invoice", "pfi_1"),
    "/finance/payables/partner-invoices?focus=pfi_1",
  ));

check("revrec_line with periodLabel → period + line params", () =>
  assert.equal(
    glSourceHref("revrec_line", "rpl_1", { periodLabel: "2026-07" }),
    "/wallet/revrec?period=2026-07&line=rpl_1",
  ));

check("revrec_line without periodLabel degrades to the list page", () => {
  assert.equal(glSourceHref("revrec_line", "rpl_1"), "/wallet/revrec");
  assert.equal(glSourceHref("revrec_line", "rpl_1", { periodLabel: null }), "/wallet/revrec");
});

check("contractor_payment stays on the list page (no per-row UI)", () =>
  assert.equal(glSourceHref("contractor_payment", "cp_1"), "/finance/payables/subcontractors"));

check("manual / unknown kinds → null (render as plain text)", () => {
  assert.equal(glSourceHref("manual", "x"), null);
  assert.equal(glSourceHref("mystery_kind", "x"), null);
});

check("source refs are URI-encoded", () => {
  assert.equal(glSourceHref("bank_transaction", "a b/c"), "/wallet/cash?txn=a%20b%2Fc");
  assert.equal(glSourceHref("invoice", "a b"), "/wallet/invoices/a%20b");
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll gl-drill-through checks passed.");
