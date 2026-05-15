/**
 * Agents lens — listHook-shaped React Query hooks (Task #373).
 *
 * The Agents lens organises agent operations around the
 * Design → Build → Evaluate → Deploy → Monitor → Improve → Retire
 * lifecycle. The Monitor stage re-mounts the existing agent catalogue
 * (sourced from `useAtelierListAgents`) and run-detail view; the other
 * six stages are now backed by Postgres-backed API routes registered
 * under /api/atelier/agents-lens/* (see
 * `artifacts/api-server/src/routes/atelier/agentsLensRoutes.ts`).
 *
 * Hooks here mirror the `v5-hooks.ts` `listHook` shape — `useQuery`
 * returning an `items[]` array — so callers keep the same surface as
 * before. The previous inline seed now lives in
 * `artifacts/api-server/src/lib/atelier-seed-agents-lens.ts` and is
 * loaded idempotently on cold start.
 */
import { useQuery } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api/atelier`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Atelier API ${path} failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

function listHook<T>(key: string, path: string) {
  return function useList(): T[] {
    const q = useQuery<{ items: T[] }>({
      queryKey: ["atelier-agents-lens", key],
      queryFn: () => get<{ items: T[] }>(path),
      staleTime: 30_000,
    });
    return q.data?.items ?? [];
  };
}

// ============================================================
// Design — agent specs awaiting Build
// ============================================================
export interface AgentSpec {
  id: string;
  name: string;
  intent: string;
  group: string;
  status: "drafting" | "in_review" | "approved";
  owner: string;
  forkedFrom: string | null;
  tools: string[];
  guardrails: string[];
  personaBinding: string;
  reviewLog: { actor: string; decision: string; at: string; note: string }[];
  updatedAt: string;
}
export const useAgentSpecs = listHook<AgentSpec>(
  "design-specs",
  "/agents-lens/specs",
);

// ============================================================
// Build — versions, change-log, tool wiring
// ============================================================
export interface AgentVersion {
  id: string;
  agentId: string;
  agentName: string;
  version: string;
  status: "draft" | "candidate" | "shipped";
  changeSummary: string;
  promptDelta: string;
  toolsAdded: string[];
  toolsRemoved: string[];
  author: string;
  committedAt: string;
}
export const useAgentVersions = listHook<AgentVersion>(
  "build-versions",
  "/agents-lens/versions",
);

// ============================================================
// Evaluate — eval suites, golden datasets, scorecards
// ============================================================
export interface EvalSuite {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  kind: "regression" | "red_team" | "ab";
  caseCount: number;
  passRate: number;
  lastRunAt: string;
  ownedBy: string;
  rubric: string;
}
export const useEvalSuites = listHook<EvalSuite>(
  "evaluate-suites",
  "/agents-lens/eval-suites",
);

// ============================================================
// Deploy — environments, rollout strategy, persona binding
// ============================================================
export interface DeploymentRow {
  id: string;
  agentId: string;
  agentName: string;
  version: string;
  environment: "dev" | "staging" | "prod";
  rolloutStrategy: string;
  trafficPct: number;
  personaBinding: string;
  promotedBy: string;
  promotedAt: string;
}
export const useDeployments = listHook<DeploymentRow>(
  "deploy-environments",
  "/agents-lens/deployments",
);

// ============================================================
// Improve — incidents and post-mortems
// ============================================================
export interface IncidentRow {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  severity: "sev1" | "sev2" | "sev3";
  detectedAt: string;
  status: "open" | "investigating" | "resolved";
  cluster: string;
  rootCause: string | null;
  proposedChange: string;
}
export const useAgentIncidents = listHook<IncidentRow>(
  "improve-incidents",
  "/agents-lens/incidents",
);

// ============================================================
// Retire — deprecation schedule, replacement mapping
// ============================================================
export interface RetirementRow {
  id: string;
  agentId: string;
  agentName: string;
  reason: string;
  replacementAgentId: string | null;
  replacementName: string | null;
  deprecateAt: string;
  archiveAt: string;
  status: "scheduled" | "deprecated" | "archived";
  callersToMigrate: number;
}
export const useRetirements = listHook<RetirementRow>(
  "retire-schedule",
  "/agents-lens/retirements",
);
