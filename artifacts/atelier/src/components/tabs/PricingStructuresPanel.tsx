import * as React from "react";
import {
  useAtelierSimulatePricingStructures,
  useAtelierRunPricingAnalyst,
  useAtelierPricingHandoffBilling,
  useAtelierGetPricingTrends,
  getAtelierGetPricingTrendsQueryKey,
  getAtelierGetDealPricingQueryKey,
} from "@workspace/api-client-react";
import type { AtelierPricingCostLine } from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, TrendingUp, Send, Globe } from "lucide-react";

const fmtUsd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n.toFixed(0)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

interface SimShape {
  kind: string;
  label: string;
  scenarios: {
    best: { revenueUsd: number; costUsd: number; marginPct: number };
    expected: { revenueUsd: number; costUsd: number; marginPct: number };
    worst: { revenueUsd: number; costUsd: number; marginPct: number };
  };
  riskAdjustedMarginPct: number;
  marginLockStatus: "green" | "amber" | "red";
  cashProfile?: Array<{ week: number; amountUsd: number; label: string }>;
  weeksToCash80: number;
  notes?: string[];
}

interface AnalystShape {
  runId: string;
  scenarios: SimShape[];
  sensitivity?: Array<{ kind: string; driver: string; impact: string }>;
  recommendation: { kind: string; label: string; rationale: string; tradeoffs: string[] };
  trendNotes?: string[];
  marginLockChip: "green" | "amber" | "red";
}

function gateTone(s: "green" | "amber" | "red") {
  return s === "green" ? "green" : s === "amber" ? "amber" : "red";
}

export function PricingStructuresPanel({
  oppId,
  isPartner,
  canSeeCost,
  selectedModel,
  costLines,
}: {
  oppId: string;
  isPartner: boolean;
  canSeeCost: boolean;
  selectedModel: string;
  costLines?: AtelierPricingCostLine[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const simulate = useAtelierSimulatePricingStructures();
  const analyst = useAtelierRunPricingAnalyst({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetDealPricingQueryKey(oppId) });
      },
      onError: (e: unknown) => {
        toast({
          title: "Pricing Analyst failed",
          description: e instanceof Error ? e.message : "Run failed",
          variant: "destructive",
        });
      },
    },
  });
  const handoff = useAtelierPricingHandoffBilling({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetDealPricingQueryKey(oppId) });
        toast({ title: "Handed off to billing", description: "Billing rule created on the engagement." });
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Handoff failed";
        toast({ title: "Billing handoff blocked", description: msg, variant: "destructive" });
      },
    },
  });
  const { data: trends } = useAtelierGetPricingTrends(
    { structure: selectedModel },
    {
      query: {
        enabled: !!selectedModel,
        queryKey: getAtelierGetPricingTrendsQueryKey({ structure: selectedModel }),
      },
    },
  );

  const sims = (simulate.data?.simulations ?? []) as unknown as SimShape[];
  const analystResult = analyst.data as unknown as AnalystShape | undefined;

  return (
    <>
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">
            Structure comparison
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => simulate.mutate({ oppId, data: { costLines: costLines ?? [] } })}
            disabled={simulate.isPending}
            data-testid="button-simulate-structures"
          >
            {simulate.isPending ? "Simulating…" : "Compare all structures"}
          </Button>
        </div>
        {sims.length === 0 ? (
          <p className="text-xs text-text-mute">
            Simulates all 7 structures — best / expected / worst margin bands, risk-adjusted margin, and cash-receipt profile. Pure math, no persistence.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-structure-sims">
              <thead>
                <tr className="text-[10px] font-mono uppercase tracking-widest text-text-faint text-left">
                  <th className="py-2 pr-3">Structure</th>
                  <th className="py-2 pr-3">Best</th>
                  <th className="py-2 pr-3">Expected</th>
                  <th className="py-2 pr-3">Worst</th>
                  {canSeeCost && <th className="py-2 pr-3">Risk-adj margin</th>}
                  <th className="py-2 pr-3">Gate</th>
                  <th className="py-2">Cash 80%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {sims.map((s) => (
                  <tr key={s.kind} data-testid={`row-sim-${s.kind}`} className={s.kind === selectedModel ? "bg-bg-elevate/40" : ""}>
                    <td className="py-2 pr-3 text-text font-medium">{s.label}</td>
                    <td className="py-2 pr-3 text-text-mute">
                      {fmtUsd(s.scenarios.best.revenueUsd)}{canSeeCost ? ` · ${fmtPct(s.scenarios.best.marginPct)}` : ""}
                    </td>
                    <td className="py-2 pr-3 text-text-mute">
                      {fmtUsd(s.scenarios.expected.revenueUsd)}{canSeeCost ? ` · ${fmtPct(s.scenarios.expected.marginPct)}` : ""}
                    </td>
                    <td className="py-2 pr-3 text-text-mute">
                      {fmtUsd(s.scenarios.worst.revenueUsd)}{canSeeCost ? ` · ${fmtPct(s.scenarios.worst.marginPct)}` : ""}
                    </td>
                    {canSeeCost && (
                      <td className="py-2 pr-3 text-text font-semibold">{fmtPct(s.riskAdjustedMarginPct)}</td>
                    )}
                    <td className="py-2 pr-3">
                      <MonoChip tone={gateTone(s.marginLockStatus)}>{s.marginLockStatus.toUpperCase()}</MonoChip>
                    </td>
                    <td className="py-2 text-text-mute">wk {s.weeksToCash80}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold" /> Pricing Analyst
          </h3>
          <Button
            onClick={() => analyst.mutate({ oppId, data: {} })}
            disabled={analyst.isPending}
            data-testid="button-pricing-analyst"
          >
            {analyst.isPending ? "Analyzing…" : "Run Pricing Analyst"}
          </Button>
        </div>
        {analystResult ? (
          <div className="space-y-3" data-testid="analyst-result">
            <div className="rounded-md border border-gold/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono uppercase tracking-widest text-gold">
                  Recommended: {analystResult.recommendation.label}
                </div>
                <MonoChip tone={gateTone(analystResult.marginLockChip)}>
                  Gate {analystResult.marginLockChip.toUpperCase()}
                </MonoChip>
              </div>
              <div className="text-sm text-text">{analystResult.recommendation.rationale}</div>
            </div>
            {analystResult.recommendation.tradeoffs.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Tradeoffs</div>
                <ul className="text-sm text-text-mute space-y-1 list-disc list-inside">
                  {analystResult.recommendation.tradeoffs.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {(analystResult.trendNotes?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Market context</div>
                <ul className="text-sm text-text-mute space-y-1 list-disc list-inside">
                  {analystResult.trendNotes!.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
            {(analystResult.sensitivity?.length ?? 0) > 0 && canSeeCost && (
              <div className="space-y-1">
                <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Margin sensitivity</div>
                <ul className="text-xs text-text-faint font-mono space-y-1">
                  {analystResult.sensitivity!.map((s, i) => (
                    <li key={i}>
                      {s.kind}: {s.driver} — {s.impact}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-mute">
            Compares all structures with deterministic math and recommends one with Partner-facing rationale. The margin lock gates on the risk-adjusted margin, not the best case.
          </p>
        )}
      </Card>

      {(trends?.items?.length ?? 0) > 0 && (
        <Card className="p-6 space-y-3">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gold" /> Trend guidance
          </h3>
          <div className="grid gap-2">
            {trends!.items.slice(0, 3).map((t) => (
              <div key={t.id} className="rounded-md border border-border-soft p-3 space-y-1" data-testid={`trend-${t.id}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text font-medium">{t.title}</span>
                  <MonoChip tone={t.direction === "rising" ? "green" : t.direction === "declining" ? "red" : undefined}>
                    {t.direction}
                  </MonoChip>
                </div>
                <div className="text-xs text-text-mute">{t.guidance}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {isPartner && <PricingResearcherCard oppId={oppId} />}

      {isPartner && (
        <Card className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
              <Send className="w-4 h-4 text-gold" /> Billing handoff
            </h3>
            <Button
              variant="outline"
              onClick={() => handoff.mutate({ oppId, data: {} })}
              disabled={handoff.isPending}
              data-testid="button-billing-handoff"
            >
              {handoff.isPending ? "Handing off…" : "Hand off to billing"}
            </Button>
          </div>
          <p className="text-xs text-text-mute">
            Creates a billing rule on the linked engagement from the locked structure. Blocked until any required Partner override / countersign is in place.
          </p>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------
// Pricing Researcher — web-search market benchmarks (review-only).
// Bespoke launch/poll routes are not in the openapi spec, so this
// uses raw fetch: POST returns 202 immediately, GET polls status.
// ---------------------------------------------------------------

interface ResearcherOutput {
  summary?: string;
  marketBenchmarks?: Array<{ metric?: string; value?: string; context?: string }>;
  suggestedStructures?: Array<{
    kind?: string;
    outcomeVariant?: string;
    rationale?: string;
  }>;
  suggestedCostLines?: Array<{
    type?: string;
    label?: string;
    amountUsd?: number;
    recurrence?: string;
    passThrough?: boolean;
    rationale?: string;
  }>;
  risks?: string[];
  citations?: Array<{ title?: string; url?: string }>;
  confidence?: "green" | "amber" | "red";
}

interface ResearcherStatus {
  status: "running" | "succeeded" | "failed" | null;
  phase: string | null;
  progressPct: number | null;
  output: ResearcherOutput | null;
}

function PricingResearcherCard({ oppId }: { oppId: string }) {
  const { toast } = useToast();
  const base = `${import.meta.env.BASE_URL}api/atelier/opportunities/${oppId}/pricing/researcher`;
  const [focus, setFocus] = React.useState("");
  const [state, setState] = React.useState<ResearcherStatus>({
    status: null,
    phase: null,
    progressPct: null,
    output: null,
  });
  const [launching, setLaunching] = React.useState(false);
  const polling = React.useRef<number | null>(null);

  const poll = React.useCallback(async () => {
    const r = await fetch(base, { credentials: "include" });
    if (!r.ok) return;
    const j = (await r.json()) as ResearcherStatus;
    setState(j);
    if (j.status === "running") {
      // Resume polling if research is in flight (e.g. after a page reload).
      if (!polling.current) {
        polling.current = window.setInterval(() => void pollRef.current(), 3000);
      }
    } else if (polling.current) {
      window.clearInterval(polling.current);
      polling.current = null;
    }
  }, [base]);
  const pollRef = React.useRef(poll);
  pollRef.current = poll;

  // Load any prior research on mount.
  React.useEffect(() => {
    void poll();
    return () => {
      if (polling.current) window.clearInterval(polling.current);
    };
  }, [poll]);

  const startPolling = () => {
    if (polling.current) window.clearInterval(polling.current);
    polling.current = window.setInterval(() => void poll(), 3000);
  };

  const launch = async () => {
    setLaunching(true);
    try {
      const r = await fetch(base, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(focus.trim() ? { focus: focus.trim() } : {}),
      });
      if (!r.ok && r.status !== 202) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `researcher_${r.status}`);
      }
      setState((s) => ({ ...s, status: "running", phase: "Starting research…", progressPct: 0 }));
      startPolling();
    } catch (e) {
      toast({
        title: "Pricing Researcher failed to start",
        description: e instanceof Error ? e.message : "Launch failed",
        variant: "destructive",
      });
    } finally {
      setLaunching(false);
    }
  };

  const running = state.status === "running";
  const out = state.output;

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
          <Globe className="w-4 h-4 text-gold" /> Pricing Researcher
        </h3>
        <Button
          variant="outline"
          onClick={() => void launch()}
          disabled={launching || running}
          data-testid="button-pricing-researcher"
        >
          {running ? "Researching…" : launching ? "Starting…" : out ? "Re-run research" : "Research market pricing"}
        </Button>
      </div>
      <Input
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        placeholder="Optional focus (e.g. GenAI implementation retainers in GCC banking)"
        className="bg-bg-elevate border-border text-text"
        data-testid="input-researcher-focus"
      />
      {running && (
        <div className="text-xs text-text-mute font-mono" data-testid="researcher-phase">
          {state.phase ?? "Working…"}{state.progressPct != null ? ` · ${state.progressPct}%` : ""}
        </div>
      )}
      {state.status === "failed" && (
        <div className="text-xs text-danger font-mono" data-testid="researcher-error">
          Research failed{state.phase ? `: ${state.phase}` : ""}. Try again.
        </div>
      )}
      {out && !running ? (
        <div className="space-y-3" data-testid="researcher-result">
          <div className="flex items-start justify-between gap-3">
            {out.summary && <div className="text-sm text-text">{out.summary}</div>}
            {out.confidence && (
              <MonoChip tone={gateTone(out.confidence)}>
                Confidence {out.confidence.toUpperCase()}
              </MonoChip>
            )}
          </div>
          {(out.marketBenchmarks?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Market benchmarks</div>
              <div className="grid gap-2">
                {out.marketBenchmarks!.map((b, i) => (
                  <div key={i} className="rounded-md border border-border-soft p-3 space-y-1" data-testid={`benchmark-${i}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text font-medium">{b.metric ?? "Benchmark"}</span>
                      {b.value && <MonoChip>{b.value}</MonoChip>}
                    </div>
                    {b.context && <div className="text-xs text-text-mute">{b.context}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {(out.suggestedStructures?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Suggested structures</div>
              <ul className="text-sm text-text-mute space-y-1 list-disc list-inside">
                {out.suggestedStructures!.map((s, i) => (
                  <li key={i}>
                    <span className="text-text capitalize">{(s.kind ?? "").replace(/_/g, " ")}</span>
                    {s.outcomeVariant && s.outcomeVariant !== "generic" ? (
                      <span className="text-text-faint"> · {s.outcomeVariant.replace(/_/g, " ")}</span>
                    ) : null}
                    {s.rationale ? ` — ${s.rationale}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(out.suggestedCostLines?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Suggested cost lines</div>
              <ul className="text-sm text-text-mute space-y-1 list-disc list-inside">
                {out.suggestedCostLines!.map((c, i) => (
                  <li key={i}>
                    {c.label ?? c.type} — ${Math.round(c.amountUsd ?? 0).toLocaleString()}
                    {c.recurrence && c.recurrence !== "one_time" ? ` ${c.recurrence.replace("_", "-")}` : ""}
                    {c.passThrough ? " (pass-through)" : ""}
                    {c.rationale ? ` · ${c.rationale}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(out.risks?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Risks</div>
              <ul className="text-sm text-amber-300 space-y-1 list-disc list-inside">
                {out.risks!.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          {(out.citations?.length ?? 0) > 0 && (
            <div className="text-[11px] text-text-faint font-mono space-y-0.5">
              {out.citations!.map((s, i) => (
                <div key={i}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-gold underline">
                      {s.title || s.url}
                    </a>
                  ) : (
                    s.title
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-text-faint">
            Review-only market research — nothing is applied to the deal pricing automatically.
          </p>
        </div>
      ) : !running && state.status !== "failed" ? (
        <p className="text-xs text-text-mute">
          Web-search agent that benchmarks market pricing for this deal's structures. Review-only: results never change the pricing without a Partner editing it.
        </p>
      ) : null}
    </Card>
  );
}
