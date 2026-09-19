import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  atelierAssistantBudgetLedgers,
  atelierAssistantBudgetReservations,
} from "@workspace/db";

export interface BudgetAmount {
  costMicros: number;
  providerCalls: number;
  toolCalls: number;
}

function assertAmount(amount: BudgetAmount): void {
  for (const value of [amount.costMicros, amount.providerCalls, amount.toolCalls]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("budget-amount-invalid");
  }
}

export async function reserveAssistantBudget(args: {
  orgId: string;
  ledgerId: string;
  idempotencyKey: string;
  amount: BudgetAmount;
}): Promise<{ reservationId: string; replay: boolean }> {
  assertAmount(args.amount);
  return db.transaction(async (tx) => {
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
        existing.costMicros !== args.amount.costMicros ||
        existing.providerCalls !== args.amount.providerCalls ||
        existing.toolCalls !== args.amount.toolCalls
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
        ledger.reservedCostMicros + ledger.committedCostMicros + args.amount.costMicros >
          ledger.maxCostMicros ||
        ledger.reservedProviderCalls + ledger.committedProviderCalls + args.amount.providerCalls >
          ledger.maxProviderCalls ||
        ledger.reservedToolCalls + ledger.committedToolCalls + args.amount.toolCalls >
          ledger.maxToolCalls
      ) {
        throw new Error("budget-exhausted");
      }
      chain.push(ledger);
      currentId = ledger.parentLedgerId;
    }

    for (const ledger of chain) {
      await tx
        .update(atelierAssistantBudgetLedgers)
        .set({
          reservedCostMicros: ledger.reservedCostMicros + args.amount.costMicros,
          reservedProviderCalls: ledger.reservedProviderCalls + args.amount.providerCalls,
          reservedToolCalls: ledger.reservedToolCalls + args.amount.toolCalls,
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
      ...args.amount,
    });
    return { reservationId, replay: false };
  });
}

async function settleReservation(args: {
  orgId: string;
  reservationId: string;
  state: "committed" | "refunded";
}): Promise<{ state: string }> {
  return db.transaction(async (tx) => {
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
          committedCostMicros:
            ledger.committedCostMicros +
            (args.state === "committed" ? reservation.costMicros : 0),
          committedProviderCalls:
            ledger.committedProviderCalls +
            (args.state === "committed" ? reservation.providerCalls : 0),
          committedToolCalls:
            ledger.committedToolCalls +
            (args.state === "committed" ? reservation.toolCalls : 0),
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
        updatedAt: new Date(),
      })
      .where(eq(atelierAssistantBudgetReservations.id, reservation.id));
    return { state: args.state };
  });
}

export function commitAssistantBudget(orgId: string, reservationId: string) {
  return settleReservation({ orgId, reservationId, state: "committed" });
}

export function refundAssistantBudget(orgId: string, reservationId: string) {
  return settleReservation({ orgId, reservationId, state: "refunded" });
}