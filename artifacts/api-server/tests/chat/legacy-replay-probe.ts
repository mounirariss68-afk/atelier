import assert from "node:assert/strict";
import {
  upcastPersistedTurnV1,
  type AssistantTurnStateV1,
} from "@workspace/assistant-protocol";

const cases: Array<[string, AssistantTurnStateV1]> = [
  ["streaming", "running"],
  ["awaiting_clarification", "awaiting_clarification"],
  ["awaiting_confirmation", "awaiting_confirmation"],
  ["cancelled", "cancelled"],
  ["partial", "partially_succeeded"],
  ["error", "failed"],
  ["success", "succeeded"],
  ["read_only_no_op", "completed_without_effect"],
  ["async_dispatched", "work_dispatched"],
];

for (const [legacyStatus, expectedState] of cases) {
  const input = {
    turnId: `turn-${legacyStatus}`,
    status: legacyStatus,
    prompt: `prompt-${legacyStatus}`,
    frames: [
      { type: "text", data: { text: legacyStatus } },
      { type: "final", data: { status: legacyStatus } },
    ],
    source: {
      protocolVersion: "legacy-cli",
      promptVersion: "prompt-v0",
      catalogVersion: "catalog-v0",
      schemaVersion: 0,
      policyVersion: "policy-v0",
    },
  };
  const first = upcastPersistedTurnV1(input);
  const second = upcastPersistedTurnV1(input);
  assert.deepEqual(first, second, `${legacyStatus} upcast must be deterministic`);
  assert.equal(first.state, expectedState);
  assert.equal(first.quarantined, false);
  assert.equal(first.frames.length, 2);
  assert.deepEqual(first.frames[0].original, input.frames[0]);
  assert.deepEqual(first.source, input.source);
  assert.deepEqual(first.originalPayload, {
    status: input.status,
    prompt: input.prompt,
    frames: input.frames,
    pendingWrite: null,
  });
}

const clarification = upcastPersistedTurnV1({
  turnId: "turn-clarification",
  status: "awaiting_clarification",
  prompt: "Book a flight",
  frames: [
    { type: "needs_clarification", data: { question: "Which date?" } },
  ],
});
assert.deepEqual(clarification.clarificationRef, {
  turnId: "turn-clarification",
  frameSequence: 0,
});

const pending = { tool: "account_update", input: { id: "acc-1" }, confirm: true };
const confirmation = upcastPersistedTurnV1({
  turnId: "turn-confirmation",
  status: "awaiting_confirmation",
  prompt: "Update Acme",
  frames: [{ type: "needs_confirmation", data: { summary: "Update Acme" } }],
  pendingWrite: pending,
});
assert.deepEqual(confirmation.pendingActionCandidate, {
  sourceTurnId: "turn-confirmation",
  idempotencyKey: "legacy-turn:turn-confirmation:pending-write",
  requiresFreshConfirmation: true,
  eligible: true,
  original: pending,
});
assert.notEqual(confirmation.state, "succeeded");

const unknown = upcastPersistedTurnV1({
  turnId: "turn-unknown",
  status: "mystery",
  prompt: 42,
  frames: [null, "bad-frame", { data: { hidden: true } }],
});
assert.equal(unknown.state, "failed");
assert.equal(unknown.quarantined, true);
assert.equal(unknown.prompt, "");
assert.ok(unknown.frames.every((frame) => frame.type === "compatibility.quarantined"));
assert.deepEqual(unknown.quarantineReasons, [
  "unknown_turn_status",
  "unknown_frame_type:0",
  "unknown_frame_type:1",
  "unknown_frame_type:2",
]);
assert.deepEqual(unknown.frames.map((frame) => frame.original), [
  null,
  "bad-frame",
  { data: { hidden: true } },
]);

console.log(`legacy replay probes passed (${cases.length} statuses)`);