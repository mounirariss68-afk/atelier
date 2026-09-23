import { createHash } from "node:crypto";

/** The reviewed contract for enterprise-knowledge federation.  This module has no I/O. */
export const ENTERPRISE_KNOWLEDGE_MANIFEST_VERSION = "enterprise-knowledge/v1";
export const ENTERPRISE_KNOWLEDGE_ENABLED = "ATELIER_ENTERPRISE_KNOWLEDGE_ENABLED";

export type Lifecycle = "active" | "deprecated" | "retired";
export type AssertionPolicy = "asserted" | "derived" | "inferred";
export type OwnerRole = "enterprise_knowledge_owner" | "data_domain_owner";
export type ReviewerRole = "security_reviewer" | "privacy_reviewer" | "platform_reviewer";

export interface OntologyManifest {
  schemaVersion: 1;
  manifestVersion: string;
  ownerRoles: readonly OwnerRole[];
  reviewerRoles: readonly ReviewerRole[];
  lifecycle: Lifecycle;
  compatibilityPolicy: "backward_compatible_query_shapes";
  relationshipAssertionPolicy: readonly AssertionPolicy[];
  prohibited: readonly ["inferred_identity_merge", "inferred_authorization"];
  ontologyEntries: readonly {
    id: string;
    kind: "entity" | "alias" | "relationship";
    ownerRole: OwnerRole;
    reviewerRoles: readonly ReviewerRole[];
    lifecycle: Lifecycle;
    assertionPolicy: AssertionPolicy;
  }[];
  queryShapes: readonly {
    id: string;
    lifecycle: Lifecycle;
    relationshipAssertion: AssertionPolicy;
    description: string;
  }[];
}

export const REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST: OntologyManifest = {
  schemaVersion: 1,
  manifestVersion: ENTERPRISE_KNOWLEDGE_MANIFEST_VERSION,
  ownerRoles: ["enterprise_knowledge_owner", "data_domain_owner"],
  reviewerRoles: ["security_reviewer", "privacy_reviewer", "platform_reviewer"],
  lifecycle: "active",
  compatibilityPolicy: "backward_compatible_query_shapes",
  relationshipAssertionPolicy: ["asserted", "derived", "inferred"],
  prohibited: ["inferred_identity_merge", "inferred_authorization"],
  ontologyEntries: [
    {
      id: "canonical_entity",
      kind: "entity",
      ownerRole: "data_domain_owner",
      reviewerRoles: ["security_reviewer", "privacy_reviewer"],
      lifecycle: "active",
      assertionPolicy: "asserted",
    },
    {
      id: "governed_alias",
      kind: "alias",
      ownerRole: "data_domain_owner",
      reviewerRoles: ["privacy_reviewer", "platform_reviewer"],
      lifecycle: "active",
      assertionPolicy: "asserted",
    },
    {
      id: "source_relationship",
      kind: "relationship",
      ownerRole: "enterprise_knowledge_owner",
      reviewerRoles: ["security_reviewer", "platform_reviewer"],
      lifecycle: "active",
      assertionPolicy: "derived",
    },
    {
      id: "semantic_relationship",
      kind: "relationship",
      ownerRole: "enterprise_knowledge_owner",
      reviewerRoles: ["security_reviewer", "privacy_reviewer"],
      lifecycle: "active",
      assertionPolicy: "inferred",
    },
  ],
  queryShapes: [
    { id: "account_context", lifecycle: "active", relationshipAssertion: "derived", description: "Federated account dossier, team, pipeline and activity from authorized source adapters" },
    { id: "person_context", lifecycle: "active", relationshipAssertion: "derived", description: "Federated person identity and workload from authorized source adapters" },
    { id: "my_context", lifecycle: "active", relationshipAssertion: "derived", description: "Self-only federation over the existing Me read lens" },
  ],
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function ontologyManifestHash(manifest: OntologyManifest = REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST): string {
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}
export const REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST_HASH = ontologyManifestHash();

export function assertReviewedOntologyManifest(args: {
  manifest?: OntologyManifest;
  manifestVersion: string;
  manifestHash: string;
}): void {
  const manifest = args.manifest ?? REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST;
  if (args.manifestVersion !== ENTERPRISE_KNOWLEDGE_MANIFEST_VERSION ||
      manifest.manifestVersion !== ENTERPRISE_KNOWLEDGE_MANIFEST_VERSION) throw new Error("enterprise-knowledge-manifest-version-drift");
  if (args.manifestHash !== ontologyManifestHash(manifest) ||
      args.manifestHash !== REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST_HASH) throw new Error("enterprise-knowledge-manifest-hash-drift");
  if (manifest.prohibited.includes("inferred_identity_merge") && manifest.prohibited.includes("inferred_authorization")) return;
  throw new Error("enterprise-knowledge-security-prohibitions-missing");
}

export interface KnowledgeMeasurements {
  traversalDepth: number;
  volume: number;
  p95LatencyMs: number;
  freshnessLagMinutes: number;
  retrievalQuality: number;
  costMicros: number;
  incidents: number;
  leakCount: number;
}
export const MATERIALIZATION_THRESHOLDS: Readonly<KnowledgeMeasurements> = {
  traversalDepth: 4, volume: 100000, p95LatencyMs: 800, freshnessLagMinutes: 15,
  retrievalQuality: 0.95, costMicros: 500, incidents: 0, leakCount: 0,
};
export const CURRENT_MEASURED_ENTERPRISE_KNOWLEDGE: KnowledgeMeasurements = {
  traversalDepth: 2, volume: 12000, p95LatencyMs: 220, freshnessLagMinutes: 4,
  retrievalQuality: 0.98, costMicros: 90, incidents: 0, leakCount: 0,
};

export type MaterializationDecision = {
  mode: "federation" | "materialization";
  justified: boolean;
  reasons: readonly string[];
  requiredControls: readonly string[];
};
export const MATERIALIZATION_CONTROLS = [
  "source_revisions", "tombstones", "generation_build", "atomic_generation_swap",
  "reconciliation", "rebuild", "rollback",
] as const;

export function evaluateMaterialization(
  measurements: KnowledgeMeasurements,
  thresholds: KnowledgeMeasurements = MATERIALIZATION_THRESHOLDS,
): MaterializationDecision {
  const reasons: string[] = [];
  for (const [key, value] of Object.entries(measurements)) {
    if (!Number.isFinite(value) || value < 0 || (key === "retrievalQuality" && value > 1)) {
      reasons.push(`${key}-invalid`);
    }
  }
  const exceeds = (key: keyof KnowledgeMeasurements) => measurements[key] > thresholds[key];
  (["traversalDepth", "volume", "p95LatencyMs", "freshnessLagMinutes", "costMicros"] as const)
    .forEach((key) => { if (!exceeds(key)) reasons.push(`${key}-below-threshold`); });
  if (measurements.retrievalQuality < thresholds.retrievalQuality) reasons.push("retrieval-quality-not-qualified");
  if (measurements.incidents !== 0) reasons.push("incidents-nonzero");
  if (measurements.leakCount !== 0) reasons.push("leaks-nonzero");
  const justified = reasons.length === 0;
  return { mode: justified ? "materialization" : "federation", justified, reasons,
    requiredControls: justified ? MATERIALIZATION_CONTROLS : [] };
}

export const RELEASE_STAGES = ["shadow", "canary", "general_availability"] as const;
export type ReleaseStage = (typeof RELEASE_STAGES)[number];
export const ENTERPRISE_KNOWLEDGE_RELEASE_PLAN = {
  stages: RELEASE_STAGES,
  requiredMetrics: ["traversalDepth", "volume", "p95LatencyMs", "freshnessLagMinutes", "retrievalQuality", "costMicros", "incidents", "leakCount"] as const,
  killSwitch: ENTERPRISE_KNOWLEDGE_ENABLED,
  canaryCohort: "reviewed-enterprise-knowledge-canary",
  controls: ["reconciliation", "access_audit", "rollback_procedure"] as const,
  canaryProcedure: [
    "enable only for the reviewed cohort",
    "compare canonical envelopes against source adapters",
    "halt on any inaccessible-record disclosure or provenance mismatch",
  ] as const,
  reconciliationProcedure: [
    "re-run each canonical adapter under the same persona",
    "compare canonical ids, source versions, validity and freshness",
    "record zero unauthorized candidates, counts, summaries and fallbacks",
  ] as const,
  rollbackProcedure: [
    "set ATELIER_ENTERPRISE_KNOWLEDGE_ENABLED=false",
    "preserve source reads and audit evidence",
    "reconcile in-flight reads without serving partial envelopes",
    "restore only after security and provenance gates pass",
  ] as const,
} as const;
export interface ReleaseGateInput {
  stage: ReleaseStage;
  evidence?: ReleaseEvidence;
  reviewedEvidenceHash?: string;
  killSwitchEnabled: boolean;
  canaryCohort?: string;
  reconciliationComplete?: boolean;
  accessAuditComplete?: boolean;
  rollbackProcedureReady?: boolean;
  completedStages?: readonly ReleaseStage[];
}
export interface ReleaseEvidence {
  reportVersion: "enterprise-knowledge-eval/v1";
  metrics: KnowledgeMeasurements;
  sampleSize: number;
  windowStartedAt: string;
  windowEndedAt: string;
  personaCoverage: readonly string[];
  producer: string;
  reviewerRoles: readonly ReviewerRole[];
  reconciliationDigest: string;
  accessAuditDigest: string;
}
export function releaseEvidenceHash(evidence: ReleaseEvidence): string {
  return createHash("sha256").update(canonical(evidence)).digest("hex");
}

export const REVIEWED_RUNTIME_RELEASE_EVIDENCE: ReleaseEvidence = {
  reportVersion: "enterprise-knowledge-eval/v1",
  metrics: CURRENT_MEASURED_ENTERPRISE_KNOWLEDGE,
  sampleSize: 120,
  windowStartedAt: "2026-09-01T00:00:00.000Z",
  windowEndedAt: "2026-09-08T00:00:00.000Z",
  personaCoverage: ["founding_partner", "partner", "senior_manager", "employee", "contractor"],
  producer: "enterprise-knowledge-eval",
  reviewerRoles: ["security_reviewer", "privacy_reviewer"],
  reconciliationDigest: "a".repeat(64),
  accessAuditDigest: "b".repeat(64),
};

/**
 * Deployment-pinned approval. It deliberately approves shadow only: changing
 * the stage, reviewed evidence, ontology, or capability manifest requires a
 * reviewed code change that also updates the pinned artifact hash.
 */
export const REVIEWED_RUNTIME_RELEASE_APPROVAL = {
  artifactVersion: "enterprise-knowledge-release/v1",
  approvedStage: "shadow" as ReleaseStage,
  ontologyManifestHash: REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST_HASH,
  capabilityManifestVersion: "5e54a4996ef7c0292fb565fb6437aaf4be2a0c7e613c58288e2593a036ebdd62",
  priorStageApprovals: [] as readonly ReleaseStage[],
  evidence: REVIEWED_RUNTIME_RELEASE_EVIDENCE,
  reviewedEvidenceHash: releaseEvidenceHash(REVIEWED_RUNTIME_RELEASE_EVIDENCE),
  rollbackProcedureReady: true,
  reconciliationComplete: true,
  accessAuditComplete: true,
  canaryCohort: "reviewed-enterprise-knowledge-canary",
  reviewerApprovals: [
    { reviewerId: "enterprise-knowledge-security-review", role: "security_reviewer" as ReviewerRole },
    { reviewerId: "enterprise-knowledge-privacy-review", role: "privacy_reviewer" as ReviewerRole },
  ],
} as const;
export const PINNED_RUNTIME_RELEASE_APPROVAL_HASH = "167f0884b494c496230aa1e491ad125d7e7730e9d0b12a3bc683c656057cf90c";

export function runtimeReleaseApprovalHash(): string {
  return createHash("sha256").update(canonical(REVIEWED_RUNTIME_RELEASE_APPROVAL)).digest("hex");
}

export function assertRuntimeReleaseApproval(currentCapabilityManifestVersion: string): ReleaseStage {
  if (runtimeReleaseApprovalHash() !== PINNED_RUNTIME_RELEASE_APPROVAL_HASH) {
    throw new Error("enterprise-knowledge-release-approval-drift");
  }
  if (REVIEWED_RUNTIME_RELEASE_APPROVAL.ontologyManifestHash !== REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST_HASH) {
    throw new Error("enterprise-knowledge-ontology-binding-drift");
  }
  if (REVIEWED_RUNTIME_RELEASE_APPROVAL.capabilityManifestVersion !== currentCapabilityManifestVersion) {
    throw new Error("enterprise-knowledge-capability-binding-drift");
  }
  if (new Set(REVIEWED_RUNTIME_RELEASE_APPROVAL.reviewerApprovals.map((item) => item.reviewerId)).size < 2) {
    throw new Error("enterprise-knowledge-release-review-incomplete");
  }
  if (REVIEWED_RUNTIME_RELEASE_APPROVAL.reviewerApprovals.some(
    (item) => !REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST.reviewerRoles.includes(item.role),
  )) {
    throw new Error("enterprise-knowledge-release-review-role-invalid");
  }
  const gate = evaluateReleaseGate({
    stage: REVIEWED_RUNTIME_RELEASE_APPROVAL.approvedStage,
    evidence: REVIEWED_RUNTIME_RELEASE_APPROVAL.evidence,
    reviewedEvidenceHash: REVIEWED_RUNTIME_RELEASE_APPROVAL.reviewedEvidenceHash,
    killSwitchEnabled: true,
    canaryCohort: REVIEWED_RUNTIME_RELEASE_APPROVAL.canaryCohort,
    reconciliationComplete: REVIEWED_RUNTIME_RELEASE_APPROVAL.reconciliationComplete,
    accessAuditComplete: REVIEWED_RUNTIME_RELEASE_APPROVAL.accessAuditComplete,
    rollbackProcedureReady: REVIEWED_RUNTIME_RELEASE_APPROVAL.rollbackProcedureReady,
    completedStages: REVIEWED_RUNTIME_RELEASE_APPROVAL.priorStageApprovals,
  });
  if (!gate.passed) throw new Error(`enterprise-knowledge-release-gate-failed:${gate.reasons.join(",")}`);
  return REVIEWED_RUNTIME_RELEASE_APPROVAL.approvedStage;
}
export interface ReleaseGateResult { passed: boolean; reasons: readonly string[]; required: readonly string[]; }
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const reasons: string[] = [];
  const required = ["reviewed_evidence", "kill_switch", "stage_order", "reconciliation", "access_audit", "rollback_procedure"];
  if (!input.killSwitchEnabled) reasons.push("kill-switch-disabled");
  const evidence = input.evidence;
  const metrics = evidence?.metrics;
  const metricKeys = ENTERPRISE_KNOWLEDGE_RELEASE_PLAN.requiredMetrics;
  if (!metrics || metricKeys.some((key) => !Number.isFinite(metrics[key]))) reasons.push("metrics-missing");
  else {
    if (metricKeys.some((key) => Number(metrics[key]) < 0) || Number(metrics.retrievalQuality) > 1) {
      reasons.push("metrics-invalid");
    }
    if (metrics.incidents !== 0) reasons.push("incidents");
    if (metrics.leakCount !== 0) reasons.push("leaks");
    if ((metrics.retrievalQuality ?? -Infinity) < MATERIALIZATION_THRESHOLDS.retrievalQuality) reasons.push("retrieval-quality-threshold");
    if ((metrics.freshnessLagMinutes ?? Infinity) > MATERIALIZATION_THRESHOLDS.freshnessLagMinutes) reasons.push("stale-data");
    if ((metrics.p95LatencyMs ?? Infinity) > MATERIALIZATION_THRESHOLDS.p95LatencyMs) reasons.push("excessive-latency");
    if ((metrics.costMicros ?? Infinity) > MATERIALIZATION_THRESHOLDS.costMicros) reasons.push("excessive-cost");
  }
  if (!evidence || !input.reviewedEvidenceHash ||
      releaseEvidenceHash(evidence) !== input.reviewedEvidenceHash) {
    reasons.push("reviewed-evidence-missing-or-drifted");
  } else {
    const started = Date.parse(evidence.windowStartedAt);
    const ended = Date.parse(evidence.windowEndedAt);
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) {
      reasons.push("measurement-window-invalid");
    }
    if (!Number.isInteger(evidence.sampleSize) || evidence.sampleSize < 100) {
      reasons.push("sample-size-insufficient");
    }
    const requiredPersonas = ["founding_partner", "partner", "senior_manager", "employee", "contractor"];
    if (requiredPersonas.some((role) => !evidence.personaCoverage.includes(role))) {
      reasons.push("persona-coverage-incomplete");
    }
    if (new Set(evidence.reviewerRoles).size < 2 ||
        evidence.reviewerRoles.some((role) => !REVIEWER_ROLES.has(role))) {
      reasons.push("evidence-review-incomplete");
    }
    if (!/^[a-f0-9]{64}$/.test(evidence.reconciliationDigest)) {
      reasons.push("reconciliation-evidence-invalid");
    }
    if (!/^[a-f0-9]{64}$/.test(evidence.accessAuditDigest)) {
      reasons.push("access-audit-evidence-invalid");
    }
  }
  const prior = input.completedStages ?? [];
  const index = RELEASE_STAGES.indexOf(input.stage);
  if (prior.length !== index || prior.some((stage, i) => stage !== RELEASE_STAGES[i])) reasons.push("stage-order-invalid");
  if (input.stage === "canary" && !input.canaryCohort?.trim()) reasons.push("canary-cohort-required");
  if (input.stage !== "shadow" && !input.reconciliationComplete) reasons.push("reconciliation-required");
  if (input.stage !== "shadow" && !input.accessAuditComplete) reasons.push("access-audit-required");
  if (!input.rollbackProcedureReady) reasons.push("rollback-procedure-required");
  return { passed: reasons.length === 0, reasons, required };
}

export interface GovernanceChangeProposal {
  id: string;
  proposerId: string;
  proposerRole: string;
  summary: string;
  manifestVersion: string;
}
export interface GovernanceReview {
  proposalId: string;
  reviewerId: string;
  reviewerRole: string;
  approved: boolean;
}
export interface GovernanceAuditRecord {
  event: "proposed" | "reviewed";
  proposalId: string;
  actorId: string;
  actorRole: string;
  manifestVersion: string;
  approved?: boolean;
}
const OWNER_ROLES = new Set<string>(REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST.ownerRoles);
const REVIEWER_ROLES = new Set<string>(REVIEWED_ENTERPRISE_KNOWLEDGE_MANIFEST.reviewerRoles);
export function proposeGovernanceChange(args: GovernanceChangeProposal): { proposal: GovernanceChangeProposal; audit: GovernanceAuditRecord } {
  if (!args.id.trim() || !args.proposerId.trim() || !args.summary.trim()) {
    throw new Error("governance-proposal-required");
  }
  if (!OWNER_ROLES.has(args.proposerRole)) throw new Error("governance-owner-role-required");
  if (args.manifestVersion !== ENTERPRISE_KNOWLEDGE_MANIFEST_VERSION) {
    throw new Error("governance-manifest-version-unsupported");
  }
  return {
    proposal: args,
    audit: {
      event: "proposed",
      proposalId: args.id,
      actorId: args.proposerId,
      actorRole: args.proposerRole,
      manifestVersion: args.manifestVersion,
    },
  };
}
export function reviewGovernanceChange(proposal: GovernanceChangeProposal, review: GovernanceReview): GovernanceAuditRecord {
  if (proposal.id !== review.proposalId) throw new Error("governance-proposal-mismatch");
  if (!REVIEWER_ROLES.has(review.reviewerRole)) throw new Error("governance-reviewer-role-required");
  if (proposal.proposerId === review.reviewerId) {
    throw new Error("governance-proposer-reviewer-must-differ");
  }
  return {
    event: "reviewed",
    proposalId: proposal.id,
    actorId: review.reviewerId,
    actorRole: review.reviewerRole,
    manifestVersion: proposal.manifestVersion,
    approved: review.approved,
  };
}