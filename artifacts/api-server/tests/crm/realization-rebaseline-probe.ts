/**
 * Won-project realization: durable change-order rebaseline probe.
 *
 * Proves that concurrent/replayed applications update the current budget
 * exactly once and leave a durable application receipt.
 */
import "./scratch-db.js";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { and, eq, inArray } from "drizzle-orm";

async function main() {
  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierEngagementBudget,
    atelierEngagementPnlAudit,
  } = D;
  const { applyPostedChangeOrder } =
    await import("../../src/data/atelier-engagement-pnl-seed.js");

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const orgId = `org_real_${stamp}`;
  const engagementId = `eng_real_${stamp}`;
  const changeOrderId = `co_real_${stamp}`;

  try {
    await db.insert(atelierEngagementBudget).values({
      engagementId,
      orgId,
      contractValueUsd: 100_000,
      budgetLabourHours: 1_000,
      budgetLabourCostUsd: 50_000,
      budgetExpensesUsd: 5_000,
      budgetSubsUsd: 5_000,
      budgetAtCompletionUsd: 60_000,
      baselinedAt: "2026-01-01T00:00:00.000Z",
      partnerOwnerId: "partner",
      engagementLeadId: "lead",
      sector: "Test",
    });

    const input = {
      orgId,
      engagementId,
      changeOrderId,
      valueDeltaUsd: 20_000,
      labourHoursDelta: 100,
      labourCostDeltaUsd: 6_000,
      expensesDeltaUsd: 1_000,
      subsDeltaUsd: 2_000,
      actorUserId: "finance",
    };
    const results = await Promise.all([
      applyPostedChangeOrder(input),
      applyPostedChangeOrder(input),
      applyPostedChangeOrder(input),
    ]);
    const applied = results.filter((row) => row.status === "applied").length;
    const replayed = results.filter((row) => row.status === "already_applied").length;
    if (applied !== 1 || replayed !== 2) {
      throw new Error(`expected one application and two replays: ${JSON.stringify(results)}`);
    }

    const [budget] = await db
      .select()
      .from(atelierEngagementBudget)
      .where(eq(atelierEngagementBudget.engagementId, engagementId));
    if (
      budget.contractValueUsd !== 120_000 ||
      budget.budgetLabourHours !== 1_100 ||
      budget.budgetAtCompletionUsd !== 69_000
    ) {
      throw new Error(`budget delta was not applied exactly once: ${JSON.stringify(budget)}`);
    }

    const receipts = await db
      .select()
      .from(atelierEngagementPnlAudit)
      .where(
        and(
          eq(atelierEngagementPnlAudit.orgId, orgId),
          eq(atelierEngagementPnlAudit.engagementId, engagementId),
        ),
      );
    if (
      receipts.filter((row) => row.action === "change_order.application_claimed").length !== 1 ||
      receipts.filter((row) => row.action === "change_order.posted").length !== 1
    ) {
      throw new Error(`durable receipt/audit mismatch: ${JSON.stringify(receipts)}`);
    }

    const replay = await applyPostedChangeOrder(input);
    if (replay.status !== "already_applied") {
      throw new Error(`restart-safe replay contract failed: ${JSON.stringify(replay)}`);
    }
    const [distinctA, distinctB] = await Promise.all([
      applyPostedChangeOrder({
        ...input,
        changeOrderId: `${changeOrderId}_a`,
        valueDeltaUsd: 10_000,
        labourHoursDelta: 0,
        labourCostDeltaUsd: 0,
        expensesDeltaUsd: 0,
        subsDeltaUsd: 0,
      }),
      applyPostedChangeOrder({
        ...input,
        changeOrderId: `${changeOrderId}_b`,
        valueDeltaUsd: 5_000,
        labourHoursDelta: 0,
        labourCostDeltaUsd: 0,
        expensesDeltaUsd: 0,
        subsDeltaUsd: 0,
      }),
    ]);
    const [afterDistinct] = await db
      .select()
      .from(atelierEngagementBudget)
      .where(eq(atelierEngagementBudget.engagementId, engagementId));
    if (
      distinctA.status !== "applied" ||
      distinctB.status !== "applied" ||
      afterDistinct.contractValueUsd !== 135_000
    ) {
      throw new Error(
        `distinct concurrent change orders lost an update: ${JSON.stringify({ distinctA, distinctB, afterDistinct })}`,
      );
    }
    const legacyChangeOrderId = `${changeOrderId}_legacy`;
    await db
      .update(atelierEngagementBudget)
      .set({ contractValueUsd: 142_000 })
      .where(eq(atelierEngagementBudget.engagementId, engagementId));
    await db.insert(atelierEngagementPnlAudit).values({
      id: `legacy_${stamp}`,
      orgId,
      engagementId,
      atIso: "2026-01-02T00:00:00.000Z",
      actorUserId: "finance",
      action: "change_order.posted",
      detail: `${legacyChangeOrderId} posted — engagement re-baselined by the legacy path.`,
    });
    const legacyReplay = await applyPostedChangeOrder({
      ...input,
      changeOrderId: legacyChangeOrderId,
      valueDeltaUsd: 7_000,
    });
    const [afterLegacyReplay] = await db
      .select()
      .from(atelierEngagementBudget)
      .where(eq(atelierEngagementBudget.engagementId, engagementId));
    const [legacyReceipt] = await db
      .select()
      .from(atelierEngagementPnlAudit)
      .where(eq(atelierEngagementPnlAudit.id, `coapply_${legacyChangeOrderId}`));
    if (
      legacyReplay.status !== "already_applied" ||
      afterLegacyReplay.contractValueUsd !== 142_000 ||
      !legacyReceipt
    ) {
      throw new Error(
        `legacy posted retry must backfill its receipt without reapplying: ${JSON.stringify({ legacyReplay, afterLegacyReplay, legacyReceipt })}`,
      );
    }
    console.log("PASS change-order rebaseline is durable, concurrent and replay-safe");
  } finally {
    await db
      .delete(atelierEngagementPnlAudit)
      .where(inArray(atelierEngagementPnlAudit.engagementId, [engagementId]));
    await db
      .delete(atelierEngagementBudget)
      .where(eq(atelierEngagementBudget.engagementId, engagementId));
    await pool.end();
  }
}

main().catch((error) => {
  console.error("FAIL realization rebaseline probe", error);
  process.exitCode = 1;
});