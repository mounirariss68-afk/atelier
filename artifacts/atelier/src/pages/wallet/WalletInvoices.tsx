import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";

interface Invoice {
  id: string;
  invoiceNumber: string | null;
  jurisdiction: string;
  status: string;
  currency: string;
  total: number;
  amountPaid: number;
  dueDate: string | null;
  issuedAt: string | null;
  engagementId: string | null;
  billTo: { name?: string; contactEmail?: string };
  createdAt: string;
}
interface Me { id: string; name: string; role: string }

const FINANCE_OR_PARTNER = new Set(["founding_partner", "partner", "finance", "senior_manager"]);

export default function WalletInvoices() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [items, setItems] = React.useState<Invoice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    const meR = await fetch("/api/atelier/me", { credentials: "include" }).then((r) => r.json());
    setMe(meR);
    const r = await fetch(`/api/atelier/wallet/invoices?status=${statusFilter}`, { credentials: "include" });
    const j = await r.json();
    setItems(j.invoices ?? []);
    setLoading(false);
  }, [statusFilter]);
  React.useEffect(() => { void load(); }, [load]);

  const canDraft = me ? FINANCE_OR_PARTNER.has(me.role) : false;

  async function newDraft() {
    const j = prompt("Jurisdiction (AE/SA/EU/GLOBAL)", "AE");
    if (!j) return;
    const billToName = prompt("Bill to (free-text name)") ?? "";
    const r = await fetch("/api/atelier/wallet/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ jurisdiction: j.toUpperCase(), billTo: { name: billToName } }),
    });
    if (r.ok) {
      const j2 = await r.json();
      window.location.href = `/wallet/invoices/${j2.invoice.id}`;
    } else {
      const e = await r.json().catch(() => ({}));
      alert(`Failed: ${e?.message ?? r.statusText}`);
    }
  }

  function statusTone(s: string): "green" | "gold" | "red" | undefined {
    if (s === "paid") return "green";
    if (s === "void") return "red";
    if (s === "issued") return "gold";
    return undefined;
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Invoices"
          lede="Issue, clear with the tax authority, and chase. Numbers are gap-free per jurisdiction."
        />
      </PageHero>
      <TabNav>
        <TabNavLink href="/wallet" active={false}>Expenses</TabNavLink>
        <TabNavLink href="/wallet/invoices" active>Invoices</TabNavLink>
        <TabNavLink href="/wallet/ar" active={false}>AR aging</TabNavLink>
        <TabNavLink href="/wallet/collections" active={false}>Collections</TabNavLink>
      </TabNav>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-3 text-xs font-mono">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-bg-elevate border border-border rounded px-2 py-1"
            data-testid="select-status"
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
          {canDraft && (
            <button
              onClick={() => void newDraft()}
              className="ml-auto px-3 py-1 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30"
              data-testid="btn-new-invoice"
            >
              + New invoice
            </button>
          )}
        </div>

        {loading ? (
          <Card className="p-6 text-text-mute">Loading…</Card>
        ) : items.length === 0 ? (
          <Card className="p-6 text-text-mute">No invoices yet.</Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm" data-testid="invoice-list">
              <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
                <tr>
                  <th className="text-left px-3 py-2">Number</th>
                  <th className="text-left px-3 py-2">Bill to</th>
                  <th className="text-left px-3 py-2">Jurisdiction</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="text-right px-3 py-2">Outstanding</th>
                  <th className="text-left px-3 py-2">Due</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const outstanding = (i.total - i.amountPaid).toFixed(2);
                  return (
                    <tr key={i.id} className="border-t border-border-soft hover:bg-bg-elevate/40">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link href={`/wallet/invoices/${i.id}`} className="text-gold hover:underline">
                          {i.invoiceNumber ?? "(draft)"}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{i.billTo?.name ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.jurisdiction}</td>
                      <td className="px-3 py-2"><MonoChip tone={statusTone(i.status)}>{i.status}</MonoChip></td>
                      <td className="px-3 py-2 text-right font-mono">{i.currency} {i.total.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{i.currency} {outstanding}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.dueDate ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
