import assert from "node:assert/strict";
import { executeAccountDossierRead } from "../../src/lib/atelier-cli/account-dossier-contract.js";

let accessCalls = 0;
let scopeCalls = 0;
let loadCalls = 0;
const run = (accountId: string, visible: boolean, exists: boolean) =>
  executeAccountDossierRead({
    accountId,
    loadAccess: async () => {
      accessCalls += 1;
      return { ids: new Set(["account-1"]) };
    },
    canSee: async (_access, id) => {
      scopeCalls += 1;
      return visible && id === "account-1";
    },
    loadWorkspace: async (_access, id) => {
      loadCalls += 1;
      return exists ? { account: { id }, contacts: [] } : null;
    },
  });

assert.deepEqual(await run("   ", true, true), { kind: "invalid_input" });
assert.deepEqual([accessCalls, scopeCalls, loadCalls], [0, 0, 0]);

assert.deepEqual(await run("account-1", false, true), { kind: "forbidden" });
assert.deepEqual([accessCalls, scopeCalls, loadCalls], [1, 1, 0]);

assert.deepEqual(await run("account-1", true, false), { kind: "not_found" });
assert.deepEqual([accessCalls, scopeCalls, loadCalls], [2, 2, 1]);

const first = await run(" account-1 ", true, true);
const second = await run("account-1", true, true);
assert.deepEqual(first, {
  kind: "ok",
  workspace: { account: { id: "account-1" }, contacts: [] },
});
assert.deepEqual(second, first);
assert.deepEqual([accessCalls, scopeCalls, loadCalls], [4, 4, 3]);

console.log("riser account-dossier conformance probes passed");