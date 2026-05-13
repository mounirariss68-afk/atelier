import * as React from "react";
import { useParams, Link } from "wouter";
import { Card, MonoChip, PageHero, PillButton, SectionHead } from "@/components/ui/primitives";

interface BillableExpense {
  id: string;
  personId: string;
  expenseDate: string;
  merchant: string | null;
  category: string;
  amount: number;
  currency: string;
  usdAmount: number;
  markupPct: number;
  status: string;
  policyStatus: string;
  summary: string | null;
}
interface Resp {
  engagementId: string;
  expenses: BillableExpense[];
  totals: { count: number; netUsd: number; markupUsd: number };
}
interface DraftLine {
  kind: "hours" | "expense";
  sourceId: string;
  description: string;
  qty: number;
  unitPriceUsd: number;
  amountUsd: number;
  markupPct?: number;
}
interface Draft {
  id: string;
  composedAt: string;
  rateCardId: string | null;
  lines: DraftLine[];
  totals: { hoursUsd: number; expensesNetUsd: number; markupUsd: number; totalUsd: number; lineCount: number };
}

export default function WalletClientBillable() {
  const params = useParams<{ engagementId: string }>();
  const engagementId = params.engagementId;
  const [data, setData] = React.useState<Resp | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setBusy("load");
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/atelier/wallet/client-billable/${engagementId}`, { credentials: "include" }),
        fetch(`/api/atelier/wallet/invoice-drafts/${engagementId}`, { credentials: "include" }),
      ]);
      const j1 = await r1.json();
      if (!r1.ok) throw new Error(j1.error || `HTTP ${r1.status}`);
      setData(j1);
      const j2 = await r2.json();
      setDraft(j2.draft ?? null);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [engagementId]);

  React.useEffect(() => { void load(); }, [load]);

  async function runComposer() {
    setBusy("run");
    setMsg(null);
    try {
      const r = await fetch(`/api/atelier/wallet/invoice-drafts/${engagementId}/run`, { method: "POST", credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMsg(`Composed ${j.draft.totals.lineCount} line(s); $${j.draft.totals.totalUsd.toFixed(2)}.`);
      await load();
    } catch (e) {
      setMsg(`Compose failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <PageHero>
        <SectionHead
          eyebrow={<MonoChip tone="gold">WALLET · CLIENT-BILLABLE</MonoChip>}
          headline={`Engagement ${engagementId}`}
          lede="Approved client-billable expenses and the latest invoice-line draft composed from billable hours plus pass-through expenses."
        />
      </PageHero>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <PillButton onClick={runComposer} disabled={busy === "run"} data-testid="btn-run-composer">
            {busy === "run" ? "Composing…" : "Run Invoice Composer"}
          </PillButton>
          {draft && (
            <a
              href={`/api/atelier/wallet/invoice-drafts/${engagementId}?format=csv`}
              className="text-gold underline"
              data-testid="link-csv"
            >
              Download CSV
            </a>
          )}
          <Link href={`/ledger/engagement-economics/${engagementId}`} className="text-gold underline">
            Back to economics
          </Link>
        </div>

        {msg && <Card className="p-3 text-sm border-gold/40 text-gold">{msg}</Card>}

        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-mute">
            Approved client-billable expenses {data && `· ${data.totals.count} (${data.totals.netUsd.toFixed(2)} net + ${data.totals.markupUsd.toFixed(2)} markup)`}
          </h3>
          {data && data.expenses.length === 0 && (
            <div className="text-text-mute text-sm">No approved client-billable expenses on this engagement yet.</div>
          )}
          <div className="space-y-2">
            {data?.expenses.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-4 border-t border-border/50 pt-2">
                <div>
                  <div className="font-semibold">{e.merchant ?? "(no merchant)"}</div>
                  <div className="text-xs font-mono text-text-mute">{e.expenseDate} · {e.category} · {e.currency} {e.amount.toFixed(2)}</div>
                  {e.summary && <div className="text-sm italic text-text-mute mt-0.5">{e.summary}</div>}
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <div className="font-mono text-text">${e.usdAmount.toFixed(2)}</div>
                  <div className="flex gap-1 justify-end">
                    <MonoChip tone={e.status === "approved" ? "green" : e.status === "submitted" ? "gold" : undefined}>{e.status}</MonoChip>
                    <MonoChip tone="gold">+{(e.markupPct * 100).toFixed(0)}%</MonoChip>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-mute">
            Current invoice-line draft {draft && `· ${draft.totals.lineCount} line(s) · $${draft.totals.totalUsd.toFixed(2)} (rate card ${draft.rateCardId ?? "—"})`}
          </h3>
          {!draft && <div className="text-text-mute text-sm">No draft composed yet. Click <em>Run Invoice Composer</em> above.</div>}
          {draft && (
            <table className="w-full text-sm">
              <thead className="text-left text-text-mute">
                <tr>
                  <th className="py-1 pr-2">Kind</th>
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right">Qty</th>
                  <th className="py-1 pr-2 text-right">Unit USD</th>
                  <th className="py-1 pr-2 text-right">Markup</th>
                  <th className="py-1 pr-2 text-right">Amount USD</th>
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((l) => (
                  <tr key={l.sourceId} className="border-t border-border/30">
                    <td className="py-1 pr-2 font-mono text-xs">{l.kind}</td>
                    <td className="py-1 pr-2">{l.description}</td>
                    <td className="py-1 pr-2 text-right font-mono">{l.qty.toFixed(2)}</td>
                    <td className="py-1 pr-2 text-right font-mono">${l.unitPriceUsd.toFixed(2)}</td>
                    <td className="py-1 pr-2 text-right font-mono">{l.markupPct != null ? `${(l.markupPct * 100).toFixed(0)}%` : "—"}</td>
                    <td className="py-1 pr-2 text-right font-mono">${l.amountUsd.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border/60 font-semibold">
                  <td colSpan={5} className="py-1 pr-2 text-right">Total</td>
                  <td className="py-1 pr-2 text-right font-mono">${draft.totals.totalUsd.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
