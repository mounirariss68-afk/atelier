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
import { PillButton } from "./ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  useAtelierGetQualifier,
  useAtelierSubmitQualifier,
  useAtelierGetBrief,
  useAtelierScoreQualificationRubric,
  getAtelierGetQualifierQueryKey,
  getAtelierGetBriefQueryKey,
  getAtelierGetOpportunityQueryKey,
  type QualificationRubric,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const RUBRIC_DIMENSION_LABEL: Record<string, string> = {
  strategicFit: "Strategic fit",
  clientQuality: "Client quality",
  dealEconomics: "Deal economics",
  winProbability: "Win probability",
  deliverability: "Deliverability",
  riskInverted: "Risk (inverted)",
};

const BAND_TONE: Record<string, string> = {
  pursue: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
  watch: "text-amber border-amber/40 bg-amber/10",
  decline: "text-danger border-danger/40 bg-danger/10",
};

const FIELDS: { key: "client" | "competition" | "capability" | "capacity" | "contract"; label: string; hint: string }[] = [
  { key: "client", label: "Client", hint: "Who is the buyer? What outcome do they need?" },
  { key: "competition", label: "Competition", hint: "Who else is in the room? Why us over them?" },
  { key: "capability", label: "Capability", hint: "Where do we have a defensible right to win?" },
  { key: "capacity", label: "Capacity", hint: "Can we staff and ship within the window?" },
  { key: "contract", label: "Contract", hint: "Commercial shape, procurement path, decision rights." },
];

interface Props {
  oppId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitted?: (decision: "go" | "no_go") => void;
  prefillFromBrief?: boolean;
}

export function QualifierSheet({ oppId, open, onOpenChange, onCommitted, prefillFromBrief = true }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: qualifier } = useAtelierGetQualifier(oppId, {
    query: { enabled: open && !!oppId, queryKey: getAtelierGetQualifierQueryKey(oppId) },
  });
  const { data: briefEnv } = useAtelierGetBrief(oppId, {
    query: { enabled: open && !!oppId && prefillFromBrief, queryKey: getAtelierGetBriefQueryKey(oppId) },
  });
  const submit = useAtelierSubmitQualifier();
  const scoreRubric = useAtelierScoreQualificationRubric();

  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [rationale, setRationale] = React.useState("");
  const [attachmentIds, setAttachmentIds] = React.useState("");
  const [localRubric, setLocalRubric] = React.useState<QualificationRubric | null>(null);
  const rubric = localRubric ?? qualifier?.rubric ?? null;

  React.useEffect(() => {
    if (!open) return;
    const seed = qualifier?.fiveC ?? briefEnv?.brief?.fiveCDraft ?? null;
    if (seed) {
      setVals({
        client: seed.client ?? "",
        competition: seed.competition ?? "",
        capability: seed.capability ?? "",
        capacity: seed.capacity ?? "",
        contract: seed.contract ?? "",
      });
    }
  }, [open, qualifier, briefEnv]);

  React.useEffect(() => {
    if (!open) {
      setLocalRubric(null);
      setAttachmentIds("");
    }
  }, [open]);

  const allFilled = FIELDS.every((f) => (vals[f.key] ?? "").trim().length >= 10);

  async function runRubric() {
    const ids = attachmentIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      toast({ title: "Add at least one RFP attachment id", description: "Paste the ingested attachment id(s) to score.", variant: "destructive" });
      return;
    }
    try {
      const result = await scoreRubric.mutateAsync({ oppId, data: { attachmentIds: ids } });
      setLocalRubric(result);
      qc.invalidateQueries({ queryKey: getAtelierGetQualifierQueryKey(oppId) });
      qc.invalidateQueries({ queryKey: getAtelierGetOpportunityQueryKey(oppId) });
      toast({ title: `Rubric scored · ${result.band}`, description: `Composite ${result.composite}/100.` });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast({
        title: "Could not score rubric",
        description: status === 422 ? "No extractable text found in those attachments." : String(err),
        variant: "destructive",
      });
    }
  }

  async function commit(decision: "go" | "no_go") {
    if (!allFilled) {
      toast({ title: "Fill all 5C fields", description: "Each field needs at least a sentence.", variant: "destructive" });
      return;
    }
    if (decision === "no_go" && !rationale.trim()) {
      toast({ title: "Rationale required", description: "Please explain the no-go.", variant: "destructive" });
      return;
    }
    await submit.mutateAsync({
      oppId,
      data: {
        fiveC: {
          client: vals.client,
          competition: vals.competition,
          capability: vals.capability,
          capacity: vals.capacity,
          contract: vals.contract,
        },
        decision,
        rationale,
      },
    });
    qc.invalidateQueries({ queryKey: getAtelierGetQualifierQueryKey(oppId) });
    toast({
      title: decision === "go" ? "5C approved · GO" : "5C marked NO-GO",
      description: "Decision recorded in the audit trail.",
    });
    onOpenChange(false);
    onCommitted?.(decision);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-text">5C Qualifier — gate to Pursue</DialogTitle>
          <DialogDescription className="text-text-mute">
            Every Pursue commitment must be backed by an explicit 5C take. Drafts from Pursuit Scout pre-fill where available; partner edits and decision are persisted.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid gap-2">
              <Label htmlFor={`q-${f.key}`} className="text-text font-medium">
                {f.label}
                <span className="ml-2 text-xs text-text-faint font-mono">{f.hint}</span>
              </Label>
              <Textarea
                id={`q-${f.key}`}
                value={vals[f.key] ?? ""}
                onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                className="bg-bg-deep border-border text-text min-h-[72px]"
              />
            </div>
          ))}

          {/* Structured, weighted rubric — Task #540. Scores ingested RFP
              attachments across six weighted dimensions into a composite + band. */}
          <div className="grid gap-3 pt-3 border-t border-border-soft">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-text font-medium">
                Structured rubric
                <span className="ml-2 text-xs text-text-faint font-mono">
                  Weighted 6-dimension score from the RFP
                </span>
              </Label>
              {rubric && (
                <span className={`text-xs font-mono uppercase tracking-wider rounded border px-2 py-0.5 ${BAND_TONE[rubric.band] ?? "text-text-mute border-border"}`}>
                  {rubric.band} · {rubric.composite}/100
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={attachmentIds}
                onChange={(e) => setAttachmentIds(e.target.value)}
                placeholder="RFP attachment id(s) — comma or space separated"
                className="flex-1 bg-bg-deep border border-border rounded px-3 py-2 text-sm text-text font-mono"
              />
              <PillButton variant="ghost" onClick={runRubric} disabled={scoreRubric.isPending}>
                {scoreRubric.isPending ? "Scoring…" : "Score rubric"}
              </PillButton>
            </div>
            {rubric ? (
              <div className="rounded-md border border-border-soft bg-bg-deep/60 divide-y divide-border-soft">
                {rubric.dimensions.map((d) => (
                  <div key={d.key} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-text">
                        {RUBRIC_DIMENSION_LABEL[d.key] ?? d.key}
                        <span className="ml-2 text-[10px] font-mono text-text-faint">w{d.weight}</span>
                      </div>
                      {d.rationale && (
                        <div className="text-[11px] text-text-mute truncate">{d.rationale}</div>
                      )}
                    </div>
                    <span className="font-mono text-sm text-gold shrink-0">{d.score}/5</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-faint font-mono">
                Not scored yet. Paste the ingested RFP attachment id(s) and score to compute the weighted band.
              </p>
            )}
          </div>

          <div className="grid gap-2 pt-2 border-t border-border-soft">
            <Label htmlFor="q-rationale" className="text-text-mute">Decision rationale (required for no-go)</Label>
            <Textarea
              id="q-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Why go or no-go?"
              className="bg-bg-deep border-border text-text min-h-[64px]"
            />
          </div>
        </div>
        <div className="flex justify-between items-center gap-3 pt-3 border-t border-border-soft">
          <div className="text-xs font-mono text-text-faint">
            {allFilled ? "All fields filled" : "Fill every 5C field to enable decision."}
          </div>
          <div className="flex gap-3">
            <PillButton variant="ghost" onClick={() => onOpenChange(false)}>Cancel</PillButton>
            <PillButton
              variant="ghost"
              className="text-danger hover:text-danger hover:border-danger"
              onClick={() => commit("no_go")}
              disabled={submit.isPending}
            >
              No-go
            </PillButton>
            <PillButton
              variant="primary"
              onClick={() => commit("go")}
              disabled={submit.isPending || !allFilled}
            >
              Approve · GO
            </PillButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
