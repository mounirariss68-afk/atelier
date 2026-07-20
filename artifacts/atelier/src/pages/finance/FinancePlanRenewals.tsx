/**
 * FinancePlanRenewals — subscription / framework / MSA renewal calendar
 * (Task #420, Wave 8).
 */
import * as React from "react";
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useFpaRenewals, usePlanEntities } from "@/lib/v5-hooks";
import { PRESENTATION_CURRENCIES, usePresentationCurrency } from "@/lib/presentationCurrency";


function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${currency} ${abs.toFixed(0)}`;
}

const STAGE_TONE: Record<string, "default" | "green" | "amber" | "red" | "gold"> = {
  not_started: "default", discovery: "default", proposal_sent: "gold",
  in_negotiation: "amber", verbal_yes: "green", at_risk: "red", lost: "red",
};
const RISK_TONE: Record<string, "green" | "amber" | "red"> = {
  low: "green", medium: "amber", high: "red",
};

export default function FinancePlanRenewals() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = usePresentationCurrency();
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const { data } = useFpaRenewals(presentation, entityFilter);

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-finance-plan-renewals">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Renewals calendar"
            lede="MSAs, retainers, subscriptions and framework agreements expiring in the next 12 months — sequenced by date with owner, stage and risk band."
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
        {!data ? <Card className="p-6 text-text-mute">Loading renewals…</Card> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="renewals-kpis">
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Total ARR up for renewal</div><div className="text-2xl font-display mt-1" data-testid="kpi-total-arr">{fmt(data.totalsArr.totalUsd, presentation)}</div><div className="text-xs text-text-mute font-mono mt-1">{data.rows.length} agreements</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">High-risk ARR</div><div className="text-2xl font-display mt-1 text-danger">{fmt(data.totalsArr.highRiskUsd, presentation)}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">At-risk ARR</div><div className="text-2xl font-display mt-1 text-amber-500">{fmt(data.totalsArr.atRiskUsd, presentation)}</div></Card>
              <Card className="p-3"><div className="text-[11px] font-mono uppercase text-text-faint">Low-risk ARR</div><div className="text-2xl font-display mt-1 text-success">{fmt(data.totalsArr.lowRiskUsd, presentation)}</div></Card>
            </div>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">ARR coming up for renewal — by month</div>
              <div className="h-64 w-full">
                <ResponsiveContainer>
                  <BarChart data={data.byMonth.map((m) => ({ name: m.label, ARR: Math.round(m.arrUsd), HighRisk: Math.round(m.highRiskUsd) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `${(Math.abs(v) / 1_000_000).toFixed(1)}m`} />
                    <Tooltip contentStyle={{ background: "#0b1320", border: "1px solid #ffffff22", fontSize: 12 }} formatter={(v: number) => fmt(v, presentation)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ARR" fill="#34d399" />
                    <Bar dataKey="HighRisk" fill="#fb7185" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="font-mono text-xs uppercase text-text-faint mb-3">By owner</div>
                <table className="w-full text-sm" data-testid="renewals-by-owner">
                  <thead className="text-[11px] font-mono uppercase text-text-faint"><tr><th className="text-left px-2 py-1">Owner</th><th className="text-right px-2 py-1">Count</th><th className="text-right px-2 py-1">ARR</th></tr></thead>
                  <tbody>
                    {data.byOwner.map((o) => (
                      <tr key={o.owner} className="border-t border-border-soft">
                        <td className="px-2 py-1.5">{o.owner}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{o.count}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(o.arrUsd, presentation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <Card className="p-4">
                <div className="font-mono text-xs uppercase text-text-faint mb-3">By stage</div>
                <table className="w-full text-sm" data-testid="renewals-by-stage">
                  <thead className="text-[11px] font-mono uppercase text-text-faint"><tr><th className="text-left px-2 py-1">Stage</th><th className="text-right px-2 py-1">Count</th><th className="text-right px-2 py-1">ARR</th></tr></thead>
                  <tbody>
                    {data.byStage.map((s) => (
                      <tr key={s.stage} className="border-t border-border-soft">
                        <td className="px-2 py-1.5"><MonoChip tone={STAGE_TONE[s.stage] ?? "default"}>{s.stage.replace(/_/g, " ")}</MonoChip></td>
                        <td className="px-2 py-1.5 text-right font-mono">{s.count}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt(s.arrUsd, presentation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>

            <Card className="p-4">
              <div className="font-mono text-xs uppercase text-text-faint mb-3">Renewal calendar</div>
              <table className="w-full text-sm" data-testid="renewals-table">
                <thead className="text-[11px] font-mono uppercase text-text-faint"><tr>
                  <th className="text-left px-2 py-1">Client</th>
                  <th className="text-left px-2 py-1">Kind</th>
                  <th className="text-left px-2 py-1">Entity</th>
                  <th className="text-left px-2 py-1">Owner</th>
                  <th className="text-left px-2 py-1">Expires</th>
                  <th className="text-left px-2 py-1">Stage</th>
                  <th className="text-left px-2 py-1">Risk</th>
                  <th className="text-right px-2 py-1">ARR</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border-soft">
                      <td className="px-2 py-1.5">
                        <div className="text-text">{r.client}</div>
                        <div className="text-[11px] text-text-mute">{r.recommendation}</div>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.kind}</td>
                      <td className="px-2 py-1.5 text-text-mute text-xs">{r.entityShortName}</td>
                      <td className="px-2 py-1.5 text-text-mute">{r.ownerName}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">
                        {r.expiresOn}
                        <div className="text-[10px] text-text-faint">{r.daysUntil <= 0 ? `${Math.abs(r.daysUntil)}d overdue` : `${r.daysUntil}d`}</div>
                      </td>
                      <td className="px-2 py-1.5"><MonoChip tone={STAGE_TONE[r.stage] ?? "default"}>{r.stage.replace(/_/g, " ")}</MonoChip></td>
                      <td className="px-2 py-1.5"><MonoChip tone={RISK_TONE[r.riskBand] ?? "default"}>{r.riskBand}</MonoChip></td>
                      <td className="px-2 py-1.5 text-right font-mono">{fmt(r.arrUsd, presentation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"} · presentation {presentation}
              <Link href="/finance/plan/backlog" className="ml-3 text-gold hover:underline">→ Backlog &amp; pipeline</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
