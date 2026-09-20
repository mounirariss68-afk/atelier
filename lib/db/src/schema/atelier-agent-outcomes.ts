/**
 * Append-only CRM agent outcome ledger (Task 1351).
 *
 * Deliberately stores measurements, never model/content transcripts.  The
 * application service validates links and strips metadata before insertion.
 */
import {
  pgTable, text, timestamp, integer, doublePrecision, boolean,
  jsonb, index, uniqueIndex,
} from "drizzle-orm/pg-core";

export const atelierAgentOutcomeEvents = pgTable("atelier_agent_outcome_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().default("aico"),
  eventKey: text("event_key").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  runId: text("run_id").notNull(),
  agentId: text("agent_id").notNull(),
  agentVersion: text("agent_version").notNull(),
  registryVersion: text("registry_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  promptHash: text("prompt_hash"),
  model: text("model").notNull(),
  actorUserId: text("actor_user_id"),
  originEntityType: text("origin_entity_type").notNull(),
  originEntityId: text("origin_entity_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  entryPath: text("entry_path").notNull(),
  outcomeKind: text("outcome_kind").notNull(),
  // Explicit terminal statuses include expired/superseded; a supersession
  // never mutates the prior row. Missing source-domain hooks are represented
  // through missingLinks/dataQualityFlags rather than fabricated outcomes.
  outcomeStatus: text("outcome_status").notNull(),
  priorState: text("prior_state"),
  currentState: text("current_state"),
  editDistance: doublePrecision("edit_distance"),
  reworkCount: integer("rework_count"),
  sourceAcceptedCount: integer("source_accepted_count"),
  sourceRejectedCount: integer("source_rejected_count"),
  predictedValue: doublePrecision("predicted_value"),
  actualValue: doublePrecision("actual_value"),
  supersedesEventId: text("supersedes_event_id"),
  missingLinks: jsonb("missing_links").$type<string[]>().notNull().default([]),
  dataQualityFlags: jsonb("data_quality_flags").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
}, (t) => [
  uniqueIndex("uq_agent_outcome_org_event_key").on(t.orgId, t.eventKey),
  index("idx_agent_outcome_org_time").on(t.orgId, t.occurredAt),
  index("idx_agent_outcome_org_agent").on(t.orgId, t.agentId),
  index("idx_agent_outcome_org_entity").on(t.orgId, t.entityType, t.entityId),
]);

export const atelierAgentRunSnapshots = pgTable("atelier_agent_run_snapshots", {
  runId: text("run_id").primaryKey(),
  orgId: text("org_id").notNull().default("aico"),
  agentId: text("agent_id").notNull(),
  agentVersion: text("agent_version").notNull(),
  registryVersion: text("registry_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  promptHash: text("prompt_hash"),
  model: text("model").notNull(),
  entryPath: text("entry_path").notNull(),
  dataQualityFlags: jsonb("data_quality_flags").$type<string[]>().notNull().default([]),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_agent_run_snapshot_org").on(t.orgId),
  index("idx_agent_run_snapshot_agent").on(t.orgId, t.agentId),
]);

export type AgentOutcomeEvent = typeof atelierAgentOutcomeEvents.$inferSelect;
export type InsertAgentOutcomeEvent = typeof atelierAgentOutcomeEvents.$inferInsert;