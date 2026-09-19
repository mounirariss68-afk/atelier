import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import {
  db,
  atelierAuditEvents,
  atelierWorkAttempts,
  atelierWorkCheckpoints,
  atelierWorkItems,
  atelierWorkPlans,
  atelierWorkSteps,
} from "@workspace/db";
import {
  WorkPlanV1Schema,
  WorkflowStepResultV1Schema,
  validateAcyclicWorkPlan,
} from "@workspace/assistant-protocol";
import Ajv from "ajv";
import {
  decryptAssistantValueAudited,
  encryptAssistantValue,
} from "./action-runtime.js";
import {
  currentCapabilityManifestVersion,
  reviewedCapabilityManifestEntry,
} from "../atelier-cli/capability-manifest.js";
import { evaluateAssistantPolicy } from "./control-runtime.js";
import {
  commitAssistantBudget,
  refundAssistantBudget,
  reserveRequiredAssistantBudget,
} from "./budget-runtime.js";
import { recordRiserObservationTx } from "./observability-runtime.js";

const checkpointEvidenceValidator = new Ajv({
  allErrors: true,
  strictSchema: true,
  validateSchema: true,
});

type WorkflowTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export interface WorkflowTransactionRunner {
  transaction<T>(fn: (tx: WorkflowTransaction) => Promise<T>): Promise<T>;
}

export async function createDurableWork(args: {
  orgId: string;
  requesterId: string;
  goal: string;
  authorization: {
    capabilityIds: string[];
    toolIds: string[];
    dataClasses: string[];
    policyVersion: string;
    obligations: string[];
    budgetLedgerId: string;
  };
  plan: unknown;
}): Promise<{ workItemId: string; planId: string }> {
  const plan = WorkPlanV1Schema.parse(args.plan);
  const catalogVersion = currentCapabilityManifestVersion();
  validateAcyclicWorkPlan(plan);
  if (plan.workItemId !== "new" && plan.workItemId.length > 0) {
    throw new Error("client-work-id-not-allowed");
  }
  const workItemId = `work_${randomUUID()}`;
  const planId = `plan_${randomUUID()}`;
  const stepIds = new Map(plan.steps.map((step) => [step.id, `step_${randomUUID()}`]));
  const manifestSteps = await Promise.all(plan.steps.map(async (step) => {
    if (!step.capabilityId) throw new Error("workflow-delegated-executor-unsupported");
    const entry = reviewedCapabilityManifestEntry(step.capabilityId);
    if (
      !entry ||
      entry.executionStatus !== "executable" ||
      entry.resultSchemaHash !== step.resultSchemaHash
    ) {
      throw new Error(`workflow-capability-manifest-mismatch:${step.capabilityId}`);
    }
    if (step.compensation && step.compensation.capabilityId !== step.capabilityId) {
      throw new Error(`workflow-cross-capability-compensation-unsupported:${step.capabilityId}`);
    }
    if (!args.authorization.capabilityIds.includes(entry.capabilityId)) {
      throw new Error(`workflow-authority-capability-denied:${entry.capabilityId}`);
    }
    if (
      step.toolsDataPerimeter.toolIds.some(
        (toolId) =>
          toolId !== entry.toolName ||
          !args.authorization.toolIds.includes(toolId),
      ) ||
      step.toolsDataPerimeter.dataClasses.some(
        (dataClass) => !args.authorization.dataClasses.includes(dataClass),
      )
    ) {
      throw new Error(`workflow-authority-perimeter-denied:${entry.capabilityId}`);
    }
    const policy = await evaluateAssistantPolicy({
      orgId: args.orgId,
      capabilityId: entry.capabilityId,
      baseAllowed: true,
      obligations: args.authorization.obligations,
      policyVersion: args.authorization.policyVersion,
      catalogVersion,
    });
    if (policy.effect !== "allow") {
      throw new Error(`workflow-policy-denied:${entry.capabilityId}`);
    }
    return { step, entry, policy };
  }));
  await db.transaction(async (tx) => {
    await tx.insert(atelierWorkItems).values({
      id: workItemId,
      orgId: args.orgId,
      requesterId: args.requesterId,
      goal: "<encrypted>",
      goalEncrypted: encryptAssistantValue(args.goal),
      status: "planned",
      budgetLedgerId: args.authorization.budgetLedgerId,
      policyContext: {
        policyVersion: args.authorization.policyVersion,
        obligations: args.authorization.obligations,
        capabilityIds: args.authorization.capabilityIds,
        toolIds: args.authorization.toolIds,
        dataClasses: args.authorization.dataClasses,
      },
      catalogVersion,
    });
    await tx.insert(atelierWorkPlans).values({
      id: planId,
      workItemId,
      version: plan.version,
      status: "active",
      createdBy: args.requesterId,
      rationale: "<encrypted>",
      rationaleEncrypted: encryptAssistantValue(plan.goal),
    });
    await tx.insert(atelierWorkSteps).values(
      manifestSteps.map(({ step, entry, policy }) => ({
        id: stepIds.get(step.id)!,
        workItemId,
        planId,
        capabilityId: step.capabilityId,
        delegateAgentId: step.delegateAgentId,
        dependencies: step.dependencies.map((id) => stepIds.get(id)!),
        inputEncrypted: encryptAssistantValue(step.input),
        authorityGrant: {
          orgId: args.orgId,
          requesterId: args.requesterId,
          capabilityIds: args.authorization.capabilityIds,
          toolIds: args.authorization.toolIds,
          dataClasses: args.authorization.dataClasses,
        },
        policyDecisionDigest: policy.decisionDigest,
        policyVersion: policy.policyVersion,
        policyObligations: policy.obligations,
        toolsDataPerimeter: step.toolsDataPerimeter,
        budgetGrant: step.budget,
        budgetLedgerId: args.authorization.budgetLedgerId,
        catalogVersion,
        inputSchemaVersion: entry.inputSchemaVersion,
        retryPolicy: step.retryPolicy,
        resultSchemaHash: step.resultSchemaHash,
        compensation: step.compensation
          ? {
              capabilityId: step.compensation.capabilityId,
              inputEncrypted: encryptAssistantValue(step.compensation.input),
            }
          : null,
        checkpointSpec: step.checkpoint ?? null,
        parentStepId: step.parentStepId ? stepIds.get(step.parentStepId) : null,
        status: step.dependencies.length === 0 ? "ready" : "blocked",
      })),
    );
    const checkpoints = manifestSteps.flatMap(({ step }) => {
      if (!step.checkpoint) return [];
      return [{
        id: `checkpoint_${randomUUID()}`,
        workItemId,
        stepId: stepIds.get(step.id)!,
        type: step.checkpoint.type,
        requiredDecider: {
          kind: "requester",
          requesterId: args.requesterId,
          evidenceSchema: step.checkpoint.evidenceSchema,
        },
        expiresAt: new Date(Date.now() + step.checkpoint.expiresInMs),
      }];
    });
    if (checkpoints.length) await tx.insert(atelierWorkCheckpoints).values(checkpoints);
    await recordRiserObservationTx(tx, {
      orgId: args.orgId,
      workItemId,
      stage: "workflow_plan",
      outcome: "created",
      catalogVersion,
      policyVersion: args.authorization.policyVersion,
      dimensions: {
        step_count: plan.steps.length,
        checkpoint_count: checkpoints.length,
      },
    });
  });
  return { workItemId, planId };
}

export async function claimWorkAttempt(args: {
  orgId: string;
  stepId: string;
  workerId: string;
  leaseMs: number;
  mode?: "execute" | "compensate";
  resolveAuthorization: (request: {
    orgId: string;
    requesterId: string;
    capabilityId: string;
  }) => Promise<{
    capabilityIds: string[];
    toolIds: string[];
    dataClasses: string[];
    policyVersion: string;
    obligations: string[];
    budgetLedgerId: string;
  } | null>;
}): Promise<{ attemptId: string; fencingToken: number } | null> {
  const catalogVersion = currentCapabilityManifestVersion();
  const compensation = args.mode === "compensate";
  const requiredStepStatus = compensation ? "compensation_required" : "ready";
  const requiredWorkStatus = compensation ? "compensation_required" : "planned";
  const claimed = await db.transaction(async (tx) => {
    const [stale] = await tx
      .select({ step: atelierWorkSteps, work: atelierWorkItems })
      .from(atelierWorkSteps)
      .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(
        and(
          eq(atelierWorkSteps.id, args.stepId),
          eq(atelierWorkSteps.status, requiredStepStatus),
          eq(atelierWorkItems.orgId, args.orgId),
          eq(atelierWorkItems.status, requiredWorkStatus),
        ),
      )
      .for("update");
    if (
      stale &&
      (stale.work.catalogVersion !== catalogVersion ||
        stale.step.catalogVersion !== catalogVersion)
    ) {
      await tx
        .update(atelierWorkSteps)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(atelierWorkSteps.id, stale.step.id));
      await tx
        .update(atelierWorkItems)
        .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierWorkItems.id, stale.work.id));
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: stale.work.id,
        stepId: stale.step.id,
        capabilityId: stale.step.capabilityId,
        catalogVersion: stale.work.catalogVersion,
        stage: "terminal_outcome",
        outcome: "failed",
        reasonCode: "catalog_mismatch",
        securityEvent: true,
      });
      return null;
    }
    const [record] = await tx
      .select({ step: atelierWorkSteps, work: atelierWorkItems })
      .from(atelierWorkSteps)
      .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(
        and(
          eq(atelierWorkSteps.id, args.stepId),
          eq(atelierWorkSteps.status, requiredStepStatus),
          eq(atelierWorkItems.orgId, args.orgId),
          eq(atelierWorkItems.status, requiredWorkStatus),
          eq(atelierWorkItems.catalogVersion, catalogVersion),
          eq(atelierWorkSteps.catalogVersion, catalogVersion),
          compensation
            ? sql`true`
            : isNull(atelierWorkItems.cancellationRequestedAt),
        ),
      )
      .for("update");
    const step = record?.step;
    if (!step) return null;
    if (!step.capabilityId) return null;
    if (compensation && !step.compensation) return null;
    const currentAuthorization = await args.resolveAuthorization({
      orgId: args.orgId,
      requesterId: record.work.requesterId,
      capabilityId: step.capabilityId,
    });
    const persistedGrant = step.authorityGrant as {
      orgId?: unknown;
      requesterId?: unknown;
      capabilityIds?: unknown;
      toolIds?: unknown;
      dataClasses?: unknown;
    };
    if (
      !currentAuthorization ||
      persistedGrant.orgId !== args.orgId ||
      persistedGrant.requesterId !== record.work.requesterId ||
      !currentAuthorization.capabilityIds.includes(step.capabilityId) ||
      step.toolsDataPerimeter.toolIds.some(
        (toolId) => !currentAuthorization.toolIds.includes(toolId),
      ) ||
      step.toolsDataPerimeter.dataClasses.some(
        (dataClass) => !currentAuthorization.dataClasses.includes(dataClass),
      ) ||
      currentAuthorization.budgetLedgerId !== step.budgetLedgerId ||
      currentAuthorization.policyVersion !== step.policyVersion ||
      JSON.stringify([...currentAuthorization.obligations].sort()) !==
        JSON.stringify([...step.policyObligations].sort())
    ) {
      await tx.update(atelierWorkSteps)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(atelierWorkSteps.id, step.id));
      await tx.update(atelierWorkItems)
        .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierWorkItems.id, record.work.id));
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: step.id,
        capabilityId: step.capabilityId,
        stage: "terminal_outcome",
        outcome: "failed",
        reasonCode: "authority_changed",
        securityEvent: true,
      });
      return null;
    }
    const policy = await evaluateAssistantPolicy({
      orgId: args.orgId,
      capabilityId: step.capabilityId,
      baseAllowed: true,
      obligations: step.policyObligations,
      policyVersion: step.policyVersion,
      catalogVersion,
    }, tx);
    if (
      policy.effect !== "allow" ||
      policy.decisionDigest !== step.policyDecisionDigest
    ) {
      await tx.update(atelierWorkSteps)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(atelierWorkSteps.id, step.id));
      await tx.update(atelierWorkItems)
        .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierWorkItems.id, record.work.id));
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: step.id,
        capabilityId: step.capabilityId,
        stage: "terminal_outcome",
        outcome: "failed",
        reasonCode: "policy_denied",
        securityEvent: true,
      });
      return null;
    }
    const retryPolicy = step.retryPolicy as {
      maxAttempts?: unknown;
      maxWallMs?: unknown;
    };
    if (
      typeof retryPolicy.maxWallMs !== "number" ||
      Date.now() - step.createdAt.getTime() > retryPolicy.maxWallMs
    ) {
      await tx.update(atelierWorkSteps)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(atelierWorkSteps.id, step.id));
      await tx.update(atelierWorkItems)
        .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierWorkItems.id, record.work.id));
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: step.id,
        capabilityId: step.capabilityId,
        stage: "terminal_outcome",
        outcome: "failed",
        reasonCode: "workflow_error",
      });
      return null;
    }
    const checkpoints = compensation ? [] : await tx
      .select({
        id: atelierWorkCheckpoints.id,
        decision: atelierWorkCheckpoints.decision,
        expiresAt: atelierWorkCheckpoints.expiresAt,
      })
      .from(atelierWorkCheckpoints)
      .where(eq(atelierWorkCheckpoints.stepId, step.id));
    if (
      checkpoints.some(
        (checkpoint) =>
          checkpoint.decision !== "approve" || checkpoint.expiresAt.getTime() <= Date.now(),
      )
    ) {
      return null;
    }
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(atelierWorkAttempts)
      .where(eq(atelierWorkAttempts.stepId, step.id));
    const attemptNumber = Number(count) + 1;
    if (
      !compensation &&
      (typeof retryPolicy.maxAttempts !== "number" ||
        attemptNumber > retryPolicy.maxAttempts)
    ) {
      await tx
        .update(atelierWorkSteps)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(atelierWorkSteps.id, step.id));
      await tx.update(atelierWorkItems)
        .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierWorkItems.id, record.work.id));
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: step.id,
        capabilityId: step.capabilityId,
        stage: "terminal_outcome",
        outcome: "failed",
        reasonCode: "workflow_error",
      });
      return null;
    }
    const fencingToken = attemptNumber;
    const attemptId = `attempt_${randomUUID()}`;
    await tx.insert(atelierWorkAttempts).values({
      id: attemptId,
      stepId: step.id,
      attemptNumber,
      status: "running",
      leaseOwner: args.workerId,
      leaseExpiresAt: new Date(Date.now() + Math.max(1_000, args.leaseMs)),
      heartbeatAt: new Date(),
      fencingToken,
      errorClass: compensation ? "compensation_execution" : null,
      startedAt: new Date(),
    });
    await recordRiserObservationTx(tx, {
      orgId: args.orgId,
      workItemId: record.work.id,
      stepId: step.id,
      attemptId,
      capabilityId: step.capabilityId,
      catalogVersion,
      policyVersion: step.policyVersion,
      stage: "lease",
      outcome: "acquired",
      dimensions: {
        fencing_token: fencingToken,
        compensation,
      },
    });
    await recordRiserObservationTx(tx, {
      orgId: args.orgId,
      workItemId: record.work.id,
      stepId: step.id,
      attemptId,
      capabilityId: step.capabilityId,
      catalogVersion,
      policyVersion: step.policyVersion,
      stage: "workflow_attempt",
      outcome: "running",
      dimensions: { attempt_number: attemptNumber },
    });
    await tx.update(atelierWorkSteps).set({ status: "running", updatedAt: new Date() }).where(eq(atelierWorkSteps.id, step.id));
    return {
      attemptId,
      fencingToken,
      stepId: step.id,
      workItemId: record.work.id,
      ledgerId: step.budgetLedgerId,
      budget: step.budgetGrant as {
        maxCostMicros: number;
        maxToolCalls: number;
        maxProviderCalls: number;
        maxWallMs: number;
        maxConcurrentSlots: number;
      },
    };
  });
  if (!claimed) return null;
  if (!claimed.ledgerId) {
    await db.transaction(async (tx) => {
      await tx.update(atelierWorkAttempts).set({
        status: "blocked",
        errorClass: "budget_ledger_missing",
        endedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(atelierWorkAttempts.id, claimed.attemptId),
        or(
          eq(atelierWorkAttempts.status, "running"),
          eq(atelierWorkAttempts.status, "committing"),
        ),
        eq(atelierWorkAttempts.fencingToken, claimed.fencingToken),
      ));
      await tx.update(atelierWorkSteps).set({ status: "blocked", updatedAt: new Date() })
        .where(eq(atelierWorkSteps.id, claimed.stepId));
      await tx.update(atelierWorkItems).set({ status: "blocked", updatedAt: new Date() })
        .where(eq(atelierWorkItems.id, claimed.workItemId));
    });
    return null;
  }
  try {
    const reservation = await reserveRequiredAssistantBudget({
      orgId: args.orgId,
      ledgerId: claimed.ledgerId,
      idempotencyKey: `workflow-attempt:${claimed.attemptId}:${claimed.fencingToken}`,
      amount: {
        costMicros: claimed.budget.maxCostMicros,
        toolCalls: claimed.budget.maxToolCalls,
        providerCalls: claimed.budget.maxProviderCalls,
        wallMs: claimed.budget.maxWallMs,
        concurrentSlots: claimed.budget.maxConcurrentSlots,
      },
    });
    const [attached] = await db.update(atelierWorkAttempts)
      .set({ budgetReservationId: reservation.reservationId, updatedAt: new Date() })
      .where(and(
        eq(atelierWorkAttempts.id, claimed.attemptId),
        or(
          eq(atelierWorkAttempts.status, "running"),
          eq(atelierWorkAttempts.status, "committing"),
        ),
        eq(atelierWorkAttempts.fencingToken, claimed.fencingToken),
        isNull(atelierWorkAttempts.budgetReservationId),
      ))
      .returning({ id: atelierWorkAttempts.id });
    if (!attached) {
      await refundAssistantBudget(args.orgId, reservation.reservationId);
      return null;
    }
    return { attemptId: claimed.attemptId, fencingToken: claimed.fencingToken };
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx.update(atelierWorkAttempts).set({
        status: "blocked",
        errorClass: error instanceof Error ? error.message : "budget_reservation_failed",
        endedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(atelierWorkAttempts.id, claimed.attemptId),
        or(
          eq(atelierWorkAttempts.status, "running"),
          eq(atelierWorkAttempts.status, "committing"),
        ),
        eq(atelierWorkAttempts.fencingToken, claimed.fencingToken),
      ));
      await tx.update(atelierWorkSteps).set({ status: "blocked", updatedAt: new Date() })
        .where(and(
          eq(atelierWorkSteps.id, claimed.stepId),
          eq(atelierWorkSteps.status, "running"),
        ));
      await tx.update(atelierWorkItems).set({ status: "blocked", updatedAt: new Date() })
        .where(eq(atelierWorkItems.id, claimed.workItemId));
    });
    return null;
  }
}

export async function heartbeatWorkAttempt(args: {
  orgId: string;
  attemptId: string;
  workerId: string;
  fencingToken: number;
  leaseMs: number;
}): Promise<boolean> {
  const now = new Date();
  const [updated] = await db
    .update(atelierWorkAttempts)
    .set({
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + Math.max(1_000, args.leaseMs)),
      updatedAt: now,
    })
    .where(
      and(
        eq(atelierWorkAttempts.id, args.attemptId),
        eq(atelierWorkAttempts.status, "running"),
        eq(atelierWorkAttempts.leaseOwner, args.workerId),
        eq(atelierWorkAttempts.fencingToken, args.fencingToken),
        gt(atelierWorkAttempts.leaseExpiresAt, now),
        sql`${atelierWorkAttempts.stepId} in (
          select ${atelierWorkSteps.id} from ${atelierWorkSteps}
          inner join ${atelierWorkItems}
            on ${atelierWorkItems.id} = ${atelierWorkSteps.workItemId}
          where ${atelierWorkItems.orgId} = ${args.orgId}
        )`,
      ),
    )
    .returning({ id: atelierWorkAttempts.id });
  return Boolean(updated);
}

export async function completeWorkAttempt(args: {
  orgId: string;
  attemptId: string;
  workerId: string;
  fencingToken: number;
  result: unknown;
  evidence?: unknown[];
  usage?: {
    costMicros: number;
    toolCalls: number;
    providerCalls: number;
    wallMs?: number;
  };
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ attempt: atelierWorkAttempts, step: atelierWorkSteps, work: atelierWorkItems })
      .from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
      .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(
        and(
          eq(atelierWorkAttempts.id, args.attemptId),
          or(
            eq(atelierWorkAttempts.status, "running"),
            eq(atelierWorkAttempts.status, "committing"),
          ),
          eq(atelierWorkAttempts.leaseOwner, args.workerId),
          eq(atelierWorkAttempts.fencingToken, args.fencingToken),
          gt(atelierWorkAttempts.leaseExpiresAt, new Date()),
          eq(atelierWorkItems.orgId, args.orgId),
          or(
            eq(atelierWorkItems.status, "planned"),
            eq(atelierWorkItems.status, "compensation_required"),
            eq(atelierWorkItems.status, "cancellation_settling"),
            eq(atelierWorkItems.status, "recovery_settling"),
          ),
        ),
      )
      .for("update");
    if (!record) return false;
    if (!record.attempt.budgetReservationId) return false;
    const parsedResult = WorkflowStepResultV1Schema.safeParse(args.result);
    if (!parsedResult.success || !args.usage) return false;
    const usage = args.usage;
    const budget = record.step.budgetGrant as {
      maxCostMicros: number;
      maxToolCalls: number;
      maxProviderCalls: number;
      maxWallMs: number;
      maxConcurrentSlots: number;
    };
    if (
      usage.costMicros > budget.maxCostMicros ||
      usage.toolCalls > budget.maxToolCalls ||
      usage.providerCalls > budget.maxProviderCalls ||
      (usage.wallMs ?? 0) > budget.maxWallMs
    ) return false;
    await commitAssistantBudget(args.orgId, record.attempt.budgetReservationId, {
      costMicros: usage.costMicros,
      toolCalls: usage.toolCalls,
      providerCalls: usage.providerCalls,
      wallMs: usage.wallMs ?? 0,
      concurrentSlots: 0,
    }, tx);
    const [completed] = await tx
      .update(atelierWorkAttempts)
      .set({
        status: "succeeded",
        result: parsedResult.data,
        evidence: args.evidence ?? [],
        costMicros: usage.costMicros,
        toolCalls: usage.toolCalls,
        providerCalls: usage.providerCalls,
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierWorkAttempts.id, args.attemptId),
          or(
            eq(atelierWorkAttempts.status, "running"),
            eq(atelierWorkAttempts.status, "committing"),
          ),
          eq(atelierWorkAttempts.fencingToken, args.fencingToken),
        ),
      )
      .returning({ id: atelierWorkAttempts.id });
    if (!completed) return false;
    await recordRiserObservationTx(tx, {
      orgId: args.orgId,
      workItemId: record.work.id,
      stepId: record.step.id,
      attemptId: record.attempt.id,
      capabilityId: record.step.capabilityId,
      catalogVersion: record.step.catalogVersion,
      policyVersion: record.step.policyVersion,
      stage: "workflow_attempt",
      outcome: "succeeded",
      dimensions: {
        cost_micros: usage.costMicros,
        tool_calls: usage.toolCalls,
        provider_calls: usage.providerCalls,
      },
    });
    if (record.attempt.errorClass === "compensation_execution") {
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: record.step.id,
        attemptId: record.attempt.id,
        capabilityId: record.step.capabilityId,
        stage: "compensation",
        outcome: "succeeded",
        securityEvent: true,
      });
    }
    if (
      record.work.cancellationRequestedAt &&
      record.attempt.errorClass !== "compensation_execution"
    ) {
      const hasCompensation = record.step.compensation !== null;
      await tx.update(atelierWorkSteps).set({
        status: hasCompensation ? "compensation_required" : "succeeded",
        evidenceLineage: (args.evidence ?? []).map(
          (_entry, index) => `attempt:${record.attempt.id}:evidence:${index}`,
        ),
        updatedAt: new Date(),
      }).where(eq(atelierWorkSteps.id, record.step.id));
      if (!hasCompensation) {
        await tx.insert(atelierWorkCheckpoints).values({
          id: `checkpoint_${randomUUID()}`,
          workItemId: record.work.id,
          stepId: record.step.id,
          type: "operator_review",
          requiredDecider: {
            kind: "operator",
            roles: ["founding_partner", "partner"],
            reason: "cancellation_during_commit",
            approveAction: "accept_effect",
            rejectAction: "reject_effect",
          },
          evidence: args.evidence ?? [],
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        });
      }
      const [{ count: committingCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(atelierWorkAttempts)
        .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
        .where(and(
          eq(atelierWorkSteps.workItemId, record.work.id),
          eq(atelierWorkAttempts.status, "committing"),
        ));
      if (Number(committingCount) === 0) {
        const [{ count: compensationCount }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(atelierWorkSteps)
          .where(and(
            eq(atelierWorkSteps.workItemId, record.work.id),
            eq(atelierWorkSteps.status, "compensation_required"),
          ));
        await tx.update(atelierWorkItems).set({
          status: Number(compensationCount) > 0 ? "compensation_required" : "blocked",
          updatedAt: new Date(),
        }).where(eq(atelierWorkItems.id, record.work.id));
      }
      return true;
    }
    if (record.attempt.errorClass === "compensation_execution") {
      await tx.update(atelierWorkSteps)
        .set({ status: "compensated", updatedAt: new Date() })
        .where(and(
          eq(atelierWorkSteps.id, record.step.id),
          eq(atelierWorkSteps.status, "running"),
        ));
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(atelierWorkSteps)
        .where(and(
          eq(atelierWorkSteps.workItemId, record.work.id),
          sql`${atelierWorkSteps.status} in ('compensation_required','ready','running')`,
        ));
      if (Number(count) === 0) {
        const [{ count: openCheckpointCount }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(atelierWorkCheckpoints)
          .where(and(
            eq(atelierWorkCheckpoints.workItemId, record.work.id),
            isNull(atelierWorkCheckpoints.decision),
          ));
        await tx.update(atelierWorkItems).set({
          status: Number(openCheckpointCount) > 0 ? "blocked" : "compensated",
          completedAt: Number(openCheckpointCount) > 0 ? null : new Date(),
          updatedAt: new Date(),
        }).where(eq(atelierWorkItems.id, record.work.id));
      }
      return true;
    }
    await tx
      .update(atelierWorkSteps)
      .set({
        status: "succeeded",
        evidenceLineage: (args.evidence ?? []).map(
          (_entry, index) => `attempt:${record.attempt.id}:evidence:${index}`,
        ),
        updatedAt: new Date(),
      })
      .where(and(eq(atelierWorkSteps.id, record.step.id), eq(atelierWorkSteps.status, "running")));
    if (record.work.status === "recovery_settling") {
      if (record.step.compensation !== null) {
        await tx.update(atelierWorkSteps)
          .set({ status: "compensation_required", updatedAt: new Date() })
          .where(and(
            eq(atelierWorkSteps.id, record.step.id),
            eq(atelierWorkSteps.status, "succeeded"),
          ));
      }
      const [{ count: committingCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(atelierWorkAttempts)
        .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
        .where(and(
          eq(atelierWorkSteps.workItemId, record.work.id),
          eq(atelierWorkAttempts.status, "committing"),
        ));
      if (Number(committingCount) === 0) {
        const [{ count: compensationCount }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(atelierWorkSteps)
          .where(and(
            eq(atelierWorkSteps.workItemId, record.work.id),
            eq(atelierWorkSteps.status, "compensation_required"),
          ));
        await tx.update(atelierWorkItems).set({
          status: Number(compensationCount) > 0 ? "compensation_required" : "blocked",
          updatedAt: new Date(),
        }).where(eq(atelierWorkItems.id, record.work.id));
      }
      return true;
    }
    const allSteps = await tx
      .select()
      .from(atelierWorkSteps)
      .where(eq(atelierWorkSteps.workItemId, record.step.workItemId));
    const succeeded = new Set(
      allSteps
        .filter((step) => step.id === record.step.id || step.status === "succeeded")
        .map((step) => step.id),
    );
    for (const dependent of allSteps) {
      if (
        dependent.status === "blocked" &&
        dependent.dependencies.every((dependencyId) => succeeded.has(dependencyId))
      ) {
        await tx
          .update(atelierWorkSteps)
          .set({ status: "ready", updatedAt: new Date() })
          .where(
            and(
              eq(atelierWorkSteps.id, dependent.id),
              eq(atelierWorkSteps.status, "blocked"),
            ),
          );
      }
    }
    if (allSteps.every((step) => step.id === record.step.id || step.status === "succeeded")) {
      await tx
        .update(atelierWorkItems)
        .set({ status: "awaiting_aggregation", updatedAt: new Date() })
        .where(
          and(
            eq(atelierWorkItems.id, record.work.id),
            eq(atelierWorkItems.status, "planned"),
          ),
        );
    }
    return true;
  });
}

export async function executeClaimedWorkAttempt(args: {
  orgId: string;
  attemptId: string;
  workerId: string;
  fencingToken: number;
  execute: (request: {
    capabilityId: string;
    mode: "execute" | "compensate";
    input: unknown;
    idempotencyKey: string;
  }) => Promise<{
    result: unknown;
    evidence?: unknown[];
    usage: { costMicros: number; toolCalls: number; providerCalls: number };
  }>;
}): Promise<boolean> {
  const record = await db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        attempt: atelierWorkAttempts,
        step: atelierWorkSteps,
        work: atelierWorkItems,
      })
      .from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
      .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(and(
        eq(atelierWorkAttempts.id, args.attemptId),
        or(
          eq(atelierWorkAttempts.status, "running"),
          eq(atelierWorkAttempts.status, "committing"),
        ),
        eq(atelierWorkAttempts.leaseOwner, args.workerId),
        eq(atelierWorkAttempts.fencingToken, args.fencingToken),
        gt(atelierWorkAttempts.leaseExpiresAt, new Date()),
        eq(atelierWorkItems.orgId, args.orgId),
        or(
          isNull(atelierWorkItems.cancellationRequestedAt),
          eq(atelierWorkAttempts.errorClass, "compensation_execution"),
        ),
      ))
      .for("update");
    if (!candidate) return null;
    const [committing] = await tx.update(atelierWorkAttempts)
      .set({ status: "committing", updatedAt: new Date() })
      .where(and(
        eq(atelierWorkAttempts.id, args.attemptId),
        eq(atelierWorkAttempts.status, "running"),
        eq(atelierWorkAttempts.fencingToken, args.fencingToken),
      ))
      .returning({ id: atelierWorkAttempts.id });
    return committing ? candidate : null;
  });
  if (!record?.step.capabilityId) return false;
  const mode = record.attempt.errorClass === "compensation_execution"
    ? "compensate"
    : "execute";
  const compensation = record.step.compensation as {
    capabilityId?: unknown;
    inputEncrypted?: unknown;
  } | null;
  const capabilityId = mode === "compensate"
    ? compensation?.capabilityId
    : record.step.capabilityId;
  const inputEncrypted = mode === "compensate"
    ? compensation?.inputEncrypted
    : record.step.inputEncrypted;
  if (typeof capabilityId !== "string" || typeof inputEncrypted !== "string") return false;
  const output = await args.execute({
    capabilityId,
    mode,
    input: await decryptAssistantValueAudited({
      ciphertext: inputEncrypted,
      orgId: record.work.orgId,
      requesterId: record.work.requesterId,
      actorId: args.workerId,
      resourceType: "work_step",
      resourceId: record.step.id,
      purpose: mode === "compensate" ? "execute_compensation" : "execute_work_step",
    }),
    idempotencyKey: `workflow-effect:${args.attemptId}:${args.fencingToken}`,
  });
  return completeWorkAttempt({
    orgId: args.orgId,
    attemptId: args.attemptId,
    workerId: args.workerId,
    fencingToken: args.fencingToken,
    result: output.result,
    evidence: output.evidence,
    usage: output.usage,
  });
}

export async function aggregateWorkResult(args: {
  orgId: string;
  workItemId: string;
}): Promise<{ result: unknown; evidence: unknown[] } | null> {
  return db.transaction(async (tx) => {
    const [work] = await tx.select().from(atelierWorkItems).where(and(
      eq(atelierWorkItems.id, args.workItemId),
      eq(atelierWorkItems.orgId, args.orgId),
      eq(atelierWorkItems.status, "awaiting_aggregation"),
    )).for("update");
    if (!work) return null;
    const steps = await tx.select().from(atelierWorkSteps)
      .where(eq(atelierWorkSteps.workItemId, work.id));
    if (!steps.length || steps.some((step) => step.status !== "succeeded")) return null;
    const attempts = await tx.select().from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
      .where(and(
        eq(atelierWorkSteps.workItemId, work.id),
        eq(atelierWorkAttempts.status, "succeeded"),
      ));
    const byStep = new Map<string, typeof attempts[number]["atelier_work_attempts"]>();
    for (const row of attempts) {
      const attempt = row.atelier_work_attempts;
      const current = byStep.get(attempt.stepId);
      if (!current || attempt.attemptNumber > current.attemptNumber) {
        byStep.set(attempt.stepId, attempt);
      }
    }
    if (steps.some((step) => !byStep.has(step.id))) return null;
    const result = {
      steps: steps.map((step) => ({
        stepId: step.id,
        capabilityId: step.capabilityId,
        result: byStep.get(step.id)!.result,
      })),
    };
    const evidence = steps.flatMap((step) => byStep.get(step.id)!.evidence);
    await tx.update(atelierWorkItems).set({
      status: "succeeded",
      aggregateResult: result,
      aggregateEvidence: evidence,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(atelierWorkItems.id, work.id),
      eq(atelierWorkItems.status, "awaiting_aggregation"),
    ));
    await recordRiserObservationTx(tx, {
      orgId: args.orgId,
      workItemId: work.id,
      catalogVersion: work.catalogVersion,
      stage: "terminal_outcome",
      outcome: "succeeded",
      dimensions: { step_count: steps.length },
    });
    return { result, evidence };
  });
}

export async function pauseWorkStepForProvider(args: {
  orgId: string;
  requesterId: string;
  stepId: string;
  provider: string;
  expiresInMs: number;
}): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [record] = await tx.select({ step: atelierWorkSteps, work: atelierWorkItems })
      .from(atelierWorkSteps)
      .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(and(
        eq(atelierWorkSteps.id, args.stepId),
        eq(atelierWorkItems.orgId, args.orgId),
        eq(atelierWorkItems.requesterId, args.requesterId),
        eq(atelierWorkSteps.status, "ready"),
      )).for("update");
    if (!record) return null;
    const id = `checkpoint_${randomUUID()}`;
    await tx.insert(atelierWorkCheckpoints).values({
      id,
      workItemId: record.work.id,
      stepId: record.step.id,
      type: "operator_review",
      requiredDecider: {
        kind: "operator",
        roles: ["founding_partner", "partner"],
        provider: args.provider,
        reason: "provider_degraded",
      },
      expiresAt: new Date(Date.now() + Math.max(1_000, args.expiresInMs)),
    });
    await tx.update(atelierWorkSteps).set({ status: "blocked", updatedAt: new Date() })
      .where(eq(atelierWorkSteps.id, record.step.id));
    await tx.update(atelierWorkItems).set({ status: "blocked", updatedAt: new Date() })
      .where(eq(atelierWorkItems.id, record.work.id));
    return id;
  });
}

export async function failWorkAttempt(args: {
  orgId: string;
  attemptId: string;
  workerId: string;
  fencingToken: number;
  outcome: "retryable" | "permanent" | "ambiguous" | "blocked" | "compensation_required";
  errorClass: string;
  evidence?: unknown[];
  leaseState?: "active" | "expired";
}): Promise<boolean> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ attempt: atelierWorkAttempts, step: atelierWorkSteps, work: atelierWorkItems })
      .from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
      .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(and(
        eq(atelierWorkAttempts.id, args.attemptId),
        or(
          eq(atelierWorkAttempts.status, "running"),
          eq(atelierWorkAttempts.status, "committing"),
        ),
        eq(atelierWorkAttempts.leaseOwner, args.workerId),
        eq(atelierWorkAttempts.fencingToken, args.fencingToken),
        eq(atelierWorkItems.orgId, args.orgId),
        args.leaseState === "expired"
          ? lt(atelierWorkAttempts.leaseExpiresAt, now)
          : gt(atelierWorkAttempts.leaseExpiresAt, now),
      ))
      .for("update");
    if (!record) return false;
    if (!record.attempt.budgetReservationId) return false;
    const retryPolicy = record.step.retryPolicy as { maxAttempts: number };
    const canRetry =
      args.outcome === "retryable" &&
      record.work.cancellationRequestedAt === null &&
      record.attempt.attemptNumber < retryPolicy.maxAttempts;
    await commitAssistantBudget(
      args.orgId,
      record.attempt.budgetReservationId,
      undefined,
      tx,
    );
    if (
      record.work.cancellationRequestedAt &&
      record.attempt.status === "running"
    ) {
      await tx.update(atelierWorkAttempts).set({
        status: "cancelled",
        errorClass: "cancelled_before_effect",
        endedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(atelierWorkAttempts.id, args.attemptId),
        eq(atelierWorkAttempts.status, "running"),
        eq(atelierWorkAttempts.fencingToken, args.fencingToken),
      ));
      await tx.update(atelierWorkSteps).set({
        status: "cancelled",
        updatedAt: new Date(),
      }).where(eq(atelierWorkSteps.id, record.step.id));
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: record.step.id,
        attemptId: record.attempt.id,
        capabilityId: record.step.capabilityId,
        stage: "workflow_attempt",
        outcome: "cancelled",
      });
      return true;
    }
    await tx.update(atelierWorkAttempts).set({
      status: canRetry ? "retryable" : args.outcome,
      errorClass: args.errorClass,
      evidence: args.evidence ?? [],
      endedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(atelierWorkAttempts.id, args.attemptId),
      or(
        eq(atelierWorkAttempts.status, "running"),
        eq(atelierWorkAttempts.status, "committing"),
      ),
      eq(atelierWorkAttempts.fencingToken, args.fencingToken),
    ));
    await recordRiserObservationTx(tx, {
      orgId: args.orgId,
      workItemId: record.work.id,
      stepId: record.step.id,
      attemptId: record.attempt.id,
      capabilityId: record.step.capabilityId,
      catalogVersion: record.step.catalogVersion,
      policyVersion: record.step.policyVersion,
      stage: "workflow_attempt",
      outcome: canRetry ? "retryable" : args.outcome,
      reasonCode: "workflow_error",
      securityEvent:
        args.outcome === "ambiguous" ||
        args.outcome === "compensation_required",
      dimensions: { attempt_number: record.attempt.attemptNumber },
    });
    if (args.leaseState === "expired") {
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: record.step.id,
        attemptId: record.attempt.id,
        capabilityId: record.step.capabilityId,
        stage: "lease",
        outcome: "lost",
        reasonCode: "lease_expired",
        securityEvent: true,
      });
    }
    if (canRetry) {
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: record.step.id,
        attemptId: record.attempt.id,
        capabilityId: record.step.capabilityId,
        stage: "retry",
        outcome: "scheduled",
        dimensions: { next_attempt: record.attempt.attemptNumber + 1 },
      });
      await tx.update(atelierWorkSteps).set({ status: "ready", updatedAt: new Date() })
        .where(eq(atelierWorkSteps.id, record.step.id));
      return true;
    }
    const terminalStatus =
      args.outcome === "ambiguous" || args.outcome === "blocked"
        ? "blocked"
        : args.outcome === "compensation_required"
          ? "compensation_required"
          : "failed";
    await tx.update(atelierWorkSteps).set({ status: terminalStatus, updatedAt: new Date() })
      .where(eq(atelierWorkSteps.id, record.step.id));
    const siblings = await tx.select().from(atelierWorkSteps)
      .where(eq(atelierWorkSteps.workItemId, record.work.id));
    const failedIds = new Set([record.step.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of siblings) {
        if (step.status === "blocked" && step.dependencies.some((id) => failedIds.has(id))) {
          failedIds.add(step.id);
          changed = true;
        }
      }
    }
    for (const stepId of failedIds) {
      if (stepId === record.step.id) continue;
      await tx.update(atelierWorkSteps).set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(atelierWorkSteps.id, stepId), eq(atelierWorkSteps.status, "blocked")));
    }
    const needsCompensation = siblings.some(
      (step) => step.status === "succeeded" && step.compensation !== null,
    );
    if (needsCompensation) {
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stepId: record.step.id,
        attemptId: record.attempt.id,
        capabilityId: record.step.capabilityId,
        stage: "compensation",
        outcome: "required",
        securityEvent: true,
      });
      for (const step of siblings) {
        if (step.status === "succeeded" && step.compensation !== null) {
          await tx.update(atelierWorkSteps)
            .set({ status: "compensation_required", updatedAt: new Date() })
            .where(eq(atelierWorkSteps.id, step.id));
        }
      }
    }
    await tx.insert(atelierWorkCheckpoints).values({
      id: `checkpoint_${randomUUID()}`,
      workItemId: record.work.id,
      stepId: record.step.id,
      type: "operator_review",
      requiredDecider: {
        kind: "operator",
        roles: ["founding_partner", "partner"],
        reason: args.outcome,
        errorClass: args.errorClass,
        approveAction: args.outcome === "ambiguous"
          ? "accept_manual_reconciliation"
          : "authorize_retry",
        rejectAction: "close_failed",
      },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    });
    const [{ count: remainingCommitting }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
      .where(and(
        eq(atelierWorkSteps.workItemId, record.work.id),
        eq(atelierWorkAttempts.status, "committing"),
      ));
    const settlingStatus = record.work.cancellationRequestedAt
      ? "cancellation_settling"
      : "recovery_settling";
    const finalWorkStatus = Number(remainingCommitting) > 0
        ? settlingStatus
        : needsCompensation ? "compensation_required" : terminalStatus;
    await tx.update(atelierWorkItems).set({
      status: finalWorkStatus,
      completedAt: Number(remainingCommitting) > 0 || terminalStatus === "blocked"
        ? null
        : new Date(),
      updatedAt: new Date(),
    }).where(eq(atelierWorkItems.id, record.work.id));
    if (finalWorkStatus === "failed") {
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: record.work.id,
        stage: "terminal_outcome",
        outcome: "failed",
      });
    }
    return true;
  });
}

export async function cancelDurableWork(args: {
  orgId: string;
  requesterId: string;
  workItemId: string;
  transactionRunner?: WorkflowTransactionRunner;
}): Promise<{ status: string } | null> {
  return (args.transactionRunner ?? db).transaction(async (tx) => {
    const [work] = await tx
      .select()
      .from(atelierWorkItems)
      .where(
        and(
          eq(atelierWorkItems.id, args.workItemId),
          eq(atelierWorkItems.orgId, args.orgId),
          eq(atelierWorkItems.requesterId, args.requesterId),
        ),
      )
      .for("update");
    if (!work) return null;
    if (["succeeded", "failed", "cancelled"].includes(work.status)) {
      return { status: work.status };
    }
    const committing = await tx
      .select({
        id: atelierWorkAttempts.id,
        stepId: atelierWorkAttempts.stepId,
      })
      .from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
      .where(and(
        eq(atelierWorkSteps.workItemId, work.id),
        eq(atelierWorkAttempts.status, "committing"),
      ))
    if (committing.length > 0) {
      const runningReservations = await tx
        .select({
          id: atelierWorkAttempts.id,
          stepId: atelierWorkAttempts.stepId,
          reservationId: atelierWorkAttempts.budgetReservationId,
        })
        .from(atelierWorkAttempts)
        .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
        .where(and(
          eq(atelierWorkSteps.workItemId, work.id),
          eq(atelierWorkAttempts.status, "running"),
        ));
      for (const row of runningReservations) {
        if (row.reservationId) {
          await commitAssistantBudget(args.orgId, row.reservationId, undefined, tx);
        }
      }
      const now = new Date();
      await tx.update(atelierWorkAttempts).set({
        status: "cancelled",
        errorClass: "cancelled_before_effect",
        endedAt: now,
        updatedAt: now,
      }).where(and(
        eq(atelierWorkAttempts.status, "running"),
        sql`${atelierWorkAttempts.stepId} in (
          select ${atelierWorkSteps.id} from ${atelierWorkSteps}
          where ${atelierWorkSteps.workItemId} = ${work.id}
        )`,
      ));
      for (const row of runningReservations) {
        await recordRiserObservationTx(tx, {
          orgId: args.orgId,
          workItemId: work.id,
          stepId: row.stepId,
          attemptId: row.id,
          stage: "workflow_attempt",
          outcome: "cancelled",
        });
      }
      const committingStepIds = committing.map((row) => row.stepId);
      await tx.update(atelierWorkSteps).set({
        status: "cancelled",
        updatedAt: now,
      }).where(and(
        eq(atelierWorkSteps.workItemId, work.id),
        sql`${atelierWorkSteps.status} in ('blocked','ready','running')`,
        notInArray(atelierWorkSteps.id, committingStepIds),
      ));
      await tx.update(atelierWorkItems)
        .set({
          status: "cancellation_settling",
          cancellationRequestedAt: now,
          updatedAt: now,
        })
        .where(eq(atelierWorkItems.id, work.id));
      return { status: "cancellation_pending" };
    }
    const runningReservations = await tx
      .select({
        id: atelierWorkAttempts.id,
        stepId: atelierWorkAttempts.stepId,
        reservationId: atelierWorkAttempts.budgetReservationId,
      })
      .from(atelierWorkAttempts)
      .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
      .where(and(
        eq(atelierWorkSteps.workItemId, work.id),
        eq(atelierWorkAttempts.status, "running"),
      ));
    for (const row of runningReservations) {
      if (row.reservationId) {
        await commitAssistantBudget(args.orgId, row.reservationId, undefined, tx);
      }
    }
    const now = new Date();
    await tx
      .update(atelierWorkAttempts)
      .set({ status: "cancelled", endedAt: now, updatedAt: now })
      .where(
        and(
          eq(atelierWorkAttempts.status, "running"),
          sql`${atelierWorkAttempts.stepId} in (
            select ${atelierWorkSteps.id} from ${atelierWorkSteps}
            where ${atelierWorkSteps.workItemId} = ${work.id}
          )`,
        ),
      );
    for (const row of runningReservations) {
      await recordRiserObservationTx(tx, {
        orgId: args.orgId,
        workItemId: work.id,
        stepId: row.stepId,
        attemptId: row.id,
        stage: "workflow_attempt",
        outcome: "cancelled",
      });
    }
    await tx
      .update(atelierWorkSteps)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(atelierWorkSteps.workItemId, work.id),
          sql`${atelierWorkSteps.status} <> 'succeeded'`,
        ),
      );
    await tx
      .update(atelierWorkItems)
      .set({
        status: "cancelled",
        cancellationRequestedAt: now,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(atelierWorkItems.id, work.id));
    await recordRiserObservationTx(tx, {
      orgId: args.orgId,
      workItemId: work.id,
      catalogVersion: work.catalogVersion,
      stage: "terminal_outcome",
      outcome: "cancelled",
    });
    return { status: "cancelled" };
  });
}

export async function decideWorkCheckpoint(args: {
  orgId: string;
  requesterId: string;
  workItemId: string;
  checkpointId: string;
  decision: "approve" | "reject";
  evidence: unknown;
  deciderRoles?: string[];
  transactionRunner?: WorkflowTransactionRunner;
}): Promise<typeof atelierWorkCheckpoints.$inferSelect | null> {
  return (args.transactionRunner ?? db).transaction(async (tx) => {
    const [record] = await tx
      .select({ checkpoint: atelierWorkCheckpoints })
      .from(atelierWorkCheckpoints)
      .innerJoin(atelierWorkItems, eq(atelierWorkCheckpoints.workItemId, atelierWorkItems.id))
      .where(
        and(
          eq(atelierWorkCheckpoints.id, args.checkpointId),
          eq(atelierWorkCheckpoints.workItemId, args.workItemId),
          eq(atelierWorkItems.orgId, args.orgId),
          isNull(atelierWorkCheckpoints.decision),
          gt(atelierWorkCheckpoints.expiresAt, new Date()),
        ),
      )
      .for("update");
    if (!record) return null;
    const requiredDecider = record.checkpoint.requiredDecider as {
      kind?: unknown;
      requesterId?: unknown;
      roles?: unknown;
      reason?: unknown;
    };
    if (requiredDecider.kind === "operator") {
      const requiredRoles = Array.isArray(requiredDecider.roles)
        ? requiredDecider.roles.filter((role): role is string => typeof role === "string")
        : [];
      if (!(args.deciderRoles ?? []).some((role) => requiredRoles.includes(role))) return null;
    } else if (requiredDecider.requesterId !== args.requesterId) {
      return null;
    }
    const evidenceSchema = (requiredDecider as { evidenceSchema?: unknown }).evidenceSchema;
    if (evidenceSchema !== undefined) {
      if (
        !evidenceSchema ||
        typeof evidenceSchema !== "object" ||
        !checkpointEvidenceValidator.validateSchema(evidenceSchema) ||
        !checkpointEvidenceValidator.compile(evidenceSchema)(args.evidence)
      ) return null;
    }
    const [updated] = await tx
      .update(atelierWorkCheckpoints)
      .set({
        decision: args.decision,
        evidence: args.evidence,
        decidedByUserId: args.requesterId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierWorkCheckpoints.id, args.checkpointId),
          isNull(atelierWorkCheckpoints.decision),
        ),
      )
      .returning();
    if (updated?.stepId) {
      if (requiredDecider.reason === "ambiguous") {
        await tx.update(atelierWorkSteps)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(atelierWorkSteps.id, updated.stepId));
        const [{ count: remainingAmbiguities }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(atelierWorkCheckpoints)
          .where(and(
            eq(atelierWorkCheckpoints.workItemId, args.workItemId),
            isNull(atelierWorkCheckpoints.decision),
            sql`${atelierWorkCheckpoints.requiredDecider}->>'reason' = 'ambiguous'`,
          ));
        if (Number(remainingAmbiguities) > 0) return updated;
        const ambiguityDecisions = await tx.select({
          id: atelierWorkCheckpoints.id,
          stepId: atelierWorkCheckpoints.stepId,
          decision: atelierWorkCheckpoints.decision,
          evidence: atelierWorkCheckpoints.evidence,
        }).from(atelierWorkCheckpoints).where(and(
          eq(atelierWorkCheckpoints.workItemId, args.workItemId),
          sql`${atelierWorkCheckpoints.requiredDecider}->>'reason' = 'ambiguous'`,
        )).orderBy(atelierWorkCheckpoints.id);
        for (const checkpoint of ambiguityDecisions) {
          if (!checkpoint.stepId) continue;
          await tx.update(atelierWorkSteps)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(atelierWorkSteps.id, checkpoint.stepId));
        }
        const [{ count: compensatedCount }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(atelierWorkSteps)
          .where(and(
            eq(atelierWorkSteps.workItemId, args.workItemId),
            eq(atelierWorkSteps.status, "compensated"),
          ));
        const allApproved = ambiguityDecisions.every(
          (checkpoint) => checkpoint.decision === "approve",
        );
        const acceptedRecovery = allApproved && Number(compensatedCount) > 0;
        await tx.update(atelierWorkItems).set({
          status: acceptedRecovery ? "compensated" : "failed",
          aggregateResult: {
            reviewedAmbiguity: true,
            decisions: ambiguityDecisions.map((checkpoint) => ({
              checkpointId: checkpoint.id,
              stepId: checkpoint.stepId,
              decision: checkpoint.decision,
            })),
            recovery: acceptedRecovery ? "compensated" : "failed",
          },
          aggregateEvidence: ambiguityDecisions.map((checkpoint) => ({
            stepId: checkpoint.stepId,
            checkpointId: checkpoint.id,
            decision: checkpoint.decision,
            evidence: checkpoint.evidence,
          })),
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(atelierWorkItems.id, args.workItemId),
          eq(atelierWorkItems.status, "blocked"),
        ));
        await recordRiserObservationTx(tx, {
          orgId: args.orgId,
          workItemId: args.workItemId,
          stage: "terminal_outcome",
          outcome: acceptedRecovery ? "compensated" : "failed",
          securityEvent: true,
        });
        return updated;
      }
      if (requiredDecider.reason === "cancellation_during_commit") {
        if (args.decision === "approve") {
          const [acceptedAttempt] = await tx.select({
            result: atelierWorkAttempts.result,
            evidence: atelierWorkAttempts.evidence,
          }).from(atelierWorkAttempts).where(and(
            eq(atelierWorkAttempts.stepId, updated.stepId),
            eq(atelierWorkAttempts.status, "succeeded"),
          )).orderBy(sql`${atelierWorkAttempts.attemptNumber} desc`).limit(1);
          if (!acceptedAttempt) return null;
          const [{ count: remainingDecisions }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(atelierWorkCheckpoints)
            .where(and(
              eq(atelierWorkCheckpoints.workItemId, args.workItemId),
              isNull(atelierWorkCheckpoints.decision),
              sql`${atelierWorkCheckpoints.requiredDecider}->>'reason' = 'cancellation_during_commit'`,
            ));
          if (Number(remainingDecisions) > 0) return updated;
          const acceptedCheckpoints = await tx
            .select({ stepId: atelierWorkCheckpoints.stepId })
            .from(atelierWorkCheckpoints)
            .where(and(
              eq(atelierWorkCheckpoints.workItemId, args.workItemId),
              eq(atelierWorkCheckpoints.decision, "approve"),
              sql`${atelierWorkCheckpoints.requiredDecider}->>'reason' = 'cancellation_during_commit'`,
            ))
            .orderBy(atelierWorkCheckpoints.stepId);
          const acceptedEffects: Array<{
            stepId: string;
            attemptId: string;
            result: unknown;
          }> = [];
          const acceptedEvidence: Array<{
            stepId: string;
            attemptId: string;
            evidence: unknown;
          }> = [];
          for (const checkpoint of acceptedCheckpoints) {
            if (!checkpoint.stepId) continue;
            const [attempt] = await tx.select({
              id: atelierWorkAttempts.id,
              result: atelierWorkAttempts.result,
              evidence: atelierWorkAttempts.evidence,
            }).from(atelierWorkAttempts).where(and(
              eq(atelierWorkAttempts.stepId, checkpoint.stepId),
              eq(atelierWorkAttempts.status, "succeeded"),
              isNull(atelierWorkAttempts.errorClass),
            )).orderBy(sql`${atelierWorkAttempts.attemptNumber} desc`).limit(1);
            if (!attempt) continue;
            acceptedEffects.push({
              stepId: checkpoint.stepId,
              attemptId: attempt.id,
              result: attempt.result,
            });
            for (const evidence of attempt.evidence) {
              acceptedEvidence.push({
                stepId: checkpoint.stepId,
                attemptId: attempt.id,
                evidence,
              });
            }
          }
          await tx.update(atelierWorkItems).set({
            status: "succeeded",
            aggregateResult: {
              acceptedAfterCancellation: true,
              effects: acceptedEffects,
            },
            aggregateEvidence: acceptedEvidence,
            completedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(
            eq(atelierWorkItems.id, args.workItemId),
            eq(atelierWorkItems.status, "blocked"),
          ));
          await recordRiserObservationTx(tx, {
            orgId: args.orgId,
            workItemId: args.workItemId,
            stage: "terminal_outcome",
            outcome: "succeeded",
            securityEvent: true,
          });
        } else {
          await tx.update(atelierWorkItems).set({
            status: "failed",
            completedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(
            eq(atelierWorkItems.id, args.workItemId),
            eq(atelierWorkItems.status, "blocked"),
          ));
          await recordRiserObservationTx(tx, {
            orgId: args.orgId,
            workItemId: args.workItemId,
            stage: "terminal_outcome",
            outcome: "failed",
            securityEvent: true,
          });
        }
        return updated;
      }
      if (args.decision === "approve") {
        await tx.update(atelierWorkSteps)
          .set({ status: "ready", updatedAt: new Date() })
          .where(and(
            eq(atelierWorkSteps.id, updated.stepId),
            eq(atelierWorkSteps.status, "blocked"),
          ));
        await tx.update(atelierWorkItems)
          .set({ status: "planned", updatedAt: new Date() })
          .where(and(
            eq(atelierWorkItems.id, args.workItemId),
            eq(atelierWorkItems.status, "blocked"),
          ));
      } else {
        await tx.update(atelierWorkSteps)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(atelierWorkSteps.id, updated.stepId));
        await tx.update(atelierWorkItems)
          .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(atelierWorkItems.id, args.workItemId));
        await recordRiserObservationTx(tx, {
          orgId: args.orgId,
          workItemId: args.workItemId,
          stage: "terminal_outcome",
          outcome: "failed",
          securityEvent: true,
        });
      }
    }
    if (updated && requiredDecider.kind === "operator") {
      await tx.insert(atelierAuditEvents).values({
        id: `aud_${randomUUID()}`,
        orgId: args.orgId,
        entityType: "assistant_work",
        entityId: args.workItemId,
        actorType: "human",
        actorId: args.requesterId,
        actorLabel: args.requesterId,
        action: "assistant.recovery.decided",
        payload: {
          checkpointId: updated.id,
          decision: args.decision,
          reason:
            args.evidence &&
            typeof args.evidence === "object" &&
            typeof (args.evidence as { reason?: unknown }).reason === "string"
              ? (args.evidence as { reason: string }).reason
              : null,
        },
        payloadSummary: `Assistant recovery ${args.decision}: ${updated.id}`,
      });
    }
    return updated ?? null;
  });
}

export async function reapExpiredWorkLeases(now = new Date()): Promise<number> {
  const privilege = await db.execute<{ allowed: boolean }>(sql`
    select (rolbypassrls or rolsuper) as allowed
    from pg_roles
    where rolname = current_user
  `);
  if (!privilege.rows[0]?.allowed) {
    throw new Error("workflow-reaper-requires-bypassrls");
  }
  const expired = await db.select({
    attempt: atelierWorkAttempts,
    step: atelierWorkSteps,
    work: atelierWorkItems,
  }).from(atelierWorkAttempts)
    .innerJoin(atelierWorkSteps, eq(atelierWorkAttempts.stepId, atelierWorkSteps.id))
    .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(and(
        or(
          eq(atelierWorkAttempts.status, "running"),
          eq(atelierWorkAttempts.status, "committing"),
        ),
        lt(atelierWorkAttempts.leaseExpiresAt, now),
      ));
  let reaped = 0;
  for (const row of expired) {
    if (await failWorkAttempt({
      orgId: row.work.orgId,
      attemptId: row.attempt.id,
      workerId: row.attempt.leaseOwner!,
      fencingToken: row.attempt.fencingToken,
      outcome: row.attempt.status === "committing" ? "ambiguous" : "retryable",
      errorClass: row.attempt.status === "committing"
        ? "lease_expired_effect_ambiguous"
        : "lease_expired",
      leaseState: "expired",
    })) reaped += 1;
  }
  return reaped;
}