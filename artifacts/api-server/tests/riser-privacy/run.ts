import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  atelierAssistantEvents,
  atelierAssistantBlobPurgeQueue,
  atelierAssistantKeyAccessEvents,
  atelierAssistantPrivacyRunItems,
  atelierAssistantPrivacyRuns,
  atelierAssistantRetentionHolds,
  atelierCliAttachments,
  atelierCliSessions,
  atelierCliTurns,
} from "@workspace/db";
import {
  assistantValueContainsCanary,
  authorizeAssistantProviderPayload,
} from "@workspace/assistant-protocol";
import {
  ASSISTANT_PAYLOAD_RETENTION_DAYS,
  eraseUserAssistantData,
  quarantineLegacyAssistantTelemetry,
  runRetention,
} from "../../src/lib/atelier-cli/retention.js";
import {
  emitCliTelemetry,
  safeCliErrorMessage,
  sanitizeCliPersistence,
  sanitizeCliPublicResponse,
} from "../../src/lib/atelier-cli/privacy-sinks.js";
import { appendAssistantEvent } from "../../src/lib/assistant/event-runtime.js";

const suffix = randomUUID();
const orgId = `org_riser_privacy_${suffix}`;
const requesterId = `p_riser_privacy_${suffix}`;
const heldId = `ae_held_${suffix}`;
const purgeId = `ae_purge_${suffix}`;
const currentId = `ae_current_${suffix}`;
const eraseId = `ae_erase_${suffix}`;
const heldEraseId = `ae_held_erase_${suffix}`;
const holdIds = [`hold_retention_${suffix}`, `hold_erasure_${suffix}`];
const eventIds = [heldId, purgeId, currentId, eraseId, heldEraseId];
const keyAccessResourceId = `action_key_access_${suffix}`;
const sessionId = `cls_privacy_${suffix}`;
const heldSessionId = `cls_privacy_held_${suffix}`;
const legacyTurnId = `clt_privacy_${suffix}`;
const heldTurnId = `clt_privacy_held_${suffix}`;
const attachmentId = `cla_privacy_${suffix}`;
const heldAttachmentId = `cla_privacy_held_${suffix}`;
holdIds.push(`hold_session_${suffix}`);
const nowMs = Date.UTC(2026, 8, 20, 12);
const old = new Date(
  nowMs - (ASSISTANT_PAYLOAD_RETENTION_DAYS + 1) * 86_400_000,
);

await pool.query(
  readFileSync(
    new URL(
      "../../../../lib/db/drizzle/0085_riser_privacy_reconciliation.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);

await pool.query(
  readFileSync(
    new URL(
      "../../../../lib/db/drizzle/0086_riser_observability.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);

const event = (id: string, createdAt: Date, marker: string) => ({
  id,
  protocolVersion: 1,
  orgId,
  requesterId,
  conversationId: `conversation_${suffix}`,
  turnId: `turn_${id}`,
  sequence: 0,
  conversationSequence: eventIds.indexOf(id),
  correlationId: `correlation_${id}`,
  type: "privacy.fixture",
  data: { marker },
  occurredAt: createdAt,
  createdAt,
});

try {
  await db.insert(atelierAssistantEvents).values([
    event(heldId, old, "held-retention"),
    event(purgeId, old, "purge-retention"),
    event(currentId, new Date(nowMs), "current"),
    event(eraseId, new Date(nowMs), "erase-me"),
    event(heldEraseId, new Date(nowMs), "held-erasure"),
  ]);
  await db.insert(atelierAssistantRetentionHolds).values([
    {
      id: holdIds[0],
      orgId,
      resourceType: "assistant_event",
      resourceId: heldId,
      reason: "litigation fixture",
      createdByUserId: requesterId,
    },
    {
      id: holdIds[1],
      orgId,
      resourceType: "assistant_event",
      resourceId: heldEraseId,
      reason: "investigation fixture",
      createdByUserId: requesterId,
    },
    {
      id: holdIds[2],
      orgId,
      resourceType: "cli_session",
      resourceId: heldSessionId,
      reason: "parent hold fixture",
      createdByUserId: requesterId,
    },
  ]);
  await db.insert(atelierCliSessions).values([
    {
      id: sessionId,
      orgId,
      userId: requesterId,
      createdAt: old,
      updatedAt: old,
    },
    {
      id: heldSessionId,
      orgId,
      userId: requesterId,
      createdAt: old,
      updatedAt: old,
    },
  ]);
  await db.insert(atelierCliTurns).values([
    {
      id: legacyTurnId,
      orgId,
      sessionId,
      userId: requesterId,
      status: "success",
      prompt: "legacy fixture",
      recordingTrace: { marker: "legacy trace" },
      originalPayload: { marker: "legacy payload" },
      legacyReadUntil: old,
      createdAt: old,
      updatedAt: old,
    },
    {
      id: heldTurnId,
      orgId,
      sessionId: heldSessionId,
      userId: requesterId,
      status: "success",
      prompt: "held prompt fixture",
      recordingTrace: { marker: "held trace" },
      originalPayload: { marker: "held payload" },
      legacyReadUntil: old,
      createdAt: old,
      updatedAt: old,
    },
  ]);
  await db.insert(atelierCliAttachments).values([
    {
      id: attachmentId,
      orgId,
      userId: requesterId,
      sessionId,
      turnId: legacyTurnId,
      fileName: "privacy-fixture.txt",
      mime: "text/plain",
      sizeBytes: 7,
      sha256: "privacy-fixture",
      encryptedRef: "privacy-fixture-no-object",
      createdAt: old,
    },
    {
      id: heldAttachmentId,
      orgId,
      userId: requesterId,
      sessionId: heldSessionId,
      turnId: heldTurnId,
      fileName: "privacy-held-fixture.txt",
      mime: "text/plain",
      sizeBytes: 7,
      sha256: "privacy-held-fixture",
      encryptedRef: "privacy-held-fixture-no-object",
      createdAt: old,
    },
  ]);

  const quarantine = await quarantineLegacyAssistantTelemetry(nowMs, orgId);
  assert.equal(quarantine.rowsQuarantined, 1);
  const [ledgerItem] = await db
    .select()
    .from(atelierAssistantPrivacyRunItems)
    .where(eq(atelierAssistantPrivacyRunItems.sourceId, legacyTurnId));
  assert.equal(ledgerItem?.sourceType, "cli_turn");
  assert.equal(ledgerItem?.disposition, "payload_quarantined");
  assert.match(ledgerItem?.sourceDigest ?? "", /^[a-f0-9]{64}$/);

  const retention = await runRetention(nowMs, orgId);
  assert.equal(retention.eventPayloadsPurged, 1);
  const afterRetention = await db
    .select({ id: atelierAssistantEvents.id, data: atelierAssistantEvents.data })
    .from(atelierAssistantEvents)
    .where(inArray(atelierAssistantEvents.id, [heldId, purgeId, currentId]));
  const retentionById = new Map(afterRetention.map((row) => [row.id, row.data]));
  assert.deepEqual(retentionById.get(heldId), { marker: "held-retention" });
  assert.equal(retentionById.get(purgeId), null);
  assert.deepEqual(retentionById.get(currentId), { marker: "current" });
  const [purgedAttachment] = await db
    .select()
    .from(atelierCliAttachments)
    .where(eq(atelierCliAttachments.id, attachmentId));
  assert.equal(purgedAttachment?.encryptedRef, "");
  assert.equal(purgedAttachment?.status, "deleted");
  const [purgeQueue] = await db
    .select()
    .from(atelierAssistantBlobPurgeQueue)
    .where(eq(atelierAssistantBlobPurgeQueue.attachmentId, attachmentId));
  assert.equal(purgeQueue?.state, "completed");
  const [heldTurn, heldAttachment] = await Promise.all([
    db.select().from(atelierCliTurns).where(eq(atelierCliTurns.id, heldTurnId)),
    db
      .select()
      .from(atelierCliAttachments)
      .where(eq(atelierCliAttachments.id, heldAttachmentId)),
  ]);
  assert.equal(heldTurn[0]?.prompt, "held prompt fixture");
  assert.equal(heldAttachment[0]?.encryptedRef, "privacy-held-fixture-no-object");
  await db.insert(atelierAssistantBlobPurgeQueue).values({
    id: `abpq_held_${suffix}`,
    orgId,
    attachmentId: heldAttachmentId,
    encryptedRef: "privacy-held-fixture-no-object",
    state: "deleting",
    attempts: 1,
    queuedAt: old,
    updatedAt: old,
  });
  await runRetention(nowMs, orgId);
  const [heldDeletingQueue] = await db
    .select()
    .from(atelierAssistantBlobPurgeQueue)
    .where(eq(atelierAssistantBlobPurgeQueue.attachmentId, heldAttachmentId));
  assert.equal(heldDeletingQueue?.state, "deleting");

  await db
    .update(atelierAssistantRetentionHolds)
    .set({ releasedAt: new Date(nowMs), updatedAt: new Date(nowMs) })
    .where(eq(atelierAssistantRetentionHolds.id, holdIds[0]));
  const released = await runRetention(nowMs);
  assert.equal(released.eventPayloadsPurged >= 1, true);
  const [releasedEvent] = await db
    .select({ data: atelierAssistantEvents.data })
    .from(atelierAssistantEvents)
    .where(eq(atelierAssistantEvents.id, heldId));
  assert.equal(releasedEvent?.data, null);

  const erased = await eraseUserAssistantData({ orgId, userId: requesterId }, nowMs);
  assert.equal(erased.eventRowsErased >= 1, true);
  const afterErasure = await db
    .select({ id: atelierAssistantEvents.id, data: atelierAssistantEvents.data })
    .from(atelierAssistantEvents)
    .where(inArray(atelierAssistantEvents.id, [eraseId, heldEraseId]));
  const erasureById = new Map(afterErasure.map((row) => [row.id, row.data]));
  assert.equal(erasureById.get(eraseId), null);
  assert.deepEqual(erasureById.get(heldEraseId), { marker: "held-erasure" });
  const [heldTurnAfterErasure] = await db
    .select()
    .from(atelierCliTurns)
    .where(eq(atelierCliTurns.id, heldTurnId));
  assert.equal(heldTurnAfterErasure?.prompt, "held prompt fixture");
  assert.deepEqual(heldTurnAfterErasure?.recordingTrace, { marker: "held trace" });

  process.env.NODE_ENV = "test";
  process.env.SESSION_SECRET ??= "riser-privacy-test-session-secret-32-bytes";
  process.env.ASSISTANT_ENCRYPTION_KEY_V2 ??=
    "riser-privacy-assistant-encryption-key-v2";
  const {
    decryptAssistantValueAudited,
    encryptAssistantValue,
  } = await import("../../src/lib/assistant/action-runtime.js");
  const encrypted = encryptAssistantValue({
    accountId: "account_fixture",
    privateValue: "confidential fixture",
  });
  assert.equal(encrypted.startsWith("v2."), true);
  const decrypted = await decryptAssistantValueAudited({
    ciphertext: encrypted,
    orgId,
    requesterId,
    actorId: requesterId,
    resourceType: "assistant_action",
    resourceId: keyAccessResourceId,
    purpose: "privacy_rehearsal",
  });
  assert.deepEqual(decrypted, {
    accountId: "account_fixture",
    privateValue: "confidential fixture",
  });
  const [keyAccess] = await db
    .select()
    .from(atelierAssistantKeyAccessEvents)
    .where(eq(atelierAssistantKeyAccessEvents.resourceId, keyAccessResourceId));
  assert.equal(keyAccess?.keyVersion, "v2");
  assert.equal(keyAccess?.purpose, "privacy_rehearsal");

  const canary = "RISER_CANARY_SECRET_ALL_SINKS";
  const publicFrame = sanitizeCliPublicResponse({
    type: "presentation",
    data: {
      card: { password: canary },
      narration: `summary ${canary}`,
    },
  });
  const persistedTrace = sanitizeCliPersistence({
    trace: canary,
    summary: canary,
    error: { secret: canary },
  });
  assert.equal(assistantValueContainsCanary(publicFrame), false);
  assert.equal(assistantValueContainsCanary(persistedTrace), false);
  assert.equal(safeCliErrorMessage(new Error(canary)).includes(canary), false);

  const telemetryLines: string[] = [];
  const originalLog = console.log;
  try {
    console.log = (...args: unknown[]) => {
      telemetryLines.push(args.map(String).join(" "));
    };
    emitCliTelemetry({
      evt: "privacy_canary",
      query: canary,
      secret: canary,
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(telemetryLines.join("\n").includes(canary), false);

  const canaryEvent = await appendAssistantEvent({
    orgId,
    requesterId,
    conversationId: `conversation_canary_${suffix}`,
    turnId: `turn_canary_${suffix}`,
    correlationId: `correlation_canary_${suffix}`,
    type: "privacy.canary",
    data: { trace: canary, password: canary },
  });
  eventIds.push(canaryEvent.eventId);
  const [persistedCanaryEvent] = await db
    .select({ data: atelierAssistantEvents.data })
    .from(atelierAssistantEvents)
    .where(eq(atelierAssistantEvents.id, canaryEvent.eventId));
  assert.equal(assistantValueContainsCanary(persistedCanaryEvent?.data), false);

  const providerCanaryPayloads: Array<{ provider: string; payload: unknown }> = [
    {
      provider: "anthropic",
      payload: { messages: [{ role: "user", content: canary }] },
    },
    {
      provider: "cognidocs",
      payload: {
        fileBase64: "Zml4dHVyZQ==",
        fileName: "fixture.pdf",
        mimeType: "application/pdf",
        declaredType: "invoice",
        password: canary,
      },
    },
    {
      provider: "perplexity",
      payload: { messages: [{ role: "user", content: canary }] },
    },
    { provider: "ignav", payload: { path: "/search", body: { query: canary } } },
    { provider: "stayingapi", payload: { path: `/search?q=${canary}` } },
    {
      provider: "microsoft_graph",
      payload: { path: "/me/messages", body: { subject: canary } },
    },
  ];
  for (const fixture of providerCanaryPayloads) {
    assert.throws(
      () =>
        authorizeAssistantProviderPayload({
          provider: fixture.provider,
          declaredDataClasses: ["secret"],
          payload: fixture.payload,
        }),
      /assistant-provider-canary-denied/,
    );
  }

  let providerRequests = 0;
  const server = createServer((_request, response) => {
    providerRequests += 1;
    response.writeHead(500).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL =
      `http://127.0.0.1:${(address as { port: number }).port}`;
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "privacy-probe-key";
    const stubBase = `http://127.0.0.1:${(address as { port: number }).port}`;
    process.env.COGNIDOCS_BASE_URL = stubBase;
    process.env.COGNIDOCS_SANDBOX_API_KEY = "privacy-probe-key";
    process.env.ATELIER_PERPLEXITY_BASE_URL = stubBase;
    process.env.ATELIER_IGNAV_BASE_URL = stubBase;
    process.env.ATELIER_STAYING_BASE_URL = stubBase;
    const { getPrivacyAuthorizedAnthropic } = await import(
      "../../src/lib/assistant/provider-runtime.js"
    );
    const { anthropic } = await getPrivacyAuthorizedAnthropic({
      dataClasses: ["restricted"],
    });
    assert.throws(
      () =>
        anthropic.messages.create({
          model: "privacy-probe",
          max_tokens: 1,
          messages: [
            {
              role: "user",
              content: "RISER_CANARY_SECRET_PROVIDER_MUST_NOT_LEAVE",
            },
          ],
        }),
      /assistant-provider-canary-denied/,
    );
    assert.throws(
      () =>
        anthropic.messages.stream({
          model: "privacy-probe",
          max_tokens: 1,
          messages: [
            {
              role: "user",
              content: "RISER_CANARY_SECRET_STREAM_MUST_NOT_LEAVE",
            },
          ],
        }),
      /assistant-provider-canary-denied/,
    );
    const { submitCognidocsDocument } = await import(
      "../../src/lib/cognidocs/client.js"
    );
    const { perplexitySearch } = await import(
      "../../src/lib/atelier-agents/perplexity.js"
    );
    const { ignavAirportSuggestions, stayingSearchHotels } = await import(
      "../../src/lib/atelier-agents/travel-providers.js"
    );
    const { sendMailMessage } = await import("../../src/lib/msGraph.js");
    await assert.rejects(
      () =>
        submitCognidocsDocument({
          bytes: Buffer.from("fixture"),
          fileName: "fixture.pdf",
          mimeType: "application/pdf",
          declaredType: "invoice",
          password: canary,
        }),
      /assistant-provider-canary-denied/,
    );
    await assert.rejects(
      () => perplexitySearch(canary),
      /assistant-provider-canary-denied/,
    );
    await assert.rejects(
      () => ignavAirportSuggestions(canary),
      /assistant-provider-canary-denied/,
    );
    await assert.rejects(
      () =>
        stayingSearchHotels({
          location: canary,
          checkInDate: "2026-10-01",
          checkOutDate: "2026-10-02",
          adults: 1,
          pollCapMs: 1_000,
        }),
      /assistant-provider-canary-denied/,
    );
    await assert.rejects(
      () =>
        sendMailMessage("privacy-probe-access-token", {
          subject: canary,
          bodyText: "fixture",
          to: [{ email: "fixture@example.com" }],
          attachments: [],
        }),
      /assistant-provider-canary-denied/,
    );
    assert.equal(providerRequests, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  console.log("riser privacy retention, encryption, and provider probes passed");
} finally {
  await db
    .delete(atelierAssistantKeyAccessEvents)
    .where(eq(atelierAssistantKeyAccessEvents.resourceId, keyAccessResourceId));
  await db
    .delete(atelierAssistantPrivacyRunItems)
    .where(eq(atelierAssistantPrivacyRunItems.orgId, orgId));
  await db
    .delete(atelierAssistantPrivacyRuns)
    .where(eq(atelierAssistantPrivacyRuns.orgId, orgId));
  await db
    .delete(atelierAssistantBlobPurgeQueue)
    .where(eq(atelierAssistantBlobPurgeQueue.orgId, orgId));
  await db
    .delete(atelierAssistantRetentionHolds)
    .where(inArray(atelierAssistantRetentionHolds.id, holdIds));
  await db
    .delete(atelierAssistantEvents)
    .where(inArray(atelierAssistantEvents.id, eventIds));
  await db
    .delete(atelierCliAttachments)
    .where(inArray(atelierCliAttachments.id, [attachmentId, heldAttachmentId]));
  await db
    .delete(atelierCliTurns)
    .where(inArray(atelierCliTurns.id, [legacyTurnId, heldTurnId]));
  await db
    .delete(atelierCliSessions)
    .where(inArray(atelierCliSessions.id, [sessionId, heldSessionId]));
  await pool.end();
}