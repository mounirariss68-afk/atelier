/**
 * FinanceReportsCube — profitability cube by client / partner / sector /
 * engagement type with engagement-level detail (Task #417, Wave 5).
 */
import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useFinanceReportsPeriods, useFinanceReportsProfitability, type CubeRollupRow, type CubeRow } from "@/lib/v5-hooks";
import { ReportFilterBar, useReportFilters, fmtMoney, fmtPct } from "./financeReportsShared";

type DimKey = "byClient" | "byPartner" | "bySector" | "byEngagementType";
const DIMS: { id: DimKey; label: string }[] = [
  { id: "byClient", label: "Client" },
  { id: "byPartner", label: "Partner" },
  { id: "bySector", label: "Sector" },
  { id: "byEngagementType", label: "Type" },
];

function RollupTable({ rows, currency }: { rows: CubeRollupRow[]; currency: string }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
        <tr className="border-b border-border-soft">
          <th className="text-left py-2">Dimension</th>
          <th className="text-right py-2">Engs</th>
          <th className="text-right py-2">Revenue</th>
          <th className="text-right py-2">Direct cost</th>
          <th className="text-right py-2">GM</th>
          <th className="text-right py-2">GM %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.dim} className="border-b border-border-soft/40">
            <td className="py-1.5">{r.dim}</td>
            <td className="py-1.5 text-right tabular-nums text-text-mute">{r.engagementCount}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtMoney(r.revenueGbp, currency)}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtMoney(r.directCostGbp, currency)}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtMoney(r.grossMarginGbp, currency)}</td>
            <td className="py-1.5 text-right tabular-nums">
              <span className={r.grossMarginPct >= 0.45 ? "text-emerald-400" : r.grossMarginPct >= 0.30 ? "text-text" : "text-amber-400"}>
                {fmtPct(r.grossMarginPct)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FinanceReportsCube() {
  const { data: periodsData } = useFinanceReportsPeriods();
  const periods = periodsData?.periods ?? [];
  const current = periodsData?.current?.id ?? null;
  const [filters, setFilters] = useReportFilters(current);
  const [dim, setDim] = React.useState<DimKey>("byClient");
  const { data } = useFinanceReportsProfitability(filters.period || current, filters.scope, filters.currency);

  const sortedDetail: CubeRow[] = React.useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.slice().sort((a, b) => b.revenueGbp - a.revenueGbp);
  }, [data]);

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-reports-cube">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Report"
          headline="Profitability cube"
          lede="Engagement-level revenue and gross margin rolled up by client, partner, sector and engagement type. All values in the selected presentation currency."
        />
        <div className="mt-6">
          <ReportFilterBar filters={filters} periods={periods.map((p) => ({ id: p.id, label: p.label }))} onChange={(n) => setFilters({ ...n, entity: null })} />
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <SectionHead headline="Rollup" />
            <div className="flex items-center gap-1">
              {DIMS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDim(d.id)}
                  data-testid={`cube-dim-${d.id}`}
                  className={`px-2 py-1 rounded text-xs font-mono uppercase tracking-widest border ${
                    dim === d.id ? "border-gold bg-gold/10 text-gold" : "border-border-soft text-text-mute hover:text-text"
                  }`}
                >{d.label}</button>
              ))}
            </div>
          </div>
          {data && <RollupTable rows={data[dim]} currency={filters.currency} />}
        </Card>

        <Card className="p-4 overflow-x-auto" data-testid="cube-detail">
          <div className="flex items-center justify-between mb-3">
            <SectionHead headline="Engagement detail" />
            <MonoChip>{sortedDetail.length} engagements</MonoChip>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
              <tr className="border-b border-border-soft">
                <th className="text-left py-2">Engagement</th>
                <th className="text-left py-2">Client</th>
                <th className="text-left py-2">Partner</th>
                <th className="text-left py-2">Sector</th>
                <th className="text-left py-2">Type</th>
                <th className="text-right py-2">Revenue</th>
                <th className="text-right py-2">GM</th>
                <th className="text-right py-2">GM %</th>
              </tr>
            </thead>
            <tbody>
              {sortedDetail.slice(0, 50).map((r) => (
                <tr key={r.engagementId} className="border-b border-border-soft/40">
                  <td className="py-1.5">{r.engagementName}</td>
                  <td className="py-1.5">{r.client}</td>
                  <td className="py-1.5">{r.partner}</td>
                  <td className="py-1.5">{r.sector}</td>
                  <td className="py-1.5 text-text-mute font-mono text-xs">{r.engagementType}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtMoney(r.revenueGbp, filters.currency)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtMoney(r.grossMarginGbp, filters.currency)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    <span className={r.grossMarginPct >= 0.45 ? "text-emerald-400" : r.grossMarginPct >= 0.30 ? "text-text" : "text-amber-400"}>
                      {fmtPct(r.grossMarginPct)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
