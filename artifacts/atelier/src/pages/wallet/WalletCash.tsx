import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink, PillButton } from "@/components/ui/primitives";

interface CashReceipt {
  id: string;
  bankTransactionId: string;
  totalAmount: number;
  appliedAmount: number;
  currency: string;
  receivedAt: string;
  customerId: string | null;
}

interface MatchCandidate {
  invoiceId: string;
  invoiceNumber: string | null;
  appliedAmount: number;
  confidence: number;
  rationale: string;
}

interface MatchResp {
  recommended: string;
  candidates: MatchCandidate[];
  rationaleSummary: string;
}

export default function WalletCash() {
  const [receipts, setReceipts] = React.useState<CashReceipt[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [matches, setMatches] = React.useState<MatchResp | null>(null);
  const [matching, setMatching] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await fetch("/api/atelier/wallet/cash/receipts", { credentials: "include" });
    const j = await r.json();
    setReceipts(j?.data?.rows ?? []);
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const runMatch = async (cashReceiptId: string) => {
    setMatching(true);
    setSelected(cashReceiptId);
    setMatches(null);
    try {
      const r = await fetch("/api/atelier/wallet/cash/match", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashReceiptId }),
      });
      const j = await r.json();
      setMatches(j?.data ?? null);
    } finally { setMatching(false); }
  };

  const apply = async (cashReceiptId: string, c: MatchCandidate) => {
    setBusy(true);
    try {
      await fetch("/api/atelier/wallet/cash/apply", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashReceiptId, applications: [{ invoiceId: c.invoiceId, appliedAmount: c.appliedAmount, rationale: c.rationale }] }),
      });
      setMatches(null); setSelected(null);
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-bg text-text" data-testid="page-wallet-cash">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Cash application"
          lede="Receipts from bank statements matched and applied to open invoices."
        />
      </PageHero>
      <TabNav>
        <TabNavLink href="/wallet/cash" active>Cash</TabNavLink>
        <TabNavLink href="/wallet/cash/recon" active={false}>Bank reconciliation</TabNavLink>
        <TabNavLink href="/wallet/treasury" active={false}>Treasury</TabNavLink>
        <TabNavLink href="/wallet/ar" active={false}>AR aging</TabNavLink>
      </TabNav>
      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        <Card className="overflow-hidden">
          <table className="w-full text-sm" data-testid="cash-receipts">
            <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
              <tr><th className="text-left px-3 py-2">Receipt</th><th className="text-left px-3 py-2">Date</th><th className="text-right px-3 py-2">Total</th><th className="text-right px-3 py-2">Applied</th><th className="text-right px-3 py-2">Remaining</th><th></th></tr>
            </thead>
            <tbody>
              {receipts.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-text-mute">No receipts. Import a bank statement and create receipts.</td></tr>
              )}
              {receipts.map((r) => {
                const remaining = Math.max(0, r.totalAmount - r.appliedAmount);
                return (
                  <tr key={r.id} className="border-t border-border-soft">
                    <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                    <td className="px-3 py-2">{r.receivedAt}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.currency} {r.totalAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.appliedAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      <MonoChip tone={remaining < 0.01 ? "green" : "gold"}>{remaining.toFixed(2)}</MonoChip>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {remaining > 0.01 && (
                        <PillButton variant="ghost" data-testid={`btn-match-${r.id}`} onClick={() => runMatch(r.id)}>
                          {matching && selected === r.id ? "Matching…" : "Match"}
                        </PillButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {selected && matches && (
          <Card className="p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <div className="font-mono text-sm">Matcher proposals · <span className="text-gold">{matches.recommended}</span></div>
              <button className="text-text-mute text-xs hover:text-gold" onClick={() => { setMatches(null); setSelected(null); }}>close</button>
            </div>
            <div className="text-xs text-text-mute">{matches.rationaleSummary}</div>
            <ul className="divide-y divide-border-soft">
              {matches.candidates.map((c, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-xs font-mono">
                  <div className="flex-1">
                    <div className="text-text">{c.invoiceNumber ?? c.invoiceId}</div>
                    <div className="text-text-mute">{c.rationale}</div>
                  </div>
                  <div className="mx-3 text-text-mute">{(c.confidence * 100).toFixed(0)}%</div>
                  <PillButton variant="primary" data-testid={`btn-apply-${c.invoiceId}`} disabled={busy} onClick={() => apply(selected, c)}>
                    Apply ${c.appliedAmount.toFixed(2)}
                  </PillButton>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
