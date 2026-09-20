/**
 * Agents Lens — CRM Outcome Performance (/agents/outcomes)
 *
 * Aggregate-only view of CRM agent outcome performance, sliceable by time
 * window, agent ID, and workflow entry path. Missing/broken linkage is
 * made visible through the coverage panel. This is the control-room page
 * where Cognirise leaders judge whether CRM agents create measurable business
 * value — evidence quality is made as visible as performance.
 */
import * as React from "react";
import {
  RefreshCw,
  AlertTriangle,
  Info,
  ChevronDown,
  CheckCircle2,
  BarChart3,
  Link2Off,
  Clock,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useAtelierGetAgentOutcomes } from "@workspace/api-client-react";
import type {
  AtelierGetAgentOutcomesParams,
  AtelierAgentOutcomesReport,
  AtelierAgentOutcomesReportCoverage,
  AtelierAgentOutcomesReportTotals,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { cn } from "@/lib/utils";

/* ============================================================
   Types
   ============================================================ */

type WindowPreset = "7d" | "30d" | "90d" | "custom";
type DispositionKey = "accepted" | "rejected" | "edited" | "expired" | "superseded";

const EMPTY_TOTALS: AtelierAgentOutcomesReportTotals = {
  events: 0,
  accepted: 0,
  rejected: 0,
  edited: 0,
  expired: 0,
  superseded: 0,
};

const EMPTY_COVERAGE: AtelierAgentOutcomesReportCoverage = {
  totalEvents: 0,
  completeEvents: 0,
  missingLinkEvents: 0,
  unlinkedDomainRecords: 0,
  unknownVersionEvents: 0,
  truncated: false,
};

interface Filters {
  preset: WindowPreset;
  from: string;
  to: string;
  agentId: string;
  entryPath: string;
}

/* ============================================================
   Formatting helpers
   ============================================================ */

function fmtPct(v: number | null | undefined, digits = 1): string | null {
  if (v == null) return null;
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtMs(v: number | null | undefined): string | null {
  if (v == null) return null;
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} s`;
}

function fmtNum(v: number | null | undefined, digits = 1): string | null {
  if (v == null) return null;
  if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(digits)}M`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(digits)}k`;
  return `${v}`;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function presetDates(preset: WindowPreset): { from: string; to: string } {
  const to = isoToday();
  if (preset === "7d") return { from: isoOffset(7), to };
  if (preset === "30d") return { from: isoOffset(30), to };
  if (preset === "90d") return { from: isoOffset(90), to };
  return { from: isoOffset(30), to }; // custom default
}

/* ============================================================
   Filter bar
   ============================================================ */

function FilterBar({
  filters,
  setFilters,
}: {
  filters: Filters;
  setFilters: (next: Partial<Filters>) => void;
}) {
  const presets: WindowPreset[] = ["7d", "30d", "90d", "custom"];

  function handlePreset(p: WindowPreset) {
    if (p !== "custom") {
      const dates = presetDates(p);
      setFilters({ preset: p, from: dates.from, to: dates.to });
    } else {
      setFilters({ preset: p });
    }
  }

  return (
    <div className="border-y border-border-soft bg-bg-deep/60 backdrop-blur-sm sticky top-0 z-30">
      <div className="container-atelier py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {/* Window presets */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">
              Window
            </span>
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePreset(p)}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[11px] font-mono transition-colors border",
                  filters.preset === p
                    ? "bg-gold text-bg border-gold"
                    : "bg-bg-elevate text-text-mute border-border hover:text-text",
                )}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Custom date range (visible only in custom mode) */}
          {filters.preset === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters({ from: e.target.value })}
                className="bg-bg-elevate border border-border rounded text-[11px] font-mono text-text-mute px-2 py-0.5 focus:outline-none focus:border-gold"
              />
              <span className="text-text-faint text-[11px] font-mono">to</span>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({ to: e.target.value })}
                className="bg-bg-elevate border border-border rounded text-[11px] font-mono text-text-mute px-2 py-0.5 focus:outline-none focus:border-gold"
              />
            </div>
          )}

          {/* Agent ID filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">
              Agent
            </span>
            <input
              type="text"
              value={filters.agentId}
              onChange={(e) => setFilters({ agentId: e.target.value })}
              placeholder="all"
              className="w-36 bg-bg-elevate border border-border rounded text-[11px] font-mono text-text-mute px-2 py-0.5 placeholder:text-text-faint focus:outline-none focus:border-gold"
            />
          </div>

          {/* Entry path filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint mr-1">
              Entry path
            </span>
            <input
              type="text"
              value={filters.entryPath}
              onChange={(e) => setFilters({ entryPath: e.target.value })}
              placeholder="all"
              className="w-44 bg-bg-elevate border border-border rounded text-[11px] font-mono text-text-mute px-2 py-0.5 placeholder:text-text-faint focus:outline-none focus:border-gold"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   KPI stat tile — metric + definition tooltip
   ============================================================ */

interface StatTileProps {
  label: string;
  value: string | null;
  unit?: string;
  noDataText?: string;
  tone?: "default" | "green" | "amber" | "red" | "gold";
  definition: string;
  direction?: "up-good" | "down-good" | "neutral";
}

function StatTile({
  label,
  value,
  unit,
  noDataText = "No data",
  tone = "default",
  definition,
  direction = "neutral",
}: StatTileProps) {
  const [open, setOpen] = React.useState(false);

  const valueColor =
    tone === "green"
      ? "text-success"
      : tone === "red"
        ? "text-danger"
        : tone === "amber"
          ? "text-warn"
          : tone === "gold"
            ? "text-gold"
            : "text-text";

  return (
    <Card className="p-4 h-full flex flex-col gap-2 min-h-[108px] relative">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint leading-tight flex-1">
          {label}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((s) => !s);
          }}
          className="text-text-faint hover:text-text shrink-0 transition-colors"
          aria-label={`Definition for ${label}`}
        >
          <Info className="w-3 h-3" />
        </button>
      </div>

      {value != null ? (
        <div className="flex items-baseline gap-1.5 flex-wrap mt-auto">
          <span className={cn("font-light leading-none tracking-tight text-2xl", valueColor)}>
            {value}
          </span>
          {unit && (
            <span className="text-xs font-mono text-text-mute">{unit}</span>
          )}
          {direction !== "neutral" && (
            <span className={cn("shrink-0", direction === "up-good" ? "text-success" : "text-danger")}>
              {direction === "up-good" ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
            </span>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-end">
          <span className="text-[11px] text-text-faint">{noDataText}</span>
        </div>
      )}

      {open && (
        <div className="absolute z-40 left-2 right-2 top-full mt-1.5 rounded border border-border bg-bg-deep/95 backdrop-blur-sm p-3 text-[11px] shadow-xl space-y-1">
          <div className="font-mono uppercase text-[9px] tracking-widest text-text-faint">
            {label}
          </div>
          <div className="text-text leading-relaxed">{definition}</div>
        </div>
      )}
    </Card>
  );
}

/* ============================================================
   Decision totals bar — horizontal percentage bars for the 5
   disposition buckets (accepted, rejected, edited, expired, superseded)
   ============================================================ */

const DISPOSITION_META: Record<
  string,
  { label: string; color: string; description: string }
> = {
  accepted: {
    label: "Accepted",
    color: "var(--success)",
    description: "Human accepted the agent suggestion without edit.",
  },
  rejected: {
    label: "Rejected",
    color: "var(--danger)",
    description: "Human explicitly rejected the agent suggestion.",
  },
  edited: {
    label: "Edited",
    color: "var(--warn)",
    description: "Human accepted but edited before applying — rework signal.",
  },
  expired: {
    label: "Expired",
    color: "var(--text-faint)",
    description: "Suggestion expired before human review.",
  },
  superseded: {
    label: "Superseded",
    color: "var(--gold-deep)",
    description: "A newer agent suggestion replaced this one before review.",
  },
};

function DecisionTotals({
  totals,
}: {
  totals: AtelierAgentOutcomesReport["totals"];
}) {
  const keys: DispositionKey[] = ["accepted", "rejected", "edited"];
  const grand = keys.reduce((s, k) => s + (totals[k] ?? 0), 0);

  if (grand === 0) {
    return (
      <Card className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint mb-3">
          Decision dispositions
        </div>
        <div className="text-xs text-text-faint flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 shrink-0" />
          No decision events recorded in this window.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
          Decision dispositions
        </div>
        <div className="font-mono text-[10px] text-text-faint">
          {fmtNum(grand)} total events
        </div>
      </div>

      {/* Segmented bar */}
      <div className="h-3 w-full flex rounded overflow-hidden mb-4" aria-label="Decision disposition bar">
        {keys.map((k) => {
          const v = totals[k] ?? 0;
          const pct = grand > 0 ? (v / grand) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <div
              key={k}
              style={{
                width: `${pct}%`,
                background: DISPOSITION_META[k]?.color ?? "var(--text-faint)",
              }}
              title={`${DISPOSITION_META[k]?.label ?? k}: ${v} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {keys.map((k) => {
          const v = totals[k] ?? 0;
          const pct = grand > 0 ? (v / grand) * 100 : 0;
          const meta = DISPOSITION_META[k];
          return (
            <div key={k} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: meta?.color ?? "var(--text-faint)" }}
                />
                <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
                  {meta?.label ?? k}
                </span>
              </div>
              <div className="text-lg font-light text-text leading-none">
                {v.toLocaleString()}
              </div>
              <div className="text-[10px] font-mono text-text-mute">
                {pct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ============================================================
   Coverage panel — data completeness / linkage health
   ============================================================ */

function CoveragePanel({
  coverage,
  truncated,
}: {
  coverage: AtelierAgentOutcomesReport["coverage"];
  truncated?: boolean;
}) {
  const total = coverage["totalEvents"] ?? 0;
  const complete = coverage["completeEvents"] ?? 0;
  const missingLink = coverage["missingLinkEvents"] ?? 0;
  const unknownVersion = coverage["unknownVersionEvents"] ?? 0;

  const coveragePct = total > 0 ? (complete / total) * 100 : null;
  const missingPct = total > 0 ? (missingLink / total) * 100 : 0;
  const unknownPct = total > 0 ? (unknownVersion / total) * 100 : 0;

  const hasLinkageProblems = missingLink > 0 || unknownVersion > 0;
  const coverageTone =
    coveragePct == null
      ? "default"
      : coveragePct >= 95
        ? "green"
        : coveragePct >= 80
          ? "amber"
          : "red";

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
          Evidence coverage &amp; linkage
        </div>
        {truncated && (
          <MonoChip tone="amber">result truncated</MonoChip>
        )}
      </div>

      {total === 0 ? (
        <div className="text-xs text-text-faint flex items-center gap-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          No events in scope — widen the time window or remove filters.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Coverage completeness bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-mono text-text-faint uppercase tracking-widest">
                Complete events
              </div>
              <div
                className={cn(
                  "text-[11px] font-mono font-medium",
                  coverageTone === "green"
                    ? "text-success"
                    : coverageTone === "amber"
                      ? "text-warn"
                      : coverageTone === "red"
                        ? "text-danger"
                        : "text-text-mute",
                )}
              >
                {coveragePct != null ? `${coveragePct.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className="h-1.5 bg-bg-deep rounded overflow-hidden">
              <div
                className="h-full rounded transition-all duration-500"
                style={{
                  width: coveragePct != null ? `${Math.min(coveragePct, 100)}%` : "0%",
                  background:
                    coverageTone === "green"
                      ? "var(--success)"
                      : coverageTone === "amber"
                        ? "var(--warn)"
                        : "var(--danger)",
                }}
              />
            </div>
            <div className="text-[10px] font-mono text-text-faint">
              {complete.toLocaleString()} of {total.toLocaleString()} events have full linkage
            </div>
          </div>

          {/* Linkage problems */}
          {hasLinkageProblems && (
            <div className="space-y-2 pt-2 border-t border-border-soft">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-warn">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Linkage issues detected
              </div>
              {missingLink > 0 && (
                <div className="flex items-start gap-3">
                  <Link2Off className="w-3.5 h-3.5 mt-0.5 text-danger shrink-0" />
                  <div>
                    <div className="text-xs text-text">
                      {missingLink.toLocaleString()} events ({missingPct.toFixed(1)}%) have missing linkage
                    </div>
                    <div className="text-[11px] text-text-faint mt-0.5">
                      These events cannot be attributed to a specific agent decision. Check agent instrumentation.
                    </div>
                  </div>
                </div>
              )}
              {unknownVersion > 0 && (
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warn shrink-0" />
                  <div>
                    <div className="text-xs text-text">
                      {unknownVersion.toLocaleString()} events ({unknownPct.toFixed(1)}%) have unknown agent version
                    </div>
                    <div className="text-[11px] text-text-faint mt-0.5">
                      Version metadata missing at event time. Ensure agents emit version tags on every decision.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!hasLinkageProblems && coveragePct != null && coveragePct >= 95 && (
            <div className="flex items-center gap-2 text-xs text-success pt-1 border-t border-border-soft">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Full linkage — evidence quality is high.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ============================================================
   Breakdowns table — one per dimension
   ============================================================ */

function BreakdownTable({
  title,
  items,
  total,
}: {
  title: string;
  items: { key: string; count: number }[];
  total: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? items : items.slice(0, 8);

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
          {title}
        </div>
        <div className="text-[11px] text-text-faint">No data in this dimension.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
          {title}
        </div>
        <div className="font-mono text-[10px] text-text-faint">
          {items.length} values
        </div>
      </div>
      <div className="divide-y divide-border-soft">
        {visible.map((item) => {
          const pct = total > 0 ? (item.count / total) * 100 : 0;
          return (
            <div key={item.key} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text truncate font-mono">{item.key}</div>
              </div>
              <div className="w-24 shrink-0">
                <div className="h-1 bg-bg-deep rounded overflow-hidden">
                  <div
                    className="h-full bg-gold/60 rounded"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
              <div className="text-[11px] font-mono text-text-mute w-10 text-right shrink-0">
                {item.count.toLocaleString()}
              </div>
              <div className="text-[10px] font-mono text-text-faint w-10 text-right shrink-0">
                {pct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 8 && (
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="flex items-center gap-1 text-[11px] font-mono text-text-mute hover:text-gold transition-colors"
        >
          <ChevronDown
            className={cn("w-3 h-3 transition-transform", expanded && "rotate-180")}
          />
          {expanded ? "Show fewer" : `Show ${items.length - 8} more`}
        </button>
      )}
    </div>
  );
}

/* ============================================================
   Skeleton loading state
   ============================================================ */

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-bg-elevate-2 animate-pulse rounded",
        className,
      )}
    />
  );
}

function PageSkeleton() {
  return (
    <div className="container-atelier py-8 space-y-10">
      {/* KPI strip */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      {/* Totals */}
      <Skeleton className="h-40" />
      {/* Coverage */}
      <Skeleton className="h-36" />
      {/* Breakdowns */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

/* ============================================================
   Error state
   ============================================================ */

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="container-atelier py-16 flex flex-col items-center gap-4 text-center">
      <AlertTriangle className="w-8 h-8 text-danger" />
      <div className="space-y-1">
        <div className="text-sm text-text font-medium">Unable to load outcome report</div>
        <div className="text-xs text-text-mute">
          The server returned an error. Check network connectivity and try again.
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 bg-gold text-bg-deep px-4 py-2 rounded text-sm font-medium hover:bg-gold/90 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Retry
      </button>
    </div>
  );
}

/* ============================================================
   Empty state
   ============================================================ */

function EmptyState() {
  return (
    <div className="container-atelier py-16 flex flex-col items-center gap-4 text-center">
      <BarChart3 className="w-8 h-8 text-text-faint" />
      <div className="space-y-1">
        <div className="text-sm text-text font-medium">No outcome data in this window</div>
        <div className="text-xs text-text-mute max-w-md">
          No CRM agent outcome events were recorded for the selected filters.
          Widen the time window or remove agent and entry-path constraints.
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Main page
   ============================================================ */

export default function AgentsOutcomes() {
  const defaultDates = presetDates("30d");
  const [filters, setFiltersState] = React.useState<Filters>({
    preset: "30d",
    from: defaultDates.from,
    to: defaultDates.to,
    agentId: "",
    entryPath: "",
  });

  const setFilters = React.useCallback(
    (next: Partial<Filters>) =>
      setFiltersState((p) => ({ ...p, ...next })),
    [],
  );

  const params = React.useMemo<AtelierGetAgentOutcomesParams>(() => {
    const p: AtelierGetAgentOutcomesParams = {};
    if (filters.from) p.from = filters.from;
    if (filters.to) p.to = filters.to;
    if (filters.agentId.trim()) p.agentId = filters.agentId.trim();
    if (filters.entryPath.trim()) p.entryPath = filters.entryPath.trim();
    return p;
  }, [filters.from, filters.to, filters.agentId, filters.entryPath]);

  const { data, isLoading, isError, refetch } = useAtelierGetAgentOutcomes(
    params,
    {
      query: {
        queryKey: [
          "/api/atelier/agents-lens/outcomes",
          params,
        ],
        staleTime: 60_000,
        retry: 1,
      },
    },
  );

  const report = data as AtelierAgentOutcomesReport | undefined;

  /* ----- Derived metrics from the report ----- */
  const totals = report?.totals ?? EMPTY_TOTALS;
  const metrics = report?.metrics;
  const breakdowns = report?.breakdowns ?? {};
  const coverage = report?.coverage ?? EMPTY_COVERAGE;
  const window_ = report?.window;

  const totalDecisions = (["accepted", "rejected", "edited"] as DispositionKey[]).reduce(
    (s, k) => s + (totals[k] ?? 0),
    0,
  );

  const truncated = coverage["truncated"] ? Boolean(coverage["truncated"]) : false;

  /* ----- Coverage-derived KPIs ----- */
  const totalEvents = coverage["totalEvents"] ?? 0;
  const completeEvents = coverage["completeEvents"] ?? 0;
  const missingLinkEvents = coverage["missingLinkEvents"] ?? 0;
  const unlinkedDomainRecords = coverage["unlinkedDomainRecords"] ?? 0;

  const evidenceQuality =
    totalEvents > 0
      ? fmtPct(completeEvents / totalEvents)
      : null;
  const evidenceTone: StatTileProps["tone"] =
    totalEvents === 0
      ? "default"
      : completeEvents / totalEvents >= 0.95
        ? "green"
        : completeEvents / totalEvents >= 0.8
          ? "amber"
          : "red";

  /* ----- Acceptance rate from totals ----- */
  const accepted = totals["accepted"] ?? 0;
  const acceptanceRate =
    totalDecisions > 0 ? fmtPct(accepted / totalDecisions) : null;
  const acceptanceTone: StatTileProps["tone"] =
    totalDecisions === 0
      ? "default"
      : accepted / totalDecisions >= 0.7
        ? "green"
        : accepted / totalDecisions >= 0.5
          ? "amber"
          : "red";

  /* ----- Rework rate from totals ----- */
  const edited = totals["edited"] ?? 0;
  const reworkPopulation = accepted + edited;
  const reworkRate =
    reworkPopulation > 0 ? fmtPct(edited / reworkPopulation) : null;
  const reworkTone: StatTileProps["tone"] =
    totalDecisions === 0
      ? "default"
      : edited / totalDecisions <= 0.1
        ? "green"
        : edited / totalDecisions <= 0.25
          ? "amber"
          : "red";

  /* ----- Breakdowns grand total ----- */
  const breakdownTotal = totalEvents;

  /* ----- Breakdown dimensions to show ----- */
  const BREAKDOWN_DIMS: { key: string; title: string }[] = [
    { key: "agentId", title: "By agent" },
    { key: "agentVersion", title: "By agent version" },
    { key: "model", title: "By model" },
    { key: "promptVersion", title: "By prompt version" },
    { key: "entryPath", title: "By entry path" },
  ];

  return (
    <div className="animate-in fade-in" data-testid="agents-outcomes-page">
      <LensPageHeader
        backHref="/agents"
        backLabel="Agents"
        headline="CRM agent outcome performance"
        lede="Aggregate outcome measurements for CRM agents — decision disposition, quality metrics, and evidence coverage — sliced by window, agent, and workflow entry path. Missing linkage is surfaced directly."
        eyebrow="Agents Lens · Outcomes"
      />

      <FilterBar filters={filters} setFilters={setFilters} />

      {isLoading && <PageSkeleton />}

      {isError && !isLoading && (
        <ErrorState onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && report && totalEvents === 0 && totalDecisions === 0 && (
        <EmptyState />
      )}

      {!isLoading && !isError && report && (
        <div className="container-atelier py-8 space-y-10">
          {/* ====== Window meta ====== */}
          {window_ && (window_.from || window_.to) && (
            <div className="flex items-center gap-2 text-[11px] font-mono text-text-faint">
              <Clock className="w-3 h-3 shrink-0" />
              <span>
                Window:{" "}
                {window_.from ?? "earliest"} — {window_.to ?? "latest"}
              </span>
            </div>
          )}

          {/* ====== Primary KPI strip ====== */}
          <section className="space-y-3" data-testid="outcomes-kpi-strip">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
                Aggregate performance
              </h3>
              <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint">
                {totalDecisions > 0
                  ? `${totalDecisions.toLocaleString()} decision events`
                  : "no decision events"}
              </span>
            </div>

            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {/* Core outcome KPIs from totals */}
              <StatTile
                label="Acceptance rate"
                value={acceptanceRate}
                noDataText="No decision events"
                tone={acceptanceTone}
                direction="up-good"
                definition="Fraction of agent decisions that a human accepted without edit. High acceptance indicates the agent is producing useful, trustworthy suggestions."
              />
              <StatTile
                label="Rework rate"
                value={reworkRate}
                noDataText="No decision events"
                tone={reworkTone}
                direction="down-good"
                definition="Fraction of accepted-or-edited decisions that a human edited before applying. High rework signals the agent's output needs consistent correction — a training opportunity."
              />
              <StatTile
                label="Evidence quality"
                value={evidenceQuality}
                unit="fully linked"
                noDataText="No events"
                tone={evidenceTone}
                direction="up-good"
                definition="Proportion of events that carry complete agent linkage — i.e. can be attributed to a specific agent, version, model, and decision. Low quality means outcomes cannot be traced to their source."
              />
              <StatTile
                label="Missing linkage"
                value={missingLinkEvents > 0 ? fmtNum(missingLinkEvents) : null}
                unit={missingLinkEvents > 0 ? "events" : undefined}
                noDataText="None — full coverage"
                tone={missingLinkEvents > 0 ? "red" : "green"}
                direction="down-good"
                definition="Events that have no agent linkage and cannot be attributed to any agent decision. Instrument your agents to emit decision IDs on every CRM write."
              />
              <StatTile
                label="Unlinked domain records"
                value={unlinkedDomainRecords > 0 ? fmtNum(unlinkedDomainRecords) : null}
                unit={unlinkedDomainRecords > 0 ? "records" : undefined}
                noDataText="None — full coverage"
                tone={unlinkedDomainRecords > 0 ? "red" : "green"}
                direction="down-good"
                definition="Research facts, POVs, and proposals that cannot be attributed to a same-tenant agent run snapshot."
              />

              {/* Metrics from report (nullable) */}
              <StatTile
                label="Approval latency"
                value={fmtMs(metrics?.["approvalLatencyMs"])}
                noDataText="Not measured"
                definition="Average time between an agent generating a suggestion and a human making a disposition decision. Long latency may indicate suggestions are being ignored."
              />
              <StatTile
                label="Edit rework rate"
                value={fmtPct(metrics?.["editReworkRate"])}
                noDataText="Not measured"
                tone={
                  metrics?.["editReworkRate"] == null
                    ? "default"
                    : metrics["editReworkRate"] <= 0.1
                      ? "green"
                      : metrics["editReworkRate"] <= 0.25
                        ? "amber"
                        : "red"
                }
                direction="down-good"
                definition="Rate at which accepted agent outputs are edited before use, as a fraction of all accepted decisions. Complements the totals-derived rework rate with server-computed precision."
              />
              <StatTile
                label="Source acceptance rate"
                value={fmtPct(metrics?.["sourceAcceptanceRate"])}
                noDataText="Not measured"
                tone={
                  metrics?.["sourceAcceptanceRate"] == null
                    ? "default"
                    : metrics["sourceAcceptanceRate"] >= 0.7
                      ? "green"
                      : metrics["sourceAcceptanceRate"] >= 0.5
                        ? "amber"
                        : "red"
                }
                direction="up-good"
                definition="Fraction of source-attributed agent suggestions that a human accepted. Differs from the aggregate acceptance rate when multiple sources (signals, research, external) contribute to decisions."
              />
              <StatTile
                label="Research conversion"
                value={fmtPct(metrics?.["researchConversionRate"])}
                noDataText="Not measured"
                direction="up-good"
                definition="Rate at which CRM opportunities with research-assisted, promoted-fact run linkage reach conversion. This is an association signal, not proof that research caused the conversion."
              />
              <StatTile
                label="PoV send rate"
                value={fmtPct(metrics?.["povSendRate"])}
                noDataText="Not measured"
                direction="up-good"
                definition="Fraction of point-of-value agent outputs that result in a PoV document being sent to the client. A leading indicator of pipeline quality."
              />
              <StatTile
                label="Proposal cycle time"
                value={fmtMs(metrics?.["proposalCycleTimeMs"])}
                noDataText="Not measured"
                direction="down-good"
                definition="Average wall-clock time from proposal generation to a sent state. Agent involvement should compress this; rising cycle times signal friction in the human review step."
              />
              <StatTile
                label="Margin override rate"
                value={fmtPct(metrics?.["marginOverrideRate"])}
                noDataText="Not measured"
                tone={
                  metrics?.["marginOverrideRate"] == null
                    ? "default"
                    : metrics["marginOverrideRate"] <= 0.05
                      ? "green"
                      : metrics["marginOverrideRate"] <= 0.15
                        ? "amber"
                        : "red"
                }
                direction="down-good"
                definition="Rate at which humans override agent-recommended pricing margins. High override rate indicates the pricing agent's calibration is misaligned with deal reality."
              />
              <StatTile
                label="Forecast error"
                value={fmtPct(metrics?.["forecastErrorPct"])}
                noDataText="Not measured"
                tone={
                  metrics?.["forecastErrorPct"] == null
                    ? "default"
                    : metrics["forecastErrorPct"] <= 0.05
                      ? "green"
                      : metrics["forecastErrorPct"] <= 0.15
                        ? "amber"
                        : "red"
                }
                direction="down-good"
                definition="Mean absolute percentage error of agent-generated deal forecasts vs. actual outcomes. Tracks whether the forecasting agent is improving or drifting over time."
              />
            </div>
          </section>

          {/* ====== Decision totals ====== */}
          <section className="space-y-3" data-testid="outcomes-decision-totals">
            <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
              Decision disposition breakdown
            </h3>
            <DecisionTotals totals={totals} />
          </section>

          {/* ====== Coverage & linkage ====== */}
          <section className="space-y-3" data-testid="outcomes-coverage">
            <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
              Evidence coverage &amp; linkage health
            </h3>
            <CoveragePanel coverage={coverage} truncated={truncated} />
          </section>

          {/* ====== Dimensional breakdowns ====== */}
          {Object.keys(breakdowns).length > 0 && (
            <section className="space-y-3" data-testid="outcomes-breakdowns">
              <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
                Dimensional breakdowns
              </h3>
              <div className="grid gap-6 lg:grid-cols-2">
                {BREAKDOWN_DIMS.map(({ key, title }) => {
                  const items = (breakdowns[key] ?? []).slice().sort(
                    (a, b) => b.count - a.count,
                  );
                  if (!breakdowns[key]) return null;
                  return (
                    <Card key={key} className="p-4" data-testid={`breakdown-${key}`}>
                      <BreakdownTable
                        title={title}
                        items={items}
                        total={breakdownTotal}
                      />
                    </Card>
                  );
                })}
                {/* Any additional breakdown keys the API returns that aren't in our fixed list */}
                {Object.keys(breakdowns)
                  .filter((k) => !BREAKDOWN_DIMS.find((d) => d.key === k))
                  .map((key) => {
                    const items = (breakdowns[key] ?? []).slice().sort(
                      (a, b) => b.count - a.count,
                    );
                    return (
                      <Card key={key} className="p-4" data-testid={`breakdown-${key}`}>
                        <BreakdownTable
                          title={`By ${key}`}
                          items={items}
                          total={breakdownTotal}
                        />
                      </Card>
                    );
                  })}
              </div>
            </section>
          )}

          {/* Empty breakdown state */}
          {Object.keys(breakdowns).length === 0 && totalDecisions > 0 && (
            <section className="space-y-3">
              <h3 className="font-mono text-xs uppercase tracking-widest text-text-mute">
                Dimensional breakdowns
              </h3>
              <Card className="p-4">
                <div className="text-xs text-text-faint flex items-center gap-2">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  No breakdown dimensions available. Agent events may not carry dimension metadata (agentId, model, entryPath).
                </div>
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
