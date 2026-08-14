/**
 * Task #1079 — orphaned-invoice guard probe.
 *
 * Seeds three issued invoices on the scratch DB:
 *   - "legit"     → accountId points at an existing account
 *   - "accountless" → accountId NULL (legacy/manual rows stay visible)
 *   - "orphan"    → accountId points at a non-existent account
 *
 * Asserts the orphan is invisible on every guarded surface:
 *   1. GET /wallet/invoices (Bill & Collect list) omits it
 *   2. GET /wallet/invoices/:id (detail) 404s for it, 200s for the others
 *   3. runBookkeeper source scan skips it (sourcesScanned + no exception)
 *   4. Collections agent scan skips it (invoicesScanned)
 *
 * Run: NODE_ENV=test pnpm --filter @workspace/api-server exec tsx tests/crm/orphan-invoice-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail ?? ""); }
}

async function main() {
  const { db, atelierUsers, atelierAccounts, atelierInvoice } = await import("@workspace/db");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const { runBookkeeper } = await import("../../src/lib/atelier-agents/bookkeeper.js");
  const { runCollectionsAgent } = await import("../../src/lib/atelier-agents/collections.js");

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;

  const tag = `p1079_${Date.now().toString(36)}`;
  const fpId = `u_${tag}_fp`;
  await db.insert(atelierUsers).values({
    id: fpId, orgId: "aico", name: "P1079 Partner", initials: "PP",
    email: `${tag}_fp@example.test`, role: "founding_partner",
    roleLabel: "Founding Partner", title: "Founding Partner",
  } as never);

  const acctId = `acct_${tag}`;
  await db.insert(atelierAccounts).values({
    id: acctId, orgId: "aico", name: `P1079 Client ${tag}`, country: "AE", sector: "Technology",
  } as never);

  const mkInv = (suffix: string, accountId: string | null) => ({
    id: `inv_${tag}_${suffix}`, orgId: "aico", accountId,
    jurisdiction: "GLOBAL", currency: "USD", status: "issued",
    subtotal: 1000, vatAmount: 0, total: 1000, amountPaid: 0,
    issuedAt: new Date("2026-08-01T12:00:00Z"),
  });
  const legit = mkInv("legit", acctId);
  const noacct = mkInv("noacct", null);
  const orphan = mkInv("orphan", `acct_${tag}_deleted`);
  await db.insert(atelierInvoice).values([legit, noacct, orphan] as never);

  const get = (path: string) =>
    fetch(`${BASE}${path}`, { headers: { cookie: `atelier_persona=${fpId}` } });

  try {
    // 1. Bill & Collect list
    const list = await (await get("/wallet/invoices")).json() as { invoices: Array<{ id: string }> };
    const ids = new Set((list.invoices ?? []).map((i) => i.id));
    check("list shows invoice with live account", ids.has(legit.id));
    check("list shows account-less invoice", ids.has(noacct.id));
    check("list hides orphaned invoice", !ids.has(orphan.id), [...ids]);

    // 2. Detail
    check("detail 200 for live-account invoice", (await get(`/wallet/invoices/${legit.id}`)).status === 200);
    check("detail 200 for account-less invoice", (await get(`/wallet/invoices/${noacct.id}`)).status === 200);
    check("detail 404 for orphaned invoice", (await get(`/wallet/invoices/${orphan.id}`)).status === 404);

    // 3. Bookkeeper source scan — assert only on THIS run's tagged fixtures
    //    (rerun-safe on a reused scratch DB). With no active legal entities,
    //    every scanned issued invoice surfaces as an untagged_entity
    //    exception, so exception sourceRefs are a faithful scan roster.
    const bk = await runBookkeeper({
      orgId: "aico", input: { periodLabel: "2026-08" }, triggeredByUserId: fpId,
    });
    const scanned = new Set(bk.output.exceptions.map((e) => e.sourceRef));
    check("bookkeeper scans the live-account invoice", scanned.has(legit.id), bk.output.exceptions);
    check("bookkeeper scans the account-less invoice", scanned.has(noacct.id), bk.output.exceptions);
    check("bookkeeper skips the orphaned invoice", !scanned.has(orphan.id), bk.output.exceptions);

    // 4. Collections scan — scope each run to a single fixture invoice so
    //    counts are independent of any leftovers on the scratch DB.
    const colOrphan = await runCollectionsAgent({
      orgId: "aico", input: { invoiceId: orphan.id }, triggeredByUserId: fpId,
    });
    check("collections skips the orphaned invoice", colOrphan.output.invoicesScanned === 0, colOrphan.output);
    const colLegit = await runCollectionsAgent({
      orgId: "aico", input: { invoiceId: legit.id }, triggeredByUserId: fpId,
    });
    check("collections scans the live-account invoice", colLegit.output.invoicesScanned === 1, colLegit.output);
  } finally {
    // Teardown: remove this run's fixtures so reruns on a reused scratch DB
    // stay deterministic.
    const { eq, inArray } = await import("drizzle-orm");
    await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, [legit.id, noacct.id, orphan.id]));
    await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, fpId));
    server.close();
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
