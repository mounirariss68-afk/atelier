/**
 * FinancePreFormation — pre-formation entity cost pools (Task #1092).
 *
 * Costs incurred for entities that don't legally exist yet (Istanbul,
 * Riyadh, …) are booked in the home (UAE) ledger, quarantined in the
 * "Pre-incorporation costs — recoverable" clearing account (1500) and
 * tracked here per prospective entity: running totals (posted vs.
 * pipeline), itemized sources, intended ownership structure with the
 * recommended settlement treatment, and staleness flags. The settle
 * action posts the corresponding GL journals on incorporation (or
 * abandonment) and stamps the pool settled with a full audit trail.
 */

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHero, Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { API_BASE } from "@/lib/v5-hooks";
import { Link } from "wouter";
import { ArrowUpRight, Loader2 } from "lucide-react";

interface PoolItem {
  kind: "expense" | "supplier_invoice" | "journal";
  id: string;
  label: string;
  date: string | null;
  amount: number;
  currency: string;
  usdAmount: number;
  status: string;
  posted: boolean;
}

interface PoolSettlement {
  treatment: string;
  settledAt: string;
  settledByName: string;
  approvalNote: string | null;
  journalEntryId: string | null;
  totalUsd: number;
}

interface Pool {
  entityId: string;
  name: string;
  legalNameEn: string;
  country: string;
  status: string;
  ownershipType: string | null;
  ownershipLabel: string | null;
  jvSplits: Array<{ partnerName: string; sharePct: number }> | null;
  formationNotes: string | null;
  recommendedTreatment: string | null;
  settlement: PoolSettlement | null;
  postedUsd: number;
  pipelineUsd: number;
  totalUsd: number;
  display: { currency: string; posted: number; pipeline: number; total: number };
  itemCount: number;
  items: PoolItem[];
  lastActivityAt: string | null;
  idleDays: number | null;
  staleFlags: string[];
}

const TREATMENTS: Array<{ value: string; label: string; hint: string }> = [
  { value: "recharge", label: "Intercompany recharge", hint: "Bill the full pool to the newly incorporated entity (IC receivable)." },
  { value: "jv_split", label: "JV split recharge", hint: "Recharge per the JV cost-sharing percentages on the entity's ownership record." },
  { value: "founder_receivable", label: "Founder receivable", hint: "Related-party receivable from the founders (founder-owned venture). Requires an approval note." },
  { value: "absorb", label: "Absorb into UAE P&L", hint: "Recognize the pool as UAE operating expense." },
  { value: "write_off", label: "Write off (abandoned)", hint: "Entity will not be formed — write the pool off as abandoned market-entry cost." },
];

const TREATMENT_LABEL: Record<string, string> = Object.fromEntries(
  TREATMENTS.map((t) => [t.value, t.label]),
);

const STALE_LABEL: Record<string, string> = {
  entity_active_unsettled: "Entity is active — settle the pool",
  no_recent_activity: "No recent activity — review",
};

function money(n: number, ccy: string): string {
  return `${ccy} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function usePreformationPools(currency: string) {
  return useQuery<{ items: Pool[]; displayCurrency: string; staleDays: number }>({
    queryKey: ["atelier-v5", "preformation-pools", currency],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/finance/preformation/pools?currency=${currency}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Pre-formation pools failed: ${res.status}`);
      return res.json();
    },
    staleTime: 15_000,
  });
}

function SettleDialog(props: {
  pool: Pool | null;
  onClose: () => void;
  onSettled: () => void;
}) {
  const { toast } = useToast();
  const [treatment, setTreatment] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const p = props.pool;

  React.useEffect(() => {
    if (p) {
      setTreatment(p.recommendedTreatment ?? "");
      setNote("");
      setError(null);
    }
  }, [p?.entityId]);

  if (!p) return null;
  const needsNote = p.ownershipType === "founder_partner" || treatment === "founder_receivable";

  const settle = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/finance/preformation/pools/${p.entityId}/settle`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ treatment, approvalNote: note.trim() || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? body?.error ?? `Settlement failed (${res.status})`);
        return;
      }
      toast({ title: "Pool settled", description: `${p.name} — ${TREATMENT_LABEL[treatment] ?? treatment}` });
      props.onSettled();
      props.onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Settle pre-formation pool — {p.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-text-mute">
            Posted clearing balance: <span className="text-text font-medium">{money(p.display.posted, p.display.currency)}</span>
            {p.pipelineUsd > 0 && (
              <span className="text-amber ml-2">
                (+{money(p.display.pipeline, p.display.currency)} not yet bookkept — run the Bookkeeper before settling)
              </span>
            )}
          </p>
          <div className="space-y-2">
            {TREATMENTS.map((t) => (
              <label
                key={t.value}
                className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer ${treatment === t.value ? "border-gold" : "border-border"}`}
              >
                <input
                  type="radio"
                  className="mt-1"
                  checked={treatment === t.value}
                  onChange={() => setTreatment(t.value)}
                  data-testid={`radio-treatment-${t.value}`}
                />
                <span>
                  <span className="text-text">
                    {t.label}
                    {p.recommendedTreatment === t.value && (
                      <MonoChip tone="gold" className="ml-2">recommended</MonoChip>
                    )}
                  </span>
                  <span className="block text-xs text-text-mute">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-text-mute">
              Approval note{needsNote ? " (required for founder-owned settlements)" : " (optional)"}
            </span>
            <textarea
              className="w-full rounded-md border border-border glass-surface px-2 py-1.5 text-sm text-text outline-none focus-visible:border-gold min-h-[70px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Who approved this settlement and on what basis?"
              data-testid="input-settle-note"
            />
          </label>
          {error && <p className="text-sm text-danger" data-testid="settle-error">⚠ {error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button
              onClick={settle}
              disabled={busy || !treatment || (needsNote && !note.trim())}
              data-testid="button-confirm-settle"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Settle pool
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function FinancePreFormation() {
  const qc = useQueryClient();
  const { data: me } = useAtelierGetMe();
  const [currency, setCurrency] = React.useState("USD");
  const { data, isLoading, error } = usePreformationPools(currency);
  const [settling, setSettling] = React.useState<Pool | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const canSettle = me?.role === "founding_partner" || me?.role === "partner" || me?.role === "finance";
  const pools = data?.items ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["atelier-v5", "preformation-pools"] });
    qc.invalidateQueries({ queryKey: ["atelier-v5", "legal-entities"] });
  };

  return (
    <div>
      <PageHero>
        <Eyebrow>Finance · Pre-formation</Eyebrow>
        <h1 className="text-xl text-text mt-1">Pre-formation cost pools</h1>
        <p className="text-sm text-text-mute mt-2 max-w-2xl">
          Costs for entities still being set up are booked in the UAE ledger, parked in the
          "Pre-incorporation costs — recoverable" clearing account, and settled deliberately on
          incorporation — recharged, split with JV partners, billed to founders, absorbed, or
          written off.
        </p>
      </PageHero>

      <div className="container-atelier py-10 space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-mute">Display currency</span>
          {["USD", "AED", "SAR", "TRY", "EUR"].map((c) => (
            <button
              key={c}
              className={`px-3 h-8 rounded-full text-xs font-mono border ${currency === c ? "border-gold text-gold" : "border-border text-text-mute hover:text-text"}`}
              onClick={() => setCurrency(c)}
              data-testid={`currency-${c}`}
            >
              {c}
            </button>
          ))}
          <div className="flex-1" />
          <Link href="/finance/entities" className="text-xs text-text-mute hover:text-gold inline-flex items-center gap-1">
            Legal-entity registry <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>

        {isLoading && <Card className="p-6 text-sm text-text-mute">Loading pools…</Card>}
        {error != null && (
          <Card className="p-6 text-sm text-danger" data-testid="pools-error">
            Could not load pre-formation pools. This page is limited to finance leadership.
          </Card>
        )}
        {!isLoading && !error && pools.length === 0 && (
          <Card className="p-8 text-center" data-testid="empty-pools">
            <Eyebrow>No pre-formation pools</Eyebrow>
            <p className="text-sm text-text-mute mt-2 max-w-md mx-auto">
              Create a prospective entity with status "In formation" in the legal-entity registry,
              then tag internal expenses or supplier invoices to it. Its costs will be quarantined
              here until the entity incorporates.
            </p>
          </Card>
        )}

        {pools.map((p) => (
          <Card key={p.entityId} className="p-5 space-y-4" data-testid={`pool-${p.entityId}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base text-text">{p.name}</h2>
                  <MonoChip tone={p.status === "in_formation" ? "amber" : p.status === "active" ? "green" : "default"}>
                    {p.status.replace(/_/g, " ")}
                  </MonoChip>
                  {p.settlement ? (
                    <MonoChip tone="green">settled · {TREATMENT_LABEL[p.settlement.treatment] ?? p.settlement.treatment}</MonoChip>
                  ) : (
                    p.staleFlags.map((f) => (
                      <MonoChip key={f} tone="red">{STALE_LABEL[f] ?? f}</MonoChip>
                    ))
                  )}
                </div>
                <p className="text-xs text-text-mute mt-1">
                  {p.ownershipLabel ?? "Ownership not specified"}
                  {p.jvSplits && p.jvSplits.length > 0 && (
                    <> · {p.jvSplits.map((s) => `${s.partnerName} ${s.sharePct}%`).join(", ")}</>
                  )}
                  {p.recommendedTreatment && !p.settlement && (
                    <> · recommended: <span className="text-text">{TREATMENT_LABEL[p.recommendedTreatment]}</span></>
                  )}
                </p>
                {p.formationNotes && <p className="text-xs text-text-faint mt-1">{p.formationNotes}</p>}
              </div>
              <div className="text-right">
                <div className="text-lg text-text" data-testid={`pool-total-${p.entityId}`}>
                  {money(p.display.total, p.display.currency)}
                </div>
                <div className="text-[11px] text-text-mute">
                  posted {money(p.display.posted, p.display.currency)}
                  {p.pipelineUsd > 0 && <> · pipeline {money(p.display.pipeline, p.display.currency)}</>}
                </div>
                {p.idleDays != null && !p.settlement && (
                  <div className="text-[11px] text-text-faint">last activity {p.idleDays}d ago</div>
                )}
              </div>
            </div>

            {p.settlement && (
              <div className="text-xs text-text-mute border-t border-border-soft pt-3">
                Settled {new Date(p.settlement.settledAt).toLocaleDateString()} by {p.settlement.settledByName}
                {" — "}${p.settlement.totalUsd.toFixed(2)} via {TREATMENT_LABEL[p.settlement.treatment] ?? p.settlement.treatment}
                {p.settlement.approvalNote && <> · note: “{p.settlement.approvalNote}”</>}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setExpanded(expanded === p.entityId ? null : p.entityId)}
                data-testid={`button-items-${p.entityId}`}
              >
                {expanded === p.entityId ? "Hide" : "Show"} items ({p.itemCount})
              </Button>
              {canSettle && !p.settlement && (
                <Button size="sm" onClick={() => setSettling(p)} data-testid={`button-settle-${p.entityId}`}>
                  Settle pool
                </Button>
              )}
              <Link href={`/finance/entities/${p.entityId}`} className="text-xs text-text-mute hover:text-gold ml-auto inline-flex items-center gap-1">
                Entity record <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            {expanded === p.entityId && (
              <div className="border-t border-border-soft pt-3 space-y-1.5">
                {p.items.length === 0 && <p className="text-xs text-text-mute">No items yet.</p>}
                {p.items.map((it) => (
                  <div key={`${it.kind}-${it.id}`} className="flex items-center gap-2 text-xs">
                    <MonoChip tone={it.kind === "journal" ? "gold" : "default"}>
                      {it.kind.replace(/_/g, " ")}
                    </MonoChip>
                    <span className="text-text truncate flex-1">{it.label}</span>
                    <span className="text-text-faint">{it.date ?? "—"}</span>
                    <span className="text-text-mute w-28 text-right">{money(it.amount, it.currency)}</span>
                    <MonoChip tone={it.posted ? "green" : "amber"}>{it.posted ? "posted" : it.status}</MonoChip>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      <SettleDialog pool={settling} onClose={() => setSettling(null)} onSettled={refresh} />
    </div>
  );
}
