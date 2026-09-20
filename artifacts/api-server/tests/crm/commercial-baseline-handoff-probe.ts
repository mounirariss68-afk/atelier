/**
 * Task 1352 — real scratch-DB behavioural probe.
 *
 * This is intentionally not a migration smoke test. It seeds one isolated
 * tenant, drives the shared stage service, exercises retry/concurrency and
 * removes every row it created. Run after migrations:
 *   pnpm --filter @workspace/api-server test:commercial-handoff
 */
import "./scratch-db.js";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { and, eq, inArray } from "drizzle-orm";

let failures = 0;
function check(name: string, value: boolean, detail?: unknown) {
  if (value) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierAccounts, atelierRateCards, atelierRateCardRows,
    atelierMarginPolicies, atelierOpportunities, atelierDealPricings,
    atelierEngagements, atelierCounterparty, atelierContract,
    atelierSoldPositionSnapshot, atelierBillingRule, atelierOpportunityStageTransitions,
     atelierEngagementBudget, atelierEngagementEtc, atelierEngagementCostToDate,
  } = D as any;
  const { applyStageTransition } =
    await import("../../src/lib/atelier-agents/stage-service.js");
  const { simulateStructure } =
    await import("../../src/lib/atelier-pricing-structures.js");

  const tag = `probe1352_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const orgId = `org_${tag}`;
  const otherOrg = `other_${tag}`;
  const userId = `user_${tag}`;
  const accountId = `acct_${tag}`;
  const cardId = `card_${tag}`;
  const oppId = `opp_${tag}`;
  const ids = [oppId];
  const actor = {
    id: userId,
    name: "Commercial handoff probe",
    orgId,
    role: "founding_partner",
  };
  const mix = [{ seniority: "Analyst", role: "delivery", ftePct: 1 }];
  const params = { feeUsd: 10000, paymentTermsDays: 15, installments: [
    { label: "Start", pctOfFee: 1, offsetWeeks: 0 },
  ] };
  const costs = [{ type: "travel", label: "Travel", amountUsd: 400, recurrence: "one_time" }];
  const approval = {
    partnerOverrideId: `override_${tag}`, partnerOverrideAt: new Date(Date.now() + 1000),
    countersignPartnerId: `counter_${tag}`, countersignAt: new Date(Date.now() + 1000),
  };

  const insertOpp = async (id: string, org: string, pricing?: boolean) => {
    await db.insert(atelierOpportunities).values({
      id, orgId: org, slug: id, name: `Handoff ${id}`, accountId,
      salesStage: "runner", partnerOwnerId: userId, engagementLeadId: userId,
      dealSizeHypothesis: 10000, probabilityPct: 80, nextMilestone: "signed SOW",
      sourceLead: "probe",
    } as any);
    if (pricing) {
      const rateRows = [{
        seniority: "Analyst",
        dayRateInternalCost: 250,
        dayRateClientPrice: 500,
        overheadPct: 0,
      }];
      const policy = {
        targetMarginPct: 0.55,
        amberThresholdPct: 0.5,
        redThresholdPct: 0.45,
        twoPartnerThresholdPct: 0.5,
      };
      const sim = simulateStructure({
        kind: "fixed_fee",
        params,
        teamMix: mix,
        durationWeeks: 4,
        rateCardRows: rateRows,
        policy,
        costLines: costs,
      });
      await db.insert(atelierDealPricings).values({
        id: `pricing_${id}`, orgId: org, opportunityId: id, rateCardId: cardId,
        pricingModel: "fixed_fee", durationWeeks: 4, teamMix: mix,
        computedCostUsd: sim.scenarios.expected.costUsd,
        computedPriceUsd: sim.scenarios.expected.revenueUsd,
        computedMarginPct: sim.scenarios.expected.marginPct,
        riskAdjustedMarginPct: sim.riskAdjustedMarginPct,
        targetMarginPct: 0.55,
        marginLockStatus: sim.marginLockStatus,
        structureParams: params,
        structureSim: {
          ...sim,
          pricingBasis: { rateCardId: cardId, currency: "USD", rateCardRows: rateRows, policy },
        },
        costLines: costs,
        ...approval,
      } as any);
    }
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId, orgId, name: actor.name, initials: "CH", email: `${tag}@test.invalid`,
      role: "founding_partner", roleLabel: "Founding Partner", title: "Partner",
    } as any);
    await db.insert(atelierAccounts).values({
      id: accountId, orgId, name: `Handoff Client ${tag}`, country: "AE", sector: "Technology",
    } as any);
    await db.insert(atelierRateCards).values({
      id: cardId, orgId, name: "Probe card", status: "active", geography: "AE", currency: "USD",
    } as any);
    await db.insert(atelierRateCardRows).values({
      id: `row_${tag}`, orgId, rateCardId: cardId, role: "delivery", seniority: "Analyst",
      dayRateInternalCost: 250, dayRateClientPrice: 500, overheadPct: 0,
    } as any);
    await db.insert(atelierMarginPolicies).values({
      id: `policy_${tag}`, orgId, name: "default", targetMarginPct: 0.55,
      amberThresholdPct: 0.5, redThresholdPct: 0.45, twoPartnerThresholdPct: 0.5,
      isDefault: true,
    } as any);

    // Fail closed: no saved pricing.
    const noPrice = `opp_noprice_${tag}`;
    ids.push(noPrice);
    await insertOpp(noPrice, orgId, false);
    const noPriceRow = (await db.select().from(atelierOpportunities).where(eq(atelierOpportunities.id, noPrice)))[0];
    const blocked = await applyStageTransition(noPriceRow, {
      toStage: "contract", rationaleText: "probe", signedInstrumentFileId: "signed-no-price",
      evidenceArtifactIds: ["signed-no-price"], source: "probe",
    }, actor);
    check("missing pricing fails closed", !blocked.ok && blocked.error === "contract-pricing-required");

    const unsigned = `opp_unsigned_${tag}`;
    ids.push(unsigned);
    await insertOpp(unsigned, orgId, true);
    const unsignedRow = (await db.select().from(atelierOpportunities).where(eq(atelierOpportunities.id, unsigned)))[0];
    const unsignedOverride = await applyStageTransition(
      unsignedRow,
      {
        toStage: "contract",
        rationaleText: "probe unsigned override",
        evidenceArtifactIds: [],
        partnerOverride: true,
        source: "probe",
      },
      actor,
    );
    check(
      "partner override cannot create an unsigned baseline",
      !unsignedOverride.ok &&
        unsignedOverride.error === "contract-signed-instrument-required",
      unsignedOverride,
    );

    await insertOpp(oppId, orgId, true);
    const opp = (await db.select().from(atelierOpportunities).where(eq(atelierOpportunities.id, oppId)))[0];
    const input = {
      toStage: "contract" as const, rationaleText: "probe signed handoff",
      signedInstrumentFileId: `file_${tag}`, evidenceArtifactIds: [`file_${tag}`],
      source: "probe",
    };
    const crossTenant = await applyStageTransition(
      opp,
      input,
      { ...actor, orgId: otherOrg },
    );
    check(
      "cross-tenant actor is rejected",
      !crossTenant.ok && crossTenant.error === "cross-tenant-stage-transition",
      crossTenant,
    );
    const [first, second] = await Promise.all([
      applyStageTransition(opp, input, actor),
      applyStageTransition(opp, input, actor),
    ]);
    check("concurrent transition has a success", first.ok || second.ok, [first, second]);
    const retryOpp = (await db.select().from(atelierOpportunities).where(eq(atelierOpportunities.id, oppId)))[0];
    const firstSignedAt = retryOpp.contractSignedAt?.getTime();
    const retry = await applyStageTransition(retryOpp, input, actor);
    check("retry does not fail handoff", retry.ok, retry);
    const retriedOpp = (await db.select().from(atelierOpportunities).where(eq(atelierOpportunities.id, oppId)))[0];
    check(
      "retry preserves the original signed timestamp",
      !!firstSignedAt && retriedOpp.contractSignedAt?.getTime() === firstSignedAt,
      { firstSignedAt, retriedSignedAt: retriedOpp.contractSignedAt?.getTime() },
    );

    const [engagements, contracts, snapshots, rules, transitions, budgets, etcs] = await Promise.all([
      db.select().from(atelierEngagements).where(eq(atelierEngagements.opportunityId, oppId)),
      db.select().from(atelierContract).where(eq(atelierContract.opportunityId, oppId)),
      db.select().from(atelierSoldPositionSnapshot).where(eq(atelierSoldPositionSnapshot.opportunityId, oppId)),
      db.select().from(atelierBillingRule).where(eq(atelierBillingRule.engagementId, `eng_${oppId}`)),
      db.select().from(atelierOpportunityStageTransitions).where(eq(atelierOpportunityStageTransitions.opportunityId, oppId)),
      db.select().from(atelierEngagementBudget).where(eq(atelierEngagementBudget.engagementId, `eng_${oppId}`)),
      db.select().from(atelierEngagementEtc).where(eq(atelierEngagementEtc.engagementId, `eng_${oppId}`)),
    ]);
    check("stage is contract", retryOpp.salesStage === "contract");
    check("exactly one engagement/contract/snapshot/billing rule", engagements.length === 1 && contracts.length === 1 && snapshots.length === 1 && rules.length === 1, { engagements: engagements.length, contracts: contracts.length, snapshots: snapshots.length, rules: rules.length });
    const snap = snapshots[0];
    check("snapshot freezes structure, cost lines, approvals and downstream IDs",
      snap.pricingInputs.structureParams.feeUsd === params.feeUsd &&
      snap.pricingInputs.costLines[0].amountUsd === costs[0].amountUsd &&
      snap.pricingProvenance.approvals.partnerOverrideId === approval.partnerOverrideId &&
      snap.pricingProvenance.contractId === contracts[0].id &&
      snap.pricingProvenance.engagementId === engagements[0].id &&
      snap.pricingProvenance.billingRuleId === rules[0].id &&
      snap.pricingProvenance.signedInstrumentFileId === input.signedInstrumentFileId);
    check("signed evidence activates SOW", contracts[0].status === "active" && !!contracts[0].fullyExecutedAt);
    check(
      "handoff creates one reconciled engagement budget and ETC baseline",
      budgets.length === 1 &&
        etcs.length === 1 &&
        budgets[0].contractValueUsd === snap.soldPriceUsd &&
        budgets[0].budgetLabourHours === snap.soldHours &&
        budgets[0].budgetLabourCostUsd === 5_000 &&
        budgets[0].budgetExpensesUsd === 400 &&
        budgets[0].budgetSubsUsd === 0 &&
        budgets[0].budgetAtCompletionUsd === snap.soldCostUsd &&
        etcs[0].method === "extrapolation",
      { budget: budgets[0], etc: etcs[0], sold: snap },
    );
    check("retry transition rows are bounded", transitions.length >= 1 && transitions.length <= 3);
    check("tenant scope does not leak", (await db.select().from(atelierEngagements).where(eq(atelierEngagements.orgId, otherOrg))).length === 0);

    let contractMutationBlocked = false;
    try {
      await db
        .update(atelierContract)
        .set({ contractValue: contracts[0].contractValue + 1 })
        .where(eq(atelierContract.id, contracts[0].id));
    } catch {
      contractMutationBlocked = true;
    }
    check("signed contract economics are immutable", contractMutationBlocked);

    let billingMutationBlocked = false;
    try {
      await db
        .update(atelierBillingRule)
        .set({ paymentTermsDays: rules[0].paymentTermsDays + 1 })
        .where(eq(atelierBillingRule.id, rules[0].id));
    } catch {
      billingMutationBlocked = true;
    }
    check("baseline billing economics are immutable", billingMutationBlocked);

    // Approval gates: amber without override and red without countersign.
    const gateOpp = `opp_gate_${tag}`;
    ids.push(gateOpp);
    await insertOpp(gateOpp, orgId, true);
    await db.update(atelierDealPricings).set({ partnerOverrideId: null, partnerOverrideAt: null, countersignPartnerId: null, countersignAt: null }).where(eq(atelierDealPricings.opportunityId, gateOpp));
    const gateRow = (await db.select().from(atelierOpportunities).where(eq(atelierOpportunities.id, gateOpp)))[0];
    const amber = await applyStageTransition(gateRow, input, actor);
    check("amber approval gate enforced", !amber.ok && amber.error === "contract-margin-approval-required");
    await db.update(atelierDealPricings).set({ partnerOverrideId: approval.partnerOverrideId, partnerOverrideAt: new Date(Date.now() + 1000), countersignPartnerId: null, countersignAt: null, riskAdjustedMarginPct: 0.4, marginLockStatus: "red" }).where(eq(atelierDealPricings.opportunityId, gateOpp));
    const red = await applyStageTransition(gateRow, input, actor);
    check("red countersign gate enforced", !red.ok && red.error === "contract-countersign-required");
  } finally {
    // Child-first cleanup keeps this safe on both scratch schemas.
    await db.delete(atelierEngagementCostToDate).where(inArray(atelierEngagementCostToDate.engagementId, ids.map((id) => `eng_${id}`)));
    await db.delete(atelierEngagementEtc).where(inArray(atelierEngagementEtc.engagementId, ids.map((id) => `eng_${id}`)));
    await db.delete(atelierEngagementBudget).where(inArray(atelierEngagementBudget.engagementId, ids.map((id) => `eng_${id}`)));
    await db.delete(atelierSoldPositionSnapshot).where(inArray(atelierSoldPositionSnapshot.opportunityId, ids));
    await db.delete(atelierBillingRule).where(eq(atelierBillingRule.engagementId, `eng_${oppId}`));
    await db.delete(atelierContract).where(inArray(atelierContract.opportunityId, ids));
    await db.delete(atelierEngagements).where(inArray(atelierEngagements.opportunityId, ids));
    await db.delete(atelierCounterparty).where(eq(atelierCounterparty.accountId, accountId));
    await db.delete(atelierDealPricings).where(inArray(atelierDealPricings.opportunityId, ids));
    await db.delete(atelierOpportunityStageTransitions).where(inArray(atelierOpportunityStageTransitions.opportunityId, ids));
    await db.delete(atelierOpportunities).where(inArray(atelierOpportunities.id, ids));
    await db.delete(atelierMarginPolicies).where(eq(atelierMarginPolicies.orgId, orgId));
    await db.delete(atelierRateCardRows).where(eq(atelierRateCardRows.orgId, orgId));
    await db.delete(atelierRateCards).where(eq(atelierRateCards.orgId, orgId));
    await db.delete(atelierAccounts).where(eq(atelierAccounts.orgId, orgId));
    await db.delete(atelierUsers).where(eq(atelierUsers.orgId, orgId));
    await pool.end();
  }
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FAIL commercial handoff behavioural probe", error);
  process.exitCode = 1;
});