/**
 * FinanceMvpReports — /finance/reports
 *
 * Understandable monthly/quarterly/yearly performance view using the
 * actual-only summary contract. Entity/overall views, project/client
 * gross margin, source-level download links, multi-currency warnings.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useLegalEntities } from "@/lib/v5-hooks";
import { PageHero, SectionHead, Card, MonoChip, BackLink } from "@/components/ui/primitives";
import { ArrowRight, Download, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";

const API_BASE = "/api/atelier";

// -----------------------------------------------------------------------
// Types (reuse from overview contract)
// -----------------------------------------------------------------------

interface BucketAmount { currency: string; amount: number }
interface DisplayAmount { currency: string; amount: number; source?: string }
interface SummaryLine { buckets: BucketAmount[]; display?: DisplayAmount }
interface ProjectMarginRow {
  projectId: string; projectName: string;
  clientId: string; clientName: string;
  revenue: SummaryLine; directCosts: SummaryLine;
  grossMargin: SummaryLine; grossMarginPct: number | null;
}
interface ReconInfo {
  bankTransactions: number; matchedTransactions: number;
  unmatchedTransactions: number; completenessPct: number;
}
interface MvpSummary {
  contractVersion: string;
  period: { dimension: string; from: string; to: string };
  scope: { kind: string; entityId?: string };
  actualOnly: boolean;
  revenue: SummaryLine;
  directCosts: SummaryLine;
  operatingExpenses: SummaryLine;
  netResult: SummaryLine;
  cash: SummaryLine;
  openLiabilities: SummaryLine;
  projectClientGrossMargin: ProjectMarginRow[];
  reconciliation: ReconInfo;
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------

type Dimension = "month" | "quarter" | "year";

function buildPeriod(dim: Dimension): string {
  const now = new Date();
  if (dim === "month") return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (dim === "quarter") return `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
  return String(now.getFullYear());
}

function useMvpSummary(dim: Dimension, entityId: string | null) {
  const period = buildPeriod(dim);
  return useQuery<MvpSummary>({
    queryKey: ["mvp-summary-reports", dim, period, entityId ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams({ dimension: dim, period });
      if (entityId) params.set("entityId", entityId);
      params.set("displayCurrency", "USD");
      const res = await fetch(`${API_BASE}/finance/mvp/summary?${params}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json() as Promise<MvpSummary>;
    },
    staleTime: 30_000,
    retry: false,
  });
}

function recentPeriods(dim: Dimension): string[] {
  const now = new Date();
  if (dim === "year") {
    return Array.from({ length: 3 }, (_, index) => String(now.getFullYear() - 2 + index));
  }
  if (dim === "quarter") {
    const current = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);
    return Array.from({ length: 6 }, (_, index) => {
      const value = current - 5 + index;
      return `${Math.floor(value / 4)}-Q${(value % 4) + 1}`;
    });
  }
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function useMvpTrend(dim: Dimension, entityId: string | null) {
  const periods = recentPeriods(dim);
  return useQuery<Array<{ period: string; summary: MvpSummary }>>({
    queryKey: ["mvp-summary-trend", dim, entityId ?? "all", periods.join(",")],
    queryFn: async () => Promise.all(periods.map(async (period) => {
      const params = new URLSearchParams({ dimension: dim, period });
      if (entityId) params.set("entityId", entityId);
      const res = await fetch(`${API_BASE}/finance/mvp/summary?${params}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Finance trend request failed (${res.status})`);
      return { period, summary: await res.json() as MvpSummary };
    })),
    staleTime: 30_000,
    retry: false,
  });
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function fmtMoney(line: SummaryLine | undefined): string {
  if (!line) return "—";
  if (line.display) {
    const { currency, amount } = line.display;
    return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (!line.buckets.length) return "—";
  const first = line.buckets[0];
  return `${first.currency} ${first.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function isMultiCurrency(line: SummaryLine | undefined): boolean {
  return (line?.buckets?.length ?? 0) > 1;
}

function getAmount(line: SummaryLine | undefined): number | null {
  if (!line) return null;
  if (line.display?.amount != null) return line.display.amount;
  if (line.buckets.length) return line.buckets[0].amount;
  return null;
}

// -----------------------------------------------------------------------
// P&L summary
// -----------------------------------------------------------------------

function PnlRow({
  label,
  line,
  bold,
  indent,
  tonePositive,
}: {
  label: string;
  line: SummaryLine | undefined;
  bold?: boolean;
  indent?: boolean;
  tonePositive?: boolean;
}) {
  const val = getAmount(line);
  const multi = isMultiCurrency(line);
  const tone =
    tonePositive != null && val != null
      ? val > 0
        ? tonePositive
          ? "text-success"
          : "text-danger"
        : val < 0
        ? tonePositive
          ? "text-danger"
          : "text-success"
        : "text-text"
      : "text-text";

  return (
    <div
      className={`flex items-center justify-between py-2 border-b border-border-soft/50 last:border-b-0 ${indent ? "pl-4" : ""}`}
    >
      <div className={`text-sm ${bold ? "font-medium text-text" : "text-text-mute"}`}>{label}</div>
      <div className="flex items-center gap-2">
        {multi && <MonoChip tone="amber" className="text-[9px]">multi-ccy</MonoChip>}
        <div className={`text-sm font-mono ${bold ? "font-medium" : ""} ${tone}`}>
          {fmtMoney(line)}
        </div>
      </div>
    </div>
  );
}

function PnlCard({ summary }: { summary: MvpSummary }) {
  const rev = getAmount(summary.revenue);
  const dc = getAmount(summary.directCosts);
  const gm = rev != null && dc != null ? rev - dc : null;
  const opex = getAmount(summary.operatingExpenses);
  const net = getAmount(summary.netResult);
  const gmPct = rev && rev > 0 && gm != null ? (gm / rev) * 100 : null;

  const currency = summary.revenue.display?.currency ?? summary.revenue.buckets[0]?.currency ?? "USD";
  const gmLine: SummaryLine | undefined = gm != null ? { buckets: [{ currency, amount: gm }], display: { currency, amount: gm } } : undefined;

  return (
    <Card className="p-5 space-y-1" data-testid="reports-pnl-card">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
          Performance summary · {summary.period.dimension} · {summary.period.from}
          {summary.actualOnly && <span className="ml-2 text-text-faint">actuals only</span>}
        </div>
        <Link href="/finance/reports/pnl" className="text-[10px] font-mono text-gold hover:text-gold/80 inline-flex items-center gap-1">
          Full P&L <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <PnlRow label="Revenue" line={summary.revenue} bold />
      <PnlRow label="Direct costs" line={summary.directCosts} indent tonePositive={false} />
      {gmLine && (
        <PnlRow
          label={`Gross margin${gmPct != null ? ` (${gmPct.toFixed(1)}%)` : ""}`}
          line={gmLine}
          bold
          tonePositive
        />
      )}
      <PnlRow label="Operating expenses" line={summary.operatingExpenses} indent tonePositive={false} />
      <PnlRow label="Net result" line={summary.netResult} bold tonePositive />
    </Card>
  );
}

// -----------------------------------------------------------------------
// Trend arrow
// -----------------------------------------------------------------------

function TrendIcon({ val }: { val: number | null }) {
  if (val == null) return <Minus className="w-3 h-3 text-text-faint" />;
  if (val > 0) return <TrendingUp className="w-3 h-3 text-success" />;
  if (val < 0) return <TrendingDown className="w-3 h-3 text-danger" />;
  return <Minus className="w-3 h-3 text-text-faint" />;
}

// -----------------------------------------------------------------------
// Margin table
// -----------------------------------------------------------------------

function MarginTable({ rows }: { rows: ProjectMarginRow[] }) {
  if (!rows.length) {
    return (
      <Card className="p-6 text-center border-border-soft" data-testid="reports-margin-empty">
        <div className="text-sm text-text-mute">No project or client margin data for this period.</div>
        <div className="text-xs text-text-faint mt-1">
          Margin data appears once engagement costs and revenue are recorded.
        </div>
        <Link href="/finance/reports/margin" className="mt-3 text-xs text-gold hover:text-gold/80 inline-flex items-center gap-1">
          Margin report <ArrowRight className="w-3 h-3" />
        </Link>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden" data-testid="reports-margin-table">
      <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Project / client gross margin</div>
        <Link href="/finance/reports/margin" className="text-[10px] font-mono text-gold hover:text-gold/80 inline-flex items-center gap-1">
          Full margin report <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] font-mono uppercase text-text-faint">
            <tr className="border-b border-border-soft">
              <th className="text-left px-4 py-2">Project</th>
              <th className="text-left px-4 py-2">Client</th>
              <th className="text-right px-4 py-2">Revenue</th>
              <th className="text-right px-4 py-2">Direct costs</th>
              <th className="text-right px-4 py-2">Gross margin</th>
              <th className="text-right px-4 py-2">Margin %</th>
              <th className="text-center px-4 py-2">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.projectId} className="border-b border-border-soft/60 hover:bg-bg-elevate/30">
                <td className="px-4 py-2 text-text">{r.projectName}</td>
                <td className="px-4 py-2 text-text-mute">{r.clientName}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {fmtMoney(r.revenue)}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {fmtMoney(r.directCosts)}
                </td>
                <td className={`px-4 py-2 text-right font-mono ${(r.grossMargin.display?.amount ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                  {fmtMoney(r.grossMargin)}
                </td>
                <td className={`px-4 py-2 text-right font-mono ${(r.grossMarginPct ?? 0) >= 30 ? "text-success" : (r.grossMarginPct ?? 0) >= 10 ? "text-warn" : "text-danger"}`}>
                  {r.grossMarginPct == null ? "—" : `${r.grossMarginPct.toFixed(1)}%`}
                </td>
                <td className="px-4 py-2 text-center">
                  <TrendIcon val={r.grossMargin.display?.amount ?? 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TrendTable({ rows }: { rows: Array<{ period: string; summary: MvpSummary }> }) {
  return (
    <Card className="overflow-hidden" data-testid="reports-trend-table">
      <div className="px-4 py-3 border-b border-border-soft">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Recent performance trend</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] font-mono uppercase text-text-faint">
            <tr className="border-b border-border-soft">
              <th className="text-left px-4 py-2">Period</th>
              <th className="text-right px-4 py-2">Revenue</th>
              <th className="text-right px-4 py-2">Expenses</th>
              <th className="text-right px-4 py-2">Net result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ period, summary }) => (
              <tr key={period} className="border-b border-border-soft/60 last:border-0">
                <td className="px-4 py-2 text-text font-mono">{period}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(summary.revenue)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(summary.operatingExpenses)}</td>
                <td className={`px-4 py-2 text-right font-mono ${(getAmount(summary.netResult) ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                  {fmtMoney(summary.netResult)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Download links
// -----------------------------------------------------------------------

function DownloadLinks({ summary }: { summary: MvpSummary }) {
  const sources = [
    summary.cash.display?.source,
    summary.revenue.display?.source,
    summary.operatingExpenses.display?.source,
    summary.netResult.display?.source,
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  return (
    <Card className="p-4 space-y-3" data-testid="reports-download-links">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Download / export</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Link
          href="/finance/reports/pnl"
          className="flex items-center gap-2 text-xs text-text-mute hover:text-gold transition-colors"
          data-testid="link-download-pnl"
        >
          <Download className="w-3.5 h-3.5" /> P&L report
        </Link>
        <Link
          href="/finance/reports/margin"
          className="flex items-center gap-2 text-xs text-text-mute hover:text-gold transition-colors"
          data-testid="link-download-margin"
        >
          <Download className="w-3.5 h-3.5" /> Margin report
        </Link>
        <Link href="/wallet/expenses" className="flex items-center gap-2 text-xs text-text-mute hover:text-gold transition-colors">
          <Download className="w-3.5 h-3.5" /> Expense source records
        </Link>
        <Link href="/wallet/invoices" className="flex items-center gap-2 text-xs text-text-mute hover:text-gold transition-colors">
          <Download className="w-3.5 h-3.5" /> Invoice source records
        </Link>
      </div>
      {sources.length > 0 && (
        <div className="pt-2 border-t border-border-soft">
          <div className="text-[10px] font-mono text-text-faint uppercase tracking-widest mb-1">Data sources</div>
          {sources.map((s) => (
            <div key={s} className="text-[11px] text-text-faint font-mono">{s}</div>
          ))}
        </div>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------

function FilterBar({
  dim,
  setDim,
  entityId,
  setEntityId,
}: {
  dim: Dimension;
  setDim: (d: Dimension) => void;
  entityId: string | null;
  setEntityId: (id: string | null) => void;
}) {
  const { entities } = useLegalEntities();
  const dims: Dimension[] = ["month", "quarter", "year"];

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="reports-filter-bar">
      <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
        {dims.map((d) => (
          <button
            key={d}
            onClick={() => setDim(d)}
            className={`px-3 py-1 rounded-full text-xs font-mono capitalize transition-colors ${
              dim === d ? "bg-gold text-bg-deep" : "text-text-mute hover:text-text"
            }`}
            data-testid={`reports-filter-dim-${d}`}
          >
            {d}
          </button>
        ))}
      </div>
      <select
        className="h-8 rounded-full border border-border bg-bg-elevate px-3 text-xs font-mono text-text"
        value={entityId ?? ""}
        onChange={(e) => setEntityId(e.target.value || null)}
        data-testid="reports-filter-entity"
      >
        <option value="">All entities (consolidated)</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.shortName || e.legalNameEn}
          </option>
        ))}
      </select>
    </div>
  );
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default function FinanceMvpReports() {
  const [dim, setDim] = React.useState<Dimension>("month");
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const { data: summary, isLoading, isError, error } = useMvpSummary(dim, entityId);
  const { data: trend } = useMvpTrend(dim, entityId);

  const hasMultiCurrency =
    summary &&
    (isMultiCurrency(summary.cash) ||
      isMultiCurrency(summary.revenue) ||
      isMultiCurrency(summary.netResult));

  return (
    <div className="animate-in fade-in" data-testid="page-mvp-reports">
      <PageHero>
        <BackLink href="/finance">Finance overview</BackLink>
        <SectionHead
          eyebrow="Finance · Reports"
          headline="Performance reports"
          lede="Actual figures only. Monthly, quarterly, and yearly views by entity or consolidated. No budget or forecast data until your first period is complete."
        />
        <div className="mt-6">
          <FilterBar dim={dim} setDim={setDim} entityId={entityId} setEntityId={setEntityId} />
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-6">

        {/* Multi-currency warning */}
        {hasMultiCurrency && (
          <Card className="p-4 border-warn/30" data-testid="reports-multiccy-warning">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
              <div className="text-sm text-text-mute">
                <span className="text-warn font-medium">Multiple currencies in use.</span>{" "}
                Figures are shown in each entity's local currency with no conversion applied.
                For a single-currency consolidated view, use the full P&L report and select a presentation currency.
              </div>
            </div>
          </Card>
        )}

        {isLoading && (
          <div className="space-y-4">
            <Card className="h-64 animate-pulse bg-bg-elevate/50" />
            <Card className="h-40 animate-pulse bg-bg-elevate/50" />
          </div>
        )}

        {isError && (
          <Card className="p-6 border-border-soft" data-testid="reports-error">
            <div className="flex items-center gap-3 text-sm text-text-mute">
              <AlertTriangle className="w-4 h-4 text-text-faint shrink-0" />
              <span>
                Summary data is not yet available.{" "}
                {error instanceof Error ? error.message : ""}
              </span>
            </div>
            <div className="text-xs text-text-faint mt-2">
              You can still access the full report pages below.
            </div>
          </Card>
        )}

        {summary && (
          <>
            {/* P&L summary */}
            <PnlCard summary={summary} />
            {trend && <TrendTable rows={trend} />}

            {/* Two-column: margin table + downloads */}
            <div className="grid lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <MarginTable rows={summary.projectClientGrossMargin} />
              </div>
              <DownloadLinks summary={summary} />
            </div>
          </>
        )}

        {/* Always available: links to full reports */}
        <div className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">All reports</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: "Income and spending detail", sub: "Revenue, costs, and net result with downloadable detail", href: "/finance/reports/pnl" },
              { label: "Project and client margin", sub: "Gross margin by project and client with source detail", href: "/finance/reports/margin" },
              { label: "Expense records", sub: "Receipts and claims behind spending totals", href: "/wallet/expenses" },
              { label: "Invoice records", sub: "Customer invoices and receipts behind revenue totals", href: "/wallet/invoices" },
            ].map((r) => (
              <Card key={r.href} className="p-4 card-hover" data-testid={`reports-link-${r.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <Link href={r.href} className="block space-y-1">
                  <div className="text-sm font-medium text-text">{r.label}</div>
                  <div className="text-xs text-text-mute">{r.sub}</div>
                  <div className="text-[10px] font-mono text-gold mt-2 inline-flex items-center gap-1">
                    Open <ArrowRight className="w-2.5 h-2.5" />
                  </div>
                </Link>
              </Card>
            ))}
          </div>
        </div>

        {/* Actuals-only note */}
        <div className="text-xs text-text-faint font-mono border-t border-border-soft pt-4" data-testid="reports-actuals-note">
          All figures are actuals only and tie back to recorded source transactions.
        </div>
      </div>
    </div>
  );
}
