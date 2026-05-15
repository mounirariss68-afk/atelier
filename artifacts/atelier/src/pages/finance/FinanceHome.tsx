/**
 * FinanceHome — CFO overview dashboard (Task #413).
 *
 * Replaces the previous Finance section index (Task #372). The eight-
 * section ribbon is rendered below the dashboard via
 * `FinanceSectionRibbon` so deep-link routes continue to resolve.
 *
 * Filter semantics (applied end-to-end, not just URL state)
 *   - Entity:  filters the entities array used by Close / Compliance /
 *              Inbox panels live. Firm-aggregate sources (margin / util /
 *              cash forecast) cannot yet be sliced by entity — affected
 *              tiles render a `scopeNote` chip stating the limitation
 *              (Wave 2 will plumb engagement→entity).
 *   - Period:  drives `daysInPeriod` (MTD 30, QTD 90, YTD 365, R12 365)
 *              which is used in DSO / WIP-days / lockup derivations.
 *   - As-of:   shifts the cash-forecast window (weeks earlier than as-of
 *              are dropped) and is the anchor date for the 90-day
 *              compliance calendar in Row 5.
 *   - Ccy:     "GBP" presentation, "Local" entity-local (resolved from
 *              the single selected entity), "Side-by-side" shows £ and
 *              local together.
 *
 * Wave-N placeholders
 *   Anything not currently sourced from a live portal endpoint renders
 *   as a Wave-N tile / card with identical dimensions. Synthetic
 *   sparklines and modelled numbers were intentionally removed in favour
 *   of explicit placeholders so the dashboard is trustworthy on day one.
 */

import * as React from "react";
import { Link } from "wouter";
import { useAtelierGetPipelineForecast, useAtelierListEngagements } from "@workspace/api-client-react";
import { PageHero, SectionHead, Card, MonoChip, Eyebrow } from "@/components/ui/primitives";
import { useFinanceEntities, type FinanceEntityRow } from "@/lib/v5-hooks";
import {
  CfoFilterBar,
  MetricTile,
  PanelHead,
  RagDot,
  formatMoney,
  formatPct,
  resolvePrimaryCode,
  PERIOD_DAYS,
  useCfoFilters,
  type CfoCurrency,
  type CfoFilters,
  type FilterBarSource,
} from "./cfoPrimitives";
import {
  useArAging,
  useWipLatest,
  useMarginFirm,
  useCashForecast,
  useUtilFirm,
  buildCfoInbox,
  type CashForecastWeek,
} from "./cfoData";
import { useFpaBudget, useFpaHeadcount, useFpaRenewals } from "@/lib/v5-hooks";
import FinanceSectionRibbon from "./FinanceSectionRibbon";
import {
  useExpectedDisbursements,
  useStalledApprovals,
  useStatutoryFilings,
  useInsurancePolicies,
  useInternalControls,
  useCash13w,
  useBacklogCoverage,
  type StatutoryFilingRow,
  type InsurancePolicyRow,
  type InternalControlRow,
} from "@/lib/v5-hooks";
import { useSyncExternalStore } from "react";
import { subscribeCloseStore, getCloseSnapshot, statusForEntity, type CloseStatusForEntity } from "@/data/finance-close-seed";
import { ArrowRight, Lock, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

const PLAN_RATIO = { revenue: 0.92, ebitda: 0.88 } as const;
const FIRM_SCOPE_NOTE = "firm-wide · entity slice W2";

function useCloseSnapshot() {
  return useSyncExternalStore(subscribeCloseStore, getCloseSnapshot, getCloseSnapshot);
}

function CloseStatusMiniCard({ entity, status }: { entity: FinanceEntityRow; status: CloseStatusForEntity }) {
  const period = status.period;
  if (!period) {
    return (
      <Link href={`/finance/close?entity=${entity.id}`}>
        <Card
          className="p-3 cursor-pointer hover:border-gold/40 transition-colors border-border-soft opacity-70"
          data-testid={`finance-close-mini-${entity.id}`}
        >
          <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-text-faint">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Close · {entity.shortName}</span>
            <span>—</span>
          </div>
          <div className="mt-1 text-sm text-text-mute leading-tight">No period open</div>
          <div className="text-xs text-text-faint mt-1">Open a period to begin the close workflow</div>
        </Card>
      </Link>
    );
  }
  const tone =
    period.locked ? "border-emerald-500/40 bg-emerald-500/5" :
    status.status === "in_review" ? "border-gold/40 bg-gold/5" :
    status.status === "not_started" ? "border-border-soft" :
    "border-amber-500/40 bg-amber-500/5";
  const Icon = period.locked ? Lock : status.status === "not_started" ? Clock : status.openRecs > 0 ? AlertTriangle : CheckCircle2;
  return (
    <Link href={`/finance/close?entity=${entity.id}`}>
      <Card
        className={`p-3 cursor-pointer hover:border-gold/40 transition-colors ${tone}`}
        data-testid={`finance-close-mini-${entity.id}`}
      >
        <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-text-faint">
          <span className="flex items-center gap-1"><Icon className="w-3 h-3" /> Close · {entity.shortName}</span>
          <span>{period.periodLabel}</span>
        </div>
        <div className="mt-1 text-sm text-text leading-tight">
          {period.locked
            ? `Closed in ${status.daysToCloseActual ?? "—"}d / ${status.daysToCloseTarget}d target`
            : status.status === "not_started"
              ? `Not started — target ${period.targetCloseOn}`
              : `${status.checklistPct}% checklist · ${status.openRecs} open rec${status.openRecs === 1 ? "" : "s"}`}
        </div>
        <div className="text-xs text-text-mute mt-1 flex items-center gap-1">
          <span>Sign-off {status.signOffsCount}/{status.signOffsRequired}</span>
          {period.locked && <MonoChip tone="green" className="ml-1">locked</MonoChip>}
        </div>
      </Card>
    </Link>
  );
}

/* ============================================================
   Hook composition: derived filter context
   ============================================================ */

interface FilterCtx {
  filters: CfoFilters;
  selectedEntities: FinanceEntityRow[];
  isAllEntities: boolean;
  localCode: string | undefined;
  daysInPeriod: number;
  asOfMs: number;
}

function useFilterCtx(filters: CfoFilters): FilterCtx {
  const allEntities = useFinanceEntities();
  const isAll = filters.entities.includes("all");
  const selected = isAll ? allEntities : allEntities.filter((e) => (filters.entities as string[]).includes(e.id));
  const localCode = !isAll && selected.length === 1 ? selected[0].baseCurrency : undefined;
  const asOfMs = filters.asOf ? new Date(filters.asOf).getTime() : Date.now();
  return {
    filters,
    selectedEntities: selected.length ? selected : allEntities,
    isAllEntities: isAll,
    localCode,
    daysInPeriod: PERIOD_DAYS[filters.period],
    asOfMs,
  };
}

/* ============================================================
   Row 1 — KPI hero strip
   ============================================================ */

function HeroStrip({ ctx, ar, wip, margin, cash, util }: {
  ctx: FilterCtx;
  ar: ReturnType<typeof useArAging>;
  wip: ReturnType<typeof useWipLatest>;
  margin: ReturnType<typeof useMarginFirm>;
  cash: ReturnType<typeof useCashForecast>;
  util: ReturnType<typeof useUtilFirm>;
}) {
  const { filters, localCode, daysInPeriod } = ctx;
  const ccy = filters.currency;
  const fmtOpts = { localCode };

  // Cash on hand & days-of-cash from the 13-week forecast (from as-of week onward)
  const weeksFromAsOf = (cash?.weeks ?? []).filter((w) => new Date(w.weekStart).getTime() >= ctx.asOfMs - 7 * 86_400_000);
  const cashOnHand = weeksFromAsOf[0]?.openingBalance ?? null;
  const weeklyBurn = weeksFromAsOf.length
    ? weeksFromAsOf.reduce((s, w) => s + w.expectedOut, 0) / weeksFromAsOf.length
    : 0;
  const daysOfCash = cashOnHand && weeklyBurn > 0 ? Math.round((cashOnHand / weeklyBurn) * 7) : null;
  const netCash = weeksFromAsOf.length ? weeksFromAsOf.reduce((s, w) => s + (w.expectedIn - w.expectedOut), 0) : null;

  // Revenue (recognised, firm-margin window)
  const rev = margin?.firm.revenueRecognised ?? null;
  const revPlan = rev ? rev / PLAN_RATIO.revenue : null;
  const revDelta = rev != null && revPlan != null ? rev - revPlan : 0;

  // EBITDA proxy = gross margin amount (full opex break-out lands Wave 6)
  const grossMargin = margin?.firm.grossMarginAmount ?? null;
  const ebitdaPlan = grossMargin ? grossMargin / PLAN_RATIO.ebitda : null;
  const ebitdaDelta = grossMargin != null && ebitdaPlan != null ? grossMargin - ebitdaPlan : 0;
  const marginPct = margin?.firm.grossMarginPct ?? null;

  // Lockup days = WIP days + DSO over the selected period window
  const dailyRev = rev ? rev / daysInPeriod : 0;
  const wipDays = dailyRev > 0 && wip ? Math.round(wip.firm.unbilled / dailyRev) : null;
  const dso = dailyRev > 0 && ar ? Math.round(ar.totalOutstandingUsd / dailyRev) : null;
  const lockup = wipDays != null && dso != null ? wipDays + dso : null;

  // Utilisation
  const utilAvg = util?.partnerSummary.length
    ? util.partnerSummary.reduce((s, p) => s + p.utilPct, 0) / util.partnerSummary.length
    : null;
  const utilTarget = util?.partnerSummary.length
    ? util.partnerSummary.reduce((s, p) => s + p.targetPct, 0) / util.partnerSummary.length
    : 0.75;

  const realisation = util?.realizationRatePct ?? null;

  const cashRag = daysOfCash == null ? "neutral" : daysOfCash >= 90 ? "green" : daysOfCash >= 45 ? "amber" : "red";
  const lockupRag = lockup == null ? "neutral" : lockup <= 75 ? "green" : lockup <= 110 ? "amber" : "red";
  const utilRag = utilAvg == null ? "neutral" : utilAvg >= utilTarget ? "green" : utilAvg >= utilTarget - 0.1 ? "amber" : "red";
  const realisationRag = realisation == null ? "neutral" : realisation >= 0.9 ? "green" : realisation >= 0.75 ? "amber" : "red";
  const revRag = rev != null && revPlan != null ? (rev >= revPlan ? "green" : rev >= revPlan * 0.9 ? "amber" : "red") : "neutral";
  const ebitdaRag = grossMargin != null && ebitdaPlan != null ? (grossMargin >= ebitdaPlan ? "green" : grossMargin >= ebitdaPlan * 0.9 ? "amber" : "red") : "neutral";
  const netCashRag = netCash == null ? "neutral" : netCash >= 0 ? "green" : "red";

  const firmScope = ctx.isAllEntities ? undefined : FIRM_SCOPE_NOTE;

  // Subscribe so close-status mini-cards re-render when the in-memory store mutates.
  useCloseSnapshot();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3" data-testid="cfo-hero-strip">
      <MetricTile
        testId="cfo-tile-cash"
        label="Cash on hand"
        value={cashOnHand != null ? formatMoney(cashOnHand, ccy, fmtOpts) : "—"}
        unit={daysOfCash != null ? `· ${daysOfCash}d` : undefined}
        rag={cashRag}
        href="/wallet/treasury"
        scopeNote={firmScope}
        info={{
          definition: "Aggregate cash across all operating accounts at the as-of date.",
          formula: "Σ bank balances (opening of first week ≥ as-of)",
          source: "Treasury · cash_forecast_13w",
          freshness: cashOnHand != null ? "live" : "no snapshot",
        }}
        ccy={ccy}
        localCode={localCode}
      />
      <MetricTile
        testId="cfo-tile-net-cash"
        label="Net cash movement"
        value={netCash != null ? formatMoney(netCash, ccy, fmtOpts) : "—"}
        unit={weeksFromAsOf.length ? `${weeksFromAsOf.length}w` : undefined}
        rag={netCashRag}
        href="/wallet/treasury"
        scopeNote={firmScope}
        info={{
          definition: "Net of expected receipts minus disbursements over the forecast horizon from as-of.",
          formula: "Σ (expectedIn − expectedOut) for weeks ≥ as-of",
          source: "Treasury · cash_forecast_13w",
          freshness: cash ? "live" : "no snapshot",
        }}
        ccy={ccy}
        localCode={localCode}
      />
      <MetricTile
        testId="cfo-tile-revenue"
        label="Revenue vs plan"
        value={rev != null ? formatMoney(rev, ccy, fmtOpts) : "—"}
        rag={revRag}
        vsPlan={rev != null ? { delta: revDelta, kind: "money", tone: revRag } : undefined}
        href="/finance/reports/firm-economics"
        scopeNote={firmScope}
        info={{
          definition: "Recognised revenue in the period, all entities.",
          formula: "Σ revenueRecognised (margin snapshot)",
          source: "Margin engine · /margin/firm",
          freshness: margin?.asOf ?? "live",
        }}
        ccy={ccy}
        localCode={localCode}
      />
      <MetricTile
        testId="cfo-tile-ebitda"
        label="EBITDA vs plan"
        value={grossMargin != null ? formatMoney(grossMargin, ccy, fmtOpts) : "—"}
        unit={marginPct != null ? `· ${formatPct(marginPct)}` : undefined}
        rag={ebitdaRag}
        vsPlan={grossMargin != null ? { delta: ebitdaDelta, kind: "money", tone: ebitdaRag } : undefined}
        href="/finance/reports/firm-economics"
        scopeNote={firmScope}
        info={{
          definition: "Gross margin proxy until full opex break-out lands in Wave 6.",
          formula: "revenueRecognised − directCost (margin snapshot)",
          source: "Margin engine · /margin/firm",
          freshness: margin?.asOf ?? "live",
        }}
        ccy={ccy}
        localCode={localCode}
      />
      <MetricTile
        testId="cfo-tile-lockup"
        label="Lockup days"
        value={lockup != null ? `${lockup}d` : "—"}
        unit={wipDays != null && dso != null ? `WIP ${wipDays} · DSO ${dso}` : undefined}
        rag={lockupRag}
        href="/wallet/wip"
        scopeNote={firmScope}
        info={{
          definition: "Days revenue tied up between work delivered and cash collected.",
          formula: `WIP days + DSO  =  unbilled/(rev/${daysInPeriod}) + AR/(rev/${daysInPeriod})`,
          source: "WIP + AR aging · period-scaled",
          freshness: ar && wip ? "live" : "partial",
        }}
        ccy={ccy}
        localCode={localCode}
      />
      <MetricTile
        testId="cfo-tile-utilisation"
        label="Utilisation"
        value={utilAvg != null ? formatPct(utilAvg) : "—"}
        unit={`tgt ${formatPct(utilTarget)}`}
        rag={utilRag}
        vsPlan={utilAvg != null ? { delta: utilAvg - utilTarget, kind: "pct", tone: utilRag } : undefined}
        href="/finance/reports/utilization"
        scopeNote={firmScope}
        info={{
          definition: "Billable hours divided by available hours, weighted across partners.",
          formula: "Σ partner.utilPct / N partners",
          source: "Time engine · /ledger/utilization/firm",
          freshness: util ? "live" : "no snapshot",
        }}
        ccy={ccy}
        localCode={localCode}
      />
      <MetricTile
        testId="cfo-tile-backlog"
        label="Backlog coverage"
        value="—"
        wave={{ wave: 5, note: "Backlog model lands Wave 5" }}
        rag="neutral"
        ccy={ccy}
        localCode={localCode}
      />
      <MetricTile
        testId="cfo-tile-realisation"
        label="Realisation"
        value={realisation != null ? formatPct(realisation) : "—"}
        rag={realisationRag}
        href="/wallet/margin"
        scopeNote={firmScope}
        info={{
          definition: "Recognised revenue divided by standard rate-card revenue.",
          formula: "revenueRecognised / standardRevenueAtRack",
          source: "Margin engine · /margin/firm",
          freshness: margin?.asOf ?? "live",
        }}
        ccy={ccy}
        localCode={localCode}
      />
    </div>
  );
}

/* ============================================================
   Row 2 — Cash & Liquidity + Revenue Engine
   ============================================================ */

function CashAndRevenue({ ctx, cash, ar, wip, margin }: {
  ctx: FilterCtx;
  cash: ReturnType<typeof useCashForecast>;
  ar: ReturnType<typeof useArAging>;
  wip: ReturnType<typeof useWipLatest>;
  margin: ReturnType<typeof useMarginFirm>;
}) {
  const { data: forecast } = useAtelierGetPipelineForecast();
  const { filters, localCode } = ctx;
  const ccy = filters.currency;
  const fmtOpts = { localCode };

  // Cash chart bars — only weeks at/after as-of
  const weeks: CashForecastWeek[] = (cash?.weeks ?? []).filter((w) => new Date(w.weekStart).getTime() >= ctx.asOfMs - 7 * 86_400_000);
  const maxAbs = Math.max(1, ...weeks.map((w) => Math.abs(w.closingBalance)));
  const minCash = weeks.length ? Math.min(...weeks.map((w) => w.closingBalance)) : null;
  const cashGapsInWindow = weeks.filter((w) => w.isCashGap).length;

  // Top 5 receipts (from AR rows)
  const topReceipts = (ar?.rows ?? [])
    .slice()
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5);

  // Pipeline coverage — weighted vs revenue plan
  const coverage = forecast?.weightedPipelineUsd ?? null;
  const planTarget = (margin?.firm.revenueRecognised ?? 0) * 1.5;
  const coverageRatio = coverage && planTarget > 0 ? coverage / planTarget : null;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* Cash & Liquidity */}
      <div className="space-y-3">
        <Card className="p-4" data-testid="cfo-cash-panel">
          <PanelHead title={`Cash & Liquidity · ${weeks.length}-week forecast from ${filters.asOf}`} drillHref="/wallet/treasury" />
          {weeks.length === 0 ? (
            <div className="text-xs text-text-mute py-8 text-center">No treasury snapshot at/after as-of date — recompute under Treasury or move as-of earlier.</div>
          ) : (
            <>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
                {weeks.map((w) => {
                  const h = Math.max(8, Math.round((Math.abs(w.closingBalance) / maxAbs) * 70));
                  return (
                    <div key={w.weekIndex} className="flex flex-col items-center gap-0.5">
                      <div className="text-[8px] font-mono text-text-faint">w{w.weekIndex}</div>
                      <div
                        className={`w-full rounded ${w.isCashGap ? "bg-danger" : w.closingBalance >= 0 ? "bg-gold" : "bg-warn"}`}
                        style={{ height: `${h}px` }}
                        title={`${w.weekStart}: ${formatMoney(w.closingBalance, ccy, fmtOpts)}`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[10px] font-mono text-text-mute flex justify-between">
                <span>Min cash: <span className="text-text">{minCash != null ? formatMoney(minCash, ccy, fmtOpts) : "—"}</span></span>
                <span>Covenant floor: <span className="text-text-faint italic">— Wave 4</span></span>
                <span>Cash gaps: <span className={cashGapsInWindow ? "text-danger" : "text-success"}>{cashGapsInWindow}</span></span>
              </div>
            </>
          )}
        </Card>

        {/* Close Status Mini-cards (Wave 4) */}
        {ctx.selectedEntities.length > 0 && (
          <div className="space-y-3">
            <Eyebrow>Close status</Eyebrow>
            <div className="grid grid-cols-1 gap-2" data-testid="finance-close-mini-cards">
              {ctx.selectedEntities
                .map((e) => ({ entity: e, status: statusForEntity(e.id) }))
                .filter((x) => x.status.period !== null)
                .map(({ entity, status }) => (
                  <CloseStatusMiniCard key={entity.id} entity={entity} status={status} />
                ))}
            </div>
          </div>
        )}

        <Card className="p-4 grid grid-cols-2 gap-4" data-testid="cfo-cash-mix">
          <div className="opacity-60 border border-dashed border-border-soft rounded p-3">
            <div className="flex items-center justify-between">
              <Eyebrow>Currency mix</Eyebrow>
              <MonoChip>Wave 4</MonoChip>
            </div>
            <div className="text-2xl font-light text-text-faint mt-2">—</div>
            <div className="text-[10px] font-mono text-text-faint italic mt-1">Multi-bank balance feed lands Wave 4.</div>
          </div>
          <div className="opacity-60 border border-dashed border-border-soft rounded p-3">
            <div className="flex items-center justify-between">
              <Eyebrow>FX exposure</Eyebrow>
              <MonoChip>Wave 4</MonoChip>
            </div>
            <div className="text-2xl font-light text-text-faint mt-2">—</div>
            <div className="text-[10px] font-mono text-text-faint italic mt-1">90-day VaR on non-presentation currencies — Wave 4.</div>
          </div>
        </Card>
      </div>

      {/* Revenue Engine */}
      <div className="space-y-3">
        <Card className="p-4" data-testid="cfo-rev-waterfall">
          <PanelHead title="Bookings → Billings → Cash" drillHref="/finance/billing/rate-cards" />
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Bookings", v: forecast?.totalDealSumUsd ?? null, sub: "weighted pipeline" },
              { label: "Billings", v: wip ? wip.firm.invoiced + wip.firm.unbilled : null, sub: "WIP + invoiced" },
              { label: "Cash", v: ar && margin ? margin.firm.revenueRecognised - ar.totalOutstandingUsd : null, sub: "rev − AR" },
            ].map((c) => (
              <div key={c.label} className="border border-border-soft rounded p-2">
                <div className="text-[10px] font-mono uppercase text-text-faint">{c.label}</div>
                <div className="text-xl font-light text-text mt-1">{c.v != null ? formatMoney(c.v, ccy, fmtOpts) : "—"}</div>
                <div className="text-[10px] text-text-mute mt-1">{c.sub}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4" data-testid="cfo-pipeline">
          <PanelHead title="Weighted pipeline vs plan" drillHref="/opportunities?view=forecast" />
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-light text-text">{coverage != null ? formatMoney(coverage, ccy, fmtOpts) : "—"}</div>
            {coverageRatio != null && (
              <MonoChip tone={coverageRatio >= 1.5 ? "green" : coverageRatio >= 1 ? "amber" : "red"}>
                {coverageRatio.toFixed(2)}x cover
              </MonoChip>
            )}
          </div>
          <div className="text-[10px] font-mono text-text-mute mt-1">
            Target band 1.0–1.5x revenue. Stalled: {forecast?.stalledCount ?? 0} · Total opps: {forecast?.totalCount ?? 0}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-mono uppercase text-text-faint mb-1">Top 5 expected receipts</div>
              <ul className="text-[11px] space-y-0.5">
                {topReceipts.length === 0 && <li className="text-text-faint italic">No open AR.</li>}
                {topReceipts.map((r) => (
                  <li key={r.invoice.id} className="flex justify-between gap-2">
                    <span className="truncate text-text-mute">{r.invoice.billTo?.name ?? r.invoice.invoiceNumber}</span>
                    <span className="font-mono text-text">{formatMoney(r.outstanding, ccy, fmtOpts)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="opacity-60 border border-dashed border-border-soft rounded p-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase text-text-faint">Top 5 disbursements</div>
                <MonoChip>Wave 3</MonoChip>
              </div>
              <div className="text-[11px] text-text-faint italic mt-1">Payment-run register lands Wave 3.</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ============================================================
   Row 3 — Engagement Health
   ============================================================ */

function EngagementHealth({ ctx, util }: {
  ctx: FilterCtx;
  util: ReturnType<typeof useUtilFirm>;
}) {
  const { data: engagements } = useAtelierListEngagements();

  const rollup = util?.engagementRollup ?? [];
  const rollupById = new Map(rollup.map((r) => [r.engagementId, r]));

  const rows = (engagements ?? [])
    .map((e) => {
      const r = rollupById.get(e.id);
      return {
        engagement: e,
        realised: r?.realizedMarginPct ?? null,
        target: r?.targetMarginPct ?? null,
        slip: r ? r.realizedMarginPct - r.targetMarginPct : null,
      };
    })
    .sort((a, b) => (a.slip ?? 1) - (b.slip ?? 1))
    .slice(0, 10);

  // Margin distribution histogram (real data only)
  const bins = [0.2, 0.3, 0.4, 0.5, 0.6];
  const binCounts = bins.map((b) => rollup.filter((r) => r.realizedMarginPct >= b && r.realizedMarginPct < b + 0.1).length);
  const maxBin = Math.max(1, ...binCounts);

  const atRisk = rows.filter((r) => r.engagement.raidStatus === "red" || (r.slip != null && r.slip < -0.05));

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2 p-4" data-testid="cfo-engagement-table">
        <PanelHead
          title="Engagement health · top 10 by margin slippage"
          drillHref="/clients/engagements"
          right={!ctx.isAllEntities && <MonoChip tone="amber">{FIRM_SCOPE_NOTE}</MonoChip>}
        />
        <table className="w-full text-xs">
          <thead className="text-[10px] font-mono uppercase text-text-faint">
            <tr className="border-b border-border-soft">
              <th className="text-left py-1.5">Engagement</th>
              <th className="text-left">Partner</th>
              <th className="text-right">% complete</th>
              <th className="text-right">% billed</th>
              <th className="text-right">EAC var</th>
              <th className="text-right">Margin</th>
              <th className="text-right">Change orders</th>
              <th className="text-center">RAG</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-text-faint italic">No active engagements.</td></tr>
            )}
            {rows.map((r) => {
              const tone = r.engagement.raidStatus === "red" ? "red" : r.engagement.raidStatus === "amber" ? "amber" : "green";
              return (
                <tr key={r.engagement.id} className="border-b border-border-soft/60 hover:bg-bg-elevate/30">
                  <td className="py-1.5">
                    <Link href={`/clients/deliver/engagements/${r.engagement.id}`} className="text-text hover:text-gold">
                      {r.engagement.name}
                    </Link>
                    <div className="text-[10px] text-text-faint font-mono">{r.engagement.accountName}</div>
                  </td>
                  <td className="text-text-mute">{r.engagement.partnerOwnerName}</td>
                  <td className="text-right text-text-faint italic">— W2</td>
                  <td className="text-right text-text-faint italic">— W2</td>
                  <td className="text-right text-text-faint italic">— W2</td>
                  <td className="text-right font-mono">
                    {r.realised != null ? (
                      <span className={r.slip != null && r.slip < -0.05 ? "text-danger" : "text-text"}>
                        {formatPct(r.realised)} <span className="text-text-faint">/ {r.target != null ? formatPct(r.target) : "—"}</span>
                      </span>
                    ) : "—"}
                  </td>
                  <td className="text-right text-text-faint italic">— W2</td>
                  <td className="text-center"><RagDot tone={tone as "red" | "amber" | "green"} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="space-y-3">
        <Card className="p-4" data-testid="cfo-projects-at-risk">
          <PanelHead title="Projects at risk" />
          {atRisk.length === 0 ? (
            <div className="text-xs text-text-mute py-4">All clear. No engagements RED or below margin floor.</div>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {atRisk.map((r) => (
                <li key={r.engagement.id} className="flex items-baseline justify-between gap-2 border-b border-border-soft pb-1.5 last:border-b-0">
                  <Link href={`/clients/deliver/engagements/${r.engagement.id}`} className="text-text hover:text-gold truncate">
                    {r.engagement.name}
                  </Link>
                  <MonoChip tone={r.engagement.raidStatus === "red" ? "red" : "amber"}>
                    {r.slip != null ? `${(r.slip * 100).toFixed(0)} pts` : r.engagement.raidStatus}
                  </MonoChip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4" data-testid="cfo-margin-hist">
          <PanelHead title="Margin distribution" />
          {rollup.length === 0 ? (
            <div className="text-xs text-text-faint italic py-4">No margin snapshot.</div>
          ) : (
            <>
              <div className="flex items-end gap-1 h-24">
                {bins.map((b, i) => (
                  <div key={b} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-[9px] font-mono text-text-faint">{binCounts[i]}</div>
                    <div className="w-full bg-gold/60 rounded-t" style={{ height: `${(binCounts[i] / maxBin) * 80}px` }} />
                    <div className="text-[9px] font-mono text-text-mute">{(b * 100).toFixed(0)}+</div>
                  </div>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-text-faint font-mono">{rollup.length} engagement(s) snapshotted</div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ============================================================
   Row 4 — People & Delivery + Working Capital
   ============================================================ */

function PeopleAndWorkingCapital({ ctx, util, ar, wip, margin }: {
  ctx: FilterCtx;
  util: ReturnType<typeof useUtilFirm>;
  ar: ReturnType<typeof useArAging>;
  wip: ReturnType<typeof useWipLatest>;
  margin: ReturnType<typeof useMarginFirm>;
}) {
  const { filters, localCode, daysInPeriod } = ctx;
  const ccy = filters.currency;
  const fmtOpts = { localCode };

  const arBuckets = ar?.buckets ?? [];
  const totalAr = ar?.totalOutstandingUsd ?? 0;
  const arOver90 = arBuckets.find((b) => b.bucket === "d90_plus")?.totalUsd ?? 0;

  const topOverdue = (ar?.rows ?? [])
    .filter((r) => r.daysOverdue > 0)
    .slice()
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 5);

  const wipTop = (wip?.engagements ?? [])
    .slice()
    .sort((a, b) => b.unbilled_amount - a.unbilled_amount)
    .slice(0, 5);

  // Real DSO / WIP-days (no synthetic trend)
  const rev = margin?.firm.revenueRecognised ?? 0;
  const dailyRev = rev > 0 ? rev / daysInPeriod : 0;
  const currentDso = dailyRev > 0 ? Math.round(totalAr / dailyRev) : null;
  const currentWipDays = dailyRev > 0 && wip ? Math.round(wip.firm.unbilled / dailyRev) : null;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* People & Delivery */}
      <Card className="p-4 space-y-4" data-testid="cfo-people-panel">
        <PanelHead
          title="People & Delivery capacity"
          drillHref="/finance/reports/utilization"
          right={!ctx.isAllEntities && <MonoChip tone="amber">{FIRM_SCOPE_NOTE}</MonoChip>}
        />
        <div>
          <div className="text-[10px] font-mono uppercase text-text-faint mb-2">Utilisation by partner vs target</div>
          {util?.partnerSummary.length ? (
            <div className="space-y-1">
              {util.partnerSummary.slice(0, 6).map((p) => {
                const ratio = p.targetPct > 0 ? p.utilPct / p.targetPct : 0;
                const tone = ratio >= 1 ? "bg-success" : ratio >= 0.85 ? "bg-warn" : "bg-danger";
                return (
                  <div key={p.partnerId} className="flex items-center gap-2 text-[11px]">
                    <span className="w-32 truncate text-text-mute">{p.partnerName}</span>
                    <div className="flex-1 h-2 rounded bg-bg-elevate overflow-hidden relative">
                      <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, p.utilPct * 100)}%` }} />
                      <div className="absolute top-0 h-full w-px bg-gold" style={{ left: `${p.targetPct * 100}%` }} />
                    </div>
                    <span className="font-mono w-12 text-right">{formatPct(p.utilPct)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-text-faint italic">No utilisation snapshot.</div>
          )}
        </div>

        {/* Wave-4 placeholder tiles — no synthetic numbers */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Bench %", note: "Roster + roll-on lands Wave 4" },
            { label: "Time-compliance", note: "Time-sheet hygiene lands Wave 4" },
            { label: "Headcount plan vs actual", note: "Headcount plan lands Wave 4" },
            { label: "90-day attrition", note: "HRIS feed lands Wave 4" },
          ].map((p) => (
            <div key={p.label} className="opacity-60 border border-dashed border-border-soft rounded p-2 min-h-[72px]">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono uppercase text-text-faint">{p.label}</div>
                <MonoChip>Wave 4</MonoChip>
              </div>
              <div className="text-xl font-light text-text-faint mt-1">—</div>
              <div className="text-[10px] font-mono text-text-faint italic">{p.note}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Working Capital */}
      <Card className="p-4 space-y-4" data-testid="cfo-wc-panel">
        <PanelHead title="Working capital" drillHref="/wallet/ar" right={!ctx.isAllEntities && <MonoChip tone="amber">{FIRM_SCOPE_NOTE}</MonoChip>} />
        {/* AR aging stack */}
        <div>
          <div className="flex items-baseline justify-between text-[10px] font-mono uppercase text-text-faint mb-1">
            <span>AR aging · {formatMoney(totalAr, ccy, fmtOpts)} outstanding</span>
            <span>over 90: <span className={arOver90 > 0 ? "text-danger" : "text-success"}>{formatMoney(arOver90, ccy, fmtOpts)}</span></span>
          </div>
          <div className="flex h-4 rounded overflow-hidden border border-border-soft">
            {arBuckets.map((b) => {
              const w = totalAr > 0 ? (b.totalUsd / totalAr) * 100 : 0;
              const color = b.bucket === "current" ? "bg-success" : b.bucket === "d1_30" ? "bg-gold" : b.bucket === "d31_60" ? "bg-warn" : "bg-danger";
              return <div key={b.bucket} className={color} style={{ width: `${w}%` }} title={`${b.bucket}: ${formatMoney(b.totalUsd, ccy, fmtOpts)}`} />;
            })}
          </div>
          {topOverdue.length > 0 && (
            <ul className="mt-2 text-[11px] space-y-0.5">
              {topOverdue.map((r) => (
                <li key={r.invoice.id} className="flex justify-between gap-2">
                  <Link href={`/wallet/collections?invoiceId=${r.invoice.id}`} className="text-text-mute hover:text-gold truncate">
                    {r.invoice.billTo?.name ?? r.invoice.invoiceNumber}
                  </Link>
                  <span className="font-mono text-text">{formatMoney(r.outstanding, ccy, fmtOpts)} · {r.daysOverdue}d</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* WIP aging */}
        <div>
          <div className="text-[10px] font-mono uppercase text-text-faint mb-1">
            WIP aging · {wip ? formatMoney(wip.firm.unbilled, ccy, fmtOpts) : "—"} unbilled
          </div>
          {wipTop.length > 0 ? (
            <ul className="text-[11px] space-y-0.5">
              {wipTop.map((w) => (
                <li key={w.engagement_id} className="flex justify-between gap-2">
                  <span className="text-text-mute font-mono truncate">{w.engagement_id}</span>
                  <span className="font-mono text-text">{formatMoney(w.unbilled_amount, ccy, fmtOpts)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-text-faint italic">No WIP snapshot.</div>
          )}
        </div>

        {/* Real current DSO + WIP-days; trend is Wave-4 placeholder */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-mono uppercase text-text-faint">DSO · period</div>
            <div className="text-xl font-light text-text">{currentDso != null ? `${currentDso}d` : "—"}</div>
            <div className="text-[10px] font-mono text-text-faint italic">{filters.period.toUpperCase()} · trend Wave 4</div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase text-text-faint">WIP days · period</div>
            <div className="text-xl font-light text-text">{currentWipDays != null ? `${currentWipDays}d` : "—"}</div>
            <div className="text-[10px] font-mono text-text-faint italic">{filters.period.toUpperCase()} · trend Wave 4</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   Row 5 — Close · Compliance · Inbox
   ============================================================ */

function toneClasses(t: "red" | "amber" | "gold" | "default"): string {
  switch (t) {
    case "red": return "border-danger/40 bg-danger/5";
    case "amber": return "border-warn/40 bg-warn/5";
    case "gold": return "border-gold/40 bg-gold/5";
    default: return "border-border-soft";
  }
}

function CloseComplianceInbox({ entities, inbox, asOfMs }: {
  entities: FinanceEntityRow[];
  inbox: ReturnType<typeof buildCfoInbox>;
  asOfMs: number;
}) {
  // Compliance calendar — 90-day rolling from as-of
  const calendar = React.useMemo(() => {
    const items: Array<{ id: string; label: string; entity: string; date: string; tone: "red" | "amber" | "gold" | "default"; daysOut: number }> = [];
    const dayMs = 86_400_000;
    for (const e of entities) {
      const push = (id: string, label: string, date: string) => {
        if (!date || date === "—") return;
        const d = Math.round((new Date(date).getTime() - asOfMs) / dayMs);
        if (d > 90 || d < -30) return;
        items.push({ id, label, entity: e.shortName, date, daysOut: d, tone: d < 0 ? "red" : d <= 7 ? "amber" : d <= 30 ? "gold" : "default" });
      };
      push(`v-${e.id}`, "VAT filing", e.fiscal.nextVatFiling);
      push(`ct-${e.id}`, "CT filing", e.fiscal.nextCtFiling);
      push(`cl-${e.id}`, "Period close", e.fiscal.nextClose);
      for (const lic of e.tradeLicenses) {
        const d = Math.round((new Date(lic.expiresOn).getTime() - asOfMs) / dayMs);
        if (d <= 90 && d >= -30) {
          items.push({ id: `lic-${lic.id}`, label: `${lic.authority} renewal`, entity: e.shortName, date: lic.expiresOn, daysOut: d, tone: d < 0 ? "red" : d <= 30 ? "amber" : "gold" });
        }
      }
    }
    items.sort((a, b) => a.daysOut - b.daysOut);
    return items.slice(0, 8);
  }, [entities, asOfMs]);

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      {/* Close status per entity */}
      <Card className="p-4" data-testid="cfo-close-panel">
        <PanelHead title="Close status · per entity" drillHref="/finance/close" />
        <ul className="space-y-2">
          {entities.length === 0 && <li className="text-xs text-text-faint italic">No entities in current selection.</li>}
          {entities.map((e) => {
            const closeD = Math.round((new Date(e.fiscal.nextClose).getTime() - asOfMs) / 86_400_000);
            const tone = closeD < 0 ? "red" : closeD <= 7 ? "amber" : "default";
            return (
              <li key={e.id} className={`border ${toneClasses(tone)} rounded p-2 text-xs`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-text">{e.shortName}</span>
                  <MonoChip tone={tone === "red" ? "red" : tone === "amber" ? "amber" : "default"}>{closeD < 0 ? `${Math.abs(closeD)}d late` : `${closeD}d to close`}</MonoChip>
                </div>
                <div className="text-text-faint font-mono mt-0.5 text-[10px] flex justify-between">
                  <span>checklist <span className="italic">— W4</span></span>
                  <span>recs <span className="italic">— W4</span></span>
                  <span>sign-off <span className="italic">— W4</span></span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Compliance calendar */}
      <Card className="p-4" data-testid="cfo-compliance-panel">
        <PanelHead title="Compliance · next 90 days" drillHref="/finance/comply" />
        {calendar.length === 0 ? (
          <div className="text-xs text-text-mute py-4">Nothing within the 90-day horizon.</div>
        ) : (
          <ul className="space-y-1">
            {calendar.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-2 text-[11px] border-b border-border-soft last:border-b-0 py-1">
                <div className="min-w-0">
                  <div className="text-text truncate">{c.label}</div>
                  <div className="text-text-faint font-mono text-[10px]">{c.entity}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-text">{c.date}</div>
                  <MonoChip tone={c.tone === "red" ? "red" : c.tone === "amber" ? "amber" : "gold"}>
                    {c.daysOut < 0 ? `${Math.abs(c.daysOut)}d late` : `${c.daysOut}d`}
                  </MonoChip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Inbox */}
      <Card className="p-4" data-testid="cfo-inbox-panel">
        <PanelHead title="Next action for you" />
        {inbox.length === 0 ? (
          <div className="text-xs text-text-mute py-4">Nothing imminent.</div>
        ) : (
          <ul className="space-y-1.5" data-testid="finance-next-actions">
            {inbox.map((a) => (
              <li key={a.id}>
                <Link href={a.href}>
                  <div className={`border ${toneClasses(a.tone)} rounded p-2 cursor-pointer hover:border-gold/40 transition-colors`} data-testid={`finance-action-${a.id}`}>
                    <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono uppercase tracking-widest text-text-faint">
                      <span>{a.section}</span>
                      <span>{a.due}</span>
                    </div>
                    <div className="text-xs text-text font-medium leading-tight mt-0.5">{a.title}</div>
                    <div className="text-[10px] text-text-mute mt-0.5">{a.detail}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ============================================================
   FinanceHome — page shell
   ============================================================ */

export default function FinanceHome() {
  const [filters, setFilters] = useCfoFilters();
  const ctx = useFilterCtx(filters);

  const ar = useArAging();
  const wip = useWipLatest();
  const margin = useMarginFirm();
  const cash = useCashForecast();
  const util = useUtilFirm();
  const { data: fpaBudget } = useFpaBudget("base", "USD", null);
  const { data: fpaHc } = useFpaHeadcount("base", null);
  const { data: fpaRenewals } = useFpaRenewals("USD", null);

  // Inbox is entity-scoped: only producers tied to selected entities
  const inbox = React.useMemo(
    () => buildCfoInbox(ctx.selectedEntities, ar, margin, cash),
    [ctx.selectedEntities, ar, margin, cash],
  );

  const sources: FilterBarSource[] = [
    { name: "ledger", ageMin: margin ? 35 : 0, status: margin ? "live" : "missing" },
    { name: "bank", ageMin: cash ? 12 : 0, status: cash ? "live" : "missing" },
    { name: "time", ageMin: util ? 60 : 0, status: util ? "live" : "missing" },
    { name: "pipeline", ageMin: 25, status: "live" },
  ];

  const ccyCode = resolvePrimaryCode(filters.currency, ctx.localCode);
  const ccyChip = filters.currency === "side"
    ? `presentation · GBP / ${ctx.localCode ?? "USD"}`
    : `presentation · ${ccyCode}`;

  return (
    <div className="animate-in fade-in" data-testid="cfo-dashboard">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · CFO Dashboard"
          headline="CFO morning view"
          lede="Solvency, earnings, collection, delivery, control — the five questions answered before the first coffee. Numbers reflect the entity, period, currency and as-of selected in the filter bar."
        />
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-mono text-text-mute">
          <MonoChip>{ctx.selectedEntities.length} entit{ctx.selectedEntities.length === 1 ? "y" : "ies"}</MonoChip>
          <MonoChip>{ccyChip}</MonoChip>
          <MonoChip>{filters.period.toUpperCase()} · {ctx.daysInPeriod}d</MonoChip>
          {!ctx.isAllEntities && filters.currency === "local" && !ctx.localCode && (
            <MonoChip tone="amber">local needs single-entity selection — using GBP</MonoChip>
          )}
          <MonoChip tone={inbox.length > 0 ? "amber" : "green"}>
            {inbox.length} item{inbox.length === 1 ? "" : "s"} need attention
          </MonoChip>
        </div>
      </PageHero>

      <CfoFilterBar filters={filters} setFilters={setFilters} sources={sources} />

      <div className="container-atelier py-6 space-y-6">
        <section>
          <Eyebrow>KPI hero · {filters.period.toUpperCase()}</Eyebrow>
          <div className="mt-2">
            <HeroStrip ctx={ctx} ar={ar} wip={wip} margin={margin} cash={cash} util={util} />
          </div>
        </section>

        <section>
          <CashAndRevenue ctx={ctx} cash={cash} ar={ar} wip={wip} margin={margin} />
        </section>

        <section>
          <EngagementHealth ctx={ctx} util={util} />
        </section>

        <section>
          <PeopleAndWorkingCapital ctx={ctx} util={util} ar={ar} wip={wip} margin={margin} />
        </section>

        <section>
          <CloseComplianceInbox entities={ctx.selectedEntities} inbox={inbox} asOfMs={ctx.asOfMs} />
        </section>

        <section data-testid="finance-plan-fpa">
          <Eyebrow>FP&amp;A · driver-based plan ({fpaBudget?.scenarioLabel ?? "Base case"})</Eyebrow>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
            <Link href="/finance/plan/budget">
              <Card className="p-4 cursor-pointer hover:border-gold/40 transition-colors h-full" data-testid="kpi-tile-revenue-plan">
                <Eyebrow>Revenue (FY plan)</Eyebrow>
                <div className="text-2xl font-light mt-1 text-success">
                  {fpaBudget ? formatMoney(fpaBudget.totals.revenue, "GBP", { localCode: "USD" }) : "—"}
                </div>
                <div className="text-[10px] font-mono text-text-mute mt-1">
                  {fpaBudget ? `${fpaBudget.fyLabel} · ${fpaBudget.scenarioLabel}` : "loading…"}
                </div>
              </Card>
            </Link>
            <Link href="/finance/plan/budget">
              <Card className={`p-4 cursor-pointer hover:border-gold/40 transition-colors h-full ${fpaBudget && fpaBudget.totals.ebitda < 0 ? "border-danger/40 bg-danger/5" : ""}`} data-testid="kpi-tile-ebitda-plan">
                <Eyebrow>EBITDA (FY plan)</Eyebrow>
                <div className={`text-2xl font-light mt-1 ${fpaBudget && fpaBudget.totals.ebitda >= 0 ? "text-success" : "text-danger"}`}>
                  {fpaBudget ? formatMoney(fpaBudget.totals.ebitda, "GBP", { localCode: "USD" }) : "—"}
                </div>
                <div className="text-[10px] font-mono text-text-mute mt-1">
                  Margin {fpaBudget ? formatPct(fpaBudget.totals.ebitdaMarginPct) : "—"}
                </div>
              </Card>
            </Link>
            <Link href="/finance/plan/headcount">
              <Card className="p-4 cursor-pointer hover:border-gold/40 transition-colors h-full" data-testid="kpi-tile-headcount-plan">
                <Eyebrow>Headcount EOP</Eyebrow>
                <div className="text-2xl font-light mt-1">{fpaHc ? fpaHc.totals.endingHeadcount : "—"}</div>
                <div className="text-[10px] font-mono text-text-mute mt-1">
                  {fpaHc ? `+${fpaHc.totals.plannedHires} hires · −${fpaHc.totals.plannedExits} exits` : "loading…"}
                </div>
              </Card>
            </Link>
            <Link href="/finance/plan/renewals">
              <Card className={`p-4 cursor-pointer hover:border-gold/40 transition-colors h-full ${fpaRenewals && fpaRenewals.totalsArr.highRiskUsd > 0 ? "border-amber-500/40 bg-amber-500/5" : ""}`} data-testid="kpi-tile-renewals">
                <Eyebrow>ARR up for renewal</Eyebrow>
                <div className="text-2xl font-light mt-1">
                  {fpaRenewals ? formatMoney(fpaRenewals.totalsArr.totalUsd, "GBP", { localCode: "USD" }) : "—"}
                </div>
                <div className="text-[10px] font-mono text-text-mute mt-1">
                  {fpaRenewals ? `${formatMoney(fpaRenewals.totalsArr.highRiskUsd, "GBP", { localCode: "USD" })} high-risk` : "loading…"}
                </div>
              </Card>
            </Link>
          </div>
        </section>
      </div>

      <FinanceSectionRibbon />
    </div>
  );
}
