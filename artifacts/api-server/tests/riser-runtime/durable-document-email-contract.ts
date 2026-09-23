import assert from "node:assert/strict";
import { MsGraphError } from "../../src/lib/msGraph.js";
import {
  documentEmailReplayDisposition,
  executingDocumentEmailState,
  isAmbiguousTransportError,
} from "../../src/lib/assistant/durable-document-email.js";

// A transport failure is ambiguous because Microsoft Graph may have accepted
// the request before the connection failed. It must never be retried blindly.
assert.equal(isAmbiguousTransportError(new Error("socket closed")), true);
assert.equal(isAmbiguousTransportError(new MsGraphError("server error", 503)), true);
assert.equal(isAmbiguousTransportError(new MsGraphError("timeout", 408)), true);

// Auth and ordinary validation failures are known failures, not unknown
// provider outcomes; they may safely be surfaced as a reconnect/error result.
assert.equal(isAmbiguousTransportError(new MsGraphError("bad request", 400)), false);
assert.equal(isAmbiguousTransportError(new MsGraphError("unauthorized", 401)), false);
assert.equal(isAmbiguousTransportError(new MsGraphError("conflict", 409)), false);
assert.equal(isAmbiguousTransportError(new MsGraphError("payload too large", 413)), false);
assert.equal(isAmbiguousTransportError(new MsGraphError("rate limited", 429)), false);
assert.equal(isAmbiguousTransportError(new MsGraphError("unprocessable", 422)), false);

const now = new Date("2026-09-23T08:00:00.000Z").getTime();
assert.equal(
  executingDocumentEmailState(
    new Date("2026-09-23T07:59:00.000Z"),
    new Date("2026-09-23T07:59:00.000Z"),
    now,
  ),
  "in_progress",
  "a concurrent confirmation must not terminalize an active execution",
);
assert.equal(
  executingDocumentEmailState(
    new Date("2026-09-23T07:40:00.000Z"),
    new Date("2026-09-23T07:40:00.000Z"),
    now,
  ),
  "stale",
  "a crashed worker eventually becomes eligible for conservative unknown recovery",
);

const future = new Date("2026-09-23T08:10:00.000Z");
assert.deepEqual(
  documentEmailReplayDisposition([
    { id: "a1", state: "failed", stateVersion: 8, result: { outcome: "unknown" }, expiresAt: future },
  ], now),
  { kind: "blocked", reason: "provider_outcome_unknown" },
  "a new-turn replay must stay blocked until an unknown Graph outcome is reconciled",
);
assert.deepEqual(
  documentEmailReplayDisposition([
    { id: "a2", state: "executing", stateVersion: 5, result: null, expiresAt: future },
  ], now),
  { kind: "blocked", reason: "execution_in_progress" },
  "a concurrent new-turn replay must not create a second provider action",
);
assert.deepEqual(
  documentEmailReplayDisposition([
    { id: "a3", state: "awaiting_confirmation", stateVersion: 3, result: null, expiresAt: future },
  ], now),
  { kind: "reuse", actionId: "a3", stateVersion: 3 },
  "an identical pending preview is reused instead of duplicated",
);
assert.deepEqual(
  documentEmailReplayDisposition([
    { id: "a4", state: "succeeded", stateVersion: 7, result: { outcome: "succeeded" }, expiresAt: future },
  ], now),
  { kind: "new" },
  "a completed request may be intentionally repeated with fresh confirmation",
);

console.log("durable document email transport contract passed");
