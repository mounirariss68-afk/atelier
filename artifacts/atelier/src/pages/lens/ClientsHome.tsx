/**
 * ClientsHome — pipeline dashboard for the Clients lens Overview.
 *
 * Best-practice CRM dashboard with four primary KPIs and three breakdowns:
 *
 *   KPIs                    | Breakdowns
 *   ─────────────────────── | ─────────────────────────────
 *   Open pipeline ($ + #)   | Pipeline by sales stage (funnel)
 *   Weighted pipeline ($)   | Expected closures by quarter
 *   Won YTD ($ + #)         | Pipeline by deal type (new/exp/ren)
 *   Projected FY revenue    |
 *
 * Data sources: existing accounts / opportunities / engagements hooks.
 * Close-date is taken from `nextMilestoneDate` when present, otherwise
 * estimated from `createdAt` plus a stage-typical horizon. Deal type is
 * derived per-opp via `deriveDealType` (account engagement history).
 */

import * as React from "react";
import { Link } from "wouter";
import {
  useAtelierListAccounts,
  useAtelierListOpportunities,
  useAtelierListEngagements,
  type Opportunity,
  type SalesStage,
} from "@workspace/api-client-react";
import { Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { ArrowRight } from "lucide-react";
import { CLIENT_SECTIONS } from "@/lib/client-lifecycle";
import { deriveDealType, DEAL_TYPE_LABEL, type DealType } from "@/lib/opportunity-deal-type";
import { cn } from "@/lib/utils";

// Sales stages that count as "open pipeline" — anything pre-signature.
const OPEN_STAGES: ReadonlyArray<SalesStage> = ["suspect", "prospect", "convert", "runner"];
const WON_STAGE: SalesStage = "contract";
const DEAD_STAGES: ReadonlyArray<SalesStage> = ["lost", "no_decision", "withdrawn"];

// Stage-typical days from creation to expected close. Used to estimate a
// close date when the opp doesn't carry an explicit one yet.
const STAGE_HORIZON_DAYS: Record<SalesStage, number> = {
  suspect: 180,
  prospect: 120,
  convert: 90,
  runner: 45,
  contract: 14,
  lost: 0,
  no_decision: 0,
  withdrawn: 0,
};

const STAGE_ORDER: ReadonlyArray<SalesStage> = ["suspect", "prospect", "convert", "runner", "contract"];

const STAGE_LABEL: Record<SalesStage, string> = {
  suspect: "Suspect",
  prospect: "Prospect",
  convert: "Convert",
  runner: "Runner",
  contract: "Contract",
  lost: "Lost",
  no_decision: "No decision",
  withdrawn: "Withdrawn",
};

function getSalesStage(o: Opportunity): SalesStage {
  return (o.salesStage ?? "suspect") as SalesStage;
}

function getCloseDate(o: Opportunity): Date {
  if (o.nextMilestoneDate) {
    const d = new Date(o.nextMilestoneDate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const created = new Date(o.createdAt);
  const horizon = STAGE_HORIZON_DAYS[getSalesStage(o)] ?? 90;
  return new Date(created.getTime() + horizon * 24 * 60 * 60 * 1000);
}

function quarterOf(d: Date): number {
  return Math.floor(d.getMonth() / 3) + 1;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtFullUsd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

interface KpiTileProps {
  eyebrow: string;
  primary: string;
  secondary?: string;
  caption?: string;
  testId?: string;
}

function KpiTile({ eyebrow, primary, secondary, caption, testId }: KpiTileProps) {
  return (
    <Card className="p-5 flex flex-col gap-2" data-testid={testId}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-light text-text tabular-nums">{primary}</span>
        {secondary ? (
          <span className="text-xs font-mono text-text-faint tabular-nums">{secondary}</span>
        ) : null}
      </div>
      {caption ? <p className="text-xs text-text-mute leading-snug">{caption}</p> : null}
    </Card>
  );
}

interface BarRowProps {
  label: string;
  count: number;
  value: number;
  weighted?: number;
  pct: number;
  testId?: string;
}

function BarRow({ label, count, value, weighted, pct, testId }: BarRowProps) {
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-mono uppercase tracking-widest text-text-mute">{label}</span>
        <span className="font-mono text-text-faint tabular-nums">
          {count} · {fmtUsd(value)}
          {weighted !== undefined ? (
            <span className="text-gold/80"> · w {fmtUsd(weighted)}</span>
          ) : null}
        </span>
      </div>
      <div className="h-2 bg-bg-deep/60 rounded-sm overflow-hidden border border-border-soft">
        <div
          className="h-full bg-gold/70 transition-all"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

export default function ClientsHome() {
  const { data: accounts } = useAtelierListAccounts();
  const { data: opps } = useAtelierListOpportunities();
  const { data: engs } = useAtelierListEngagements();

  const accountList = accounts ?? [];
  const oppList = opps ?? [];
  const engList = engs ?? [];

  const accountsById = React.useMemo(() => {
    const m = new Map<string, { id: string; activeEngagementCount?: number }>();
    for (const a of accountList) m.set(a.id, a);
    return m;
  }, [accountList]);

  const now = React.useMemo(() => new Date(), []);
  const fiscalYear = now.getFullYear();
  const yearStart = new Date(fiscalYear, 0, 1);
  const yearEnd = new Date(fiscalYear + 1, 0, 1);

  // Partition opps into open / won / dead buckets.
  const openOpps = oppList.filter((o) => OPEN_STAGES.includes(getSalesStage(o)));
  const wonOpps = oppList.filter((o) => getSalesStage(o) === WON_STAGE);
  // dead opps are intentionally tracked but not surfaced as a top KPI;
  // we keep the partition documented so future "win rate" tiles can plug in.
  const _deadOpps = oppList.filter((o) => DEAD_STAGES.includes(getSalesStage(o)));
  void _deadOpps;

  // KPI 1 — Open pipeline.
  const openValue = openOpps.reduce((s, o) => s + o.dealSizeUsd, 0);
  const openCount = openOpps.length;

  // KPI 2 — Weighted pipeline.
  const weightedValue = openOpps.reduce(
    (s, o) => s + o.dealSizeUsd * (o.probabilityPct / 100),
    0,
  );

  // KPI 3 — Won YTD: contract-stage opps signed in the current fiscal year.
  const wonYtd = wonOpps.filter((o) => {
    const ref = o.contractSignedAt ? new Date(o.contractSignedAt) : new Date(o.createdAt);
    return ref >= yearStart && ref < yearEnd;
  });
  const wonYtdValue = wonYtd.reduce((s, o) => s + o.dealSizeUsd, 0);

  // KPI 4 — Projected FY revenue: Won YTD + weighted value of open opps
  // expected to close before year-end.
  const expectedToCloseThisYear = openOpps.filter((o) => {
    const d = getCloseDate(o);
    return d >= now && d < yearEnd;
  });
  const projectedRest = expectedToCloseThisYear.reduce(
    (s, o) => s + o.dealSizeUsd * (o.probabilityPct / 100),
    0,
  );
  const projectedFy = wonYtdValue + projectedRest;

  // Breakdown — pipeline by stage (open stages only).
  const stageBreakdown = STAGE_ORDER.filter((s) => s !== "contract").map((stage) => {
    const inStage = openOpps.filter((o) => getSalesStage(o) === stage);
    const value = inStage.reduce((s, o) => s + o.dealSizeUsd, 0);
    const weighted = inStage.reduce(
      (s, o) => s + o.dealSizeUsd * (o.probabilityPct / 100),
      0,
    );
    return { stage, count: inStage.length, value, weighted };
  });
  const stageMaxValue = Math.max(1, ...stageBreakdown.map((b) => b.value));

  // Breakdown — expected closures by quarter (current FY, all open opps).
  const quarters = [1, 2, 3, 4].map((q) => {
    const inQ = openOpps.filter((o) => {
      const d = getCloseDate(o);
      return d.getFullYear() === fiscalYear && quarterOf(d) === q;
    });
    const value = inQ.reduce((s, o) => s + o.dealSizeUsd, 0);
    const weighted = inQ.reduce(
      (s, o) => s + o.dealSizeUsd * (o.probabilityPct / 100),
      0,
    );
    return { q, count: inQ.length, value, weighted };
  });
  const quarterMaxValue = Math.max(1, ...quarters.map((q) => q.value));

  // Breakdown — pipeline by deal type (new / expansion / renewal).
  const dealTypes: DealType[] = ["new", "expansion", "renewal"];
  const typeBreakdown = dealTypes.map((t) => {
    const inType = openOpps.filter((o) => deriveDealType(o, accountsById) === t);
    const value = inType.reduce((s, o) => s + o.dealSizeUsd, 0);
    const weighted = inType.reduce(
      (s, o) => s + o.dealSizeUsd * (o.probabilityPct / 100),
      0,
    );
    return { t, count: inType.length, value, weighted };
  });
  const typeMaxValue = Math.max(1, ...typeBreakdown.map((b) => b.value));

  const currentQuarter = quarterOf(now);

  return (
    <div className="animate-in fade-in" data-testid="clients-overview">
      <LensPageHeader
        backHref="/"
        backLabel="Home"
        headline="Pipeline dashboard"
        lede={`Open pipeline, weighted value, expected closures and projected FY${fiscalYear} revenue at a glance.`}
      />

      <div className="container-atelier py-10 space-y-10">
        <Card className="p-5 flex flex-wrap items-center justify-between gap-4" data-testid="clients-prototypes-card">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Delivery promise</div>
            <h3 className="mt-1 text-lg font-semibold">Prototype portfolio</h3>
            <p className="mt-1 text-sm text-text-mute">Track client prototype requests, deadlines, evidence, and approved tooling cost.</p>
          </div>
          <Link href="/prototypes" className="text-xs font-mono uppercase tracking-widest text-gold hover:underline">Open prototypes →</Link>
        </Card>
        {/* KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile
            eyebrow="Open pipeline"
            primary={fmtUsd(openValue)}
            secondary={`${openCount} ${openCount === 1 ? "opp" : "opps"}`}
            caption={`Total contract value of opportunities in ${OPEN_STAGES.map((s) => STAGE_LABEL[s]).join(" / ")}.`}
            testId="kpi-open-pipeline"
          />
          <KpiTile
            eyebrow="Weighted pipeline"
            primary={fmtUsd(weightedValue)}
            secondary={`${openValue > 0 ? Math.round((weightedValue / openValue) * 100) : 0}% of open`}
            caption="Sum of deal value × win probability across open opps."
            testId="kpi-weighted-pipeline"
          />
          <KpiTile
            eyebrow={`Won YTD · ${fiscalYear}`}
            primary={fmtUsd(wonYtdValue)}
            secondary={`${wonYtd.length} ${wonYtd.length === 1 ? "deal" : "deals"}`}
            caption="Contracts signed since 1 Jan."
            testId="kpi-won-ytd"
          />
          <KpiTile
            eyebrow={`Projected FY${fiscalYear}`}
            primary={fmtUsd(projectedFy)}
            secondary={`+${fmtUsd(projectedRest)} weighted to close`}
            caption="Won YTD plus weighted pipeline expected to land by year-end."
            testId="kpi-projected-fy"
          />
        </div>

        {/* Stage funnel + Quarter breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5 space-y-4" data-testid="panel-stage-funnel">
            <div className="flex items-baseline justify-between gap-3">
              <Eyebrow>Pipeline by stage</Eyebrow>
              <span className="text-[11px] font-mono text-text-faint">count · value · weighted</span>
            </div>
            <div className="space-y-3">
              {stageBreakdown.map((b) => (
                <BarRow
                  key={b.stage}
                  label={STAGE_LABEL[b.stage]}
                  count={b.count}
                  value={b.value}
                  weighted={b.weighted}
                  pct={(b.value / stageMaxValue) * 100}
                  testId={`stage-bar-${b.stage}`}
                />
              ))}
            </div>
            <div className="pt-3 border-t border-border-soft">
              <Link
                href="/clients/opportunities"
                className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-gold hover:underline"
              >
                Open pipeline <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </Card>

          <Card className="p-5 space-y-4" data-testid="panel-quarter-closures">
            <div className="flex items-baseline justify-between gap-3">
              <Eyebrow>Expected closures · FY{fiscalYear}</Eyebrow>
              <span className="text-[11px] font-mono text-text-faint">by close-date quarter</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {quarters.map((q) => {
                const isCurrent = q.q === currentQuarter;
                return (
                  <div
                    key={q.q}
                    className={cn(
                      "rounded-md border p-3 space-y-1.5",
                      isCurrent ? "border-gold/40 bg-bg-deep" : "border-border-soft bg-bg-elevate/40",
                    )}
                    data-testid={`quarter-tile-q${q.q}`}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[11px] uppercase tracking-widest text-text-mute">
                        Q{q.q}
                      </span>
                      {isCurrent ? (
                        <span className="font-mono text-[10px] uppercase tracking-widest text-gold">
                          now
                        </span>
                      ) : null}
                    </div>
                    <div className="text-lg font-light text-text tabular-nums">{fmtUsd(q.value)}</div>
                    <div className="text-[11px] font-mono text-text-faint tabular-nums">
                      {q.count} {q.count === 1 ? "opp" : "opps"} · w {fmtUsd(q.weighted)}
                    </div>
                    <div className="h-1.5 bg-bg-deep/60 rounded-sm overflow-hidden border border-border-soft">
                      <div
                        className="h-full bg-gold/70"
                        style={{ width: `${Math.max(0, Math.min(100, (q.value / quarterMaxValue) * 100))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-text-faint leading-snug">
              Close dates use each opp's next-milestone date when set, otherwise estimated from
              creation date plus a stage-typical horizon.
            </p>
          </Card>
        </div>

        {/* Deal-type breakdown */}
        <Card className="p-5 space-y-4" data-testid="panel-deal-type">
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Pipeline by deal type</Eyebrow>
            <span className="text-[11px] font-mono text-text-faint">
              renewals & expansions live as a flag on each opp
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {typeBreakdown.map((b) => (
              <div key={b.t} className="space-y-2" data-testid={`deal-type-${b.t}`}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-text">{DEAL_TYPE_LABEL[b.t]}</span>
                  <span className="font-mono text-[11px] text-text-faint tabular-nums">
                    {b.count} · {fmtUsd(b.value)}
                  </span>
                </div>
                <div className="h-2 bg-bg-deep/60 rounded-sm overflow-hidden border border-border-soft">
                  <div
                    className="h-full bg-gold/70"
                    style={{ width: `${Math.max(0, Math.min(100, (b.value / typeMaxValue) * 100))}%` }}
                  />
                </div>
                <div className="text-[11px] font-mono text-text-faint tabular-nums">
                  weighted {fmtUsd(b.weighted)}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Quick links */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border-soft">
          <span className="font-mono text-[10px] uppercase tracking-widest text-text-faint pr-2">
            Jump to
          </span>
          {CLIENT_SECTIONS.filter((s) => s.id !== "overview").map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className="inline-flex"
              data-testid={`overview-jump-${s.id}`}
            >
              <MonoChip>{s.label}</MonoChip>
            </Link>
          ))}
        </div>

        {/* Health footnotes — engagements + accounts in flight, kept */}
        {/* lightweight so the dashboard stays revenue-focused.        */}
        <div className="text-[11px] font-mono text-text-faint">
          {accountList.length} accounts · {engList.length} active engagements ·{" "}
          {oppList.length} total opportunities tracked.{" "}
          {fmtFullUsd(wonYtdValue)} won YTD, {fmtFullUsd(projectedFy)} projected FY{fiscalYear}.
        </div>
      </div>
    </div>
  );
}
