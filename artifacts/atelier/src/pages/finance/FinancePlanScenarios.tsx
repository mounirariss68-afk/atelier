/**
 * FinancePlanScenarios — base / upside / downside / KSA-led variant
 * comparison vs base case (Task #420, Wave 8).
 */
import * as React from "react";
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useFpaScenarios, usePlanEntities } from "@/lib/v5-hooks";

const PRESENTATION_CURRENCIES = ["USD", "GBP", "AED", "SAR", "EUR"];

function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${currency} ${abs.toFixed(0)}`;
}
function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }
function pctDelta(n: number): string { return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`; }

const TONE: Record<string, "default" | "green" | "amber" | "red" | "gold"> = {
  base: "default", upside: "green", downside: "red", ksa_only: "gold",
};

export default function FinancePlanScenarios() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = React.useState("USD");
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const { data } = useFpaScenarios(presentation, entityFilter);

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-finance-plan-scenarios">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Scenarios vs base case"
            lede="What-if comparisons across utilisation, rate, FX and attrition deltas. Each scenario re-runs the driver model end-to-end against the same headcount plan."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
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
        {!data ? <Card className="p-6 text-text-mute">Loading scenarios…</Card> : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="scenario-cards">
              {data.comparisons.map((c) => (
                <Card key={c.scenarioId} className={`p-4 border ${c.scenarioId === "base" ? "border-border" : c.deltas.ebitdaPct >= 0 ? "border-success/40" : "border-danger/40"}`} data-testid={`scenario-card-${c.scenarioId}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-display">{c.scenarioLabel}</div>
                    <MonoChip tone={TONE[c.scenarioId] ?? "default"}>{c.scenarioId}</MonoChip>
                  </div>
                  <div className="text-[11px] text-text-mute mt-1 leading-snug">{c.description}</div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                    <div>
                      <div className="text-[10px] uppercase text-text-faint font-mono">Revenue</div>
                      <div className="font-mono">{fmt(c.revenue, presentation)}</div>
                      {c.scenarioId !== "base" && <div className={`font-mono text-[11px] ${c.deltas.revenuePct >= 0 ? "text-success" : "text-danger"}`}>{pctDelta(c.deltas.revenuePct)}</div>}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-text-faint font-mono">EBITDA</div>
                      <div className={`font-mono ${c.ebitda >= 0 ? "text-success" : "text-danger"}`}>{fmt(c.ebitda, presentation)}</div>
                      {c.scenarioId !== "base" && <div className={`font-mono text-[11px] ${c.deltas.ebitdaPct >= 0 ? "text-success" : "text-danger"}`}>{pctDelta(c.deltas.ebitdaPct)}</div>}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-text-faint font-mono">Gross margin</div>
                      <div className="font-mono">{pct(c.grossMarginPct)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-text-faint font-mono">EBITDA margin</div>
                      <div className="font-mono">{pct(c.ebitdaMarginPct)}</div>
                      {c.scenarioId !== "base" && <div className={`font-mono text-[11px] ${c.deltas.ebitdaMarginPctPts >= 0 ? "text-success" : "text-danger"}`}>{c.deltas.ebitdaMarginPctPts >= 0 ? "+" : ""}{(c.deltas.ebitdaMarginPctPts * 100).toFixed(1)} pts</div>}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Quarterly revenue by scenario</div>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <LineChart data={(data.comparisons[0]?.quarter ?? []).map((q, qi) => {
                    const row: Record<string, number | string> = { name: q.quarter };
                    for (const c of data.comparisons) row[c.scenarioLabel] = Math.round((c.quarter[qi]?.revenue) ?? 0);
                    return row;
                  })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(Math.abs(v) / 1_000_000).toFixed(1)}m`} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} formatter={(v: number) => fmt(v, presentation)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.comparisons.map((c, i) => (
                      <Line key={c.scenarioId} type="monotone" dataKey={c.scenarioLabel} stroke={["#94a3b8", "#34d399", "#fb7185", "#fbbf24"][i % 4]} strokeWidth={2} dot={{ r: 3 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Quarterly EBITDA by scenario</div>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <BarChart data={(data.comparisons[0]?.quarter ?? []).map((q, qi) => {
                    const row: Record<string, number | string> = { name: q.quarter };
                    for (const c of data.comparisons) row[c.scenarioLabel] = Math.round((c.quarter[qi]?.ebitda) ?? 0);
                    return row;
                  })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(Math.abs(v) / 1_000_000).toFixed(1)}m`} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} formatter={(v: number) => fmt(v, presentation)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {data.comparisons.map((c, i) => (
                      <Bar key={c.scenarioId} dataKey={c.scenarioLabel} fill={["#94a3b8", "#34d399", "#fb7185", "#fbbf24"][i % 4]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"} · presentation {presentation}
              <Link href="/finance/plan/budget" className="ml-3 text-gold hover:underline">→ Budget detail</Link>
              <Link href="/finance/plan/bonus" className="ml-3 text-gold hover:underline">→ Bonus accrual</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
