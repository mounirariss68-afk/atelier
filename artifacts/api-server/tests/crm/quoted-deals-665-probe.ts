/**
 * Task #665 — Alliance partner cost-line linkage probe.
 *
 * Covers:
 *   1. PUT pricing persists partnerFirmId + quotedAmountUsd on an
 *      alliance_partner_quote cost line; GET pricing returns them.
 *   2. GET /partners/firms/:id/quoted-deals surfaces the deal with
 *      quoted vs costed amounts and the delta.
 *   3. A firm with no linked lines gets an empty list; unknown firm 404s.
 *   4. Non-alliance lines and lines linked to other firms are excluded.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/quoted-deals-665-probe.ts
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
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierDealPricings,
    atelierRateCards,
    atelierRateCardRows,
    atelierMarginPolicies,
    atelierPartnerFirms,
  } = D;
  const { eq, inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const STAMP = Date.now().toString(36);
  const T = `probe665_${STAMP}`;
  const fpId = `u_${T}_fp`;
  const acctId = `acct_${T}`;
  const oppId = `opp_${T}`;
  const rcId = `rc_${T}`;
  const firmA = `pfrm_${T}_a`;
  const firmB = `pfrm_${T}_b`;

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
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  try {
    // ---------- seed ----------
    await db.insert(atelierUsers).values({
      id: fpId, orgId: "aico", name: "P665 FP", initials: "PF",
      email: `${T}_fp@example.test`, role: "founding_partner",
      roleLabel: "Founding Partner", title: "Founding Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: acctId, orgId: "aico", name: `Probe665 Acct ${STAMP}`, country: "AE",
      sector: "Probe", createdByUserId: fpId,
    } as any);
    await db.insert(atelierOpportunities).values({
      id: oppId, orgId: "aico", slug: `probe665-opp-${STAMP}`, accountId: acctId,
      name: `Probe665 Opp ${STAMP}`, salesStage: "prospect", partnerOwnerId: fpId,
      engagementLeadId: fpId, dealSizeHypothesis: 300000, probabilityPct: 50,
      nextMilestone: "probe", sourceLead: "manual", createdByUserId: fpId,
    } as any);
    await db.update(atelierMarginPolicies).set({ isDefault: false } as any)
      .where(eq(atelierMarginPolicies.isDefault, true));
    await db.insert(atelierMarginPolicies).values({
      id: `mpol_${T}`, name: "probe665", targetMarginPct: 0.55,
      amberThresholdPct: 0.5, redThresholdPct: 0.45, twoPartnerThresholdPct: 0.45,
      isDefault: true,
    } as any);
    await db.insert(atelierRateCards).values({
      id: rcId, orgId: "aico", name: "Probe665 Card", status: "active",
      geography: "UAE", currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"), version: 1, createdByUserId: fpId,
    } as any);
    await db.insert(atelierRateCardRows).values([
      { id: `rcr_${T}_p`, orgId: "aico", rateCardId: rcId, role: "Partner", seniority: "Partner", dayRateInternalCost: 2000, dayRateClientPrice: 6000, overheadPct: 0.25, currency: "USD", createdByUserId: fpId },
      { id: `rcr_${T}_a`, orgId: "aico", rateCardId: rcId, role: "Analyst", seniority: "Analyst", dayRateInternalCost: 500, dayRateClientPrice: 1500, overheadPct: 0.25, currency: "USD", createdByUserId: fpId },
    ] as any);
    await db.insert(atelierPartnerFirms).values([
      { id: firmA, orgId: "aico", name: `Probe665 Firm A ${STAMP}`, status: "active" },
      { id: firmB, orgId: "aico", name: `Probe665 Firm B ${STAMP}`, status: "active" },
    ] as any);

    const teamMix = [
      { seniority: "Partner", role: "Lead", ftePct: 0.2 },
      { seniority: "Analyst", role: "Analyst", ftePct: 1 },
    ];

    // ---------- 1. PUT pricing with linked alliance line ----------
    const put = await api("PUT", `/opportunities/${oppId}/pricing`, {
      teamMix,
      durationWeeks: 12,
      pricingModel: "time_and_materials",
      rateCardId: rcId,
      costLines: [
        {
          type: "alliance_partner_quote",
          label: "Sub-contracted data engineering",
          amountUsd: 42000,
          recurrence: "one_time",
          passThrough: false,
          partnerFirmId: firmA,
          quotedAmountUsd: 40000,
        },
        { type: "travel", label: "Onsite", amountUsd: 5000, recurrence: "one_time" },
        {
          type: "alliance_partner_quote",
          label: "Other firm line",
          amountUsd: 1000,
          partnerFirmId: firmB,
          quotedAmountUsd: 1000,
        },
      ],
    });
    check("PUT pricing 200", put.status === 200, put);

    // NOTE: GET /pricing reads the masked view atelier_deal_pricings_v which
    // only exists via numbered migrations (absent in push-provisioned scratch
    // DBs), so verify persistence directly from the base row instead.
    const [row] = await db
      .select({ costLines: atelierDealPricings.costLines })
      .from(atelierDealPricings)
      .where(eq(atelierDealPricings.opportunityId, oppId));
    const lines = ((row?.costLines ?? []) as any[]);
    const linked = lines.find((l) => l.type === "alliance_partner_quote" && l.partnerFirmId === firmA);
    check("pricing persists partnerFirmId", !!linked, lines);
    check("pricing persists quotedAmountUsd", linked?.quotedAmountUsd === 40000, linked);

    // ---------- 2. quoted-deals for firm A ----------
    const qd = await api("GET", `/partners/firms/${firmA}/quoted-deals`);
    check("quoted-deals 200", qd.status === 200, qd);
    const items = (qd.body?.items ?? []) as any[];
    check("quoted-deals: exactly one item for firm A", items.length === 1, items);
    const it = items[0] ?? {};
    check("quoted-deals: opportunity linkage", it.opportunityId === oppId && it.opportunityName?.includes("Probe665"), it);
    check("quoted-deals: account name surfaced", it.accountName?.includes("Probe665 Acct"), it);
    check("quoted-deals: quoted vs costed + delta", it.costedAmountUsd === 42000 && it.quotedAmountUsd === 40000 && it.deltaUsd === 2000, it);
    check("quoted-deals: line label + stage", it.lineLabel === "Sub-contracted data engineering" && it.salesStage === "prospect", it);

    // ---------- 3. firm B sees only its own line; unknown 404 ----------
    const qdB = await api("GET", `/partners/firms/${firmB}/quoted-deals`);
    check("quoted-deals: firm B sees only its line", qdB.status === 200 && qdB.body.items.length === 1 && qdB.body.items[0].lineLabel === "Other firm line", qdB.body);
    check("quoted-deals: firm B delta zero", qdB.body.items[0].deltaUsd === 0, qdB.body.items[0]);
    const qd404 = await api("GET", `/partners/firms/pfrm_missing_${STAMP}/quoted-deals`);
    check("quoted-deals: unknown firm 404", qd404.status === 404, qd404);
  } finally {
    // scratch DB is isolated, but clean up tracked rows anyway.
    try {
      await db.delete(atelierDealPricings).where(eq(atelierDealPricings.opportunityId, oppId));
      const { hardDeleteOpportunities } = await import("../../src/lib/atelier-opportunity-delete.js");
      await hardDeleteOpportunities([oppId]);
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierRateCardRows).where(inArray(atelierRateCardRows.id, [`rcr_${T}_p`, `rcr_${T}_a`]));
      await db.delete(atelierRateCards).where(eq(atelierRateCards.id, rcId));
      await db.delete(atelierMarginPolicies).where(eq(atelierMarginPolicies.id, `mpol_${T}`));
      await db.delete(atelierPartnerFirms).where(inArray(atelierPartnerFirms.id, [firmA, firmB]));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, fpId));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end();
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
