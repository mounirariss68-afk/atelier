import { and, eq, isNull } from "drizzle-orm";
import { db, atelierAccounts } from "@workspace/db";
import { createDurableActionPreview } from "./action-runtime.js";
import { evaluateAssistantPolicy } from "./control-runtime.js";
import { findByToolName } from "../atelier-cli/capability-catalog.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import { canSeeAccount } from "../../routes/atelier/accountRoutes.js";

type Persona = Parameters<typeof accessibleEngagementIds>[0];
const CAPABILITY_ID = "coverage.account_update";
const POLICY_VERSION = "riser-policy-v1";
const EXPIRY_MS = 10 * 60_000;
const ALLOWED_STATUSES = new Set(["active", "dormant", "archived"]);

export async function createDurableAccountUpdatePreview(args: {
  persona: Persona;
  conversationId: string;
  turnId: string;
  step: number;
  input: Record<string, unknown>;
}): Promise<{
  actionId: string;
  stateVersion: number;
  summary: string;
  diff: Record<string, unknown>;
}> {
  const capability = findByToolName("account_update");
  if (
    !capability ||
    capability.id !== CAPABILITY_ID ||
    !capability.isWrite ||
    !capability.requiredRoles?.includes(args.persona.role)
  ) {
    throw new Error("durable-account-preview-forbidden");
  }
  const keys = Object.keys(args.input);
  if (
    keys.some((key) => !["id", "name", "status", "notes"].includes(key)) ||
    typeof args.input.id !== "string"
  ) {
    throw new Error("durable-account-preview-invalid-input");
  }
  const canonicalInput: Record<string, unknown> = { id: args.input.id };
  if (args.input.name !== undefined) {
    if (typeof args.input.name !== "string" || args.input.name.trim().length === 0) {
      throw new Error("durable-account-preview-invalid-name");
    }
    canonicalInput.name = args.input.name.trim();
  }
  if (args.input.status !== undefined) {
    if (typeof args.input.status !== "string" || !ALLOWED_STATUSES.has(args.input.status)) {
      throw new Error("durable-account-preview-invalid-status");
    }
    canonicalInput.status = args.input.status;
  }
  if (args.input.notes !== undefined) {
    if (typeof args.input.notes !== "string") {
      throw new Error("durable-account-preview-invalid-notes");
    }
    canonicalInput.notes = args.input.notes;
  }
  if (Object.keys(canonicalInput).length === 1) {
    throw new Error("durable-account-preview-empty-patch");
  }
  const [account] = await db
    .select()
    .from(atelierAccounts)
    .where(
      and(
        eq(atelierAccounts.id, args.input.id),
        eq(atelierAccounts.orgId, args.persona.orgId),
        isNull(atelierAccounts.deletedAt),
      ),
    );
  if (!account) throw new Error("durable-account-preview-not-found");
  const access = await accessibleEngagementIds(args.persona);
  if (!(await canSeeAccount(access, args.persona, account.id))) {
    throw new Error("durable-account-preview-forbidden");
  }
  const policy = await evaluateAssistantPolicy({
    orgId: args.persona.orgId,
    capabilityId: CAPABILITY_ID,
    baseAllowed: true,
    obligations: ["fresh_confirmation"],
    policyVersion: POLICY_VERSION,
  });
  if (policy.effect !== "allow") throw new Error("durable-account-preview-policy-denied");
  const changedFields = Object.keys(canonicalInput).filter((key) => key !== "id");
  const diff = {
    accountId: account.id,
    changedFields,
    before: {
      ...(canonicalInput.name !== undefined ? { name: account.name } : {}),
      ...(canonicalInput.status !== undefined ? { status: account.status } : {}),
      ...(canonicalInput.notes !== undefined ? { notes: account.notes ? "(existing notes)" : null } : {}),
    },
    after: {
      ...(canonicalInput.name !== undefined ? { name: canonicalInput.name } : {}),
      ...(canonicalInput.status !== undefined ? { status: canonicalInput.status } : {}),
      ...(canonicalInput.notes !== undefined ? { notes: "(updated notes)" } : {}),
    },
  };
  const created = await createDurableActionPreview({
    orgId: args.persona.orgId,
    requesterId: args.persona.id,
    conversationId: args.conversationId,
    sourceTurnId: args.turnId,
    capabilityId: CAPABILITY_ID,
    inputSchemaVersion: capability.schemaVersion,
    canonicalInput,
    targetRefsAndRevisions: [{
      type: "account",
      id: account.id,
      updatedAt: account.updatedAt.toISOString(),
    }],
    policyDecision: policy,
    riskClass: "write",
    irreversible: false,
    outboundChannels: [],
    summary: `Update account ${account.name}`,
    diff,
    expiresAt: new Date(Date.now() + EXPIRY_MS),
    idempotencyKey: `durable:${args.turnId}:${args.step}:account_update`,
  });
  return {
    actionId: created.actionId,
    stateVersion: created.stateVersion,
    summary: `Update account ${account.name}`,
    diff,
  };
}