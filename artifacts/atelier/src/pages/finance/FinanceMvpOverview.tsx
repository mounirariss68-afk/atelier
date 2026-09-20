/**
 * FinanceMvpOverview — /finance
 *
 * Founder-facing actual-only overview. Replaces dense CFO surfaces with
 * approachable, action-oriented finance health for pre-revenue stage.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useLegalEntities } from "@/lib/v5-hooks";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { ArrowRight, AlertTriangle, CheckCircle2, Clock, TrendingDown } from "lucide-react";

const API_BASE = "/api/atelier";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface BucketAmount {
  currency: string;
  amount: number;
}
interface DisplayAmount {
  currency: string;
  amount: number;
  source?: string;
}
interface SummaryLine {
  buckets: BucketAmount[];
  display?: DisplayAmount;
}
interface ProjectMarginRow {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  revenue: SummaryLine;
  directCosts: SummaryLine;
  grossMargin: SummaryLine;
  grossMarginPct: number | null;
}
interface ReconInfo {
  bankTransactions: number;
  matchedTransactions: number;
  unmatchedTransactions: number;
  completenessPct: number;
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
    queryKey: ["mvp-summary", dim, period, entityId ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams({ dimension: dim, period });
      if (entityId) params.set("entityId", entityId);
      params.set("displayCurrency", "USD");
      const res = await fetch(`${API_BASE}/finance/mvp/summary?${params}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Summary fetch failed: ${res.status}`);
      return res.json() as Promise<MvpSummary>;
    },
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

function netResultTone(line: SummaryLine | undefined): "green" | "amber" | "red" | "default" {
  if (!line) return "default";
  const val = line.display?.amount ?? line.buckets[0]?.amount;
  if (val == null) return "default";
  if (val > 0) return "green";
  if (val < 0) return "red";
  return "amber";
}

// -----------------------------------------------------------------------
// KPI tile
// -----------------------------------------------------------------------

function KpiTile({
  label,
  value,
  sub,
  tone = "default",
  href,
  multiCcy,
  "data-testid": testId,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red" | "default";
  href?: string;
  multiCcy?: boolean;
  "data-testid"?: string;
}) {
  const toneClass =
    tone === "green"
      ? "text-success"
      : tone === "red"
      ? "text-danger"
      : tone === "amber"
      ? "text-warn"
      : "text-text";

  const inner = (
    <div className="p-4 h-full flex flex-col gap-1" data-testid={testId}>
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">{label}</div>
      <div className={`text-2xl font-light mt-1 ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-text-mute mt-0.5">{sub}</div>}
      {multiCcy && (
        <div className="text-[10px] font-mono text-warn mt-1">Multiple currencies — see drill-through</div>
      )}
      {href && (
        <div className="mt-auto pt-2 flex items-center gap-1 text-[10px] font-mono text-text-faint hover:text-gold transition-colors">
          View detail <ArrowRight className="w-3 h-3" />
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Card className="card-hover h-full">
        <Link href={href} className="block h-full">
          {inner}
        </Link>
      </Card>
    );
  }
  return <Card className="h-full">{inner}</Card>;
}

// -----------------------------------------------------------------------
// Reconciliation status
// -----------------------------------------------------------------------

function ReconStatus({ recon }: { recon?: ReconInfo }) {
  if (!recon) {
    return (
      <Card className="p-4" data-testid="mvp-recon-status">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">Reconciliation</div>
        <div className="text-sm text-text-mute italic">No bank statement imported yet.</div>
        <Link href="/finance/reconcile" className="text-xs text-gold hover:text-gold/80 mt-2 inline-flex items-center gap-1">
          Start reconciliation <ArrowRight className="w-3 h-3" />
        </Link>
      </Card>
    );
  }
  const pct = recon.completenessPct;
  const tone = pct >= 95 ? "green" : pct >= 70 ? "amber" : "red";
  const Icon = pct >= 95 ? CheckCircle2 : AlertTriangle;
  const iconClass = pct >= 95 ? "text-success" : pct >= 70 ? "text-warn" : "text-danger";

  return (
    <Card className="p-4" data-testid="mvp-recon-status">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Reconciliation</div>
        <MonoChip tone={tone}>{pct.toFixed(0)}% matched</MonoChip>
      </div>
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClass}`} />
        <div className="text-sm text-text-mute">
          {recon.matchedTransactions} of {recon.bankTransactions} bank transactions matched.
          {recon.unmatchedTransactions > 0 && (
            <span className="text-danger ml-1">{recon.unmatchedTransactions} unmatched.</span>
          )}
        </div>
      </div>
      <Link href="/finance/reconcile" className="mt-3 text-xs text-gold hover:text-gold/80 inline-flex items-center gap-1">
        Review exceptions <ArrowRight className="w-3 h-3" />
      </Link>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Unpaid items / open liabilities
// -----------------------------------------------------------------------

function UnpaidItems({ line }: { line?: SummaryLine }) {
  const isEmpty = !line || (line.buckets.length === 0 && !line.display);
  return (
    <Card className="p-4" data-testid="mvp-unpaid-items">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Unpaid items</div>
        {!isEmpty && <MonoChip tone="amber">{fmtMoney(line)}</MonoChip>}
      </div>
      {isEmpty ? (
        <div className="text-sm text-text-mute">No open payables recorded.</div>
      ) : (
        <div className="text-sm text-text-mute">
          Outstanding bills and liabilities not yet paid.
        </div>
      )}
      <div className="mt-3 flex flex-col gap-1.5">
        <Link href="/finance/money-out" className="text-xs text-gold hover:text-gold/80 inline-flex items-center gap-1">
          Review bills <ArrowRight className="w-3 h-3" />
        </Link>
        <Link href="/finance/payables/supplier-invoices" className="text-xs text-text-mute hover:text-gold inline-flex items-center gap-1">
          Supplier invoices <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Attention links
// -----------------------------------------------------------------------

function AttentionLinks() {
  return (
    <Card className="p-4" data-testid="mvp-attention-links">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-3">Needs attention</div>
      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2 text-text-mute">
          <Clock className="w-3.5 h-3.5 text-warn shrink-0" />
          <Link href="/finance/approvals" className="hover:text-gold transition-colors">
            Review approvals
          </Link>
        </li>
        <li className="flex items-center gap-2 text-text-mute">
          <TrendingDown className="w-3.5 h-3.5 text-text-faint shrink-0" />
          <Link href="/finance/reconcile" className="hover:text-gold transition-colors">
            Import or review a bank statement
          </Link>
        </li>
        <li className="flex items-center gap-2 text-text-mute">
          <AlertTriangle className="w-3.5 h-3.5 text-text-faint shrink-0" />
          <Link href="/finance/entities" className="hover:text-gold transition-colors">
            Review entity setup
          </Link>
        </li>
      </ul>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Pre-revenue zero state
// -----------------------------------------------------------------------

function PreRevenueState() {
  return (
    <Card className="p-8 text-center border-border-soft" data-testid="mvp-pre-revenue-state">
      <div className="max-w-md mx-auto space-y-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Pre-revenue</div>
        <h3 className="text-lg text-text">No trading revenue recorded yet</h3>
        <p className="text-sm text-text-mute leading-relaxed">
          This overview will show actual revenue, margins, and cash movement once transactions are recorded.
          Right now you can track your setup costs, shareholder contributions, and bank balances.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/finance/money-in"
            className="pill-btn pill-btn-primary text-sm"
          >
            Record a contribution
          </Link>
          <Link
            href="/finance/money-out"
            className="pill-btn pill-btn-ghost text-sm"
          >
            Record an expense
          </Link>
        </div>
      </div>
    </Card>
  );
}

function PreRevenueReadiness() {
  const items = [
    ["Setup costs", "Record receipts and supplier bills now so formation costs stay visible."],
    ["Contracts", "Customer contract activity will flow into billing when trading starts."],
    ["Payroll", "No payroll figures are shown until payroll runs are posted."],
    ["Contractors", "Approved contractor invoices and reimbursements will appear under Money out."],
  ];
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" data-testid="mvp-pre-revenue-readiness">
      {items.map(([label, copy]) => (
        <Card key={label} className="p-4">
          <div className="text-xs font-medium text-text">{label}</div>
          <p className="text-xs text-text-mute mt-2 leading-relaxed">{copy}</p>
        </Card>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// Project / client gross margin table
// -----------------------------------------------------------------------

function MarginTable({ rows }: { rows: ProjectMarginRow[] }) {
  if (!rows.length) return null;
  return (
    <Card className="overflow-hidden" data-testid="mvp-margin-table">
      <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Project / client gross margin</div>
        <Link href="/finance/reports/margin" className="text-[10px] font-mono text-gold hover:text-gold/80 inline-flex items-center gap-1">
          Full report <ArrowRight className="w-3 h-3" />
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
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.projectId} className="border-b border-border-soft/60 hover:bg-bg-elevate/30">
                <td className="px-4 py-2 text-text">{r.projectName}</td>
                <td className="px-4 py-2 text-text-mute">{r.clientName}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.revenue)}</td>
                <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.directCosts)}</td>
                <td className={`px-4 py-2 text-right font-mono ${(r.grossMargin.display?.amount ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                  {fmtMoney(r.grossMargin)}
                </td>
                <td className={`px-4 py-2 text-right font-mono ${(r.grossMarginPct ?? 0) >= 30 ? "text-success" : (r.grossMarginPct ?? 0) >= 10 ? "text-warn" : "text-danger"}`}>
                  {r.grossMarginPct == null ? "—" : `${r.grossMarginPct.toFixed(1)}%`}
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
// Source drill-through
// -----------------------------------------------------------------------

function SourceLinks({ summary }: { summary: MvpSummary }) {
  const sources = [
    summary.cash.display?.source,
    summary.revenue.display?.source,
    summary.operatingExpenses.display?.source,
  ].filter(Boolean);
  if (!sources.length) return null;
  return (
    <div className="text-[11px] text-text-faint font-mono space-y-1" data-testid="mvp-source-links">
      <div className="text-[10px] uppercase tracking-widest mb-1">Data sources</div>
      {sources.map((s) => (
        <div key={s}>{s}</div>
      ))}
    </div>
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
    <div className="flex flex-wrap items-center gap-2" data-testid="mvp-filter-bar">
      <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
        {dims.map((d) => (
          <button
            key={d}
            onClick={() => setDim(d)}
            className={`px-3 py-1 rounded-full text-xs font-mono capitalize transition-colors ${
              dim === d
                ? "bg-gold text-bg-deep"
                : "text-text-mute hover:text-text"
            }`}
            data-testid={`filter-dim-${d}`}
          >
            {d}
          </button>
        ))}
      </div>

      <select
        className="h-8 rounded-full border border-border bg-bg-elevate px-3 text-xs font-mono text-text"
        value={entityId ?? ""}
        onChange={(e) => setEntityId(e.target.value || null)}
        data-testid="filter-entity"
      >
        <option value="">All entities</option>
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

export default function FinanceMvpOverview() {
  const [dim, setDim] = React.useState<Dimension>("month");
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const { data: summary, isLoading, isError, error } = useMvpSummary(dim, entityId);

  const hasRevenue =
    summary && (summary.revenue.buckets.some((b) => b.amount !== 0) || summary.revenue.display?.amount);

  return (
    <div className="animate-in fade-in" data-testid="page-mvp-overview">
      <PageHero>
        <SectionHead
          eyebrow="Finance · Overview"
          headline="Financial overview"
          lede="Actual figures only — no projections. Everything your team has recorded, clearly organised."
        />
        <div className="mt-6">
          <FilterBar dim={dim} setDim={setDim} entityId={entityId} setEntityId={setEntityId} />
        </div>
      </PageHero>

      <div className="container-atelier py-8 space-y-6">
        {/* Nav strip */}
        <div className="flex flex-wrap gap-2 text-xs font-mono" data-testid="mvp-nav-strip">
          {[
            { label: "Entities", href: "/finance/entities" },
            { label: "Money out", href: "/finance/money-out" },
            { label: "Money in", href: "/finance/money-in" },
            { label: "Reconcile", href: "/finance/reconcile" },
            { label: "Reports", href: "/finance/reports" },
          ].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="px-3 py-1.5 rounded-full border border-border text-text-mute hover:border-gold hover:text-gold transition-colors"
            >
              {n.label}
            </Link>
          ))}
        </div>

        {isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-28 animate-pulse bg-bg-elevate/50" />
            ))}
          </div>
        )}

        {isError && (
          <Card className="p-6 border-danger/30" data-testid="mvp-error">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
              <div>
                <div className="text-sm font-medium text-text">Could not load financial data</div>
                <div className="text-xs text-text-mute mt-1">
                  {error instanceof Error ? error.message : "Financial data is temporarily unavailable."}
                </div>
                <div className="text-xs text-text-faint mt-2">
                  Try again. If the problem continues, contact your workspace administrator.
                </div>
              </div>
            </div>
          </Card>
        )}

        {summary && (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="mvp-kpi-row">
              <KpiTile
                label="Cash"
                value={fmtMoney(summary.cash)}
                sub="Current balance"
                tone={
                  (summary.cash.display?.amount ?? summary.cash.buckets[0]?.amount ?? 0) > 0
                    ? "green"
                    : "red"
                }
                href="/wallet/cash"
                multiCcy={isMultiCurrency(summary.cash)}
                data-testid="kpi-cash"
              />
              <KpiTile
                label="Revenue"
                value={fmtMoney(summary.revenue)}
                sub={`Actual ${dim}`}
                tone="default"
                href="/finance/money-in"
                multiCcy={isMultiCurrency(summary.revenue)}
                data-testid="kpi-revenue"
              />
              <KpiTile
                label="Setup costs"
                value={fmtMoney(summary.directCosts)}
                sub="Direct / project"
                href="/finance/money-out"
                multiCcy={isMultiCurrency(summary.directCosts)}
                data-testid="kpi-direct-costs"
              />
              <KpiTile
                label="Operating expenses"
                value={fmtMoney(summary.operatingExpenses)}
                sub="Overheads"
                href="/finance/money-out"
                multiCcy={isMultiCurrency(summary.operatingExpenses)}
                data-testid="kpi-opex"
              />
              <KpiTile
                label="Gross margin"
                value={
                  summary.revenue.display?.amount != null && summary.directCosts.display?.amount != null
                    ? (() => {
                        const gm = summary.revenue.display.amount - summary.directCosts.display.amount;
                        const pct =
                          summary.revenue.display.amount > 0
                            ? ((gm / summary.revenue.display.amount) * 100).toFixed(1) + "%"
                            : "—";
                        return `${summary.revenue.display.currency} ${gm.toLocaleString(undefined, { maximumFractionDigits: 0 })} · ${pct}`;
                      })()
                    : "—"
                }
                tone={
                  summary.revenue.display?.amount != null && summary.directCosts.display?.amount != null
                    ? summary.revenue.display.amount - summary.directCosts.display.amount > 0
                      ? "green"
                      : "red"
                    : "default"
                }
                href="/finance/reports/margin"
                data-testid="kpi-gross-margin"
              />
              <KpiTile
                label="Net result"
                value={fmtMoney(summary.netResult)}
                sub={`${dim} net`}
                tone={netResultTone(summary.netResult)}
                href="/finance/reports"
                multiCcy={isMultiCurrency(summary.netResult)}
                data-testid="kpi-net-result"
              />
            </div>

            {/* Pre-revenue state */}
            {!hasRevenue && <PreRevenueState />}
            {!hasRevenue && <PreRevenueReadiness />}

            {/* Second row */}
            <div className="grid md:grid-cols-3 gap-4">
              <ReconStatus recon={summary.reconciliation} />
              <UnpaidItems line={summary.openLiabilities} />
              <AttentionLinks />
            </div>

            {/* Margin table */}
            {summary.projectClientGrossMargin.length > 0 && (
              <MarginTable rows={summary.projectClientGrossMargin} />
            )}

            {/* Source drill-through */}
            <SourceLinks summary={summary} />

            {/* Multi-currency warning */}
            {(isMultiCurrency(summary.cash) ||
              isMultiCurrency(summary.revenue) ||
              isMultiCurrency(summary.netResult)) && (
              <Card className="p-4 border-warn/30" data-testid="mvp-multiccy-warning">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                  <div className="text-sm text-text-mute">
                    <span className="text-warn font-medium">Multiple currencies detected.</span> Totals shown above are in each entity's local currency. No automatic conversion is applied. Set a display currency or use the Reports page for a converted view.
                  </div>
                </div>
              </Card>
            )}
          </>
        )}

        {/* Always-visible quick links */}
        {!summary && !isLoading && (
          <div className="grid sm:grid-cols-2 gap-4">
            <PreRevenueState />
            <div className="space-y-3">
              <ReconStatus recon={undefined} />
              <AttentionLinks />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
