/**
 * Task #1344 focused backend lifecycle probe.
 * Run with the isolated scratch DB; this intentionally exercises policy
 * primitives and the self-scoped create/contingency gates without UI code.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

const stamp = Date.now();
const org = "aico";
const partner = `p_1344_partner_${stamp}`;
const partnerPerson = `person_1344_partner_${stamp}`;
const partnerContractor = `ctr_1344_partner_${stamp}`;
const partnerContract = `contract_1344_partner_${stamp}`;
const partnerDocument = `contractdoc_1344_partner_${stamp}`;
const beneficiary = `p_1344_beneficiary_${stamp}`;
const founder = `p_1344_founder_${stamp}`;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS ${name}`);
  else { failures.push(name); console.error(`FAIL ${name}`, detail ?? ""); }
};

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierExpenses, atelierExpensePolicies,
    atelierPersons, atelierContractors, atelierContractRecords, atelierContractDocuments,
  } = D;
  const { and, eq } = await import("drizzle-orm");
  const P = await import("../../src/lib/atelier-expense-policy.js");
  const app = (await import("../../src/app.js")).default;
  await db.insert(atelierUsers).values([
    { id: partner, orgId: org, personId: partnerPerson, name: "NEP 1344", initials: "NP", email: `${partner}@test`, role: "non_equity_partner", roleLabel: "NEP", title: "Partner" },
    { id: beneficiary, orgId: org, name: "Owed Person", initials: "OP", email: `${beneficiary}@test`, role: "employee", roleLabel: "Employee", title: "Employee" },
    { id: founder, orgId: org, name: "Founder 1344", initials: "FP", email: `${founder}@test`, role: "founding_partner", roleLabel: "Founding Partner", title: "Founder" },
  ]);
  await db.insert(atelierExpensePolicies).values({
    id: `pol_1344_${stamp}`, orgId: org, category: "meal", appliesToRole: null,
    eligibleRoles: ["employee", "contractor", "partner"], requiresReceipt: true,
    requiresBusinessPurpose: true, periodicCapUsd: 100, periodicCapPeriod: "month",
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const call = async (method: string, path: string, body: unknown) => {
    const r = await fetch(base + path, {
      method, headers: { "content-type": "application/json", cookie: `atelier_persona=${partner}` },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const founderCall = async (path: string, body: unknown) => {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `atelier_persona=${founder}` },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const noAgreement = await call("POST", "/me/expenses", {
      merchant: "NEP meal", amount: 25, currency: "USD", category: "meal",
      businessPurpose: "Pursuit meeting", receiptFixtureKey: "receipt_basic",
      contextType: "bd",
      fundingSource: "partner_paid", owedTo: beneficiary, reimbursementTrigger: "win",
    });
    check("NEP missing agreement rejected", noAgreement.status === 409 && noAgreement.body?.error === "signed-governing-contract-required", noAgreement);
    await db.insert(atelierPersons).values({
      id: partnerPerson, orgId: org, firstName: "NEP", lastName: "1344",
      displayName: "NEP 1344", sourceKind: "contractor",
    });
    await db.insert(atelierContractors).values({
      id: partnerContractor, orgId: org, personId: partnerPerson,
      fullName: "NEP 1344", email: `${partner}@test`,
      dayRateAmount: 100, dayRateCurrency: "USD",
    });
    await db.insert(atelierContractRecords).values({
      id: partnerContract, orgId: org, title: "Scoped NEP expense agreement",
      contractType: "non_equity_partner_employment", counterpartyKind: "person",
      personId: partnerPerson, counterpartyLabel: "NEP 1344", status: "signed",
      ownerUserId: founder, ownerLabel: "Founder 1344", currentDocumentId: partnerDocument,
      fieldValues: { expenseCategories: ["meal"] },
    });
    await db.insert(atelierContractDocuments).values({
      id: partnerDocument, orgId: org, contractId: partnerContract, versionNumber: 1,
      kind: "signed_pdf", fileName: "nep-expense-agreement.pdf", mime: "application/pdf",
      sizeBytes: 12, sha256: `sha256:${stamp}`, blobRef: `enc:test:${stamp}`,
      createdBy: founder, createdByLabel: "Founder 1344",
    });
    const scopedNep = await call("POST", "/me/expenses", {
      merchant: "NEP scoped meal", amount: 25, currency: "USD", category: "meal",
      businessPurpose: "Pursuit meal", receiptFixtureKey: "receipt_basic",
      contextType: "bd", fundingSource: "personal_claim",
      reimbursementTrigger: "not_applicable",
    });
    const [storedScopedNep] = scopedNep.body?.expense?.id
      ? await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, scopedNep.body.expense.id))
      : [];
    check("signed current NEP agreement permits scoped category", scopedNep.status === 201 &&
      storedScopedNep?.governingContractId === partnerContract &&
      storedScopedNep?.governingContractVersionId === partnerDocument, scopedNep);
    const outOfScopeNep = await call("POST", "/me/expenses", {
      merchant: "NEP unscoped travel", amount: 25, currency: "USD", category: "travel",
      businessPurpose: "Pursuit travel", receiptFixtureKey: "receipt_basic",
      contextType: "bd", fundingSource: "personal_claim",
      reimbursementTrigger: "not_applicable",
    });
    check("NEP agreement rejects unscoped category", outOfScopeNep.status === 409 &&
      outOfScopeNep.body?.error === "expense-category-not-in-agreement", outOfScopeNep);
    const ordinary = await (async () => {
      const r = await fetch(base + "/me/expenses", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `atelier_persona=${beneficiary}` },
        body: JSON.stringify({
          merchant: "Ordinary expense", amount: 12, currency: "USD",
          businessPurpose: "Office supplies", receiptFixtureKey: "receipt_basic",
          contextType: "bd", owedTo: "Owed Person", reimbursementTrigger: "not_applicable",
        }),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    })();
    check("not_applicable normalizes to non-contingent draft", ordinary.status === 201 &&
      ordinary.body?.expense?.contingencyType === "none" &&
      ordinary.body?.expense?.reimbursementTrigger === "not_applicable" &&
      ordinary.body?.expense?.owedTo === "Owed Person", ordinary);

    const noReceipt = await P.evaluateExpense({
      orgId: org, category: "meal", usdAmount: 20, amount: 20, currency: "USD",
      submitterRole: "employee", hasReceipt: false, businessPurpose: "Lunch",
      personId: partner, expenseDate: "2026-02-10",
    });
    check("receipt evidence is red", noReceipt.status === "red");
    const noPurpose = await P.evaluateExpense({
      orgId: org, category: "meal", usdAmount: 20, amount: 20, currency: "USD",
      submitterRole: "employee", hasReceipt: true, businessPurpose: "",
      personId: partner, expenseDate: "2026-02-10",
    });
    check("business purpose is red", noPurpose.status === "red");
    const first = await P.priorPeriodExpenseUsd({
      orgId: org, personId: partner, category: "meal", expenseDate: "2026-02-20", period: "month",
    });
    await db.insert(atelierExpenses).values({
      id: `exp_1344_prior_${stamp}`, orgId: org, personId: partner, personType: "non_equity_partner",
      expenseDate: "2026-02-03", captureSource: "manual", category: "meal", amount: 90,
      currency: "USD", usdAmount: 90, businessPurpose: "Prior meeting", status: "approved",
      beneficiaryUserId: partner,
    });
    const second = await P.priorPeriodExpenseUsd({
      orgId: org, personId: partner, category: "meal", expenseDate: "2026-02-20", period: "month",
    });
    check("period aggregation includes approved same-month claims", first === 0 && second === 90, { first, second });
    const over = await P.evaluateExpense({
      orgId: org, category: "meal", usdAmount: 20, amount: 20, currency: "USD",
      submitterRole: "employee", hasReceipt: true, businessPurpose: "Lunch",
      personId: partner, expenseDate: "2026-02-20",
    });
    check("period cap produces amber approval finding", over.status === "amber" && over.approvalRequired);

    const contingentId = `exp_1344_contingent_${stamp}`;
    await db.insert(atelierExpenses).values({
      id: contingentId, orgId: org, personId: beneficiary, personType: "employee",
      expenseDate: "2026-02-20", captureSource: "manual", category: "travel", amount: 200,
      currency: "USD", usdAmount: 200, merchant: "Partner-funded pursuit",
      businessPurpose: "Pursuit travel", status: "approved", policyStatus: "green",
      fundingSource: "partner_paid", beneficiaryUserId: beneficiary, beneficiaryName: "Owed Person",
      contingencyType: "win", contingencyStatus: "pending", directCostStatus: "pending",
    });
    const premature = await founderCall(`/wallet/expenses/${contingentId}/reimburse`, {});
    check("pending contingent reimbursement is blocked", premature.status === 409 &&
      premature.body?.error === "contingency-pending", premature);
    const won = await founderCall(`/wallet/expenses/${contingentId}/contingency-outcome`, { outcome: "won" });
    check("winning activates and includes approved direct cost once", won.status === 200 &&
      won.body?.activated === true &&
      won.body?.expense?.contingencyStatus === "activated" &&
      won.body?.expense?.directCostStatus === "included", won);
    const duplicateWon = await founderCall(`/wallet/expenses/${contingentId}/contingency-outcome`, { outcome: "won" });
    check("duplicate project outcome is idempotent", duplicateWon.status === 200 &&
      duplicateWon.body?.alreadySettled === true, duplicateWon);
    const reimbursed = await founderCall(`/wallet/expenses/${contingentId}/reimburse`, {});
    check("activated approved claim follows normal reimbursement", reimbursed.status === 200 &&
      reimbursed.body?.expense?.status === "reimbursed", reimbursed);
    const duplicateReimburse = await founderCall(`/wallet/expenses/${contingentId}/reimburse`, {});
    check("duplicate reimbursement is idempotent", duplicateReimburse.status === 200 &&
      duplicateReimburse.body?.alreadyReimbursed === true, duplicateReimburse);

    const lostId = `exp_1344_lost_${stamp}`;
    await db.insert(atelierExpenses).values({
      id: lostId, orgId: org, personId: beneficiary, personType: "employee",
      expenseDate: "2026-02-21", captureSource: "manual", category: "travel", amount: 150,
      currency: "USD", usdAmount: 150, merchant: "Lost pursuit",
      businessPurpose: "Pursuit travel", status: "approved", policyStatus: "green",
      fundingSource: "partner_paid", beneficiaryUserId: beneficiary, beneficiaryName: "Owed Person",
      contingencyType: "win", contingencyStatus: "pending", directCostStatus: "pending",
    });
    const lost = await founderCall(`/wallet/expenses/${lostId}/contingency-outcome`, { outcome: "lost" });
    check("lost pursuit closes as non-reimbursable and excluded", lost.status === 200 &&
      lost.body?.activated === false &&
      lost.body?.expense?.contingencyStatus === "lost" &&
      lost.body?.expense?.directCostStatus === "excluded", lost);
    const lostReimburse = await founderCall(`/wallet/expenses/${lostId}/reimburse`, {});
    check("lost pursuit cannot be reimbursed", lostReimburse.status === 409, lostReimburse);
  } finally {
    await db.delete(atelierExpenses).where(eq(atelierExpenses.personId, partner));
    await db.delete(atelierExpenses).where(eq(atelierExpenses.personId, beneficiary));
    await db.delete(atelierExpensePolicies).where(eq(atelierExpensePolicies.id, `pol_1344_${stamp}`));
    await db.delete(atelierContractDocuments).where(eq(atelierContractDocuments.id, partnerDocument));
    await db.delete(atelierContractRecords).where(eq(atelierContractRecords.id, partnerContract));
    await db.delete(atelierContractors).where(eq(atelierContractors.id, partnerContractor));
    await db.delete(atelierPersons).where(eq(atelierPersons.id, partnerPerson));
    await db.delete(atelierUsers).where(and(eq(atelierUsers.id, partner), eq(atelierUsers.orgId, org)));
    await db.delete(atelierUsers).where(and(eq(atelierUsers.id, beneficiary), eq(atelierUsers.orgId, org)));
    await db.delete(atelierUsers).where(and(eq(atelierUsers.id, founder), eq(atelierUsers.orgId, org)));
    server.close();
    await pool.end();
  }
  if (failures.length) process.exit(1);
  console.log("task-1344-lifecycle: all checks passed");
}
main().catch((e) => { console.error(e); process.exit(1); });