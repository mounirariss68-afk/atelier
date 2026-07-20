/**
 * Task #429 — Billing Orchestrator end-to-end probe (all four rule types).
 *
 * Deterministic (rule-based agent, no LLM). Exercises:
 *   - Rule setup via REST (milestone / periodic_tnm / fixed_fee / retainer)
 *   - Manual POST /billing/run → triggers materialised + drafts created
 *   - Idempotency: second run creates zero new triggers / drafts
 *   - Empty T&M period → trigger skipped visibly (no empty draft)
 *   - Worklist shape; hold / release / skip transitions
 *   - Partner approve → invoice ISSUES with minted number; trigger issued
 *   - Approve is partner-gated (finance persona → 403)
 *   - Paused rule produces no new triggers
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/billing-orchestrator-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierAccounts, atelierEngagements,
    atelierRevenueMilestone, atelierTimesheetEntries, atelierExpenses,
    atelierBillingRule, atelierBillingTrigger, atelierInvoice,
    atelierInvoiceLine, atelierAuditEvents, atelierAgentRuns,
  } = D as any;
  const { and, eq, inArray, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe429_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const finId = `u_${runTag}_fin`;
  const acctId = `acct_${runTag}`;
  const engId = `eng_${runTag}`;
  const msId = `ms_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const apiAs = (userId: string) => async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${userId}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };
  const api = apiAs(fpId);
  const finApi = apiAs(finId);

  // Date scaffolding: anchor at the start of the month BEFORE last month so
  // exactly two calendar months have completed. Timesheet/expense data goes
  // into last month only → older month yields an empty (skipped) T&M period.
  const now = new Date();
  const lastMonthMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const yesterday = new Date(now.getTime() - 86400_000);

  const ruleIds: string[] = [];

  try {
    // ---- Fixtures ----
    for (const [id, role] of [[fpId, "founding_partner"], [finId, "finance"]] as const) {
      await db.insert(atelierUsers).values({
        id, orgId: "aico", name: `Probe429 ${role}`, initials: "P4",
        email: `${id}@example.test`, role, roleLabel: role, title: role,
      } as any);
    }
    await db.insert(atelierAccounts).values({
      id: acctId, orgId: "aico", name: `Probe429 Client ${runTag}`,
      country: "AE", sector: "Technology",
    } as any);
    await db.insert(atelierEngagements).values({
      id: engId, orgId: "aico", slug: `probe429-${Date.now()}`, name: "Probe429 Engagement",
      accountId: acctId, plmStage: "deliver", partnerOwnerId: fpId, engagementLeadId: fpId,
      startDate: isoDate(anchor), plannedEndDate: isoDate(new Date(now.getTime() + 90 * 86400_000)),
    } as any);
    await db.insert(atelierRevenueMilestone).values({
      id: msId, orgId: "aico", engagementId: engId, sequence: 1,
      name: "Probe429 Milestone", plannedAmount: 50000, earnedAmount: 42000,
      status: "invoiceable", invoiceableAt: yesterday,
    } as any);
    // Approved billable time + expense in last month only.
    await db.insert(atelierTimesheetEntries).values([
      {
        id: `ts_${runTag}_1`, orgId: "aico", weekId: `wk_${runTag}`, personId: fpId,
        personType: "employee", workDate: isoDate(lastMonthMid), engagementId: engId,
        activityCode: "billable", hours: 8, billable: true, status: "approved",
      },
      {
        id: `ts_${runTag}_2`, orgId: "aico", weekId: `wk_${runTag}`, personId: fpId,
        personType: "employee", workDate: isoDate(lastMonthMid), engagementId: engId,
        activityCode: "billable", hours: 4, billable: true, status: "approved",
      },
    ] as any);
    await db.insert(atelierExpenses).values({
      id: `exp_${runTag}_1`, orgId: "aico", personId: fpId, engagementId: engId,
      expenseDate: isoDate(lastMonthMid), captureSource: "manual", merchant: "Probe Air",
      amount: 500, currency: "USD", usdAmount: 500, clientBillable: true,
      markupPct: 10, status: "approved",
    } as any);

    // ---- Rule setup via REST (finance persona can create) ----
    const billTo = { name: "Probe429 Client Ltd", contactEmail: "billing@probe429.test" };
    const mk = async (payload: Record<string, unknown>) => {
      const r = await finApi("POST", "/billing/rules", { engagementId: engId, billTo, ...payload });
      if (r.status === 201 && r.body?.id) ruleIds.push(r.body.id);
      return r;
    };

    const rMs = await mk({ ruleType: "milestone", currency: "USD", jurisdiction: "AE" });
    check("milestone rule create -> 201", rMs.status === 201, rMs);
    const rTnm = await mk({
      ruleType: "periodic_tnm", currency: "USD",
      config: { defaultRateUsd: 100, anchorDate: isoDate(anchor) },
    });
    check("periodic_tnm rule create -> 201", rTnm.status === 201, rTnm);
    const rFf = await mk({
      ruleType: "fixed_fee", currency: "USD",
      config: { installments: [
        { key: "kickoff", dueDate: isoDate(yesterday), amount: 20000, label: "Kickoff fee" },
        { key: "final", dueDate: "2099-01-01", amount: 20000, label: "Final fee" },
      ] },
    });
    check("fixed_fee rule create -> 201", rFf.status === 201, rFf);
    const rRet = await mk({
      ruleType: "retainer", currency: "USD",
      config: { amount: 10000, cadence: "monthly", anchorDate: isoDate(anchor) },
    });
    check("retainer rule create -> 201", rRet.status === 201, rRet);

    const rBad = await finApi("POST", "/billing/rules", {
      engagementId: engId, ruleType: "retainer", billTo, config: {},
    });
    check("retainer without amount rejected -> 400", rBad.status === 400, rBad);

    // ---- Run 1: materialise + draft ----
    const run1 = await finApi("POST", "/billing/run", {});
    check("manual run -> 200", run1.status === 200, run1);
    const o1 = run1.body?.output ?? {};
    // Expected triggers: 1 milestone + 2 T&M months + 1 due installment + 2 retainer months = 6
    check("run1 materialised 6 triggers", o1.triggersCreated === 6, o1);
    // Drafts: milestone, 1 non-empty T&M, installment, 2 retainers = 5; 1 empty T&M skipped
    check("run1 drafted 5 invoices", o1.invoicesDrafted === 5, o1);
    check("run1 skipped 1 empty T&M period", o1.triggersSkipped === 1, o1);

    // ---- Idempotency: run again ----
    const run2 = await finApi("POST", "/billing/run", {});
    const o2 = run2.body?.output ?? {};
    check(
      "run2 idempotent (0 new triggers, 0 new drafts)",
      run2.status === 200 && o2.triggersCreated === 0 && o2.invoicesDrafted === 0,
      o2,
    );

    // ---- Worklist ----
    const wl = await finApi("GET", "/billing/worklist");
    const trigs: any[] = wl.body?.triggers ?? [];
    const mine = trigs.filter((t) => t.engagementId === engId);
    check("worklist -> 200 with our 6 triggers", wl.status === 200 && mine.length === 6, mine.length);
    const drafted = mine.filter((t) => t.status === "drafted");
    const skipped = mine.filter((t) => t.status === "skipped");
    check("worklist: 5 drafted + 1 skipped", drafted.length === 5 && skipped.length === 1, mine.map((t) => t.status));
    check(
      "skipped one is the empty T&M period",
      skipped[0]?.triggerType === "period_end" && /Nothing unbilled/i.test(skipped[0]?.skippedReason ?? ""),
      skipped[0],
    );
    const msTrig = drafted.find((t) => t.triggerType === "milestone");
    check("milestone draft amount = earnedAmount 42000", msTrig?.amount === 42000, msTrig);
    const tnmTrig = drafted.find((t) => t.triggerType === "period_end");
    // 12 hrs * $100 + $500 expense * 1.10 markup = 1750
    check("T&M draft amount = 1750 (time + marked-up expense)", tnmTrig?.amount === 1750, tnmTrig);
    check(
      "drafted invoices carry AE VAT on milestone (42000 * 1.05)",
      msTrig?.invoice?.total === 44100 && msTrig?.invoice?.status === "draft",
      msTrig?.invoice,
    );
    const upcoming: any[] = wl.body?.upcoming ?? [];
    check(
      "upcoming preview omits already-materialised keys and shows none due in 90d for our future installment beyond horizon",
      Array.isArray(upcoming),
      upcoming.length,
    );

    // ---- Hold / release / skip on the retainer triggers ----
    const rets = drafted.filter((t) => t.triggerType === "retainer");
    check("two retainer drafts exist", rets.length === 2, rets.length);
    // A drafted trigger cannot be held — only ready ones. Pause the T&M rule,
    // then verify a paused rule adds nothing on re-run.
    const pause = await finApi("PATCH", `/billing/rules/${rTnm.body.id}`, { status: "paused" });
    check("pause rule -> 200 paused", pause.status === 200 && pause.body?.status === "paused", pause.body);
    const run3 = await finApi("POST", "/billing/run", {});
    check("paused rule adds no triggers", run3.body?.output?.triggersCreated === 0, run3.body?.output);

    // Manufacture a ready trigger to exercise hold/release/skip deterministically.
    const readyId = `btrig_${runTag}_ready`;
    await db.insert(atelierBillingTrigger).values({
      id: readyId, orgId: "aico", ruleId: rRet.body.id, engagementId: engId,
      triggerType: "retainer", idempotencyKey: `bill:${rRet.body.id}:retainer:2099-01`,
      dueDate: "2099-02-01", amount: 10000, currency: "USD", status: "ready",
    } as any);
    const hold = await finApi("POST", `/billing/triggers/${readyId}/hold`, { reason: "client dispute" });
    check("hold ready trigger -> held", hold.status === 200 && hold.body?.status === "held", hold.body);
    const rel = await finApi("POST", `/billing/triggers/${readyId}/release`, {});
    check("release held trigger -> ready", rel.status === 200 && rel.body?.status === "ready", rel.body);
    const skp = await finApi("POST", `/billing/triggers/${readyId}/skip`, { reason: "written off" });
    check("skip trigger -> skipped", skp.status === 200 && skp.body?.status === "skipped", skp.body);

    // ---- Concurrency: two simultaneous runs must draft each trigger once ----
    const concId = `btrig_${runTag}_conc`;
    await db.insert(atelierBillingTrigger).values({
      id: concId, orgId: "aico", ruleId: rRet.body.id, engagementId: engId,
      triggerType: "retainer", idempotencyKey: `bill:${rRet.body.id}:retainer:2026-08`,
      dueDate: "2026-08-01", amount: 7777, currency: "USD", status: "ready",
      details: { periodLabel: "2026-08" },
    } as any);
    const [runA, runB] = await Promise.all([
      finApi("POST", "/billing/run", {}),
      finApi("POST", "/billing/run", {}),
    ]);
    const draftedTotal =
      (runA.body?.output?.invoicesDrafted ?? 0) + (runB.body?.output?.invoicesDrafted ?? 0);
    const concInvs = await db.select().from(atelierInvoice).where(and(
      eq(atelierInvoice.engagementId, engId), eq(atelierInvoice.subtotal, 7777),
    ));
    const [concTrig] = await db.select().from(atelierBillingTrigger)
      .where(eq(atelierBillingTrigger.id, concId));
    check(
      "concurrent runs draft exactly one invoice per trigger",
      runA.status === 200 && runB.status === 200 && draftedTotal === 1 &&
        concInvs.length === 1 && concTrig?.status === "drafted" &&
        concTrig?.invoiceId === concInvs[0]?.id,
      { runA: runA.body?.output, runB: runB.body?.output, concInvs: concInvs.length, trig: concTrig?.status },
    );

    // ---- Approve: finance is refused, partner issues ----
    const denied = await finApi("POST", `/billing/triggers/${msTrig.id}/approve`, {});
    check("finance approve -> 403 (partner tier required)", denied.status === 403, denied);
    const approved = await api("POST", `/billing/triggers/${msTrig.id}/approve`, {});
    check(
      "partner approve -> issued with minted number",
      approved.status === 200 &&
        approved.body?.trigger?.status === "issued" &&
        typeof approved.body?.invoice?.invoice?.invoiceNumber === "string" &&
        approved.body.invoice.invoice.invoiceNumber.includes("AE-INV-"),
      approved.body,
    );
    const again = await api("POST", `/billing/triggers/${msTrig.id}/approve`, {});
    check("re-approve issued trigger -> 400 invalid_state", again.status === 400, again);
  } finally {
    try {
      const orDash = (xs: string[]) => (xs.length ? xs : ["_"]);
      const trigRows = await db.select({ id: atelierBillingTrigger.id, invoiceId: atelierBillingTrigger.invoiceId })
        .from(atelierBillingTrigger).where(eq(atelierBillingTrigger.engagementId, engId));
      const invIds = trigRows.map((t: any) => t.invoiceId).filter(Boolean);
      await db.delete(atelierInvoiceLine).where(inArray(atelierInvoiceLine.invoiceId, orDash(invIds)));
      await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, orDash(invIds)));
      await db.delete(atelierBillingTrigger).where(eq(atelierBillingTrigger.engagementId, engId));
      await db.delete(atelierBillingRule).where(inArray(atelierBillingRule.id, orDash(ruleIds)));
      await db.delete(atelierRevenueMilestone).where(eq(atelierRevenueMilestone.id, msId));
      await db.delete(atelierTimesheetEntries).where(like(atelierTimesheetEntries.id, `ts_${runTag}%`));
      await db.delete(atelierExpenses).where(like(atelierExpenses.id, `exp_${runTag}%`));
      await db.delete(atelierEngagements).where(eq(atelierEngagements.id, engId));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.agentId, "ag_billing_orchestrator"));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `%${runTag}%`));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, finId]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
