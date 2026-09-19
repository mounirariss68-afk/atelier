import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierAssistantActions,
  atelierAssistantEvents,
  atelierAssistantOutbox,
  atelierCliSessions,
  atelierCliTurns,
  atelierUsers,
} from "@workspace/db";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  backfillLegacyTurnMetadata,
  convertEligibleLegacyPendingWrite,
  verifyLegacyTurnMetadata,
} from "../../src/lib/assistant/legacy-turn-migration.js";
import { confirmAndExecuteDurableAccountUpdate } from "../../src/lib/assistant/durable-account-update-confirmation.js";

const suffix = randomUUID();
const orgId = `p_c19_org_${suffix}`;
const requesterId = `p_c19_user_${suffix}`;
const sessionId = `p_c19_session_${suffix}`;
const turnId = `p_c19_turn_${suffix}`;
const accountId = `p_c19_account_${suffix}`;
const previousCanary = process.env.RISER_DURABLE_ACCOUNT_UPDATE;
const previousCanaryOrgs = process.env.RISER_DURABLE_ACCOUNT_UPDATE_ORGS;

try {
  process.env.RISER_DURABLE_ACCOUNT_UPDATE = "1";
  process.env.RISER_DURABLE_ACCOUNT_UPDATE_ORGS = orgId;
  await db.insert(atelierUsers).values({
    id: requesterId,
    orgId,
    email: `${requesterId}@example.com`,
    name: "C19 migration requester",
    initials: "CM",
    role: "founding_partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
    permissions: [],
    bdActive: false,
  });
  await db.insert(atelierCliSessions).values({
    id: sessionId,
    orgId,
    userId: requesterId,
    createdByUserId: requesterId,
  });
  await db.insert(atelierAccounts).values({
    id: accountId,
    orgId,
    name: "Before migration",
    country: "UAE",
    sector: "Technology",
  });
  await db.insert(atelierCliTurns).values({
    id: turnId,
    orgId,
    sessionId,
    userId: requesterId,
    status: "awaiting_confirmation",
    prompt: "Archive the test account",
    frames: [{
      type: "needs_confirmation",
      data: {
        summary: "Update the test account",
        diff: {
          accountId,
          before: { name: "Ancient stale preview" },
          after: { name: "After migration" },
        },
        irreversible: false,
      },
    }],
    pendingWrite: {
      tool: "account_update",
      input: {
        id: accountId,
        name: "After migration",
        confirm: false,
      },
    },
  });

  const firstBackfill = await backfillLegacyTurnMetadata({ orgId });
  assert.equal(firstBackfill.scanned, 1);
  assert.equal(firstBackfill.updated, 1);
  assert.equal(firstBackfill.quarantined, 0);
  const secondBackfill = await backfillLegacyTurnMetadata({ orgId });
  assert.equal(secondBackfill.scanned, 0);
  assert.equal(secondBackfill.updated, 0);

  const [first, second] = await Promise.all([
    convertEligibleLegacyPendingWrite({ orgId, requesterId, turnId }),
    convertEligibleLegacyPendingWrite({ orgId, requesterId, turnId }),
  ]);
  assert.ok(
    first.status === "created" || first.status === "existing",
    `first conversion status: ${JSON.stringify(first)}`,
  );
  assert.ok(second.status === "created" || second.status === "existing");
  assert.ok("actionId" in first && "actionId" in second);
  assert.equal(second.actionId, first.actionId);
  assert.equal(
    [first.status, second.status].filter((status) => status === "created").length,
    1,
  );

  const actions = await db.select().from(atelierAssistantActions).where(and(
    eq(atelierAssistantActions.orgId, orgId),
    eq(atelierAssistantActions.sourceTurnId, turnId),
  ));
  assert.equal(actions.length, 1);
  assert.equal(actions[0].state, "awaiting_confirmation");
  assert.equal(actions[0].confirmedAt, null);
  assert.equal(actions[0].claimedAt, null);
  assert.equal(actions[0].completedAt, null);
  const migratedPreview = actions[0].previewSnapshot as {
    summary?: unknown;
    diff?: { before?: { name?: unknown } };
  };
  assert.equal(migratedPreview.summary, "Update account Before migration");
  assert.equal(migratedPreview.diff?.before?.name, "Before migration");
  const [retiredTurn] = await db.select().from(atelierCliTurns).where(
    eq(atelierCliTurns.id, turnId),
  );
  assert.equal(retiredTurn.pendingWrite, null);
  assert.ok(retiredTurn.pendingWriteRetiredAt instanceof Date);
  assert.equal(retiredTurn.durableActionId, first.actionId);
  const outbox = await db.select().from(atelierAssistantOutbox).where(
    eq(atelierAssistantOutbox.actionId, first.actionId),
  );
  assert.equal(outbox.length, 0);
  const executed = await confirmAndExecuteDurableAccountUpdate({
    actionId: first.actionId,
    orgId,
    requesterId,
    conversationId: sessionId,
    sourceTurnId: turnId,
    persona: {
      id: requesterId,
      orgId,
      role: "founding_partner",
    } as never,
    expectedStateVersion: actions[0].stateVersion,
  });
  assert.equal(executed.state, "succeeded");
  const [updatedAccount] = await db.select().from(atelierAccounts).where(
    eq(atelierAccounts.id, accountId),
  );
  assert.equal(updatedAccount.name, "After migration");

  const terminalTurnId = `p_c19_terminal_${suffix}`;
  const richTurnId = `p_c19_rich_${suffix}`;
  await db.insert(atelierCliTurns).values([
    {
      id: terminalTurnId,
      orgId,
      sessionId,
      userId: requesterId,
      status: "success",
      prompt: "stale terminal pending",
      frames: [{
        type: "needs_confirmation",
        data: { summary: "stale", diff: { accountId } },
      }],
      pendingWrite: {
        tool: "account_update",
        input: { id: accountId, name: "Must not execute" },
      },
    },
    {
      id: richTurnId,
      orgId,
      sessionId,
      userId: requesterId,
      status: "awaiting_confirmation",
      prompt: "untrusted rich pending",
      frames: [{
        type: "needs_confirmation",
        data: { summary: "rich", diff: { accountId } },
      }],
      pendingWrite: {
        capabilityId: "coverage.account_update",
        canonicalInput: { id: accountId, name: "Must not execute" },
        policyDecision: { effect: "allow" },
      },
    },
  ]);
  const edgeBackfill = await backfillLegacyTurnMetadata({ orgId });
  assert.equal(edgeBackfill.updated, 2);
  const terminal = await convertEligibleLegacyPendingWrite({
    orgId,
    requesterId,
    turnId: terminalTurnId,
  });
  assert.deepEqual(terminal, {
    status: "quarantined",
    reason: "turn_not_pending_confirmation",
  });
  const rich = await convertEligibleLegacyPendingWrite({
    orgId,
    requesterId,
    turnId: richTurnId,
  });
  assert.deepEqual(rich, { status: "quarantined", reason: "unsupported_shape" });
  const quarantinedTurns = await db.select().from(atelierCliTurns).where(
    and(
      eq(atelierCliTurns.orgId, orgId),
      isNull(atelierCliTurns.pendingWrite),
    ),
  );
  assert.ok(quarantinedTurns.some((turn) =>
    turn.id === terminalTurnId &&
    turn.quarantineReasons.includes("pending_write:turn_not_pending_confirmation")));
  assert.ok(quarantinedTurns.some((turn) =>
    turn.id === richTurnId &&
    turn.quarantineReasons.includes("pending_write:unsupported_shape")));
  const verification = await verifyLegacyTurnMetadata({ orgId });
  assert.equal(verification.pending, 0);
  assert.equal(verification.unconvertedPendingWrites, 0);
  assert.equal(verification.insufficientLegacyReaders, 0);
  console.log("legacy turn migration probe passed");
} finally {
  await db.delete(atelierAssistantEvents).where(eq(atelierAssistantEvents.orgId, orgId));
  await db.delete(atelierAssistantOutbox).where(eq(atelierAssistantOutbox.orgId, orgId));
  await db.delete(atelierAssistantActions).where(eq(atelierAssistantActions.orgId, orgId));
  await db.delete(atelierAccounts).where(eq(atelierAccounts.orgId, orgId));
  await db.delete(atelierCliTurns).where(eq(atelierCliTurns.orgId, orgId));
  await db.delete(atelierCliSessions).where(eq(atelierCliSessions.orgId, orgId));
  await db.delete(atelierUsers).where(eq(atelierUsers.orgId, orgId));
  if (previousCanary === undefined) delete process.env.RISER_DURABLE_ACCOUNT_UPDATE;
  else process.env.RISER_DURABLE_ACCOUNT_UPDATE = previousCanary;
  if (previousCanaryOrgs === undefined) delete process.env.RISER_DURABLE_ACCOUNT_UPDATE_ORGS;
  else process.env.RISER_DURABLE_ACCOUNT_UPDATE_ORGS = previousCanaryOrgs;
}