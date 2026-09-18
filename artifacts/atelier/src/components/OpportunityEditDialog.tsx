import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PillButton } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { OpportunityPartnerPicker } from "@/components/OpportunityPartnerPicker";
import { canEditPartnerAssociations } from "@/lib/lens";
import {
  useAtelierUpdateOpportunity,
  useAtelierGetMe,
  getAtelierListJointPipelineQueryKey,
  getAtelierListAccountsQueryKey,
  getAtelierGetOpportunityQueryKey,
  getAtelierListOpportunitiesQueryKey,
  getAtelierListAuditQueryKey,
  getAtelierGetPipelineForecastQueryKey,
  type Opportunity,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  opp: Opportunity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpportunityEditDialog({ opp, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useAtelierUpdateOpportunity();
  const { data: me } = useAtelierGetMe();
  const [partnerFirmIds, setPartnerFirmIds] = React.useState<string[]>([]);
  const [partnersChanged, setPartnersChanged] = React.useState(false);
  const seededFor = React.useRef<string | null>(null);

  const [name, setName] = React.useState(opp.name);
  const [dealSizeUsd, setDealSizeUsd] = React.useState(String(opp.dealSizeUsd));
  const [probabilityPct, setProbabilityPct] = React.useState(String(opp.probabilityPct));
  const [nextMilestone, setNextMilestone] = React.useState(opp.nextMilestone ?? "");
  const [nextMilestoneDate, setNextMilestoneDate] = React.useState(
    opp.nextMilestoneDate ? opp.nextMilestoneDate.slice(0, 10) : "",
  );
  const [closeDate, setCloseDate] = React.useState(
    opp.closeDate ? opp.closeDate.slice(0, 10) : "",
  );
  const [forecastCategory, setForecastCategory] = React.useState<
    NonNullable<Opportunity["forecastCategory"]>
  >(opp.forecastCategory ?? "pipeline");
  const [buyerPersona, setBuyerPersona] = React.useState(opp.buyerPersona ?? "");
  const [offeringAnchor, setOfferingAnchor] = React.useState(opp.offeringAnchor ?? "");

  React.useEffect(() => {
    if (!open) { seededFor.current = null; return; }
    if (seededFor.current === opp.id) return;
    seededFor.current = opp.id;
    setPartnerFirmIds((opp.partnerFirms ?? []).map((firm) => firm.id));
    setPartnersChanged(false);
    setName(opp.name);
    setDealSizeUsd(String(opp.dealSizeUsd));
    setProbabilityPct(String(opp.probabilityPct));
    setNextMilestone(opp.nextMilestone ?? "");
    setNextMilestoneDate(opp.nextMilestoneDate ? opp.nextMilestoneDate.slice(0, 10) : "");
    setCloseDate(opp.closeDate ? opp.closeDate.slice(0, 10) : "");
    setForecastCategory(opp.forecastCategory ?? "pipeline");
    setBuyerPersona(opp.buyerPersona ?? "");
    setOfferingAnchor(opp.offeringAnchor ?? "");
  }, [open, opp]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const deal = Number(dealSizeUsd);
    const prob = Number(probabilityPct);
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(deal) || deal < 0) {
      toast({ title: "Deal size must be a non-negative number", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(prob) || prob < 0 || prob > 100) {
      toast({ title: "Probability must be between 0 and 100", variant: "destructive" });
      return;
    }
    try {
      await update.mutateAsync({
        oppId: opp.id,
        data: {
          name: name.trim(),
          dealSizeUsd: deal,
          probabilityPct: prob,
          nextMilestone: nextMilestone.trim() || null,
          nextMilestoneDate: nextMilestoneDate.trim() || null,
          closeDate: closeDate.trim() || null,
          forecastCategory,
          buyerPersona: buyerPersona.trim() || null,
          offeringAnchor: offeringAnchor.trim() || null,
          ...(partnersChanged && canEditPartnerAssociations(me?.role) ? { partnerFirmIds } : {}),
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierGetOpportunityQueryKey(opp.id) });
      qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierGetPipelineForecastQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListJointPipelineQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierListAccountsQueryKey() });
      toast({ title: "Opportunity updated", description: "Changes recorded in the audit trail." });
      onOpenChange(false);
    } catch (err: unknown) {
      toast({ title: "Could not update opportunity", description: String(err), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Edit opportunity</DialogTitle>
          <DialogDescription className="text-text-mute">
            Update core details on <span className="font-mono text-text">{opp.name}</span>.
            Edits are audit-logged. Stage moves still go through <span className="font-mono">Move stage</span>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-5 py-3">
          <div className="grid gap-2">
            <Label htmlFor="e-name" className="text-xs uppercase tracking-widest font-mono text-text-faint">
              Name
            </Label>
            <Input
              id="e-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-bg-deep border-border-soft"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="e-deal" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                Deal size (USD)
              </Label>
              <Input
                id="e-deal"
                type="number"
                min={0}
                value={dealSizeUsd}
                onChange={(e) => setDealSizeUsd(e.target.value)}
                className="bg-bg-deep border-border-soft"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="e-prob" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                Probability %
              </Label>
              <Input
                id="e-prob"
                type="number"
                min={0}
                max={100}
                value={probabilityPct}
                onChange={(e) => setProbabilityPct(e.target.value)}
                className="bg-bg-deep border-border-soft"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="e-milestone" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                Next milestone
              </Label>
              <Input
                id="e-milestone"
                value={nextMilestone}
                onChange={(e) => setNextMilestone(e.target.value)}
                placeholder="e.g. POV demo with COO"
                className="bg-bg-deep border-border-soft"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="e-milestone-date" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                Target date
              </Label>
              <Input
                id="e-milestone-date"
                type="date"
                value={nextMilestoneDate}
                onChange={(e) => setNextMilestoneDate(e.target.value)}
                className="bg-bg-deep border-border-soft"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="e-close-date" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                Expected close date
              </Label>
              <Input
                id="e-close-date"
                type="date"
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
                className="bg-bg-deep border-border-soft"
                data-testid="input-edit-close-date"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="e-forecast-cat" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                Forecast category
              </Label>
              <select
                id="e-forecast-cat"
                value={forecastCategory}
                onChange={(e) =>
                  setForecastCategory(
                    e.target.value as NonNullable<Opportunity["forecastCategory"]>,
                  )
                }
                className="bg-bg-deep border border-border-soft rounded px-3 py-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-gold/50"
                data-testid="select-edit-forecast-category"
              >
                <option value="pipeline">Pipeline</option>
                <option value="best_case">Best case</option>
                <option value="commit">Commit</option>
                <option value="omitted">Omitted</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="e-persona" className="text-xs uppercase tracking-widest font-mono text-text-faint">
              Buyer persona
            </Label>
            <Textarea
              id="e-persona"
              value={buyerPersona}
              onChange={(e) => setBuyerPersona(e.target.value)}
              placeholder="Who owns the decision and what do they care about?"
              className="bg-bg-deep border-border-soft min-h-[64px]"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="e-anchor" className="text-xs uppercase tracking-widest font-mono text-text-faint">
              Offering anchor
            </Label>
            <Input
              id="e-anchor"
              value={offeringAnchor}
              onChange={(e) => setOfferingAnchor(e.target.value)}
              placeholder="e.g. Target operating model"
              className="bg-bg-deep border-border-soft"
            />
          </div>
          <OpportunityPartnerPicker
            value={partnerFirmIds}
            onChange={(ids) => { setPartnerFirmIds(ids); setPartnersChanged(true); }}
            retained={opp.partnerFirms ?? []}
            dialogOpen={open}
            role={me?.role}
            disabled={update.isPending}
          />
          <div className="flex justify-end gap-2 pt-1">
            <PillButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </PillButton>
            <PillButton type="submit" variant="primary" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
