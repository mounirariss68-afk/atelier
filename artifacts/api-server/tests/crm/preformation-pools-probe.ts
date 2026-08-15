/**
 * Task #1092 — pre-formation entity cost pools, end to end.
 *
 * Checks:
 *   1. Registry: in_formation entity accepts a formation record
 *      (ownership type + JV splits) and returns recommendedTreatment.
 *   2. Quarantine: an approved expense tagged to the in_formation entity
 *      posts Dr 1500 (stamped preFormationEntityId) on the HOME entity,
 *      never opex.
 *   3. Pool view: /finance/preformation/pools shows the pool with posted
 *      totals + itemized sources; role gate 403s a consultant.
 *   4. Settlement guards: unposted pipeline → 409; founder-owned without
 *      approval note → 400; jv_split without valid splits → 400.
 *   5. Settlement: jv_split posts a balanced journal (Cr 1500 + per-partner
 *      1550 IC-receivable lines — NOT 1150, which is salary advances),
 *      stamps formation.settlement, audits, and a replay 409s.
 *   6. Lifecycle: an entity ACTIVATED before its tagged costs are bookkept
 *      keeps quarantine treatment (unsettled pool ⇒ Dr 1500, never opex).
 *
 * Deterministic (no LLM). All rows in a probe-unique org, cleaned in finally.
 *
 * Run: pnpm exec tsx tests/crm/preformation-pools-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail ?? ""); }
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierLegalEntities, atelierExpenses,
    atelierGlAccount, atelierGlJournalEntry, atelierGlJournalLine,
    atelierAuditEvents, atelierBackgroundJobs, atelierAgentRuns,
  } = D;
  const { and, eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const { runBookkeeper } = await import("../../src/lib/atelier-agents/bookkeeper.js");

  const tag = `pfp_${Date.now().toString(36)}`;
  const ORG = `org_${tag}`;
  const fpId = `u_fp_${tag}`;
  const consId = `u_cons_${tag}`;
  const homeId = `lent_home_${tag}`;
  const istId = `lent_ist_${tag}`;
  const expId = `exp_${tag}`;
  const PERIOD = new Date().toISOString().slice(0, 7);

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;
  const api = async (method: string, path: string, body?: unknown, who = fpId) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };

  try {
    await db.insert(atelierUsers).values([
      { id: fpId, orgId: ORG, email: `${fpId}@probe.local`, name: "Probe FP", initials: "PF", role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
      { id: consId, orgId: ORG, email: `${consId}@probe.local`, name: "Probe Cons", initials: "PC", role: "consultant", roleLabel: "Consultant", title: "Consultant" },
    ] as any);
    await db.insert(atelierLegalEntities).values([
      {
        id: homeId, orgId: ORG, shortName: "Cognirise UAE", legalNameEn: `Cognirise UAE ${tag}`,
        country: "AE", status: "active", entityType: "llc",
      },
      {
        id: istId, orgId: ORG, shortName: "Cognirise Istanbul", legalNameEn: `Cognirise Istanbul ${tag}`,
        country: "TR", status: "in_formation", entityType: "llc",
      },
    ] as any);

    // 1 — registry formation record via PATCH
    const patch = await api("PATCH", `/finance/entities/${istId}`, {
      formation: {
        ownershipType: "jv",
        jvSplits: [
          { partnerName: "Anadolu Partners", sharePct: 60 },
          { partnerName: "Cognirise UAE", sharePct: 40 },
        ],
        notes: "Istanbul market entry",
      },
    });
    check("registry: PATCH formation 200", patch.status === 200, patch);
    check("registry: recommendedTreatment jv_split", patch.json?.entity?.recommendedTreatment === "jv_split", patch.json?.entity?.recommendedTreatment);

    // 2 — approved expense tagged to the in_formation entity → bookkeeper
    await db.insert(atelierExpenses).values({
      id: expId, orgId: ORG, personId: fpId, personType: "employee",
      expenseDate: `${PERIOD}-05`, captureSource: "manual", merchant: "THY",
      category: "travel", amount: 500, currency: "USD", usdAmount: 500,
      status: "approved", approvedAt: new Date(), entityId: istId,
      description: "Flight to Istanbul (pre-formation)",
    } as any);

    // pipeline (unposted) must block settlement
    const early = await api("POST", `/finance/preformation/pools/${istId}/settle`, { treatment: "jv_split" });
    check("guard: unposted costs → 409", early.status === 409, early);

    await runBookkeeper({
      orgId: ORG,
      input: { periodLabel: PERIOD } as any,
      triggeredByUserId: fpId,
      actorLabel: "probe",
    });

    const lines = await db.select({ l: atelierGlJournalLine, e: atelierGlJournalEntry })
      .from(atelierGlJournalLine)
      .innerJoin(atelierGlJournalEntry, eq(atelierGlJournalLine.journalEntryId, atelierGlJournalEntry.id))
      .where(and(eq(atelierGlJournalLine.orgId, ORG), eq(atelierGlJournalLine.accountCode, "1500")));
    check("quarantine: 1500 line posted", lines.length === 1, lines.length);
    check("quarantine: stamped preFormationEntityId", lines[0]?.l.preFormationEntityId === istId);
    check("quarantine: posted on HOME entity", lines[0]?.e.legalEntityId === homeId, lines[0]?.e.legalEntityId);
    const opex = await db.select().from(atelierGlJournalLine).where(and(
      eq(atelierGlJournalLine.orgId, ORG), inArray(atelierGlJournalLine.accountCode, ["6100", "6200", "6300", "6400", "6500"]),
    ));
    check("quarantine: no opex lines for the expense", opex.length === 0, opex.map((o) => o.accountCode));

    // 3 — pool view
    const pools = await api("GET", "/finance/preformation/pools?currency=USD");
    check("pools: 200", pools.status === 200, pools.status);
    const pool = (pools.json?.items ?? []).find((p: any) => p.entityId === istId);
    check("pools: pool present", !!pool);
    check("pools: postedUsd 500", pool?.postedUsd === 500, pool?.postedUsd);
    check("pools: pipelineUsd 0", pool?.pipelineUsd === 0, pool?.pipelineUsd);
    check("pools: item itemized", (pool?.items ?? []).some((i: any) => i.kind === "expense" && i.posted), pool?.items);
    check("pools: ownership + recommendation", pool?.ownershipType === "jv" && pool?.recommendedTreatment === "jv_split", pool);
    const denied = await api("GET", "/finance/preformation/pools", undefined, consId);
    check("pools: consultant 403", denied.status === 403, denied.status);

    // 4 — settlement guards
    const badNote = await api("POST", `/finance/preformation/pools/${istId}/settle`, { treatment: "founder_receivable" });
    check("guard: founder_receivable needs note", badNote.status === 400 && badNote.json?.error === "approval-note-required", badNote);
    const badTreat = await api("POST", `/finance/preformation/pools/${istId}/settle`, { treatment: "nonsense" });
    check("guard: invalid treatment 400", badTreat.status === 400, badTreat);

    // 5 — jv_split settlement
    const settle = await api("POST", `/finance/preformation/pools/${istId}/settle`, { treatment: "jv_split", approvalNote: "Board minute 12" });
    check("settle: 200", settle.status === 200, settle);
    check("settle: settlement stamped", settle.json?.settlement?.treatment === "jv_split" && settle.json?.settlement?.totalUsd === 500, settle.json);
    const jid = settle.json?.journalEntryId;
    const jl = await db.select().from(atelierGlJournalLine).where(eq(atelierGlJournalLine.journalEntryId, jid));
    const cr1500 = jl.find((x) => x.accountCode === "1500" && x.credit === 500);
    const ic = jl.filter((x) => x.accountCode === "1550");
    check("settle: Cr 1500 clears pool", !!cr1500, jl.map((x) => `${x.accountCode} d${x.debit} c${x.credit}`));
    check("settle: per-partner 1550 lines sum 500", ic.length === 2 && Math.abs(ic.reduce((s, x) => s + x.debit, 0) - 500) < 0.01, ic.map((x) => x.debit));
    // Account-code collision guard: 1150 stays salary advances; the IC
    // receivable lives on 1550 and no journal line hit 1150.
    const homeChart = await db.select().from(atelierGlAccount).where(and(
      eq(atelierGlAccount.orgId, ORG), eq(atelierGlAccount.legalEntityId, homeId),
    ));
    const acc1150 = homeChart.filter((a) => a.code === "1150");
    check("chart: single 1150 = salary advances", acc1150.length === 1 && acc1150[0].name === "Salary advances receivable", acc1150.map((a) => a.name));
    check("chart: 1550 = IC receivable", homeChart.some((a) => a.code === "1550" && /Intercompany/.test(a.name)), homeChart.filter((a) => a.code === "1550").map((a) => a.name));
    check("settle: no journal line on 1150", jl.every((x) => x.accountCode !== "1150"), jl.map((x) => x.accountCode));
    const balanced = Math.abs(jl.reduce((s, x) => s + x.debit - x.credit, 0)) < 0.005;
    check("settle: journal balanced", balanced);
    const audit = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.orgId, ORG), eq(atelierAuditEvents.action, "legal_entity.preformation_settle"),
    ));
    check("settle: audit row with note", audit.length === 1 && (audit[0].payload as any)?.approvalNote === "Board minute 12", audit);
    const replay = await api("POST", `/finance/preformation/pools/${istId}/settle`, { treatment: "absorb" });
    check("settle: replay 409 already-settled", replay.status === 409 && replay.json?.error === "already-settled", replay);
    const pools2 = await api("GET", "/finance/preformation/pools");
    const pool2 = (pools2.json?.items ?? []).find((p: any) => p.entityId === istId);
    check("pools: settled pool shows settlement", pool2?.settlement?.treatment === "jv_split", pool2?.settlement);

    // 6 — activation BEFORE bookkeeping: quarantine must survive.
    const ruhId = `lent_ruh_${tag}`;
    const expId2 = `exp2_${tag}`;
    await db.insert(atelierLegalEntities).values({
      id: ruhId, orgId: ORG, shortName: "Cognirise Riyadh", legalNameEn: `Cognirise Riyadh ${tag}`,
      country: "SA", status: "in_formation", entityType: "llc",
    } as any);
    const patch2 = await api("PATCH", `/finance/entities/${ruhId}`, {
      formation: { ownershipType: "cognirise_uae", notes: "Riyadh market entry" },
    });
    check("lifecycle: Riyadh formation PATCH 200", patch2.status === 200, patch2.status);
    await db.insert(atelierExpenses).values({
      id: expId2, orgId: ORG, personId: fpId, personType: "employee",
      expenseDate: `${PERIOD}-07`, captureSource: "manual", merchant: "Saudia",
      category: "travel", amount: 300, currency: "USD", usdAmount: 300,
      status: "approved", approvedAt: new Date(), entityId: ruhId,
      description: "Flight to Riyadh (pre-formation)",
    } as any);
    // Activate the entity BEFORE the Bookkeeper posts the tagged cost.
    const act = await api("PATCH", `/finance/entities/${ruhId}`, { status: "active" });
    check("lifecycle: activation PATCH 200", act.status === 200, act.status);
    await runBookkeeper({
      orgId: ORG,
      input: { periodLabel: PERIOD } as any,
      triggeredByUserId: fpId,
      actorLabel: "probe",
    });
    const ruhLines = await db.select({ l: atelierGlJournalLine, e: atelierGlJournalEntry })
      .from(atelierGlJournalLine)
      .innerJoin(atelierGlJournalEntry, eq(atelierGlJournalLine.journalEntryId, atelierGlJournalEntry.id))
      .where(and(
        eq(atelierGlJournalLine.orgId, ORG),
        eq(atelierGlJournalLine.accountCode, "1500"),
        eq(atelierGlJournalLine.preFormationEntityId, ruhId),
      ));
    check("lifecycle: activated-unsettled still Dr 1500", ruhLines.length === 1 && ruhLines[0].l.debit === 300, ruhLines.map((r) => r.l.debit));
    check("lifecycle: quarantine on HOME ledger", ruhLines[0]?.e.legalEntityId === homeId, ruhLines[0]?.e.legalEntityId);
    const ruhOpex = await db.select().from(atelierGlJournalLine).where(and(
      eq(atelierGlJournalLine.orgId, ORG), inArray(atelierGlJournalLine.accountCode, ["6100", "6200", "6300", "6400", "6500"]),
    ));
    check("lifecycle: still no opex leakage", ruhOpex.length === 0, ruhOpex.map((o) => o.accountCode));
    // Settle (recharge) clears the pool — and self-heals 1550 if missing.
    const settle2 = await api("POST", `/finance/preformation/pools/${ruhId}/settle`, { treatment: "recharge" });
    check("lifecycle: recharge settle 200", settle2.status === 200, settle2);
    const jl2 = await db.select().from(atelierGlJournalLine).where(eq(atelierGlJournalLine.journalEntryId, settle2.json?.journalEntryId));
    check("lifecycle: recharge Dr 1550 / Cr 1500", jl2.some((x) => x.accountCode === "1550" && x.debit === 300) && jl2.some((x) => x.accountCode === "1500" && x.credit === 300), jl2.map((x) => `${x.accountCode} d${x.debit} c${x.credit}`));

    // 7 — settled pool CLOSED for new costs (Istanbul is settled but
    // still in_formation): API tagging rejects, and a directly-inserted
    // tagged cost surfaces as a Bookkeeper exception — never a new 1500
    // line (stranded) and never opex.
    const closedTag = await api("POST", "/wallet/expenses", {
      captureSource: "manual", merchant: "THY", category: "travel",
      amount: 120, currency: "USD", expenseDate: `${PERIOD}-09`,
      description: "post-settlement Istanbul cost",
      contextType: "internal", entityId: istId,
    });
    check("closed pool: wallet tag 400 entity-pool-settled", closedTag.status === 400 && closedTag.json?.error === "entity-pool-settled", closedTag);
    const expId3 = `exp3_${tag}`;
    await db.insert(atelierExpenses).values({
      id: expId3, orgId: ORG, personId: fpId, personType: "employee",
      expenseDate: `${PERIOD}-09`, captureSource: "manual", merchant: "THY",
      category: "travel", amount: 120, currency: "USD", usdAmount: 120,
      status: "approved", approvedAt: new Date(), entityId: istId,
      description: "post-settlement Istanbul cost (direct)",
    } as any);
    const run3 = await runBookkeeper({
      orgId: ORG,
      input: { periodLabel: PERIOD } as any,
      triggeredByUserId: fpId,
      actorLabel: "probe",
    });
    const exp3Entries = await db.select().from(atelierGlJournalEntry).where(and(
      eq(atelierGlJournalEntry.orgId, ORG),
      eq(atelierGlJournalEntry.sourceRef, expId3),
    ));
    check("closed pool: post-settlement cost NOT posted", exp3Entries.length === 0, exp3Entries.map((e) => e.memo));
    const ist1500 = await db.select().from(atelierGlJournalLine).where(and(
      eq(atelierGlJournalLine.orgId, ORG),
      eq(atelierGlJournalLine.accountCode, "1500"),
      eq(atelierGlJournalLine.preFormationEntityId, istId),
    ));
    const istClearing = ist1500.reduce((sum, x) => sum + x.debit - x.credit, 0);
    check("closed pool: Istanbul clearing stays 0", Math.abs(istClearing) < 0.005, istClearing);
    const settledExc = (run3.output?.exceptions ?? []).some((e: any) => e.code === "preformation_pool_settled" && e.sourceRef === expId3);
    check("closed pool: bookkeeper exception raised", settledExc, run3.output?.exceptions);
    // Chat parity: me.expense_create applies the SAME settled-pool guard
    // as the REST attribution resolver.
    const { listCapabilities } = await import("../../src/lib/atelier-cli/capability-catalog.js");
    const expCap = listCapabilities().find((c) => c.id === "me.expense_create");
    check("chat: me.expense_create registered", !!expCap);
    if (expCap) {
      const chatRes = await expCap.run(
        {
          merchant: "THY", category: "travel", amount: 90, currency: "USD",
          expenseDate: `${PERIOD}-10`, description: "post-settlement via chat",
          contextType: "internal", entityId: istId, confirm: true,
        },
        { persona: { id: fpId, role: "founding_partner", orgId: ORG } } as any,
      );
      check("chat: settled pool tag rejected", (chatRes as any)?.ok === false && (chatRes as any)?.errorCode === "entity_pool_settled", chatRes);
      const chatOk = await expCap.run(
        {
          merchant: "Saudia", category: "travel", amount: 90, currency: "USD",
          expenseDate: `${PERIOD}-10`, description: "active-entity via chat",
          contextType: "internal", entityId: ruhId, confirm: true,
        },
        { persona: { id: fpId, role: "founding_partner", orgId: ORG } } as any,
      );
      check("chat: active (settled+active) entity still taggable", (chatOk as any)?.ok === true, chatOk);
    }
  } finally {
    await db.delete(atelierGlJournalLine).where(eq(atelierGlJournalLine.orgId, ORG));
    await db.delete(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.orgId, ORG));
    await db.delete(atelierGlAccount).where(eq(atelierGlAccount.orgId, ORG));
    await db.delete(atelierExpenses).where(eq(atelierExpenses.orgId, ORG));
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.orgId, ORG));
    await db.delete(atelierBackgroundJobs).where(eq(atelierBackgroundJobs.orgId, ORG));
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.orgId, ORG));
    await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.orgId, ORG));
    await db.delete(atelierUsers).where(eq(atelierUsers.orgId, ORG));
    server.close();
    await pool.end();
  }

  if (failures > 0) { console.error(`${failures} check(s) failed`); process.exit(1); }
  console.log("All pre-formation pool probe checks passed.");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
