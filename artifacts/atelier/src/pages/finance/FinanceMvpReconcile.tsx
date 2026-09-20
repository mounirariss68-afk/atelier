/**
 * FinanceMvpReconcile — /finance/reconcile
 *
 * Guided hub into existing bank statement import, match review,
 * exceptions, approval, and period completion.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, MonoChip, BackLink } from "@/components/ui/primitives";
import { ArrowRight, Upload, Search, AlertTriangle, CheckCircle2, Lock, Info } from "lucide-react";

const API_BASE = "/api/atelier";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface ReconPeriod {
  id: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  variance: number;
  reconSummary?: {
    txnCount: number;
    matchedCount: number;
    unmatchedCount: number;
    openExceptions: number;
  };
}

interface ReconOverview {
  periods: ReconPeriod[];
  totalUnmatched: number;
  hasOpenExceptions: boolean;
  latestStatus: string | null;
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------

function useReconOverview() {
  return useQuery<ReconOverview>({
    queryKey: ["mvp-recon-overview"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/wallet/bank/recon`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = await res.json();
      const periods: ReconPeriod[] = j.data?.rows ?? [];
      const totalUnmatched = periods.reduce(
        (s, p) => s + (p.reconSummary?.unmatchedCount ?? 0),
        0,
      );
      const hasOpenExceptions = periods.some((p) => (p.reconSummary?.openExceptions ?? 0) > 0);
      const latest = periods.find((p) => p.status !== "finalised") ?? periods[0] ?? null;
      return {
        periods,
        totalUnmatched,
        hasOpenExceptions,
        latestStatus: latest?.status ?? null,
      };
    },
    staleTime: 30_000,
    retry: false,
  });
}

// -----------------------------------------------------------------------
// Step card
// -----------------------------------------------------------------------

function StepCard({
  step,
  icon: Icon,
  title,
  description,
  href,
  hrefLabel,
  status,
  statusTone,
  "data-testid": testId,
}: {
  step: number;
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  hrefLabel: string;
  status?: string;
  statusTone?: "green" | "amber" | "red" | "default";
  "data-testid"?: string;
}) {
  return (
    <Card className="p-5 flex gap-4" data-testid={testId}>
      <div className="flex flex-col items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-full border border-gold/40 flex items-center justify-center text-xs font-mono text-gold">
          {step}
        </div>
        <div className="w-px flex-1 bg-border-soft min-h-4" />
      </div>
      <div className="flex-1 space-y-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-text-faint shrink-0" />
            <div className="text-sm font-medium text-text">{title}</div>
          </div>
          {status && <MonoChip tone={statusTone ?? "default"}>{status}</MonoChip>}
        </div>
        <p className="text-xs text-text-mute leading-relaxed">{description}</p>
        <Link
          href={href}
          className="text-xs text-gold hover:text-gold/80 inline-flex items-center gap-1 font-mono"
          data-testid={`${testId}-link`}
        >
          {hrefLabel} <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------
// Period status card
// -----------------------------------------------------------------------

function PeriodCard({ period }: { period: ReconPeriod }) {
  const s = period.reconSummary;
  const tone =
    period.status === "finalised"
      ? "green"
      : (s?.openExceptions ?? 0) > 0
      ? "red"
      : "amber";
  const label =
    period.status === "finalised"
      ? "Finalised"
      : (s?.openExceptions ?? 0) > 0
      ? "Has exceptions"
      : "In progress";

  return (
    <div
      className="flex items-center justify-between gap-4 py-3 border-b border-border-soft last:border-b-0"
      data-testid={`recon-period-${period.id}`}
    >
      <div>
        <div className="text-sm text-text">{period.periodLabel}</div>
        <div className="text-xs text-text-mute font-mono mt-0.5">
          {period.periodStart} — {period.periodEnd}
        </div>
        {s && (
          <div className="text-xs text-text-faint mt-0.5">
            {s.matchedCount} matched · {s.unmatchedCount} unmatched
            {s.openExceptions > 0 && (
              <span className="text-danger ml-2">{s.openExceptions} open exception{s.openExceptions !== 1 ? "s" : ""}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {Math.abs(period.variance) > 0.01 && (
          <MonoChip tone="red">variance {period.variance.toFixed(2)}</MonoChip>
        )}
        <MonoChip tone={tone}>{label}</MonoChip>
        <Link
          href="/wallet/cash/recon"
          className="text-xs text-gold hover:text-gold/80 inline-flex items-center gap-1 font-mono"
        >
          Review <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------

export default function FinanceMvpReconcile() {
  const { data: overview, isLoading, isError } = useReconOverview();

  const noPeriods = !isLoading && !isError && (overview?.periods.length ?? 0) === 0;

  return (
    <div className="animate-in fade-in" data-testid="page-mvp-reconcile">
      <PageHero>
        <BackLink href="/finance">Finance overview</BackLink>
        <SectionHead
          eyebrow="Finance · Reconcile"
          headline="Bank reconciliation"
          lede="Match your bank statement to what is recorded in the system. Reconciling monthly keeps your cash balance accurate and makes period-end reporting straightforward."
        />
      </PageHero>

      <div className="container-atelier py-8 space-y-8">

        {/* Status overview */}
        {!isLoading && !isError && overview && overview.periods.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="recon-summary-strip">
            <Card className="p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Periods</div>
              <div className="text-2xl font-light text-text mt-1">{overview.periods.length}</div>
              <div className="text-xs text-text-mute mt-0.5">All time</div>
            </Card>
            <Card className="p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Open exceptions</div>
              <div className={`text-2xl font-light mt-1 ${overview.hasOpenExceptions ? "text-danger" : "text-text"}`}>
                {overview.periods.reduce((s, p) => s + (p.reconSummary?.openExceptions ?? 0), 0)}
              </div>
              <div className="text-xs text-text-mute mt-0.5">Need resolution</div>
            </Card>
            <Card className="p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Unmatched</div>
              <div className={`text-2xl font-light mt-1 ${overview.totalUnmatched > 0 ? "text-warn" : "text-text"}`}>
                {overview.totalUnmatched}
              </div>
              <div className="text-xs text-text-mute mt-0.5">Transactions</div>
            </Card>
            <Card className="p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Latest period</div>
              <div className="text-2xl font-light text-text mt-1">
                {overview.latestStatus === "finalised" ? (
                  <CheckCircle2 className="w-6 h-6 text-success inline" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-warn inline" />
                )}
              </div>
              <div className="text-xs text-text-mute mt-0.5">
                {overview.latestStatus ?? "No periods"}
              </div>
            </Card>
          </div>
        )}

        {/* Guided steps */}
        <div className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">How to reconcile — step by step</div>

          <div className="space-y-1">
            <StepCard
              step={1}
              icon={Upload}
              title="Import a bank statement"
              description="Download the statement for the period from your bank (CSV or OFX), then import it here. The system reads each transaction and attempts to match it to recorded expenses, invoices, and transfers."
              href="/wallet/cash"
              hrefLabel="Go to Cash and import"
              data-testid="recon-step-import"
            />
            <StepCard
              step={2}
              icon={Search}
              title="Review matches and exceptions"
              description="Most transactions will match automatically. Exceptions are transactions where no match was found, or where the amounts differ. Review each one and classify it — bank fee, internal transfer, or a missing record."
              href="/wallet/cash/recon"
              hrefLabel="Open reconciliation workspace"
              status={
                overview && overview.hasOpenExceptions
                  ? `${overview.periods.reduce((s, p) => s + (p.reconSummary?.openExceptions ?? 0), 0)} open`
                  : undefined
              }
              statusTone="red"
              data-testid="recon-step-review"
            />
            <StepCard
              step={3}
              icon={CheckCircle2}
              title="Approve the period"
              description="Once all exceptions are resolved or acknowledged, a founding partner finalises the period. This locks the cash ledger for that period — no further changes can be made without reopening it."
              href="/wallet/cash/recon"
              hrefLabel="Finalise a period"
              data-testid="recon-step-approve"
            />
            <StepCard
              step={4}
              icon={Lock}
              title="Period complete"
              description="A finalised period feeds the cash balance into reports and the financial overview. The cash figure in the overview only reflects finalised or imported data — never a guess."
              href="/finance"
              hrefLabel="Back to overview"
              data-testid="recon-step-complete"
            />
          </div>
        </div>

        {/* No periods state */}
        {noPeriods && (
          <Card className="p-8 border-dashed border-border-soft text-center" data-testid="recon-no-periods">
            <div className="max-w-sm mx-auto space-y-3">
              <Upload className="w-8 h-8 text-text-faint mx-auto" />
              <div className="text-sm font-medium text-text">No reconciliation periods yet</div>
              <p className="text-xs text-text-mute leading-relaxed">
                Start by opening a reconciliation period for your first bank statement month, then
                import the statement from your bank.
              </p>
              <Link
                href="/wallet/cash/recon"
                className="pill-btn pill-btn-primary text-xs inline-flex"
                data-testid="link-open-first-period"
              >
                Open first period
              </Link>
            </div>
          </Card>
        )}

        {/* Period list */}
        {!isLoading && !isError && overview && overview.periods.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Reconciliation periods</div>
              <Link
                href="/wallet/cash/recon"
                className="text-xs text-gold hover:text-gold/80 inline-flex items-center gap-1 font-mono"
              >
                Open workspace <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <Card className="px-4" data-testid="recon-period-list">
              {overview.periods.slice(0, 6).map((p) => (
                <PeriodCard key={p.id} period={p} />
              ))}
              {overview.periods.length > 6 && (
                <div className="py-3 text-xs text-text-mute">
                  {overview.periods.length - 6} earlier periods not shown.{" "}
                  <Link href="/wallet/cash/recon" className="text-gold hover:text-gold/80">
                    View all
                  </Link>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <Card className="p-4 border-border-soft" data-testid="recon-error">
            <div className="flex items-center gap-3 text-sm text-text-mute">
              <Info className="w-4 h-4 text-text-faint shrink-0" />
              Could not load reconciliation data. You can still access the full workspace below.
            </div>
            <Link href="/wallet/cash/recon" className="mt-3 pill-btn pill-btn-ghost text-xs inline-flex">
              Open reconciliation workspace
            </Link>
          </Card>
        )}

        {/* Quick link to full workspace */}
        <Card className="p-4 flex items-center justify-between gap-4" data-testid="recon-workspace-link">
          <div>
            <div className="text-sm font-medium text-text">Full reconciliation workspace</div>
            <div className="text-xs text-text-mute mt-1">
              Open reconciliation periods, work the exceptions one by one, apply candidate matches, and finalise.
            </div>
          </div>
          <Link
            href="/wallet/cash/recon"
            className="pill-btn pill-btn-ghost text-xs shrink-0"
            data-testid="link-full-workspace"
          >
            Open <ArrowRight className="w-3 h-3" />
          </Link>
        </Card>
      </div>
    </div>
  );
}
