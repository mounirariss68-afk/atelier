import { randomUUID } from "node:crypto";
import { and, eq, max, sql } from "drizzle-orm";
import { db, atelierAssistantEvents } from "@workspace/db";
import {
  ASSISTANT_PROTOCOL_VERSION,
  AssistantEventV1Schema,
  sanitizeAssistantForSink,
  type AssistantEventV1,
} from "@workspace/assistant-protocol";
import { recordRiserObservationTx } from "./observability-runtime.js";

type AssistantTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AppendAssistantEventArgs {
  orgId: string;
  requesterId: string;
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
      data: sanitizeAssistantForSink({
        sink: "durable_event",
        value: args.data,
      }),
    });
    await tx.insert(atelierAssistantEvents).values({
      id: event.eventId,
      protocolVersion: event.protocolVersion,
      orgId: args.orgId,
      requesterId: args.requesterId,
      conversationId: event.conversationId,
      turnId: event.turnId,
      sequence: event.sequence,
      conversationSequence: (conversationLast?.sequence ?? -1) + 1,
      correlationId: event.correlationId,
      type: event.type,
      data: event.data,
      occurredAt: new Date(event.occurredAt),
    });
    const observationBase = {
      orgId: args.orgId,
      conversationId: args.conversationId,
      turnId: args.turnId,
      actionId: args.correlationId,
      deploymentVersion: process.env.REPLIT_DEPLOYMENT_ID ?? "development",
    } as const;
    if (args.type === "action.awaiting_confirmation") {
      await recordRiserObservationTx(tx, {
        ...observationBase,
        stage: "policy",
        outcome: "allowed",
        securityEvent: true,
      });
      await recordRiserObservationTx(tx, {
        ...observationBase,
        stage: "preview",
        outcome: "awaiting_confirmation",
      });
    } else if (args.type === "action.confirmed") {
      await recordRiserObservationTx(tx, {
        ...observationBase,
        stage: "confirm",
        outcome: "confirmed",
        securityEvent: true,
      });
    } else if (args.type === "action.executing") {
      await recordRiserObservationTx(tx, {
        ...observationBase,
        stage: "execute",
        outcome: "executing",
        securityEvent: true,
      });
    } else if (
      args.type === "action.succeeded" ||
      args.type === "action.failed" ||
      args.type === "action.partially_succeeded" ||
      args.type === "action.compensated"
    ) {
      const outcome = args.type.slice("action.".length) as
        | "succeeded"
        | "failed"
        | "partially_succeeded"
        | "compensated";
      await recordRiserObservationTx(tx, {
        ...observationBase,
        stage: "execute",
        outcome,
        securityEvent: true,
      });
      await recordRiserObservationTx(tx, {
        ...observationBase,
        stage: "terminal_outcome",
        outcome,
      });
    } else if (
      args.type === "action.invalidated" ||
      args.type === "action.cancelled" ||
      args.type === "action.expired"
    ) {
      await recordRiserObservationTx(tx, {
        ...observationBase,
        stage: "terminal_outcome",
        outcome:
          args.type === "action.cancelled"
            ? "cancelled"
            : args.type === "action.expired"
              ? "expired"
              : "invalidated",
        securityEvent: true,
      });
    }
    return event;
}

export async function appendAssistantEvent(
  args: AppendAssistantEventArgs,
): Promise<AssistantEventV1> {
  return db.transaction(async (tx) => {
    return appendAssistantEventTx(tx, args);
  });
}