/**
 * Task #1288 — engagement-aware client-invoice creation + draft repair.
 *
 * Covers:
 *   - /wallet/invoice-create-options gating + prefill derivation
 *   - POST /wallet/invoices with engagementId (account/billTo/jurisdiction/
 *     currency derived server-side)
 *   - PATCH /wallet/invoices/:id draft repair:
 *       · attach engagement to a bare (old-way) draft, billTo prefill
 *       · account-only draft → engagement of the SAME account (no confirm)
 *       · cross-account attach requires confirmAccountChange and atomically
 *         refreshes billTo/jurisdiction/currency/vatRatePct
 *       · reassignment blocked once lines exist
 *       · billTo edit; empty patch rejected
 *
 * Fixture-scoped and rerun-safe: all rows carry the PROBE tag and are
 * deleted in the finally block. Runs against the dev DB via NODE_ENV=test
 * persona-cookie bypass (see personaCookie.ts).
 */
import assert from "node:assert";
import { and, eq, isNull, like } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAccounts,
  atelierEngagements,
  atelierInvoice,
  atelierInvoiceLine,
} from "@workspace/db";

const TAG = "probe1288";

async function main(): Promise<void> {
  process.env.NODE_ENV = "test";
  const { default: app } = await import("../../src/app.js").then((m: any) => ({ default: m.app ?? m.default }));

  const users = await db.select().from(atelierUsers).where(isNull(atelierUsers.deletedAt));
  const founder = users.find((u) => u.role === "founding_partner");
  assert(founder, "founding partner persona required");
  const orgId = founder.orgId;

  // Two probe accounts in different jurisdictions.
  const acctA = `acct_${TAG}_ae`;
  const acctB = `acct_${TAG}_sa`;
  const engA = `eng_${TAG}_a`;
  const engB = `eng_${TAG}_b`;
  const invoiceIds: string[] = [];

  await db.insert(atelierAccounts).values([
    { id: acctA, orgId, name: "Probe1288 Emirates Co", country: "United Arab Emirates", countryCode: "AE", sector: "energy", primaryCurrency: "AED" },
    { id: acctB, orgId, name: "Probe1288 Riyadh Co", country: "Saudi Arabia", countryCode: "SA", sector: "energy", primaryCurrency: "SAR" },
  ]);
  await db.insert(atelierEngagements).values([
    { id: engA, orgId, slug: engA, name: "Probe1288 Eng A", accountId: acctA, plmStage: "deliver", partnerOwnerId: founder.id, engagementLeadId: founder.id, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
    { id: engB, orgId, slug: engB, name: "Probe1288 Eng B", accountId: acctB, plmStage: "deliver", partnerOwnerId: founder.id, engagementLeadId: founder.id, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
  ]);

  const server = app.listen(5128);
  await new Promise((r) => server.on("listening", r));
  const base = "http://localhost:5128/api/atelier";
  const H = (id: string) => ({ cookie: `atelier_persona=${id}`, "content-type": "application/json" });
  const F = H(founder.id);
  let pass = 0;
  const ok = (name: string, cond: unknown) => { assert(cond, name); pass++; console.log(`  ✓ ${name}`); };

  try {
    // ---- options + gating -------------------------------------------------
    const opts = await fetch(`${base}/wallet/invoice-create-options`, { headers: F }).then((r) => r.json());
    const oA = opts.engagements.find((e: any) => e.id === engA);
    ok("options include engagement with account-derived defaults",
      oA && oA.defaults.jurisdiction === "AE" && oA.defaults.currency === "AED" && oA.defaults.billToName === "Probe1288 Emirates Co");
    const employee = users.find((u) => u.role === "employee");
    if (employee) {
      const r = await fetch(`${base}/wallet/invoice-create-options`, { headers: H(employee.id) });
      ok("options 403 for non-finance roles", r.status === 403);
    }

    // ---- create with engagement -------------------------------------------
    const r1 = await fetch(`${base}/wallet/invoices`, { method: "POST", headers: F, body: JSON.stringify({ engagementId: engA }) });
    const c1 = await r1.json();
    invoiceIds.push(c1.invoice.id);
    ok("create w/engagement derives account + billTo + jurisdiction + currency",
      r1.status === 201 && c1.invoice.engagementId === engA && c1.invoice.accountId === acctA &&
      c1.invoice.billTo?.name === "Probe1288 Emirates Co" && c1.invoice.jurisdiction === "AE" && c1.invoice.currency === "AED" && c1.invoice.vatRatePct === 5);
    const comp = await fetch(`${base}/wallet/invoices/${c1.invoice.id}/compose`, { method: "POST", headers: F, body: "{}" });
    ok("compose works immediately on a fresh engagement draft", comp.status === 200);

    // ---- bare (old-way) draft repair --------------------------------------
    const r2 = await fetch(`${base}/wallet/invoices`, { method: "POST", headers: F, body: JSON.stringify({ jurisdiction: "AE", billTo: { name: "" } }) });
    const bare = (await r2.json()).invoice;
    invoiceIds.push(bare.id);
    const p1a = await fetch(`${base}/wallet/invoices/${bare.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engA }) });
    ok("bare draft: unconfirmed attach → 409 (unproven account context)", p1a.status === 409 && (await p1a.json()).error === "account_mismatch");
    const p1 = await fetch(`${base}/wallet/invoices/${bare.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engA, confirmAccountChange: true }) });
    const p1j = await p1.json();
    ok("bare draft: confirmed attach resets billing context from the account",
      p1.status === 200 && p1j.invoice.engagementId === engA && p1j.invoice.accountId === acctA && p1j.invoice.billTo?.name === "Probe1288 Emirates Co");

    // ---- account-only draft → same-account engagement (no confirm) --------
    const r3 = await fetch(`${base}/wallet/invoices`, { method: "POST", headers: F, body: JSON.stringify({ accountId: acctA }) });
    const acctOnly = (await r3.json()).invoice;
    invoiceIds.push(acctOnly.id);
    ok("account-only create derives billing context", acctOnly.accountId === acctA && acctOnly.jurisdiction === "AE" && acctOnly.currency === "AED");
    const p2 = await fetch(`${base}/wallet/invoices/${acctOnly.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engA }) });
    ok("same-account attach needs no confirmation", p2.status === 200 && (await p2.json()).invoice.engagementId === engA);

    // ---- cross-account attach: blocked, then confirmed refresh ------------
    const r4 = await fetch(`${base}/wallet/invoices`, { method: "POST", headers: F, body: JSON.stringify({ accountId: acctA }) });
    const crossInv = (await r4.json()).invoice;
    invoiceIds.push(crossInv.id);
    const p3 = await fetch(`${base}/wallet/invoices/${crossInv.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engB }) });
    ok("cross-account attach without confirm → 409 account_mismatch", p3.status === 409 && (await p3.json()).error === "account_mismatch");
    const p4 = await fetch(`${base}/wallet/invoices/${crossInv.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engB, confirmAccountChange: true }) });
    const p4j = await p4.json();
    ok("confirmed cross-account attach atomically refreshes billing context",
      p4.status === 200 && p4j.invoice.engagementId === engB && p4j.invoice.accountId === acctB &&
      p4j.invoice.billTo?.name === "Probe1288 Riyadh Co" && p4j.invoice.jurisdiction === "SA" &&
      p4j.invoice.currency === "SAR" && p4j.invoice.vatRatePct === 15);

    // ---- reassignment blocked once lines exist ----------------------------
    await fetch(`${base}/wallet/invoices/${crossInv.id}/lines`, { method: "POST", headers: F, body: JSON.stringify({ description: "Fee", qty: 1, unitPrice: 100 }) });
    const p5 = await fetch(`${base}/wallet/invoices/${crossInv.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engA, confirmAccountChange: true }) });
    ok("reassignment blocked once lines exist", p5.status === 400 && (await p5.json()).error === "invalid_state");

    // ---- populated accountless legacy draft -------------------------------
    const r5 = await fetch(`${base}/wallet/invoices`, { method: "POST", headers: F, body: JSON.stringify({ jurisdiction: "SA", billTo: { name: "Some Old Client LLC" } }) });
    const legacy = (await r5.json()).invoice;
    invoiceIds.push(legacy.id);
    const p8 = await fetch(`${base}/wallet/invoices/${legacy.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engA }) });
    ok("accountless legacy draft with Bill To: attach requires confirmation", p8.status === 409 && (await p8.json()).error === "account_mismatch");
    const p9 = await fetch(`${base}/wallet/invoices/${legacy.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engA, confirmAccountChange: true, billTo: { name: "Some Old Client LLC" } }) });
    ok("stale billTo cannot ride along with an account-context change", p9.status === 400);
    const p10 = await fetch(`${base}/wallet/invoices/${legacy.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ engagementId: engA, confirmAccountChange: true }) });
    const p10j = await p10.json();
    ok("confirmed legacy attach unconditionally resets billing context",
      p10.status === 200 && p10j.invoice.engagementId === engA && p10j.invoice.accountId === acctA &&
      p10j.invoice.billTo?.name === "Probe1288 Emirates Co" && p10j.invoice.jurisdiction === "AE" &&
      p10j.invoice.currency === "AED" && p10j.invoice.vatRatePct === 5);

    // ---- billTo edit + empty patch ----------------------------------------
    const p6 = await fetch(`${base}/wallet/invoices/${bare.id}`, { method: "PATCH", headers: F, body: JSON.stringify({ billTo: { name: "ACME Corp", contactEmail: "b@acme.com" } }) });
    ok("billTo edit persists", p6.status === 200 && (await p6.json()).invoice.billTo?.contactEmail === "b@acme.com");
    const p7 = await fetch(`${base}/wallet/invoices/${bare.id}`, { method: "PATCH", headers: F, body: "{}" });
    ok("empty patch rejected", p7.status === 400);

    console.log(`\nwallet-invoice-create: ${pass} checks passed`);
  } finally {
    server.close();
    for (const id of invoiceIds) {
      await db.delete(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, id));
      await db.delete(atelierInvoice).where(eq(atelierInvoice.id, id));
    }
    await db.delete(atelierInvoice).where(and(eq(atelierInvoice.orgId, orgId), like(atelierInvoice.accountId, `acct_${TAG}%`)));
    await db.delete(atelierEngagements).where(like(atelierEngagements.id, `eng_${TAG}%`));
    await db.delete(atelierAccounts).where(like(atelierAccounts.id, `acct_${TAG}%`));
  }
  process.exit(0);
}

main().catch((e) => { console.error("FAIL", e); process.exit(1); });
