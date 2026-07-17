/**
 * Agent management metrics — additive to `agents-lens-seed.ts` (Task #463).
 *
 * The Postgres-backed Agents-lens seed (`agents-lens-seed.ts`) keeps its
 * existing per-stage hook signatures intact. This file layers
 * deterministic management metrics on top of the agent catalogue and
 * lifecycle data so the new CFO/CHRO-style Agents Lens home dashboard
 * can render real numbers without empty states.
 *
 * All values are derived from a stable hash of the agent id, so a given
 * agent's pass-rate / latency / cost / etc. is the same across reloads
 * and across components — mirroring the deterministic seed approach
 * used in the People dashboard.
 *
 * NOTE: numbers here are seed-driven, not telemetry (see `cfoData.ts`).
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

/* ---------------- deterministic helpers ---------------- */

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function rand(seed: string, idx: number): number {
  // 0..1 deterministic per (seed, idx)
  return (hash(`${seed}#${idx}`) % 100_000) / 100_000;
}
function randIn(seed: string, idx: number, min: number, max: number): number {
  return min + rand(seed, idx) * (max - min);
}
function trend(seed: string, points: number, base: number, range: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const drift = (rand(seed, i) - 0.5) * range;
    out.push(Math.max(0, base + drift));
  }
  return out;
}

/* ---------------- environments ---------------- */

export type AgentEnvironment = "dev" | "staging" | "prod" | "all";

/* ---------------- per-agent rollup ---------------- */

export interface AgentMetrics {
  agentId: string;
  agentName: string;
  group: string;
  environment: "dev" | "staging" | "prod";
  ownerFunction: string;
  evalPassRate: number;        // 0..1, latest
  evalPassRateTrend: number[]; // last 30d, 30 points
  evalPassRateTarget: number;  // 0..1
  evalRegression: boolean;
  p95LatencyMs: number;
  p95LatencyTrend: number[];
  errorRatePct: number;        // 0..100
  guardrailViolationsPerKRuns: number;
  successRate: number;         // 0..1 (success / deflection)
  costPerSuccessfulRunUsd: number;
  costTrend: number[];
  spendMonthlyUsd: number;
  spendPlanMonthlyUsd: number;
  runs7d: number;
  runs30d: number;
  sloBurn30d: number;          // 0..1, fraction of error budget consumed
}

/**
 * Owning lens for each agent — mirrors the five Manage-shell lenses
 * (`src/lib/lens.ts`) so the Agents Lens dashboard's Portfolio filter
 * reads as "by lens" (Clients · People · Agents · Partners · Finance)
 * rather than as ad-hoc owner functions.
 */
const FUNCTIONS = [
  "Clients",
  "People",
  "Agents",
  "Partners",
  "Finance",
];

function envForAgent(agent: AgentCatalogEntry, deployments: DeploymentRow[]): "dev" | "staging" | "prod" {
  const dep = deployments.find((d) => d.agentId === agent.id);
  if (dep) return dep.environment;
  // Fall back deterministically based on stage / status.
  const r = rand(agent.id, 99);
  if (agent.status === "registered") return r < 0.7 ? "prod" : "staging";
  if (agent.status === "mvp") return r < 0.5 ? "staging" : "dev";
  return "dev";
}

function passRateTargetFor(agent: AgentCatalogEntry): number {
  // Higher targets for production-grade, lower for stubs.
  if (agent.status === "registered") return 0.95;
  if (agent.status === "mvp") return 0.9;
  return 0.85;
}

export function useAgentMetrics(): AgentMetrics[] {
  const { data: catalogue } = useAtelierListAgents();
  const deployments = useDeployments();
  const evals = useEvalSuites();

  return React.useMemo(() => {
    if (!catalogue) return [];
    return catalogue.map((a) => {
      const env = envForAgent(a, deployments);
      const target = passRateTargetFor(a);
      // Use the latest eval suite pass-rate when present, otherwise jitter.
      const suite = evals.find((e) => e.agentId === a.id);
      const passBase = suite?.passRate ?? randIn(a.id, 1, 0.78, 0.99);
      const passRate = Math.round(passBase * 1000) / 1000;
      const passTrend = trend(`${a.id}:pass`, 30, passRate, 0.05).map(
        (v) => Math.round(Math.min(1, v) * 1000) / 1000,
      );
      // Regression: any 3-day window in the trend dropped > 4pts vs the start.
      const tStart = passTrend[0] ?? passRate;
      const tEnd = passTrend[passTrend.length - 1] ?? passRate;
      const evalRegression = tEnd < tStart - 0.04 || passRate < target - 0.05;

      const p95Base = randIn(a.id, 2, 240, 2400);
      const p95LatencyMs = Math.round(p95Base);
      const p95LatencyTrend = trend(`${a.id}:p95`, 30, p95Base, p95Base * 0.2).map(
        (v) => Math.round(v),
      );
      const errorRatePct = Math.round(randIn(a.id, 3, 0.1, 3.5) * 10) / 10;
      const guardrailViolationsPerKRuns = Math.round(randIn(a.id, 4, 0, 7) * 10) / 10;
      const successRate = Math.round(randIn(a.id, 5, 0.62, 0.97) * 1000) / 1000;
      const costPerSuccessfulRunUsd = Math.round(randIn(a.id, 6, 0.02, 0.45) * 1000) / 1000;
      const costTrend = trend(`${a.id}:cost`, 30, costPerSuccessfulRunUsd, 0.04).map(
        (v) => Math.round(v * 1000) / 1000,
      );

      const runs30d = a.runsLast30d ?? Math.round(randIn(a.id, 7, 30, 4000));
      const runs7d = Math.round(runs30d / 4);
      const successfulRuns = Math.round(runs30d * successRate);
      const spendMonthlyUsd = Math.round(successfulRuns * costPerSuccessfulRunUsd);
      const spendPlanMonthlyUsd = Math.round(spendMonthlyUsd * randIn(a.id, 8, 0.85, 1.15));

      // SLO burn = (errorRate / errorBudget). Budget tightens for prod.
      const errorBudget = env === "prod" ? 1.0 : env === "staging" ? 2.5 : 5.0;
      const sloBurn30d = Math.min(1.5, errorRatePct / errorBudget);

      const ownerFunction =
        FUNCTIONS[hash(a.group ?? a.id) % FUNCTIONS.length] ?? "Engagement";

      return {
        agentId: a.id,
        agentName: a.name,
        group: a.group,
        environment: env,
        ownerFunction,
        evalPassRate: passRate,
        evalPassRateTrend: passTrend,
        evalPassRateTarget: target,
        evalRegression,
        p95LatencyMs,
        p95LatencyTrend,
        errorRatePct,
        guardrailViolationsPerKRuns,
        successRate,
        costPerSuccessfulRunUsd,
        costTrend,
        spendMonthlyUsd,
        spendPlanMonthlyUsd,
        runs7d,
        runs30d,
        sloBurn30d,
      };
    });
  }, [catalogue, deployments, evals]);
}

/* ---------------- firm-wide rollup ---------------- */

export interface AgentRollup {
  agentsInProd: number;
  activeVersions: number;
  evalPassRate: number;
  evalPassRatePrior: number;
  evalPassRateTrend: number[];
  p95LatencyMs: number;
  p95LatencyPrior: number;
  p95LatencyTrend: number[];
  costPerSuccessUsd: number;
  costPerSuccessPrior: number;
  costTrend: number[];
  successRate: number;
  successRatePrior: number;
  openIncidents: number;
  openIncidentsPrior: number;
  sloBurn30d: number;
  sloBurnPrior: number;
  totalSpendMonthlyUsd: number;
  totalPlanMonthlyUsd: number;
  spendByEnv: { env: "dev" | "staging" | "prod"; spend: number; plan: number }[];
  topCostAgents: AgentMetrics[];
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

    const evalPassRate = avg(metrics.map((m) => m.evalPassRate));
    const evalPassRateTrend: number[] = [];
    const points = metrics[0]?.evalPassRateTrend.length ?? 0;
    for (let i = 0; i < points; i++) {
      evalPassRateTrend.push(avg(metrics.map((m) => m.evalPassRateTrend[i] ?? 0)));
    }
    const evalPassRatePrior = evalPassRateTrend[0] ?? evalPassRate;

    const p95LatencyMs = avg(metrics.map((m) => m.p95LatencyMs));
    const p95LatencyTrend: number[] = [];
    for (let i = 0; i < points; i++) {
      p95LatencyTrend.push(avg(metrics.map((m) => m.p95LatencyTrend[i] ?? 0)));
    }
    const p95LatencyPrior = p95LatencyTrend[0] ?? p95LatencyMs;

    const costPerSuccessUsd = avg(metrics.map((m) => m.costPerSuccessfulRunUsd));
    const costTrend: number[] = [];
    for (let i = 0; i < points; i++) {
      costTrend.push(avg(metrics.map((m) => m.costTrend[i] ?? 0)));
    }
    const costPerSuccessPrior = costTrend[0] ?? costPerSuccessUsd;

    const successRate = avg(metrics.map((m) => m.successRate));
    const successRatePrior = successRate * 0.97; // mild prior

    const openIncidents = incidents.filter((i) => i.status !== "resolved").length;
    const openIncidentsPrior = Math.max(0, openIncidents - 1);

    const sloBurn30d = avg(metrics.map((m) => m.sloBurn30d));
    const sloBurnPrior = sloBurn30d * 0.92;

    const totalSpendMonthlyUsd = metrics.reduce((s, m) => s + m.spendMonthlyUsd, 0);
    const totalPlanMonthlyUsd = metrics.reduce((s, m) => s + m.spendPlanMonthlyUsd, 0);

    const envs: ("dev" | "staging" | "prod")[] = ["prod", "staging", "dev"];
    const spendByEnv = envs.map((env) => {
      const ms = metrics.filter((m) => m.environment === env);
      return {
        env,
        spend: ms.reduce((s, m) => s + m.spendMonthlyUsd, 0),
        plan: ms.reduce((s, m) => s + m.spendPlanMonthlyUsd, 0),
      };
    });

    const topCostAgents = metrics
      .slice()
      .sort((a, b) => b.spendMonthlyUsd - a.spendMonthlyUsd)
      .slice(0, 5);

    return {
      agentsInProd,
      activeVersions,
      evalPassRate,
      evalPassRatePrior,
      evalPassRateTrend,
      p95LatencyMs,
      p95LatencyPrior,
      p95LatencyTrend,
      costPerSuccessUsd,
      costPerSuccessPrior,
      costTrend,
      successRate,
      successRatePrior,
      openIncidents,
      openIncidentsPrior,
      sloBurn30d,
      sloBurnPrior,
      totalSpendMonthlyUsd,
      totalPlanMonthlyUsd,
      spendByEnv,
      topCostAgents,
    };
  }, [metrics, versions, incidents]);
}

/* ---------------- stage throughput ---------------- */

export interface StageThroughput {
  entered: number;
  exited: number;
}

export function useStageThroughput(periodDays: number): Record<string, StageThroughput> {
  const specs = useAgentSpecs();
  const versions = useAgentVersions();
  const evals = useEvalSuites();
  const deployments = useDeployments();
  const incidents = useAgentIncidents();
  const retirements = useRetirements();

  return React.useMemo(() => {
    const seedSize =
      specs.length + versions.length + evals.length + deployments.length +
      incidents.length + retirements.length;
    function pair(seed: string): StageThroughput {
      const e = Math.round(randIn(`${seed}:enter:${periodDays}:${seedSize}`, 1, 0, 6));
      const x = Math.round(randIn(`${seed}:exit:${periodDays}:${seedSize}`, 2, 0, 5));
      return { entered: e, exited: x };
    }
    return {
      design: pair("design"),
      build: pair("build"),
      evaluate: pair("evaluate"),
      deploy: pair("deploy"),
      monitor: pair("monitor"),
      improve: pair("improve"),
      retire: pair("retire"),
    };
  }, [specs.length, versions.length, evals.length, deployments.length, incidents.length, retirements.length, periodDays]);
}

/* ---------------- portfolio composition ---------------- */

export interface CompositionBuckets {
  byStage: { label: string; value: number }[];
  byFunction: { label: string; value: number }[];
  byEnvironment: { label: string; value: number }[];
}

export function useComposition(metrics: AgentMetrics[], stageCounts: Record<string, number>): CompositionBuckets {
  return React.useMemo(() => {
    const fnCounts = new Map<string, number>();
    metrics.forEach((m) => fnCounts.set(m.ownerFunction, (fnCounts.get(m.ownerFunction) ?? 0) + 1));
    const envCounts = new Map<string, number>();
    metrics.forEach((m) => envCounts.set(m.environment, (envCounts.get(m.environment) ?? 0) + 1));
    return {
      byStage: Object.entries(stageCounts).map(([label, value]) => ({ label, value })),
      byFunction: Array.from(fnCounts.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
      byEnvironment: ["prod", "staging", "dev"].map((env) => ({
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
