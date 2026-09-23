/**
 * Task #1422 — deterministic prototype tracker API probe.
 * Uses POST /prototypes (never the AI-backed Forge endpoint).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail ?? ""); }
};

async function main() {
  const D = await import("@workspace/db") as any;
  const { db, pool, atelierUsers, atelierAccounts, atelierOpportunities, atelierEngagements,
    atelierPrototypes, atelierVendorCostSplits, atelierVendorProjectMap, atelierPartnerFirmInvoices,
    atelierAuditEvents } = D;
  const { and, eq, inArray } = await import("drizzle-orm");
  const stamp = Date.now(), org = "aico";
  const fp = `pt_fp_${stamp}`, consultant = `pt_con_${stamp}`, senior = `pt_senior_${stamp}`, otherOrg = `pt_other_${stamp}`;
  const account = `pt_acc_${stamp}`, opp = `pt_opp_${stamp}`, opp2 = `pt_opp2_${stamp}`, linked = `pt_eng_${stamp}`, unrelated = `pt_badeng_${stamp}`;
  const base = { orgId: org, createdByUserId: fp };
  const user = (id: string, role: string, userOrg = org) => ({
    id, orgId: userOrg, email: `${id}@example.com`, name: id, initials: id.slice(-2),
    role, roleLabel: role, title: role, permissions: [], bdActive: false,
  });
  await db.insert(atelierUsers).values([user(fp, "founding_partner"), user(consultant, "consultant"), user(senior, "senior_manager"), user(otherOrg, "founding_partner", "other-org")]).onConflictDoNothing();
  await db.insert(atelierAccounts).values({ id: account, ...base, name: `Prototype Account ${stamp}`, country: "UAE", sector: "Technology" });
  await db.insert(atelierOpportunities).values({
    id: opp, ...base, slug: `prototype-${stamp}`, name: `Prototype Deal ${stamp}`, accountId: account,
    partnerOwnerId: fp, engagementLeadId: fp, dealSizeHypothesis: 10000, probabilityPct: 50,
    nextMilestone: "Demo", sourceLead: "manual",
  });
  await db.insert(atelierOpportunities).values({
    id: opp2, ...base, slug: `prototype-two-${stamp}`, name: `Prototype Deal Two ${stamp}`, accountId: account,
    partnerOwnerId: fp, engagementLeadId: fp, dealSizeHypothesis: 20000, probabilityPct: 30,
    nextMilestone: "Discovery", sourceLead: "manual",
  });
  await db.insert(atelierEngagements).values([
    { id: linked, ...base, slug: `linked-${stamp}`, name: "Linked engagement", accountId: account,
      opportunityId: opp, plmStage: "mobilize", partnerOwnerId: fp, engagementLeadId: fp,
      startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
    { id: unrelated, ...base, slug: `unrelated-${stamp}`, name: "Unrelated engagement", accountId: account,
      plmStage: "mobilize", partnerOwnerId: fp, engagementLeadId: fp,
      startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
  ]);
  const app = (await import("../../src/app.js")).default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;
  async function call(method: string, path: string, persona: string, body?: any) {
    const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  try {
    const created = await call("POST", "/prototypes", fp, { opportunityId: opp, name: "First prototype" });
    const p1 = created.body;
    check("create defaults to exactly 48h", created.status === 201 &&
      new Date(p1.dueAt).getTime() - new Date(p1.requestedAt).getTime() === 48 * 60 * 60 * 1000, p1);
    const p2r = await call("POST", "/prototypes", fp, { opportunityId: opp, name: "Second prototype" });
    check("multiple prototypes per opportunity", p2r.status === 201 && p2r.body.opportunityId === opp && p2r.body.id !== p1.id);
    const p3r = await call("POST", "/prototypes", fp, { opportunityId: opp2, name: "Other opportunity prototype" });
    check("unauthorized role denied write", (await call("POST", "/prototypes", consultant, { opportunityId: opp })).status === 403);
    check("non-owner senior manager denied update", (await call("PATCH", `/prototypes/${p1.id}`, senior, { name: "Denied" })).status === 403);
    check("non-owner senior manager denied transition", (await call("POST", `/prototypes/${p1.id}/transition`, senior, { status: "scoping" })).status === 403);
    check("non-owner senior manager denied deadline", (await call("POST", `/prototypes/${p1.id}/deadline`, senior, { dueAt: new Date().toISOString(), reason: "Denied" })).status === 403);
    check("non-owner senior manager denied handoff", (await call("POST", `/prototypes/${p1.id}/handoff`, senior, { engagementId: linked })).status === 403);
    check("other org cannot read", (await call("GET", `/prototypes/${p1.id}`, otherOrg)).status === 404);
    const deadline = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const changed = await call("POST", `/prototypes/${p1.id}/deadline`, fp, { dueAt: deadline, reason: "Client moved review meeting" });
    const audits = await db.select().from(atelierAuditEvents).where(and(eq(atelierAuditEvents.entityId, p1.id), eq(atelierAuditEvents.action, "prototype.deadline_changed")));
    check("deadline reason and audit", changed.status === 200 && changed.body.deadlineChangeReason === "Client moved review meeting" && audits.length === 1);
    const links = await call("PATCH", `/prototypes/${p1.id}/links`, fp, { buildUrl: "https://build.example", demoUrl: "https://demo.example", repositoryUrl: "https://repo.example" });
    check("links operation", links.status === 200 && links.body.buildUrl === "https://build.example");
    const dueAt = new Date(Date.now() + 3600000).toISOString();
    await call("POST", `/prototypes/${p1.id}/deadline`, fp, { dueAt, reason: "Reset boundary" });
    await call("POST", `/prototypes/${p1.id}/transition`, fp, { status: "scoping" });
    await call("POST", `/prototypes/${p1.id}/transition`, fp, { status: "approved" });
    await call("POST", `/prototypes/${p1.id}/transition`, fp, { status: "building" });
    await call("POST", `/prototypes/${p1.id}/transition`, fp, { status: "ready" });
    const delivered = await call("POST", `/prototypes/${p1.id}/transition`, fp, { status: "delivered" });
    check("route delivery records SLA", delivered.status === 200 && delivered.body.slaOutcome === "on_time" && delivered.body.deliveredAt);
    const deliveredAt = delivered.body.deliveredAt, sla = delivered.body.slaOutcome;
    check("delivered cannot regress", (await call("POST", `/prototypes/${p1.id}/transition`, fp, { status: "building" })).status === 409);
    const redelivered = await call("POST", `/prototypes/${p1.id}/transition`, fp, { status: "delivered" });
    check("idempotent redelivery preserves evidence", redelivered.status === 200 && redelivered.body.deliveredAt === deliveredAt && redelivered.body.slaOutcome === sla);
    const deadlineAfterDelivery = await call("POST", `/prototypes/${p1.id}/deadline`, fp, { dueAt: new Date(Date.now() + 86400000).toISOString(), reason: "Should be immutable" });
    const unchanged = await call("GET", `/prototypes/${p1.id}`, fp);
    check("deadline edit after delivery is rejected and evidence unchanged",
      deadlineAfterDelivery.status === 409 && unchanged.body.prototype.dueAt === dueAt &&
      unchanged.body.prototype.slaOutcome === sla);
    const badHandoff = await call("POST", `/prototypes/${p1.id}/handoff`, fp, { engagementId: unrelated });
    const goodHandoff = await call("POST", `/prototypes/${p1.id}/handoff`, fp, { engagementId: linked });
    check("handoff rejects unrelated and accepts linked", badHandoff.status === 400 && goodHandoff.status === 200 && goodHandoff.body.engagementId === linked);
    const matchingMap = await call("POST", "/finance/tooling/map", fp, {
      vendorKey: "replit", projectKey: `handed-off-${stamp}`, bucketType: "engagement",
      bucketRef: linked, prototypeId: p1.id,
    });
    const persistedMap = await db.select().from(atelierVendorProjectMap).where(and(
      eq(atelierVendorProjectMap.orgId, org), eq(atelierVendorProjectMap.projectKey, `handed-off-${stamp}`),
    ));
    check("handed-off matching engagement tooling mapping persists prototype attribution",
      matchingMap.status === 200 && persistedMap.length === 1 && persistedMap[0].prototypeId === p1.id);

    const invoice = `pt_inv_${stamp}`;
    await db.insert(atelierPartnerFirmInvoices).values({ id: invoice, ...base, partnerFirmId: "unlinked", partnerFirmName: "Replit", weekIso: "2026-W01", costAmount: 15, costCurrency: "USD", usdAmount: 15, status: "submitted" });
    await db.insert(atelierVendorCostSplits).values([
      { id: `pt_ap_${stamp}`, ...base, invoiceId: invoice, prototypeId: p1.id, projectKey: "approved", projectLabel: "Approved", bucketType: "opportunity", bucketRef: opp, currency: "USD", grossAmount: 10, vatAmount: 0, creditAmount: 0, netAmount: 10, usdAmount: 10, status: "approved" },
      { id: `pt_pp_${stamp}`, ...base, invoiceId: invoice, prototypeId: p1.id, projectKey: "proposed", projectLabel: "Proposed", bucketType: "opportunity", bucketRef: opp, currency: "USD", grossAmount: 5, vatAmount: 0, creditAmount: 0, netAmount: 5, usdAmount: 5, status: "proposed" },
    ]);
    const detail = await call("GET", `/prototypes/${p1.id}`, fp);
    check("cost summary excludes proposed from approved", detail.status === 200 && detail.body.costs.approvedUsd === 10 && detail.body.costs.pendingUsd === 5);
    const mismatch = await call("POST", "/finance/tooling/map", fp, { vendorKey: "replit", projectKey: "wrong", bucketType: "opportunity", bucketRef: opp, prototypeId: p3r.body.id });
    check("prototype attribution mismatch rejected", mismatch.status === 400 && mismatch.body.error === "prototype-opportunity-mismatch");
  } finally {
    server.close();
    await db.delete(atelierVendorCostSplits).where(eq(atelierVendorCostSplits.invoiceId, `pt_inv_${stamp}`)).catch(() => {});
    await db.delete(atelierVendorProjectMap).where(eq(atelierVendorProjectMap.orgId, org)).catch(() => {});
    await db.delete(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, `pt_inv_${stamp}`)).catch(() => {});
    await pool.end();
  }
  if (failures) process.exitCode = 1;
  else console.log("All prototype tracker integration checks passed.");
}
main().catch((err) => { console.error(err); process.exitCode = 1; });