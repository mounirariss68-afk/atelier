import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import {
  db,
  atelierWorkAttempts,
  atelierWorkItems,
  atelierWorkPlans,
  atelierWorkSteps,
} from "@workspace/db";
import {
  WorkPlanV1Schema,
  validateAcyclicWorkPlan,
} from "@workspace/assistant-protocol";
import { encryptAssistantValue } from "./action-runtime.js";

export async function createDurableWork(args: {
  orgId: string;
  requesterId: string;
  goal: string;
  catalogVersion: string;
  policyContext: unknown;
  plan: unknown;
}): Promise<{ workItemId: string; planId: string }> {
  const plan = WorkPlanV1Schema.parse(args.plan);
  validateAcyclicWorkPlan(plan);
  if (plan.workItemId !== "new" && plan.workItemId.length > 0) {
    throw new Error("client-work-id-not-allowed");
  }
  const workItemId = `work_${randomUUID()}`;
  const planId = `plan_${randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx.insert(atelierWorkItems).values({
      id: workItemId,
      orgId: args.orgId,
      requesterId: args.requesterId,
      goal: args.goal,
      status: "planned",
      policyContext: args.policyContext,
      catalogVersion: args.catalogVersion,
    });
    await tx.insert(atelierWorkPlans).values({
      id: planId,
      workItemId,
      version: plan.version,
      status: "active",
      createdBy: args.requesterId,
      rationale: plan.goal,
    });
    await tx.insert(atelierWorkSteps).values(
      plan.steps.map((step) => ({
        id: step.id.startsWith("step_") ? step.id : `step_${randomUUID()}`,
        workItemId,
        planId,
        capabilityId: step.capabilityId,
        delegateAgentId: step.delegateAgentId,
        dependencies: step.dependencies,
        inputEncrypted: encryptAssistantValue({}),
        authorityGrant: step.authorityGrant,
        policyDecisionDigest: String(step.authorityGrant.policyDecisionDigest ?? ""),
        catalogVersion: args.catalogVersion,
        inputSchemaVersion: 1,
        retryPolicy: step.retryPolicy,
        resultSchemaHash: String(step.authorityGrant.resultSchemaHash ?? ""),
        status: step.dependencies.length === 0 ? "ready" : "blocked",
      })),
    );
  });
  return { workItemId, planId };
}

export async function claimWorkAttempt(args: {
  stepId: string;
  workerId: string;
  leaseMs: number;
}): Promise<{ attemptId: string; fencingToken: number } | null> {
  return db.transaction(async (tx) => {
    const [step] = await tx
      .select()
      .from(atelierWorkSteps)
      .where(and(eq(atelierWorkSteps.id, args.stepId), eq(atelierWorkSteps.status, "ready")))
      .for("update");
    if (!step) return null;
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(atelierWorkAttempts)
      .where(eq(atelierWorkAttempts.stepId, step.id));
    const attemptNumber = Number(count) + 1;
    const fencingToken = attemptNumber;
    const attemptId = `attempt_${randomUUID()}`;
    await tx.insert(atelierWorkAttempts).values({
      id: attemptId,
      stepId: step.id,
      attemptNumber,
      status: "running",
      leaseOwner: args.workerId,
      leaseExpiresAt: new Date(Date.now() + Math.max(1_000, args.leaseMs)),
      fencingToken,
      startedAt: new Date(),
    });
    await tx.update(atelierWorkSteps).set({ status: "running", updatedAt: new Date() }).where(eq(atelierWorkSteps.id, step.id));
    return { attemptId, fencingToken };
  });
}

export async function reapExpiredWorkLeases(now = new Date()): Promise<number> {
  const expired = await db
    .update(atelierWorkAttempts)
    .set({
      status: "retryable",
      errorClass: "lease_expired",
      endedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(atelierWorkAttempts.status, "running"),
        lt(atelierWorkAttempts.leaseExpiresAt, now),
      ),
    )
    .returning({ stepId: atelierWorkAttempts.stepId });
  for (const row of expired) {
    await db
      .update(atelierWorkSteps)
      .set({ status: "ready", updatedAt: now })
      .where(eq(atelierWorkSteps.id, row.stepId));
  }
  return expired.length;
}