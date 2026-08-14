/**
 * Task #1070 — Internal supplier-invoice upload probes.
 *
 * Runs standalone (tsx ./tests/supplier-invoices/run.ts) booting the app
 * in-process via app.listen(0); NODE_ENV=test enables the persona-cookie
 * bypass so requests act as ephemeral p_test_* personas. All rows created
 * here are removed in `finally`.
 *
 * Coverage:
 *   1. Role gating: fp/finance can upload; consultant/hr 403 on upload +
 *      review; employee/alliance_partner 403 at the central gate; the
 *      list surface is readable for internal read roles.
 *   2. Upload validation (missing fields, non-PDF bytes).
 *   3. Dedupe: same file bytes → 409; same supplier+reference → 409;
 *      rejected rows do not block re-upload.
 *   4. Lifecycle: submitted → under_review → approved; reject needs a
 *      reason; double-approve 409; audit events written.
 *   5. Bank-details hold: invoice linked to a partner firm without an
 *      IBAN blocks approve + is skipped at run build; unlinked suppliers
 *      carry no hold.
 *   6. Payment-run eligibility: approved supplier invoice joins the run,
 *      cancel releases it, mark-paid settles it with a remittance ref.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { eq, inArray, and, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_si_fp_${STAMP}`;
const FIN_ID = `p_test_si_fin_${STAMP}`;
const CONS_ID = `p_test_si_cons_${STAMP}`;
const HR_ID = `p_test_si_hr_${STAMP}`;
const EMP_ID = `p_test_si_emp_${STAMP}`;
const AP_ID = `p_test_si_ap_${STAMP}`;

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

const PDF_A = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% probe A\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const PDF_B = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% probe B\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const PDF_C = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% probe C\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const PDF_D = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% probe D\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const PDF_E = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% probe E\ntrailer<</Root 1 0 R>>\n%%EOF\n");

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
    personaId: string,
    fields: Record<string, string>,
    file: { name: string; type: string; bytes: Buffer },
  ): Promise<{ status: number; body: any }> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${API}/finance/payables/supplier-invoices`, {
      method: "POST",
      headers: { cookie: `atelier_persona=${personaId}` },
      body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function raw(path: string, personaId: string): Promise<Response> {
    return fetch(`${API}${path}`, { headers: { cookie: `atelier_persona=${personaId}` } });
  }

  const firmNoBankId = `pfrm_test_si_nb_${STAMP}`;
  const firmBankId = `pfrm_test_si_bk_${STAMP}`;
  const bankId = `bank_test_si_${STAMP}`;
  const runIds: string[] = [];
  const createdInvoiceIds: string[] = [];

  try {
    // -------------------------------------------------------------- setup
    for (const p of [
      { id: FP_ID, role: "founding_partner", name: "SI FP", firm: null },
      { id: FIN_ID, role: "finance", name: "SI Finance", firm: null },
      { id: CONS_ID, role: "consultant", name: "SI Consultant", firm: null },
      { id: HR_ID, role: "hr", name: "SI HR", firm: null },
      { id: EMP_ID, role: "employee", name: "SI Employee", firm: null },
      { id: AP_ID, role: "alliance_partner", name: "SI Alliance", firm: firmBankId },
    ]) {
      await db.insert(atelierUsers).values({
        id: p.id,
        orgId: ORG,
        email: `${p.id}@example.com`,
        name: p.name,
        initials: "SI",
        role: p.role,
        roleLabel: p.name,
        title: p.name,
        permissions: [],
        bdActive: false,
        partnerFirmId: p.firm,
      }).onConflictDoNothing();
    }
    await db.insert(atelierPartnerFirms).values({
      id: firmNoBankId,
      orgId: ORG,
      name: `SI Firm NoBank ${STAMP}`,
      status: "active",
      partnershipStage: "agreed",
      agreementStage: "signed",
      createdByUserId: FP_ID, // no bank details on purpose
    });
    await db.insert(atelierPartnerFirms).values({
      id: firmBankId,
      orgId: ORG,
      name: `SI Firm Bank ${STAMP}`,
      status: "active",
      partnershipStage: "agreed",
      agreementStage: "signed",
      bankIban: "AE070331234567890123456",
      createdByUserId: FP_ID,
    });
    await db.insert(atelierBankAccount).values({
      id: bankId,
      orgId: ORG,
      bankName: "SI Probe Bank",
      accountLabel: `SI Ops ${STAMP}`,
      accountNumberLast4: "4411",
      currency: "USD",
      isActive: true,
    });

    // =====================================================================
    group("role gating");
    // =====================================================================
    {
      for (const [who, label, want] of [
        [CONS_ID, "consultant upload", 403],
        [HR_ID, "hr upload", 403],
      ] as const) {
        const r = await upload(who, { supplierName: "X", amount: "10", currency: "USD", reference: `R-${STAMP}-x` }, { name: "x.pdf", type: "application/pdf", bytes: PDF_E });
        check(`${label} \u2192 ${want}`, r.status === want, `status=${r.status}`);
      }
      for (const who of [EMP_ID, AP_ID]) {
        const r = await raw("/finance/payables/supplier-invoices", who);
        check(`restricted persona ${who === EMP_ID ? "employee" : "alliance_partner"} list \u2192 403`, r.status === 403, `status=${r.status}`);
      }
      const consRead = await call("GET", "/finance/payables/supplier-invoices", CONS_ID);
      check("consultant read list \u2192 200 (read surface)", consRead.status === 200, `status=${consRead.status}`);
      const consReview = await call("POST", `/finance/payables/supplier-invoices/spi_none/review`, CONS_ID, { decision: "approve" });
      check("consultant review \u2192 403", consReview.status === 403, `status=${consReview.status}`);
    }

    // =====================================================================
    group("upload validation");
    // =====================================================================
    {
      const noName = await upload(FIN_ID, { amount: "100", currency: "USD", reference: `R-${STAMP}-1` }, { name: "a.pdf", type: "application/pdf", bytes: PDF_A });
      check("missing supplier name \u2192 400", noName.status === 400, `status=${noName.status}`);
      const noRef = await upload(FIN_ID, { supplierName: "Acme", amount: "100", currency: "USD" }, { name: "a.pdf", type: "application/pdf", bytes: PDF_A });
      check("missing reference \u2192 400", noRef.status === 400, `status=${noRef.status}`);
      const badPdf = await upload(FIN_ID, { supplierName: "Acme", amount: "100", currency: "USD", reference: `R-${STAMP}-1` }, { name: "a.pdf", type: "application/pdf", bytes: Buffer.from("not a pdf") });
      check("non-PDF bytes \u2192 400", badPdf.status === 400, `status=${badPdf.status}`);
      const badAmt = await upload(FIN_ID, { supplierName: "Acme", amount: "-5", currency: "USD", reference: `R-${STAMP}-1` }, { name: "a.pdf", type: "application/pdf", bytes: PDF_A });
      check("negative amount \u2192 400", badAmt.status === 400, `status=${badAmt.status}`);
    }

    // =====================================================================
    group("upload + dedupe");
    // =====================================================================
    let invId: string | null = null;
    {
      const ok = await upload(FIN_ID, {
        supplierName: `SI Cloud ${STAMP}`, amount: "1250.5", currency: "USD",
        reference: `SUP-A-${STAMP}`, periodLabel: "July 2026", notes: "hosting",
      }, { name: "supplier-a.pdf", type: "application/pdf", bytes: PDF_A });
      check("finance upload \u2192 201 submitted", ok.status === 201 && ok.body?.item?.status === "submitted", `status=${ok.status} ${JSON.stringify(ok.body)}`);
      check("unlinked supplier has no bank hold", ok.body?.item?.hasBankDetails === true, JSON.stringify(ok.body?.item));
      invId = ok.body?.item?.id ?? null;
      if (invId) createdInvoiceIds.push(invId);

      const dupFile = await upload(FIN_ID, {
        supplierName: "Different Name", amount: "999", currency: "USD", reference: `SUP-OTHER-${STAMP}`,
      }, { name: "same-bytes.pdf", type: "application/pdf", bytes: PDF_A });
      check("same file bytes \u2192 409 duplicate (file)", dupFile.status === 409 && dupFile.body?.matchedBy === "file", `status=${dupFile.status} ${JSON.stringify(dupFile.body)}`);

      const dupRef = await upload(FIN_ID, {
        supplierName: `si cloud ${STAMP}`, amount: "1250.5", currency: "USD", reference: `sup-a-${STAMP}`,
      }, { name: "supplier-a2.pdf", type: "application/pdf", bytes: PDF_B });
      check("same supplier+reference \u2192 409 duplicate (reference)", dupRef.status === 409 && dupRef.body?.matchedBy === "reference", `status=${dupRef.status} ${JSON.stringify(dupRef.body)}`);

      // Race safety: two simultaneous uploads of the same bytes must
      // yield exactly one 201 (the advisory-locked dedupe transaction
      // serializes them; the loser gets 409).
      const race = await Promise.all([0, 1].map((i) => upload(FIN_ID, {
        supplierName: `SI Race ${STAMP}`, amount: "42", currency: "USD", reference: `SUP-RACE-${STAMP}`,
      }, { name: `race-${i}.pdf`, type: "application/pdf", bytes: PDF_E })));
      const raceStatuses = race.map((r) => r.status).sort();
      check("parallel same-invoice uploads \u2192 one 201 + one 409", raceStatuses[0] === 201 && raceStatuses[1] === 409, JSON.stringify(raceStatuses));
      for (const r of race) if (r.body?.item?.id) createdInvoiceIds.push(r.body.item.id);

      const list = await call("GET", "/finance/payables/supplier-invoices", FP_ID);
      check("list contains exactly the one upload", (list.body?.items ?? []).filter((i: any) => i.id === invId).length === 1, JSON.stringify(list.body?.items?.map((i: any) => i.id)));
      const dl = await raw(`/finance/payables/supplier-invoices/${invId}/file`, FP_ID);
      check("PDF download \u2192 200 pdf", dl.status === 200 && (dl.headers.get("content-type") ?? "").includes("pdf"), `status=${dl.status}`);
    }

    // =====================================================================
    group("lifecycle: submitted \u2192 under_review \u2192 approved; reject rules");
    // =====================================================================
    {
      const start = await call("POST", `/finance/payables/supplier-invoices/${invId}/review`, FIN_ID, { decision: "start_review" });
      check("start_review \u2192 under_review", start.status === 200 && start.body?.invoice?.status === "under_review", `status=${start.status} ${JSON.stringify(start.body)}`);
      const approve = await call("POST", `/finance/payables/supplier-invoices/${invId}/review`, FP_ID, { decision: "approve" });
      check("approve \u2192 approved", approve.status === 200 && approve.body?.invoice?.status === "approved", `status=${approve.status} ${JSON.stringify(approve.body)}`);
      const again = await call("POST", `/finance/payables/supplier-invoices/${invId}/review`, FP_ID, { decision: "approve" });
      check("double-approve \u2192 409", again.status === 409, `status=${again.status}`);

      // Reject path on a second upload; rejected rows unblock re-upload.
      const two = await upload(FIN_ID, { supplierName: `SI Stationery ${STAMP}`, amount: "80", currency: "AED", reference: `SUP-B-${STAMP}` }, { name: "supplier-b.pdf", type: "application/pdf", bytes: PDF_B });
      const twoId = two.body?.item?.id;
      if (twoId) createdInvoiceIds.push(twoId);
      const rejNoReason = await call("POST", `/finance/payables/supplier-invoices/${twoId}/review`, FIN_ID, { decision: "reject" });
      check("reject without reason \u2192 400", rejNoReason.status === 400, `status=${rejNoReason.status}`);
      const rej = await call("POST", `/finance/payables/supplier-invoices/${twoId}/review`, FIN_ID, { decision: "reject", reason: "wrong month" });
      check("reject with reason \u2192 rejected", rej.status === 200 && rej.body?.invoice?.status === "rejected", `status=${rej.status}`);
      const reup = await upload(FIN_ID, { supplierName: `SI Stationery ${STAMP}`, amount: "80", currency: "AED", reference: `SUP-B-${STAMP}` }, { name: "supplier-b2.pdf", type: "application/pdf", bytes: PDF_C });
      check("re-upload after reject \u2192 201", reup.status === 201, `status=${reup.status} ${JSON.stringify(reup.body)}`);
      if (reup.body?.item?.id) createdInvoiceIds.push(reup.body.item.id);
      // Approve the re-upload so run build has 2 candidates later? Keep rejected-path clean: reject it too.
      await call("POST", `/finance/payables/supplier-invoices/${reup.body.item.id}/review`, FIN_ID, { decision: "reject", reason: "probe cleanup" });

      const auditRows = await db.select().from(atelierAuditEvents).where(and(
        eq(atelierAuditEvents.entityType, "partner_firm_invoice"),
        eq(atelierAuditEvents.entityId, invId!),
      ));
      const actions = auditRows.map((a: any) => a.action);
      check("audit trail written (upload/start/approve)",
        actions.includes("finance.supplier_invoice.upload") &&
        actions.includes("finance.supplier_invoice.start_review") &&
        actions.includes("finance.supplier_invoice.approve"),
        JSON.stringify(actions));
    }

    // =====================================================================
    group("bank-details hold for linked partner firms");
    // =====================================================================
    let heldId: string | null = null;
    {
      const linked = await upload(FP_ID, {
        supplierName: "ignored", partnerFirmId: firmNoBankId,
        amount: "300", currency: "USD", reference: `SUP-NB-${STAMP}`,
      }, { name: "supplier-nb.pdf", type: "application/pdf", bytes: PDF_D });
      check("upload linked to no-bank firm \u2192 201, hasBankDetails=false", linked.status === 201 && linked.body?.item?.hasBankDetails === false, `status=${linked.status} ${JSON.stringify(linked.body?.item)}`);
      heldId = linked.body?.item?.id ?? null;
      if (heldId) createdInvoiceIds.push(heldId);
      const app1 = await call("POST", `/finance/payables/supplier-invoices/${heldId}/review`, FP_ID, { decision: "approve" });
      check("approve blocked without firm IBAN \u2192 409", app1.status === 409 && app1.body?.error === "bank-details-missing", `status=${app1.status} ${JSON.stringify(app1.body)}`);
      const badFirm = await upload(FP_ID, { supplierName: "x", partnerFirmId: "pfrm_does_not_exist", amount: "5", currency: "USD", reference: `SUP-XX-${STAMP}` }, { name: "x.pdf", type: "application/pdf", bytes: PDF_E });
      check("unknown partnerFirmId \u2192 404", badFirm.status === 404, `status=${badFirm.status}`);
    }

    // =====================================================================
    group("payment-run eligibility");
    // =====================================================================
    {
      // Force the held invoice approved directly in DB to prove the run
      // build ALSO enforces the bank hold (defense-in-depth).
      await db.update(atelierPartnerFirmInvoices).set({ status: "approved" }).where(eq(atelierPartnerFirmInvoices.id, heldId!));

      const build = await call("POST", "/finance/payables/payment-runs/build", FP_ID, {
        bankAccountId: bankId, invoiceIds: [], expenseIds: [], partnerInvoiceIds: [invId, heldId],
      });
      check("build run \u2192 201", build.status === 201, `status=${build.status} ${JSON.stringify(build.body)}`);
      const runId1 = build.body?.run?.id;
      if (runId1) runIds.push(runId1);
      const itemRefs = (build.body?.run?.items ?? []).map((i: any) => i.refId);
      check("approved supplier invoice joins the run", itemRefs.includes(invId), JSON.stringify(itemRefs));
      check("no-bank linked invoice held back", !itemRefs.includes(heldId) && (build.body?.skippedMissingBank ?? []).includes(heldId), JSON.stringify(build.body?.skippedMissingBank));
      const [scheduled] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, invId!));
      check("invoice scheduled with run id", scheduled?.status === "scheduled" && scheduled?.paymentRunId === runId1, JSON.stringify({ s: scheduled?.status }));

      const cancel = await call("POST", `/finance/payables/payment-runs/${runId1}/cancel`, FP_ID, { reason: "probe" });
      check("cancel run \u2192 ok", cancel.status === 200, `status=${cancel.status}`);
      const [released] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, invId!));
      check("cancel releases invoice back to approved", released?.status === "approved" && !released?.paymentRunId, JSON.stringify({ s: released?.status }));

      // Race safety: two simultaneous builds over the same eligible
      // invoice must schedule it exactly once (advisory-locked build
      // transaction + conditional claim). The loser either builds a run
      // without the invoice (or 409s if nothing else was eligible).
      const [raceA, raceB] = await Promise.all([0, 1].map(() =>
        call("POST", "/finance/payables/payment-runs/build", FP_ID, {
          bankAccountId: bankId, invoiceIds: [], expenseIds: [], partnerInvoiceIds: [invId],
        })));
      for (const r of [raceA, raceB]) if (r.body?.run?.id) runIds.push(r.body.run.id);
      const claims = [raceA, raceB].flatMap((r) => (r.body?.run?.items ?? []).filter((i: any) => i.refId === invId));
      check("parallel run builds claim the invoice exactly once",
        claims.length === 1 && [raceA, raceB].filter((r) => r.status === 201).length >= 1,
        JSON.stringify({ statuses: [raceA.status, raceB.status], claims: claims.length }));
      const winnerRunId = [raceA, raceB].find((r) => (r.body?.run?.items ?? []).some((i: any) => i.refId === invId))?.body?.run?.id;
      const cancelRace = await call("POST", `/finance/payables/payment-runs/${winnerRunId}/cancel`, FP_ID, { reason: "probe race" });
      check("race winner run cancelled to release invoice", cancelRace.status === 200, `status=${cancelRace.status}`);
      // Cancel any empty loser run too so it doesn't linger.
      for (const r of [raceA, raceB]) {
        const id = r.body?.run?.id;
        if (id && id !== winnerRunId) await call("POST", `/finance/payables/payment-runs/${id}/cancel`, FP_ID, { reason: "probe race loser" });
      }

      const build2 = await call("POST", "/finance/payables/payment-runs/build", FP_ID, {
        bankAccountId: bankId, invoiceIds: [], expenseIds: [], partnerInvoiceIds: [invId],
      });
      const runId2 = build2.body?.run?.id;
      if (runId2) runIds.push(runId2);
      // Skip the dual-signature ceremony (covered by existing payables
      // probes): force approved and exercise the supplier pay path.
      await db.update(atelierPaymentRuns).set({ status: "approved" }).where(eq(atelierPaymentRuns.id, runId2));
      const paid = await call("POST", `/finance/payables/payment-runs/${runId2}/mark-paid`, FP_ID, { remittanceRef: `RMT-SI-${STAMP}` });
      check("mark-paid \u2192 ok", paid.status === 200, `status=${paid.status} ${JSON.stringify(paid.body)}`);
      const [afterPaid] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, invId!));
      check("supplier invoice paid with remittance ref", afterPaid?.status === "paid" && afterPaid?.remittanceRef === `RMT-SI-${STAMP}`, JSON.stringify({ s: afterPaid?.status, r: afterPaid?.remittanceRef }));
    }
  } finally {
    try {
      if (runIds.length) {
        await db.delete(atelierPaymentRunItems).where(inArray(atelierPaymentRunItems.runId, runIds));
        await db.delete(atelierPaymentRuns).where(inArray(atelierPaymentRuns.id, runIds));
      }
      if (createdInvoiceIds.length) {
        await db.delete(atelierPartnerFirmInvoices).where(inArray(atelierPartnerFirmInvoices.id, createdInvoiceIds));
      }
      await db.delete(atelierPartnerFirmInvoices).where(like(atelierPartnerFirmInvoices.reference, `SUP-%-${STAMP}`));
      await db.delete(atelierBankAccount).where(eq(atelierBankAccount.id, bankId));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, [firmNoBankId, firmBankId]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FP_ID, FIN_ID, CONS_ID, HR_ID, EMP_ID, AP_ID]));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
    await pool?.end?.().catch(() => {});
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 supplier-invoice probes passed"
      : `\n\u2717 ${failures.length} failure(s): ${failures.join("; ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
