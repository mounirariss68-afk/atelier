/**
 * THE ATELIER — Agents lens schema (Task #373).
 *
 * Persistence for the Design / Build / Evaluate / Deploy / Improve / Retire
 * stages of the Agents lens. Migrates the previous client-side seed in
 * artifacts/atelier/src/lib/agents-lens-seed.ts to Postgres, in line with
 * the v5 Press / Studio / Guardhouse pattern.
 *
 * All tables follow the existing Atelier conventions:
 *   - text PKs (deterministic slugs so seed/audit traffic stays readable)
 *   - org_id default 'aico' (multi-tenant scope, enforced at app layer)
 *   - created_at / updated_at / created_by_user_id / deleted_at
 *
 * Engagement scoping: none — these are firm-wide agent-lifecycle surfaces.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  index,
} from "drizzle-orm/pg-core";

const ORG = (name: string) => text(name).notNull().default("aico");
const COMMON = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: text("created_by_user_id"),
  deletedAt: timestamp("deleted_at"),
};

// ============================================================
// DESIGN — agent specs awaiting Build
// ============================================================
export const atelierAgentSpecs = pgTable(
  "atelier_agent_specs",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    intent: text("intent").notNull().default(""),
    group: text("group_name").notNull().default(""),
    status: text("status").notNull(),
    owner: text("owner").notNull(),
    forkedFrom: text("forked_from"),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    guardrails: jsonb("guardrails").$type<string[]>().notNull().default([]),
    personaBinding: text("persona_binding").notNull().default(""),
    reviewLog: jsonb("review_log")
      .$type<
        Array<{ actor: string; decision: string; at: string; note: string }>
      >()
      .notNull()
      .default([]),
    ...COMMON,
    // Override COMMON.updatedAt with the seed-supplied display value so the
    // client sees the spec's own last-edit time, not the Postgres row mtime.
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_atelier_agent_specs_org").on(t.orgId),
    index("idx_atelier_agent_specs_status").on(t.status),
  ],
);

// ============================================================
// BUILD — versions, change-log, tool wiring
// ============================================================
export const atelierAgentVersions = pgTable(
  "atelier_agent_versions",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    agentId: text("agent_id").notNull(),
    agentName: text("agent_name").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull(),
    changeSummary: text("change_summary").notNull().default(""),
    promptDelta: text("prompt_delta").notNull().default(""),
    toolsAdded: jsonb("tools_added").$type<string[]>().notNull().default([]),
    toolsRemoved: jsonb("tools_removed").$type<string[]>().notNull().default([]),
    author: text("author").notNull(),
    committedAt: text("committed_at").notNull(),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_agent_versions_org").on(t.orgId),
    index("idx_atelier_agent_versions_agent").on(t.agentId),
  ],
);

// ============================================================
// EVALUATE — eval suites, golden datasets, scorecards
// ============================================================
export const atelierAgentEvalSuites = pgTable(
  "atelier_agent_eval_suites",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    name: text("name").notNull(),
    agentId: text("agent_id").notNull(),
    agentName: text("agent_name").notNull(),
    kind: text("kind").notNull(),
    caseCount: integer("case_count").notNull().default(0),
    passRate: doublePrecision("pass_rate").notNull().default(0),
    lastRunAt: text("last_run_at").notNull(),
    ownedBy: text("owned_by").notNull(),
    rubric: text("rubric").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_agent_eval_org").on(t.orgId),
    index("idx_atelier_agent_eval_agent").on(t.agentId),
  ],
);

// ============================================================
// DEPLOY — environments, rollout strategy, persona binding
// ============================================================
export const atelierAgentDeployments = pgTable(
  "atelier_agent_deployments",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    agentId: text("agent_id").notNull(),
    agentName: text("agent_name").notNull(),
    version: text("version").notNull(),
    environment: text("environment").notNull(),
    rolloutStrategy: text("rollout_strategy").notNull().default(""),
    trafficPct: integer("traffic_pct").notNull().default(0),
    personaBinding: text("persona_binding").notNull().default(""),
    promotedBy: text("promoted_by").notNull(),
    promotedAt: text("promoted_at").notNull(),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_agent_deploys_org").on(t.orgId),
    index("idx_atelier_agent_deploys_env").on(t.environment),
  ],
);

// ============================================================
// IMPROVE — incidents and post-mortems
// ============================================================
export const atelierAgentIncidents = pgTable(
  "atelier_agent_incidents",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    agentId: text("agent_id").notNull(),
    agentName: text("agent_name").notNull(),
    title: text("title").notNull(),
    severity: text("severity").notNull(),
    detectedAt: text("detected_at").notNull(),
    status: text("status").notNull(),
    cluster: text("cluster").notNull().default(""),
    rootCause: text("root_cause"),
    proposedChange: text("proposed_change").notNull().default(""),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_agent_incidents_org").on(t.orgId),
    index("idx_atelier_agent_incidents_status").on(t.status),
  ],
);

// ============================================================
// RETIRE — deprecation schedule, replacement mapping
// ============================================================
export const atelierAgentRetirements = pgTable(
  "atelier_agent_retirements",
  {
    id: text("id").primaryKey(),
    orgId: ORG("org_id"),
    agentId: text("agent_id").notNull(),
    agentName: text("agent_name").notNull(),
    reason: text("reason").notNull().default(""),
    replacementAgentId: text("replacement_agent_id"),
    replacementName: text("replacement_name"),
    deprecateAt: text("deprecate_at").notNull(),
    archiveAt: text("archive_at").notNull(),
    status: text("status").notNull(),
    callersToMigrate: integer("callers_to_migrate").notNull().default(0),
    ...COMMON,
  },
  (t) => [
    index("idx_atelier_agent_retire_org").on(t.orgId),
    index("idx_atelier_agent_retire_status").on(t.status),
  ],
);
