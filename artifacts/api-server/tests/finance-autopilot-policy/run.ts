/**
 * Task #1091 — auto-post policy engine probe (pure, no DB).
 *
 * Guarantees the reviewer asked for:
 *   1. Defaults preserve current behaviour (a plain upload with no field
 *      confidences never auto-advances; a well-parsed small known-vendor
 *      invoice DOES auto under defaults).
 *   2. Lowering supplierInvoiceAutoMaxAed blocks a previously-auto invoice.
 *   3. Never-auto kinds can NEVER return auto:true (and assertNeverAuto
 *      throws only for auto-eligible kinds).
 *   4. Bookkeeper deterministic journals are always-auto by matrix.
 *   5. Cash application autos only on an exact single-candidate match.
 *
 * Run: pnpm exec tsx tests/finance-autopilot-policy/run.ts
 */
import {
  evaluateAutoPost,
  assertNeverAuto,
  isNeverAuto,
  FINANCE_AUTOPILOT_DEFAULTS,
  type AutoPostKind,
} from "../../src/lib/atelier-finance-autopolicy.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const T = { ...FINANCE_AUTOPILOT_DEFAULTS };

// 1) Defaults preserve current behaviour.
const plainUpload = evaluateAutoPost({
  kind: "supplier_invoice", thresholds: T,
  amountAedEquivalent: 500, confidences: [], knownVendor: true,
});
check("plain upload (no confidences) never autos under defaults", plainUpload.auto === false, plainUpload);

const wellParsed = evaluateAutoPost({
  kind: "supplier_invoice", thresholds: T,
  amountAedEquivalent: 800, confidences: [0.95, 0.92, 0.99], knownVendor: true,
});
check("small, high-confidence, known-vendor invoice autos under defaults", wellParsed.auto === true, wellParsed);

const unknownVendor = evaluateAutoPost({
  kind: "supplier_invoice", thresholds: T,
  amountAedEquivalent: 800, confidences: [0.95, 0.92], knownVendor: false,
});
check("unknown vendor never autos", unknownVendor.auto === false, unknownVendor);

const weakField = evaluateAutoPost({
  kind: "supplier_invoice", thresholds: T,
  amountAedEquivalent: 800, confidences: [0.95, 0.6], knownVendor: true,
});
check("one weak field blocks the whole doc", weakField.auto === false, weakField);

const overCeiling = evaluateAutoPost({
  kind: "supplier_invoice", thresholds: T,
  amountAedEquivalent: 1500, confidences: [0.99], knownVendor: true,
});
check("above default ceiling (1000) blocks auto", overCeiling.auto === false, overCeiling);

// 2) Lowering supplierInvoiceAutoMaxAed blocks a previously-auto invoice.
const lowered = { ...T, supplierInvoiceAutoMaxAed: 500 };
const nowBlocked = evaluateAutoPost({
  kind: "supplier_invoice", thresholds: lowered,
  amountAedEquivalent: 800, confidences: [0.95, 0.92, 0.99], knownVendor: true,
});
check("lowering the ceiling to 500 blocks the previously-auto AED 800 invoice", nowBlocked.auto === false, nowBlocked);

// 3) Never-auto kinds can NEVER return auto:true.
const neverKinds: AutoPostKind[] = [
  "payment_run", "vendor_bank_change", "client_invoice_issue", "dunning_send",
  "period_close", "statutory_filed", "payroll_run", "journal_reversal", "recon_finalise",
];
for (const k of neverKinds) {
  const r = evaluateAutoPost({ kind: k, thresholds: T, amountAedEquivalent: 1, confidences: [1, 1], knownVendor: true, exactSingleCandidate: true });
  check(`never-auto: ${k} is auto:false regardless of signals`, r.auto === false, r);
  check(`never-auto: ${k} flagged by isNeverAuto`, isNeverAuto(k) === true);
  let threw = false;
  try { assertNeverAuto(k); } catch { threw = true; }
  check(`assertNeverAuto(${k}) does NOT throw (correctly never-auto)`, threw === false);
}
// assertNeverAuto MUST throw for auto-eligible kinds (the guard's purpose).
for (const k of ["supplier_invoice", "ai_journal", "cash_application", "bookkeeper_journal"] as AutoPostKind[]) {
  let threw = false;
  try { assertNeverAuto(k); } catch { threw = true; }
  check(`assertNeverAuto(${k}) throws for an auto-eligible kind`, threw === true);
}

// 4) Bookkeeper deterministic journals always auto.
const bk = evaluateAutoPost({ kind: "bookkeeper_journal", thresholds: T });
check("bookkeeper_journal is always-auto", bk.auto === true, bk);

// 5) Cash application autos only on exact single-candidate.
const cashExact = evaluateAutoPost({ kind: "cash_application", thresholds: T, exactSingleCandidate: true });
check("cash_application autos on exact single-candidate", cashExact.auto === true, cashExact);
const cashAmbiguous = evaluateAutoPost({ kind: "cash_application", thresholds: T, exactSingleCandidate: false });
check("cash_application does NOT auto when not exact single-candidate", cashAmbiguous.auto === false, cashAmbiguous);

// ai_journal: high confidence + under ceiling autos; over ceiling blocks.
const aiOk = evaluateAutoPost({ kind: "ai_journal", thresholds: T, amountAedEquivalent: 4000, confidences: [0.95, 0.91] });
check("ai_journal autos when confident and under journal ceiling", aiOk.auto === true, aiOk);
const aiOver = evaluateAutoPost({ kind: "ai_journal", thresholds: T, amountAedEquivalent: 6000, confidences: [0.99] });
check("ai_journal blocks above the journal ceiling (5000)", aiOver.auto === false, aiOver);

// Every auto/deny decision carries at least one reason.
check("well-parsed decision records reasons", wellParsed.reasons.length > 0);
check("never-auto decision records a reason", evaluateAutoPost({ kind: "payment_run", thresholds: T }).reasons.length > 0);

if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
console.log("\nAll finance-autopilot-policy checks passed.");
