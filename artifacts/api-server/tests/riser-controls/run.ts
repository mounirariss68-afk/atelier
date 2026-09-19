import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  atelierAssistantActions,
  atelierAssistantControls,
  atelierAuditEvents,
  atelierWorkAttempts,
  atelierWorkCheckpoints,
  atelierWorkItems,
  atelierWorkPlans,
  atelierWorkSteps,
} from "@workspace/db";
import {
  AssistantControlRequestV1Schema,
  ASSISTANT_OPERATOR_CONTROL_VERSION,
} from "@workspace/assistant-protocol";
import {
  assertAssistantProviderControl,
  createAssistantControl,
  disableAssistantControl,
  evaluateAssistantPolicy,
  listAssistantDeadLetters,
  resolveAssistantControl,
} from "../../src/lib/assistant/control-runtime.js";
import { decideWorkCheckpoint } from "../../src/lib/assistant/workflow-runtime.js";

const suffix = randomUUID();
const orgId = `org_control_${suffix}`;
const otherOrgId = `org_control_other_${suffix}`;
const actorId = `user_control_${suffix}`;
const catalogVersion = `catalog_${suffix}`;
const policyVersion = `policy_${suffix}`;

const request = (
  scopeKey: string,
  inflightBehavior: "finish" | "pause" | "cancel" | "compensate",
  scope:
    | "org"
    | "capability"
    | "provider"
    | "model"
    | "catalog_version"
    | "policy_version" = "capability",
) => ({
  version: ASSISTANT_OPERATOR_CONTROL_VERSION,
  scope,
  scopeKey,
  mode: "quarantine" as const,
  inflightBehavior,
  reason: `C26 rehearsal control for ${scope}:${scopeKey}`,
});

async function seedAction(capabilityId: string, ownerOrgId = orgId) {
  const id = `action_${capabilityId}_${randomUUID()}`;
  await db.insert(atelierAssistantActions).values({
    id,
    orgId: ownerOrgId,
    requesterId: actorId,
    capabilityId,
    catalogVersion,
    inputSchemaVersion: 1,
    inputDigest: "digest",
    requestDigest: "request",
    canonicalInputEncrypted: "not-read-by-control-rehearsal",
    policyVersion,
    policyDecisionDigest: "decision",
    riskClass: "medium",
    expiresAt: new Date(Date.now() + 60_000),
    state: "awaiting_confirmation",
    idempotencyKey: `idem_${randomUUID()}`,
  });
  return id;
}

async function seedWork(args: {
  capabilityId: string;
  ownerOrgId?: string;
  stepStatus?: "ready" | "running" | "succeeded";
  withAttempt?: boolean;
  compensation?: boolean;
}) {
  const ownerOrgId = args.ownerOrgId ?? orgId;
  const workItemId = `work_${randomUUID()}`;
  const planId = `plan_${randomUUID()}`;
  const stepId = `step_${randomUUID()}`;
  await db.insert(atelierWorkItems).values({
    id: workItemId,
    orgId: ownerOrgId,
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
    capabilityId: args.capabilityId,
    inputEncrypted: "not-read-by-control-rehearsal",
    authorityGrant: {},
    policyDecisionDigest: "decision",
    policyVersion,
    catalogVersion,
    inputSchemaVersion: 1,
    retryPolicy: { maxAttempts: 3, maxWallMs: 60_000 },
    resultSchemaHash: "result-schema",
    compensation: args.compensation ? { capabilityId: args.capabilityId } : null,
    status: args.stepStatus ?? "ready",
  });
  let attemptId: string | null = null;
  if (args.withAttempt) {
    attemptId = `attempt_${randomUUID()}`;
    await db.insert(atelierWorkAttempts).values({
      id: attemptId,
      stepId,
      attemptNumber: 1,
      status: "running",
      leaseOwner: "worker",
      leaseExpiresAt: new Date(Date.now() + 60_000),
      startedAt: new Date(),
    });
  }
  return { workItemId, stepId, attemptId };
}

try {
  assert.equal(
    AssistantControlRequestV1Schema.safeParse({
      ...request("coverage.bad", "pause"),
      reason: "short",
    }).success,
    false,
  );

  const pauseActionId = await seedAction("coverage.pause");
  const pauseWork = await seedWork({ capabilityId: "coverage.pause" });
  const otherWork = await seedWork({
    capabilityId: "coverage.pause",
    ownerOrgId: otherOrgId,
  });
  const pauseControl = await createAssistantControl({
    orgId,
    actorId,
    actorLabel: "C26 operator",
    request: request("coverage.pause", "pause"),
  });
  const [pausedAction] = await db
    .select()
    .from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, pauseActionId));
  const [pausedWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, pauseWork.workItemId));
  const [isolatedWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, otherWork.workItemId));
  assert.equal(pausedAction.state, "invalidated");
  assert.equal(pausedWork.status, "blocked");
  assert.equal(isolatedWork.status, "planned");
  const [pauseCheckpoint] = await db
    .select()
    .from(atelierWorkCheckpoints)
    .where(eq(atelierWorkCheckpoints.workItemId, pauseWork.workItemId));
  assert.ok(pauseCheckpoint);
  assert.equal(pauseCheckpoint.stepId, pauseWork.stepId);

  const cancelled = await seedWork({
    capabilityId: "coverage.cancel",
    stepStatus: "running",
    withAttempt: true,
  });
  await createAssistantControl({
    orgId,
    actorId,
    actorLabel: "C26 operator",
    request: request("coverage.cancel", "cancel"),
  });
  const [cancelledWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, cancelled.workItemId));
  const [cancelledAttempt] = await db
    .select()
    .from(atelierWorkAttempts)
    .where(eq(atelierWorkAttempts.id, cancelled.attemptId!));
  assert.equal(cancelledWork.status, "cancelled");
  assert.equal(cancelledAttempt.status, "cancelled");

  const compensating = await seedWork({
    capabilityId: "coverage.compensate",
    stepStatus: "succeeded",
    compensation: true,
  });
  await createAssistantControl({
    orgId,
    actorId,
    actorLabel: "C26 operator",
    request: request("coverage.compensate", "compensate"),
  });
  const [compensatingWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, compensating.workItemId));
  const [compensatingStep] = await db
    .select()
    .from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, compensating.stepId));
  assert.equal(compensatingWork.status, "compensation_required");
  assert.equal(compensatingStep.status, "compensation_required");

  const finishing = await seedWork({
    capabilityId: "coverage.finish",
    stepStatus: "running",
    withAttempt: true,
  });
  await createAssistantControl({
    orgId,
    actorId,
    actorLabel: "C26 operator",
    request: request("coverage.finish", "finish"),
  });
  const [finishingWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, finishing.workItemId));
  const [finishingAttempt] = await db
    .select()
    .from(atelierWorkAttempts)
    .where(eq(atelierWorkAttempts.id, finishing.attemptId!));
  assert.equal(finishingWork.status, "planned");
  assert.equal(finishingAttempt.status, "running");

  const firstModelControl = await createAssistantControl({
    orgId,
    actorId,
    actorLabel: "C26 operator",
    request: request("claude-c26", "finish", "model"),
  });
  const secondModelControl = await createAssistantControl({
    orgId,
    actorId,
    actorLabel: "C26 operator",
    request: {
      ...request("claude-c26", "finish", "model"),
      mode: "deny",
      reason: "C26 second version must deterministically supersede first",
    },
  });
  assert.equal(secondModelControl.version, firstModelControl.version + 1);
  const modelDecision = await resolveAssistantControl({
    orgId,
    provider: "anthropic",
    model: "claude-c26",
  });
  assert.equal(modelDecision.control?.id, secondModelControl.id);
  await assert.rejects(
    assertAssistantProviderControl({
      orgId,
      provider: "anthropic",
      model: "claude-c26",
    }),
    /assistant-provider-disabled/,
  );
  await assert.doesNotReject(
    assertAssistantProviderControl({
      orgId: otherOrgId,
      provider: "anthropic",
      model: "claude-c26",
    }),
  );

  const deniedPolicy = await evaluateAssistantPolicy({
    orgId,
    capabilityId: "coverage.pause",
    baseAllowed: true,
    obligations: [],
    policyVersion,
    catalogVersion,
  });
  assert.equal(deniedPolicy.effect, "deny");
  assert.equal(deniedPolicy.code, "operator_control");
  await disableAssistantControl({
    orgId,
    controlId: pauseControl.id,
    actorId,
    actorLabel: "C26 operator",
    reason: "C26 rehearsal confirms explicit disable is audited",
  });
  const allowedPolicy = await evaluateAssistantPolicy({
    orgId,
    capabilityId: "coverage.pause",
    baseAllowed: true,
    obligations: [],
    policyVersion,
    catalogVersion,
  });
  assert.equal(allowedPolicy.effect, "allow");
  assert.notEqual(allowedPolicy.decisionDigest, deniedPolicy.decisionDigest);

  const fabricated = await decideWorkCheckpoint({
    orgId,
    requesterId: actorId,
    workItemId: pauseWork.workItemId,
    checkpointId: `checkpoint_missing_${suffix}`,
    decision: "approve",
    evidence: { reason: "must not fabricate approval" },
    deciderRoles: ["founding_partner"],
  });
  assert.equal(fabricated, null);
  const decided = await decideWorkCheckpoint({
    orgId,
    requesterId: actorId,
    workItemId: pauseWork.workItemId,
    checkpointId: pauseCheckpoint.id,
    decision: "approve",
    evidence: { reason: "existing checkpoint only" },
    deciderRoles: ["founding_partner"],
  });
  assert.equal(decided?.decision, "approve");

  const deadLetters = await listAssistantDeadLetters({ orgId, limit: 100 });
  assert.ok(deadLetters.actions.some((row) => row.id === pauseActionId));
  assert.ok(
    deadLetters.work.some(
      (row) =>
        row.id === cancelled.workItemId ||
        row.id === compensating.workItemId,
    ),
  );

  const audits = await db
    .select()
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.orgId, orgId),
        eq(atelierAuditEvents.entityType, "assistant_control"),
      ),
    );
  assert.ok(audits.some((row) => row.action === "assistant.control.created"));
  assert.ok(audits.some((row) => row.action === "assistant.control.disabled"));
  assert.ok(
    audits.some((row) => row.action === "assistant.control.reconciled"),
  );
  const controls = await db
    .select()
    .from(atelierAssistantControls)
    .where(eq(atelierAssistantControls.orgId, orgId));
  assert.ok(controls.length >= 6);

  console.log("riser operator controls: PASS");
} finally {
  await pool.end();
}