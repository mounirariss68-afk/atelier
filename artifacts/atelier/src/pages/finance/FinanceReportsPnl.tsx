/**
 * FinanceReportsPnl — consolidated and per-entity P&L with variance vs
 * budget / forecast / prior year and auto-commentary (Task #417, Wave 5).
 */
import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import {
  useFinanceReportsPeriods, useFinanceReportsPnl,
  type PnlLines,
} from "@/lib/v5-hooks";
import {
  ReportFilterBar, useReportFilters, fmtMoney, VarianceCellChip, PreliminaryChip,
} from "./financeReportsShared";

const ROWS: Array<{ key: keyof PnlLines; label: string; bold?: boolean; negate?: boolean }> = [
  { key: "grossRevenue", label: "External revenue" },
  { key: "intercoRevenue", label: "Inter-company revenue" },
  { key: "netRevenue", label: "Net revenue", bold: true },
  { key: "directCost", label: "Direct cost", negate: true },
  { key: "intercoCost", label: "Inter-company cost", negate: true },
  { key: "grossProfit", label: "Gross profit", bold: true },
  { key: "payroll", label: "Payroll", negate: true },
  { key: "opex", label: "Opex", negate: true },
  { key: "ebitda", label: "EBITDA", bold: true },
  { key: "depreciation", label: "Depreciation & amortisation", negate: true },
  { key: "ebit", label: "EBIT", bold: true },
  { key: "interestExpense", label: "Interest expense", negate: true },
  { key: "pretaxIncome", label: "Pretax income" },
  { key: "tax", label: "Tax", negate: true },
  { key: "netIncome", label: "Net income", bold: true },
];

export default function FinanceReportsPnl() {
  const { data: periodsData } = useFinanceReportsPeriods();
  const periods = periodsData?.periods ?? [];
  const current = periodsData?.current?.id ?? null;
  const [filters, setFilters] = useReportFilters(current);
  const { data, isLoading } = useFinanceReportsPnl(filters.period || current, filters.scope, filters.entity, filters.currency);

  const headRow = data?.consolidated ?? (data?.perEntity?.[0] && {
    actual: data.perEntity[0].actual, budget: data.perEntity[0].budget,
    forecast: data.perEntity[0].forecast, priorYear: data.perEntity[0].priorYear,
  });

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-reports-pnl">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Report"
          headline="Profit & Loss"
          lede="Per-entity and consolidated P&L. Inter-company eliminations applied on consolidation; FX translation at average rate. Variance vs budget / forecast / prior year with auto-commentary."
        />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ReportFilterBar filters={filters} periods={periods.map((p) => ({ id: p.id, label: p.label }))} onChange={setFilters} />
          <PreliminaryChip preliminary={data?.preliminary} />
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        {/* Task #1069 — explain empty GL instead of showing silent zeros. */}
        {data?.glJournals && data.glJournals.missingPeriods.length > 0 && (
          <Card className="p-4 border-amber-500/40 bg-amber-500/5" data-testid="pnl-missing-journals-notice">
            <div className="text-sm text-amber-300 font-semibold">
              No journals posted for {data.glJournals.missingPeriods.join(", ")}
            </div>
            <p className="text-sm text-text-mute mt-1">
              Entity P&amp;L figures come only from the posted general ledger, so{" "}
              {data.glJournals.anyJournalsInScope
                ? "these months contribute zero to this report"
                : "this report shows zeros"}{" "}
              until journals are posted.{" "}
              <Link href="/finance/ledger" className="text-gold underline">
                Run the Bookkeeper in Finance → Ledger
              </Link>{" "}
              to post them.
            </p>
            {data.glJournals.unpostedActivity &&
              (data.glJournals.unpostedActivity.revenueUsd !== 0 ||
                data.glJournals.unpostedActivity.costUsd !== 0) && (
                <p className="text-sm text-text mt-2" data-testid="pnl-unposted-hint">
                  Not yet posted: USD {data.glJournals.unpostedActivity.revenueUsd.toLocaleString()} revenue ·
                  USD {data.glJournals.unpostedActivity.costUsd.toLocaleString()} costs of approved activity
                  (net USD {data.glJournals.unpostedActivity.netUsd.toLocaleString()}). Posted GL remains the
                  accounting source of truth.
                </p>
              )}
          </Card>
        )}
        {(data?.pendingApprovalUsd ?? 0) > 0 && (
          <Card className="p-4 border-border" data-testid="pnl-pending-approval-line">
            <p className="text-sm text-text-mute">
              <MonoChip tone="gold">awaiting approval</MonoChip>{" "}
              USD {(data?.pendingApprovalUsd ?? 0).toLocaleString()} of submitted expenses are awaiting
              approval and are <span className="text-text">not included</span> in this P&amp;L.{" "}
              <Link href="/wallet" className="text-gold underline">Review in Wallet → Expenses</Link>.
            </p>
          </Card>
        )}
        {data?.commentary && data.commentary.length > 0 && (
          <Card className="p-4">
            <div className="text-xs font-mono uppercase tracking-widest text-text-faint mb-2">Auto commentary</div>
            <ul className="space-y-1 text-sm text-text">
              {data.commentary.map((c, i) => <li key={i}>· {c}</li>)}
            </ul>
          </Card>
        )}

        {isLoading && <div className="text-sm text-text-mute">Loading…</div>}

        {headRow && (
          <Card className="p-4 overflow-x-auto" data-testid="pnl-main-table">
            <div className="flex items-center justify-between mb-3">
              <SectionHead headline={data?.entity ? "Entity P&L" : "Consolidated P&L"} />
              {data?.eliminations && (
                <MonoChip tone="amber">IC eliminations: {fmtMoney(data.eliminations.intercoRevenueGbp, filters.currency)}</MonoChip>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                <tr className="border-b border-border-soft">
                  <th className="text-left py-2">Line</th>
                  <th className="text-right py-2">Actual</th>
                  <th className="text-right py-2">Budget</th>
                  <th className="text-right py-2">vs Bgt</th>
                  <th className="text-right py-2">Forecast</th>
                  <th className="text-right py-2">vs Fcst</th>
                  <th className="text-right py-2">Prior year</th>
                  <th className="text-right py-2">YoY</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const a = headRow.actual[r.key]; const b = headRow.budget[r.key];
                  const f = headRow.forecast[r.key]; const py = headRow.priorYear[r.key];
                  const sign = r.negate ? -1 : 1;
                  const vBgt = b ? (a - b) / Math.abs(b) : 0;
                  const vFcst = f ? (a - f) / Math.abs(f) : 0;
                  const vPy = py ? (a - py) / Math.abs(py) : 0;
                  return (
                    <tr key={r.key} className={`border-b border-border-soft/40 ${r.bold ? "font-semibold bg-bg-soft/30" : ""}`}>
                      <td className="py-1.5">{r.label}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtMoney(sign * a, filters.currency)}</td>
                      <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtMoney(sign * b, filters.currency)}</td>
                      <td className="py-1.5 text-right"><VarianceCellChip pct={sign * vBgt} /></td>
                      <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtMoney(sign * f, filters.currency)}</td>
                      <td className="py-1.5 text-right"><VarianceCellChip pct={sign * vFcst} /></td>
                      <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtMoney(sign * py, filters.currency)}</td>
                      <td className="py-1.5 text-right"><VarianceCellChip pct={sign * vPy} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {data?.perEntity && data.perEntity.length > 1 && !data.entity && (
          <Card className="p-4 overflow-x-auto" data-testid="pnl-per-entity-table">
            <SectionHead headline="By entity (presentation currency)" />
            <table className="w-full text-sm mt-3">
              <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                <tr className="border-b border-border-soft">
                  <th className="text-left py-2">Entity</th>
                  <th className="text-right py-2">Net revenue</th>
                  <th className="text-right py-2">Gross profit</th>
                  <th className="text-right py-2">EBITDA</th>
                  <th className="text-right py-2">Net income</th>
                  <th className="text-right py-2">Local ccy</th>
                </tr>
              </thead>
              <tbody>
                {data.perEntity.map((e) => (
                  <tr key={e.entityId} className="border-b border-border-soft/40">
                    <td className="py-1.5">
                      {e.entityName}
                      {data.glJournals?.entitiesWithoutJournals.includes(e.entityId) ? (
                        <MonoChip tone="amber" className="ml-2">no journals posted</MonoChip>
                      ) : (data.glJournals?.missingByEntity?.[e.entityId]?.length ?? 0) > 0 ? (
                        <MonoChip tone="amber" className="ml-2">
                          no journals: {data.glJournals!.missingByEntity[e.entityId].join(", ")}
                        </MonoChip>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.actual.netRevenue, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.actual.grossProfit, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.actual.ebitda, filters.currency)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtMoney(e.actual.netIncome, filters.currency)}</td>
                    <td className="py-1.5 text-right text-text-faint font-mono text-xs">{e.baseCurrency}</td>
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
