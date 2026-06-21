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
import { fieldControlCls } from "./ui/fieldControls";
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
  SUB_STATUS_BY_STAGE,
  SUB_STATUS_LABEL,
  TERMINAL_REASON_CODES,
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
  const [evidence, setEvidence] = React.useState("");
  const [override, setOverride] = React.useState(false);
  const [subStatus, setSubStatus] = React.useState<string>("");
  // Convert→Runner gate fields.
  const [decider, setDecider] = React.useState("");
  const [verbalCommitDate, setVerbalCommitDate] = React.useState("");
  const [signaturePath, setSignaturePath] = React.useState("");
  // Runner→Contract gate field. (Uploads are surfaced via the artifacts
  // tab elsewhere; this dialog accepts the artifact id directly.)
  const [signedInstrumentFileId, setSignedInstrumentFileId] = React.useState("");
  // Terminal-entry gate field.
  const [reasonCode, setReasonCode] = React.useState("");

  React.useEffect(() => {
    if (open) {
      const initial = initialToStage ?? currentStage;
      setToStage(initial);
      setRationale("");
      setProb(SALES_STAGE_DEFAULT_PROB[initial]);
      setMilestone("");
      setMilestoneDate("");
      setEvidence("");
      setOverride(false);
      setSubStatus("");
      setDecider("");
      setVerbalCommitDate("");
      setSignaturePath("");
      setSignedInstrumentFileId("");
      setReasonCode("");
    }
  }, [open, initialToStage, currentStage]);

  React.useEffect(() => {
    setProb(SALES_STAGE_DEFAULT_PROB[toStage]);
    setSubStatus("");
    setReasonCode("");
  }, [toStage]);

  // Per-transition gate flags. These mirror the server-side gates in
  // agentRoutes.ts (POST /opportunities/:oppId/stage-transition); the
  // dialog blocks submit early so the user gets a clean form error
  // instead of a 412 round-trip.
  const isSuspectToProspect = currentStage === "suspect" && toStage === "prospect";
  const isConvertToRunner = currentStage === "convert" && toStage === "runner";
  const isRunnerToContract = currentStage === "runner" && toStage === "contract";
  const isTerminalEntry = (TERMINAL_STAGES as readonly SalesStage[]).includes(toStage);

  const subStatusOptions = SUB_STATUS_BY_STAGE[toStage] ?? [];
  const reasonOptions = isTerminalEntry
    ? TERMINAL_REASON_CODES[toStage as "lost" | "no_decision" | "withdrawn"]
    : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rationale.trim()) {
      toast({ title: "Rationale required", variant: "destructive" });
      return;
    }
    // Client-side gate previews — partner-override skips them all.
    if (!override) {
      if (isConvertToRunner) {
        const missing: string[] = [];
        if (!decider.trim()) missing.push("decider");
        if (!verbalCommitDate.trim()) missing.push("verbal-commit date");
        if (!signaturePath.trim()) missing.push("signature path");
        if (missing.length) {
          toast({
            title: "Convert → Runner gate",
            description: `Provide ${missing.join(", ")} or use partner override.`,
            variant: "destructive",
          });
          return;
        }
      }
      if (isRunnerToContract && !signedInstrumentFileId.trim()) {
        toast({
          title: "Runner → Contract gate",
          description: "Attach the signed instrument (artifact id) or use partner override.",
          variant: "destructive",
        });
        return;
      }
      if (isTerminalEntry && !reasonCode.trim()) {
        toast({
          title: `Reason required to enter ${SALES_STAGE_LABEL[toStage]}`,
          description: "Pick a reason code so the debrief and analytics line up.",
          variant: "destructive",
        });
        return;
      }
    }

    const evidenceArtifactIds = Array.from(
      new Set([
        ...evidence.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        ...(isRunnerToContract && signedInstrumentFileId.trim()
          ? [signedInstrumentFileId.trim()]
          : []),
      ]),
    );

    try {
      await transition.mutateAsync({
        oppId,
        data: {
          toStage,
          rationaleText: rationale.trim(),
          evidenceArtifactIds,
          newProbabilityPct: prob,
          nextMilestone: milestone.trim() || null,
          nextMilestoneDate: milestoneDate.trim() || null,
          partnerOverride: override,
          subStatus: subStatus || null,
          decider: isConvertToRunner ? decider.trim() || null : null,
          verbalCommitDate: isConvertToRunner ? verbalCommitDate || null : null,
          signaturePath: isConvertToRunner ? signaturePath.trim() || null : null,
          signedInstrumentFileId: isRunnerToContract
            ? signedInstrumentFileId.trim() || null
            : null,
          reasonCode: isTerminalEntry ? reasonCode || null : null,
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
      const data = (err as { response?: { data?: { gate?: string; reason?: string } } })
        ?.response?.data;
      if (status === 412) {
        toast({
          title: data?.gate ? `Gate: ${data.gate}` : "Stage gate failed",
          description:
            data?.reason ??
            "This transition has unmet requirements. Use partner override only if you have direct authority.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Could not move stage", description: String(err), variant: "destructive" });
      }
    }
  }

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

          {subStatusOptions.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="t-substatus" className="text-xs uppercase tracking-widest font-mono text-text-faint">
                Sub-status (optional)
              </Label>
              <select
                id="t-substatus"
                value={subStatus}
                onChange={(e) => setSubStatus(e.target.value)}
                className={`${fieldControlCls} bg-bg-deep border border-border-soft rounded text-sm text-text`}
              >
                <option value="">— none —</option>
                {subStatusOptions.map((s) => (
                  <option key={s} value={s}>
                    {SUB_STATUS_LABEL[s] ?? s}
                  </option>
                ))}
              </select>
            </div>
          )}

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

          {!isTerminalEntry && (
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

          <div className="grid gap-2">
            <Label htmlFor="t-evidence" className="text-xs uppercase tracking-widest font-mono text-text-faint">
              Evidence artifact IDs (optional)
            </Label>
            <Textarea
              id="t-evidence"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="art_… one per line, or comma-separated"
              className="bg-bg-deep border-border-soft text-text font-mono text-xs min-h-[56px]"
            />
            <p className="text-[10px] text-text-faint">
              References attached here are recorded on the transition and surface in the opportunity's Artifacts tab.
            </p>
          </div>

          {isSuspectToProspect && (
            <div className="rounded border border-gold/40 bg-gold/5 p-3 text-xs text-text-mute">
              <span className="block font-mono uppercase tracking-wider text-gold mb-1">
                Suspect → Prospect gate
              </span>
              Requires a completed 5C qualifier with a Go decision. Fill the
              5C tab on this opportunity, or tick partner override below.
            </div>
          )}

          {isConvertToRunner && (
            <div className="grid gap-3 rounded border border-gold/40 bg-gold/5 p-3">
              <span className="font-mono uppercase tracking-wider text-gold text-xs">
                Convert → Runner gate
              </span>
              <div className="grid gap-2">
                <Label htmlFor="t-decider" className="text-[10px] uppercase tracking-widest font-mono text-text-faint">
                  Named decider
                </Label>
                <Input
                  id="t-decider"
                  value={decider}
                  onChange={(e) => setDecider(e.target.value)}
                  placeholder="e.g. CFO Sarah Patel"
                  className="bg-bg-deep border-border-soft"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="t-vcd" className="text-[10px] uppercase tracking-widest font-mono text-text-faint">
                    Verbal-commit date
                  </Label>
                  <Input
                    id="t-vcd"
                    type="date"
                    value={verbalCommitDate}
                    onChange={(e) => setVerbalCommitDate(e.target.value)}
                    className="bg-bg-deep border-border-soft"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="t-sigpath" className="text-[10px] uppercase tracking-widest font-mono text-text-faint">
                    Signature path
                  </Label>
                  <Input
                    id="t-sigpath"
                    value={signaturePath}
                    onChange={(e) => setSignaturePath(e.target.value)}
                    placeholder="e.g. Procurement → CFO → DocuSign"
                    className="bg-bg-deep border-border-soft"
                  />
                </div>
              </div>
            </div>
          )}

          {isRunnerToContract && (
            <div className="grid gap-2 rounded border border-gold/40 bg-gold/5 p-3">
              <span className="font-mono uppercase tracking-wider text-gold text-xs">
                Runner → Contract gate
              </span>
              <Label htmlFor="t-sif" className="text-[10px] uppercase tracking-widest font-mono text-text-faint">
                Signed instrument · artifact id
              </Label>
              <Input
                id="t-sif"
                value={signedInstrumentFileId}
                onChange={(e) => setSignedInstrumentFileId(e.target.value)}
                placeholder="art_…"
                className="bg-bg-deep border-border-soft font-mono text-xs"
              />
              <p className="text-[10px] text-text-faint">
                Charter Architect auto-fires on Contract entry for the linked engagement.
              </p>
            </div>
          )}

          {isTerminalEntry && (
            <div className="grid gap-2 rounded border border-amber/40 bg-amber/5 p-3">
              <span className="font-mono uppercase tracking-wider text-amber text-xs">
                Closing as {SALES_STAGE_LABEL[toStage]}
              </span>
              <Label htmlFor="t-reason" className="text-[10px] uppercase tracking-widest font-mono text-text-faint">
                Reason code
              </Label>
              <select
                id="t-reason"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                className={`${fieldControlCls} bg-bg-deep border border-border-soft rounded text-sm text-text`}
              >
                <option value="">— pick reason —</option>
                {reasonOptions.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(isSuspectToProspect || isConvertToRunner || isRunnerToContract || isTerminalEntry) && (
            <label className="flex items-start gap-2 text-xs text-text-mute cursor-pointer">
              <Checkbox
                checked={override}
                onCheckedChange={(c) => setOverride(c === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-mono uppercase tracking-wider text-amber">Partner override</span>
                <span className="block">
                  Skip the gate above. Use only when partner authority is direct and this will be reviewed at the next portfolio sync.
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
