import * as React from "react";
import { Link } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";
import { WalletTabs } from "./walletTabs";

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

export interface CreateDefaults { billToName: string | null; jurisdiction: string; currency: string }
export interface EngagementOption { id: string; name: string; plmStage: string; accountId: string; accountName: string | null; defaults: CreateDefaults }
export interface AccountOption { id: string; name: string; defaults: CreateDefaults }
export interface CreateOptions { engagements: EngagementOption[]; accounts: AccountOption[] }

const FINANCE_OR_PARTNER = new Set(["founding_partner", "partner", "finance", "senior_manager"]);
const JURISDICTIONS = ["AE", "SA", "EU", "GLOBAL"] as const;

/** Task #1288 — pointer from the outbound (AR) invoice surface to the AP upload path. */
export function SupplierInvoiceSignpost({ canLink }: { canLink: boolean }) {
  return (
    <div
      className="flex items-center gap-2 text-xs text-text-mute border border-border-soft rounded px-3 py-2 bg-bg-elevate/40"
      data-testid="supplier-invoice-signpost"
    >
      <span>
        This page is for invoices <span className="text-text">Cognirise issues to clients</span>. Received a
        supplier invoice?{" "}
        {canLink ? (
          <Link href="/finance/payables/supplier-invoices" className="text-gold hover:underline" data-testid="link-supplier-invoices">
            Upload it in Finance → Pay → Supplier invoices
          </Link>
        ) : (
          <span>Ask Finance to upload it under Finance → Pay → Supplier invoices.</span>
        )}
      </span>
    </div>
  );
}

/** Task #1288 — engagement-aware "New invoice" dialog. */
function NewInvoiceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [opts, setOpts] = React.useState<CreateOptions | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"engagement" | "account">("engagement");
  const [engagementId, setEngagementId] = React.useState("");
  const [accountId, setAccountId] = React.useState("");
  const [billToName, setBillToName] = React.useState("");
  const [billToEmail, setBillToEmail] = React.useState("");
  const [jurisdiction, setJurisdiction] = React.useState("GLOBAL");
  const [currency, setCurrency] = React.useState("USD");
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void fetch("/api/atelier/wallet/invoice-create-options", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message ?? r.statusText);
        return r.json();
      })
      .then((j: CreateOptions) => { if (alive) setOpts(j); })
      .catch((e: Error) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, []);

  const applyDefaults = (d: CreateDefaults | undefined) => {
    if (!d) return;
    if (!touched) {
      setBillToName(d.billToName ?? "");
      setJurisdiction(d.jurisdiction);
      setCurrency(d.currency);
    }
  };

  async function create() {
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        jurisdiction,
        currency,
        billTo: { name: billToName, ...(billToEmail ? { contactEmail: billToEmail } : {}) },
      };
      if (mode === "engagement" && engagementId) body.engagementId = engagementId;
      if (mode === "account" && accountId) body.accountId = accountId;
      const r = await fetch("/api/atelier/wallet/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.message ?? r.statusText); return; }
      onCreated(j.invoice.id);
    } finally { setBusy(false); }
  }

  const selectionMade = mode === "engagement" ? !!engagementId : !!accountId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-5 space-y-4" data-testid="dialog-new-invoice" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div>
          <div className="text-base font-medium">New client invoice</div>
          <div className="text-xs text-text-mute mt-1">
            Pick the engagement this invoice bills for — Compose can then pull its approved time and billable
            expenses straight onto the draft. Bill To, jurisdiction and currency prefill from the client account.
          </div>
        </div>

        {loadError && <div className="text-xs text-danger">⚠ Could not load engagements: {loadError}</div>}

        <div className="flex gap-3 text-xs font-mono">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={mode === "engagement"} onChange={() => setMode("engagement")} data-testid="radio-mode-engagement" />
            For an engagement
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={mode === "account"} onChange={() => setMode("account")} data-testid="radio-mode-account" />
            Account only (no engagement yet)
          </label>
        </div>

        {mode === "engagement" ? (
          <div className="space-y-1">
            <label className="text-[11px] font-mono uppercase text-text-faint">Engagement</label>
            <select
              value={engagementId}
              onChange={(e) => {
                setEngagementId(e.target.value);
                applyDefaults(opts?.engagements.find((o) => o.id === e.target.value)?.defaults);
              }}
              className="w-full bg-bg-elevate border border-border rounded px-2 py-1.5 text-sm"
              data-testid="select-engagement"
            >
              <option value="">{opts ? (opts.engagements.length === 0 ? "No engagements yet" : "Select an engagement…") : "Loading…"}</option>
              {opts?.engagements.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.accountName ? ` — ${e.accountName}` : ""}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-[11px] font-mono uppercase text-text-faint">Client account</label>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                applyDefaults(opts?.accounts.find((o) => o.id === e.target.value)?.defaults);
              }}
              className="w-full bg-bg-elevate border border-border rounded px-2 py-1.5 text-sm"
              data-testid="select-account"
            >
              <option value="">{opts ? (opts.accounts.length === 0 ? "No accounts yet" : "Select an account…") : "Loading…"}</option>
              {opts?.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <div className="text-[11px] text-text-mute">
              Without an engagement, Compose can't pull time &amp; expenses — you can attach one on the draft later.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <label className="text-[11px] font-mono uppercase text-text-faint">Bill to</label>
            <input
              value={billToName}
              onChange={(e) => { setBillToName(e.target.value); setTouched(true); }}
              placeholder="Client legal name"
              className="w-full bg-bg-elevate border border-border rounded px-2 py-1.5 text-sm"
              data-testid="input-billto-name"
            />
          </div>
          <div className="space-y-1 col-span-2">
            <label className="text-[11px] font-mono uppercase text-text-faint">Billing contact email (optional)</label>
            <input
              value={billToEmail}
              onChange={(e) => setBillToEmail(e.target.value)}
              placeholder="billing@client.com"
              className="w-full bg-bg-elevate border border-border rounded px-2 py-1.5 text-sm"
              data-testid="input-billto-email"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-mono uppercase text-text-faint">Jurisdiction (VAT)</label>
            <select
              value={jurisdiction}
              onChange={(e) => { setJurisdiction(e.target.value); setTouched(true); }}
              className="w-full bg-bg-elevate border border-border rounded px-2 py-1.5 text-sm"
              data-testid="select-jurisdiction"
            >
              {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-mono uppercase text-text-faint">Currency</label>
            <input
              value={currency}
              onChange={(e) => { setCurrency(e.target.value.toUpperCase()); setTouched(true); }}
              className="w-full bg-bg-elevate border border-border rounded px-2 py-1.5 text-sm font-mono"
              data-testid="input-currency"
            />
          </div>
        </div>

        {error && <div className="text-xs text-danger" data-testid="text-create-error">⚠ {error}</div>}

        <div className="flex justify-end gap-2 text-sm">
          <button onClick={onClose} className="px-3 py-1 rounded border border-border text-text-mute hover:bg-bg-elevate" data-testid="btn-cancel-create">
            Cancel
          </button>
          <button
            onClick={() => void create()}
            disabled={busy || !selectionMade || !billToName.trim()}
            className="px-3 py-1 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 disabled:opacity-40"
            data-testid="btn-create-invoice"
          >
            {busy ? "Creating…" : "Create draft"}
          </button>
        </div>
      </Card>
    </div>
  );
}

export default function WalletInvoices() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [items, setItems] = React.useState<Invoice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [showCreate, setShowCreate] = React.useState(false);

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

  function statusTone(s: string): "green" | "gold" | "red" | undefined {
    if (s === "paid") return "green";
    if (s === "void") return "red";
    if (s === "issued") return "gold";
    return undefined;
  }

  return (
    <div className="min-h-screen text-text">
      <PageHero>
        <SectionHead
          eyebrow="Firm · Wallet"
          headline="Client invoices"
          lede="Invoices Cognirise issues to clients (accounts receivable). Issue, clear with the tax authority, and chase. Numbers are gap-free per jurisdiction."
        />
      </PageHero>
      <WalletTabs group="main" />

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        <SupplierInvoiceSignpost canLink={canDraft} />

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
              onClick={() => setShowCreate(true)}
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
          <Card className="p-6 text-text-mute">No client invoices yet.</Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm" data-testid="invoice-list">
              <thead className="bg-bg-elevate/50 text-[11px] font-mono uppercase text-text-faint">
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

      {showCreate && (
        <NewInvoiceDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { window.location.href = `/wallet/invoices/${id}`; }}
        />
      )}
    </div>
  );
}
