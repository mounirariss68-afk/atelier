import { z } from "zod";

export const RISER_EVAL_VERSION = "riser-eval/v1" as const;

export const RiserEvalMetricV1Schema = z.enum([
  "policy_tenant_isolation",
  "forged_unconfirmed_commits",
  "exactly_once_concurrent_replay",
  "supported_intent_operation_accuracy",
  "capability_top_1",
  "capability_top_3",
  "unsupported_abstention",
  "clarification_precision",
  "card_relevance_precision",
  "unexpected_empty_cards",
  "web_mobile_semantic_parity",
  "provider_unrelated_capability",
]);

export type RiserEvalMetricV1 = z.infer<typeof RiserEvalMetricV1Schema>;

export const RiserEvalSuiteV1Schema = z.enum([
  "pure",
  "security",
]);

export const RiserEvalCorpusV1Schema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/),
    metric: RiserEvalMetricV1Schema,
    source: RiserEvalSuiteV1Schema,
    minimumFixtures: z.number().int().positive(),
    capabilityScoped: z.boolean(),
  })
  .strict();

export const RiserEvalDatasetV1Schema = z
  .object({
    version: z.literal(RISER_EVAL_VERSION),
    datasetVersion: z.string().min(1).max(100),
    protocolVersion: z.number().int().positive(),
    presentationDataVersion: z.number().int().positive(),
    privacyPolicyVersion: z.string().min(1).max(100),
    catalogVersion: z.string().regex(/^[a-f0-9]{64}$/),
    routerVersion: z.string().min(1).max(100),
    modelVersion: z.string().min(1).max(100),
    promptVersion: z.string().min(1).max(100),
    rendererVersion: z.string().min(1).max(100),
    seed: z.number().int().nonnegative(),
    baseline: z.string().min(1).max(200),
    denominator: z.literal("named_fixture"),
    statisticalMethod: z.literal("exact_census"),
    confidence: z.literal(1),
    perCapabilityTop3Minimum: z.number().min(0).max(1),
    minimumCapabilityFixtures: z.number().int().positive(),
    changeClasses: z
      .array(
        z.enum([
          "model",
          "prompt",
          "router",
          "catalog",
          "policy",
          "protocol",
          "renderer",
        ]),
      )
      .length(7),
    corpora: z.array(RiserEvalCorpusV1Schema).min(1),
  })
  .strict()
  .superRefine((dataset, ctx) => {
    const ids = new Set<string>();
    const metrics = new Set<RiserEvalMetricV1>();
    for (const [index, corpus] of dataset.corpora.entries()) {
      if (ids.has(corpus.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["corpora", index, "id"],
          message: "duplicate-corpus-id",
        });
      }
      ids.add(corpus.id);
      metrics.add(corpus.metric);
    }
    for (const metric of RiserEvalMetricV1Schema.options) {
      if (!metrics.has(metric)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["corpora"],
          message: `missing-metric-corpus:${metric}`,
        });
      }
    }
  });

export type RiserEvalDatasetV1 = z.infer<typeof RiserEvalDatasetV1Schema>;
