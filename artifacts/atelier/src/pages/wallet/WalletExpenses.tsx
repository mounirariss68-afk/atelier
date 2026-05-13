import * as React from "react";
import { Link } from "wouter";
import { PageHero, Card, MonoChip, TabNav, TabNavLink } from "@/components/ui/primitives";

interface Expense {
  id: string;
  personId: string;
  expenseDate: string;
  captureSource: string;
  merchant: string | null;
  category: string;
  amount: number;
  currency: string;
  usdAmount: number;
  status: string;
  policyStatus: string;
  vatTreatment: string;
  clientBillable: boolean;
  markupPct: number;
  policyFindings?: Array<{ severity: "amber" | "red"; message: string }>;
  summary?: string | null;
}
interface Me { id: string; name: string; role: string }

export default function WalletExpenses() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [items, setItems] = React.useState<Expense[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [scope, setScope] = React.useState<"self" | "all">("self");
  const [display, setDisplay] = React.useState<"USD" | "AED" | "SAR">("USD");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    const meR = await fetch("/api/atelier/me", { credentials: "include" }).then((r) => r.json());
    setMe(meR);
    const r = await fetch(`/api/atelier/wallet/expenses?scope=${scope}`, { credentials: "include" });
    const j = await r.json();
    setItems(j.expenses ?? []);
    setLoading(false);
  }, [scope]);

  React.useEffect(() => { void load(); }, [load]);

  const filtered = items.filter((e) => statusFilter === "all" || e.status === statusFilter);
  const isLeader = me?.role === "partner" || me?.role === "operations";

  function fmt(usd: number, currency: string, amount: number): string {
    if (display === "USD") return `$${usd.toFixed(2)}`;
    // approximate display conversion via known rates
    const rates: Record<string, number> = { AED: 3.6725, SAR: 3.75 };
    const v = currency === display ? amount : usd * (rates[display] ?? 1);
    return `${display} ${v.toFixed(2)}`;
  }

  function statusTone(s: string): "green" | "gold" | "red" | undefined {
    if (s === "approved") return "green";
    if (s === "rejected") return "red";
    if (s === "submitted") return "gold";
    return undefined;
  }
  function policyTone(p: string): "green" | "gold" | "red" | undefined {
    if (p === "red") return "red";
    if (p === "amber") return "gold";
    return "green";
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <PageHero><div className="text-[11px] font-mono uppercase tracking-widest text-gold mb-2">WALLET</div><h1 className="text-3xl font-display tracking-tight">Expenses</h1><p className="text-text-mute mt-2 max-w-2xl">Every expense policy-checked, VAT-handled, traceable to the client.</p></PageHero>
      <TabNav>
        <TabNavLink href="/wallet" active>Expenses</TabNavLink>
        <TabNavLink href="/wallet/expenses/new" active={false}>+ New expense</TabNavLink>
        <TabNavLink href="/wallet/cards" active={false}>Cards</TabNavLink>
        {isLeader && <TabNavLink href="/wallet/policy" active={false}>Policy</TabNavLink>}
        {isLeader && <TabNavLink href="/wallet/vat" active={false}>VAT register</TabNavLink>}
      </TabNav>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          {isLeader && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "self" | "all")}
              className="bg-bg-elevate border border-border rounded px-2 py-1"
              data-testid="select-scope"
            >
              <option value="self">My expenses</option>
              <option value="all">Firm-wide</option>
            </select>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-bg-elevate border border-border rounded px-2 py-1"
            data-testid="select-status"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={display}
            onChange={(e) => setDisplay(e.target.value as "USD" | "AED" | "SAR")}
            className="bg-bg-elevate border border-border rounded px-2 py-1"
            data-testid="select-display-currency"
          >
            <option value="USD">USD</option>
            <option value="AED">AED</option>
            <option value="SAR">SAR</option>
          </select>
          <span className="text-text-mute">{filtered.length} expense{filtered.length === 1 ? "" : "s"}</span>
        </div>

        {loading && <div className="py-8 text-text-mute">Loading…</div>}

        <div className="grid grid-cols-1 gap-3">
          {filtered.map((e) => (
            <Link
              key={e.id}
              href={`/wallet/expenses/${e.id}`}
              data-testid={`expense-row-${e.id}`}
            >
              <Card className="p-4 hover:border-gold/50 cursor-pointer transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-semibold text-text">{e.merchant ?? "(no merchant)"}</div>
                    <div className="text-xs font-mono text-text-mute">
                      {e.expenseDate} · {e.captureSource} · {e.category}
                    </div>
                    {e.summary && <div className="text-sm text-text-mute italic">{e.summary}</div>}
                  </div>
                  <div className="text-right space-y-2 shrink-0">
                    <div className="font-mono text-text">{fmt(e.usdAmount, e.currency, e.amount)}</div>
                    <div className="flex gap-1 justify-end flex-wrap">
                      <MonoChip tone={statusTone(e.status)}>{e.status}</MonoChip>
                      <MonoChip tone={policyTone(e.policyStatus)}>policy {e.policyStatus}</MonoChip>
                      {e.clientBillable && <MonoChip tone="gold">billable +{e.markupPct}%</MonoChip>}
                      {e.vatTreatment !== "none" && <MonoChip>{e.vatTreatment}</MonoChip>}
                    </div>
                  </div>
                </div>
                {e.policyFindings && e.policyFindings.length > 0 && (
                  <ul className="mt-2 text-xs font-mono space-y-0.5">
                    {e.policyFindings.slice(0, 2).map((f, i) => (
                      <li
                        key={i}
                        className={f.severity === "red" ? "text-red-400" : "text-amber-400"}
                      >
                        ⚑ {f.message}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Link>
          ))}
          {!loading && filtered.length === 0 && (
            <Card className="p-8 text-center text-text-mute border-dashed">
              No expenses yet. <Link href="/wallet/expenses/new" className="text-gold underline">Submit one</Link>.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
