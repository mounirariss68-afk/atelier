import * as React from "react";
import { PageHero, Card, MonoChip, TabNav, TabNavLink, PillButton } from "@/components/ui/primitives";

interface ReconRow {
  id: string;
  bankAccountId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  computedReceipts: number;
  computedPayments: number;
  variance: number;
  status: string;
}

export default function WalletCashRecon() {
  const [rows, setRows] = React.useState<ReconRow[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await fetch("/api/atelier/wallet/bank/recon", { credentials: "include" });
    const j = await r.json();
    setRows(j?.data?.rows ?? []);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const finalise = async (id: string, varianceAccepted: boolean) => {
    setBusy(true);
    try {
      await fetch(`/api/atelier/wallet/bank/recon/${id}/finalise`, {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rationale: "Reviewed by partner.", varianceAccepted }),
      });
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-wallet-cash-recon">
      <PageHero>
        <div className="text-[11px] font-mono uppercase tracking-widest text-gold mb-2">WALLET</div>
        <h1 className="text-3xl font-display tracking-tight">Bank reconciliation</h1>
        <p className="text-text-mute mt-2 max-w-2xl">Open and finalise bank reconciliation periods. Finalising locks the period for cash & bank entries.</p>
      </PageHero>
      <TabNav>
        <TabNavLink href="/wallet/cash" active={false}>Cash</TabNavLink>
        <TabNavLink href="/wallet/cash/recon" active>Bank reconciliation</TabNavLink>
        <TabNavLink href="/wallet/treasury" active={false}>Treasury</TabNavLink>
        <TabNavLink href="/wallet/ar" active={false}>AR aging</TabNavLink>
      </TabNav>
      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        <Card className="overflow-hidden">
          <table className="w-full text-sm" data-testid="recon-rows">
            <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
              <tr>
                <th className="text-left px-3 py-2">Period</th>
                <th className="text-left px-3 py-2">Range</th>
                <th className="text-right px-3 py-2">Receipts</th>
                <th className="text-right px-3 py-2">Payments</th>
                <th className="text-right px-3 py-2">Variance</th>
                <th className="text-left px-3 py-2">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-text-mute">No reconciliation periods yet.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border-soft">
                  <td className="px-3 py-2">{r.periodLabel}</td>
                  <td className="px-3 py-2 text-text-mute font-mono text-xs">{r.periodStart} → {r.periodEnd}</td>
                  <td className="px-3 py-2 text-right font-mono">${r.computedReceipts.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">${r.computedPayments.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MonoChip tone={Math.abs(r.variance) > 0.01 ? "red" : "green"}>${r.variance.toFixed(2)}</MonoChip>
                  </td>
                  <td className="px-3 py-2">
                    <MonoChip tone={r.status === "finalised" ? "green" : "gold"}>{r.status}</MonoChip>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status !== "finalised" && (
                      <PillButton variant="primary" disabled={busy} data-testid={`btn-finalise-${r.id}`}
                        onClick={() => finalise(r.id, Math.abs(r.variance) > 0.01)}>
                        Finalise
                      </PillButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
