/**
 * Task #406 — deterministic per-persona tests for the read-only
 * finance / win-loss / leave-queue / contract chat capabilities.
 *
 * Runs entirely in-process against the dev DB (no HTTP, no LLM):
 *   1. Catalog registration — every new tool is registered read-only.
 *   2. Catalog persona gating — codex tools stripped for restricted
 *      personas; employee keeps the self-scope contract list.
 *   3. Run-level ACL — explicit refusals (never silent empties) for
 *      recruiter and self-scope personas; approver gate on the leave
 *      queue; partner gate on templates.
 *   4. Happy paths — founding partner gets real payload shapes.
 *
 * Usage: pnpm --filter api-server run test:cli-finance-ops
 * (Never register this as a workflow.)
 */
import assert from "node:assert/strict";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  capabilitiesForPersona,
  findByToolName,
} from "../../src/lib/atelier-cli/capability-catalog.js";
import type { CliPersona, ToolContext, ToolResult } from "../../src/lib/atelier-cli/index.js";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      fail++;
      console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.stack : String(err)}`);
    });
}

const ORG = "org_t406_test";
function persona(role: string): CliPersona {
  return { id: `u_t406_${role}`, name: `T406 ${role}`, role, orgId: ORG };
}
function ctxFor(p: CliPersona): ToolContext {
  return { persona: p, turnId: "t406-turn", sessionId: "t406-session", stepIdx: 0 };
}
async function runTool(
  toolName: string,
  p: CliPersona,
  input: Record<string, unknown> = {},
): Promise<ToolResult> {
  const entry = findByToolName(toolName);
  assert.ok(entry, `tool ${toolName} not registered`);
  return entry!.run(input, ctxFor(p));
}
function expectForbidden(r: ToolResult, label: string): void {
  assert.equal(r.ok, false, `${label}: expected refusal, got ok`);
  assert.equal((r as { errorCode?: string }).errorCode, "forbidden", `${label}: errorCode`);
  const msg = (r as { errorMessage?: string }).errorMessage ?? "";
  assert.ok(msg.length > 10, `${label}: refusal must carry an explanation`);
}

const NEW_TOOLS = [
  "finance_report_pnl",
  "finance_report_bs",
  "finance_report_cf",
  "finance_report_profitability",
  "finance_entity_expiries",
  "winloss_debrief_by_opportunity",
  "winloss_theme_library",
  "leave_pending_queue",
  "leave_team_calendar",
  "contract_list",
  "contract_template_list",
];

async function main() {
  console.log("Task #406 — finance/ops read capabilities\n");

  console.log("[1] Catalog registration");
  await test("all new tools registered, read-only, no confirm, carded", () => {
    for (const t of NEW_TOOLS) {
      const e = findByToolName(t);
      assert.ok(e, `${t} missing`);
      assert.equal(e!.isWrite, false, `${t} must be read-only`);
      assert.equal(e!.twoPhaseConfirm, false, `${t} must not confirm`);
      assert.ok(e!.resultCard, `${t} must declare a result card`);
      assert.ok(
        ["kpi_strip", "ranked_list", "entity_card"].includes(e!.resultCard!),
        `${t} card must be a client-rendered shape`,
      );
      assert.ok((e!.examplePhrases?.en?.length ?? 0) > 0, `${t} needs example prompts`);
    }
  });

  console.log("\n[2] Catalog persona gating");
  await test("restricted personas never see the codex contract tools", () => {
    for (const role of ["contractor", "partner_firm_resource", "recruiter"]) {
      const names = new Set(capabilitiesForPersona(persona(role)).map((e) => e.toolName));
      assert.ok(!names.has("contract_list"), `${role} must not see contract_list`);
      assert.ok(!names.has("contract_template_list"), `${role} must not see templates`);
    }
  });
  await test("employee keeps the self-scope contract list in the catalog", () => {
    const names = new Set(capabilitiesForPersona(persona("employee")).map((e) => e.toolName));
    assert.ok(names.has("contract_list"), "employee must see contract_list (self-scope)");
  });
  await test("founding partner sees every new tool", () => {
    const names = new Set(
      capabilitiesForPersona(persona("founding_partner")).map((e) => e.toolName),
    );
    for (const t of NEW_TOOLS) assert.ok(names.has(t), `founding_partner missing ${t}`);
  });

  console.log("\n[3] Run-level ACL — explicit refusals");
  await test("recruiter refused on finance reports + expiries + win/loss", async () => {
    expectForbidden(await runTool("finance_report_pnl", persona("recruiter")), "pnl");
    expectForbidden(await runTool("finance_entity_expiries", persona("recruiter")), "expiries");
    expectForbidden(await runTool("winloss_theme_library", persona("recruiter")), "themes");
    expectForbidden(await runTool("contract_list", persona("recruiter")), "contracts");
  });
  await test("self-scope personas refused on org-wide surfaces", async () => {
    for (const role of ["employee", "contractor", "partner_firm_resource"]) {
      expectForbidden(await runTool("finance_report_bs", persona(role)), `${role} bs`);
      expectForbidden(
        await runTool("winloss_debrief_by_opportunity", persona(role), { opportunity: "x" }),
        `${role} debrief`,
      );
      expectForbidden(await runTool("leave_pending_queue", persona(role)), `${role} leave`);
    }
  });
  await test("leave queue requires approver tier (lead/HR), not just non-restricted", async () => {
    expectForbidden(await runTool("leave_pending_queue", persona("board_observer")), "observer");
    expectForbidden(await runTool("leave_team_calendar", persona("board_observer")), "observer cal");
  });
  await test("templates are partner-tier only", async () => {
    expectForbidden(await runTool("contract_template_list", persona("senior_manager")), "sm");
    expectForbidden(await runTool("contract_template_list", persona("employee")), "employee");
  });

  console.log("\n[4] Happy paths (founding partner + HR + employee)");
  const fp = persona("founding_partner");
  await test("finance_report_pnl returns consolidated + variance + commentary", async () => {
    const r = await runTool("finance_report_pnl", fp, { scope: "ytd", currency: "USD" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const d = (r as { data: Record<string, unknown> }).data;
    assert.equal(d.scope, "ytd");
    assert.equal(d.currency, "USD");
    assert.ok(d.consolidated, "consolidated missing");
    assert.ok(d.variance, "variance missing");
    assert.ok(Array.isArray(d.commentary), "commentary missing");
    assert.ok(Array.isArray(d.perEntity), "perEntity missing");
  });
  await test("finance_report_bs / cf / profitability return shaped payloads", async () => {
    const bs = await runTool("finance_report_bs", fp, {});
    assert.equal(bs.ok, true);
    assert.ok((bs as { data: Record<string, unknown> }).data.consolidated);
    const cf = await runTool("finance_report_cf", fp, { scope: "r12" });
    assert.equal(cf.ok, true);
    assert.ok((cf as { data: Record<string, unknown> }).data.consolidated);
    const prof = await runTool("finance_report_profitability", fp, {});
    assert.equal(prof.ok, true);
    const pd = (prof as { data: Record<string, unknown> }).data;
    assert.ok(Array.isArray(pd.byClient), "byClient missing");
    assert.ok(Array.isArray(pd.topEngagements), "topEngagements missing");
  });
  await test("bad scope/currency inputs are clamped, not errors", async () => {
    const r = await runTool("finance_report_pnl", fp, { scope: "bogus", currency: "XXX" });
    assert.equal(r.ok, true);
    const d = (r as { data: Record<string, unknown> }).data;
    assert.equal(d.scope, "ytd");
    assert.equal(d.currency, "USD");
  });
  await test("finance_entity_expiries clamps window + returns sorted items", async () => {
    const r = await runTool("finance_entity_expiries", fp, { windowDays: 9999 });
    assert.equal(r.ok, true);
    const d = (r as { data: { windowDays: number; items: Array<{ daysOut: number }> } }).data;
    assert.equal(d.windowDays, 365);
    for (let i = 1; i < d.items.length; i++) {
      assert.ok(d.items[i - 1].daysOut <= d.items[i].daysOut, "items must be sorted");
    }
  });
  await test("winloss_debrief: unknown opportunity → explicit not-found", async () => {
    const r = await runTool("winloss_debrief_by_opportunity", fp, {
      opportunity: "zz-no-such-opp-t406-zz",
    });
    assert.equal(r.ok, false);
    assert.equal((r as { errorCode?: string }).errorCode, "not-found");
  });
  await test("winloss_theme_library returns a list (possibly empty) for fp", async () => {
    const r = await runTool("winloss_theme_library", fp, { polarity: "win", limit: 5 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray((r as { data: { themes: unknown[] } }).data.themes));
  });
  await test("leave queue + calendar work for HR (empty org → empty lists, ok:true)", async () => {
    const hr = persona("hr");
    const q = await runTool("leave_pending_queue", hr, {});
    assert.equal(q.ok, true, JSON.stringify(q));
    assert.ok(Array.isArray((q as { data: { requests: unknown[] } }).data.requests));
    const cal = await runTool("leave_team_calendar", hr, {
      start: "2026-07-01",
      end: "2026-07-31",
    });
    assert.equal(cal.ok, true);
    assert.ok(Array.isArray((cal as { data: { entries: unknown[] } }).data.entries));
  });
  await test("leave calendar rejects inverted window explicitly", async () => {
    const r = await runTool("leave_team_calendar", persona("hr"), {
      start: "2026-08-31",
      end: "2026-08-01",
    });
    assert.equal(r.ok, false);
    assert.equal((r as { errorCode?: string }).errorCode, "invalid-input");
  });
  await test("employee contract_list degrades to explicit self-scope (never silent)", async () => {
    const r = await runTool("contract_list", persona("employee"), {});
    assert.equal(r.ok, true, JSON.stringify(r));
    const d = (r as { data: { scope: string; note?: string; contracts: unknown[] } }).data;
    assert.equal(d.scope, "self");
    assert.ok((d.note ?? "").includes("Self-scope"), "self-scope note required");
    assert.ok(Array.isArray(d.contracts));
  });
  await test("fp contract_list + template_list return org-wide payloads", async () => {
    const c = await runTool("contract_list", fp, { limit: 10 });
    assert.equal(c.ok, true, JSON.stringify(c));
    assert.equal((c as { data: { scope: string } }).data.scope, "all");
    const t = await runTool("contract_template_list", fp, {});
    assert.equal(t.ok, true, JSON.stringify(t));
    assert.ok(Array.isArray((t as { data: { templates: unknown[] } }).data.templates));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
