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
import {
  useAtelierUpdateAccount,
  getAtelierGetAccountWorkspaceQueryKey,
  type AtelierAccountWorkspaceAccount,
  type AtelierAccountObjective,
  type AtelierAccountCompetitor,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  account: AtelierAccountWorkspaceAccount;
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const labelCls = "text-xs uppercase tracking-widest font-mono text-text-faint";
const fieldCls = "bg-bg-deep border-border-soft";

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

type ObjectiveDraft = AtelierAccountObjective;
type CompetitorDraft = AtelierAccountCompetitor;

export function EditAccountStrategyDialog({ account, accountId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useAtelierUpdateAccount();

  const [guidance, setGuidance] = React.useState("");
  const [objectives, setObjectives] = React.useState<ObjectiveDraft[]>([]);
  const [serviceLines, setServiceLines] = React.useState("");
  const [winHypothesis, setWinHypothesis] = React.useState("");
  const [keyPlays, setKeyPlays] = React.useState("");
  const [competitors, setCompetitors] = React.useState<CompetitorDraft[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setGuidance(account.strategyGuidance ?? "");
    const s = account.accountStrategy;
    setObjectives(
      (s?.objectives ?? []).map((o) => ({
        id: o.id,
        text: o.text,
        targetValue: o.targetValue ?? "",
        targetDate: o.targetDate ?? "",
      })),
    );
    setServiceLines((s?.targetServiceLines ?? []).join("\n"));
    setWinHypothesis(s?.winHypothesis ?? "");
    setKeyPlays((s?.keyPlays ?? []).join("\n"));
    setCompetitors(
      (account.competitors ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        holds: c.holds ?? "",
        displacementAngle: c.displacementAngle ?? "",
      })),
    );
  }, [open, account]);

  function linesToArray(v: string): string[] {
    return v
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const cleanObjectives = objectives
      .map((o) => ({
        id: o.id || uid("obj"),
        text: o.text.trim(),
        targetValue: o.targetValue?.trim() || null,
        targetDate: o.targetDate?.trim() || null,
      }))
      .filter((o) => o.text.length > 0);
    const cleanCompetitors = competitors
      .map((c) => ({
        id: c.id || uid("cmp"),
        name: c.name.trim(),
        holds: c.holds?.trim() || null,
        displacementAngle: c.displacementAngle?.trim() || null,
      }))
      .filter((c) => c.name.length > 0);
    const serviceLineArr = linesToArray(serviceLines);
    const keyPlaysArr = linesToArray(keyPlays);

    const hasStrategy =
      cleanObjectives.length > 0 ||
      serviceLineArr.length > 0 ||
      winHypothesis.trim().length > 0 ||
      keyPlaysArr.length > 0;

    try {
      await update.mutateAsync({
        accountId,
        data: {
          accountStrategy: hasStrategy
            ? {
                objectives: cleanObjectives,
                targetServiceLines: serviceLineArr,
                winHypothesis: winHypothesis.trim(),
                keyPlays: keyPlaysArr,
              }
            : null,
          strategyGuidance: guidance.trim() || null,
          competitors: cleanCompetitors,
        },
      });
      qc.invalidateQueries({ queryKey: getAtelierGetAccountWorkspaceQueryKey(accountId) });
      toast({ title: "Strategy saved", description: "Changes recorded in the audit trail." });
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Could not save strategy",
        description: (err as Error)?.message ?? String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[720px] bg-bg-elevate border-gold/40 text-text max-h-[90vh] overflow-y-auto"
        data-testid="dialog-edit-strategy"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Edit account strategy</DialogTitle>
          <DialogDescription className="text-text-mute">
            Cognirise's plan of record for{" "}
            <span className="font-mono text-text">{account.brandName ?? account.name}</span>. Edits
            are audit-logged.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-6 py-3">
          {/* Partner guidance (Task #699) */}
          <div className="grid gap-2">
            <Label htmlFor="es-guidance" className={labelCls}>
              Partner guidance (steers the Strategy Developer agent)
            </Label>
            <Textarea
              id="es-guidance"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              className={`${fieldCls} min-h-[88px]`}
              maxLength={4000}
              placeholder="Your thoughts and direction on the strategy — e.g. lead with the CFO agenda, avoid competing on price, prioritise the supply-chain agentic build…"
              data-testid="input-strategy-guidance"
            />
          </div>

          {/* Objectives */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className={labelCls}>Objectives (measurable)</Label>
              <button
                type="button"
                onClick={() =>
                  setObjectives((prev) => [
                    ...prev,
                    { id: uid("obj"), text: "", targetValue: "", targetDate: "" },
                  ])
                }
                className="pill-btn pill-btn-ghost text-xs"
                data-testid="button-add-objective"
              >
                <Plus className="w-3 h-3" /> Add objective
              </button>
            </div>
            {objectives.length === 0 && (
              <p className="text-text-mute italic text-xs">No objectives yet.</p>
            )}
            <div className="space-y-2">
              {objectives.map((o, i) => (
                <div
                  key={o.id}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_140px_120px_auto] gap-2 items-start"
                >
                  <Input
                    value={o.text}
                    placeholder="Objective"
                    onChange={(e) =>
                      setObjectives((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                      )
                    }
                    className={fieldCls}
                    data-testid={`input-objective-text-${i}`}
                  />
                  <Input
                    value={o.targetValue ?? ""}
                    placeholder="Target (e.g. $4M)"
                    onChange={(e) =>
                      setObjectives((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, targetValue: e.target.value } : x)),
                      )
                    }
                    className={fieldCls}
                    data-testid={`input-objective-target-${i}`}
                  />
                  <Input
                    value={o.targetDate ?? ""}
                    placeholder="By (e.g. Q4 26)"
                    onChange={(e) =>
                      setObjectives((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, targetDate: e.target.value } : x)),
                      )
                    }
                    className={fieldCls}
                    data-testid={`input-objective-date-${i}`}
                  />
                  <button
                    type="button"
                    onClick={() => setObjectives((prev) => prev.filter((_, j) => j !== i))}
                    className="text-text-faint hover:text-danger p-2"
                    aria-label="Remove objective"
                    data-testid={`button-remove-objective-${i}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Target service lines */}
          <div className="grid gap-2">
            <Label htmlFor="es-servicelines" className={labelCls}>
              Target service lines (one per line)
            </Label>
            <Textarea
              id="es-servicelines"
              value={serviceLines}
              onChange={(e) => setServiceLines(e.target.value)}
              className={`${fieldCls} min-h-[72px]`}
              placeholder={"Agentic Build\nDiagnostic\nTransformation"}
              data-testid="input-service-lines"
            />
          </div>

          {/* Win hypothesis */}
          <div className="grid gap-2">
            <Label htmlFor="es-win" className={labelCls}>
              Win hypothesis
            </Label>
            <Textarea
              id="es-win"
              value={winHypothesis}
              onChange={(e) => setWinHypothesis(e.target.value)}
              className={`${fieldCls} min-h-[72px]`}
              placeholder="Why Cognirise wins here…"
              data-testid="input-win-hypothesis"
            />
          </div>

          {/* Key plays */}
          <div className="grid gap-2">
            <Label htmlFor="es-plays" className={labelCls}>
              Key plays (one per line)
            </Label>
            <Textarea
              id="es-plays"
              value={keyPlays}
              onChange={(e) => setKeyPlays(e.target.value)}
              className={`${fieldCls} min-h-[72px]`}
              placeholder={"Land a diagnostic with the COO\nExpand into supply-chain agentic build"}
              data-testid="input-key-plays"
            />
          </div>

          {/* Competitors */}
          <div className="grid gap-2 border-t border-border-soft pt-4">
            <div className="flex items-center justify-between">
              <Label className={labelCls}>Competitive landscape</Label>
              <button
                type="button"
                onClick={() =>
                  setCompetitors((prev) => [
                    ...prev,
                    { id: uid("cmp"), name: "", holds: "", displacementAngle: "" },
                  ])
                }
                className="pill-btn pill-btn-ghost text-xs"
                data-testid="button-add-competitor"
              >
                <Plus className="w-3 h-3" /> Add competitor
              </button>
            </div>
            {competitors.length === 0 && (
              <p className="text-text-mute italic text-xs">No competitors recorded.</p>
            )}
            <div className="space-y-3">
              {competitors.map((c, i) => (
                <div key={c.id} className="border border-border-soft rounded p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={c.name}
                      placeholder="Competitor / incumbent"
                      onChange={(e) =>
                        setCompetitors((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                        )
                      }
                      className={fieldCls}
                      data-testid={`input-competitor-name-${i}`}
                    />
                    <button
                      type="button"
                      onClick={() => setCompetitors((prev) => prev.filter((_, j) => j !== i))}
                      className="text-text-faint hover:text-danger p-2"
                      aria-label="Remove competitor"
                      data-testid={`button-remove-competitor-${i}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <Input
                    value={c.holds ?? ""}
                    placeholder="What they currently hold"
                    onChange={(e) =>
                      setCompetitors((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, holds: e.target.value } : x)),
                      )
                    }
                    className={fieldCls}
                    data-testid={`input-competitor-holds-${i}`}
                  />
                  <Input
                    value={c.displacementAngle ?? ""}
                    placeholder="Cognirise's displacement angle"
                    onChange={(e) =>
                      setCompetitors((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, displacementAngle: e.target.value } : x,
                        ),
                      )
                    }
                    className={fieldCls}
                    data-testid={`input-competitor-angle-${i}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1 border-t border-border-soft">
            <PillButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </PillButton>
            <PillButton
              type="submit"
              variant="primary"
              disabled={update.isPending}
              data-testid="button-submit-edit-strategy"
            >
              {update.isPending ? "Saving…" : "Save strategy"}
            </PillButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
