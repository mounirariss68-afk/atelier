/**
 * Account360Tab — account-level financials, relationship history & health
 * (Task #570). Read-only rollup of existing engagement / invoice /
 * opportunity data; per-engagement Financials screens remain the source of
 * truth and are unchanged. Fetched lazily from /accounts/:id/account-360.
 */

import * as React from "react";
import { Link } from "wouter";
import { useAtelierGetAccount360 } from "@workspace/api-client-react";
import type {
  AtelierAccountHealthFactor,
  AtelierAccountTimelineItem,
  AtelierAccountRenewal,
  AtelierAccountNextBestAction,
} from "@workspace/api-client-react";
import { Card, MonoChip, SectionHead } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

const fmtUsd = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

const BAND_TONE: Record<"green" | "amber" | "red", "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red",
};

const BAND_LABEL: Record<"green" | "amber" | "red", string> = {
  green: "Healthy",
  amber: "Watch",
  red: "At risk",
};

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-xs text-text-mute uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-lg font-semibold font-mono">{value}</div>
      {sub ? <div className="mt-1 text-xs text-text-mute">{sub}</div> : null}
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const TONE_DOT: Record<
  AtelierAccountTimelineItem["tone"],
  string
> = {
  default: "bg-text-faint",
  gold: "bg-gold",
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
};

export function Account360Tab({ accountId }: { accountId: string }) {
  const { data, isLoading, isError, error } = useAtelierGetAccount360(accountId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError) {
    const status = (error as { status?: number } | undefined)?.status;
    return (
      <Card className="p-6">
        <div className="text-sm text-text-mute font-mono">
          {status === 403
            ? "You don't have access to this account's financials."
            : "Unable to load account financials."}
        </div>
      </Card>
    );
  }

  if (!data) return null;
  const { financials: f, health, timeline, renewals, nextBestActions } = data;

  return (
    <div className="space-y-8" data-testid="account-360">
      {/* ---- Financial rollup ---- */}
      <section>
        <SectionHead headline="Financial rollup" lede="Across all engagements & invoices" />
        <Card className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            <Stat
              label="Recognised revenue"
              value={fmtUsd(f.recognisedRevenueUsd)}
              sub={`${(f.grossMarginPct * 100).toFixed(0)}% gross margin`}
            />
            <Stat
              label="Contract value"
              value={fmtUsd(f.contractValueUsd)}
              sub={`${f.engagementCount} engagement${f.engagementCount === 1 ? "" : "s"}`}
            />
            <Stat
              label="Active engagement value"
              value={fmtUsd(f.activeEngagementValueUsd)}
              sub={`${f.activeEngagementCount} active`}
            />
            <Stat
              label="Open pipeline"
              value={fmtUsd(f.openPipelineUsd)}
              sub={`${fmtUsd(f.weightedPipelineUsd)} weighted · ${f.openOpportunityCount} open`}
            />
            <Stat label="Billed to date" value={fmtUsd(f.billedUsd)} />
            <Stat label="Collected to date" value={fmtUsd(f.collectedUsd)} />
            <Stat
              label="Outstanding AR"
              value={fmtUsd(f.arOutstandingUsd)}
              sub={`${f.invoiceCount} invoice${f.invoiceCount === 1 ? "" : "s"}`}
            />
            <Stat
              label="Overdue AR"
              value={fmtUsd(f.arOverdueUsd)}
              sub={
                f.overdueInvoiceCount > 0
                  ? `${f.overdueInvoiceCount} overdue`
                  : "None overdue"
              }
            />
            <Stat
              label="Tooling spend"
              value={fmtUsd(f.toolingSpendUsd ?? 0)}
              sub="Approved AI/dev tool costs"
            />
          </div>
          {f.arOutstandingUsd > 0 && (
            <div className="mt-6 pt-5 border-t border-border-soft">
              <div className="text-xs text-text-mute uppercase tracking-wider mb-3">
                AR aging
              </div>
              <div className="grid grid-cols-5 gap-3 text-center">
                {[
                  { label: "Current", v: f.aging.current, tone: "green" as const },
                  { label: "1–30", v: f.aging.d30, tone: "default" as const },
                  { label: "31–60", v: f.aging.d60, tone: "amber" as const },
                  { label: "61–90", v: f.aging.d90, tone: "amber" as const },
                  { label: "90+", v: f.aging.d90plus, tone: "red" as const },
                ].map((b) => (
                  <div key={b.label}>
                    <div className="text-[11px] text-text-faint">{b.label}</div>
                    <div className="mt-1 font-mono text-sm">{fmtUsd(b.v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* ---- Composite health ---- */}
      <section>
        <SectionHead headline="Account health" lede="Relationship · financial · engagement · risk" />
        <Card className="p-6">
          <div className="flex items-center gap-5">
            <div className="text-center">
              <div className="text-4xl font-bold font-mono">{health.score}</div>
              <div className="mt-1">
                <MonoChip tone={BAND_TONE[health.band]}>
                  {BAND_LABEL[health.band]}
                </MonoChip>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {health.factors.map((factor: AtelierAccountHealthFactor) => (
                <div key={factor.key} className="border border-border-soft rounded p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-text-mute">
                      {factor.label}
                    </span>
                    <span className="font-mono text-sm font-semibold">
                      {factor.score}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 bg-bg-soft rounded overflow-hidden">
                    <div
                      className={`h-full ${
                        factor.score >= 70
                          ? "bg-emerald-400"
                          : factor.score >= 45
                            ? "bg-amber-400"
                            : "bg-red-400"
                      }`}
                      style={{ width: `${factor.score}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-text-mute">{factor.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* ---- Renewals / expansions + next-best-actions ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <SectionHead headline="Renewals & expansions" />
          <Card className="p-6">
            {renewals.length === 0 ? (
              <div className="text-sm text-text-mute font-mono">
                No renewals or open expansion opportunities.
              </div>
            ) : (
              <ul className="space-y-3">
                {renewals.map((r: AtelierAccountRenewal) => (
                  <li
                    key={r.id}
                    className="flex items-start justify-between gap-3 border-b border-border-soft last:border-0 pb-3 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <MonoChip tone={r.kind === "renewal" ? "amber" : "gold"}>
                          {r.kind}
                        </MonoChip>
                        <Link
                          href={
                            r.refKind === "opportunity"
                              ? `/opportunities/${r.refId}`
                              : `/engagements/${r.refId}`
                          }
                          className="text-sm font-medium truncate hover:underline"
                        >
                          {r.title}
                        </Link>
                      </div>
                      {r.detail && (
                        <div className="mt-1 text-xs text-text-mute">{r.detail}</div>
                      )}
                    </div>
                    {r.valueUsd > 0 && (
                      <div className="font-mono text-sm whitespace-nowrap">
                        {fmtUsd(r.valueUsd)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section>
          <SectionHead headline="Next best actions" />
          <Card className="p-6">
            {nextBestActions.length === 0 ? (
              <div className="text-sm text-text-mute font-mono">
                Nothing flagged — the account is in good shape.
              </div>
            ) : (
              <ul className="space-y-3">
                {nextBestActions.map((a: AtelierAccountNextBestAction) => {
                  const href =
                    a.refKind === "opportunity"
                      ? `/opportunities/${a.refId}`
                      : a.refKind === "engagement"
                        ? `/engagements/${a.refId}`
                        : null;
                  const label = (
                    <span className="text-sm font-medium">{a.label}</span>
                  );
                  return (
                    <li
                      key={a.id}
                      className="flex items-start gap-3 border-b border-border-soft last:border-0 pb-3 last:pb-0"
                    >
                      <MonoChip
                        tone={
                          a.priority === "high"
                            ? "red"
                            : a.priority === "low"
                              ? "default"
                              : "amber"
                        }
                      >
                        {a.priority}
                      </MonoChip>
                      <div className="min-w-0">
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                        {a.detail && (
                          <div className="mt-1 text-xs text-text-mute">{a.detail}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </section>
      </div>

      {/* ---- Relationship history timeline ---- */}
      <section>
        <SectionHead headline="Relationship history" lede="Engagements, deals & key milestones" />
        <Card className="p-6">
          {timeline.length === 0 ? (
            <div className="text-sm text-text-mute font-mono">
              No relationship history yet.
            </div>
          ) : (
            <ol className="relative border-l border-border-soft ml-2">
              {timeline.map((item: AtelierAccountTimelineItem) => {
                const href =
                  item.refKind === "opportunity"
                    ? `/opportunities/${item.refId}`
                    : item.refKind === "engagement"
                      ? `/engagements/${item.refId}`
                      : null;
                return (
                  <li key={item.id} className="ml-5 pb-5 last:pb-0">
                    <span
                      className={`absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full ${TONE_DOT[item.tone]}`}
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-text-faint">
                        {fmtDate(item.date)}
                      </span>
                      <MonoChip>{item.kind}</MonoChip>
                    </div>
                    <div className="mt-1 text-sm">
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </div>
                    {item.detail && (
                      <div className="mt-0.5 text-xs text-text-mute">{item.detail}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </section>
    </div>
  );
}
