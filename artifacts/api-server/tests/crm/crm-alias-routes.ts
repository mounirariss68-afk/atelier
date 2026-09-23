import assert from "node:assert/strict";
import {
  CRM_ALIAS_ROUTE_CONTRACT,
  canGovernCrmAliases,
  normalizeAlias,
} from "../../src/routes/atelier/crmAliasRoutes.js";

assert.deepEqual(CRM_ALIAS_ROUTE_CONTRACT, [
  { method: "GET", path: "/crm/aliases" },
  { method: "POST", path: "/crm/aliases" },
  { method: "POST", path: "/crm/aliases/:id/retire" },
]);
assert.equal(normalizeAlias("  Acme—International  "), "acme international");
assert.equal(canGovernCrmAliases("partner"), true);
assert.equal(canGovernCrmAliases("founding_partner"), true);
assert.equal(canGovernCrmAliases("senior_manager"), false);
assert.equal(canGovernCrmAliases("employee"), false);
console.log("CRM alias route contract passed");