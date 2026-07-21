/**
 * Task #435 — Engagement pricing structures probe.
 *
 * Deterministic (Anthropic stubbed). Covers:
 *   1. Simulation math: all 7 kinds, capped-T&M worst-case cap, fixed-fee
 *      revenue invariance, outcome-based expected value, risk-adjusted
 *      margin = weighted band blend, cash profiles sum to revenue.
 *   2. PUT pricing: margin lock gates on the RISK-ADJUSTED margin (an
 *      outcome-based structure whose expected margin looks green must
 *      gate on the blended figure); approval invalidation on
 *      structureParams change.
 *   3. Simulate endpoint: 7 sims returned; masked for non-costing viewer.
 *   4. Rate-card versioning: clone rows + uplift, closes prior version,
 *      version increments, 409 when effectiveFrom not after current,
 *      partner-only.
 *   5. Pricing Analyst route (stub LLM): scenarios + recommendation among
 *      simulated kinds; snapshot persisted on the pricing row.
 *   6. Billing handoff: 409 while override required; after override,
 *      creates an atelier_billing_rule and stamps the pricing row.
 *   7. Trends: structure filter includes general entries.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/pricing-structures-probe.ts
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

const ANALYST_LLM = {
  recommendedKind: "fixed_fee",
  rationale: "Fixed fee clears the risk-adjusted target and front-loads cash.",
  tradeoffs: ["Firm carries overrun risk", "Change control must be strict"],
  trendNotes: ["Outcome-linked components are increasingly expected."],
};

async function main() {
  // Stub Anthropic BEFORE the app import (client reads env at import time).
  const stub = createServer((req, res) => {
    let body = "";
    req.on("data", (ch) => (body += ch));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_probe435",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [{ type: "text", text: JSON.stringify(ANALYST_LLM) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    });
  });
  stub.listen(0);
  await new Promise<void>((r) => stub.once("listening", () => r()));
  const stubPort = (stub.address() as AddressInfo).port;
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "probe435-stub-key";

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
  const { eq, like, inArray } = await import("drizzle-orm");
  const S = await import("../../src/lib/atelier-pricing-structures.js");

  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const STAMP = Date.now().toString(36);
  const T = `probe435_${STAMP}`;
  const fpId = `u_${T}_fp`;
  const fp2Id = `u_${T}_fp2`;
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
      { id: fpId, orgId: "aico", name: "P435 FP", initials: "PF", email: `${T}_fp@example.test`, role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
      { id: fp2Id, orgId: "aico", name: "P435 FP2", initials: "P2", email: `${T}_fp2@example.test`, role: "partner", roleLabel: "Partner", title: "Partner" },
      { id: empId, orgId: "aico", name: "P435 Emp", initials: "PE", email: `${T}_emp@example.test`, role: "employee", roleLabel: "Consultant", title: "Consultant" },
    ] as any);
    await db.insert(atelierAccounts).values({ id: acctId, orgId: "aico", name: `Probe435 Acct ${STAMP}`, country: "AE", sector: "Probe", createdByUserId: fpId } as any);
    await db.insert(atelierOpportunities).values({
      id: oppId,
      orgId: "aico",
      slug: `probe435-opp-${STAMP}`,
      accountId: acctId,
      name: `Probe435 Opp ${STAMP}`,
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
      slug: `probe435-${STAMP}`,
      name: `Probe435 Eng ${STAMP}`,
      opportunityId: oppId,
      accountId: acctId,
      plmStage: "mobilize",
      partnerOwnerId: fpId,
      engagementLeadId: fpId,
      startDate: "2026-08-03",
      plannedEndDate: "2026-12-31",
      createdByUserId: fpId,
    } as any);
    // Deterministic margin policy.
    await db.update(atelierMarginPolicies).set({ isDefault: false } as any).where(eq(atelierMarginPolicies.isDefault, true));
    await db.insert(atelierMarginPolicies).values({
      id: `mpol_${T}`,
      name: `probe435`,
      targetMarginPct: 0.55,
      amberThresholdPct: 0.5,
      redThresholdPct: 0.45,
      twoPartnerThresholdPct: 0.45,
      isDefault: true,
    } as any);
    const effectiveFrom = new Date("2026-01-01T00:00:00Z");
    await db.insert(atelierRateCards).values({
      id: rcId,
      orgId: "aico",
      name: `Probe435 Card`,
      status: "active",
      geography: "UAE",
      currency: "USD",
      effectiveFrom,
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

    // ---------- 1. simulation math ----------
    const sims = S.simulateAllStructures({ teamMix, durationWeeks, rateCardRows, policy });
    check("sim: 7 structures", sims.length === 7 && new Set(sims.map((s: any) => s.kind)).size === 7, sims.map((s: any) => s.kind));
    for (const s of sims) {
      check(
        `sim ${s.kind}: bands ordered best>=expected>=worst`,
        s.scenarios.best.marginPct >= s.scenarios.expected.marginPct - 1e-9 &&
          s.scenarios.expected.marginPct >= s.scenarios.worst.marginPct - 1e-9,
        s.scenarios,
      );
      const blended = 0.2 * s.scenarios.best.marginPct + 0.6 * s.scenarios.expected.marginPct + 0.2 * s.scenarios.worst.marginPct;
      check(`sim ${s.kind}: risk-adjusted = weighted blend`, close(s.riskAdjustedMarginPct, blended, 0.001), { got: s.riskAdjustedMarginPct, want: blended });
      const cashSum = s.cashProfile.reduce((a: number, c: any) => a + c.amountUsd, 0);
      check(`sim ${s.kind}: cash profile totals`, close(cashSum, s.cashTotalUsd, 0.05), { cashSum, total: s.cashTotalUsd });
    }
    const ff = sims.find((s: any) => s.kind === "fixed_fee")!;
    check("sim fixed_fee: revenue invariant across bands", ff.scenarios.best.revenueUsd === ff.scenarios.expected.revenueUsd && ff.scenarios.expected.revenueUsd === ff.scenarios.worst.revenueUsd);
    const tnm = sims.find((s: any) => s.kind === "tnm")!;
    check("sim tnm: margin stable across bands", close(tnm.scenarios.best.marginPct, tnm.scenarios.worst.marginPct, 0.02), tnm.scenarios);
    const capped = sims.find((s: any) => s.kind === "capped_tnm")!;
    const basePrice = tnm.scenarios.expected.revenueUsd;
    check("sim capped_tnm: worst revenue capped at 110% base", close(capped.scenarios.worst.revenueUsd, Math.round(basePrice * 1.1 * 100) / 100, 1), { worst: capped.scenarios.worst.revenueUsd, cap: basePrice * 1.1 });
    const ob = S.simulateStructure({
      kind: "outcome_based",
      params: { feeUsd: 1000000, feeAtRiskPct: 0.4, successProbabilityPct: 0.5, successMultiplier: 1.5 },
      teamMix, durationWeeks, rateCardRows, policy,
    });
    // base 600k; success fee 400k*1.5=600k. expected rev 600k + 600k*0.5 = 900k
    check("sim outcome_based: expected value math", close(ob.scenarios.expected.revenueUsd, 900000, 1) && close(ob.scenarios.worst.revenueUsd, 600000, 1) && close(ob.scenarios.best.revenueUsd, 1200000, 1), ob.scenarios);

    // ---------- 2. PUT gates on risk-adjusted margin ----------
    // Choose an outcome-based fee where the EXPECTED margin is green but the
    // blended risk-adjusted margin dips below target → gate must not be green
    // on the expected case alone.
    const putGreen = await api("PUT", `/opportunities/${oppId}/pricing`, {
      teamMix, durationWeeks, pricingModel: "tnm", rateCardId: rcId,
    });
    check("PUT tnm: 200 + riskAdjusted persisted", putGreen.status === 200 && typeof putGreen.body?.pricing?.riskAdjustedMarginPct === "number", putGreen.body?.error);
    check("PUT tnm: structureSim persisted", putGreen.body?.pricing?.structureSim?.kind === "tnm", putGreen.body?.pricing?.structureSim?.kind);
    const tnmGate = putGreen.body.pricing.marginLockStatus;
    check(
      "PUT: lock status matches risk-adjusted classification",
      tnmGate === putGreen.body.structureSim.marginLockStatus,
      { lock: tnmGate, sim: putGreen.body.structureSim.marginLockStatus },
    );

    // Legacy model value normalizes.
    const putLegacy = await api("PUT", `/opportunities/${oppId}/pricing`, { pricingModel: "time_and_materials" });
    check("PUT legacy time_and_materials: normalizes to tnm sim", putLegacy.status === 200 && putLegacy.body?.structureSim?.kind === "tnm", putLegacy.body?.structureSim?.kind);

    // Outcome-based with heavy at-risk share: expected margin can look fine,
    // risk-adjusted must gate. Compute both to assert the gate followed the
    // risk-adjusted figure, not the expected one.
    const obParams = { feeAtRiskPct: 0.6, successProbabilityPct: 0.5, successMultiplier: 1.0 };
    const obSim = S.simulateStructure({ kind: "outcome_based", params: obParams as any, teamMix, durationWeeks, rateCardRows, policy });
    const putOb = await api("PUT", `/opportunities/${oppId}/pricing`, {
      pricingModel: "outcome_based",
      structureParams: obParams,
    });
    check("PUT outcome_based: gate uses risk-adjusted margin", putOb.status === 200 && putOb.body?.pricing?.marginLockStatus === obSim.marginLockStatus, { got: putOb.body?.pricing?.marginLockStatus, want: obSim.marginLockStatus });
    check(
      "PUT outcome_based: risk-adjusted below expected-case margin",
      putOb.body.pricing.riskAdjustedMarginPct < putOb.body.pricing.computedMarginPct,
      { ra: putOb.body.pricing.riskAdjustedMarginPct, exp: putOb.body.pricing.computedMarginPct },
    );

    // Approval invalidation on structureParams change.
    await db.update(atelierDealPricings).set({ partnerOverrideId: fp2Id, partnerOverrideAt: new Date(), partnerOverrideRationale: "probe" } as any).where(eq(atelierDealPricings.opportunityId, oppId));
    const putParamChange = await api("PUT", `/opportunities/${oppId}/pricing`, {
      pricingModel: "outcome_based",
      structureParams: { ...obParams, successProbabilityPct: 0.9 },
    });
    check("PUT structureParams change: prior override invalidated", putParamChange.status === 200 && putParamChange.body?.pricing?.partnerOverrideId === null, putParamChange.body?.pricing?.partnerOverrideId);

    // Non-partner cannot persist.
    const putEmp = await api("PUT", `/opportunities/${oppId}/pricing`, { pricingModel: "tnm" }, empId);
    check("PUT: non-partner 403", putEmp.status === 403, putEmp.status);

    // ---------- 3. simulate endpoint + masking ----------
    const simAll = await api("POST", `/opportunities/${oppId}/pricing/simulate`, {});
    check("simulate: 7 sims for partner", simAll.status === 200 && simAll.body?.simulations?.length === 7, simAll.body?.simulations?.length);
    check("simulate: partner sees margins", typeof simAll.body?.simulations?.[0]?.riskAdjustedMarginPct === "number" && simAll.body.simulations[0].riskAdjustedMarginPct !== 0);
    const simEmp = await api("POST", `/opportunities/${oppId}/pricing/simulate`, {}, empId);
    if (simEmp.status === 200) {
      const anyCost = (simEmp.body?.simulations ?? []).some(
        (s: any) => (s.scenarios?.expected?.costUsd ?? 0) > 0 || (s.riskAdjustedMarginPct ?? 0) !== 0,
      );
      check("simulate: non-costing viewer masked", !anyCost, simEmp.body?.simulations?.[0]);
    } else {
      check("simulate: non-costing viewer blocked or masked", simEmp.status === 403, simEmp.status);
    }
    const getEmp = await api("GET", `/opportunities/${oppId}/pricing`, undefined, empId);
    check(
      "GET pricing: risk-adjusted + sim masked (or blocked) for employee",
      getEmp.status === 403 ||
        (getEmp.status === 200 && getEmp.body?.pricing?.riskAdjustedMarginPct == null && getEmp.body?.pricing?.structureSim == null),
      { status: getEmp.status, ra: getEmp.body?.pricing?.riskAdjustedMarginPct, sim: !!getEmp.body?.pricing?.structureSim },
    );

    // ---------- 4. rate-card versioning ----------
    const badVer = await api("POST", `/rate-cards/${rcId}/new-version`, { effectiveFrom: "2025-12-01" });
    check("new-version: 409 when effectiveFrom not after current", badVer.status === 409 && badVer.body?.error === "effective-from-not-after-current", badVer.body);
    const empVer = await api("POST", `/rate-cards/${rcId}/new-version`, { effectiveFrom: "2026-09-01" }, empId);
    check("new-version: partner-only", empVer.status === 403, empVer.status);
    const okVer = await api("POST", `/rate-cards/${rcId}/new-version`, { effectiveFrom: "2026-09-01", upliftPct: 0.1 });
    check("new-version: 201 + version incremented + supersedes", okVer.status === 201 && okVer.body?.card?.version === 2 && okVer.body?.card?.supersedesId === rcId, okVer.body);
    check("new-version: rows cloned", okVer.body?.rowsCloned === 2, okVer.body?.rowsCloned);
    const newRows = await db.select().from(atelierRateCardRows).where(eq(atelierRateCardRows.rateCardId, okVer.body.card.id));
    const partnerRow = newRows.find((r: any) => r.seniority === "Partner");
    check("new-version: uplift applied to client price only", !!partnerRow && close(partnerRow.dayRateClientPrice, 6600, 0.01) && partnerRow.dayRateInternalCost === 2000, partnerRow);
    const [oldCard] = await db.select().from(atelierRateCards).where(eq(atelierRateCards.id, rcId));
    check("new-version: prior version closed at new effectiveFrom", oldCard.effectiveTo?.toISOString().slice(0, 10) === "2026-09-01", oldCard.effectiveTo);

    // ---------- 5. Pricing Analyst (stub LLM) ----------
    const analyst = await api("POST", `/opportunities/${oppId}/pricing/analyst`, {});
    check("analyst: 200 with 7 scenarios", analyst.status === 200 && analyst.body?.scenarios?.length === 7, analyst.body?.error ?? analyst.body?.scenarios?.length);
    check("analyst: recommendation among simulated kinds", analyst.body?.recommendation?.kind === "fixed_fee" && analyst.body?.recommendation?.rationale === ANALYST_LLM.rationale, analyst.body?.recommendation);
    check("analyst: sensitivity per structure", analyst.body?.sensitivity?.length === 7);
    const [prAfter] = await db.select().from(atelierDealPricings).where(eq(atelierDealPricings.opportunityId, oppId));
    check("analyst: snapshot persisted on pricing row", prAfter.pricingAnalystRunId === analyst.body.runId && !!prAfter.pricingAnalystOutput, { runId: prAfter.pricingAnalystRunId });
    const [runRow] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, analyst.body.runId));
    check("analyst: agent run row completed", ["succeeded", "completed", "complete"].includes(String(runRow?.status)), runRow?.status);

    // ---------- 6. billing handoff gating ----------
    // Force a red risk-adjusted margin with no override → 409.
    await db.update(atelierDealPricings).set({
      riskAdjustedMarginPct: 0.30,
      partnerOverrideId: null, countersignPartnerId: null,
    } as any).where(eq(atelierDealPricings.opportunityId, oppId));
    const hoBlocked = await api("POST", `/opportunities/${oppId}/pricing/handoff-billing`, {});
    check("handoff: 409 override-required on red margin", hoBlocked.status === 409 && String(hoBlocked.body?.error).includes("required-before-handoff"), hoBlocked.body);
    // Green margin path (tnm) → 201, rule created, pricing stamped.
    await api("PUT", `/opportunities/${oppId}/pricing`, { pricingModel: "tnm", structureParams: {} });
    const hoEmp = await api("POST", `/opportunities/${oppId}/pricing/handoff-billing`, {}, empId);
    check("handoff: partner-only", hoEmp.status === 403, hoEmp.status);
    const ho = await api("POST", `/opportunities/${oppId}/pricing/handoff-billing`, { startDate: "2026-08-03" });
    check("handoff: 201 + periodic_tnm rule", ho.status === 201 && ho.body?.rule?.ruleType === "periodic_tnm" && ho.body?.rule?.engagementId === engId, ho.body);
    const [prHo] = await db.select().from(atelierDealPricings).where(eq(atelierDealPricings.opportunityId, oppId));
    check("handoff: pricing row stamped with billingRuleId", prHo.billingRuleId === ho.body.rule.id && !!prHo.billingHandoffAt, { ruleId: prHo.billingRuleId });

    // ---------- 7. trends ----------
    const trends = await api("GET", `/pricing/trends?structure=outcome_based`);
    const structs = new Set((trends.body?.items ?? []).map((t: any) => t.structure));
    check("trends: filtered to structure + general", trends.status === 200 && (trends.body?.items?.length ?? 0) > 0 && [...structs].every((s) => s === "outcome_based" || s === "general"), [...structs]);
    const trendsAll = await api("GET", `/pricing/trends`);
    check("trends: unfiltered returns full guidance", (trendsAll.body?.items?.length ?? 0) >= (trends.body?.items?.length ?? 0));
  } finally {
    // ---------- cleanup (belt + suspenders; scratch DB anyway) ----------
    try {
      await db.delete(atelierBillingRule).where(eq(atelierBillingRule.engagementId, engId));
      await db.delete(atelierDealPricings).where(eq(atelierDealPricings.opportunityId, oppId));
      await db.delete(atelierEngagements).where(eq(atelierEngagements.id, engId));
      await db.delete(atelierOpportunities).where(eq(atelierOpportunities.id, oppId));
      await db.delete(atelierAccounts).where(eq(atelierAccounts.id, acctId));
      const cards = await db.select().from(atelierRateCards).where(like(atelierRateCards.name, `Probe435%`));
      const cardIds = cards.map((c: any) => c.id);
      if (cardIds.length) {
        await db.delete(atelierRateCardRows).where(inArray(atelierRateCardRows.rateCardId, cardIds));
        await db.delete(atelierRateCards).where(inArray(atelierRateCards.id, cardIds));
      }
      await db.delete(atelierMarginPolicies).where(eq(atelierMarginPolicies.id, `mpol_${T}`));
      await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.actorId, `u_${T}%`));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [fpId, fp2Id, empId]));
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
