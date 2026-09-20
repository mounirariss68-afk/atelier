// Scratch DB bootstrap must be the first import.
import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";

const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const orgId = `riser_http_org_${stamp}`;
const requesterId = `p_test_riser_http_${stamp}`;
const accountId = `acct_riser_http_${stamp}`;
const conversationId = `conv_riser_http_${stamp}`;
const turnId = `turn_riser_http_${stamp}`;

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ??= "riser-http-test-session-secret-32-bytes";
process.env.RISER_DURABLE_ACCOUNT_UPDATE = "1";
process.env.RISER_DURABLE_ACCOUNT_UPDATE_ORGS = orgId;

const D = await import("@workspace/db");
const {
  db,
  pool,
  atelierUsers,
  atelierAccounts,
  atelierAssistantActions,
  atelierAssistantEvents,
  atelierAuditEvents,
} = D;
await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
const { createDurableAccountUpdatePreview } = await import(
  "../../src/lib/assistant/durable-account-update-preview.js"
);
const { CANONICAL_ASSISTANT_HEADERS } = await import(
  "../../src/lib/assistant/compatibility.js"
);
const app = (await import("../../src/app.js")).default;

const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", resolve));
const { port } = server.address() as AddressInfo;
const api = `http://127.0.0.1:${port}/api/assistant`;

async function confirm(actionId: string, stateVersion: number) {
  const response = await fetch(`${api}/actions/${actionId}/confirm`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `atelier_persona=${requesterId}`,
      ...CANONICAL_ASSISTANT_HEADERS,
    },
    body: JSON.stringify({ stateVersion }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

try {
  await db.insert(atelierUsers).values({
    id: requesterId,
    orgId,
    email: `${requesterId}@example.com`,
    name: "Riser HTTP tester",
    initials: "RH",
    role: "founding_partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
    permissions: [],
    bdActive: false,
  });
  await db.insert(atelierAccounts).values({
    id: accountId,
    orgId,
    name: "Before HTTP race",
    country: "UAE",
    sector: "Technology",
  });
  const preview = await createDurableAccountUpdatePreview({
    persona: {
      id: requesterId,
      orgId,
      role: "founding_partner",
    } as never,
    conversationId,
    turnId,
    step: 0,
    input: { id: accountId, name: "After HTTP race", status: "dormant" },
  });
  const outcomes = await Promise.all(
    Array.from({ length: 20 }, () => confirm(preview.actionId, preview.stateVersion)),
  );
  assert.equal(outcomes.every((outcome) => outcome.status === 200), true);
  assert.equal(new Set(outcomes.map((outcome) => JSON.stringify(outcome.body))).size, 1);
  assert.equal(outcomes[0].body.state, "succeeded");
  const replay = await confirm(preview.actionId, preview.stateVersion);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, outcomes[0].body);

  const [account] = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, accountId));
  assert.equal(account.name, "After HTTP race");
  assert.equal(account.status, "dormant");
  const audits = await db
    .select()
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.orgId, orgId),
        eq(atelierAuditEvents.entityId, accountId),
        eq(atelierAuditEvents.action, "update"),
      ),
    );
  assert.equal(audits.length, 1);
  const terminalEvents = await db
    .select()
    .from(atelierAssistantEvents)
    .where(
      and(
        eq(atelierAssistantEvents.orgId, orgId),
        eq(atelierAssistantEvents.correlationId, preview.actionId),
        eq(atelierAssistantEvents.type, "action.succeeded"),
      ),
    );
  assert.equal(terminalEvents.length, 1);
  console.log("riser HTTP concurrency probes passed");
} finally {
  await db.delete(atelierAssistantEvents).where(eq(atelierAssistantEvents.orgId, orgId));
  await db.delete(atelierAssistantActions).where(eq(atelierAssistantActions.orgId, orgId));
  await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.orgId, orgId));
  await db.delete(atelierAccounts).where(eq(atelierAccounts.orgId, orgId));
  await db.delete(atelierUsers).where(eq(atelierUsers.id, requesterId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}