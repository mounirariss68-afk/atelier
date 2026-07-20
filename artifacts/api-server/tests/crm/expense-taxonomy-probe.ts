/**
 * Task #383 — Expense taxonomy + categorization probe.
 *
 * Covers:
 *   - GET /wallet/expense-taxonomy → categories (10), costCenters, fundingSources, entities
 *   - POST /wallet/expense-categorize/suggest with no memory → AI suggestion via
 *     a stub Anthropic server (deterministic canned JSON); empty body → 400
 *   - POST /me/expenses with categoryCode/subCategoryCode → persisted pair,
 *     categorySource=manual
 *   - Internal expense without entity+costCenter → submit 409 attribution-incomplete;
 *     PATCH entity+costCenter → submit 200
 *   - fundingSource=company_account is persisted; bogus fundingSource → 400
 *
 * Deterministic: the AI categorize call hits a local stub Anthropic server
 * (env set BEFORE app import).
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/expense-taxonomy-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
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

const AI_SUGGESTION = {
  categoryCode: "travel",
  subCategoryCode: "ground_transport",
  confidence: "green",
  rationale: "Ride-hailing merchant → ground transport.",
};

async function main() {
  // Stub Anthropic server MUST exist before the app is imported.
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe383",
          type: "message",
          role: "assistant",
          model: "claude-haiku-4-5",
          content: [{ type: "text", text: JSON.stringify(AI_SUGGESTION) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe383-stub-key";

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierExpenses,
    atelierLegalEntities,
    atelierBankAccount,
    atelierEngagements,
    atelierMerchantCategoryMap,
  } = D;
  const { eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  // Mirror server boot: the scratch DB starts with an empty taxonomy table.
  const tx = await import("../../src/lib/atelier-expense-taxonomy.js");
  await tx.ensureExpenseTaxonomy();

  const runTag = `probe383_${Date.now()}`;
  const empId = `u_${runTag}_emp`;
  const fpId = `u_${runTag}_fp`;
  const expenseIds: string[] = [];
  const entityId = `le_${runTag}`;
  const xOrg = `xorg_${runTag}`;
  const xBankId = `bank_${runTag}_x`;
  const xEngId = `eng_${runTag}_x`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (who: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${who}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values([
      {
        id: empId,
        orgId: "aico",
        name: "Probe383 Employee",
        initials: "PE",
        email: `${runTag}_emp@example.test`,
        role: "employee",
        roleLabel: "Consultant",
        title: "Consultant",
      },
    ]);
    await db.insert(atelierLegalEntities).values({
      id: entityId,
      orgId: "aico",
      legalNameEn: "Probe383 Entity LLC",
      country: "AE",
      status: "active",
    } as any);

    // --- taxonomy ---
    const tax = await api(empId, "GET", "/wallet/expense-taxonomy");
    check("taxonomy 200", tax.status === 200, tax);
    const cats = tax.body?.categories ?? [];
    check("taxonomy has 10 categories", cats.length === 10, cats.length);
    check(
      "taxonomy categories carry subCategories",
      cats.every((c: any) => Array.isArray(c.subCategories) && c.subCategories.length > 0),
    );
    check(
      "taxonomy costCenters + fundingSources",
      Array.isArray(tax.body?.costCenters) &&
        tax.body.costCenters.includes("marketing") &&
        Array.isArray(tax.body?.fundingSources) &&
        tax.body.fundingSources.includes("company_account"),
      tax.body,
    );
    check(
      "taxonomy entities include probe entity",
      (tax.body?.entities ?? []).some((e: any) => e.id === entityId),
      tax.body?.entities,
    );

    // --- suggest: no memory → stub AI ---
    const sug = await api(empId, "POST", "/wallet/expense-categorize/suggest", {
      merchant: `Careem ${runTag}`,
      description: "Airport ride",
    });
    check("suggest 200", sug.status === 200, sug);
    check(
      "suggest via stub AI",
      sug.body?.suggestion?.source === "ai" &&
        sug.body.suggestion.categoryCode === "travel" &&
        sug.body.suggestion.subCategoryCode === "ground_transport" &&
        sug.body.suggestion.confidence === "green" &&
        sug.body?.aiError === null,
      sug.body,
    );

    const sugBad = await api(empId, "POST", "/wallet/expense-categorize/suggest", {});
    check("suggest empty body 400", sugBad.status === 400, sugBad);

    // --- create with explicit pair ---
    const create = await api(empId, "POST", "/me/expenses", {
      merchant: `Emirates ${runTag}`,
      amount: 250,
      currency: "USD",
      contextType: "bd",
      categoryCode: "travel",
      subCategoryCode: "flights",
      bdIndustry: "Energy",
      fundingSource: "partner_paid",
    });
    check("create 201", create.status === 201, create);
    const exp1 = create.body?.expense;
    if (exp1?.id) expenseIds.push(exp1.id);
    check(
      "create persisted pair + manual source + funding",
      exp1?.categoryCode === "travel" &&
        exp1?.subCategoryCode === "flights" &&
        exp1?.categorySource === "manual" &&
        exp1?.fundingSource === "partner_paid" &&
        exp1?.bdIndustry === "Energy",
      exp1,
    );

    // --- bogus funding source ---
    const badFunding = await api(empId, "POST", "/me/expenses", {
      merchant: `Bad ${runTag}`,
      amount: 10,
      contextType: "bd",
      fundingSource: "petty_cash",
    });
    check("bogus fundingSource 400", badFunding.status === 400, badFunding);

    // --- company_account requires a registered bank account ---
    const noBank = await api(empId, "POST", "/me/expenses", {
      merchant: `Corp Card ${runTag}`,
      amount: 10,
      contextType: "bd",
      fundingSource: "company_account",
    });
    check(
      "company_account without bank 400",
      noBank.status === 400 && noBank.body?.error === "bank-account-required",
      noBank,
    );

    // --- internal attribution completeness ---
    const internal = await api(empId, "POST", "/me/expenses", {
      merchant: `Office Depot ${runTag}`,
      amount: 40,
      contextType: "internal",
      internalProjectLabel: "Office supplies",
      categoryCode: "office_admin",
      subCategoryCode: "office_supplies",
    });
    check("internal create 201", internal.status === 201, internal);
    const exp2 = internal.body?.expense;
    if (exp2?.id) expenseIds.push(exp2.id);

    const submitBlocked = await api(empId, "POST", `/me/expenses/${exp2?.id}/submit`, {});
    check(
      "internal submit blocked 409 attribution-incomplete",
      submitBlocked.status === 409 && submitBlocked.body?.error === "attribution-incomplete",
      submitBlocked,
    );

    const patched = await api(empId, "PATCH", `/me/expenses/${exp2?.id}`, {
      entityId,
      costCenter: "operations",
    });
    check(
      "patch entity+costCenter 200",
      patched.status === 200 &&
        patched.body?.expense?.entityId === entityId &&
        patched.body?.expense?.costCenter === "operations",
      patched,
    );

    const submitOk = await api(empId, "POST", `/me/expenses/${exp2?.id}/submit`, {});
    check(
      "internal submit ok after attribution",
      submitOk.status === 200 && submitOk.body?.expense?.status === "submitted",
      submitOk,
    );

    // --- cross-org isolation (regression: routes must scope by orgId) ---
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: "Probe383 Founder",
      initials: "PF",
      email: `${runTag}_fp@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    });
    await db.insert(atelierBankAccount).values({
      id: xBankId,
      orgId: xOrg,
      bankName: "Other Org Bank",
      accountLabel: "Other Org Operating",
      accountNumberLast4: "9999",
    } as any);
    await db.insert(atelierEngagements).values({
      id: xEngId,
      orgId: xOrg,
      slug: `x-${runTag}`,
      name: "Other Org Engagement",
      accountId: `acct_${runTag}_x`,
      plmStage: "deliver",
      partnerOwnerId: `u_${runTag}_xowner`,
      engagementLeadId: `u_${runTag}_xlead`,
      startDate: "2026-01-01",
      plannedEndDate: "2026-12-31",
    } as any);

    const xSig = await api(fpId, "PUT", `/wallet/bank/accounts/${xBankId}/signatories`, {
      signatories: [],
    });
    check("cross-org signatories PUT → 404", xSig.status === 404, xSig);
    const xMarkup = await api(fpId, "PATCH", `/wallet/engagements/${xEngId}/expense-markup`, {
      expenseMarkupPct: 10,
    });
    check("cross-org expense-markup PATCH → 404", xMarkup.status === 404, xMarkup);
    const xExport = await api(fpId, "GET", `/wallet/expenses/export?engagementId=${xEngId}&format=csv`);
    check("cross-org export → 404", xExport.status === 404, xExport);

    // Merchant memory is tenant-local: a trusted mapping in ANOTHER org must
    // not influence this org's suggestion (falls through to the stub AI).
    await db.insert(atelierMerchantCategoryMap).values({
      id: `merchmap_${runTag}_x`,
      orgId: xOrg,
      merchantKey: tx.normalizeMerchantKey(`XorgCafe ${runTag}`),
      merchantLabel: `XorgCafe ${runTag}`,
      categoryCode: "meals_entertainment",
      subCategoryCode: "team_meals",
      confirmCount: 99,
      lastConfirmedAt: new Date(),
      lastConfirmedByUserId: null,
    } as any);
    const xSug = await api(empId, "POST", "/wallet/expense-categorize/suggest", {
      merchant: `XorgCafe ${runTag}`,
      description: "Coffee",
    });
    check(
      "cross-org merchant memory ignored (suggest falls back to AI)",
      xSug.status === 200 && xSug.body?.suggestion?.source !== "merchant_memory",
      xSug,
    );

    // Taxonomy bank list is org-scoped: the other org's account must not leak.
    const tax2 = await api(empId, "GET", "/wallet/expense-taxonomy");
    check(
      "taxonomy bankAccounts array excludes other-org account",
      tax2.status === 200 &&
        Array.isArray(tax2.body?.bankAccounts) &&
        !tax2.body.bankAccounts.some((b: any) => b.id === xBankId),
      tax2.body?.bankAccounts,
    );

    // Cross-org approve/reject must 404, not act on another tenant's expense.
    const xExpId = `exp_${runTag}_x`;
    expenseIds.push(xExpId);
    await db.insert(atelierExpenses).values({
      id: xExpId,
      orgId: xOrg,
      personId: `u_${runTag}_xowner`,
      merchant: "Other Org Vendor",
      category: "other",
      amount: 10,
      currency: "USD",
      usdAmount: 10,
      expenseDate: "2026-07-01",
      status: "submitted",
      contextType: "internal",
      captureSource: "manual",
    } as any);
    const xApprove = await api(fpId, "POST", `/wallet/expenses/${xExpId}/approve`, {});
    check("cross-org approve → 404", xApprove.status === 404, xApprove);

    // Timesheet auto-approval uses DETERMINISTIC week ids (tsw_<person>_<week>),
    // so a same-shaped id in another org must never be approved by our approver.
    const xWeekId = `tsw_u_${runTag}_xowner_2026-W29`;
    await db
      .update(atelierExpenses)
      .set({ timesheetWeekId: xWeekId, policyStatus: "green", engagementId: xEngId })
      .where(eq(atelierExpenses.id, xExpId));
    const wallet = await import("../../src/routes/atelier/walletRoutes.js");
    const [fpRow] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, fpId));
    const autoRes = await wallet.autoApproveTimesheetExpenses(xWeekId, fpRow);
    const [xAfter] = await db
      .select()
      .from(atelierExpenses)
      .where(eq(atelierExpenses.id, xExpId));
    check(
      "cross-org timesheet auto-approve is a no-op",
      autoRes.approved === 0 && xAfter.status === "submitted",
      { autoRes, status: xAfter?.status },
    );
  } finally {
    try {
      if (expenseIds.length)
        await db.delete(atelierExpenses).where(inArray(atelierExpenses.id, expenseIds));
      await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, entityId));
      await db.delete(atelierBankAccount).where(eq(atelierBankAccount.id, xBankId));
      await db
        .delete(atelierMerchantCategoryMap)
        .where(eq(atelierMerchantCategoryMap.id, `merchmap_${runTag}_x`));
      await db.delete(atelierEngagements).where(eq(atelierEngagements.id, xEngId));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [empId, fpId]));
    } catch (err) {
      console.error("cleanup error", err);
    }
    server.close();
    stub.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("probe crashed", err);
  process.exit(1);
});
