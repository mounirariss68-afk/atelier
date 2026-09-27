import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildHighRiskCoverageMatrix,
  EXECUTABLE_ACTION_EVIDENCE,
  KNOWN_MISSING_HIGH_RISK_IDS,
  reviewedCapabilityManifest,
  type ReviewedCapability,
} from "./coverage-matrix.js";

const here = resolve(import.meta.dirname);
const entries = reviewedCapabilityManifest.entries;
const matrix = buildHighRiskCoverageMatrix(entries);
const evidenceById = new Map(
  EXECUTABLE_ACTION_EVIDENCE.map((evidence) => [evidence.capabilityId, evidence]),
);
const knownMissingIds = new Set(KNOWN_MISSING_HIGH_RISK_IDS);

assert.equal(entries.length, reviewedCapabilityManifest.entryCount);
assert.equal(evidenceById.size, EXECUTABLE_ACTION_EVIDENCE.length, "duplicate action evidence");
assert.equal(knownMissingIds.size, KNOWN_MISSING_HIGH_RISK_IDS.length, "duplicate known-gap ID");

const missingIds = matrix
  .filter((row) => row.status === "missing")
  .map((row) => row.capabilityId);
const newlyMissingIds = missingIds.filter((id) => !knownMissingIds.has(id));
assert.deepEqual(
  newlyMissingIds,
  [],
  "new executable high-risk writes must have an action-specific runnable assertion/observation",
);

const supportedIds = new Set(
  matrix.filter((row) => row.status === "supported").map((row) => row.capabilityId),
);
for (const evidence of EXECUTABLE_ACTION_EVIDENCE) {
  assert.ok(supportedIds.has(evidence.capabilityId), `${evidence.capabilityId} is stale or not executable/high-risk`);
  assert.ok(evidence.scenarioId.trim());
  assert.ok(evidence.owner.trim());
  assert.ok(evidence.testLayer.trim());
  assert.ok(evidence.assertionMarker.trim());
  const testPath = resolve(here, "../..", evidence.testRef);
  assert.ok(existsSync(testPath), `missing test reference ${evidence.testRef}`);
  const source = readFileSync(testPath, "utf8");
  const capability = entries.find((entry) => entry.capabilityId === evidence.capabilityId);
  assert.ok(capability, `missing manifest capability ${evidence.capabilityId}`);
  assert.ok(
    source.includes(capability.toolName),
    `${evidence.testRef} must name tool ${capability.toolName}`,
  );
  assert.ok(
    source.includes(evidence.assertionMarker),
    `${evidence.testRef} is missing named runnable observation/assertion: ${evidence.assertionMarker}`,
  );
}

for (const id of missingIds) {
  assert.ok(knownMissingIds.has(id), `${id} must be tracked in the known-gap ratchet`);
}

const unsupportedIds = matrix
  .filter((row) => row.status === "unsupported")
  .map((row) => row.capabilityId);
assert.ok(unsupportedIds.length > 0, "reviewed unsupported high-risk actions should be reported");

const newlyExecutableWrite: ReviewedCapability = {
  capabilityId: "new.finance_dispatch",
  toolName: "new_finance_dispatch",
  effect: "write",
  effectClass: "outbound_write",
  executionStatus: "executable",
  policyClass: "outbound_write",
  confirmation: { irreversible: true, outboundChannel: "email" },
};
const withNewWrite = buildHighRiskCoverageMatrix([...entries, newlyExecutableWrite]);
assert.equal(
  withNewWrite.find((row) => row.capabilityId === newlyExecutableWrite.capabilityId)?.status,
  "missing",
);
assert.ok(
  withNewWrite.some((row) =>
    row.capabilityId === newlyExecutableWrite.capabilityId &&
    row.status === "missing" &&
    !knownMissingIds.has(row.capabilityId)
  ),
  "an unregistered executable write must be a new ratchet failure",
);

const newlyUnsupportedWrite = {
  ...newlyExecutableWrite,
  executionStatus: "unsupported" as const,
};
assert.equal(
  buildHighRiskCoverageMatrix([...entries, newlyUnsupportedWrite])
    .find((row) => row.capabilityId === newlyUnsupportedWrite.capabilityId)?.status,
  "unsupported",
);

console.log(
  `riser-eval coverage matrix: ${matrix.filter((row) => row.status === "supported").length} supported, ` +
  `${unsupportedIds.length} unsupported, ${missingIds.length} known missing`,
);