import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, atelierAssistantActions } from "@workspace/db";
import {
  ActionPreviewV1Schema,
  ActionStateV1Schema,
  PolicyDecisionV1Schema,
  assertActionTransition,
  type ActionStateV1,
  type PolicyDecisionV1,
} from "@workspace/assistant-protocol";
import { appendAssistantEventTx } from "./event-runtime.js";

const TERMINAL = new Set<ActionStateV1>([
  "succeeded",
  "failed",
  "partially_succeeded",
  "compensated",
  "cancelled",
  "expired",
  "invalidated",
]);

export function digestAssistantValue(value: unknown): string {
  return createHash("sha256").update(stableAssistantJson(value)).digest("hex");
}

function stableAssistantJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableAssistantJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableAssistantJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function encryptionKey(): Buffer {
  const root = process.env.SESSION_SECRET;
  if (!root || root.length < 32) throw new Error("assistant-encryption-key-unavailable");
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(root), Buffer.from("atelier-riser-v1"), Buffer.from("action-input"), 32),
  );
}

export function encryptAssistantValue(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptAssistantValue(value: string): unknown {
  if (value.length > 1_400_000) throw new Error("assistant-ciphertext-too-large");
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("assistant-ciphertext-invalid");
  }
  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  const ciphertext = Buffer.from(ciphertextRaw, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 1_048_576) {
    throw new Error("assistant-ciphertext-invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  if (plaintext.length > 1_048_576) throw new Error("assistant-plaintext-too-large");
  return JSON.parse(plaintext.toString("utf8")) as unknown;
}

export async function cancelDurableAction(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
}): Promise<{ state: ActionStateV1; stateVersion: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.id, args.actionId),
          eq(atelierAssistantActions.orgId, args.orgId),
          eq(atelierAssistantActions.requesterId, args.requesterId),
        ),
      )
      .for("update");
    const row = rows[0];
    if (!row) throw new Error("action-not-found");
    const current = ActionStateV1Schema.parse(row.state);
    if (TERMINAL.has(current)) return { state: current, stateVersion: row.stateVersion };
    assertActionTransition(current, "cancelled");
    const [updated] = await tx
      .update(atelierAssistantActions)
      .set({
        state: "cancelled",
        stateVersion: row.stateVersion + 1,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierAssistantActions.id, row.id),
          eq(atelierAssistantActions.stateVersion, row.stateVersion),
        ),
      )
      .returning({
        state: atelierAssistantActions.state,
        stateVersion: atelierAssistantActions.stateVersion,
      });
    if (!updated) throw new Error("action-concurrency-conflict");
    if (row.conversationId && row.sourceTurnId) {
      await appendAssistantEventTx(tx, {
        orgId: row.orgId,
        conversationId: row.conversationId,
        turnId: row.sourceTurnId,
        correlationId: row.id,
        type: "action.cancelled",
        data: { actionId: row.id, stateVersion: updated.stateVersion },
      });
    }
    return {
      state: ActionStateV1Schema.parse(updated.state),
      stateVersion: updated.stateVersion,
    };
  });
}

export async function createDurableActionPreview(args: {
  orgId: string;
  requesterId: string;
  conversationId: string;
  sourceTurnId: string;
  capabilityId: string;
  catalogVersion: string;
  inputSchemaVersion: number;
  canonicalInput: unknown;
  targetRefsAndRevisions: unknown[];
  policyDecision: PolicyDecisionV1;
  riskClass: string;
  irreversible: boolean;
  outboundChannels: string[];
  summary: string;
  diff: unknown;
  typedEvidence?: string;
  expiresAt: Date;
  idempotencyKey: string;
}): Promise<{ actionId: string; preview: unknown; stateVersion: number }> {
  const policy = PolicyDecisionV1Schema.parse(args.policyDecision);
  if (policy.effect !== "allow") throw new Error("action-policy-not-allowed");
  if (args.expiresAt.getTime() <= Date.now()) throw new Error("action-expiry-invalid");
  const inputDigest = digestAssistantValue(args.canonicalInput);
  const typedEvidenceDigest = args.typedEvidence
    ? digestAssistantValue(args.typedEvidence)
    : null;
  const actionId = `action_${randomUUID()}`;
  const preview = ActionPreviewV1Schema.parse({
    actionId,
    capabilityId: args.capabilityId,
    summary: args.summary,
    diff: args.diff,
    inputDigest,
    irreversible: args.irreversible,
    outboundChannels: args.outboundChannels,
    expiresAt: args.expiresAt.toISOString(),
  });

  const existing = await db
    .select()
    .from(atelierAssistantActions)
    .where(
      and(
        eq(atelierAssistantActions.orgId, args.orgId),
        eq(atelierAssistantActions.requesterId, args.requesterId),
        eq(atelierAssistantActions.idempotencyKey, args.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing[0]) {
    if (
      existing[0].inputDigest !== inputDigest ||
      existing[0].capabilityId !== args.capabilityId ||
      existing[0].catalogVersion !== args.catalogVersion
    ) {
      throw new Error("action-idempotency-conflict");
    }
    return {
      actionId: existing[0].id,
      preview: existing[0].previewSnapshot,
      stateVersion: existing[0].stateVersion,
    };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(atelierAssistantActions).values({
      id: actionId,
      orgId: args.orgId,
      requesterId: args.requesterId,
      conversationId: args.conversationId,
      sourceTurnId: args.sourceTurnId,
      capabilityId: args.capabilityId,
      catalogVersion: args.catalogVersion,
      inputSchemaVersion: args.inputSchemaVersion,
      inputDigest,
      canonicalInputEncrypted: encryptAssistantValue(args.canonicalInput),
      targetRefsAndRevisions: args.targetRefsAndRevisions,
      policyVersion: policy.policyVersion,
      policyDecisionDigest: policy.decisionDigest,
      obligations: policy.obligations,
      riskClass: args.riskClass,
      irreversible: args.irreversible,
      outboundChannels: args.outboundChannels,
      previewSnapshot: preview,
      typedEvidenceDigest,
      expiresAt: args.expiresAt,
      state: "awaiting_confirmation",
      stateVersion: 3,
      idempotencyKey: args.idempotencyKey,
      });
      await appendAssistantEventTx(tx, {
      orgId: args.orgId,
      conversationId: args.conversationId,
      turnId: args.sourceTurnId,
      correlationId: actionId,
      type: "action.awaiting_confirmation",
      data: { actionId, preview, stateVersion: 3 },
      });
    });
  } catch (error) {
    const [raced] = await db
      .select()
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.orgId, args.orgId),
          eq(atelierAssistantActions.requesterId, args.requesterId),
          eq(atelierAssistantActions.idempotencyKey, args.idempotencyKey),
        ),
      )
      .limit(1);
    if (
      raced &&
      raced.inputDigest === inputDigest &&
      raced.capabilityId === args.capabilityId &&
      raced.catalogVersion === args.catalogVersion
    ) {
      return {
        actionId: raced.id,
        preview: raced.previewSnapshot,
        stateVersion: raced.stateVersion,
      };
    }
    throw error;
  }
  return { actionId, preview, stateVersion: 3 };
}

export async function confirmDurableAction(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
  expectedStateVersion: number;
  typedEvidence?: string;
  recheckPolicy: (action: typeof atelierAssistantActions.$inferSelect) => Promise<PolicyDecisionV1>;
}): Promise<{ state: "confirmed"; stateVersion: number }> {
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.id, args.actionId),
          eq(atelierAssistantActions.orgId, args.orgId),
          eq(atelierAssistantActions.requesterId, args.requesterId),
          eq(atelierAssistantActions.state, "awaiting_confirmation"),
          eq(atelierAssistantActions.stateVersion, args.expectedStateVersion),
          gt(atelierAssistantActions.expiresAt, new Date()),
        ),
      )
      .for("update");
    if (!row) throw new Error("action-not-confirmable");
    if (
      row.typedEvidenceDigest &&
      digestAssistantValue(args.typedEvidence ?? "") !== row.typedEvidenceDigest
    ) {
      throw new Error("action-typed-evidence-mismatch");
    }
    const policy = PolicyDecisionV1Schema.parse(await args.recheckPolicy(row));
    if (
      policy.effect !== "allow" ||
      policy.policyVersion !== row.policyVersion ||
      policy.decisionDigest !== row.policyDecisionDigest
    ) {
      const [invalidated] = await tx
        .update(atelierAssistantActions)
        .set({
          state: "invalidated",
          stateVersion: row.stateVersion + 1,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(atelierAssistantActions.id, row.id))
        .returning({ stateVersion: atelierAssistantActions.stateVersion });
      await appendAssistantEventTx(tx, {
        orgId: row.orgId,
        conversationId: row.conversationId!,
        turnId: row.sourceTurnId!,
        correlationId: row.id,
        type: "action.invalidated",
        data: { actionId: row.id, reason: "policy_drift" },
      });
      return { state: "invalidated" as const, stateVersion: invalidated.stateVersion };
    }
    assertActionTransition("awaiting_confirmation", "confirmed");
    const [updated] = await tx
      .update(atelierAssistantActions)
      .set({
        state: "confirmed",
        stateVersion: row.stateVersion + 1,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierAssistantActions.id, row.id),
          eq(atelierAssistantActions.stateVersion, row.stateVersion),
        ),
      )
      .returning({ stateVersion: atelierAssistantActions.stateVersion });
    if (!updated) throw new Error("action-concurrency-conflict");
    await appendAssistantEventTx(tx, {
      orgId: row.orgId,
      conversationId: row.conversationId!,
      turnId: row.sourceTurnId!,
      correlationId: row.id,
      type: "action.confirmed",
      data: { actionId: row.id, stateVersion: updated.stateVersion },
    });
    return { state: "confirmed" as const, stateVersion: updated.stateVersion };
  });
  if (outcome.state === "invalidated") throw new Error("action-policy-drift");
  return outcome;
}

export async function claimDurableAction(args: {
  actionId: string;
  orgId: string;
  recheckPolicy: (action: typeof atelierAssistantActions.$inferSelect) => Promise<PolicyDecisionV1>;
  recheckTargets: (targets: unknown[]) => Promise<boolean>;
}): Promise<{ fencingToken: number; input: unknown } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.id, args.actionId),
          eq(atelierAssistantActions.orgId, args.orgId),
          eq(atelierAssistantActions.state, "confirmed"),
          gt(atelierAssistantActions.expiresAt, new Date()),
        ),
      )
      .for("update");
    if (!row) return null;
    const policy = PolicyDecisionV1Schema.parse(await args.recheckPolicy(row));
    const targetsCurrent = await args.recheckTargets(row.targetRefsAndRevisions);
    if (
      policy.effect !== "allow" ||
      policy.policyVersion !== row.policyVersion ||
      policy.decisionDigest !== row.policyDecisionDigest ||
      !targetsCurrent
    ) {
      await tx
        .update(atelierAssistantActions)
        .set({
          state: "invalidated",
          stateVersion: row.stateVersion + 1,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(atelierAssistantActions.id, row.id),
            eq(atelierAssistantActions.state, "confirmed"),
          ),
        );
      await appendAssistantEventTx(tx, {
        orgId: row.orgId,
        conversationId: row.conversationId!,
        turnId: row.sourceTurnId!,
        correlationId: row.id,
        type: "action.invalidated",
        data: { actionId: row.id, reason: targetsCurrent ? "policy_drift" : "target_drift" },
      });
      return null;
    }
    assertActionTransition("confirmed", "executing");
    const fence = row.executorFence + 1;
    const [updated] = await tx
      .update(atelierAssistantActions)
      .set({
        state: "executing",
        stateVersion: row.stateVersion + 1,
        executorFence: fence,
        claimedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierAssistantActions.id, row.id),
          eq(atelierAssistantActions.stateVersion, row.stateVersion),
        ),
      )
      .returning({ id: atelierAssistantActions.id });
    if (!updated) return null;
    return { fencingToken: fence, input: decryptAssistantValue(row.canonicalInputEncrypted) };
  });
}

export async function completeDurableAction(args: {
  actionId: string;
  orgId: string;
  fencingToken: number;
  status: "succeeded" | "failed" | "partially_succeeded" | "compensated";
  result: unknown;
}): Promise<{ state: ActionStateV1; result: unknown }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.id, args.actionId),
          eq(atelierAssistantActions.orgId, args.orgId),
        ),
      )
      .for("update");
    if (!row) throw new Error("action-not-found");
    const current = ActionStateV1Schema.parse(row.state);
    if (TERMINAL.has(current)) return { state: current, result: row.result };
    if (current !== "executing" || row.executorFence !== args.fencingToken) {
      throw new Error("action-fence-mismatch");
    }
    assertActionTransition("executing", args.status);
    const [updated] = await tx
      .update(atelierAssistantActions)
      .set({
        state: args.status,
        stateVersion: row.stateVersion + 1,
        result: args.result,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(atelierAssistantActions.id, row.id),
          eq(atelierAssistantActions.executorFence, args.fencingToken),
          eq(atelierAssistantActions.state, "executing"),
        ),
      )
      .returning({ state: atelierAssistantActions.state, result: atelierAssistantActions.result });
    if (!updated) throw new Error("action-concurrency-conflict");
    await appendAssistantEventTx(tx, {
      orgId: row.orgId,
      conversationId: row.conversationId!,
      turnId: row.sourceTurnId!,
      correlationId: row.id,
      type: `action.${args.status}`,
      data: { actionId: row.id, result: args.result },
    });
    return { state: ActionStateV1Schema.parse(updated.state), result: updated.result };
  });
}