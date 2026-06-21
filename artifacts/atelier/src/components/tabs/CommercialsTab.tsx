import * as React from "react";
import {
  useAtelierGetDealPricing,
  useAtelierUpdateDealPricing,
  useAtelierWhatifDealPricing,
  useAtelierRunPricingStrategist,
  useAtelierOverridePricing,
  useAtelierCountersignPricing,
  useAtelierGetMe,
  getAtelierGetDealPricingQueryKey,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { fieldControlCls } from "@/components/ui/fieldControls";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Lock, ShieldAlert, Plus, Trash2 } from "lucide-react";

const SENIORITY_BANDS = [
  "Partner",
  "Principal",
  "SubjectMatterLead",
  "AIEngineer",
  "Designer",
  "Analyst",
];

interface TeamMixEntry {
  seniority: string;
  role?: string;
  ftePct: number;
}

const fmtUsd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n.toFixed(0)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

function MarginChip({ status, pct }: { status: "green" | "amber" | "red"; pct: number }) {
  const tone = status === "green" ? "green" : status === "amber" ? "amber" : "red";
  return (
    <MonoChip tone={tone}>
      Margin {fmtPct(pct)} · {status.toUpperCase()}
    </MonoChip>
  );
}

export function CommercialsTab({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const { data, isLoading, isError } = useAtelierGetDealPricing(oppId, {
    query: { enabled: !!oppId, queryKey: getAtelierGetDealPricingQueryKey(oppId) },
  });

  const update = useAtelierUpdateDealPricing({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetDealPricingQueryKey(oppId) });
        toast({ title: "Pricing saved", description: "Margin recalculated." });
      },
    },
  });
  const whatif = useAtelierWhatifDealPricing();
  const strategist = useAtelierRunPricingStrategist({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetDealPricingQueryKey(oppId) });
      },
    },
  });
  const override = useAtelierOverridePricing({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetDealPricingQueryKey(oppId) });
        toast({ title: "Override recorded" });
      },
    },
  });
  const countersign = useAtelierCountersignPricing({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getAtelierGetDealPricingQueryKey(oppId) });
        toast({ title: "Countersign recorded" });
      },
    },
  });

  const [draftMix, setDraftMix] = React.useState<TeamMixEntry[]>([]);
  const [draftWeeks, setDraftWeeks] = React.useState<number>(8);
  const [draftModel, setDraftModel] = React.useState<string>("time_and_materials");
  const [overrideRationale, setOverrideRationale] = React.useState("");
  const [countersignRationale, setCountersignRationale] = React.useState("");
  const [strategistResult, setStrategistResult] = React.useState<unknown | null>(null);

  React.useEffect(() => {
    if (!data?.pricing) return;
    setDraftMix((data.pricing.teamMix as TeamMixEntry[]) ?? []);
    setDraftWeeks(data.pricing.durationWeeks);
    setDraftModel(data.pricing.pricingModel);
  }, [data?.pricing?.id]);

  // Reactive what-if: recompute on draft changes (debounced 350 ms).
  // Margin chip updates live as Partner edits team mix / duration / model.
  React.useEffect(() => {
    if (!data?.pricing?.rateCardId) return;
    if (draftMix.length === 0) return;
    const handle = window.setTimeout(() => {
      whatif.mutate({
        oppId,
        data: {
          teamMix: draftMix,
          durationWeeks: draftWeeks,
          pricingModel: draftModel,
          rateCardId: data.pricing.rateCardId,
        },
      });
    }, 350);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftMix, draftWeeks, draftModel, oppId, data?.pricing?.rateCardId]);

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  if (isError || !data) {
    return (
      <Card className="p-6">
        <div className="text-text-mute text-sm">
          No active rate card found. Ask a Partner to seed one in <code className="font-mono text-gold">/pricing</code>.
        </div>
      </Card>
    );
  }

  const pricing = data.pricing;
  const policy = data.policy;
  const rateCardRows = data.rateCardRows ?? [];
  const isPartner = (me?.role === "partner" || me?.role === "founding_partner");

  const persistedMargin = pricing.computedMarginPct;
  const persistedStatus = pricing.marginLockStatus as "green" | "amber" | "red";

  const liveCompute = whatif.data;

  const onSave = () => {
    update.mutate({
      oppId,
      data: {
        teamMix: draftMix,
        durationWeeks: draftWeeks,
        pricingModel: draftModel,
        rateCardId: pricing.rateCardId,
      },
    });
  };

  const onWhatif = () => {
    whatif.mutate({
      oppId,
      data: {
        teamMix: draftMix,
        durationWeeks: draftWeeks,
        pricingModel: draftModel,
        rateCardId: pricing.rateCardId,
      },
    });
  };

  const addRow = () => {
    setDraftMix((prev) => [...prev, { seniority: "Analyst", role: "", ftePct: 0.5 }]);
  };
  const removeRow = (i: number) =>
    setDraftMix((prev) => prev.filter((_, idx) => idx !== i));
  const editRow = (i: number, patch: Partial<TeamMixEntry>) =>
    setDraftMix((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const onStrategist = async () => {
    const result = await strategist.mutateAsync({ oppId });
    setStrategistResult(result);
  };

  const onOverride = () => {
    if (!overrideRationale.trim()) {
      toast({ title: "Rationale required", variant: "destructive" });
      return;
    }
    override.mutate({ oppId, data: { rationale: overrideRationale } });
  };
  const onCountersign = () => {
    if (!countersignRationale.trim()) {
      toast({ title: "Rationale required", variant: "destructive" });
      return;
    }
    countersign.mutate({ oppId, data: { rationale: countersignRationale } });
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-mono text-sm tracking-widest uppercase text-gold">
            Deal Pricing
          </h3>
          <div className="flex items-center gap-2">
            <MarginChip status={persistedStatus} pct={persistedMargin} />
            <MonoChip>Target {fmtPct(policy.targetMarginPct)}</MonoChip>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-md border border-border-soft p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Cost</div>
            <div className="text-2xl text-text font-semibold">{fmtUsd(pricing.computedCostUsd)}</div>
          </div>
          <div className="rounded-md border border-border-soft p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Price</div>
            <div className="text-2xl text-text font-semibold">{fmtUsd(pricing.computedPriceUsd)}</div>
          </div>
          <div className="rounded-md border border-border-soft p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Margin</div>
            <div className="text-2xl text-text font-semibold">{fmtPct(persistedMargin)}</div>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute">Team Mix · What-if</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addRow} data-testid="button-add-row">
              <Plus className="w-3 h-3 mr-1" /> Row
            </Button>
            <Button variant="outline" size="sm" onClick={onWhatif} data-testid="button-whatif">
              Recompute
            </Button>
            <Button size="sm" onClick={onSave} disabled={update.isPending} data-testid="button-save-pricing">
              Save
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 items-end">
          <label className="text-xs text-text-mute font-mono uppercase tracking-widest">
            Duration (weeks)
            <Input
              type="number"
              min={1}
              value={draftWeeks}
              onChange={(e) => setDraftWeeks(parseFloat(e.target.value) || 0)}
              className="bg-bg-elevate border-border text-text mt-1"
              data-testid="input-duration"
            />
          </label>
          <label className="text-xs text-text-mute font-mono uppercase tracking-widest">
            Pricing model
            <select
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              className={`${fieldControlCls} mt-1 bg-bg-elevate border border-border rounded-md text-text text-sm`}
              data-testid="select-model"
            >
              <option value="time_and_materials">Time &amp; Materials</option>
              <option value="fixed_fee">Fixed Fee</option>
              <option value="outcome_based">Outcome-Based</option>
              <option value="retainer">Retainer</option>
            </select>
          </label>
        </div>

        <div className="border border-border-soft rounded-md divide-y divide-border-soft">
          {draftMix.length === 0 && (
            <div className="px-4 py-6 text-center text-text-faint text-sm">
              No team members staffed yet. Click <span className="text-gold">Row</span> to add a seniority band.
            </div>
          )}
          {draftMix.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center px-4 py-2" data-testid={`row-mix-${i}`}>
              <select
                value={row.seniority}
                onChange={(e) => editRow(i, { seniority: e.target.value })}
                className={`${fieldControlCls} col-span-4 bg-bg-elevate border border-border rounded-md text-text text-sm`}
                data-testid={`select-seniority-${i}`}
              >
                {SENIORITY_BANDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <Input
                placeholder="Role (e.g. Pursuit Lead)"
                value={row.role ?? ""}
                onChange={(e) => editRow(i, { role: e.target.value })}
                className="col-span-5 bg-bg-elevate border-border text-text"
                data-testid={`input-role-${i}`}
              />
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={row.ftePct}
                onChange={(e) => editRow(i, { ftePct: parseFloat(e.target.value) || 0 })}
                className="col-span-2 bg-bg-elevate border-border text-text"
                data-testid={`input-fte-${i}`}
              />
              <button
                onClick={() => removeRow(i)}
                className="col-span-1 text-text-faint hover:text-danger transition-colors"
                data-testid={`button-remove-${i}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {liveCompute && (
          <div className="rounded-md border border-gold/30 bg-bg-elevate/40 p-3 flex items-center justify-between">
            <div className="text-xs text-text-mute">
              <span className="font-mono uppercase tracking-widest">What-if</span> · Cost {fmtUsd(liveCompute.computedCostUsd)} · Price {fmtUsd(liveCompute.computedPriceUsd)}
            </div>
            <MarginChip
              status={liveCompute.marginLockStatus as "green" | "amber" | "red"}
              pct={liveCompute.computedMarginPct}
            />
          </div>
        )}

        <div className="text-[11px] text-text-faint font-mono">
          Rate card rows loaded: {rateCardRows.length}
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-sm tracking-widest uppercase text-text-mute flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold" /> Pricing Strategist
          </h3>
          <Button onClick={onStrategist} disabled={strategist.isPending} data-testid="button-strategist">
            {strategist.isPending ? "Working…" : "Run Strategist"}
          </Button>
        </div>
        {strategistResult ? (
          <StrategistBrief result={strategistResult as StrategistResultShape} />
        ) : (
          <p className="text-xs text-text-mute">
            Builds the deal model and proposes 2–3 alternative structures. Numbers are server-computed; narrative is Sonnet-authored.
          </p>
        )}
      </Card>

      {(persistedStatus === "amber" || persistedStatus === "red") && (
        <Card className="p-6 space-y-4 border-amber-500/40">
          <h3 className="font-mono text-sm tracking-widest uppercase text-amber-400 flex items-center gap-2">
            <Lock className="w-4 h-4" /> Margin lock — {persistedStatus.toUpperCase()}
          </h3>
          <p className="text-sm text-text-mute">
            Submit-proposal is blocked until a Partner records an override
            {persistedStatus === "red" ? " and a second Partner countersigns" : ""}.
          </p>
          {!pricing.partnerOverrideId && (
            <div className="space-y-2">
              <Input
                value={overrideRationale}
                onChange={(e) => setOverrideRationale(e.target.value)}
                placeholder="Why this discount? (logo, IP, market entry…)"
                className="bg-bg-elevate border-border text-text"
                data-testid="input-override-rationale"
              />
              <Button
                onClick={onOverride}
                disabled={!isPartner || override.isPending}
                data-testid="button-override"
              >
                {isPartner ? "Record Partner override" : "Partner role required"}
              </Button>
            </div>
          )}
          {pricing.partnerOverrideId && (
            <div className="text-xs text-text-mute font-mono">
              First override by {pricing.partnerOverrideId} · {pricing.partnerOverrideRationale}
            </div>
          )}
          {persistedStatus === "red" && pricing.partnerOverrideId && !pricing.countersignPartnerId && (
            <div className="space-y-2 pt-3 border-t border-border-soft">
              <div className="text-xs font-mono uppercase tracking-widest text-amber-400 flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5" /> Two-Partner countersign required
              </div>
              <Input
                value={countersignRationale}
                onChange={(e) => setCountersignRationale(e.target.value)}
                placeholder="Countersign rationale"
                className="bg-bg-elevate border-border text-text"
                data-testid="input-countersign-rationale"
              />
              <Button
                onClick={onCountersign}
                disabled={!isPartner || pricing.partnerOverrideId === me?.id || countersign.isPending}
                data-testid="button-countersign"
              >
                {pricing.partnerOverrideId === me?.id
                  ? "A different Partner must countersign"
                  : "Countersign as Partner"}
              </Button>
            </div>
          )}
          {pricing.countersignPartnerId && (
            <div className="text-xs text-text-mute font-mono">
              Countersigned by {pricing.countersignPartnerId} · {pricing.countersignRationale}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

interface StrategistResultShape {
  primary: {
    pricingModel: string;
    cost: number;
    price: number;
    marginPct: number;
    marginLockStatus: "green" | "amber" | "red";
    narrative: string;
  };
  alternatives: Array<{
    pricingModel: string;
    cost: number;
    price: number;
    marginPct: number;
    marginLockStatus: "green" | "amber" | "red";
    story: string;
  }>;
  talkingPoints: string[];
  risks: string[];
}

function StrategistBrief({ result }: { result: StrategistResultShape }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gold/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono uppercase tracking-widest text-gold">Primary recommendation</div>
          <MarginChip status={result.primary.marginLockStatus} pct={result.primary.marginPct} />
        </div>
        <div className="text-sm text-text">{result.primary.narrative}</div>
        <div className="text-xs text-text-faint font-mono">
          {result.primary.pricingModel.replace(/_/g, " ")} · {fmtUsd(result.primary.price)} price · {fmtUsd(result.primary.cost)} cost
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Alternatives</div>
        <div className="grid gap-2">
          {result.alternatives.map((alt, i) => (
            <div key={i} className="rounded-md border border-border-soft p-3 space-y-1" data-testid={`alt-${i}`}>
              <div className="flex items-center justify-between">
                <span className="text-text font-semibold capitalize">
                  {alt.pricingModel.replace(/_/g, " ")}
                </span>
                <MarginChip status={alt.marginLockStatus} pct={alt.marginPct} />
              </div>
              <div className="text-sm text-text-mute">{alt.story}</div>
              <div className="text-xs text-text-faint font-mono">
                {fmtUsd(alt.price)} price · {fmtUsd(alt.cost)} cost
              </div>
            </div>
          ))}
        </div>
      </div>

      {result.talkingPoints.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Talking points</div>
          <ul className="text-sm text-text space-y-1 list-disc list-inside">
            {result.talkingPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {result.risks.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-mono uppercase tracking-widest text-text-mute">Risks</div>
          <ul className="text-sm text-amber-300 space-y-1 list-disc list-inside">
            {result.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
