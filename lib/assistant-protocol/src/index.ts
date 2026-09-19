import { z } from "zod";

export * from "./legacy.js";
export * from "./privacy.js";

export const ASSISTANT_PROTOCOL_VERSION = 1 as const;

const boundedId = z.string().min(1).max(200);
const nullableId = boundedId.nullable().optional();

export const PageContextV1Schema = z
  .object({
    surface: z.string().min(1).max(100).optional(),
    currentPath: z.string().min(1).max(500).optional(),
    route: z.string().min(1).max(500).optional(),
    pathname: z.string().min(1).max(500).optional(),
    activeAccountId: boundedId.optional(),
    activeOpportunityId: boundedId.optional(),
    activeEngagementId: boundedId.optional(),
    activePersonId: boundedId.optional(),
    activeExpenseId: boundedId.optional(),
    activeAgentId: boundedId.optional(),
    accountId: boundedId.optional(),
    engagementId: boundedId.optional(),
    opportunityId: boundedId.optional(),
    contactId: boundedId.optional(),
    entityId: boundedId.optional(),
    entityType: z.string().min(1).max(80).optional(),
    tab: z.string().min(1).max(80).optional(),
  })
  .strict();

export const ClarificationValuesV1Schema = z
  .record(z.string().min(1).max(200), z.string().max(16_384))
  .refine((value) => Object.keys(value).length <= 40, "too-many-clarification-values");

export const AssistantRequestV1Schema = z
  .object({
    protocolVersion: z.literal(ASSISTANT_PROTOCOL_VERSION).default(ASSISTANT_PROTOCOL_VERSION),
    conversationId: nullableId,
    prompt: z.string().min(1).max(16_384),
    attachmentIds: z.array(boundedId).max(20).default([]),
    pageContext: PageContextV1Schema.nullable().optional(),
    dryRun: z.boolean().default(false),
    cancelInflight: z.boolean().default(false),
    clientTurnKey: nullableId,
    async: z.boolean().default(false),
    reset: z.boolean().default(false),
    continuesTurnId: nullableId,
    clarificationValues: ClarificationValuesV1Schema.nullable().optional(),
    disambigOptionId: nullableId,
    locale: z.string().min(2).max(35).optional(),
    timezone: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();

export type AssistantRequestV1 = z.infer<typeof AssistantRequestV1Schema>;

export const LegacyAssistantRequestSchema = AssistantRequestV1Schema.omit({
  protocolVersion: true,
  conversationId: true,
})
  .extend({
    sessionId: nullableId,
    /** Diagnostic-only compatibility field. It is never copied into V1. */
    intent: z.unknown().optional(),
  })
  .strict();

export type LegacyAssistantRequest = z.infer<typeof LegacyAssistantRequestSchema>;

export function upcastLegacyAssistantRequest(input: LegacyAssistantRequest): AssistantRequestV1 {
  const { sessionId, intent: _ignoredIntent, ...rest } = input;
  return AssistantRequestV1Schema.parse({
    ...rest,
    protocolVersion: ASSISTANT_PROTOCOL_VERSION,
    conversationId: sessionId ?? null,
  });
}

export const PublicErrorV1Schema = z
  .object({
    protocolVersion: z.literal(ASSISTANT_PROTOCOL_VERSION),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(500),
    correlationId: boundedId,
  })
  .strict();

export type PublicErrorV1 = z.infer<typeof PublicErrorV1Schema>;

export const IntentOperationV1Schema = z.enum([
  "read",
  "create",
  "update",
  "link",
  "transition",
  "delete",
  "navigate",
  "workflow",
  "reset",
  "trivial",
  "other",
]);

export const InterpretedIntentV1Schema = z
  .object({
    id: boundedId,
    goal: z.string().min(1).max(1_000),
    operation: IntentOperationV1Schema,
    kind: z.string().min(1).max(100),
    mentions: z.array(z.string().min(1).max(200)).max(20),
    constraints: z.record(z.string(), z.unknown()),
    confidence: z.number().min(0).max(1),
    ambiguity: z
      .object({
        class: z.enum(["entity", "operation", "constraint", "destructive", "conflicting"]),
        reason: z.string().min(1).max(500),
      })
      .strict()
      .nullable(),
    abstention: z
      .object({
        code: z.enum(["unsupported", "unsafe", "insufficient_context", "provider_unavailable"]),
        reason: z.string().min(1).max(500),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type InterpretedIntentV1 = z.infer<typeof InterpretedIntentV1Schema>;

export const ResolverResultV1Schema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("unique"),
      entityId: boundedId,
      entityType: z.string().min(1).max(100),
      orgId: boundedId,
      revision: z.string().min(1).max(200),
      visibilityDecision: z.literal("allowed"),
    })
    .strict(),
  z
    .object({
      status: z.literal("ambiguous"),
      candidates: z
        .array(
          z
            .object({
              entityId: boundedId,
              entityType: z.string().min(1).max(100),
              label: z.string().min(1).max(300),
              revision: z.string().min(1).max(200),
            })
            .strict(),
        )
        .min(2)
        .max(20),
    })
    .strict(),
  z.object({ status: z.literal("not_found") }).strict(),
  z
    .object({
      status: z.literal("stale"),
      entityId: boundedId,
      expectedRevision: z.string().min(1).max(200),
      actualRevision: z.string().min(1).max(200).nullable(),
    })
    .strict(),
]);

export type ResolverResultV1 = z.infer<typeof ResolverResultV1Schema>;

export const PolicyDecisionV1Schema = z.discriminatedUnion("effect", [
  z
    .object({
      effect: z.literal("allow"),
      policyVersion: z.string().min(1).max(100),
      obligations: z.array(z.string().min(1).max(200)).max(30),
      decisionDigest: z.string().min(32).max(200),
    })
    .strict(),
  z
    .object({
      effect: z.literal("deny"),
      policyVersion: z.string().min(1).max(100),
      code: z.string().min(1).max(100),
      safeReason: z.string().min(1).max(500),
      decisionDigest: z.string().min(32).max(200),
    })
    .strict(),
  z
    .object({
      effect: z.literal("clarify"),
      policyVersion: z.string().min(1).max(100),
      fields: z.array(z.string().min(1).max(100)).min(1).max(20),
      decisionDigest: z.string().min(32).max(200),
    })
    .strict(),
]);

export type PolicyDecisionV1 = z.infer<typeof PolicyDecisionV1Schema>;

export const ActionStateV1Schema = z.enum([
  "draft",
  "previewed",
  "awaiting_confirmation",
  "confirmed",
  "executing",
  "succeeded",
  "failed",
  "partially_succeeded",
  "compensated",
  "cancelled",
  "expired",
  "invalidated",
]);

export type ActionStateV1 = z.infer<typeof ActionStateV1Schema>;

const ACTION_TRANSITIONS: Readonly<Record<ActionStateV1, readonly ActionStateV1[]>> = {
  draft: ["previewed", "cancelled"],
  previewed: ["awaiting_confirmation", "cancelled", "invalidated"],
  awaiting_confirmation: ["confirmed", "cancelled", "expired", "invalidated"],
  confirmed: ["executing", "invalidated"],
  executing: ["succeeded", "failed", "partially_succeeded", "compensated"],
  succeeded: [],
  failed: [],
  partially_succeeded: [],
  compensated: [],
  cancelled: [],
  expired: [],
  invalidated: [],
};

export function assertActionTransition(from: ActionStateV1, to: ActionStateV1): void {
  if (!ACTION_TRANSITIONS[from].includes(to)) {
    throw new Error(`invalid-action-transition:${from}:${to}`);
  }
}

export const ActionPreviewV1Schema = z
  .object({
    actionId: boundedId,
    capabilityId: boundedId,
    summary: z.string().min(1).max(1_000),
    diff: z.unknown(),
    inputDigest: z.string().min(32).max(200),
    irreversible: z.boolean(),
    outboundChannels: z.array(z.string().min(1).max(100)).max(20),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const ConfirmationRequiredV1Schema = ActionPreviewV1Schema.extend({
  stateVersion: z.number().int().positive(),
  typedEvidence: z
    .object({
      label: z.string().min(1).max(200),
      expectedDigest: z.string().min(32).max(200),
    })
    .strict()
    .optional(),
}).strict();

export const ExecutionResultV1Schema = z
  .object({
    actionId: boundedId,
    capabilityId: boundedId,
    status: z.enum(["succeeded", "partially_succeeded", "failed", "compensated"]),
    data: z.unknown(),
    auditEventIds: z.array(boundedId),
    navigation: z.object({ path: z.string().min(1).max(1_000) }).strict().optional(),
    retryable: z.boolean(),
  })
  .strict();

export const PresentationV1Schema = z
  .object({
    id: boundedId,
    answersIntentIds: z.array(boundedId).min(1).max(20),
    capabilityId: boundedId,
    resultSourceId: boundedId,
    relationship: z.enum(["primary", "supplementary"]),
    cardType: z.string().min(1).max(100),
    data: z.unknown(),
    minimumDataVersion: z.number().int().positive(),
    relevanceReason: z.string().min(1).max(500),
  })
  .strict();

export type PresentationV1 = z.infer<typeof PresentationV1Schema>;

function presentationObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasMeaningfulEntityIdentity(value: unknown): boolean {
  const entity = presentationObject(value);
  if (!entity || typeof entity.id !== "string" || entity.id.trim().length === 0) return false;
  return ["name", "fullName", "title", "label"].some(
    (key) => typeof entity[key] === "string" && (entity[key] as string).trim().length > 0,
  );
}

function hasMeaningfulPresentationValue(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) {
    return value.length > 0 && value.some((item) => hasMeaningfulPresentationValue(item, depth + 1));
  }
  const object = presentationObject(value);
  return Boolean(
    object &&
      Object.keys(object).length > 0 &&
      Object.values(object).some((item) => hasMeaningfulPresentationValue(item, depth + 1)),
  );
}

const PRESENTATION_V1_PAIRS = new Set([
  "roster.list|roster_list|ranked_list",
  "roster.person_detail|person_detail|contact_card",
]);

export function isAllowedPresentationV1Pair(args: {
  capabilityId: string;
  resultSourceId: string;
  cardType: string;
}): boolean {
  return PRESENTATION_V1_PAIRS.has(
    `${args.capabilityId}|${args.resultSourceId}|${args.cardType}`,
  );
}

const ENTITY_DATA_KEYS: Readonly<Record<string, readonly string[]>> = {
  account_card: ["account"],
  contact_card: ["contact", "person"],
  opportunity_card: ["opportunity"],
};

export function hasMinimumPresentationData(cardType: string, data: unknown): boolean {
  const root = presentationObject(data);
  if (!root) return false;
  if (cardType === "ranked_list") {
    if (!Array.isArray(root.items)) return false;
    return root.items.every((item) => {
      const row = presentationObject(item);
      if (!row || Object.keys(row).length === 0) return false;
      return Object.values(row).some((value) => hasMeaningfulPresentationValue(value));
    });
  }
  const nestedKeys = ENTITY_DATA_KEYS[cardType];
  if (!nestedKeys) return false;
  if (hasMeaningfulEntityIdentity(root)) return true;
  return nestedKeys.some((key) => hasMeaningfulEntityIdentity(root[key]));
}

export const WorkPlanV1Schema = z
  .object({
    workItemId: boundedId,
    version: z.number().int().positive(),
    goal: z.string().min(1).max(2_000),
    steps: z
      .array(
        z
          .object({
            id: boundedId,
            capabilityId: boundedId.optional(),
            delegateAgentId: boundedId.optional(),
            dependencies: z.array(boundedId).max(100),
            input: z.unknown(),
            authorityGrant: z.record(z.string(), z.unknown()),
            policyDecisionDigest: z.string().min(32).max(200),
            resultSchemaHash: z.string().min(12).max(200),
            retryPolicy: z
              .object({
                maxAttempts: z.number().int().min(1).max(10),
                maxWallMs: z.number().int().min(1).max(86_400_000),
              })
              .strict(),
          })
          .strict()
          .refine((step) => Boolean(step.capabilityId) !== Boolean(step.delegateAgentId), {
            message: "exactly-one-executor-required",
          }),
      )
      .min(1)
      .max(200),
  })
  .strict();

export type WorkPlanV1 = z.infer<typeof WorkPlanV1Schema>;

export function validateAcyclicWorkPlan(plan: WorkPlanV1): void {
  if (new Set(plan.steps.map((step) => step.id)).size !== plan.steps.length) {
    throw new Error("workflow-duplicate-step-id");
  }
  const ids = new Set(plan.steps.map((step) => step.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("workflow-cycle");
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step) throw new Error("workflow-missing-step");
    visiting.add(id);
    for (const dependency of step.dependencies) {
      if (!ids.has(dependency)) throw new Error("workflow-missing-dependency");
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of plan.steps) visit(step.id);
}

const assistantEventBase = z.object({
  protocolVersion: z.literal(ASSISTANT_PROTOCOL_VERSION),
  conversationId: boundedId,
  turnId: boundedId,
  eventId: boundedId,
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  correlationId: boundedId,
});

export const AssistantEventV1Schema = assistantEventBase
  .extend({
    type: z.string().min(1).max(100),
    data: z.unknown(),
  })
  .strict();

export type AssistantEventV1 = z.infer<typeof AssistantEventV1Schema>;