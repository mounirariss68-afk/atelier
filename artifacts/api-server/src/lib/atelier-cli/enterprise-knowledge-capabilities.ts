/**
 * Task #1415 — bounded cross-domain federation.
 *
 * The adapter table is intentionally closed.  This module never accepts a
 * capability id from a caller and never translates natural language to SQL.
 */
import {
  CATALOG_SCHEMA_VERSION,
  capabilitiesForPersona,
  defineCapability,
} from "./capability-catalog.js";
import { reviewedCapabilityManifestDocument, reviewedCapabilityManifestEntry } from "./capability-manifest.js";
import { assertRuntimeReleaseApproval } from "./enterprise-knowledge-governance.js";
import type { ToolContext, ToolResult } from "./index.js";
import {
  canonicalRefs,
  ENTERPRISE_KNOWLEDGE_AUTHORITY,
  normalizedConfidence,
  type EnterpriseKnowledgeEnvelope,
  type EnterpriseKnowledgeSection,
  type RelationshipAssertion,
} from "./enterprise-knowledge-contract.js";

type Shape = "account_context" | "person_context" | "my_context";
type Adapter = { capabilityId: string; toolName: string; input: Record<string, unknown> };
type AdapterRunner = (adapter: Adapter, ctx: ToolContext) => Promise<ToolResult>;
type ReleaseStage = "shadow" | "canary" | "general_availability";

const ADAPTERS: Record<Shape, (input: Record<string, unknown>) => Adapter[]> = {
  account_context: (input) => [
    { capabilityId: "account.dossier", toolName: "account_dossier", input: selectorInput(input) },
    {
      capabilityId: "account.who_works",
      toolName: "account_team_and_pipeline",
      input: accountTeamSelector(input),
    },
  ],
  person_context: (input) => [
    { capabilityId: "roster.person_detail", toolName: "person_detail", input: selectorInput(input) },
    { capabilityId: "person.workload", toolName: "person_workload", input: selectorInput(input) },
  ],
  my_context: () => [
    { capabilityId: "me.semantic_summary", toolName: "my_semantic_summary", input: {} },
  ],
};

function selectorInput(input: Record<string, unknown>): Record<string, unknown> {
  const { shape: _shape, ...selectors } = input;
  return selectors;
}

function accountTeamSelector(input: Record<string, unknown>): Record<string, unknown> {
  const selectors = selectorInput(input);
  if ("accountQuery" in selectors) {
    return { accountName: selectors.accountQuery };
  }
  return selectors;
}

const UNAVAILABLE = {
  ok: false as const,
  errorCode: "unavailable",
  errorMessage: "The requested context is unavailable.",
};

export function enterpriseKnowledgeReleaseDecision(
  personaId: string,
  env: NodeJS.ProcessEnv = process.env,
): { stage: ReleaseStage | "disabled"; serve: boolean } {
  if (env.ATELIER_ENTERPRISE_KNOWLEDGE_ENABLED === "false") {
    return { stage: "disabled", serve: false };
  }
  const configured = env.ATELIER_ENTERPRISE_KNOWLEDGE_RELEASE_STAGE ?? "shadow";
  const stage = configured === "shadow" || configured === "canary" ||
    configured === "general_availability"
    ? configured
    : "disabled";
  if (stage === "disabled") return { stage, serve: false };
  let approvedStage: ReleaseStage;
  try {
    approvedStage = assertRuntimeReleaseApproval(reviewedCapabilityManifestDocument().manifestVersion);
  } catch {
    return { stage: "disabled", serve: false };
  }
  const stageOrder: ReleaseStage[] = ["shadow", "canary", "general_availability"];
  if (stageOrder.indexOf(stage) > stageOrder.indexOf(approvedStage)) {
    return { stage, serve: false };
  }
  if (stage === "general_availability") return { stage, serve: true };
  if (stage !== "canary") return { stage, serve: false };
  const cohort = new Set(
    (env.ATELIER_ENTERPRISE_KNOWLEDGE_CANARY_ACTOR_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  return { stage, serve: cohort.has(personaId) };
}

function releaseStage(): ReleaseStage | "disabled" {
  if (process.env.ATELIER_ENTERPRISE_KNOWLEDGE_ENABLED === "false") return "disabled";
  const stage = process.env.ATELIER_ENTERPRISE_KNOWLEDGE_RELEASE_STAGE ?? "shadow";
  return stage === "shadow" || stage === "canary" || stage === "general_availability"
    ? stage
    : "disabled";
}

function canServeRelease(ctx: ToolContext, stage: ReleaseStage | "disabled"): boolean {
  const decision = enterpriseKnowledgeReleaseDecision(ctx.persona.id);
  return decision.stage === stage && decision.serve;
}

function suspiciousSelector(value: string): boolean {
  return /\b(ignore|disregard|system prompt|previous instructions|select\s+.+\s+from|drop\s+table|union\s+select)\b/i.test(value);
}

export function validateEnterpriseKnowledgeInput(input: Record<string, unknown>): Shape | ToolResult {
  const keys = Object.keys(input);
  const allowedKeys = new Set(["shape", "accountId", "accountQuery", "personId", "name"]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    return { ok: false, errorCode: "invalid_input", errorMessage: "Unsupported selector field." };
  }
  const shape = input.shape;
  if (shape !== "account_context" && shape !== "person_context" && shape !== "my_context") {
    return { ok: false, errorCode: "invalid_input", errorMessage: "Unsupported context shape." };
  }
  if (shape === "my_context" && (keys.length !== 1 || keys[0] !== "shape")) {
    return { ok: false, errorCode: "invalid_input", errorMessage: "my_context accepts no selector." };
  }
  const accountSelectors = ["accountId", "accountQuery"].filter((key) => key in input);
  const personSelectors = ["personId", "name"].filter((key) => key in input);
  if (shape === "account_context" && (accountSelectors.length !== 1 || personSelectors.length !== 0)) {
    return { ok: false, errorCode: "invalid_input", errorMessage: "accountId or accountQuery required." };
  }
  if (shape === "person_context" && (personSelectors.length !== 1 || accountSelectors.length !== 0)) {
    return { ok: false, errorCode: "invalid_input", errorMessage: "personId or name required." };
  }
  for (const key of keys.filter((k) => k !== "shape")) {
    if (typeof input[key] !== "string" || !String(input[key]).trim() || String(input[key]).length > 200 ||
      suspiciousSelector(String(input[key]))) {
      return { ok: false, errorCode: "invalid_input", errorMessage: "Selector is invalid." };
    }
  }
  return shape;
}

function assertionFor(adapter: Adapter): { label: RelationshipAssertion; explanation: string } {
  return { label: "derived", explanation: "This section is derived by the delegated, ACL-preserving composition." };
}

const PROHIBITED_DISCLOSURE_KEY =
  /(hidden|denied|inaccessible|unauthorized|filtered|omitted|restricted|redacted).*(count|ids?|candidates?|paths?|summar(?:y|ies))?/i;

function projectReviewedAdapterData(adapter: Adapter, value: unknown): unknown {
  if (adapter.capabilityId !== "person.workload" || !value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const { hiddenAccountCount: _hiddenAccountCount, ...authorized } = value as Record<string, unknown>;
  return authorized;
}

export function inspectAuthorizedProjection(value: unknown): { ok: true } | { ok: false } {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++nodes > 5_000 || current.depth > 32) return { ok: false };
    if (current.value === null || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    const record = current.value as Record<string, unknown>;
    if (record.available === false || record.ok === false || typeof record.errorCode === "string") {
      return { ok: false };
    }
    for (const [key, child] of Object.entries(record)) {
      if (PROHIBITED_DISCLOSURE_KEY.test(key)) return { ok: false };
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 1_000_000) return { ok: false };
  } catch {
    return { ok: false };
  }
  return { ok: true };
}

export function sanitizeAuthorizedProjection(value: unknown): unknown {
  if (inspectAuthorizedProjection(value).ok === false) return null;
  return value;
}

function extractCanonicalRefs(adapter: Adapter, value: unknown) {
  const refs = canonicalRefs(value);
  const add = (kind: Parameters<typeof canonicalRefs>[1], id: unknown) => {
    if (kind && typeof id === "string" && id) refs.push({ kind, id, authority: "source" as const });
  };
  const root = value && typeof value === "object" ? value as Record<string, any> : {};
  if (adapter.capabilityId === "account.dossier") add("account", root.id);
  if (adapter.capabilityId === "account.who_works") {
    add("account", root.account?.id);
    for (const item of root.openOpportunities ?? []) add("opportunity", item?.id);
    for (const item of root.activeEngagements ?? []) add("engagement", item?.id);
    for (const item of root.recentMeetings ?? []) add("meeting", item?.id);
  }
  if (adapter.capabilityId === "roster.person_detail") {
    add("person", root.person?.id ?? root.id);
    add("contact", root.contact?.id);
    add("account", root.account?.id);
    for (const item of root.managers ?? []) add("person", item?.id);
    for (const item of root.directReports ?? []) add("person", item?.id);
  }
  if (adapter.capabilityId === "person.workload") {
    add("person", root.person?.id);
    for (const item of root.openOpportunities ?? []) add("opportunity", item?.id);
    for (const item of root.engagementStaffings ?? []) add("engagement", item?.engagementId);
    for (const item of root.accountRoles ?? []) add("account", item?.accountId);
  }
  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()]
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

function assertionLineageFor(adapter: Adapter) {
  if (adapter.capabilityId === "account.dossier") return [
    { path: "identity", assertion: "asserted" as const, explanation: "Account identity is read from the authoritative account row." },
    { path: "counts", assertion: "derived" as const, explanation: "Visible counts are derived from authorized live child rows." },
  ];
  if (adapter.capabilityId === "roster.person_detail") return [
    { path: "identity", assertion: "asserted" as const, explanation: "Person or contact identity is read from the authoritative source row." },
    { path: "relationships", assertion: "derived" as const, explanation: "Reporting and company relationships are derived from authorized source links." },
  ];
  return [
    { path: "*", assertion: "derived" as const, explanation: "The section is composed from authorized source records." },
  ];
}

export async function composeEnterpriseKnowledge(args: {
  shape: Shape;
  input: Record<string, unknown>;
  ctx: ToolContext;
  adapters?: Adapter[];
  runAdapter?: AdapterRunner;
  now?: () => Date;
  staleAfterMs?: number;
  minimumResponseMs?: number;
  monotonicNow?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ToolResult> {
  const monotonicNow = args.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  const finish = async (result: ToolResult): Promise<ToolResult> => {
    const remaining = (args.minimumResponseMs ?? 75) - (monotonicNow() - startedAt);
    if (remaining > 0) {
      await (args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(remaining);
    }
    return result;
  };
  const adapters = args.adapters ?? ADAPTERS[args.shape](args.input);
  const run = args.runAdapter ?? (async (adapter, ctx) => {
    const capability = capabilitiesForPersona(ctx.persona).find(
      (entry) => entry.id === adapter.capabilityId && entry.toolName === adapter.toolName,
    );
    const manifest = reviewedCapabilityManifestEntry(adapter.capabilityId);
    if (!capability || !manifest || manifest.toolName !== adapter.toolName ||
      manifest.executionStatus !== "executable") {
      return { ok: false, errorCode: "not_found" };
    }
    return capability.run(adapter.input, ctx);
  });
  // Run the closed adapter set without fallback or early exit. Each delegated
  // executor applies its own source ACL before loading/ranking data. Waiting
  // for the whole set prevents a denied first adapter from creating an
  // observable "fast miss" while the envelope remains withheld until all pass.
  const completed: Array<readonly [Adapter, ToolResult]> = await Promise.all(adapters.map(async (adapter) => {
    try {
      return [adapter, await run(adapter, args.ctx)] as const;
    } catch {
      return [adapter, {
        ok: false as const,
        errorCode: "unavailable",
        errorMessage: "The requested context is unavailable.",
      }] as const;
    }
  }));
  if (completed.some(([, result]) =>
    !result.ok || result.disambiguation ||
    result.errorCode === "forbidden" ||
    result.errorCode === "not_found" || result.errorCode === "ambiguous")) {
    return finish(UNAVAILABLE);
  }
  const now = (args.now ?? (() => new Date()))();
  const sections: Record<string, EnterpriseKnowledgeSection> = {};
  for (const [adapter, result] of completed) {
    const manifest = reviewedCapabilityManifestEntry(adapter.capabilityId);
    if (!manifest || manifest.executionStatus === "unsupported") return finish(UNAVAILABLE);
    const observedAt = now.toISOString();
    const assertion = assertionFor(adapter);
    const raw = projectReviewedAdapterData(adapter, result.data);
    if (inspectAuthorizedProjection(raw).ok === false) return finish(UNAVAILABLE);
    const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const asOf = typeof source.asOf === "string" ? source.asOf : null;
    const parsedAsOf = asOf ? Date.parse(asOf) : Number.NaN;
    const ageMs = Number.isFinite(parsedAsOf) && parsedAsOf <= now.getTime()
      ? now.getTime() - parsedAsOf
      : null;
    const stale = ageMs !== null && ageMs > (args.staleAfterMs ?? 86_400_000);
    sections[adapter.toolName] = {
      canonicalRefs: extractCanonicalRefs(adapter, raw),
      provenance: {
        adapterCapabilityId: adapter.capabilityId,
        adapterToolName: adapter.toolName,
        manifestVersion: reviewedCapabilityManifestDocument().manifestVersion,
        implementationVersion: manifest?.implementationVersion ?? null,
        resultSchemaHash: manifest?.resultSchemaHash ?? null,
        sourceRevision:
          typeof source.sourceRevision === "string" ? source.sourceRevision
            : typeof source.versionId === "string" ? source.versionId
              : null,
      },
      observedAt,
      asOf,
      validity: ageMs === null ? "unknown" : stale ? "stale" : "fresh",
      freshness: { observedAt, ageMs },
      confidence: normalizedConfidence(source.confidence),
      relationshipAssertion: assertion.label,
      relationshipExplanation: assertion.explanation,
      assertionLineage: assertionLineageFor(adapter),
      data: raw,
    };
  }
  const envelope: EnterpriseKnowledgeEnvelope = {
    contractVersion: "enterprise-knowledge-v1",
    shape: args.shape,
    authority: ENTERPRISE_KNOWLEDGE_AUTHORITY,
    sections,
  };
  return finish({ ok: true, data: envelope });
}

const inputSchema = {
  type: "object",
  properties: {
    shape: { type: "string", enum: ["account_context", "person_context", "my_context"] },
    accountId: { type: "string", maxLength: 200 },
    accountQuery: { type: "string", maxLength: 200 },
    personId: { type: "string", maxLength: 200 },
    name: { type: "string", maxLength: 200 },
  },
  additionalProperties: false,
} as Record<string, unknown>;

export const enterpriseKnowledgeCapability = defineCapability({
  id: "knowledge.enterprise_query",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "knowledge",
  toolName: "enterprise_knowledge_query",
  description: "Read-only bounded account, person, or self context from authorized source capabilities.",
  slashAliases: { en: ["/enterprise-context"] },
  representativePrompts: { en: ["Show the authorized context for this account"] },
  inputSchema,
  isWrite: false,
  irreversible: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "section_card",
  surfaceOn: ["global", "home"],
  promoteAsSuggestion: false,
  async run(input, ctx) {
    const stage = releaseStage();
    if (stage === "disabled") {
      return {
        ok: false,
        errorCode: "unavailable",
        errorMessage: "The requested context is unavailable.",
      };
    }
    if (!capabilitiesForPersona(ctx.persona).some((entry) => entry.id === "knowledge.enterprise_query")) {
      return UNAVAILABLE;
    }
    const shape = validateEnterpriseKnowledgeInput(input);
    if (typeof shape !== "string") return shape;
    const result = await composeEnterpriseKnowledge({ shape, input, ctx });
    // Shadow evaluates the exact production path but never serves its result.
    if (!canServeRelease(ctx, stage)) return UNAVAILABLE;
    return result;
  },
});