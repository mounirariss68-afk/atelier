import * as React from "react";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";

interface Bucket { country: string; treatment: string; usdNet: number; usdVat: number; usdGross: number; count: number }
interface Row {
  id: string; expenseId: string; expenseDate: string; country: string; treatment: string;
  rate: number; currency: string; netAmount: number; vatAmount: number; grossAmount: number;
  usdNet: number; usdVat: number; usdGross: number; merchant: string | null; summary: string | null;
}

export default function WalletVat() {
  const [buckets, setBuckets] = React.useState<Bucket[]>([]);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    void fetch("/api/atelier/wallet/vat", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          setErr(`${r.status}`);
          return { buckets: [], rows: [] };
        }
        return r.json();
      })
      .then((j) => { setBuckets(j.buckets ?? []); setRows(j.rows ?? []); setLoading(false); });
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="VAT register"
          lede="KSA 15% · UAE 5% · everything else exported. Audit-ready CSV one click away."
        />
      </PageHero>
      <TabNav>
        <TabNavLink href="/wallet" active={false}>Expenses</TabNavLink>
        <TabNavLink href="/wallet/policy" active={false}>Policy</TabNavLink>
        <TabNavLink href="/wallet/vat" active>VAT register</TabNavLink>
      </TabNav>
      <div className="px-6 py-4 max-w-7xl mx-auto space-y-6">
        {loading && <div className="text-text-mute">Loading…</div>}
        {err && <p className="text-red-400 font-mono text-xs">Error {err} — leadership only.</p>}

        {!loading && !err && (
          <>
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-mono uppercase tracking-wider text-text-mute">Bucketed totals</h3>
              <a
                href="/api/atelier/wallet/vat?format=csv"
                className="px-3 py-1 rounded text-xs font-mono uppercase bg-gold text-bg"
                data-testid="link-export-csv"
              >
                Export CSV
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {buckets.map((b) => (
                <Card key={`${b.country}-${b.treatment}`} className="p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <MonoChip tone="gold">{b.country} · {b.treatment}</MonoChip>
                    <span className="text-xs font-mono text-text-mute">{b.count} row{b.count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-2">
                    <div><div className="text-text-mute">Net</div><div>${b.usdNet.toFixed(2)}</div></div>
                    <div><div className="text-text-mute">VAT</div><div>${b.usdVat.toFixed(2)}</div></div>
                    <div><div className="text-text-mute">Gross</div><div>${b.usdGross.toFixed(2)}</div></div>
                  </div>
                </Card>
              ))}
              {buckets.length === 0 && (
                <Card className="p-6 text-center text-text-mute md:col-span-3">No approved expenses yet.</Card>
              )}
            </div>

            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-text-mute mb-2">Detail rows ({rows.length})</h3>
              <Card className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-text-mute border-b border-border">
                    <tr>
                      {["Date","Country","Treatment","Merchant","Net","VAT","Gross","USD net","USD VAT","USD gross"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-normal uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border-soft hover:bg-bg-elevate">
                        <td className="px-3 py-2">{r.expenseDate}</td>
                        <td className="px-3 py-2">{r.country}</td>
                        <td className="px-3 py-2">{r.treatment}</td>
                        <td className="px-3 py-2 text-text">{r.merchant}</td>
                        <td className="px-3 py-2 text-right">{r.currency} {r.netAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{r.vatAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{r.grossAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">${r.usdNet.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">${r.usdVat.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">${r.usdGross.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
