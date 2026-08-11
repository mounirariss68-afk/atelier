/**
 * FinancePlanBudget — driver-based annual budget (Task #420, Wave 8).
 */
import * as React from "react";
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, ComposedChart } from "recharts";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useFpaBudget, usePlanEntities } from "@/lib/v5-hooks";
import { PRESENTATION_CURRENCIES, usePresentationCurrency } from "@/lib/presentationCurrency";


function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${currency} ${abs.toFixed(0)}`;
}
function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function signedPct(n: number): string { return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`; }
function varianceTone(n: number | null): string {
  if (n == null) return "text-text-faint";
  if (n >= 0.02) return "text-success";
  if (n <= -0.05) return "text-danger";
  if (n <= -0.02) return "text-warn";
  return "text-text-mute";
}

export default function FinancePlanBudget() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = usePresentationCurrency();
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const [scenarioId, setScenarioId] = React.useState("base");
  const { data } = useFpaBudget(scenarioId, presentation, entityFilter);

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-plan-budget">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Driver-based budget"
            lede="Headcount × utilisation × bill-rate × realisation rolled up to monthly revenue, direct cost and EBITDA. Scenarios apply utilisation, rate, FX and attrition deltas."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className="bg-bg-elevate border border-border rounded px-2 py-1" data-testid="select-scenario">
              {data?.scenarios.map((s) => <option key={s.id} value={s.id}>{s.label}</option>) ?? <option value="base">Base</option>}
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
        {!data ? <Card className="p-6 text-text-mute">Loading budget…</Card> : (
          <>
            {data.committedScenario && (
              <Card className={`p-3 ${data.isCommittedScenario ? "border-gold/40 bg-gold/5" : "border-border-soft"}`} data-testid="committed-banner">
                <div className="text-xs font-mono flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <MonoChip tone="gold">COMMITTED</MonoChip>
                    <span className="ml-2 text-text">{data.committedScenario.scenarioLabel}</span>
                    <span className="text-text-mute"> is the official forecast · {data.committedScenario.periodLabel || "FY2026"} · {data.committedScenario.byUserName} ({data.committedScenario.byRole}) · {new Date(data.committedScenario.committedAt).toLocaleDateString()}</span>
                  </div>
                  {!data.isCommittedScenario && (
                    <span className="text-[11px] text-text-mute italic">Viewing {data.scenarioLabel} (not the committed forecast)</span>
                  )}
                </div>
              </Card>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="budget-kpis">
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Revenue (12mo)</div><div className="text-2xl font-display mt-1 flex items-center gap-2" data-testid="kpi-revenue">{fmt(data.totals.revenue, presentation)}{data.isCommittedScenario && <MonoChip tone="gold" data-testid="badge-committed">COMMITTED</MonoChip>}</div><div className="text-xs text-text-mute font-mono mt-1">{data.scenarioLabel} · {data.fyLabel}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Direct cost</div><div className="text-2xl font-display mt-1">{fmt(data.totals.directCost, presentation)}</div><div className="text-xs text-text-mute font-mono mt-1">Loaded delivery cost</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Gross margin</div><div className="text-2xl font-display mt-1 text-success">{pct(data.totals.grossMarginPct)}</div><div className="text-xs text-text-mute font-mono mt-1">Revenue − direct cost</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">EBITDA</div><div className={`text-2xl font-display mt-1 ${data.totals.ebitda >= 0 ? "text-success" : "text-danger"}`} data-testid="kpi-ebitda">{fmt(data.totals.ebitda, presentation)}</div><div className="text-xs text-text-mute font-mono mt-1">Margin {pct(data.totals.ebitdaMarginPct)}</div></Card>
            </div>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Monthly P&amp;L — {data.scenarioLabel}</div>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <ComposedChart data={data.months.map((m) => ({ name: m.label.slice(0, 3), Revenue: Math.round(m.revenueUsd), Cost: Math.round(m.directCostUsd + m.overheadUsd), EBITDA: Math.round(m.ebitdaUsd) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(Math.abs(v) / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} formatter={(v: number) => fmt(v, presentation)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Revenue" fill="#34d399" />
                    <Bar dataKey="Cost" fill="#fb7185" />
                    <Line dataKey="EBITDA" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
                <div className="font-mono text-xs uppercase text-text-faint">Monthly detail · Plan vs Actual</div>
                <div className="font-mono text-[10px] text-text-faint">
                  Actuals through {data.ytdActual.throughLabel} · firm-economics realised
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="budget-monthly-table">
                  <thead className="text-[10px] font-mono uppercase text-text-faint">
                    <tr className="border-b border-border-soft">
                      <th className="text-left px-2 py-1.5">Month</th>
                      <th className="text-right px-2 py-1.5">FTEs</th>
                      <th className="text-right px-2 py-1.5">Plan rev</th>
                      <th className="text-right px-2 py-1.5">Actual rev</th>
                      <th className="text-right px-2 py-1.5">Var %</th>
                      <th className="text-right px-2 py-1.5">Direct</th>
                      <th className="text-right px-2 py-1.5">Overhead</th>
                      <th className="text-right px-2 py-1.5">Plan EBITDA</th>
                      <th className="text-right px-2 py-1.5">Actual EBITDA</th>
                      <th className="text-right px-2 py-1.5">Var %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.months.map((m, i) => {
                      const a = data.monthsActual[i];
                      const partialFlag = a?.isElapsed && a.isPartial ? ` · MTD ${a.daysElapsed}/${a.daysInMonth}d` : "";
                      return (
                        <tr key={m.iso} className="border-t border-border-soft" data-testid={`budget-row-${m.iso}`}>
                          <td className="px-2 py-1.5">
                            {m.label}
                            {partialFlag && <span className="text-[10px] text-text-faint font-mono ml-1">{partialFlag}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{m.fteEquivalent.toFixed(0)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-text-mute">{fmt(a?.revenuePlanProratedUsd ?? m.revenueUsd, presentation)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-success">
                            {a?.revenueActualUsd != null ? fmt(a.revenueActualUsd, presentation) : <span className="text-text-faint">—</span>}
                          </td>
                          <td className={`px-2 py-1.5 text-right font-mono ${varianceTone(a?.revenueVariancePct ?? null)}`}>
                            {a?.revenueVariancePct != null ? signedPct(a.revenueVariancePct) : <span className="text-text-faint">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(m.directCostUsd, presentation)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(m.overheadUsd, presentation)}</td>
                          <td className={`px-2 py-1.5 text-right font-mono text-text-mute`}>{fmt(a?.ebitdaPlanProratedUsd ?? m.ebitdaUsd, presentation)}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${(a?.ebitdaActualUsd ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                            {a?.ebitdaActualUsd != null ? fmt(a.ebitdaActualUsd, presentation) : <span className="text-text-faint">—</span>}
                          </td>
                          <td className={`px-2 py-1.5 text-right font-mono ${varianceTone(a?.ebitdaVariancePct ?? null)}`}>
                            {a?.ebitdaVariancePct != null ? signedPct(a.ebitdaVariancePct) : <span className="text-text-faint">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="text-[11px] font-mono">
                    <tr className="border-t-2 border-border-soft" data-testid="budget-row-ytd">
                      <td className="px-2 py-1.5 uppercase text-text-faint">YTD ({data.ytdActual.elapsedMonths} mo)</td>
                      <td className="px-2 py-1.5"></td>
                      <td className="px-2 py-1.5 text-right text-text-mute">{fmt(data.ytdActual.revenuePlanProrated, presentation)}</td>
                      <td className="px-2 py-1.5 text-right text-success" data-testid="budget-ytd-actual-revenue">{fmt(data.ytdActual.revenueActual, presentation)}</td>
                      <td className={`px-2 py-1.5 text-right ${varianceTone(data.ytdActual.revenueVariancePct)}`} data-testid="budget-ytd-revenue-variance">{signedPct(data.ytdActual.revenueVariancePct)}</td>
                      <td className="px-2 py-1.5"></td>
                      <td className="px-2 py-1.5"></td>
                      <td className="px-2 py-1.5 text-right text-text-mute">{fmt(data.ytdActual.ebitdaPlanProrated, presentation)}</td>
                      <td className={`px-2 py-1.5 text-right ${data.ytdActual.ebitdaActual >= 0 ? "text-success" : "text-danger"}`}>{fmt(data.ytdActual.ebitdaActual, presentation)}</td>
                      <td className={`px-2 py-1.5 text-right ${varianceTone(data.ytdActual.ebitdaVariancePct)}`}>{signedPct(data.ytdActual.ebitdaVariancePct)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="flex items-baseline justify-between mb-3 gap-2">
                  <div className="font-mono text-xs uppercase text-text-faint">By entity</div>
                  <div className="font-mono text-[10px] text-text-faint">Drill → engagement-economics actuals</div>
                </div>
                <table className="w-full text-sm" data-testid="budget-by-entity">
                  <thead className="text-[11px] font-mono uppercase text-text-faint"><tr><th className="text-left px-2 py-1">Entity</th><th className="text-right px-2 py-1">Revenue</th><th className="text-right px-2 py-1">EBITDA</th><th className="text-right px-2 py-1">Margin</th><th className="text-right px-2 py-1">EOP HC</th><th className="px-2 py-1"></th></tr></thead>
                  <tbody>
                    {data.byEntity.map((e) => (
                      <tr key={e.entityId} className="border-t border-border-soft hover:bg-bg-elevate/40" data-testid={`budget-entity-row-${e.entityId}`}>
                        <td className="px-2 py-1.5">{e.shortName}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(e.totalRevenueUsd, presentation)}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${e.totalEbitdaUsd >= 0 ? "text-success" : "text-danger"}`}>{fmt(e.totalEbitdaUsd, presentation)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{pct(e.ebitdaMarginPct)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{e.endingHeadcount}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Link
                            href={`/finance/reports/firm-economics?entity=${e.entityId}`}
                            className="text-[11px] text-gold hover:underline font-mono"
                            data-testid={`budget-entity-actuals-${e.entityId}`}
                          >
                            Actuals →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card className="p-4">
                <div className="font-mono text-xs uppercase text-text-faint mb-3">By role — contribution margin</div>
                <table className="w-full text-sm" data-testid="budget-by-role">
                  <thead className="text-[11px] font-mono uppercase text-text-faint"><tr><th className="text-left px-2 py-1">Role</th><th className="text-right px-2 py-1">HC-mo</th><th className="text-right px-2 py-1">Revenue</th><th className="text-right px-2 py-1">CM</th><th className="text-right px-2 py-1">CM%</th></tr></thead>
                  <tbody>
                    {data.byRole.map((r) => (
                      <tr key={r.roleCode} className="border-t border-border-soft">
                        <td className="px-2 py-1.5">{r.roleLabel}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.totalHeadcountMonths}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.totalRevenueUsd, presentation)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(r.contributionMarginUsd, presentation)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{pct(r.contributionMarginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">By quarter</div>
              <div className="h-56 w-full">
                <ResponsiveContainer>
                  <BarChart data={data.byQuarter.map((q) => ({ name: q.quarter, Revenue: Math.round(q.revenue), EBITDA: Math.round(q.ebitda) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(Math.abs(v) / 1_000_000).toFixed(1)}m`} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} formatter={(v: number) => fmt(v, presentation)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Revenue" fill="#34d399" />
                    <Bar dataKey="EBITDA" fill="#fbbf24" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-3 border-border-soft">
              <div className="font-mono text-[11px] uppercase text-text-faint mb-2">Driver notes</div>
              <ul className="text-xs text-text-mute space-y-1 font-mono">
                {data.driverNotes.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"} · presentation {presentation}
              <Link href="/finance/plan/scenarios" className="ml-3 text-gold hover:underline">→ Scenarios</Link>
              <Link href="/finance/plan/headcount" className="ml-3 text-gold hover:underline">→ Headcount</Link>
              <Link href="/finance/plan/cash-13w" className="ml-3 text-gold hover:underline">→ 13-week cash</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
