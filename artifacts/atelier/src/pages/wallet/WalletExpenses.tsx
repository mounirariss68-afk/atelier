import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { RecordCard } from "@/components/ui/record-card";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";

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

// Task #396 — unmatched-merchant admin loop (leadership only).
interface UnmatchedMerchant {
  id: string;
  rawMerchantText: string;
  normalizedText: string;
  occurrenceCount: number;
  status: string;
  lastSeenAt: string | null;
}

function MerchantAdminPanel() {
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<UnmatchedMerchant[]>([]);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [note, setNote] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await fetch("/api/atelier/wallet/merchants/unmatched", { credentials: "include" });
    if (!r.ok) return;
    const j = await r.json();
    setRows(j.merchants ?? []);
    setPendingCount(j.pendingCount ?? 0);
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const enrich = async () => {
    setRunning(true);
    setNote(null);
    try {
      const r = await fetch("/api/atelier/wallet/merchants/enrich", {
        method: "POST",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) throw new Error("An enrichment run is already in progress.");
      if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      const runId: string = j.runId;
      // Poll until done/failed.
      for (;;) {
        await new Promise((res) => setTimeout(res, 3000));
        const pr = await fetch(`/api/atelier/wallet/merchants/enrich/${runId}`, {
          credentials: "include",
        });
        const pj = await pr.json().catch(() => ({}));
        if (pj.status === "done") {
          const res = pj.result ?? {};
          setNote(
            `Classified ${res.classified ?? 0} of ${res.processed ?? 0} unknown merchants (${res.inserted ?? 0} added, ${res.remainingPending ?? 0} still pending).`,
          );
          break;
        }
        if (pj.status === "failed") throw new Error(pj.error || "Enrichment failed.");
      }
      await load();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="p-4 space-y-3" data-testid="merchant-admin-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          className="text-sm font-semibold text-text hover:text-gold"
          onClick={() => setOpen((v) => !v)}
          data-testid="btn-toggle-merchant-admin"
        >
          Unknown merchants {open ? "▾" : "▸"}
        </button>
        {open && (
          <button
            className="rounded bg-bg-elevate border border-border px-3 py-1.5 text-xs font-mono uppercase tracking-wider text-gold disabled:opacity-50"
            onClick={enrich}
            disabled={running || pendingCount === 0}
            data-testid="btn-enrich-merchants"
          >
            {running ? "Classifying…" : `AI-classify ${pendingCount} pending`}
          </button>
        )}
      </div>
      {open && (
        <>
          {note && <p className="text-xs text-text-mute" data-testid="enrich-note">{note}</p>}
          {rows.length === 0 ? (
            <p className="text-sm text-text-mute">No unknown merchants logged.</p>
          ) : (
            <ul className="divide-y divide-border-soft text-sm">
              {rows.slice(0, 30).map((m) => (
                <li key={m.id} className="py-1.5 flex items-center justify-between gap-2">
                  <span className="truncate">
                    <span className="text-text">{m.normalizedText}</span>{" "}
                    <span className="text-xs text-text-faint">({m.rawMerchantText})</span>
                  </span>
                  <span className="shrink-0 text-xs font-mono text-text-mute">
                    ×{m.occurrenceCount} · {m.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

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
  // Task #292 — wallet leadership = partner-tier + finance.
  const isLeader =
    me?.role === "founding_partner" ||
    me?.role === "partner" ||
    me?.role === "finance";

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
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Expenses"
          lede="Every expense policy-checked, VAT-handled, traceable to the client."
        />
      </PageHero>
      <SubSectionTabs
        tabs={[
        { id: "expenses", label: "Expenses", href: "/wallet" },
        { id: "invoices", label: "Invoices", href: "/wallet/invoices" },
        { id: "ar", label: "AR aging", href: "/wallet/ar" },
        { id: "collections", label: "Collections", href: "/wallet/collections" },
        { id: "expenses-new", label: "+ New expense", href: "/wallet/expenses/new" },
        { id: "cards", label: "Cards", href: "/wallet/cards" },
        { id: "policy", label: "Policy", href: "/wallet/policy", hidden: !isLeader },
        { id: "vat", label: "VAT register", href: "/wallet/vat", hidden: !isLeader },
      ]}
      />

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

        {isLeader && <MerchantAdminPanel />}

        {loading && <div className="py-8 text-text-mute">Loading…</div>}

        <div className="grid grid-cols-1 gap-3">
          {filtered.map((e) => (
            <RecordCard
              key={e.id}
              href={`/wallet/expenses/${e.id}`}
              title={e.merchant ?? "(no merchant)"}
              subtitle={
                <span className="font-mono">
                  {e.expenseDate} · {e.captureSource} · {e.category}
                </span>
              }
              trailing={
                <div className="text-right space-y-2">
                  <div className="font-mono text-text">{fmt(e.usdAmount, e.currency, e.amount)}</div>
                  <div className="flex gap-1 justify-end flex-wrap">
                    <MonoChip tone={statusTone(e.status)}>{e.status}</MonoChip>
                    <MonoChip tone={policyTone(e.policyStatus)}>policy {e.policyStatus}</MonoChip>
                    {e.clientBillable && <MonoChip tone="gold">billable +{e.markupPct}%</MonoChip>}
                    {e.vatTreatment !== "none" && <MonoChip>{e.vatTreatment}</MonoChip>}
                  </div>
                </div>
              }
              data-testid={`expense-row-${e.id}`}
            >
              {e.summary && <div className="text-sm text-text-mute italic">{e.summary}</div>}
              {e.policyFindings && e.policyFindings.length > 0 && (
                <ul className="text-xs font-mono space-y-0.5">
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
            </RecordCard>
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
