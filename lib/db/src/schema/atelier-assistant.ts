import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const atelierAssistantActions = pgTable(
  "atelier_assistant_actions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    requesterId: text("requester_id").notNull(),
    conversationId: text("conversation_id"),
    sourceTurnId: text("source_turn_id"),
    capabilityId: text("capability_id").notNull(),
    catalogVersion: text("catalog_version").notNull(),
    inputSchemaVersion: integer("input_schema_version").notNull(),
    inputDigest: text("input_digest").notNull(),
    requestDigest: text("request_digest").notNull(),
    canonicalInputEncrypted: text("canonical_input_encrypted").notNull(),
    targetRefsAndRevisions: jsonb("target_refs_and_revisions").$type<unknown[]>().notNull().default([]),
    policyVersion: text("policy_version").notNull(),
    policyDecisionDigest: text("policy_decision_digest").notNull(),
    obligations: jsonb("obligations").$type<unknown[]>().notNull().default([]),
    riskClass: text("risk_class").notNull(),
    irreversible: boolean("irreversible").notNull().default(false),
    outboundChannels: jsonb("outbound_channels").$type<string[]>().notNull().default([]),
    previewSnapshot: jsonb("preview_snapshot").$type<unknown>(),
    typedEvidenceDigest: text("typed_evidence_digest"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("draft"),
    stateVersion: integer("state_version").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    executorFence: integer("executor_fence").notNull().default(0),
    result: jsonb("result").$type<unknown>(),
    publicError: jsonb("public_error").$type<unknown>(),
    auditEventIds: jsonb("audit_event_ids").$type<string[]>().notNull().default([]),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_assistant_actions_owner").on(t.orgId, t.requesterId),
    index("idx_assistant_actions_state").on(t.orgId, t.state),
    uniqueIndex("uq_assistant_actions_idempotency").on(
      t.orgId,
      t.requesterId,
      t.idempotencyKey,
    ),
  ],
);

export const atelierAssistantEvents = pgTable(
  "atelier_assistant_events",
  {
    id: text("id").primaryKey(),
    protocolVersion: integer("protocol_version").notNull(),
    orgId: text("org_id").notNull(),
    requesterId: text("requester_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    turnId: text("turn_id").notNull(),
    sequence: integer("sequence").notNull(),
    conversationSequence: integer("conversation_sequence").notNull(),
    correlationId: text("correlation_id").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").$type<unknown>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_assistant_event_sequence").on(t.turnId, t.sequence),
    uniqueIndex("uq_assistant_event_scoped_sequence").on(
      t.orgId,
      t.conversationId,
      t.turnId,
      t.sequence,
    ),
    uniqueIndex("uq_assistant_event_conversation_sequence").on(
      t.orgId,
      t.conversationId,
      t.conversationSequence,
    ),
    index("idx_assistant_events_conversation").on(t.orgId, t.conversationId, t.createdAt),
    index("idx_assistant_events_requester").on(t.orgId, t.requesterId, t.createdAt),
  ],
);

export const atelierAssistantOutbox = pgTable(
  "atelier_assistant_outbox",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    actionId: text("action_id")
      .notNull()
      .references(() => atelierAssistantActions.id, { onDelete: "cascade" }),
    destination: text("destination").notNull(),
    providerIdempotencyKey: text("provider_idempotency_key").notNull(),
    requestEncrypted: text("request_encrypted").notNull(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    providerResult: jsonb("provider_result").$type<unknown>(),
    lastErrorCode: text("last_error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_assistant_outbox_provider_key").on(t.destination, t.providerIdempotencyKey),
    index("idx_assistant_outbox_state").on(t.state, t.nextAttemptAt),
  ],
);

export const atelierAssistantBudgetLedgers = pgTable(
  "atelier_assistant_budget_ledgers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    parentLedgerId: text("parent_ledger_id"),
    policyVersion: text("policy_version").notNull(),
    maxCostMicros: integer("max_cost_micros").notNull(),
    reservedCostMicros: integer("reserved_cost_micros").notNull().default(0),
    committedCostMicros: integer("committed_cost_micros").notNull().default(0),
    maxProviderCalls: integer("max_provider_calls").notNull(),
    reservedProviderCalls: integer("reserved_provider_calls").notNull().default(0),
    committedProviderCalls: integer("committed_provider_calls").notNull().default(0),
    maxToolCalls: integer("max_tool_calls").notNull(),
    reservedToolCalls: integer("reserved_tool_calls").notNull().default(0),
    committedToolCalls: integer("committed_tool_calls").notNull().default(0),
    maxWallMs: integer("max_wall_ms").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_assistant_budget_owner").on(t.orgId, t.ownerType, t.ownerId),
  ],
);

export const atelierAssistantBudgetReservations = pgTable(
  "atelier_assistant_budget_reservations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ledgerId: text("ledger_id")
      .notNull()
      .references(() => atelierAssistantBudgetLedgers.id, { onDelete: "cascade" }),
    ledgerIds: jsonb("ledger_ids").$type<string[]>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    costMicros: integer("cost_micros").notNull(),
    providerCalls: integer("provider_calls").notNull(),
    toolCalls: integer("tool_calls").notNull(),
    state: text("state").notNull().default("reserved"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_assistant_budget_reservation_key").on(t.orgId, t.idempotencyKey),
    index("idx_assistant_budget_reservation_state").on(t.orgId, t.state),
  ],
);

export const atelierAssistantControls = pgTable(
  "atelier_assistant_controls",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    scope: text("scope").notNull(),
    scopeKey: text("scope_key").notNull(),
    mode: text("mode").notNull(),
    inflightBehavior: text("inflight_behavior").notNull(),
    reason: text("reason").notNull(),
    version: integer("version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    createdByUserId: text("created_by_user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_assistant_control_scope").on(t.orgId, t.scope, t.scopeKey, t.version),
    index("idx_assistant_controls_enabled").on(t.orgId, t.enabled),
  ],
);

export const atelierWorkItems = pgTable(
  "atelier_work_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    requesterId: text("requester_id").notNull(),
    goal: text("goal").notNull(),
    status: text("status").notNull().default("draft"),
    conversationLinks: jsonb("conversation_links").$type<string[]>().notNull().default([]),
    budgetLedgerId: text("budget_ledger_id").references(() => atelierAssistantBudgetLedgers.id),
    policyContext: jsonb("policy_context").$type<unknown>().notNull(),
    catalogVersion: text("catalog_version").notNull(),
    cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
    aggregateResult: jsonb("aggregate_result").$type<unknown>(),
    aggregateEvidence: jsonb("aggregate_evidence").$type<unknown[]>().notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_work_items_owner").on(t.orgId, t.requesterId),
    index("idx_work_items_status").on(t.orgId, t.status),
    check(
      "chk_work_item_status",
      sql`${t.status} in ('draft','planned','blocked','cancellation_settling','recovery_settling','awaiting_aggregation','succeeded','failed','cancelled','compensation_required','compensated')`,
    ),
  ],
);

export const atelierWorkPlans = pgTable(
  "atelier_work_plans",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => atelierWorkItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_work_plan_version").on(t.workItemId, t.version)],
);

export const atelierWorkSteps = pgTable(
  "atelier_work_steps",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => atelierWorkItems.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => atelierWorkPlans.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id"),
    delegateAgentId: text("delegate_agent_id"),
    dependencies: jsonb("dependencies").$type<string[]>().notNull().default([]),
    inputEncrypted: text("input_encrypted").notNull(),
    authorityGrant: jsonb("authority_grant").$type<unknown>().notNull(),
    policyDecisionDigest: text("policy_decision_digest").notNull(),
    policyVersion: text("policy_version").notNull().default("legacy-fail-closed"),
    policyObligations: jsonb("policy_obligations").$type<string[]>().notNull().default([]),
    toolsDataPerimeter: jsonb("tools_data_perimeter").$type<{
      toolIds: string[];
      dataClasses: string[];
    }>().notNull().default({ toolIds: [], dataClasses: [] }),
    budgetGrant: jsonb("budget_grant").$type<{
      maxCostMicros: number;
      maxToolCalls: number;
      maxProviderCalls: number;
    }>().notNull().default({
      maxCostMicros: 0,
      maxToolCalls: 0,
      maxProviderCalls: 0,
    }),
    catalogVersion: text("catalog_version").notNull(),
    inputSchemaVersion: integer("input_schema_version").notNull(),
    budgetLedgerId: text("budget_ledger_id").references(() => atelierAssistantBudgetLedgers.id),
    retryPolicy: jsonb("retry_policy").$type<unknown>().notNull(),
    resultSchemaHash: text("result_schema_hash").notNull(),
    compensation: jsonb("compensation").$type<unknown>(),
    checkpointSpec: jsonb("checkpoint_spec").$type<unknown>(),
    parentStepId: text("parent_step_id"),
    evidenceLineage: jsonb("evidence_lineage").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("blocked"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_work_steps_plan").on(t.planId),
    index("idx_work_steps_status").on(t.workItemId, t.status),
    check(
      "chk_work_step_status",
      sql`${t.status} in ('blocked','ready','running','succeeded','failed','cancelled','compensation_required','compensated')`,
    ),
  ],
);

export const atelierWorkAttempts = pgTable(
  "atelier_work_attempts",
  {
    id: text("id").primaryKey(),
    stepId: text("step_id")
      .notNull()
      .references(() => atelierWorkSteps.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull().default("queued"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    fencingToken: integer("fencing_token").notNull().default(0),
    budgetReservationId: text("budget_reservation_id").references(
      () => atelierAssistantBudgetReservations.id,
    ),
    result: jsonb("result").$type<unknown>(),
    errorClass: text("error_class"),
    publicError: jsonb("public_error").$type<unknown>(),
    evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
    costMicros: integer("cost_micros").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    providerCalls: integer("provider_calls").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_work_attempt_number").on(t.stepId, t.attemptNumber),
    index("idx_work_attempt_lease").on(t.status, t.leaseExpiresAt),
    check(
      "chk_work_attempt_status",
      sql`${t.status} in ('queued','running','committing','succeeded','retryable','permanent','ambiguous','blocked','cancelled','compensation_required','compensated')`,
    ),
  ],
);

export const atelierWorkCheckpoints = pgTable(
  "atelier_work_checkpoints",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => atelierWorkItems.id, { onDelete: "cascade" }),
    stepId: text("step_id").references(() => atelierWorkSteps.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    requiredDecider: jsonb("required_decider").$type<unknown>().notNull(),
    decision: text("decision"),
    evidence: jsonb("evidence").$type<unknown>(),
    decidedByUserId: text("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_work_checkpoint_open").on(t.workItemId, t.decision, t.expiresAt),
    check(
      "chk_work_checkpoint_decision",
      sql`${t.decision} is null or ${t.decision} in ('approve','reject')`,
    ),
  ],
);