/**
 * Bounded legal-entity document semantics. This module deliberately accepts
 * an already ACL-filtered list: it never loads CRM records or broadens ACLs.
 */
export type RolloutMode = "off" | "shadow" | "retrieval" | "draft";
export type SemanticConcept = "registration" | "ejari" | "constitutional" | "ct" | "vat";

export interface VisibleEntityDocument {
  id: string;
  title?: string | null;
  docKind?: string | null;
  currentVersionId?: string | null;
  status?: string | null;
  deletedAt?: unknown;
  /** For tax pointers, the current version must be available to resolve. */
  available?: boolean;
  /** Distinguishes a dangling currentVersionId from a current blob that is unavailable. */
  versionExists?: boolean;
}

export interface RegistrationPointer {
  type: string;
  certificateDocumentId?: string | null;
}

export interface SemanticEntity {
  id: string;
  registrations?: RegistrationPointer[] | null;
}

export interface BundleConcept {
  key: SemanticConcept;
  synonyms: string[];
  exclusions?: string[];
  source: "registration" | "entity_document";
}

export const DEFAULT_COMPANY_REGISTRATION_AND_TAX: BundleConcept[] = [
  { key: "registration", source: "entity_document", synonyms: ["registration", "commercial register", "trade license", "company registration"], exclusions: ["tax registration", "vat", "corporate tax"] },
  { key: "ejari", source: "entity_document", synonyms: ["ejari", "tenancy", "lease"], exclusions: ["tax"] },
  { key: "constitutional", source: "entity_document", synonyms: ["constitutional", "memorandum", "moa", "articles of association"] },
  { key: "ct", source: "registration", synonyms: ["ct", "corporate tax", "corporate tax certificate", "tax registration ct"] },
  { key: "vat", source: "registration", synonyms: ["vat", "vat certificate", "tax registration vat"] },
];

export function normalizeAlias(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\u200b-\u200f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function normalizeSemanticText(value: string): string {
  return normalizeAlias(value);
}

function hasNormalizedPhrase(text: string, phrase: string): boolean {
  const normalizedText = ` ${normalizeSemanticText(text)} `;
  const normalizedPhrase = normalizeSemanticText(phrase);
  return !!normalizedPhrase && normalizedText.includes(` ${normalizedPhrase} `);
}

/** Deterministic synonym matching: exclusions always win and longest synonym
 * wins ties, preventing "tax registration" from resolving as registration. */
export function parseSemanticConcept(query: string, concepts = DEFAULT_COMPANY_REGISTRATION_AND_TAX): SemanticConcept | null {
  const text = normalizeSemanticText(query);
  const candidates = concepts.filter((c) => {
    const hit = c.synonyms.some((s) => hasNormalizedPhrase(text, s));
    const excluded = (c.exclusions ?? []).some((s) => hasNormalizedPhrase(text, s));
    return hit && !excluded;
  }).sort((a, b) => Math.max(...b.synonyms.map((s) => normalizeSemanticText(s).length)) -
    Math.max(...a.synonyms.map((s) => normalizeSemanticText(s).length)));
  return candidates[0]?.key ?? null;
}

/** A request for the named bundle is an explicit request for the complete
 * governed checklist, rather than a single fuzzy concept. */
export function parseSemanticBundle(
  query: string,
  configured = DEFAULT_COMPANY_REGISTRATION_AND_TAX,
): SemanticConcept[] {
  const text = normalizeSemanticText(query);
  const fullBundle =
    (text.includes("company registration") && text.includes("tax")) ||
    text.includes("legal entity document pack") ||
    text.includes("company document pack");
  const requested = fullBundle
    ? configured.map((c) => c.key)
    : [...new Set(
        query.split(/\s*(?:,|\+|\band\b|\bplus\b)\s*/i).flatMap((clause) => {
          const clauseText = normalizeSemanticText(clause);
          return configured.filter((concept) =>
            concept.synonyms.some((synonym) => hasNormalizedPhrase(clauseText, synonym)) &&
            !(concept.exclusions ?? []).some((exclusion) => hasNormalizedPhrase(clauseText, exclusion))
          ).map((concept) => concept.key);
        }),
      )];
  return requested.filter((key) => {
    const concept = configured.find((item) => item.key === key)!;
    return !concept.synonyms.some((synonym) => {
      const normalized = normalizeSemanticText(synonym);
      return [
        `without ${normalized}`,
        `exclude ${normalized}`,
        `excluding ${normalized}`,
        `no ${normalized}`,
      ].some((marker) => text.includes(marker));
    });
  });
}

export async function classifySemanticBundleWithClaude(args: {
  query: string;
  orgId: string;
  configured: BundleConcept[];
  classify?: (query: string, governedConcepts: BundleConcept[]) => Promise<unknown>;
}): Promise<SemanticConcept[]> {
  const deterministic = parseSemanticBundle(args.query, args.configured);
  const clauses = args.query.split(/\s*(?:,|\+|\band\b|\bplus\b)\s*/i).filter(Boolean);
  const unresolved = clauses.filter((clause) => parseSemanticBundle(clause, args.configured).length === 0);
  if (deterministic.length > 0 && unresolved.length === 0) return deterministic;
  try {
    let parsed: { concepts?: unknown };
    if (args.classify) {
      parsed = await args.classify(unresolved.join(" and ") || args.query, args.configured) as { concepts?: unknown };
    } else {
      const { getPrivacyAuthorizedAnthropic } = await import("./assistant/provider-runtime.js");
      const model = process.env.ATELIER_CLI_HAIKU_MODEL ?? "claude-haiku-4-5";
      const { anthropic } = await getPrivacyAuthorizedAnthropic({
        dataClasses: ["confidential"], orgId: args.orgId, capabilityId: "document.email", model,
      });
      const response = await anthropic.messages.create({
        model,
        max_tokens: 80,
        system: `Classify a legal-entity document phrase into only these governed concepts and honor their exclusions: ${JSON.stringify(args.configured)}. Return JSON {"concepts":[]} and abstain with an empty array when unclear. Never invent another concept.`,
        messages: [{ role: "user", content: (unresolved.join(" and ") || args.query).slice(0, 500) }],
      });
      const raw = response.content.map((block) => block.type === "text" ? block.text : "").join("");
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return deterministic;
      parsed = JSON.parse(match[0]) as { concepts?: unknown };
    }
    if (!Array.isArray(parsed.concepts)) return [];
    const allowed = new Set<SemanticConcept>(
      args.configured.map((concept) => concept.key),
    );
    const modelConcepts = parsed.concepts.filter((value): value is SemanticConcept =>
      typeof value === "string" && allowed.has(value as SemanticConcept));
    const explicitlyExcluded = new Set(parseExplicitExclusions(args.query, args.configured));
    return [...new Set([...deterministic, ...modelConcepts])].filter((key) => !explicitlyExcluded.has(key));
  } catch {
    return deterministic;
  }
}

function parseExplicitExclusions(query: string, configured: BundleConcept[]): SemanticConcept[] {
  const text = normalizeSemanticText(query);
  return configured.filter((concept) => concept.synonyms.some((synonym) => {
    const value = normalizeSemanticText(synonym);
    return [`without ${value}`, `exclude ${value}`, `excluding ${value}`, `no ${value}`]
      .some((marker) => text.includes(marker));
  })).map((concept) => concept.key);
}

function matches(doc: VisibleEntityDocument, concept: BundleConcept): boolean {
  const text = normalizeSemanticText(`${doc.docKind ?? ""} ${doc.title ?? ""}`);
  return concept.synonyms.some((s) => hasNormalizedPhrase(text, s)) &&
    !(concept.exclusions ?? []).some((s) => hasNormalizedPhrase(text, s));
}

export type Resolution =
  | { outcome: "resolved"; concept: SemanticConcept; documentId: string }
  | { outcome: "missing" | "duplicate" | "invisible" | "stale" | "unavailable"; concept: SemanticConcept; documentIds: string[] };

/** Resolve against visible documents only. CT/VAT are exact registration
 * pointers; all other concepts use current, live entity documents. */
export function resolveEntityBundle(
  entity: SemanticEntity,
  visibleDocuments: VisibleEntityDocument[],
  concepts = DEFAULT_COMPANY_REGISTRATION_AND_TAX,
  authoritativeDocuments = visibleDocuments,
): Resolution[] {
  return concepts.map((concept) => {
    let docs: VisibleEntityDocument[];
    if (concept.source === "registration") {
      const type = concept.key === "ct" ? "tax_registration_ct" : "tax_registration_vat";
      const pointers = (entity.registrations ?? []).filter((r) => r.type === type && !!r.certificateDocumentId);
      if (pointers.length === 0) return { outcome: "missing", concept: concept.key, documentIds: [] };
      if (pointers.length > 1) {
        const visibleIds = new Set(visibleDocuments.map((document) => document.id));
        return {
          outcome: "duplicate",
          concept: concept.key,
          documentIds: pointers.map((pointer) => pointer.certificateDocumentId!)
            .filter((id) => visibleIds.has(id)).sort(),
        };
      }
      const pointed = authoritativeDocuments.find((d) => d.id === pointers[0]!.certificateDocumentId);
      if (!pointed || pointed.deletedAt || pointed.status !== "active" || !pointed.currentVersionId || pointed.versionExists === false) {
        return { outcome: "stale", concept: concept.key, documentIds: [] };
      }
      if (!visibleDocuments.some((d) => d.id === pointed.id)) {
        return { outcome: "invisible", concept: concept.key, documentIds: [] };
      }
      docs = [pointed];
    } else {
      const candidates = authoritativeDocuments.filter((d) => matches(d, concept));
      const live = candidates.filter((d) => !d.deletedAt && d.status === "active");
      if (live.length === 0 && candidates.length > 0) {
        return { outcome: "stale", concept: concept.key, documentIds: [] };
      }
      if (live.length === 0) return { outcome: "missing", concept: concept.key, documentIds: [] };
      if (live.length > 1) {
        const visibleIds = new Set(visibleDocuments.map((d) => d.id));
        return { outcome: "duplicate", concept: concept.key, documentIds: live.filter((d) => visibleIds.has(d.id)).map((d) => d.id).sort() };
      }
      if (!live[0]!.currentVersionId || live[0]!.versionExists === false) {
        return { outcome: "stale", concept: concept.key, documentIds: [] };
      }
      if (!visibleDocuments.some((d) => d.id === live[0]!.id)) {
        return { outcome: "invisible", concept: concept.key, documentIds: [] };
      }
      docs = live;
    }
    const ids = docs.map((d) => d.id).sort();
    if (docs.some((d) => d.available === false)) return { outcome: "unavailable", concept: concept.key, documentIds: ids };
    if (ids.length === 0) return { outcome: "missing", concept: concept.key, documentIds: [] };
    if (ids.length > 1) return { outcome: "duplicate", concept: concept.key, documentIds: ids };
    return { outcome: "resolved", concept: concept.key, documentId: ids[0]! };
  });
}

export function rolloutMode(args: { orgId: string; testMailbox?: string | null; mode?: RolloutMode; orgAllowlist?: string[]; mailboxAllowlist?: string[] }): RolloutMode {
  const mode = args.mode ?? "off";
  if (mode === "off") return "off";
  if (args.orgAllowlist?.includes(args.orgId) || (args.testMailbox && args.mailboxAllowlist?.includes(args.testMailbox))) return mode;
  return "off";
}

export function rolloutModeFromEnv(orgId: string, recipientEmails: string[] = []): RolloutMode {
  const raw = process.env.LEGAL_ENTITY_DOCUMENT_SEMANTICS_MODE;
  const mode: RolloutMode =
    raw === "shadow" || raw === "retrieval" || raw === "draft" ? raw : "off";
  const orgAllowlist = (process.env.LEGAL_ENTITY_DOCUMENT_SEMANTICS_ORG_ALLOWLIST ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const mailboxAllowlist = (process.env.LEGAL_ENTITY_DOCUMENT_SEMANTICS_DRAFT_MAILBOX_ALLOWLIST ?? "")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (mode === "off" || !orgAllowlist.includes(orgId)) return "off";
  if (mode === "draft" && (
    recipientEmails.length === 0 ||
    recipientEmails.some((email) => !mailboxAllowlist.includes(email.toLowerCase()))
  )) return "retrieval";
  return mode;
}