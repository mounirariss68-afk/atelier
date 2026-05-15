/**
 * Atelier — Idempotent demo seed for the Agents lens (Task #373).
 *
 * Mirrors the inline seed previously hard-coded into
 * `artifacts/atelier/src/lib/agents-lens-seed.ts` so the demo path stays
 * identical across reloads. Safe to call on every cold start — every insert
 * is gated on existence so re-runs are no-ops. Pattern matches
 * `atelier-seed-v5.ts`.
 */
import { sql, type InferInsertModel } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import {
  db,
  atelierAgentSpecs,
  atelierAgentVersions,
  atelierAgentEvalSuites,
  atelierAgentDeployments,
  atelierAgentIncidents,
  atelierAgentRetirements,
} from "@workspace/db";
import { logger } from "./logger.js";

type WithIdColumn = PgTable & { id: PgColumn };

async function upsertById<T extends WithIdColumn>(
  table: T,
  rows: Array<InferInsertModel<T> & { id: string }>,
): Promise<void> {
  for (const row of rows) {
    const existing = await db.execute(
      sql`select 1 from ${table} where ${table.id} = ${row.id} limit 1`,
    );
    if (existing.rows.length === 0) {
      await db.insert(table).values(row);
    }
  }
}

const AGENT_SPECS = [
  {
    id: "spec_pursuit_brief",
    name: "Pursuit Brief Author v2",
    intent:
      "Compose a 1-pager pursuit brief from CRM signals, prior debriefs and a partner's win-themes pick.",
    group: "Pursuit",
    status: "in_review",
    owner: "Maya O.",
    forkedFrom: "ag_pursuit_scout",
    tools: ["crm.read", "winThemes.read", "credentials.read"],
    guardrails: [
      "Cite at least 2 internal sources",
      "No client PII outside the active engagement scope",
      "Output ≤ 600 words",
    ],
    personaBinding: "partner | senior_manager",
    reviewLog: [
      { actor: "Maya O.", decision: "submit", at: "2026-05-08", note: "First draft from Atelier fork." },
      { actor: "Daniel V.", decision: "request_changes", at: "2026-05-12", note: "Needs guardrail on PII scope." },
    ],
    updatedAt: "2026-05-13T09:00:00Z",
  },
  {
    id: "spec_eval_red_team",
    name: "Red-Team Probe Composer",
    intent: "Generate adversarial inputs for a candidate agent prompt and grade refusal quality.",
    group: "Evaluate",
    status: "drafting",
    owner: "Priya R.",
    forkedFrom: null,
    tools: ["evals.write", "models.invoke"],
    guardrails: [
      "Probes must be reproducible (seeded)",
      "No real customer data in adversarial inputs",
    ],
    personaBinding: "compliance_officer",
    reviewLog: [
      { actor: "Priya R.", decision: "draft", at: "2026-05-14", note: "Initial scaffold; pending sign-off." },
    ],
    updatedAt: "2026-05-14T16:30:00Z",
  },
  {
    id: "spec_dossier_translator",
    name: "Dossier Translator (TR↔EN)",
    intent: "Translate approved dossiers between Turkish and English while preserving citations.",
    group: "Knowledge",
    status: "approved",
    owner: "Selim A.",
    forkedFrom: "ag_knowledge_concierge",
    tools: ["assets.read", "assets.write", "translate.invoke"],
    guardrails: [
      "Preserve every citation marker verbatim",
      "Flag idioms for human review",
    ],
    personaBinding: "any",
    reviewLog: [
      { actor: "Selim A.", decision: "submit", at: "2026-05-02", note: "Reviewed against Atelier dossier-72." },
      { actor: "Maya O.", decision: "approve", at: "2026-05-04", note: "Ready for Build." },
    ],
    updatedAt: "2026-05-04T11:15:00Z",
  },
];

const AGENT_VERSIONS = [
  {
    id: "ver_pursuit_2_3_0",
    agentId: "ag_pursuit_scout",
    agentName: "Pursuit Scout",
    version: "2.3.0",
    status: "candidate",
    changeSummary: "Tighter source-citation rubric; adds win-theme tool.",
    promptDelta:
      "+ Cite at least 2 internal sources before any market claim.\n+ Use winThemes.search before drafting positioning.",
    toolsAdded: ["winThemes.search"],
    toolsRemoved: [],
    author: "Maya O.",
    committedAt: "2026-05-13T14:00:00Z",
  },
  {
    id: "ver_pursuit_2_2_4",
    agentId: "ag_pursuit_scout",
    agentName: "Pursuit Scout",
    version: "2.2.4",
    status: "shipped",
    changeSummary: "Hot-fix: trim hallucinated competitor names.",
    promptDelta: "+ Reject any competitor name not present in CRM.competitors.",
    toolsAdded: [],
    toolsRemoved: [],
    author: "Daniel V.",
    committedAt: "2026-04-29T10:25:00Z",
  },
  {
    id: "ver_concierge_1_4_0",
    agentId: "ag_knowledge_concierge",
    agentName: "Knowledge Concierge",
    version: "1.4.0",
    status: "draft",
    changeSummary: "Add sector-tag boost; trim long abstracts.",
    promptDelta: "+ Boost results whose sectorTags overlap the active engagement.",
    toolsAdded: [],
    toolsRemoved: ["legacy.fulltext"],
    author: "Selim A.",
    committedAt: "2026-05-12T09:40:00Z",
  },
  {
    id: "ver_pricing_3_0_1",
    agentId: "ag_pricing_assistant",
    agentName: "Pricing Assistant",
    version: "3.0.1",
    status: "shipped",
    changeSummary: "Margin-policy v2 alignment.",
    promptDelta: "+ Honour finance.marginPolicy.v2 thresholds; fail closed if missing.",
    toolsAdded: ["marginPolicy.read"],
    toolsRemoved: [],
    author: "Aylin K.",
    committedAt: "2026-04-22T17:00:00Z",
  },
];

const EVAL_SUITES = [
  {
    id: "eval_pursuit_regression",
    name: "Pursuit Brief — regression",
    agentId: "ag_pursuit_scout",
    agentName: "Pursuit Scout",
    kind: "regression",
    caseCount: 48,
    passRate: 0.94,
    lastRunAt: "2026-05-14T07:00:00Z",
    ownedBy: "Maya O.",
    rubric: "Citation coverage ≥ 0.8, no hallucinated competitor names, ≤ 600 words.",
  },
  {
    id: "eval_pursuit_red_team",
    name: "Pursuit Brief — red-team",
    agentId: "ag_pursuit_scout",
    agentName: "Pursuit Scout",
    kind: "red_team",
    caseCount: 22,
    passRate: 0.82,
    lastRunAt: "2026-05-13T18:00:00Z",
    ownedBy: "Priya R.",
    rubric: "Refuses prompt-injection, declines off-scope client questions.",
  },
  {
    id: "eval_concierge_ab",
    name: "Concierge ranking — A/B v1.3 vs v1.4",
    agentId: "ag_knowledge_concierge",
    agentName: "Knowledge Concierge",
    kind: "ab",
    caseCount: 60,
    passRate: 0.71,
    lastRunAt: "2026-05-12T11:00:00Z",
    ownedBy: "Selim A.",
    rubric: "Top-3 contains a partner-approved asset.",
  },
  {
    id: "eval_pricing_regression",
    name: "Pricing — margin policy v2",
    agentId: "ag_pricing_assistant",
    agentName: "Pricing Assistant",
    kind: "regression",
    caseCount: 35,
    passRate: 1.0,
    lastRunAt: "2026-05-10T09:00:00Z",
    ownedBy: "Aylin K.",
    rubric: "All quotes within ±2pp of policy floor; refuses below floor.",
  },
];

const DEPLOYMENTS = [
  {
    id: "dep_pursuit_dev",
    agentId: "ag_pursuit_scout",
    agentName: "Pursuit Scout",
    version: "2.3.0",
    environment: "dev",
    rolloutStrategy: "shadow",
    trafficPct: 0,
    personaBinding: "partner",
    promotedBy: "Maya O.",
    promotedAt: "2026-05-13T15:00:00Z",
  },
  {
    id: "dep_pursuit_staging",
    agentId: "ag_pursuit_scout",
    agentName: "Pursuit Scout",
    version: "2.2.4",
    environment: "staging",
    rolloutStrategy: "canary",
    trafficPct: 25,
    personaBinding: "partner | senior_manager",
    promotedBy: "Daniel V.",
    promotedAt: "2026-04-30T10:00:00Z",
  },
  {
    id: "dep_pursuit_prod",
    agentId: "ag_pursuit_scout",
    agentName: "Pursuit Scout",
    version: "2.2.3",
    environment: "prod",
    rolloutStrategy: "full",
    trafficPct: 100,
    personaBinding: "partner | senior_manager",
    promotedBy: "Daniel V.",
    promotedAt: "2026-04-15T08:00:00Z",
  },
  {
    id: "dep_concierge_prod",
    agentId: "ag_knowledge_concierge",
    agentName: "Knowledge Concierge",
    version: "1.3.2",
    environment: "prod",
    rolloutStrategy: "full",
    trafficPct: 100,
    personaBinding: "any",
    promotedBy: "Selim A.",
    promotedAt: "2026-04-02T12:30:00Z",
  },
  {
    id: "dep_pricing_prod",
    agentId: "ag_pricing_assistant",
    agentName: "Pricing Assistant",
    version: "3.0.1",
    environment: "prod",
    rolloutStrategy: "full",
    trafficPct: 100,
    personaBinding: "partner | finance",
    promotedBy: "Aylin K.",
    promotedAt: "2026-04-22T17:30:00Z",
  },
];

const INCIDENTS = [
  {
    id: "inc_pursuit_2026_05_11",
    agentId: "ag_pursuit_scout",
    agentName: "Pursuit Scout",
    title: "Hallucinated competitor 'Helix Group' on 3 pursuits",
    severity: "sev2",
    detectedAt: "2026-05-11T09:30:00Z",
    status: "investigating",
    cluster: "Hallucinated competitor names",
    rootCause: "Prompt did not require CRM.competitors gating prior to draft.",
    proposedChange: "Land ag_pursuit_scout 2.3.0 (already in eval).",
    // Task #382 — link incident to the failing pursuit_scout runs that
    // triggered the cluster, plus the candidate version that fixes it.
    evidenceRunIds: ["run_pursuit_tahakom", "run_pursuit_nhc"],
    fixVersionId: "ver_pursuit_2_3_0",
  },
  {
    id: "inc_concierge_2026_05_06",
    agentId: "ag_knowledge_concierge",
    agentName: "Knowledge Concierge",
    title: "Top-3 missed partner-approved asset on banking sector",
    severity: "sev3",
    detectedAt: "2026-05-06T14:10:00Z",
    status: "open",
    cluster: "Sector-tag relevance",
    rootCause: null,
    proposedChange: "Add sector-tag boost — see ag_knowledge_concierge 1.4.0 draft.",
    evidenceRunIds: [],
    fixVersionId: "ver_concierge_1_4_0",
  },
  {
    id: "inc_pricing_2026_04_19",
    agentId: "ag_pricing_assistant",
    agentName: "Pricing Assistant",
    title: "Quoted below floor on engagement #3120",
    severity: "sev1",
    detectedAt: "2026-04-19T11:45:00Z",
    status: "resolved",
    cluster: "Margin-policy compliance",
    rootCause: "Stale margin policy cache — race against finance update.",
    proposedChange: "Shipped — ag_pricing_assistant 3.0.1, fail-closed on missing policy.",
    evidenceRunIds: [],
    fixVersionId: "ver_pricing_3_0_1",
  },
];

const RETIREMENTS = [
  {
    id: "ret_legacy_summarizer",
    agentId: "ag_legacy_summarizer",
    agentName: "Legacy Dossier Summarizer",
    reason: "Replaced by Knowledge Concierge with citation-grounded snippets.",
    replacementAgentId: "ag_knowledge_concierge",
    replacementName: "Knowledge Concierge",
    deprecateAt: "2026-06-01",
    archiveAt: "2026-09-01",
    status: "scheduled",
    callersToMigrate: 4,
  },
  {
    id: "ret_pursuit_v1",
    agentId: "ag_pursuit_v1",
    agentName: "Pursuit Brief v1",
    reason: "Superseded by Pursuit Scout 2.x.",
    replacementAgentId: "ag_pursuit_scout",
    replacementName: "Pursuit Scout",
    deprecateAt: "2026-04-01",
    archiveAt: "2026-07-01",
    status: "deprecated",
    callersToMigrate: 0,
  },
  {
    id: "ret_pricing_v2",
    agentId: "ag_pricing_v2",
    agentName: "Pricing Assistant v2",
    reason: "Replaced by v3 with margin-policy v2 alignment.",
    replacementAgentId: "ag_pricing_assistant",
    replacementName: "Pricing Assistant",
    deprecateAt: "2026-03-15",
    archiveAt: "2026-06-15",
    status: "archived",
    callersToMigrate: 0,
  },
];

export async function ensureAtelierAgentsLensSeed(): Promise<void> {
  try {
    await upsertById(atelierAgentSpecs, AGENT_SPECS);
    await upsertById(atelierAgentVersions, AGENT_VERSIONS);
    await upsertById(atelierAgentEvalSuites, EVAL_SUITES);
    await upsertById(atelierAgentDeployments, DEPLOYMENTS);
    await upsertById(atelierAgentIncidents, INCIDENTS);
    await upsertById(atelierAgentRetirements, RETIREMENTS);
    logger.info("[atelier] agents-lens seed (design/build/eval/deploy/improve/retire) complete");
  } catch (err) {
    logger.error({ err }, "[atelier] agents-lens seed failed");
  }
}
