/**
 * Agents lens — listHook-shaped React Query hooks (Task #373) plus
 * client-side mutations for the actionable lens controls (Task #374).
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
 * returning an `items[]` array. Mutations from the lens action buttons
 * (approve / promote / run-suite / file-incident) are applied as
 * optimistic patches via `queryClient.setQueryData`, layered on top of
 * the API-backed reads. They survive within a session but reset on hard
 * refresh — see follow-up task #385 for server-side persistence.
 */
import * as React from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;
const LENS_KEY = "atelier-agents-lens";

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

function stageKey(key: string) {
  return [LENS_KEY, key] as const;
}

function listHook<T>(key: string, path: string) {
  return function useList(): T[] {
    const q = useQuery<{ items: T[] }>({
      queryKey: stageKey(key),
      queryFn: () => get<{ items: T[] }>(path),
      staleTime: 30_000,
    });
    return q.data?.items ?? [];
  };
}

/**
 * Patch the cached items array for a stage in-place. Returns a no-op if
 * the cache hasn't been hydrated yet (the next refetch will produce
 * fresh data and the user can re-issue the action).
 */
function patchStage<T>(
  client: QueryClient,
  key: string,
  patch: (items: T[]) => T[],
) {
  const qk = stageKey(key);
  const current = client.getQueryData<{ items: T[] }>(qk);
  if (!current) return;
  client.setQueryData<{ items: T[] }>(qk, { items: patch(current.items) });
}

function todayISO(): string {
  return new Date().toISOString();
}
function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
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
  /** Optional back-link to the Monitor run that surfaced the incident. */
  runId?: string;
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

// ============================================================
// Mutations — wired to the lens action buttons (Task #374)
//
// Mutations are applied as optimistic patches on the React Query cache
// for the matching stage so every consumer re-renders. They do not yet
// hit the server — see follow-up #385 for persistence.
// ============================================================

/** Append a review-log entry on a Design spec and update its status. */
export function useDesignSpecActions() {
  const client = useQueryClient();
  return React.useMemo(
    () => ({
      approve(specId: string, actor: string, note: string) {
        patchStage<AgentSpec>(client, "design-specs", (items) =>
          items.map((s) =>
            s.id === specId
              ? {
                  ...s,
                  status: "approved",
                  updatedAt: todayISO(),
                  reviewLog: [
                    ...s.reviewLog,
                    {
                      actor,
                      decision: "approve",
                      at: todayDate(),
                      note: note || "Approved.",
                    },
                  ],
                }
              : s,
          ),
        );
      },
      requestChanges(specId: string, actor: string, note: string) {
        patchStage<AgentSpec>(client, "design-specs", (items) =>
          items.map((s) =>
            s.id === specId
              ? {
                  ...s,
                  status: "in_review",
                  updatedAt: todayISO(),
                  reviewLog: [
                    ...s.reviewLog,
                    {
                      actor,
                      decision: "request_changes",
                      at: todayDate(),
                      note: note || "Changes requested.",
                    },
                  ],
                }
              : s,
          ),
        );
      },
    }),
    [client],
  );
}

/**
 * Promote a Build version to staging or prod. Creates a new Deploy row
 * and flips the version's status to `shipped` when promoted to prod.
 */
export function usePromoteVersion() {
  const client = useQueryClient();
  return React.useCallback(
    (
      versionId: string,
      environment: "staging" | "prod",
      actor: string,
    ): DeploymentRow | null => {
      const versions = client.getQueryData<{ items: AgentVersion[] }>(
        stageKey("build-versions"),
      );
      const v = versions?.items.find((x) => x.id === versionId);
      if (!v) return null;
      const row: DeploymentRow = {
        id: `dep_${v.agentId}_${environment}_${Date.now()}`,
        agentId: v.agentId,
        agentName: v.agentName,
        version: v.version,
        environment,
        rolloutStrategy: environment === "prod" ? "full" : "canary",
        trafficPct: environment === "prod" ? 100 : 25,
        personaBinding: "partner | senior_manager",
        promotedBy: actor,
        promotedAt: todayISO(),
      };
      patchStage<DeploymentRow>(client, "deploy-environments", (items) => [
        row,
        ...items,
      ]);
      patchStage<AgentVersion>(client, "build-versions", (items) =>
        items.map((x) => {
          if (x.id !== versionId) return x;
          if (environment === "prod") return { ...x, status: "shipped" };
          if (x.status === "draft") return { ...x, status: "candidate" };
          return x;
        }),
      );
      return row;
    },
    [client],
  );
}

/**
 * Run an eval suite. Simulates a scorecard run by jittering the suite's
 * pass-rate and stamping `lastRunAt`; returns the pass / fail counts so
 * the caller can surface a toast.
 */
export interface EvalRunResult {
  suiteId: string;
  passed: number;
  failed: number;
  passRate: number;
  ranAt: string;
}

export function useRunEvalSuite() {
  const client = useQueryClient();
  return React.useCallback(
    (suiteId: string): EvalRunResult | null => {
      const suites = client.getQueryData<{ items: EvalSuite[] }>(
        stageKey("evaluate-suites"),
      );
      const s = suites?.items.find((x) => x.id === suiteId);
      if (!s) return null;
      const drift = (Math.random() - 0.45) * 0.08;
      const nextRate =
        Math.round(Math.max(0, Math.min(1, s.passRate + drift)) * 100) / 100;
      const ranAt = todayISO();
      patchStage<EvalSuite>(client, "evaluate-suites", (items) =>
        items.map((x) =>
          x.id === suiteId ? { ...x, passRate: nextRate, lastRunAt: ranAt } : x,
        ),
      );
      const passed = Math.round(s.caseCount * nextRate);
      const failed = s.caseCount - passed;
      return { suiteId, passed, failed, passRate: nextRate, ranAt };
    },
    [client],
  );
}

/**
 * File an incident on Improve, optionally linked back to the Monitor
 * run that surfaced it. The new row lands at the top of the list.
 */
export interface FileIncidentInput {
  agentId: string;
  agentName: string;
  title: string;
  severity: IncidentRow["severity"];
  cluster: string;
  rootCause?: string;
  proposedChange: string;
  runId?: string;
}

export function useFileIncident() {
  const client = useQueryClient();
  return React.useCallback(
    (input: FileIncidentInput): IncidentRow => {
      const row: IncidentRow = {
        id: `inc_${input.agentId}_${Date.now()}`,
        agentId: input.agentId,
        agentName: input.agentName,
        title: input.title,
        severity: input.severity,
        detectedAt: todayISO(),
        status: "open",
        cluster: input.cluster,
        rootCause: input.rootCause ?? null,
        proposedChange: input.proposedChange,
        runId: input.runId,
      };
      patchStage<IncidentRow>(client, "improve-incidents", (items) => [
        row,
        ...items,
      ]);
      return row;
    },
    [client],
  );
}
