// Scratch DB bootstrap must run before any @workspace/db import.
import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";

process.env.NODE_ENV = "test";
const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const orgId = `finance_mvp_${stamp}`;
const partnerId = `finance_mvp_partner_${stamp}`;
const recruiterId = `finance_mvp_recruiter_${stamp}`;
const accountId = `finance_mvp_account_${stamp}`;
const engagementId = `finance_mvp_engagement_${stamp}`;
const expenseOnlyEngagementId = `finance_mvp_expense_only_${stamp}`;
const entityA = `finance_mvp_entity_a_${stamp}`;
const entityB = `finance_mvp_entity_b_${stamp}`;
const date = "2025-02";

const D = await import("@workspace/db");
const {
  db, pool, atelierUsers, atelierAccounts, atelierEngagements, atelierExpenses,
  atelierPartnerFirmInvoices,
} = D;
const app = (await import("../../src/app.js")).default;
const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", resolve));
const { port } = server.address() as AddressInfo;
const endpoint = `http://127.0.0.1:${port}/api/atelier/finance/mvp/summary`;

const user = {
  orgId, email: `${partnerId}@example.com`, name: "Finance MVP tester",
  initials: "FM", role: "founding_partner", roleLabel: "Founding Partner",
  title: "Founding Partner", permissions: [], bdActive: false,
};
const engagement = (id: string, name: string) => ({
  id, orgId, slug: id, name, accountId, plmStage: "deliver",
  partnerOwnerId: partnerId, engagementLeadId: partnerId,
  startDate: "2025-01-01", plannedEndDate: "2025-12-31",
});
const expense = (id: string, engagementId: string, amount: number, currency: string, entityId: string) => ({
  id, orgId, personId: partnerId, personType: "employee", engagementId,
  expenseDate: "2025-02-10", captureSource: "manual", category: "other",
  amount, currency, fxRate: 1, usdAmount: amount, vatAmount: 0,
  clientBillable: true, status: "approved", entityId,
});

async function get(cookie: string, query = "") {
  const response = await fetch(`${endpoint}?dimension=month&period=${date}${query}`, {
    headers: { cookie: `atelier_persona=${cookie}` },
  });
  return { status: response.status, body: await response.json() as any };
}
function amount(metric: any, currency: string): number {
  return metric.buckets.find((bucket: any) => bucket.currency === currency)?.amount ?? 0;
}

try {
  await db.insert(atelierUsers).values([
    { id: partnerId, ...user },
    { id: recruiterId, ...user, email: `${recruiterId}@example.com`, role: "recruiter", roleLabel: "Recruiter" },
  ]);
  await db.insert(atelierAccounts).values({
    id: accountId, orgId, name: "Finance MVP client", country: "AE", sector: "Technology",
  });
  await db.insert(atelierEngagements).values([
    engagement(engagementId, "Mixed currency project"),
    engagement(expenseOnlyEngagementId, "Expense-only project"),
  ]);
  await db.insert(atelierExpenses).values([
    expense(`expense_a_${stamp}`, engagementId, 20, "USD", entityA),
    expense(`expense_b_${stamp}`, engagementId, 99, "USD", entityB),
    expense(`expense_eur_${stamp}`, engagementId, 10, "EUR", entityA),
    expense(`expense_only_${stamp}`, expenseOnlyEngagementId, 30, "GBP", entityA),
  ]);
  await db.insert(atelierPartnerFirmInvoices).values({
    id: `supplier_${stamp}`, orgId, partnerFirmId: "supplier", partnerFirmName: "Supplier",
    engagementId, legalEntityId: entityA, weekIso: "2025-W07", hours: 1,
    costAmount: 40, costCurrency: "USD", fxRate: 1, usdAmount: 40,
    status: "approved", source: "partner_submitted", invoiceDate: "2025-02-12",
  });

  assert.equal((await get(recruiterId)).status, 403, "restricted persona must be forbidden");

  const empty = await get(partnerId, `&entityId=unused_${stamp}`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.revenue.buckets, []);
  assert.deepEqual(empty.body.projectClientGrossMargin, []);

  const filtered = await get(partnerId, `&entityId=${entityA}`);
  assert.equal(filtered.status, 200);
  assert.equal(amount(filtered.body.directCosts, "USD"), 60, "supplier bill + entity A expense");
  assert.equal(amount(filtered.body.directCosts, "EUR"), 10);
  assert.equal(amount(filtered.body.directCosts, "GBP"), 30);
  assert.equal(amount(filtered.body.netResult, "GBP"), -30, "cost-only currency is negative");
  assert.equal(filtered.body.projectClientGrossMargin.length, 2, "expense-only project is represented");
  const mixed = filtered.body.projectClientGrossMargin.find((p: any) => p.projectId === engagementId);
  assert.ok(mixed);
  assert.equal(mixed.grossMarginPct, null, "mixed currencies are not compared without display conversion");
  assert.equal(amount(mixed.directCosts, "USD"), 60);
  assert.equal(amount(mixed.directCosts, "EUR"), 10);
  assert.equal(amount(mixed.grossMargin, "EUR"), -10);
  assert.equal(filtered.body.projectClientGrossMargin.find((p: any) => p.projectId === expenseOnlyEngagementId).grossMarginPct, 0);

  const all = await get(partnerId);
  assert.equal(amount(all.body.directCosts, "USD"), 159, "entity B is included in overall aggregate");
  console.log("finance MVP summary scratch API probes passed");
} finally {
  await db.delete(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.orgId, orgId));
  await db.delete(atelierExpenses).where(eq(atelierExpenses.orgId, orgId));
  await db.delete(atelierEngagements).where(eq(atelierEngagements.orgId, orgId));
  await db.delete(atelierAccounts).where(eq(atelierAccounts.orgId, orgId));
  await db.delete(atelierUsers).where(eq(atelierUsers.orgId, orgId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}