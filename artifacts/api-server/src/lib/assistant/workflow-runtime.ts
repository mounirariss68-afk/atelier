import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  atelierWorkAttempts,
  atelierWorkCheckpoints,
  atelierWorkItems,
  atelierWorkPlans,
  atelierWorkSteps,
} from "@workspace/db";
import {
  WorkPlanV1Schema,
  validateAcyclicWorkPlan,
} from "@workspace/assistant-protocol";
import { encryptAssistantValue } from "./action-runtime.js";
import {
  currentCapabilityManifestVersion,
  reviewedCapabilityManifestEntry,
} from "../atelier-cli/capability-manifest.js";

export async function createDurableWork(args: {
  orgId: string;
  requesterId: string;
  goal: string;
  policyContext: unknown;
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
  const manifestSteps = plan.steps.map((step) => {
    if (!step.capabilityId) throw new Error("workflow-delegated-executor-unsupported");
    const entry = reviewedCapabilityManifestEntry(step.capabilityId);
    if (
      !entry ||
      entry.executionStatus !== "executable" ||
      entry.resultSchemaHash !== step.resultSchemaHash
    ) {
      throw new Error(`workflow-capability-manifest-mismatch:${step.capabilityId}`);
    }
    return { step, entry };
  });
  await db.transaction(async (tx) => {
    await tx.insert(atelierWorkItems).values({
      id: workItemId,
      orgId: args.orgId,
      requesterId: args.requesterId,
      goal: args.goal,
      status: "planned",
      policyContext: args.policyContext,
      catalogVersion,
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
      manifestSteps.map(({ step, entry }) => ({
        id: stepIds.get(step.id)!,
        workItemId,
        planId,
        capabilityId: step.capabilityId,
        delegateAgentId: step.delegateAgentId,
        dependencies: step.dependencies.map((id) => stepIds.get(id)!),
        inputEncrypted: encryptAssistantValue(step.input),
        authorityGrant: step.authorityGrant,
        policyDecisionDigest: step.policyDecisionDigest,
        catalogVersion,
        inputSchemaVersion: entry.inputSchemaVersion,
        retryPolicy: step.retryPolicy,
        resultSchemaHash: step.resultSchemaHash,
        status: step.dependencies.length === 0 ? "ready" : "blocked",
      })),
    );
  });
  return { workItemId, planId };
}

export async function claimWorkAttempt(args: {
  orgId: string;
  stepId: string;
  workerId: string;
  leaseMs: number;
}): Promise<{ attemptId: string; fencingToken: number } | null> {
  const catalogVersion = currentCapabilityManifestVersion();
  return db.transaction(async (tx) => {
    const [stale] = await tx
      .select({ step: atelierWorkSteps, work: atelierWorkItems })
      .from(atelierWorkSteps)
      .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(
        and(
          eq(atelierWorkSteps.id, args.stepId),
          eq(atelierWorkSteps.status, "ready"),
          eq(atelierWorkItems.orgId, args.orgId),
          eq(atelierWorkItems.status, "planned"),
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
      return null;
    }
    const [record] = await tx
      .select({ step: atelierWorkSteps, work: atelierWorkItems })
      .from(atelierWorkSteps)
      .innerJoin(atelierWorkItems, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
      .where(
        and(
          eq(atelierWorkSteps.id, args.stepId),
          eq(atelierWorkSteps.status, "ready"),
          eq(atelierWorkItems.orgId, args.orgId),
          eq(atelierWorkItems.status, "planned"),
          eq(atelierWorkItems.catalogVersion, catalogVersion),
          eq(atelierWorkSteps.catalogVersion, catalogVersion),
          isNull(atelierWorkItems.cancellationRequestedAt),
        ),
      )
      .for("update");
    const step = record?.step;
    if (!step) return null;
    const checkpoints = await tx
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

export async function completeWorkAttempt(args: {
  orgId: string;
  attemptId: string;
  workerId: string;
  fencingToken: number;
  result: unknown;
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
          eq(atelierWorkAttempts.status, "running"),
          eq(atelierWorkAttempts.leaseOwner, args.workerId),
          eq(atelierWorkAttempts.fencingToken, args.fencingToken),
          gt(atelierWorkAttempts.leaseExpiresAt, new Date()),
          eq(atelierWorkItems.orgId, args.orgId),
          eq(atelierWorkItems.status, "planned"),
          isNull(atelierWorkItems.cancellationRequestedAt),
        ),
      )
      .for("update");
    if (!record) return false;
    const [completed] = await tx
      .update(atelierWorkAttempts)
      .set({ status: "succeeded", result: args.result, endedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(atelierWorkAttempts.id, args.attemptId),
          eq(atelierWorkAttempts.status, "running"),
          eq(atelierWorkAttempts.fencingToken, args.fencingToken),
        ),
      )
      .returning({ id: atelierWorkAttempts.id });
    if (!completed) return false;
    await tx
      .update(atelierWorkSteps)
      .set({ status: "succeeded", updatedAt: new Date() })
      .where(and(eq(atelierWorkSteps.id, record.step.id), eq(atelierWorkSteps.status, "running")));
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
        .set({ status: "succeeded", completedAt: new Date(), updatedAt: new Date() })
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

export async function cancelDurableWork(args: {
  orgId: string;
  requesterId: string;
  workItemId: string;
}): Promise<{ status: string } | null> {
  return db.transaction(async (tx) => {
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
}): Promise<typeof atelierWorkCheckpoints.$inferSelect | null> {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ checkpoint: atelierWorkCheckpoints })
      .from(atelierWorkCheckpoints)
      .innerJoin(atelierWorkItems, eq(atelierWorkCheckpoints.workItemId, atelierWorkItems.id))
      .where(
        and(
          eq(atelierWorkCheckpoints.id, args.checkpointId),
          eq(atelierWorkCheckpoints.workItemId, args.workItemId),
          eq(atelierWorkItems.orgId, args.orgId),
          eq(atelierWorkItems.requesterId, args.requesterId),
          isNull(atelierWorkCheckpoints.decision),
          gt(atelierWorkCheckpoints.expiresAt, new Date()),
        ),
      )
      .for("update");
    if (!record) return null;
    const requiredDecider = record.checkpoint.requiredDecider as { requesterId?: unknown };
    if (requiredDecider.requesterId !== args.requesterId) return null;
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
    return updated ?? null;
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