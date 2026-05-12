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
  getAtelierGetQualifierQueryKey,
  getAtelierGetBriefQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

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

  const [vals, setVals] = React.useState<Record<string, string>>({});
  const [rationale, setRationale] = React.useState("");

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

  const allFilled = FIELDS.every((f) => (vals[f.key] ?? "").trim().length >= 10);

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
