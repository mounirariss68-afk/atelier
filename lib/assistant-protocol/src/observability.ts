import { z } from "zod";

export const RISER_OBSERVABILITY_VERSION = "riser-observability/v1" as const;

export const RiserObservationStageV1Schema = z.enum([
  "interpretation",
  "candidate_selection",
  "abstention",
  "resolution",
  "policy",
  "preview",
  "confirm",
  "execute",
  "replay",
  "workflow_plan",
  "workflow_attempt",
  "lease",
  "retry",
  "compensation",
  "presentation_proposed",
  "presentation_emitted",
  "presentation_suppressed",
  "terminal_outcome",
  "security",
]);

const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:/+-]+$/)
  .refine(
    (value) => !/(secret|password|bearer|api[_-]?key|sk_live|sk_test)/i.test(value),
    "sensitive-observation-identifier",
  );

const optionalIdentifier = identifier.nullable().optional();

export const RiserObservationDimensionsV1Schema = z
  .record(
    z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/),
    z.union([z.boolean(), z.number().finite()]),
  )
  .refine((value) => Object.keys(value).length <= 24, "too-many-observation-dimensions");

export const RiserObservationV1Schema = z
  .object({
    version: z.literal(RISER_OBSERVABILITY_VERSION),
    eventId: identifier,
    orgId: identifier,
    stage: RiserObservationStageV1Schema,
    outcome: z.enum([
      "allowed",
      "rejected",
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
      "selected",
      "no_tool",
      "abstained",
      "resolved",
      "unique",
      "not_found",
      "ambiguous",
      "stale",
      "awaiting_confirmation",
      "confirmed",
      "executing",
      "succeeded",
      "failed",
      "partial",
      "partially_succeeded",
      "compensated",
      "cancelled",
      "expired",
      "invalidated",
      "created",
      "running",
      "retryable",
      "permanent",
      "blocked",
      "compensation_required",
      "acquired",
      "lost",
      "scheduled",
      "required",
      "evaluated",
      "relevant",
      "no_relevant_card",
      "requested",
      "completed",
      "gap",
      "forged_confirm_rejected",
      "supported",
      "success",
      "error",
      "awaiting_clarification",
      "read_only_no_op",
      "awaiting_aggregation",
      "async_dispatched",
    ]),
    securityEvent: z.boolean(),
    samplingMode: z.enum(["always", "deterministic"]),
    sampleRate: z.number().min(0).max(1),
    occurredAt: z.string().datetime(),
    conversationId: optionalIdentifier,
    turnId: optionalIdentifier,
    intentId: optionalIdentifier,
    actionId: optionalIdentifier,
    workItemId: optionalIdentifier,
    stepId: optionalIdentifier,
    attemptId: optionalIdentifier,
    capabilityId: optionalIdentifier,
    catalogVersion: optionalIdentifier,
    schemaVersion: optionalIdentifier,
    policyVersion: optionalIdentifier,
    modelVersion: optionalIdentifier,
    deploymentVersion: optionalIdentifier,
    reasonCode: z
      .enum([
        "no_tool",
        "no_relevant_card",
        "card_budget",
        "minimum_data",
        "policy_denied",
        "provider_fault",
        "workflow_error",
        "lease_expired",
        "catalog_mismatch",
        "authority_changed",
        "budget_unavailable",
      ])
      .nullable()
      .optional(),
    dimensions: RiserObservationDimensionsV1Schema.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.conversationId &&
      !value.turnId &&
      !value.actionId &&
      !value.workItemId &&
      !value.attemptId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "observation-correlation-required",
      });
    }
    if (
      value.securityEvent &&
      (value.samplingMode !== "always" || value.sampleRate !== 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "security-observation-must-bypass-sampling",
      });
    }
  });

export type RiserObservationStageV1 = z.infer<
  typeof RiserObservationStageV1Schema
>;
export type RiserObservationV1 = z.infer<typeof RiserObservationV1Schema>;