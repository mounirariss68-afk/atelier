import assert from "node:assert/strict";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  capabilityManifestVersion,
  generateCapabilityManifestV1,
} from "../../src/lib/atelier-cli/capability-manifest.js";
import {
  findByToolName,
  listCapabilities,
} from "../../src/lib/atelier-cli/capability-catalog.js";

const manifest = generateCapabilityManifestV1();
assert.equal(manifest.length, 326);
assert.equal(new Set(manifest.map((entry) => entry.capabilityId)).size, manifest.length);
assert.equal(new Set(manifest.map((entry) => entry.toolName)).size, manifest.length);
assert.match(capabilityManifestVersion(manifest), /^[a-f0-9]{64}$/);

for (const entry of manifest) {
  assert.match(entry.inputSchemaHash, /^[a-f0-9]{12}$/);
  assert.match(entry.resultSchemaHash, /^[a-f0-9]{12}$/);
  if (entry.effect === "write" && entry.executionStatus === "executable") {
    assert.equal(entry.confirmation.required, true, `${entry.capabilityId} must confirm`);
  }
}

const agents = listCapabilities().filter((entry) => entry.source === "agent");
assert.ok(agents.length > 0);
for (const agent of agents) {
  assert.equal(agent.executionStatus, "unsupported");
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

console.log("riser capability manifest probes passed");