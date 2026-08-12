import * as React from "react";
import type { AtelierResearchFact } from "@workspace/api-client-react";
import {
  useAtelierListResearchFacts,
  useAtelierPromoteResearchFact,
  getAtelierListResearchFactsQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfidenceDot } from "./ConfidenceDot";
import { ExternalLink, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function ResearchTab({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useAtelierListResearchFacts(oppId);
  const promote = useAtelierPromoteResearchFact();
  const [filter, setFilter] = React.useState<"all" | "promoted" | "candidates">("all");
  // Task #1022 — POV deep-research pass: targeted queries per thesis angle,
  // landing as unpromoted candidate facts for review. Async 202 + poll.
  const [showResearch, setShowResearch] = React.useState(false);
  const [researchForm, setResearchForm] = React.useState({ objective: "", angles: "" });
  const [researching, setResearching] = React.useState(false);
  const unmountedRef = React.useRef(false);
  React.useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  async function runDeepResearch() {
    if (!researchForm.objective.trim()) {
      toast({ title: "Objective required", description: "What should the POV argue?", variant: "destructive" });
      return;
    }
    setResearching(true);
    try {
      const start = await fetch(`/api/atelier/opportunities/${encodeURIComponent(oppId)}/pov-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          objective: researchForm.objective,
          angles: researchForm.angles.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      if (!start.ok) {
        const b = (await start.json().catch(() => ({}))) as { reason?: string; error?: string };
        throw new Error(b.reason ?? b.error ?? "Could not start research");
      }
      toast({ title: "Deep research started", description: "Targeted queries are running — this can take a few minutes." });
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (unmountedRef.current) return;
        const r = await fetch(`/api/atelier/opportunities/${encodeURIComponent(oppId)}/pov-research-status`, { credentials: "include" });
        if (!r.ok) continue;
        const body = (await r.json()) as { status: string; error?: string; factCount?: number };
        if (body.status === "running") continue;
        if (body.status === "done") {
          qc.invalidateQueries({ queryKey: getAtelierListResearchFactsQueryKey(oppId) });
          setShowResearch(false);
          toast({ title: "Research complete", description: `${body.factCount ?? 0} new candidate facts to review.` });
        } else {
          toast({ title: "Research failed", description: body.error ?? "Try again.", variant: "destructive" });
        }
        return;
      }
      toast({ title: "Research timed out", description: "Check back shortly.", variant: "destructive" });
    } catch (e) {
      toast({ title: "Could not run research", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      if (!unmountedRef.current) setResearching(false);
    }
  }

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;
  const facts = data ?? [];
  const filtered = facts.filter((f: AtelierResearchFact) =>
    filter === "all" ? true : filter === "promoted" ? f.promoted : !f.promoted,
  );

  async function toggle(id: string, current: boolean) {
    await promote.mutateAsync({ oppId, factId: id, data: { promote: !current } });
    qc.invalidateQueries({ queryKey: getAtelierListResearchFactsQueryKey(oppId) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    toast({ title: !current ? "Promoted to evidence" : "Demoted to candidate" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 glass-surface p-1 rounded-full border border-border">
          {(["all", "promoted", "candidates"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1 text-xs font-mono uppercase rounded-full transition-colors ${
                filter === k ? "bg-bg-deep text-gold" : "text-text-mute hover:text-text"
              }`}
            >
              {k} ({k === "all" ? facts.length : k === "promoted" ? facts.filter((f: AtelierResearchFact) => f.promoted).length : facts.filter((f: AtelierResearchFact) => !f.promoted).length})
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-text-faint">
            Promote evidence to make it citable in POVs and proposals.
          </span>
          <PillButton variant="ghost" onClick={() => setShowResearch((s) => !s)} data-testid="button-toggle-deep-research">
            Deep research
          </PillButton>
        </div>
      </div>

      {showResearch && (
        <Card className="p-5 space-y-3 border-gold/40">
          <h4 className="text-sm font-semibold text-text">POV deep research</h4>
          <p className="text-xs text-text-mute">
            Runs targeted, recent-source web queries per angle and lands the results here as candidate facts for review.
          </p>
          <div>
            <label className="text-xs text-text-mute" htmlFor="research-objective">Objective</label>
            <input
              id="research-objective"
              value={researchForm.objective}
              onChange={(e) => setResearchForm({ ...researchForm, objective: e.target.value })}
              placeholder="What should the POV argue?"
              className="w-full bg-bg-deep border border-border rounded px-3 py-2 text-sm text-text"
              data-testid="input-research-objective"
            />
          </div>
          <div>
            <label className="text-xs text-text-mute" htmlFor="research-angles">Thesis angles (one per line, optional)</label>
            <textarea
              id="research-angles"
              value={researchForm.angles}
              onChange={(e) => setResearchForm({ ...researchForm, angles: e.target.value })}
              placeholder={"cost pressure in core operations\nregulatory timeline\ncompetitor moves"}
              className="w-full bg-bg-deep border border-border rounded px-3 py-2 text-sm text-text min-h-[70px]"
              data-testid="input-research-angles"
            />
          </div>
          <div className="flex justify-end gap-2">
            <PillButton variant="ghost" onClick={() => setShowResearch(false)}>Cancel</PillButton>
            <PillButton variant="primary" onClick={runDeepResearch} disabled={researching} data-testid="button-run-deep-research">
              {researching ? "Researching… (a few minutes)" : "Run deep research"}
            </PillButton>
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card className="p-10 text-center border-dashed bg-bg-deep">
          <p className="text-text-mute">No facts in this filter. Run Pursuit Scout from the Brief tab to gather evidence.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((f: AtelierResearchFact) => (
            <Card key={f.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] uppercase font-mono text-gold tracking-widest">{f.topic}</span>
                    <ConfidenceDot confidence={f.confidence} />
                    {f.promoted && (
                      <span className="text-[10px] uppercase font-mono text-success tracking-widest border border-success/40 rounded px-1.5">
                        ✓ promoted
                      </span>
                    )}
                    {f.flags?.stale && (
                      <span className="text-[10px] uppercase font-mono text-warning tracking-widest border border-warning/40 rounded px-1.5" title="Evidence retrieved more than 6 months ago">
                        stale
                      </span>
                    )}
                    {f.flags?.lowConfidence && (
                      <span className="text-[10px] uppercase font-mono text-warning tracking-widest border border-warning/40 rounded px-1.5">
                        low confidence
                      </span>
                    )}
                    {f.flags?.unsourced && (
                      <span className="text-[10px] uppercase font-mono text-danger tracking-widest border border-danger/40 rounded px-1.5">
                        unsourced
                      </span>
                    )}
                    {f.duplicateOfId && (
                      <span className="text-[10px] uppercase font-mono text-text-mute tracking-widest border border-border rounded px-1.5" title={`Near-duplicate of fact ${f.duplicateOfId}`}>
                        duplicate
                      </span>
                    )}
                    {f.retrievedAt && (
                      <span className="text-[10px] font-mono text-text-faint">
                        {new Date(f.retrievedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p className="text-text text-sm">{f.statement}</p>
                  {f.snippet && (
                    <blockquote className="mt-2 border-l-2 border-border-soft pl-3 text-xs text-text-mute italic">
                      "{f.snippet}"
                    </blockquote>
                  )}
                  {f.sourceUrl && (
                    <a
                      href={f.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-gold hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" /> {f.sourceTitle ?? f.sourceUrl}
                    </a>
                  )}
                </div>
                <PillButton
                  variant={f.promoted ? "ghost" : "primary"}
                  onClick={() => toggle(f.id, f.promoted)}
                  disabled={promote.isPending}
                  className="shrink-0"
                >
                  {f.promoted ? (
                    <span className="inline-flex items-center gap-1"><X className="w-3 h-3" /> Demote</span>
                  ) : (
                    <span className="inline-flex items-center gap-1"><Check className="w-3 h-3" /> Promote</span>
                  )}
                </PillButton>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
