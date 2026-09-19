import { randomUUID } from "node:crypto";
import { and, eq, max, sql } from "drizzle-orm";
import { db, atelierAssistantEvents } from "@workspace/db";
import {
  ASSISTANT_PROTOCOL_VERSION,
  AssistantEventV1Schema,
  redactAssistantValue,
  type AssistantEventV1,
} from "@workspace/assistant-protocol";

type AssistantTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AppendAssistantEventArgs {
  orgId: string;
  conversationId: string;
  turnId: string;
  correlationId: string;
  type: string;
  data: unknown;
}

export async function appendAssistantEventTx(
  tx: AssistantTransaction,
  args: AppendAssistantEventArgs,
): Promise<AssistantEventV1> {
    const lockKey = `${args.orgId}:${args.conversationId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [last] = await tx
      .select({ sequence: max(atelierAssistantEvents.sequence) })
      .from(atelierAssistantEvents)
      .where(
        and(
          eq(atelierAssistantEvents.orgId, args.orgId),
          eq(atelierAssistantEvents.conversationId, args.conversationId),
          eq(atelierAssistantEvents.turnId, args.turnId),
        ),
      );
    const [conversationLast] = await tx
      .select({ sequence: max(atelierAssistantEvents.conversationSequence) })
      .from(atelierAssistantEvents)
      .where(
        and(
          eq(atelierAssistantEvents.orgId, args.orgId),
          eq(atelierAssistantEvents.conversationId, args.conversationId),
        ),
      );
    const event = AssistantEventV1Schema.parse({
      protocolVersion: ASSISTANT_PROTOCOL_VERSION,
      conversationId: args.conversationId,
      turnId: args.turnId,
      eventId: `ae_${randomUUID()}`,
      sequence: (last?.sequence ?? -1) + 1,
      occurredAt: new Date().toISOString(),
      correlationId: args.correlationId,
      type: args.type,
      data: redactAssistantValue(args.data),
    });
    await tx.insert(atelierAssistantEvents).values({
      id: event.eventId,
      protocolVersion: event.protocolVersion,
      orgId: args.orgId,
      conversationId: event.conversationId,
      turnId: event.turnId,
      sequence: event.sequence,
      conversationSequence: (conversationLast?.sequence ?? -1) + 1,
      correlationId: event.correlationId,
      type: event.type,
      data: event.data,
      occurredAt: new Date(event.occurredAt),
    });
    return event;
}

export async function appendAssistantEvent(
  args: AppendAssistantEventArgs,
): Promise<AssistantEventV1> {
  return db.transaction(async (tx) => {
    return appendAssistantEventTx(tx, args);
  });
}