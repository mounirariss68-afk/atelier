import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import {
  ASSISTANT_PROTOCOL_VERSION,
  AssistantRequestV1Schema,
  upcastLegacyAssistantRequest,
} from "@workspace/assistant-protocol";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??= "riser-compat-session-secret-32-bytes";

const {
  assistantProtocolMetadata,
  canonicalToLegacyTurnRequest,
  compileAssistantSlashIntent,
} = await import("../../src/lib/assistant/compatibility.js");
const { demoChatExceptionAllowed } = await import("../../src/lib/auth/demoReadOnly.js");
const {
  db,
  pool,
  atelierUsers,
  atelierCliSessions,
  atelierCliTurns,
} = await import("@workspace/db");
const app = (await import("../../src/app.js")).default;

const canonical = AssistantRequestV1Schema.parse({
  protocolVersion: ASSISTANT_PROTOCOL_VERSION,
  conversationId: "conversation-1",
  prompt: "/new show my open work",
  attachmentIds: ["attachment-1"],
  clientTurnKey: "client-turn-1",
  locale: "en-AE",
  timezone: "Asia/Dubai",
});
const legacy = canonicalToLegacyTurnRequest(canonical);
assert.equal(legacy.sessionId, canonical.conversationId);
assert.equal(legacy.clientTurnKey, canonical.clientTurnKey);
assert.equal(legacy.locale, canonical.locale);
assert.deepEqual(
  JSON.parse(JSON.stringify(upcastLegacyAssistantRequest(legacy))),
  { ...canonical, pageContext: null },
);
assert.deepEqual(compileAssistantSlashIntent("/new show my open work"), {
  prompt: "show my open work",
  reset: true,
  command: "new",
});
assert.deepEqual(compileAssistantSlashIntent("/unknown keep it"), {
  prompt: "/unknown keep it",
  reset: false,
  command: null,
});
assert.deepEqual(assistantProtocolMetadata(), {
  protocolVersion: 1,
  minimumClientProtocolVersion: 1,
  presentationDataVersions: [1],
  canonicalTurnPath: "/api/assistant/turns",
  compatibilityTurnPath: "/api/atelier/cli/turn",
  workflowWritesEnabled: false,
  legacyReadRetention: true,
});
assert.equal(demoChatExceptionAllowed({
  method: "POST",
  path: "/assistant/turns",
  requestedPersonaId: "p_demo_reviewer",
}), true);
assert.equal(demoChatExceptionAllowed({
  method: "POST",
  path: "/assistant/turns",
  requestedPersonaId: "p_non_demo",
}), false);

const suffix = randomUUID();
const requesterId = `p_riser_compat_${suffix}`;
const orgId = `org_riser_compat_${suffix}`;
const foreignRequesterId = `p_riser_compat_foreign_${suffix}`;
const foreignOrgId = `org_riser_compat_foreign_${suffix}`;
const foreignSessionId = `session_riser_compat_foreign_${suffix}`;
const foreignTurnId = `turn_riser_compat_foreign_${suffix}`;
const replaySessionId = `session_riser_compat_replay_${suffix}`;
const legacyReplayTurnId = `turn_riser_compat_legacy_replay_${suffix}`;
const semanticReplayTurnId = `turn_riser_compat_semantic_replay_${suffix}`;
const proposedReplayTurnId = `turn_riser_compat_proposed_replay_${suffix}`;
await db.insert(atelierUsers).values({
  id: requesterId,
  orgId,
  email: `${requesterId}@example.com`,
  name: "Riser compatibility tester",
  initials: "RC",
  role: "founding_partner",
  roleLabel: "Founding Partner",
  title: "Founding Partner",
  permissions: [],
  bdActive: false,
});
await db.insert(atelierUsers).values({
  id: foreignRequesterId,
  orgId: foreignOrgId,
  email: `${foreignRequesterId}@example.com`,
  name: "Foreign compatibility tester",
  initials: "FC",
  role: "founding_partner",
  roleLabel: "Founding Partner",
  title: "Founding Partner",
  permissions: [],
  bdActive: false,
});
await db.insert(atelierCliSessions).values({
  id: foreignSessionId,
  orgId: foreignOrgId,
  userId: foreignRequesterId,
  createdByUserId: foreignRequesterId,
});
await db.insert(atelierCliTurns).values({
  id: foreignTurnId,
  orgId: foreignOrgId,
  sessionId: foreignSessionId,
  userId: foreignRequesterId,
  prompt: "foreign pending write",
  status: "awaiting_confirmation",
  frames: [],
  pendingWrite: { tool: "account_update", input: { id: "foreign-account" } },
  lastStepIdx: 0,
});
await db.insert(atelierCliSessions).values({
  id: replaySessionId,
  orgId,
  userId: requesterId,
  createdByUserId: requesterId,
});
await db.insert(atelierCliTurns).values([
  {
    id: legacyReplayTurnId,
    orgId,
    sessionId: replaySessionId,
    userId: requesterId,
    clientTurnKey: "legacy-replay-key",
    prompt: "legacy replay",
    status: "success",
    frames: [
      { type: "narration", data: { text: "legacy result" } },
      { type: "final", data: { status: "success" } },
    ],
    pendingWrite: null,
    lastStepIdx: 1,
  },
  {
    id: semanticReplayTurnId,
    orgId,
    sessionId: replaySessionId,
    userId: requesterId,
    clientTurnKey: "semantic-replay-key",
    prompt: "semantic replay",
    status: "success",
    frames: [
      {
        type: "narration",
        data: { text: "semantic result" },
        protocolVersion: 1,
        presentationDataVersion: 1,
        mode: "semantic",
        turnId: semanticReplayTurnId,
        sequence: 0,
        terminal: false,
      },
      {
        type: "tool_evidence",
        data: { hidden: true },
        protocolVersion: 1,
        presentationDataVersion: 1,
        mode: "semantic",
        turnId: semanticReplayTurnId,
        sequence: 4,
        terminal: false,
      },
      {
        type: "final",
        data: { status: "success" },
        protocolVersion: 1,
        presentationDataVersion: 1,
        mode: "semantic",
        turnId: semanticReplayTurnId,
        sequence: 5,
        terminal: true,
        outcome: {
          kind: "committed",
          committed: true,
          navigateTo: { path: "/accounts/test", when: "on_commit" },
        },
      },
    ],
    pendingWrite: null,
    lastStepIdx: 2,
  },
  {
    id: proposedReplayTurnId,
    orgId,
    sessionId: replaySessionId,
    userId: requesterId,
    clientTurnKey: "proposed-replay-key",
    prompt: "proposed replay",
    status: "awaiting_confirmation",
    frames: [
      {
        type: "needs_confirmation",
        data: { summary: "Review this action" },
        protocolVersion: 1,
        presentationDataVersion: 1,
        mode: "semantic",
        turnId: proposedReplayTurnId,
        sequence: 0,
        terminal: false,
      },
      {
        type: "final",
        data: { status: "awaiting_confirmation" },
        protocolVersion: 1,
        presentationDataVersion: 1,
        mode: "semantic",
        turnId: proposedReplayTurnId,
        sequence: 1,
        terminal: true,
        outcome: {
          kind: "proposed",
          committed: false,
          navigateTo: { path: "/accounts/test", when: "on_propose" },
        },
      },
    ],
    pendingWrite: { tool: "account_update", input: { id: "test" } },
    lastStepIdx: 1,
  },
]);

const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", resolve));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}/api`;
const cookie = `atelier_persona=${requesterId}`;
const demoCookie = "atelier_persona=p_demo_reviewer";
const canonicalHeaders = {
  "x-assistant-protocol-version": "1",
  "x-assistant-protocol-mode": "semantic",
  "x-assistant-presentation-versions": "1",
};
const parseSse = (body: string) =>
  body.split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);

try {
  const metadataResponse = await fetch(`${base}/assistant/protocol`, {
    headers: { cookie },
  });
  assert.equal(metadataResponse.status, 200);
  assert.deepEqual(await metadataResponse.json(), assistantProtocolMetadata());

  const invalidVersion = await fetch(`${base}/assistant/turns`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, ...canonicalHeaders },
    body: JSON.stringify({ ...canonical, protocolVersion: 2 }),
  });
  assert.equal(invalidVersion.status, 400);

  const unsupportedCanonical = await fetch(`${base}/assistant/turns`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: demoCookie,
      "x-assistant-protocol-version": "2",
    },
    body: JSON.stringify({ ...canonical, prompt: "account capabilities" }),
  });
  assert.equal(unsupportedCanonical.status, 426);

  const canonicalDemo = await fetch(`${base}/assistant/turns`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: demoCookie, ...canonicalHeaders },
    body: JSON.stringify({ ...canonical, prompt: "/new account capabilities" }),
  });
  assert.equal(canonicalDemo.status, 200);
  assert.equal(canonicalDemo.headers.get("x-assistant-protocol-version"), "1");
  assert.equal(canonicalDemo.headers.get("x-assistant-protocol-mode"), "semantic");
  assert.equal(canonicalDemo.headers.get("x-assistant-presentation-versions"), "1");
  const semanticFrames = parseSse(await canonicalDemo.text());
  assert.ok(semanticFrames.length > 0);
  assert.equal(
    semanticFrames.every((frame) => {
      const envelope = frame.__assistantEnvelope as Record<string, unknown> | undefined;
      return envelope?.protocolVersion === 1 &&
        envelope.presentationDataVersion === 1 &&
        envelope.mode === "semantic";
    }),
    true,
  );

  const legacyDemo = await fetch(`${base}/atelier/cli/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: demoCookie },
    body: JSON.stringify({ ...legacy, prompt: "/new account capabilities" }),
  });
  assert.equal(legacyDemo.status, 200);
  const legacyFrames = parseSse(await legacyDemo.text());
  assert.equal(legacyFrames.some((frame) => "__assistantEnvelope" in frame), false);
  const semanticPayloads = semanticFrames.map(
    ({ __assistantEnvelope: _envelope, turnId: _turnId, ...payload }) => payload,
  );
  const normalizedLegacyFrames = legacyFrames.map(
    ({ turnId: _turnId, ...payload }) => payload,
  );
  assert.deepEqual(semanticPayloads, normalizedLegacyFrames);

  for (const replay of [
    {
      key: "legacy-replay-key",
      turnId: legacyReplayTurnId,
      outcome: { kind: "read", committed: false, replayedIdempotent: true },
    },
    {
      key: "semantic-replay-key",
      turnId: semanticReplayTurnId,
      outcome: {
        kind: "committed",
        committed: true,
        navigateTo: { path: "/accounts/test", when: "on_commit" },
        replayedIdempotent: true,
      },
    },
    {
      key: "proposed-replay-key",
      turnId: proposedReplayTurnId,
      outcome: {
        kind: "proposed",
        committed: false,
        navigateTo: { path: "/accounts/test", when: "on_propose" },
        replayedIdempotent: true,
      },
    },
  ]) {
    const response = await fetch(`${base}/assistant/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...canonicalHeaders },
      body: JSON.stringify({
        protocolVersion: 1,
        conversationId: replaySessionId,
        prompt: "retry",
        clientTurnKey: replay.key,
      }),
    });
    assert.equal(response.status, 200);
    const frames = parseSse(await response.text());
    const envelopes = frames.map(
      (frame) => frame.__assistantEnvelope as Record<string, unknown>,
    );
    assert.equal(envelopes.every((envelope) => envelope.turnId === replay.turnId), true);
    const sequences = envelopes.map((envelope) => Number(envelope.sequence));
    assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
    const terminals = frames.filter((frame) =>
      (frame.__assistantEnvelope as Record<string, unknown>).terminal === true);
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].replay, true);
    assert.deepEqual(
      (terminals[0].__assistantEnvelope as { outcome?: unknown }).outcome,
      replay.outcome,
    );
  }

  const unsupportedLegacy = await fetch(`${base}/atelier/cli/turn`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-assistant-protocol-version": "2",
      "x-assistant-protocol-mode": "semantic",
      "x-assistant-presentation-versions": "1",
    },
    body: JSON.stringify(legacy),
  });
  assert.equal(unsupportedLegacy.status, 426);

  const foreignLegacyConfirm = await fetch(
    `${base}/assistant/actions/${foreignTurnId}/confirm`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...canonicalHeaders },
      body: JSON.stringify({ typedEvidence: "foreign" }),
    },
  );
  assert.equal(foreignLegacyConfirm.status, 404);
  assert.deepEqual(await foreignLegacyConfirm.json(), { code: "action_not_found" });

  const workflowCreate = await fetch(`${base}/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ goal: "unsafe client plan", policyContext: {}, plan: {} }),
  });
  assert.equal(workflowCreate.status, 503);
  assert.deepEqual(await workflowCreate.json(), { code: "workflow_writes_disabled" });

  console.log("riser compatibility probes passed");
} finally {
  await db.delete(atelierCliTurns).where(
    (await import("drizzle-orm")).eq(atelierCliTurns.sessionId, replaySessionId),
  );
  await db.delete(atelierCliSessions).where(
    (await import("drizzle-orm")).eq(atelierCliSessions.id, replaySessionId),
  );
  await db.delete(atelierCliTurns).where(
    (await import("drizzle-orm")).eq(atelierCliTurns.id, foreignTurnId),
  );
  await db.delete(atelierCliSessions).where(
    (await import("drizzle-orm")).eq(atelierCliSessions.id, foreignSessionId),
  );
  await db.delete(atelierUsers).where(
    (await import("drizzle-orm")).eq(atelierUsers.id, foreignRequesterId),
  );
  await db.delete(atelierUsers).where(
    (await import("drizzle-orm")).eq(atelierUsers.id, requesterId),
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}