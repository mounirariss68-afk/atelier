/**
 * Task #875 — Partner contracts & billing hub probes.
 *
 * Runs standalone (tsx ./tests/partner-billing/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass so requests act as ephemeral p_test_* personas. All rows created
 * here are removed in `finally`.
 *
 * Coverage:
 *   1. Role boundary: consultant/partner 403 on each other's surfaces.
 *   2. Portal invoice submission (multipart PDF) + validation failures.
 *   3. Firm isolation: firm B never sees firm A invoices/contracts/inbox.
 *   4. AP review state machine: reject-needs-reason, bank-details gate,
 *      double-approve 409.
 *   5. Payment-run linkage: build schedules, cancel releases, mark-paid
 *      pays partner invoices.
 *   6. Contract shares: share → visible, revoke → gone; cross-firm 404.
 *   7. Doc inbox: upload → pending, accept → contract record + auto-share
 *      with downloadable PDF; reject needs note.
 *   8. Issued RCTIs read-only + firm-scoped.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, inArray, eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_pb_fp_${STAMP}`;
const CONS_ID = `p_test_pb_cons_${STAMP}`;
const PA_ID = `p_test_pb_pa_${STAMP}`; // firm A partner login
const PB_ID = `p_test_pb_pb_${STAMP}`; // firm B partner login

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierPartnerFirms,
    atelierPartnerFirmInvoices,
    atelierPartnerContractShares,
    atelierPartnerDocInbox,
    atelierContractRecords,
    atelierContractDocuments,
    atelierSelfBilledInvoices,
    atelierBankAccount,
    atelierPaymentRuns,
    atelierPaymentRunItems,
    atelierAuditEvents,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string,
    path: string,
    personaId: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function upload(
    path: string,
    personaId: string,
    fields: Record<string, string>,
    file: { name: string; type: string; bytes: Buffer },
  ): Promise<{ status: number; body: any }> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${personaId}` },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function raw(path: string, personaId: string): Promise<Response> {
    return fetch(`${API}${path}`, { headers: { cookie: `atelier_persona=${personaId}` } });
  }

  const firmAId = `pfrm_test_pb_a_${STAMP}`;
  const firmBId = `pfrm_test_pb_b_${STAMP}`;
  const ctrId = `ctr_test_pb_${STAMP}`;
  const sbiId = `sbi_test_pb_${STAMP}`;
  const bankId = `bank_test_pb_${STAMP}`;
  const runIds: string[] = [];
  let invAId: string | null = null;
  let invBId: string | null = null;
  let inboxId: string | null = null;
  let acceptedContractId: string | null = null;

  try {
    // -------------------------------------------------------------- setup
    for (const p of [
      { id: FP_ID, role: "founding_partner", name: "PB FP", firm: null },
      { id: CONS_ID, role: "consultant", name: "PB Consultant", firm: null },
      { id: PA_ID, role: "alliance_partner", name: "PB Partner A", firm: firmAId },
      { id: PB_ID, role: "alliance_partner", name: "PB Partner B", firm: firmBId },
    ]) {
      await db.insert(atelierUsers).values({
        id: p.id,
        orgId: ORG,
        email: `${p.id}@example.com`,
        name: p.name,
        initials: "PB",
        role: p.role,
        roleLabel: p.name,
        title: p.name,
        permissions: [],
        bdActive: false,
        partnerFirmId: p.firm,
      }).onConflictDoNothing();
    }
    await db.insert(atelierPartnerFirms).values({
      id: firmAId,
      orgId: ORG,
      name: `PB Firm A ${STAMP}`,
      status: "active",
      partnershipStage: "agreed",
      agreementStage: "signed",
      bankIban: "AE070331234567890123456",
      createdByUserId: FP_ID,
    });
    await db.insert(atelierPartnerFirms).values({
      id: firmBId,
      orgId: ORG,
      name: `PB Firm B ${STAMP}`,
      status: "active",
      partnershipStage: "agreed",
      agreementStage: "signed",
      createdByUserId: FP_ID, // no bank details on purpose
    });
    // Contract record with firm A as counterparty (shared later).
    await db.insert(atelierContractRecords).values({
      id: ctrId,
      orgId: ORG,
      title: `PB Shared MSA ${STAMP}`,
      contractType: "msa",
      counterpartyKind: "partner_firm",
      counterpartyLabel: `PB Firm A ${STAMP}`,
      status: "signed",
      ownerUserId: FP_ID,
      ownerLabel: "PB FP",
    });
    // Cognirise-issued RCTI to firm A (portal read-only "issued" list).
    await db.insert(atelierSelfBilledInvoices).values({
      id: sbiId,
      orgId: ORG,
      invoiceNumber: `RCTI-PB-${STAMP}`,
      supplierType: "partner_firm",
      supplierId: firmAId,
      supplierName: `PB Firm A ${STAMP}`,
      weekIso: "2026-W30",
      currency: "USD",
      lines: [],
      subtotalAmount: 1000,
      totalAmount: 1000,
      totalUsd: 1000,
      status: "approved",
    });
    await db.insert(atelierBankAccount).values({
      id: bankId,
      orgId: ORG,
      bankName: "PB Probe Bank",
      accountLabel: `PB Ops ${STAMP}`,
      accountNumberLast4: "9955",
      currency: "USD",
      isActive: true,
    });

    // =====================================================================
    group("role boundaries");
    // =====================================================================
    for (const [who, path] of [
      [CONS_ID, "/partner-portal/invoices"],
      [CONS_ID, "/partner-portal/contracts"],
      [PA_ID, "/finance/payables/partner-invoices"],
      [PA_ID, "/partners/doc-inbox"],
      [PA_ID, `/partners/firms/${firmAId}/contract-shares`],
    ] as const) {
      const r = await call("GET", path, who);
      check(`403 for ${who === CONS_ID ? "consultant" : "partner"} on ${path}`, r.status === 403, `status=${r.status}`);
    }

    // =====================================================================
    group("portal invoice submission + validation");
    // =====================================================================
    {
      const bad1 = await upload("/partner-portal/invoices", PA_ID, { amount: "100", currency: "USD" }, { name: "a.pdf", type: "application/pdf", bytes: PDF_BYTES });
      check("missing reference \u2192 400", bad1.status === 400, `status=${bad1.status}`);
      const bad2 = await upload("/partner-portal/invoices", PA_ID, { amount: "100", currency: "USD", reference: "INV-1" }, { name: "a.pdf", type: "application/pdf", bytes: Buffer.from("not a pdf") });
      check("non-PDF bytes \u2192 400", bad2.status === 400, `status=${bad2.status}`);
      const ok = await upload("/partner-portal/invoices", PA_ID, {
        amount: "1234.5", currency: "USD", reference: `INV-A-${STAMP}`, periodLabel: "July 2026", notes: "probe",
      }, { name: "invoice-a.pdf", type: "application/pdf", bytes: PDF_BYTES });
      check("firm A submit \u2192 201 submitted", ok.status === 201 && ok.body?.item?.status === "submitted", `status=${ok.status} body=${JSON.stringify(ok.body)}`);
      invAId = ok.body?.item?.id ?? null;
      const okB = await upload("/partner-portal/invoices", PB_ID, {
        amount: "500", currency: "USD", reference: `INV-B-${STAMP}`,
      }, { name: "invoice-b.pdf", type: "application/pdf", bytes: PDF_BYTES });
      check("firm B submit \u2192 201", okB.status === 201, `status=${okB.status}`);
      invBId = okB.body?.item?.id ?? null;
    }

    // =====================================================================
    group("firm isolation \u2014 invoices");
    // =====================================================================
    {
      const listB = await call("GET", "/partner-portal/invoices", PB_ID);
      const idsB = (listB.body?.items ?? []).map((i: any) => i.id);
      check("firm B list excludes firm A invoice", listB.status === 200 && !idsB.includes(invAId), JSON.stringify(idsB));
      const fileX = await raw(`/partner-portal/invoices/${invAId}/file`, PB_ID);
      check("firm B \u2192 404 on firm A invoice file", fileX.status === 404, `status=${fileX.status}`);
      const fileOk = await raw(`/partner-portal/invoices/${invAId}/file`, PA_ID);
      check("firm A downloads own invoice PDF", fileOk.status === 200 && (fileOk.headers.get("content-type") ?? "").includes("pdf"), `status=${fileOk.status}`);
    }

    // =====================================================================
    group("AP review state machine");
    // =====================================================================
    {
      const list = await call("GET", "/finance/payables/partner-invoices", FP_ID);
      const rowA = (list.body?.items ?? []).find((i: any) => i.id === invAId);
      const rowB = (list.body?.items ?? []).find((i: any) => i.id === invBId);
      check("finance list shows both, bank flags correct", !!rowA && !!rowB && rowA.hasBankDetails === true && rowB.hasBankDetails === false, JSON.stringify({ a: rowA?.hasBankDetails, b: rowB?.hasBankDetails }));
      const rejNoReason = await call("POST", `/finance/payables/partner-invoices/${invAId}/review`, FP_ID, { decision: "reject" });
      check("reject without reason \u2192 400", rejNoReason.status === 400, `status=${rejNoReason.status}`);
      const apprNoBank = await call("POST", `/finance/payables/partner-invoices/${invBId}/review`, FP_ID, { decision: "approve" });
      check("approve without bank details \u2192 409", apprNoBank.status === 409 && apprNoBank.body?.error === "bank-details-missing", `status=${apprNoBank.status} ${JSON.stringify(apprNoBank.body)}`);
      const start = await call("POST", `/finance/payables/partner-invoices/${invAId}/review`, FP_ID, { decision: "start_review" });
      check("start_review \u2192 under_review", start.status === 200 && start.body?.invoice?.status === "under_review", JSON.stringify(start.body));
      const appr = await call("POST", `/finance/payables/partner-invoices/${invAId}/review`, FP_ID, { decision: "approve" });
      check("approve \u2192 approved", appr.status === 200 && appr.body?.invoice?.status === "approved", JSON.stringify(appr.body));
      const again = await call("POST", `/finance/payables/partner-invoices/${invAId}/review`, FP_ID, { decision: "approve" });
      check("second approve \u2192 409", again.status === 409, `status=${again.status}`);
      const rejB = await call("POST", `/finance/payables/partner-invoices/${invBId}/review`, FP_ID, { decision: "reject", reason: "Probe rejection" });
      check("reject with reason \u2192 rejected", rejB.status === 200 && rejB.body?.invoice?.status === "rejected", JSON.stringify(rejB.body));
      const rejVisible = await call("GET", "/partner-portal/invoices", PB_ID);
      const rB = (rejVisible.body?.items ?? []).find((i: any) => i.id === invBId);
      check("partner sees rejection reason", rB?.status === "rejected" && rB?.rejectedReason === "Probe rejection", JSON.stringify(rB));
      const audits = await db.select().from(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, invAId!));
      check("review actions audited", audits.length >= 2, `audits=${audits.length}`);
    }

    // =====================================================================
    group("payment-run linkage");
    // =====================================================================
    {
      const build1 = await call("POST", "/finance/payables/payment-runs/build", FP_ID, { bankAccountId: bankId, invoiceIds: [], expenseIds: [], partnerInvoiceIds: [invAId] });
      check("build \u2192 run created", build1.status === 200 || build1.status === 201, `status=${build1.status} ${JSON.stringify(build1.body)}`);
      const runId1 = build1.body?.run?.id ?? build1.body?.id;
      if (runId1) runIds.push(runId1);
      const [afterBuild] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, invAId!));
      check("invoice scheduled with runId", afterBuild?.status === "scheduled" && afterBuild?.paymentRunId === runId1, JSON.stringify({ s: afterBuild?.status, r: afterBuild?.paymentRunId }));
      const items1 = runId1 ? await db.select().from(atelierPaymentRunItems).where(eq(atelierPaymentRunItems.runId, runId1)) : [];
      check("run has partner_firm_invoice item", items1.some((i: any) => i.itemType === "partner_firm_invoice" && i.refId === invAId), JSON.stringify(items1.map((i: any) => i.itemType)));
      const cancel = await call("POST", `/finance/payables/payment-runs/${runId1}/cancel`, FP_ID, {});
      check("cancel run \u2192 ok", cancel.status === 200, `status=${cancel.status}`);
      const [afterCancel] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, invAId!));
      check("cancel releases invoice back to approved", afterCancel?.status === "approved" && !afterCancel?.paymentRunId, JSON.stringify({ s: afterCancel?.status, r: afterCancel?.paymentRunId }));

      const build2 = await call("POST", "/finance/payables/payment-runs/build", FP_ID, { bankAccountId: bankId, invoiceIds: [], expenseIds: [], partnerInvoiceIds: [invAId] });
      const runId2 = build2.body?.run?.id ?? build2.body?.id;
      if (runId2) runIds.push(runId2);
      // Skip the dual-signature ceremony (covered by existing payables probes):
      // force the run to approved and exercise the partner-invoice pay path.
      await db.update(atelierPaymentRuns).set({ status: "approved" }).where(eq(atelierPaymentRuns.id, runId2));
      const paid = await call("POST", `/finance/payables/payment-runs/${runId2}/mark-paid`, FP_ID, { remittanceRef: `RMT-${STAMP}` });
      check("mark-paid \u2192 ok", paid.status === 200, `status=${paid.status} ${JSON.stringify(paid.body)}`);
      const [afterPaid] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, invAId!));
      check("invoice paid with remittance ref", afterPaid?.status === "paid" && afterPaid?.remittanceRef === `RMT-${STAMP}`, JSON.stringify({ s: afterPaid?.status, ref: afterPaid?.remittanceRef }));
      const portal = await call("GET", "/partner-portal/invoices", PA_ID);
      const pRow = (portal.body?.items ?? []).find((i: any) => i.id === invAId);
      check("partner sees paid status", pRow?.status === "paid", JSON.stringify(pRow));
    }

    // =====================================================================
    group("contract shares");
    // =====================================================================
    {
      const share = await call("POST", `/partners/firms/${firmAId}/contract-shares`, FP_ID, { contractId: ctrId, note: "probe share" });
      check("share create \u2192 201", share.status === 201 || share.status === 200, `status=${share.status} ${JSON.stringify(share.body)}`);
      const shareId = share.body?.share?.id ?? share.body?.id;
      const again = await call("POST", `/partners/firms/${firmAId}/contract-shares`, FP_ID, { contractId: ctrId });
      check("re-share idempotent", again.status === 200 || again.status === 201, `status=${again.status}`);
      const cA = await call("GET", "/partner-portal/contracts", PA_ID);
      const sharedA = (cA.body?.shared ?? []).map((c: any) => c.id);
      check("firm A sees shared contract", sharedA.includes(ctrId), JSON.stringify(sharedA));
      const cB = await call("GET", "/partner-portal/contracts", PB_ID);
      const sharedB = (cB.body?.shared ?? []).map((c: any) => c.id);
      check("firm B does NOT see it", !sharedB.includes(ctrId), JSON.stringify(sharedB));
      const dlB = await raw(`/partner-portal/contracts/${ctrId}/download`, PB_ID);
      check("firm B download \u2192 404", dlB.status === 404, `status=${dlB.status}`);
      const revoke = await call("POST", `/partners/firms/${firmAId}/contract-shares/${shareId}/revoke`, FP_ID, {});
      check("revoke \u2192 ok", revoke.status === 200, `status=${revoke.status}`);
      const cA2 = await call("GET", "/partner-portal/contracts", PA_ID);
      check("after revoke firm A no longer sees it", !(cA2.body?.shared ?? []).some((c: any) => c.id === ctrId), JSON.stringify(cA2.body?.shared));
      const dlA = await raw(`/partner-portal/contracts/${ctrId}/download`, PA_ID);
      check("after revoke download \u2192 404", dlA.status === 404, `status=${dlA.status}`);
    }

    // =====================================================================
    group("doc inbox review \u2192 contract record");
    // =====================================================================
    {
      const up = await upload("/partner-portal/inbox", PA_ID, { note: "countersigned copy" }, { name: `countersigned-${STAMP}.pdf`, type: "application/pdf", bytes: PDF_BYTES });
      check("partner upload \u2192 201 pending", up.status === 201 && up.body?.item?.status === "pending", `status=${up.status} ${JSON.stringify(up.body)}`);
      inboxId = up.body?.item?.id ?? null;
      const listB = await call("GET", "/partner-portal/inbox", PB_ID);
      check("firm B inbox does not include firm A item", !(listB.body?.items ?? []).some((i: any) => i.id === inboxId), JSON.stringify(listB.body?.items));
      const internal = await call("GET", "/partners/doc-inbox?status=pending", FP_ID);
      check("internal inbox lists the item", (internal.body?.items ?? []).some((i: any) => i.id === inboxId), JSON.stringify(internal.body?.items?.map((i: any) => i.id)));
      const rejNoNote = await call("POST", `/partners/doc-inbox/${inboxId}/review`, FP_ID, { decision: "reject" });
      check("reject without note \u2192 400", rejNoNote.status === 400, `status=${rejNoNote.status}`);
      const accept = await call("POST", `/partners/doc-inbox/${inboxId}/review`, FP_ID, { decision: "accept", title: `PB Countersigned ${STAMP}` });
      check("accept \u2192 contract created", accept.status === 200 && !!accept.body?.contractId, JSON.stringify(accept.body));
      acceptedContractId = accept.body?.contractId ?? null;
      const reAccept = await call("POST", `/partners/doc-inbox/${inboxId}/review`, FP_ID, { decision: "accept", title: "again" });
      check("re-review \u2192 409", reAccept.status === 409, `status=${reAccept.status}`);
      const cA = await call("GET", "/partner-portal/contracts", PA_ID);
      const row = (cA.body?.shared ?? []).find((c: any) => c.id === acceptedContractId);
      check("accepted contract auto-shared, downloadable", !!row && row.canDownload === true, JSON.stringify(row));
      const dl = await raw(`/partner-portal/contracts/${acceptedContractId}/download`, PA_ID);
      check("partner downloads accepted PDF", dl.status === 200 && (dl.headers.get("content-type") ?? "").includes("pdf"), `status=${dl.status}`);
      const dlB = await raw(`/partner-portal/contracts/${acceptedContractId}/download`, PB_ID);
      check("firm B blocked from accepted PDF", dlB.status === 404, `status=${dlB.status}`);
    }

    // =====================================================================
    group("issued RCTIs (read-only, firm-scoped)");
    // =====================================================================
    {
      const isA = await call("GET", "/partner-portal/issued", PA_ID);
      check("firm A sees issued RCTI", (isA.body?.items ?? []).some((i: any) => i.id === sbiId), JSON.stringify(isA.body?.items));
      const isB = await call("GET", "/partner-portal/issued", PB_ID);
      check("firm B does not", !(isB.body?.items ?? []).some((i: any) => i.id === sbiId), JSON.stringify(isB.body?.items));
    }
  } finally {
    try {
      await db.delete(atelierPartnerContractShares).where(like(atelierPartnerContractShares.id, "pcs_%"));
      await db.delete(atelierPartnerDocInbox).where(inArray(atelierPartnerDocInbox.partnerFirmId, [firmAId, firmBId]));
      await db.delete(atelierPartnerFirmInvoices).where(inArray(atelierPartnerFirmInvoices.partnerFirmId, [firmAId, firmBId]));
      if (runIds.length) {
        await db.delete(atelierPaymentRunItems).where(inArray(atelierPaymentRunItems.runId, runIds));
        await db.delete(atelierPaymentRuns).where(inArray(atelierPaymentRuns.id, runIds));
      }
      await db.delete(atelierSelfBilledInvoices).where(eq(atelierSelfBilledInvoices.id, sbiId));
      await db.delete(atelierBankAccount).where(eq(atelierBankAccount.id, bankId));
      const ctrIds = [ctrId, ...(acceptedContractId ? [acceptedContractId] : [])];
      await db.delete(atelierContractDocuments).where(inArray(atelierContractDocuments.contractId, ctrIds));
      await db.delete(atelierContractRecords).where(inArray(atelierContractRecords.id, ctrIds));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, [firmAId, firmBId]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP_ID, CONS_ID, PA_ID, PB_ID]));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
    await pool?.end?.().catch(() => {});
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 partner-billing probes passed"
      : `\n\u2717 ${failures.length} failure(s): ${failures.join("; ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
