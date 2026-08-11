import * as React from "react";
import { Card, MonoChip, PageHero, SectionHead } from "@/components/ui/primitives";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface MarginFirm {
  firm: {
    revenueRecognised: number;
    directCost: number;
    grossMarginAmount: number;
    grossMarginPct: number;
    leakageAmount: number;
    engagementCount: number;
  };
  slips: Array<{ engagementId: string; realizationRate: number; leakageAmount: number }>;
  asOf: string | null;
}
interface LeakageRow {
  firm: { standard: number; recognised: number; leakage: number; realizationRate: number };
  engagements: Array<{
    engagement_id: string;
    revenue_recognised: number;
    standard_revenue_at_rack: number;
    leakage_amount: number;
    realization_rate: number;
  }>;
}

const fmtUsd = (n: number) => `$${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;
const thisMonth = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };

export default function WalletMargin() {
  const { toast } = useToast();
  const [firm, setFirm] = React.useState<MarginFirm | null>(null);
  const [leakage, setLeakage] = React.useState<LeakageRow | null>(null);
  const [me, setMe] = React.useState<{ role: string } | null>(null);
  const [period, setPeriod] = React.useState(thisMonth());
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const [meR, m, l] = await Promise.all([
      fetch("/api/atelier/me", { credentials: "include" }).then((x) => x.json()),
      fetch("/api/atelier/margin/firm", { credentials: "include" }).then((x) => x.json()),
      fetch("/api/atelier/leakage", { credentials: "include" }).then((x) => x.json()),
    ]);
    setMe(meR.user ?? null);
    setFirm(m);
    setLeakage(l);
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);

  const isFinance = me?.role === "finance" || me?.role === "founding_partner" || me?.role === "partner";

  const refreshMargin = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/atelier/margin/refresh", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodLabel: period }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "refresh failed");
      toast({ title: "Margin refreshed", description: `${j.written} snapshots for ${period}` });
      await refresh();
    } catch (e) {
      toast({ title: "Refresh failed", description: String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Margin & leakage"
          lede="Firm-wide margin snapshots and leakage trail — where realised value drops below contracted scope."
        />
      </PageHero>
      <SubSectionTabs
        tabs={[
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "revrec", label: "Rev-rec", href: "/wallet/revrec" },
        { id: "wip", label: "WIP", href: "/wallet/wip" },
        { id: "margin", label: "Margin & leakage", href: "/wallet/margin" },
      ]}
      />

      <div className="px-6 py-4 max-w-7xl mx-auto">
      {firm && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-xs text-text-mute uppercase">Revenue</div><div className="text-2xl mt-1 font-mono">{fmtUsd(firm.firm.revenueRecognised)}</div></Card>
          <Card className="p-4"><div className="text-xs text-text-mute uppercase">Direct cost</div><div className="text-2xl mt-1 font-mono">{fmtUsd(firm.firm.directCost)}</div></Card>
          <Card className="p-4"><div className="text-xs text-text-mute uppercase">Gross margin</div><div className="text-2xl mt-1 font-mono">{fmtUsd(firm.firm.grossMarginAmount)}</div><MonoChip tone={firm.firm.grossMarginPct >= 0.45 ? "green" : firm.firm.grossMarginPct >= 0.3 ? "amber" : "red"} className="mt-1">{fmtPct(firm.firm.grossMarginPct)}</MonoChip></Card>
          <Card className="p-4 border-gold/40"><div className="text-xs text-text-mute uppercase">Leakage</div><div className="text-2xl mt-1 font-mono text-gold">{fmtUsd(firm.firm.leakageAmount)}</div></Card>
        </div>
      )}

      <div className="mt-4 flex items-end gap-3">
        <div>
          <label className="text-xs text-text-mute uppercase block mb-1">Period</label>
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="YYYY-MM" className="w-32" />
        </div>
        {isFinance && <Button onClick={refreshMargin} disabled={busy}>Refresh margin snapshots</Button>}
      </div>

      {firm && firm.slips.length > 0 && (
        <Card className="mt-4 p-4 border-amber/30">
          <h3 className="text-lg mb-3">Top realization slips</h3>
          <ul className="space-y-2 text-sm">
            {firm.slips.map((s) => (
              <li key={s.engagementId} className="flex items-center justify-between border-b border-border/30 pb-2">
                <span className="font-mono text-xs">{s.engagementId}</span>
                <span><MonoChip tone="amber">realization {fmtPct(s.realizationRate)}</MonoChip></span>
                <span className="font-mono text-gold">{fmtUsd(s.leakageAmount)} leaked</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {leakage && leakage.engagements.length > 0 && (
        <Card className="mt-4 p-4">
          <h3 className="text-lg mb-3">Leakage by engagement</h3>
          <table className="w-full text-sm" data-testid="leakage-table">
            <thead className="text-text-mute text-left">
              <tr><th className="py-2">Engagement</th><th>Standard</th><th>Recognised</th><th>Realization</th><th>Leakage</th></tr>
            </thead>
            <tbody>
              {leakage.engagements.map((r) => (
                <tr key={r.engagement_id} className="border-t border-border/40">
                  <td className="py-2 font-mono text-xs">{r.engagement_id}</td>
                  <td className="font-mono">{fmtUsd(r.standard_revenue_at_rack)}</td>
                  <td className="font-mono">{fmtUsd(r.revenue_recognised)}</td>
                  <td>{fmtPct(r.realization_rate)}</td>
                  <td className="font-mono text-gold">{fmtUsd(r.leakage_amount)}</td>
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
