import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PillButton } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierCreateStageTransition,
  getAtelierListOpportunitiesQueryKey,
  getAtelierGetOpportunityQueryKey,
  getAtelierGetStageHistoryQueryKey,
  getAtelierListAuditQueryKey,
  getAtelierGetPipelineForecastQueryKey,
  type SalesStage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  SALES_STAGES,
  SALES_STAGE_LABEL,
  SALES_STAGE_DEFAULT_PROB,
  TERMINAL_STAGES,
} from "@/lib/sales-stages";

interface Props {
  oppId: string;
  oppName: string;
  currentStage: SalesStage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialToStage?: SalesStage;
}

export function StageTransitionDialog({
  oppId,
  oppName,
  currentStage,
  open,
  onOpenChange,
  initialToStage,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const transition = useAtelierCreateStageTransition();

  const [toStage, setToStage] = React.useState<SalesStage>(initialToStage ?? currentStage);
  const [rationale, setRationale] = React.useState("");
  const [prob, setProb] = React.useState<number>(SALES_STAGE_DEFAULT_PROB[toStage]);
  const [milestone, setMilestone] = React.useState("");
  const [milestoneDate, setMilestoneDate] = React.useState("");
  const [override, setOverride] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setToStage(initialToStage ?? currentStage);
      setRationale("");
      setProb(SALES_STAGE_DEFAULT_PROB[initialToStage ?? currentStage]);
      setMilestone("");
      setMilestoneDate("");
      setOverride(false);
    }
  }, [open, initialToStage, currentStage]);

  React.useEffect(() => {
    setProb(SALES_STAGE_DEFAULT_PROB[toStage]);
  }, [toStage]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rationale.trim()) {
      toast({ title: "Rationale required", variant: "destructive" });
      return;
    }
    try {
      await transition.mutateAsync({
        oppId,
        data: {
          toStage,
          rationaleText: rationale.trim(),
          evidenceArtifactIds: [],
          newProbabilityPct: prob,
          nextMilestone: milestone.trim() || null,
          nextMilestoneDate: milestoneDate.trim() || null,
          partnerOverride: override,
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierListOpportunitiesQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierGetOpportunityQueryKey(oppId) });
      qc.invalidateQueries({ queryKey: getAtelierGetStageHistoryQueryKey(oppId) });
      qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
      qc.invalidateQueries({ queryKey: getAtelierGetPipelineForecastQueryKey() });
      toast({
        title: `Moved to ${SALES_STAGE_LABEL[toStage]}`,
        description: `Probability set to ${prob}%`,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 412) {
        toast({
          title: "5C qualifier required",
          description:
            "Late-stage moves require a completed 5C with a Go decision. Use partner override only if you have direct authority.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Could not move stage", description: String(err), variant: "destructive" });
      }
    }
  }

  const lateStage = ["proposal_in_flight", "submitted", "verbal_commit", "signed"].includes(toStage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] bg-bg-elevate border-gold/40 text-text">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Move stage</DialogTitle>
          <DialogDescription className="text-text-mute">
            Stage moves on <span className="font-mono text-text">{oppName}</span> are
            audit-logged. Provide a rationale and tune the win-probability.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5 py-3">
          <div className="grid gap-2">
            <Label className="text-xs uppercase tracking-widest font-mono text-text-faint">
              Move to stage
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {SALES_STAGES.map((s) => {
                const active = s === toStage;
                const isCurrent = s === currentStage;
                return (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setToStage(s)}
                    className={`text-left text-xs font-mono uppercase tracking-wider rounded border px-3 py-2 transition-colors ${
                      active
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border-soft hover:border-gold/40 text-text-mute"
                    }`}
                  >
                    {SALES_STAGE_LABEL[s]}
                    {isCurrent && (
                      <span className="ml-2 text-[9px] text-text-faint">current</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="t-rationale" className="text-xs uppercase tracking-widest font-mono text-text-faint">
              Rationale
            </Label>
            <Textarea
              id="t-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Why is this opportunity moving to this stage now?"
              className="bg-bg-deep border-border-soft text-text min-h-[88px]"
              required
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs uppercase tracking-widest font-mono text-text-faint">
                Win probability
              </Label>
              <span className="font-mono text-gold text-sm">{prob}%</span>
            </div>
            <Slider
              value={[prob]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => setProb(v[0])}
            />
            <p className="text-[11px] text-text-faint font-mono">
              Default for {SALES_STAGE_LABEL[toStage]}: {SALES_STAGE_DEFAULT_PROB[toStage]}%
            </p>
          </div>

          {!TERMINAL_STAGES.includes(toStage) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="t-milestone" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                  Next milestone
                </Label>
                <Input
                  id="t-milestone"
                  value={milestone}
                  onChange={(e) => setMilestone(e.target.value)}
                  placeholder="e.g. POV demo with COO"
                  className="bg-bg-deep border-border-soft"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="t-milestone-date" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                  Target date
                </Label>
                <Input
                  id="t-milestone-date"
                  type="date"
                  value={milestoneDate}
                  onChange={(e) => setMilestoneDate(e.target.value)}
                  className="bg-bg-deep border-border-soft"
                />
              </div>
            </div>
          )}

          {lateStage && (
            <label className="flex items-start gap-2 text-xs text-text-mute cursor-pointer">
              <Checkbox
                checked={override}
                onCheckedChange={(c) => setOverride(c === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-mono uppercase tracking-wider text-amber">Partner override</span>
                <span className="block">
                  Skip the 5C/Go gate. Use only when partner authority is direct and this will be reviewed at the next portfolio sync.
                </span>
              </span>
            </label>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <PillButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </PillButton>
            <PillButton type="submit" variant="primary" disabled={transition.isPending}>
              {transition.isPending ? "Moving…" : "Commit move"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
