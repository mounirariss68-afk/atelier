import * as React from "react";
import {
  useAtelierGetMe,
  useAtelierListRateCards,
  useAtelierGetRateCard,
  useAtelierGetMarginPolicy,
  useAtelierUpdateMarginPolicy,
  useAtelierAddRateCardRow,
  getAtelierGetRateCardQueryKey,
  getAtelierGetMarginPolicyQueryKey,
  getAtelierListRateCardsQueryKey,
} from "@workspace/api-client-react";
import { SectionHead, PageHero, Card, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Lock } from "lucide-react";

const SENIORITY_BANDS = [
  "Partner",
  "Principal",
  "SubjectMatterLead",
  "AIEngineer",
  "Designer",
  "Analyst",
];

export default function Pricing() {
  const { data: me, isLoading } = useAtelierGetMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: cards } = useAtelierListRateCards({
    query: { enabled: me?.role === "partner", queryKey: getAtelierListRateCardsQueryKey() },
  });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!selectedId && cards && cards.length > 0) setSelectedId(cards[0].id);
  }, [cards, selectedId]);

  const { data: card } = useAtelierGetRateCard(selectedId ?? "", {
    query: {
      enabled: !!selectedId,
      queryKey: getAtelierGetRateCardQueryKey(selectedId ?? ""),
    },
  });
  const { data: policy } = useAtelierGetMarginPolicy({
    query: { enabled: me?.role === "partner", queryKey: getAtelierGetMarginPolicyQueryKey() },
  });

  const updatePolicy = useAtelierUpdateMarginPolicy({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetMarginPolicyQueryKey() });
        toast({ title: "Margin policy updated" });
      },
    },
  });
  const addRow = useAtelierAddRateCardRow({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetRateCardQueryKey(selectedId ?? "") });
        toast({ title: "Row added" });
        setNewRow({ role: "", seniority: "Analyst", dayRateInternalCost: 600, dayRateClientPrice: 1500, overheadPct: 0.25, currency: "USD" });
      },
    },
  });

  const [target, setTarget] = React.useState("");
  const [amber, setAmber] = React.useState("");
  const [red, setRed] = React.useState("");
  React.useEffect(() => {
    if (policy) {
      setTarget(String(policy.targetMarginPct));
      setAmber(String(policy.amberThresholdPct));
      setRed(String(policy.redThresholdPct));
    }
  }, [policy]);

  const [newRow, setNewRow] = React.useState({
    role: "",
    seniority: "Analyst",
    dayRateInternalCost: 600,
    dayRateClientPrice: 1500,
    overheadPct: 0.25,
    currency: "USD",
  });

  if (isLoading) return <div className="container-atelier py-12"><Skeleton className="h-64 bg-bg-elevate" /></div>;
  if (!me) return null;

  if (me.role !== "partner") {
    return (
      <div className="container-atelier py-20 flex flex-col items-center text-center animate-in fade-in">
        <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mb-6 text-danger">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-semibold text-text mb-3">Partner Access Required</h2>
        <p className="text-text-mute max-w-md">
          Pricing administration is restricted to firm Partners.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead headline="Pricing" lede="Rate cards, margin policy, and the levers that protect them." />
      </PageHero>

      <div className="container-atelier py-10 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm tracking-widest uppercase text-gold">Rate Cards</h3>
              <MonoChip>{cards?.length ?? 0} card(s)</MonoChip>
            </div>
            <div className="flex flex-wrap gap-2">
              {(cards ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`px-3 py-1.5 rounded-md border text-xs font-mono transition-colors ${
                    selectedId === c.id
                      ? "border-gold/60 bg-gold/10 text-gold"
                      : "border-border-soft text-text-mute hover:text-text"
                  }`}
                  data-testid={`button-card-${c.id}`}
                >
                  {c.name} · {c.geography}
                </button>
              ))}
            </div>
            {card && (
              <div className="space-y-3">
                <div className="text-xs text-text-faint font-mono">
                  {card.geography} · {card.currency} · {card.status}
                </div>
                <div className="border border-border-soft rounded-md divide-y divide-border-soft text-sm">
                  <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-text-faint bg-bg-elevate/40">
                    <div className="col-span-3">Seniority</div>
                    <div className="col-span-3">Role</div>
                    <div className="col-span-2 text-right">Cost/day</div>
                    <div className="col-span-2 text-right">Price/day</div>
                    <div className="col-span-2 text-right">Overhead</div>
                  </div>
                  {(card.rows ?? []).map((r) => (
                    <div key={r.id} className="grid grid-cols-12 gap-2 px-4 py-2" data-testid={`row-card-${r.id}`}>
                      <div className="col-span-3 text-text">{r.seniority}</div>
                      <div className="col-span-3 text-text-mute">{r.role}</div>
                      <div className="col-span-2 text-right font-mono text-text">${r.dayRateInternalCost.toFixed(0)}</div>
                      <div className="col-span-2 text-right font-mono text-text">${r.dayRateClientPrice.toFixed(0)}</div>
                      <div className="col-span-2 text-right font-mono text-text-mute">{(r.overheadPct * 100).toFixed(0)}%</div>
                    </div>
                  ))}
                  {(!card.rows || card.rows.length === 0) && (
                    <div className="px-4 py-6 text-center text-text-faint text-sm">No rows yet — add one below.</div>
                  )}
                </div>
                <div className="grid grid-cols-12 gap-2 items-end pt-3 border-t border-border-soft">
                  <select
                    value={newRow.seniority}
                    onChange={(e) => setNewRow({ ...newRow, seniority: e.target.value })}
                    className="col-span-3 bg-bg-elevate border border-border rounded-md px-2 py-1.5 text-text text-sm"
                    data-testid="select-new-seniority"
                  >
                    {SENIORITY_BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <Input
                    placeholder="Role"
                    value={newRow.role}
                    onChange={(e) => setNewRow({ ...newRow, role: e.target.value })}
                    className="col-span-3 bg-bg-elevate border-border text-text"
                    data-testid="input-new-role"
                  />
                  <Input
                    type="number"
                    value={newRow.dayRateInternalCost}
                    onChange={(e) => setNewRow({ ...newRow, dayRateInternalCost: parseFloat(e.target.value) || 0 })}
                    className="col-span-2 bg-bg-elevate border-border text-text"
                    data-testid="input-new-cost"
                  />
                  <Input
                    type="number"
                    value={newRow.dayRateClientPrice}
                    onChange={(e) => setNewRow({ ...newRow, dayRateClientPrice: parseFloat(e.target.value) || 0 })}
                    className="col-span-2 bg-bg-elevate border-border text-text"
                    data-testid="input-new-price"
                  />
                  <Button
                    size="sm"
                    onClick={() => selectedId && addRow.mutate({ id: selectedId, data: newRow })}
                    disabled={!selectedId || !newRow.role}
                    className="col-span-2"
                    data-testid="button-add-row"
                  >
                    Add row
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6 space-y-4 border-gold/30">
            <h3 className="font-mono text-sm tracking-widest uppercase text-gold flex items-center gap-2">
              <Lock className="w-4 h-4" /> Margin Policy
            </h3>
            <p className="text-xs text-text-mute">
              Below target → AMBER (single-Partner override). Below RED → two-Partner countersign.
            </p>
            <label className="text-xs text-text-mute font-mono uppercase tracking-widest block">
              Target margin (0..1)
              <Input
                type="number" step={0.01} min={0} max={1}
                value={target} onChange={(e) => setTarget(e.target.value)}
                className="bg-bg-elevate border-border text-text mt-1"
                data-testid="input-target"
              />
            </label>
            <label className="text-xs text-text-mute font-mono uppercase tracking-widest block">
              AMBER threshold
              <Input
                type="number" step={0.01} min={0} max={1}
                value={amber} onChange={(e) => setAmber(e.target.value)}
                className="bg-bg-elevate border-border text-text mt-1"
                data-testid="input-amber"
              />
            </label>
            <label className="text-xs text-text-mute font-mono uppercase tracking-widest block">
              RED threshold
              <Input
                type="number" step={0.01} min={0} max={1}
                value={red} onChange={(e) => setRed(e.target.value)}
                className="bg-bg-elevate border-border text-text mt-1"
                data-testid="input-red"
              />
            </label>
            <Button
              onClick={() =>
                updatePolicy.mutate({
                  data: {
                    targetMarginPct: parseFloat(target),
                    amberThresholdPct: parseFloat(amber),
                    redThresholdPct: parseFloat(red),
                    twoPartnerThresholdPct: parseFloat(red),
                  },
                })
              }
              data-testid="button-save-policy"
            >
              Save policy
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
