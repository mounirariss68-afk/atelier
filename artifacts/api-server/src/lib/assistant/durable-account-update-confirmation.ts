import { and, eq, isNull } from "drizzle-orm";
import { db, atelierAccounts, atelierAssistantActions } from "@workspace/db";
import type { PolicyDecisionV1 } from "@workspace/assistant-protocol";
import {
  claimDurableAction,
  completeDurableAction,
  confirmDurableAction,
} from "./action-runtime.js";
import { executeDurableAccountUpdate } from "./durable-account-update.js";
import { evaluateAssistantPolicy } from "./control-runtime.js";
import { capabilitiesForPersona } from "../atelier-cli/capability-catalog.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import { canSeeAccount } from "../../routes/atelier/accountRoutes.js";

type Persona = Parameters<typeof accessibleEngagementIds>[0];

function currentPolicy(
  action: typeof atelierAssistantActions.$inferSelect,
  baseAllowed: boolean,
): Promise<PolicyDecisionV1> {
  const obligations = action.obligations.every(
    (obligation): obligation is string => typeof obligation === "string",
  )
    ? action.obligations
    : [];
  return evaluateAssistantPolicy({
    orgId: action.orgId,
    capabilityId: action.capabilityId,
    baseAllowed: baseAllowed && obligations.length === action.obligations.length,
    obligations,
    policyVersion: action.policyVersion,
  });
}

async function targetsCurrent(
  orgId: string,
  targets: unknown[],
): Promise<boolean> {
  if (targets.length !== 1) return false;
  const target = targets[0];
  if (typeof target !== "object" || target === null) return false;
  const row = target as Record<string, unknown>;
  if (
    row.type !== "account" ||
    typeof row.id !== "string" ||
    typeof row.updatedAt !== "string"
  ) {
    return false;
  }
  const [account] = await db
    .select({ updatedAt: atelierAccounts.updatedAt })
    .from(atelierAccounts)
    .where(
      and(
        eq(atelierAccounts.id, row.id),
        eq(atelierAccounts.orgId, orgId),
        isNull(atelierAccounts.deletedAt),
      ),
    );
  return account?.updatedAt.toISOString() === row.updatedAt;
}

export async function confirmAndExecuteDurableAccountUpdate(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
  persona: Persona;
  expectedStateVersion?: number;
  typedEvidence?: string;
}): Promise<{ state: string; result: unknown }> {
  const load = async () => {
    const [action] = await db
      .select()
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.id, args.actionId),
          eq(atelierAssistantActions.orgId, args.orgId),
          eq(atelierAssistantActions.requesterId, args.requesterId),
          eq(atelierAssistantActions.capabilityId, "coverage.account_update"),
        ),
      );
    return action;
  };
  let action = await load();
  if (!action) throw new Error("durable-account-action-not-found");
  const roleAllowed = capabilitiesForPersona(args.persona).some(
    (entry) => entry.id === "coverage.account_update" && entry.isWrite,
  );
  const target = action.targetRefsAndRevisions[0] as Record<string, unknown> | undefined;
  const targetId =
    target?.type === "account" && typeof target.id === "string" ? target.id : null;
  const access = await accessibleEngagementIds(args.persona);
  const allowed =
    roleAllowed &&
    targetId !== null &&
    (await canSeeAccount(access, args.persona, targetId));
  if (!allowed) throw new Error("durable-account-action-forbidden");
  if (["failed", "invalidated", "cancelled", "expired"].includes(action.state)) {
    return { state: action.state, result: action.result };
  }
  if (action.state === "succeeded") {
    return { state: action.state, result: action.result };
  }
  if (action.state === "awaiting_confirmation") {
    if (args.expectedStateVersion !== action.stateVersion) {
      throw new Error("durable-account-state-version-mismatch");
    }
    await confirmDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      requesterId: action.requesterId,
      expectedStateVersion: action.stateVersion,
      typedEvidence: args.typedEvidence,
      recheckPolicy: (current) => currentPolicy(current, allowed),
    });
    action = (await load())!;
  }
  if (action.state === "confirmed") {
    const claim = await claimDurableAction({
      actionId: action.id,
      orgId: action.orgId,
      recheckPolicy: (current) => currentPolicy(current, allowed),
      recheckTargets: (targets) => targetsCurrent(action!.orgId, targets),
    });
    if (!claim) {
      action = (await load())!;
      return { state: action.state, result: action.result };
    }
    const result = await executeDurableAccountUpdate({
      orgId: action.orgId,
      actionId: action.id,
      fencingToken: claim.fencingToken,
    });
    return { state: "succeeded", result };
  }
  if (action.state === "executing") {
    const policy = await currentPolicy(action, allowed);
    if (
      policy.effect !== "allow" ||
      policy.policyVersion !== action.policyVersion ||
      policy.decisionDigest !== action.policyDecisionDigest
    ) {
      const terminal = await completeDurableAction({
        actionId: action.id,
        orgId: action.orgId,
        fencingToken: action.executorFence,
        status: "failed",
        result: { code: "policy_drift" },
      });
      return { state: terminal.state, result: terminal.result };
    }
    const result = await executeDurableAccountUpdate({
      orgId: action.orgId,
      actionId: action.id,
      fencingToken: action.executorFence,
    });
    return { state: "succeeded", result };
  }
  throw new Error("durable-account-action-state-unsupported");
}