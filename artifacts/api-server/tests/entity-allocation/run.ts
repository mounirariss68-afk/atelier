/**
 * Task #1095 — Entity Allocation Engine probes.
 *
 * Offline, deterministic coverage of the intercompany benefit-principle
 * allocation stack (AI calls hit a local stub Anthropic server started
 * BEFORE the app import):
 *   1. Destination-rule travel: BD trip to SA → SA entity (travel_destination).
 *   2. Attend-training travel: home entity wins (travel_home).
 *   3. Engagement-linked cost → engagement's contracting entity.
 *   4. Registry match: supplier invoice from the registered lessor → that entity.
 *   5. AI fallback low confidence → needs_input (never a guess) + queue.
 *   6. Human decide: approve keeps proposal; override requires reason and
 *      writes an audit row with {field, from, to} changes.
 *   7. Role clamps: consultant 403 on wallet allocation + GL decide/sweep;
 *      approving an expense with an entity override as non-leadership → 403.
 *   8. Bookkeeper gate: proposed (undecided) allocation raises an
 *      allocation_pending exception and does not post.
 *
 * Run: NODE_ENV=test pnpm run test:entity-allocation
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// Low-confidence AI answer: the allocator must degrade to needs_input.
const AI_LOW_CONFIDENCE = {
  entityId: null,
  tripPurpose: null,
  destinationCountry: null,
  shared: false,
  justification: "The receipt does not say which entity benefits.",
  confidence: 0.2,
};

async function main() {
  // Stub Anthropic BEFORE the app/client import (env read at import time).
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_probe1095", type: "message", role: "assistant",
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: JSON.stringify(AI_LOW_CONFIDENCE) }],
        stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }));
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL =
    `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe1095-stub-key";

  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers, atelierEmployees, atelierLegalEntities, atelierEngagements,
    atelierExpenses, atelierPartnerFirmInvoices, atelierAuditEvents,
    atelierGlJournalEntry, atelierPeriodCloseLock,
  } = D as any;
  const { and, eq, inArray, sql } = await import("drizzle-orm");
  const alloc = await import("../../src/lib/atelier-entity-allocation.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const STAMP = Date.now();
  const ORG = "aico";
  const FP = `p_test_ea_fp_${STAMP}`;
  const FIN = `p_test_ea_fin_${STAMP}`;
  const CONS = `p_test_ea_cons_${STAMP}`;
  const ENT_AE = `ent_ea_ae_${STAMP}`;
  const ENT_SA = `ent_ea_sa_${STAMP}`;
  const EMP = `emp_ea_${STAMP}`;
  const ACC = `acc_ea_${STAMP}`;
  const ENG = `eng_ea_${STAMP}`;
  const expenseIds: string[] = [];
  const pfiIds: string[] = [];

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;
  const api = async (who: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    // ---------------------------------------------------------- fixtures
    for (const [id, role, name] of [
      [FP, "founding_partner", "EA FP"],
      [FIN, "finance", "EA Finance"],
      [CONS, "consultant", "EA Consultant"],
    ] as const) {
      await db.insert(atelierUsers).values({
        id, orgId: ORG, email: `${id}@example.test`, name, initials: "EA",
        role, roleLabel: name, title: name, permissions: [], bdActive: false,
      }).onConflictDoNothing();
    }
    // The scratch DB is shared across probe runs — archive any leftover
    // active entities so soleEntityInCountry sees exactly ours.
    await db.execute(sql`update atelier_legal_entities set status = 'archived', archived_at = now() where status <> 'archived'`);
    await db.insert(atelierLegalEntities).values([
      {
        id: ENT_AE, orgId: ORG, legalNameEn: `EA Dubai Entity ${STAMP}`,
        shortName: "AE Entity", country: "AE", status: "active",
        lease: { lessorName: `Probe1095 Properties LLC`, ownerName: null },
      },
      {
        id: ENT_SA, orgId: ORG, legalNameEn: `EA Riyadh Entity ${STAMP}`,
        shortName: "SA Entity", country: "SA", status: "active",
      },
    ] as any);
    // AE is the head entity — firm-wide costs land there (multi-entity org).
    await db.update(atelierLegalEntities).set({ isHeadEntity: true })
      .where(eq(atelierLegalEntities.id, ENT_AE));
    // Consultant is an AE-homed employee (fp/fin stay non-roster).
    await db.insert(atelierEmployees).values({
      id: EMP, orgId: ORG, fullName: "EA Consultant", email: `${CONS}@example.test`,
      role: "consultant", roleTitle: "Consultant", userId: CONS,
      legalEntityId: ENT_AE, homeCountry: "AE",
    } as any);
    await db.execute(sql`insert into atelier_accounts (id, org_id, name, country, sector, partner_owner_id) values (${ACC}, ${ORG}, ${`EA acct ${STAMP}`}, 'SA', 'Test', ${FP})`);
    await db.insert(atelierEngagements).values({
      id: ENG, orgId: ORG, slug: ENG, name: `EA engagement ${STAMP}`,
      accountId: ACC, plmStage: "deliver", partnerOwnerId: FP,
      engagementLeadId: FP, startDate: "2026-01-01", plannedEndDate: "2026-12-31",
      legalEntityId: ENT_SA,
    } as any);

    const mkExpense = (id: string, patch: Record<string, unknown>) => {
      expenseIds.push(id);
      return db.insert(atelierExpenses).values({
        id, orgId: ORG, personId: CONS, personType: "employee",
        expenseDate: "2026-08-10", captureSource: "manual",
        merchant: "Probe Merchant", category: "other",
        amount: 100, currency: "USD", usdAmount: 100, status: "submitted",
        ...patch,
      } as any);
    };

    // ------------------------------------------ 1. travel destination rule
    await mkExpense(`exp_ea_dest_${STAMP}`, {
      category: "flight", tripDestinationCountry: "SA", tripPurpose: "bd",
      merchant: "Emirates",
    });
    let r = await alloc.proposeExpenseAllocation(`exp_ea_dest_${STAMP}`, { allowAi: false });
    check("BD travel to SA → proposed", r.status === "proposed", r);
    check("BD travel picks SA entity via travel_destination",
      r.decision?.entityId === ENT_SA && r.decision?.ruleId === "travel_destination", r.decision);
    check("destination decision is deterministic with justification",
      r.decision?.decidedBy === "deterministic" && !!r.decision?.justification, r.decision);

    // ------------------------------------------ 2. attend-training home rule
    await mkExpense(`exp_ea_home_${STAMP}`, {
      category: "flight", tripDestinationCountry: "SA", tripPurpose: "training_attend",
      merchant: "Saudia",
    });
    r = await alloc.proposeExpenseAllocation(`exp_ea_home_${STAMP}`, { allowAi: false });
    check("attend-training travel → home entity (AE) via travel_home",
      r.status === "proposed" && r.decision?.entityId === ENT_AE && r.decision?.ruleId === "travel_home", r);

    // ------------------------------------------ 3. engagement entity rule
    await mkExpense(`exp_ea_eng_${STAMP}`, { engagementId: ENG, category: "taxi" });
    r = await alloc.proposeExpenseAllocation(`exp_ea_eng_${STAMP}`, { allowAi: false });
    check("engagement-linked cost → contracting entity (SA) via engagement_entity",
      r.status === "proposed" && r.decision?.entityId === ENT_SA && r.decision?.ruleId === "engagement_entity", r);

    // ------------------------------------------ 4. registry lessor match (pfi)
    const pfiLease = `pfi_ea_lease_${STAMP}`;
    pfiIds.push(pfiLease);
    await db.insert(atelierPartnerFirmInvoices).values({
      id: pfiLease, orgId: ORG, partnerFirmId: "", partnerFirmName: "Probe1095 Properties LLC",
      weekIso: "2026-08-01", hours: 0, costAmount: 5000, costCurrency: "AED",
      fxRate: 0.2723, usdAmount: 1361.5, status: "submitted", source: "internal_upload",
      reference: `RENT-${STAMP}`, submittedByUserId: FIN, submittedAt: new Date(),
    } as any);
    let pr = await alloc.proposeSupplierInvoiceAllocation(pfiLease, { allowAi: false });
    check("lessor-named supplier invoice → AE entity via registry_match",
      pr.status === "proposed" && pr.decision?.entityId === ENT_AE && pr.decision?.ruleId === "registry_match", pr);

    // -------------------------- 4b. firm-wide cost → head entity (no AI)
    await mkExpense(`exp_ea_fw_${STAMP}`, { category: "saas", merchant: "Figma" });
    r = await alloc.proposeExpenseAllocation(`exp_ea_fw_${STAMP}`, { allowAi: false });
    check("firm-wide cost in multi-entity org → head entity via default_entity",
      r.status === "proposed" && r.decision?.entityId === ENT_AE &&
      r.decision?.ruleId === "default_entity" && r.decision?.decidedBy === "deterministic", r);
    check("firm-wide allocation flagged shared", r.decision?.shared === true, r.decision);
    const [fwRow] = await db.select().from(atelierExpenses)
      .where(eq(atelierExpenses.id, `exp_ea_fw_${STAMP}`));
    check("allocShared persisted on the row", fwRow.allocShared === true, fwRow.allocShared);

    // ------------------------------------------ 5. AI fallback low confidence
    await mkExpense(`exp_ea_ai_${STAMP}`, { category: "other", merchant: "Mystery Shop" });
    r = await alloc.proposeExpenseAllocation(`exp_ea_ai_${STAMP}`, { allowAi: true });
    check("AI low confidence degrades to needs_input (never a guess)",
      r.status === "needs_input" && r.decision === null, r);
    const [aiRow] = await db.select().from(atelierExpenses)
      .where(eq(atelierExpenses.id, `exp_ea_ai_${STAMP}`));
    check("needs_input row keeps entityId null", aiRow.entityId == null, aiRow.entityId);
    const pend = await api(FIN, "GET", "/gl/allocations/pending");
    check("pending queue lists proposed + needs_input rows",
      pend.status === 200 &&
      (pend.body?.data?.rows ?? []).some((x: any) => x.id === `exp_ea_ai_${STAMP}` && x.allocStatus === "needs_input") &&
      (pend.body?.data?.rows ?? []).some((x: any) => x.id === `exp_ea_dest_${STAMP}` && x.allocStatus === "proposed"),
      pend.body?.data?.rows?.length);

    // ------------------------------------------ 6. decide: approve + override
    const app1 = await api(FIN, "POST", `/gl/allocations/expense/exp_ea_dest_${STAMP}/decide`, {});
    check("finance approve keeps proposed entity → approved",
      app1.status === 200 && app1.body?.data?.status === "approved" && app1.body?.data?.entityId === ENT_SA, app1);
    const ovNoReason = await api(FIN, "POST", `/gl/allocations/expense/exp_ea_home_${STAMP}/decide`, { entityId: ENT_SA });
    check("override without reason → 400 reason_required",
      ovNoReason.status === 400 && ovNoReason.body?.error === "reason_required", ovNoReason);
    const ov = await api(FP, "POST", `/gl/allocations/expense/exp_ea_home_${STAMP}/decide`, {
      entityId: ENT_SA, reason: "Training was actually delivered to the Saudi team",
    });
    check("override with reason → overridden", ov.status === 200 && ov.body?.data?.status === "overridden", ov);
    const audits = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityType, "expense"),
      eq(atelierAuditEvents.entityId, `exp_ea_home_${STAMP}`),
      eq(atelierAuditEvents.action, "allocation.override"),
    ));
    const ch = (audits[0]?.payload as any)?.changes ?? [];
    check("override audit row has {field,from,to} changes",
      audits.length === 1 &&
      ch.some((c: any) => c.field === "entityId" && c.from === ENT_AE && c.to === ENT_SA) &&
      ch.some((c: any) => c.field === "allocStatus" && c.to === "overridden"),
      audits[0]?.payload);
    const [ovRow] = await db.select().from(atelierExpenses)
      .where(eq(atelierExpenses.id, `exp_ea_home_${STAMP}`));
    check("override stamps explicit_choice/human/reason",
      ovRow.allocRuleId === "explicit_choice" && ovRow.allocDecidedBy === "human" &&
      !!ovRow.allocOverrideReason, ovRow);
    // Idempotent re-propose never touches decided rows.
    const reP = await alloc.proposeExpenseAllocation(`exp_ea_home_${STAMP}`, { allowAi: false });
    check("propose skips already-decided rows", reP.status === null, reP);

    // ------------------------------------------ 7. role clamps
    const c1 = await api(CONS, "POST", `/gl/allocations/expense/exp_ea_eng_${STAMP}/decide`, {});
    check("consultant GL decide → 403", c1.status === 403, c1);
    const c2 = await api(CONS, "POST", "/gl/allocations/sweep", {});
    check("consultant sweep → 403", c2.status === 403, c2);
    const c3 = await api(CONS, "POST", `/wallet/expenses/exp_ea_eng_${STAMP}/allocation`, { entityId: ENT_AE });
    check("consultant wallet allocation decide → 403", c3.status === 403, c3);
    const c4 = await api(CONS, "POST", `/wallet/expenses/exp_ea_eng_${STAMP}/approve`, { entityId: ENT_AE });
    check("non-leadership approve with entity override → 403", c4.status === 403, c4);

    // ------------------------------------------ 8. sweep + bookkeeper gate
    await mkExpense(`exp_ea_sweep_${STAMP}`, { engagementId: ENG, category: "hotel", status: "approved" });
    const sw = await api(FP, "POST", "/gl/allocations/sweep", {});
    check("founder sweep proposes for untagged rows",
      sw.status === 200 && sw.body?.data?.proposed >= 1, sw.body);
    const [swRow] = await db.select().from(atelierExpenses)
      .where(eq(atelierExpenses.id, `exp_ea_sweep_${STAMP}`));
    check("sweep prefilled engagement entity", swRow.entityId === ENT_SA && swRow.allocStatus === "proposed", swRow);
    // Bookkeeper must NOT post a proposed (undecided) allocation.
    const bk = await api(FP, "POST", "/gl/bookkeeper/run", { periodLabel: "2026-08", entityId: ENT_SA });
    if (bk.status === 200) {
      const exc = (bk.body?.data?.exceptions ?? []).filter((x: any) => x.code === "allocation_pending");
      check("bookkeeper raises allocation_pending for undecided rows", exc.length >= 1, bk.body?.data?.exceptions);
    } else {
      check("bookkeeper run reachable", false, bk);
    }

    // wallet approve decides the allocation in the same act (leadership).
    const wap = await api(FP, "POST", `/wallet/expenses/exp_ea_sweep_${STAMP}/allocation`, {});
    check("leadership standalone allocation approve → 200 approved",
      wap.status === 200 && wap.body?.expense?.allocStatus === "approved", wap.body?.expense?.allocStatus);

    // ------------------ 9. /gl/tag rides the shared decide path (no bypass)
    // 9a. tagging an undecided expense approves via the allocation lifecycle.
    await mkExpense(`exp_ea_tag_${STAMP}`, { category: "saas", merchant: "Notion" });
    await alloc.proposeExpenseAllocation(`exp_ea_tag_${STAMP}`, { allowAi: false }); // → AE proposal
    const tag1 = await api(FIN, "POST", "/gl/tag",
      { kind: "expense", id: `exp_ea_tag_${STAMP}`, legalEntityId: ENT_AE });
    check("gl/tag approve of proposed entity → approved via decide path",
      tag1.status === 200 && tag1.body?.data?.status === "approved", tag1);
    // 9b. tagging a DIFFERENT entity on a decided row without reason → 400.
    const tag2 = await api(FIN, "POST", "/gl/tag",
      { kind: "expense", id: `exp_ea_tag_${STAMP}`, legalEntityId: ENT_SA });
    check("gl/tag entity change without reason → 400 reason_required",
      tag2.status === 400 && tag2.body?.error === "reason_required", tag2);
    // 9c. with a reason → overridden + allocation.override audit.
    const tag3 = await api(FIN, "POST", "/gl/tag",
      { kind: "expense", id: `exp_ea_tag_${STAMP}`, legalEntityId: ENT_SA, reason: "Cost benefits the Saudi team" });
    check("gl/tag entity change with reason → overridden",
      tag3.status === 200 && tag3.body?.data?.status === "overridden", tag3);
    const tagAudits = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityType, "expense"),
      eq(atelierAuditEvents.entityId, `exp_ea_tag_${STAMP}`),
      inArray(atelierAuditEvents.action, ["allocation.approve", "allocation.override"]),
    ));
    check("gl/tag writes allocation approve+override audits with changes",
      tagAudits.some((a: any) => a.action === "allocation.approve") &&
      tagAudits.some((a: any) => a.action === "allocation.override" &&
        ((a.payload as any)?.changes ?? []).some((c: any) => c.field === "entityId" && c.from === ENT_AE && c.to === ENT_SA)),
      tagAudits.map((a: any) => a.action));
    // 9d. posted into a close-locked period → 409, entity unchanged.
    const jrnId = `gljrn_ea_tag_${STAMP}`;
    await db.insert(atelierGlJournalEntry).values({
      id: jrnId, orgId: ORG, legalEntityId: ENT_SA, periodLabel: "2026-07",
      entryDate: "2026-07-15", sourceKind: "expense", sourceRef: `exp_ea_tag_${STAMP}`,
      totalDebit: 100, totalCredit: 100,
    });
    const lockId = `pcl_ea_${STAMP}`;
    await db.insert(atelierPeriodCloseLock).values({
      id: lockId, orgId: ORG, periodLabel: "2026-07", lockedModules: ["gl"],
    });
    try {
      const tag4 = await api(FIN, "POST", "/gl/tag",
        { kind: "expense", id: `exp_ea_tag_${STAMP}`, legalEntityId: ENT_AE, reason: "trying to flip a closed period" });
      check("gl/tag on close-locked posted expense → 409 period-locked",
        tag4.status === 409 && tag4.body?.error === "period-locked", tag4);
      const [lockedRow] = await db.select().from(atelierExpenses)
        .where(eq(atelierExpenses.id, `exp_ea_tag_${STAMP}`));
      check("locked expense keeps its entity + overridden status",
        lockedRow.entityId === ENT_SA && lockedRow.allocStatus === "overridden", lockedRow);
    } finally {
      await db.delete(atelierPeriodCloseLock).where(eq(atelierPeriodCloseLock.id, lockId));
      await db.delete(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.id, jrnId));
    }

    // ------------- 10. every creation route prefetches an allocation +
    //                   null-allocStatus rows never silently post
    // 10a. Me self-service create (bypass-suspect route) → prefilled.
    const meCreate = await api(CONS, "POST", "/me/expenses", {
      amount: 42, currency: "USD", merchant: "Slack", contextType: "internal",
      internalProjectLabel: "Probe internal project",
    });
    if (meCreate.status === 201) {
      const meExpId = meCreate.body?.expense?.id;
      expenseIds.push(meExpId);
      const [meRow] = await db.select().from(atelierExpenses)
        .where(eq(atelierExpenses.id, meExpId));
      check("me-lens expense create prefills an allocation lifecycle",
        meRow.allocStatus === "proposed" || meRow.allocStatus === "needs_input", meRow.allocStatus);
    } else {
      check("me-lens expense create reachable", false, meCreate);
    }
    // 10b. Raw legacy row: null allocStatus + no entity → bookkeeper queues it.
    await mkExpense(`exp_ea_null_${STAMP}`, { category: "other", merchant: "Legacy Untagged", status: "approved" });
    await db.update(atelierExpenses).set({ allocStatus: null, entityId: null })
      .where(eq(atelierExpenses.id, `exp_ea_null_${STAMP}`));
    // 10c. Raw legacy row WITH an explicit entity tag → posts via audited legacy_tag.
    await mkExpense(`exp_ea_legacy_${STAMP}`, { category: "other", merchant: "Legacy Tagged", status: "approved" });
    await db.update(atelierExpenses).set({ allocStatus: null, entityId: ENT_SA })
      .where(eq(atelierExpenses.id, `exp_ea_legacy_${STAMP}`));
    const bk2 = await api(FP, "POST", "/gl/bookkeeper/run", { periodLabel: "2026-08", entityId: ENT_SA });
    const exc2 = (bk2.body?.data?.exceptions ?? []);
    check("null-allocation expense raises allocation_pending (no silent default post)",
      bk2.status === 200 && exc2.some((x: any) =>
        x.code === "allocation_pending" && x.sourceRef === `exp_ea_null_${STAMP}`), exc2);
    const [legacyRow] = await db.select().from(atelierExpenses)
      .where(eq(atelierExpenses.id, `exp_ea_legacy_${STAMP}`));
    check("legacy explicitly-tagged expense backfilled as approved legacy_tag",
      legacyRow.allocStatus === "approved" && legacyRow.allocRuleId === "legacy_tag", legacyRow);
    const legacyAudit = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityType, "expense"),
      eq(atelierAuditEvents.entityId, `exp_ea_legacy_${STAMP}`),
      eq(atelierAuditEvents.action, "allocation.approve"),
    ));
    check("legacy_tag backfill is audited", legacyAudit.length >= 1, legacyAudit.length);
  } finally {
    try {
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [...expenseIds, ...pfiIds, "allocation_sweep"]));
      await db.execute(sql`delete from atelier_gl_journal_line where entry_id in (select id from atelier_gl_journal_entry where source_ref in ${expenseIds.length ? expenseIds : ["_"]})`);
      await db.execute(sql`delete from atelier_gl_journal_entry where source_ref in ${expenseIds.length ? expenseIds : ["_"]}`);
      await db.delete(atelierExpenses).where(inArray(atelierExpenses.id, expenseIds.length ? expenseIds : ["_"]));
      await db.delete(atelierPartnerFirmInvoices).where(inArray(atelierPartnerFirmInvoices.id, pfiIds.length ? pfiIds : ["_"]));
      await db.delete(atelierEngagements).where(eq(atelierEngagements.id, ENG));
      await db.execute(sql`delete from atelier_accounts where id = ${ACC}`);
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP));
      await db.delete(atelierLegalEntities).where(inArray(atelierLegalEntities.id, [ENT_AE, ENT_SA]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP, FIN, CONS]));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
    stub.close();
    await pool.end();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
