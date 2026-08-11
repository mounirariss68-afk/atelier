/**
 * FinanceReportsBoardPack — assembled monthly board pack with PDF
 * download and monthly-schedule management (Task #417, Wave 5).
 */
import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import {
  useFinanceReportsPeriods, useFinanceReportsBoardPack, useFinanceReportsSchedules,
  type PnlLines, type BsLines, type CfLines, type CubeRow, type PnlVariance,
} from "@/lib/v5-hooks";
import { fmtMoney, fmtPct, signedPct } from "./financeReportsShared";
import { PRESENTATION_CURRENCIES, usePresentationCurrency } from "@/lib/presentationCurrency";
import { Download } from "lucide-react";

const API_BASE = "/api/atelier";

interface PnlBlock { actual: PnlLines; budget: PnlLines; forecast: PnlLines; priorYear: PnlLines }

function PnlSection({ block, variance, currency }: { block: PnlBlock; variance?: PnlVariance; currency: string }) {
  const rows: Array<[string, number, number, number, number]> = [
    ["Net revenue", block.actual.netRevenue, block.budget.netRevenue, block.forecast.netRevenue, block.priorYear.netRevenue],
    ["Gross profit", block.actual.grossProfit, block.budget.grossProfit, block.forecast.grossProfit, block.priorYear.grossProfit],
    ["EBITDA", block.actual.ebitda, block.budget.ebitda, block.forecast.ebitda, block.priorYear.ebitda],
    ["EBIT", block.actual.ebit, block.budget.ebit, block.forecast.ebit, block.priorYear.ebit],
    ["Net income", block.actual.netIncome, block.budget.netIncome, block.forecast.netIncome, block.priorYear.netIncome],
  ];
  const varBgt: Record<string, number | undefined> = variance ? {
    "Net revenue": variance.netRevenue.vsBudgetPct,
    "Gross profit": variance.grossProfit.vsBudgetPct,
    EBITDA: variance.ebitda.vsBudgetPct,
    EBIT: variance.ebit.vsBudgetPct,
    "Net income": variance.netIncome.vsBudgetPct,
  } : {};
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
        <tr className="border-b border-border-soft">
          <th className="text-left py-2">Line</th>
          <th className="text-right py-2">Actual</th>
          <th className="text-right py-2">Budget</th>
          <th className="text-right py-2">vs Bgt</th>
          <th className="text-right py-2">Forecast</th>
          <th className="text-right py-2">PY</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b, f, py]) => (
          <tr key={label} className="border-b border-border-soft/40">
            <td className="py-1.5">{label}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtMoney(a, currency)}</td>
            <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtMoney(b, currency)}</td>
            <td className="py-1.5 text-right text-xs font-mono text-text-mute">{varBgt[label] != null ? signedPct(varBgt[label]) : "—"}</td>
            <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtMoney(f, currency)}</td>
            <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtMoney(py, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BsSection({ bs, currency }: { bs: BsLines; currency: string }) {
  const rows: Array<[string, number]> = [
    ["Cash", bs.cash], ["AR", bs.ar], ["WIP", bs.wip], ["PP&E", bs.ppe],
    ["Total assets", bs.totalAssets],
    ["AP", bs.ap], ["Accruals", bs.accruals], ["Debt", bs.debt],
    ["Total liabilities", bs.totalLiabilities],
    ["Share capital", bs.shareCapital], ["Retained earnings", bs.retainedEarnings],
    ["FCTR", bs.fctr], ["Total equity", bs.totalEquity],
  ];
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([l, v]) => (
          <tr key={l} className="border-b border-border-soft/40">
            <td className="py-1.5">{l}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtMoney(v, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CfSection({ cf, currency }: { cf: CfLines; currency: string }) {
  const rows: Array<[string, number]> = [
    ["Net income", cf.netIncome],
    ["Depreciation", cf.depreciation],
    ["Working capital change", cf.workingCapitalChange],
    ["Cash from ops", cf.cashFromOps],
    ["Capex", cf.capex],
    ["Cash from investing", cf.cashFromInvesting],
    ["Cash from financing", cf.cashFromFinancing],
    ["Net change in cash", cf.netChangeInCash],
  ];
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([l, v]) => (
          <tr key={l} className="border-b border-border-soft/40">
            <td className="py-1.5">{l}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtMoney(v, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CubeSnapshot({ rows, label, currency }: { rows: CubeRow[]; label: string; currency: string }) {
  return (
    <div>
      <div className="text-xs font-mono uppercase tracking-widest text-text-faint mb-1">{label}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.engagementId} className="border-b border-border-soft/40">
              <td className="py-1.5 truncate max-w-[260px]">{r.engagementName}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(r.revenueGbp, currency)}</td>
              <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtPct(r.grossMarginPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FinanceReportsBoardPack() {
  const { data: periodsData } = useFinanceReportsPeriods();
  const periods = periodsData?.periods ?? [];
  const current = periodsData?.current?.id ?? null;
  const [period, setPeriod] = React.useState<string>("");
  React.useEffect(() => { if (current && !period) setPeriod(current); }, [current, period]);
  const [currency, setCurrency] = usePresentationCurrency();
  const { data } = useFinanceReportsBoardPack(period || current, currency);
  const { data: schedules, refetch: refetchSchedules } = useFinanceReportsSchedules();

  const pdfUrl = `${API_BASE}/finance/reports/board-pack.pdf?period=${period || current || ""}&currency=${currency}`;

  async function toggleSchedule(id: string, enabled: boolean) {
    await fetch(`${API_BASE}/finance/reports/schedules`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    await refetchSchedules();
  }

  const sectionMap = new Map((data?.sections ?? []).map((s) => [s.id, s]));
  const exec = sectionMap.get("exec_summary");
  const pnl = sectionMap.get("pnl");
  const bs = sectionMap.get("bs");
  const cf = sectionMap.get("cf");
  const prof = sectionMap.get("profitability");
  const outlook = sectionMap.get("outlook");

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-reports-board-pack">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Report"
            headline="Board pack"
            lede="Standing monthly board pack — executive summary with auto-commentary, consolidated three-statement view in your selected presentation currency, profitability highlights and key risks. PDF export and monthly schedule available."
          />
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="bg-bg border border-border-soft rounded px-2 py-1 text-text text-sm"
              data-testid="board-pack-period"
            >
              {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="bg-bg border border-border-soft rounded px-2 py-1 text-text text-sm"
              data-testid="board-pack-currency"
            >
              {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <a href={pdfUrl} target="_blank" rel="noreferrer" data-testid="board-pack-pdf-link">
              <PillButton><Download className="w-3.5 h-3.5 inline mr-1" />Download PDF</PillButton>
            </a>
          </div>
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        {exec?.commentary && (
          <Card className="p-4" data-testid="board-pack-exec-summary">
            <SectionHead headline="Executive summary" />
            <ul className="mt-3 space-y-1 text-sm">
              {exec.commentary.map((c, i) => <li key={i}>· {c}</li>)}
            </ul>
          </Card>
        )}

        {pnl && (
          <Card className="p-4 overflow-x-auto" data-testid="board-pack-pnl">
            <div className="flex items-center justify-between mb-3">
              <SectionHead headline={pnl.title} />
              {pnl.eliminations && <MonoChip tone="amber">IC eliminations: {fmtMoney(pnl.eliminations.intercoRevenueGbp, currency)}</MonoChip>}
            </div>
            <PnlSection block={pnl.consolidated as PnlBlock} variance={pnl.variance} currency={currency} />
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {bs && (
            <Card className="p-4" data-testid="board-pack-bs">
              <SectionHead headline={bs.title} />
              <div className="mt-3"><BsSection bs={bs.consolidated as BsLines} currency={currency} /></div>
            </Card>
          )}
          {cf && (
            <Card className="p-4" data-testid="board-pack-cf">
              <SectionHead headline={cf.title} />
              <div className="mt-3"><CfSection cf={cf.consolidated as CfLines} currency={currency} /></div>
            </Card>
          )}
        </div>

        {prof && (
          <Card className="p-4" data-testid="board-pack-profitability">
            <SectionHead headline={prof.title} />
            <div className="grid md:grid-cols-2 gap-6 mt-3">
              <CubeSnapshot rows={prof.topRevenue ?? []} label="Top 5 by revenue" currency={currency} />
              <CubeSnapshot rows={prof.bottomMargin ?? []} label="Bottom 5 by GM %" currency={currency} />
            </div>
          </Card>
        )}

        {outlook?.risks && (
          <Card className="p-4" data-testid="board-pack-outlook">
            <SectionHead headline={outlook.title} />
            <ul className="mt-3 space-y-1 text-sm">
              {outlook.risks.map((r, i) => <li key={i}>· {r}</li>)}
            </ul>
          </Card>
        )}

        <Card className="p-4" data-testid="board-pack-schedules">
          <SectionHead headline="Monthly delivery schedule" />
          <table className="w-full text-sm mt-3">
            <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
              <tr className="border-b border-border-soft">
                <th className="text-left py-2">Schedule</th>
                <th className="text-left py-2">Cron</th>
                <th className="text-left py-2">Next run</th>
                <th className="text-left py-2">Recipients</th>
                <th className="text-right py-2">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {(schedules?.items ?? []).map((s) => (
                <tr key={s.id} className="border-b border-border-soft/40">
                  <td className="py-1.5">{s.name}</td>
                  <td className="py-1.5 text-text-mute font-mono text-xs">{s.cron}</td>
                  <td className="py-1.5 text-text-mute">{s.nextRunOn}</td>
                  <td className="py-1.5 text-text-mute text-xs">{s.recipients.join(", ")}</td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => toggleSchedule(s.id, !s.enabled)}
                      data-testid={`schedule-toggle-${s.id}`}
                      className={`px-2 py-1 rounded text-xs font-mono uppercase tracking-widest border ${s.enabled ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-border-soft text-text-mute"}`}
                    >{s.enabled ? "On" : "Off"}</button>
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
