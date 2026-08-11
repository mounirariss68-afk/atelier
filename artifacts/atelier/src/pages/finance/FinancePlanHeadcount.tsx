/**
 * FinancePlanHeadcount — driver-based headcount plan (Task #420, Wave 8).
 */
import * as React from "react";
import { Link } from "wouter";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useFpaHeadcount, usePlanEntities } from "@/lib/v5-hooks";

const ROLE_ORDER = ["P", "SM", "M", "SC", "C", "A"];

export default function FinancePlanHeadcount() {
  const entities = usePlanEntities();
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const [scenarioId, setScenarioId] = React.useState("base");
  const { data } = useFpaHeadcount(scenarioId, entityFilter);

  // Build stacked-area data: months × role headcount aggregated across entities
  const stackedData = React.useMemo(() => {
    if (!data) return [];
    return data.months.map((m) => {
      const row: Record<string, number | string> = { name: m.label.slice(0, 3) };
      for (const code of ROLE_ORDER) {
        row[code] = data.rows.filter((r) => r.roleCode === code).reduce((s, r) => s + (r.byMonth[m.index]?.headcount ?? 0), 0);
      }
      return row;
    });
  }, [data]);

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-plan-headcount">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Headcount plan"
            lede="Starting headcount plus discrete planned hires and exits over the 12-month horizon. Scenario attrition deltas compound monthly after the as-of date."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className="bg-bg-elevate border border-border rounded px-2 py-1" data-testid="select-scenario">
              {data?.scenarios.map((s) => <option key={s.id} value={s.id}>{s.label}</option>) ?? <option value="base">Base</option>}
            </select>
            <select value={entityFilter ?? "consolidated"} onChange={(e) => setEntityFilter(e.target.value === "consolidated" ? null : e.target.value)} className="bg-bg-elevate border border-border rounded px-2 py-1" data-testid="select-entity">
              <option value="consolidated">Consolidated</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
            </select>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {!data ? <Card className="p-6 text-text-mute">Loading headcount…</Card> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="headcount-kpis">
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Starting HC</div><div className="text-2xl font-display mt-1" data-testid="kpi-starting-hc">{data.totals.startingHeadcount}</div><div className="text-xs text-text-mute font-mono mt-1">{data.asOfMonthLabel}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Ending HC</div><div className="text-2xl font-display mt-1" data-testid="kpi-ending-hc">{data.totals.endingHeadcount}</div><div className="text-xs text-text-mute font-mono mt-1">12 months out</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Net change</div><div className={`text-2xl font-display mt-1 ${data.totals.netHires >= 0 ? "text-success" : "text-danger"}`}>{data.totals.netHires >= 0 ? "+" : ""}{data.totals.netHires}</div><div className="text-xs text-text-mute font-mono mt-1">{data.scenarioLabel}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Planned hires</div><div className="text-2xl font-display mt-1 text-success">+{data.totals.plannedHires}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Planned exits</div><div className="text-2xl font-display mt-1 text-danger">−{data.totals.plannedExits}</div></Card>
            </div>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Headcount by role over time</div>
              <div className="h-72 w-full">
                <ResponsiveContainer>
                  <AreaChart data={stackedData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {ROLE_ORDER.map((code, i) => (
                      <Area key={code} dataKey={code} stackId="1" stroke={["#a78bfa","#60a5fa","#34d399","#fbbf24","#f97316","#fb7185"][i]} fill={["#a78bfa","#60a5fa","#34d399","#fbbf24","#f97316","#fb7185"][i]} fillOpacity={0.65} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="font-mono text-xs uppercase text-text-faint mb-3">By entity</div>
                <table className="w-full text-sm" data-testid="hc-by-entity">
                  <thead className="text-[11px] font-mono uppercase text-text-faint"><tr><th className="text-left px-2 py-1">Entity</th><th className="text-right px-2 py-1">Start</th><th className="text-right px-2 py-1">End</th><th className="text-right px-2 py-1">Net</th></tr></thead>
                  <tbody>
                    {data.byEntity.map((e) => (
                      <tr key={e.entityId} className="border-t border-border-soft">
                        <td className="px-2 py-1.5">{e.shortName}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{e.starting}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{Math.round(e.ending)}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${e.net >= 0 ? "text-success" : "text-danger"}`}>{e.net >= 0 ? "+" : ""}{Math.round(e.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <Card className="p-4">
                <div className="font-mono text-xs uppercase text-text-faint mb-3">By role</div>
                <table className="w-full text-sm" data-testid="hc-by-role">
                  <thead className="text-[11px] font-mono uppercase text-text-faint"><tr><th className="text-left px-2 py-1">Role</th><th className="text-right px-2 py-1">Start</th><th className="text-right px-2 py-1">End</th><th className="text-right px-2 py-1">Net</th></tr></thead>
                  <tbody>
                    {data.byRole.map((r) => (
                      <tr key={r.roleCode} className="border-t border-border-soft">
                        <td className="px-2 py-1.5">{r.roleLabel}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{r.starting}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{Math.round(r.ending)}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${r.net >= 0 ? "text-success" : "text-danger"}`}>{r.net >= 0 ? "+" : ""}{Math.round(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Planned hires &amp; exits</div>
              <table className="w-full text-sm" data-testid="hc-changes-table">
                <thead className="text-[11px] font-mono uppercase text-text-faint"><tr><th className="text-left px-2 py-1">Entity</th><th className="text-left px-2 py-1">Role</th><th className="text-left px-2 py-1">Month</th><th className="text-right px-2 py-1">Δ</th><th className="text-left px-2 py-1">Reason</th></tr></thead>
                <tbody>
                  {data.rows.flatMap((r) => r.changes.map((c) => ({ ...c, entity: r.entityShortName, role: r.roleLabel, key: `${r.entityId}-${r.roleCode}-${c.monthIndex}` })))
                    .sort((a, b) => a.monthIndex - b.monthIndex)
                    .map((c) => (
                      <tr key={c.key} className="border-t border-border-soft">
                        <td className="px-2 py-1.5">{c.entity}</td>
                        <td className="px-2 py-1.5 text-text-mute">{c.role}</td>
                        <td className="px-2 py-1.5 font-mono text-xs">{data.months[c.monthIndex]?.label ?? c.monthIndex}</td>
                        <td className={`px-2 py-1.5 text-right font-mono ${c.delta >= 0 ? "text-success" : "text-danger"}`}>{c.delta >= 0 ? "+" : ""}{c.delta}</td>
                        <td className="px-2 py-1.5 text-text-mute">{c.reason}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"}
              <Link href="/finance/plan/budget" className="ml-3 text-gold hover:underline">→ Budget</Link>
              <Link href="/finance/plan/bonus" className="ml-3 text-gold hover:underline">→ Bonus accrual</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
