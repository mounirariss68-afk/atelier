/**
 * Task #430 — Self-billing (RCTI) + payment runs regression probe.
 *
 * Runs standalone (tsx ./tests/self-billing/run.ts) booting the app
 * in-process via app.listen(0) on an isolated scratch DB; NODE_ENV=test
 * enables the persona-cookie bypass so requests act as ephemeral
 * p_test_* personas. All rows created here are removed in `finally`.
 *
 * Coverage:
 *   1. Clerk idempotency: run creates one invoice per supplier/week from
 *      lead-approved timesheet hours; rerun refreshes/skips, never
 *      duplicates; approved invoices are never touched by reruns.
 *   2. Dispute exclusion: a disputed invoice never enters a payment-run
 *      build; approved invoices do (status → scheduled).
 *   3. Dual signature: view-only signatory 403; non-signatory 403;
 *      same user twice 409; over-limit 403; two distinct active
 *      signatories → approved; mark-paid cascades remittance to the
 *      invoice.
 *   4. Self-scope ACL: contractor sees only own invoices (rejected
 *      hidden); foreign persona list empty + detail/pdf 404; owner PDF
 *      download 200 application/pdf; employee persona cannot touch
 *      finance payables surfaces (403).
 *   5. Partner-firm path (Task #458): clerk composes an RCTI from
 *      uploaded partner-firm hours, reconciled against the
 *      atelier_partner_firm_invoices proposal row; the firm's resource
 *      (scope via atelier_partner_firm_resources email) sees it at
 *      /me/self-billing while foreign personas get empty list / 404;
 *      mark-paid cascades `paid` to the partner-firm invoice rows.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FIN_ID = `p_test_fin_${STAMP}`;       // finance — maker + signatory A
const PT_ID = `p_test_pt_${STAMP}`;         // partner — signatory B
const PT2_ID = `p_test_pt2_${STAMP}`;       // partner — view_only signatory
const PT3_ID = `p_test_pt3_${STAMP}`;       // partner — limited signatory
const CT_USER = `p_test_ct_${STAMP}`;       // contractor persona (invoice owner)
const CT2_USER = `p_test_ct2_${STAMP}`;     // second contractor persona
const EMP_ID = `p_test_emp_${STAMP}`;       // employee — must not reach finance surfaces
const PFR_ID = `p_test_pfr_${STAMP}`;       // partner-firm resource (invoice viewer)
const PFR2_ID = `p_test_pfr2_${STAMP}`;     // resource of ANOTHER firm (foreign)
const PF_ID = `pf_sbi_${STAMP}`;            // partner firm (supplier)
const PF2_ID = `pf2_sbi_${STAMP}`;          // second firm (never invoiced)
const PFR_ROW = `pfr_sbi_${STAMP}`;
const PFR2_ROW = `pfr2_sbi_${STAMP}`;
const PFH_ID = `pfh_sbi_${STAMP}`;
const PFI_ID = `pfi_sbi_${STAMP}`;
const CT_PERSON = `ct_sbi_${STAMP}`;
const CT2_PERSON = `ct2_sbi_${STAMP}`;
const ENG_ID = `eng_sbi_${STAMP}`;
const WEEK_ID = `tsw_sbi_${STAMP}`;
const WEEK2_ID = `tsw2_sbi_${STAMP}`;
const BANK_ID = `bank_sbi_${STAMP}`;

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

function isoWeekOf(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

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
    atelierContractors,
    atelierEngagements,
    atelierTimesheetWeeks,
    atelierTimesheetEntries,
    atelierSelfBilledInvoices,
    atelierSelfBillingSequences,
    atelierPaymentRuns,
    atelierPaymentRunItems,
    atelierBankAccount,
    atelierBankSignatories,
    atelierAuditEvents,
    atelierAgentRuns,
    atelierPartnerFirms,
    atelierPartnerFirmResources,
    atelierPartnerFirmHours,
    atelierPartnerFirmInvoices,
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

  const weekIso = isoWeekOf(new Date()); // clerk scans last 4 weeks; current week is in scope
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() || 7) - 1));
  const mondayStr = monday.toISOString().slice(0, 10);

  const createdInvoiceIds: string[] = [];
  const createdRunIds: string[] = [];

  try {
    // --- ephemeral personas + fixture rows ---
    const personas = [
      { id: FIN_ID, role: "finance", label: "Finance", name: "Test Finance" },
      { id: PT_ID, role: "partner", label: "Partner", name: "Signer Partner" },
      { id: PT2_ID, role: "partner", label: "Partner", name: "ViewOnly Partner" },
      { id: PT3_ID, role: "partner", label: "Partner", name: "Limited Partner" },
      { id: CT_USER, role: "contractor", label: "Contractor", name: "SBI Contractor" },
      { id: CT2_USER, role: "contractor", label: "Contractor", name: "Other Contractor" },
      { id: EMP_ID, role: "employee", label: "Employee", name: "Plain Employee" },
      { id: PFR_ID, role: "partner_firm_resource", label: "Partner Firm Resource", name: "Firm Resource" },
      { id: PFR2_ID, role: "partner_firm_resource", label: "Partner Firm Resource", name: "Other Firm Resource" },
    ];
    for (const p of personas) {
      await db.insert(atelierUsers).values({
        id: p.id, orgId: ORG, email: `${p.id}@cognirise.ai`, name: p.name,
        initials: "TT", role: p.role, roleLabel: p.label, title: p.name,
        permissions: [], bdActive: false,
      }).onConflictDoNothing();
    }
    await db.insert(atelierContractors).values({
      id: CT_PERSON, orgId: ORG, fullName: "SBI Contractor",
      email: `${CT_USER}@cognirise.ai`, dayRateAmount: 800, dayRateCurrency: "USD",
    });
    await db.insert(atelierContractors).values({
      id: CT2_PERSON, orgId: ORG, fullName: "Other Contractor",
      email: `${CT2_USER}@cognirise.ai`, dayRateAmount: 640, dayRateCurrency: "USD",
    });
    // No engagement row needed: the clerk only resolves engagement names
    // from the table; unknown ids simply render without a display name.
    // Lead-approved contractor week: 2 billable days (16h) on one engagement.
    await db.insert(atelierTimesheetWeeks).values({
      id: WEEK_ID, orgId: ORG, personId: CT_PERSON, personType: "contractor",
      weekIso, weekStartDate: mondayStr, status: "lead_approved",
      totalHours: 16, billableHours: 16,
    });
    for (let i = 0; i < 2; i++) {
      await db.insert(atelierTimesheetEntries).values({
        id: `tse_sbi_${STAMP}_${i}`, orgId: ORG, weekId: WEEK_ID,
        personId: CT_PERSON, personType: "contractor",
        workDate: mondayStr, engagementId: ENG_ID, activityCode: "billable",
        hours: 8, billable: true, status: "approved",
      });
    }
    // Second contractor: week for the dispute-exclusion scenario.
    await db.insert(atelierTimesheetWeeks).values({
      id: WEEK2_ID, orgId: ORG, personId: CT2_PERSON, personType: "contractor",
      weekIso, weekStartDate: mondayStr, status: "lead_approved",
      totalHours: 8, billableHours: 8,
    });
    await db.insert(atelierTimesheetEntries).values({
      id: `tse2_sbi_${STAMP}`, orgId: ORG, weekId: WEEK2_ID,
      personId: CT2_PERSON, personType: "contractor",
      workDate: mondayStr, engagementId: ENG_ID, activityCode: "billable",
      hours: 8, billable: true, status: "approved",
    });
    // Bank account + signatory register.
    await db.insert(atelierBankAccount).values({
      id: BANK_ID, orgId: ORG, bankName: "Test Bank", accountLabel: "Ops",
      accountNumberLast4: "9999", currency: "USD", isActive: true,
    });
    const sigRows = [
      { id: `bs_a_${STAMP}`, userId: FIN_ID, name: "Test Finance", authority: "joint", limit: null },
      { id: `bs_b_${STAMP}`, userId: PT_ID, name: "Signer Partner", authority: "joint", limit: null },
      { id: `bs_v_${STAMP}`, userId: PT2_ID, name: "ViewOnly Partner", authority: "view_only", limit: null },
      { id: `bs_l_${STAMP}`, userId: PT3_ID, name: "Limited Partner", authority: "joint", limit: 10 },
    ];
    for (const s of sigRows) {
      await db.insert(atelierBankSignatories).values({
        id: s.id, orgId: ORG, bankAccountId: BANK_ID, userId: s.userId,
        personName: s.name, authority: s.authority,
        monetaryLimitAmount: s.limit, limitCurrency: s.limit != null ? "USD" : null,
      });
    }

    // =====================================================================
    group("clerk \u00b7 generation + idempotency");
    // =====================================================================
    const empRun = await call("POST", "/finance/payables/self-billing/run", EMP_ID, {});
    check("employee cannot trigger clerk \u2192 403", empRun.status === 403, `status=${empRun.status}`);

    const run1 = await call("POST", "/finance/payables/self-billing/run", FIN_ID, { weeksIso: [weekIso] });
    check(
      "clerk run \u2192 200 with 2 invoices created",
      run1.status === 200 && run1.body?.summary?.invoicesCreated === 2,
      `status=${run1.status} body=${JSON.stringify(run1.body)?.slice(0, 300)}`,
    );

    const list1 = await call("GET", "/finance/payables/self-billing", FIN_ID);
    const mine = (list1.body?.items ?? []).filter((i: any) =>
      [CT_PERSON, CT2_PERSON].includes(i.supplierId ?? "") ||
      [`SBI Contractor`, `Other Contractor`].includes(i.supplierName),
    );
    check("both invoices listed as drafts", mine.length === 2 && mine.every((i: any) => i.status === "draft"),
      JSON.stringify(mine.map((i: any) => [i.supplierName, i.status])));
    const inv1 = mine.find((i: any) => i.supplierName === "SBI Contractor");
    const inv2 = mine.find((i: any) => i.supplierName === "Other Contractor");
    if (inv1) createdInvoiceIds.push(inv1.id);
    if (inv2) createdInvoiceIds.push(inv2.id);
    check(
      "amounts snapshot day rate / 8 (16h \u00d7 $100/h = $1600)",
      inv1?.subtotalAmount === 1600 && inv1?.totalAmount === 1600,
      `subtotal=${inv1?.subtotalAmount} total=${inv1?.totalAmount}`,
    );

    const run2 = await call("POST", "/finance/payables/self-billing/run", FIN_ID, { weeksIso: [weekIso] });
    const s2 = run2.body?.summary;
    check(
      "rerun creates nothing new (idempotent)",
      run2.status === 200 && s2?.invoicesCreated === 0 && (s2?.invoicesUpdated ?? 0) + (s2?.invoicesSkipped ?? 0) === 2,
      JSON.stringify(s2),
    );
    const list2 = await call("GET", "/finance/payables/self-billing", FIN_ID);
    const mine2 = (list2.body?.items ?? []).filter((i: any) => createdInvoiceIds.includes(i.id));
    check("rerun keeps the same invoice ids (no duplicates)", mine2.length === 2, `count=${mine2.length}`);

    // Approve inv1 then rerun — approved invoices must never be touched.
    const ap = await call("POST", `/finance/payables/self-billing/${inv1.id}/approve`, FIN_ID, {});
    check("approve draft \u2192 200 approved", ap.status === 200, `status=${ap.status}`);
    const run3 = await call("POST", "/finance/payables/self-billing/run", FIN_ID, { weeksIso: [weekIso] });
    const afterRun3 = await call("GET", "/finance/payables/self-billing", FIN_ID);
    const inv1After = (afterRun3.body?.items ?? []).find((i: any) => i.id === inv1.id);
    check(
      "rerun never touches an approved invoice",
      run3.status === 200 && inv1After?.status === "approved",
      `status=${inv1After?.status}`,
    );

    // =====================================================================
    group("dispute \u00b7 me-lens scope + exclusion from builds");
    // =====================================================================
    const ctList = await call("GET", "/me/self-billing", CT_USER);
    check(
      "contractor sees only own invoice",
      ctList.status === 200 && (ctList.body?.items ?? []).length === 1 &&
        ctList.body.items[0].id === inv1.id,
      JSON.stringify(ctList.body?.items?.map((i: any) => i.id)),
    );
    const foreignDetail = await call("GET", `/me/self-billing/${inv1.id}`, CT2_USER);
    check("foreign contractor detail \u2192 404", foreignDetail.status === 404, `status=${foreignDetail.status}`);
    const foreignPdf = await fetch(`${API}/me/self-billing/${inv1.id}/pdf`, {
      headers: { cookie: `atelier_persona=${CT2_USER}` },
    });
    check("foreign contractor pdf \u2192 404", foreignPdf.status === 404, `status=${foreignPdf.status}`);
    const ownPdf = await fetch(`${API}/me/self-billing/${inv1.id}/pdf`, {
      headers: { cookie: `atelier_persona=${CT_USER}` },
    });
    const pdfBytes = Buffer.from(await ownPdf.arrayBuffer());
    check(
      "owner pdf \u2192 200 application/pdf with %PDF magic",
      ownPdf.status === 200 &&
        (ownPdf.headers.get("content-type") ?? "").includes("application/pdf") &&
        pdfBytes.subarray(0, 4).toString() === "%PDF",
      `status=${ownPdf.status} ct=${ownPdf.headers.get("content-type")}`,
    );
    const empFin = await call("GET", "/finance/payables/self-billing", EMP_ID);
    check(
      "employee blocked from finance payables list",
      empFin.status === 403 || empFin.status === 401,
      `status=${empFin.status}`,
    );

    // CT2 disputes their own draft.
    const noReason = await call("POST", `/me/self-billing/${inv2.id}/dispute`, CT2_USER, {});
    check("dispute without reason \u2192 400", noReason.status === 400, `status=${noReason.status}`);
    const disp = await call("POST", `/me/self-billing/${inv2.id}/dispute`, CT2_USER, { reason: "Hours overstated" });
    check("own dispute \u2192 200", disp.status === 200, `status=${disp.status}`);
    const dispAgain = await call("POST", `/me/self-billing/${inv2.id}/dispute`, CT2_USER, { reason: "again" });
    check("double dispute \u2192 409", dispAgain.status === 409, `status=${dispAgain.status}`);

    // Rerun clerk: disputed invoices are never refreshed back to draft.
    await call("POST", "/finance/payables/self-billing/run", FIN_ID, { weeksIso: [weekIso] });
    const afterDispRun = await call("GET", "/finance/payables/self-billing", FIN_ID);
    const inv2After = (afterDispRun.body?.items ?? []).find((i: any) => i.id === inv2.id);
    check("rerun never touches a disputed invoice", inv2After?.status === "disputed", `status=${inv2After?.status}`);

    // Build a run: only the APPROVED invoice may enter; disputed excluded.
    const build = await call("POST", "/finance/payables/payment-runs/build", FIN_ID, {
      bankAccountId: BANK_ID, invoiceIds: [inv1.id, inv2.id],
    });
    check(
      "build \u2192 201 with exactly the approved invoice (disputed excluded)",
      build.status === 201 && build.body?.run?.itemCount === 1,
      `status=${build.status} itemCount=${build.body?.run?.itemCount}`,
    );
    const runId: string = build.body?.run?.id;
    if (runId) createdRunIds.push(runId);
    const invSched = await call("GET", "/finance/payables/self-billing", FIN_ID);
    const inv1Sched = (invSched.body?.items ?? []).find((i: any) => i.id === inv1.id);
    check("approved invoice \u2192 scheduled + linked to run", inv1Sched?.status === "scheduled" && inv1Sched?.paymentRunId === runId,
      `status=${inv1Sched?.status} run=${inv1Sched?.paymentRunId}`);

    // A scheduled invoice in a live run cannot be disputed.
    const dispSched = await call("POST", `/me/self-billing/${inv1.id}/dispute`, CT_USER, { reason: "too late" });
    check("dispute while in live run \u2192 409", dispSched.status === 409, `status=${dispSched.status}`);

    // Second build finds nothing eligible.
    const build2 = await call("POST", "/finance/payables/payment-runs/build", FIN_ID, { bankAccountId: BANK_ID });
    check("second build with nothing eligible \u2192 409", build2.status === 409, `status=${build2.status}`);

    // =====================================================================
    group("dual signature \u00b7 authority + distinct users");
    // =====================================================================
    const viewSign = await call("POST", `/finance/payables/payment-runs/${runId}/sign`, PT2_ID, {});
    check("view_only signatory \u2192 403", viewSign.status === 403, `status=${viewSign.status}`);
    const limitSign = await call("POST", `/finance/payables/payment-runs/${runId}/sign`, PT3_ID, {});
    check("over-monetary-limit signatory \u2192 403", limitSign.status === 403, `status=${limitSign.status}`);
    const emptySign = await call("POST", `/finance/payables/payment-runs/${runId}/sign`, EMP_ID, {});
    check("employee (not leader) sign \u2192 403", emptySign.status === 403, `status=${emptySign.status}`);

    const sign1 = await call("POST", `/finance/payables/payment-runs/${runId}/sign`, FIN_ID, {});
    check("first signature \u2192 1/2, not yet approved", sign1.status === 200 && sign1.body?.approved === false,
      JSON.stringify(sign1.body));
    const markEarly = await call("POST", `/finance/payables/payment-runs/${runId}/mark-paid`, FIN_ID, {});
    check("mark-paid with one signature \u2192 409", markEarly.status === 409, `status=${markEarly.status}`);
    const signDup = await call("POST", `/finance/payables/payment-runs/${runId}/sign`, FIN_ID, {});
    check("same user signing twice \u2192 409", signDup.status === 409, `status=${signDup.status}`);
    const sign2 = await call("POST", `/finance/payables/payment-runs/${runId}/sign`, PT_ID, {});
    check("second distinct signature \u2192 approved", sign2.status === 200 && sign2.body?.approved === true,
      JSON.stringify(sign2.body));

    // Export bank file.
    const exp = await fetch(`${API}/finance/payables/payment-runs/${runId}/export`, {
      method: "POST", headers: { cookie: `atelier_persona=${FIN_ID}` },
    });
    const csv = await exp.text();
    check(
      "export \u2192 CSV containing the invoice line",
      exp.status === 200 && csv.includes("self_billed_invoice") && csv.includes("SBI Contractor"),
      `status=${exp.status}`,
    );

    // Mark paid: remittance cascades to the invoice; me-lens sees it.
    const paid = await call("POST", `/finance/payables/payment-runs/${runId}/mark-paid`, FIN_ID, { remittanceRef: `RMT-${STAMP}` });
    check("mark-paid \u2192 200", paid.status === 200 && paid.body?.itemsPaid === 1, JSON.stringify(paid.body));
    const finalMe = await call("GET", `/me/self-billing/${inv1.id}`, CT_USER);
    check(
      "invoice paid with remittance ref visible to the contractor",
      finalMe.status === 200 && finalMe.body?.invoice?.status === "paid" &&
        finalMe.body?.invoice?.remittanceRef === `RMT-${STAMP}`,
      JSON.stringify(finalMe.body?.invoice ?? {}).slice(0, 200),
    );
    const dispPaid = await call("POST", `/me/self-billing/${inv1.id}/dispute`, CT_USER, { reason: "post-hoc" });
    check("dispute after paid \u2192 409", dispPaid.status === 409, `status=${dispPaid.status}`);

    // Rejected invoices are hidden from the counterparty.
    const rej = await call("POST", `/finance/payables/self-billing/${inv2.id}/resolve-dispute`, FIN_ID, { note: "resolved for test" });
    check("resolve dispute \u2192 200 (back to draft)", rej.status === 200, `status=${rej.status}`);
    const rej2 = await call("POST", `/finance/payables/self-billing/${inv2.id}/reject`, FIN_ID, { reason: "test reject" });
    check("reject draft \u2192 200", rej2.status === 200, `status=${rej2.status}`);
    const ct2List = await call("GET", "/me/self-billing", CT2_USER);
    check(
      "rejected invoice hidden from counterparty",
      ct2List.status === 200 && (ct2List.body?.items ?? []).every((i: any) => i.id !== inv2.id),
      JSON.stringify(ct2List.body?.items?.map((i: any) => [i.id, i.status])),
    );

    // =====================================================================
    group("partner firm \u00b7 clerk generation + me-lens scope + paid cascade");
    // =====================================================================
    // Fixtures seeded only NOW so the earlier full clerk reruns never saw
    // them (keeps the contractor-path idempotency counts untouched).
    await db.insert(atelierPartnerFirms).values({
      id: PF_ID, orgId: ORG, name: "SBI Partner Firm",
      contactEmail: `firm_${STAMP}@example.com`, defaultBillingCurrency: "USD",
    });
    await db.insert(atelierPartnerFirms).values({
      id: PF2_ID, orgId: ORG, name: "Other Partner Firm",
    });
    // Me-lens scope resolves via the RESOURCE email == persona email.
    await db.insert(atelierPartnerFirmResources).values({
      id: PFR_ROW, orgId: ORG, partnerFirmId: PF_ID,
      fullName: "Firm Resource", email: `${PFR_ID}@cognirise.ai`,
    });
    await db.insert(atelierPartnerFirmResources).values({
      id: PFR2_ROW, orgId: ORG, partnerFirmId: PF2_ID,
      fullName: "Other Firm Resource", email: `${PFR2_ID}@cognirise.ai`,
    });
    // Uploaded firm hours: 16h costing $2,400 on one engagement.
    await db.insert(atelierPartnerFirmHours).values({
      id: PFH_ID, orgId: ORG, engagementId: ENG_ID, partnerFirmId: PF_ID,
      partnerFirmResourceId: PFR_ROW, resourceName: "Firm Resource",
      weekIso, hours: 16, costAmount: 2400, costCurrency: "USD",
    });
    // Matching payment-proposal row the invoice must reconcile against
    // and that mark-paid must cascade `paid` onto.
    await db.insert(atelierPartnerFirmInvoices).values({
      id: PFI_ID, orgId: ORG, partnerFirmId: PF_ID,
      partnerFirmName: "SBI Partner Firm", engagementId: ENG_ID,
      weekIso, hours: 16, costAmount: 2400, costCurrency: "USD",
      fxRate: 1, usdAmount: 2400, status: "partner_approved",
      evidenceFirmHourIds: [PFH_ID],
    });

    const pfRun = await call("POST", "/finance/payables/self-billing/run", FIN_ID, {
      weeksIso: [weekIso], supplierType: "partner_firm",
    });
    check(
      "partner_firm clerk run \u2192 200 with 1 invoice created",
      pfRun.status === 200 && pfRun.body?.summary?.invoicesCreated === 1,
      `status=${pfRun.status} body=${JSON.stringify(pfRun.body)?.slice(0, 300)}`,
    );
    const pfList = await call("GET", "/finance/payables/self-billing", FIN_ID);
    const pfInv = (pfList.body?.items ?? []).find(
      (i: any) => i.supplierType === "partner_firm" && i.supplierId === PF_ID,
    );
    if (pfInv) createdInvoiceIds.push(pfInv.id);
    check(
      "firm invoice drafted with cost-amount totals ($2,400) + firm name",
      pfInv?.status === "draft" && pfInv?.subtotalAmount === 2400 &&
        pfInv?.totalAmount === 2400 && pfInv?.supplierName === "SBI Partner Firm",
      JSON.stringify(pfInv ?? {}).slice(0, 300),
    );
    const [pfInvRow] = pfInv
      ? await db.select().from(atelierSelfBilledInvoices).where(eq(atelierSelfBilledInvoices.id, pfInv.id))
      : [null];
    check(
      "invoice reconciled + linked to the partner-firm proposal row",
      (pfInvRow?.partnerFirmInvoiceIds ?? []).includes(PFI_ID) &&
        pfInvRow?.reconciliation?.status === "matched",
      `ids=${JSON.stringify(pfInvRow?.partnerFirmInvoiceIds)} recon=${pfInvRow?.reconciliation?.status}`,
    );

    // Idempotency holds for the partner-firm path too.
    const pfRun2 = await call("POST", "/finance/payables/self-billing/run", FIN_ID, {
      weeksIso: [weekIso], supplierType: "partner_firm",
    });
    const pfS2 = pfRun2.body?.summary;
    check(
      "partner_firm rerun creates nothing new (refresh only)",
      pfRun2.status === 200 && pfS2?.invoicesCreated === 0 && (pfS2?.invoicesUpdated ?? 0) === 1,
      JSON.stringify(pfS2),
    );

    // Me-lens: the firm's resource sees it; foreign personas do not.
    const pfrList = await call("GET", "/me/self-billing", PFR_ID);
    check(
      "firm resource sees exactly the firm's invoice at /me/self-billing",
      pfrList.status === 200 && (pfrList.body?.items ?? []).length === 1 &&
        pfrList.body.items[0].id === pfInv?.id &&
        pfrList.body.items[0].supplierType === "partner_firm",
      JSON.stringify(pfrList.body?.items?.map((i: any) => [i.id, i.supplierType])),
    );
    const pfr2List = await call("GET", "/me/self-billing", PFR2_ID);
    check(
      "resource of another firm gets an empty list",
      pfr2List.status === 200 && (pfr2List.body?.items ?? []).length === 0,
      JSON.stringify(pfr2List.body?.items),
    );
    const pfr2Detail = await call("GET", `/me/self-billing/${pfInv?.id}`, PFR2_ID);
    check("foreign firm resource detail \u2192 404", pfr2Detail.status === 404, `status=${pfr2Detail.status}`);
    const ctForeign = await call("GET", `/me/self-billing/${pfInv?.id}`, CT_USER);
    check("contractor cannot read the firm invoice \u2192 404", ctForeign.status === 404, `status=${ctForeign.status}`);
    const pfrForeignPdf = await fetch(`${API}/me/self-billing/${pfInv?.id}/pdf`, {
      headers: { cookie: `atelier_persona=${PFR2_ID}` },
    });
    check("foreign firm resource pdf \u2192 404", pfrForeignPdf.status === 404, `status=${pfrForeignPdf.status}`);
    const pfrPdf = await fetch(`${API}/me/self-billing/${pfInv?.id}/pdf`, {
      headers: { cookie: `atelier_persona=${PFR_ID}` },
    });
    const pfrPdfBytes = Buffer.from(await pfrPdf.arrayBuffer());
    check(
      "firm resource pdf \u2192 200 application/pdf with %PDF magic",
      pfrPdf.status === 200 &&
        (pfrPdf.headers.get("content-type") ?? "").includes("application/pdf") &&
        pfrPdfBytes.subarray(0, 4).toString() === "%PDF",
      `status=${pfrPdf.status} ct=${pfrPdf.headers.get("content-type")}`,
    );

    // Approve → build → dual-sign → mark-paid; status must cascade to
    // the atelier_partner_firm_invoices proposal row.
    const pfAp = await call("POST", `/finance/payables/self-billing/${pfInv?.id}/approve`, FIN_ID, {});
    check("approve firm invoice \u2192 200", pfAp.status === 200, `status=${pfAp.status}`);
    const pfBuild = await call("POST", "/finance/payables/payment-runs/build", FIN_ID, {
      bankAccountId: BANK_ID, invoiceIds: [pfInv?.id],
    });
    check(
      "build run with the firm invoice \u2192 201, 1 item",
      pfBuild.status === 201 && pfBuild.body?.run?.itemCount === 1,
      `status=${pfBuild.status} itemCount=${pfBuild.body?.run?.itemCount}`,
    );
    const pfRunId: string = pfBuild.body?.run?.id;
    if (pfRunId) createdRunIds.push(pfRunId);
    const pfSign1 = await call("POST", `/finance/payables/payment-runs/${pfRunId}/sign`, FIN_ID, {});
    const pfSign2 = await call("POST", `/finance/payables/payment-runs/${pfRunId}/sign`, PT_ID, {});
    check(
      "dual signature on the firm run \u2192 approved",
      pfSign1.status === 200 && pfSign2.status === 200 && pfSign2.body?.approved === true,
      `s1=${pfSign1.status} s2=${pfSign2.status} approved=${pfSign2.body?.approved}`,
    );
    const pfPaid = await call("POST", `/finance/payables/payment-runs/${pfRunId}/mark-paid`, FIN_ID, {
      remittanceRef: `RMT-PF-${STAMP}`,
    });
    check("mark-paid firm run \u2192 200", pfPaid.status === 200 && pfPaid.body?.itemsPaid === 1, JSON.stringify(pfPaid.body));
    const pfrFinal = await call("GET", `/me/self-billing/${pfInv?.id}`, PFR_ID);
    check(
      "firm resource sees paid invoice with remittance ref",
      pfrFinal.status === 200 && pfrFinal.body?.invoice?.status === "paid" &&
        pfrFinal.body?.invoice?.remittanceRef === `RMT-PF-${STAMP}`,
      JSON.stringify(pfrFinal.body?.invoice ?? {}).slice(0, 200),
    );
    const [pfiRow] = await db.select().from(atelierPartnerFirmInvoices)
      .where(eq(atelierPartnerFirmInvoices.id, PFI_ID));
    check(
      "mark-paid cascades `paid` to the partner-firm invoice row",
      pfiRow?.status === "paid" && pfiRow?.paidAt != null && pfiRow?.paidByUserId === FIN_ID,
      `status=${pfiRow?.status} paidBy=${pfiRow?.paidByUserId}`,
    );
  } finally {
    try {
      await db.delete(atelierPaymentRunItems).where(
        createdRunIds.length ? inArray(atelierPaymentRunItems.runId, createdRunIds) : eq(atelierPaymentRunItems.id, "none"));
      await db.delete(atelierPaymentRuns).where(
        createdRunIds.length ? inArray(atelierPaymentRuns.id, createdRunIds) : eq(atelierPaymentRuns.id, "none"));
      await db.delete(atelierSelfBilledInvoices).where(
        inArray(atelierSelfBilledInvoices.supplierId, [CT_PERSON, CT2_PERSON, PF_ID]));
      await db.delete(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, PFI_ID));
      await db.delete(atelierPartnerFirmHours).where(eq(atelierPartnerFirmHours.id, PFH_ID));
      await db.delete(atelierPartnerFirmResources).where(inArray(atelierPartnerFirmResources.id, [PFR_ROW, PFR2_ROW]));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, [PF_ID, PF2_ID]));
      await db.delete(atelierBankSignatories).where(eq(atelierBankSignatories.bankAccountId, BANK_ID));
      await db.delete(atelierBankAccount).where(eq(atelierBankAccount.id, BANK_ID));
      await db.delete(atelierTimesheetEntries).where(inArray(atelierTimesheetEntries.weekId, [WEEK_ID, WEEK2_ID]));
      await db.delete(atelierTimesheetWeeks).where(inArray(atelierTimesheetWeeks.id, [WEEK_ID, WEEK2_ID]));
      await db.delete(atelierContractors).where(inArray(atelierContractors.id, [CT_PERSON, CT2_PERSON]));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityType, ["self_billed_invoice", "payment_run"]));
      await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.agentId, "ag_self_billing_clerk"));
      await db.delete(atelierSelfBillingSequences).where(like(atelierSelfBillingSequences.id, "%:aico"));
      for (const id of [FIN_ID, PT_ID, PT2_ID, PT3_ID, CT_USER, CT2_USER, EMP_ID, PFR_ID, PFR2_ID]) {
        await db.delete(atelierUsers).where(eq(atelierUsers.id, id));
      }
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 self-billing probe: all checks passed"
      : `\n\u2717 self-billing probe: ${failures.length} failed:\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
