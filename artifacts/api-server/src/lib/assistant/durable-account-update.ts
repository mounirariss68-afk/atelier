import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierAssistantActions,
  atelierAuditEvents,
} from "@workspace/db";
import { decryptAssistantValue } from "./action-runtime.js";
import { appendAssistantEventTx } from "./event-runtime.js";

const ALLOWED_STATUSES = new Set(["active", "dormant", "archived"]);

export async function executeDurableAccountUpdate(args: {
  orgId: string;
  actionId: string;
  fencingToken: number;
}): Promise<{ id: string; changedFields: string[] }> {
  const outcome = await db.transaction(async (tx) => {
    const [action] = await tx
      .select()
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.id, args.actionId),
          eq(atelierAssistantActions.orgId, args.orgId),
          eq(atelierAssistantActions.capabilityId, "coverage.account_update"),
        ),
      )
      .for("update");
    if (!action) throw new Error("durable-account-action-not-executable");
    if (action.executorFence !== args.fencingToken) {
      throw new Error("durable-account-action-fence-mismatch");
    }
    if (action.state === "succeeded") {
      return { ok: true as const, result: action.result as { id: string; changedFields: string[] } };
    }
    if (action.state !== "executing") throw new Error("durable-account-action-not-executable");
    const terminalize = async (
      state: "failed" | "invalidated",
      code: string,
    ): Promise<{ ok: false; code: string }> => {
      const result = { code };
      await tx
        .update(atelierAssistantActions)
        .set({
          state,
          stateVersion: action.stateVersion + 1,
          result,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(atelierAssistantActions.id, action.id),
            eq(atelierAssistantActions.state, "executing"),
            eq(atelierAssistantActions.executorFence, args.fencingToken),
          ),
        );
      await appendAssistantEventTx(tx, {
        orgId: action.orgId,
        requesterId: action.requesterId,
        conversationId: action.conversationId!,
        turnId: action.sourceTurnId!,
        correlationId: action.id,
        type: `action.${state}`,
        data: { actionId: action.id, code },
      });
      return { ok: false, code };
    };
    const decrypted = decryptAssistantValue(action.canonicalInputEncrypted);
    if (typeof decrypted !== "object" || decrypted === null || Array.isArray(decrypted)) {
      return terminalize("failed", "invalid_input");
    }
    const input = decrypted as Record<string, unknown>;
    const id = typeof input.id === "string" ? input.id : "";
    if (!id) return terminalize("failed", "invalid_input");
    const target = action.targetRefsAndRevisions.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as Record<string, unknown>).type === "account" &&
        (candidate as Record<string, unknown>).id === id,
    ) as Record<string, unknown> | undefined;
    const expectedUpdatedAt = typeof target?.updatedAt === "string" ? target.updatedAt : "";
    if (!expectedUpdatedAt) return terminalize("failed", "target_invalid");

    const [account] = await tx
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, id),
          eq(atelierAccounts.orgId, args.orgId),
          isNull(atelierAccounts.deletedAt),
        ),
      )
      .for("update");
    if (!account) return terminalize("failed", "target_not_found");
    if (account.updatedAt.toISOString() !== expectedUpdatedAt) {
      return terminalize("failed", "target_stale");
    }
    const patch: Partial<typeof atelierAccounts.$inferInsert> = {
      updatedAt: new Date(Math.max(Date.now(), account.updatedAt.getTime() + 1)),
    };
    const changedFields: string[] = [];
    if (input.name !== undefined) {
      if (typeof input.name !== "string" || input.name.trim().length === 0) {
        return terminalize("failed", "invalid_name");
      }
      patch.name = input.name.trim();
      changedFields.push("name");
    }
    if (input.status !== undefined) {
      if (typeof input.status !== "string" || !ALLOWED_STATUSES.has(input.status)) {
        return terminalize("failed", "invalid_status");
      }
      patch.status = input.status;
      changedFields.push("status");
    }
    if (input.notes !== undefined) {
      if (typeof input.notes !== "string") return terminalize("failed", "invalid_notes");
      patch.notes = input.notes;
      changedFields.push("notes");
    }
    if (changedFields.length === 0) return terminalize("failed", "empty_patch");
    await tx
      .update(atelierAccounts)
      .set(patch)
      .where(and(eq(atelierAccounts.id, id), eq(atelierAccounts.orgId, args.orgId)));
    const auditId = `ae_${randomUUID()}`;
    await tx.insert(atelierAuditEvents).values({
      id: auditId,
      orgId: args.orgId,
      actorType: "human",
      actorId: action.requesterId,
      actorLabel: action.requesterId,
      entityType: "account",
      entityId: id,
      action: "update",
      payloadSummary: "account.update",
      payload: { changedFields, actionId: action.id },
    });
    const result = { id, changedFields };
    await tx
      .update(atelierAssistantActions)
      .set({
        state: "succeeded",
        stateVersion: action.stateVersion + 1,
        result,
        auditEventIds: [auditId],
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(atelierAssistantActions.id, action.id));
    await appendAssistantEventTx(tx, {
      orgId: action.orgId,
      requesterId: action.requesterId,
      conversationId: action.conversationId!,
      turnId: action.sourceTurnId!,
      correlationId: action.id,
      type: "action.succeeded",
      data: { actionId: action.id, result },
    });
    return { ok: true as const, result };
  });
  if (!outcome.ok) throw new Error(`durable-account-${outcome.code}`);
  return outcome.result;
}