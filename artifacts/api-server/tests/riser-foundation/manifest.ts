import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  capabilityManifestVersion,
  generateCapabilityManifestDocumentV1,
  generateCapabilityManifestV1,
} from "../../src/lib/atelier-cli/capability-manifest.js";
import {
  findByToolName,
  listCapabilities,
  assertValidCapabilityInputSchema,
} from "../../src/lib/atelier-cli/capability-catalog.js";
import {
  CAPABILITY_DIVERGENCES,
  assertCapabilityDivergences,
} from "../../src/lib/atelier-cli/capability-divergences.js";

const manifest = generateCapabilityManifestV1();
const document = generateCapabilityManifestDocumentV1();
const checkedIn = JSON.parse(
  await readFile(
    new URL(
      "../../src/lib/atelier-cli/generated/capability-manifest.v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.deepEqual(checkedIn, document, "checked-in manifest must match runtime registry");
assert.equal(manifest.length, 326);
assert.equal(document.entryCount, 326);
assert.equal(document.manifestVersion, capabilityManifestVersion(manifest));
assert.equal(new Set(manifest.map((entry) => entry.capabilityId)).size, manifest.length);
assert.equal(new Set(manifest.map((entry) => entry.toolName)).size, manifest.length);
assert.match(capabilityManifestVersion(manifest), /^[a-f0-9]{64}$/);
assert.equal(CAPABILITY_DIVERGENCES.length, 3);
for (const invalidSchema of [
  { type: "object", additionalProperties: "yes" },
  { type: "object", properties: { value: { type: "string", minLength: -1 } } },
  { type: "object", properties: { value: { type: "string", enum: "not-an-array" } } },
  { type: "object", properties: { value: { type: "number", minimum: "zero" } } },
]) {
  assert.throws(
    () => assertValidCapabilityInputSchema(invalidSchema, "negative-probe"),
    /capability-invalid-json-schema/,
  );
}

for (const entry of manifest) {
  assert.match(entry.inputSchemaHash, /^[a-f0-9]{12}$/);
  assert.match(entry.resultSchemaHash, /^[a-f0-9]{12}$/);
  assert.match(entry.implementationVersion, /^[a-f0-9]{12}$/);
  assert.ok(entry.policyClass.length > 0, `${entry.capabilityId} policy class`);
  assert.ok(entry.effectClass.length > 0, `${entry.capabilityId} effect class`);
  assert.equal(entry.presentation.contractVersion, 1);
  assert.equal(entry.presentation.minimumDataVersion, 1);
  assertCapabilityDivergences(entry.divergenceIds);
  if (entry.effect === "write" && entry.executionStatus === "executable") {
    assert.equal(entry.confirmation.required, true, `${entry.capabilityId} must confirm`);
  }
  if (entry.executionStatus === "legacy_compat") {
    assert.ok(
      entry.divergenceIds.includes("legacy-confirmation-compat-v1"),
      `${entry.capabilityId} legacy confirmation divergence`,
    );
  }
  if (entry.source === "cli-only") {
    assert.ok(
      entry.divergenceIds.includes("cli-only-route-parity-v1"),
      `${entry.capabilityId} route-parity divergence`,
    );
  }
}

const capabilities = listCapabilities();
assert.equal(capabilities.length, manifest.length);
const agents = capabilities.filter((entry) => entry.source === "agent");
assert.equal(agents.length, 60);
assert.equal(capabilities.filter((entry) => entry.source === "cli-only").length, 266);
for (const agent of agents) {
  assert.equal(agent.executionStatus, "unsupported");
  assert.equal(agent.policyClass, "unsupported");
  assert.ok(agent.divergenceIds.includes("agent-executor-unsupported-v1"));
  assert.equal(findByToolName(agent.toolName), undefined);
  const result = await agent.run({}, {
    persona: { id: "test-user", name: "Test", role: "founding_partner", orgId: "test-org" },
    sessionId: "test-session",
    turnId: "test-turn",
  } as never);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "unsupported");
  assert.equal(JSON.stringify(result).includes("dispatched"), false);
}
for (const capability of capabilities) {
  assert.equal(typeof capability.run, "function", `${capability.id} executor`);
  assert.equal(capability.presentationContract.cardType, capability.resultCard);
  if (capability.isWrite) {
    assert.equal(
      (capability.run as unknown as { __navContractWrapped?: boolean }).__navContractWrapped,
      true,
      `${capability.id} write executor contract wrapper`,
    );
  }
}

console.log("riser capability manifest probes passed");