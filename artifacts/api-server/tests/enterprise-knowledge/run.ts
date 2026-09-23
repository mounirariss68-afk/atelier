import assert from "node:assert/strict";
import {
  assertReviewedOntologyManifest, CURRENT_MEASURED_ENTERPRISE_KNOWLEDGE,
  evaluateMaterialization, evaluateReleaseGate, ontologyManifestHash,
  RELEASE_STAGES, REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST,
  REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST_HASH, proposeGovernanceChange,
  releaseEvidenceHash, reviewGovernanceChange, assertRuntimeReleaseApproval,
} from "../../src/lib/atelier-cli/enterprise-knowledge-governance.js";

assert.doesNotThrow(() => assertReviewedOntologyManifest({
  manifestVersion: REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST.manifestVersion,
  manifestHash: REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST_HASH,
}));
assert.throws(() => assertReviewedOntologyManifest({ manifestVersion: "v2", manifestHash: REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST_HASH }));
assert.notEqual(ontologyManifestHash({ ...REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST, lifecycle: "deprecated" }), REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST_HASH);
assert.equal(assertRuntimeReleaseApproval("5e54a4996ef7c0292fb565fb6437aaf4be2a0c7e613c58288e2593a036ebdd62"), "shadow");
assert.equal(evaluateMaterialization(CURRENT_MEASURED_ENTERPRISE_KNOWLEDGE).mode, "federation");
const justified = evaluateMaterialization({ traversalDepth: 9, volume: 999999, p95LatencyMs: 900, freshnessLagMinutes: 20, retrievalQuality: 0.99, costMicros: 900, incidents: 0, leakCount: 0 });
assert.equal(justified.mode, "materialization");
assert.deepEqual(justified.requiredControls, ["source_revisions", "tombstones", "generation_build", "atomic_generation_swap", "reconciliation", "rebuild", "rollback"]);
const evidence = {
  reportVersion: "enterprise-knowledge-eval/v1" as const,
  metrics: CURRENT_MEASURED_ENTERPRISE_KNOWLEDGE,
  sampleSize: 120,
  windowStartedAt: "2026-09-01T00:00:00.000Z",
  windowEndedAt: "2026-09-08T00:00:00.000Z",
  personaCoverage: ["founding_partner", "partner", "senior_manager", "employee", "contractor"],
  producer: "enterprise-knowledge-eval",
  reviewerRoles: ["security_reviewer", "privacy_reviewer"] as const,
  reconciliationDigest: "a".repeat(64),
  accessAuditDigest: "b".repeat(64),
};
const reviewedEvidenceHash = releaseEvidenceHash(evidence);
assert.equal(evaluateReleaseGate({ stage: "shadow", killSwitchEnabled: true, evidence, reviewedEvidenceHash, rollbackProcedureReady: true }).passed, true);
assert.equal(evaluateReleaseGate({ stage: "canary", killSwitchEnabled: true, evidence, reviewedEvidenceHash, rollbackProcedureReady: true, completedStages: ["shadow"], canaryCohort: "security-team", reconciliationComplete: true, accessAuditComplete: true }).passed, true);
assert.equal(evaluateReleaseGate({ stage: "canary", killSwitchEnabled: false, completedStages: ["shadow"], rollbackProcedureReady: true }).passed, false);
assert.equal(evaluateReleaseGate({ stage: "shadow", killSwitchEnabled: true, rollbackProcedureReady: true }).passed, false);
assert.equal(evaluateReleaseGate({ stage: "shadow", killSwitchEnabled: true, evidence, reviewedEvidenceHash: "c".repeat(64), rollbackProcedureReady: true }).passed, false);
assert.equal(evaluateMaterialization({ ...CURRENT_MEASURED_ENTERPRISE_KNOWLEDGE, p95LatencyMs: Number.NaN }).mode, "federation");
assert.equal(RELEASE_STAGES.join("->"), "shadow->canary->general_availability");
const proposal = proposeGovernanceChange({ id: "g-1", proposerId: "owner-1", proposerRole: "enterprise_knowledge_owner", summary: "review shape", manifestVersion: REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST.manifestVersion });
assert.throws(() => reviewGovernanceChange(proposal.proposal, { proposalId: "g-1", reviewerId: "owner-1", reviewerRole: "security_reviewer", approved: true }));
assert.throws(() => proposeGovernanceChange({ id: "g-2", proposerId: "x", proposerRole: "consultant", summary: "bad", manifestVersion: REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST.manifestVersion }));
assert.equal(reviewGovernanceChange(proposal.proposal, { proposalId: "g-1", reviewerId: "reviewer-1", reviewerRole: "security_reviewer", approved: true }).event, "reviewed");
console.log("enterprise knowledge governance: PASS");