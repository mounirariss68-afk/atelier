import assert from "node:assert/strict";
import { MsGraphError } from "../../src/lib/msGraph.js";
import {
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

console.log("durable document email transport contract passed");