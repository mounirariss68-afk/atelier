import { and, eq } from "drizzle-orm";
import {
  db, atelierAgentRuns, atelierAgentRunSnapshots, atelierAgentOutcomeEvents, atelierAuditEvents, atelierUsers,
} from "@workspace/db";

const SAFE_KEYS = new Set([
  "confidence", "decision", "channel", "reasonCode", "workflow", "sourceType",
  "approvalLatencyMs", "cycleTimeMs",
]);
const FORBIDDEN = /(url|uri|link|text|body|content|statement|prompt|transcript|label|name|address)/i;

export type RecordOutcomeInput = Omit<
  typeof atelierAgentOutcomeEvents.$inferInsert,
  "id" | "orgId" | "recordedAt" | "metadata" | "missingLinks" | "dataQualityFlags"
> & {
  orgId: string;
  metadata?: Record<string, unknown>;
  missingLinks?: string[];
  dataQualityFlags?: string[];
};

/**
 * Route writers should use this entry point rather than copying registry/model
 * attribution into callsites.  Run snapshots are immutable and are the only
 * authoritative source for attribution; a missing snapshot means the run is
 * not stable enough to produce a measurement.
 */
export type RecordOutcomeForRunInput = Omit<
  RecordOutcomeInput,
  | "agentId"
  | "agentVersion"
  | "registryVersion"
  | "promptVersion"
  | "promptHash"
  | "model"
  | "runId"
  | "dataQualityFlags"
> & {
  runId: string;
  dataQualityFlags?: string[];
};

function safeMetadata(input: Record<string, unknown> | undefined) {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!SAFE_KEYS.has(key) || FORBIDDEN.test(key)) continue;
    if (typeof value === "string" && (FORBIDDEN.test(value) || value.length > 120)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    }
  }
  return output;
}

function normalized(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(normalized).sort());
  if (value && typeof value === "object") {
    return JSON.stringify(Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(normalized(v))])));
  }
  return JSON.stringify(value ?? null);
}

function rid() { return `out_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }

/**
 * The sole writer for outcome measurements.  The unique org/event key makes
 * retries and concurrent deliveries converge on one row; late events are
 * accepted because occurredAt is independent of recordedAt.
 */
export async function recordAgentOutcome(input: RecordOutcomeInput) {
  if (!input.orgId || !input.eventKey || !input.runId || !input.entityId || !input.originEntityId) {
    throw new Error("outcome requires tenant, eventKey, runId, origin and domain entity");
  }
  return db.transaction(async (tx) => {
    const [run] = await tx.select({
      id: atelierAgentRuns.id, orgId: atelierAgentRuns.orgId,
      agentId: atelierAgentRuns.agentId, targetType: atelierAgentRuns.targetType,
      targetId: atelierAgentRuns.targetId,
    }).from(atelierAgentRuns).where(eq(atelierAgentRuns.id, input.runId)).limit(1);
    if (!run || run.orgId !== input.orgId) throw new Error("outcome run is not in tenant");
    if (run.agentId !== input.agentId) throw new Error("outcome agent does not match run");
    const [snapshot] = await tx.select().from(atelierAgentRunSnapshots).where(and(
      eq(atelierAgentRunSnapshots.runId, input.runId),
      eq(atelierAgentRunSnapshots.orgId, input.orgId),
    )).limit(1);
    if (!snapshot) throw new Error("outcome run snapshot is missing or not in tenant");
    if (run.targetId && (run.targetId !== input.originEntityId || (run.targetType && run.targetType !== input.originEntityType))) {
      throw new Error("outcome entity does not match run target");
    }
    if (input.actorUserId) {
      const [actor] = await tx.select({ id: atelierUsers.id }).from(atelierUsers).where(and(
        eq(atelierUsers.id, input.actorUserId), eq(atelierUsers.orgId, input.orgId),
      )).limit(1);
      if (!actor) throw new Error("outcome actor is not in tenant");
    }
    if (input.supersedesEventId) {
      const [prior] = await tx.select({ id: atelierAgentOutcomeEvents.id })
        .from(atelierAgentOutcomeEvents)
        .where(and(eq(atelierAgentOutcomeEvents.id, input.supersedesEventId), eq(atelierAgentOutcomeEvents.orgId, input.orgId)))
        .limit(1);
      if (!prior) throw new Error("superseded outcome is not in tenant");
    }
    const id = rid();
    const [row] = await tx.insert(atelierAgentOutcomeEvents).values({
      ...input,
      id,
      // Provenance is immutable at run start; caller values cannot rewrite it.
      agentVersion: snapshot.agentVersion,
      registryVersion: snapshot.registryVersion,
      promptVersion: snapshot.promptVersion,
      promptHash: snapshot.promptHash,
      model: snapshot.model,
      entryPath: snapshot.entryPath,
      metadata: safeMetadata(input.metadata),
      missingLinks: input.missingLinks ?? [],
      dataQualityFlags: input.dataQualityFlags ?? [],
    }).onConflictDoNothing({ target: [atelierAgentOutcomeEvents.orgId, atelierAgentOutcomeEvents.eventKey] }).returning();
    if (!row) {
      const [existing] = await tx.select().from(atelierAgentOutcomeEvents).where(and(
        eq(atelierAgentOutcomeEvents.orgId, input.orgId),
        eq(atelierAgentOutcomeEvents.eventKey, input.eventKey),
      )).limit(1);
      if (!existing) throw new Error("outcome replay disappeared");
      const same = existing.runId === input.runId &&
        existing.actorUserId === (input.actorUserId ?? null) &&
        existing.entityType === input.entityType && existing.entityId === input.entityId &&
        existing.originEntityType === input.originEntityType && existing.originEntityId === input.originEntityId &&
        existing.outcomeKind === input.outcomeKind && existing.outcomeStatus === input.outcomeStatus &&
        existing.occurredAt.getTime() === input.occurredAt.getTime() &&
        existing.supersedesEventId === (input.supersedesEventId ?? null) &&
        existing.priorState === (input.priorState ?? null) && existing.currentState === (input.currentState ?? null) &&
        existing.editDistance === (input.editDistance ?? null) && existing.reworkCount === (input.reworkCount ?? null) &&
        existing.predictedValue === (input.predictedValue ?? null) && existing.actualValue === (input.actualValue ?? null) &&
        existing.sourceAcceptedCount === (input.sourceAcceptedCount ?? null) &&
        existing.sourceRejectedCount === (input.sourceRejectedCount ?? null) &&
        normalized(existing.metadata) === normalized(safeMetadata(input.metadata)) &&
        normalized(existing.missingLinks) === normalized(input.missingLinks ?? []) &&
        normalized(existing.dataQualityFlags) === normalized(input.dataQualityFlags ?? []) &&
        existing.agentId === snapshot.agentId && existing.agentVersion === snapshot.agentVersion &&
        existing.registryVersion === snapshot.registryVersion && existing.promptVersion === snapshot.promptVersion &&
        existing.promptHash === snapshot.promptHash && existing.model === snapshot.model &&
        existing.entryPath === snapshot.entryPath;
      if (!same) throw new Error("conflicting outcome replay");
      return existing;
    }
    await tx.insert(atelierAuditEvents).values({
      id: rid(), orgId: input.orgId, entityType: input.entityType, entityId: input.entityId,
      actorType: "system", actorId: input.agentId, actorLabel: "CRM outcome ledger",
      action: "agent.outcome.recorded",
      payload: { outcomeId: row.id, eventKey: row.eventKey, outcomeKind: row.outcomeKind, outcomeStatus: row.outcomeStatus },
      payloadSummary: "CRM agent outcome recorded",
    });
    return row;
  });
}

export async function recordOutcomeForRun(input: RecordOutcomeForRunInput) {
  if (!input.runId) return null;
  const [snapshot] = await db.select().from(atelierAgentRunSnapshots)
    .where(eq(atelierAgentRunSnapshots.runId, input.runId)).limit(1);
  if (!snapshot || snapshot.orgId !== input.orgId) return null;
  if (!snapshot.agentId) return null;
  return recordAgentOutcome({
    ...input,
    agentId: snapshot.agentId,
    agentVersion: snapshot.agentVersion,
    registryVersion: snapshot.registryVersion,
    promptVersion: snapshot.promptVersion,
    promptHash: snapshot.promptHash,
    model: snapshot.model,
    dataQualityFlags: Array.from(new Set([
      ...(snapshot.dataQualityFlags ?? []),
      ...(input.dataQualityFlags ?? []),
    ])),
  });
}