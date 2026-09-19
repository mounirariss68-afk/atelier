import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  db,
  atelierAssistantActions,
  atelierAssistantKeyAccessEvents,
} from "@workspace/db";
import {
  ActionPreviewV1Schema,
  ActionStateV1Schema,
  PolicyDecisionV1Schema,
  assertActionTransition,
  type ActionStateV1,
  type PolicyDecisionV1,
} from "@workspace/assistant-protocol";
import { appendAssistantEventTx } from "./event-runtime.js";
import { evaluateAssistantPolicy } from "./control-runtime.js";
import {
  assertCurrentCapabilityManifestVersion,
  currentCapabilityManifestVersion,
  reviewedCapabilityManifestEntry,
} from "../atelier-cli/capability-manifest.js";

const TERMINAL = new Set<ActionStateV1>([
  "succeeded",
  "failed",
  "partially_succeeded",
  "compensated",
  "cancelled",
  "expired",
  "invalidated",
]);

async function authoritativePolicy(
  orgId: string,
  capabilityId: string,
  proposed: PolicyDecisionV1,
  executor: Pick<typeof db, "select"> = db,
): Promise<PolicyDecisionV1> {
  const candidate = PolicyDecisionV1Schema.parse(proposed);
  return evaluateAssistantPolicy({
    orgId,
    capabilityId,
    baseAllowed: candidate.effect === "allow",
    obligations: candidate.effect === "allow" ? candidate.obligations : [],
    policyVersion: candidate.policyVersion,
  }, executor);
}

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

function encryptionKey(version: "v1" | "v2"): Buffer {
  const dedicated = process.env.ASSISTANT_ENCRYPTION_KEY_V2;
  const root =
    version === "v2"
      ? dedicated ||
        (!process.env.REPLIT_DEPLOYMENT ? process.env.SESSION_SECRET : undefined)
      : process.env.SESSION_SECRET;
  if (!root || root.length < 32) throw new Error("assistant-encryption-key-unavailable");
  const salt =
    version === "v1" ? "atelier-riser-v1" : "atelier-riser-v2";
  const info =
    version === "v1" ? "action-input" : "assistant-sensitive-payload";
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(root),
      Buffer.from(salt),
      Buffer.from(info),
      32,
    ),
  );
}

export function encryptAssistantValue(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey("v2"), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptAssistantValue(value: string): unknown {
  if (value.length > 1_400_000) throw new Error("assistant-ciphertext-too-large");
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if ((version !== "v1" && version !== "v2") || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("assistant-ciphertext-invalid");
  }
  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  const ciphertext = Buffer.from(ciphertextRaw, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 1_048_576) {
    throw new Error("assistant-ciphertext-invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(version),
    iv,
  );
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  if (plaintext.length > 1_048_576) throw new Error("assistant-plaintext-too-large");
  return JSON.parse(plaintext.toString("utf8")) as unknown;
}

export function decryptAssistantValueForTest(value: string): unknown {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("assistant-test-decrypt-disabled");
  }
  return decryptAssistantValue(value);
}

export async function decryptAssistantValueAudited(
  args: {
    ciphertext: string;
    orgId: string;
    requesterId: string;
    actorId: string;
    resourceType: "assistant_action" | "work_step";
    resourceId: string;
    purpose: string;
  },
  executor: Pick<typeof db, "insert"> = db,
): Promise<unknown> {
  const keyVersion = args.ciphertext.split(".", 1)[0] || "unknown";
  const value = decryptAssistantValue(args.ciphertext);
  await executor.insert(atelierAssistantKeyAccessEvents).values({
    id: `aka_${randomUUID()}`,
    orgId: args.orgId,
    requesterId: args.requesterId,
    actorId: args.actorId,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    purpose: args.purpose,
    keyVersion,
  });
  return value;
}

export async function cancelDurableAction(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
}): Promise<{ state: ActionStateV1; stateVersion: number }> {
  return withAssistantRlsTransaction(args, async (tx) => {
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
        requesterId: row.requesterId,
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

export type AssistantActionTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withAssistantRlsTransaction<T>(
  args: { orgId: string; requesterId: string },
  fn: (tx: AssistantActionTransaction) => Promise<T>,
): Promise<T> {
  if (!args.orgId || !args.requesterId) {
    throw new Error("assistant-rls-context-required");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT
      set_config('app.org_id', ${args.orgId}, true),
      set_config('app.user_id', ${args.requesterId}, true)`);
    return fn(tx);
  });
}

export async function withAssistantLifecycleRlsTransaction<T>(
  args: { orgId: string },
  fn: (tx: AssistantActionTransaction) => Promise<T>,
): Promise<T> {
  if (!args.orgId) throw new Error("assistant-lifecycle-org-required");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT
      set_config('app.org_id', ${args.orgId}, true),
      set_config('app.user_id', 'system:retention', true)`);
    await tx.execute(sql.raw("SET LOCAL ROLE atelier_retention_executor"));
    return fn(tx);
  });
}

export async function createDurableActionPreviewTx(
  tx: AssistantActionTransaction,
  args: {
  orgId: string;
  requesterId: string;
  conversationId: string;
  sourceTurnId: string;
  capabilityId: string;
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
  const catalogVersion = currentCapabilityManifestVersion();
  const manifestEntry = reviewedCapabilityManifestEntry(args.capabilityId);
  if (
    !manifestEntry ||
    manifestEntry.executionStatus === "unsupported" ||
    manifestEntry.effect !== "write" ||
    manifestEntry.inputSchemaVersion !== args.inputSchemaVersion ||
    manifestEntry.confirmation.irreversible !== args.irreversible ||
    JSON.stringify([...manifestEntry.confirmation.outboundChannel ? [manifestEntry.confirmation.outboundChannel] : []].sort()) !==
      JSON.stringify([...args.outboundChannels].sort())
  ) {
    throw new Error("action-capability-manifest-mismatch");
  }
  const policy = await authoritativePolicy(
    args.orgId,
    args.capabilityId,
    args.policyDecision,
    tx,
  );
  if (policy.effect !== "allow") throw new Error("action-policy-not-allowed");
  if (args.expiresAt.getTime() <= Date.now()) throw new Error("action-expiry-invalid");
  const inputDigest = digestAssistantValue(args.canonicalInput);
  const typedEvidenceDigest = args.typedEvidence
    ? digestAssistantValue(args.typedEvidence)
    : null;
  const requestDigest = digestAssistantValue({
    capabilityId: args.capabilityId,
    catalogVersion,
    inputSchemaVersion: args.inputSchemaVersion,
    inputDigest,
    targetRefsAndRevisions: args.targetRefsAndRevisions,
    policyVersion: policy.policyVersion,
    policyDecisionDigest: policy.decisionDigest,
    obligations: [...policy.obligations].sort(),
    riskClass: args.riskClass,
    irreversible: args.irreversible,
    outboundChannels: [...args.outboundChannels].sort(),
    summary: args.summary,
    diff: args.diff,
    typedEvidenceDigest,
  });
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

  const existing = await tx
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
      existing[0].requestDigest !== requestDigest
    ) {
      throw new Error("action-idempotency-conflict");
    }
    return {
      actionId: existing[0].id,
      preview: existing[0].previewSnapshot,
      stateVersion: existing[0].stateVersion,
    };
  }

  await tx.insert(atelierAssistantActions).values({
      id: actionId,
      orgId: args.orgId,
      requesterId: args.requesterId,
      conversationId: args.conversationId,
      sourceTurnId: args.sourceTurnId,
      capabilityId: args.capabilityId,
      catalogVersion,
      inputSchemaVersion: args.inputSchemaVersion,
      inputDigest,
      requestDigest,
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
      requesterId: args.requesterId,
      conversationId: args.conversationId,
      turnId: args.sourceTurnId,
      correlationId: actionId,
      type: "action.awaiting_confirmation",
      data: { actionId, preview, stateVersion: 3 },
  });
  return { actionId, preview, stateVersion: 3 };
}

export async function createDurableActionPreview(
  args: Parameters<typeof createDurableActionPreviewTx>[1],
): Promise<{ actionId: string; preview: unknown; stateVersion: number }> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT
        set_config('app.org_id', ${args.orgId}, true),
        set_config('app.user_id', ${args.requesterId}, true)`);
      return createDurableActionPreviewTx(tx, args);
    });
  } catch {
    // A concurrent insert may win the unique idempotency key. Re-enter the
    // same transaction-aware constructor so it recomputes and compares the
    // request digest; never return an existing action by key alone.
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT
        set_config('app.org_id', ${args.orgId}, true),
        set_config('app.user_id', ${args.requesterId}, true)`);
      return createDurableActionPreviewTx(tx, args);
    });
  }
}

export async function confirmDurableAction(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
  expectedStateVersion: number;
  typedEvidence?: string;
  recheckPolicy: (action: typeof atelierAssistantActions.$inferSelect) => Promise<PolicyDecisionV1>;
}): Promise<{ state: "confirmed"; stateVersion: number }> {
  const outcome = await withAssistantRlsTransaction(args, async (tx) => {
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
    try {
      assertCurrentCapabilityManifestVersion(row.catalogVersion);
    } catch {
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
        requesterId: row.requesterId,
        conversationId: row.conversationId!,
        turnId: row.sourceTurnId!,
        correlationId: row.id,
        type: "action.invalidated",
        data: { actionId: row.id, reason: "manifest_version_unsupported" },
      });
      return {
        state: "manifest_unsupported" as const,
        stateVersion: invalidated.stateVersion,
      };
    }
    if (
      row.typedEvidenceDigest &&
      digestAssistantValue(args.typedEvidence ?? "") !== row.typedEvidenceDigest
    ) {
      throw new Error("action-typed-evidence-mismatch");
    }
    const policy = await authoritativePolicy(
      row.orgId,
      row.capabilityId,
      await args.recheckPolicy(row),
      tx,
    );
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
        requesterId: row.requesterId,
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
      requesterId: row.requesterId,
      conversationId: row.conversationId!,
      turnId: row.sourceTurnId!,
      correlationId: row.id,
      type: "action.confirmed",
      data: { actionId: row.id, stateVersion: updated.stateVersion },
    });
    return { state: "confirmed" as const, stateVersion: updated.stateVersion };
  });
  if (outcome.state === "invalidated") throw new Error("action-policy-drift");
  if (outcome.state === "manifest_unsupported") {
    throw new Error("action-manifest-version-unsupported");
  }
  return outcome;
}

export async function claimDurableAction(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
  recheckPolicy: (action: typeof atelierAssistantActions.$inferSelect) => Promise<PolicyDecisionV1>;
  recheckTargets: (targets: unknown[]) => Promise<boolean>;
}): Promise<{ fencingToken: number; input: unknown } | null> {
  return withAssistantRlsTransaction(args, async (tx) => {
    const [row] = await tx
      .select()
      .from(atelierAssistantActions)
      .where(
        and(
          eq(atelierAssistantActions.id, args.actionId),
          eq(atelierAssistantActions.orgId, args.orgId),
          eq(atelierAssistantActions.state, "confirmed"),
        ),
      )
      .for("update");
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      assertActionTransition("confirmed", "expired");
      await tx.update(atelierAssistantActions).set({
        state: "expired",
        stateVersion: row.stateVersion + 1,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(atelierAssistantActions.id, row.id),
        eq(atelierAssistantActions.state, "confirmed"),
      ));
      if (row.conversationId && row.sourceTurnId) {
        await appendAssistantEventTx(tx, {
          orgId: row.orgId,
          requesterId: row.requesterId,
          conversationId: row.conversationId,
          turnId: row.sourceTurnId,
          correlationId: row.id,
          type: "action.expired",
          data: { actionId: row.id },
        });
      }
      return null;
    }
    try {
      assertCurrentCapabilityManifestVersion(row.catalogVersion);
    } catch {
      await tx
        .update(atelierAssistantActions)
        .set({
          state: "invalidated",
          stateVersion: row.stateVersion + 1,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(atelierAssistantActions.id, row.id));
      await appendAssistantEventTx(tx, {
        orgId: row.orgId,
        requesterId: row.requesterId,
        conversationId: row.conversationId!,
        turnId: row.sourceTurnId!,
        correlationId: row.id,
        type: "action.invalidated",
        data: { actionId: row.id, reason: "manifest_version_unsupported" },
      });
      return null;
    }
    const policy = await authoritativePolicy(
      row.orgId,
      row.capabilityId,
      await args.recheckPolicy(row),
      tx,
    );
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
        requesterId: row.requesterId,
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
    if (row.conversationId && row.sourceTurnId) {
      await appendAssistantEventTx(tx, {
        orgId: row.orgId,
        requesterId: row.requesterId,
        conversationId: row.conversationId,
        turnId: row.sourceTurnId,
        correlationId: row.id,
        type: "action.executing",
        data: { actionId: row.id, fencingToken: fence },
      });
    }
    return {
      fencingToken: fence,
      input: await decryptAssistantValueAudited(
        {
          ciphertext: row.canonicalInputEncrypted,
          orgId: row.orgId,
          requesterId: row.requesterId,
          actorId: args.requesterId,
          resourceType: "assistant_action",
          resourceId: row.id,
          purpose: "claim_for_execution",
        },
        tx,
      ),
    };
  });
}

export async function completeDurableAction(args: {
  actionId: string;
  orgId: string;
  requesterId: string;
  fencingToken: number;
  status: "succeeded" | "failed" | "partially_succeeded" | "compensated";
  result: unknown;
}): Promise<{ state: ActionStateV1; result: unknown }> {
  return withAssistantRlsTransaction(args, async (tx) => {
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
      requesterId: row.requesterId,
      conversationId: row.conversationId!,
      turnId: row.sourceTurnId!,
      correlationId: row.id,
      type: `action.${args.status}`,
      data: { actionId: row.id, result: args.result },
    });
    return { state: ActionStateV1Schema.parse(updated.state), result: updated.result };
  });
}