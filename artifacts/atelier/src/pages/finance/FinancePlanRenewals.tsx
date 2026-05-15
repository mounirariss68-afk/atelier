/**
 * FinancePlanRenewals — subscription / framework renewal calendar (Task #440).
 *
 * Surfaces the upcoming renewals across the firm — SaaS, MSAs / frameworks,
 * vendor contracts and licences — with owner, value, notice window and
 * derived risk score so finance can plan negotiations against the same
 * 13-week strip the cash forecast uses.
 */

import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { useRenewals, usePlanEntities, type RenewalRow, type RenewalKind, type RenewalStatus } from "@/lib/v5-hooks";

const PRESENTATION_CURRENCIES = ["USD", "GBP", "AED", "SAR", "EUR"];

function fmt(n: number, currency: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${currency} ${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}${currency} ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${currency} ${abs.toFixed(0)}`;
}

const KIND_LABEL: Record<RenewalKind, string> = {
  subscription: "Subscription",
  framework: "Framework / MSA",
  vendor: "Vendor",
  license: "Licence",
};
const KIND_TONE: Record<RenewalKind, "default" | "gold" | "green" | "amber"> = {
  subscription: "default",
  framework: "gold",
  vendor: "default",
  license: "amber",
};
const STATUS_TONE: Record<RenewalStatus, "default" | "gold" | "green" | "amber" | "red"> = {
  on_track: "green",
  at_risk: "amber",
  in_negotiation: "gold",
  overdue: "red",
};
const STATUS_LABEL: Record<RenewalStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  in_negotiation: "In negotiation",
  overdue: "Overdue",
};

const KIND_FILTERS: { id: "all" | RenewalKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "subscription", label: "Subscriptions" },
  { id: "framework", label: "Frameworks / MSAs" },
  { id: "vendor", label: "Vendors" },
  { id: "license", label: "Licences" },
];

function leadTimeLabel(r: RenewalRow): string {
  if (r.daysUntilRenewal < 0) return `overdue · ${Math.abs(r.daysUntilRenewal)}d ago`;
  return `in ${r.daysUntilRenewal}d · ${(r.daysUntilRenewal / 7).toFixed(1)}w`;
}
function noticeLabel(r: RenewalRow): string {
  if (r.daysUntilRenewal < 0) return "renewal lapsed";
  if (r.noticeWindowOpensInDays > 0) return `notice opens in ${r.noticeWindowOpensInDays}d`;
  return `notice window open · ${r.noticePeriodDays}d`;
}

export default function FinancePlanRenewals() {
  const entities = usePlanEntities();
  const [presentation, setPresentation] = React.useState("USD");
  const [entityFilter, setEntityFilter] = React.useState<string | null>(null);
  const [kindFilter, setKindFilter] = React.useState<"all" | RenewalKind>("all");
  const { data } = useRenewals(presentation, entityFilter);

  const items = React.useMemo(() => {
    if (!data) return [];
    return kindFilter === "all" ? data.items : data.items.filter((r) => r.kind === kindFilter);
  }, [data, kindFilter]);

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-finance-plan-renewals">
      <PageHero>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <SectionHead
            eyebrow="Manage · Finance · Plan"
            headline="Renewals"
            lede="Subscription, framework and vendor renewals — owner, annual value, notice window and lead-time. Stress-test renewal risk against the 13-week strip and the long-range plan."
          />
          <div className="flex items-center gap-2 text-xs font-mono">
            <select
              value={entityFilter ?? "consolidated"}
              onChange={(e) => setEntityFilter(e.target.value === "consolidated" ? null : e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
              data-testid="select-entity"
            >
              <option value="consolidated">Consolidated</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.shortName}</option>)}
            </select>
            <select
              value={presentation}
              onChange={(e) => setPresentation(e.target.value)}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
              data-testid="select-currency"
            >
              {PRESENTATION_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {!data ? (
          <Card className="p-6 text-text-mute">Loading renewals…</Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="renewals-kpis">
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Renewals · next 13w</div>
                <div className="text-2xl font-display mt-1" data-testid="kpi-count-13w">{data.totals.countNext13w}</div>
                <div className="text-xs text-text-mute font-mono mt-1">{fmt(data.totals.valueNext13wPresentation, presentation)} ARR</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Renewals · next 26w</div>
                <div className="text-2xl font-display mt-1">{data.totals.countNext26w}</div>
                <div className="text-xs text-text-mute font-mono mt-1">{fmt(data.totals.valueNext26wPresentation, presentation)} ARR</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">At-risk renewals</div>
                <div className={`text-2xl font-display mt-1 ${data.totals.atRiskCount > 0 ? "text-amber-500" : ""}`} data-testid="kpi-at-risk">
                  {data.totals.atRiskCount}
                </div>
                <div className="text-xs text-text-mute font-mono mt-1">{fmt(data.totals.atRiskValuePresentation, presentation)} exposed</div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] font-mono uppercase text-text-faint">Total tracked</div>
                <div className="text-2xl font-display mt-1">{data.items.length}</div>
                <div className="text-xs text-text-mute font-mono mt-1">across all kinds</div>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <CutCard title="By kind" rows={data.byKind.map((r) => ({ key: KIND_LABEL[r.kind], count: r.count, value: r.valuePresentation }))} presentation={presentation} testId="cut-kind" />
              <CutCard title="By owner" rows={data.byOwner.map((r) => ({ key: r.owner, count: r.count, value: r.valuePresentation }))} presentation={presentation} testId="cut-owner" />
            </div>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="font-mono text-xs uppercase text-text-faint">Upcoming renewals</div>
                <div className="flex items-center gap-1 text-[11px] font-mono">
                  {KIND_FILTERS.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => setKindFilter(k.id)}
                      className={`px-2 py-1 rounded border transition-colors ${
                        kindFilter === k.id ? "border-gold/50 text-gold" : "border-border text-text-mute hover:text-text"
                      }`}
                      data-testid={`filter-${k.id}`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>
              <table className="w-full text-sm" data-testid="renewals-table">
                <thead className="text-[11px] font-mono uppercase text-text-faint">
                  <tr>
                    <th className="text-left px-2 py-1">Counterparty</th>
                    <th className="text-left px-2 py-1">Kind</th>
                    <th className="text-left px-2 py-1">Owner</th>
                    <th className="text-left px-2 py-1">Renews</th>
                    <th className="text-left px-2 py-1">Lead-time</th>
                    <th className="text-left px-2 py-1">Notice</th>
                    <th className="text-left px-2 py-1">Status</th>
                    <th className="text-right px-2 py-1">Risk</th>
                    <th className="text-right px-2 py-1">Annual value</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-t border-border-soft align-top" data-testid={`row-${r.id}`}>
                      <td className="px-2 py-2">
                        <div className="text-text">{r.counterparty}</div>
                        <div className="text-xs text-text-mute">{r.description}</div>
                      </td>
                      <td className="px-2 py-2"><MonoChip tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</MonoChip></td>
                      <td className="px-2 py-2">
                        <div>{r.ownerName}</div>
                        <div className="text-xs text-text-mute">{r.ownerRole}</div>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{r.renewsOn}</td>
                      <td className={`px-2 py-2 text-xs ${r.daysUntilRenewal < 0 ? "text-danger" : r.daysUntilRenewal <= 30 ? "text-amber-500" : "text-text-mute"}`}>
                        {leadTimeLabel(r)}
                      </td>
                      <td className="px-2 py-2 text-xs text-text-mute">
                        {noticeLabel(r)}
                        {r.autoRenew ? <span className="ml-1 text-text-faint">· auto-renew</span> : null}
                      </td>
                      <td className="px-2 py-2"><MonoChip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</MonoChip></td>
                      <td className="px-2 py-2 text-right">
                        <RiskPill score={r.riskScore} />
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {fmt(r.annualValuePresentation, presentation)}
                        <div className="text-[10px] text-text-faint">{r.currency} {(r.annualValueLocal / 1000).toFixed(0)}k local</div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 ? (
                    <tr><td colSpan={9} className="px-2 py-4 text-center text-text-mute">No renewals match the current filter.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </Card>

            <div className="text-xs text-text-mute font-mono">
              As-of {data.asOf} · {data.entityFilter ? entities.find((e) => e.id === data.entityFilter)?.shortName ?? data.entityFilter : "Consolidated"} · presentation {presentation}
              <Link href="/finance/plan/scenarios" className="ml-3 text-gold hover:underline">→ Scenarios</Link>
              <Link href="/finance/plan/cash-13w" className="ml-3 text-gold hover:underline">→ 13-week cash</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RiskPill({ score }: { score: number }) {
  const tone = score >= 75 ? "text-danger border-danger/40" : score >= 50 ? "text-amber-500 border-amber-500/40" : "text-success border-success/40";
  return (
    <span className={`inline-flex items-center justify-center min-w-[2.4rem] px-1.5 py-0.5 rounded border text-[11px] font-mono ${tone}`}>
      {score}
    </span>
  );
}

function CutCard({ title, rows, presentation, testId }: { title: string; rows: { key: string; count: number; value: number }[]; presentation: string; testId: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card className="p-4" data-testid={testId}>
      <div className="font-mono text-xs uppercase text-text-faint mb-3">{title}</div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between text-xs gap-2">
              <span className="truncate"><span className="text-text-mute mr-1">{r.count}×</span>{r.key}</span>
              <span className="font-mono text-text-mute whitespace-nowrap">{fmt(r.value, presentation)}</span>
            </div>
            <div className="relative h-2 bg-bg-elevate rounded mt-1 overflow-hidden">
              <div className="absolute top-0 left-0 h-full bg-gold/70" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
