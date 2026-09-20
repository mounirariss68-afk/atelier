import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  pool,
  atelierAssistantActions,
  atelierAssistantControls,
  atelierAssistantEvents,
  atelierAssistantOutbox,
  atelierAssistantProviderResults,
  atelierAssistantRolloutEvents,
  atelierAssistantRollouts,
  atelierAuditEvents,
  atelierWorkAttempts,
  atelierWorkItems,
  atelierWorkPlans,
  atelierWorkSteps,
} from "@workspace/db";
import { appendAssistantEvent } from "../../src/lib/assistant/event-runtime.js";
import { resolveAssistantControl } from "../../src/lib/assistant/control-runtime.js";
import { completeWorkAttempt } from "../../src/lib/assistant/workflow-runtime.js";
import {
  ROLLOUT_ALARMS,
  ROLLBACK_STEPS,
  advanceAssistantRollout,
  completeAssistantRollbackStep,
  createAssistantRollout,
  breachedRolloutAlarms,
  recordRolloutMeasurements,
  startAssistantRollback,
} from "../../src/lib/assistant/rollout-runtime.js";

const suffix = randomUUID();
const orgId = `org_rollout_${suffix}`;
const actorId = `user_rollout_${suffix}`;
const catalogVersion = `catalog_${suffix}`;
const policyVersion = `policy_${suffix}`;
const pendingActionId = `action_pending_${suffix}`;
const executingActionId = `action_executing_${suffix}`;
const workItemId = `work_${suffix}`;
const planId = `plan_${suffix}`;
const stepId = `step_${suffix}`;
const attemptId = `attempt_${suffix}`;
const conversationId = `conversation_${suffix}`;
const turnId = `turn_${suffix}`;
const otherOrgId = `org_rollout_other_${suffix}`;
const otherActionId = `action_other_${suffix}`;
const legacyActionId = `action_legacy_schema_${suffix}`;
const outboxId = `outbox_${suffix}`;

const action = (id: string, state: "awaiting_confirmation" | "executing") => ({
  id,
  orgId,
  requesterId: actorId,
  capabilityId: "account.update",
  catalogVersion,
  inputSchemaVersion: 1,
  inputDigest: `input_${id}`,
  requestDigest: `request_${id}`,
  canonicalInputEncrypted: "fixture",
  policyVersion,
  policyDecisionDigest: "decision",
  riskClass: "medium",
  expiresAt: new Date(Date.now() + 60_000),
  state,
  idempotencyKey: `idem_${id}`,
});

try {
  await appendAssistantEvent({
    orgId,
    requesterId: actorId,
    conversationId,
    turnId,
    correlationId: `cursor_before_${suffix}`,
    type: "turn.started",
    data: { phase: "before_rollback" },
  });
  const [cursorRow] = await db.select({
    cursor: atelierAssistantEvents.conversationSequence,
  }).from(atelierAssistantEvents)
    .where(eq(atelierAssistantEvents.conversationId, conversationId));
  const reconnectCursor = cursorRow.cursor;
  await appendAssistantEvent({
    orgId,
    requesterId: actorId,
    conversationId,
    turnId,
    correlationId: `missed_during_disconnect_${suffix}`,
    type: "text.delta",
    data: { text: "persisted while client disconnected" },
  });
  await db.insert(atelierAssistantActions).values([
    action(pendingActionId, "awaiting_confirmation"),
    action(executingActionId, "executing"),
    { ...action(legacyActionId, "awaiting_confirmation"), inputSchemaVersion: 0 },
    { ...action(otherActionId, "awaiting_confirmation"), orgId: otherOrgId },
  ]);
  await db.insert(atelierAssistantOutbox).values({
    id: outboxId,
    orgId,
    actionId: executingActionId,
    destination: "c25-provider",
    providerIdempotencyKey: `provider_key_${suffix}`,
    requestEncrypted: "fixture",
    state: "inflight",
  });
  await assert.rejects(
    db.insert(atelierAssistantOutbox).values({
      id: `outbox_duplicate_${suffix}`,
      orgId,
      actionId: executingActionId,
      destination: "c25-provider",
      providerIdempotencyKey: `provider_key_${suffix}`,
      requestEncrypted: "fixture",
    }),
  );
  await db.insert(atelierWorkItems).values({
    id: workItemId,
    orgId,
    requesterId: actorId,
    goal: "<encrypted>",
    status: "planned",
    policyContext: { policyVersion },
    catalogVersion,
  });
  await db.insert(atelierWorkPlans).values({
    id: planId,
    workItemId,
    version: 1,
    status: "active",
    createdBy: actorId,
    rationale: "<encrypted>",
  });
  await db.insert(atelierWorkSteps).values({
    id: stepId,
    workItemId,
    planId,
    capabilityId: "account.update",
    inputEncrypted: "fixture",
    authorityGrant: {},
    policyDecisionDigest: "decision",
    policyVersion,
    catalogVersion,
    inputSchemaVersion: 1,
    retryPolicy: { maxAttempts: 3, maxWallMs: 60_000 },
    resultSchemaHash: "result",
    status: "running",
  });
  await db.insert(atelierWorkAttempts).values({
    id: attemptId,
    stepId,
    attemptNumber: 1,
    status: "running",
    leaseOwner: "worker-before-rollback",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    fencingToken: 7,
    startedAt: new Date(),
  });

  const rollout = await createAssistantRollout({
    orgId,
    name: "C25 active-state rollback rehearsal",
    actorId,
    dimensions: {
      action_executor: "durable-action-v1",
      workflow_family: "durable-work-v1",
      client_cohort: "canary-web-mobile",
    },
    versions: {
      schema: "0089",
      protocol: "assistant-protocol/v1",
      catalog: catalogVersion,
      policy: policyVersion,
    },
    exitCriteria: {
      stage_ready: 1,
    },
    alarmThresholds: {
      security: 0,
      duplicate_commits: 0,
      irrelevant_cards: 0,
      replay_gaps: 0,
      false_dispatch: 0,
      errors: 0,
      latency_ms: 2_000,
      cost_micros: 1_000_000,
    },
  });
  const thresholds = rollout.alarmThresholds as Record<string, number>;
  for (const alarmName of ROLLOUT_ALARMS) {
    assert.deepEqual(
      breachedRolloutAlarms(
        { [alarmName]: (thresholds[alarmName] ?? 0) + 1 },
        thresholds,
      ),
      [alarmName],
    );
  }

  await assert.rejects(
    advanceAssistantRollout(rollout.id, "shadow"),
    /rollout-exit-criteria-failed/,
  );
  await assert.rejects(
    advanceAssistantRollout(rollout.id, "cleanup"),
    /rollout-stage-order-invalid/,
  );
  await recordRolloutMeasurements({
    rolloutId: rollout.id,
    actorId,
    actorLabel: "C25 release operator",
    measurements: {
      stage_ready: 1,
    },
  });
  await advanceAssistantRollout(rollout.id, "shadow");
  const [{ count: skewBefore }] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(atelierAssistantActions)
    .where(sql`${atelierAssistantActions.orgId} = ${orgId}
      and ${atelierAssistantActions.inputSchemaVersion} = 0`);
  assert.equal(skewBefore, 1);
  await db.update(atelierAssistantActions).set({
    inputSchemaVersion: 1,
    updatedAt: new Date(),
  }).where(eq(atelierAssistantActions.id, legacyActionId));
  const [{ count: skewAfter }] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(atelierAssistantActions)
    .where(sql`${atelierAssistantActions.orgId} = ${orgId}
      and ${atelierAssistantActions.inputSchemaVersion} = 0`);
  assert.equal(skewAfter, 0);
  await recordRolloutMeasurements({
    rolloutId: rollout.id,
    actorId,
    actorLabel: "C25 migration operator",
    measurements: {
      schema_versions_active: 2,
      legacy_rows_backfilled: 1,
      schema_skew_remaining: 0,
      schema_skew_resolved: 1,
    },
  });
  await advanceAssistantRollout(rollout.id, "backfill_verify");
  await advanceAssistantRollout(rollout.id, "cohort_canary");

  const [alarm, duplicateAlarm] = await Promise.all([
    recordRolloutMeasurements({
      rolloutId: rollout.id,
      actorId,
      actorLabel: "C25 release operator",
      measurements: { duplicate_commits: 1 },
    }),
    recordRolloutMeasurements({
      rolloutId: rollout.id,
      actorId,
      actorLabel: "C25 concurrent alarm producer",
      measurements: { duplicate_commits: 1 },
    }),
  ]);
  assert.deepEqual(alarm.breached, ["duplicate_commits"]);
  assert.equal(alarm.rollout.status, "rollback");
  assert.equal(duplicateAlarm.rollout.status, "rollback");

  const auditsBefore = await db.select().from(atelierAuditEvents);
  const rollingBack = await startAssistantRollback({
    rolloutId: rollout.id,
    actorId,
    actorLabel: "C25 release operator",
    reason: "Automatic duplicate-commit alarm during cohort canary",
  });
  assert.equal(rollingBack.status, "rollback");
  assert.equal(rollingBack.workerFence, 1);
  assert.deepEqual(rollingBack.rollbackSteps, ROLLBACK_STEPS.slice(0, 3));
  assert.equal(new Set(rollingBack.controlIds).size, 3);
  const rollbackControls = await db.select().from(atelierAssistantControls)
    .where(sql`${atelierAssistantControls.id} in (${sql.join(
      rollingBack.controlIds.map((id) => sql`${id}`),
      sql`, `,
    )})`);
  assert.equal(rollbackControls.length, 3);

  const [pendingAction] = await db.select().from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, pendingActionId));
  const [executingAction] = await db.select().from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, executingActionId));
  const [work] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, workItemId));
  const [attempt] = await db.select().from(atelierWorkAttempts)
    .where(eq(atelierWorkAttempts.id, attemptId));
  assert.equal(pendingAction.state, "invalidated");
  assert.equal(executingAction.state, "executing");
  assert.equal(executingAction.stateVersion, 1);
  assert.equal(work.status, "blocked");
  assert.equal(attempt.status, "blocked");
  assert.equal(attempt.leaseOwner, null);
  assert.ok(attempt.fencingToken > 7);
  assert.equal(await completeWorkAttempt({
    orgId,
    attemptId,
    workerId: "worker-before-rollback",
    fencingToken: 7,
    result: { status: "succeeded", output: {} },
    usage: { costMicros: 0, toolCalls: 0, providerCalls: 0 },
  }), false);
  const controlContext = {
    orgId,
    capabilityId: "account.update",
    provider: null,
    model: null,
    protocolVersion: "assistant-protocol/v1",
    routerVersion: null,
    catalogVersion,
    policyVersion,
    actionExecutor: "durable-action-v1",
    workflowFamily: "durable-work-v1",
    clientCohort: "canary-web-mobile",
  };
  assert.equal((await resolveAssistantControl(controlContext)).blocked, true);
  const [otherAction] = await db.select().from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, otherActionId));
  assert.equal(otherAction.state, "awaiting_confirmation");

  await completeAssistantRollbackStep({
    rolloutId: rollout.id,
    step: "classify_inflight",
    actorId,
    actorLabel: "C25 release operator",
  });
  await assert.rejects(
    completeAssistantRollbackStep({
      rolloutId: rollout.id,
      step: "reconcile_outbox_provider",
      actorId,
      actorLabel: "C25 release operator",
      providerResults: [{
        actionId: executingActionId,
        outcome: "succeeded",
        providerResultId: `provider_result_${suffix}`,
      }],
    }),
    /rollback-step-order-invalid/,
  );
  await completeAssistantRollbackStep({
    rolloutId: rollout.id,
    step: "finish_fail_compensate",
    actorId,
    actorLabel: "C25 release operator",
  });
  await assert.rejects(
    completeAssistantRollbackStep({
      rolloutId: rollout.id,
      step: "reconcile_outbox_provider",
      actorId,
      actorLabel: "C25 release operator",
      providerResults: [],
    }),
    /rollback-provider-reconciliation-incomplete/,
  );
  await completeAssistantRollbackStep({
    rolloutId: rollout.id,
    step: "reconcile_outbox_provider",
    actorId,
    actorLabel: "C25 release operator",
    providerResults: [{
      actionId: executingActionId,
      outcome: "succeeded",
      providerResultId: `provider_result_${suffix}`,
    }],
  });
  await completeAssistantRollbackStep({
    rolloutId: rollout.id,
    step: "restore_compatible_routing",
    actorId,
    actorLabel: "C25 release operator",
  });
  assert.equal((await resolveAssistantControl(controlContext)).blocked, true);
  const rolledBack = await completeAssistantRollbackStep({
    rolloutId: rollout.id,
    step: "verify_audit_continuity",
    actorId,
    actorLabel: "C25 release operator",
  });
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.auditContinuityVerified, true);
  assert.deepEqual(rolledBack.rollbackSteps, ROLLBACK_STEPS);
  assert.equal((await resolveAssistantControl(controlContext)).blocked, false);
  const [deliveredOutbox] = await db.select().from(atelierAssistantOutbox)
    .where(eq(atelierAssistantOutbox.id, outboxId));
  assert.equal(deliveredOutbox.state, "delivered");
  assert.equal(deliveredOutbox.attempts, 1);

  const auditsAfter = await db.select().from(atelierAuditEvents);
  assert.ok(auditsAfter.length >= auditsBefore.length + 3);
  const [persisted] = await db.select().from(atelierAssistantRollouts)
    .where(eq(atelierAssistantRollouts.id, rollout.id));
  assert.equal(persisted.versions && typeof persisted.versions, "object");
  assert.equal((persisted.versions as Record<string, string>).schema, "0089");
  const rolloutEvents = await db.select().from(atelierAssistantRolloutEvents)
    .where(eq(atelierAssistantRolloutEvents.rolloutId, rollout.id))
    .orderBy(asc(atelierAssistantRolloutEvents.sequence));
  assert.ok(rolloutEvents.some((event) =>
    event.type === "rollout.stage_advanced" &&
    (event.evidence as { to?: string }).to === "backfill_verify"));
  assert.ok(rolloutEvents.some((event) => event.type === "rollout.alarm"));
  assert.ok(rolloutEvents.some((event) => event.type === "rollback.reconcile_outbox_provider"));
  assert.equal(rolloutEvents.filter((event) => event.type === "rollback.started").length, 1);
  assert.equal(
    rolloutEvents.filter((event) => event.type === "rollback.admission_fenced").length,
    1,
  );
  assert.ok(rolloutEvents.every((event, index) => event.sequence === index));

  await appendAssistantEvent({
    orgId,
    requesterId: actorId,
    conversationId,
    turnId,
    correlationId: `cursor_after_${suffix}`,
    type: "turn.completed",
    data: { phase: "after_rollback" },
  });
  const replayAfterReconnect = await db.select()
    .from(atelierAssistantEvents)
    .where(gt(atelierAssistantEvents.conversationSequence, reconnectCursor))
    .orderBy(asc(atelierAssistantEvents.conversationSequence));
  assert.deepEqual(
    replayAfterReconnect
      .filter((event) => event.conversationId === conversationId)
      .map((event) => event.type),
    ["text.delta", "turn.completed"],
  );

  console.log("riser staged rollout and active-state rollback: PASS");
} finally {
  await db.delete(atelierAssistantRollouts)
    .where(eq(atelierAssistantRollouts.id, `rollout_missing_${suffix}`));
  await db.delete(atelierWorkItems).where(eq(atelierWorkItems.id, workItemId));
  await db.delete(atelierAssistantProviderResults)
    .where(eq(atelierAssistantProviderResults.orgId, orgId));
  await db.delete(atelierAssistantActions)
    .where(eq(atelierAssistantActions.orgId, orgId));
  await pool.end();
}