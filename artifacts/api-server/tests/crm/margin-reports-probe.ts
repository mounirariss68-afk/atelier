/**
 * Task #434 — Margin / realization reporting suite probe.
 *
 * Deterministic (no LLM paths). Covers:
 *   1. Sold-position capture + immutability: backfill captures a snapshot
 *      for a contract-stage opp; re-running the backfill is a no-op and
 *      the stored values never change.
 *   2. Client margin rollup math from margin snapshots, plus partner and
 *      entity filters (entity derived from the latest non-void invoice).
 *   3. Overhead allocation: pool from engagement-less GL expense lines,
 *      allocations tie exactly to the GL total, basis switch (PUT config)
 *      changes the shares.
 *   4. Realization report leakage decomposition: rate variance, hours
 *      overrun, scope write-offs (negative revenue adjustments) and
 *      expense non-recovery — recovered expenses excluded.
 *   5. Persona gates: restricted persona gets 403 on reads; finance-only
 *      writes reject a partner-less persona? (writes need finance/leadership).
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/margin-reports-probe.ts
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
function close(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
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
    atelierEngagements,
    atelierEngagementMarginSnapshot,
    atelierSoldPositionSnapshot,
    atelierOverheadAllocationConfig,
    atelierGlAccount,
    atelierGlJournalEntry,
    atelierGlJournalLine,
    atelierRevenueAdjustment,
    atelierExpenses,
    atelierInvoice,
    atelierInvoiceLine,
    atelierCashApplication,
    atelierAuditEvents,
    atelierPaneAItems,
    atelierNotifications,
  } = D;
  const { eq, inArray, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const STAMP = `${Date.now().toString(36)}`;
  const T = `probe434_${STAMP}`;
  const fpId = `u_${T}_fp`;
  const restrictedId = `u_${T}_emp`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (method: string, path: string, body?: unknown, who: string = fpId) => {
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

  const acctA = `acct_${T}_a`;
  const acctB = `acct_${T}_b`;
  const oppPriced = `opp_${T}_priced`;
  const oppBare = `opp_${T}_bare`;
  const engA = `eng_${T}_a`; // priced, entity ent1, partner FP
  const engB = `eng_${T}_b`; // bare, no invoice, partner OTHER
  const otherPartner = `u_${T}_p2`;
  const ent1 = `ent_${T}_1`;

  try {
    // ---- Seed personas ----
    await db.insert(atelierUsers).values([
      {
        id: fpId,
        orgId: "aico",
        name: "Probe434 Partner",
        initials: "PP",
        email: `${T}_fp@example.test`,
        role: "founding_partner",
        roleLabel: "Founding Partner",
        title: "Founding Partner",
      },
      {
        id: restrictedId,
        orgId: "aico",
        name: "Probe434 Employee",
        initials: "PE",
        email: `${T}_emp@example.test`,
        role: "employee",
        roleLabel: "Consultant",
        title: "Consultant",
      },
      {
        id: otherPartner,
        orgId: "aico",
        name: "Probe434 Partner2",
        initials: "P2",
        email: `${T}_p2@example.test`,
        role: "partner",
        roleLabel: "Partner",
        title: "Partner",
      },
    ] as any);

    // ---- Seed accounts / opps / pricing / engagements ----
    await db.insert(atelierAccounts).values([
      { id: acctA, orgId: "aico", name: `Probe434 Alpha ${STAMP}`, country: "AE", sector: "Probe", createdByUserId: fpId },
      { id: acctB, orgId: "aico", name: `Probe434 Beta ${STAMP}`, country: "AE", sector: "Probe", createdByUserId: fpId },
    ] as any);
    await db.insert(atelierOpportunities).values([
      {
        id: oppPriced,
        orgId: "aico",
        slug: `${T}-priced`,
        name: "Probe434 priced deal",
        accountId: acctA,
        salesStage: "contract",
        partnerOwnerId: fpId,
        engagementLeadId: fpId,
        dealSizeHypothesis: 999999, // must be ignored when pricing exists
        probabilityPct: 90,
        nextMilestone: "probe",
        sourceLead: "manual",
        createdByUserId: fpId,
      },
      {
        id: oppBare,
        orgId: "aico",
        slug: `${T}-bare`,
        name: "Probe434 bare deal",
        accountId: acctB,
        salesStage: "contract",
        partnerOwnerId: otherPartner,
        engagementLeadId: otherPartner,
        dealSizeHypothesis: 50000,
        probabilityPct: 90,
        nextMilestone: "probe",
        sourceLead: "manual",
        createdByUserId: fpId,
      },
    ] as any);
    // Pricing: 2 weeks × 1.0 FTE = 80 sold hours; price 100k, cost 55k.
    await db.insert(atelierDealPricings).values({
      id: `dp_${T}`,
      orgId: "aico",
      opportunityId: oppPriced,
      rateCardId: `rc_${T}`,
      pricingModel: "time_and_materials",
      durationWeeks: 2,
      teamMix: [{ seniority: "senior", ftePct: 1 }],
      computedCostUsd: 55000,
      computedPriceUsd: 100000,
      computedMarginPct: 0.45,
      targetMarginPct: 0.55,
      createdByUserId: fpId,
    } as any);
    await db.insert(atelierEngagements).values([
      {
        id: engA,
        orgId: "aico",
        slug: engA,
        name: "Probe434 Eng A",
        accountId: acctA,
        opportunityId: oppPriced,
        plmStage: "deliver",
        partnerOwnerId: fpId,
        engagementLeadId: fpId,
        startDate: "2026-01-01",
        plannedEndDate: "2026-12-31",
      },
      {
        id: engB,
        orgId: "aico",
        slug: engB,
        name: "Probe434 Eng B",
        accountId: acctB,
        opportunityId: oppBare,
        plmStage: "deliver",
        partnerOwnerId: otherPartner,
        engagementLeadId: otherPartner,
        startDate: "2026-01-01",
        plannedEndDate: "2026-12-31",
      },
    ] as any);

    // Margin snapshots: engA 2026-06 rev 60k cost 33k 60h (plus an older
    // snapshot for the same period that must be superseded), engB 2026-06
    // rev 20k cost 8k 30h.
    await db.insert(atelierEngagementMarginSnapshot).values([
      {
        id: `ems_${T}_a_old`,
        orgId: "aico",
        engagementId: engA,
        periodLabel: "2026-06",
        snapshotAt: new Date("2026-06-15T00:00:00Z"),
        revenueRecognised: 1,
        directCost: 1,
        hoursBillable: 1,
      },
      {
        id: `ems_${T}_a`,
        orgId: "aico",
        engagementId: engA,
        periodLabel: "2026-06",
        snapshotAt: new Date("2026-07-01T00:00:00Z"),
        revenueRecognised: 60000,
        directCost: 33000,
        hoursBillable: 60,
        leakageAmount: 1234,
      },
      {
        id: `ems_${T}_b`,
        orgId: "aico",
        engagementId: engB,
        periodLabel: "2026-06",
        snapshotAt: new Date("2026-07-01T00:00:00Z"),
        revenueRecognised: 20000,
        directCost: 8000,
        hoursBillable: 30,
      },
    ] as any);

    // Invoice for engA → entity ent1 (entity derivation), plus an expense
    // recovery line for one of two billable expenses.
    const expRecovered = `exp_${T}_rec`;
    const expLost = `exp_${T}_lost`;
    await db.insert(atelierInvoice).values({
      id: `inv_${T}`,
      orgId: "aico",
      engagementId: engA,
      accountId: acctA,
      legalEntityId: ent1,
      jurisdiction: "AE",
      status: "sent",
      currency: "USD",
      issuedAt: new Date("2026-05-15T00:00:00Z"),
      createdByUserId: fpId,
    } as any);
    await db.insert(atelierCashApplication).values({
      id: `cashapp_${T}`,
      orgId: "aico",
      cashReceiptId: `cashreceipt_${T}`,
      invoiceId: `inv_${T}`,
      appliedAmount: 1234,
      currency: "USD",
      appliedAt: new Date("2026-06-15T00:00:00Z"),
    } as any);
    await db.insert(atelierInvoiceLine).values({
      id: `invl_${T}`,
      orgId: "aico",
      invoiceId: `inv_${T}`,
      description: "probe recovered expense",
      sourceKind: "expense",
      sourceRef: expRecovered,
      amount: 500,
    } as any);
    await db.insert(atelierExpenses).values([
      {
        id: expRecovered,
        orgId: "aico",
        personId: fpId,
        engagementId: engA,
        expenseDate: "2026-06-10",
        captureSource: "manual",
        usdAmount: 500,
        clientBillable: true,
        status: "approved",
      },
      {
        id: expLost,
        orgId: "aico",
        personId: fpId,
        engagementId: engA,
        expenseDate: "2026-06-11",
        captureSource: "manual",
        usdAmount: 700,
        clientBillable: true,
        status: "reimbursed",
      },
    ] as any);
    // Scope write-off: -2,000 adjustment (and a positive one that must not count).
    await db.insert(atelierRevenueAdjustment).values([
      {
        id: `radj_${T}_neg`,
        orgId: "aico",
        postingId: `post_${T}_1`,
        engagementId: engA,
        deltaAmount: -2000,
        rationaleText: "probe write-off",
        requestedByUserId: fpId,
      },
      {
        id: `radj_${T}_pos`,
        orgId: "aico",
        postingId: `post_${T}_2`,
        engagementId: engA,
        deltaAmount: 999,
        rationaleText: "probe positive (ignored)",
        requestedByUserId: fpId,
      },
    ] as any);

    // GL: two expense accounts; overhead lines (no engagementId) 9k + 1k = 10k;
    // one engagement-dimensioned line (direct, excluded) and one revenue-type
    // account line (excluded).
    await db.insert(atelierGlAccount).values([
      { id: `gla_${T}_rent`, orgId: "aico", legalEntityId: ent1, code: `6${STAMP.slice(-3)}1`, name: "Probe Rent", type: "expense", normalSide: "debit" },
      { id: `gla_${T}_it`, orgId: "aico", legalEntityId: ent1, code: `6${STAMP.slice(-3)}2`, name: "Probe IT", type: "expense", normalSide: "debit" },
      { id: `gla_${T}_rev`, orgId: "aico", legalEntityId: ent1, code: `4${STAMP.slice(-3)}0`, name: "Probe Rev", type: "revenue", normalSide: "credit" },
    ] as any);
    await db.insert(atelierGlJournalEntry).values({
      id: `gljrn_${T}`,
      orgId: "aico",
      legalEntityId: ent1,
      periodLabel: "2026-06",
      entryDate: "2026-06-30",
      sourceKind: "manual",
      sourceRef: T,
    } as any);
    await db.insert(atelierGlJournalLine).values([
      { id: `gljl_${T}_1`, orgId: "aico", journalEntryId: `gljrn_${T}`, accountId: `gla_${T}_rent`, accountCode: "6001", accountName: "Probe Rent", debit: 9000 },
      { id: `gljl_${T}_2`, orgId: "aico", journalEntryId: `gljrn_${T}`, accountId: `gla_${T}_it`, accountCode: "6002", accountName: "Probe IT", debit: 1000 },
      { id: `gljl_${T}_3`, orgId: "aico", journalEntryId: `gljrn_${T}`, accountId: `gla_${T}_rent`, accountCode: "6001", accountName: "Probe Rent (direct)", debit: 5000, engagementId: engA },
      { id: `gljl_${T}_4`, orgId: "aico", journalEntryId: `gljrn_${T}`, accountId: `gla_${T}_rev`, accountCode: "4000", accountName: "Probe Rev", credit: 7777 },
    ] as any);

    // ---- 1. Persona gates ----
    const g1 = await api("GET", "/margin-reports/clients", undefined, restrictedId);
    check("restricted persona 403 on reads", g1.status === 403, g1);
    const g2 = await api("PUT", "/margin-reports/allocation-config", { basis: "revenue", glAccountCodes: [], notes: "" }, restrictedId);
    check("restricted persona 403 on config write", g2.status === 403, g2);

    // ---- 2. Backfill + immutability ----
    const bf1 = await api("POST", "/margin-reports/sold-positions/backfill");
    check("backfill captures both contract opps", bf1.status === 200 && bf1.body.captured >= 2, bf1.body);
    const soldRows1 = await db
      .select()
      .from(atelierSoldPositionSnapshot)
      .where(inArray(atelierSoldPositionSnapshot.opportunityId, [oppPriced, oppBare]));
    const priced = soldRows1.find((r) => r.opportunityId === oppPriced)!;
    const bare = soldRows1.find((r) => r.opportunityId === oppBare)!;
    check(
      "priced snapshot uses pricing (100k / 80h / 45%)",
      !!priced && priced.hasPricing && close(priced.soldPriceUsd, 100000) && close(priced.soldHours, 80) && close(priced.soldMarginPct, 0.45) && close(priced.soldEffectiveRateUsd, 1250),
      priced,
    );
    check("bare snapshot falls back to deal hypothesis (50k, no pricing)", !!bare && !bare.hasPricing && close(bare.soldPriceUsd, 50000), bare);

    // Mutate the source pricing, re-backfill → snapshot must NOT change.
    await db.update(atelierDealPricings).set({ computedPriceUsd: 1 } as any).where(eq(atelierDealPricings.id, `dp_${T}`));
    const bf2 = await api("POST", "/margin-reports/sold-positions/backfill");
    check("re-backfill is a no-op (all skipped)", bf2.status === 200 && bf2.body.captured === 0, bf2.body);
    const [pricedAfter] = await db
      .select()
      .from(atelierSoldPositionSnapshot)
      .where(eq(atelierSoldPositionSnapshot.opportunityId, oppPriced));
    check("snapshot immutable after source pricing mutated", close(pricedAfter.soldPriceUsd, 100000), pricedAfter.soldPriceUsd);

    // ---- 3. Client margin rollups ----
    const cm = await api("GET", "/margin-reports/clients?periodFrom=2026-06&periodTo=2026-06");
    const rowA = cm.body?.rows?.find((r: any) => r.accountId === acctA);
    const rowB = cm.body?.rows?.find((r: any) => r.accountId === acctB);
    check(
      "rollup math per account (latest snapshot wins, old superseded)",
      cm.status === 200 &&
        !!rowA &&
        close(rowA.revenueRecognised, 60000) &&
        close(rowA.directCost, 33000) &&
        close(rowA.grossMarginAmount, 27000) &&
        close(rowA.grossMarginPct, 0.45) &&
        close(rowA.leakageAmount, 1234) &&
        !!rowB &&
        close(rowB.revenueRecognised, 20000),
      { rowA, rowB },
    );
    check(
      "totals tie",
      close(cm.body.totals.revenueRecognised, 80000) && close(cm.body.totals.grossMarginAmount, 27000 + 12000),
      cm.body?.totals,
    );
    const cmPartner = await api("GET", `/margin-reports/clients?partnerId=${otherPartner}`);
    check(
      "partner filter keeps only engB account",
      cmPartner.status === 200 && cmPartner.body.rows.length === 1 && cmPartner.body.rows[0].accountId === acctB,
      cmPartner.body?.rows?.map((r: any) => r.accountId),
    );
    const cmEntity = await api("GET", `/margin-reports/clients?entityId=${ent1}`);
    check(
      "entity filter (from latest invoice) keeps only engA account",
      cmEntity.status === 200 && cmEntity.body.rows.length === 1 && cmEntity.body.rows[0].accountId === acctA,
      cmEntity.body?.rows?.map((r: any) => r.accountId),
    );

    // ---- 4. Overhead allocation ----
    const net1 = await api("GET", "/margin-reports/net?periodFrom=2026-06&periodTo=2026-06");
    check(
      "overhead pool = engagement-less expense lines only (10k, 2 lines)",
      net1.status === 200 && close(net1.body.overheadPoolUsd, 10000) && net1.body.overheadLineCount === 2,
      { pool: net1.body?.overheadPoolUsd, lines: net1.body?.overheadLineCount },
    );
    const netA1 = net1.body.rows.find((r: any) => r.engagementId === engA);
    check(
      "revenue basis: engA gets 75% of pool (7.5k), net = 27k - 7.5k",
      !!netA1 && close(netA1.allocatedOverheadUsd, 7500) && close(netA1.netMarginAmount, 19500),
      netA1,
    );
    check("allocations tie to GL total", net1.body.tiesToGl === true && close(net1.body.allocatedTotalUsd, 10000), net1.body);

    const putCfg = await api("PUT", "/margin-reports/allocation-config", { basis: "hours", glAccountCodes: [], notes: "probe" });
    check("PUT allocation-config (finance write) 200", putCfg.status === 200 && putCfg.body.basis === "hours", putCfg);
    const net2 = await api("GET", "/margin-reports/net?periodFrom=2026-06&periodTo=2026-06");
    const netA2 = net2.body.rows.find((r: any) => r.engagementId === engA);
    check(
      "hours basis changes shares: engA 60/90 of 10k ≈ 6,666.67",
      net2.status === 200 && net2.body.basis === "hours" && !!netA2 && close(netA2.allocatedOverheadUsd, 6666.67, 0.02),
      netA2?.allocatedOverheadUsd,
    );
    check("hours basis still ties to GL", net2.body.tiesToGl === true && close(net2.body.allocatedTotalUsd, 10000), net2.body?.allocatedTotalUsd);

    // ---- 5. Realization + leakage decomposition ----
    const real = await api("GET", "/margin-reports/realization?periodFrom=2026-06&periodTo=2026-06");
    const rA = real.body?.rows?.find((r: any) => r.engagementId === engA);
    // engA: sold 100k/80h @1250; delivered 60k/60h → delivered rate 1000.
    // rateVariance = (1250-1000)*60 = 15,000; no hours overrun (60<80);
    // write-offs = 2,000 (only the negative adj); expense non-recovery = 700
    // (the 500 one is recovered via invoice line).
    check(
      "realization rate = 0.6 for engA",
      real.status === 200 && !!rA && close(rA.realizationRate, 0.6),
      rA?.realizationRate,
    );
    check(
      "period cash includes collections against prior-period invoices",
      !!rA && close(rA.financials.cashCollectedUsd, 1234) && close(rA.financials.invoicedUsd, 0),
      rA?.financials,
    );
    check(
      "leakage decomposition (rate var 15k, overrun 0, write-off 2k, non-recovery 700)",
      !!rA?.leakage &&
        close(rA.leakage.rateVarianceUsd, 15000) &&
        close(rA.leakage.hoursOverrunUsd, 0) &&
        close(rA.leakage.scopeWriteOffsUsd, 2000) &&
        close(rA.leakage.expenseNonRecoveryUsd, 700) &&
        close(rA.leakage.totalUsd, 17700),
      rA?.leakage,
    );

    // ---- 6. Sold positions listing surface ----
    const sp = await api("GET", "/margin-reports/sold-positions");
    check(
      "sold-positions listing includes both snapshots",
      sp.status === 200 && [oppPriced, oppBare].every((o) => sp.body.rows.some((r: any) => r.opportunityId === o)),
      sp.body?.rows?.length,
    );
    // ---- 7. Cross-org isolation ----
    const XORG = `xorg_${T}`;
    await db.insert(atelierAccounts).values({
      id: `acct_${T}_x`, orgId: XORG, name: `Probe434 Foreign ${STAMP}`, country: "AE", sector: "Probe", createdByUserId: fpId,
    });
    await db.insert(atelierOpportunities).values({
      id: `opp_${T}_x`, orgId: XORG, slug: `opp-${T}-x`, accountId: `acct_${T}_x`, name: "Foreign contract opp",
      salesStage: "contract", dealSizeHypothesis: 99999, partnerOwnerId: fpId, engagementLeadId: fpId, probabilityPct: 90,
      nextMilestone: "probe", sourceLead: "manual", createdByUserId: fpId,
    });
    await db.insert(atelierEngagements).values({
      id: `eng_${T}_x`, orgId: XORG, slug: `eng_${T}_x`, accountId: `acct_${T}_x`, opportunityId: `opp_${T}_x`,
      name: "Foreign engagement", plmStage: "deliver", partnerOwnerId: fpId, engagementLeadId: fpId,
      startDate: "2026-01-01", plannedEndDate: "2026-12-31",
    } as any);
    await db.insert(atelierEngagementMarginSnapshot).values({
      id: `ems_${T}_x`, orgId: XORG, engagementId: `eng_${T}_x`, periodLabel: "2026-06",
      revenueRecognised: 123456, directCost: 1, hoursBillable: 10,
    });
    await db.insert(atelierSoldPositionSnapshot).values({
      id: `sold_opp_${T}_x_pre`, orgId: XORG, opportunityId: `opp_${T}_x_pre`, accountId: `acct_${T}_x`,
      soldPriceUsd: 99999, createdByUserId: fpId,
    });
    const xClients = await api("GET", "/margin-reports/clients");
    check(
      "cross-org: client rollups exclude foreign-org engagements",
      xClients.status === 200 && !xClients.body.rows.some((r: any) => r.accountId === `acct_${T}_x`),
      xClients.body?.rows?.map((r: any) => r.accountId),
    );
    const xNet = await api("GET", "/margin-reports/net?periodFrom=2026-06&periodTo=2026-06");
    check(
      "cross-org: net margin excludes foreign-org engagements",
      xNet.status === 200 && !xNet.body.rows.some((r: any) => r.engagementId === `eng_${T}_x`),
      xNet.body?.rows?.map((r: any) => r.engagementId),
    );
    const xReal = await api("GET", "/margin-reports/realization");
    check(
      "cross-org: realization excludes foreign-org engagements",
      xReal.status === 200 && !xReal.body.rows.some((r: any) => r.engagementId === `eng_${T}_x`),
      xReal.body?.rows?.length,
    );
    const xSp = await api("GET", "/margin-reports/sold-positions");
    check(
      "cross-org: sold-positions listing excludes foreign-org snapshots",
      xSp.status === 200 && !xSp.body.rows.some((r: any) => r.orgId === XORG),
      xSp.body?.rows?.length,
    );
    const xBf = await api("POST", "/margin-reports/sold-positions/backfill");
    const [foreignSnap] = await db
      .select()
      .from(atelierSoldPositionSnapshot)
      .where(eq(atelierSoldPositionSnapshot.id, `sold_opp_${T}_x`));
    check(
      "cross-org: backfill never captures foreign-org contract opps",
      xBf.status === 200 && !foreignSnap,
      { captured: xBf.body?.captured, foreignSnap: !!foreignSnap },
    );

    // Sentinel isolation: give the foreign engagement a sold baseline that
    // WOULD fire every band (realization 123,456 / 1,000,000 ≈ 0.12, progress
    // 10/10 = 100%) if the run leaked across orgs, then trigger a run as the
    // caller-org partner and assert no foreign alert was written.
    await db.insert(atelierSoldPositionSnapshot).values({
      id: `sold_opp_${T}_x`, orgId: XORG, opportunityId: `opp_${T}_x`, engagementId: `eng_${T}_x`,
      accountId: `acct_${T}_x`, partnerOwnerId: fpId, soldHours: 10, soldPriceUsd: 1000000,
      createdByUserId: fpId,
    } as any);
    const xRun = await api("POST", "/margin-reports/sentinel/run");
    const foreignPane = await db
      .select({ id: atelierPaneAItems.id })
      .from(atelierPaneAItems)
      .where(like(atelierPaneAItems.id, `panea_margin_eng_${T}_x%`));
    const foreignNotif = await db
      .select({ id: atelierNotifications.id })
      .from(atelierNotifications)
      .where(like(atelierNotifications.id, `notif_margin_eng_${T}_x%`));
    check(
      "cross-org: sentinel run scoped to caller org (no foreign alerts/notifications)",
      xRun.status === 200 && foreignPane.length === 0 && foreignNotif.length === 0,
      { status: xRun.status, out: xRun.body, foreignPane: foreignPane.length, foreignNotif: foreignNotif.length },
    );
    // engA (realization 0.6, progress 75%) fires during the caller-org run —
    // its alert rows must be stamped with the caller's org.
    const ownPane = await db
      .select({ id: atelierPaneAItems.id, orgId: atelierPaneAItems.orgId })
      .from(atelierPaneAItems)
      .where(like(atelierPaneAItems.id, `panea_margin_${engA}%`));
    const ownNotif = await db
      .select({ id: atelierNotifications.id, orgId: atelierNotifications.orgId })
      .from(atelierNotifications)
      .where(like(atelierNotifications.id, `notif_margin_${engA}%`));
    check(
      "sentinel alerts stamped with caller org",
      ownPane.length > 0 &&
        ownPane.every((p) => p.orgId === "aico") &&
        ownNotif.length > 0 &&
        ownNotif.every((n) => n.orgId === "aico"),
      { pane: ownPane, notif: ownNotif },
    );
  } finally {
    try {
      await db.delete(atelierSoldPositionSnapshot).where(like(atelierSoldPositionSnapshot.id, `sold_opp_${T}%`));
      await db.delete(atelierPaneAItems).where(like(atelierPaneAItems.id, `panea_margin_eng_${T}%`));
      await db.delete(atelierNotifications).where(like(atelierNotifications.id, `notif_margin_eng_${T}%`));
      await db.delete(atelierOverheadAllocationConfig).where(eq(atelierOverheadAllocationConfig.id, "ohcfg_aico"));
      await db.delete(atelierGlJournalLine).where(like(atelierGlJournalLine.id, `gljl_${T}%`));
      await db.delete(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.id, `gljrn_${T}`));
      await db.delete(atelierGlAccount).where(like(atelierGlAccount.id, `gla_${T}%`));
      await db.delete(atelierRevenueAdjustment).where(like(atelierRevenueAdjustment.id, `radj_${T}%`));
      await db.delete(atelierExpenses).where(like(atelierExpenses.id, `exp_${T}%`));
      await db.delete(atelierCashApplication).where(eq(atelierCashApplication.id, `cashapp_${T}`));
      await db.delete(atelierInvoiceLine).where(eq(atelierInvoiceLine.id, `invl_${T}`));
      await db.delete(atelierInvoice).where(eq(atelierInvoice.id, `inv_${T}`));
      await db.delete(atelierEngagementMarginSnapshot).where(like(atelierEngagementMarginSnapshot.id, `ems_${T}%`));
      await db.delete(atelierEngagements).where(inArray(atelierEngagements.id, [engA, engB, `eng_${T}_x`]));
      await db.delete(atelierDealPricings).where(eq(atelierDealPricings.id, `dp_${T}`));
      await db.delete(atelierOpportunities).where(inArray(atelierOpportunities.id, [oppPriced, oppBare, `opp_${T}_x`]));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [acctA, acctB, `acct_${T}_x`]));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `%${T}%`));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, restrictedId, otherPartner]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("probe crashed", e);
  process.exit(1);
});
