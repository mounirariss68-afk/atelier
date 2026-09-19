import { randomUUID } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import {
  db,
  atelierAssistantBudgetLedgers,
  atelierAssistantBudgetEvents,
  atelierAssistantBudgetReservations,
} from "@workspace/db";

export interface BudgetAmount {
  costMicros: number;
  providerCalls: number;
  toolCalls: number;
  wallMs?: number;
  concurrentSlots?: number;
}

type NormalizedBudgetAmount = Required<BudgetAmount>;
type BudgetTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function normalizeAmount(amount: BudgetAmount): NormalizedBudgetAmount {
  const normalized = {
    ...amount,
    wallMs: amount.wallMs ?? 0,
    concurrentSlots: amount.concurrentSlots ?? 0,
  };
  for (const value of Object.values(normalized)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("budget-amount-invalid");
  }
  return normalized;
}

export async function reserveAssistantBudget(args: {
  orgId: string;
  ledgerId: string;
  idempotencyKey: string;
  amount: BudgetAmount;
  leaseMs?: number;
}): Promise<{ reservationId: string; replay: boolean }> {
  const amount = normalizeAmount(args.amount);
  const leaseMs = args.leaseMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60_000) {
    throw new Error("budget-lease-invalid");
  }
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.org_id', ${args.orgId}, true)`);
    const [existing] = await tx
      .select()
      .from(atelierAssistantBudgetReservations)
      .where(
        and(
          eq(atelierAssistantBudgetReservations.orgId, args.orgId),
          eq(atelierAssistantBudgetReservations.idempotencyKey, args.idempotencyKey),
        ),
      )
      .for("update");
    if (existing) {
      if (
        existing.ledgerId !== args.ledgerId ||
        existing.costMicros !== amount.costMicros ||
        existing.providerCalls !== amount.providerCalls ||
        existing.toolCalls !== amount.toolCalls ||
        existing.wallMs !== amount.wallMs ||
        existing.concurrentSlots !== amount.concurrentSlots
      ) {
        throw new Error("budget-idempotency-conflict");
      }
      return { reservationId: existing.id, replay: true };
    }

    const chain: Array<typeof atelierAssistantBudgetLedgers.$inferSelect> = [];
    const seen = new Set<string>();
    let currentId: string | null = args.ledgerId;
    while (currentId) {
      if (seen.has(currentId)) throw new Error("budget-ledger-cycle");
      seen.add(currentId);
      const [ledger] = await tx
        .select()
        .from(atelierAssistantBudgetLedgers)
        .where(
          and(
            eq(atelierAssistantBudgetLedgers.id, currentId),
            eq(atelierAssistantBudgetLedgers.orgId, args.orgId),
          ),
        )
        .for("update");
      if (!ledger) throw new Error("budget-ledger-not-found");
      if (ledger.expiresAt.getTime() <= Date.now()) throw new Error("budget-ledger-expired");
      if (
        ledger.reservedCostMicros + ledger.committedCostMicros + amount.costMicros >
          ledger.maxCostMicros ||
        ledger.reservedProviderCalls + ledger.committedProviderCalls + amount.providerCalls >
          ledger.maxProviderCalls ||
        ledger.reservedToolCalls + ledger.committedToolCalls + amount.toolCalls >
          ledger.maxToolCalls ||
        ledger.reservedWallMs + ledger.committedWallMs + amount.wallMs >
          ledger.maxWallMs ||
        ledger.reservedConcurrentSlots + amount.concurrentSlots >
          ledger.maxConcurrentSlots
      ) {
        await tx.insert(atelierAssistantBudgetEvents).values({
          id: `budget_evt_${randomUUID()}`,
          orgId: args.orgId,
          ledgerId: ledger.id,
          type: "budget.exhausted",
          data: {
            requested: amount,
            ownerType: ledger.ownerType,
            ownerId: ledger.ownerId,
          },
        });
        return { error: "budget-exhausted" as const };
      }
      chain.push(ledger);
      currentId = ledger.parentLedgerId;
    }

    for (const ledger of chain) {
      await tx
        .update(atelierAssistantBudgetLedgers)
        .set({
          reservedCostMicros: ledger.reservedCostMicros + amount.costMicros,
          reservedProviderCalls: ledger.reservedProviderCalls + amount.providerCalls,
          reservedToolCalls: ledger.reservedToolCalls + amount.toolCalls,
          reservedWallMs: ledger.reservedWallMs + amount.wallMs,
          reservedConcurrentSlots: ledger.reservedConcurrentSlots + amount.concurrentSlots,
          updatedAt: new Date(),
        })
        .where(eq(atelierAssistantBudgetLedgers.id, ledger.id));
    }
    const reservationId = `budget_res_${randomUUID()}`;
    await tx.insert(atelierAssistantBudgetReservations).values({
      id: reservationId,
      orgId: args.orgId,
      ledgerId: args.ledgerId,
      ledgerIds: chain.map((ledger) => ledger.id),
      idempotencyKey: args.idempotencyKey,
      ...amount,
      leaseExpiresAt: new Date(Date.now() + leaseMs),
    });
    await tx.insert(atelierAssistantBudgetEvents).values({
      id: `budget_evt_${randomUUID()}`,
      orgId: args.orgId,
      ledgerId: args.ledgerId,
      reservationId,
      type: "budget.reserved",
      data: { amount, ledgerIds: chain.map((ledger) => ledger.id) },
    });
    return { reservationId, replay: false };
  });
  if ("error" in outcome) throw new Error(outcome.error);
  return outcome;
}

async function settleReservation(args: {
  orgId: string;
  reservationId: string;
  state: "committed" | "refunded";
  actual?: BudgetAmount;
  eventType?: string;
  tx?: BudgetTransaction;
}): Promise<{ state: string }> {
  const execute = async (tx: BudgetTransaction) => {
    await tx.execute(sql`SELECT set_config('app.org_id', ${args.orgId}, true)`);
    const [reservation] = await tx
      .select()
      .from(atelierAssistantBudgetReservations)
      .where(
        and(
          eq(atelierAssistantBudgetReservations.id, args.reservationId),
          eq(atelierAssistantBudgetReservations.orgId, args.orgId),
        ),
      )
      .for("update");
    if (!reservation) throw new Error("budget-reservation-not-found");
    if (reservation.state !== "reserved") return { state: reservation.state };
    const reserved = normalizeAmount({
      costMicros: reservation.costMicros,
      providerCalls: reservation.providerCalls,
      toolCalls: reservation.toolCalls,
      wallMs: reservation.wallMs,
      concurrentSlots: reservation.concurrentSlots,
    });
    const actual = args.state === "committed"
      ? normalizeAmount(args.actual ?? reserved)
      : normalizeAmount({ costMicros: 0, providerCalls: 0, toolCalls: 0 });
    if (
      actual.costMicros > reserved.costMicros ||
      actual.providerCalls > reserved.providerCalls ||
      actual.toolCalls > reserved.toolCalls ||
      actual.wallMs > reserved.wallMs ||
      actual.concurrentSlots > reserved.concurrentSlots
    ) {
      throw new Error("budget-settlement-exceeds-reservation");
    }
    for (const ledgerId of reservation.ledgerIds) {
      const [ledger] = await tx
        .select()
        .from(atelierAssistantBudgetLedgers)
        .where(eq(atelierAssistantBudgetLedgers.id, ledgerId))
        .for("update");
      if (!ledger) throw new Error("budget-ledger-not-found");
      await tx
        .update(atelierAssistantBudgetLedgers)
        .set({
          reservedCostMicros: ledger.reservedCostMicros - reservation.costMicros,
          reservedProviderCalls: ledger.reservedProviderCalls - reservation.providerCalls,
          reservedToolCalls: ledger.reservedToolCalls - reservation.toolCalls,
          reservedWallMs: ledger.reservedWallMs - reservation.wallMs,
          reservedConcurrentSlots:
            ledger.reservedConcurrentSlots - reservation.concurrentSlots,
          committedCostMicros:
            ledger.committedCostMicros +
             actual.costMicros,
          committedProviderCalls:
            ledger.committedProviderCalls +
             actual.providerCalls,
          committedToolCalls:
            ledger.committedToolCalls +
             actual.toolCalls,
          committedWallMs: ledger.committedWallMs + actual.wallMs,
          updatedAt: new Date(),
        })
        .where(eq(atelierAssistantBudgetLedgers.id, ledger.id));
    }
    await tx
      .update(atelierAssistantBudgetReservations)
      .set({
        state: args.state,
        committedAt: args.state === "committed" ? new Date() : null,
        refundedAt: args.state === "refunded" ? new Date() : null,
        settledAmount: { ...actual, concurrentSlots: 0 },
        updatedAt: new Date(),
      })
      .where(eq(atelierAssistantBudgetReservations.id, reservation.id));
    await tx.insert(atelierAssistantBudgetEvents).values({
      id: `budget_evt_${randomUUID()}`,
      orgId: args.orgId,
      ledgerId: reservation.ledgerId,
      reservationId: reservation.id,
      type: args.eventType ?? `budget.${args.state}`,
      data: { reserved, settled: { ...actual, concurrentSlots: 0 } },
    });
    return { state: args.state };
  };
  if (args.tx) return execute(args.tx);
  return db.transaction(execute);
}

export function commitAssistantBudget(
  orgId: string,
  reservationId: string,
  actual?: BudgetAmount,
  tx?: BudgetTransaction,
) {
  return settleReservation({ orgId, reservationId, state: "committed", actual, tx });
}

export function refundAssistantBudget(
  orgId: string,
  reservationId: string,
  tx?: BudgetTransaction,
) {
  return settleReservation({ orgId, reservationId, state: "refunded", tx });
}

export async function reserveRequiredAssistantBudget(
  args: Parameters<typeof reserveAssistantBudget>[0],
  reserve: typeof reserveAssistantBudget = reserveAssistantBudget,
): Promise<{ reservationId: string; replay: boolean }> {
  try {
    return await reserve(args);
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "budget-amount-invalid",
        "budget-lease-invalid",
        "budget-idempotency-conflict",
        "budget-ledger-cycle",
        "budget-ledger-not-found",
        "budget-ledger-expired",
        "budget-exhausted",
      ].includes(error.message)
    ) {
      throw error;
    }
    throw new Error("budget-ledger-unavailable");
  }
}

export async function reconcileExpiredAssistantBudgetReservations(args: {
  orgId: string;
  limit?: number;
}): Promise<{ reconciled: number }> {
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.org_id', ${args.orgId}, true)`);
    return tx.select({ id: atelierAssistantBudgetReservations.id })
      .from(atelierAssistantBudgetReservations)
      .where(and(
        eq(atelierAssistantBudgetReservations.orgId, args.orgId),
        eq(atelierAssistantBudgetReservations.state, "reserved"),
        lte(atelierAssistantBudgetReservations.leaseExpiresAt, new Date()),
      ))
      .limit(Math.max(1, Math.min(args.limit ?? 500, 5_000)));
  });
  let reconciled = 0;
  for (const row of rows) {
    const result = await settleReservation({
      orgId: args.orgId,
      reservationId: row.id,
      state: "refunded",
      eventType: "budget.reconciled_expired",
    });
    if (result.state === "refunded") reconciled += 1;
  }
  return { reconciled };
}