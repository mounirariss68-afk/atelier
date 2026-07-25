/**
 * Task #663 — Pricing engine extensions probe.
 *
 * Deterministic (Anthropic stubbed, SSE-aware for the web-search researcher).
 * Covers:
 *   1. Legacy regression: no costLines / empty costLines / explicit "generic"
 *      variant produce JSON-identical simulations to the pre-663 engine path.
 *   2. Cost stack: absorbed lines raise cost + lower margin in every band;
 *      pass-through lines never touch margin but ride the cash profile with
 *      passThrough:true; weekly/monthly recurrence expansion.
 *   3. Band weights: custom weights change the risk-adjusted blend exactly;
 *      normalizeBandWeights normalizes non-unit sums; garbage falls back.
 *   4. Outcome variants: gain_share (share/cap/floor), volume_unit (tiered
 *      marginal revenue + minimum fee), sla_based (worst = last band),
 *      success_fee (expected value); contingent cash receipts flagged.
 *   5. PUT pricing: costLines persisted, computedCostUsd includes absorbed,
 *      costLines change invalidates a prior partner override.
 *   6. Simulate endpoint: costLines accepted, costStack present for partner,
 *      masked for non-costing viewer.
 *   7. Pricing Researcher: POST 202 + poll to succeeded; review-only output
 *      persisted on the pricing row; agent run row completed; partner-only.
 *   8. Billing handoff: contingent components flagged in the plan/rule config,
 *      pass-through installments included at cost.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/pricing-663-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import { createServer } from "node:http";
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

const RESEARCHER_LLM = {
  summary: "Fixed fee with a success-fee kicker is standard for this sector.",
  marketBenchmarks: [
    { metric: "AI advisory day rate", value: "$4k–$8k", context: "GCC market 2026" },
  ],
  suggestedStructures: [
    { kind: "outcome_based", outcomeVariant: "success_fee", rationale: "Aligns incentives.", suggestedParams: { successFee: { successFeeUsd: 150000 } } },
  ],
  suggestedCostLines: [
    { type: "llm_ai", label: "LLM API usage", amountUsd: 2500, recurrence: "monthly", passThrough: true, rationale: "Token costs scale with usage." },
  ],
  risks: ["Outcome verification disputes delay the contingent tranche."],
  confidence: "amber",
};

async function main() {
  // Stub Anthropic BEFORE the app import. The researcher uses the streaming
  // web-search helper, so serve SSE when the request asks for a stream.
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      const text = JSON.stringify(RESEARCHER_LLM);
      const wantsStream = body.includes('"stream":true');
      if (!wantsStream) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_probe663",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 20 },
          }),
        );
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const ev = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      ev("message_start", {
        type: "message_start",
        message: {
          id: "msg_probe663",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      });
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
      ev("content_block_stop", { type: "content_block_stop", index: 0 });
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } });
      ev("message_stop", { type: "message_stop" });
      res.end();
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe663-stub-key";

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierAccounts,
    atelierOpportunities,
    atelierDealPricings,
    atelierEngagements,
    atelierRateCards,
    atelierRateCardRows,
    atelierMarginPolicies,
    atelierBillingRule,
    atelierAuditEvents,
    atelierAgentRuns,
  } = D;
  const { eq, inArray } = await import("drizzle-orm");
  const S = await import("../../src/lib/atelier-pricing-structures.js");

  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const STAMP = Date.now().toString(36);
  const T = `probe663_${STAMP}`;
  const fpId = `u_${T}_fp`;
  const empId = `u_${T}_emp`;

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

  const acctId = `acct_${T}`;
  const oppId = `opp_${T}`;
  const engId = `eng_${T}`;
  const rcId = `rc_${T}`;

  try {
    // ---------- seed ----------
    await db.insert(atelierUsers).values([
      { id: fpId, orgId: "aico", name: "P663 FP", initials: "PF", email: `${T}_fp@example.test`, role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
      { id: empId, orgId: "aico", name: "P663 Emp", initials: "PE", email: `${T}_emp@example.test`, role: "employee", roleLabel: "Consultant", title: "Consultant" },
    ] as any);
    await db.insert(atelierAccounts).values({ id: acctId, orgId: "aico", name: `Probe663 Acct ${STAMP}`, country: "AE", sector: "Probe", createdByUserId: fpId } as any);
    await db.insert(atelierOpportunities).values({
      id: oppId,
      orgId: "aico",
      slug: `probe663-opp-${STAMP}`,
      accountId: acctId,
      name: `Probe663 Opp ${STAMP}`,
      salesStage: "proposal",
      partnerOwnerId: fpId,
      engagementLeadId: fpId,
      dealSizeHypothesis: 500000,
      probabilityPct: 60,
      nextMilestone: "probe",
      sourceLead: "manual",
      createdByUserId: fpId,
    } as any);
    await db.insert(atelierEngagements).values({
      id: engId,
      orgId: "aico",
      slug: `probe663-${STAMP}`,
      name: `Probe663 Eng ${STAMP}`,
      opportunityId: oppId,
      accountId: acctId,
      plmStage: "mobilize",
      partnerOwnerId: fpId,
      engagementLeadId: fpId,
      startDate: "2026-08-03",
      plannedEndDate: "2026-12-31",
      createdByUserId: fpId,
    } as any);
    await db.update(atelierMarginPolicies).set({ isDefault: false } as any).where(eq(atelierMarginPolicies.isDefault, true));
    await db.insert(atelierMarginPolicies).values({
      id: `mpol_${T}`,
      name: `probe663`,
      targetMarginPct: 0.55,
      amberThresholdPct: 0.5,
      redThresholdPct: 0.45,
      twoPartnerThresholdPct: 0.45,
      isDefault: true,
    } as any);
    await db.insert(atelierRateCards).values({
      id: rcId,
      orgId: "aico",
      name: `Probe663 Card`,
      status: "active",
      geography: "UAE",
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      version: 1,
      createdByUserId: fpId,
    } as any);
    await db.insert(atelierRateCardRows).values([
      { id: `rcr_${T}_p`, orgId: "aico", rateCardId: rcId, role: "Partner", seniority: "Partner", dayRateInternalCost: 2000, dayRateClientPrice: 6000, overheadPct: 0.25, currency: "USD", createdByUserId: fpId },
      { id: `rcr_${T}_a`, orgId: "aico", rateCardId: rcId, role: "Analyst", seniority: "Analyst", dayRateInternalCost: 500, dayRateClientPrice: 1500, overheadPct: 0.25, currency: "USD", createdByUserId: fpId },
    ] as any);

    const teamMix = [
      { seniority: "Partner", role: "Lead", ftePct: 0.2 },
      { seniority: "Analyst", role: "Analyst", ftePct: 1 },
    ];
    const durationWeeks = 12;
    const policy = { targetMarginPct: 0.55, amberThresholdPct: 0.5, redThresholdPct: 0.45, twoPartnerThresholdPct: 0.45 } as any;
    const rateCardRows = [
      { role: "Partner", seniority: "Partner", dayRateInternalCost: 2000, dayRateClientPrice: 6000, overheadPct: 0.25 },
      { role: "Analyst", seniority: "Analyst", dayRateInternalCost: 500, dayRateClientPrice: 1500, overheadPct: 0.25 },
    ] as any;
    const baseArgs = { teamMix, durationWeeks, rateCardRows, policy };

    // ---------- 1. legacy regression ----------
    const legacyAll = S.simulateAllStructures(baseArgs);
    const emptyLinesAll = S.simulateAllStructures({ ...baseArgs, costLines: [] });
    check(
      "legacy: simulateAllStructures identical with costLines:[]",
      JSON.stringify(legacyAll) === JSON.stringify(emptyLinesAll),
    );
    const obLegacy = S.simulateStructure({ kind: "outcome_based", params: { feeAtRiskPct: 0.4, successProbabilityPct: 0.6, successMultiplier: 1.5 }, ...baseArgs });
    const obGeneric = S.simulateStructure({ kind: "outcome_based", params: { feeAtRiskPct: 0.4, successProbabilityPct: 0.6, successMultiplier: 1.5, outcomeVariant: "generic" }, ...baseArgs, costLines: [] });
    check(
      "legacy: explicit generic variant bit-identical to omitted variant",
      JSON.stringify(obLegacy) === JSON.stringify(obGeneric),
    );
    check("legacy: costStack present but zeroed", legacyAll[0].costStack.absorbedNonLaborUsd === 0 && legacyAll[0].costStack.passThroughUsd === 0 && legacyAll[0].costStack.lines.length === 0);

    // ---------- 2. cost stack ----------
    const ffBase = S.simulateStructure({ kind: "fixed_fee", ...baseArgs });
    const absorbedLines = [
      { type: "hardware_infra", label: "GPU cluster", amountUsd: 20000, recurrence: "one_time" },
      { type: "llm_ai", label: "LLM tokens", amountUsd: 1000, recurrence: "weekly" },
    ] as any;
    const ffAbs = S.simulateStructure({ kind: "fixed_fee", ...baseArgs, costLines: absorbedLines });
    const wantAbsorbed = 20000 + 1000 * durationWeeks;
    check("cost: absorbed total = one_time + weekly×duration", close(ffAbs.costStack.absorbedNonLaborUsd, wantAbsorbed), ffAbs.costStack);
    check(
      "cost: absorbed raises cost in every band by the absorbed total",
      close(ffAbs.scenarios.best.costUsd - ffBase.scenarios.best.costUsd, wantAbsorbed) &&
        close(ffAbs.scenarios.expected.costUsd - ffBase.scenarios.expected.costUsd, wantAbsorbed) &&
        close(ffAbs.scenarios.worst.costUsd - ffBase.scenarios.worst.costUsd, wantAbsorbed),
      { base: ffBase.scenarios, abs: ffAbs.scenarios },
    );
    check("cost: absorbed lowers margin", ffAbs.scenarios.expected.marginPct < ffBase.scenarios.expected.marginPct);
    check("cost: revenue untouched by absorbed lines", ffAbs.scenarios.expected.revenueUsd === ffBase.scenarios.expected.revenueUsd);

    const ptLines = [
      { type: "travel", label: "Client travel", amountUsd: 3000, recurrence: "monthly", passThrough: true },
      { type: "alliance_partner_quote", label: "Partner quote", amountUsd: 15000, recurrence: "one_time", passThrough: true, quotedAmountUsd: 18000 },
    ] as any;
    const ffPt = S.simulateStructure({ kind: "fixed_fee", ...baseArgs, costLines: ptLines });
    const months = Math.ceil(durationWeeks / 4);
    const wantPt = 3000 * months + 15000;
    check("cost: pass-through total = monthly×months + one_time", close(ffPt.costStack.passThroughUsd, wantPt), ffPt.costStack);
    check(
      "cost: pass-through never touches margin bands",
      JSON.stringify(ffPt.scenarios) === JSON.stringify(ffBase.scenarios),
      { base: ffBase.scenarios, pt: ffPt.scenarios },
    );
    const ptReceipts = ffPt.cashProfile.filter((c: any) => c.passThrough === true);
    check("cost: pass-through rides cash profile flagged", ptReceipts.length === months + 1 && close(ptReceipts.reduce((a: number, c: any) => a + c.amountUsd, 0), wantPt), ptReceipts);
    check("cost: cash total includes pass-through", close(ffPt.cashTotalUsd, ffBase.cashTotalUsd + wantPt, 0.05), { pt: ffPt.cashTotalUsd, base: ffBase.cashTotalUsd });
    check("cost: partner quote metadata preserved", ffPt.costStack.lines.some((l: any) => l.type === "alliance_partner_quote" && l.quotedAmountUsd === 18000));

    // normalizeCostLines defenses
    const norm = S.normalizeCostLines([
      { type: "bogus_type", amountUsd: 100 },
      { type: "travel", amountUsd: -5 },
      { type: "travel", amountUsd: "nope" },
      { type: "llm_ai", amountUsd: 50.555, recurrence: "quarterly" },
    ]);
    check(
      "cost: normalizeCostLines coerces type/recurrence, drops invalid amounts",
      norm.length === 2 && norm[0].type === "other" && norm[1].recurrence === "one_time" && norm[1].amountUsd === 50.56,
      norm,
    );

    // ---------- 3. band weights ----------
    const wDefault = S.normalizeBandWeights(undefined);
    check("weights: default 0.2/0.6/0.2", wDefault.best === 0.2 && wDefault.expected === 0.6 && wDefault.worst === 0.2, wDefault);
    const wNorm = S.normalizeBandWeights({ best: 1, expected: 1, worst: 2 });
    check("weights: non-unit sums normalize", close(wNorm.best, 0.25, 1e-4) && close(wNorm.expected, 0.25, 1e-4) && close(wNorm.worst, 0.5, 1e-4), wNorm);
    check("weights: garbage falls back to default", JSON.stringify(S.normalizeBandWeights({ best: -1, expected: 1, worst: 1 })) === JSON.stringify(wDefault));

    const ffW = S.simulateStructure({ kind: "fixed_fee", params: { bandWeights: { best: 0, expected: 0, worst: 1 } }, ...baseArgs });
    check("weights: worst-only weights → riskAdjusted = worst margin", close(ffW.riskAdjustedMarginPct, ffW.scenarios.worst.marginPct, 1e-3), { ra: ffW.riskAdjustedMarginPct, worst: ffW.scenarios.worst.marginPct });
    check("weights: custom weights echoed in assumptions", ffW.assumptions.bandWeights.worst === 1 && ffW.assumptions.bandWeights.best === 0);
    check("weights: custom weights shift riskAdjusted vs default", ffW.riskAdjustedMarginPct < ffBase.riskAdjustedMarginPct, { custom: ffW.riskAdjustedMarginPct, def: ffBase.riskAdjustedMarginPct });

    // ---------- 4. outcome variants ----------
    // gain_share: share/cap/floor + contingent tranche.
    const gs = S.simulateStructure({
      kind: "outcome_based",
      params: {
        feeUsd: 500000,
        outcomeVariant: "gain_share",
        gainShare: { sharePct: 0.25, capUsd: 120000, floorUsd: 10000, improvementBestUsd: 1000000, improvementExpectedUsd: 400000, improvementWorstUsd: 0, baseFeeUsd: 300000 },
      },
      ...baseArgs,
    });
    // tranches: best min(250k,cap120k)=120k; expected 100k; worst max(0*share,floor10k)=10k
    check("variant gain_share: cap/floor band math", close(gs.scenarios.best.revenueUsd, 420000, 1) && close(gs.scenarios.expected.revenueUsd, 400000, 1) && close(gs.scenarios.worst.revenueUsd, 310000, 1), gs.scenarios);
    check("variant gain_share: expected tranche contingent in cash", gs.cashProfile.some((c: any) => c.contingent === true && close(c.amountUsd, 100000, 1)), gs.cashProfile);

    // volume_unit: tiered marginal revenue + minimum fee.
    const vparams = { pricePerUnit: 10, tiers: [{ fromUnits: 1000, pricePerUnit: 8 }, { fromUnits: 5000, pricePerUnit: 5 }], unitsBest: 10000, unitsExpected: 3000, unitsWorst: 100, minimumFeeUsd: 20000 } as any;
    check("variant volume: tieredVolumeRevenue marginal math", close(S.tieredVolumeRevenue(vparams, 10000), 1000 * 10 + 4000 * 8 + 5000 * 5, 0.01) && close(S.tieredVolumeRevenue(vparams, 3000), 1000 * 10 + 2000 * 8, 0.01));
    check("variant volume: minimum fee floors worst case", close(S.tieredVolumeRevenue(vparams, 100), 20000, 0.01));
    const vu = S.simulateStructure({ kind: "outcome_based", params: { outcomeVariant: "volume_unit", volume: vparams }, ...baseArgs });
    check("variant volume: bands from tiered revenue", close(vu.scenarios.best.revenueUsd, 67000, 1) && close(vu.scenarios.expected.revenueUsd, 26000, 1) && close(vu.scenarios.worst.revenueUsd, 20000, 1), vu.scenarios);
    check("variant volume: all receipts contingent + sum to expected", vu.cashProfile.every((c: any) => c.contingent === true) && close(vu.cashProfile.reduce((a: number, c: any) => a + c.amountUsd, 0), 26000, 0.05), vu.cashProfile);

    // sla_based: worst = last band by default.
    const sla = S.simulateStructure({
      kind: "outcome_based",
      params: { outcomeVariant: "sla_based", sla: { baseFeeUsd: 200000, bands: [{ label: "Met", creditPct: 0 }, { label: "Breach", creditPct: 0.1 }, { label: "Severe", creditPct: 0.3 }] } },
      ...baseArgs,
    });
    check("variant sla: best full fee, worst = last band credit", close(sla.scenarios.best.revenueUsd, 200000, 1) && close(sla.scenarios.expected.revenueUsd, 200000, 1) && close(sla.scenarios.worst.revenueUsd, 140000, 1), sla.scenarios);

    // success_fee: expected value.
    const sf = S.simulateStructure({
      kind: "outcome_based",
      params: { outcomeVariant: "success_fee", successFee: { baseFeeUsd: 250000, successFeeUsd: 100000, successProbabilityPct: 0.4 } },
      ...baseArgs,
    });
    check("variant success_fee: EV math", close(sf.scenarios.best.revenueUsd, 350000, 1) && close(sf.scenarios.expected.revenueUsd, 290000, 1) && close(sf.scenarios.worst.revenueUsd, 250000, 1), sf.scenarios);
    check("variant success_fee: contingent receipt = EV of kicker", sf.cashProfile.some((c: any) => c.contingent === true && close(c.amountUsd, 40000, 1)), sf.cashProfile);
    check("variants: assumptions echo the variant", gs.assumptions.outcomeVariant === "gain_share" && vu.assumptions.outcomeVariant === "volume_unit" && sla.assumptions.outcomeVariant === "sla_based" && sf.assumptions.outcomeVariant === "success_fee");

    // ---------- 5. PUT with costLines + override invalidation ----------
    const putLines = [
      { type: "hardware_infra", label: "Edge devices", amountUsd: 12000, recurrence: "one_time" },
      { type: "travel", label: "Travel", amountUsd: 2000, recurrence: "monthly", passThrough: true },
    ];
    const putBare = await api("PUT", `/opportunities/${oppId}/pricing`, { teamMix, durationWeeks, pricingModel: "fixed_fee", rateCardId: rcId, costLines: [] });
    check("PUT: baseline 200", putBare.status === 200, putBare.body?.error);
    const bareCost = putBare.body.pricing.computedCostUsd;
    const putWith = await api("PUT", `/opportunities/${oppId}/pricing`, { costLines: putLines });
    check("PUT: costLines persisted + normalized", putWith.status === 200 && Array.isArray(putWith.body?.pricing?.costLines) && putWith.body.pricing.costLines.length === 2, putWith.body?.pricing?.costLines);
    check("PUT: computedCostUsd includes absorbed only (not pass-through)", close(putWith.body.pricing.computedCostUsd, bareCost + 12000, 0.05), { got: putWith.body.pricing.computedCostUsd, want: bareCost + 12000 });
    check("PUT: structureSim costStack persisted", close(putWith.body?.structureSim?.costStack?.passThroughUsd ?? -1, 2000 * months, 0.05), putWith.body?.structureSim?.costStack);
    check("PUT: computedMarginPct reflects absorbed cost", putWith.body.pricing.computedMarginPct < putBare.body.pricing.computedMarginPct);

    // costLines change alone invalidates a prior override.
    await db.update(atelierDealPricings).set({ partnerOverrideId: fpId, partnerOverrideAt: new Date(), partnerOverrideRationale: "probe" } as any).where(eq(atelierDealPricings.opportunityId, oppId));
    const putChange = await api("PUT", `/opportunities/${oppId}/pricing`, { costLines: [{ ...putLines[0], amountUsd: 30000 }, putLines[1]] });
    check("PUT: costLines change invalidates prior override", putChange.status === 200 && putChange.body?.pricing?.partnerOverrideId === null, putChange.body?.pricing?.partnerOverrideId);
    // No-op PUT (same lines) must NOT invalidate.
    await db.update(atelierDealPricings).set({ partnerOverrideId: fpId, partnerOverrideAt: new Date(), partnerOverrideRationale: "probe2" } as any).where(eq(atelierDealPricings.opportunityId, oppId));
    const putSame = await api("PUT", `/opportunities/${oppId}/pricing`, {});
    check("PUT: no-op keeps prior override", putSame.status === 200 && putSame.body?.pricing?.partnerOverrideId === fpId, putSame.body?.pricing?.partnerOverrideId);

    // ---------- 6. simulate endpoint with costLines + masking ----------
    const simAll = await api("POST", `/opportunities/${oppId}/pricing/simulate`, { costLines: putLines });
    check("simulate: 7 sims with costStack for partner", simAll.status === 200 && simAll.body?.simulations?.length === 7 && simAll.body.simulations.every((s: any) => s.costStack && close(s.costStack.absorbedNonLaborUsd, 12000, 0.05)), simAll.body?.simulations?.[0]?.costStack);
    const simEmp = await api("POST", `/opportunities/${oppId}/pricing/simulate`, { costLines: putLines }, empId);
    if (simEmp.status === 200) {
      const leaks = (simEmp.body?.simulations ?? []).some(
        (s: any) => (s.scenarios?.expected?.costUsd ?? 0) > 0 || (s.costStack?.absorbedNonLaborUsd ?? 0) > 0 || (s.riskAdjustedMarginPct ?? 0) !== 0,
      );
      check("simulate: cost stack masked for non-costing viewer", !leaks, simEmp.body?.simulations?.[0]);
    } else {
      check("simulate: non-costing viewer blocked or masked", simEmp.status === 403, simEmp.status);
    }

    // ---------- 7. Pricing Researcher (202 + poll, review-only) ----------
    const resEmp = await api("POST", `/opportunities/${oppId}/pricing/researcher`, {}, empId);
    check("researcher: partner-only launch", resEmp.status === 403, resEmp.status);
    const before = await db.select().from(atelierDealPricings).where(eq(atelierDealPricings.opportunityId, oppId));
    const priceBefore = before[0].computedPriceUsd;
    const launch = await api("POST", `/opportunities/${oppId}/pricing/researcher`, { focus: "GCC AI advisory benchmarks" });
    check("researcher: launch 202 running", launch.status === 202 && launch.body?.status === "running", launch);
    let polled: any = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const poll = await api("GET", `/opportunities/${oppId}/pricing/researcher`);
      polled = poll.body;
      if (polled?.status === "succeeded" || polled?.status === "failed") break;
    }
    check("researcher: poll reaches succeeded", polled?.status === "succeeded", polled);
    check("researcher: output persisted with stubbed content", polled?.output?.summary === RESEARCHER_LLM.summary && polled?.output?.suggestedCostLines?.[0]?.type === "llm_ai" && polled?.output?.confidence === "amber", polled?.output);
    const [prAfter] = await db.select().from(atelierDealPricings).where(eq(atelierDealPricings.opportunityId, oppId));
    check("researcher: snapshot on pricing row + runId", prAfter.pricingResearcherRunId === polled?.runId && !!prAfter.pricingResearcherOutput, { runId: prAfter.pricingResearcherRunId });
    check("researcher: review-only — economic terms untouched", prAfter.computedPriceUsd === priceBefore && prAfter.partnerOverrideId === fpId, { before: priceBefore, after: prAfter.computedPriceUsd });
    if (polled?.runId) {
      const [runRow] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, polled.runId));
      check("researcher: agent run row completed", ["succeeded", "completed", "complete"].includes(String(runRow?.status)), runRow?.status);
    }

    // ---------- 8. billing handoff: contingent + pass-through ----------
    // Outcome success_fee with a pass-through line → handoff must flag the
    // contingent kicker and carry pass-through installments at cost.
    await api("PUT", `/opportunities/${oppId}/pricing`, {
      pricingModel: "outcome_based",
      structureParams: { feeUsd: 900000, outcomeVariant: "success_fee", successFee: { baseFeeUsd: 700000, successFeeUsd: 200000, successProbabilityPct: 0.6 } },
      costLines: [{ type: "travel", label: "Travel", amountUsd: 2000, recurrence: "monthly", passThrough: true }],
    });
    // Clear any gate blocker with an explicit override (economic input changed above cleared it).
    await db.update(atelierDealPricings).set({ partnerOverrideId: fpId, partnerOverrideAt: new Date(), partnerOverrideRationale: "probe handoff", countersignPartnerId: empId, countersignAt: new Date() } as any).where(eq(atelierDealPricings.opportunityId, oppId));
    const ho = await api("POST", `/opportunities/${oppId}/pricing/handoff-billing`, { startDate: "2026-08-03" });
    check("handoff: 201", ho.status === 201, ho.body);
    const cfg = ho.body?.rule?.config ?? ho.body?.plan?.config ?? {};
    const contingent = cfg.contingentComponents ?? ho.body?.plan?.config?.contingentComponents ?? [];
    check("handoff: contingent components flagged", Array.isArray(contingent) && contingent.length > 0 && contingent.every((c: any) => c.dueDate && c.expectedAmount > 0), contingent);
    check("handoff: contingent EV = kicker × probability", contingent.some((c: any) => close(c.expectedAmount, 120000, 1)), contingent);
    const planNote = String(ho.body?.plan?.notes ?? ho.body?.rule?.notes ?? "");
    check("handoff: notes flag manual verification", planNote.includes("contingent") || planNote.includes("manual verification"), planNote);
    const installments = (cfg.installments ?? []) as any[];
    const ptInst = installments.filter((i: any) => i.passThrough === true || String(i.label ?? "").toLowerCase().includes("pass-through"));
    check("handoff: pass-through installments at cost", ptInst.length > 0 && close(ptInst.reduce((a: number, c: any) => a + (c.amount ?? 0), 0), 2000 * months, 0.05), installments);
  } finally {
    try {
      await db.delete(atelierBillingRule).where(eq(atelierBillingRule.engagementId, engId));
      await db.delete(atelierDealPricings).where(eq(atelierDealPricings.opportunityId, oppId));
      await db.delete(atelierEngagements).where(eq(atelierEngagements.id, engId));
      const { hardDeleteOpportunities } = await import("../../src/lib/atelier-opportunity-delete.js");
      await hardDeleteOpportunities([oppId]);
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      await db.delete(atelierRateCardRows).where(inArray(atelierRateCardRows.id, [`rcr_${T}_p`, `rcr_${T}_a`]));
      await db.delete(atelierRateCards).where(eq(atelierRateCards.id, rcId));
      await db.delete(atelierMarginPolicies).where(eq(atelierMarginPolicies.id, `mpol_${T}`));
      await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.targetId, oppId));
      await db.delete(atelierAuditEvents).where(inArray(atelierAuditEvents.actorId, [fpId, empId]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, empId]));
    } catch (e) {
      console.error("cleanup error", e);
    }
    server.close();
    stub.close();
    await pool.end();
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
