import * as React from "react";
import { Card, MonoChip, PageHero, TabNav, TabNavLink } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface WipRow {
  engagement_id: string;
  hours_burned: number;
  expense_burned: number;
  recognised_revenue: number;
  invoiced_amount: number;
  unbilled_amount: number;
  currency: string;
}
interface RunRow { id: string; status: string; engagementsScanned: number; snapshotsWritten: number; startedAt: string; finishedAt: string | null; }

const fmtUsd = (n: number) => `$${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function WalletWip() {
  const { toast } = useToast();
  const [latest, setLatest] = React.useState<{ engagements: WipRow[]; firm: { recognised: number; invoiced: number; unbilled: number; count: number } } | null>(null);
  const [runs, setRuns] = React.useState<RunRow[]>([]);
  const [me, setMe] = React.useState<{ role: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const [meR, l, r] = await Promise.all([
      fetch("/api/atelier/me", { credentials: "include" }).then((x) => x.json()),
      fetch("/api/atelier/wip/snapshots/latest", { credentials: "include" }).then((x) => x.json()),
      fetch("/api/atelier/wip/run-log", { credentials: "include" }).then((x) => x.json()),
    ]);
    setMe(meR.user ?? null);
    setLatest(l);
    setRuns(r.runs ?? []);
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);

  const refreshSnap = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/atelier/wip/snapshots/refresh", { method: "POST", credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "refresh failed");
      toast({ title: "WIP refreshed", description: `${j.written} snapshots written` });
      await refresh();
    } catch (e) {
      toast({ title: "Refresh failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const isFinance = me?.role === "finance" || me?.role === "founding_partner" || me?.role === "partner";

  return (
    <PageHero>
      <TabNav>
        <TabNavLink href="/wallet" active={false}>Expenses</TabNavLink>
        <TabNavLink href="/wallet/revrec" active={false}>Rev-rec</TabNavLink>
        <TabNavLink href="/wallet/wip" active>WIP</TabNavLink>
        <TabNavLink href="/wallet/margin" active={false}>Margin & leakage</TabNavLink>
      </TabNav>

      {latest && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-6">
          <Card className="p-4"><div className="text-xs text-text-mute uppercase">Engagements</div><div className="text-2xl mt-1">{latest.firm.count}</div></Card>
          <Card className="p-4"><div className="text-xs text-text-mute uppercase">Recognised</div><div className="text-2xl mt-1 font-mono">{fmtUsd(latest.firm.recognised)}</div></Card>
          <Card className="p-4"><div className="text-xs text-text-mute uppercase">Invoiced</div><div className="text-2xl mt-1 font-mono">{fmtUsd(latest.firm.invoiced)}</div></Card>
          <Card className="p-4 border-gold/40"><div className="text-xs text-text-mute uppercase">Unbilled WIP</div><div className="text-2xl mt-1 font-mono text-gold">{fmtUsd(latest.firm.unbilled)}</div></Card>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        {isFinance && <Button onClick={refreshSnap} disabled={busy}>{busy ? "Refreshing..." : "Refresh snapshot"}</Button>}
      </div>

      <Card className="mt-4 p-4">
        <h3 className="text-lg mb-3">WIP by engagement</h3>
        {!latest || latest.engagements.length === 0 ? (
          <p className="text-text-mute text-sm">No WIP snapshots yet. Click "Refresh snapshot" to compute.</p>
        ) : (
          <table className="w-full text-sm" data-testid="wip-table">
            <thead className="text-text-mute text-left">
              <tr><th className="py-2">Engagement</th><th>Hours</th><th>Expense</th><th>Recognised</th><th>Invoiced</th><th>Unbilled</th></tr>
            </thead>
            <tbody>
              {latest.engagements.map((r) => (
                <tr key={r.engagement_id} className="border-t border-border/40">
                  <td className="py-2 font-mono text-xs">{r.engagement_id}</td>
                  <td>{Number(r.hours_burned).toFixed(0)}</td>
                  <td className="font-mono">{fmtUsd(r.expense_burned)}</td>
                  <td className="font-mono">{fmtUsd(r.recognised_revenue)}</td>
                  <td className="font-mono">{fmtUsd(r.invoiced_amount)}</td>
                  <td className="font-mono text-gold">{fmtUsd(r.unbilled_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <h3 className="text-lg mb-3">Refresh history</h3>
        <ul className="space-y-1 text-sm">
          {runs.map((r) => (
            <li key={r.id} className="flex gap-3">
              <span className="font-mono text-xs text-text-mute">{r.id}</span>
              <MonoChip tone={r.status === "complete" ? "green" : r.status === "running" ? "gold" : "red"}>{r.status}</MonoChip>
              <span className="text-text-mute">scanned {r.engagementsScanned} · wrote {r.snapshotsWritten}</span>
            </li>
          ))}
        </ul>
      </Card>
    </PageHero>
  );
}
