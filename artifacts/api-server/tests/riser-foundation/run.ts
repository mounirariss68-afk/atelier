import assert from "node:assert/strict";
import {
  AssistantRequestV1Schema,
  LegacyAssistantRequestSchema,
  redactAssistantValue,
  upcastLegacyAssistantRequest,
  upcastLegacyFrame,
  upcastLegacyPendingWrite,
  upcastLegacyTurnStatus,
} from "@workspace/assistant-protocol";

const valid = {
  sessionId: "session-1",
  prompt: "Show the account",
  attachmentIds: ["attachment-1"],
  pageContext: {
    currentPath: "/accounts/account-1",
    surface: "account_workspace",
    activeAccountId: "account-1",
  },
  intent: "delete_everything",
};

const parsed = LegacyAssistantRequestSchema.parse(valid);
const upcast = upcastLegacyAssistantRequest(parsed);
assert.equal(upcast.protocolVersion, 1);
assert.equal(upcast.conversationId, "session-1");
assert.equal("intent" in upcast, false, "caller intent must not cross the V1 boundary");

for (const malicious of [
  { ...valid, unknown: true },
  { ...valid, pageContext: { ...valid.pageContext, foreignOrgId: "org-other" } },
  { ...valid, attachmentIds: Array.from({ length: 21 }, (_, i) => `a-${i}`) },
  { ...valid, prompt: "x".repeat(16_385) },
]) {
  assert.equal(LegacyAssistantRequestSchema.safeParse(malicious).success, false);
}

assert.equal(
  AssistantRequestV1Schema.safeParse({ ...upcast, intent: "write" }).success,
  false,
);

assert.equal(upcastLegacyTurnStatus("awaiting_confirmation"), "awaiting_confirmation");
assert.equal(upcastLegacyTurnStatus("unknown"), "failed");
assert.deepEqual(upcastLegacyFrame({ type: "final", data: { status: "success" } }), {
  sourceProtocol: "legacy-cli-frame",
  original: { type: "final", data: { status: "success" } },
  type: "legacy.final",
  data: { status: "success" },
});
assert.equal(upcastLegacyPendingWrite({ tool: "account_delete" }).requiresFreshConfirmation, true);

const canary = "a".repeat(40);
const redacted = JSON.stringify(
  redactAssistantValue({
    password: "plant-me",
    nested: { authorization: "Bearer abc", note: `value ${canary}` },
    email: "person@example.com",
  }),
);
assert.equal(redacted.includes("plant-me"), false);
assert.equal(redacted.includes(canary), false);
assert.equal(redacted.includes("person@example.com"), false);

console.log("riser foundation probes passed");