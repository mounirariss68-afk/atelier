import { useState, useMemo, useEffect } from "react";
import {
  useAtelierListOpportunities,
  useAtelierGetPipelineForecast,
  useAtelierRunPipelineForecaster,
  getAtelierListOpportunitiesQueryKey,
  getAtelierGetPipelineForecastQueryKey,
  getAtelierListAuditQueryKey,
  type SalesStage,
  type Opportunity,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { SectionHead, PageHero, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LayoutGrid,
  List as ListIcon,
  AlertTriangle,
  Plus,
  ArrowUp,
  ArrowDown,
  RefreshCw,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CreateOpportunityDialog } from "@/components/CreateOpportunityDialog";
import { StageTransitionDialog } from "@/components/StageTransitionDialog";
import { useToast } from "@/hooks/use-toast";
import {
  SALES_STAGES,
  SALES_STAGE_LABEL,
  STALLED_THRESHOLD_DAYS,
  stageTone,
  SALES_STAGE_DESCRIPTION,
} from "@/lib/sales-stages";

type OppItem = Opportunity;

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function StageColumn({
  stage,
  children,
  count,
  weighted,
}: {
  stage: SalesStage;
  children: React.ReactNode;
  count: number;
  weighted: number;
}) {
  return (
    <div className="min-w-[280px] w-[280px] shrink-0 flex flex-col gap-3 snap-start rounded-md p-2">
      <div className="pb-2 border-b border-gold/30 space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-widest uppercase text-text-mute">
            {SALES_STAGE_LABEL[stage]}
          </span>
          <span className="font-mono text-xs text-text-faint">
            {count} · <span className="text-gold">{fmtUsd(weighted)}</span>
          </span>
        </div>
        <p className="text-[10px] leading-snug text-text-faint">
          {SALES_STAGE_DESCRIPTION[stage]}
        </p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function OppCard({ opp, onClick }: { opp: OppItem; onClick: () => void }) {
  const isStalled = (opp as { stalled?: boolean }).stalled ?? opp.daysInStage > STALLED_THRESHOLD_DAYS;
  return (
    <Card className="p-4 space-y-3 hover:border-gold/50 transition-all group">
      <div className="flex justify-between items-start gap-2">
        <Link
          href={`/opportunities/${opp.id}`}
          className="font-medium text-text group-hover:text-gold transition-colors block leading-tight"
        >
          {opp.name}
        </Link>
        {isStalled && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full border border-danger/60 bg-danger/15 text-danger text-[10px] font-mono uppercase tracking-wider px-2 py-0.5"
            title={`${opp.daysInStage} days in stage — stalled`}
          >
            <AlertTriangle className="w-3 h-3" /> {opp.daysInStage}d
          </span>
        )}
      </div>
      <div className="text-sm text-text-mute font-mono">{opp.accountName}</div>
      <div className="flex justify-between items-end pt-2 border-t border-border-soft">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-faint font-mono">Value · Weighted</span>
          <span className="text-sm font-semibold text-text">
            {fmtUsd(opp.dealSizeUsd)}
            <span className="text-text-mute font-normal"> · </span>
            <span className="text-gold">{fmtUsd((opp.dealSizeUsd * opp.probabilityPct) / 100)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClick}
            className="text-[10px] font-mono uppercase tracking-wider text-text-mute hover:text-gold transition-colors border border-border-soft hover:border-gold/40 rounded px-2 py-1"
          >
            Move
          </button>
          <Avatar className="w-6 h-6 border-2 border-bg-elevate">
            <AvatarFallback className="text-[10px] bg-bg-deep text-gold">
              {opp.partnerOwnerName.split(" ").map((n: string) => n[0]).join("")}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </Card>
  );
}

type SortKey = "name" | "accountName" | "salesStage" | "dealSizeUsd" | "probabilityPct" | "daysInStage";

// Forecast roll-up tab — folded in from the legacy /forecast page (Task #271).
// Same /forecast endpoint, same five group-by toggles. Lives here so users
// don't lose the forecasting view when the standalone nav item disappears.
interface ForecastRow {
  key: string;
  label: string;
  count: number;
  weightedValueUsd: number;
  rawValueUsd: number;
  byStage: Record<string, number>;
}
const FORECAST_TABS: Array<{ id: string; label: string }> = [
  { id: "partner", label: "Partner" },
  { id: "offering", label: "Offering" },
  { id: "sector", label: "Sector" },
  { id: "stage", label: "Stage" },
  { id: "quarter", label: "Quarter" },
];
function ForecastPanel({ initialBy }: { initialBy: string }) {
  const [by, setBy] = useState<string>(initialBy);
  const [data, setData] = useState<{ rows: ForecastRow[]; totals: { count: number; weightedValueUsd: number; rawValueUsd: number } } | null>(null);
  useEffect(() => {
    setData(null);
    let alive = true;
    fetch(`/api/atelier/forecast?by=${by}`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { if (alive) setData(j); })
      .catch(() => { if (alive) setData({ rows: [], totals: { count: 0, weightedValueUsd: 0, rawValueUsd: 0 } }); });
    // Reflect the active group-by in the URL so /opportunities?view=forecast&by=offering is bookmarkable.
    const url = new URL(window.location.href);
    url.searchParams.set("view", "forecast");
    url.searchParams.set("by", by);
    window.history.replaceState(null, "", url.toString());
    return () => { alive = false; };
  }, [by]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[11px] font-mono uppercase tracking-widest text-text-faint mr-2">Group by</span>
        {FORECAST_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setBy(t.id)}
            className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
              by === t.id ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
            }`}
            data-testid={`forecast-by-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!data ? (
        <Skeleton className="h-32 bg-bg-elevate" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="text-text-faint font-mono text-[11px] uppercase tracking-widest">Opps</div>
              <div className="text-2xl font-light mt-1 text-text">{data.totals.count}</div>
            </Card>
            <Card className="p-4 border-gold/40">
              <div className="text-text-faint font-mono text-[11px] uppercase tracking-widest">Weighted</div>
              <div className="text-2xl font-light mt-1 text-gold">{fmtUsd(data.totals.weightedValueUsd)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-text-faint font-mono text-[11px] uppercase tracking-widest">Raw</div>
              <div className="text-2xl font-light mt-1 text-text">{fmtUsd(data.totals.rawValueUsd)}</div>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-deep text-text-mute font-mono text-xs uppercase tracking-wider border-b border-border">
                <tr>
                  <th className="text-left p-3">Bucket</th>
                  <th className="text-right p-3">Count</th>
                  <th className="text-right p-3">Weighted</th>
                  <th className="text-right p-3">Raw</th>
                  <th className="text-left p-3">By stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={r.key} className="hover:bg-bg-elevate-2 transition-colors">
                    <td className="p-3 font-medium text-text">{r.label}</td>
                    <td className="p-3 text-right">{r.count}</td>
                    <td className="p-3 text-right text-gold">{fmtUsd(r.weightedValueUsd)}</td>
                    <td className="p-3 text-right text-text-mute">{fmtUsd(r.rawValueUsd)}</td>
                    <td className="p-3 text-xs font-mono text-text-mute">
                      {Object.entries(r.byStage).map(([s, c]) => `${s}:${c}`).join(" · ")}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-text-faint text-sm italic">No data for this grouping.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

export default function Pipeline() {
  const { data: opps, isLoading } = useAtelierListOpportunities();
  const { data: forecast } = useAtelierGetPipelineForecast();
  const runForecaster = useAtelierRunPipelineForecaster();
  const qc = useQueryClient();
  const { toast } = useToast();

  // Top-level view: pipeline (kanban/table of opps) or forecast (roll-ups).
  // Initialised from ?view= so /opportunities?view=forecast deep-links work,
  // and so the legacy /forecast redirect lands on the right tab.
  const initialQuery = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialMode: "pipeline" | "forecast" = initialQuery.get("view") === "forecast" ? "forecast" : "pipeline";
  const initialBy = initialQuery.get("by") || "partner";
  const [mode, setMode] = useState<"pipeline" | "forecast">(initialMode);
  const [view, setView] = useState<"kanban" | "table">("kanban");

  // Keep the ?view= param in sync so back/forward and bookmarks work.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (mode === "forecast") {
      url.searchParams.set("view", "forecast");
    } else {
      url.searchParams.delete("view");
      url.searchParams.delete("by");
    }
    window.history.replaceState(null, "", url.toString());
  }, [mode]);
  const [sortKey, setSortKey] = useState<SortKey>("dealSizeUsd");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [moveTarget, setMoveTarget] = useState<OppItem | null>(null);
  const [stageFilter, setStageFilter] = useState<SalesStage | "all">("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const o of opps ?? []) set.add(o.partnerOwnerName);
    return Array.from(set).sort();
  }, [opps]);

  const filteredOpps = useMemo(() => {
    return (opps ?? []).filter((o) => {
      const s = (o as { salesStage?: SalesStage }).salesStage ?? "lead";
      if (stageFilter !== "all" && s !== stageFilter) return false;
      if (ownerFilter !== "all" && o.partnerOwnerName !== ownerFilter) return false;
      return true;
    });
  }, [opps, stageFilter, ownerFilter]);

  const sortedOpps = useMemo(() => {
    const arr = [...filteredOpps];
    arr.sort((a, b) => {
      const av = (a as unknown as Record<string, string | number>)[sortKey];
      const bv = (b as unknown as Record<string, string | number>)[sortKey];
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filteredOpps, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }
  function SortHead({ k, label }: { k: SortKey; label: string }) {
    const active = sortKey === k;
    return (
      <th
        className={`p-4 font-normal cursor-pointer select-none hover:text-text transition-colors ${active ? "text-gold" : ""}`}
        onClick={() => toggleSort(k)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
        </span>
      </th>
    );
  }

  async function refreshForecast() {
    try {
      await runForecaster.mutateAsync();
      qc.invalidateQueries({ queryKey: getAtelierGetPipelineForecastQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
      toast({ title: "Forecast refreshed" });
    } catch (err) {
      toast({ title: "Forecaster failed", description: String(err), variant: "destructive" });
    }
  }

  // Build per-stage roll-up locally (also use forecast.buckets for consistency).
  const bucketByStage = useMemo(() => {
    const m = new Map<SalesStage, { count: number; weighted: number }>();
    for (const s of SALES_STAGES) m.set(s, { count: 0, weighted: 0 });
    for (const o of opps ?? []) {
      const s = (o as { salesStage?: SalesStage }).salesStage ?? ("lead" as SalesStage);
      const cur = m.get(s) ?? { count: 0, weighted: 0 };
      cur.count += 1;
      cur.weighted += (o.dealSizeUsd * o.probabilityPct) / 100;
      m.set(s, cur);
    }
    return m;
  }, [opps]);

  if (isLoading) {
    return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  }

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-3.5rem)]">
      <PageHero>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <SectionHead
              headline="Opportunity Pipeline"
              lede="10-stage sales lifecycle. Click Move on a card to log a stage transition with rationale + evidence. Pipeline Forecaster re-rolls weighted value and flags stalled deals."
            />
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <CreateOpportunityDialog
                trigger={
                  <PillButton variant="primary">
                    <span className="inline-flex items-center gap-1"><Plus className="w-3 h-3" /> New opportunity</span>
                  </PillButton>
                }
              />
              {/* Win Themes Library lives here (not in the top nav) because it
                  is the post-mortem of an opportunity. Won/Lost transitions
                  open the per-opportunity debrief; this link surfaces the
                  cross-deal library for trend analysis. */}
              <Link href="/win-loss">
                <PillButton variant="ghost">
                  <span className="inline-flex items-center gap-1.5">Win Themes Library</span>
                </PillButton>
              </Link>
              <PillButton variant="ghost" onClick={refreshForecast} disabled={runForecaster.isPending}>
                <span className="inline-flex items-center gap-1.5">
                  <RefreshCw className={`w-3 h-3 ${runForecaster.isPending ? "animate-spin" : ""}`} />
                  Refresh forecast
                </span>
              </PillButton>
              {/* Task #271 — segmented Pipeline | Forecast control. Replaces
                  the standalone /forecast top-nav entry. */}
              <div className="flex items-center bg-bg-elevate p-1 rounded-full border border-border text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setMode("pipeline")}
                  className={`px-3 py-1 rounded-full transition-colors ${mode === "pipeline" ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"}`}
                  data-testid="tab-mode-pipeline"
                >
                  Pipeline
                </button>
                <button
                  type="button"
                  onClick={() => setMode("forecast")}
                  className={`px-3 py-1 rounded-full transition-colors ${mode === "forecast" ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"}`}
                  data-testid="tab-mode-forecast"
                >
                  Forecast
                </button>
              </div>
              {mode === "pipeline" && (
                <div className="flex items-center gap-2 bg-bg-elevate p-1 rounded-full border border-border">
                  <button
                    onClick={() => setView("kanban")}
                    className={`p-2 rounded-full transition-colors ${view === "kanban" ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"}`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setView("table")}
                    className={`p-2 rounded-full transition-colors ${view === "table" ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"}`}
                  >
                    <ListIcon className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Filters — pipeline mode only; forecast mode has its own group-by toggle. */}
          {mode === "pipeline" && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-text-faint">
            <span>Filter</span>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as SalesStage | "all")}
              className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
            >
              <option value="all">All stages</option>
              {SALES_STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
            >
              <option value="all">All owners</option>
              {owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {(stageFilter !== "all" || ownerFilter !== "all") && (
              <button
                type="button"
                onClick={() => { setStageFilter("all"); setOwnerFilter("all"); }}
                className="text-text-mute hover:text-gold underline"
              >
                Clear
              </button>
            )}
            <span className="ml-auto text-text-mute">{filteredOpps.length} of {opps?.length ?? 0}</span>
          </div>
          )}

          {/* Forecast summary strip — pipeline mode only. */}
          {mode === "pipeline" && forecast && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="p-4">
                <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">In-flight deals</div>
                <div className="text-2xl font-light text-text mt-1">{forecast.totalCount}</div>
              </Card>
              <Card className="p-4">
                <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Pipeline value</div>
                <div className="text-2xl font-light text-text mt-1">{fmtUsd(forecast.totalDealSumUsd)}</div>
              </Card>
              <Card className="p-4 border-gold/40">
                <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Weighted pipeline</div>
                <div className="text-2xl font-light text-gold mt-1">{fmtUsd(forecast.weightedPipelineUsd)}</div>
              </Card>
              <Card className={`p-4 ${forecast.stalledCount > 0 ? "border-danger/40" : ""}`}>
                <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Stalled (&gt;{STALLED_THRESHOLD_DAYS}d)</div>
                <div className={`text-2xl font-light mt-1 ${forecast.stalledCount > 0 ? "text-danger" : "text-text"}`}>
                  {forecast.stalledCount}
                </div>
              </Card>
            </div>
          )}
        </div>
      </PageHero>

      <div className={`py-10 space-y-8 flex-1 flex flex-col ${mode === "pipeline" && view === "kanban" ? "px-[clamp(16px,3vw,32px)] min-w-0" : "container-atelier"}`}>
        {mode === "forecast" ? (
          <ForecastPanel initialBy={initialBy} />
        ) : view === "kanban" ? (
          <div className="flex-1 flex gap-4 overflow-x-auto scrollbar-thin pb-6 snap-x">
            {SALES_STAGES.map((stage) => {
              const stageOpps = filteredOpps.filter(
                (o) => ((o as { salesStage?: SalesStage }).salesStage ?? "lead") === stage,
              );
              const bucket = bucketByStage.get(stage) ?? { count: 0, weighted: 0 };
              return (
                <StageColumn key={stage} stage={stage} count={bucket.count} weighted={bucket.weighted}>
                  {stageOpps.map((opp) => (
                    <OppCard key={opp.id} opp={opp} onClick={() => setMoveTarget(opp)} />
                  ))}
                </StageColumn>
              );
            })}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-bg-deep font-mono text-xs text-text-mute uppercase tracking-wider border-b border-border">
                  <tr>
                    <SortHead k="name" label="Opportunity" />
                    <SortHead k="accountName" label="Account" />
                    <SortHead k="salesStage" label="Stage" />
                    <SortHead k="dealSizeUsd" label="Value" />
                    <SortHead k="probabilityPct" label="Probability" />
                    <th className="p-4 font-normal">Team</th>
                    <SortHead k="daysInStage" label="Aging" />
                    <th className="p-4 font-normal">Next Milestone</th>
                    <th className="p-4 font-normal" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sortedOpps.map((opp) => {
                    const s = (opp as { salesStage?: SalesStage }).salesStage ?? "lead";
                    const isStalled =
                      (opp as { stalled?: boolean }).stalled ?? opp.daysInStage > STALLED_THRESHOLD_DAYS;
                    return (
                      <tr key={opp.id} className="hover:bg-bg-elevate-2 transition-colors">
                        <td className="p-4">
                          <Link href={`/opportunities/${opp.id}`} className="font-medium text-text hover:text-gold transition-colors">
                            {opp.name}
                          </Link>
                          {isStalled && (
                            <span className="ml-2 text-[10px] text-danger font-mono border border-danger/30 rounded px-1">
                              {opp.daysInStage}d stalled
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-text-mute">{opp.accountName}</td>
                        <td className="p-4">
                          <MonoChip tone={stageTone(s)}>{SALES_STAGE_LABEL[s]}</MonoChip>
                        </td>
                        <td className="p-4 font-mono">
                          {fmtUsd(opp.dealSizeUsd)}
                          <span className="text-text-faint"> · </span>
                          <span className="text-gold">{fmtUsd((opp.dealSizeUsd * opp.probabilityPct) / 100)}</span>
                        </td>
                        <td className="p-4 font-mono text-text-mute">{opp.probabilityPct}%</td>
                        <td className="p-4 text-text-mute">
                          {opp.partnerOwnerName.split(" ")[0]} / {opp.engagementLeadName.split(" ")[0]}
                        </td>
                        <td className="p-4 font-mono text-xs">
                          {isStalled ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-danger/60 bg-danger/15 text-danger text-[10px] uppercase tracking-wider px-2 py-0.5">
                              <AlertTriangle className="w-3 h-3" /> {opp.daysInStage}d
                            </span>
                          ) : (
                            <span className="text-text-mute">{opp.daysInStage}d</span>
                          )}
                        </td>
                        <td className="p-4 text-text-mute text-xs truncate max-w-[200px]">{opp.nextMilestone}</td>
                        <td className="p-4 text-right">
                          <button
                            type="button"
                            onClick={() => setMoveTarget(opp)}
                            className="text-[10px] font-mono uppercase tracking-wider text-text-mute hover:text-gold transition-colors border border-border-soft hover:border-gold/40 rounded px-2 py-1"
                          >
                            Move
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {moveTarget && (
        <StageTransitionDialog
          oppId={moveTarget.id}
          oppName={moveTarget.name}
          currentStage={(moveTarget as { salesStage?: SalesStage }).salesStage ?? "lead"}
          open={true}
          onOpenChange={(o) => { if (!o) setMoveTarget(null); }}
        />
      )}
    </div>
  );
}
