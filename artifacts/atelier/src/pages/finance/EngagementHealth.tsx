/**
 * EngagementHealth — firm-level register of every engagement's P&L health
 * (Task #414, Wave 2).
 *
 * Surfaces EAC variance, forecast margin, RAG status, and open / approved
 * change-orders per engagement. Sortable + filterable so the CFO can scan
 * for the red and amber rows in one pass before drilling into the per-
 * engagement P&L page.
 */
import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BackLink, PageHero, SectionHead, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { ArrowRight, AlertTriangle } from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

type Rag = "green" | "amber" | "red";

interface HealthRow {
  engagementId: string;
  engagementName: string;
  contractValueUsd: number;
  bacUsd: number;
  ctdUsd: number;
  etcUsd: number;
  etcMethod: "manual" | "extrapolation";
  eacUsd: number;
  vacUsd: number;
  vacPctOfBac: number;
  forecastFinalMarginPct: number;
  plannedMarginPct: number;
  marginSlippagePct: number;
  pctComplete: number;
  pctBilled: number;
  ragStatus: Rag;
  partnerOwnerId: string;
  partnerOwnerName: string;
  engagementLeadId: string;
  engagementLeadName: string;
  sector: string;
  openChangeOrders: number;
  approvedChangeOrders: number;
  changeOrderValueUsd: number;
  revenueRecognisedToDateUsd: number;
  invoicedToDateUsd: number;
  cashCollectedToDateUsd: number;
  grossMarginToDatePct: number;
  wipUsd: number;
  arUsd: number;
  lockupUsd: number;
}

const fmtUsd = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtPctSigned = (n: number) =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

const RAG_TONE: Record<Rag, "green" | "amber" | "red"> = {
  green: "green",
  amber: "amber",
  red: "red",
};

type SortKey = "default" | "vac" | "margin-slip" | "margin" | "contract" | "rag" | "complete";
type SlipBand = "all" | "slipping" | "on-plan" | "ahead";
type CompleteBand = "all" | "early" | "mid" | "late";

export default function EngagementHealth(): JSX.Element {
  const [sortKey, setSortKey] = React.useState<SortKey>("default");
  const [ragFilter, setRagFilter] = React.useState<"all" | Rag>("all");
  const [partnerFilter, setPartnerFilter] = React.useState<string>("all");
  const [sectorFilter, setSectorFilter] = React.useState<string>("all");
  const [slipFilter, setSlipFilter] = React.useState<SlipBand>("all");
  const [completeFilter, setCompleteFilter] = React.useState<CompleteBand>("all");

  const q = useQuery<{ items: HealthRow[] }>({
    queryKey: ["finance", "engagement-pnl", "register"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/finance/engagement-pnl`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`engagement_pnl_${r.status}`);
      return (await r.json()) as { items: HealthRow[] };
    },
  });

  const partnerOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const r of q.data?.items ?? []) map.set(r.partnerOwnerId, r.partnerOwnerName);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [q.data]);
  const sectorOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of q.data?.items ?? []) set.add(r.sector);
    return Array.from(set).sort();
  }, [q.data]);

  const rows = React.useMemo(() => {
    const items = q.data?.items ?? [];
    const filtered = items.filter((i) => {
      if (ragFilter !== "all" && i.ragStatus !== ragFilter) return false;
      if (partnerFilter !== "all" && i.partnerOwnerId !== partnerFilter) return false;
      if (sectorFilter !== "all" && i.sector !== sectorFilter) return false;
      if (slipFilter === "slipping" && i.marginSlippagePct >= -0.005) return false;
      if (slipFilter === "on-plan" && Math.abs(i.marginSlippagePct) > 0.02) return false;
      if (slipFilter === "ahead" && i.marginSlippagePct <= 0.005) return false;
      if (completeFilter === "early" && !(i.pctComplete < 0.34)) return false;
      if (completeFilter === "mid" && !(i.pctComplete >= 0.34 && i.pctComplete < 0.67)) return false;
      if (completeFilter === "late" && !(i.pctComplete >= 0.67)) return false;
      return true;
    });
    const sorted = filtered.slice().sort((a, b) => {
      if (sortKey === "default") {
        // Combined risk score: VAC% of BAC + margin slippage; most distressed first
        const score = (r: HealthRow) => r.vacPctOfBac + r.marginSlippagePct;
        return score(a) - score(b);
      }
      if (sortKey === "vac") return a.vacUsd - b.vacUsd;
      if (sortKey === "margin-slip") return a.marginSlippagePct - b.marginSlippagePct;
      if (sortKey === "margin") return a.forecastFinalMarginPct - b.forecastFinalMarginPct;
      if (sortKey === "contract") return b.contractValueUsd - a.contractValueUsd;
      if (sortKey === "complete") return a.pctComplete - b.pctComplete;
      const order: Record<Rag, number> = { red: 0, amber: 1, green: 2 };
      return order[a.ragStatus] - order[b.ragStatus];
    });
    return sorted;
  }, [q.data, sortKey, ragFilter, partnerFilter, sectorFilter, slipFilter, completeFilter]);

  const totals = React.useMemo(() => {
    const items = q.data?.items ?? [];
    const totalContract = items.reduce((s, r) => s + r.contractValueUsd, 0);
    const totalBac = items.reduce((s, r) => s + r.bacUsd, 0);
    const totalEac = items.reduce((s, r) => s + r.eacUsd, 0);
    const totalVac = totalBac - totalEac;
    const portfolioMargin = totalContract > 0 ? (totalContract - totalEac) / totalContract : 0;
    const atRisk = items.filter((r) => r.ragStatus !== "green").length;
    const openCos = items.reduce((s, r) => s + r.openChangeOrders, 0);
    return { totalContract, totalVac, portfolioMargin, atRisk, openCos, count: items.length };
  }, [q.data]);

  return (
    <div>
      <PageHero>
        <BackLink href="/finance/plan" className="mb-4" data-testid="link-back">
          Back to plan
        </BackLink>
        <SectionHead
          eyebrow="Finance · Plan · Engagement Health"
          headline="Engagement P&L register"
          lede="Per-engagement EAC, variance vs baseline budget, and forecast final margin. Drill into any row for the per-engagement P&L, EAC engine, change orders and audit trail."
        />
      </PageHero>
      <div className="px-6 py-10 max-w-[1400px] mx-auto">

      <div className="mt-8 grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryTile label="Engagements" value={String(totals.count)} />
        <SummaryTile label="Contract value" value={fmtUsd(totals.totalContract)} />
        <SummaryTile
          label="EAC variance vs baseline"
          value={fmtUsd(totals.totalVac)}
          tone={totals.totalVac < 0 ? "red" : totals.totalVac === 0 ? "default" : "green"}
        />
        <SummaryTile
          label="Portfolio forecast margin"
          value={fmtPct(totals.portfolioMargin)}
          tone={totals.portfolioMargin < 0.30 ? "red" : totals.portfolioMargin < 0.40 ? "amber" : "green"}
        />
        <SummaryTile
          label="At-risk · open COs"
          value={`${totals.atRisk} · ${totals.openCos}`}
          tone={totals.atRisk > 0 ? "amber" : "default"}
        />
      </div>

      <div className="mt-8 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="font-mono text-xs uppercase tracking-wider text-text-faint mr-2">RAG</span>
          {(["all", "red", "amber", "green"] as const).map((k) => (
            <PillButton
              key={k}
              variant={ragFilter === k ? "primary" : "ghost"}
              onClick={() => setRagFilter(k)}
              data-testid={`button-rag-${k}`}
            >
              {k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1)}
            </PillButton>
          ))}
          <span className="ml-4 font-mono text-xs uppercase tracking-wider text-text-faint mr-2">Margin slip</span>
          {([
            ["all", "All"],
            ["slipping", "Slipping"],
            ["on-plan", "On plan"],
            ["ahead", "Ahead"],
          ] as Array<[SlipBand, string]>).map(([k, label]) => (
            <PillButton
              key={k}
              variant={slipFilter === k ? "primary" : "ghost"}
              onClick={() => setSlipFilter(k)}
              data-testid={`button-slip-${k}`}
            >
              {label}
            </PillButton>
          ))}
          <span className="ml-4 font-mono text-xs uppercase tracking-wider text-text-faint mr-2">% complete</span>
          {([
            ["all", "All"],
            ["early", "Early"],
            ["mid", "Mid"],
            ["late", "Late"],
          ] as Array<[CompleteBand, string]>).map(([k, label]) => (
            <PillButton
              key={k}
              variant={completeFilter === k ? "primary" : "ghost"}
              onClick={() => setCompleteFilter(k)}
              data-testid={`button-complete-${k}`}
            >
              {label}
            </PillButton>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="font-mono text-xs uppercase tracking-wider text-text-faint">
            Partner
            <select
              value={partnerFilter}
              onChange={(e) => setPartnerFilter(e.target.value)}
              className="ml-2 rounded border border-border bg-bg p-1.5 text-xs font-mono text-text"
              data-testid="select-partner"
            >
              <option value="all">All partners</option>
              {partnerOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
          <label className="font-mono text-xs uppercase tracking-wider text-text-faint">
            Sector
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="ml-2 rounded border border-border bg-bg p-1.5 text-xs font-mono text-text"
              data-testid="select-sector"
            >
              <option value="all">All sectors</option>
              {sectorOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <span className="ml-4 font-mono text-xs uppercase tracking-wider text-text-faint">Sort</span>
          {([
            ["default", "Risk score (default)"],
            ["vac", "Variance"],
            ["margin-slip", "Margin slip"],
            ["margin", "Forecast margin"],
            ["contract", "Contract"],
            ["complete", "% complete"],
            ["rag", "RAG"],
          ] as Array<[SortKey, string]>).map(([k, label]) => (
            <PillButton
              key={k}
              variant={sortKey === k ? "primary" : "ghost"}
              onClick={() => setSortKey(k)}
              data-testid={`button-sort-${k}`}
            >
              {label}
            </PillButton>
          ))}
        </div>
      </div>

      <Card className="mt-6 p-0 overflow-hidden">
        {q.isLoading && (
          <div className="p-6 font-mono text-sm text-text-mute">Loading register…</div>
        )}
        {q.isError && (
          <div className="p-6 font-mono text-sm text-danger">Failed to load engagement register.</div>
        )}
        {q.data && rows.length === 0 && (
          <div className="p-6 font-mono text-sm text-text-mute">No engagements match this filter.</div>
        )}
        {rows.length > 0 && (
          <table className="w-full text-sm" data-testid="table-engagement-health">
            <thead className="bg-bg-elevate/60 text-text-faint font-mono text-[11px] uppercase tracking-wider">
              <tr>
                <th className="text-left p-3">Engagement</th>
                <th className="text-right p-3">Contract</th>
                <th className="text-right p-3">BAC</th>
                <th className="text-right p-3">CTD</th>
                <th className="text-right p-3">EAC</th>
                <th className="text-right p-3">VAC</th>
                <th className="text-right p-3">Fcst margin</th>
                <th className="text-right p-3">% complete</th>
                <th className="text-center p-3">RAG</th>
                <th className="text-right p-3">Open · Apprvd COs</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.engagementId}
                  className="border-t border-border-soft hover:bg-bg-elevate/40"
                  data-testid={`row-eng-${r.engagementId}`}
                >
                  <td className="p-3">
                    <div className="font-medium text-text">{r.engagementName}</div>
                    <div className="text-[11px] font-mono text-text-faint">{r.sector}</div>
                  </td>
                  <td className="p-3 text-right font-mono">{fmtUsd(r.contractValueUsd)}</td>
                  <td className="p-3 text-right font-mono">{fmtUsd(r.bacUsd)}</td>
                  <td className="p-3 text-right font-mono">{fmtUsd(r.ctdUsd)}</td>
                  <td className="p-3 text-right font-mono">{fmtUsd(r.eacUsd)}</td>
                  <td
                    className={`p-3 text-right font-mono ${r.vacUsd < 0 ? "text-danger" : "text-text"}`}
                  >
                    {fmtUsd(r.vacUsd)}
                    <div className="text-[11px] text-text-faint">{fmtPctSigned(r.vacPctOfBac)}</div>
                  </td>
                  <td className="p-3 text-right font-mono">
                    {fmtPct(r.forecastFinalMarginPct)}
                    <div className="text-[11px] text-text-faint">
                      plan {fmtPct(r.plannedMarginPct)}
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono">{fmtPct(r.pctComplete)}</td>
                  <td className="p-3 text-center">
                    <MonoChip tone={RAG_TONE[r.ragStatus]}>{r.ragStatus}</MonoChip>
                  </td>
                  <td className="p-3 text-right font-mono">
                    <span className={r.openChangeOrders > 0 ? "text-amber" : "text-text"}>
                      {r.openChangeOrders}
                    </span>{" "}
                    · {r.approvedChangeOrders}
                  </td>
                  <td className="p-3 text-right">
                    <Link href={`/finance/plan/engagement-pnl/${r.engagementId}`}>
                      <a
                        className="inline-flex items-center gap-1 text-gold hover:underline text-xs font-mono"
                        data-testid={`link-pnl-${r.engagementId}`}
                      >
                        Open <ArrowRight className="w-3 h-3" />
                      </a>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {totals.atRisk > 0 && (
        <div className="mt-6 flex items-start gap-3 rounded border border-amber/40 bg-amber/5 p-4">
          <AlertTriangle className="w-5 h-5 text-amber mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-text">{totals.atRisk} engagement{totals.atRisk === 1 ? "" : "s"} in amber/red.</div>
            <div className="text-text-mute mt-1">
              Drill into the per-engagement P&L to review EAC drivers, manual ETC overrides and the change-order register.
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "green" | "amber" | "red";
}): JSX.Element {
  const toneClass =
    tone === "red"
      ? "text-danger"
      : tone === "amber"
      ? "text-amber"
      : tone === "green"
      ? "text-green-400"
      : "text-text";
  return (
    <Card className="p-4">
      <div className="font-mono text-[11px] uppercase tracking-wider text-text-faint">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}
