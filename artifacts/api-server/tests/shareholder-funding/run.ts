/**
 * Finance MVP shareholder-funding integration probe.
 *
 * The scratch-db bootstrap must remain the first import: it creates and
 * migrates an isolated database before @workspace/db binds its pool.
 */
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";

const stamp = Date.now();
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) console.log(`  ✓ ${label}`);
  else { failures.push(label); console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierLegalEntities, atelierDocuments,
    atelierPeriodCloseLock, atelierShareholderFunding } = D as any;
  const seed = (await db.select().from(atelierUsers).where(eq(atelierUsers.role, "founding_partner")))[0];
  const finance = (await db.select().from(atelierUsers).where(eq(atelierUsers.role, "finance")))[0] ?? seed;
  if (!seed) throw new Error("scratch boot did not seed a founding partner");
  const fp = `p_test_fund_fp_${stamp}`;
  const other = `p_test_fund_other_${stamp}`;
  await db.insert(atelierUsers).values({
    ...seed, id: other, orgId: `org_other_${stamp}`, email: `${other}@test.invalid`,
    name: "Other Org Partner", initials: "OO",
  });
  const entity = `lent_test_fund_${stamp}`;
  const siblingEntity = `lent_test_fund_sibling_${stamp}`;
  const otherEntity = `lent_test_fund_other_${stamp}`;
  const entityValues = (id: string, orgId: string, status = "planned") => ({
    id, orgId, legalNameEn: `Funding Test ${id}`, shortName: id, legalForm: "LLC",
    country: "AE", jurisdiction: "Dubai", status, baseCurrency: "AED",
    registeredAddress: "", officeAddress: "", governingLaw: "", courts: "",
    registrations: [], activities: [], owners: [], isHeadEntity: false,
  });
  await db.insert(atelierLegalEntities).values([
    entityValues(entity, seed.orgId),
    entityValues(siblingEntity, seed.orgId),
    entityValues(otherEntity, `org_other_${stamp}`),
  ]);
  const doc = `doc_test_fund_${stamp}`;
  await db.insert(atelierDocuments).values({
    id: doc, orgId: seed.orgId, entityId: entity, title: "Funding evidence",
    uploaderUserId: seed.id, uploaderLabel: seed.name,
  });
  const bankRef = `bnktxn_foreign_${stamp}`;
  const period = "2099-01";
  const historicalLockId = `lock_test_fund_root_${stamp}`;
  await db.insert(atelierPeriodCloseLock).values({
    id: `lock_test_fund_${stamp}`, orgId: seed.orgId, periodLabel: period,
    lockedModules: ["finance_mvp"], lockedByUserId: seed.id,
  });

  const app = (await import("../../src/app.js")).default;
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  async function call(method: string, path: string, persona: string, body?: Record<string, unknown>) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  }
  const create = (key: string, extra: Record<string, unknown> = {}) => call(
    "POST", "/finance/shareholder-funding", seed.id, {
      entityId: entity, contributionType: "shareholder_loan", contributorName: "Founder",
      amount: 1000, currency: "AED", transactionDate: "2099-01-10", periodLabel: period,
      sourceDocumentId: doc, idempotencyKey: key, ...extra,
    });

  try {
    console.log("\n── shareholder funding lifecycle");
    const entities = await call("GET", "/finance/entities", seed.id);
    check("planned entity is accepted and listed", entities.status === 200 && entities.body.items.some((x: any) => x.id === entity && x.status === "planned"));
    const created = await create(`fund-key-${stamp}`);
    check("create is rejected in locked period", created.status === 409 && created.body.error === "period_locked");

    // Use an unlocked period for lifecycle assertions.
    const first = await create(`fund-key-live-${stamp}`, { periodLabel: "2099-02", transactionDate: "2099-02-10" });
    check("create succeeds", first.status === 201, JSON.stringify(first.body));
    const id = first.body?.contribution?.id;
    const replay = await create(`fund-key-live-${stamp}`, { amount: 999 });
    check("idempotent replay returns original row", replay.status === 200 && replay.body.idempotent === true && replay.body.contribution?.amount === 1000);
    const foreignEntity = await call("POST", "/finance/shareholder-funding", seed.id, {
      entityId: siblingEntity, contributionType: "equity", contributorName: "Founder", amount: 1,
      currency: "AED", transactionDate: "2099-02-10", idempotencyKey: `other-entity-${stamp}`,
    });
    check("same-org entity scope permits a valid distinct entity", foreignEntity.status === 201, JSON.stringify(foreignEntity.body));
    const otherOrg = await call("GET", "/finance/shareholder-funding", other);
    check("other org cannot see tenant rows", otherOrg.status === 200 && otherOrg.body.items.every((x: any) => x.orgId !== seed.orgId));
    const confirmed = await call("POST", `/finance/shareholder-funding/${id}/confirm`, seed.id);
    check("confirm succeeds", confirmed.status === 200 && confirmed.body.contribution.status === "confirmed");
    await db.insert(atelierPeriodCloseLock).values({
      id: historicalLockId, orgId: seed.orgId, periodLabel: "2099-02",
      lockedModules: ["finance_mvp"], lockedByUserId: seed.id,
    });
    const partial = await call("POST", `/finance/shareholder-funding/${id}/repay`, seed.id, {
      amount: 400, reason: "Partial repayment", transactionDate: "2099-04-10",
      idempotencyKey: `repay-${stamp}`,
    });
    check("later-period repayment succeeds despite historical root lock",
      partial.status === 201 && partial.body.status === "partially_repaid", JSON.stringify(partial.body));
    const concurrent = await Promise.all([
      call("POST", `/finance/shareholder-funding/${id}/repay`, seed.id, {
        amount: 400, reason: "Concurrent repayment A", transactionDate: "2099-05-10",
        idempotencyKey: `concurrent-a-${stamp}`,
      }),
      call("POST", `/finance/shareholder-funding/${id}/repay`, seed.id, {
        amount: 400, reason: "Concurrent repayment B", transactionDate: "2099-05-10",
        idempotencyKey: `concurrent-b-${stamp}`,
      }),
    ]);
    const concurrentSuccesses = concurrent.filter((x) => x.status === 201).length;
    check("concurrent repayments allow exactly one success", concurrentSuccesses === 1,
      concurrent.map((x) => `${x.status}:${JSON.stringify(x.body)}`).join(" | "));
    const childrenAfterConcurrent = await db.select().from(atelierShareholderFunding).where(and(
      eq(atelierShareholderFunding.contributionId, id),
      inArray(atelierShareholderFunding.entryType, ["repayment", "reversal"]),
    ));
    check("concurrent offsets never exceed original amount",
      childrenAfterConcurrent.reduce((sum: number, x: any) => sum + x.amount, 0) <= 1000.000001);
    const reversal = await call("POST", `/finance/shareholder-funding/${id}/reverse`, seed.id, {
      amount: 100, reason: "Correction", transactionDate: "2099-06-10",
      idempotencyKey: `reverse-${stamp}`,
    });
    check("reversal appends without deleting original", reversal.status === 201 && reversal.body.entry?.status === "reversed", JSON.stringify(reversal.body));
    const detail = await call("GET", `/finance/shareholder-funding/${id}`, seed.id);
    check("history retains root + repayments + reversal", detail.status === 200 && detail.body.entries.length === 4 &&
      detail.body.entries.map((x: any) => x.entryType).join(",") === "contribution,repayment,repayment,reversal");
    const badDoc = await call("POST", "/finance/shareholder-funding", seed.id, {
      entityId: entity, contributionType: "equity", contributorName: "Founder", amount: 2,
      currency: "AED", transactionDate: "2099-07-11", sourceDocumentId: "doc-not-ours",
      idempotencyKey: `bad-doc-${stamp}`,
    });
    check("foreign/missing document evidence is rejected", badDoc.status === 400);
    const badBank = await call("POST", "/finance/shareholder-funding", seed.id, {
      entityId: entity, contributionType: "equity", contributorName: "Founder", amount: 2,
      currency: "AED", transactionDate: "2099-07-11", bankTransactionId: bankRef,
      idempotencyKey: `bad-bank-${stamp}`,
    });
    check("foreign/missing bank evidence is rejected", badBank.status === 400,
      `route currently returned ${badBank.status}; bank reference validation may be missing`);
    const [rows] = await Promise.all([
      db.select().from(atelierShareholderFunding).where(eq(atelierShareholderFunding.contributionId, id)),
    ]);
    check("append-only rows remain present", rows.length === 4);
  } finally {
    server.close();
    await db.delete(atelierShareholderFunding).where(eq(atelierShareholderFunding.orgId, seed.orgId));
    await db.delete(atelierPeriodCloseLock).where(eq(atelierPeriodCloseLock.id, historicalLockId));
    await db.delete(atelierPeriodCloseLock).where(eq(atelierPeriodCloseLock.id, `lock_test_fund_${stamp}`));
    await db.delete(atelierDocuments).where(eq(atelierDocuments.id, doc));
    await db.delete(atelierLegalEntities).where(inArray(atelierLegalEntities.id, [entity, siblingEntity, otherEntity]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [other]));
    await pool.end();
  }
  if (failures.length) {
    console.error(`\n${failures.length} shareholder-funding assertion(s) failed.`);
    process.exitCode = 1;
  } else console.log("\nAll shareholder-funding assertions passed.");
}
main().catch((err) => { console.error(err); process.exitCode = 1; });