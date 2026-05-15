import * as React from "react";
import { PageHero, SectionHead, Card, PillButton, MonoChip } from "@/components/ui/primitives";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";

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

interface ForecastResp {
  weeks: ForecastWeek[];
  cashGapWeeks: number[];
  rationaleSummary?: string;
}

export default function WalletTreasury() {
  const [data, setData] = React.useState<ForecastResp | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await fetch("/api/atelier/cli/execute", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolName: "cash_forecast_13w", input: {} }),
    });
    const j = await r.json();
    setData(j?.data ?? null);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const recompute = async () => {
    setBusy(true);
    try {
      await fetch("/api/atelier/cli/execute", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName: "cash_forecast_13w", input: { compute: true } }),
      });
      await load();
    } finally { setBusy(false); }
  };

  const max = Math.max(1, ...(data?.weeks ?? []).map((w) => Math.abs(w.closingBalance)));

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-wallet-treasury">
      <PageHero>
        <div className="flex items-end justify-between gap-4">
          <SectionHead
            eyebrow="Firm · Wallet"
            headline="Treasury — 13-week cash forecast"
            lede="Direct-method forecast across 13 rolling weeks. Cash-gap weeks flagged red."
          />
          <PillButton variant="primary" disabled={busy} data-testid="btn-recompute" onClick={recompute}>
            {busy ? "Computing…" : "Recompute snapshot"}
          </PillButton>
        </div>
      </PageHero>
      <SubSectionTabs
        tabs={[
        { id: "cash", label: "Cash", href: "/wallet/cash" },
        { id: "cash-recon", label: "Bank reconciliation", href: "/wallet/cash/recon" },
        { id: "treasury", label: "Treasury", href: "/wallet/treasury" },
        { id: "ar", label: "AR aging", href: "/wallet/ar" },
      ]}
      />
      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {!data || data.weeks.length === 0 ? (
          <Card className="p-6 text-text-mute">No forecast snapshot yet. Click <span className="font-mono">Recompute snapshot</span>.</Card>
        ) : (
          <>
            <Card className="p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-xs text-text-faint uppercase">Forecast strip · 13 weeks</div>
                <div className="text-xs text-text-mute">
                  {data.cashGapWeeks.length} cash gap{data.cashGapWeeks.length === 1 ? "" : "s"}
                  {data.cashGapWeeks.length > 0 && <span className="text-danger ml-2">weeks {data.cashGapWeeks.join(", ")}</span>}
                </div>
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
                {data.weeks.map((w) => {
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
                <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
                  <tr><th className="text-left px-3 py-2">Week</th><th className="text-left px-3 py-2">Start</th><th className="text-right px-3 py-2">In</th><th className="text-right px-3 py-2">Out</th><th className="text-right px-3 py-2">Closing</th><th className="text-left px-3 py-2"></th></tr>
                </thead>
                <tbody>
                  {data.weeks.map((w) => (
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
