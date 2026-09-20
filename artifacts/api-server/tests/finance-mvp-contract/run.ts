import assert from "node:assert/strict";
import {
  FINANCE_MVP_APPROVAL_STATES,
  FINANCE_MVP_CATEGORIES,
  FINANCE_MVP_CONTRACT,
  FINANCE_MVP_ENTITY_STATES,
  FINANCE_MVP_PERIOD_DIMENSIONS,
  FINANCE_MVP_SOURCE_TYPES,
} from "../../src/routes/atelier/financeMvpContract.js";

assert.equal(FINANCE_MVP_CONTRACT.version, "finance-mvp.v1");
assert.deepEqual(FINANCE_MVP_CONTRACT.entityStates, FINANCE_MVP_ENTITY_STATES);
assert.ok(FINANCE_MVP_ENTITY_STATES.includes("planned"));
assert.ok(FINANCE_MVP_ENTITY_STATES.includes("in_formation"));
assert.ok(FINANCE_MVP_SOURCE_TYPES.includes("shareholder_contribution"));
assert.ok(FINANCE_MVP_SOURCE_TYPES.includes("bank_transaction"));
assert.ok(FINANCE_MVP_CATEGORIES.includes("setup"));
assert.deepEqual(FINANCE_MVP_PERIOD_DIMENSIONS, ["month", "quarter", "year"]);
assert.ok(FINANCE_MVP_APPROVAL_STATES.includes("pending_review"));
assert.equal(FINANCE_MVP_CONTRACT.summaryPath, "/finance/mvp/summary");
console.log("finance MVP contract: ok");