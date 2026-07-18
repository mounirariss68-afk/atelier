/**
 * Agents lens — management dashboard home.
 *
 * A head-of-agents dashboard built strictly from real records: the
 * agent catalogue (`useAtelierListAgents`), Postgres-backed lens rows
 * (specs, versions, eval suites, deployments, incidents, retirements)
 * and nothing else. Where run telemetry (latency, cost, error rates,
 * success rates) is not collected yet, the page shows explicit
 * "no telemetry" states rather than fabricated numbers — see
 * `agentsMetrics.ts` for the honesty contract.
 *
 * The `AGENTS_LIFECYCLE_STAGES` export is preserved so other modules
 * importing it (e.g. the Atelier Library "fork to Design" CTA) keep
 * working.
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
  Donut,
  Funnel,
  type FunnelStep,
  type DonutSegment,
} from "@/pages/people/dashboard/charts";
import {
  useAgentMetrics,
  useAgentRollup,
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
   Filter bar — portfolio (agent group) and environment only.
   Period / as-of selectors were removed: there is no time-series
   telemetry to scope yet, so offering them would be misleading.
   ============================================================ */

type AgentEnv = "all" | "prod" | "staging" | "dev" | "undeployed";

interface AgentFilters {
  portfolio: string; // "all" | agent group
  environment: AgentEnv;
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
          {["all", ...portfolioOptions].map((p) => (
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
              {p === "all" ? "All groups" : p}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">
            Environment
          </span>
          {(["all", "prod", "staging", "dev", "undeployed"] as const).map((e) => (
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
      </div>
    </div>
  );
}

/* ============================================================
   Formatting helpers.
   ============================================================ */

function formatPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}
function formatCount(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return `${v}`;
}

/* ============================================================
   KPI tile — real value, or an explicit no-data state.
   ============================================================ */

type Tone = "default" | "gold" | "amber" | "red" | "green";

interface KpiTileProps {
  testId: string;
  label: string;
  /** Null renders the explicit no-data state. */
  value: string | null;
  unit?: string;
  noDataText?: string;
  tone?: Tone;
  href?: string;
  legend: { definition: string; freshness: string };
}

function KpiTile({ testId, label, value, unit, noDataText, tone = "default", href, legend }: KpiTileProps) {
  const [open, setOpen] = React.useState(false);
  const inner = (
    <Card hover className="p-3 h-full flex flex-col gap-2 min-h-[112px] cursor-pointer relative" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint truncate">
          {label}
        </div>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((s) => !s); }}
          className="text-text-faint hover:text-text shrink-0"
          aria-label={`About ${label}`}
          title="Definition · freshness"
          data-testid={`${testId}-info`}
        >
          <Info className="w-3 h-3" />
        </button>
      </div>
      {value != null ? (
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <div className={cn(
            "font-light leading-none tracking-tight text-2xl",
            tone === "red" ? "text-danger" : "text-text",
          )}>
            {value}
          </div>
          {unit && <div className="text-xs font-mono text-text-mute">{unit}</div>}
        </div>
      ) : (
        <div className="flex-1 flex items-center" data-testid={`${testId}-no-data`}>
          <div className="text-[11px] text-text-faint">
            {noDataText ?? "No data yet"}
          </div>
        </div>
      )}
      {open && (
        <div className="absolute z-30 left-2 right-2 top-full mt-1 rounded border border-border bg-bg-deep p-3 text-[11px] text-text-mute shadow-xl space-y-1">
          <div className="font-mono uppercase text-[9px] tracking-widest text-text-faint">{label}</div>
          <div className="text-text">{legend.definition}</div>
          <div className="text-text-faint">Freshness: {legend.freshness}</div>
        </div>
      )}
    </Card>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : <div>{inner}</div>;
}

/* ============================================================
   No-telemetry placeholder card.
   ============================================================ */

function NoTelemetryCard({ testId, title, body }: { testId: string; title: string; body: string }) {
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
        {title}
      </div>
      <div className="flex items-start gap-2 text-xs text-text-faint">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>{body}</p>
      </div>
    </Card>
  );
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
    return Array.from(new Set(allMetrics.map((m) => m.group))).sort();
  }, [allMetrics]);

  const [filters, setFiltersState] = React.useState<AgentFilters>({
    portfolio: "all",
    environment: "all",
  });
  const setFilters = React.useCallback(
    (next: Partial<AgentFilters>) => setFiltersState((p) => ({ ...p, ...next })),
    [],
  );

  // Apply filters
  const metrics = React.useMemo(() => {
    return allMetrics.filter((m) => {
      if (filters.portfolio !== "all" && m.group !== filters.portfolio) return false;
      if (filters.environment !== "all") {
        const env = m.environment ?? "undeployed";
        if (env !== filters.environment) return false;
      }
      return true;
    });
  }, [allMetrics, filters.portfolio, filters.environment]);

  const rollup = useAgentRollup(metrics);

  // Per-stage counts (unique agents in stage), filtered by environment when relevant
  const uniq = <T,>(xs: T[], pick: (x: T) => string) => new Set(xs.map(pick)).size;
  const monitorCount = metrics.length || (catalogue?.length ?? 0);
  const stageCounts: Record<string, number> = {
    design: specs.length,
    build: uniq(versions, (v) => v.agentId),
    evaluate: uniq(evals, (e) => e.agentId),
    deploy:
      filters.environment === "undeployed"
        ? 0
        : uniq(
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

  /* ----- KPI tones ----- */
  const passTone: Tone =
    rollup.evalPassRate == null ? "default"
      : rollup.evalPassRate >= 0.95 ? "green"
      : rollup.evalPassRate >= 0.9 ? "gold"
      : "amber";
  const incidentTone: Tone = rollup.openIncidents === 0 ? "green" : rollup.openIncidents > 3 ? "red" : "amber";

  /* ----- Lifecycle funnel ----- */
  const funnelSteps: FunnelStep[] = AGENTS_LIFECYCLE_STAGES.map((s) => ({
    id: s.id,
    label: s.label,
    value: stageCounts[s.id] ?? 0,
    caption: s.blurb,
    href: s.href,
    icon: s.icon,
  }));

  /* ----- Eval scorecard — only agents with real eval runs ----- */
  const evaluated = metrics.filter((m) => m.evalPassRate != null);
  const weakestEvals = evaluated
    .slice()
    .sort((a, b) => (a.evalPassRate as number) - (b.evalPassRate as number))
    .slice(0, 5);

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
      title: `Below eval target — ${m.agentName}`,
      detail: `${formatPct(m.evalPassRate as number)} pass · target ${formatPct(m.evalPassRateTarget)}`,
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
  const groupSegments = paint(composition.byGroup);
  const envSegments = paint(composition.byEnvironment);
  const stageTotal = stageSegments.reduce((s, x) => s + x.value, 0);
  const groupTotal = groupSegments.reduce((s, x) => s + x.value, 0);
  const envTotal = envSegments.reduce((s, x) => s + x.value, 0);

  /* ----- Render ----- */
  return (
    <div className="animate-in fade-in" data-testid="agents-dashboard">
      <LensPageHeader
        headline="Agent management — portfolio, evals, incidents, lifecycle"
        lede="The head-of-agents morning briefing, built only from recorded data: portfolio composition, eval results, deployments, incidents and the open action queue. Run telemetry (latency, cost, success rates) isn't collected yet — those panels say so instead of guessing."
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
              recorded data only · no run telemetry yet
            </span>
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6" data-testid="agents-kpi-strip">
            <KpiTile
              testId="kpi-agents-prod"
              label="Agents in production"
              value={String(rollup.agentsInProd)}
              unit={`/ ${metrics.length} total`}
              tone="gold"
              href="/agents/deploy"
              legend={{
                definition: "Unique agents with at least one prod deployment record.",
                freshness: "live · deployments registry",
              }}
            />
            <KpiTile
              testId="kpi-active-versions"
              label="Active versions"
              value={String(rollup.activeVersions)}
              unit={`of ${versions.length}`}
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
              value={rollup.evalPassRate != null ? formatPct(rollup.evalPassRate) : null}
              unit={rollup.evalPassRate != null ? `${rollup.evalCoverage}/${metrics.length} agents` : undefined}
              noDataText="No eval runs recorded yet"
              tone={passTone}
              href="/agents/evaluate"
              legend={{
                definition: "Average pass-rate of the latest recorded eval-suite run per agent. Only agents with at least one recorded run count.",
                freshness: "live · eval registry",
              }}
            />
            <KpiTile
              testId="kpi-runs-30d"
              label="Runs (30d)"
              value={rollup.runs30d != null ? formatCount(rollup.runs30d) : null}
              noDataText="No run counts recorded yet"
              href="/agents/monitor"
              legend={{
                definition: "Sum of recorded 30-day run counts from the agent catalogue.",
                freshness: "catalogue-reported",
              }}
            />
            <KpiTile
              testId="kpi-open-incidents"
              label="Open incidents"
              value={String(rollup.openIncidents)}
              tone={incidentTone}
              href="/agents/improve"
              legend={{
                definition: "Incidents not yet marked resolved across the estate.",
                freshness: "live",
              }}
            />
            <KpiTile
              testId="kpi-run-telemetry"
              label="Latency · cost · SLO"
              value={null}
              noDataText="No run telemetry yet — instrument agent runs to unlock these"
              href="/agents/monitor"
              legend={{
                definition: "p95 latency, error rate, cost per run and SLO burn will appear here once run telemetry is collected. Nothing is estimated in the meantime.",
                freshness: "not collected yet",
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
              agents per stage · live
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
              {weakestEvals.length === 0 ? (
                <div className="text-xs text-text-faint" data-testid="agents-perf-eval-empty">
                  No eval runs recorded yet. Run an eval suite from the Evaluate stage to populate this scorecard.
                </div>
              ) : (
                <ul className="divide-y divide-border-soft">
                  {weakestEvals.map((m) => {
                    const pass = m.evalPassRate as number;
                    const tone: Tone = pass >= m.evalPassRateTarget ? "green" : "amber";
                    return (
                      <li key={m.agentId} className="flex items-center gap-3 py-2">
                        <MonoChip tone={tone}>{formatPct(pass)}</MonoChip>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-text truncate">{m.agentName}</div>
                          <div className="text-[11px] text-text-mute truncate">
                            target {formatPct(m.evalPassRateTarget)} · {m.environment ?? "undeployed"}
                            {m.evalRegression && <span className="text-danger"> · below target</span>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <NoTelemetryCard
              testId="agents-perf-reliability"
              title="Reliability · latency & errors"
              body="Run-level latency, error-rate and guardrail telemetry isn't collected yet, so there are no reliability numbers to show. Once agent runs are instrumented, p95 latency and error rates will appear here."
            />
          </div>
        </section>

        {/* ====== Cost & value ====== */}
        <section className="space-y-3" data-testid="agents-cost">
          <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
            Cost &amp; value
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            <NoTelemetryCard
              testId="agents-cost-no-telemetry"
              title="Spend & cost per run"
              body="Inference and tool spend isn't metered yet, so there are no cost figures to report. When run telemetry lands, spend by environment, cost per successful run and top cost drivers will appear here — until then this panel stays honest and empty."
            />
            <Card className="p-4" data-testid="agents-cost-runs">
              <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
                Recorded run volume · 30d
              </div>
              {rollup.runs30d == null ? (
                <div className="text-xs text-text-faint" data-testid="agents-cost-runs-empty">
                  No run counts recorded in the catalogue yet.
                </div>
              ) : (
                <>
                  <div className="text-3xl font-light text-gold leading-none">
                    {formatCount(rollup.runs30d)}
                  </div>
                  <div className="text-[11px] text-text-mute mt-1">
                    total recorded runs across {metrics.filter((m) => m.runs30d != null).length} agents
                  </div>
                </>
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
                By agent group
              </div>
              {groupTotal === 0 ? (
                <div className="text-xs text-text-faint">No agents in scope.</div>
              ) : (
                <Donut segments={groupSegments} centerLabel={groupTotal} centerCaption="agents" />
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
