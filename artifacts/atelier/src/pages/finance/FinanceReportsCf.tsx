/**
 * FinanceReportsCf — Cash Flow Statement (indirect method) per entity
 * and consolidated (Task #417, Wave 5).
 */
import * as React from "react";
import { PageHero, SectionHead, Card } from "@/components/ui/primitives";
import { useFinanceReportsPeriods, useFinanceReportsCf, type CfLines } from "@/lib/v5-hooks";
import { ReportFilterBar, useReportFilters, fmtMoney, PreliminaryChip } from "./financeReportsShared";

const ROWS: Array<{ key: keyof CfLines; label: string; bold?: boolean; section?: string }> = [
  { key: "netIncome", label: "Net income", section: "ops" },
  { key: "depreciation", label: "+ Depreciation & amortisation" },
  { key: "workingCapitalChange", label: "+ Working capital change" },
  { key: "cashFromOps", label: "Cash from operating activities", bold: true },
  { key: "capex", label: "Capex", section: "inv" },
  { key: "cashFromInvesting", label: "Cash from investing activities", bold: true },
  { key: "debtRepayment", label: "Debt repayment", section: "fin" },
  { key: "intercoFunding", label: "Inter-company funding" },
  { key: "cashFromFinancing", label: "Cash from financing activities", bold: true },
  { key: "fxOnCash", label: "FX effect on cash" },
  { key: "netChangeInCash", label: "Net change in cash", bold: true },
  { key: "openingCash", label: "Opening cash" },
  { key: "closingCash", label: "Closing cash", bold: true },
];

export default function FinanceReportsCf() {
  const { data: periodsData } = useFinanceReportsPeriods();
  const periods = periodsData?.periods ?? [];
  const current = periodsData?.current?.id ?? null;
  const [filters, setFilters] = useReportFilters(current);
  const { data } = useFinanceReportsCf(filters.period || current, filters.scope, filters.entity, filters.currency);

  const headCf: CfLines | null = data?.consolidated ?? data?.perEntity?.[0]?.display ?? null;

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-reports-cf">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Report"
          headline="Cash Flow Statement"
          lede="Indirect-method cash flow for the period. Operating, investing and financing sections; closing cash ties to the Balance Sheet."
        />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ReportFilterBar filters={filters} periods={periods.map((p) => ({ id: p.id, label: p.label }))} onChange={setFilters} />
          <PreliminaryChip preliminary={data?.preliminary} />
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        {headCf && (
          <Card className="p-4" data-testid="cf-main">
            <SectionHead headline={data?.entity ? "Entity Cash Flow" : "Consolidated Cash Flow"} />
            <table className="w-full text-sm mt-3">
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.key} className={`border-b border-border-soft/40 ${r.bold ? "font-semibold bg-bg-soft/30" : ""}`}>
                    <td className="py-1.5">{r.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(headCf[r.key] as number, filters.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {data?.perEntity && data.perEntity.length > 1 && !data.entity && (
          <Card className="p-4 overflow-x-auto" data-testid="cf-per-entity">
            <SectionHead headline="By entity (presentation currency)" />
            <table className="w-full text-sm mt-3">
              <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                <tr className="border-b border-border-soft">
                  <th className="text-left py-2">Entity</th>
                  <th className="text-right py-2">Cash from ops</th>
                  <th className="text-right py-2">Cash from inv</th>
                  <th className="text-right py-2">Cash from fin</th>
                  <th className="text-right py-2">Net change</th>
                  <th className="text-right py-2">Closing cash</th>
                </tr>
              </thead>
              <tbody>
                {data.perEntity.map((e) => (
                  <tr key={e.entityId} className="border-b border-border-soft/40">
                    <td className="py-1.5">{e.entityName}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.cashFromOps, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.cashFromInvesting, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.cashFromFinancing, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.netChangeInCash, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.display.closingCash, filters.currency)}</td>
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
