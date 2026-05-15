/**
 * FinancePlanBonus — bonus & commission accrual gated on firm gross
 * margin (Task #420, Wave 8).
 */
import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useFpaBonus, usePlanEntities } from "@/lib/v5-hooks";

const PRESENTATION_CURRENCIES = ["USD", "GBP", "AED", "SAR", "EUR"];

function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${currency} ${abs.toFixed(0)}`;
}
function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }

export default function FinancePlanBonus() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = React.useState("USD");
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const [scenarioId, setScenarioId] = React.useState("base");
  const { data } = useFpaBonus(scenarioId, presentation, entityFilter);

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-finance-plan-bonus">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Bonus &amp; commission accrual"
            lede="YTD accrual based on individual target × performance multiplier × firm-margin gate. Commission is % of net new ARR closed for sales-eligible roles."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className="bg-bg-elevate border border-border rounded px-2 py-1" data-testid="select-scenario">
              <option value="base">Base case</option>
              <option value="upside">Upside</option>
              <option value="downside">Downside</option>
              <option value="ksa_only">KSA-led</option>
            </select>
            <select value={entityFilter ?? "consolidated"} onChange={(e) => setEntityFilter(e.target.value === "consolidated" ? null : e.target.value)} className="bg-bg-elevate border border-border rounded px-2 py-1" data-testid="select-entity">
              <option value="consolidated">Consolidated</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
            </select>
            <select value={presentation} onChange={(e) => setPresentation(e.target.value)} className="bg-bg-elevate border border-border rounded px-2 py-1" data-testid="select-currency">
              {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {!data ? <Card className="p-6 text-text-mute">Loading bonus accrual…</Card> : (
          <>
            <Card className={`p-4 border ${data.marginGate.passes ? "border-success/40" : "border-amber-500/40"}`} data-testid="margin-gate">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <div>
                  <div className="font-mono text-[11px] uppercase text-text-faint">Margin gate</div>
                  <div className="text-sm mt-1">
                    Firm gross margin <span className="font-mono">{pct(data.marginGate.firmGrossMarginPct)}</span> ·
                    threshold <span className="font-mono">{pct(data.marginGate.thresholdPct)}</span> ·
                    multiplier <span className={`font-mono ${data.marginGate.gateMultiplier >= 1 ? "text-success" : "text-amber-500"}`}>×{data.marginGate.gateMultiplier.toFixed(2)}</span>
                  </div>
                </div>
                <MonoChip tone={data.marginGate.passes ? "green" : "amber"}>{data.marginGate.passes ? "GATE OPEN" : "BELOW THRESHOLD"}</MonoChip>
              </div>
              <div className="text-xs text-text-mute mt-2">YTD accrual progress: {pct(data.ytdProgressPct)} ({data.scenarioLabel} scenario).</div>
            </Card>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="bonus-kpis">
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">YTD bonus accrual</div><div className="text-2xl font-display mt-1" data-testid="kpi-bonus-accrual">{fmt(data.totals.bonusAccrual, presentation)}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">YTD commission accrual</div><div className="text-2xl font-display mt-1">{fmt(data.totals.commissionAccrual, presentation)}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Combined</div><div className="text-2xl font-display mt-1 text-gold">{fmt(data.totals.combined, presentation)}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Base salary pool</div><div className="text-2xl font-display mt-1">{fmt(data.totals.baseSalaryTotal, presentation)}</div></Card>
            </div>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Per-person accrual</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="bonus-table">
                  <thead className="text-[11px] font-mono uppercase text-text-faint">
                    <tr>
                      <th className="text-left px-2 py-1">Name</th>
                      <th className="text-left px-2 py-1">Role</th>
                      <th className="text-left px-2 py-1">Entity</th>
                      <th className="text-right px-2 py-1">Base</th>
                      <th className="text-right px-2 py-1">Target%</th>
                      <th className="text-right px-2 py-1">Perf×</th>
                      <th className="text-right px-2 py-1">Gate×</th>
                      <th className="text-right px-2 py-1">Bonus YTD</th>
                      <th className="text-right px-2 py-1">New ARR</th>
                      <th className="text-right px-2 py-1">Comm%</th>
                      <th className="text-right px-2 py-1">Comm YTD</th>
                      <th className="text-right px-2 py-1">Combined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className="border-t border-border-soft">
                        <td className="px-2 py-1.5">{r.name}</td>
                        <td className="px-2 py-1.5 text-text-mute text-xs">{r.roleLabel}</td>
                        <td className="px-2 py-1.5 text-text-mute text-xs">{r.entityShortName}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.baseSalary, presentation)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{pct(r.bonusTargetPct)}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${r.perfMultiplier >= 1 ? "text-success" : "text-amber-500"}`}>×{r.perfMultiplier.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">×{r.gateMultiplier.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.bonusAccrual, presentation)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.newArrClosed > 0 ? fmt(r.newArrClosed, presentation) : "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.commissionRate > 0 ? pct(r.commissionRate) : "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.commissionAccrual > 0 ? fmt(r.commissionAccrual, presentation) : "—"}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-gold">{fmt(r.combined, presentation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"} · presentation {presentation}
              <Link href="/finance/plan/budget" className="ml-3 text-gold hover:underline">→ Budget</Link>
              <Link href="/finance/plan/scenarios" className="ml-3 text-gold hover:underline">→ Scenarios</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
