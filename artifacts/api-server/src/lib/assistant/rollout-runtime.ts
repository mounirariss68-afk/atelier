import { randomUUID } from "node:crypto";
import { and, eq, inArray, max, sql } from "drizzle-orm";
import {
  db,
  atelierAssistantActions,
  atelierAssistantOutbox,
  atelierAssistantProviderResults,
  atelierAssistantRolloutEvents,
  atelierAssistantRollouts,
  atelierAuditEvents,
  atelierWorkAttempts,
  atelierWorkItems,
  atelierWorkSteps,
} from "@workspace/db";
import { ASSISTANT_OPERATOR_CONTROL_VERSION } from "@workspace/assistant-protocol";
import { createAssistantControl, disableAssistantControl } from "./control-runtime.js";

export const ROLLOUT_STAGES = [
  "expand",
  "shadow",
  "backfill_verify",
  "cohort_canary",
  "cutover",
  "compatibility_retention",
  "cleanup",
] as const;

export const ROLLBACK_STEPS = [
  "deny_new_actions",
  "preserve_reads_status",
  "freeze_fence_workers",
  "classify_inflight",
  "finish_fail_compensate",
  "reconcile_outbox_provider",
  "restore_compatible_routing",
  "verify_audit_continuity",
] as const;

export const ROLLOUT_ALARMS = [
  "security",
  "duplicate_commits",
  "irrelevant_cards",
  "replay_gaps",
  "false_dispatch",
  "errors",
  "latency_ms",
  "cost_micros",
] as const;

type RolloutStage = (typeof ROLLOUT_STAGES)[number];
type RolloutAlarm = (typeof ROLLOUT_ALARMS)[number];
type RolloutScope =
  | "protocol_version"
  | "model"
  | "router_version"
  | "catalog_version"
  | "policy_version"
  | "action_executor"
  | "workflow_family"
  | "org"
  | "client_cohort";

const scopeKeys = new Set<RolloutScope>([
  "protocol_version", "model", "router_version", "catalog_version",
  "policy_version", "action_executor", "workflow_family", "org", "client_cohort",
]);

async function appendRolloutEvent(
  rolloutId: string,
  type: string,
  evidence: unknown,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${rolloutId}))`);
    const [last] = await tx.select({ sequence: max(atelierAssistantRolloutEvents.sequence) })
      .from(atelierAssistantRolloutEvents)
      .where(eq(atelierAssistantRolloutEvents.rolloutId, rolloutId));
    const [event] = await tx.insert(atelierAssistantRolloutEvents).values({
      id: `rollout_event_${randomUUID()}`,
      rolloutId,
      sequence: Number(last?.sequence ?? -1) + 1,
      type,
      evidence,
    }).returning();
    return event!;
  });
}

export async function createAssistantRollout(args: {
  orgId?: string | null;
  name: string;
  actorId: string;
  dimensions: Partial<Record<RolloutScope, string>>;
  versions: Record<string, string>;
  exitCriteria: Record<string, number>;
  alarmThresholds: Record<RolloutAlarm, number>;
}) {
  if (!args.name.trim()) throw new Error("rollout-name-required");
  if (Object.keys(args.dimensions).length === 0) throw new Error("rollout-dimension-required");
  if (Object.keys(args.dimensions).some((key) => !scopeKeys.has(key as RolloutScope))) {
    throw new Error("rollout-dimension-unsupported");
  }
  for (const alarm of ROLLOUT_ALARMS) {
    if (!Number.isFinite(args.alarmThresholds[alarm])) {
      throw new Error(`rollout-alarm-threshold-required:${alarm}`);
    }
  }
  const id = `rollout_${randomUUID()}`;
  const [row] = await db.insert(atelierAssistantRollouts).values({
    id,
    orgId: args.orgId ?? null,
    name: args.name.trim(),
    dimensions: args.dimensions as Record<string, string>,
    versions: args.versions,
    exitCriteria: args.exitCriteria,
    alarmThresholds: args.alarmThresholds,
    createdByUserId: args.actorId,
  }).returning();
  await appendRolloutEvent(id, "rollout.created", {
    status: "expand",
    dimensions: args.dimensions,
    versions: args.versions,
    exitCriteria: args.exitCriteria,
    alarmThresholds: args.alarmThresholds,
  });
  return row!;
}

export function breachedRolloutAlarms(
  measurements: Record<string, number>,
  thresholds: Record<string, number>,
): string[] {
  return ROLLOUT_ALARMS.filter((alarm) => {
    const actual = measurements[alarm] ?? 0;
    const maximum = thresholds[alarm];
    return maximum === undefined || actual > maximum;
  });
}

export async function recordRolloutMeasurements(args: {
  rolloutId: string;
  measurements: Record<string, number>;
  actorId: string;
  actorLabel: string;
}) {
  const recorded = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(atelierAssistantRollouts)
      .where(eq(atelierAssistantRollouts.id, args.rolloutId)).for("update");
    if (!row) throw new Error("rollout-not-found");
    if (!row.orgId) throw new Error("rollout-rollback-org-required");
    const measurements = {
      ...(row.measurements as Record<string, number>),
      ...args.measurements,
    };
    const breached = breachedRolloutAlarms(
      measurements,
      row.alarmThresholds as Record<string, number>,
    );
    if (row.status === "rollback" || row.status === "rolled_back") {
      return { row, measurements, breached, changed: false };
    }
    const [updated] = await tx.update(atelierAssistantRollouts).set({
      measurements,
      status: breached.length > 0 ? "halted" : row.status,
      haltedReason: breached.length > 0 ? `alarm:${breached.join(",")}` : row.haltedReason,
      updatedAt: new Date(),
    }).where(eq(atelierAssistantRollouts.id, row.id)).returning();
    return { row: updated!, measurements, breached, changed: true };
  });
  const { row, measurements, breached } = recorded;
  if (!recorded.changed) return { rollout: row, breached };
  await appendRolloutEvent(row.id, breached.length > 0 ? "rollout.alarm" : "rollout.measured", {
    measurements,
    thresholds: row.alarmThresholds,
    breached,
    stage: row.status,
  });
  if (breached.length > 0) {
    const rollback = await startAssistantRollback({
      rolloutId: row.id,
      actorId: args.actorId,
      actorLabel: args.actorLabel,
      reason: `Automatic rollout alarm: ${breached.join(", ")}`,
    });
    return { rollout: rollback, breached };
  }
  return { rollout: row, breached };
}

export async function advanceAssistantRollout(rolloutId: string, next: RolloutStage) {
  const [row] = await db.select().from(atelierAssistantRollouts)
    .where(eq(atelierAssistantRollouts.id, rolloutId)).limit(1);
  if (!row) throw new Error("rollout-not-found");
  if (row.status === "halted" || row.status === "rollback") throw new Error("rollout-halted");
  const currentIndex = ROLLOUT_STAGES.indexOf(row.status as RolloutStage);
  if (currentIndex < 0 || ROLLOUT_STAGES[currentIndex + 1] !== next) {
    throw new Error("rollout-stage-order-invalid");
  }
  const measurements = row.measurements as Record<string, number>;
  const criteria = row.exitCriteria as Record<string, number>;
  const failed = Object.entries(criteria).filter(([metric, minimum]) =>
    (measurements[metric] ?? Number.NEGATIVE_INFINITY) < minimum);
  if (failed.length > 0) throw new Error(`rollout-exit-criteria-failed:${failed.map(([m]) => m).join(",")}`);
  const [updated] = await db.update(atelierAssistantRollouts)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(atelierAssistantRollouts.id, rolloutId)).returning();
  await appendRolloutEvent(rolloutId, "rollout.stage_advanced", {
    from: row.status,
    to: next,
    versions: row.versions,
    measurements,
    exitCriteria: criteria,
  });
  return updated!;
}

export async function startAssistantRollback(args: {
  rolloutId: string;
  actorId: string;
  actorLabel: string;
  reason: string;
}) {
  const initiation = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(atelierAssistantRollouts)
      .where(eq(atelierAssistantRollouts.id, args.rolloutId)).for("update");
    if (!row) throw new Error("rollout-not-found");
    if (!row.orgId) throw new Error("rollout-rollback-org-required");
    if (row.status === "rollback" || row.status === "rolled_back") {
      return { row, initiated: false as const, priorStatus: row.status };
    }
    const [updated] = await tx.update(atelierAssistantRollouts).set({
      status: "rollback",
      rollbackSteps: [],
      workerFence: row.workerFence + 1,
      haltedReason: args.reason,
      updatedAt: new Date(),
    }).where(eq(atelierAssistantRollouts.id, row.id)).returning();
    return { row: updated!, initiated: true as const, priorStatus: row.status };
  });
  if (!initiation.initiated) return initiation.row;
  const row = initiation.row;
  const orgId = row.orgId!;
  await appendRolloutEvent(row.id, "rollback.started", {
    reason: args.reason,
    priorStage: initiation.priorStatus,
    versions: row.versions,
    workerFence: row.workerFence,
  });
  const controlIds: string[] = [];
  try {
    const dimensions = row.dimensions as Record<string, string>;
    for (const [scope, scopeKey] of Object.entries(dimensions)) {
      const control = await createAssistantControl({
        orgId,
        actorId: args.actorId,
        actorLabel: args.actorLabel,
        request: {
          version: ASSISTANT_OPERATOR_CONTROL_VERSION,
          scope: scope as RolloutScope,
          scopeKey,
          mode: "quarantine",
          inflightBehavior: scope === "workflow_family" ? "pause" : "finish",
          reason: args.reason,
        },
      });
      controlIds.push(control.id);
      await appendRolloutEvent(row.id, "rollback.control_applied", {
        controlId: control.id,
        scope,
        scopeKey,
        reconciliationStatus: control.reconciliationStatus,
      });
    }
  } catch (error) {
    await db.update(atelierAssistantRollouts).set({
      status: "halted",
      controlIds,
      haltedReason: `rollback-control-failed:${error instanceof Error ? error.message : "unknown"}`,
      updatedAt: new Date(),
    }).where(eq(atelierAssistantRollouts.id, row.id));
    await appendRolloutEvent(row.id, "rollback.control_failed", {
      controlIds,
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
  const [updated] = await db.update(atelierAssistantRollouts).set({
    rollbackSteps: ROLLBACK_STEPS.slice(0, 3),
    controlIds,
    updatedAt: new Date(),
  }).where(eq(atelierAssistantRollouts.id, row.id)).returning();
  await appendRolloutEvent(row.id, "rollback.admission_fenced", {
    steps: ROLLBACK_STEPS.slice(0, 3),
    controlIds,
  });
  return updated!;
}

export async function completeAssistantRollbackStep(args: {
  rolloutId: string;
  step: (typeof ROLLBACK_STEPS)[number];
  actorId: string;
  actorLabel: string;
  providerResults?: Array<{
    actionId: string;
    outcome: "succeeded" | "failed";
    providerResultId: string;
  }>;
}) {
  const [row] = await db.select().from(atelierAssistantRollouts)
    .where(eq(atelierAssistantRollouts.id, args.rolloutId)).limit(1);
  if (!row || row.status !== "rollback") throw new Error("rollout-not-in-rollback");
  const completed = row.rollbackSteps as string[];
  const expected = ROLLBACK_STEPS[completed.length];
  if (args.step !== expected) throw new Error("rollback-step-order-invalid");
  let evidence: unknown;
  if (args.step === "classify_inflight") {
    const actions = await db.select().from(atelierAssistantActions)
      .where(and(
        eq(atelierAssistantActions.orgId, row.orgId!),
        inArray(atelierAssistantActions.state, ["awaiting_confirmation", "confirmed", "executing"]),
      ));
    const work = await db.select().from(atelierWorkItems)
      .where(eq(atelierWorkItems.orgId, row.orgId!));
    const attempts = await db.select({ attempt: atelierWorkAttempts })
      .from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkSteps.id, atelierWorkAttempts.stepId))
      .innerJoin(atelierWorkItems, eq(atelierWorkItems.id, atelierWorkSteps.workItemId))
      .where(and(
        eq(atelierWorkItems.orgId, row.orgId!),
        inArray(atelierWorkAttempts.status, ["running", "committing", "blocked"]),
      ));
    const executingActionIds = actions
      .filter((action) => action.state === "executing")
      .map((action) => action.id);
    const outboxes = executingActionIds.length === 0 ? [] : await db.select({
      id: atelierAssistantOutbox.id,
    }).from(atelierAssistantOutbox)
      .where(inArray(atelierAssistantOutbox.actionId, executingActionIds));
    const blockedAttemptIds = attempts
      .filter(({ attempt }) => attempt.status === "blocked")
      .map(({ attempt }) => attempt.id);
    await db.update(atelierAssistantRollouts).set({
      rollbackLineage: {
        executingActionIds,
        outboxIds: outboxes.map(({ id }) => id),
        blockedAttemptIds,
      },
      updatedAt: new Date(),
    }).where(eq(atelierAssistantRollouts.id, row.id));
    evidence = {
      pendingActions: actions.filter((action) => action.state !== "executing").map((action) => action.id),
      executingActions: executingActionIds,
      outboxIds: outboxes.map(({ id }) => id),
      activeWork: work.filter((item) => !["succeeded", "failed", "cancelled", "compensated"].includes(item.status)).map((item) => item.id),
      attempts: attempts.map(({ attempt }) => ({
        id: attempt.id,
        status: attempt.status,
        fence: attempt.fencingToken,
      })),
    };
  } else if (args.step === "finish_fail_compensate") {
    const pending = await db.select({ id: atelierAssistantActions.id })
      .from(atelierAssistantActions)
      .where(and(
        eq(atelierAssistantActions.orgId, row.orgId!),
        inArray(atelierAssistantActions.state, ["awaiting_confirmation", "confirmed"]),
      ));
    const liveAttempts = await db.select({ id: atelierWorkAttempts.id })
      .from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkSteps.id, atelierWorkAttempts.stepId))
      .innerJoin(atelierWorkItems, eq(atelierWorkItems.id, atelierWorkSteps.workItemId))
      .where(and(
        eq(atelierWorkItems.orgId, row.orgId!),
        eq(atelierWorkAttempts.status, "running"),
      ));
    if (pending.length > 0 || liveAttempts.length > 0) {
      throw new Error("rollback-inflight-not-settled");
    }
    evidence = { pendingActions: 0, runningAttempts: 0 };
  } else if (args.step === "reconcile_outbox_provider") {
    const executing = await db.select().from(atelierAssistantActions)
      .where(and(
        eq(atelierAssistantActions.orgId, row.orgId!),
        eq(atelierAssistantActions.state, "executing"),
      ));
    const results = args.providerResults ?? [];
    if (
      results.length !== executing.length ||
      new Set(results.map((result) => result.actionId)).size !== results.length ||
      new Set(results.map((result) => result.providerResultId)).size !== results.length ||
      executing.some((action) => !results.some((result) => result.actionId === action.id))
    ) {
      throw new Error("rollback-provider-reconciliation-incomplete");
    }
    for (const result of results) {
      await db.transaction(async (tx) => {
        const [action] = await tx.select().from(atelierAssistantActions)
          .where(eq(atelierAssistantActions.id, result.actionId)).for("update");
        if (!action || action.state !== "executing") {
          throw new Error("rollback-provider-result-already-applied");
        }
        await tx.insert(atelierAssistantProviderResults).values({
          providerResultId: result.providerResultId,
          actionId: action.id,
          orgId: action.orgId,
          outcome: result.outcome,
          reconciledByUserId: args.actorId,
        });
        const outbox = await tx.select().from(atelierAssistantOutbox)
          .where(eq(atelierAssistantOutbox.actionId, action.id)).for("update");
        if (outbox.length !== 1) {
          throw new Error("rollback-outbox-reconciliation-incomplete");
        }
        await tx.update(atelierAssistantOutbox).set({
          state: "delivered",
          attempts: outbox[0]!.attempts + 1,
          providerResult: {
            providerResultId: result.providerResultId,
            outcome: result.outcome,
          },
          lastErrorCode: null,
          updatedAt: new Date(),
        }).where(eq(atelierAssistantOutbox.id, outbox[0]!.id));
        const [updated] = await tx.update(atelierAssistantActions).set({
          state: result.outcome,
          stateVersion: action.stateVersion + 1,
          result: { reconciled: true, providerResultId: result.providerResultId },
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(atelierAssistantActions.id, action.id),
          eq(atelierAssistantActions.stateVersion, action.stateVersion),
        )).returning({ id: atelierAssistantActions.id });
        if (!updated) throw new Error("rollback-provider-result-concurrency-conflict");
        await tx.insert(atelierAuditEvents).values({
          id: `aud_${randomUUID()}`,
          orgId: action.orgId,
          entityType: "assistant_action",
          entityId: action.id,
          actorType: "human",
          actorId: args.actorId,
          actorLabel: args.actorLabel,
          action: "assistant.action.provider_reconciled",
          payload: result,
          payloadSummary: `Provider result reconciled for ${action.id}`,
        });
      });
    }
    evidence = { providerResults: results };
  } else if (args.step === "restore_compatible_routing") {
    evidence = {
      compatibleRoutingPrepared: true,
      controlsHeldUntilAuditVerification: row.controlIds,
      versions: row.versions,
    };
  } else if (args.step === "verify_audit_continuity") {
    const events = await db.select().from(atelierAssistantRolloutEvents)
      .where(eq(atelierAssistantRolloutEvents.rolloutId, row.id));
    const sequences = events.map((event) => event.sequence).sort((a, b) => a - b);
    const contiguous = sequences.every((sequence, index) => sequence === index);
    const controlIds = row.controlIds as string[];
    const lineage = row.rollbackLineage as {
      executingActionIds: string[];
      outboxIds: string[];
      blockedAttemptIds: string[];
    };
    const controlAudits = controlIds.length === 0 ? [] : await db.select()
      .from(atelierAuditEvents)
      .where(and(
        eq(atelierAuditEvents.entityType, "assistant_control"),
        eq(atelierAuditEvents.action, "assistant.control.created"),
        inArray(atelierAuditEvents.entityId, controlIds),
      ));
    const executing = await db.select({ id: atelierAssistantActions.id })
      .from(atelierAssistantActions)
      .where(and(
        eq(atelierAssistantActions.orgId, row.orgId!),
        eq(atelierAssistantActions.state, "executing"),
      ));
    const providerResults = lineage.executingActionIds.length === 0 ? [] : await db.select()
      .from(atelierAssistantProviderResults)
      .where(inArray(atelierAssistantProviderResults.actionId, lineage.executingActionIds));
    const actionAudits = lineage.executingActionIds.length === 0 ? [] : await db.select()
      .from(atelierAuditEvents)
      .where(and(
        eq(atelierAuditEvents.entityType, "assistant_action"),
        eq(atelierAuditEvents.action, "assistant.action.provider_reconciled"),
        inArray(atelierAuditEvents.entityId, lineage.executingActionIds),
      ));
    const outboxes = lineage.outboxIds.length === 0 ? [] : await db.select()
      .from(atelierAssistantOutbox)
      .where(inArray(atelierAssistantOutbox.id, lineage.outboxIds));
    const attemptAudits = lineage.blockedAttemptIds.length === 0 ? [] : await db.select()
      .from(atelierAuditEvents)
      .where(and(
        eq(atelierAuditEvents.entityType, "work_attempt"),
        eq(atelierAuditEvents.action, "assistant.work_attempt.fenced"),
        inArray(atelierAuditEvents.entityId, lineage.blockedAttemptIds),
      ));
    const exactIds = (
      actual: string[],
      expected: string[],
    ) => actual.length === expected.length &&
      new Set(actual).size === expected.length &&
      expected.every((id) => actual.includes(id));
    if (
      !contiguous ||
      !exactIds(controlAudits.map((audit) => audit.entityId), controlIds) ||
      executing.length > 0 ||
      !exactIds(
        providerResults.map((result) => result.actionId),
        lineage.executingActionIds,
      ) ||
      !exactIds(
        actionAudits.map((audit) => audit.entityId),
        lineage.executingActionIds,
      ) ||
      !exactIds(outboxes.map((outbox) => outbox.id), lineage.outboxIds) ||
      outboxes.some((outbox) => outbox.state !== "delivered") ||
      !exactIds(
        attemptAudits.map((audit) => audit.entityId),
        lineage.blockedAttemptIds,
      )
    ) {
      throw new Error("rollback-audit-continuity-required");
    }
    for (const controlId of controlIds) {
      await disableAssistantControl({
        orgId: row.orgId!,
        controlId,
        actorId: args.actorId,
        actorLabel: args.actorLabel,
        reason: "C25 audit continuity verified; compatible routing restored",
      });
    }
    evidence = {
      contiguousEventSequences: contiguous,
      eventCount: events.length,
      controlCreationAuditCount: controlAudits.length,
      providerResultCount: providerResults.length,
      actionReconciliationAuditCount: actionAudits.length,
      blockedAttemptCount: lineage.blockedAttemptIds.length,
      attemptFenceAuditCount: attemptAudits.length,
      unresolvedExecutingActions: executing.length,
      releasedControlIds: controlIds,
    };
  } else {
    throw new Error("rollback-step-not-executable");
  }
  await appendRolloutEvent(row.id, `rollback.${args.step}`, evidence);
  const rollbackSteps = [...completed, args.step];
  const done = rollbackSteps.length === ROLLBACK_STEPS.length;
  const [updated] = await db.update(atelierAssistantRollouts).set({
    rollbackSteps,
    auditContinuityVerified: done,
    status: done ? "rolled_back" : "rollback",
    updatedAt: new Date(),
  }).where(eq(atelierAssistantRollouts.id, row.id)).returning();
  return updated!;
}