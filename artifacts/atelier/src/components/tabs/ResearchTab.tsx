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
        <span className="text-xs font-mono text-text-faint">
          Promote evidence to make it citable in POVs and proposals.
        </span>
      </div>

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
