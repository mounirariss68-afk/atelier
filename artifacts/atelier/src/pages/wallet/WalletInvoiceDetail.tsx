import * as React from "react";
import { useRoute, Link } from "wouter";
import { BackLink, PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";

interface Line { id: string; ord: number; description: string; qty: number; unitPrice: number; amount: number; sourceKind: string; sourceRef: string | null }
interface Submission { id: string; channel: string; status: string; clearanceUuid: string | null; qrCodePayload: string | null; clearedAt: string | null; rejectedReason: string | null }
interface DunningEvent { id: string; stepIndex: number; channel: string; template: string | null; sentAt: string }
interface Promise { id: string; promisedAmount: number; promisedDate: string; status: string; contactName: string | null }
interface Invoice {
  id: string; invoiceNumber: string | null; jurisdiction: string; status: string;
  currency: string; subtotal: number; vatAmount: number; vatRatePct: number; total: number; amountPaid: number;
  dueDate: string | null; issuedAt: string | null; engagementId: string | null; billTo: Record<string, string>;
  notes: string | null; voidedReason: string | null;
}
interface Full { invoice: Invoice; lines: Line[]; submissions: Submission[]; dunningEvents: DunningEvent[]; promises: Promise[] }
interface Me { id: string; role: string }

export default function WalletInvoiceDetail() {
  const [, params] = useRoute("/wallet/invoices/:id");
  const id = params?.id ?? "";
  const [me, setMe] = React.useState<Me | null>(null);
  const [data, setData] = React.useState<Full | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    const meR = await fetch("/api/atelier/me", { credentials: "include" }).then((r) => r.json());
    setMe(meR);
    const r = await fetch(`/api/atelier/wallet/invoices/${id}`, { credentials: "include" });
    setData(r.ok ? await r.json() : null);
  }, [id]);
  React.useEffect(() => { void load(); }, [load]);

  async function call(path: string, body?: unknown): Promise<void> {
    setBusy(true);
    try {
      const r = await fetch(`/api/atelier/wallet/invoices/${id}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: body ? JSON.stringify(body) : "{}",
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert(`Failed: ${e?.message ?? r.statusText}`);
      }
      await load();
    } finally { setBusy(false); }
  }

  if (!data) return <div className="p-8 text-text-mute">Loading…</div>;
  const inv = data.invoice;
  const isPartner = me?.role === "founding_partner" || me?.role === "partner";
  const isFinance = isPartner || me?.role === "finance";
  const isSm = isFinance || me?.role === "senior_manager";

  return (
    <div className="min-h-screen text-text">
      <PageHero>
        <BackLink href="/wallet/invoices" className="mb-4" data-testid="link-back">
          Back to invoices
        </BackLink>
        <SectionHead
          eyebrow={inv.invoiceNumber ?? "(draft)"}
          headline={inv.invoiceNumber ?? "(draft)"}
          lede={
            <span>
              {inv.jurisdiction} ·{" "}
              <MonoChip tone={inv.status === "paid" ? "green" : inv.status === "void" ? "red" : "gold"}>
                {inv.status}
              </MonoChip>
            </span>
          }
        />
      </PageHero>

      <div className="px-6 py-4 max-w-5xl mx-auto space-y-4">
        <Card className="p-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[11px] font-mono uppercase text-text-faint">Bill to</div>
            <div className="font-medium">{inv.billTo?.name ?? "—"}</div>
            <div className="text-text-mute text-xs">{inv.billTo?.contactEmail ?? ""}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-mono uppercase text-text-faint">Total</div>
            <div className="text-2xl font-display">{inv.currency} {inv.total.toFixed(2)}</div>
            <div className="text-xs text-text-mute">subtotal {inv.subtotal.toFixed(2)} + VAT {inv.vatAmount.toFixed(2)} ({inv.vatRatePct}%)</div>
            <div className="text-xs text-text-mute">paid {inv.amountPaid.toFixed(2)} · due {inv.dueDate ?? "—"}</div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-3 py-2 border-b border-border-soft text-[11px] font-mono uppercase text-text-faint">Lines</div>
          <table className="w-full text-sm">
            <thead className="text-[11px] font-mono uppercase text-text-faint">
              <tr><th className="text-left px-3 py-1">Description</th><th className="text-left px-3 py-1">Source</th><th className="text-right px-3 py-1">Qty</th><th className="text-right px-3 py-1">Unit</th><th className="text-right px-3 py-1">Amount</th></tr>
            </thead>
            <tbody>
              {data.lines.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-3 text-text-mute text-center">No lines yet.</td></tr>
              ) : data.lines.map((l) => (
                <tr key={l.id} className="border-t border-border-soft">
                  <td className="px-3 py-1.5">{l.description}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-text-faint">{l.sourceKind}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{l.qty}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{l.unitPrice.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{l.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {inv.status === "draft" && isSm && (
          <Card className="p-4 space-y-2">
            <div className="text-[11px] font-mono uppercase text-text-faint">Compose lines from time + expenses</div>
            <div className="flex gap-2 text-sm">
              <button disabled={busy} onClick={() => void call("/compose", { fromDate: "1900-01-01", toDate: "2999-12-31", defaultRateUsd: 250 })}
                      className="px-3 py-1 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30">
                Compose
              </button>
              <button disabled={busy || !isPartner} onClick={() => void call("/issue")}
                      className="px-3 py-1 rounded bg-success/20 text-success border border-success/40 hover:bg-success/30 disabled:opacity-40"
                      title={isPartner ? "Issue invoice (partner)" : "Partner-tier required"}>
                Issue
              </button>
            </div>
          </Card>
        )}

        {data.submissions.length > 0 && (
          <Card className="p-4">
            <div className="text-[11px] font-mono uppercase text-text-faint mb-2">E-invoice submissions</div>
            {data.submissions.map((s) => (
              <div key={s.id} className="text-sm flex justify-between py-1">
                <div><span className="font-mono text-xs uppercase">{s.channel}</span> · <MonoChip tone={s.status === "cleared" ? "green" : s.status === "rejected" ? "red" : "gold"}>{s.status}</MonoChip></div>
                <div className="text-text-mute font-mono text-xs">{s.clearanceUuid ?? s.rejectedReason ?? ""}</div>
              </div>
            ))}
          </Card>
        )}

        {(inv.status === "issued" || inv.status === "paid" || inv.status === "void") && (
          <Card className="p-4 space-y-2">
            <div className="text-[11px] font-mono uppercase text-text-faint">Client PDF</div>
            <div className="flex gap-2 text-sm">
              <a href={`/api/atelier/wallet/invoices/${id}/pdf`} target="_blank" rel="noreferrer"
                 className="px-3 py-1 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30">
                View PDF
              </a>
              <a href={`/api/atelier/wallet/invoices/${id}/pdf?download=1`}
                 className="px-3 py-1 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30">
                Download
              </a>
              {isFinance && inv.status !== "void" && (
                <button disabled={busy} onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await fetch(`/api/atelier/wallet/invoices/${id}/send`, {
                      method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: "{}",
                    });
                    const b = await r.json().catch(() => ({}));
                    if (!r.ok) alert(`Failed: ${b?.message ?? b?.error ?? r.statusText}`);
                    else if (b.delivered) alert(`Invoice emailed to ${b.to}.`);
                    else alert(`NOT delivered — email is not configured (${b.via}). Download the PDF and send it manually.`);
                  } finally { setBusy(false); }
                }} className="px-3 py-1 rounded bg-success/20 text-success border border-success/40 disabled:opacity-40"
                   title="Email the invoice PDF to the billing contact">
                  Email client
                </button>
              )}
            </div>
          </Card>
        )}

        {inv.status === "issued" && (
          <Card className="p-4 space-y-2">
            <div className="text-[11px] font-mono uppercase text-text-faint">Actions</div>
            <div className="flex gap-2 text-sm">
              {isFinance && (
                <button disabled={busy} onClick={() => {
                  const a = Number(prompt("Payment amount") ?? "0");
                  if (a > 0) void call("/payment", { amount: a });
                }} className="px-3 py-1 rounded bg-success/20 text-success border border-success/40">
                  Record payment
                </button>
              )}
              {me?.role === "founding_partner" && (
                <button disabled={busy} onClick={() => {
                  const reason = prompt("Void reason") ?? "";
                  if (reason) void call("/void", { reason });
                }} className="px-3 py-1 rounded bg-danger/20 text-danger border border-danger/40">
                  Void (irreversible)
                </button>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
