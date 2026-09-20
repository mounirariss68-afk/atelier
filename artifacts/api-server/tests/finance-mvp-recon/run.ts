/**
 * Finance MVP generic bank-match API probe.
 *
 * This intentionally exercises the scratch database through HTTP, including
 * tenant/entity validation and the second validation pass at approval time.
 */
import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";

process.env.NODE_ENV = "test";
const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const orgId = `recon_org_${stamp}`;
const otherOrgId = `recon_other_${stamp}`;
const entityA = `recon_entity_a_${stamp}`;
const entityB = `recon_entity_b_${stamp}`;
const bankId = `recon_bank_${stamp}`;
const importId = `recon_import_${stamp}`;
const partnerId = `recon_partner_${stamp}`;
const financeId = `recon_finance_${stamp}`;
const foreignExpenseId = `recon_foreign_expense_${stamp}`;
const expenseId = `recon_expense_${stamp}`;
const fundingId = `recon_funding_${stamp}`;
const mismatchedFundingId = `recon_funding_mismatch_${stamp}`;
const foreignFundingId = `recon_funding_foreign_${stamp}`;

const D = await import("@workspace/db");
const {
  db, pool, atelierUsers, atelierBankAccount, atelierBankStatementImport,
  atelierBankTransaction, atelierBankReconPeriod, atelierExpenses,
  atelierShareholderFunding,
} = D;

const seed = (await db.select().from(atelierUsers).where(eq(atelierUsers.role, "founding_partner")))[0];
if (!seed) throw new Error("scratch boot did not seed a founding partner");
const user = {
  orgId, email: `${partnerId}@test.invalid`, name: "Recon Partner",
  initials: "RP", role: "founding_partner", roleLabel: "Founding Partner",
  title: "Founding Partner", permissions: [], bdActive: false,
};
await db.insert(atelierUsers).values([
  { ...user, id: partnerId },
  { ...user, id: financeId, email: `${financeId}@test.invalid`, name: "Recon Finance", role: "finance", roleLabel: "Finance" },
  { ...user, id: `recon_other_user_${stamp}`, orgId: otherOrgId, email: `other_${stamp}@test.invalid` },
]);

const tx = (id: string, date = "2099-08-15") => ({
  id, orgId, bankAccountId: bankId, statementImportId: importId,
  postedDate: date, amount: 100, currency: "USD", kind: "payment",
});

await db.insert(atelierBankAccount).values({
  id: bankId, orgId, bankName: "Test Bank", accountLabel: "Recon",
  accountNumberLast4: "1234", currency: "USD",
});
await db.insert(atelierBankStatementImport).values({
  id: importId, orgId, bankAccountId: bankId, statementDate: "2099-08-31",
  source: "csv", fileHash: `hash_${stamp}`, rowsCount: 1,
});
await db.insert(atelierBankTransaction).values([
  tx(`recon_txn_fabricated_${stamp}`),
  { ...tx(`recon_txn_expense_${stamp}`), legalEntityId: entityA },
  { ...tx(`recon_txn_funding_${stamp}`), legalEntityId: entityA },
  { ...tx(`recon_txn_deleted_${stamp}`), legalEntityId: entityA },
  tx(`recon_txn_locked_${stamp}`, "2099-09-15"),
]);
await db.insert(atelierExpenses).values([
  {
    id: expenseId, orgId, personId: partnerId, personType: "employee",
    expenseDate: "2099-08-10", captureSource: "manual", category: "other",
    amount: 100, currency: "USD", fxRate: 1, usdAmount: 100, vatAmount: 0,
    clientBillable: false, status: "approved", entityId: entityB,
  },
  {
    id: foreignExpenseId, orgId: otherOrgId, personId: partnerId, personType: "employee",
    expenseDate: "2099-08-10", captureSource: "manual", category: "other",
    amount: 100, currency: "USD", fxRate: 1, usdAmount: 100, vatAmount: 0,
    clientBillable: false, status: "approved", entityId: entityA,
  },
]);
await db.insert(atelierShareholderFunding).values([
  {
    id: fundingId, orgId, entityId: entityA, entryType: "contribution",
    contributionId: fundingId, contributionType: "equity", contributorName: "Founder",
    amount: 100, currency: "USD", transactionDate: "2099-08-10", periodLabel: "2099-08",
    idempotencyKey: `recon-funding-${stamp}`,
  },
  {
    id: mismatchedFundingId, orgId, entityId: entityB, entryType: "contribution",
    contributionId: mismatchedFundingId, contributionType: "equity", contributorName: "Founder",
    amount: 100, currency: "USD", transactionDate: "2099-08-10", periodLabel: "2099-08",
    idempotencyKey: `recon-funding-mismatch-${stamp}`,
  },
  {
    id: foreignFundingId, orgId: otherOrgId, entityId: entityA, entryType: "contribution",
    contributionId: foreignFundingId, contributionType: "equity", contributorName: "Founder",
    amount: 100, currency: "USD", transactionDate: "2099-08-10", periodLabel: "2099-08",
    idempotencyKey: `recon-funding-foreign-${stamp}`,
  },
]);
await db.insert(atelierBankReconPeriod).values({
  id: `recon_period_locked_${stamp}`, orgId, bankAccountId: bankId,
  periodLabel: "2099-09", periodStart: "2099-09-01", periodEnd: "2099-09-30",
  status: "finalised", finalisedByUserId: partnerId, approvedByUserId: partnerId,
});

const app = (await import("../../src/app.js")).default;
const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", resolve));
const port = (server.address() as AddressInfo).port;
const endpoint = `http://127.0.0.1:${port}/api/atelier/wallet/bank`;
async function call(path: string, persona: string, body: Record<string, unknown>) {
  const response = await fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
}
const match = (id: string, kind: string, refId: string) => call(
  `/transactions/${id}/match`, financeId,
  { matchedRefKind: kind, matchedRefId: refId, evidence: { source: "test" } },
);

try {
  assert.equal((await match(`recon_txn_fabricated_${stamp}`, "expense", "does-not-exist")).status, 400);
  assert.equal((await match(`recon_txn_expense_${stamp}`, "expense", foreignExpenseId)).status, 400);
  assert.equal((await match(`recon_txn_expense_${stamp}`, "expense", expenseId)).status, 400, "entity mismatch");
  assert.equal((await match(`recon_txn_funding_${stamp}`, "shareholder_contribution", "missing")).status, 400);
  assert.equal((await match(`recon_txn_funding_${stamp}`, "shareholder_contribution", foreignFundingId)).status, 400);
  assert.equal((await match(`recon_txn_funding_${stamp}`, "shareholder_contribution", mismatchedFundingId)).status, 400, "funding entity mismatch");
  assert.equal((await match(`recon_txn_funding_${stamp}`, "shareholder_contribution", fundingId)).status, 202);

  const deletedProposal = await match(`recon_txn_deleted_${stamp}`, "shareholder_contribution", fundingId);
  assert.equal(deletedProposal.status, 202);
  await db.update(atelierShareholderFunding).set({ deletedAt: new Date() }).where(eq(atelierShareholderFunding.id, fundingId));
  assert.equal((await call(`/transactions/recon_txn_deleted_${stamp}/match/approve`, partnerId, {})).status, 409);
  // Restore the reference for the independent successful approval assertion.
  await db.update(atelierShareholderFunding).set({ deletedAt: null }).where(eq(atelierShareholderFunding.id, fundingId));
  assert.equal((await call(`/transactions/recon_txn_funding_${stamp}/match/approve`, partnerId, {})).status, 200);
  const [approved] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, `recon_txn_funding_${stamp}`));
  assert.equal(approved.matchedState, "matched");
  assert.equal((await match(`recon_txn_locked_${stamp}`, "shareholder_contribution", fundingId)).status, 409);
  console.log("finance MVP reconciliation scratch API probes passed");
} finally {
  await db.delete(atelierBankReconPeriod).where(eq(atelierBankReconPeriod.orgId, orgId));
  await db.delete(atelierBankTransaction).where(eq(atelierBankTransaction.orgId, orgId));
  await db.delete(atelierBankStatementImport).where(eq(atelierBankStatementImport.orgId, orgId));
  await db.delete(atelierBankAccount).where(eq(atelierBankAccount.orgId, orgId));
  await db.delete(atelierExpenses).where(eq(atelierExpenses.id, expenseId));
  await db.delete(atelierShareholderFunding).where(eq(atelierShareholderFunding.orgId, orgId));
  await db.delete(atelierUsers).where(and(eq(atelierUsers.orgId, orgId), eq(atelierUsers.id, partnerId)));
  await db.delete(atelierUsers).where(eq(atelierUsers.id, financeId));
  await db.delete(atelierUsers).where(eq(atelierUsers.orgId, otherOrgId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}