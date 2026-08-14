import * as React from "react";
import { PageHero, SectionHead, Card, PillButton, MonoChip } from "@/components/ui/primitives";
import { WalletTabs } from "./walletTabs";

interface ForecastWeek {
  weekIndex: number;
  weekStart: string;
  expectedIn: number;
  expectedOut: number;
  openingBalance: number;
  closingBalance: number;
  confidenceLow: number;
  confidenceHigh: number;
  isCashGap: boolean;
}

interface SnapshotResp {
  snapshotId: string | null;
  snapshotAt?: string;
  weeks: ForecastWeek[];
}

interface WorkingCapital {
  asOf: string;
  cash: { total: number; byAccount: Array<{ id: string; label: string; currency: string; balance: number }> };
  ar: { open: number; overdue: number; invoiceCount: number };
  unappliedReceipts: number;
  ap: { total: number; contractorPayments: number; partnerFirmInvoices: number; reimbursableExpenses: number };
  netWorkingCapital: number;
  triageCounts: Record<string, number>;
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function WalletTreasury() {
  const [snap, setSnap] = React.useState<SnapshotResp | null>(null);
  const [wc, setWc] = React.useState<WorkingCapital | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const [fr, wr] = await Promise.all([
      fetch("/api/atelier/wallet/cash/forecast/latest", { credentials: "include" }),
      fetch("/api/atelier/wallet/cash/working-capital", { credentials: "include" }),
    ]);
    const fj = await fr.json();
    const wj = await wr.json();
    setSnap(fj?.data ?? null);
    setWc(wj?.data ?? null);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const recompute = async () => {
    setBusy(true);
    try {
      await fetch("/api/atelier/wallet/cash/forecast/run", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      await load();
    } finally { setBusy(false); }
  };

  const weeks = snap?.weeks ?? [];
  const cashGapWeeks = weeks.filter((w) => w.isCashGap).map((w) => w.weekIndex);
  const max = Math.max(1, ...weeks.map((w) => Math.abs(w.closingBalance)));

  return (
    <div className="min-h-screen text-text" data-testid="page-wallet-treasury">
      <PageHero>
        <div className="flex items-end justify-between gap-4">
          <SectionHead
            eyebrow="Firm · Wallet"
            headline="Treasury — cash & working capital"
            lede="Scheduled 13-week direct-method forecast snapshots with cash-gap alerts, plus the live working-capital position."
          />
          <PillButton variant="primary" disabled={busy} data-testid="btn-recompute" onClick={recompute}>
            {busy ? "Computing…" : "Recompute snapshot"}
          </PillButton>
        </div>
      </PageHero>
      <WalletTabs group="cash" />
      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {wc && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="working-capital-cards">
            <Card className="p-4">
              <div className="text-[11px] font-mono uppercase text-text-faint">Cash</div>
              <div className="text-xl font-mono mt-1" data-testid="wc-cash">{usd(wc.cash.total)}</div>
              <div className="text-[11px] text-text-mute mt-1">{wc.cash.byAccount.length} account{wc.cash.byAccount.length === 1 ? "" : "s"}</div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] font-mono uppercase text-text-faint">AR open</div>
              <div className="text-xl font-mono mt-1" data-testid="wc-ar">{usd(wc.ar.open)}</div>
              <div className="text-[11px] mt-1">
                {wc.ar.overdue > 0
                  ? <span className="text-danger">{usd(wc.ar.overdue)} overdue</span>
                  : <span className="text-text-mute">nothing overdue</span>}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] font-mono uppercase text-text-faint">Unapplied receipts</div>
              <div className="text-xl font-mono mt-1" data-testid="wc-unapplied">{usd(wc.unappliedReceipts)}</div>
              <div className="text-[11px] text-text-mute mt-1">awaiting application</div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] font-mono uppercase text-text-faint">Approved payables</div>
              <div className="text-xl font-mono mt-1" data-testid="wc-ap">{usd(wc.ap.total)}</div>
              <div className="text-[11px] text-text-mute mt-1">contractors · firms · claims</div>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] font-mono uppercase text-text-faint">Net working capital</div>
              <div className={`text-xl font-mono mt-1 ${wc.netWorkingCapital < 0 ? "text-danger" : "text-gold"}`} data-testid="wc-net">
                {usd(wc.netWorkingCapital)}
              </div>
              <div className="text-[11px] text-text-mute mt-1">
                triage: {(wc.triageCounts.proposed ?? 0) + (wc.triageCounts.unmatched ?? 0) + (wc.triageCounts.parked ?? 0)} open
              </div>
            </Card>
          </div>
        )}

        {weeks.length === 0 ? (
          <Card className="p-6 text-text-mute">No forecast snapshot yet. Snapshots are written every Monday by the Cash Flow Forecaster, or click <span className="font-mono">Recompute snapshot</span>.</Card>
        ) : (
          <>
            <Card className="p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-xs text-text-faint uppercase">
                  Forecast strip · 13 weeks
                  {snap?.snapshotAt && <span className="ml-2 normal-case text-text-mute">snapshot {String(snap.snapshotAt).slice(0, 10)}</span>}
                </div>
                <div className="text-xs text-text-mute">
                  {cashGapWeeks.length} cash gap{cashGapWeeks.length === 1 ? "" : "s"}
                  {cashGapWeeks.length > 0 && <span className="text-danger ml-2">weeks {cashGapWeeks.join(", ")}</span>}
                </div>
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
                {weeks.map((w) => {
                  const h = Math.max(8, Math.round((Math.abs(w.closingBalance) / max) * 80));
                  return (
                    <div key={w.weekIndex} className="flex flex-col items-center gap-1" data-testid={`forecast-week-${w.weekIndex}`}>
                      <div className="text-[9px] font-mono text-text-faint">w{w.weekIndex}</div>
                      <div className={`w-full rounded ${w.isCashGap ? "bg-danger" : w.closingBalance >= 0 ? "bg-gold" : "bg-warning"}`}
                        style={{ height: `${h}px` }} title={`${w.weekStart}: $${w.closingBalance.toFixed(0)}`} />
                      <div className="text-[9px] font-mono text-text-mute">${(w.closingBalance / 1000).toFixed(0)}k</div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-elevate/50 text-[11px] font-mono uppercase text-text-faint">
                  <tr><th className="text-left px-3 py-2">Week</th><th className="text-left px-3 py-2">Start</th><th className="text-right px-3 py-2">In</th><th className="text-right px-3 py-2">Out</th><th className="text-right px-3 py-2">Closing</th><th className="text-left px-3 py-2"></th></tr>
                </thead>
                <tbody>
                  {weeks.map((w) => (
                    <tr key={w.weekIndex} className="border-t border-border-soft">
                      <td className="px-3 py-2 font-mono text-xs">w{w.weekIndex}</td>
                      <td className="px-3 py-2 font-mono text-xs">{w.weekStart}</td>
                      <td className="px-3 py-2 text-right font-mono">${w.expectedIn.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono">${w.expectedOut.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono">${w.closingBalance.toFixed(0)}</td>
                      <td className="px-3 py-2">{w.isCashGap && <MonoChip tone="red">cash gap</MonoChip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
