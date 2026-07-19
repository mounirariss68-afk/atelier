/**
 * Task #500 — Unit tests for `resolveNavPath`.
 * Task #511 — Capability catalog runtime contract: every in-scope
 *   `isWrite` capability must return a `navigateTo` hint on commit
 *   (either a `{ path, when: "on_commit" }` pair or an explicit
 *   `null`). The contract is enforced **at runtime** by a wrapper
 *   installed in `defineCapability` (see
 *   `assertNavigateToContract`), and this test suite exercises that
 *   wrapper end-to-end:
 *
 *     1. Validates the wrapper's logic against synthetic results
 *        (compliant + non-compliant shapes, plus mid-flight
 *        envelopes that must be skipped).
 *     2. Iterates `listCapabilities().filter(c => c.isWrite)` and
 *        asserts every entry's `run` carries the wrapper marker
 *        (`__navContractWrapped`).
 *     3. Drives every write capability through a dry-run commit
 *        harness (`run({ confirm: true }, ctx)`) and asserts that
 *        any commit-success result satisfies the contract. Caps
 *        that legitimately fail before commit (validation, auth,
 *        missing DB row) are accepted; ONLY `navigateTo` contract
 *        violations are surfaced — and they include the offending
 *        capability id in the error message.
 *
 *   pnpm --filter @workspace/api-server test:cli-navigation
 */
import assert from "node:assert/strict";
import {
  resolveNavPath,
  type NavWriteVerb,
  type NavWriteKind,
} from "../../src/lib/atelier-cli/orchestrator-nav-path.js";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  listCapabilities,
  assertNavigateToContract,
  validateNavigateToShape,
} from "../../src/lib/atelier-cli/capability-catalog.js";
import type { ToolContext, ToolResult } from "../../src/lib/atelier-cli/index.js";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        pass++;
        console.log(`  ✓ ${name}`);
      },
      (err) => {
        fail++;
        console.error(
          `  ✗ ${name}\n      ${err instanceof Error ? err.stack : String(err)}`,
        );
      },
    );
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

async function main(): Promise<void> {
  console.log("resolveNavPath — every supported kind");

  // account ----------------------------------------------------------
  await test("account update → /accounts/:id from targetId", () => {
    assert.equal(nav("update", "account", "acc_42", {}), "/accounts/acc_42");
  });
  await test("account create → /accounts/:id from result.id", () => {
    assert.equal(nav("create", "account", null, {}, { id: "acc_99" }), "/accounts/acc_99");
  });
  await test("account create with no id → null", () => {
    assert.equal(nav("create", "account", null, {}), null);
  });

  // opportunity ------------------------------------------------------
  await test("opportunity transition → /opportunities/:id", () => {
    assert.equal(nav("transition", "opportunity", "opp_1", {}), "/opportunities/opp_1");
  });
  await test("opportunity create with result.id → /opportunities/:id", () => {
    assert.equal(
      nav("create", "opportunity", null, {}, { id: "opp_new" }),
      "/opportunities/opp_new",
    );
  });

  // contact ----------------------------------------------------------
  await test("contact create with payload.accountId → /accounts/:accountId", () => {
    assert.equal(nav("create", "contact", null, { accountId: "acc_7" }), "/accounts/acc_7");
  });
  await test("contact create without accountId → null", () => {
    assert.equal(nav("create", "contact", null, {}), null);
  });
  await test("contact update prefers result.accountId over payload", () => {
    assert.equal(
      nav("update", "contact", "ct_1", { accountId: "acc_old" }, { accountId: "acc_new" }),
      "/accounts/acc_new",
    );
  });

  // engagement -------------------------------------------------------
  await test("engagement create → /clients/deliver/engagements/:id", () => {
    assert.equal(
      nav("create", "engagement", null, {}, { id: "eng_1" }),
      "/clients/deliver/engagements/eng_1",
    );
  });

  // deliverable ------------------------------------------------------
  await test("deliverable create with engagementId + id → nested path", () => {
    assert.equal(
      nav("create", "deliverable", null, { engagementId: "eng_1" }, { id: "del_5" }),
      "/clients/deliver/engagements/eng_1/deliverables/del_5",
    );
  });
  await test("deliverable with engagementId but no id → engagement page", () => {
    assert.equal(
      nav("create", "deliverable", null, { engagementId: "eng_1" }),
      "/clients/deliver/engagements/eng_1",
    );
  });
  await test("deliverable without engagementId → null", () => {
    assert.equal(nav("create", "deliverable", null, {}), null);
  });

  // expense ----------------------------------------------------------
  await test("expense update with id → /wallet/expenses/:id", () => {
    assert.equal(nav("update", "expense", "ex_1", {}), "/wallet/expenses/ex_1");
  });
  await test("expense create with no id → /wallet/expenses/new", () => {
    assert.equal(nav("create", "expense", null, {}), "/wallet/expenses/new");
  });
  await test("expense update with no id → null", () => {
    assert.equal(nav("update", "expense", null, {}), null);
  });

  // invoice ----------------------------------------------------------
  await test("invoice update with id → /wallet/invoices/:id", () => {
    assert.equal(nav("update", "invoice", "inv_1", {}), "/wallet/invoices/inv_1");
  });
  await test("invoice create with no id → /wallet/invoices", () => {
    assert.equal(nav("create", "invoice", null, {}), "/wallet/invoices");
  });

  // contract ---------------------------------------------------------
  await test("contract with id → /contracts/codex/contracts/:id", () => {
    assert.equal(nav("update", "contract", "ct_1", {}), "/contracts/codex/contracts/ct_1");
  });
  await test("contract without id → /contracts/codex (fallback)", () => {
    assert.equal(nav("create", "contract", null, {}), "/contracts/codex");
  });

  // agent_design -----------------------------------------------------
  await test("agent_design with id → /agents/design/:id", () => {
    assert.equal(nav("update", "agent_design", "ag_1", {}), "/agents/design/ag_1");
  });
  await test("agent_design without id → null", () => {
    assert.equal(nav("create", "agent_design", null, {}), null);
  });

  // timesheet_entry --------------------------------------------------
  await test("timesheet_entry with personId + weekIso → /people/time/:p/:w", () => {
    assert.equal(
      nav("create", "timesheet_entry", null, { personId: "per_1", weekIso: "2026-W20" }),
      "/people/time/per_1/2026-W20",
    );
  });
  await test("timesheet_entry accepts weekId as fallback for weekIso", () => {
    assert.equal(
      nav("update", "timesheet_entry", "te_1", { personId: "per_1", weekId: "tw_42" }),
      "/people/time/per_1/tw_42",
    );
  });
  await test("timesheet_entry without person/week → /people/time", () => {
    assert.equal(nav("update", "timesheet_entry", "te_1", {}), "/people/time");
  });

  // raid_item / proposal / pov / change_order ------------------------
  for (const kind of ["raid_item", "proposal", "pov", "change_order"] as const) {
    await test(`${kind} with engagementId → engagement page`, () => {
      assert.equal(
        nav("create", kind, null, { engagementId: "eng_9" }),
        "/clients/deliver/engagements/eng_9",
      );
    });
    await test(`${kind} with opportunityId only → opportunity page`, () => {
      assert.equal(
        nav("create", kind, null, { opportunityId: "opp_9" }),
        "/opportunities/opp_9",
      );
    });
    await test(`${kind} prefers engagementId over opportunityId`, () => {
      assert.equal(
        nav("create", kind, null, { engagementId: "eng_9", opportunityId: "opp_9" }),
        "/clients/deliver/engagements/eng_9",
      );
    });
    await test(`${kind} with neither → null`, () => {
      assert.equal(nav("create", kind, null, {}), null);
    });
  }

  // win_loss_debrief -------------------------------------------------
  await test("win_loss_debrief with opportunityId → /opportunities/:id/win-loss", () => {
    assert.equal(
      nav("create", "win_loss_debrief", null, { opportunityId: "opp_1" }),
      "/opportunities/opp_1/win-loss",
    );
  });
  await test("win_loss_debrief without opportunityId → null", () => {
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
    await test(`${kind} has no SPA destination → null`, () => {
      assert.equal(nav("create", kind, "id_1", { engagementId: "eng_1" }), null);
    });
  }

  // resultData precedence --------------------------------------------
  await test("commit-phase result.id wins over targetId", () => {
    assert.equal(
      nav("update", "account", "acc_old", {}, { id: "acc_new" }),
      "/accounts/acc_new",
    );
  });
  await test("non-string id values are ignored", () => {
    assert.equal(nav("update", "account", null, {}, { id: 42 }), null);
  });
  await test("empty-string id values are ignored", () => {
    assert.equal(nav("update", "account", "", {}, { id: "" }), null);
  });

  // =====================================================================
  // Task #511 — Behavior-based navigateTo contract assertions.
  // =====================================================================

  console.log("\nTask #511 — navigateTo contract validator (synthetic shapes)\n");

  // Wrapper-logic unit tests: drive `assertNavigateToContract` with
  // synthetic ToolResult shapes and verify the accept/reject decisions.
  await test("validateNavigateToShape accepts null", () => {
    assert.equal(validateNavigateToShape(null), null);
  });
  await test("validateNavigateToShape accepts { path, when: 'on_commit' }", () => {
    assert.equal(
      validateNavigateToShape({ path: "/accounts/acc_1", when: "on_commit" }),
      null,
    );
  });
  await test("validateNavigateToShape rejects undefined", () => {
    assert.match(String(validateNavigateToShape(undefined)), /missing/);
  });
  await test("validateNavigateToShape rejects wrong `when`", () => {
    assert.match(
      String(validateNavigateToShape({ path: "/x", when: "later" })),
      /when must equal "on_commit"/,
    );
  });
  await test("validateNavigateToShape rejects missing path", () => {
    assert.match(
      String(validateNavigateToShape({ when: "on_commit" })),
      /path must be a non-empty string/,
    );
  });
  await test("validateNavigateToShape rejects non-string path", () => {
    assert.match(
      String(validateNavigateToShape({ path: 42, when: "on_commit" })),
      /path must be a non-empty string/,
    );
  });

  await test("contract throws on commit-success without `navigateTo` key", () => {
    assert.throws(
      () =>
        assertNavigateToContract("synthetic.cap_a", {
          ok: true,
          data: { id: "x" },
        } as ToolResult),
      /\[capability "synthetic\.cap_a"\] commit-success result is missing the `navigateTo` key/,
    );
  });
  await test("contract throws on malformed navigateTo (wrong `when`)", () => {
    assert.throws(
      () =>
        assertNavigateToContract("synthetic.cap_b", {
          ok: true,
          data: { id: "x", navigateTo: { path: "/x", when: "later" } },
        } as ToolResult),
      /\[capability "synthetic\.cap_b"\] navigateTo contract violation/,
    );
  });
  await test("contract accepts navigateTo: null on commit success", () => {
    assertNavigateToContract("synthetic.cap_c", {
      ok: true,
      data: { id: "x", navigateTo: null },
    } as ToolResult);
  });
  await test("contract accepts well-formed navigateTo on commit success", () => {
    assertNavigateToContract("synthetic.cap_d", {
      ok: true,
      data: { id: "x", navigateTo: { path: "/accounts/x", when: "on_commit" } },
    } as ToolResult);
  });
  await test("contract skips read-only / failed results (ok: false)", () => {
    assertNavigateToContract("synthetic.cap_e", {
      ok: false,
      errorCode: "not_found",
      errorMessage: "x",
    } as ToolResult);
  });
  await test("contract skips confirmation envelope (mid-flight)", () => {
    assertNavigateToContract("synthetic.cap_f", {
      ok: true,
      confirmation: {
        summary: "s",
        diff: {},
        pending: { tool: "x", input: {} },
      },
      data: { preview: 1 },
    } as ToolResult);
  });
  await test("contract skips disambiguation envelope (mid-flight)", () => {
    assertNavigateToContract("synthetic.cap_g", {
      ok: true,
      disambiguation: { kind: "k", options: [] },
      data: { preview: 1 },
    } as ToolResult);
  });
  await test("contract skips clarification envelope (mid-flight)", () => {
    assertNavigateToContract("synthetic.cap_h", {
      ok: true,
      clarification: { field: "f", question: "q?", tool: "x" },
      data: { preview: 1 },
    } as ToolResult);
  });
  await test("contract skips when data is absent (no payload to attach hint to)", () => {
    assertNavigateToContract("synthetic.cap_i", { ok: true } as ToolResult);
  });

  // ---------------------------------------------------------------------
  // Catalog-driven assertions — iterate every isWrite cap, no allowlist.
  // ---------------------------------------------------------------------
  console.log("\nTask #511 — catalog write capabilities (run-time wrapper)\n");

  const catalog = listCapabilities();
  const writeCaps = catalog.filter((c) => c.isWrite === true);

  await test("catalog exposes at least one isWrite capability", () => {
    assert.ok(writeCaps.length > 0, "expected ≥1 isWrite cap in the catalog");
  });

  // 1. Every isWrite cap MUST be wrapped — `defineCapability` installs
  //    the runtime guard, so a regression that bypasses it (e.g. someone
  //    swapping `cap.run` after registration) surfaces here.
  for (const cap of writeCaps) {
    await test(`[${cap.id}] run is wrapped by the navigateTo contract guard`, () => {
      const marker = (cap.run as unknown as { __navContractWrapped?: boolean })
        .__navContractWrapped;
      assert.equal(
        marker,
        true,
        `cap "${cap.id}" run is not wrapped — defineCapability's contract guard was bypassed.`,
      );
    });
  }

  // 2. Dry-run commit harness — call each cap's run with `confirm: true`
  //    and a minimal in-process context. Caps that legitimately can't
  //    commit (DB row missing, permission denied, schema invalid) return
  //    `ok: false` or throw a non-contract error; we accept those. The
  //    wrapper itself enforces the contract on any commit-success path
  //    that DOES execute, throwing with the cap id baked into the
  //    message — which we re-assert here so failures are unambiguous.
  const NAV_CONTRACT_RE = /navigateTo contract violation|missing the `navigateTo` key/;
  const ctx: ToolContext = {
    persona: {
      id: "p_test_navigateTo",
      name: "Test Persona",
      role: "founding_partner",
      orgId: "org_test_navigateTo",
    },
    turnId: "turn_test_navigateTo",
    sessionId: "sess_test_navigateTo",
    stepIdx: 0,
  };
  for (const cap of writeCaps) {
    await test(`[${cap.id}] dry-run commit honours the navigateTo contract`, async () => {
      let result: ToolResult | undefined;
      try {
        result = await cap.run({ confirm: true }, ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Only contract violations are real failures here. Everything
        // else (DB errors, validation errors) means the cap couldn't
        // reach a commit in this dry-run harness — which is fine.
        if (NAV_CONTRACT_RE.test(msg)) {
          throw new Error(
            `cap "${cap.id}" violated the navigateTo contract on commit:\n      ${msg}`,
          );
        }
        return;
      }
      // If the cap DID commit, the wrapper has already validated the
      // shape (it would have thrown above). Re-assert defensively so
      // the test message is keyed by capability id even if the wrapper
      // is somehow bypassed.
      if (
        result &&
        result.ok === true &&
        !result.confirmation &&
        !result.disambiguation &&
        !result.clarification &&
        !result.refusal &&
        result.data &&
        typeof result.data === "object"
      ) {
        const data = result.data as Record<string, unknown>;
        if (!("navigateTo" in data)) {
          throw new Error(
            `cap "${cap.id}" commit-success result is missing the navigateTo key`,
          );
        }
        const err = validateNavigateToShape(data.navigateTo);
        assert.equal(
          err,
          null,
          `cap "${cap.id}" navigateTo contract violation: ${err}`,
        );
      }
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

await main();
