/**
 * Task #1199 — GL "Needs attention" probes.
 *
 * Offline, deterministic coverage of allocation proposals for the GL
 * kinds newly covered by the engine (client invoices, contractor
 * payments, bank transactions) and the merged needs-attention feed:
 *   1. Invoice: engagement entity → engagement_entity; jurisdiction sole
 *      entity → registry_match. Proposals NEVER write legalEntityId.
 *   2. Contractor payment: engagement entity, else payee home entity
 *      (person_home).
 *   3. Bank transaction: owning account's entity (registry_match); an
 *      account with no entity → needs_input when AI is off.
 *   4. /gl/untagged carries proposal fields and triggers the propose pass.
 *   5. Decide: approve keeps proposal + writes legalEntityId; change
 *      requires a reason (overridden); /gl/tag rides the decide path.
 *   6. Period-lock: decide on a record posted into a close-locked period
 *      → 409, entity unchanged.
 *   7. Sweep scans the new kinds.
 *
 * Run: NODE_ENV=test pnpm run test:gl-needs-attention
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
  entityId: null, tripPurpose: null, destinationCountry: null, shared: false,
  justification: "Cannot tell which entity benefits.", confidence: 0.2,
};

async function main() {
  // Stub Anthropic BEFORE the app/client import (env read at import time).
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_probe1199", type: "message", role: "assistant",
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
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe1199-stub-key";

  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers, atelierEmployees, atelierLegalEntities, atelierEngagements,
    atelierInvoice, atelierContractorPayments, atelierBankAccount,
    atelierBankTransaction, atelierAuditEvents,
    atelierGlJournalEntry, atelierPeriodCloseLock,
  } = D as any;
  const { and, eq, inArray, sql } = await import("drizzle-orm");
  const alloc = await import("../../src/lib/atelier-entity-allocation.js");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const STAMP = Date.now();
  const ORG = "aico";
  const FP = `p_test_na_fp_${STAMP}`;
  const FIN = `p_test_na_fin_${STAMP}`;
  const CONTR = `p_test_na_contr_${STAMP}`;
  const ENT_AE = `ent_na_ae_${STAMP}`;
  const ENT_SA = `ent_na_sa_${STAMP}`;
  const EMP = `emp_na_${STAMP}`;
  const ACC = `acc_na_${STAMP}`;
  const ENG = `eng_na_${STAMP}`;      // contracted by SA entity
  const ENG2 = `eng_na2_${STAMP}`;    // no entity tagged
  const BA_AE = `ba_na_ae_${STAMP}`;  // bank account registered to AE
  const BA_NONE = `ba_na_none_${STAMP}`; // bank account with no entity
  const INV_ENG = `inv_na_eng_${STAMP}`;
  const INV_JUR = `inv_na_jur_${STAMP}`;
  const CP_ENG = `cp_na_eng_${STAMP}`;
  const CP_HOME = `cp_na_home_${STAMP}`;
  const BT_ACCT = `bt_na_acct_${STAMP}`;
  const BT_NONE = `bt_na_none_${STAMP}`;
  const invoiceIds = [INV_ENG, INV_JUR];
  const cpIds = [CP_ENG, CP_HOME];
  const btIds = [BT_ACCT, BT_NONE];
  const allIds = [...invoiceIds, ...cpIds, ...btIds];

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
      [FP, "founding_partner", "NA FP"],
      [FIN, "finance", "NA Finance"],
      [CONTR, "contractor", "NA Contractor"],
    ] as const) {
      await db.insert(atelierUsers).values({
        id, orgId: ORG, email: `${id}@example.test`, name, initials: "NA",
        role, roleLabel: name, title: name, permissions: [], bdActive: false,
      }).onConflictDoNothing();
    }
    // Archive leftovers so soleEntityInCountry sees exactly ours.
    await db.execute(sql`update atelier_legal_entities set status = 'archived', archived_at = now() where status <> 'archived'`);
    await db.insert(atelierLegalEntities).values([
      { id: ENT_AE, orgId: ORG, legalNameEn: `NA Dubai Entity ${STAMP}`, shortName: "AE Entity", country: "AE", status: "active" },
      { id: ENT_SA, orgId: ORG, legalNameEn: `NA Riyadh Entity ${STAMP}`, shortName: "SA Entity", country: "SA", status: "active" },
    ] as any);
    // Contractor homed in AE (person_home rule).
    await db.insert(atelierEmployees).values({
      id: EMP, orgId: ORG, fullName: "NA Contractor", email: `${CONTR}@example.test`,
      role: "contractor", roleTitle: "Contractor", userId: CONTR,
      legalEntityId: ENT_AE, homeCountry: "AE", workerType: "contractor",
    } as any);
    await db.execute(sql`insert into atelier_accounts (id, org_id, name, country, sector, partner_owner_id) values (${ACC}, ${ORG}, ${`NA acct ${STAMP}`}, 'SA', 'Test', ${FP})`);
    await db.insert(atelierEngagements).values([
      { id: ENG, orgId: ORG, slug: ENG, name: `NA engagement ${STAMP}`, accountId: ACC, plmStage: "deliver", partnerOwnerId: FP, engagementLeadId: FP, startDate: "2026-01-01", plannedEndDate: "2026-12-31", legalEntityId: ENT_SA },
      { id: ENG2, orgId: ORG, slug: ENG2, name: `NA engagement2 ${STAMP}`, accountId: ACC, plmStage: "deliver", partnerOwnerId: FP, engagementLeadId: FP, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
    ] as any);
    await db.insert(atelierBankAccount).values([
      { id: BA_AE, orgId: ORG, legalEntityId: ENT_AE, bankName: "Probe Bank", accountLabel: "AE Operating", accountNumberLast4: "1199", currency: "AED" },
      { id: BA_NONE, orgId: ORG, legalEntityId: null, bankName: "Probe Bank", accountLabel: "Orphan", accountNumberLast4: "0000", currency: "USD" },
    ] as any);
    await db.insert(atelierInvoice).values([
      { id: INV_ENG, orgId: ORG, engagementId: ENG, accountId: ACC, jurisdiction: "AE", invoiceNumber: `NA-ENG-${STAMP}`, currency: "SAR", status: "issued", total: 1000, issuedAt: new Date() },
      { id: INV_JUR, orgId: ORG, engagementId: null, accountId: ACC, jurisdiction: "SA", invoiceNumber: `NA-JUR-${STAMP}`, currency: "SAR", status: "issued", total: 500, issuedAt: new Date() },
    ] as any);
    await db.insert(atelierContractorPayments).values([
      { id: CP_ENG, orgId: ORG, payeeUserId: CONTR, payeeName: "NA Contractor", engagementId: ENG, weekIso: "2026-08-01", usdAmount: 800, status: "paid" },
      { id: CP_HOME, orgId: ORG, payeeUserId: CONTR, payeeName: "NA Contractor", engagementId: ENG2, weekIso: "2026-08-08", usdAmount: 600, status: "paid" },
    ] as any);
    await db.insert(atelierBankTransaction).values([
      { id: BT_ACCT, orgId: ORG, bankAccountId: BA_AE, statementImportId: `imp_na_${STAMP}`, postedDate: "2026-08-05", amount: -250, currency: "AED", counterpartyNameRaw: "DEWA", kind: "payment" },
      { id: BT_NONE, orgId: ORG, bankAccountId: BA_NONE, statementImportId: `imp_na_${STAMP}`, postedDate: "2026-08-06", amount: 999, currency: "USD", counterpartyNameRaw: "Mystery Inc", kind: "receipt" },
    ] as any);

    // ---------------------------------- 1. invoice proposal rules
    let r = await alloc.proposeGlRecordAllocation("invoice", INV_ENG, { allowAi: false });
    check("engagement invoice → proposed SA via engagement_entity",
      r.status === "proposed" && r.decision?.entityId === ENT_SA && r.decision?.ruleId === "engagement_entity", r);
    r = await alloc.proposeGlRecordAllocation("invoice", INV_JUR, { allowAi: false });
    check("jurisdiction invoice → proposed SA via registry_match",
      r.status === "proposed" && r.decision?.entityId === ENT_SA && r.decision?.ruleId === "registry_match", r);
    const [invRow] = await db.select().from(atelierInvoice).where(eq(atelierInvoice.id, INV_ENG));
    check("invoice proposal never writes legalEntityId",
      invRow.legalEntityId == null && invRow.allocProposedEntityId === ENT_SA &&
      invRow.allocStatus === "proposed" && invRow.allocConfidence === 0.95, invRow);

    // ---------------------------------- 2. contractor payment rules
    r = await alloc.proposeGlRecordAllocation("contractor_payment", CP_ENG, { allowAi: false });
    check("engagement contractor payment → SA via engagement_entity",
      r.status === "proposed" && r.decision?.entityId === ENT_SA && r.decision?.ruleId === "engagement_entity", r);
    r = await alloc.proposeGlRecordAllocation("contractor_payment", CP_HOME, { allowAi: false });
    check("entity-less engagement cp → payee home AE via person_home",
      r.status === "proposed" && r.decision?.entityId === ENT_AE && r.decision?.ruleId === "person_home", r);
    const [cpRow] = await db.select().from(atelierContractorPayments).where(eq(atelierContractorPayments.id, CP_HOME));
    check("cp proposal keeps legalEntityId null", cpRow.legalEntityId == null && cpRow.allocProposedEntityId === ENT_AE, cpRow);

    // ---------------------------------- 3. bank transaction rules
    r = await alloc.proposeGlRecordAllocation("bank_transaction", BT_ACCT, { allowAi: false });
    check("bank txn on AE account → AE via registry_match",
      r.status === "proposed" && r.decision?.entityId === ENT_AE && r.decision?.ruleId === "registry_match" && r.decision?.confidence === 0.95, r);
    r = await alloc.proposeGlRecordAllocation("bank_transaction", BT_NONE, { allowAi: false });
    check("bank txn on entity-less account (rules only) → needs_input",
      r.status === "needs_input" && r.decision === null, r);
    // AI on, but stub answers low confidence → still needs_input, never a guess.
    r = await alloc.proposeGlRecordAllocation("bank_transaction", BT_NONE, { allowAi: true });
    check("AI low confidence stays needs_input", r.status === "needs_input", r);

    // ---------------------------------- 4. untagged feed carries proposals
    const feed = await api(FIN, "GET", "/gl/untagged");
    const rows: any[] = feed.body?.data?.rows ?? [];
    const feedRow = (id: string) => rows.find((x) => x.id === id);
    check("untagged feed reachable", feed.status === 200, feed.status);
    check("feed row carries proposal fields",
      feedRow(INV_ENG)?.allocStatus === "proposed" &&
      feedRow(INV_ENG)?.proposedEntityId === ENT_SA &&
      typeof feedRow(INV_ENG)?.allocJustification === "string" &&
      feedRow(INV_ENG)?.allocConfidence === 0.95, feedRow(INV_ENG));
    check("needs_input row flagged in feed", feedRow(BT_NONE)?.allocStatus === "needs_input" && feedRow(BT_NONE)?.proposedEntityId == null, feedRow(BT_NONE));

    // ---------------------------------- 5. decide approve / change
    const ap = await api(FIN, "POST", `/gl/allocations/invoice/${INV_ENG}/decide`, {});
    check("approve invoice proposal → approved + entity written",
      ap.status === 200 && ap.body?.data?.status === "approved" && ap.body?.data?.entityId === ENT_SA, ap);
    const [invAfter] = await db.select().from(atelierInvoice).where(eq(atelierInvoice.id, INV_ENG));
    check("approved invoice now has legalEntityId", invAfter.legalEntityId === ENT_SA && invAfter.allocStatus === "approved", invAfter);
    const chNo = await api(FIN, "POST", `/gl/allocations/contractor_payment/${CP_HOME}/decide`, { entityId: ENT_SA });
    check("change vs proposal without reason → 400 reason_required",
      chNo.status === 400 && chNo.body?.error === "reason_required", chNo);
    const ch = await api(FP, "POST", `/gl/allocations/contractor_payment/${CP_HOME}/decide`, { entityId: ENT_SA, reason: "Work delivered to the Saudi team" });
    check("change with reason → overridden", ch.status === 200 && ch.body?.data?.status === "overridden", ch);
    const [cpAfter] = await db.select().from(atelierContractorPayments).where(eq(atelierContractorPayments.id, CP_HOME));
    check("overridden cp stamped human/explicit_choice + entity written",
      cpAfter.legalEntityId === ENT_SA && cpAfter.allocDecidedBy === "human" && cpAfter.allocRuleId === "explicit_choice", cpAfter);
    const audits = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityType, "contractor_payment"),
      eq(atelierAuditEvents.entityId, CP_HOME),
      eq(atelierAuditEvents.action, "allocation.override"),
    ));
    check("override audited with changes", audits.length === 1 &&
      ((audits[0]?.payload as any)?.changes ?? []).some((c: any) => c.field === "legalEntityId" && c.to === ENT_SA), audits[0]?.payload);
    // needs_input row decided via plain picker (gl/tag path).
    const tag = await api(FIN, "POST", "/gl/tag", { kind: "bank_transaction", id: BT_NONE, legalEntityId: ENT_AE });
    check("gl/tag on needs_input bank txn rides decide path → approved",
      tag.status === 200 && tag.body?.data?.status === "approved", tag);
    const [btAfter] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, BT_NONE));
    check("tagged bank txn has entity + approved status", btAfter.legalEntityId === ENT_AE && btAfter.allocStatus === "approved", btAfter);
    // role clamp: contractor cannot decide.
    const clamp = await api(CONTR, "POST", `/gl/allocations/bank_transaction/${BT_ACCT}/decide`, {});
    check("contractor decide → 403", clamp.status === 403, clamp);

    // ---------------------------------- 6. period-lock rejection
    const jrnId = `gljrn_na_${STAMP}`;
    await db.insert(atelierGlJournalEntry).values({
      id: jrnId, orgId: ORG, legalEntityId: ENT_AE, periodLabel: "2026-07",
      entryDate: "2026-07-20", sourceKind: "bank_transaction", sourceRef: BT_ACCT,
      totalDebit: 250, totalCredit: 250,
    });
    const lockId = `pcl_na_${STAMP}`;
    await db.insert(atelierPeriodCloseLock).values({ id: lockId, orgId: ORG, periodLabel: "2026-07", lockedModules: ["gl"] });
    try {
      const locked = await api(FIN, "POST", `/gl/allocations/bank_transaction/${BT_ACCT}/decide`, {});
      check("decide on close-locked posted bank txn → 409 period-locked",
        locked.status === 409 && locked.body?.error === "period-locked", locked);
      const [lockedRow] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, BT_ACCT));
      check("locked bank txn keeps legalEntityId null", lockedRow.legalEntityId == null && lockedRow.allocStatus === "proposed", lockedRow);
    } finally {
      await db.delete(atelierPeriodCloseLock).where(eq(atelierPeriodCloseLock.id, lockId));
      await db.delete(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.id, jrnId));
    }

    // ---------------------------------- 7. sweep scans the new kinds
    // Reset the still-proposed rows to null allocStatus so the sweep picks them up.
    await db.update(atelierInvoice).set({ allocStatus: null, allocProposedEntityId: null }).where(eq(atelierInvoice.id, INV_JUR));
    await db.update(atelierContractorPayments).set({ allocStatus: null, allocProposedEntityId: null }).where(eq(atelierContractorPayments.id, CP_ENG));
    await db.update(atelierBankTransaction).set({ allocStatus: null, allocProposedEntityId: null }).where(eq(atelierBankTransaction.id, BT_ACCT));
    const sw = await api(FP, "POST", "/gl/allocations/sweep", {});
    check("sweep proposes for the new kinds", sw.status === 200 && sw.body?.data?.proposed >= 3, sw.body);
  } finally {
    try {
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [...allIds, "allocation_sweep"]));
      await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, invoiceIds));
      await db.delete(atelierContractorPayments).where(inArray(atelierContractorPayments.id, cpIds));
      await db.delete(atelierBankTransaction).where(inArray(atelierBankTransaction.id, btIds));
      await db.delete(atelierBankAccount).where(inArray(atelierBankAccount.id, [BA_AE, BA_NONE]));
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [ENG, ENG2]));
      await db.execute(sql`delete from atelier_accounts where id = ${ACC}`);
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP));
      await db.delete(atelierLegalEntities).where(inArray(atelierLegalEntities.id, [ENT_AE, ENT_SA]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP, FIN, CONTR]));
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
