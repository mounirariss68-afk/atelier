import { z } from "zod";

export const ASSISTANT_OPERATOR_CONTROL_VERSION =
  "assistant-operator-control/v1" as const;

export const AssistantControlScopeV1Schema = z.enum([
  "org",
  "capability",
  "provider",
  "model",
  "protocol_version",
  "router_version",
  "catalog_version",
  "policy_version",
  "action_executor",
  "workflow_family",
  "client_cohort",
]);

export const AssistantControlModeV1Schema = z.enum(["deny", "quarantine"]);

export const AssistantControlInflightBehaviorV1Schema = z.enum([
  "finish",
  "pause",
  "cancel",
  "compensate",
]);

export const AssistantControlRequestV1Schema = z
  .object({
    version: z.literal(ASSISTANT_OPERATOR_CONTROL_VERSION),
    scope: AssistantControlScopeV1Schema,
    scopeKey: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_.:/@+*-]+$/),
    mode: AssistantControlModeV1Schema,
    inflightBehavior: AssistantControlInflightBehaviorV1Schema,
    reason: z.string().trim().min(10).max(500),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export const AssistantManualRecoveryV1Schema = z
  .object({
    version: z.literal(ASSISTANT_OPERATOR_CONTROL_VERSION),
    checkpointId: z.string().min(1).max(200),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(10).max(500),
    evidence: z.unknown().optional(),
  })
  .strict();

export type AssistantControlScopeV1 = z.infer<
  typeof AssistantControlScopeV1Schema
>;
export type AssistantControlModeV1 = z.infer<
  typeof AssistantControlModeV1Schema
>;
export type AssistantControlInflightBehaviorV1 = z.infer<
  typeof AssistantControlInflightBehaviorV1Schema
>;
export type AssistantControlRequestV1 = z.infer<
  typeof AssistantControlRequestV1Schema
>;