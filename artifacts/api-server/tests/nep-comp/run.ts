/**
 * Task #1298 — Non-salaried NEP compensation probe.
 *
 * Standalone (tsx ./tests/nep-comp/run.ts) on the isolated scratch DB;
 * NODE_ENV=test enables the persona-cookie bypass. All fixture rows are
 * ephemeral (p_test_* / *_STAMP) and removed in `finally`.
 *
 * Coverage:
 *   1. Pure math: tier selection (sale vs origination-only vs none),
 *      24-month window boundary, worked example ($500k fees, $300k costs
 *      → $200k Project Profit → $40k @20% / $20k @10%).
 *   2. Plan lifecycle: founder creates plan (day rate syncs to the
 *      contractor roster row), duplicate effective date 409, comp
 *      visibility (HR read 200, partner read 403, employee 403), writes
 *      finance/founder-only.
 *   3. Entitlement recompute: material-contribution engagement gets the
 *      sale tier with own time charges deducted as a direct cost;
 *      origination-only engagement inside the window gets 10%; an
 *      engagement signed after the window gets tier none.
 *   4. Collection gating: entitlement stays `accruing` until fees are
 *      fully collected AND client acceptance recorded; then payable with
 *      a due date 30 days after the later event; approve is 409 before.
 *   5. Payables integration: approved entitlement enters a payment-run
 *      build as itemType nep_margin_share; mark-paid cascades paid +
 *      remittanceRef; recompute never touches paid rows (idempotent).
 *   6. Conversion tracker: rolling 12-month attributable revenue and
 *      realised margin vs thresholds.
 *   7. /me/nep-comp: NEP sees own plan/entitlements; a foreign contractor
 *      gets hasPlan:false.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, inArray, like, sql } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FP_ID = `p_test_fp_${STAMP}`;     // founding partner — maker
const FIN_ID = `p_test_fin_${STAMP}`;   // finance
const HR_ID = `p_test_hr_${STAMP}`;     // hr — comp read-only
const PT_ID = `p_test_pt_${STAMP}`;     // partner — must NOT read comp
const EMP_ID = `p_test_emp_${STAMP}`;   // employee — must be clamped
const NEP_ID = `p_test_nep_${STAMP}`;   // the NEP login
const CT2_ID = `p_test_ct2_${STAMP}`;   // foreign contractor login
const CT_PERSON = `ct_nep_${STAMP}`;
const CT_CANONICAL = `person_nep_${STAMP}`;
const GOV_CONTRACT = `contract_nep_${STAMP}`;
const GOV_DOC = `cdoc_nep_${STAMP}`;
const CT2_PERSON = `ct2_nep_${STAMP}`;
const ACC_ID = `acc_nep_${STAMP}`;
const ENG_SALE = `eng_sale_${STAMP}`;      // material contribution → 20%
const ENG_ORIG = `eng_orig_${STAMP}`;      // origination-only, in window → 10%
const ENG_LATE = `eng_late_${STAMP}`;      // origination-only, window lapsed → none
const ENG_PRE = `eng_pre_${STAMP}`;        // starts before the first plan → no entitlement
const INV_SALE = `inv_sale_${STAMP}`;
const INV_ORIG = `inv_orig_${STAMP}`;
const BANK_ID = `bank_nep_${STAMP}`;

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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db, pool,
    atelierUsers, atelierContractors, atelierAccounts, atelierEngagements,
     atelierPersons, atelierContractRecords, atelierContractDocuments,
     atelierPersonRelationshipClassifications,
    atelierInvoice, atelierContractorPayments,
    atelierNepCompPlans, atelierNepEntitlements,
    atelierPaymentRuns, atelierPaymentRunItems, atelierBankAccount,
    atelierBankSignatories, atelierAuditEvents,
    atelierTimesheetWeeks, atelierTimesheetEntries,
  } = D as any;

  // 1 — pure math, no server needed.
  const M = await import("../../src/lib/atelier-nep-comp.js");
  group("Pure math: tiers, window, worked example");
  {
    const base = {
      firstEngagementAt: "2026-01-01",
      windowMonths: 24,
      saleTierPct: 20,
      originationOnlyPct: 10,
    };
    const t1 = M.selectTier({ ...base, originated: true, materialContribution: true, engagementSignedAt: "2029-06-01" });
    check("sale tier has no time limit", t1.tier === "sale" && t1.pct === 20);
    const t2 = M.selectTier({ ...base, originated: true, materialContribution: false, engagementSignedAt: "2027-12-31" });
    check("origination-only inside 24m window → 10%", t2.tier === "origination_only" && t2.pct === 10);
    const t3 = M.selectTier({ ...base, originated: true, materialContribution: false, engagementSignedAt: "2028-01-02" });
    check("origination-only after window lapses → none", t3.tier === "none" && t3.pct === 0, JSON.stringify(t3));
    const tBoundary = M.selectTier({ ...base, originated: true, materialContribution: false, engagementSignedAt: "2028-01-01" });
    check("engagement signed exactly at window end still qualifies", tBoundary.tier === "origination_only");
    const t4 = M.selectTier({ ...base, originated: false, materialContribution: false, engagementSignedAt: "2026-06-01" });
    check("neither originated nor contributed → none", t4.tier === "none");
    const t5 = M.selectTier({ ...base, originated: false, materialContribution: true, engagementSignedAt: "2026-06-01" });
    check("material contribution without origination → sale tier", t5.tier === "sale");

    const profit = M.computeProjectProfit(500_000, 300_000);
    check("worked example: $500k fees − $300k costs = $200k profit", profit === 200_000);
    check("worked example: 20% tier → $40k", M.computeMarginShare(profit, 20) === 40_000);
    check("worked example: 10% tier → $20k", M.computeMarginShare(profit, 10) === 20_000);
    check("negative profit pays nothing", M.computeMarginShare(-50_000, 20) === 0);
    check(
      "legacy plan without signed provenance is quarantined",
      M.pickEffectivePlan(
        [{ effectiveFrom: "2020-01-01", governingContractId: null, governingContractVersionId: null }] as any,
        "2026-01-01",
      ) === null,
    );
    const due = M.computeDueDate(new Date("2026-03-01T00:00:00Z"), new Date("2026-03-10T00:00:00Z"));
    check("due date = 30 days after the LATER of collection/acceptance", due === "2026-04-09", String(due));
    check("no due date until both events", M.computeDueDate(new Date(), null) === null);
  }

  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(method: string, path: string, personaId: string, body?: Record<string, unknown>) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${personaId}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  const createdRunIds: string[] = [];
  try {
    // --- fixtures ---
    const personas = [
      { id: FP_ID, role: "founding_partner", label: "Founding Partner", name: "Test Founder" },
      { id: FIN_ID, role: "finance", label: "Finance", name: "Test Finance" },
      { id: HR_ID, role: "hr", label: "HR", name: "Test HR" },
      { id: PT_ID, role: "partner", label: "Partner", name: "Test Partner" },
      { id: EMP_ID, role: "employee", label: "Employee", name: "Test Employee" },
      { id: NEP_ID, role: "non_equity_partner", label: "Non-Equity Partner", name: "Test NEP" },
      { id: CT2_ID, role: "contractor", label: "Contractor", name: "Foreign Contractor" },
    ];
    for (const p of personas) {
      await db.insert(atelierUsers).values({
        id: p.id, orgId: ORG, email: `${p.id}@cognirise.ai`, name: p.name,
        initials: "TT", role: p.role, roleLabel: p.label, title: p.name,
        permissions: [], bdActive: false,
      }).onConflictDoNothing();
    }
    await db.insert(atelierContractors).values({
      id: CT_PERSON, orgId: ORG, personId: CT_CANONICAL, fullName: "Test NEP",
      email: `${NEP_ID}@cognirise.ai`, dayRateAmount: 100, dayRateCurrency: "USD",
    });
    await db.insert(atelierPersons).values({
      id: CT_CANONICAL, orgId: ORG, firstName: "Test", lastName: "NEP",
      displayName: "Test NEP", sourceKind: "contractor",
    });
    await db.insert(atelierContractRecords).values({
      id: GOV_CONTRACT, orgId: ORG, title: "NEP governing agreement",
      contractType: "non_equity_partner_employment", counterpartyKind: "person",
      personId: CT_CANONICAL, counterpartyLabel: "Test NEP", status: "signed",
      ownerUserId: FP_ID, ownerLabel: "Test Founder", currentDocumentId: GOV_DOC,
    });
    await db.insert(atelierContractDocuments).values({
      id: GOV_DOC, orgId: ORG, contractId: GOV_CONTRACT, versionNumber: 1,
      kind: "signed_pdf", fileName: "nep-signed.pdf", mime: "application/pdf",
      sizeBytes: 12, sha256: `sha256:${STAMP}`, blobRef: `enc:test:${STAMP}`,
      createdBy: FP_ID, createdByLabel: "Test Founder",
    });
    await db.insert(atelierContractors).values({
      id: CT2_PERSON, orgId: ORG, fullName: "Foreign Contractor",
      email: `${CT2_ID}@cognirise.ai`, dayRateAmount: 640, dayRateCurrency: "USD",
    });
    // Account originated by the NEP; first engagement 2024-09-01 so the
    // 24-month window ends 2026-09-01 (today 2026-08 is inside; ENG_LATE
    // is signed after).
    await db.insert(atelierAccounts).values({
      id: ACC_ID, orgId: ORG, name: `NEP Origination Co ${STAMP}`,
      country: "UAE", sector: "Energy", partnerOwnerId: NEP_ID,
      originatedByUserId: NEP_ID, originatedAt: new Date("2024-08-15T00:00:00Z"),
      originationFirstEngagementAt: "2024-09-01",
    });
    const engBase = {
      orgId: ORG, accountId: ACC_ID, plmStage: "deliver",
      partnerOwnerId: FP_ID, engagementLeadId: FP_ID,
      plannedEndDate: "2027-01-01",
    };
    await db.insert(atelierEngagements).values({
      ...engBase, id: ENG_SALE, slug: `eng-sale-${STAMP}`, name: "Sale-tier engagement", startDate: "2026-01-15",
    });
    await db.insert(atelierEngagements).values({
      ...engBase, id: ENG_ORIG, slug: `eng-orig-${STAMP}`, name: "Origination-only engagement", startDate: "2026-05-01",
    });
    await db.insert(atelierEngagements).values({
      ...engBase, id: ENG_LATE, slug: `eng-late-${STAMP}`, name: "Post-window engagement", startDate: "2026-10-01",
    });
    // Pre-plan engagement: starts BEFORE the first plan's effectiveFrom
    // (2026-01-01) — no plan covers it, so recompute must skip it.
    await db.insert(atelierEngagements).values({
      ...engBase, id: ENG_PRE, slug: `eng-pre-${STAMP}`, name: "Pre-plan engagement", startDate: "2025-11-01",
    });

    // Worked example on ENG_SALE: $500k fees, $300k direct costs of which
    // $50k are the NEP's OWN time charges (20 days × 2,500).
    await db.insert(atelierInvoice).values({
      id: INV_SALE, orgId: ORG, engagementId: ENG_SALE, accountId: ACC_ID,
      jurisdiction: "UAE", currency: "USD", status: "issued",
      subtotal: 500_000, total: 500_000, amountPaid: 0,
      issuedAt: new Date("2026-06-01T00:00:00Z"),
    });
    await db.insert(atelierContractorPayments).values([
      {
        id: `cp_other_${STAMP}`, orgId: ORG, payeeUserId: CT2_ID, payeePersonType: "contractor",
        payeeName: "Foreign Contractor", engagementId: ENG_SALE, weekIso: "2026-W20",
        hours: 100, ratePerHour: 2500, rateCurrency: "USD",
        costAmount: 250_000, costCurrency: "USD", usdAmount: 250_000, status: "partner_approved",
      },
      {
        id: `cp_own_${STAMP}`, orgId: ORG, payeeUserId: NEP_ID, payeePersonType: "contractor",
        payeeName: "Test NEP", engagementId: ENG_SALE, weekIso: "2026-W21",
        hours: 160, ratePerHour: 312.5, rateCurrency: "USD",
        costAmount: 50_000, costCurrency: "USD", usdAmount: 50_000, status: "partner_approved",
      },
    ]);
    // ENG_ORIG: $200k fees fully collected, $0 costs → $200k profit @10% = $20k.
    await db.insert(atelierInvoice).values({
      id: INV_ORIG, orgId: ORG, engagementId: ENG_ORIG, accountId: ACC_ID,
      jurisdiction: "UAE", currency: "USD", status: "paid",
      subtotal: 200_000, total: 200_000, amountPaid: 200_000,
      issuedAt: new Date("2026-06-15T00:00:00Z"), paidAt: new Date("2026-07-01T00:00:00Z"),
    });

    // --- 2. plan lifecycle + gating ---
    group("Plan lifecycle + comp gating");
    const planBody = {
      contractorId: CT_PERSON, effectiveFrom: "2026-01-01", currency: "USD",
      governingContractId: GOV_CONTRACT, governingContractVersionId: GOV_DOC,
      dayRateAmount: 2500, marginSharePctSale: 20, marginSharePctOriginationOnly: 10,
      originationWindowMonths: 24, conversionRevenueThresholdUsd: 2_000_000,
      conversionMarginThresholdPct: 40, postConversionSalaryAmount: 300_000,
      postConversionSalaryCurrency: "USD",
    };
    const noClassification = await call("POST", "/finance/nep-comp/plans", FP_ID, planBody);
    check("unclassified contractor cannot receive an NEP plan", noClassification.status === 409 && noClassification.body?.error === "classification-required");
    const classified = await call("PATCH", `/roster/people/${CT_CANONICAL}/classification`, HR_ID, {
      relationshipType: "non_equity_partner", compensationBasis: "nep_margin_share",
      effectiveFrom: "2026-01-01",
    });
    check("contractor is explicitly classified as non_equity_partner", classified.status === 200);
    const classifiedAgain = await call("POST", `/finance/nep-comp/plans/${CT_PERSON}/classification-migration`, FIN_ID, {
      relationshipType: "non_equity_partner", effectiveFrom: "2026-01-01",
      provenanceId: `legacy-migration-${STAMP}`,
    });
    const classificationRows = await db.select().from(atelierPersonRelationshipClassifications)
      .where(eq(atelierPersonRelationshipClassifications.personId, CT_CANONICAL));
    check("classification migration retry is idempotent when supported",
      classifiedAgain.status === 200 && classifiedAgain.body?.idempotent === true && classificationRows.length === 1);
    const invalidContract = await call("POST", "/finance/nep-comp/plans", FP_ID, { ...planBody, governingContractId: `missing_${STAMP}` });
    check("missing governing contract is rejected", invalidContract.status === 409 && invalidContract.body?.error === "signed-governing-contract-required");
    const unsignedId = `contract_unsigned_${STAMP}`, unsignedDoc = `cdoc_unsigned_${STAMP}`;
    await db.insert(atelierContractRecords).values({
      id: unsignedId, orgId: ORG, title: "Unsigned NEP agreement", contractType: "non_equity_partner_employment",
      counterpartyKind: "person", personId: CT_CANONICAL, counterpartyLabel: "Test NEP", status: "draft",
      ownerUserId: FP_ID, ownerLabel: "Test Founder", currentDocumentId: unsignedDoc,
    });
    await db.insert(atelierContractDocuments).values({
      id: unsignedDoc, orgId: ORG, contractId: unsignedId, versionNumber: 1, kind: "generated_draft",
      fileName: "unsigned.pdf", mime: "application/pdf", sizeBytes: 1, sha256: "unsigned",
      blobRef: "enc:test:unsigned", createdBy: FP_ID, createdByLabel: "Test Founder",
    });
    const unsigned = await call("POST", "/finance/nep-comp/plans", FP_ID, { ...planBody, governingContractId: unsignedId, governingContractVersionId: unsignedDoc });
    check("unsigned governing contract is rejected", unsigned.status === 409 && unsigned.body?.error === "signed-governing-contract-required");
    const mismatch = await call("POST", "/finance/nep-comp/plans", FP_ID, { ...planBody, governingContractVersionId: unsignedDoc });
    check("mismatched governing version is rejected", mismatch.status === 409 && mismatch.body?.error === "signed-governing-contract-required");
    await db.update(atelierContractRecords).set({ templateVersionId: unsignedDoc }).where(eq(atelierContractRecords.id, GOV_CONTRACT));
    const templateVersionMisuse = await call("POST", "/finance/nep-comp/plans", FP_ID, { ...planBody, governingContractVersionId: unsignedDoc });
    check("template version cannot masquerade as signed provenance", templateVersionMisuse.status === 409 && templateVersionMisuse.body?.error === "signed-governing-contract-required");
    check("partner cannot create a plan (403)", (await call("POST", "/finance/nep-comp/plans", PT_ID, planBody)).status === 403);
    check("HR cannot create a plan (read-only comp viewer, 403)", (await call("POST", "/finance/nep-comp/plans", HR_ID, planBody)).status === 403);
    const created = await call("POST", "/finance/nep-comp/plans", FP_ID, planBody);
    check("founder creates the plan (201)", created.status === 201, JSON.stringify(created.body));
    check("plan list carries governing contract provenance",
      created.body?.plan?.governingContractId === GOV_CONTRACT && created.body?.plan?.governingContractVersionId === GOV_DOC,
      JSON.stringify(created.body));
    const [ctAfter] = await db.select().from(atelierContractors).where(eq(atelierContractors.id, CT_PERSON));
    check("plan day rate synced to the contractor roster row", ctAfter.dayRateAmount === 2500 && ctAfter.dayRateCurrency === "USD");
    check("duplicate effective date is 409", (await call("POST", "/finance/nep-comp/plans", FIN_ID, planBody)).status === 409);
    const revised = await call("POST", "/finance/nep-comp/plans", FIN_ID, { ...planBody, effectiveFrom: "2026-07-01", dayRateAmount: 2600 });
    check("finance can add an effective-dated revision", revised.status === 201);
    check("HR can read plans (200)", (await call("GET", "/finance/nep-comp/plans", HR_ID)).status === 200);
    check("partner cannot read plans (403)", (await call("GET", "/finance/nep-comp/plans", PT_ID)).status === 403);
    check("employee is clamped at the central gate (403)", (await call("GET", "/finance/nep-comp/plans", EMP_ID)).status === 403);
    const detail0 = await call("GET", `/finance/nep-comp/plans/${CT_PERSON}`, FP_ID);
    check("detail shows current plan = latest effective revision", detail0.body?.currentPlan?.dayRateAmount === 2600);
    check("plan history keeps both revisions", (detail0.body?.planHistory ?? []).length === 2);
    check("plan detail/history preserve governing contract provenance",
      detail0.body?.currentPlan?.governingContractId === GOV_CONTRACT &&
      (detail0.body?.planHistory ?? []).every((p: any) => p.governingContractId === GOV_CONTRACT && p.governingContractVersionId === GOV_DOC),
      JSON.stringify(detail0.body));
    const rosterDetail = await call("GET", `/roster/people/${CT_PERSON}`, HR_ID);
    check(
      "authorized roster detail shows signed agreement provenance",
      rosterDetail.status === 200 &&
        String(rosterDetail.body?.person?.provenance ?? "").includes(GOV_DOC),
      JSON.stringify(rosterDetail.body),
    );
    // A FUTURE-dated revision must not change the operational rate today.
    const future = await call("POST", "/finance/nep-comp/plans", FP_ID, { ...planBody, effectiveFrom: "2030-01-01", dayRateAmount: 9999 });
    check("future-dated revision accepted", future.status === 201);
    const [ctFuture] = await db.select().from(atelierContractors).where(eq(atelierContractors.id, CT_PERSON));
    check("future-dated revision does NOT change the roster day rate today", ctFuture.dayRateAmount === 2600, String(ctFuture.dayRateAmount));
    const detailFuture = await call("GET", `/finance/nep-comp/plans/${CT_PERSON}`, FP_ID);
    check("current plan is still the latest ALREADY-effective revision", detailFuture.body?.currentPlan?.dayRateAmount === 2600);

    // --- 3. attribution + recompute ---
    group("Attribution + entitlement recompute");
    const mc = await call("POST", `/finance/nep-comp/engagements/${ENG_SALE}/material-contribution`, FP_ID, { userId: NEP_ID });
    check("founder flags material contribution (200)", mc.status === 200);
    const audRows = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityId, ENG_SALE),
      eq(atelierAuditEvents.action, "nep_comp.material_contribution_set"),
    ));
    check("material-contribution flag is audited", audRows.length === 1);
    check("partner cannot flag material contribution (403)",
      (await call("POST", `/finance/nep-comp/engagements/${ENG_ORIG}/material-contribution`, PT_ID, { userId: NEP_ID })).status === 403);

    const rc1 = await call("POST", "/finance/nep-comp/recompute", FIN_ID, { contractorId: CT_PERSON });
    check("recompute runs (200)", rc1.status === 200, JSON.stringify(rc1.body));
    const entsQ = await call("GET", `/finance/nep-comp/entitlements?contractorId=${CT_PERSON}`, FIN_ID);
    const ents: any[] = entsQ.body?.items ?? [];
    const eSale = ents.find((e) => e.engagementId === ENG_SALE);
    const eOrig = ents.find((e) => e.engagementId === ENG_ORIG);
    const eLate = ents.find((e) => e.engagementId === ENG_LATE);
    check("three entitlement rows (one per plan-covered engagement)", ents.length === 3, JSON.stringify(ents.map((e) => e.engagementId)));
    check("engagement pre-dating the first plan gets NO entitlement (no retroactive fallback)",
      !ents.some((e) => e.engagementId === ENG_PRE));
    check("sale engagement gets the 20% tier", eSale?.tier === "sale" && eSale?.tierPct === 20, JSON.stringify(eSale));
    check("origination-only engagement inside window gets 10%", eOrig?.tier === "origination_only" && eOrig?.tierPct === 10);
    check("engagement signed after the 24-month window gets tier none", eLate?.tier === "none" && eLate?.amountUsd === 0);
    check("own time charges deducted as a direct cost ($50k)", eSale?.ownTimeChargesUsd === 50_000, String(eSale?.ownTimeChargesUsd));
    check("sale engagement not yet collected → $0 collected, accruing",
      eSale?.status === "accruing" && eSale?.feesCollectedUsd === 0 && eSale?.fullyCollected === false);
    check("origination engagement fully collected", eOrig?.fullyCollected === true && eOrig?.feesCollectedUsd === 200_000);
    check("origination profit/amount: $200k → $20k @10%", eOrig?.projectProfitUsd === 200_000 && eOrig?.amountUsd === 20_000);
    check("statement math lines present", Array.isArray(eSale?.statement?.lines) && eSale.statement.lines.some((l: any) => l.kind === "cost_own_time_charges"));

    // --- 4. collection gating ---
    group("Collection + acceptance gating");
    check("approve before payable is 409", (await call("POST", `/finance/nep-comp/entitlements/${eOrig.id}/approve`, FIN_ID)).status === 409);
    const acc1 = await call("POST", `/finance/nep-comp/entitlements/${eOrig.id}/accept`, FP_ID);
    check("client acceptance recorded → payable", acc1.status === 200 && acc1.body?.status === "payable", JSON.stringify(acc1.body));
    check("due date set ~30 days after later of collection/acceptance", typeof acc1.body?.dueDate === "string");
    check("second acceptance is 409", (await call("POST", `/finance/nep-comp/entitlements/${eOrig.id}/accept`, FP_ID)).status === 409);

    // Now collect the sale invoice fully and accept: worked example numbers.
    await db.update(atelierInvoice).set({ status: "paid", amountPaid: 500_000, paidAt: new Date("2026-08-01T00:00:00Z") })
      .where(eq(atelierInvoice.id, INV_SALE));
    await call("POST", "/finance/nep-comp/recompute", FIN_ID, { contractorId: CT_PERSON });
    const eSale2 = (await call("GET", `/finance/nep-comp/entitlements?contractorId=${CT_PERSON}`, FIN_ID)).body.items
      .find((e: any) => e.engagementId === ENG_SALE);
    check("after collection: fees $500k, costs $300k, profit $200k",
      eSale2.feesCollectedUsd === 500_000 && eSale2.directCostsUsd === 300_000 && eSale2.projectProfitUsd === 200_000,
      JSON.stringify({ f: eSale2.feesCollectedUsd, c: eSale2.directCostsUsd, p: eSale2.projectProfitUsd }));
    check("worked example end-to-end: $40k at the 20% tier", eSale2.amountUsd === 40_000);
    check("collected but not accepted → still accruing", eSale2.status === "accruing");
    const accS = await call("POST", `/finance/nep-comp/entitlements/${eSale2.id}/accept`, FP_ID);
    check("acceptance after collection → payable + due date", accS.body?.status === "payable" && typeof accS.body?.dueDate === "string", JSON.stringify(accS.body));

    // --- 5. payables integration ---
    group("Payables integration (nep_margin_share)");
    const ap1 = await call("POST", `/finance/nep-comp/entitlements/${eSale2.id}/approve`, FIN_ID);
    check("approve payable entitlement (200)", ap1.status === 200);
    await db.insert(atelierBankAccount).values({
      id: BANK_ID, orgId: ORG, bankName: "NEP Test Bank", accountLabel: "Ops",
      accountNumberLast4: "1298", currency: "USD", isActive: true,
    });
    await db.insert(atelierBankSignatories).values([
      { id: `bs1_${STAMP}`, orgId: ORG, bankAccountId: BANK_ID, userId: FIN_ID, personName: "Test Finance", authority: "joint" },
      { id: `bs2_${STAMP}`, orgId: ORG, bankAccountId: BANK_ID, userId: PT_ID, personName: "Test Partner", authority: "joint" },
    ]);
    const build = await call("POST", "/finance/payables/payment-runs/build", FIN_ID, { bankAccountId: BANK_ID });
    check("payment-run build succeeds with the approved entitlement", build.status === 200 || build.status === 201, JSON.stringify(build.body));
    const runId = build.body?.run?.id ?? build.body?.runId ?? build.body?.id;
    if (runId) createdRunIds.push(runId);
    const items = runId ? await db.select().from(atelierPaymentRunItems).where(eq(atelierPaymentRunItems.runId, runId)) : [];
    const nepItem = items.find((i: any) => i.itemType === "nep_margin_share");
    check("run contains a nep_margin_share item for $40k", Boolean(nepItem) && nepItem.amountUsd === 40_000, JSON.stringify(items.map((i: any) => [i.itemType, i.amountUsd])));
    const [entScheduled] = await db.select().from(atelierNepEntitlements).where(eq(atelierNepEntitlements.id, eSale2.id));
    check("entitlement claimed → scheduled with run id", entScheduled.status === "scheduled" && entScheduled.paymentRunId === runId);

    // Idempotency: a recompute must not touch the scheduled row.
    await call("POST", "/finance/nep-comp/recompute", FIN_ID, { contractorId: CT_PERSON });
    const [entStill] = await db.select().from(atelierNepEntitlements).where(eq(atelierNepEntitlements.id, eSale2.id));
    check("recompute never touches scheduled rows", entStill.status === "scheduled" && entStill.amountUsd === 40_000);

    // Signatories must see the manual-bank warning before approving:
    // NEP margin shares pay a contractor person (no system IBAN policy).
    const runDetail = await call("GET", `/finance/payables/payment-runs/${runId}`, FIN_ID);
    const detailNep = (runDetail.body?.items ?? runDetail.body?.run?.items ?? []).find((i: any) => i.itemType === "nep_margin_share");
    check("run detail flags nep_margin_share as missingBank", detailNep?.missingBank === true, JSON.stringify(detailNep));

    // Sign twice + mark paid, mirroring the payables lifecycle.
    await call("POST", `/finance/payables/payment-runs/${runId}/sign`, FIN_ID);
    await call("POST", `/finance/payables/payment-runs/${runId}/sign`, PT_ID);

    // Bank-file export: the NEP line exports with blank bank cells (manual
    // keying) and the Wio export surfaces it in the missing-IBAN warning.
    const csvRes = await fetch(`${API}/finance/payables/payment-runs/${runId}/export`, {
      method: "POST", headers: { cookie: `atelier_persona=${FIN_ID}` },
    });
    const csvText = await csvRes.text();
    const nepLine = csvText.split(/\r?\n/).find((l) => l.includes("nep_margin_share"));
    check("CSV export contains the nep_margin_share line", csvRes.status === 200 && Boolean(nepLine), csvText.slice(0, 200));
    check("nep line exports blank bank cells for manual keying", Boolean(nepLine) && nepLine!.endsWith(`,"",""`), nepLine ?? "");
    const wioRes = await fetch(`${API}/finance/payables/payment-runs/${runId}/export-wio`, {
      method: "POST", headers: { cookie: `atelier_persona=${FIN_ID}` },
    });
    check("Wio export succeeds with the NEP item", wioRes.status === 200);
    const wioAudit = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityId, runId),
      eq(atelierAuditEvents.action, "finance.payment_run.export_wio"),
    ));
    const missingIban = (wioAudit[0]?.payload as any)?.missingIban ?? [];
    check("Wio export missing-IBAN warning names the NEP payee", missingIban.includes("Test NEP"), JSON.stringify(missingIban));
    const mp = await call("POST", `/finance/payables/payment-runs/${runId}/mark-paid`, FIN_ID, { remittanceRef: `NEPRUN-${STAMP}` });
    check("run mark-paid succeeds", mp.status === 200, JSON.stringify(mp.body));
    const [entPaid] = await db.select().from(atelierNepEntitlements).where(eq(atelierNepEntitlements.id, eSale2.id));
    check("entitlement cascaded to paid with remittance ref", entPaid.status === "paid" && entPaid.remittanceRef === `NEPRUN-${STAMP}`);
    await call("POST", "/finance/nep-comp/recompute", FIN_ID, { contractorId: CT_PERSON });
    const [entPaidStill] = await db.select().from(atelierNepEntitlements).where(eq(atelierNepEntitlements.id, eSale2.id));
    check("recompute never touches paid rows", entPaidStill.status === "paid" && entPaidStill.amountUsd === 40_000);

    // --- 6. conversion tracker ---
    group("Conversion tracker");
    const detail = await call("GET", `/finance/nep-comp/plans/${CT_PERSON}`, FP_ID);
    const conv = detail.body?.conversion;
    // --- Effective-date activation at the pricing boundary ---------------
    // A revision must start pricing on/after its effectiveFrom WITHOUT any
    // manual recompute or roster sync: the payment proposer resolves the
    // rate from the plan effective on the WORK week, not the roster field.
    group("Effective-dated rate at the pricing boundary");
    {
      const { runPaymentProposer } = await import("../../src/lib/atelier-payment-proposer.js");
      const { isoWeekStart, resolveContractorDayRateForDate } = M as any;
      check("isoWeekStart parses ISO weeks", isoWeekStart("2030-W02") === "2030-01-07", isoWeekStart("2030-W02") ?? "null");
      const preRate = await resolveContractorDayRateForDate(ORG, CT_PERSON, "2025-12-01");
      check("no plan rate before the first effectiveFrom", preRate === null);
      // Corrupt the roster field to prove the plan (2600, effective 2026-07-01) wins.
      await db.update(atelierContractors).set({ dayRateAmount: 1111 }).where(eq(atelierContractors.id, CT_PERSON));
      const WK_CUR = "2026-W28";  // starts 2026-07-06 → revision rate 2600
      const WK_FUT = "2030-W02";  // starts 2030-01-07 → future revision rate 9999
      const weekFixtures = [
        { id: `tsw_cur_${STAMP}`, weekIso: WK_CUR, start: "2026-07-06" },
        { id: `tsw_fut_${STAMP}`, weekIso: WK_FUT, start: "2030-01-07" },
      ];
      for (const w of weekFixtures) {
        await db.insert(atelierTimesheetWeeks).values({
          id: w.id, orgId: ORG, personId: CT_PERSON, personType: "contractor",
          weekIso: w.weekIso, weekStartDate: w.start, status: "lead_approved", totalHours: 8,
        });
        await db.insert(atelierTimesheetEntries).values({
          id: `tse_${w.id}`, orgId: ORG, weekId: w.id, personId: CT_PERSON, personType: "contractor",
          workDate: w.start, engagementId: ENG_LATE, activityCode: "billable", hours: 8, billable: true, status: "approved",
        });
      }
      await runPaymentProposer({ weeksIso: [WK_CUR, WK_FUT], triggeredBy: "test" });
      const cps = await db.select().from(atelierContractorPayments).where(and(
        inArray(atelierContractorPayments.weekIso, [WK_CUR, WK_FUT]),
        eq(atelierContractorPayments.engagementId, ENG_LATE),
      ));
      const cpCur = cps.find((c: any) => c.weekIso === WK_CUR);
      const cpFut = cps.find((c: any) => c.weekIso === WK_FUT);
      check("current week priced from the effective plan, not the (corrupted) roster field",
        cpCur?.ratePerHour === 2600 / 8, JSON.stringify(cpCur));
      check("post-effective week priced at the future revision rate without recompute",
        cpFut?.ratePerHour === 9999 / 8, JSON.stringify(cpFut));
      // Restore the roster field for the remaining checks.
      await db.update(atelierContractors).set({ dayRateAmount: 2600 }).where(eq(atelierContractors.id, CT_PERSON));
      await db.delete(atelierTimesheetEntries).where(inArray(atelierTimesheetEntries.weekId, weekFixtures.map((w) => w.id)));
      await db.delete(atelierTimesheetWeeks).where(inArray(atelierTimesheetWeeks.id, weekFixtures.map((w) => w.id)));
      await db.delete(atelierContractorPayments).where(inArray(atelierContractorPayments.weekIso, [WK_CUR, WK_FUT]));
    }

    // --- Tenant isolation (RLS) regression -------------------------------
    // The live connection is BYPASSRLS (superuser), so like the CRM suite we
    // assert the DB-layer control at the observable layers: RLS is
    // enabled+forced on both new tables and the standard org-isolation
    // policy exists with the atelier_current_org() predicate.
    {
      const rlsRows: any[] = ((await db.execute(sql`
        SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policies p
                 WHERE p.tablename = c.relname
                   AND p.policyname = c.relname || '_org_isolation'
                   AND p.qual LIKE '%atelier_current_org%') AS policies
        FROM pg_class c
        WHERE c.relname IN ('atelier_nep_comp_plans','atelier_nep_entitlements')
      `)) as any).rows ?? [];
      check("both NEP tables present in pg_class", rlsRows.length === 2, JSON.stringify(rlsRows));
      for (const r of rlsRows) {
        check(`${r.relname}: RLS enabled + forced`, r.relrowsecurity === true && r.relforcerowsecurity === true, JSON.stringify(r));
        check(`${r.relname}: org-isolation policy on atelier_current_org()`, Number(r.policies) === 1, JSON.stringify(r));
      }
      // Policy predicate behaves: under a foreign-org GUC the helper reports
      // the foreign org, so `org_id = atelier_current_org()` excludes rows.
      await db.transaction(async (tx: any) => {
        await tx.execute(sql`select set_config('app.org_id', 'zzz_other_org', true)`);
        const visible: any[] = ((await tx.execute(sql`
          SELECT count(*) AS n FROM atelier_nep_comp_plans
          WHERE org_id = atelier_current_org() AND contractor_id = ${CT_PERSON}
        `)) as any).rows ?? [];
        check("cross-org predicate hides NEP plans from a foreign org", Number(visible[0]?.n) === 0, JSON.stringify(visible));
      });
    }

    check("conversion progress present", Boolean(conv));
    // $700k collected in the last 12 months, threshold $2M → not met.
    check("rolling 12m attributable revenue = $700k (< $2M threshold)",
      conv?.attributableRevenueUsd === 700_000 && conv?.revenueMet === false, JSON.stringify(conv));
    // Realised margin across fully-collected accepted engagements:
    // (200k + 200k) / (500k + 200k) = 57.14% ≥ 40% → met.
    check("realised delivered margin ≥ 40% threshold met",
      conv?.marginMet === true && Math.abs((conv?.realisedMarginPct ?? 0) - 57.14) < 0.1);
    check("bothMet false until revenue threshold reached", conv?.bothMet === false);

    // --- 7. Me lens self view ---
    group("/me/nep-comp self view");
    const meView = await call("GET", "/me/nep-comp", NEP_ID);
    check("NEP sees own plan terms", meView.status === 200 && meView.body?.hasPlan === true && meView.body?.plan?.dayRateAmount === 2600);
    check("NEP sees own entitlements incl. paid margin share",
      (meView.body?.entitlements ?? []).some((e: any) => e.status === "paid" && e.amountUsd === 40_000));
    check("NEP sees conversion progress", meView.body?.conversion?.attributableRevenueUsd === 700_000);
    const foreign = await call("GET", "/me/nep-comp", CT2_ID);
    check("foreign contractor gets hasPlan:false", foreign.status === 200 && foreign.body?.hasPlan === false);
    check("NEP cannot read the finance surface (403)", (await call("GET", "/finance/nep-comp/plans", NEP_ID)).status === 403);
  } finally {
    // --- cleanup (fixture-scoped) ---
    try {
      await db.delete(atelierNepEntitlements).where(eq(atelierNepEntitlements.contractorId, CT_PERSON));
      await db.delete(atelierNepCompPlans).where(eq(atelierNepCompPlans.contractorId, CT_PERSON));
      await db.delete(atelierContractDocuments).where(inArray(atelierContractDocuments.contractId, [GOV_CONTRACT, `contract_unsigned_${STAMP}`]));
      await db.delete(atelierContractRecords).where(inArray(atelierContractRecords.id, [GOV_CONTRACT, `contract_unsigned_${STAMP}`]));
      await db.delete(atelierPersonRelationshipClassifications).where(eq(atelierPersonRelationshipClassifications.personId, CT_CANONICAL));
      if (createdRunIds.length) {
        await db.delete(atelierPaymentRunItems).where(inArray(atelierPaymentRunItems.runId, createdRunIds));
        await db.delete(atelierPaymentRuns).where(inArray(atelierPaymentRuns.id, createdRunIds));
      }
      await db.delete(atelierBankSignatories).where(eq(atelierBankSignatories.bankAccountId, BANK_ID));
      await db.delete(atelierBankAccount).where(eq(atelierBankAccount.id, BANK_ID));
      await db.delete(atelierContractorPayments).where(inArray(atelierContractorPayments.engagementId, [ENG_SALE, ENG_ORIG, ENG_LATE]));
      await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, [INV_SALE, INV_ORIG]));
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [ENG_SALE, ENG_ORIG, ENG_LATE, ENG_PRE]));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, ACC_ID));
      await db.delete(atelierContractors).where(inArray(atelierContractors.id, [CT_PERSON, CT2_PERSON]));
      await db.delete(atelierPersons).where(eq(atelierPersons.id, CT_CANONICAL));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `p_test_%_${STAMP}`));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_%_${STAMP}`));
    } catch (err) {
      console.error("cleanup error", err);
    }
    server.close();
    await pool.end().catch(() => undefined);
  }

  console.log("");
  if (failures.length) {
    console.error(`\u2717 ${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\u2713 nep-comp probe passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
