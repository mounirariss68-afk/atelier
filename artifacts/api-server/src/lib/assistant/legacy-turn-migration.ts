import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  upcastPersistedTurnV1,
} from "@workspace/assistant-protocol";
import {
  db,
  atelierAccounts,
  atelierAssistantActions,
  atelierCliTurns,
  atelierUsers,
} from "@workspace/db";
import "../atelier-cli/bootstrap-capabilities.js";
import {
  capabilitiesForPersona,
  findByToolName,
} from "../atelier-cli/capability-catalog.js";
import {
  reviewedCapabilityManifestDocument,
} from "../atelier-cli/capability-manifest.js";
import { evaluateAssistantPolicy } from "./control-runtime.js";
import { durableAccountUpdateEnabled } from "./durable-account-update-canary.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import { canSeeAccount } from "../../routes/atelier/accountRoutes.js";
import {
  createDurableActionPreviewTx,
  digestAssistantValue,
} from "./action-runtime.js";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function confirmationFromFrames(frames: unknown): {
  summary: string;
  diff: unknown;
  irreversible: boolean;
} | null {
  if (!Array.isArray(frames)) return null;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = record(frames[index]);
    const data = record(frame?.data);
    if (
      frame?.type === "needs_confirmation" &&
      typeof data?.summary === "string" &&
      "diff" in (data ?? {})
    ) {
      return {
        summary: data.summary,
        diff: data.diff,
        irreversible: data.irreversible === true,
      };
    }
  }
  return null;
}

export async function backfillLegacyTurnMetadata(args: {
  orgId: string;
  limit?: number;
}): Promise<{
  scanned: number;
  updated: number;
  quarantined: number;
  verificationDigest: string;
}> {
  return db.transaction(async (tx) => {
  await tx.execute(sql`SELECT
    set_config('app.org_id', ${args.orgId}, true),
    set_config('app.user_id', '', true)`);
  const rows = await tx.select().from(atelierCliTurns).where(and(
    eq(atelierCliTurns.orgId, args.orgId),
    isNull(atelierCliTurns.persistedSchemaVersion),
  )).orderBy(asc(atelierCliTurns.createdAt), asc(atelierCliTurns.id))
    .limit(Math.max(1, Math.min(args.limit ?? 500, 5_000)));
  const digests: string[] = [];
  let updated = 0;
  let quarantined = 0;
  for (const row of rows) {
    const sourceVersions = {
      protocolVersion: null,
      promptVersion: null,
      catalogVersion: null,
      schemaVersion: 0,
      policyVersion: null,
    };
    const canonical = upcastPersistedTurnV1({
      turnId: row.id,
      status: row.status,
      prompt: row.prompt,
      frames: row.frames,
      pendingWrite: row.pendingWrite,
      source: sourceVersions,
    });
    const legacyPayloadDigest = digestAssistantValue(canonical.originalPayload);
    const [result] = await tx.update(atelierCliTurns).set({
      persistedSchemaVersion: canonical.schemaVersion,
      canonicalState: canonical.state,
      originalPayload: canonical.originalPayload,
      sourceVersions,
      legacyPayloadDigest,
      quarantineReasons: canonical.quarantineReasons,
      upcastedAt: new Date(),
      legacyReadUntil: new Date(Date.now() + 366 * 24 * 60 * 60 * 1_000),
      updatedAt: new Date(),
    }).where(and(
      eq(atelierCliTurns.id, row.id),
      eq(atelierCliTurns.orgId, args.orgId),
      isNull(atelierCliTurns.persistedSchemaVersion),
    )).returning({ id: atelierCliTurns.id });
    if (result) updated += 1;
    if (canonical.quarantined) quarantined += 1;
    digests.push(`${row.id}:${legacyPayloadDigest}:${canonical.state}`);
  }
  return {
    scanned: rows.length,
    updated,
    quarantined,
    verificationDigest: digestAssistantValue(digests),
  };
  });
}

export async function verifyLegacyTurnMetadata(args: {
  orgId: string;
}): Promise<{
  total: number;
  migrated: number;
  pending: number;
  quarantined: number;
  expiredLegacyReaders: number;
  insufficientLegacyReaders: number;
  unconvertedPendingWrites: number;
  digestMismatches: string[];
  verificationDigest: string;
}> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT
      set_config('app.org_id', ${args.orgId}, true),
      set_config('app.user_id', '', true)`);
    const rows = await tx.select({
      id: atelierCliTurns.id,
      persistedSchemaVersion: atelierCliTurns.persistedSchemaVersion,
      originalPayload: atelierCliTurns.originalPayload,
      legacyPayloadDigest: atelierCliTurns.legacyPayloadDigest,
      quarantineReasons: atelierCliTurns.quarantineReasons,
      legacyReadUntil: atelierCliTurns.legacyReadUntil,
      pendingWrite: atelierCliTurns.pendingWrite,
      durableActionId: atelierCliTurns.durableActionId,
    }).from(atelierCliTurns).where(
      eq(atelierCliTurns.orgId, args.orgId),
    ).orderBy(asc(atelierCliTurns.createdAt), asc(atelierCliTurns.id));
    const digestMismatches = rows
      .filter((row) =>
        row.persistedSchemaVersion !== null &&
        (
          row.originalPayload === null ||
          row.legacyPayloadDigest !== digestAssistantValue(row.originalPayload)
        ))
      .map((row) => row.id);
    const migratedRows = rows.filter((row) => row.persistedSchemaVersion === 1);
    const requiredReadUntil = Date.now() + 365 * 24 * 60 * 60 * 1_000;
    return {
      total: rows.length,
      migrated: migratedRows.length,
      pending: rows.filter((row) => row.persistedSchemaVersion === null).length,
      quarantined: migratedRows.filter((row) => row.quarantineReasons.length > 0).length,
      expiredLegacyReaders: migratedRows.filter(
        (row) => row.legacyReadUntil !== null && row.legacyReadUntil.getTime() <= Date.now(),
      ).length,
      insufficientLegacyReaders: migratedRows.filter(
        (row) => row.legacyReadUntil === null ||
          row.legacyReadUntil.getTime() < requiredReadUntil,
      ).length,
      unconvertedPendingWrites: rows.filter(
        (row) => row.pendingWrite !== null && row.durableActionId === null,
      ).length,
      digestMismatches,
      verificationDigest: digestAssistantValue(
        migratedRows.map((row) =>
          `${row.id}:${row.legacyPayloadDigest}:${row.quarantineReasons.join(",")}`),
      ),
    };
  });
}

export async function migrateAllLegacyTurns(args: {
  orgId: string;
  batchSize?: number;
}): Promise<{
  backfilled: number;
  converted: number;
  ineligible: number;
  verification: Awaited<ReturnType<typeof verifyLegacyTurnMetadata>>;
}> {
  const batchSize = Math.max(1, Math.min(args.batchSize ?? 500, 5_000));
  let backfilled = 0;
  for (;;) {
    const batch = await backfillLegacyTurnMetadata({
      orgId: args.orgId,
      limit: batchSize,
    });
    backfilled += batch.updated;
    if (batch.scanned === 0) break;
    if (batch.updated === 0) break;
  }
  const candidates = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT
      set_config('app.org_id', ${args.orgId}, true),
      set_config('app.user_id', '', true)`);
    return tx.select({
      id: atelierCliTurns.id,
      userId: atelierCliTurns.userId,
    }).from(atelierCliTurns).where(and(
      eq(atelierCliTurns.orgId, args.orgId),
      isNotNull(atelierCliTurns.pendingWrite),
      isNull(atelierCliTurns.durableActionId),
    )).orderBy(asc(atelierCliTurns.createdAt), asc(atelierCliTurns.id));
  });
  let converted = 0;
  let ineligible = 0;
  for (const candidate of candidates) {
    const result = await convertEligibleLegacyPendingWrite({
      orgId: args.orgId,
      requesterId: candidate.userId,
      turnId: candidate.id,
    });
    if (result.status === "created" || result.status === "existing") converted += 1;
    else ineligible += 1;
  }
  return {
    backfilled,
    converted,
    ineligible,
    verification: await verifyLegacyTurnMetadata({ orgId: args.orgId }),
  };
}

export async function convertEligibleLegacyPendingWrite(args: {
  orgId: string;
  requesterId: string;
  turnId: string;
}): Promise<
  | { status: "created" | "existing"; actionId: string; stateVersion: number }
  | { status: "quarantined"; reason: string }
  | { status: "not_found" }
> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT
      set_config('app.org_id', ${args.orgId}, true),
      set_config('app.user_id', ${args.requesterId}, true)`);
    const [turn] = await tx.select().from(atelierCliTurns).where(and(
      eq(atelierCliTurns.id, args.turnId),
      eq(atelierCliTurns.orgId, args.orgId),
      eq(atelierCliTurns.userId, args.requesterId),
    )).limit(1).for("update");
    if (!turn) return { status: "not_found" as const };
    if (turn.durableActionId) {
      return {
        status: "existing" as const,
        actionId: turn.durableActionId,
        stateVersion: 3,
      };
    }
    const quarantine = async (reason: string) => {
      await tx.update(atelierCliTurns).set({
        pendingWrite: null,
        pendingWriteRetiredAt: new Date(),
        quarantineReasons: [
          ...turn.quarantineReasons,
          `pending_write:${reason}`,
        ],
        updatedAt: new Date(),
      }).where(and(
        eq(atelierCliTurns.id, turn.id),
        eq(atelierCliTurns.orgId, args.orgId),
      ));
      return { status: "quarantined" as const, reason };
    };
    const pending = record(turn.pendingWrite);
    if (!pending) return quarantine("malformed_pending_write");
    if (
      turn.status !== "awaiting_confirmation" ||
      turn.canonicalState !== "awaiting_confirmation"
    ) {
      return quarantine("turn_not_pending_confirmation");
    }
    const legacyTool = typeof pending.tool === "string" ? pending.tool : null;
    const legacyInput = record(pending.input);
    const pinnedActionId = typeof legacyInput?.__durableActionId === "string"
      ? legacyInput.__durableActionId
      : null;
    if (pinnedActionId) {
      const [pinned] = await tx.select().from(atelierAssistantActions).where(and(
        eq(atelierAssistantActions.id, pinnedActionId),
        eq(atelierAssistantActions.orgId, args.orgId),
        eq(atelierAssistantActions.requesterId, args.requesterId),
        eq(atelierAssistantActions.sourceTurnId, turn.id),
      )).limit(1);
      if (!pinned) return quarantine("invalid_durable_action_pin");
      await tx.update(atelierCliTurns).set({
        durableActionId: pinned.id,
        pendingWrite: null,
        pendingWriteRetiredAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(atelierCliTurns.id, turn.id),
        eq(atelierCliTurns.orgId, args.orgId),
        isNull(atelierCliTurns.durableActionId),
      ));
      return {
        status: "existing" as const,
        actionId: pinned.id,
        stateVersion: pinned.stateVersion,
      };
    }
    if (legacyTool && legacyInput) {
      const catalog = findByToolName(legacyTool);
      const manifest = reviewedCapabilityManifestDocument().entries.find(
        (entry) => entry.toolName === legacyTool,
      );
      const [user] = await tx.select().from(atelierUsers).where(and(
        eq(atelierUsers.id, args.requesterId),
        eq(atelierUsers.orgId, args.orgId),
      )).limit(1);
      const confirmation = confirmationFromFrames(turn.frames);
      if (!catalog) return quarantine("catalog_entry_missing");
      if (!manifest) return quarantine("reviewed_manifest_entry_missing");
      if (!user) return quarantine("requester_missing");
      if (!confirmation) return quarantine("confirmation_snapshot_missing");
      if (!catalog.isWrite) return quarantine("not_a_write");
      if (manifest.executionStatus === "unsupported") {
        return quarantine("capability_unsupported");
      }
      if (
        catalog.id !== "coverage.account_update" ||
        !durableAccountUpdateEnabled(args.orgId)
      ) {
        return quarantine("durable_executor_not_enabled");
      }
      const roleAllowed = capabilitiesForPersona({
        id: user.id,
        name: user.name,
        orgId: user.orgId,
        role: user.role,
      }).some((entry) => entry.id === catalog.id && entry.isWrite);
      const allowedKeys = new Set(["id", "name", "status", "notes", "confirm", "commitToken"]);
      if (
        Object.keys(legacyInput).some((key) => !allowedKeys.has(key)) ||
        typeof legacyInput.id !== "string"
      ) {
        return quarantine("invalid_account_input");
      }
      const canonicalInput: Record<string, unknown> = { id: legacyInput.id };
      if (legacyInput.name !== undefined) {
        if (typeof legacyInput.name !== "string" || legacyInput.name.trim().length === 0) {
          return quarantine("invalid_account_name");
        }
        canonicalInput.name = legacyInput.name.trim();
      }
      if (legacyInput.status !== undefined) {
        if (
          typeof legacyInput.status !== "string" ||
          !new Set(["active", "dormant", "archived"]).has(legacyInput.status)
        ) {
          return quarantine("invalid_account_status");
        }
        canonicalInput.status = legacyInput.status;
      }
      if (legacyInput.notes !== undefined) {
        if (typeof legacyInput.notes !== "string") {
          return quarantine("invalid_account_notes");
        }
        canonicalInput.notes = legacyInput.notes;
      }
      if (Object.keys(canonicalInput).length === 1) {
        return quarantine("empty_account_patch");
      }
      const [account] = await tx.select().from(atelierAccounts).where(and(
        eq(atelierAccounts.id, legacyInput.id),
        eq(atelierAccounts.orgId, args.orgId),
        isNull(atelierAccounts.deletedAt),
      )).limit(1);
      if (!account) return quarantine("account_not_found");
      const persona = {
        id: user.id,
        name: user.name,
        orgId: user.orgId,
        role: user.role,
      };
      const access = await accessibleEngagementIds(persona);
      if (!roleAllowed || !(await canSeeAccount(access, persona, account.id))) {
        return quarantine("authorization_denied");
      }
      const policyDecision = await evaluateAssistantPolicy({
        orgId: args.orgId,
        capabilityId: catalog.id,
        baseAllowed: true,
        obligations: ["fresh_confirmation"],
        policyVersion: "riser-policy-v1",
      }, tx);
      if (policyDecision.effect !== "allow") {
        return quarantine("authorization_denied");
      }
      const changedFields = Object.keys(canonicalInput).filter((key) => key !== "id");
      const currentDiff = {
        accountId: account.id,
        changedFields,
        before: {
          ...(canonicalInput.name !== undefined ? { name: account.name } : {}),
          ...(canonicalInput.status !== undefined ? { status: account.status } : {}),
          ...(canonicalInput.notes !== undefined
            ? { notes: account.notes ? "(existing notes)" : null }
            : {}),
        },
        after: {
          ...(canonicalInput.name !== undefined ? { name: canonicalInput.name } : {}),
          ...(canonicalInput.status !== undefined ? { status: canonicalInput.status } : {}),
          ...(canonicalInput.notes !== undefined ? { notes: "(updated notes)" } : {}),
        },
      };
      const created = await createDurableActionPreviewTx(tx, {
        orgId: args.orgId,
        requesterId: args.requesterId,
        conversationId: turn.sessionId,
        sourceTurnId: turn.id,
        capabilityId: catalog.id,
        inputSchemaVersion: manifest.inputSchemaVersion,
        canonicalInput,
        targetRefsAndRevisions: [{
          type: "account",
          id: account.id,
          updatedAt: account.updatedAt.toISOString(),
        }],
        policyDecision,
        riskClass: "write",
        irreversible: false,
        outboundChannels: [],
        summary: `Update account ${account.name}`,
        diff: currentDiff,
        typedEvidence: typeof pending.typedNameExpected === "string"
          ? pending.typedNameExpected
          : undefined,
        expiresAt: new Date(Date.now() + 15 * 60 * 1_000),
        idempotencyKey: `legacy-turn:${turn.id}:pending-write`,
      });
      await tx.update(atelierCliTurns).set({
        durableActionId: created.actionId,
        pendingWrite: null,
        pendingWriteRetiredAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(atelierCliTurns.id, turn.id),
        eq(atelierCliTurns.orgId, args.orgId),
        isNull(atelierCliTurns.durableActionId),
      ));
      return {
        status: "created" as const,
        actionId: created.actionId,
        stateVersion: created.stateVersion,
      };
    }
    return quarantine("unsupported_shape");
  });
}