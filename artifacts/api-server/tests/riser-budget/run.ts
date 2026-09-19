import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import {
  db,
  atelierAssistantBudgetEvents,
  atelierAssistantBudgetLedgers,
  atelierAssistantBudgetReservations,
} from "@workspace/db";
import {
  commitAssistantBudget,
  refundAssistantBudget,
  reconcileExpiredAssistantBudgetReservations,
  reserveAssistantBudget,
  reserveRequiredAssistantBudget,
} from "../../src/lib/assistant/budget-runtime.js";

const suffix = randomUUID();
const orgId = `p_budget_${suffix}`;
const parentLedgerId = `budget_parent_${suffix}`;
const childLedgerId = `budget_child_${suffix}`;
const expiresAt = new Date(Date.now() + 60_000);
const limits = {
  maxCostMicros: 10_000,
  maxProviderCalls: 10,
  maxToolCalls: 10,
  maxWallMs: 10_000,
  maxConcurrentSlots: 5,
};

try {
  await db.insert(atelierAssistantBudgetLedgers).values([
    {
      id: parentLedgerId,
      orgId,
      ownerType: "conversation",
      ownerId: `conversation_${suffix}`,
      policyVersion: "budget-v1",
      ...limits,
      expiresAt,
    },
    {
      id: childLedgerId,
      orgId,
      ownerType: "turn",
      ownerId: `turn_${suffix}`,
      parentLedgerId,
      policyVersion: "budget-v1",
      ...limits,
      expiresAt,
    },
  ]);

  const races = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) =>
      reserveAssistantBudget({
        orgId,
        ledgerId: childLedgerId,
        idempotencyKey: `race_${suffix}_${index}`,
        amount: {
          costMicros: 100,
          providerCalls: 1,
          toolCalls: 1,
          wallMs: 100,
          concurrentSlots: 1,
        },
        leaseMs: 60_000,
      })),
  );
  const reserved = races.filter(
    (result): result is PromiseFulfilledResult<{ reservationId: string; replay: boolean }> =>
      result.status === "fulfilled",
  );
  const exhausted = races.filter((result) =>
    result.status === "rejected" &&
    result.reason instanceof Error &&
    result.reason.message === "budget-exhausted");
  assert.equal(reserved.length, 5);
  assert.equal(exhausted.length, 15);
  const replay = await reserveAssistantBudget({
    orgId,
    ledgerId: childLedgerId,
    idempotencyKey: `race_${suffix}_0`,
    amount: {
      costMicros: 100,
      providerCalls: 1,
      toolCalls: 1,
      wallMs: 100,
      concurrentSlots: 1,
    },
    leaseMs: 60_000,
  });
  assert.equal(replay.replay, true);
  await assert.rejects(
    reserveAssistantBudget({
      orgId,
      ledgerId: childLedgerId,
      idempotencyKey: `race_${suffix}_0`,
      amount: {
        costMicros: 101,
        providerCalls: 1,
        toolCalls: 1,
        wallMs: 100,
        concurrentSlots: 1,
      },
    }),
    /budget-idempotency-conflict/,
  );

  const exhaustionEvents = await db.select()
    .from(atelierAssistantBudgetEvents)
    .where(and(
      eq(atelierAssistantBudgetEvents.orgId, orgId),
      eq(atelierAssistantBudgetEvents.type, "budget.exhausted"),
    ));
  assert.equal(exhaustionEvents.length, 15);

  await assert.rejects(
    commitAssistantBudget(orgId, reserved[0].value.reservationId, {
      costMicros: 40,
      providerCalls: 1,
      toolCalls: 1,
      wallMs: 50,
      concurrentSlots: 2,
    }),
    /budget-settlement-exceeds-reservation/,
  );
  await commitAssistantBudget(orgId, reserved[0].value.reservationId, {
    costMicros: 40,
    providerCalls: 1,
    toolCalls: 1,
    wallMs: 50,
    concurrentSlots: 0,
  });
  await assert.rejects(
    commitAssistantBudget(orgId, reserved[1].value.reservationId, {
      costMicros: 101,
      providerCalls: 1,
      toolCalls: 1,
      wallMs: 100,
      concurrentSlots: 0,
    }),
    /budget-settlement-exceeds-reservation/,
  );

  await db.update(atelierAssistantBudgetReservations)
    .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
    .where(and(
      eq(atelierAssistantBudgetReservations.orgId, orgId),
      eq(atelierAssistantBudgetReservations.state, "reserved"),
    ));
  const reconciliation = await reconcileExpiredAssistantBudgetReservations({ orgId });
  assert.equal(reconciliation.reconciled, 4);

  const ledgers = await db.select()
    .from(atelierAssistantBudgetLedgers)
    .where(eq(atelierAssistantBudgetLedgers.orgId, orgId));
  assert.equal(ledgers.length, 2);
  for (const ledger of ledgers) {
    assert.equal(ledger.reservedConcurrentSlots, 0);
    assert.equal(ledger.reservedCostMicros, 0);
    assert.equal(ledger.committedCostMicros, 40);
    assert.equal(ledger.committedWallMs, 50);
  }

  const reconciledEvents = await db.select()
    .from(atelierAssistantBudgetEvents)
    .where(and(
      eq(atelierAssistantBudgetEvents.orgId, orgId),
      eq(atelierAssistantBudgetEvents.type, "budget.reconciled_expired"),
    ));
  assert.equal(reconciledEvents.length, 4);

  const rollbackReservation = await reserveAssistantBudget({
    orgId,
    ledgerId: childLedgerId,
    idempotencyKey: `rollback_${suffix}`,
    amount: {
      costMicros: 10,
      providerCalls: 1,
      toolCalls: 1,
      wallMs: 10,
      concurrentSlots: 1,
    },
  });
  await assert.rejects(
    db.transaction(async (tx) => {
      await commitAssistantBudget(orgId, rollbackReservation.reservationId, {
        costMicros: 10,
        providerCalls: 1,
        toolCalls: 1,
        wallMs: 10,
        concurrentSlots: 0,
      }, tx);
      throw new Error("force-workflow-completion-rollback");
    }),
    /force-workflow-completion-rollback/,
  );
  const [rolledBackReservation] = await db.select()
    .from(atelierAssistantBudgetReservations)
    .where(eq(atelierAssistantBudgetReservations.id, rollbackReservation.reservationId));
  assert.equal(rolledBackReservation.state, "reserved");
  const [rolledBackLedger] = await db.select()
    .from(atelierAssistantBudgetLedgers)
    .where(eq(atelierAssistantBudgetLedgers.id, childLedgerId));
  assert.equal(rolledBackLedger.reservedCostMicros, 10);
  assert.equal(rolledBackLedger.committedCostMicros, 40);
  await refundAssistantBudget(orgId, rollbackReservation.reservationId);

  await assert.rejects(
    reserveAssistantBudget({
      orgId,
      ledgerId: "missing-ledger",
      idempotencyKey: `missing_${suffix}`,
      amount: { costMicros: 1, providerCalls: 1, toolCalls: 1 },
    }),
    /budget-ledger-not-found/,
  );
  await assert.rejects(
    reserveAssistantBudget({
      orgId: `other_${orgId}`,
      ledgerId: childLedgerId,
      idempotencyKey: `cross_org_${suffix}`,
      amount: { costMicros: 1, providerCalls: 1, toolCalls: 1 },
    }),
    /budget-ledger-not-found/,
  );
  await assert.rejects(
    reserveRequiredAssistantBudget(
      {
        orgId,
        ledgerId: childLedgerId,
        idempotencyKey: `outage_${suffix}`,
        amount: { costMicros: 1, providerCalls: 1, toolCalls: 1 },
      },
      async () => {
        throw new Error("connection refused");
      },
    ),
    /budget-ledger-unavailable/,
  );

  const dimensionCases = [
    { name: "cost", amount: { costMicros: 1, providerCalls: 0, toolCalls: 0 } },
    { name: "provider", amount: { costMicros: 0, providerCalls: 1, toolCalls: 0 } },
    { name: "tool", amount: { costMicros: 0, providerCalls: 0, toolCalls: 1 } },
    {
      name: "wall",
      amount: { costMicros: 0, providerCalls: 0, toolCalls: 0, wallMs: 1 },
    },
    {
      name: "concurrency",
      amount: { costMicros: 0, providerCalls: 0, toolCalls: 0, concurrentSlots: 1 },
    },
  ];
  for (const entry of dimensionCases) {
    const ledgerId = `budget_zero_${entry.name}_${suffix}`;
    await db.insert(atelierAssistantBudgetLedgers).values({
      id: ledgerId,
      orgId,
      ownerType: "dimension",
      ownerId: entry.name,
      policyVersion: "budget-v1",
      maxCostMicros: 0,
      maxProviderCalls: 0,
      maxToolCalls: 0,
      maxWallMs: 0,
      maxConcurrentSlots: 0,
      expiresAt,
    });
    await assert.rejects(
      reserveAssistantBudget({
        orgId,
        ledgerId,
        idempotencyKey: `dimension_${entry.name}_${suffix}`,
        amount: entry.amount,
      }),
      /budget-exhausted/,
    );
  }

  await assert.rejects(
    db.insert(atelierAssistantBudgetLedgers).values({
      id: `budget_oversized_child_${suffix}`,
      orgId,
      ownerType: "turn",
      ownerId: "oversized",
      parentLedgerId,
      policyVersion: "budget-v1",
      maxCostMicros: limits.maxCostMicros + 1,
      maxProviderCalls: limits.maxProviderCalls,
      maxToolCalls: limits.maxToolCalls,
      maxWallMs: limits.maxWallMs,
      maxConcurrentSlots: limits.maxConcurrentSlots,
      expiresAt,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "cause" in error &&
      error.cause instanceof Error &&
      error.cause.message === "budget-child-exceeds-parent",
  );

  const workflowSource = await readFile(
    new URL("../../src/lib/assistant/workflow-runtime.ts", import.meta.url),
    "utf8",
  );
  const commitCalls = [...workflowSource.matchAll(/commitAssistantBudget\(([\s\S]*?)\);/g)];
  assert.ok(commitCalls.length >= 4);
  for (const call of commitCalls) {
    assert.match(
      call[1],
      /\btx\b/,
      "workflow budget settlement must share caller transaction",
    );
  }

  console.log("riser atomic budget probes passed");
} finally {
  await db.delete(atelierAssistantBudgetEvents)
    .where(eq(atelierAssistantBudgetEvents.orgId, orgId));
  await db.delete(atelierAssistantBudgetReservations)
    .where(eq(atelierAssistantBudgetReservations.orgId, orgId));
  await db.delete(atelierAssistantBudgetLedgers)
    .where(eq(atelierAssistantBudgetLedgers.orgId, orgId));
}