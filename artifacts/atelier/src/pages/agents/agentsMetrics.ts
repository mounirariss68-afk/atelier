/**
 * Agent management metrics — honest, data-backed rollups for the
 * Agents Lens home dashboard.
 *
 * Every number surfaced here is derived from real records:
 *   - the agent catalogue (`useAtelierListAgents`, incl. `runsLast30d`)
 *   - Postgres-backed Agents-lens rows (eval suites, deployments,
 *     versions, incidents, retirements — `agents-lens-seed.ts` hooks)
 *
 * Metrics with no backing telemetry (latency, error rate, cost, spend,
 * SLO burn, success rate, trends) are intentionally NOT fabricated:
 * fields are `null` when no data exists and the dashboard renders
 * explicit "no telemetry yet" states instead. Do not reintroduce
 * seed-driven / hash-jittered numbers here.
 */
import * as React from "react";
import {
  useAgentSpecs,
  useAgentVersions,
  useEvalSuites,
  useDeployments,
  useAgentIncidents,
  useRetirements,
  type AgentSpec,
  type AgentVersion,
  type EvalSuite,
  type DeploymentRow,
  type IncidentRow,
  type RetirementRow,
} from "@/lib/agents-lens-seed";
import { useAtelierListAgents } from "@workspace/api-client-react";
import type { AgentCatalogEntry } from "@workspace/api-client-react";

/* ---------------- environments ---------------- */

export type AgentEnvironment = "dev" | "staging" | "prod" | "all";

/* ---------------- per-agent rollup ---------------- */

export interface AgentMetrics {
  agentId: string;
  agentName: string;
  group: string;
  /** From a real deployment record; null when the agent has none. */
  environment: "dev" | "staging" | "prod" | null;
  /** Latest golden-set pass-rate (0..1) from real eval-suite runs; null when never evaluated. */
  evalPassRate: number | null;
  /** Stated policy target (0..1) by catalogue status — a target, not a measurement. */
  evalPassRateTarget: number;
  /** True only when a real eval run exists and is below target. */
  evalRegression: boolean;
  /** Real run count from the catalogue; null when not recorded. */
  runs30d: number | null;
}

function passRateTargetFor(agent: AgentCatalogEntry): number {
  // Policy targets by maturity — these are goals, not measurements.
  if (agent.status === "registered") return 0.95;
  if (agent.status === "mvp") return 0.9;
  return 0.85;
}

function latestSuiteFor(agentId: string, evals: EvalSuite[]): EvalSuite | undefined {
  const mine = evals.filter((e) => e.agentId === agentId);
  if (mine.length === 0) return undefined;
  return mine
    .slice()
    .sort((a, b) => (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""))[0];
}

export function useAgentMetrics(): AgentMetrics[] {
  const { data: catalogue } = useAtelierListAgents();
  const deployments = useDeployments();
  const evals = useEvalSuites();

  return React.useMemo(() => {
    if (!catalogue) return [];
    return catalogue.map((a) => {
      const dep = deployments.find((d) => d.agentId === a.id);
      const target = passRateTargetFor(a);
      const suite = latestSuiteFor(a.id, evals);
      const evalPassRate =
        suite != null ? Math.round(suite.passRate * 1000) / 1000 : null;

      return {
        agentId: a.id,
        agentName: a.name,
        group: a.group,
        environment: dep?.environment ?? null,
        evalPassRate,
        evalPassRateTarget: target,
        evalRegression: evalPassRate != null && evalPassRate < target,
        runs30d: a.runsLast30d ?? null,
      };
    });
  }, [catalogue, deployments, evals]);
}

/* ---------------- firm-wide rollup ---------------- */

export interface AgentRollup {
  agentsInProd: number;
  activeVersions: number;
  /** Average of real eval pass-rates; null when no agent has eval runs. */
  evalPassRate: number | null;
  /** Number of agents contributing to `evalPassRate`. */
  evalCoverage: number;
  openIncidents: number;
  /** Sum of catalogue runsLast30d; null when no agent records runs. */
  runs30d: number | null;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function useAgentRollup(metrics: AgentMetrics[]): AgentRollup {
  const versions = useAgentVersions();
  const incidents = useAgentIncidents();

  return React.useMemo(() => {
    const agentsInProd = metrics.filter((m) => m.environment === "prod").length;
    const activeVersions = versions.filter((v) => v.status !== "draft").length;

    const evaluated = metrics.filter((m) => m.evalPassRate != null);
    const evalPassRate = evaluated.length
      ? avg(evaluated.map((m) => m.evalPassRate as number))
      : null;

    const openIncidents = incidents.filter((i) => i.status !== "resolved").length;

    const withRuns = metrics.filter((m) => m.runs30d != null);
    const runs30d = withRuns.length
      ? withRuns.reduce((s, m) => s + (m.runs30d as number), 0)
      : null;

    return {
      agentsInProd,
      activeVersions,
      evalPassRate,
      evalCoverage: evaluated.length,
      openIncidents,
      runs30d,
    };
  }, [metrics, versions, incidents]);
}

/* ---------------- portfolio composition ---------------- */

export interface CompositionBuckets {
  byStage: { label: string; value: number }[];
  byGroup: { label: string; value: number }[];
  byEnvironment: { label: string; value: number }[];
}

export function useComposition(
  metrics: AgentMetrics[],
  stageCounts: Record<string, number>,
): CompositionBuckets {
  return React.useMemo(() => {
    const groupCounts = new Map<string, number>();
    metrics.forEach((m) =>
      groupCounts.set(m.group, (groupCounts.get(m.group) ?? 0) + 1),
    );
    const envCounts = new Map<string, number>();
    metrics.forEach((m) => {
      const key = m.environment ?? "undeployed";
      envCounts.set(key, (envCounts.get(key) ?? 0) + 1);
    });
    return {
      byStage: Object.entries(stageCounts).map(([label, value]) => ({ label, value })),
      byGroup: Array.from(groupCounts.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
      byEnvironment: ["prod", "staging", "dev", "undeployed"].map((env) => ({
        label: env,
        value: envCounts.get(env) ?? 0,
      })),
    };
  }, [metrics, stageCounts]);
}

/* ---------------- cross-helpers re-exports for the home page ---------------- */

export type {
  AgentSpec,
  AgentVersion,
  EvalSuite,
  DeploymentRow,
  IncidentRow,
  RetirementRow,
};
