/**
 * Task #1081 — chart-of-accounts auto-seed regression probe (scratch DB).
 *
 * Covers:
 *   - Fresh entity + Bookkeeper run: chart auto-seeds first, invoice
 *     posts cleanly (no missing_account / zero-posted run), exactly one
 *     gl.chart_seed audit entry attributed to the run.
 *   - Repeated runs: no duplicate accounts, no extra seed audits.
 *   - GET /gl/accounts and /gl/trial-balance on a chart-less entity
 *     auto-seed lazily (no empty chart for an active entity).
 *   - missing_account still fires for an unknown code on a seeded entity.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/gl-autoseed/run.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierLegalEntities, atelierInvoice,
    atelierGlAccount, atelierAuditEvents, atelierExpenses,
    atelierExpenseGlMappings, atelierGlPostingException,
  } = D;
  const { and, eq } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe1081_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${fpId}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };

  const accountCount = async (entityId: string) =>
    (await db.select({ id: atelierGlAccount.id }).from(atelierGlAccount)
      .where(and(eq(atelierGlAccount.orgId, "aico"), eq(atelierGlAccount.legalEntityId, entityId)))).length;
  const seedAudits = async (entityId: string) =>
    await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.entityType, "gl_account"),
      eq(atelierAuditEvents.entityId, entityId),
      eq(atelierAuditEvents.action, "gl.chart_seed"),
    ));

  try {
    await db.insert(atelierUsers).values({
      id: fpId, orgId: "aico", name: "Probe1081 Partner", initials: "PP",
      email: `${runTag}_fp@example.test`, role: "founding_partner",
      roleLabel: "Founding Partner", title: "Founding Partner",
    } as any);

    // Two fresh entities, no chart on either.
    const mkEntity = async (suffix: string) => {
      const id = `lent_${runTag}_${suffix}`;
      await db.insert(atelierLegalEntities).values({
        id, orgId: "aico", legalNameEn: `Probe1081 ${suffix.toUpperCase()} LLC`,
        shortName: `P1081-${suffix}`, country: "AE", legalForm: "LLC",
        jurisdiction: "DIFC", baseCurrency: "USD", status: "active",
      } as any);
      return id;
    };
    const entA = await mkEntity("a"); // exercised via Bookkeeper run
    const entB = await mkEntity("b"); // exercised via GL reads

    // Invoice issued in-period, tagged to entity A.
    const period = "2026-07";
    await db.insert(atelierInvoice).values({
      id: `inv_${runTag}`, orgId: "aico", legalEntityId: entA,
      jurisdiction: "DIFC", invoiceNumber: `INV-${runTag}`, currency: "USD",
      status: "issued", subtotal: 1000, vatAmount: 50, total: 1050,
      issuedAt: new Date(`${period}-10T00:00:00Z`),
    } as any);

    check("entity A starts with no chart", (await accountCount(entA)) === 0);

    // ---- 1. Bookkeeper run auto-seeds + posts ----
    const run1 = await api("POST", "/gl/bookkeeper/run", { periodLabel: period, entityId: entA });
    check("bookkeeper run 1 -> 200", run1.status === 200, run1);
    check("run 1 posted the invoice", (run1.body?.data?.entriesCreated ?? 0) >= 1, run1.body?.data);
    const exc1 = (run1.body?.data?.exceptions ?? []).filter((x: any) => x.code === "missing_account");
    check("run 1 has no missing_account exceptions", exc1.length === 0, exc1);
    const countA1 = await accountCount(entA);
    check("run 1 seeded the default chart", countA1 >= 30, countA1);
    const audits1 = await seedAudits(entA);
    check("exactly one gl.chart_seed audit for entity A", audits1.length === 1, audits1.length);
    check("seed audit attributed to the agent run", audits1[0]?.actorType === "agent", audits1[0]?.actorType);

    // ---- 2. Repeated run: idempotent ----
    const run2 = await api("POST", "/gl/bookkeeper/run", { periodLabel: period, entityId: entA });
    check("bookkeeper run 2 -> 200", run2.status === 200, run2);
    check("run 2 skips the already-posted invoice", (run2.body?.data?.entriesSkippedExisting ?? 0) >= 1, run2.body?.data);
    check("run 2 does not duplicate accounts", (await accountCount(entA)) === countA1, await accountCount(entA));
    check("run 2 adds no extra seed audit", (await seedAudits(entA)).length === 1);

    // ---- 3. GL reads lazily seed ----
    check("entity B starts with no chart", (await accountCount(entB)) === 0);
    const acctsB = await api("GET", `/gl/accounts?entityId=${entB}`);
    check("GET /gl/accounts -> 200", acctsB.status === 200, acctsB.status);
    const rowsB = (acctsB.body?.data?.rows ?? []).filter((r: any) => r.legalEntityId === entB);
    check("chart read auto-seeds entity B", rowsB.length >= 30, rowsB.length);
    check("one gl.chart_seed audit for entity B", (await seedAudits(entB)).length === 1);
    const acctsB2 = await api("GET", `/gl/accounts?entityId=${entB}`);
    const rowsB2 = (acctsB2.body?.data?.rows ?? []).filter((r: any) => r.legalEntityId === entB);
    check("second read does not duplicate accounts", rowsB2.length === rowsB.length, rowsB2.length);
    check("second read adds no extra seed audit", (await seedAudits(entB)).length === 1);
    const tb = await api("GET", `/gl/trial-balance?entityId=${entB}&period=${period}`);
    check("trial balance read -> 200", tb.status === 200, tb.status);

    // ---- 4. missing_account still fires on a seeded entity ----
    await db.insert(atelierExpenseGlMappings).values({
      id: `glmap_${runTag}`, orgId: "aico", entityId: entA,
      subCategoryCode: `bogus_${runTag}`, glCode: "9999",
    } as any);
    await db.insert(atelierExpenses).values({
      id: `exp_${runTag}`, orgId: "aico", personId: fpId,
      expenseDate: `${period}-12`, captureSource: "manual",
      merchant: "Bogus Merchant", category: "other",
      subCategoryCode: `bogus_${runTag}`, entityId: entA,
      amount: 100, currency: "USD", usdAmount: 100, status: "approved",
      approvedAt: new Date(`${period}-12T00:00:00Z`),
    } as any);
    const run3 = await api("POST", "/gl/bookkeeper/run", { periodLabel: period, entityId: entA });
    check("bookkeeper run 3 -> 200", run3.status === 200, run3);
    const miss = (run3.body?.data?.exceptions ?? []).filter((x: any) => x.code === "missing_account");
    check("unknown code 9999 raises missing_account", miss.length === 1, run3.body?.data?.exceptions);
    check("run 3 adds no extra seed audit", (await seedAudits(entA)).length === 1);
    const excRows = await db.select().from(atelierGlPostingException).where(and(
      eq(atelierGlPostingException.orgId, "aico"),
      eq(atelierGlPostingException.code, "missing_account"),
      eq(atelierGlPostingException.legalEntityId, entA),
    ));
    check("missing_account exception row persisted", excRows.length >= 1, excRows.length);
  } finally {
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
