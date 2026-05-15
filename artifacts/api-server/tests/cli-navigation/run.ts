/**
 * Task #500 — Unit tests for `resolveNavPath`.
 *
 * Locks in the (verb, kind) → SPA route mapping consumed by the chat's
 * propose/commit auto-navigation path. Pure module; no HTTP, no DB.
 *
 *   pnpm --filter @workspace/api-server test:cli-navigation
 */
import assert from "node:assert/strict";
import {
  resolveNavPath,
  type NavWriteVerb,
  type NavWriteKind,
} from "../../src/lib/atelier-cli/orchestrator-nav-path.js";

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

function nav(
  verb: NavWriteVerb,
  kind: NavWriteKind,
  targetId: string | null,
  payload: Record<string, unknown> = {},
  resultData?: unknown,
): string | null {
  return resolveNavPath({ verb, kind, targetId, payload, resultData });
}

console.log("resolveNavPath — every supported kind");

// account ----------------------------------------------------------
test("account update → /accounts/:id from targetId", () => {
  assert.equal(nav("update", "account", "acc_42", {}), "/accounts/acc_42");
});
test("account create → /accounts/:id from result.id", () => {
  assert.equal(nav("create", "account", null, {}, { id: "acc_99" }), "/accounts/acc_99");
});
test("account create with no id → null", () => {
  assert.equal(nav("create", "account", null, {}), null);
});

// opportunity ------------------------------------------------------
test("opportunity transition → /opportunities/:id", () => {
  assert.equal(nav("transition", "opportunity", "opp_1", {}), "/opportunities/opp_1");
});
test("opportunity create with result.id → /opportunities/:id", () => {
  assert.equal(
    nav("create", "opportunity", null, {}, { id: "opp_new" }),
    "/opportunities/opp_new",
  );
});

// contact ----------------------------------------------------------
test("contact create with payload.accountId → /accounts/:accountId", () => {
  assert.equal(nav("create", "contact", null, { accountId: "acc_7" }), "/accounts/acc_7");
});
test("contact create without accountId → null", () => {
  assert.equal(nav("create", "contact", null, {}), null);
});
test("contact update prefers result.accountId over payload", () => {
  assert.equal(
    nav("update", "contact", "ct_1", { accountId: "acc_old" }, { accountId: "acc_new" }),
    "/accounts/acc_new",
  );
});

// engagement -------------------------------------------------------
test("engagement create → /clients/deliver/engagements/:id", () => {
  assert.equal(
    nav("create", "engagement", null, {}, { id: "eng_1" }),
    "/clients/deliver/engagements/eng_1",
  );
});

// deliverable ------------------------------------------------------
test("deliverable create with engagementId + id → nested path", () => {
  assert.equal(
    nav("create", "deliverable", null, { engagementId: "eng_1" }, { id: "del_5" }),
    "/clients/deliver/engagements/eng_1/deliverables/del_5",
  );
});
test("deliverable with engagementId but no id → engagement page", () => {
  assert.equal(
    nav("create", "deliverable", null, { engagementId: "eng_1" }),
    "/clients/deliver/engagements/eng_1",
  );
});
test("deliverable without engagementId → null", () => {
  assert.equal(nav("create", "deliverable", null, {}), null);
});

// expense ----------------------------------------------------------
test("expense update with id → /wallet/expenses/:id", () => {
  assert.equal(nav("update", "expense", "ex_1", {}), "/wallet/expenses/ex_1");
});
test("expense create with no id → /wallet/expenses/new", () => {
  assert.equal(nav("create", "expense", null, {}), "/wallet/expenses/new");
});
test("expense update with no id → null", () => {
  assert.equal(nav("update", "expense", null, {}), null);
});

// invoice ----------------------------------------------------------
test("invoice update with id → /wallet/invoices/:id", () => {
  assert.equal(nav("update", "invoice", "inv_1", {}), "/wallet/invoices/inv_1");
});
test("invoice create with no id → /wallet/invoices", () => {
  assert.equal(nav("create", "invoice", null, {}), "/wallet/invoices");
});

// contract ---------------------------------------------------------
test("contract with id → /codex/contracts/:id", () => {
  assert.equal(nav("update", "contract", "ct_1", {}), "/codex/contracts/ct_1");
});
test("contract without id → /codex (fallback)", () => {
  assert.equal(nav("create", "contract", null, {}), "/codex");
});

// agent_design -----------------------------------------------------
test("agent_design with id → /agents/design/:id", () => {
  assert.equal(nav("update", "agent_design", "ag_1", {}), "/agents/design/ag_1");
});
test("agent_design without id → null", () => {
  assert.equal(nav("create", "agent_design", null, {}), null);
});

// timesheet_entry --------------------------------------------------
test("timesheet_entry with personId + weekIso → /people/time/:p/:w", () => {
  assert.equal(
    nav("create", "timesheet_entry", null, { personId: "per_1", weekIso: "2026-W20" }),
    "/people/time/per_1/2026-W20",
  );
});
test("timesheet_entry accepts weekId as fallback for weekIso", () => {
  assert.equal(
    nav("update", "timesheet_entry", "te_1", { personId: "per_1", weekId: "tw_42" }),
    "/people/time/per_1/tw_42",
  );
});
test("timesheet_entry without person/week → /people/time", () => {
  assert.equal(nav("update", "timesheet_entry", "te_1", {}), "/people/time");
});

// raid_item / proposal / pov / change_order ------------------------
for (const kind of ["raid_item", "proposal", "pov", "change_order"] as const) {
  test(`${kind} with engagementId → engagement page`, () => {
    assert.equal(
      nav("create", kind, null, { engagementId: "eng_9" }),
      "/clients/deliver/engagements/eng_9",
    );
  });
  test(`${kind} with opportunityId only → opportunity page`, () => {
    assert.equal(
      nav("create", kind, null, { opportunityId: "opp_9" }),
      "/opportunities/opp_9",
    );
  });
  test(`${kind} prefers engagementId over opportunityId`, () => {
    assert.equal(
      nav("create", kind, null, { engagementId: "eng_9", opportunityId: "opp_9" }),
      "/clients/deliver/engagements/eng_9",
    );
  });
  test(`${kind} with neither → null`, () => {
    assert.equal(nav("create", kind, null, {}), null);
  });
}

// win_loss_debrief -------------------------------------------------
test("win_loss_debrief with opportunityId → /opportunities/:id/win-loss", () => {
  assert.equal(
    nav("create", "win_loss_debrief", null, { opportunityId: "opp_1" }),
    "/opportunities/opp_1/win-loss",
  );
});
test("win_loss_debrief without opportunityId → null", () => {
  assert.equal(nav("create", "win_loss_debrief", null, {}), null);
});

// kinds without a navigation destination ---------------------------
for (const kind of [
  "partner_link",
  "meeting",
  "rate_card",
  "renewal",
  "partner_firm",
  "win_theme",
  "brief",
] as const) {
  test(`${kind} has no SPA destination → null`, () => {
    assert.equal(nav("create", kind, "id_1", { engagementId: "eng_1" }), null);
  });
}

// resultData precedence --------------------------------------------
test("commit-phase result.id wins over targetId", () => {
  assert.equal(
    nav("update", "account", "acc_old", {}, { id: "acc_new" }),
    "/accounts/acc_new",
  );
});
test("non-string id values are ignored", () => {
  assert.equal(nav("update", "account", null, {}, { id: 42 }), null);
});
test("empty-string id values are ignored", () => {
  assert.equal(nav("update", "account", "", {}, { id: "" }), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
