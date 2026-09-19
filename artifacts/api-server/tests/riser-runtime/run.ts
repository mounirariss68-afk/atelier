import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  atelierAssistantActions,
  atelierAccounts,
  atelierAuditEvents,
  atelierAssistantBudgetLedgers,
  atelierAssistantBudgetReservations,
  atelierAssistantControls,
  atelierAssistantEvents,
  atelierWorkAttempts,
  atelierWorkCheckpoints,
  atelierWorkItems,
  atelierWorkSteps,
} from "@workspace/db";
import { appendAssistantEvent } from "../../src/lib/assistant/event-runtime.js";
import {
  claimDurableAction,
  completeDurableAction,
  confirmDurableAction,
  createDurableActionPreview,
} from "../../src/lib/assistant/action-runtime.js";
import {
  commitAssistantBudget,
  refundAssistantBudget,
  reserveAssistantBudget,
} from "../../src/lib/assistant/budget-runtime.js";
import { evaluateAssistantPolicy } from "../../src/lib/assistant/control-runtime.js";
import { executeDurableAccountUpdate } from "../../src/lib/assistant/durable-account-update.js";
import { confirmAndExecuteDurableAccountUpdate } from "../../src/lib/assistant/durable-account-update-confirmation.js";
import { createDurableAccountUpdatePreview } from "../../src/lib/assistant/durable-account-update-preview.js";
import {
  cancelDurableWork,
  claimWorkAttempt,
  completeWorkAttempt,
  createDurableWork,
  decideWorkCheckpoint,
} from "../../src/lib/assistant/workflow-runtime.js";

process.env.SESSION_SECRET ??= "riser-runtime-test-session-secret-32-bytes";

const suffix = randomUUID();
const orgId = `riser_org_${suffix}`;
const requesterId = `riser_user_${suffix}`;
const conversationId = `riser_conversation_${suffix}`;
let workItemId: string | null = null;

try {
  const policy = {
    effect: "allow" as const,
    policyVersion: "test-policy-v1",
    obligations: ["fresh_confirmation"],
    decisionDigest: "p".repeat(64),
  };
  const action = await createDurableActionPreview({
    orgId,
    requesterId,
    conversationId,
    sourceTurnId: `action_turn_${suffix}`,
    capabilityId: "account.update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 1,
    canonicalInput: { b: 2, a: 1 },
    targetRefsAndRevisions: [{ id: "acc_test", revision: "1" }],
    policyDecision: policy,
    riskClass: "write",
    irreversible: false,
    outboundChannels: [],
    summary: "Update an account",
    diff: { name: "Updated" },
    typedEvidence: "Account",
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `action-key-${suffix}`,
  });
  const actionReplay = await createDurableActionPreview({
    orgId,
    requesterId,
    conversationId,
    sourceTurnId: `action_turn_${suffix}`,
    capabilityId: "account.update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 1,
    canonicalInput: { a: 1, b: 2 },
    targetRefsAndRevisions: [{ id: "acc_test", revision: "1" }],
    policyDecision: policy,
    riskClass: "write",
    irreversible: false,
    outboundChannels: [],
    summary: "Update an account",
    diff: { name: "Updated" },
    typedEvidence: "Account",
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `action-key-${suffix}`,
  });
  assert.equal(actionReplay.actionId, action.actionId);
  await assert.rejects(
    () =>
      createDurableActionPreview({
        orgId,
        requesterId,
        conversationId,
        sourceTurnId: `action_turn_${suffix}`,
        capabilityId: "account.update",
        catalogVersion: "test-v1",
        inputSchemaVersion: 1,
        canonicalInput: { accountId: "acc_1", name: "New name" },
        targetRefsAndRevisions: [{ id: "acc_1", revision: "2" }],
        policyDecision: policy,
        riskClass: "write",
        irreversible: false,
        outboundChannels: [],
        summary: "Update account name",
        diff: { name: { before: "Old name", after: "New name" } },
        typedEvidence: "CONFIRM",
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: `action-key-${suffix}`,
      }),
    /action-idempotency-conflict/,
  );
  const racedActions = await Promise.all(
    Array.from({ length: 20 }, () =>
      createDurableActionPreview({
        orgId,
        requesterId,
        conversationId,
        sourceTurnId: `action_race_turn_${suffix}`,
        capabilityId: "account.read",
        catalogVersion: "test-v1",
        inputSchemaVersion: 1,
        canonicalInput: { accountId: "acc_race" },
        targetRefsAndRevisions: [{ id: "acc_race", revision: "1" }],
        policyDecision: policy,
        riskClass: "read",
        irreversible: false,
        outboundChannels: [],
        summary: "Read account",
        diff: {},
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: `action-race-key-${suffix}`,
      }),
    ),
  );
  assert.equal(new Set(racedActions.map((candidate) => candidate.actionId)).size, 1);
  await assert.rejects(
    createDurableActionPreview({
      orgId,
      requesterId,
      conversationId,
      sourceTurnId: `action_turn_${suffix}`,
      capabilityId: "account.update",
      catalogVersion: "test-v1",
      inputSchemaVersion: 1,
      canonicalInput: { a: 99 },
      targetRefsAndRevisions: [],
      policyDecision: policy,
      riskClass: "write",
      irreversible: false,
      outboundChannels: [],
      summary: "Conflict",
      diff: {},
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: `action-key-${suffix}`,
    }),
    /action-idempotency-conflict/,
  );
  await assert.rejects(
    confirmDurableAction({
      actionId: action.actionId,
      orgId,
      requesterId,
      expectedStateVersion: action.stateVersion,
      typedEvidence: "Wrong",
      recheckPolicy: async () => policy,
    }),
    /typed-evidence-mismatch/,
  );
  const confirmation = await confirmDurableAction({
    actionId: action.actionId,
    orgId,
    requesterId,
    expectedStateVersion: action.stateVersion,
    typedEvidence: "Account",
    recheckPolicy: async () => policy,
  });
  assert.equal(confirmation.state, "confirmed");
  assert.equal(
    await claimDurableAction({
      actionId: action.actionId,
      orgId: "wrong-org",
      recheckPolicy: async () => policy,
      recheckTargets: async () => true,
    }),
    null,
  );
  const actionClaim = await claimDurableAction({
    actionId: action.actionId,
    orgId,
    recheckPolicy: async () => policy,
    recheckTargets: async () => true,
  });
  assert.ok(actionClaim);
  assert.deepEqual(actionClaim.input, { b: 2, a: 1 });
  await assert.rejects(
    completeDurableAction({
      actionId: action.actionId,
      orgId,
      fencingToken: actionClaim.fencingToken + 1,
      status: "succeeded",
      result: { id: "acc_test" },
    }),
    /action-fence-mismatch/,
  );
  const actionResult = await completeDurableAction({
    actionId: action.actionId,
    orgId,
    fencingToken: actionClaim.fencingToken,
    status: "succeeded",
    result: { id: "acc_test" },
  });
  assert.equal(actionResult.state, "succeeded");
  assert.deepEqual(
    await completeDurableAction({
      actionId: action.actionId,
      orgId,
      fencingToken: actionClaim.fencingToken,
      status: "succeeded",
      result: { id: "different" },
    }),
    actionResult,
  );
  const staleTargetAction = await createDurableActionPreview({
    orgId,
    requesterId,
    conversationId,
    sourceTurnId: `action_stale_target_${suffix}`,
    capabilityId: "account.update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 1,
    canonicalInput: { accountId: "acc_stale", name: "Changed" },
    targetRefsAndRevisions: [{ id: "acc_stale", revision: "1" }],
    policyDecision: policy,
    riskClass: "write",
    irreversible: false,
    outboundChannels: [],
    summary: "Update stale account",
    diff: {},
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `action-stale-target-${suffix}`,
  });
  const staleTargetConfirmed = await confirmDurableAction({
    actionId: staleTargetAction.actionId,
    orgId,
    requesterId,
    expectedStateVersion: staleTargetAction.stateVersion,
    recheckPolicy: async () => policy,
  });
  assert.equal(staleTargetConfirmed.state, "confirmed");
  assert.equal(
    await claimDurableAction({
      actionId: staleTargetAction.actionId,
      orgId,
      recheckPolicy: async () => policy,
      recheckTargets: async () => false,
    }),
    null,
  );
  const [invalidatedTargetAction] = await db
    .select()
    .from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, staleTargetAction.actionId));
  assert.equal(invalidatedTargetAction.state, "invalidated");

  const accountId = `acct_riser_${suffix}`;
  const [durableAccount] = await db
    .insert(atelierAccounts)
    .values({
      id: accountId,
      orgId,
      name: "Before durable update",
      country: "UAE",
      sector: "Technology",
    })
    .returning();
  const accountAction = await createDurableActionPreview({
    orgId,
    requesterId,
    conversationId,
    sourceTurnId: `account_update_${suffix}`,
    capabilityId: "coverage.account_update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 1,
    canonicalInput: { id: accountId, name: "After durable update", status: "dormant" },
    targetRefsAndRevisions: [{
      type: "account",
      id: accountId,
      updatedAt: durableAccount.updatedAt.toISOString(),
    }],
    policyDecision: policy,
    riskClass: "write",
    irreversible: false,
    outboundChannels: [],
    summary: "Update account",
    diff: {},
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `durable-account-${suffix}`,
  });
  await confirmDurableAction({
    actionId: accountAction.actionId,
    orgId,
    requesterId,
    expectedStateVersion: accountAction.stateVersion,
    recheckPolicy: async () => policy,
  });
  const accountClaim = await claimDurableAction({
    actionId: accountAction.actionId,
    orgId,
    recheckPolicy: async () => policy,
    recheckTargets: async () => true,
  });
  assert.ok(accountClaim);
  const executorRace = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      executeDurableAccountUpdate({
        orgId,
        actionId: accountAction.actionId,
        fencingToken: accountClaim.fencingToken,
      }),
    ),
  );
  assert.equal(executorRace.filter((result) => result.status === "fulfilled").length, 20);
  assert.equal(
    new Set(
      executorRace
        .filter((result): result is PromiseFulfilledResult<{ id: string; changedFields: string[] }> =>
          result.status === "fulfilled",
        )
        .map((result) => JSON.stringify(result.value)),
    ).size,
    1,
  );
  const [updatedAccount] = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, accountId));
  assert.equal(updatedAccount.name, "After durable update");
  assert.equal(updatedAccount.status, "dormant");
  const accountAudits = await db
    .select()
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.orgId, orgId),
        eq(atelierAuditEvents.entityId, accountId),
        eq(atelierAuditEvents.action, "update"),
      ),
    );
  assert.equal(accountAudits.length, 1);
  const [completedAccountAction] = await db
    .select()
    .from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, accountAction.actionId));
  assert.equal(completedAccountAction.state, "succeeded");
  assert.deepEqual(completedAccountAction.auditEventIds, [accountAudits[0].id]);
  assert.equal(JSON.stringify(accountAudits[0].payload).includes("After durable update"), false);

  const adapterAccountId = `acct_adapter_${suffix}`;
  const [adapterAccount] = await db
    .insert(atelierAccounts)
    .values({
      id: adapterAccountId,
      orgId,
      name: "Before adapter",
      country: "UAE",
      sector: "Technology",
    })
    .returning();
  const adapterAction = await createDurableActionPreview({
    orgId,
    requesterId,
    conversationId,
    sourceTurnId: `account_adapter_${suffix}`,
    capabilityId: "coverage.account_update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 1,
    canonicalInput: { id: adapterAccountId, name: "After adapter" },
    targetRefsAndRevisions: [{
      type: "account",
      id: adapterAccountId,
      updatedAt: adapterAccount.updatedAt.toISOString(),
    }],
    policyDecision: policy,
    riskClass: "write",
    irreversible: false,
    outboundChannels: [],
    summary: "Update account through adapter",
    diff: {},
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `durable-account-adapter-${suffix}`,
  });
  const adapterArgs = {
    actionId: adapterAction.actionId,
    orgId,
    requesterId,
    conversationId,
    sourceTurnId: `account_adapter_${suffix}`,
    persona: {
      id: requesterId,
      name: "Riser tester",
      orgId,
      role: "founding_partner" as const,
    } as never,
    expectedStateVersion: adapterAction.stateVersion,
  };
  const adapterRace = await Promise.all(
    Array.from({ length: 20 }, () =>
      confirmAndExecuteDurableAccountUpdate(adapterArgs),
    ),
  );
  const adapterOutcome = adapterRace[0];
  assert.equal(adapterOutcome.state, "succeeded");
  assert.equal(
    new Set(adapterRace.map((outcome) => JSON.stringify(outcome))).size,
    1,
  );
  assert.deepEqual(
    await confirmAndExecuteDurableAccountUpdate(adapterArgs),
    adapterOutcome,
  );
  const adapterAudits = await db
    .select()
    .from(atelierAuditEvents)
    .where(eq(atelierAuditEvents.entityId, adapterAccountId));
  assert.equal(adapterAudits.length, 1);

  const previewAccountId = `acct_preview_${suffix}`;
  const [previewAccount] = await db
    .insert(atelierAccounts)
    .values({
      id: previewAccountId,
      orgId,
      name: "Before preview",
      country: "UAE",
      sector: "Technology",
    })
    .returning();
  const previewArgs = {
    persona: {
      id: requesterId,
      name: "Riser tester",
      orgId,
      role: "founding_partner" as const,
    } as never,
    conversationId,
    turnId: `account_preview_${suffix}`,
    step: 0,
    input: { id: previewAccountId, name: "After preview" },
  };
  const preview = await createDurableAccountUpdatePreview(previewArgs);
  assert.deepEqual(await createDurableAccountUpdatePreview(previewArgs), preview);
  const [stillUnchanged] = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, previewAccount.id));
  assert.equal(stillUnchanged.name, "Before preview");
  const [previewAction] = await db
    .select()
    .from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, preview.actionId));
  assert.equal(previewAction.state, "awaiting_confirmation");
  assert.equal(previewAction.capabilityId, "coverage.account_update");
  assert.equal(previewAction.targetRefsAndRevisions[0]?.id, previewAccountId);
  assert.equal(previewAction.targetRefsAndRevisions[0]?.updatedAt, previewAccount.updatedAt.toISOString());

  const parentLedgerId = `budget_parent_${suffix}`;
  const childLedgerId = `budget_child_${suffix}`;
  await db.insert(atelierAssistantBudgetLedgers).values([
    {
      id: parentLedgerId,
      orgId,
      ownerType: "org",
      ownerId: orgId,
      policyVersion: "test-v1",
      maxCostMicros: 1_000,
      maxProviderCalls: 4,
      maxToolCalls: 10,
      maxWallMs: 60_000,
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: childLedgerId,
      orgId,
      ownerType: "action",
      ownerId: action.actionId,
      parentLedgerId,
      policyVersion: "test-v1",
      maxCostMicros: 1_000,
      maxProviderCalls: 4,
      maxToolCalls: 10,
      maxWallMs: 60_000,
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  const initialReservation = await reserveAssistantBudget({
    orgId,
    ledgerId: childLedgerId,
    idempotencyKey: `budget-initial-${suffix}`,
    amount: { costMicros: 100, providerCalls: 1, toolCalls: 1 },
  });
  assert.equal(initialReservation.replay, false);
  assert.equal(
    (
      await reserveAssistantBudget({
        orgId,
        ledgerId: childLedgerId,
        idempotencyKey: `budget-initial-${suffix}`,
        amount: { costMicros: 100, providerCalls: 1, toolCalls: 1 },
      })
    ).replay,
    true,
  );
  const concurrentReservations = await Promise.allSettled(
    Array.from({ length: 5 }, (_, index) =>
      reserveAssistantBudget({
        orgId,
        ledgerId: childLedgerId,
        idempotencyKey: `budget-race-${suffix}-${index}`,
        amount: { costMicros: 100, providerCalls: 1, toolCalls: 1 },
      }),
    ),
  );
  const fulfilled = concurrentReservations.filter(
    (result): result is PromiseFulfilledResult<{ reservationId: string; replay: boolean }> =>
      result.status === "fulfilled",
  );
  assert.equal(fulfilled.length, 3);
  await commitAssistantBudget(orgId, initialReservation.reservationId);
  await refundAssistantBudget(orgId, fulfilled[0].value.reservationId);
  const [parentLedger] = await db
    .select()
    .from(atelierAssistantBudgetLedgers)
    .where(eq(atelierAssistantBudgetLedgers.id, parentLedgerId));
  assert.equal(parentLedger.committedProviderCalls, 1);
  assert.equal(parentLedger.reservedProviderCalls, 2);

  const allowedPolicy = await evaluateAssistantPolicy({
    orgId,
    capabilityId: "account.update",
    baseAllowed: true,
    obligations: ["fresh_confirmation"],
    policyVersion: "test-policy-v1",
  });
  assert.equal(allowedPolicy.effect, "allow");
  const controlDriftAction = await createDurableActionPreview({
    orgId,
    requesterId,
    conversationId,
    sourceTurnId: `action_control_drift_${suffix}`,
    capabilityId: "account.update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 1,
    canonicalInput: { accountId: "acc_control", name: "Blocked" },
    targetRefsAndRevisions: [{ id: "acc_control", revision: "1" }],
    policyDecision: allowedPolicy,
    riskClass: "write",
    irreversible: false,
    outboundChannels: [],
    summary: "Blocked by operator control",
    diff: {},
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `action-control-drift-${suffix}`,
  });
  await db.insert(atelierAssistantControls).values({
    id: `control_${suffix}`,
    orgId,
    scope: "capability",
    scopeKey: "account.update",
    mode: "deny",
    inflightBehavior: "cancel",
    reason: "runtime probe",
    createdByUserId: requesterId,
  });
  const deniedPolicy = await evaluateAssistantPolicy({
    orgId,
    capabilityId: "account.update",
    baseAllowed: true,
    obligations: ["fresh_confirmation"],
    policyVersion: "test-policy-v1",
  });
  assert.equal(deniedPolicy.effect, "deny");
  assert.equal(deniedPolicy.code, "operator_control");
  await assert.rejects(
    () =>
      confirmDurableAction({
        actionId: controlDriftAction.actionId,
        orgId,
        requesterId,
        expectedStateVersion: controlDriftAction.stateVersion,
        recheckPolicy: async () => allowedPolicy,
      }),
    /action-policy-drift/,
  );

  const created = await createDurableWork({
    orgId,
    requesterId,
    goal: "Safely read then summarize an account",
    catalogVersion: "test-v1",
    policyContext: { test: true },
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Safely read then summarize an account",
      steps: [
        {
          id: "read",
          capabilityId: "account.read",
          dependencies: [],
          input: { accountId: "acc_test" },
          authorityGrant: { scope: "test" },
          policyDecisionDigest: "a".repeat(64),
          resultSchemaHash: "b".repeat(12),
          retryPolicy: { maxAttempts: 2, maxWallMs: 10_000 },
        },
        {
          id: "summarize",
          delegateAgentId: "agent.summarizer",
          dependencies: ["read"],
          input: { source: "read" },
          authorityGrant: { scope: "test" },
          policyDecisionDigest: "c".repeat(64),
          resultSchemaHash: "d".repeat(12),
          retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
        },
      ],
    },
  });
  workItemId = created.workItemId;
  const steps = await db
    .select()
    .from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, workItemId))
    .orderBy(asc(atelierWorkSteps.createdAt));
  assert.equal(steps.length, 2);
  const readStep = steps.find((step) => step.capabilityId === "account.read");
  const summarizeStep = steps.find((step) => step.delegateAgentId === "agent.summarizer");
  assert.ok(readStep);
  assert.ok(summarizeStep);
  assert.notEqual(readStep.id, "read");
  assert.deepEqual(summarizeStep.dependencies, [readStep.id]);

  assert.equal(
    await claimWorkAttempt({
      orgId: "wrong-org",
      stepId: readStep.id,
      workerId: "worker-a",
      leaseMs: 30_000,
    }),
    null,
  );
  const claim = await claimWorkAttempt({
    orgId,
    stepId: readStep.id,
    workerId: "worker-a",
    leaseMs: 30_000,
  });
  assert.ok(claim);
  assert.equal(
    await claimWorkAttempt({
      orgId,
      stepId: readStep.id,
      workerId: "worker-b",
      leaseMs: 30_000,
    }),
    null,
  );
  assert.equal(
    await completeWorkAttempt({
      orgId,
      attemptId: claim.attemptId,
      workerId: "worker-a",
      fencingToken: claim.fencingToken + 1,
      result: { ok: true },
    }),
    false,
  );
  assert.equal(
    await completeWorkAttempt({
      orgId,
      attemptId: claim.attemptId,
      workerId: "worker-a",
      fencingToken: claim.fencingToken,
      result: { ok: true },
    }),
    true,
  );
  const [readySummaryStep] = await db
    .select()
    .from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, summarizeStep.id));
  assert.equal(readySummaryStep.status, "ready");

  const checkpointId = `checkpoint_${suffix}`;
  await db.insert(atelierWorkCheckpoints).values({
    id: checkpointId,
    workItemId,
    stepId: summarizeStep.id,
    type: "human_approval",
    requiredDecider: { requesterId },
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(
    await claimWorkAttempt({
      orgId,
      stepId: summarizeStep.id,
      workerId: "worker-summary",
      leaseMs: 30_000,
    }),
    null,
  );
  assert.equal(
    await decideWorkCheckpoint({
      orgId,
      requesterId: "wrong-user",
      workItemId,
      checkpointId,
      decision: "approve",
      evidence: {},
    }),
    null,
  );
  assert.ok(
    await decideWorkCheckpoint({
      orgId,
      requesterId,
      workItemId,
      checkpointId,
      decision: "approve",
      evidence: { reason: "test" },
    }),
  );
  assert.equal(
    await decideWorkCheckpoint({
      orgId,
      requesterId,
      workItemId,
      checkpointId,
      decision: "reject",
      evidence: {},
    }),
    null,
  );
  const summaryClaim = await claimWorkAttempt({
    orgId,
    stepId: summarizeStep.id,
    workerId: "worker-summary",
    leaseMs: 30_000,
  });
  assert.ok(summaryClaim);
  assert.equal(
    await completeWorkAttempt({
      orgId,
      attemptId: summaryClaim.attemptId,
      workerId: "worker-summary",
      fencingToken: summaryClaim.fencingToken,
      result: { summary: "done" },
    }),
    true,
  );
  const [completedWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, workItemId));
  assert.equal(completedWork.status, "succeeded");

  const cancellable = await createDurableWork({
    orgId,
    requesterId,
    goal: "Cancel safely",
    catalogVersion: "test-v1",
    policyContext: { test: true },
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Cancel safely",
      steps: [{
        id: "wait",
        capabilityId: "account.read",
        dependencies: [],
        input: {},
        authorityGrant: {},
        policyDecisionDigest: "e".repeat(64),
        resultSchemaHash: "f".repeat(12),
        retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
      }],
    },
  });
  const [cancellableStep] = await db
    .select()
    .from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, cancellable.workItemId));
  const cancellableClaim = await claimWorkAttempt({
    orgId,
    stepId: cancellableStep.id,
    workerId: "worker-cancel",
    leaseMs: 30_000,
  });
  assert.ok(cancellableClaim);
  assert.deepEqual(
    await cancelDurableWork({ orgId, requesterId, workItemId: cancellable.workItemId }),
    { status: "cancelled" },
  );
  assert.equal(
    await completeWorkAttempt({
      orgId,
      attemptId: cancellableClaim.attemptId,
      workerId: "worker-cancel",
      fencingToken: cancellableClaim.fencingToken,
      result: { shouldNotCommit: true },
    }),
    false,
  );
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      appendAssistantEvent({
        orgId,
        requesterId,
        conversationId,
        turnId: `turn_${suffix}`,
        correlationId: `correlation_${suffix}`,
        type: "test.event",
        data: { index, authorization: "must-not-persist" },
      }),
    ),
  );
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      appendAssistantEvent({
        orgId,
        requesterId,
        conversationId,
        turnId: `turn_two_${suffix}`,
        correlationId: `correlation_${suffix}`,
        type: "test.event",
        data: { index },
      }),
    ),
  );
  const events = await db
    .select()
    .from(atelierAssistantEvents)
    .where(
      and(
        eq(atelierAssistantEvents.orgId, orgId),
        eq(atelierAssistantEvents.conversationId, conversationId),
        eq(atelierAssistantEvents.type, "test.event"),
      ),
    )
    .orderBy(asc(atelierAssistantEvents.sequence));
  const firstTurnEvents = events.filter((event) => event.turnId === `turn_${suffix}`);
  const secondTurnEvents = events.filter((event) => event.turnId === `turn_two_${suffix}`);
  assert.deepEqual(
    firstTurnEvents.map((event) => event.sequence),
    Array.from({ length: 20 }, (_, index) => index),
  );
  assert.deepEqual(
    secondTurnEvents.map((event) => event.sequence),
    Array.from({ length: 5 }, (_, index) => index),
  );
  assert.deepEqual(
    [...events]
      .sort((a, b) => a.conversationSequence - b.conversationSequence)
      .map((event) => event.conversationSequence),
    Array.from(
      { length: 25 },
      (_, index) => Math.min(...events.map((event) => event.conversationSequence)) + index,
    ),
  );
  assert.equal(JSON.stringify(events).includes("must-not-persist"), false);

  console.log("riser runtime probes passed");
} finally {
  await db
    .delete(atelierAssistantEvents)
    .where(eq(atelierAssistantEvents.orgId, orgId));
  await db.delete(atelierAssistantActions).where(eq(atelierAssistantActions.orgId, orgId));
  await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.orgId, orgId));
  await db.delete(atelierAccounts).where(eq(atelierAccounts.orgId, orgId));
  await db.delete(atelierAssistantControls).where(eq(atelierAssistantControls.orgId, orgId));
  await db
    .delete(atelierAssistantBudgetReservations)
    .where(eq(atelierAssistantBudgetReservations.orgId, orgId));
  await db
    .delete(atelierAssistantBudgetLedgers)
    .where(eq(atelierAssistantBudgetLedgers.orgId, orgId));
  if (workItemId) {
    await db.delete(atelierWorkItems).where(eq(atelierWorkItems.id, workItemId));
  }
}