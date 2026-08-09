/**
 * Task #853 — universal entity lookups + AR rollups.
 *
 * Runs in-process against the dev DB (no HTTP, no LLM):
 *   1. Catalog registration + self-only catalog widening.
 *   2. entity_detail id + typed-query paths per provider kind.
 *   3. Cross-type / same-type ambiguity → disambiguation option ids are
 *      the exact tool-input values (resume via `id`).
 *   4. statement_of_account math vs seeded invoice/cash-application rows.
 *   5. pending_invoices fuzzy account-vs-engagement ambiguity + resume.
 *   6. ACL: board observer AR denial (rollup message), restricted persona
 *      denial, self-only clamp boundary (staffed-only visibility).
 *
 * Usage: pnpm --filter @workspace/api-server run test:entity-detail
 * (Never register this as a workflow.)
 */
import assert from "node:assert/strict";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  capabilitiesForPersona,
  findByToolName,
} from "../../src/lib/atelier-cli/capability-catalog.js";
import type { CliPersona, ToolContext, ToolResult } from "../../src/lib/atelier-cli/index.js";
import {
  db,
  atelierAccounts,
  atelierAccountTeamMembers,
  atelierCashApplication,
  atelierCashReceipt,
  atelierContractRecords,
  atelierDeliverables,
  atelierEngagementAccess,
  atelierEngagements,
  atelierInvoice,
  atelierOpportunities,
  atelierPartnerFirms,
  atelierPovs,
} from "@workspace/db";
import { eq, like } from "drizzle-orm";

let pass = 0;
let fail = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.stack : String(err)}`);
  }
}

const ORG = "org_t853";
function persona(role: string, id = `u_t853_${role}`): CliPersona {
  return { id, name: `T853 ${role}`, role, orgId: ORG } as CliPersona;
}
function ctxFor(p: CliPersona): ToolContext {
  return { persona: p, turnId: "t853-turn", sessionId: "t853-session", stepIdx: 0 } as ToolContext;
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
  assert.equal(r.ok, false, `${label}: expected refusal, got ${JSON.stringify(r).slice(0, 200)}`);
  assert.equal((r as { errorCode?: string }).errorCode, "forbidden", `${label}: errorCode`);
}
function dataOf(r: ToolResult): Record<string, unknown> {
  assert.equal(r.ok, true, `expected ok result, got ${JSON.stringify(r).slice(0, 300)}`);
  return (r as { data: Record<string, unknown> }).data;
}

// ─────────────────────────── seed ids ───────────────────────────
const ACC = "acc_t853_tasama";
const ACC2 = "acc_t853_tasamb"; // near-duplicate name for ambiguity
const ACC_OTHER = "acc_t853_other"; // out-of-perimeter for the employee
const ENG = "eng_t853_main";
const ENG_SAME_NAME = "eng_t853_samename"; // shares a name stem with ACC
const OPP = "opp_t853_deal";
const POV = "pov_t853_one";
const DEL = "del_t853_one";
const PF = "pf_t853_firm";
const CTR = "ctr_t853_msa";
const INV1 = "inv_t853_overdue"; // issued, partially paid, 40d overdue
const INV2 = "inv_t853_paid"; // fully paid
const INV3 = "inv_t853_current"; // issued, due in future
const RCPT = "rcpt_t853_one";
const CAPP = "capp_t853_one";
const FP = persona("founding_partner");
const BOARD = persona("board_observer");
const RESTRICTED = persona("recruiter");
const EMP = persona("employee");

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toISOString().slice(0, 10);
}

async function seed(): Promise<void> {
  const base = { orgId: ORG };
  await db.insert(atelierAccounts).values([
    { id: ACC, ...base, name: "Tasama Holdings T853", country: "UAE", sector: "Conglomerate" },
    { id: ACC2, ...base, name: "Tasama Ventures T853", country: "UAE", sector: "VC" },
    { id: ACC_OTHER, ...base, name: "Perimeter Test Co T853", country: "KSA", sector: "Energy" },
  ]);
  await db.insert(atelierEngagements).values([
    {
      id: ENG, ...base, slug: "t853-main", name: "Operating Model Redesign T853",
      accountId: ACC, plmStage: "deliver", partnerOwnerId: FP.id, engagementLeadId: FP.id,
      startDate: daysAgo(60), plannedEndDate: daysAgo(-60),
    },
    {
      id: ENG_SAME_NAME, ...base, slug: "t853-same", name: "Tasama Transformation T853",
      accountId: ACC, plmStage: "deliver", partnerOwnerId: FP.id, engagementLeadId: FP.id,
      startDate: daysAgo(30), plannedEndDate: daysAgo(-90),
    },
  ]);
  await db.insert(atelierOpportunities).values([{
    id: OPP, ...base, slug: "t853-deal", name: "Tasama Expansion Deal T853", accountId: ACC,
    partnerOwnerId: FP.id, engagementLeadId: FP.id, dealSizeHypothesis: 500000,
    probabilityPct: 60, nextMilestone: "Proposal review", sourceLead: "referral",
  }]);
  await db.insert(atelierPovs).values([{
    id: POV, ...base, opportunityId: OPP, title: "Market Entry POV T853",
    audience: "CEO", objective: "Frame the expansion thesis", status: "outline",
    outline: [{ heading: "Why now" }, { heading: "Where to play" }],
  }]);
  await db.insert(atelierDeliverables).values([{
    id: DEL, ...base, engagementId: ENG, type: "design", name: "Target Operating Model T853",
    status: "in_progress", dueDate: daysAgo(-14),
  }]);
  await db.insert(atelierPartnerFirms).values([{
    id: PF, ...base, name: "Quantifi Analytics T853",
  }]);
  await db.insert(atelierContractRecords).values([{
    id: CTR, orgId: ORG, title: "Tasama Master Services Agreement T853",
    counterpartyKind: "account", accountId: ACC, counterpartyLabel: "Tasama Holdings T853",
    status: "signed", ownerUserId: FP.id, ownerLabel: "T853 founding_partner",
  }]);
  await db.insert(atelierInvoice).values([
    {
      id: INV1, ...base, accountId: ACC, engagementId: ENG, jurisdiction: "UAE",
      invoiceNumber: "T853-001", currency: "USD", status: "issued",
      subtotal: 100000, total: 100000, amountPaid: 40000,
      dueDate: daysAgo(40), issuedAt: new Date(Date.now() - 70 * 86400_000),
    },
    {
      id: INV2, ...base, accountId: ACC, engagementId: ENG, jurisdiction: "UAE",
      invoiceNumber: "T853-002", currency: "USD", status: "paid",
      subtotal: 50000, total: 50000, amountPaid: 50000,
      dueDate: daysAgo(10), issuedAt: new Date(Date.now() - 40 * 86400_000),
      paidAt: new Date(),
    },
    {
      id: INV3, ...base, accountId: ACC, engagementId: ENG, jurisdiction: "UAE",
      invoiceNumber: "T853-003", currency: "USD", status: "issued",
      subtotal: 25000, total: 25000, amountPaid: 0,
      dueDate: daysAgo(-20), issuedAt: new Date(),
    },
  ]);
  await db.insert(atelierCashReceipt).values([{
    id: RCPT, ...base, bankTransactionId: "txn_t853_one", totalAmount: 40000,
    appliedAmount: 40000, currency: "USD", receivedAt: daysAgo(5),
  }]);
  await db.insert(atelierCashApplication).values([{
    id: CAPP, ...base, cashReceiptId: RCPT, invoiceId: INV1, appliedAmount: 40000, currency: "USD",
  }]);
  // Employee staffing: grant on ENG only (→ staffed on ACC via engagement).
  await db.insert(atelierEngagementAccess).values([{
    id: "ea_t853_emp", engagementId: ENG, userId: EMP.id, status: "active",
  }]);
  await db.insert(atelierAccountTeamMembers).values([{
    id: "atm_t853_emp", ...base, accountId: ACC, userId: EMP.id,
  }]);
}

async function cleanup(): Promise<void> {
  await db.delete(atelierCashApplication).where(eq(atelierCashApplication.id, CAPP));
  await db.delete(atelierCashReceipt).where(eq(atelierCashReceipt.id, RCPT));
  await db.delete(atelierInvoice).where(like(atelierInvoice.id, "inv_t853_%"));
  await db.delete(atelierContractRecords).where(eq(atelierContractRecords.id, CTR));
  await db.delete(atelierPartnerFirms).where(eq(atelierPartnerFirms.id, PF));
  await db.delete(atelierDeliverables).where(eq(atelierDeliverables.id, DEL));
  await db.delete(atelierPovs).where(eq(atelierPovs.id, POV));
  await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, OPP));
  await db.delete(atelierEngagementAccess).where(eq(atelierEngagementAccess.id, "ea_t853_emp"));
  await db.delete(atelierAccountTeamMembers).where(eq(atelierAccountTeamMembers.id, "atm_t853_emp"));
  await db.delete(atelierEngagements).where(like(atelierEngagements.id, "eng_t853_%"));
  await db.delete(atelierAccounts).where(like(atelierAccounts.id, "acc_t853_%"));
}

async function main() {
  console.log("Task #853 — universal entity lookups + AR rollups\n");
  await cleanup(); // clear any leftovers from a crashed run
  await seed();
  try {
    console.log("[1] Catalog");
    await test("new tools registered read-only", () => {
      for (const t of ["entity_detail", "statement_of_account", "pending_invoices"]) {
        const e = findByToolName(t);
        assert.ok(e, `${t} missing`);
        assert.equal(e!.isWrite, false, `${t} must be read-only`);
      }
    });
    await test("self-only catalog = me.* plus entity.detail only", () => {
      const caps = capabilitiesForPersona(EMP).map((c) => c.id);
      const nonMe = caps.filter((id) => !id.startsWith("me."));
      assert.deepEqual(nonMe, ["entity.detail"], `unexpected widening: ${nonMe.join(", ")}`);
      assert.ok(!caps.includes("finance.statement_of_account"));
      assert.ok(!caps.includes("finance.pending_invoices"));
    });

    console.log("[2] entity_detail id + typed paths (founding partner)");
    const idCases: Array<[string, string, string]> = [
      ["account", ACC, "Tasama Holdings T853"],
      ["opportunity", OPP, "Tasama Expansion Deal T853"],
      ["engagement", ENG, "Operating Model Redesign T853"],
      ["pov", POV, "Market Entry POV T853"],
      ["deliverable", DEL, "Target Operating Model T853"],
      ["invoice", INV1, "T853-001"],
      ["partner_firm", PF, "Quantifi Analytics T853"],
      ["contract", CTR, "Tasama Master Services Agreement T853"],
    ];
    for (const [kind, id, label] of idCases) {
      await test(`id fetch: ${kind}`, async () => {
        const d = dataOf(await runTool("entity_detail", FP, { id, kind }));
        const blob = JSON.stringify(d);
        assert.ok(blob.includes(label), `${kind} card missing "${label}": ${blob.slice(0, 300)}`);
        assert.ok(typeof d.href === "string" && (d.href as string).length > 0, `${kind}: href`);
      });
    }
    await test("untyped id fetch routes to the right provider", async () => {
      const d = dataOf(await runTool("entity_detail", FP, { id: POV }));
      assert.ok(JSON.stringify(d).includes("Market Entry POV T853"));
    });
    await test("typed query fuzzy-resolves (opportunity by name)", async () => {
      const d = dataOf(
        await runTool("entity_detail", FP, { kind: "opportunity", query: "Tasama Expansion Deal T853" }),
      );
      assert.ok(JSON.stringify(d).includes("Tasama Expansion Deal T853"));
    });
    await test("depth data present (engagement RAID/deliverables, account brief keys)", async () => {
      const eng = dataOf(await runTool("entity_detail", FP, { id: ENG, kind: "engagement" }));
      const blob = JSON.stringify(eng);
      assert.ok(blob.includes("Target Operating Model T853"), "engagement depth lists deliverables");
      const acc = dataOf(await runTool("entity_detail", FP, { id: ACC, kind: "account" }));
      assert.ok((acc as { detail?: unknown }).detail !== undefined, "account card carries a detail block");
    });

    console.log("[3] Ambiguity & resume");
    await test("same-type ambiguity → options with exact ids", async () => {
      const r = await runTool("entity_detail", FP, { kind: "account", query: "Tasama" });
      const d = dataOf(r);
      const opts = (d.options ?? []) as Array<{ id: string }>;
      assert.ok(opts.length >= 2, `expected chips, got ${JSON.stringify(d).slice(0, 300)}`);
      const ids = opts.map((o) => o.id);
      assert.ok(ids.includes(ACC) && ids.includes(ACC2), `option ids must be record ids: ${ids.join(",")}`);
      // resume with the picked id
      const picked = dataOf(await runTool("entity_detail", FP, { id: ACC2, kind: "account" }));
      assert.ok(JSON.stringify(picked).includes("Tasama Ventures T853"));
    });
    await test("unresolvable name → helpful not-found (no dead end)", async () => {
      const r = await runTool("entity_detail", FP, { kind: "account", query: "Zzyqx Nonexistent 9931" });
      assert.equal(r.ok, false);
      assert.ok(((r as { errorMessage?: string }).errorMessage ?? "").length > 5);
    });

    console.log("[4] Statement of account");
    await test("ledger math matches seeded rows", async () => {
      const d = dataOf(await runTool("statement_of_account", FP, { accountId: ACC }));
      assert.equal(d.shape, "statement_of_account");
      const cur = (d.currencies as Array<Record<string, unknown>>).find((c) => c.currency === "USD")!;
      const totals = cur.totals as { issued: number; paid: number; outstanding: number };
      assert.equal(totals.issued, 175000);
      assert.equal(totals.paid, 90000);
      assert.equal(totals.outstanding, 85000);
      const aging = cur.aging as Record<string, number>;
      assert.equal(aging.d31_60, 60000, "overdue-40d invoice sits in 31–60 bucket");
      assert.equal(aging.current, 25000, "not-yet-due invoice is current");
      const payments = d.payments as Array<{ amount: number }>;
      assert.ok(payments.some((p) => p.amount === 40000), "cash application appears in payment log");
    });
    await test("statement by fuzzy name resolves", async () => {
      const d = dataOf(await runTool("statement_of_account", FP, { accountQuery: "Tasama Holdings T853" }));
      assert.ok(JSON.stringify(d.account).includes(ACC));
    });
    await test("board observer: AR detail denied", async () => {
      expectForbidden(await runTool("statement_of_account", BOARD, { accountId: ACC }), "board soa");
      expectForbidden(await runTool("pending_invoices", BOARD, { accountId: ACC }), "board pending");
      expectForbidden(await runTool("entity_detail", BOARD, { id: INV1, kind: "invoice" }), "board invoice");
    });
    await test("restricted persona: AR denied", async () => {
      expectForbidden(await runTool("statement_of_account", RESTRICTED, { accountId: ACC }), "restricted soa");
    });

    console.log("[5] Pending invoices");
    await test("by accountId: outstanding only, amounts due + days overdue", async () => {
      const d = dataOf(await runTool("pending_invoices", FP, { accountId: ACC }));
      assert.equal(d.shape, "pending_invoices");
      const invs = d.invoices as Array<Record<string, unknown>>;
      const nums = invs.map((i) => i.invoiceNumber);
      assert.ok(nums.includes("T853-001") && nums.includes("T853-003"), `got ${nums.join(",")}`);
      assert.ok(!nums.includes("T853-002"), "fully-paid invoice excluded");
      const overdue = invs.find((i) => i.invoiceNumber === "T853-001")!;
      assert.equal(overdue.amountDue, 60000);
      assert.ok((overdue.daysOverdue as number) >= 39, `daysOverdue=${overdue.daysOverdue}`);
    });
    await test("fuzzy name matching account AND engagement → choice chips, then resume", async () => {
      const r = await runTool("pending_invoices", FP, { query: "Tasama" });
      const d = dataOf(r);
      const opts = (d.options ?? []) as Array<{ id: string; secondary?: string }>;
      assert.ok(opts.length >= 2, `expected chips, got ${JSON.stringify(d).slice(0, 300)}`);
      assert.ok(opts.some((o) => (o.secondary ?? "").startsWith("Account")));
      assert.ok(opts.some((o) => (o.secondary ?? "").startsWith("Engagement")));
      // resume with engagement pick
      const resumed = dataOf(await runTool("pending_invoices", FP, { engagementId: ENG }));
      assert.ok((resumed.invoices as unknown[]).length >= 2);
    });

    console.log("[6] Self-only clamp boundary (employee)");
    await test("employee sees staffed engagement, its account, and deliverable", async () => {
      const eng = dataOf(await runTool("entity_detail", EMP, { id: ENG, kind: "engagement" }));
      assert.ok(JSON.stringify(eng).includes("Operating Model Redesign T853"));
      const acc = dataOf(await runTool("entity_detail", EMP, { id: ACC, kind: "account" }));
      assert.ok(JSON.stringify(acc).includes("Tasama Holdings T853"));
      const del = dataOf(await runTool("entity_detail", EMP, { id: DEL, kind: "deliverable" }));
      assert.ok(JSON.stringify(del).includes("Target Operating Model T853"));
    });
    await test("employee cannot see out-of-perimeter account", async () => {
      const r = await runTool("entity_detail", EMP, { id: ACC_OTHER, kind: "account" });
      assert.equal(r.ok, false, `expected denial, got ${JSON.stringify(r).slice(0, 200)}`);
    });
    await test("employee denied non-widened kinds (invoice, contact, partner_firm)", async () => {
      for (const [kind, id] of [["invoice", INV1], ["partner_firm", PF], ["contract", CTR]] as const) {
        const r = await runTool("entity_detail", EMP, { id, kind });
        assert.equal(r.ok, false, `${kind}: expected denial`);
      }
    });
    await test("employee denied AR rollups outright", async () => {
      expectForbidden(await runTool("statement_of_account", EMP, { accountId: ACC }), "emp soa");
      expectForbidden(await runTool("pending_invoices", EMP, { accountId: ACC }), "emp pending");
    });
  } finally {
    await cleanup();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
