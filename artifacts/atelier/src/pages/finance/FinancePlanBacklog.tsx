/**
 * FinancePlanBacklog — signed backlog + weighted pipeline coverage (Task #415, Wave 3).
 */

import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useBacklogCoverage, usePlanEntities } from "@/lib/v5-hooks";
import { PRESENTATION_CURRENCIES, usePresentationCurrency } from "@/lib/presentationCurrency";


function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${currency} ${abs.toFixed(0)}`;
}

const STAGE_TONE: Record<string, "default" | "gold" | "green" | "amber" | "red"> = {
  discover: "default",
  qualify: "default",
  shape: "amber",
  propose: "gold",
  negotiate: "gold",
  verbal: "green",
};

export default function FinancePlanBacklog() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = usePresentationCurrency();
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const { data } = useBacklogCoverage(presentation, entityFilter);

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-finance-plan-backlog">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Backlog &amp; pipeline coverage"
            lede="Signed backlog plus probability-weighted pipeline against the next two quarters of revenue plan. Coverage cut by entity, sector, partner-owner, and stage."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
            <select
              value={entityFilter ?? "consolidated"}
              onChange={(e) => setEntityFilter(e.target.value === "consolidated" ? null : e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
              data-testid="select-entity"
            >
              <option value="consolidated">Consolidated</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
            </select>
            <select
              value={presentation}
              onChange={(e) => setPresentation(e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
              data-testid="select-currency"
            >
              {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {!data ? (
          <Card className="p-6 text-text-mute">Loading coverage…</Card>
        ) : (
          <>
            {/* Coverage summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="backlog-kpis">
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Signed backlog</div>
                <div className="text-2xl font-display mt-1" data-testid="kpi-backlog">{fmt(data.totals.backlogUsd, presentation)}</div>
                <div className="text-xs text-text-mute font-mono mt-1">{data.totals.backlogCoverageMonths} months runway at burn</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Weighted pipeline</div>
                <div className="text-2xl font-display mt-1" data-testid="kpi-weighted-pipeline">{fmt(data.totals.weightedPipelineUsd, presentation)}</div>
                <div className="text-xs text-text-mute font-mono mt-1">stage-probability weighted</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Next 2-Q plan</div>
                <div className="text-2xl font-display mt-1">{fmt(data.totals.next2qPlanUsd, presentation)}</div>
                <div className="text-xs text-text-mute font-mono mt-1">{data.revenuePlan.map((q) => q.quarterLabel).join(" + ")}</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Coverage ratio</div>
                <div className={`text-2xl font-display mt-1 ${data.totals.coverageRatio >= data.targetCoverage ? "text-success" : data.totals.coverageRatio >= data.targetCoverage * 0.66 ? "text-amber-500" : "text-danger"}`} data-testid="kpi-coverage-ratio">
                  {data.totals.coverageRatio.toFixed(2)}×
                </div>
                <div className="text-xs text-text-mute font-mono mt-1">target {data.targetCoverage.toFixed(1)}× of plan</div>
              </Card>
            </div>

            {/* Coverage bar */}
            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-2">
                Backlog + weighted pipeline vs. next 2-Q plan
              </div>
              <CoverageBar
                backlog={data.totals.backlogUsd}
                weighted={data.totals.weightedPipelineUsd}
                plan={data.totals.next2qPlanUsd}
                target={data.targetCoverage}
                presentation={presentation}
              />
            </Card>

            {/* Cuts */}
            <div className="grid md:grid-cols-3 gap-4">
              <CutCard title="By entity" rows={data.byEntity.map((r) => ({ key: r.entityName, b: r.backlogUsd, w: r.weightedUsd }))} presentation={presentation} testId="cut-entity" />
              <CutCard title="By sector" rows={data.bySector.map((r) => ({ key: r.sector, b: r.backlogUsd, w: r.weightedUsd }))} presentation={presentation} testId="cut-sector" />
              <CutCard title="By partner-owner" rows={data.byPartner.map((r) => ({ key: r.partner, b: r.backlogUsd, w: r.weightedUsd }))} presentation={presentation} testId="cut-partner" />
            </div>

            {/* Pipeline by stage */}
            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Pipeline by stage</div>
              <table className="w-full text-sm" data-testid="stage-table">
                <thead className="text-[11px] font-mono uppercase text-text-faint">
                  <tr>
                    <th className="text-left px-2 py-1">Stage</th>
                    <th className="text-right px-2 py-1">Deals</th>
                    <th className="text-right px-2 py-1">Raw ACV</th>
                    <th className="text-right px-2 py-1">Weighted</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byStage.map((s) => (
                    <tr key={s.stage} className="border-t border-border-soft">
                      <td className="px-2 py-1.5"><MonoChip tone={STAGE_TONE[s.stage] ?? "default"}>{s.stage}</MonoChip></td>
                      <td className="px-2 py-1.5 text-right font-mono">{s.count}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmt(s.rawUsd, presentation)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gold">{fmt(s.weightedUsd, presentation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Top 5 weighted deals */}
            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Top 5 weighted deals</div>
              <table className="w-full text-sm" data-testid="top-deals-table">
                <thead className="text-[11px] font-mono uppercase text-text-faint">
                  <tr>
                    <th className="text-left px-2 py-1">Deal</th>
                    <th className="text-left px-2 py-1">Partner</th>
                    <th className="text-left px-2 py-1">Stage</th>
                    <th className="text-left px-2 py-1">Close</th>
                    <th className="text-right px-2 py-1">Raw</th>
                    <th className="text-right px-2 py-1">Weighted</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topDeals.map((d) => (
                    <tr key={d.id} className="border-t border-border-soft">
                      <td className="px-2 py-1.5">
                        <div className="text-text">{d.name}</div>
                        <div className="text-xs text-text-mute">{d.client}</div>
                      </td>
                      <td className="px-2 py-1.5 text-text-mute">{d.partner}</td>
                      <td className="px-2 py-1.5"><MonoChip tone={STAGE_TONE[d.stage] ?? "default"}>{d.stage}</MonoChip></td>
                      <td className="px-2 py-1.5 font-mono text-xs">{d.expectedClose}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmt(d.rawUsd, presentation)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gold">{fmt(d.weightedUsd, presentation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Backlog contracts */}
            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Signed contracts (remaining backlog)</div>
              <table className="w-full text-sm" data-testid="contracts-table">
                <thead className="text-[11px] font-mono uppercase text-text-faint">
                  <tr>
                    <th className="text-left px-2 py-1">Client</th>
                    <th className="text-left px-2 py-1">Sector</th>
                    <th className="text-left px-2 py-1">Partner</th>
                    <th className="text-left px-2 py-1">Ends</th>
                    <th className="text-right px-2 py-1">Quarters of runway</th>
                    <th className="text-right px-2 py-1">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contracts.map((c) => (
                    <tr key={c.id} className="border-t border-border-soft">
                      <td className="px-2 py-1.5">{c.client}</td>
                      <td className="px-2 py-1.5 text-text-mute">{c.sector}</td>
                      <td className="px-2 py-1.5 text-text-mute">{c.partner}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{c.endsOn}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{c.quartersOfRunway.toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmt(c.remainingUsd, presentation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"} · presentation {presentation}
              <Link href="/finance/plan/cash-13w" className="ml-3 text-gold hover:underline">→ 13-week cash forecast</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CoverageBar({ backlog, weighted, plan, target, presentation }: { backlog: number; weighted: number; plan: number; target: number; presentation: string }) {
  const total = backlog + weighted;
  const targetTotal = plan * target;
  const denom = Math.max(targetTotal, total, 1);
  const bPct = (backlog / denom) * 100;
  const wPct = (weighted / denom) * 100;
  const planPct = (plan / denom) * 100;
  const targetPct = (targetTotal / denom) * 100;
  return (
    <div className="space-y-2">
      <div className="relative h-8 bg-bg-elevate rounded overflow-hidden">
        <div className="absolute top-0 left-0 h-full bg-success/70" style={{ width: `${bPct}%` }} title={`Backlog ${fmt(backlog, presentation)}`} />
        <div className="absolute top-0 h-full bg-gold/70" style={{ left: `${bPct}%`, width: `${wPct}%` }} title={`Weighted ${fmt(weighted, presentation)}`} />
        <div className="absolute top-0 h-full border-l-2 border-text border-dashed" style={{ left: `${planPct}%` }} title={`Plan 1× ${fmt(plan, presentation)}`} />
        <div className="absolute top-0 h-full border-l-2 border-amber-500 border-dashed" style={{ left: `${targetPct}%` }} title={`Target ${target}×`} />
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-text-faint">
        <span><span className="inline-block w-2 h-2 bg-success/70 mr-1" />Backlog</span>
        <span><span className="inline-block w-2 h-2 bg-gold/70 mr-1" />Weighted pipeline</span>
        <span>Plan 1× ({fmt(plan, presentation)})</span>
        <span>Target {target}× ({fmt(plan * target, presentation)})</span>
      </div>
    </div>
  );
}

function CutCard({ title, rows, presentation, testId }: { title: string; rows: { key: string; b: number; w: number }[]; presentation: string; testId: string }) {
  const max = Math.max(1, ...rows.map((r) => r.b + r.w));
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="font-mono text-xs uppercase text-text-faint mb-3">{title}</div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const total = r.b + r.w;
          const bPct = (r.b / max) * 100;
          const wPct = (r.w / max) * 100;
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between text-xs gap-2">
                <span className="truncate">{r.key}</span>
                <span className="font-mono text-text-mute whitespace-nowrap">{fmt(total, presentation)}</span>
              </div>
              <div className="relative h-2 bg-bg-elevate rounded mt-1 overflow-hidden">
                <div className="absolute top-0 left-0 h-full bg-success/70" style={{ width: `${bPct}%` }} />
                <div className="absolute top-0 h-full bg-gold/70" style={{ left: `${bPct}%`, width: `${wPct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
