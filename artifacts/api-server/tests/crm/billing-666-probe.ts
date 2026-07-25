/**
 * Task #666 — Contingent pricing components on billing surfaces probe.
 *
 * Deterministic, no LLM calls. Covers:
 *   1. POST /billing/rules preserves config.contingentComponents and
 *      installment passThrough flags (zod no longer strips them).
 *   2. PATCH /billing/rules/:id with a config round-trips both.
 *   3. scanBillingTriggers materialises triggers ONLY for installments —
 *      contingent components never become triggers.
 *   4. draftInvoiceForTrigger marks pass-through installment lines as
 *      re-invoiced at cost.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/billing-666-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierAccounts, atelierEngagements, atelierBillingRule, atelierBillingTrigger, atelierInvoice, atelierInvoiceLine, atelierAuditEvents } = D;
  const { eq, inArray } = await import("drizzle-orm");
  const E = await import("../../src/lib/atelier-billing-engine.js");

  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const STAMP = Date.now().toString(36);
  const T = `probe666_${STAMP}`;
  const fpId = `u_${T}_fp`;
  const acctId = `acct_${T}`;
  const engId = `eng_${T}`;

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

  let ruleId = "";
  try {
    await db.insert(atelierUsers).values({
      id: fpId, orgId: "aico", name: "P666 FP", initials: "PF",
      email: `${T}_fp@example.test`, role: "founding_partner",
      roleLabel: "Founding Partner", title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({ id: acctId, orgId: "aico", name: `Probe666 Acct ${STAMP}`, country: "AE", sector: "Probe", createdByUserId: fpId } as any);
    await db.insert(atelierEngagements).values({ id: engId, orgId: "aico", accountId: acctId, slug: `probe666-eng-${STAMP}`, name: `Probe666 Eng ${STAMP}`, status: "active", plmStage: "delivery", partnerOwnerId: fpId, engagementLeadId: fpId, startDate: "2026-01-01", plannedEndDate: "2026-12-31", createdByUserId: fpId } as any);

    // ---------- 1. create rule with contingent + pass-through ----------
    const cfg = {
      installments: [
        { key: "base-1", dueDate: "2026-02-01", amount: 50000, label: "Base fee 1" },
        { key: "passthrough-llm-1", dueDate: "2026-03-01", amount: 2500, label: "LLM API usage", passThrough: true },
      ],
      contingentComponents: [
        { key: "contingent-success-1", dueDate: "2026-06-01", expectedAmount: 150000, label: "Success fee tranche" },
      ],
    };
    const created = await api("POST", "/billing/rules", {
      engagementId: engId, ruleType: "fixed_fee", currency: "USD",
      paymentTermsDays: 30, jurisdiction: "GLOBAL", billTo: {}, config: cfg,
      notes: "probe666",
    });
    ruleId = created.body?.id ?? "";
    check("create rule 201", created.status === 201, created);
    check("create preserves contingentComponents", created.body?.config?.contingentComponents?.length === 1 && created.body.config.contingentComponents[0].expectedAmount === 150000, created.body?.config);
    check("create preserves passThrough flag", created.body?.config?.installments?.some((i: any) => i.key === "passthrough-llm-1" && i.passThrough === true), created.body?.config);

    // ---------- 2. PATCH config round-trip ----------
    const patched = await api("PATCH", `/billing/rules/${ruleId}`, { config: cfg, notes: "probe666 patched" });
    check("patch 200", patched.status === 200, patched);
    check("patch preserves contingentComponents", patched.body?.config?.contingentComponents?.length === 1, patched.body?.config);
    check("patch preserves passThrough flag", patched.body?.config?.installments?.some((i: any) => i.passThrough === true), patched.body?.config);

    // ---------- 3. scan: only installments become triggers ----------
    const scan = await E.scanBillingTriggers({ orgId: "aico", engagementId: engId, asOf: new Date("2026-07-01T00:00:00Z") });
    const trigs = await db.select().from(atelierBillingTrigger).where(eq(atelierBillingTrigger.ruleId, ruleId));
    check("scan created exactly 2 triggers (installments only)", scan.triggersCreated === 2 && trigs.length === 2, { scan, keys: trigs.map((t) => t.idempotencyKey) });
    check("no trigger for contingent component", !trigs.some((t) => t.idempotencyKey.includes("contingent-success")), trigs.map((t) => t.idempotencyKey));
    const ptTrig = trigs.find((t) => t.idempotencyKey.includes("passthrough-llm-1"));
    check("pass-through trigger carries details.passThrough", (ptTrig?.details as any)?.passThrough === true, ptTrig?.details);

    // ---------- 4. draft: pass-through line marked at cost ----------
    const [rule] = await db.select().from(atelierBillingRule).where(eq(atelierBillingRule.id, ruleId));
    const drafted = await E.draftInvoiceForTrigger({ trigger: ptTrig!, rule: rule! });
    check("pass-through trigger drafted", drafted.status === "drafted" && !!drafted.invoiceId, drafted);
    const dLines = drafted.invoiceId
      ? await db.select().from(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, drafted.invoiceId))
      : [];
    check("draft line marked as at-cost pass-through", dLines.some((l) => /pass-through cost, re-invoiced at cost/.test(l.description)), dLines.map((l) => l.description));

    // upcoming preview label for a future pass-through installment
    const [futureRule] = await db.insert(atelierBillingRule).values({
      id: `brule_${T}_fut`, orgId: "aico", engagementId: engId, accountId: acctId,
      ruleType: "fixed_fee", status: "active", currency: "USD", paymentTermsDays: 30,
      jurisdiction: "GLOBAL", billTo: {},
      config: { installments: [{ key: "pt-fut", dueDate: "2026-08-01", amount: 900, label: "Cloud hosting", passThrough: true }] },
      notes: "probe666 future", createdByUserId: fpId,
    } as any).returning();
    const upcoming = await E.computeUpcomingTriggers({ orgId: "aico", asOf: new Date("2026-07-01T00:00:00Z"), horizonDays: 90 });
    const up = upcoming.find((u) => u.ruleId === futureRule!.id);
    check("upcoming label marks pass-through at cost", !!up && /pass-through, at cost/.test(up.label), up);
  } finally {
    // ---------- cleanup (tag sweep) ----------
    try {
      const trigRows = await db.select().from(atelierBillingTrigger).where(eq(atelierBillingTrigger.engagementId, engId));
      const invIds = trigRows.map((t) => t.invoiceId).filter((x): x is string => !!x);
      if (invIds.length) {
        await db.delete(atelierInvoiceLine).where(inArray(atelierInvoiceLine.invoiceId, invIds));
        await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, invIds));
      }
      await db.delete(atelierBillingTrigger).where(eq(atelierBillingTrigger.engagementId, engId));
      await db.delete(atelierBillingRule).where(eq(atelierBillingRule.engagementId, engId));
      await db.delete(atelierEngagements).where(eq(atelierEngagements.id, engId));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.entityId, [ruleId, engId, acctId].filter(Boolean)));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, fpId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
