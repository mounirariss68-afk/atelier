import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, max, or, sql } from "drizzle-orm";
import {
  db,
  atelierAssistantActions,
  atelierAssistantControls,
  atelierAuditEvents,
  atelierWorkAttempts,
  atelierWorkCheckpoints,
  atelierWorkItems,
  atelierWorkSteps,
} from "@workspace/db";
import {
  AssistantControlRequestV1Schema,
  PolicyDecisionV1Schema,
  type AssistantControlRequestV1,
  type PolicyDecisionV1,
} from "@workspace/assistant-protocol";
import { appendAssistantEventTx } from "./event-runtime.js";
import { recordRiserObservationTx } from "./observability-runtime.js";
import { refundAssistantBudget } from "./budget-runtime.js";

type ControlRow = typeof atelierAssistantControls.$inferSelect;
type ControlExecutor = Pick<typeof db, "select">;

export interface AssistantControlContext {
  orgId: string;
  capabilityId?: string | null;
  provider?: string | null;
  model?: string | null;
  catalogVersion?: string | null;
  policyVersion?: string | null;
}

export interface AssistantControlDecision {
  blocked: boolean;
  control: ControlRow | null;
  activeControlVersions: Array<{ id: string; version: number; mode: string }>;
  digest: string;
}

const SCOPE_PRIORITY: Record<string, number> = {
  capability: 6,
  model: 5,
  provider: 4,
  catalog_version: 3,
  policy_version: 2,
  org: 1,
};

function controlMatches(
  control: ControlRow,
  context: AssistantControlContext,
): boolean {
  const key = control.scopeKey;
  if (control.scope === "org") return key === "*" || key === context.orgId;
  if (control.scope === "capability") {
    return key === "*" || key === context.capabilityId;
  }
  if (control.scope === "provider") {
    return key === "*" || key === context.provider;
  }
  if (control.scope === "model") return key === "*" || key === context.model;
  if (control.scope === "catalog_version") {
    return key === "*" || key === context.catalogVersion;
  }
  if (control.scope === "policy_version") {
    return key === "*" || key === context.policyVersion;
  }
  return false;
}

export async function resolveAssistantControl(
  context: AssistantControlContext,
  executor: ControlExecutor = db,
): Promise<AssistantControlDecision> {
  const controls = await executor
    .select()
    .from(atelierAssistantControls)
    .where(
      and(
        eq(atelierAssistantControls.enabled, true),
        or(
          isNull(atelierAssistantControls.orgId),
          eq(atelierAssistantControls.orgId, context.orgId),
        ),
        or(
          isNull(atelierAssistantControls.expiresAt),
          gt(atelierAssistantControls.expiresAt, new Date()),
        ),
      ),
    );
  const matching = controls
    .filter((control) => controlMatches(control, context))
    .filter(
      (control) => control.mode === "deny" || control.mode === "quarantine",
    )
    .sort(
      (a, b) =>
        b.version - a.version ||
        Number(b.orgId !== null) - Number(a.orgId !== null) ||
        (SCOPE_PRIORITY[b.scope] ?? 0) - (SCOPE_PRIORITY[a.scope] ?? 0) ||
        b.id.localeCompare(a.id),
    );
  const activeControlVersions = matching.map((control) => ({
    id: control.id,
    version: control.version,
    mode: control.mode,
  }));
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        context,
        activeControlVersions,
      }),
    )
    .digest("hex");
  return {
    blocked: matching.length > 0,
    control: matching[0] ?? null,
    activeControlVersions,
    digest,
  };
}

export async function evaluateAssistantPolicy(
  args: {
    orgId: string;
    capabilityId: string;
    baseAllowed: boolean;
    obligations: string[];
    policyVersion: string;
    provider?: string | null;
    model?: string | null;
    catalogVersion?: string | null;
  },
  executor: ControlExecutor = db,
): Promise<PolicyDecisionV1> {
  let decision: AssistantControlDecision;
  try {
    decision = await resolveAssistantControl(
      {
        orgId: args.orgId,
        capabilityId: args.capabilityId,
        provider: args.provider,
        model: args.model,
        catalogVersion: args.catalogVersion,
        policyVersion: args.policyVersion,
      },
      executor,
    );
  } catch {
    decision = {
      blocked: true,
      control: null,
      activeControlVersions: [
        {
          id: "operator-control-runtime-unavailable",
          version: 1,
          mode: "deny",
        },
      ],
      digest: createHash("sha256")
        .update(`operator-control-unavailable:${args.orgId}`)
        .digest("hex"),
    };
  }
  const material =
    decision.activeControlVersions.length === 0
      ? JSON.stringify({
          orgId: args.orgId,
          capabilityId: args.capabilityId,
          baseAllowed: args.baseAllowed,
          obligations: [...args.obligations].sort(),
          policyVersion: args.policyVersion,
          control: null,
        })
      : JSON.stringify({
          contract: "assistant-control-decision/v1",
          orgId: args.orgId,
          capabilityId: args.capabilityId,
          provider: args.provider ?? null,
          model: args.model ?? null,
          catalogVersion: args.catalogVersion ?? null,
          policyVersion: args.policyVersion,
          baseAllowed: args.baseAllowed,
          obligations: [...args.obligations].sort(),
          effect: "deny",
          activeControlVersions: decision.activeControlVersions,
        });
  const decisionDigest = createHash("sha256").update(material).digest("hex");
  if (!args.baseAllowed || decision.blocked) {
    return PolicyDecisionV1Schema.parse({
      effect: "deny",
      policyVersion: args.policyVersion,
      code: decision.blocked ? "operator_control" : "policy_denied",
      safeReason: decision.blocked
        ? "This capability is temporarily unavailable."
        : "This request is not authorized.",
      decisionDigest,
    });
  }
  return PolicyDecisionV1Schema.parse({
    effect: "allow",
    policyVersion: args.policyVersion,
    obligations: args.obligations,
    decisionDigest,
  });
}

export async function assertAssistantProviderControl(args: {
  orgId: string;
  capabilityId?: string | null;
  provider: string;
  model?: string | null;
  catalogVersion?: string | null;
  policyVersion?: string | null;
}): Promise<void> {
  let decision: AssistantControlDecision;
  try {
    decision = await resolveAssistantControl(args);
  } catch {
    throw new Error("assistant-operator-control-unavailable");
  }
  if (decision.blocked) {
    throw new Error(
      decision.control?.mode === "quarantine"
        ? "assistant-provider-quarantined"
        : "assistant-provider-disabled",
    );
  }
}

export async function createAssistantControl(args: {
  orgId: string;
  actorId: string;
  actorLabel: string;
  request: unknown;
}): Promise<ControlRow> {
  const request = AssistantControlRequestV1Schema.parse(
    args.request,
  ) as AssistantControlRequestV1;
  const control = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${args.orgId}:${request.scope}:${request.scopeKey}`}))`,
    );
    const [current] = await tx
      .select({ version: max(atelierAssistantControls.version) })
      .from(atelierAssistantControls)
      .where(
        and(
          eq(atelierAssistantControls.orgId, args.orgId),
          eq(atelierAssistantControls.scope, request.scope),
          eq(atelierAssistantControls.scopeKey, request.scopeKey),
        ),
      );
    await tx
      .update(atelierAssistantControls)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(atelierAssistantControls.orgId, args.orgId),
          eq(atelierAssistantControls.scope, request.scope),
          eq(atelierAssistantControls.scopeKey, request.scopeKey),
          eq(atelierAssistantControls.enabled, true),
        ),
      );
    const [created] = await tx
      .insert(atelierAssistantControls)
      .values({
        id: `control_${randomUUID()}`,
        orgId: args.orgId,
        scope: request.scope,
        scopeKey: request.scopeKey,
        mode: request.mode,
        inflightBehavior: request.inflightBehavior,
        reason: request.reason,
        version: Number(current?.version ?? 0) + 1,
        reconciliationStatus: "pending",
        createdByUserId: args.actorId,
        expiresAt: request.expiresAt ? new Date(request.expiresAt) : null,
      })
      .returning();
    await tx.insert(atelierAuditEvents).values({
      id: `aud_${randomUUID()}`,
      orgId: args.orgId,
      entityType: "assistant_control",
      entityId: created.id,
      actorType: "human",
      actorId: args.actorId,
      actorLabel: args.actorLabel,
      action: "assistant.control.created",
      payload: {
        scope: created.scope,
        scopeKey: created.scopeKey,
        mode: created.mode,
        inflightBehavior: created.inflightBehavior,
        version: created.version,
        reason: created.reason,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
      payloadSummary: `Assistant control ${created.scope}:${created.scopeKey} v${created.version}`,
    });
    return created;
  });
  try {
    await reconcileAssistantControl({
      control,
      actorId: args.actorId,
      actorLabel: args.actorLabel,
    });
  } catch (error) {
    await db
      .update(atelierAssistantControls)
      .set({
        reconciliationStatus: "failed",
        reconciliationError:
          error instanceof Error ? error.name.slice(0, 120) : "unknown",
        updatedAt: new Date(),
      })
      .where(eq(atelierAssistantControls.id, control.id));
  }
  const [current] = await db
    .select()
    .from(atelierAssistantControls)
    .where(eq(atelierAssistantControls.id, control.id));
  return current ?? control;
}

export async function disableAssistantControl(args: {
  orgId: string;
  controlId: string;
  actorId: string;
  actorLabel: string;
  reason: string;
}): Promise<ControlRow | null> {
  if (args.reason.trim().length < 10 || args.reason.length > 500) {
    throw new Error("assistant-control-disable-reason-invalid");
  }
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(atelierAssistantControls)
      .where(
        and(
          eq(atelierAssistantControls.id, args.controlId),
          eq(atelierAssistantControls.orgId, args.orgId),
        ),
      )
      .for("update");
    if (!existing) return null;
    const [updated] = await tx
      .update(atelierAssistantControls)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(atelierAssistantControls.id, existing.id))
      .returning();
    await tx.insert(atelierAuditEvents).values({
      id: `aud_${randomUUID()}`,
      orgId: args.orgId,
      entityType: "assistant_control",
      entityId: existing.id,
      actorType: "human",
      actorId: args.actorId,
      actorLabel: args.actorLabel,
      action: "assistant.control.disabled",
      payload: {
        version: existing.version,
        reason: args.reason.trim(),
      },
      payloadSummary: `Assistant control disabled: ${existing.scope}:${existing.scopeKey}`,
    });
    return updated;
  });
}

function controlAppliesToCapability(
  control: ControlRow,
  capabilityId: string | null,
  catalogVersion: string | null,
  policyVersion: string | null,
): boolean {
  if (control.scope === "org") {
    return control.scopeKey === "*" || control.scopeKey === control.orgId;
  }
  if (control.scope === "capability") {
    return control.scopeKey === "*" || control.scopeKey === capabilityId;
  }
  if (control.scope === "catalog_version") {
    return control.scopeKey === "*" || control.scopeKey === catalogVersion;
  }
  if (control.scope === "policy_version") {
    return control.scopeKey === "*" || control.scopeKey === policyVersion;
  }
  return false;
}

export async function reconcileAssistantControl(args: {
  control: ControlRow;
  actorId: string;
  actorLabel: string;
}): Promise<{
  actionsInvalidated: number;
  workPaused: number;
  workCancelled: number;
  workCompensating: number;
  executingPreserved: number;
}> {
  const summary = {
    actionsInvalidated: 0,
    workPaused: 0,
    workCancelled: 0,
    workCompensating: 0,
    executingPreserved: 0,
  };
  const control = args.control;
  if (!control.enabled || !control.orgId) return summary;
  const [claimed] = await db
    .update(atelierAssistantControls)
    .set({
      reconciliationStatus: "running",
      reconciliationError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(atelierAssistantControls.id, control.id),
        eq(atelierAssistantControls.orgId, control.orgId),
        inArray(atelierAssistantControls.reconciliationStatus, [
          "pending",
          "failed",
          "running",
        ]),
      ),
    )
    .returning();
  if (!claimed) return summary;
  if (control.scope === "provider" || control.scope === "model") {
    await db
      .update(atelierAssistantControls)
      .set({
        reconciliationStatus: "complete",
        reconciledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(atelierAssistantControls.id, control.id));
    return summary;
  }

  const actions = await db
    .select()
    .from(atelierAssistantActions)
    .where(
      and(
        eq(atelierAssistantActions.orgId, control.orgId),
        inArray(atelierAssistantActions.state, [
          "awaiting_confirmation",
          "confirmed",
          "executing",
        ]),
      ),
    );
  for (const action of actions) {
    if (
      !controlAppliesToCapability(
        control,
        action.capabilityId,
        action.catalogVersion,
        action.policyVersion,
      )
    ) continue;
    if (action.state === "executing") {
      summary.executingPreserved += 1;
      continue;
    }
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(atelierAssistantActions)
        .set({
          state: "invalidated",
          stateVersion: action.stateVersion + 1,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(atelierAssistantActions.id, action.id),
            eq(atelierAssistantActions.state, action.state),
          ),
        )
        .returning({ id: atelierAssistantActions.id });
      if (!updated) return;
      if (action.conversationId && action.sourceTurnId) {
        await appendAssistantEventTx(tx, {
          orgId: action.orgId,
          requesterId: action.requesterId,
          conversationId: action.conversationId,
          turnId: action.sourceTurnId,
          correlationId: action.id,
          type: "action.invalidated",
          data: {
            actionId: action.id,
            reason: "operator_control",
            controlId: control.id,
          },
        });
      }
      summary.actionsInvalidated += 1;
    });
  }

  const workRows = await db
    .select({ work: atelierWorkItems, step: atelierWorkSteps })
    .from(atelierWorkItems)
    .innerJoin(atelierWorkSteps, eq(atelierWorkSteps.workItemId, atelierWorkItems.id))
    .where(
      and(
        eq(atelierWorkItems.orgId, control.orgId),
        inArray(atelierWorkItems.status, [
          "planned",
          "blocked",
          "recovery_settling",
          "cancellation_settling",
          "compensation_required",
        ]),
      ),
    );
  const workIds = new Set(
    workRows
      .filter(({ work, step }) =>
        controlAppliesToCapability(
          control,
          step.capabilityId,
          work.catalogVersion,
          step.policyVersion,
        ),
      )
      .map(({ work }) => work.id),
  );
  for (const workId of workIds) {
    await db.transaction(async (tx) => {
      const [work] = await tx
        .select()
        .from(atelierWorkItems)
        .where(eq(atelierWorkItems.id, workId))
        .for("update");
      if (!work || ["succeeded", "failed", "cancelled", "compensated"].includes(work.status)) {
        return;
      }
      const steps = await tx
        .select()
        .from(atelierWorkSteps)
        .where(eq(atelierWorkSteps.workItemId, work.id));
      const attempts = await tx
        .select()
        .from(atelierWorkAttempts)
        .where(inArray(atelierWorkAttempts.stepId, steps.map((step) => step.id)));
      const activeAttempts = attempts.filter((attempt) =>
        attempt.status === "running" || attempt.status === "committing",
      );
      const runningAttempts = activeAttempts.filter(
        (attempt) => attempt.status === "running",
      );
      const committingAttempts = activeAttempts.filter(
        (attempt) => attempt.status === "committing",
      );
      if (control.inflightBehavior === "finish" && activeAttempts.length > 0) {
        summary.executingPreserved += activeAttempts.length;
        return;
      }
      const now = new Date();
      if (
        control.inflightBehavior === "pause" ||
        control.inflightBehavior === "finish"
      ) {
        await tx
          .update(atelierWorkItems)
          .set({ status: "blocked", updatedAt: now })
          .where(eq(atelierWorkItems.id, work.id));
        const [existingCheckpoint] = await tx
          .select({ id: atelierWorkCheckpoints.id })
          .from(atelierWorkCheckpoints)
          .where(
            and(
              eq(atelierWorkCheckpoints.workItemId, work.id),
              isNull(atelierWorkCheckpoints.decision),
              sql`${atelierWorkCheckpoints.requiredDecider}->>'reason' = 'operator_control'`,
            ),
          )
          .limit(1);
        if (!existingCheckpoint) {
          await tx.insert(atelierWorkCheckpoints).values({
            id: `checkpoint_${randomUUID()}`,
            workItemId: work.id,
            stepId: steps[0]?.id ?? null,
            type: "operator_review",
            requiredDecider: {
              kind: "operator",
              roles: ["founding_partner"],
              reason: "operator_control",
              controlId: control.id,
              approveAction: "resume_after_control_released",
              rejectAction: "close_failed",
              evidenceSchema: {
                type: "object",
                additionalProperties: false,
                required: ["reason"],
                properties: {
                  reason: { type: "string", minLength: 10, maxLength: 500 },
                  evidence: {},
                },
              },
            },
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
          });
        }
        summary.workPaused += 1;
        return;
      }

      for (const attempt of runningAttempts) {
        if (attempt.budgetReservationId) {
          await refundAssistantBudget(
            control.orgId!,
            attempt.budgetReservationId,
            tx,
          );
        }
      }
      if (runningAttempts.length > 0) {
        await tx
          .update(atelierWorkAttempts)
          .set({
            status: "cancelled",
            errorClass: "operator_control",
            endedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              inArray(
                atelierWorkAttempts.id,
                runningAttempts.map((attempt) => attempt.id),
              ),
              eq(atelierWorkAttempts.status, "running"),
            ),
          );
      }
      for (const attempt of runningAttempts) {
        await recordRiserObservationTx(tx, {
          orgId: control.orgId!,
          workItemId: work.id,
          stepId: attempt.stepId,
          attemptId: attempt.id,
          stage: "workflow_attempt",
          outcome: "cancelled",
          reasonCode: "authority_changed",
          securityEvent: true,
        });
      }
      if (committingAttempts.length > 0) {
        await tx
          .update(atelierWorkItems)
          .set({
            status:
              control.inflightBehavior === "compensate"
                ? "recovery_settling"
                : "cancellation_settling",
            cancellationRequestedAt: now,
            updatedAt: now,
          })
          .where(eq(atelierWorkItems.id, work.id));
        const [existing] = await tx
          .select({ id: atelierWorkCheckpoints.id })
          .from(atelierWorkCheckpoints)
          .where(
            and(
              eq(atelierWorkCheckpoints.workItemId, work.id),
              isNull(atelierWorkCheckpoints.decision),
              sql`${atelierWorkCheckpoints.requiredDecider}->>'reason' = 'operator_control_commit_inflight'`,
            ),
          )
          .limit(1);
        if (!existing) {
          await tx.insert(atelierWorkCheckpoints).values({
            id: `checkpoint_${randomUUID()}`,
            workItemId: work.id,
            stepId: committingAttempts[0]?.stepId ?? null,
            type: "operator_review",
            requiredDecider: {
              kind: "operator",
              roles: ["founding_partner"],
              reason: "operator_control_commit_inflight",
              controlId: control.id,
              approveAction: "accept_authoritative_commit",
              rejectAction: "require_compensation",
              evidenceSchema: {
                type: "object",
                additionalProperties: false,
                required: ["reason"],
                properties: {
                  reason: { type: "string", minLength: 10, maxLength: 500 },
                  evidence: {},
                },
              },
            },
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
          });
        }
        summary.executingPreserved += committingAttempts.length;
        return;
      }

      const compensable = steps.filter(
        (step) => step.status === "succeeded" && step.compensation !== null,
      );
      if (
        control.inflightBehavior === "compensate" &&
        compensable.length > 0
      ) {
        await tx
          .update(atelierWorkSteps)
          .set({ status: "compensation_required", updatedAt: now })
          .where(inArray(atelierWorkSteps.id, compensable.map((step) => step.id)));
        await tx
          .update(atelierWorkSteps)
          .set({ status: "cancelled", updatedAt: now })
          .where(
            and(
              eq(atelierWorkSteps.workItemId, work.id),
              sql`${atelierWorkSteps.id} not in (${sql.join(
                compensable.map((step) => sql`${step.id}`),
                sql`, `,
              )})`,
              sql`${atelierWorkSteps.status} <> 'succeeded'`,
            ),
          );
        await tx
          .update(atelierWorkItems)
          .set({
            status: "compensation_required",
            cancellationRequestedAt: now,
            updatedAt: now,
          })
          .where(eq(atelierWorkItems.id, work.id));
        await recordRiserObservationTx(tx, {
          orgId: control.orgId!,
          workItemId: work.id,
          stage: "compensation",
          outcome: "required",
          reasonCode: "authority_changed",
          securityEvent: true,
        });
        summary.workCompensating += 1;
      } else {
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
          orgId: control.orgId!,
          workItemId: work.id,
          stage: "terminal_outcome",
          outcome: "cancelled",
          reasonCode: "authority_changed",
          securityEvent: true,
        });
        summary.workCancelled += 1;
      }
    });
  }
  await db.insert(atelierAuditEvents).values({
    id: `aud_${randomUUID()}`,
    orgId: control.orgId,
    entityType: "assistant_control",
    entityId: control.id,
    actorType: "human",
    actorId: args.actorId,
    actorLabel: args.actorLabel,
    action: "assistant.control.reconciled",
    payload: summary,
    payloadSummary: `Assistant control reconciliation v${control.version}`,
  });
  await db
    .update(atelierAssistantControls)
    .set({
      reconciliationStatus: "complete",
      reconciliationError: null,
      reconciledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierAssistantControls.id, control.id));
  return summary;
}

export async function retryAssistantControlReconciliation(args: {
  orgId: string;
  controlId: string;
  actorId: string;
  actorLabel: string;
}) {
  const [control] = await db
    .select()
    .from(atelierAssistantControls)
    .where(
      and(
        eq(atelierAssistantControls.id, args.controlId),
        eq(atelierAssistantControls.orgId, args.orgId),
        eq(atelierAssistantControls.enabled, true),
      ),
    );
  if (!control) return null;
  const summary = await reconcileAssistantControl({
    control,
    actorId: args.actorId,
    actorLabel: args.actorLabel,
  });
  return { controlId: control.id, summary };
}

export async function listAssistantDeadLetters(args: {
  orgId: string;
  limit?: number;
}) {
  const limit = Math.min(500, Math.max(1, args.limit ?? 100));
  const [actions, work, attempts] = await Promise.all([
    db
      .select({
        id: atelierAssistantActions.id,
        capabilityId: atelierAssistantActions.capabilityId,
        state: atelierAssistantActions.state,
        completedAt: atelierAssistantActions.completedAt,
      })
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.orgId, args.orgId),
          inArray(atelierAssistantActions.state, [
            "failed",
            "partially_succeeded",
            "invalidated",
          ]),
        ),
      )
      .orderBy(desc(atelierAssistantActions.updatedAt))
      .limit(limit),
    db
      .select({
        id: atelierWorkItems.id,
        status: atelierWorkItems.status,
        completedAt: atelierWorkItems.completedAt,
        updatedAt: atelierWorkItems.updatedAt,
      })
      .from(atelierWorkItems)
      .where(
        and(
          eq(atelierWorkItems.orgId, args.orgId),
          inArray(atelierWorkItems.status, [
            "blocked",
            "failed",
            "compensation_required",
            "recovery_settling",
            "cancellation_settling",
          ]),
        ),
      )
      .orderBy(desc(atelierWorkItems.updatedAt))
      .limit(limit),
    db
      .select({
        id: atelierWorkAttempts.id,
        workItemId: atelierWorkItems.id,
        stepId: atelierWorkAttempts.stepId,
        status: atelierWorkAttempts.status,
        errorClass: atelierWorkAttempts.errorClass,
        endedAt: atelierWorkAttempts.endedAt,
      })
      .from(atelierWorkAttempts)
      .innerJoin(
        atelierWorkSteps,
        eq(atelierWorkAttempts.stepId, atelierWorkSteps.id),
      )
      .innerJoin(
        atelierWorkItems,
        eq(atelierWorkSteps.workItemId, atelierWorkItems.id),
      )
      .where(
        and(
          eq(atelierWorkItems.orgId, args.orgId),
          inArray(atelierWorkAttempts.status, [
            "permanent",
            "ambiguous",
            "blocked",
            "compensation_required",
            "cancelled",
          ]),
        ),
      )
      .orderBy(desc(atelierWorkAttempts.updatedAt))
      .limit(limit),
  ]);
  return { bounded: actions.length === limit || work.length === limit || attempts.length === limit, actions, work, attempts };
}