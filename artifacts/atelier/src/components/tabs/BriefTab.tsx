import * as React from "react";
import {
  useAtelierGetBrief,
  useAtelierRunPursuitScout,
  getAtelierGetBriefQueryKey,
  getAtelierListResearchFactsQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ConfidenceDot } from "./ConfidenceDot";

export function BriefTab({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useAtelierGetBrief(oppId);
  const run = useAtelierRunPursuitScout();

  async function rerun() {
    await run.mutateAsync({ oppId, data: {} });
    qc.invalidateQueries({ queryKey: getAtelierGetBriefQueryKey(oppId) });
    qc.invalidateQueries({ queryKey: getAtelierListResearchFactsQueryKey(oppId) });
    qc.invalidateQueries({ queryKey: getAtelierListAuditQueryKey() });
    toast({ title: "Pursuit Scout re-run", description: "New brief synthesised." });
  }

  if (isLoading) return <Skeleton className="h-64 bg-bg-elevate" />;

  if (!data?.brief) {
    return (
      <Card className="p-12 text-center border-dashed bg-bg-deep">
        <h3 className="text-lg font-semibold text-text mb-2">No brief yet</h3>
        <p className="text-text-mute mb-6 max-w-md mx-auto">
          Run Pursuit Scout to draft an evidence-cited account snapshot, buyer landscape, and 5C draft.
        </p>
        <PillButton variant="primary" onClick={rerun} disabled={run.isPending}>
          {run.isPending ? "Researching…" : "Run Pursuit Scout"}
        </PillButton>
      </Card>
    );
  }

  const b = data.brief;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ConfidenceDot confidence={data.confidence ?? "amber"} />
          <span className="text-sm text-text-mute font-mono">
            {data.createdAt ? new Date(data.createdAt).toLocaleString() : ""}
          </span>
        </div>
        <PillButton variant="ghost" onClick={rerun} disabled={run.isPending}>
          {run.isPending ? "Re-running…" : "Re-run Scout"}
        </PillButton>
      </div>

      <Card className="p-6 space-y-3">
        <h3 className="text-xs uppercase tracking-widest font-mono text-text-faint">Account snapshot</h3>
        <p className="text-text font-medium">{b.accountSnapshot.oneLiner}</p>
        <p className="text-text-mute text-sm">{b.accountSnapshot.scaleHint}</p>
        <ul className="text-sm text-text-mute list-disc list-inside space-y-1 pt-2">
          {b.accountSnapshot.recentMoves.map((m: string, i: number) => <li key={i}>{m}</li>)}
        </ul>
      </Card>

      <Card className="p-6 space-y-3">
        <h3 className="text-xs uppercase tracking-widest font-mono text-text-faint">Buyer landscape</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {b.buyerLandscape.likelyBuyers.map((bu: { title: string; rationale: string }, i: number) => (
            <div key={i} className="border border-border-soft rounded p-3 bg-bg-deep">
              <div className="text-text font-medium text-sm">{bu.title}</div>
              <div className="text-text-mute text-xs mt-1">{bu.rationale}</div>
            </div>
          ))}
        </div>
        <p className="text-text-mute text-sm pt-2">{b.buyerLandscape.powerMap}</p>
      </Card>

      <Card className="p-6 space-y-3">
        <h3 className="text-xs uppercase tracking-widest font-mono text-text-faint">5C draft (review in Qualifier)</h3>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {(["client", "competition", "capability", "capacity", "contract"] as const).map((k) => (
            <div key={k}>
              <dt className="text-text font-medium capitalize">{k}</dt>
              <dd className="text-text-mute mt-1">{b.fiveCDraft[k]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-6 space-y-3">
        <h3 className="text-xs uppercase tracking-widest font-mono text-text-faint">Open questions</h3>
        <ul className="text-sm text-text list-decimal list-inside space-y-1">
          {b.openQuestions.map((q: string, i: number) => <li key={i}>{q}</li>)}
        </ul>
      </Card>
    </div>
  );
}
