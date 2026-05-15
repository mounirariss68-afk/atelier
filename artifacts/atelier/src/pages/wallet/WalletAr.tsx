import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";

interface AgedRow {
  invoice: { id: string; invoiceNumber: string | null; billTo: { name?: string }; currency: string; total: number; amountPaid: number; dueDate: string | null };
  daysOverdue: number;
  outstanding: number;
  bucket: "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
}
interface AgingResp {
  buckets: Array<{ bucket: string; totalUsd: number }>;
  totalOutstandingUsd: number;
  invoiceCount: number;
  rows: AgedRow[];
}

const BUCKET_LABEL: Record<string, string> = {
  current: "Current",
  d1_30: "1–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90_plus: "90+",
};

export default function WalletAr() {
  const [data, setData] = React.useState<AgingResp | null>(null);

  React.useEffect(() => {
    void fetch("/api/atelier/wallet/ar/aging", { credentials: "include" })
      .then((r) => r.json())
      .then(setData);
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="AR aging"
          lede="Where the cash sits, by overdue bucket."
        />
      </PageHero>
      <TabNav>
        <TabNavLink href="/wallet" active={false}>Expenses</TabNavLink>
        <TabNavLink href="/wallet/invoices" active={false}>Invoices</TabNavLink>
        <TabNavLink href="/wallet/ar" active>AR aging</TabNavLink>
        <TabNavLink href="/wallet/collections" active={false}>Collections</TabNavLink>
      </TabNav>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        {!data ? (
          <Card className="p-6 text-text-mute">Loading…</Card>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-3">
              {data.buckets.map((b) => (
                <Card key={b.bucket} className="p-3">
                  <div className="text-[11px] font-mono uppercase text-text-faint">{BUCKET_LABEL[b.bucket] ?? b.bucket}</div>
                  <div className="text-2xl font-display mt-1">${b.totalUsd.toFixed(0)}</div>
                </Card>
              ))}
            </div>
            <div className="text-sm text-text-mute font-mono">
              Total outstanding: <span className="text-text">${data.totalOutstandingUsd.toFixed(2)}</span> across {data.invoiceCount} invoices.
            </div>
            <Card className="overflow-hidden">
              <table className="w-full text-sm" data-testid="ar-aging-rows">
                <thead className="bg-bg-elevate text-[11px] font-mono uppercase text-text-faint">
                  <tr><th className="text-left px-3 py-2">Number</th><th className="text-left px-3 py-2">Bill to</th><th className="text-right px-3 py-2">Outstanding</th><th className="text-right px-3 py-2">Days overdue</th><th className="text-left px-3 py-2">Bucket</th><th></th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.invoice.id} className="border-t border-border-soft">
                      <td className="px-3 py-2 font-mono text-xs"><Link href={`/wallet/invoices/${r.invoice.id}`} className="text-gold hover:underline">{r.invoice.invoiceNumber}</Link></td>
                      <td className="px-3 py-2">{r.invoice.billTo?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.invoice.currency} {r.outstanding.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.daysOverdue}</td>
                      <td className="px-3 py-2"><MonoChip tone={r.bucket === "current" ? "green" : r.bucket === "d90_plus" ? "red" : "gold"}>{BUCKET_LABEL[r.bucket]}</MonoChip></td>
                      <td className="px-3 py-2"><Link href={`/wallet/collections?invoiceId=${r.invoice.id}`} className="text-text-mute text-xs hover:text-gold">Chase →</Link></td>
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
