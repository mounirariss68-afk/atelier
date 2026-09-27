import reviewedManifestJson from "../../src/lib/atelier-cli/generated/capability-manifest.v1.json";

export interface ReviewedCapability {
  capabilityId: string;
  toolName: string;
  effect: "read" | "write";
  effectClass: string;
  executionStatus: "executable" | "unsupported" | "legacy_compat";
  policyClass: string;
  confirmation: {
    irreversible: boolean;
    outboundChannel: string | null;
  };
}

export interface HighRiskActionEvidence {
  capabilityId: string;
  scenarioId: string;
  owner: string;
  testLayer: string;
  testRef: string;
  /** Exact prompt or named assertion present in the runnable test source. */
  assertionMarker: string;
}

export type CoverageStatus = "supported" | "unsupported" | "missing";

export interface CoverageMatrixRow {
  capabilityId: string;
  toolName: string;
  effectClass: string;
  executionStatus: ReviewedCapability["executionStatus"];
  status: CoverageStatus;
  scenarioId: string | null;
}

/**
 * Evidence is limited to action-specific named observations/assertions already
 * present in runnable tests. A generic write-dispatch or policy test is not
 * evidence for an individual capability.
 */
export const EXECUTABLE_ACTION_EVIDENCE: readonly HighRiskActionEvidence[] = [
  {
    capabilityId: "account.delete",
    scenarioId: "account.delete.confirmed-delete",
    owner: "CRM account lifecycle",
    testLayer: "database integration",
    testRef: "tests/crm/run.ts",
    assertionMarker: "account_delete phase2 (override+confirm)",
  },
  {
    capabilityId: "codex.contract_attach_final_and_send",
    scenarioId: "contract.attach-final-and-send.committed",
    owner: "CRM contracts",
    testLayer: "database integration",
    testRef: "tests/crm/nep-flow-probe.ts",
    assertionMarker: "6b. commit sends for signature",
  },
  {
    capabilityId: "codex.contract_send_signature",
    scenarioId: "contract.send-signature.unauthorized-denial",
    owner: "CRM contracts",
    testLayer: "database integration and authorization",
    testRef: "tests/crm/contract-lifecycle-probe.ts",
    assertionMarker: "CLI self-send by non-signatory denied",
  },
  {
    capabilityId: "document.email",
    scenarioId: "document.email.company-document-commit",
    owner: "Atelier document capabilities",
    testLayer: "database integration and outbound contract",
    testRef: "tests/crm/document-email-probe.ts",
    assertionMarker: "company: commit ok",
  },
  {
    capabilityId: "ledger.approve_payroll_run",
    scenarioId: "payroll.approve-run.typed-confirmation",
    owner: "Finance capabilities",
    testLayer: "database integration and confirmation",
    testRef: "tests/crm/chat-finance-approvals-probe.ts",
    assertionMarker: "approve_payroll_run: forged confirm posted nothing (still draft)",
  },
  {
    capabilityId: "ledger.approve_self_billing",
    scenarioId: "self-billing.approve.commit",
    owner: "Finance capabilities",
    testLayer: "database integration and confirmation",
    testRef: "tests/crm/chat-finance-approvals-probe.ts",
    assertionMarker: "approve_self_billing: committed through the SAME payables core",
  },
  {
    capabilityId: "ledger.approve_send_collections",
    scenarioId: "collections.approve-send.commit",
    owner: "Finance capabilities",
    testLayer: "database integration and outbound policy",
    testRef: "tests/crm/chat-finance-approvals-probe.ts",
    assertionMarker: "approve_send_collections: verified commit ok",
  },
  {
    capabilityId: "me.document_email",
    scenarioId: "me.document-email.send-commit",
    owner: "Employee self-service",
    testLayer: "database integration and outbound contract",
    testRef: "tests/crm/document-email-probe.ts",
    assertionMarker: "send: POST /me/sendMail",
  },
];

/**
 * Ratchet baseline only: these are known executable high-risk actions for
 * which the existing runnable tests have no action-specific assertion yet.
 * New missing IDs fail the focused coverage check; resolved IDs can be removed
 * from this list as evidence is added.
 */
export const KNOWN_MISSING_HIGH_RISK_IDS: readonly string[] = [
  "account.profile_update_decision",
  "attachment.delete_document",
  "bank.recon.finalise",
  "change_order.dispatch",
  "change_order.record_acceptance",
  "deliverable_acceptance.record_signed",
  "deliverable_acceptance.submit",
  "deliverable.email_send",
  "meeting.cancel_internal",
  "meta.undo_last_action",
  "proposal.override_pricing",
  "proposal.send",
  "revrec_post_period",
  "revrec_record_adjustment",
  "wallet.dunning.send_next",
  "wallet.invoice.issue",
  "wallet.invoice.void",
];

export const reviewedCapabilityManifest = reviewedManifestJson as {
  manifestSchemaVersion: number;
  manifestVersion: string;
  entryCount: number;
  entries: readonly ReviewedCapability[];
};

export function isHighRiskWrite(capability: ReviewedCapability): boolean {
  return capability.effect === "write" && (
    capability.confirmation.irreversible ||
    capability.effectClass === "outbound_write" ||
    capability.policyClass === "irreversible_write" ||
    capability.policyClass === "outbound_write"
  );
}

export function buildHighRiskCoverageMatrix(
  entries: readonly ReviewedCapability[],
  evidence: readonly HighRiskActionEvidence[] = EXECUTABLE_ACTION_EVIDENCE,
): CoverageMatrixRow[] {
  const evidenceById = new Map(evidence.map((entry) => [entry.capabilityId, entry]));
  return entries
    .filter(isHighRiskWrite)
    .map((capability) => {
      const actionEvidence = evidenceById.get(capability.capabilityId);
      const status: CoverageStatus = capability.executionStatus !== "executable"
        ? "unsupported"
        : actionEvidence
          ? "supported"
          : "missing";
      return {
        capabilityId: capability.capabilityId,
        toolName: capability.toolName,
        effectClass: capability.effectClass,
        executionStatus: capability.executionStatus,
        status,
        scenarioId: actionEvidence?.scenarioId ?? null,
      };
    })
    .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}