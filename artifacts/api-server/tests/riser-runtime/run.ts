import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import { and, asc, eq, isNull } from "drizzle-orm";
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
  aggregateWorkResult,
  cancelDurableWork,
  claimWorkAttempt as claimWorkAttemptRuntime,
  completeWorkAttempt,
  createDurableWork,
  decideWorkCheckpoint,
  executeClaimedWorkAttempt,
  failWorkAttempt,
  heartbeatWorkAttempt,
  pauseWorkStepForProvider,
  reapExpiredWorkLeases,
} from "../../src/lib/assistant/workflow-runtime.js";
import { currentCapabilityManifestVersion } from "../../src/lib/atelier-cli/capability-manifest.js";

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
    capabilityId: "coverage.account_update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 3,
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
    capabilityId: "coverage.account_update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 3,
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
  const reviewedManifestVersion = currentCapabilityManifestVersion();
  const [pinnedAction] = await db
    .select()
    .from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, action.actionId));
  assert.equal(pinnedAction.catalogVersion, reviewedManifestVersion);
  assert.notEqual(pinnedAction.catalogVersion, "test-v1");

  const staleManifestAction = await createDurableActionPreview({
    orgId,
    requesterId,
    conversationId,
    sourceTurnId: `stale_manifest_turn_${suffix}`,
    capabilityId: "coverage.account_update",
    catalogVersion: "caller-must-not-control-this",
    inputSchemaVersion: 3,
    canonicalInput: { accountId: "stale_manifest" },
    targetRefsAndRevisions: [],
    policyDecision: policy,
    riskClass: "write",
    irreversible: false,
    outboundChannels: [],
    summary: "Stale manifest action",
    diff: {},
    expiresAt: new Date(Date.now() + 60_000),
    idempotencyKey: `stale-manifest-${suffix}`,
  });
  await db
    .update(atelierAssistantActions)
    .set({ catalogVersion: "retired-manifest-version" })
    .where(eq(atelierAssistantActions.id, staleManifestAction.actionId));
  await assert.rejects(
    () =>
      confirmDurableAction({
        actionId: staleManifestAction.actionId,
        orgId,
        requesterId,
        expectedStateVersion: staleManifestAction.stateVersion,
        recheckPolicy: async () => policy,
      }),
    /action-manifest-version-unsupported/,
  );
  const [invalidatedManifestAction] = await db
    .select()
    .from(atelierAssistantActions)
    .where(eq(atelierAssistantActions.id, staleManifestAction.actionId));
  assert.equal(invalidatedManifestAction.state, "invalidated");
  await assert.rejects(
    () =>
      createDurableActionPreview({
        orgId,
        requesterId,
        conversationId,
        sourceTurnId: `action_turn_${suffix}`,
        capabilityId: "coverage.account_update",
        catalogVersion: "test-v1",
        inputSchemaVersion: 3,
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
        capabilityId: "coverage.account_update",
        catalogVersion: "test-v1",
        inputSchemaVersion: 3,
        canonicalInput: { accountId: "acc_race" },
        targetRefsAndRevisions: [{ id: "acc_race", revision: "1" }],
        policyDecision: policy,
        riskClass: "write",
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
      capabilityId: "coverage.account_update",
      catalogVersion: "test-v1",
      inputSchemaVersion: 3,
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
      requesterId,
      recheckPolicy: async () => policy,
      recheckTargets: async () => true,
    }),
    null,
  );
  const actionClaim = await claimDurableAction({
    actionId: action.actionId,
    orgId,
    requesterId,
    recheckPolicy: async () => policy,
    recheckTargets: async () => true,
  });
  assert.ok(actionClaim);
  assert.deepEqual(actionClaim.input, { b: 2, a: 1 });
  await assert.rejects(
    completeDurableAction({
      actionId: action.actionId,
      orgId,
      requesterId,
      fencingToken: actionClaim.fencingToken + 1,
      status: "succeeded",
      result: { id: "acc_test" },
    }),
    /action-fence-mismatch/,
  );
  const actionResult = await completeDurableAction({
    actionId: action.actionId,
    orgId,
    requesterId,
    fencingToken: actionClaim.fencingToken,
    status: "succeeded",
    result: { id: "acc_test" },
  });
  assert.equal(actionResult.state, "succeeded");
  assert.deepEqual(
    await completeDurableAction({
      actionId: action.actionId,
      orgId,
      requesterId,
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
    capabilityId: "coverage.account_update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 3,
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
      requesterId,
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
    inputSchemaVersion: 3,
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
    requesterId,
    recheckPolicy: async () => policy,
    recheckTargets: async () => true,
  });
  assert.ok(accountClaim);
  const executorRace = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      executeDurableAccountUpdate({
        orgId,
        requesterId,
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
    inputSchemaVersion: 3,
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
  const workflowLedgerId = `budget_workflow_${suffix}`;
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
      maxConcurrentSlots: 100,
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
      maxConcurrentSlots: 100,
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: workflowLedgerId,
      orgId,
      ownerType: "workflow",
      ownerId: `workflow_test_${suffix}`,
      policyVersion: "test-policy-v1",
      maxCostMicros: 10_000,
      maxProviderCalls: 100,
      maxToolCalls: 100,
      maxWallMs: 60_000,
      maxConcurrentSlots: 100,
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  const workflowAuthorization = {
    capabilityIds: ["account.brief", "account.dossier"],
    toolIds: ["account_brief", "account_dossier"],
    dataClasses: ["account"],
    policyVersion: "test-policy-v1",
    obligations: [] as string[],
    budgetLedgerId: workflowLedgerId,
  };
  const claimWorkAttempt = (
    args: Omit<
      Parameters<typeof claimWorkAttemptRuntime>[0],
      "resolveAuthorization"
    >,
  ) =>
    claimWorkAttemptRuntime({
      ...args,
      resolveAuthorization: async ({ orgId: requestedOrgId, requesterId: requestedUserId }) =>
        requestedOrgId === orgId && requestedUserId === requesterId
          ? workflowAuthorization
          : null,
    });
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
    capabilityId: "coverage.account_update",
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
    capabilityId: "coverage.account_update",
    catalogVersion: "test-v1",
    inputSchemaVersion: 3,
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
    scopeKey: "coverage.account_update",
    mode: "deny",
    inflightBehavior: "cancel",
    reason: "runtime probe",
    createdByUserId: requesterId,
  });
  const deniedPolicy = await evaluateAssistantPolicy({
    orgId,
    capabilityId: "coverage.account_update",
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

  await assert.rejects(
    () =>
      createDurableWork({
        orgId,
        requesterId,
        goal: "Delegated execution is not yet reviewed",
        catalogVersion: "caller-must-not-control-this",
        authorization: workflowAuthorization,
        plan: {
          workItemId: "new",
          version: 1,
          goal: "Delegated execution is not yet reviewed",
          steps: [{
            id: "delegate",
            delegateAgentId: "agent.summarizer",
            dependencies: [],
            input: {},
            authorityGrant: {},
            policyDecisionDigest: "a".repeat(64),
            toolsDataPerimeter: { toolIds: [], dataClasses: [] },
            budget: { maxCostMicros: 0, maxToolCalls: 0, maxProviderCalls: 0 },
            resultSchemaHash: "94c64f190712",
            retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
          }],
        },
      }),
    /delegated-executor-unsupported/,
  );
  await assert.rejects(
    () =>
      createDurableWork({
        orgId,
        requesterId,
        goal: "Reject missing workflow parent",
        authorization: workflowAuthorization,
        plan: {
          workItemId: "new",
          version: 1,
          goal: "Reject missing workflow parent",
          steps: [{
            id: "orphan",
            parentStepId: "missing",
            capabilityId: "account.brief",
            dependencies: [],
            input: {},
            authorityGrant: {},
            policyDecisionDigest: "a".repeat(64),
            toolsDataPerimeter: {
              toolIds: ["account_brief"],
              dataClasses: ["account"],
            },
            budget: { maxCostMicros: 10, maxToolCalls: 1, maxProviderCalls: 1 },
            resultSchemaHash: "94c64f190712",
            retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
          }],
        },
      }),
    /workflow-missing-parent/,
  );

  const created = await createDurableWork({
    orgId,
    requesterId,
    goal: "Safely read then summarize an account",
    catalogVersion: "test-v1",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Safely read then summarize an account",
      steps: [
        {
          id: "read",
          capabilityId: "account.brief",
          dependencies: [],
          input: { accountId: "acc_test" },
          authorityGrant: { scope: "test" },
          policyDecisionDigest: "a".repeat(64),
          toolsDataPerimeter: { toolIds: ["account_brief"], dataClasses: ["account"] },
          budget: { maxCostMicros: 100, maxToolCalls: 2, maxProviderCalls: 2 },
          resultSchemaHash: "94c64f190712",
          compensation: {
            capabilityId: "account.brief",
            input: { accountId: "acc_test", compensate: true },
          },
          retryPolicy: { maxAttempts: 2, maxWallMs: 10_000 },
        },
        {
          id: "summarize",
          capabilityId: "account.dossier",
          parentStepId: "read",
          dependencies: ["read"],
          input: { source: "read" },
          authorityGrant: { scope: "test" },
          policyDecisionDigest: "c".repeat(64),
          toolsDataPerimeter: { toolIds: ["account_dossier"], dataClasses: ["account"] },
          budget: { maxCostMicros: 100, maxToolCalls: 2, maxProviderCalls: 2 },
          resultSchemaHash: "94c64f190712",
          checkpoint: {
            type: "human_approval",
            evidenceSchema: {
              type: "object",
              properties: { reason: { type: "string" } },
              required: ["reason"],
              additionalProperties: false,
            },
            expiresInMs: 60_000,
          },
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
  const [pinnedWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, workItemId));
  assert.equal(pinnedWork.catalogVersion, reviewedManifestVersion);
  assert.ok(steps.every((step) => step.catalogVersion === reviewedManifestVersion));
  const readStep = steps.find((step) => step.capabilityId === "account.brief");
  const summarizeStep = steps.find((step) => step.capabilityId === "account.dossier");
  assert.ok(readStep);
  assert.ok(summarizeStep);
  assert.notEqual(readStep.id, "read");
  assert.deepEqual(summarizeStep.dependencies, [readStep.id]);
  assert.equal(summarizeStep.parentStepId, readStep.id);
  const providerCheckpointId = await pauseWorkStepForProvider({
    orgId,
    requesterId,
    stepId: readStep.id,
    provider: "test-provider",
    expiresInMs: 60_000,
  });
  assert.ok(providerCheckpointId);
  assert.equal(
    await claimWorkAttempt({
      orgId,
      stepId: readStep.id,
      workerId: "worker-provider-paused",
      leaseMs: 30_000,
    }),
    null,
  );
  assert.ok(await decideWorkCheckpoint({
    orgId,
    requesterId,
    workItemId,
    checkpointId: providerCheckpointId,
    decision: "approve",
    evidence: { providerRecovered: true },
    deciderRoles: ["founding_partner"],
  }));

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
  const [claimedAttempt] = await db
    .select()
    .from(atelierWorkAttempts)
    .where(eq(atelierWorkAttempts.id, claim.attemptId));
  assert.ok(claimedAttempt.budgetReservationId);
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
      result: { ok: true, data: { ok: true } },
      usage: { costMicros: 0, toolCalls: 0, providerCalls: 0 },
    }),
    false,
  );
  assert.equal(
    await completeWorkAttempt({
      orgId,
      attemptId: claim.attemptId,
      workerId: "worker-a",
      fencingToken: claim.fencingToken,
      result: { fabricated: true },
      usage: { costMicros: 0, toolCalls: 0, providerCalls: 0 },
    }),
    false,
  );
  assert.equal(
    await completeWorkAttempt({
      orgId,
      attemptId: claim.attemptId,
      workerId: "worker-a",
      fencingToken: claim.fencingToken,
      result: { ok: true, data: { missingUsage: true } },
    }),
    false,
  );
  assert.equal(
    await completeWorkAttempt({
      orgId,
      attemptId: claim.attemptId,
      workerId: "worker-a",
      fencingToken: claim.fencingToken,
      result: { ok: true, data: { ok: true } },
      usage: { costMicros: 10, toolCalls: 1, providerCalls: 0 },
    }),
    true,
  );
  const [readySummaryStep] = await db
    .select()
    .from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, summarizeStep.id));
  assert.equal(readySummaryStep.status, "ready");

  const [createdCheckpoint] = await db
    .select()
    .from(atelierWorkCheckpoints)
    .where(eq(atelierWorkCheckpoints.stepId, summarizeStep.id));
  assert.ok(createdCheckpoint);
  const checkpointId = createdCheckpoint.id;
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
  assert.equal(
    await decideWorkCheckpoint({
      orgId,
      requesterId,
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
      result: { ok: true, data: { summary: "done" } },
      usage: { costMicros: 10, toolCalls: 1, providerCalls: 0 },
    }),
    true,
  );
  const [completedWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, workItemId));
  assert.equal(completedWork.status, "awaiting_aggregation");
  const aggregate = await aggregateWorkResult({ orgId, workItemId });
  assert.ok(aggregate);
  assert.equal(aggregate.result.steps.length, 2);
  const [aggregatedWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, workItemId));
  assert.equal(aggregatedWork.status, "succeeded");

  const staleWork = await createDurableWork({
    orgId,
    requesterId,
    goal: "Reject a retired manifest pin",
    catalogVersion: "caller-must-not-control-this",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Reject a retired manifest pin",
      steps: [{
        id: "stale",
        capabilityId: "account.brief",
        dependencies: [],
        input: {},
        authorityGrant: {},
        policyDecisionDigest: "e".repeat(64),
        toolsDataPerimeter: { toolIds: [], dataClasses: ["account"] },
        budget: { maxCostMicros: 1_000, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
        retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
      }],
    },
  });
  const [staleWorkStep] = await db
    .select()
    .from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, staleWork.workItemId));
  await db
    .update(atelierWorkItems)
    .set({ catalogVersion: "retired-manifest-version" })
    .where(eq(atelierWorkItems.id, staleWork.workItemId));
  assert.equal(
    await claimWorkAttempt({
      orgId,
      stepId: staleWorkStep.id,
      workerId: "worker-stale",
      leaseMs: 30_000,
    }),
    null,
  );
  const [invalidatedWork] = await db
    .select()
    .from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, staleWork.workItemId));
  const [invalidatedWorkStep] = await db
    .select()
    .from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, staleWorkStep.id));
  assert.equal(invalidatedWork.status, "failed");
  assert.equal(invalidatedWorkStep.status, "failed");

  const policyDriftWork = await createDurableWork({
    orgId,
    requesterId,
    goal: "Reject policy drift",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Reject policy drift",
      steps: [{
        id: "policy-drift",
        capabilityId: "account.brief",
        dependencies: [],
        input: {},
        authorityGrant: {},
        policyDecisionDigest: "1".repeat(64),
        toolsDataPerimeter: { toolIds: ["account_brief"], dataClasses: ["account"] },
        budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
        retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
      }],
    },
  });
  const [policyDriftStep] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, policyDriftWork.workItemId));
  await db.insert(atelierAssistantControls).values({
    id: `control_workflow_drift_${suffix}`,
    orgId,
    scope: "capability",
    scopeKey: "account.brief",
    mode: "deny",
    inflightBehavior: "fail_closed",
    reason: "runtime drift probe",
    createdByUserId: requesterId,
  });
  assert.equal(await claimWorkAttempt({
    orgId,
    stepId: policyDriftStep.id,
    workerId: "worker-policy-drift",
    leaseMs: 30_000,
  }), null);
  const [policyDriftFailed] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, policyDriftStep.id));
  assert.equal(policyDriftFailed.status, "failed");
  await db.delete(atelierAssistantControls)
    .where(eq(atelierAssistantControls.id, `control_workflow_drift_${suffix}`));

  const cancellable = await createDurableWork({
    orgId,
    requesterId,
    goal: "Cancel safely",
    catalogVersion: "test-v1",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Cancel safely",
      steps: [{
        id: "wait",
        capabilityId: "account.brief",
        dependencies: [],
        input: {},
        authorityGrant: {},
        policyDecisionDigest: "e".repeat(64),
        toolsDataPerimeter: { toolIds: [], dataClasses: ["account"] },
        budget: { maxCostMicros: 1_000, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
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
  const [cancellableAttempt] = await db.select().from(atelierWorkAttempts)
    .where(eq(atelierWorkAttempts.id, cancellableClaim.attemptId));
  assert.ok(cancellableAttempt.budgetReservationId);
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
      result: { ok: true, data: { shouldNotCommit: true } },
      usage: { costMicros: 0, toolCalls: 0, providerCalls: 0 },
    }),
    false,
  );
  const [cancelledReservation] = await db
    .select()
    .from(atelierAssistantBudgetReservations)
    .where(eq(
      atelierAssistantBudgetReservations.id,
      cancellableAttempt.budgetReservationId!,
    ));
  assert.equal(cancelledReservation.state, "committed");

  const narrowedWork = await createDurableWork({
    orgId,
    requesterId,
    goal: "Reject narrowed current authority",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Reject narrowed current authority",
      steps: [{
        id: "narrowed",
        capabilityId: "account.brief",
        dependencies: [],
        input: {},
        authorityGrant: {},
        policyDecisionDigest: "7".repeat(64),
        toolsDataPerimeter: { toolIds: ["account_brief"], dataClasses: ["account"] },
        budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
        retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
      }],
    },
  });
  const [narrowedStep] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, narrowedWork.workItemId));
  assert.equal(await claimWorkAttemptRuntime({
    orgId,
    stepId: narrowedStep.id,
    workerId: "worker-narrowed",
    leaseMs: 30_000,
    resolveAuthorization: async () => ({
      ...workflowAuthorization,
      capabilityIds: [],
      toolIds: [],
      dataClasses: [],
    }),
  }), null);
  const [narrowedFailed] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, narrowedStep.id));
  assert.equal(narrowedFailed.status, "failed");

  const recoverable = await createDurableWork({
    orgId,
    requesterId,
    goal: "Recover then compensate safely",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Recover then compensate safely",
      steps: [
        {
          id: "effect",
          capabilityId: "account.brief",
          dependencies: [],
          input: {},
          authorityGrant: { scope: "test" },
          policyDecisionDigest: "f".repeat(64),
          toolsDataPerimeter: { toolIds: ["account_brief"], dataClasses: ["account"] },
          budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
          resultSchemaHash: "94c64f190712",
          compensation: { capabilityId: "account.brief", input: { compensate: true } },
          retryPolicy: { maxAttempts: 2, maxWallMs: 10_000 },
        },
        {
          id: "dependent",
          capabilityId: "account.dossier",
          dependencies: ["effect"],
          input: {},
          authorityGrant: { scope: "test" },
          policyDecisionDigest: "9".repeat(64),
          toolsDataPerimeter: { toolIds: ["account_dossier"], dataClasses: ["account"] },
          budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
          resultSchemaHash: "94c64f190712",
          retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
        },
      ],
    },
  });
  const recoverySteps = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, recoverable.workItemId));
  const effectStep = recoverySteps.find((step) => step.capabilityId === "account.brief");
  const dependentStep = recoverySteps.find((step) => step.capabilityId === "account.dossier");
  assert.ok(effectStep);
  assert.ok(dependentStep);
  const firstClaim = await claimWorkAttempt({
    orgId,
    stepId: effectStep.id,
    workerId: "worker-expired",
    leaseMs: 1_000,
  });
  assert.ok(firstClaim);
  assert.equal(await heartbeatWorkAttempt({
    orgId,
    attemptId: firstClaim.attemptId,
    workerId: "wrong-worker",
    fencingToken: firstClaim.fencingToken,
    leaseMs: 10_000,
  }), false);
  await db.update(atelierWorkAttempts)
    .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
    .where(eq(atelierWorkAttempts.id, firstClaim.attemptId));
  assert.equal(await reapExpiredWorkLeases(), 1);
  const secondClaim = await claimWorkAttempt({
    orgId,
    stepId: effectStep.id,
    workerId: "worker-recovered",
    leaseMs: 30_000,
  });
  assert.ok(secondClaim);
  assert.ok(secondClaim.fencingToken > firstClaim.fencingToken);
  assert.equal(await completeWorkAttempt({
    orgId,
    attemptId: firstClaim.attemptId,
    workerId: "worker-expired",
    fencingToken: firstClaim.fencingToken,
    result: { ok: true, data: { stale: true } },
    usage: { costMicros: 0, toolCalls: 0, providerCalls: 0 },
  }), false);
  assert.equal(await heartbeatWorkAttempt({
    orgId,
    attemptId: secondClaim.attemptId,
    workerId: "worker-recovered",
    fencingToken: secondClaim.fencingToken,
    leaseMs: 30_000,
  }), true);
  assert.equal(await completeWorkAttempt({
    orgId,
    attemptId: secondClaim.attemptId,
    workerId: "worker-recovered",
    fencingToken: secondClaim.fencingToken,
    result: { ok: true, data: { overBudget: true } },
    usage: { costMicros: 101, toolCalls: 1, providerCalls: 1 },
  }), false);
  assert.equal(await completeWorkAttempt({
    orgId,
    attemptId: secondClaim.attemptId,
    workerId: "worker-recovered",
    fencingToken: secondClaim.fencingToken,
    result: { ok: true, data: { ok: true } },
    evidence: [{ source: "probe" }],
    usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
  }), true);
  const [lineageEffectStep] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, effectStep.id));
  assert.deepEqual(lineageEffectStep.evidenceLineage, [
    `attempt:${secondClaim.attemptId}:evidence:0`,
  ]);
  const dependentClaim = await claimWorkAttempt({
    orgId,
    stepId: dependentStep.id,
    workerId: "worker-dependent",
    leaseMs: 30_000,
  });
  assert.ok(dependentClaim);
  assert.equal(await failWorkAttempt({
    orgId,
    attemptId: dependentClaim.attemptId,
    workerId: "worker-dependent",
    fencingToken: dependentClaim.fencingToken,
    outcome: "permanent",
    errorClass: "probe_permanent",
    evidence: [{ source: "probe" }],
  }), true);
  const [compensationStep] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, effectStep.id));
  const [failedDependent] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, dependentStep.id));
  const [compensatingWork] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, recoverable.workItemId));
  assert.equal(compensationStep.status, "compensation_required");
  assert.equal(failedDependent.status, "failed");
  assert.equal(compensatingWork.status, "compensation_required");
  const compensationClaim = await claimWorkAttempt({
    orgId,
    stepId: effectStep.id,
    workerId: "worker-compensation",
    leaseMs: 30_000,
    mode: "compensate",
  });
  assert.ok(compensationClaim);
  let compensationEffect = false;
  assert.equal(await executeClaimedWorkAttempt({
    orgId,
    attemptId: compensationClaim.attemptId,
    workerId: "worker-compensation",
    fencingToken: compensationClaim.fencingToken,
    execute: async ({ capabilityId, mode, input }) => {
      assert.equal(capabilityId, "account.brief");
      assert.equal(mode, "compensate");
      assert.deepEqual(input, { compensate: true });
      compensationEffect = true;
      return {
        result: { ok: true, data: { compensated: true } },
        evidence: [{ source: "compensation-probe" }],
        usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
      };
    },
  }), true);
  assert.equal(compensationEffect, true);
  const [compensatedStep] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, effectStep.id));
  const [compensatedWork] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, recoverable.workItemId));
  assert.equal(compensatedStep.status, "compensated");
  assert.equal(compensatedWork.status, "blocked");

  const cancellationRace = await createDurableWork({
    orgId,
    requesterId,
    goal: "Fence cancellation during effect commit",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Fence cancellation during effect commit",
      steps: [{
        id: "effect",
        capabilityId: "account.brief",
        dependencies: [],
        input: { operation: "commit-race" },
        authorityGrant: {},
        policyDecisionDigest: "8".repeat(64),
        toolsDataPerimeter: { toolIds: ["account_brief"], dataClasses: ["account"] },
        budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
        compensation: {
          capabilityId: "account.brief",
          input: { operation: "undo-commit-race" },
        },
        retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
      }, {
        id: "parallel",
        capabilityId: "account.dossier",
        dependencies: [],
        input: { operation: "parallel-before-effect" },
        authorityGrant: {},
        policyDecisionDigest: "8".repeat(64),
        toolsDataPerimeter: { toolIds: ["account_dossier"], dataClasses: ["account"] },
        budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
        retryPolicy: { maxAttempts: 2, maxWallMs: 10_000 },
      }],
    },
  });
  const cancellationRaceSteps = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, cancellationRace.workItemId));
  const cancellationRaceStep = cancellationRaceSteps.find(
    (step) => step.capabilityId === "account.brief",
  )!;
  const cancellationParallelStep = cancellationRaceSteps.find(
    (step) => step.capabilityId === "account.dossier",
  )!;
  const cancellationRaceClaim = await claimWorkAttempt({
    orgId,
    stepId: cancellationRaceStep.id,
    workerId: "worker-cancel-race",
    leaseMs: 30_000,
  });
  assert.ok(cancellationRaceClaim);
  const cancellationParallelClaim = await claimWorkAttempt({
    orgId,
    stepId: cancellationParallelStep.id,
    workerId: "worker-cancel-parallel",
    leaseMs: 30_000,
  });
  assert.ok(cancellationParallelClaim);
  let enterExecutor!: () => void;
  let releaseExecutor!: () => void;
  const executorEntered = new Promise<void>((resolve) => {
    enterExecutor = resolve;
  });
  const executorRelease = new Promise<void>((resolve) => {
    releaseExecutor = resolve;
  });
  let raceEffectApplied = false;
  const raceExecution = executeClaimedWorkAttempt({
    orgId,
    attemptId: cancellationRaceClaim.attemptId,
    workerId: "worker-cancel-race",
    fencingToken: cancellationRaceClaim.fencingToken,
    execute: async ({ idempotencyKey }) => {
      assert.equal(
        idempotencyKey,
        `workflow-effect:${cancellationRaceClaim.attemptId}:${cancellationRaceClaim.fencingToken}`,
      );
      enterExecutor();
      await executorRelease;
      raceEffectApplied = true;
      return {
        result: { ok: true, data: { committed: true } },
        evidence: [{ source: "commit-race" }],
        usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
      };
    },
  });
  await executorEntered;
  assert.deepEqual(await cancelDurableWork({
    orgId,
    requesterId,
    workItemId: cancellationRace.workItemId,
  }), { status: "cancellation_pending" });
  const [cancelledParallelAttempt] = await db.select().from(atelierWorkAttempts)
    .where(eq(atelierWorkAttempts.id, cancellationParallelClaim.attemptId));
  const [cancelledParallelStep] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, cancellationParallelStep.id));
  assert.equal(cancelledParallelAttempt.status, "cancelled");
  assert.equal(cancelledParallelStep.status, "cancelled");
  releaseExecutor();
  assert.equal(await raceExecution, true);
  assert.equal(raceEffectApplied, true);
  const [cancelRaceWorkAfter] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, cancellationRace.workItemId));
  const [cancelRaceStepAfter] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, cancellationRaceStep.id));
  assert.equal(cancelRaceWorkAfter.status, "compensation_required");
  assert.equal(cancelRaceStepAfter.status, "compensation_required");
  const cancelRaceCompensationClaim = await claimWorkAttempt({
    orgId,
    stepId: cancellationRaceStep.id,
    workerId: "worker-cancel-race-compensation",
    leaseMs: 30_000,
    mode: "compensate",
  });
  assert.ok(cancelRaceCompensationClaim);
  assert.equal(await executeClaimedWorkAttempt({
    orgId,
    attemptId: cancelRaceCompensationClaim.attemptId,
    workerId: "worker-cancel-race-compensation",
    fencingToken: cancelRaceCompensationClaim.fencingToken,
    execute: async ({ mode, input }) => {
      assert.equal(mode, "compensate");
      assert.deepEqual(input, { operation: "undo-commit-race" });
      return {
        result: { ok: true, data: { compensated: true } },
        evidence: [{ source: "cancel-race-compensation" }],
        usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
      };
    },
  }), true);
  const [cancelRaceCompensated] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, cancellationRace.workItemId));
  assert.equal(cancelRaceCompensated.status, "compensated");

  const runNoCompCancellationDecision = async (
    decision: "approve" | "reject",
  ): Promise<void> => {
    const work = await createDurableWork({
      orgId,
      requesterId,
      goal: `Resolve no-comp cancellation ${decision}`,
      authorization: workflowAuthorization,
      plan: {
        workItemId: "new",
        version: 1,
        goal: `Resolve no-comp cancellation ${decision}`,
        steps: [{
          id: "effect",
          capabilityId: "account.brief",
          dependencies: [],
          input: { operation: `no-comp-${decision}` },
          authorityGrant: {},
          policyDecisionDigest: "b".repeat(64),
          toolsDataPerimeter: { toolIds: ["account_brief"], dataClasses: ["account"] },
          budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
          resultSchemaHash: "94c64f190712",
          retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
        }],
      },
    });
    const [step] = await db.select().from(atelierWorkSteps)
      .where(eq(atelierWorkSteps.workItemId, work.workItemId));
    const claim = await claimWorkAttempt({
      orgId,
      stepId: step.id,
      workerId: `worker-no-comp-${decision}`,
      leaseMs: 30_000,
    });
    assert.ok(claim);
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const execution = executeClaimedWorkAttempt({
      orgId,
      attemptId: claim.attemptId,
      workerId: `worker-no-comp-${decision}`,
      fencingToken: claim.fencingToken,
      execute: async () => {
        entered();
        await releasePromise;
        return {
          result: { ok: true, data: { committed: true } },
          evidence: [{ decision }],
          usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
        };
      },
    });
    await enteredPromise;
    assert.deepEqual(await cancelDurableWork({
      orgId,
      requesterId,
      workItemId: work.workItemId,
    }), { status: "cancellation_pending" });
    release();
    assert.equal(await execution, true);
    const [checkpoint] = await db.select().from(atelierWorkCheckpoints)
      .where(and(
        eq(atelierWorkCheckpoints.workItemId, work.workItemId),
        isNull(atelierWorkCheckpoints.decision),
      ));
    assert.ok(checkpoint);
    assert.ok(await decideWorkCheckpoint({
      orgId,
      requesterId,
      workItemId: work.workItemId,
      checkpointId: checkpoint.id,
      decision,
      evidence: { reviewed: true },
      deciderRoles: ["founding_partner"],
    }));
    const [resolved] = await db.select().from(atelierWorkItems)
      .where(eq(atelierWorkItems.id, work.workItemId));
    assert.equal(resolved.status, decision === "approve" ? "succeeded" : "failed");
  };
  await runNoCompCancellationDecision("approve");
  await runNoCompCancellationDecision("reject");

  for (const completionOrder of ["comp-first", "plain-first"] as const) {
    const mixed = await createDurableWork({
      orgId,
      requesterId,
      goal: `Settle mixed committers ${completionOrder}`,
      authorization: workflowAuthorization,
      plan: {
        workItemId: "new",
        version: 1,
        goal: `Settle mixed committers ${completionOrder}`,
        steps: [{
          id: "comp",
          capabilityId: "account.brief",
          dependencies: [],
          input: { operation: "mixed-comp" },
          authorityGrant: {},
          policyDecisionDigest: "d".repeat(64),
          toolsDataPerimeter: { toolIds: ["account_brief"], dataClasses: ["account"] },
          budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
          resultSchemaHash: "94c64f190712",
          compensation: {
            capabilityId: "account.brief",
            input: { operation: "undo-mixed-comp" },
          },
          retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
        }, {
          id: "plain",
          capabilityId: "account.dossier",
          dependencies: [],
          input: { operation: "mixed-plain" },
          authorityGrant: {},
          policyDecisionDigest: "e".repeat(64),
          toolsDataPerimeter: { toolIds: ["account_dossier"], dataClasses: ["account"] },
          budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
          resultSchemaHash: "94c64f190712",
          retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
        }],
      },
    });
    const mixedSteps = await db.select().from(atelierWorkSteps)
      .where(eq(atelierWorkSteps.workItemId, mixed.workItemId));
    const compStep = mixedSteps.find((step) => step.capabilityId === "account.brief")!;
    const plainStep = mixedSteps.find((step) => step.capabilityId === "account.dossier")!;
    const compClaim = await claimWorkAttempt({
      orgId,
      stepId: compStep.id,
      workerId: `worker-mixed-comp-${completionOrder}`,
      leaseMs: 30_000,
    });
    const plainClaim = await claimWorkAttempt({
      orgId,
      stepId: plainStep.id,
      workerId: `worker-mixed-plain-${completionOrder}`,
      leaseMs: 30_000,
    });
    assert.ok(compClaim);
    assert.ok(plainClaim);
    await db.update(atelierWorkAttempts).set({ status: "committing" })
      .where(eq(atelierWorkAttempts.id, compClaim.attemptId));
    await db.update(atelierWorkAttempts).set({ status: "committing" })
      .where(eq(atelierWorkAttempts.id, plainClaim.attemptId));
    assert.deepEqual(await cancelDurableWork({
      orgId,
      requesterId,
      workItemId: mixed.workItemId,
    }), { status: "cancellation_pending" });
    const completions = completionOrder === "comp-first"
      ? [
          { claim: compClaim, workerId: `worker-mixed-comp-${completionOrder}` },
          { claim: plainClaim, workerId: `worker-mixed-plain-${completionOrder}` },
        ]
      : [
          { claim: plainClaim, workerId: `worker-mixed-plain-${completionOrder}` },
          { claim: compClaim, workerId: `worker-mixed-comp-${completionOrder}` },
        ];
    assert.equal(await completeWorkAttempt({
      orgId,
      attemptId: completions[0].claim.attemptId,
      workerId: completions[0].workerId,
      fencingToken: completions[0].claim.fencingToken,
      result: { ok: true, data: { order: completionOrder, index: 0 } },
      usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
    }), true);
    const [settling] = await db.select().from(atelierWorkItems)
      .where(eq(atelierWorkItems.id, mixed.workItemId));
    assert.equal(settling.status, "cancellation_settling");
    assert.equal(await completeWorkAttempt({
      orgId,
      attemptId: completions[1].claim.attemptId,
      workerId: completions[1].workerId,
      fencingToken: completions[1].claim.fencingToken,
      result: { ok: true, data: { order: completionOrder, index: 1 } },
      usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
    }), true);
    const [recoveryRequired] = await db.select().from(atelierWorkItems)
      .where(eq(atelierWorkItems.id, mixed.workItemId));
    assert.equal(recoveryRequired.status, "compensation_required");
    const recoveryClaim = await claimWorkAttempt({
      orgId,
      stepId: compStep.id,
      workerId: `worker-mixed-recovery-${completionOrder}`,
      leaseMs: 30_000,
      mode: "compensate",
    });
    assert.ok(recoveryClaim);
    assert.equal(await executeClaimedWorkAttempt({
      orgId,
      attemptId: recoveryClaim.attemptId,
      workerId: `worker-mixed-recovery-${completionOrder}`,
      fencingToken: recoveryClaim.fencingToken,
      execute: async () => ({
        result: { ok: true, data: { compensated: true } },
        usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
      }),
    }), true);
    const [mixedCheckpoint] = await db.select().from(atelierWorkCheckpoints)
      .where(and(
        eq(atelierWorkCheckpoints.workItemId, mixed.workItemId),
        isNull(atelierWorkCheckpoints.decision),
      ));
    assert.ok(mixedCheckpoint);
    assert.ok(await decideWorkCheckpoint({
      orgId,
      requesterId,
      workItemId: mixed.workItemId,
      checkpointId: mixedCheckpoint.id,
      decision: "approve",
      evidence: { reviewed: true },
      deciderRoles: ["founding_partner"],
    }));
    const [mixedTerminal] = await db.select().from(atelierWorkItems)
      .where(eq(atelierWorkItems.id, mixed.workItemId));
    assert.equal(mixedTerminal.status, "succeeded");
  }

  const dualAccepted = await createDurableWork({
    orgId,
    requesterId,
    goal: "Aggregate both accepted committed effects",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Aggregate both accepted committed effects",
      steps: ["account.brief", "account.dossier"].map((capabilityId, index) => ({
        id: `accepted-${index}`,
        capabilityId,
        dependencies: [],
        input: { index },
        authorityGrant: {},
        policyDecisionDigest: `${index + 1}`.repeat(64),
        toolsDataPerimeter: {
          toolIds: [capabilityId === "account.brief" ? "account_brief" : "account_dossier"],
          dataClasses: ["account"],
        },
        budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
        retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
      })),
    },
  });
  const dualAcceptedSteps = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, dualAccepted.workItemId));
  const dualClaims = [];
  for (const [index, step] of dualAcceptedSteps.entries()) {
    const claim = await claimWorkAttempt({
      orgId,
      stepId: step.id,
      workerId: `worker-dual-${index}`,
      leaseMs: 30_000,
    });
    assert.ok(claim);
    dualClaims.push({ claim, step, index });
    await db.update(atelierWorkAttempts).set({ status: "committing" })
      .where(eq(atelierWorkAttempts.id, claim.attemptId));
  }
  assert.deepEqual(await cancelDurableWork({
    orgId,
    requesterId,
    workItemId: dualAccepted.workItemId,
  }), { status: "cancellation_pending" });
  for (const entry of dualClaims) {
    assert.equal(await completeWorkAttempt({
      orgId,
      attemptId: entry.claim.attemptId,
      workerId: `worker-dual-${entry.index}`,
      fencingToken: entry.claim.fencingToken,
      result: { ok: true, data: { acceptedIndex: entry.index } },
      evidence: [{ acceptedEvidence: entry.index }],
      usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
    }), true);
  }
  const dualCheckpoints = await db.select().from(atelierWorkCheckpoints)
    .where(and(
      eq(atelierWorkCheckpoints.workItemId, dualAccepted.workItemId),
      isNull(atelierWorkCheckpoints.decision),
    ));
  assert.equal(dualCheckpoints.length, 2);
  for (const checkpoint of [...dualCheckpoints].reverse()) {
    assert.ok(await decideWorkCheckpoint({
      orgId,
      requesterId,
      workItemId: dualAccepted.workItemId,
      checkpointId: checkpoint.id,
      decision: "approve",
      evidence: { reviewed: true },
      deciderRoles: ["founding_partner"],
    }));
  }
  const [dualAcceptedTerminal] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, dualAccepted.workItemId));
  const acceptedAggregate = dualAcceptedTerminal.aggregateResult as {
    effects?: unknown[];
  };
  assert.equal(dualAcceptedTerminal.status, "succeeded");
  assert.equal(acceptedAggregate.effects?.length, 2);
  assert.equal(dualAcceptedTerminal.aggregateEvidence.length, 2);

  const partialAmbiguity = await createDurableWork({
    orgId,
    requesterId,
    goal: "Preserve a sibling completion after ambiguity",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Preserve a sibling completion after ambiguity",
      steps: ["account.brief", "account.dossier", "account.brief"].map(
        (capabilityId, index) => ({
        id: `ambiguity-${index}`,
        capabilityId,
        dependencies: [],
        input: { index },
        authorityGrant: {},
        policyDecisionDigest: `${index + 3}`.repeat(64),
        toolsDataPerimeter: {
          toolIds: [capabilityId === "account.brief" ? "account_brief" : "account_dossier"],
          dataClasses: ["account"],
        },
        budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
        ...(index === 2
          ? {
              compensation: {
                capabilityId,
                input: { operation: "undo-preserved-sibling" },
              },
            }
          : {}),
        retryPolicy: { maxAttempts: 1, maxWallMs: 10_000 },
        }),
      ),
    },
  });
  const ambiguitySteps = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, partialAmbiguity.workItemId));
  const ambiguityClaims = [];
  for (const [index, step] of ambiguitySteps.entries()) {
    const claim = await claimWorkAttempt({
      orgId,
      stepId: step.id,
      workerId: `worker-partial-ambiguity-${index}`,
      leaseMs: 30_000,
    });
    assert.ok(claim);
    ambiguityClaims.push({ claim, index });
    await db.update(atelierWorkAttempts).set({ status: "committing" })
      .where(eq(atelierWorkAttempts.id, claim.attemptId));
  }
  for (const entry of ambiguityClaims.slice(0, 2)) {
    await db.update(atelierWorkAttempts)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(atelierWorkAttempts.id, entry.claim.attemptId));
  }
  assert.equal(await reapExpiredWorkLeases(), 2);
  const [ambiguitySettling] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, partialAmbiguity.workItemId));
  assert.equal(ambiguitySettling.status, "recovery_settling");
  assert.equal(await completeWorkAttempt({
    orgId,
    attemptId: ambiguityClaims[2].claim.attemptId,
    workerId: "worker-partial-ambiguity-2",
    fencingToken: ambiguityClaims[2].claim.fencingToken,
    result: { ok: true, data: { preserved: true } },
    evidence: [{ source: "preserved-sibling" }],
    usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
  }), true);
  const [preservedAttempt] = await db.select().from(atelierWorkAttempts)
    .where(eq(atelierWorkAttempts.id, ambiguityClaims[2].claim.attemptId));
  const [ambiguityBlocked] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, partialAmbiguity.workItemId));
  assert.equal(preservedAttempt.status, "succeeded");
  assert.equal(ambiguityBlocked.status, "compensation_required");
  const preservedCompensationClaim = await claimWorkAttempt({
    orgId,
    stepId: ambiguitySteps[2].id,
    workerId: "worker-preserved-compensation",
    leaseMs: 30_000,
    mode: "compensate",
  });
  assert.ok(preservedCompensationClaim);
  assert.equal(await executeClaimedWorkAttempt({
    orgId,
    attemptId: preservedCompensationClaim.attemptId,
    workerId: "worker-preserved-compensation",
    fencingToken: preservedCompensationClaim.fencingToken,
    execute: async ({ mode, input }) => {
      assert.equal(mode, "compensate");
      assert.deepEqual(input, { operation: "undo-preserved-sibling" });
      return {
        result: { ok: true, data: { compensated: true } },
        usage: { costMicros: 100, toolCalls: 1, providerCalls: 1 },
      };
    },
  }), true);
  const [ambiguityAwaitingReview] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, partialAmbiguity.workItemId));
  assert.equal(ambiguityAwaitingReview.status, "blocked");
  const ambiguityCheckpoints = await db.select().from(atelierWorkCheckpoints)
    .where(and(
      eq(atelierWorkCheckpoints.workItemId, partialAmbiguity.workItemId),
      isNull(atelierWorkCheckpoints.decision),
    ));
  assert.equal(ambiguityCheckpoints.length, 2);
  for (const [index, checkpoint] of [...ambiguityCheckpoints].reverse().entries()) {
    assert.ok(await decideWorkCheckpoint({
      orgId,
      requesterId,
      workItemId: partialAmbiguity.workItemId,
      checkpointId: checkpoint.id,
      decision: "approve",
      evidence: { manuallyReconciled: index },
      deciderRoles: ["founding_partner"],
    }));
    const [duringReview] = await db.select().from(atelierWorkItems)
      .where(eq(atelierWorkItems.id, partialAmbiguity.workItemId));
    assert.equal(duringReview.status, index === 0 ? "blocked" : "compensated");
  }
  const [ambiguityTerminal] = await db.select().from(atelierWorkItems)
    .where(eq(atelierWorkItems.id, partialAmbiguity.workItemId));
  const ambiguityTerminalSteps = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, partialAmbiguity.workItemId));
  assert.equal(ambiguityTerminal.status, "compensated");
  assert.equal(
    ambiguityTerminalSteps.filter((step) => step.status === "failed").length,
    2,
  );
  assert.equal(ambiguityTerminal.aggregateEvidence.length, 2);

  const ambiguousExpiry = await createDurableWork({
    orgId,
    requesterId,
    goal: "Escalate uncertain effect expiry",
    authorization: workflowAuthorization,
    plan: {
      workItemId: "new",
      version: 1,
      goal: "Escalate uncertain effect expiry",
      steps: [{
        id: "effect",
        capabilityId: "account.brief",
        dependencies: [],
        input: { operation: "ambiguous-expiry" },
        authorityGrant: {},
        policyDecisionDigest: "9".repeat(64),
        toolsDataPerimeter: { toolIds: ["account_brief"], dataClasses: ["account"] },
        budget: { maxCostMicros: 100, maxToolCalls: 1, maxProviderCalls: 1 },
        resultSchemaHash: "94c64f190712",
        retryPolicy: { maxAttempts: 2, maxWallMs: 10_000 },
      }],
    },
  });
  const [ambiguousStep] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.workItemId, ambiguousExpiry.workItemId));
  const ambiguousClaim = await claimWorkAttempt({
    orgId,
    stepId: ambiguousStep.id,
    workerId: "worker-ambiguous",
    leaseMs: 30_000,
  });
  assert.ok(ambiguousClaim);
  await db.update(atelierWorkAttempts).set({
    status: "committing",
    leaseExpiresAt: new Date(Date.now() - 1_000),
  }).where(eq(atelierWorkAttempts.id, ambiguousClaim.attemptId));
  assert.equal(await reapExpiredWorkLeases(), 1);
  const [ambiguousAttemptAfter] = await db.select().from(atelierWorkAttempts)
    .where(eq(atelierWorkAttempts.id, ambiguousClaim.attemptId));
  const [ambiguousStepAfter] = await db.select().from(atelierWorkSteps)
    .where(eq(atelierWorkSteps.id, ambiguousStep.id));
  assert.equal(ambiguousAttemptAfter.status, "ambiguous");
  assert.equal(ambiguousStepAfter.status, "blocked");
  assert.equal(await claimWorkAttempt({
    orgId,
    stepId: ambiguousStep.id,
    workerId: "worker-ambiguous-replay",
    leaseMs: 30_000,
  }), null);

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
  await db.delete(atelierWorkItems).where(eq(atelierWorkItems.orgId, orgId));
  await db
    .delete(atelierAssistantBudgetReservations)
    .where(eq(atelierAssistantBudgetReservations.orgId, orgId));
  await db
    .delete(atelierAssistantBudgetLedgers)
    .where(eq(atelierAssistantBudgetLedgers.orgId, orgId));
}