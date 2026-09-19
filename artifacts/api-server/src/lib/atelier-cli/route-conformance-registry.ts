export const ROUTE_CONFORMANCE_REGISTRY = {
  "artifacts/api-server/src/routes/atelier/accountRoutes.ts|get /accounts/:accountId": {
    capabilityId: "account.dossier",
    executorContract: "account-dossier-read-v1",
    evidence: "tests/riser-foundation/account-dossier-conformance.ts",
    conformance: {
      auth: "proven:persona-bound-adapters",
      validation: "proven:shared-contract",
      recordScope: "proven:shared-contract",
      sideEffects: "not_applicable:read_only",
      confirmation: "not_applicable:read_only",
      idempotency: "not_applicable:read_only",
      audit: "not_applicable:read_only",
      navigation: "intentional_divergence:assistant-card-only",
      publicErrors: "intentional_divergence:http-403-assistant-not-found",
    },
    divergence: {
      status: "approved",
      owner: "Agent Platform",
      reason:
        "HTTP preserves explicit forbidden/not-found responses while the assistant collapses inaccessible accounts to not-found and adds card navigation metadata.",
      reviewBy: "2027-03-31",
      rollback:
        "disable account.dossier and keep GET /accounts/:accountId authoritative",
    },
  },
} as const;

const externalBoundary = (
  owner: string,
  reason: string,
  rollback: string,
) => ({
  status: "approved" as const,
  owner,
  reason,
  reviewBy: "2027-03-31",
  rollback,
});

export const ROUTE_FILE_DIVERGENCES = {
  "artifacts/api-server/src/routes/arcelik.ts": externalBoundary(
    "Arcelik Product Owners",
    "Separate Arcelik product API; it is outside the Atelier assistant capability realm.",
    "Disable Arcelik routes without changing the Atelier catalog.",
  ),
  "artifacts/api-server/src/routes/tasama.ts": externalBoundary(
    "Tasama Product Owners",
    "Separate Tasama product API; it is outside the Atelier assistant capability realm.",
    "Disable Tasama routes without changing the Atelier catalog.",
  ),
  "artifacts/api-server/src/routes/assessments.ts": externalBoundary(
    "Assessment Product Owners",
    "Public assessment and submission surface; no authenticated Atelier assistant authority is intended.",
    "Disable assessment routes while preserving Atelier.",
  ),
  "artifacts/api-server/src/routes/auth/index.ts": externalBoundary(
    "Identity Platform",
    "Authentication, activation and credential-recovery control plane; assistant execution is prohibited.",
    "Disable the affected identity route and preserve existing authenticated sessions where safe.",
  ),
  "artifacts/api-server/src/routes/chat.ts": externalBoundary(
    "Legacy Chat Owners",
    "Legacy chat transport is not an Atelier capability executor and remains isolated during Riser cutover.",
    "Disable legacy chat routes and retain the versioned assistant transport.",
  ),
  "artifacts/api-server/src/routes/assistantRoutes.ts": externalBoundary(
    "Agent Platform",
    "Versioned assistant transport and durable-action control plane; it orchestrates capabilities rather than representing one.",
    "Disable the assistant transport without changing route-authoritative business APIs.",
  ),
  "artifacts/api-server/src/routes/workflowRoutes.ts": externalBoundary(
    "Agent Platform",
    "Durable workflow control plane; it schedules reviewed capabilities and is not itself a catalog business capability.",
    "Disable workflow admission and preserve persisted work for recovery.",
  ),
  "artifacts/api-server/src/routes/salon/index.ts": externalBoundary(
    "Salon Product Owners",
    "External client-portal surface with token/persona authority distinct from the internal Atelier assistant.",
    "Disable Salon routes without widening internal assistant authority.",
  ),
  "artifacts/api-server/src/routes/esignWebhook.ts": externalBoundary(
    "Document Platform",
    "Inbound DocuSeal webhook; external event ingestion must never be assistant-invokable.",
    "Disable webhook ingestion and reconcile from the authoritative provider.",
  ),
  "artifacts/api-server/src/routes/msCalendarWebhook.ts": externalBoundary(
    "Calendar Platform",
    "Inbound Microsoft calendar webhook; external event ingestion must never be assistant-invokable.",
    "Disable webhook ingestion and fall back to live calendar refresh.",
  ),
  "artifacts/api-server/src/routes/health.ts": externalBoundary(
    "SRE",
    "Operational health probe with no user business authority or assistant surface.",
    "Remove the probe from traffic only through deployment health configuration.",
  ),
} as const;