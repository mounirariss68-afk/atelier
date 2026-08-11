import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";

interface AgedRow {
  invoice: { id: string; invoiceNumber: string | null; jurisdiction: string; billTo: { name?: string }; currency: string; total: number; amountPaid: number };
  daysOverdue: number;
  outstanding: number;
}
interface Me { id: string; role: string }

export default function WalletCollections() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [rows, setRows] = React.useState<AgedRow[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const m = await fetch("/api/atelier/me", { credentials: "include" }).then((r) => r.json());
    setMe(m);
    const r = await fetch("/api/atelier/wallet/ar/aging", { credentials: "include" }).then((r) => r.json());
    // Only show overdue rows.
    setRows((r.rows ?? []).filter((x: AgedRow) => x.daysOverdue > 0));
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function send(invoiceId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/atelier/wallet/dunning/${invoiceId}/send`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}",
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert(`Failed: ${e?.message ?? r.statusText}`);
      } else {
        alert("Reminder sent.");
      }
    } finally { setBusy(false); }
  }

  async function recordPromise(invoiceId: string, outstanding: number) {
    const amt = Number(prompt(`Promised amount (USD, max ${outstanding.toFixed(2)})`) ?? "0");
    const date = prompt("Promised date (YYYY-MM-DD)") ?? "";
    if (!amt || !date) return;
    const r = await fetch(`/api/atelier/wallet/dunning/${invoiceId}/promise`, {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ promisedAmount: amt, promisedDate: date }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      alert(`Failed: ${e?.message ?? r.statusText}`);
    }
  }

  return (
    <div className="min-h-screen text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Collections"
          lede="The dunning ladder runs per jurisdiction. Each step needs a real human nudge, and (after step one) a partner approver."
        />
      </PageHero>
      <SubSectionTabs
        tabs={[
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "invoices", label: "Invoices", href: "/wallet/invoices" },
        { id: "ar", label: "AR aging", href: "/wallet/ar" },
        { id: "collections", label: "Collections", href: "/wallet/collections" },
      ]}
      />

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {rows.length === 0 ? (
          <Card className="p-6 text-text-mute">No overdue invoices. Nothing to chase.</Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm" data-testid="collections-rows">
              <thead className="bg-bg-elevate/50 text-[11px] font-mono uppercase text-text-faint">
                <tr><th className="text-left px-3 py-2">Number</th><th className="text-left px-3 py-2">Bill to</th><th className="text-left px-3 py-2">Jurisdiction</th><th className="text-right px-3 py-2">Outstanding</th><th className="text-right px-3 py-2">Days</th><th className="text-right px-3 py-2">Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.invoice.id} className="border-t border-border-soft">
                    <td className="px-3 py-2 font-mono text-xs"><Link href={`/wallet/invoices/${r.invoice.id}`} className="text-gold hover:underline">{r.invoice.invoiceNumber}</Link></td>
                    <td className="px-3 py-2">{r.invoice.billTo?.name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.invoice.jurisdiction}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.invoice.currency} {r.outstanding.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.daysOverdue}</td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button disabled={busy} onClick={() => void send(r.invoice.id)} className="px-2 py-1 rounded text-xs bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30">Send next reminder</button>
                      <button disabled={busy} onClick={() => void recordPromise(r.invoice.id, r.outstanding)} className="px-2 py-1 rounded text-xs glass-surface-2 border border-border hover:border-gold/40">Promise to pay</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
