/**
 * Task #1415 — the wire contract for the bounded cross-domain read lens.
 *
 * This is deliberately a projection contract, not a graph contract.  The
 * authority to answer each section remains in the delegated capability.
 */
export type RelationshipAssertion = "asserted" | "derived" | "inferred";
export type SectionValidity = "fresh" | "stale" | "unknown";

export interface EnterpriseKnowledgeProvenance {
  adapterCapabilityId: string;
  adapterToolName: string;
  manifestVersion: string | null;
  implementationVersion: string | null;
  resultSchemaHash: string | null;
  sourceRevision: string | null;
}

export interface EnterpriseKnowledgeCanonicalRef {
  kind: "account" | "person" | "contact" | "engagement" | "opportunity" | "meeting" | "document";
  id: string;
  authority: "source";
}

export interface EnterpriseKnowledgeSection {
  canonicalRefs: EnterpriseKnowledgeCanonicalRef[];
  provenance: EnterpriseKnowledgeProvenance;
  observedAt: string;
  asOf: string | null;
  validity: SectionValidity;
  freshness: { observedAt: string; ageMs: number | null };
  confidence: number | null;
  relationshipAssertion: RelationshipAssertion;
  relationshipExplanation: string;
  assertionLineage: readonly {
    path: string;
    assertion: RelationshipAssertion;
    explanation: string;
  }[];
  data: unknown;
}

export interface EnterpriseKnowledgeEnvelope {
  contractVersion: "enterprise-knowledge-v1";
  shape: "account_context" | "person_context" | "my_context";
  authority: {
    kind: "projection";
    statement: string;
    canAuthorize: false;
    canWidenPolicy: false;
    canWrite: false;
  };
  sections: Record<string, EnterpriseKnowledgeSection>;
}

export const ENTERPRISE_KNOWLEDGE_AUTHORITY = {
  kind: "projection" as const,
  statement:
    "This is a read-only projection. Projections, graph views, and RAG cannot authorize access, widen policy, or write to source systems.",
  canAuthorize: false as const,
  canWidenPolicy: false as const,
  canWrite: false as const,
};

export function normalizedConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

const CANONICAL_ID_KEYS = {
  accountId: "account",
  personId: "person",
  engagementId: "engagement",
  opportunityId: "opportunity",
  meetingId: "meeting",
  documentId: "document",
} as const;

export function canonicalRefs(
  value: unknown,
  rootKind?: EnterpriseKnowledgeCanonicalRef["kind"],
): EnterpriseKnowledgeCanonicalRef[] {
  const refs = new Map<string, EnterpriseKnowledgeCanonicalRef>();
  const add = (kind: EnterpriseKnowledgeCanonicalRef["kind"], id: unknown) => {
    if (typeof id === "string" && id) {
      refs.set(`${kind}:${id}`, { kind, id, authority: "source" });
    }
  };
  const scan = (node: unknown, depth = 0): void => {
    if (depth > 3 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.slice(0, 20).forEach((item) => scan(item, depth + 1));
    const record = node as Record<string, unknown>;
    if (depth === 0 && rootKind) add(rootKind, record.id);
    for (const [key, kind] of Object.entries(CANONICAL_ID_KEYS)) {
      add(kind, record[key]);
    }
    for (const value of Object.values(record).slice(0, 50)) scan(value, depth + 1);
  };
  scan(value);
  return [...refs.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}