/**
 * Agents lens — management dashboard home (Task #463).
 *
 * Replaces the old "lifecycle ribbon" landing page with a CFO/CHRO-style
 * executive dashboard for the head-of-agents persona. The seven-stage
 * lifecycle is preserved as a horizontal funnel (still linking to the
 * existing /agents/<stage> pages) but the page is reframed around
 * portfolio health, performance, reliability, cost/value, lifecycle
 * flow and active risks at a glance.
 *
 * The `AGENTS_LIFECYCLE_STAGES` export is preserved so other modules
 * importing it (e.g. the Atelier Library "fork to Design" CTA) keep
 * working.
 *
 * All numbers come from the existing Agents-lens hooks
 * (`useAgentSpecs`, `useAgentVersions`, `useEvalSuites`, `useDeployments`,
 * `useAgentIncidents`, `useRetirements`) and `useAtelierListAgents`,
 * augmented with the deterministic management metrics defined in
 * `agentsMetrics.ts`.
 */
import * as React from "react";
import { Link } from "wouter";
import {
  Pencil,
  Wrench,
  ClipboardCheck,
  Rocket,
  Activity,
  RefreshCw,
  Archive,
  Info,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ArchiveRestore,
} from "lucide-react";
import { useAtelierListAgents } from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { cn } from "@/lib/utils";
import {
  useAgentSpecs,
  useAgentVersions,
  useEvalSuites,
  useDeployments,
  useAgentIncidents,
  useRetirements,
} from "@/lib/agents-lens-seed";
import {
  Sparkline,
  BarRows,
  Donut,
  Funnel,
  type FunnelStep,
  type BarRowDatum,
  type DonutSegment,
} from "@/pages/people/dashboard/charts";
import {
  useAgentMetrics,
  useAgentRollup,
  useStageThroughput,
  useComposition,
} from "./agentsMetrics";

export const AGENTS_LIFECYCLE_STAGES = [
  {
    id: "design",
    label: "Design",
    href: "/agents/design",
    icon: Pencil,
    blurb: "Specs, intents, prompts, tools, guardrails — and the fork-from-library entry into Atelier.",
  },
  {
    id: "build",
    label: "Build",
    href: "/agents/build",
    icon: Wrench,
    blurb: "Versioning, change logs, prompt and policy edits, tool wiring.",
  },
  {
    id: "evaluate",
    label: "Evaluate",
    href: "/agents/evaluate",
    icon: ClipboardCheck,
    blurb: "Eval suites — regression, red-team, A/B — and golden-dataset scorecards.",
  },
  {
    id: "deploy",
    label: "Deploy",
    href: "/agents/deploy",
    icon: Rocket,
    blurb: "Environments (dev → staging → prod), rollout strategy, persona binding.",
  },
  {
    id: "monitor",
    label: "Monitor",
    href: "/agents/monitor",
    icon: Activity,
    blurb: "Catalogue, run telemetry, cost / latency / success dashboards.",
  },
  {
    id: "improve",
    label: "Improve",
    href: "/agents/improve",
    icon: RefreshCw,
    blurb: "Incidents, post-mortems, failure clusters → eval expansion loop.",
  },
  {
    id: "retire",
    label: "Retire",
    href: "/agents/retire",
    icon: Archive,
    blurb: "Deprecation schedule, replacement mapping, archive.",
  },
] as const;

/* ============================================================
   Filter bar — mirrors CfoFilterBar but scoped to agent ops.
   ============================================================ */

type AgentEnv = "all" | "prod" | "staging" | "dev";
type AgentPeriod = "7d" | "30d" | "qtd" | "ytd";
const PERIOD_DAYS: Record<AgentPeriod, number> = { "7d": 7, "30d": 30, qtd: 90, ytd: 365 };
const PERIOD_LABEL: Record<AgentPeriod, string> = { "7d": "7d", "30d": "30d", qtd: "QTD", ytd: "YTD" };

interface AgentFilters {
  portfolio: string;        // "all" | function name | lens id
  environment: AgentEnv;
  period: AgentPeriod;
  asOf: string;
}

function FilterBar({
  filters,
  setFilters,
  portfolioOptions,
}: {
  filters: AgentFilters;
  setFilters: (next: Partial<AgentFilters>) => void;
  portfolioOptions: string[];
}) {
  return (
    <div
      className="container-atelier py-3 border-y border-border-soft bg-bg-deep/60 backdrop-blur-sm sticky top-0 z-30"
      data-testid="agents-filter-bar"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">
            Portfolio
          </span>
          {(["all", ...portfolioOptions] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setFilters({ portfolio: p })}
              data-testid={`agents-filter-portfolio-${p}`}
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors border",
                filters.portfolio === p
                  ? "bg-gold text-bg border-gold"
                  : "bg-bg-elevate text-text-mute border-border hover:text-text",
              )}
            >
              {p === "all" ? "All lenses" : p}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">
            Environment
          </span>
          {(["all", "prod", "staging", "dev"] as const).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setFilters({ environment: e })}
              data-testid={`agents-filter-env-${e}`}
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors border capitalize",
                filters.environment === e
                  ? "bg-gold text-bg border-gold"
                  : "bg-bg-elevate text-text-mute border-border hover:text-text",
              )}
            >
              {e}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">
            Period
          </span>
          {(Object.keys(PERIOD_LABEL) as AgentPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setFilters({ period: p })}
              data-testid={`agents-filter-period-${p}`}
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors border",
                filters.period === p
                  ? "bg-gold text-bg border-gold"
                  : "bg-bg-elevate text-text-mute border-border hover:text-text",
              )}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            As of
          </span>
          <input
            type="date"
            value={filters.asOf}
            onChange={(e) => setFilters({ asOf: e.target.value })}
            className="bg-bg-elevate border border-border rounded px-2 py-0.5 text-[11px] font-mono text-text"
            data-testid="agents-filter-asof"
          />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Formatting helpers — match CFO/CHRO conventions.
   ============================================================ */

function formatPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}
function formatMs(v: number): string {
  return `${Math.round(v)}ms`;
}
function formatUsd(v: number, digits = 2): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}m`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(digits)}`;
}
function formatCount(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return `${v}`;
}
function signed(v: number, fmt: (n: number) => string): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${fmt(v)}`;
}

/* ============================================================
   KPI tile — mirrors CFO MetricTile but with a built-in legend
   popover so an exec audience reads "as-of / vs plan / coverage"
   alongside agent-ops vocabulary.
   ============================================================ */

type Tone = "default" | "gold" | "amber" | "red" | "green";

interface KpiTileProps {
  testId: string;
  label: string;
  value: string;
  unit?: string;
  delta?: { text: string; tone?: Tone };
  spark?: number[];
  tone?: Tone;
  href?: string;
  legend: { definition: string; vsPlan?: string; freshness: string };
}

function KpiTile({ testId, label, value, unit, delta, spark, tone = "default", href, legend }: KpiTileProps) {
  const [open, setOpen] = React.useState(false);
  const inner = (
    <Card hover className="p-3 h-full flex flex-col gap-2 min-h-[148px] cursor-pointer relative" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint truncate">
          {label}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {delta && <MonoChip tone={delta.tone}>{delta.text}</MonoChip>}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((s) => !s); }}
            className="text-text-faint hover:text-text"
            aria-label={`About ${label}`}
            title="Definition · vs plan · freshness"
            data-testid={`${testId}-info`}
          >
            <Info className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <div className={cn(
          "font-light leading-none tracking-tight text-2xl",
          tone === "red" ? "text-danger" : "text-text",
        )}>
          {value}
        </div>
        {unit && <div className="text-xs font-mono text-text-mute">{unit}</div>}
      </div>
      {spark && spark.length > 1 ? (
        <Sparkline values={spark} width={120} height={22} className="w-full" />
      ) : (
        <div className="h-6 w-full bg-bg-elevate/30 rounded" />
      )}
      {open && (
        <div className="absolute z-30 left-2 right-2 top-full mt-1 rounded border border-border bg-bg-deep p-3 text-[11px] text-text-mute shadow-xl space-y-1">
          <div className="font-mono uppercase text-[9px] tracking-widest text-text-faint">{label}</div>
          <div className="text-text">{legend.definition}</div>
          {legend.vsPlan && <div className="text-text-faint">vs plan: {legend.vsPlan}</div>}
          <div className="text-text-faint">Freshness: {legend.freshness}</div>
        </div>
      )}
    </Card>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : <div>{inner}</div>;
}

/* ============================================================
   Page
   ============================================================ */

export default function AgentsLensHome() {
  const specs = useAgentSpecs();
  const versions = useAgentVersions();
  const evals = useEvalSuites();
  const deployments = useDeployments();
  const incidents = useAgentIncidents();
  const retirements = useRetirements();
  const { data: catalogue } = useAtelierListAgents();
  const allMetrics = useAgentMetrics();

  const portfolioOptions = React.useMemo(() => {
    return Array.from(new Set(allMetrics.map((m) => m.ownerFunction))).sort();
  }, [allMetrics]);

  const [filters, setFiltersState] = React.useState<AgentFilters>({
    portfolio: "all",
    environment: "all",
    period: "30d",
    asOf: new Date().toISOString().slice(0, 10),
  });
  const setFilters = React.useCallback(
    (next: Partial<AgentFilters>) => setFiltersState((p) => ({ ...p, ...next })),
    [],
  );

  // Apply filters
  const metrics = React.useMemo(() => {
    return allMetrics.filter((m) => {
      if (filters.portfolio !== "all" && m.ownerFunction !== filters.portfolio) return false;
      if (filters.environment !== "all" && m.environment !== filters.environment) return false;
      return true;
    });
  }, [allMetrics, filters.portfolio, filters.environment]);

  const rollup = useAgentRollup(metrics);
  const throughput = useStageThroughput(PERIOD_DAYS[filters.period]);

  // Per-stage counts (unique agents in stage), filtered by environment when relevant
  const uniq = <T,>(xs: T[], pick: (x: T) => string) => new Set(xs.map(pick)).size;
  const monitorCount = metrics.length || (catalogue?.length ?? 0);
  const stageCounts: Record<string, number> = {
    design: specs.length,
    build: uniq(versions, (v) => v.agentId),
    evaluate: uniq(evals, (e) => e.agentId),
    deploy: uniq(
      filters.environment === "all"
        ? deployments
        : deployments.filter((d) => d.environment === filters.environment),
      (d) => d.agentId,
    ),
    monitor: monitorCount,
    improve: uniq(incidents.filter((i) => i.status !== "resolved"), (i) => i.agentId),
    retire: uniq(retirements.filter((r) => r.status !== "archived"), (r) => r.agentId),
  };

  const composition = useComposition(metrics, stageCounts);

  /* ----- KPI strip ----- */
  const passDelta = rollup.evalPassRate - rollup.evalPassRatePrior;
  const passTone: Tone = rollup.evalPassRate >= 0.95 ? "green" : rollup.evalPassRate >= 0.9 ? "gold" : "amber";
  const p95Delta = rollup.p95LatencyMs - rollup.p95LatencyPrior;
  const p95Tone: Tone = rollup.p95LatencyMs <= 500 ? "green" : rollup.p95LatencyMs <= 1200 ? "gold" : "amber";
  const costDelta = rollup.costPerSuccessUsd - rollup.costPerSuccessPrior;
  const costTone: Tone = costDelta <= 0 ? "green" : "amber";
  const successDelta = rollup.successRate - rollup.successRatePrior;
  const successTone: Tone = rollup.successRate >= 0.9 ? "green" : rollup.successRate >= 0.8 ? "gold" : "amber";
  const incidentDelta = rollup.openIncidents - rollup.openIncidentsPrior;
  const incidentTone: Tone = rollup.openIncidents === 0 ? "green" : rollup.openIncidents > 3 ? "red" : "amber";
  const sloTone: Tone = rollup.sloBurn30d <= 0.5 ? "green" : rollup.sloBurn30d <= 0.9 ? "amber" : "red";

  /* ----- Lifecycle funnel ----- */
  const funnelSteps: FunnelStep[] = AGENTS_LIFECYCLE_STAGES.map((s) => {
    const t = throughput[s.id];
    const next = t ? `+${t.entered} entered · -${t.exited} exited (${PERIOD_LABEL[filters.period]})` : undefined;
    return {
      id: s.id,
      label: s.label,
      value: stageCounts[s.id] ?? 0,
      caption: s.blurb,
      next,
      href: s.href,
      icon: s.icon,
    };
  });

  /* ----- Performance & reliability ----- */
  const topByPass = metrics
    .slice()
    .sort((a, b) => a.evalPassRate - b.evalPassRate) // worst-first to highlight regressions
    .slice(0, 5);
  const topByLatency = metrics
    .slice()
    .sort((a, b) => b.p95LatencyMs - a.p95LatencyMs)
    .slice(0, 5);

  /* ----- Cost & value ----- */
  const totalSpend = rollup.totalSpendMonthlyUsd;
  const totalPlan = rollup.totalPlanMonthlyUsd;
  const spendVsPlanPct = totalPlan > 0 ? (totalSpend - totalPlan) / totalPlan : 0;

  /* ----- Action queue ----- */
  interface Action {
    id: string;
    category: string;
    title: string;
    detail: string;
    href: string;
    priority: "high" | "medium" | "low";
  }
  const PRIORITY_TONE: Record<Action["priority"], Tone> = { high: "red", medium: "amber", low: "default" };
  const PRIORITY_RANK: Record<Action["priority"], number> = { high: 0, medium: 1, low: 2 };

  const actions: Action[] = [];
  incidents
    .filter((i) => i.status !== "resolved")
    .forEach((i) => actions.push({
      id: `inc-${i.id}`,
      category: "Improve",
      title: `Resolve ${i.severity.toUpperCase()} · ${i.title}`,
      detail: `${i.agentName} · ${i.cluster}`,
      href: "/agents/improve",
      priority: i.severity === "sev1" ? "high" : i.severity === "sev2" ? "medium" : "low",
    }));
  metrics
    .filter((m) => m.evalRegression)
    .forEach((m) => actions.push({
      id: `reg-${m.agentId}`,
      category: "Evaluate",
      title: `Eval regression — ${m.agentName}`,
      detail: `${formatPct(m.evalPassRate)} pass · target ${formatPct(m.evalPassRateTarget)}`,
      href: "/agents/evaluate",
      priority: "high",
    }));
  versions
    .filter((v) => v.status === "candidate")
    .forEach((v) => actions.push({
      id: `pp-${v.id}`,
      category: "Deploy",
      title: `Promote candidate · ${v.agentName} ${v.version}`,
      detail: v.changeSummary,
      href: "/agents/deploy",
      priority: "medium",
    }));
  retirements
    .filter((r) => r.status === "scheduled")
    .forEach((r) => actions.push({
      id: `rt-${r.id}`,
      category: "Retire",
      title: `Scheduled retirement · ${r.agentName}`,
      detail: `Deprecate ${r.deprecateAt} · ${r.callersToMigrate} callers to migrate`,
      href: "/agents/retire",
      priority: "low",
    }));
  const sortedActions = actions
    .slice()
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 12);

  /* ----- Composition palettes ----- */
  const PALETTE = [
    "var(--gold)",
    "var(--gold-deep)",
    "var(--gold-soft)",
    "var(--success)",
    "var(--warn)",
    "var(--text-mute)",
  ];
  function paint(segs: { label: string; value: number }[]): DonutSegment[] {
    return segs.map((s, i) => ({ label: s.label, value: s.value, color: PALETTE[i % PALETTE.length] }));
  }
  const stageSegments = paint(composition.byStage);
  const fnSegments = paint(composition.byFunction);
  const envSegments = paint(composition.byEnvironment);
  const stageTotal = stageSegments.reduce((s, x) => s + x.value, 0);
  const fnTotal = fnSegments.reduce((s, x) => s + x.value, 0);
  const envTotal = envSegments.reduce((s, x) => s + x.value, 0);

  /* ----- Render ----- */
  return (
    <div className="animate-in fade-in" data-testid="agents-dashboard">
      <LensPageHeader
        headline="Agent management — portfolio, performance, reliability, cost"
        lede="The head-of-agents morning briefing. Portfolio composition, eval health, reliability, cost-per-run, lifecycle flow and the open action queue — every signal that tells you how the agent estate is running today, in one screen."
      />

      <FilterBar
        filters={filters}
        setFilters={setFilters}
        portfolioOptions={portfolioOptions}
      />

      <div className="container-atelier py-8 space-y-10">
        {/* ====== KPI hero strip ====== */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
              Agent ops pulse
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
              as-of {filters.asOf} · period {PERIOD_LABEL[filters.period]}
            </span>
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 2xl:grid-cols-8" data-testid="agents-kpi-strip">
            <KpiTile
              testId="kpi-agents-prod"
              label="Agents in production"
              value={String(rollup.agentsInProd)}
              unit={`/ ${metrics.length} total`}
              tone="gold"
              spark={[]}
              href="/agents/deploy"
              legend={{
                definition: "Unique agents with at least one prod deployment.",
                freshness: "live · derived from deployments",
              }}
            />
            <KpiTile
              testId="kpi-active-versions"
              label="Active versions"
              value={String(rollup.activeVersions)}
              unit={`of ${versions.length}`}
              spark={[]}
              tone="gold"
              href="/agents/build"
              legend={{
                definition: "Versions in candidate or shipped state across the catalogue.",
                freshness: "live · build registry",
              }}
            />
            <KpiTile
              testId="kpi-eval-pass"
              label="Eval pass-rate (golden)"
              value={formatPct(rollup.evalPassRate)}
              delta={{
                text: signed(passDelta * 100, (n) => `${n.toFixed(1)}pp`),
                tone: passDelta >= 0 ? "green" : "amber",
              }}
              spark={rollup.evalPassRateTrend.map((v) => Math.round(v * 1000))}
              tone={passTone}
              href="/agents/evaluate"
              legend={{
                definition: "Weighted average pass-rate of the latest golden-set run per agent.",
                vsPlan: "target ≥ 95% prod · ≥ 90% staging",
                freshness: `period ${PERIOD_LABEL[filters.period]}`,
              }}
            />
            <KpiTile
              testId="kpi-p95-latency"
              label="p95 latency"
              value={formatMs(rollup.p95LatencyMs)}
              delta={{
                text: signed(p95Delta, (n) => `${Math.round(n)}ms`),
                tone: p95Delta <= 0 ? "green" : "amber",
              }}
              spark={rollup.p95LatencyTrend}
              tone={p95Tone}
              href="/agents/monitor"
              legend={{
                definition: "Firm-wide p95 of agent run latency, weighted across agents.",
                vsPlan: "target ≤ 1.2s for prod agents",
                freshness: "rolling 30d",
              }}
            />
            <KpiTile
              testId="kpi-cost-per-run"
              label="Cost / successful run"
              value={formatUsd(rollup.costPerSuccessUsd, 3)}
              delta={{
                text: signed(costDelta, (n) => formatUsd(n, 3)),
                tone: costTone,
              }}
              spark={rollup.costTrend.map((v) => Math.round(v * 1000))}
              tone={costTone}
              href="/agents/monitor"
              legend={{
                definition: "Total inference + tool spend ÷ successful runs.",
                vsPlan: `monthly spend ${formatUsd(totalSpend)} vs plan ${formatUsd(totalPlan)} (${signed(spendVsPlanPct * 100, (n) => `${n.toFixed(1)}%`)})`,
                freshness: "rolling 30d",
              }}
            />
            <KpiTile
              testId="kpi-success-rate"
              label="Success / deflection"
              value={formatPct(rollup.successRate)}
              delta={{
                text: signed(successDelta * 100, (n) => `${n.toFixed(1)}pp`),
                tone: successDelta >= 0 ? "green" : "amber",
              }}
              spark={[]}
              tone={successTone}
              href="/agents/monitor"
              legend={{
                definition: "Runs that hit a successful terminal state without escalation.",
                vsPlan: "coverage target ≥ 90% in prod",
                freshness: "rolling 30d",
              }}
            />
            <KpiTile
              testId="kpi-open-incidents"
              label="Open incidents"
              value={String(rollup.openIncidents)}
              delta={{
                text: signed(incidentDelta, (n) => `${n}`),
                tone: incidentDelta <= 0 ? "green" : "red",
              }}
              spark={[]}
              tone={incidentTone}
              href="/agents/improve"
              legend={{
                definition: "Incidents not yet marked resolved across the estate.",
                freshness: "live",
              }}
            />
            <KpiTile
              testId="kpi-slo-burn"
              label="SLO burn (30d)"
              value={formatPct(Math.min(1, rollup.sloBurn30d))}
              delta={{
                text: signed((rollup.sloBurn30d - rollup.sloBurnPrior) * 100, (n) => `${n.toFixed(1)}pp`),
                tone: rollup.sloBurn30d <= rollup.sloBurnPrior ? "green" : "amber",
              }}
              spark={[]}
              tone={sloTone}
              href="/agents/monitor"
              legend={{
                definition: "Fraction of the 30-day error budget consumed across prod agents.",
                vsPlan: "regrettable above 90%",
                freshness: "rolling 30d",
              }}
            />
          </div>
        </section>

        {/* ====== Lifecycle flow funnel ====== */}
        <section className="space-y-3" data-testid="agents-lifecycle-funnel">
          <div className="flex items-baseline justify-between">
            <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
              Lifecycle flow · Design → Retire
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
              throughput vs prior · {PERIOD_LABEL[filters.period]}
            </span>
          </div>
          <Funnel steps={funnelSteps} />
        </section>

        {/* ====== Performance & reliability ====== */}
        <section className="space-y-3" data-testid="agents-perf">
          <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
            Performance &amp; reliability
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4" data-testid="agents-perf-eval">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                  Eval scorecard · weakest 5
                </div>
                <Link href="/agents/evaluate" className="font-mono text-[10px] uppercase tracking-widest text-text-mute hover:text-gold inline-flex items-center gap-1">
                  Drill in <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              {topByPass.length === 0 ? (
                <div className="text-xs text-text-faint">No agents in scope.</div>
              ) : (
                <ul className="divide-y divide-border-soft">
                  {topByPass.map((m) => {
                    const tone: Tone = m.evalPassRate >= m.evalPassRateTarget ? "green" : m.evalRegression ? "red" : "amber";
                    return (
                      <li key={m.agentId} className="flex items-center gap-3 py-2">
                        <MonoChip tone={tone}>{formatPct(m.evalPassRate)}</MonoChip>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text truncate">{m.agentName}</div>
                          <div className="text-[11px] text-text-mute truncate">
                            target {formatPct(m.evalPassRateTarget)} · {m.environment}
                            {m.evalRegression && <span className="text-danger"> · regression</span>}
                          </div>
                        </div>
                        <div className="w-20 shrink-0">
                          <Sparkline values={m.evalPassRateTrend.map((v) => Math.round(v * 1000))} width={80} height={20} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card className="p-4" data-testid="agents-perf-reliability">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                  Reliability · slowest 5 (p95)
                </div>
                <Link href="/agents/monitor" className="font-mono text-[10px] uppercase tracking-widest text-text-mute hover:text-gold inline-flex items-center gap-1">
                  Drill in <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              {topByLatency.length === 0 ? (
                <div className="text-xs text-text-faint">No agents in scope.</div>
              ) : (
                <ul className="divide-y divide-border-soft">
                  {topByLatency.map((m) => {
                    const tone: Tone = m.p95LatencyMs <= 800 ? "green" : m.p95LatencyMs <= 1500 ? "amber" : "red";
                    return (
                      <li key={m.agentId} className="flex items-center gap-3 py-2">
                        <MonoChip tone={tone}>{formatMs(m.p95LatencyMs)}</MonoChip>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text truncate">{m.agentName}</div>
                          <div className="text-[11px] text-text-mute truncate">
                            err {m.errorRatePct.toFixed(1)}% · guardrail {m.guardrailViolationsPerKRuns.toFixed(1)}/k · {m.environment}
                          </div>
                        </div>
                        <div className="w-20 shrink-0">
                          <Sparkline values={m.p95LatencyTrend} width={80} height={20} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </section>

        {/* ====== Cost & value ====== */}
        <section className="space-y-3" data-testid="agents-cost">
          <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
            Cost &amp; value
          </h3>
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-1" data-testid="agents-cost-spend-vs-plan">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
                Spend vs plan · by environment
              </div>
              <div className="space-y-3">
                {rollup.spendByEnv.map((row) => {
                  const delta = row.plan > 0 ? (row.spend - row.plan) / row.plan : 0;
                  const tone: "green" | "amber" | "red" = delta <= 0 ? "green" : delta <= 0.1 ? "amber" : "red";
                  const pct = row.plan > 0 ? Math.min(150, (row.spend / row.plan) * 100) : 0;
                  return (
                    <div key={row.env} data-testid={`spend-${row.env}`}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-text-mute capitalize">{row.env}</span>
                        <span className="font-mono text-text-faint">
                          {formatUsd(row.spend)} <span className="text-text-faint/70">/ plan {formatUsd(row.plan)}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-sm bg-bg-deep overflow-hidden relative">
                        <div
                          className={cn(
                            "h-full transition-all",
                            tone === "green" && "bg-success",
                            tone === "amber" && "bg-warn",
                            tone === "red" && "bg-danger",
                          )}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-px bg-text-faint"
                          style={{ left: `${Math.min(100, (row.plan / Math.max(row.spend, row.plan)) * 100)}%` }}
                        />
                      </div>
                      <div className="text-[10px] font-mono text-text-faint mt-0.5">
                        {signed(delta * 100, (n) => `${n.toFixed(1)}%`)} vs plan
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-4 lg:col-span-1" data-testid="agents-cost-trend">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
                Cost / successful run · trend
              </div>
              <div className="text-3xl font-light text-gold leading-none">
                {formatUsd(rollup.costPerSuccessUsd, 3)}
              </div>
              <div className="text-[11px] text-text-mute mt-1">
                {signed(costDelta, (n) => formatUsd(n, 3))} vs prior · {PERIOD_LABEL[filters.period]}
              </div>
              <div className="mt-3">
                <Sparkline
                  values={rollup.costTrend.map((v) => Math.round(v * 1000))}
                  width={240}
                  height={48}
                  className="w-full"
                />
              </div>
              <div className="mt-3 text-[10px] font-mono text-text-faint">
                Total monthly spend {formatUsd(totalSpend)} · plan {formatUsd(totalPlan)}
              </div>
            </Card>

            <Card className="p-4 lg:col-span-1" data-testid="agents-cost-top">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
                Top 5 cost drivers
              </div>
              {rollup.topCostAgents.length === 0 ? (
                <div className="text-xs text-text-faint">No agents in scope.</div>
              ) : (
                <BarRows
                  rows={rollup.topCostAgents.map<BarRowDatum>((m) => ({
                    label: m.agentName,
                    value: m.spendMonthlyUsd,
                    caption: `· ${formatUsd(m.costPerSuccessfulRunUsd, 3)}/run`,
                    tone: m.spendMonthlyUsd > rollup.totalSpendMonthlyUsd / metrics.length * 2 ? "amber" : "default",
                  }))}
                />
              )}
            </Card>
          </div>
        </section>

        {/* ====== Portfolio composition ====== */}
        <section className="space-y-3" data-testid="agents-composition">
          <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
            Portfolio composition
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="p-4" data-testid="composition-by-stage">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
                By lifecycle stage
              </div>
              {stageTotal === 0 ? (
                <div className="text-xs text-text-faint">No agents in scope.</div>
              ) : (
                <Donut segments={stageSegments} centerLabel={stageTotal} centerCaption="agents" />
              )}
            </Card>
            <Card className="p-4" data-testid="composition-by-function">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
                By owning lens
              </div>
              {fnTotal === 0 ? (
                <div className="text-xs text-text-faint">No agents in scope.</div>
              ) : (
                <Donut segments={fnSegments} centerLabel={fnTotal} centerCaption="agents" />
              )}
            </Card>
            <Card className="p-4" data-testid="composition-by-env">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
                By environment
              </div>
              {envTotal === 0 ? (
                <div className="text-xs text-text-faint">No agents in scope.</div>
              ) : (
                <Donut segments={envSegments} centerLabel={envTotal} centerCaption="agents" />
              )}
            </Card>
          </div>
        </section>

        {/* ====== Action queue ====== */}
        <section className="space-y-3" data-testid="agents-action-queue">
          <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
            Head-of-agents action queue
          </h3>
          <Card className="p-2">
            {sortedActions.length === 0 ? (
              <div className="p-6 text-center text-xs text-text-faint inline-flex items-center justify-center gap-2 w-full">
                <CheckCircle2 className="w-4 h-4 text-success" />
                No actions in the queue. The agent estate is on cruise control.
              </div>
            ) : (
              <ul className="divide-y divide-border-soft">
                {sortedActions.map((it) => {
                  const Icon =
                    it.category === "Improve" ? AlertTriangle :
                    it.category === "Evaluate" ? ClipboardCheck :
                    it.category === "Deploy" ? Rocket :
                    it.category === "Retire" ? ArchiveRestore :
                    Activity;
                  return (
                    <li key={it.id}>
                      <Link
                        href={it.href}
                        data-testid={`action-${it.id}`}
                        className="flex items-center gap-3 p-3 hover:bg-bg-elevate-2 transition-colors rounded"
                      >
                        <MonoChip tone={PRIORITY_TONE[it.priority]}>{it.priority}</MonoChip>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint w-24 shrink-0 hidden sm:flex items-center gap-1.5">
                          <Icon className="w-3 h-3" /> {it.category}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text truncate">{it.title}</div>
                          <div className="text-[11px] text-text-mute truncate">{it.detail}</div>
                        </div>
                        <span className="font-mono text-[10px] text-text-faint shrink-0">→</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
