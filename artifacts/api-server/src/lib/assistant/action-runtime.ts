import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, atelierAssistantActions } from "@workspace/db";
import {
  ActionStateV1Schema,
  assertActionTransition,
  type ActionStateV1,
} from "@workspace/assistant-protocol";

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
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("assistant-ciphertext-invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]);
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
    return {
      state: ActionStateV1Schema.parse(updated.state),
      stateVersion: updated.stateVersion,
    };
  });
}