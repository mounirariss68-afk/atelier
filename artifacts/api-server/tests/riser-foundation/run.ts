import assert from "node:assert/strict";
import {
  AssistantRequestV1Schema,
  ASSISTANT_PRIVACY_POLICY_VERSION,
  LegacyAssistantRequestSchema,
  assistantValueContainsCanary,
  assertAssistantProviderAllowed,
  redactAssistantValue,
  sanitizeAssistantForSink,
  upcastLegacyAssistantRequest,
  upcastLegacyFrame,
  upcastLegacyPendingWrite,
  upcastLegacyTurnStatus,
  WorkPlanV1Schema,
  validateAcyclicWorkPlan,
} from "@workspace/assistant-protocol";
import {
  decryptAssistantValue,
  encryptAssistantValue,
} from "../../src/lib/assistant/action-runtime.js";

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
assert.equal(upcastLegacyTurnStatus("awaiting_clarification"), "awaiting_clarification");
assert.equal(upcastLegacyTurnStatus("unknown"), "failed");
for (const [legacy, expected] of [
  ["streaming", "running"],
  ["partial", "partially_succeeded"],
  ["success", "succeeded"],
  ["cancelled", "cancelled"],
  ["error", "failed"],
  ["read_only_no_op", "completed_without_effect"],
  ["async_dispatched", "work_dispatched"],
] as const) {
  assert.equal(upcastLegacyTurnStatus(legacy), expected);
}
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

const plantedPrivacyCanary = "RISER_CANARY_SECRET_NEVER_PERSIST";
for (const sink of ["public_response", "durable_event", "log", "telemetry"] as const) {
  const sanitized = sanitizeAssistantForSink({
    sink,
    value: {
      password: plantedPrivacyCanary,
      narration: `Contact private@example.com using ${plantedPrivacyCanary}`,
    },
  });
  assert.equal(assistantValueContainsCanary(sanitized), false);
  assert.equal(JSON.stringify(sanitized).includes("private@example.com"), false);
}
assert.deepEqual(
  assertAssistantProviderAllowed({
    provider: "anthropic",
    dataClasses: ["internal", "confidential"],
  }),
  { policyVersion: ASSISTANT_PRIVACY_POLICY_VERSION },
);
assert.throws(
  () => assertAssistantProviderAllowed({
    provider: "anthropic",
    dataClasses: ["secret"],
  }),
  /assistant-provider-data-class-denied/,
);
assert.throws(
  () => assertAssistantProviderAllowed({
    provider: "unknown-provider",
    dataClasses: ["public"],
  }),
  /assistant-provider-not-allowlisted/,
);

const step = {
  id: "a",
  capabilityId: "account.read",
  dependencies: [] as string[],
  input: { accountId: "acc_1" },
  authorityGrant: {},
  policyDecisionDigest: "d".repeat(64),
  toolsDataPerimeter: { toolIds: [], dataClasses: ["account"] },
  budget: { maxCostMicros: 1_000, maxToolCalls: 1, maxProviderCalls: 1 },
  resultSchemaHash: "e".repeat(12),
  retryPolicy: { maxAttempts: 2, maxWallMs: 1_000 },
};
const plan = WorkPlanV1Schema.parse({
  workItemId: "new",
  version: 1,
  goal: "Read an account",
  steps: [step],
});
validateAcyclicWorkPlan(plan);
assert.throws(
  () =>
    validateAcyclicWorkPlan({
      ...plan,
      steps: [step, { ...step }],
    }),
  /workflow-duplicate-step-id/,
);
assert.throws(
  () =>
    validateAcyclicWorkPlan({
      ...plan,
      steps: [{ ...step, dependencies: ["missing"] }],
    }),
  /workflow-missing-dependency/,
);
assert.throws(
  () =>
    validateAcyclicWorkPlan({
      ...plan,
      steps: [{ ...step, dependencies: [step.id] }],
    }),
  /workflow-cycle/,
);

process.env.SESSION_SECRET ??= "riser-foundation-test-session-secret-32-bytes";
const encrypted = encryptAssistantValue({ secret: "value" });
assert.deepEqual(decryptAssistantValue(encrypted), { secret: "value" });
assert.throws(() => decryptAssistantValue(`${encrypted}tampered`));
assert.throws(() => decryptAssistantValue(`v1.${"a".repeat(1_400_001)}`), /too-large/);

console.log("riser foundation probes passed");