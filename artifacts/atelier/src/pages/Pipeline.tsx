import { useState, useMemo, useEffect } from "react";
import {
  useAtelierListOpportunities,
  useAtelierGetMe,
  useAtelierListPartnerFirms,
  getAtelierListPartnerFirmsQueryKey,
  useAtelierRunPipelineForecaster,
  getAtelierListOpportunitiesQueryKey,
  getAtelierGetPipelineForecastQueryKey,
  getAtelierListAuditQueryKey,
  type SalesStage,
  type Opportunity,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { RecordCard } from "@/components/ui/record-card";
import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Plus,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Download,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CreateOpportunityDialog } from "@/components/CreateOpportunityDialog";
import { StageTransitionDialog } from "@/components/StageTransitionDialog";
import { useToast } from "@/hooks/use-toast";
import { fmtMoney } from "@/lib/utils";
import { canSeePartnersLens } from "@/lib/lens";
import { OpportunityPartnerTags } from "@/components/OpportunityPartnerPicker";
import { filterPartnerOpportunities, summarizePartnerOpportunities, partnerReportQuery, partnerReportFilename } from "@/lib/partner-opportunity-filters";
import {
  SALES_STAGES,
  WORKING_STAGES,
  TERMINAL_STAGES,
  SALES_STAGE_LABEL,
  STALLED_THRESHOLD_DAYS,
  SUB_STATUS_LABEL,
  stageTone,
  SALES_STAGE_DESCRIPTION,
  runnerAgeDays,
  runnerAgeTier,
  RUNNER_AGE_AMBER_DAYS,
  RUNNER_AGE_RED_DAYS,
  type RunnerAgeTier,
} from "@/lib/sales-stages";

type OppItem = Opportunity;

// Task #8 — deal values are denominated in each account's `primaryCurrency`
// (surfaced on the opportunity wire as `currency`). Per-card money is
// formatted in that currency; roll-ups are grouped per currency and joined
// with " + " — we never sum across currencies or fabricate an FX rate.
function fmtOppMoney(n: number, currency?: string | null): string {
  return fmtMoney(n, currency ?? "USD");
}
function fmtUsd(n: number): string {
  return fmtMoney(n, "USD");
}
function fmtByCurrency(m: Record<string, number>): string {
  const parts = Object.entries(m)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => fmtMoney(v, c));
  return parts.length ? parts.join(" + ") : fmtMoney(0, "USD");
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
  weighted: Record<string, number>;
}) {
  return (
    <div className="min-w-[280px] w-[280px] shrink-0 flex flex-col gap-3 snap-start rounded-md p-2"
      data-testid={`stage-column-${stage}`}>
      <div className="pb-2 border-b border-gold/30 space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-widest uppercase text-text-mute">
            {SALES_STAGE_LABEL[stage]}
          </span>
          <span className="font-mono text-xs text-text-faint">
            {count} · <span className="text-gold">{fmtByCurrency(weighted)}</span>
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

// Task #296 — Runner-age border tints. Tailwind needs the literal class
// names at build time; keep the lookup table inline so JIT picks them up.
const RUNNER_AGE_BORDER: Record<RunnerAgeTier, string> = {
  fresh: "",
  amber: "border-l-amber",
  red: "border-l-danger",
};

function OppCard({ opp, onClick }: { opp: OppItem; onClick: () => void }) {
  const isStalled = (opp as { stalled?: boolean }).stalled ?? opp.daysInStage > STALLED_THRESHOLD_DAYS;
  const stage = (opp as { salesStage?: SalesStage }).salesStage ?? "suspect";
  const subStatus = (opp as { subStatus?: string | null }).subStatus ?? null;
  const runnerAge = stage === "runner"
    ? runnerAgeDays((opp as { runnerEnteredAt?: string | null }).runnerEnteredAt ?? null)
    : null;
  const ageTier = runnerAgeTier(runnerAge);
  const ageClass = RUNNER_AGE_BORDER[ageTier];
  const ageTitle =
    runnerAge === null
      ? undefined
      : ageTier === "red"
        ? `${runnerAge}d in Runner — escalate (≥${RUNNER_AGE_RED_DAYS}d)`
        : ageTier === "amber"
          ? `${runnerAge}d in Runner — chase legal/procurement (≥${RUNNER_AGE_AMBER_DAYS}d)`
          : `${runnerAge}d in Runner`;
  return (
    <div title={ageTitle} data-runner-age-tier={ageTier} className="h-full">
      <RecordCard
        href={`/opportunities/${opp.id}`}
        accentClass={ageClass || undefined}
        title={opp.name}
        subtitle={<span className="font-mono text-sm">{opp.accountName}</span>}
        trailing={
          isStalled ? (
            <span
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-danger/60 bg-danger/15 text-danger text-[10px] font-mono uppercase tracking-wider px-2 py-0.5"
              title={`${opp.daysInStage} days in stage — stalled`}
            >
              <AlertTriangle className="w-3 h-3" /> {opp.daysInStage}d
            </span>
          ) : undefined
        }
        chips={
          (subStatus || runnerAge !== null || opp.partnerFirms?.length) ? (
            <>
              <OpportunityPartnerTags firms={opp.partnerFirms} />
              {subStatus && (
                <span
                  className="inline-flex items-center rounded-full border border-border-soft bg-bg-deep text-text-mute text-[10px] font-mono uppercase tracking-wider px-2 py-0.5"
                  data-testid={`sub-status-${opp.id}`}
                >
                  {SUB_STATUS_LABEL[subStatus] ?? subStatus.replace(/_/g, " ")}
                </span>
              )}
              {runnerAge !== null && (
                <span
                  className={`inline-flex items-center rounded-full text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 border ${
                    ageTier === "red" ? "border-danger/60 bg-danger/15 text-danger"
                    : ageTier === "amber" ? "border-amber/60 bg-amber/15 text-amber"
                    : "border-border-soft bg-bg-deep text-text-mute"
                  }`}
                >
                  {runnerAge}d in runner
                </span>
              )}
            </>
          ) : undefined
        }
        footer={
          <div className="flex justify-between items-end">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-faint font-mono">Value · Weighted</span>
              <span className="text-sm font-semibold text-text">
                {fmtOppMoney(opp.dealSizeUsd, (opp as { currency?: string }).currency)}
                <span className="text-text-mute font-normal"> · </span>
                <span className="text-gold">{fmtOppMoney((opp.dealSizeUsd * opp.probabilityPct) / 100, (opp as { currency?: string }).currency)}</span>
              </span>
            </div>
            <div
              className="flex items-center gap-2"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
            >
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
        }
        data-testid={`opp-card-${opp.id}`}
      />
    </div>
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
  // Task #8 — server groups money per account currency and flags mixed
  // buckets so we never present a cross-currency sum under one label.
  byCurrency?: Record<string, { weightedValue: number; rawValue: number; count: number }>;
  mixedCurrency?: boolean;
  redactedCount?: number;
}
interface ForecastTotals {
  count: number;
  weightedValueUsd: number;
  rawValueUsd: number;
  byCurrency?: Record<string, { weightedValue: number; rawValue: number; count: number }>;
  mixedCurrency?: boolean;
  redactedCount?: number;
}
// Render a money roll-up honestly: single-currency buckets use that currency;
// mixed buckets show per-currency parts joined with " + ".
function fmtForecastMoney(
  usdTotal: number,
  byCurrency: Record<string, { weightedValue: number; rawValue: number; count: number }> | undefined,
  field: "weightedValue" | "rawValue",
): string {
  if (byCurrency && Object.keys(byCurrency).length > 0) {
    return fmtByCurrency(
      Object.fromEntries(Object.entries(byCurrency).map(([c, v]) => [c, v[field]])),
    );
  }
  return fmtUsd(usdTotal);
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
  const [data, setData] = useState<{ rows: ForecastRow[]; totals: ForecastTotals } | null>(null);
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
              <div className="text-2xl font-light mt-1 text-gold">{fmtForecastMoney(data.totals.weightedValueUsd, data.totals.byCurrency, "weightedValue")}</div>
            </Card>
            <Card className="p-4">
              <div className="text-text-faint font-mono text-[11px] uppercase tracking-widest">Raw</div>
              <div className="text-2xl font-light mt-1 text-text">{fmtForecastMoney(data.totals.rawValueUsd, data.totals.byCurrency, "rawValue")}</div>
            </Card>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-deep/60 text-text-mute font-mono text-xs uppercase tracking-wider border-b border-border">
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
                    <td className="p-3 text-right text-gold">{fmtForecastMoney(r.weightedValueUsd, r.byCurrency, "weightedValue")}</td>
                    <td className="p-3 text-right text-text-mute">{fmtForecastMoney(r.rawValueUsd, r.byCurrency, "rawValue")}</td>
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
  const { data: opps, isLoading, isFetching, isError, refetch } = useAtelierListOpportunities();
  const { data: me } = useAtelierGetMe();
  const canFilterPartners = canSeePartnersLens(me?.role);
  const firms = useAtelierListPartnerFirms({
    query: {
      queryKey: getAtelierListPartnerFirmsQueryKey(),
      enabled: canFilterPartners,
      staleTime: 30_000,
    },
  });
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
  // Task #723 — kanban/table switch presented via the shared ViewToggle
  // pattern (kanban is the "cards" side) and persisted per page.
  const [viewMode, setViewMode] = useViewMode("pipeline-opportunities");
  const view: "kanban" | "table" = viewMode === "list" ? "table" : "kanban";

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
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const effectivePartnerFilter = canFilterPartners ? partnerFilter : "all";
  const partnerChoices = useMemo(() => [...(firms.data?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [firms.data]);
  const selectedPartner = partnerChoices.find((firm) => firm.id === effectivePartnerFilter);

  useEffect(() => { setDownloadError(null); }, [stageFilter, ownerFilter, partnerFilter]);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of opps ?? []) if (o.partnerOwnerId) map.set(o.partnerOwnerId, o.partnerOwnerName);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [opps]);

  const filteredOpps = useMemo(() => {
    return filterPartnerOpportunities(opps ?? [], { stage: stageFilter, owner: ownerFilter, partnerFirmId: effectivePartnerFilter });
  }, [opps, stageFilter, ownerFilter, effectivePartnerFilter]);
  const summary = useMemo(() => summarizePartnerOpportunities(filteredOpps), [filteredOpps]);
  const reportReady = canFilterPartners && !!selectedPartner && !isFetching && !isError &&
    !!opps && firms.isSuccess && !firms.isFetching && filteredOpps.length > 0;

  async function downloadPartnerReport() {
    if (!reportReady || downloading || !selectedPartner) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const query = partnerReportQuery({ stage: stageFilter, owner: ownerFilter, partnerFirmId: selectedPartner.id });
      const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
      const response = await fetch(`${base}api/atelier/opportunities/partner-report.pdf?${query}`, { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || body?.error || `Report download failed (${response.status}).`);
      }
      if (!response.headers.get("content-type")?.includes("application/pdf")) {
        throw new Error("The server did not return a PDF. Please try again.");
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("The report was empty. Please try again.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = partnerReportFilename(selectedPartner.name, new Date().toISOString().slice(0, 10));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast({ title: "Partner PDF downloaded", description: "For manual sharing only. No email was sent or portal access granted." });
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not download the partner report.");
    } finally {
      setDownloading(false);
    }
  }

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

  // Cards, stage summaries and headline KPIs share the same filtered population.
  const bucketByStage = useMemo(() => {
    const m = new Map<SalesStage, { count: number; weighted: Record<string, number> }>();
    for (const s of SALES_STAGES) m.set(s, { count: 0, weighted: {} });
    for (const o of filteredOpps) {
      const s = (o as { salesStage?: SalesStage }).salesStage ?? ("suspect" as SalesStage);
      const cur = m.get(s) ?? { count: 0, weighted: {} };
      cur.count += 1;
      // Task #8 — group weighted value per account currency; never sum
      // heterogeneous currencies into one number.
      const ccy = (o as { currency?: string }).currency ?? "USD";
      cur.weighted[ccy] = (cur.weighted[ccy] ?? 0) + (o.dealSizeUsd * o.probabilityPct) / 100;
      m.set(s, cur);
    }
    return m;
  }, [filteredOpps]);

  if (isLoading) {
    return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  }

  if (isError) {
    return <div className="container-atelier py-12 space-y-3" role="alert" data-testid="error-pipeline">
      <p className="text-danger">Could not load opportunities. Please retry before filtering or exporting.</p>
      <PillButton onClick={() => void refetch()} data-testid="button-retry-pipeline">Retry</PillButton>
    </div>;
  }

  return (
    <div className="flex flex-col h-full min-h-[calc(100vh-3.5rem)]">
      <LensPageHeader
        headline="Opportunity Pipeline"
        lede="5-band sales funnel — Suspect → Prospect → Convert → Runner → Contract. Runner cards age Amber at 21d, Red at 45d so procurement-stuck deals stand out. Click Move on a card to log a stage transition with rationale + evidence."
        actions={
          <div className="flex flex-wrap items-center gap-3">
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
            <div className="flex items-center glass-surface p-1 rounded-full border border-border text-xs font-mono">
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
              <ViewToggle
                mode={viewMode}
                onChange={setViewMode}
                cardsLabel="Kanban"
                listLabel="Table"
                data-testid="view-toggle-pipeline"
              />
            )}
          </div>
        }
      />

      <div className="container-atelier pt-6 space-y-6">
        {/* Filters — pipeline mode only; forecast mode has its own group-by toggle. */}
        {mode === "pipeline" && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-text-faint">
            <span>Filter</span>
            <select
              aria-label="Stage"
              data-testid="select-stage-filter"
              value={stageFilter}
              disabled={downloading}
              onChange={(e) => setStageFilter(e.target.value as SalesStage | "all")}
              className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
            >
              <option value="all">All stages</option>
              {SALES_STAGES.map((s) => (
                <option key={s} value={s}>{SALES_STAGE_LABEL[s]}</option>
              ))}
            </select>
            <select
              aria-label="Owner"
              data-testid="select-owner-filter"
              value={ownerFilter}
              disabled={downloading}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1 text-text"
            >
              <option value="all">All owners</option>
              {ownerFilter !== "all" && !owners.some((o) => o.id === ownerFilter) && <option value={ownerFilter}>Unavailable owner</option>}
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            {canFilterPartners && (
              <>
                <select
                  aria-label="External partner firm"
                  value={partnerFilter}
                  onChange={(e) => setPartnerFilter(e.target.value)}
                  disabled={firms.isLoading || firms.isError || downloading}
                  className="max-w-full bg-bg-elevate border border-border rounded px-2 py-1 text-text"
                  data-testid="select-partner-filter"
                >
                  <option value="all">{firms.isLoading ? "Loading partners…" : "All partners"}</option>
                  {partnerFilter !== "all" && !selectedPartner && <option value={partnerFilter}>Unavailable partner — choose another</option>}
                  {partnerChoices.map((firm) => <option key={firm.id} value={firm.id}>{firm.name}</option>)}
                </select>
                <PillButton
                  variant="ghost"
                  disabled={!reportReady || downloading}
                  onClick={downloadPartnerReport}
                  data-testid="button-download-partner-pdf"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Download className="h-3.5 w-3.5" /> {downloading ? "Preparing PDF…" : "Download partner PDF"}
                  </span>
                </PillButton>
              </>
            )}
            {(stageFilter !== "all" || ownerFilter !== "all" || effectivePartnerFilter !== "all") && (
              <button
                type="button"
                disabled={downloading}
                data-testid="button-clear-pipeline-filters"
                onClick={() => { setStageFilter("all"); setOwnerFilter("all"); setPartnerFilter("all"); }}
                className="text-text-mute hover:text-gold underline"
              >
                Clear
              </button>
            )}
            <span className="ml-auto text-text-mute" data-testid="text-filtered-opportunity-count">{filteredOpps.length} of {opps?.length ?? 0}</span>
          </div>
        )}

        {mode === "pipeline" && canFilterPartners && (
          <div className="space-y-2 text-xs text-text-faint" aria-live="polite">
            {firms.isError ? (
              <div role="alert" className="text-danger" data-testid="error-pipeline-partners">
                Could not load partner firms. Export is unavailable.
                <PillButton variant="ghost" onClick={() => void firms.refetch()} data-testid="button-retry-pipeline-partners">Retry</PillButton>
              </div>
            ) : partnerFilter === "all" ? (
              <p data-testid="status-partner-report">Choose a partner firm to download a PDF for manual sharing.</p>
            ) : firms.isSuccess && !selectedPartner ? (
              <p data-testid="status-partner-report">This partner is no longer available. Choose another firm or clear the filter.</p>
            ) : isFetching || firms.isFetching ? (
              <p data-testid="status-partner-report">Refreshing data before export…</p>
            ) : <p data-testid="status-partner-report">PDF includes all authorized matches for the selected partner, stage and owner. No email or portal access is granted.</p>}
            {downloadError && <p role="alert" className="text-danger" data-testid="error-partner-report">{downloadError} Try downloading again.</p>}
          </div>
        )}
        {mode === "pipeline" && filteredOpps.length === 0 && (
          <p className="text-sm text-text-mute" data-testid="empty-filtered-opportunities">No opportunities match these filters. Adjust or clear them to continue; there is nothing to export.</p>
        )}
        {mode === "pipeline" && (
          <>
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-text-faint">
            <span className="text-gold">Pipeline · current filters</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Matching deals</div>
              <div className="text-2xl font-light text-text mt-1" data-testid="kpi-pipeline-count">{summary.count}</div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Pipeline value</div>
              <div className="text-2xl font-light text-text mt-1" data-testid="kpi-pipeline-value">{fmtByCurrency(summary.raw)}</div>
            </Card>
            <Card className="p-4 border-gold/40">
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Weighted pipeline</div>
              <div className="text-2xl font-light text-gold mt-1" data-testid="kpi-pipeline-weighted">{fmtByCurrency(summary.weighted)}</div>
            </Card>
            <Card className={`p-4 ${summary.stalled > 0 ? "border-danger/40" : ""}`}>
              <div className="text-[11px] font-mono uppercase tracking-widest text-text-faint">Stalled (&gt;{STALLED_THRESHOLD_DAYS}d)</div>
              <div className={`text-2xl font-light mt-1 ${summary.stalled > 0 ? "text-danger" : "text-text"}`} data-testid="kpi-pipeline-stalled">
                {summary.stalled}
              </div>
            </Card>
          </div>
          </>
        )}
      </div>

      <div className={`py-10 space-y-8 flex-1 flex flex-col ${mode === "pipeline" && view === "kanban" ? "px-[clamp(16px,3vw,32px)] min-w-0" : "container-atelier"}`}>
        {mode === "forecast" ? (
          <ForecastPanel initialBy={initialBy} />
        ) : view === "kanban" ? (
          // Task #296 — 5 working columns + a stacked terminal sidebar.
          // Lost / No-decision / Withdrawn share a sidebar so the kanban
          // stays readable while still surfacing closed-deal volume.
          <div className="flex-1 flex gap-4 overflow-x-auto scrollbar-thin pb-6 snap-x">
            {WORKING_STAGES.map((stage) => {
              const stageOpps = filteredOpps.filter(
                (o) => ((o as { salesStage?: SalesStage }).salesStage ?? "suspect") === stage,
              );
              const bucket = bucketByStage.get(stage) ?? { count: 0, weighted: {} };
              return (
                <StageColumn key={stage} stage={stage} count={bucket.count} weighted={bucket.weighted}>
                  {stageOpps.map((opp) => (
                    <OppCard key={opp.id} opp={opp} onClick={() => setMoveTarget(opp)} />
                  ))}
                </StageColumn>
              );
            })}
            <div
              className="min-w-[220px] w-[220px] shrink-0 flex flex-col gap-3 snap-start rounded-md p-2"
              data-testid="terminal-sidebar"
            >
              <div className="pb-2 border-b border-border-soft">
                <span className="font-mono text-[11px] tracking-widest uppercase text-text-faint">
                  Closed deals
                </span>
              </div>
              {TERMINAL_STAGES.map((stage) => {
                const bucket = bucketByStage.get(stage) ?? { count: 0, weighted: {} };
                return (
                  <Card
                    key={stage}
                    className="p-3 space-y-1"
                    data-testid={`terminal-card-${stage}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-text-mute">
                        {SALES_STAGE_LABEL[stage]}
                      </span>
                      <span className="font-mono text-xs text-text-faint">{bucket.count}</span>
                    </div>
                    <p className="text-[10px] leading-snug text-text-faint">
                      {SALES_STAGE_DESCRIPTION[stage]}
                    </p>
                  </Card>
                );
              })}
            </div>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-bg-deep/60 font-mono text-xs text-text-mute uppercase tracking-wider border-b border-border">
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
                    const s = (opp as { salesStage?: SalesStage }).salesStage ?? "suspect";
                    const isStalled =
                      (opp as { stalled?: boolean }).stalled ?? opp.daysInStage > STALLED_THRESHOLD_DAYS;
                    return (
                      <tr key={opp.id} className="hover:bg-bg-elevate-2 transition-colors">
                        <td className="p-4">
                          <Link href={`/opportunities/${opp.id}`} className="font-medium text-text hover:text-gold transition-colors">
                            {opp.name}
                          </Link>
                          <OpportunityPartnerTags firms={opp.partnerFirms} />
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
                          {fmtOppMoney(opp.dealSizeUsd, (opp as { currency?: string }).currency)}
                          <span className="text-text-faint"> · </span>
                          <span className="text-gold">{fmtOppMoney((opp.dealSizeUsd * opp.probabilityPct) / 100, (opp as { currency?: string }).currency)}</span>
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
          currentStage={(moveTarget as { salesStage?: SalesStage }).salesStage ?? "suspect"}
          dealSizeUsd={moveTarget.dealSizeUsd}
          currentNextMilestone={moveTarget.nextMilestone}
          open={true}
          onOpenChange={(o) => { if (!o) setMoveTarget(null); }}
        />
      )}
    </div>
  );
}
