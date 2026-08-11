/**
 * Task #939 — offline probes for the `find_screen` capability + the
 * shared screen catalog. No DB, no LLM, no network.
 *
 *   pnpm --filter @workspace/api-server test:app-navigation
 *
 * Covers:
 *   1. Persona surfaces: partner / employee / contractor / alliance_partner
 *      get meta.find_screen; board_observer gets it via the meta module.
 *   2. Partner ask → answer + valid navigateTo shape.
 *   3. Self-only filter: employee asking for org screens (pipeline) gets
 *      "not found" — no leak; me-lens asks resolve with /me links.
 *   4. Parameterized workspaces (tasks/RAID) → location text, navigateTo null.
 *   5. Alliance partner slice is partner-portal-only.
 *   6. Mobile hint only on mobile-mapped paths.
 */
import assert from "node:assert/strict";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  capabilitiesForPersona,
  findByToolName,
  validateNavigateToShape,
} from "../../src/lib/atelier-cli/capability-catalog.js";
import { screensForRole, matchScreens } from "@workspace/screen-catalog";
import type { ToolContext } from "../../src/lib/atelier-cli/index.js";

let pass = 0;
let fail = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.stack : String(err)}`);
  }
}

function ctxFor(role: string): ToolContext {
  return {
    persona: { id: `p_test_${role}`, name: `Test ${role}`, role } as ToolContext["persona"],
    turnId: "t_test",
    sessionId: "s_test",
    stepIdx: 0,
  };
}

const cap = findByToolName("find_screen");

async function main() {
  console.log("find_screen — persona surfaces");
  await test("registered as a read capability", () => {
    assert.ok(cap, "find_screen not registered");
    assert.equal(cap!.isWrite, false);
    assert.equal(cap!.id, "meta.find_screen");
  });
  for (const role of ["partner", "employee", "contractor", "alliance_partner", "board_observer"]) {
    await test(`${role} surface includes find_screen`, () => {
      const ids = capabilitiesForPersona({ id: "x", name: "x", role } as never).map((e) => e.id);
      assert.ok(ids.includes("meta.find_screen"), `missing for ${role}: ${ids.slice(0, 5).join(",")}…`);
    });
  }

  console.log("find_screen — answers");
  await test("partner: pipeline → /clients/opportunities + valid navigateTo", async () => {
    const res = await cap!.run({ query: "where do I see the pipeline?" }, ctxFor("partner"));
    assert.equal(res.ok, true);
    const d = res.data as Record<string, unknown>;
    assert.equal(d.href, "/clients/opportunities");
    assert.equal(String(d.location), "Clients → Opportunities");
    validateNavigateToShape(d.navigateTo);
    assert.deepEqual(d.navigateTo, { path: "/clients/opportunities", when: "on_commit" });
  });

  await test("employee: payslips → /me/pay with mobile hint", async () => {
    const res = await cap!.run({ query: "where do I find my payslips?" }, ctxFor("employee"));
    assert.equal(res.ok, true);
    const d = res.data as Record<string, unknown>;
    assert.equal(d.href, "/me/pay");
    assert.ok(typeof d.mobile === "string" && d.mobile.length > 0, "expected mobile hint on /me path");
  });

  await test("employee: pipeline → not found (no org-screen leak)", async () => {
    const res = await cap!.run({ query: "sales pipeline" }, ctxFor("employee"));
    assert.equal(res.ok, true);
    const d = res.data as Record<string, unknown>;
    assert.equal(d.navigateTo ?? null, null);
    assert.equal(d.href ?? null, null);
    const text = JSON.stringify(d);
    assert.ok(!text.includes("/clients"), `leaked org path: ${text}`);
  });

  await test("partner: tasks/RAID → parameterized workspace, navigateTo null", async () => {
    const res = await cap!.run({ query: "where do I see RAID tasks?" }, ctxFor("partner"));
    assert.equal(res.ok, true);
    const d = res.data as Record<string, unknown>;
    assert.equal(d.navigateTo, null, "parameterized screens must not deep-link");
    assert.equal(d.href, null);
    assert.ok(String(d.note).length > 0, "expected a location description");
    assert.ok(String(d.location).includes("→"), "expected a breadcrumb");
  });

  await test("contractor: performance reviews → not found (no /me/performance leak)", async () => {
    // Contractors have no Performance section (server 403s reviews/goals);
    // the catalog must not name or link it — not even as an alternate.
    const res = await cap!.run({ query: "where are my performance reviews and goals?" }, ctxFor("contractor"));
    assert.equal(res.ok, true);
    const text = JSON.stringify(res.data);
    assert.ok(!text.includes("/me/performance"), `leaked contractor-denied screen: ${text}`);
    assert.ok(!screensForRole("contractor").some((s) => s.path === "/me/performance"));
    assert.ok(screensForRole("employee").some((s) => s.path === "/me/performance"));
  });

  await test("alliance_partner: invoices → partner portal billing only", async () => {
    const res = await cap!.run({ query: "where are our invoices?" }, ctxFor("alliance_partner"));
    assert.equal(res.ok, true);
    const d = res.data as Record<string, unknown>;
    assert.equal(d.href, "/partner/billing");
  });

  await test("empty query → explicit error, not a guess", async () => {
    const res = await cap!.run({ query: "  " }, ctxFor("partner"));
    assert.equal(res.ok, false);
  });

  console.log("screen catalog — role slices");
  await test("employee slice is me-lens + chat only", () => {
    const paths = screensForRole("employee").map((s) => s.path);
    assert.ok(paths.length > 0);
    for (const p of paths) {
      assert.ok(p === "/cli" || p === "/me" || p.startsWith("/me/"), `unexpected: ${p}`);
    }
  });
  await test("alliance_partner slice is /partner + chat only", () => {
    const paths = screensForRole("alliance_partner").map((s) => s.path);
    assert.ok(paths.length > 0);
    for (const p of paths) {
      assert.ok(p === "/cli" || p === "/partner" || p.startsWith("/partner/"), `unexpected: ${p}`);
    }
  });
  await test("partner slice includes contracts lens; consultant's does not", () => {
    const partner = screensForRole("partner").map((s) => s.path);
    const consultant = screensForRole("consultant").map((s) => s.path);
    assert.ok(partner.some((p) => p.startsWith("/contracts")));
    assert.ok(!consultant.some((p) => p.startsWith("/contracts")));
  });
  await test("matchScreens is deterministic and role-scoped", () => {
    const m = matchScreens("expenses", screensForRole("employee"));
    assert.ok(m.length > 0);
    assert.equal(m[0].screen.path, "/me/expenses");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
