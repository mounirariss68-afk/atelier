/**
 * FinanceReportsWorkingCapital — DSO / WIP days / DPO / lockup per entity
 * and consolidated, derived from GL stocks and flows (Task #433).
 */
import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useFinanceReportsPeriods, useFinanceReportsWorkingCapital, type WorkingCapitalMetrics } from "@/lib/v5-hooks";
import { ReportFilterBar, useReportFilters, fmtMoney, PreliminaryChip } from "./financeReportsShared";

function fmtDays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}d`;
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-4" data-testid={`wc-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-xs font-mono uppercase tracking-widest text-text-faint">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      <div className="text-xs text-text-mute mt-1">{hint}</div>
    </Card>
  );
}

export default function FinanceReportsWorkingCapital() {
  const { data: periodsData } = useFinanceReportsPeriods();
  const periods = periodsData?.periods ?? [];
  const current = periodsData?.current?.id ?? null;
  const [filters, setFilters] = useReportFilters(current);
  const { data } = useFinanceReportsWorkingCapital(filters.period || current, filters.scope, filters.entity, filters.currency);

  const cons: WorkingCapitalMetrics | null = data?.consolidated ?? null;

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-reports-working-capital">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Report"
          headline="Working Capital"
          lede="Cash conversion discipline: days sales outstanding, unbilled WIP days, days payables outstanding and total lockup — from GL receivables, WIP and payables against revenue and spend over the scope window."
        />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ReportFilterBar filters={filters} periods={periods.map((p) => ({ id: p.id, label: p.label }))} onChange={setFilters} />
          <PreliminaryChip preliminary={data?.preliminary} />
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        {cons && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="wc-consolidated">
            <MetricTile label="DSO" value={fmtDays(cons.dso)} hint="Receivables ÷ revenue per day" />
            <MetricTile label="WIP days" value={fmtDays(cons.wipDays)} hint="Unbilled WIP ÷ revenue per day" />
            <MetricTile label="DPO" value={fmtDays(cons.dpo)} hint="Payables ÷ spend per day" />
            <MetricTile label="Lockup" value={fmtDays(cons.lockupDays)} hint="DSO + WIP days" />
          </div>
        )}

        {cons && (
          <Card className="p-4" data-testid="wc-balances">
            <SectionHead headline="Balances & activity" />
            <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3 text-sm">
              <div><MonoChip>AR</MonoChip> <span className="tabular-nums ml-1">{fmtMoney(cons.ar, filters.currency)}</span></div>
              <div><MonoChip>WIP</MonoChip> <span className="tabular-nums ml-1">{fmtMoney(cons.wip, filters.currency)}</span></div>
              <div><MonoChip>AP</MonoChip> <span className="tabular-nums ml-1">{fmtMoney(cons.ap, filters.currency)}</span></div>
              <div><MonoChip>Revenue</MonoChip> <span className="tabular-nums ml-1">{fmtMoney(cons.revenue, filters.currency)}</span></div>
              <div><MonoChip>Spend</MonoChip> <span className="tabular-nums ml-1">{fmtMoney(cons.spend, filters.currency)}</span></div>
              <div><MonoChip>Days</MonoChip> <span className="tabular-nums ml-1">{data?.days ?? "—"}</span></div>
            </div>
          </Card>
        )}

        {data?.perEntity && data.perEntity.length > 0 && (
          <Card className="p-4 overflow-x-auto" data-testid="wc-per-entity">
            <SectionHead headline="By entity (local currency)" />
            <table className="w-full text-sm mt-3">
              <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                <tr className="border-b border-border-soft">
                  <th className="text-left py-2">Entity</th>
                  <th className="text-right py-2">AR</th>
                  <th className="text-right py-2">WIP</th>
                  <th className="text-right py-2">AP</th>
                  <th className="text-right py-2">DSO</th>
                  <th className="text-right py-2">WIP days</th>
                  <th className="text-right py-2">DPO</th>
                  <th className="text-right py-2">Lockup</th>
                </tr>
              </thead>
              <tbody>
                {data.perEntity.map((e) => (
                  <tr key={e.entityId} className="border-b border-border-soft/40" data-testid={`wc-row-${e.entityId}`}>
                    <td className="py-1.5">{e.entityName} <span className="text-text-faint text-xs">({e.baseCurrency})</span></td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.ar, e.baseCurrency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.wip, e.baseCurrency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.ap, e.baseCurrency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDays(e.dso)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDays(e.wipDays)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDays(e.dpo)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtDays(e.lockupDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
