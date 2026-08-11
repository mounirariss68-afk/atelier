/**
 * FinanceReportsMargin — margin / realization reporting suite (Task #434).
 *
 * Four views over the /margin-reports/* API:
 *   • Client margin — account-level gross-margin rollups with period /
 *     entity / partner filters.
 *   • Net margin — gross margin less allocated GL overhead, with the
 *     allocation basis visible and a tie-out check against the GL total.
 *   • Realization — sold vs delivered per engagement, leakage decomposed
 *     into rate variance, hours overrun, scope write-offs and expense
 *     non-recovery.
 *   • Sold positions — the immutable contract-stage baselines + backfill.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";

const API_BASE = "/api/atelier";

async function jsonReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (data as { message?: string; error?: string }).message ??
      (data as { error?: string }).error ??
      `${res.status}`;
    throw new Error(detail);
  }
  return data as T;
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}
function pctTone(p: number): string {
  return p >= 0.45 ? "text-emerald-400" : p >= 0.25 ? "text-text" : "text-amber-400";
}

// ---------------------------------------------------------------------------
// API shapes (mirror artifacts/api-server/src/lib/atelier-margin-reporting.ts)
// ---------------------------------------------------------------------------
interface ClientMarginResp {
  rows: Array<{
    accountId: string;
    accountName: string;
    engagementCount: number;
    revenueRecognised: number;
    directCost: number;
    grossMarginAmount: number;
    grossMarginPct: number;
    leakageAmount: number;
    engagements: Array<{
      engagementId: string;
      engagementName: string;
      partnerOwnerId: string | null;
      entityId: string | null;
      revenueRecognised: number;
      grossMarginAmount: number;
      grossMarginPct: number;
    }>;
  }>;
  totals: { revenueRecognised: number; directCost: number; grossMarginAmount: number; grossMarginPct: number };
  entityDerivation: string;
}
interface NetMarginResp {
  basis: "revenue" | "direct_cost" | "hours";
  glAccountCodes: string[];
  overheadPoolUsd: number;
  overheadLineCount: number;
  allocatedTotalUsd: number;
  tiesToGl: boolean;
  unallocatedUsd: number;
  basisNote: string;
  rows: Array<{
    engagementId: string;
    engagementName: string;
    accountName: string;
    revenueRecognised: number;
    grossMarginAmount: number;
    grossMarginPct: number;
    basisValue: number;
    basisShare: number;
    allocatedOverheadUsd: number;
    netMarginAmount: number;
    netMarginPct: number;
  }>;
}
interface AllocationConfig {
  basis: "revenue" | "direct_cost" | "hours";
  glAccountCodes: string[];
  notes: string;
}
interface RealizationResp {
  note: string;
  rows: Array<{
    engagementId: string;
    engagementName: string;
    accountName: string;
    sold: {
      hasPricing: boolean;
      priceUsd: number;
      hours: number;
      effectiveRateUsd: number;
      marginPct: number;
      targetMarginPct: number;
    } | null;
    delivered: {
      revenueRecognised: number;
      hoursBillable: number;
      effectiveRateUsd: number;
      grossMarginPct: number;
    };
    realizationRate: number | null;
    leakage: {
      totalUsd: number;
      rateVarianceUsd: number;
      hoursOverrunUsd: number;
      scopeWriteOffsUsd: number;
      expenseNonRecoveryUsd: number;
    } | null;
  }>;
}
interface SoldPositionsResp {
  rows: Array<{
    id: string;
    opportunityId: string;
    engagementId: string | null;
    accountId: string;
    capturedAt: string;
    source: string;
    hasPricing: boolean;
    pricingModel: string | null;
    durationWeeks: number;
    soldHours: number;
    soldPriceUsd: number;
    soldCostUsd: number;
    soldMarginPct: number;
    targetMarginPct: number;
    soldEffectiveRateUsd: number;
  }>;
}

// ---------------------------------------------------------------------------

type Tab = "clients" | "net" | "realization" | "sold";
const TABS: { id: Tab; label: string }[] = [
  { id: "clients", label: "Client margin" },
  { id: "net", label: "Net margin" },
  { id: "realization", label: "Realization" },
  { id: "sold", label: "Sold positions" },
];

function FilterBar({
  periodFrom,
  periodTo,
  partnerId,
  entityId,
  onChange,
  showEntity,
}: {
  periodFrom: string;
  periodTo: string;
  partnerId: string;
  entityId: string;
  showEntity?: boolean;
  onChange: (n: { periodFrom?: string; periodTo?: string; partnerId?: string; entityId?: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs font-mono uppercase tracking-widest text-text-faint">
        From (YYYY-MM)
        <Input value={periodFrom} onChange={(e) => onChange({ periodFrom: e.target.value })} placeholder="2026-01" className="mt-1 w-32" data-testid="input-period-from" />
      </label>
      <label className="text-xs font-mono uppercase tracking-widest text-text-faint">
        To (YYYY-MM)
        <Input value={periodTo} onChange={(e) => onChange({ periodTo: e.target.value })} placeholder="2026-07" className="mt-1 w-32" data-testid="input-period-to" />
      </label>
      <label className="text-xs font-mono uppercase tracking-widest text-text-faint">
        Partner id
        <Input value={partnerId} onChange={(e) => onChange({ partnerId: e.target.value })} placeholder="all partners" className="mt-1 w-44" data-testid="input-partner" />
      </label>
      {showEntity && (
        <label className="text-xs font-mono uppercase tracking-widest text-text-faint">
          Entity id
          <Input value={entityId} onChange={(e) => onChange({ entityId: e.target.value })} placeholder="all entities" className="mt-1 w-44" data-testid="input-entity" />
        </label>
      )}
    </div>
  );
}

const PERIOD_RE = /^\d{4}-\d{2}$/;
function qp(params: Record<string, string>): string {
  const clean = Object.entries(params).filter(([k, v]) => {
    if (!v.trim()) return false;
    if ((k === "periodFrom" || k === "periodTo") && !PERIOD_RE.test(v.trim())) return false;
    return true;
  });
  return clean.length ? `?${new URLSearchParams(Object.fromEntries(clean.map(([k, v]) => [k, v.trim()]))).toString()}` : "";
}

export default function FinanceReportsMargin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("clients");
  const [periodFrom, setPeriodFrom] = React.useState("");
  const [periodTo, setPeriodTo] = React.useState("");
  const [partnerId, setPartnerId] = React.useState("");
  const [entityId, setEntityId] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const onFilter = (n: { periodFrom?: string; periodTo?: string; partnerId?: string; entityId?: string }) => {
    if (n.periodFrom !== undefined) setPeriodFrom(n.periodFrom);
    if (n.periodTo !== undefined) setPeriodTo(n.periodTo);
    if (n.partnerId !== undefined) setPartnerId(n.partnerId);
    if (n.entityId !== undefined) setEntityId(n.entityId);
  };

  const filterQs = qp({ periodFrom, periodTo, partnerId, entityId });
  const clients = useQuery({
    queryKey: ["margin-reports", "clients", filterQs],
    queryFn: () => jsonReq<ClientMarginResp>("GET", `/margin-reports/clients${filterQs}`),
    enabled: tab === "clients",
  });
  const net = useQuery({
    queryKey: ["margin-reports", "net", qp({ periodFrom, periodTo })],
    queryFn: () => jsonReq<NetMarginResp>("GET", `/margin-reports/net${qp({ periodFrom, periodTo })}`),
    enabled: tab === "net",
  });
  const cfg = useQuery({
    queryKey: ["margin-reports", "allocation-config"],
    queryFn: () => jsonReq<AllocationConfig>("GET", "/margin-reports/allocation-config"),
    enabled: tab === "net",
  });
  const realization = useQuery({
    queryKey: ["margin-reports", "realization", qp({ periodFrom, periodTo, partnerId })],
    queryFn: () => jsonReq<RealizationResp>("GET", `/margin-reports/realization${qp({ periodFrom, periodTo, partnerId })}`),
    enabled: tab === "realization",
  });
  const sold = useQuery({
    queryKey: ["margin-reports", "sold-positions"],
    queryFn: () => jsonReq<SoldPositionsResp>("GET", "/margin-reports/sold-positions"),
    enabled: tab === "sold",
  });

  const setBasis = async (basis: AllocationConfig["basis"]) => {
    if (!cfg.data) return;
    setBusy("basis");
    try {
      await jsonReq("PUT", "/margin-reports/allocation-config", { ...cfg.data, basis });
      await qc.invalidateQueries({ queryKey: ["margin-reports"] });
      toast({ title: "Allocation basis updated", description: `Overhead now allocated by ${basis.replace("_", " ")}.` });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runBackfill = async () => {
    setBusy("backfill");
    try {
      const out = await jsonReq<{ scanned: number; captured: number; skipped: number }>("POST", "/margin-reports/sold-positions/backfill");
      await qc.invalidateQueries({ queryKey: ["margin-reports"] });
      toast({ title: "Backfill complete", description: `${out.scanned} contract opportunities scanned — ${out.captured} captured, ${out.skipped} already had a snapshot.` });
    } catch (e) {
      toast({ title: "Backfill failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const runSentinel = async () => {
    setBusy("sentinel");
    try {
      const out = await jsonReq<{ alertsWritten: number; engagementsScanned: number }>("POST", "/margin-reports/sentinel/run");
      toast({ title: "Margin Sentinel ran", description: `${out.engagementsScanned} engagements scanned, ${out.alertsWritten} new alerts.` });
    } catch (e) {
      toast({ title: "Sentinel run failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen text-text" data-testid="page-finance-reports-margin">
      <PageHero>
        <SectionHead
          eyebrow="Manage · Finance · Report"
          headline="Margin & realization"
          lede="Client-level margin rollups, net margin after GL overhead allocation, and sold-vs-delivered realization with leakage decomposed. Baselines come from immutable sold-position snapshots captured when a deal reaches Contract."
        />
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={`tab-${t.id}`}
              className={`px-3 py-1.5 rounded-md text-sm border ${tab === t.id ? "border-accent text-accent" : "border-border-soft text-text-mute hover:text-text"}`}
            >
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={runSentinel} disabled={busy !== null} data-testid="button-run-sentinel">
            {busy === "sentinel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            <span className="ml-1.5">Run Margin Sentinel</span>
          </Button>
        </div>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        {(tab === "clients" || tab === "realization") && (
          <Card className="p-4">
            <FilterBar periodFrom={periodFrom} periodTo={periodTo} partnerId={partnerId} entityId={entityId} showEntity={tab === "clients"} onChange={onFilter} />
          </Card>
        )}

        {tab === "clients" && (
          <Card className="p-4">
            <SectionHead headline="Client margin rollups" />
            {clients.isLoading ? (
              <div className="py-8 text-center text-text-faint"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
            ) : clients.error ? (
              <p className="text-amber-400 text-sm py-4">{String((clients.error as Error).message)}</p>
            ) : !clients.data?.rows.length ? (
              <p className="text-text-faint text-sm py-4">No margin snapshots match — refresh engagement margin snapshots first (Wallet → Margin).</p>
            ) : (
              <>
                <table className="w-full text-sm mt-3">
                  <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                    <tr className="border-b border-border-soft">
                      <th className="text-left py-2">Client</th>
                      <th className="text-right py-2">Engs</th>
                      <th className="text-right py-2">Revenue</th>
                      <th className="text-right py-2">Direct cost</th>
                      <th className="text-right py-2">GM</th>
                      <th className="text-right py-2">GM %</th>
                      <th className="text-right py-2">Leakage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.data.rows.map((r) => (
                      <tr key={r.accountId} className="border-b border-border-soft/40" data-testid={`row-client-${r.accountId}`}>
                        <td className="py-1.5">{r.accountName}</td>
                        <td className="py-1.5 text-right tabular-nums text-text-mute">{r.engagementCount}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.revenueRecognised)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.directCost)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.grossMarginAmount)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${pctTone(r.grossMarginPct)}`}>{fmtPct(r.grossMarginPct)}</td>
                        <td className="py-1.5 text-right tabular-nums text-amber-400">{fmtUsd(r.leakageAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium">
                      <td className="py-2">Total</td>
                      <td />
                      <td className="py-2 text-right tabular-nums" data-testid="text-clients-total-revenue">{fmtUsd(clients.data.totals.revenueRecognised)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtUsd(clients.data.totals.directCost)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtUsd(clients.data.totals.grossMarginAmount)}</td>
                      <td className={`py-2 text-right tabular-nums ${pctTone(clients.data.totals.grossMarginPct)}`}>{fmtPct(clients.data.totals.grossMarginPct)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                <p className="text-xs text-text-faint mt-3">{clients.data.entityDerivation}</p>
              </>
            )}
          </Card>
        )}

        {tab === "net" && (
          <>
            <Card className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <SectionHead headline="Overhead allocation" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono uppercase tracking-widest text-text-faint">Basis</span>
                  {(["revenue", "direct_cost", "hours"] as const).map((b) => (
                    <button
                      key={b}
                      onClick={() => setBasis(b)}
                      disabled={busy !== null}
                      data-testid={`button-basis-${b}`}
                      className={`px-2.5 py-1 rounded text-xs border ${cfg.data?.basis === b ? "border-accent text-accent" : "border-border-soft text-text-mute hover:text-text"}`}
                    >
                      {b.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
              {net.data && (
                <div className="mt-3 flex flex-wrap gap-2 items-center text-sm">
                  <MonoChip>GL overhead pool {fmtUsd(net.data.overheadPoolUsd)}</MonoChip>
                  <MonoChip>{net.data.overheadLineCount} GL lines</MonoChip>
                  <MonoChip>Allocated {fmtUsd(net.data.allocatedTotalUsd)}</MonoChip>
                  <span className={net.data.tiesToGl ? "text-emerald-400 text-xs" : "text-amber-400 text-xs"} data-testid="text-tie-out">
                    {net.data.tiesToGl ? "✓ ties to GL total" : `⚠ ${fmtUsd(net.data.unallocatedUsd)} unallocated (no basis activity)`}
                  </span>
                  <span className="text-xs text-text-faint w-full">{net.data.basisNote}{net.data.glAccountCodes.length ? ` Pool restricted to GL accounts ${net.data.glAccountCodes.join(", ")}.` : " Pool = all expense-type GL accounts without an engagement dimension."}</span>
                </div>
              )}
            </Card>
            <Card className="p-4">
              <SectionHead headline="Net margin by engagement" />
              {net.isLoading ? (
                <div className="py-8 text-center text-text-faint"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
              ) : !net.data?.rows.length ? (
                <p className="text-text-faint text-sm py-4">No engagement margin snapshots available.</p>
              ) : (
                <table className="w-full text-sm mt-3">
                  <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                    <tr className="border-b border-border-soft">
                      <th className="text-left py-2">Engagement</th>
                      <th className="text-left py-2">Client</th>
                      <th className="text-right py-2">Revenue</th>
                      <th className="text-right py-2">GM</th>
                      <th className="text-right py-2">Basis share</th>
                      <th className="text-right py-2">Overhead</th>
                      <th className="text-right py-2">Net margin</th>
                      <th className="text-right py-2">Net %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {net.data.rows.map((r) => (
                      <tr key={r.engagementId} className="border-b border-border-soft/40" data-testid={`row-net-${r.engagementId}`}>
                        <td className="py-1.5">{r.engagementName}</td>
                        <td className="py-1.5 text-text-mute">{r.accountName}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.revenueRecognised)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.grossMarginAmount)}</td>
                        <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtPct(r.basisShare)}</td>
                        <td className="py-1.5 text-right tabular-nums text-amber-400">{fmtUsd(r.allocatedOverheadUsd)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.netMarginAmount)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${pctTone(r.netMarginPct)}`}>{fmtPct(r.netMarginPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}

        {tab === "realization" && (
          <Card className="p-4">
            <SectionHead headline="Realization — sold vs delivered" />
            {realization.isLoading ? (
              <div className="py-8 text-center text-text-faint"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
            ) : !realization.data?.rows.length ? (
              <p className="text-text-faint text-sm py-4">{realization.data?.note ?? "No data in range."}</p>
            ) : (
              <>
                <table className="w-full text-sm mt-3">
                  <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                    <tr className="border-b border-border-soft">
                      <th className="text-left py-2">Engagement</th>
                      <th className="text-right py-2">Sold</th>
                      <th className="text-right py-2">Delivered</th>
                      <th className="text-right py-2">Realization</th>
                      <th className="text-right py-2">Rate var</th>
                      <th className="text-right py-2">Hrs overrun</th>
                      <th className="text-right py-2">Write-offs</th>
                      <th className="text-right py-2">Exp non-rec</th>
                      <th className="text-right py-2">Leakage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realization.data.rows.map((r) => (
                      <tr key={r.engagementId} className="border-b border-border-soft/40" data-testid={`row-real-${r.engagementId}`}>
                        <td className="py-1.5">
                          {r.engagementName}
                          <div className="text-xs text-text-faint">{r.accountName}{r.sold && !r.sold.hasPricing ? " · sold @ deal hypothesis (no pricing)" : ""}</div>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{r.sold ? fmtUsd(r.sold.priceUsd) : <span className="text-text-faint">no baseline</span>}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.delivered.revenueRecognised)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${r.realizationRate === null ? "text-text-faint" : r.realizationRate >= 0.85 ? "text-emerald-400" : r.realizationRate >= 0.7 ? "text-amber-400" : "text-red-400"}`}>
                          {fmtPct(r.realizationRate, 0)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{r.leakage ? fmtUsd(r.leakage.rateVarianceUsd) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{r.leakage ? fmtUsd(r.leakage.hoursOverrunUsd) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{r.leakage ? fmtUsd(r.leakage.scopeWriteOffsUsd) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{r.leakage ? fmtUsd(r.leakage.expenseNonRecoveryUsd) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums text-amber-400">{r.leakage ? fmtUsd(r.leakage.totalUsd) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-text-faint mt-3">{realization.data.note}</p>
              </>
            )}
          </Card>
        )}

        {tab === "sold" && (
          <Card className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <SectionHead headline="Sold-position snapshots (immutable)" />
              <Button variant="outline" size="sm" onClick={runBackfill} disabled={busy !== null} data-testid="button-backfill">
                {busy === "backfill" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ml-1.5">Backfill contract deals</span>
              </Button>
            </div>
            <p className="text-xs text-text-faint mt-1">Captured once when a deal first enters Contract (or via backfill) and never updated — the fixed baseline for realization.</p>
            {sold.isLoading ? (
              <div className="py-8 text-center text-text-faint"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
            ) : !sold.data?.rows.length ? (
              <p className="text-text-faint text-sm py-4">No snapshots yet — use “Backfill contract deals” to capture baselines for existing Contract-stage opportunities.</p>
            ) : (
              <table className="w-full text-sm mt-3">
                <thead className="text-xs text-text-faint font-mono uppercase tracking-widest">
                  <tr className="border-b border-border-soft">
                    <th className="text-left py-2">Opportunity</th>
                    <th className="text-left py-2">Source</th>
                    <th className="text-right py-2">Sold price</th>
                    <th className="text-right py-2">Sold cost</th>
                    <th className="text-right py-2">Margin %</th>
                    <th className="text-right py-2">Target %</th>
                    <th className="text-right py-2">Hours</th>
                    <th className="text-right py-2">Rate</th>
                    <th className="text-right py-2">Captured</th>
                  </tr>
                </thead>
                <tbody>
                  {sold.data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border-soft/40" data-testid={`row-sold-${r.opportunityId}`}>
                      <td className="py-1.5 font-mono text-xs">{r.opportunityId}</td>
                      <td className="py-1.5"><MonoChip>{r.source === "contract_stage" ? "contract" : "backfill"}</MonoChip>{!r.hasPricing && <span className="text-xs text-amber-400 ml-1.5">no pricing</span>}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.soldPriceUsd)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.soldCostUsd)}</td>
                      <td className={`py-1.5 text-right tabular-nums ${pctTone(r.soldMarginPct)}`}>{fmtPct(r.soldMarginPct)}</td>
                      <td className="py-1.5 text-right tabular-nums text-text-mute">{fmtPct(r.targetMarginPct)}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.soldHours.toFixed(0)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.soldEffectiveRateUsd)}</td>
                      <td className="py-1.5 text-right text-xs text-text-faint">{new Date(r.capturedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
