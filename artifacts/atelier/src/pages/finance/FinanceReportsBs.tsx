/**
 * FinanceReportsBs — Balance Sheet per entity / consolidated (Task #417).
 *
 * Translation: BS items at closing rate, equity at historical, with the
 * difference posted to the Foreign Currency Translation Reserve (FCTR)
 * within equity so the BS always balances by construction.
 */
import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useFinanceReportsPeriods, useFinanceReportsBs, type BsLines } from "@/lib/v5-hooks";
import { ReportFilterBar, useReportFilters, fmtMoney, PreliminaryChip } from "./financeReportsShared";

const ASSETS: Array<{ key: keyof BsLines; label: string; bold?: boolean }> = [
  { key: "cash", label: "Cash" },
  { key: "ar", label: "Trade receivables" },
  { key: "intercoAr", label: "Inter-company receivables" },
  { key: "wip", label: "Unbilled WIP" },
  { key: "ppe", label: "Property, plant & equipment" },
  { key: "intangible", label: "Intangible assets" },
  { key: "intercoLoanReceivable", label: "Inter-company loan receivable" },
  { key: "totalAssets", label: "Total assets", bold: true },
];
const LIABS: Array<{ key: keyof BsLines; label: string; bold?: boolean }> = [
  { key: "ap", label: "Trade payables" },
  { key: "intercoAp", label: "Inter-company payables" },
  { key: "accruals", label: "Accruals" },
  { key: "debt", label: "External debt" },
  { key: "intercoLoanPayable", label: "Inter-company loan payable" },
  { key: "totalLiabilities", label: "Total liabilities", bold: true },
];
const EQUITY: Array<{ key: keyof BsLines; label: string; bold?: boolean }> = [
  { key: "shareCapital", label: "Share capital" },
  { key: "retainedEarnings", label: "Retained earnings" },
  { key: "fctr", label: "FX translation reserve (FCTR)" },
  { key: "totalEquity", label: "Total equity", bold: true },
  { key: "totalLiabilitiesAndEquity", label: "Total liabilities & equity", bold: true },
];

function BsBlock({ title, rows, bs, currency }: { title: string; rows: typeof ASSETS; bs: BsLines; currency: string }) {
  return (
    <div>
      <div className="text-xs font-mono uppercase tracking-widest text-text-faint mb-1">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-b border-border-soft/40 ${r.bold ? "font-semibold bg-bg-soft/30" : ""}`}>
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(bs[r.key] as number, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FinanceReportsBs() {
  const { data: periodsData } = useFinanceReportsPeriods();
  const periods = periodsData?.periods ?? [];
  const current = periodsData?.current?.id ?? null;
  const [filters, setFilters] = useReportFilters(current);
  const { data } = useFinanceReportsBs(filters.period || current, filters.entity, filters.currency);

  const headBs: BsLines | null = data?.consolidated ?? data?.perEntity?.[0]?.display ?? null;

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-finance-reports-bs">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Report"
          headline="Balance Sheet"
          lede="Closing balances per entity and consolidated. FX translation at closing rate; equity at historical; FCTR plug carries any translation differential. IC AR/AP and IC loans eliminate on consolidation."
        />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ReportFilterBar filters={filters} periods={periods.map((p) => ({ id: p.id, label: p.label }))} onChange={setFilters} showScope={false} />
          <PreliminaryChip preliminary={data?.preliminary} />
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        {headBs && (
          <Card className="p-4" data-testid="bs-main">
            <div className="flex items-center justify-between mb-3">
              <SectionHead headline={data?.entity ? "Entity Balance Sheet" : "Consolidated Balance Sheet"} />
              {data?.eliminations && (
                <div className="flex gap-2">
                  <MonoChip tone="amber">IC AR/AP: {fmtMoney(data.eliminations.intercoArGbp, filters.currency)}</MonoChip>
                  <MonoChip tone="amber">IC loans: {fmtMoney(data.eliminations.intercoLoanGbp, filters.currency)}</MonoChip>
                </div>
              )}
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <BsBlock title="Assets" rows={ASSETS} bs={headBs} currency={filters.currency} />
              <div className="space-y-4">
                <BsBlock title="Liabilities" rows={LIABS} bs={headBs} currency={filters.currency} />
                <BsBlock title="Equity" rows={EQUITY} bs={headBs} currency={filters.currency} />
              </div>
            </div>
          </Card>
        )}

        {data?.perEntity && data.perEntity.length > 1 && !data.entity && (
          <Card className="p-4 overflow-x-auto" data-testid="bs-per-entity">
            <SectionHead headline="By entity (presentation currency)" />
            <table className="w-full text-sm mt-3">
              <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                <tr className="border-b border-border-soft">
                  <th className="text-left py-2">Entity</th>
                  <th className="text-right py-2">Total assets</th>
                  <th className="text-right py-2">Total liabilities</th>
                  <th className="text-right py-2">Equity</th>
                  <th className="text-right py-2">FCTR</th>
                </tr>
              </thead>
              <tbody>
                {data.perEntity.map((e) => (
                  <tr key={e.entityId} className="border-b border-border-soft/40">
                    <td className="py-1.5">{e.entityName}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.totalAssets, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.totalLiabilities, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.totalEquity, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.fctr, filters.currency)}</td>
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
