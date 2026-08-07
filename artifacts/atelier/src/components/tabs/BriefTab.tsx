import * as React from "react";
import {
  useAtelierGetBrief,
  useAtelierRunPursuitScout,
  getAtelierGetBriefQueryKey,
  getAtelierListResearchFactsQueryKey,
  getAtelierListAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, PillButton, StatusCard, MonoChip } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ConfidenceDot } from "./ConfidenceDot";
import { Shield, ExternalLink, CheckCircle2, Circle, Clock, Download } from "lucide-react";

// Human labels for completeness section keys (Task #9).
const SECTION_LABELS: Record<string, string> = {
  accountSnapshot: "Account snapshot",
  recentMoves: "Recent moves",
  buyerLandscape: "Buyer landscape",
  openQuestions: "Open questions",
  "fiveC.client": "5C · Client",
  "fiveC.competition": "5C · Competition",
  "fiveC.capability": "5C · Capability",
  "fiveC.capacity": "5C · Capacity",
  "fiveC.contract": "5C · Contract",
};

export function BriefTab({ oppId, onOpenQualifier }: { oppId: string; onOpenQualifier?: () => void }) {
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
      <Card className="p-12 text-center border-dashed">
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
  const confidence = data.confidence ?? "amber";
  const ranAt = data.createdAt ? new Date(data.createdAt).toLocaleString() : "";
  const tone: "amber" | "green" = confidence === "green" ? "green" : "amber";

  // Task #9 — research quality signals from the envelope.
  const factsById = new Map((b.facts ?? []).filter((f) => f.id).map((f) => [f.id as string, f]));
  const fiveCFactIds = data.fiveCFactIds;
  const completeness = data.completeness;
  const ageDays = data.ageDays ?? null;
  const refreshRecommended = data.refreshRecommended ?? false;

  return (
    <div className="space-y-6">
      <StatusCard
        tone={tone}
        status={
          <div className="flex items-center gap-2">
            <ConfidenceDot confidence={confidence} />
            <MonoChip tone={tone}>Pursuit Scout</MonoChip>
          </div>
        }
        title="Pursuit Scout · awaiting verification"
        detail={
          ranAt ? (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span>Last run {ranAt}</span>
              {ageDays !== null && (
                <MonoChip tone={refreshRecommended ? "amber" : "default"} data-testid="chip-brief-age">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {ageDays === 0 ? "today" : `${ageDays}d old`}
                  </span>
                </MonoChip>
              )}
              {refreshRecommended && (
                <MonoChip tone="amber" data-testid="chip-refresh-recommended">refresh recommended</MonoChip>
              )}
              {completeness && (
                <MonoChip
                  tone={completeness.score >= 70 ? "green" : "amber"}
                  data-testid="chip-brief-completeness"
                >
                  {completeness.score}% complete
                </MonoChip>
              )}
            </span>
          ) : undefined
        }
        actions={
          <>
            <PillButton variant="ghost" onClick={rerun} disabled={run.isPending}>
              {run.isPending ? "Re-running…" : "Re-run Scout"}
            </PillButton>
            <a
              href={`/api/atelier/opportunities/${oppId}/brief.pdf`}
              download
              className="pill-btn pill-btn-ghost text-xs inline-flex items-center gap-1"
              data-testid="button-download-brief-pdf"
            >
              <Download className="w-3.5 h-3.5" /> Download PDF
            </a>
            {onOpenQualifier && (
              <PillButton variant="primary" onClick={onOpenQualifier}>
                <span className="inline-flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Verify · 5C Qualifier</span>
              </PillButton>
            )}
          </>
        }
      />

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
          {(["client", "competition", "capability", "capacity", "contract"] as const).map((k) => {
            const supporting = (fiveCFactIds?.[k] ?? [])
              .map((id) => factsById.get(id))
              .filter((f): f is NonNullable<typeof f> => !!f);
            const sectionText = b.fiveCDraft[k];
            const empty = !sectionText || !sectionText.trim();
            return (
              <div key={k}>
                <dt className="text-text font-medium capitalize">{k}</dt>
                <dd className="text-text-mute mt-1">
                  {empty ? (
                    <span className="italic text-text-faint" data-testid={`text-5c-missing-${k}`}>
                      Not researched — re-run Scout to fill this in.
                    </span>
                  ) : (
                    sectionText
                  )}
                </dd>
                {supporting.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid={`citations-5c-${k}`}>
                    {supporting.map((f, i) =>
                      f.sourceUrl ? (
                        <a
                          key={i}
                          href={f.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={f.statement}
                          className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-border-soft text-text-faint hover:text-gold hover:border-gold/50 transition-colors"
                        >
                          {f.topic || f.sourceTitle || "source"}
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      ) : (
                        <span
                          key={i}
                          title={f.statement}
                          className="inline-flex items-center text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-border-soft text-text-faint"
                        >
                          {f.topic || "fact"}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </dl>
      </Card>

      {completeness && (
        <Card className="p-6 space-y-3" data-testid="card-brief-completeness">
          <h3 className="text-xs uppercase tracking-widest font-mono text-text-faint">Research completeness</h3>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {Object.entries(completeness.sections).map(([key, ok]) => (
              <div key={key} className="flex items-center gap-2">
                {ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-text-faint shrink-0" />
                )}
                <span className={ok ? "text-text" : "text-text-faint italic"}>
                  {SECTION_LABELS[key] ?? key}
                  {!ok && " — not researched"}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-mute pt-1">
            {completeness.factCount} fact{completeness.factCount === 1 ? "" : "s"} ·{" "}
            {completeness.sourcedFactCount} with sources · confidence{" "}
            {completeness.confidenceMix.green} green / {completeness.confidenceMix.amber} amber /{" "}
            {completeness.confidenceMix.red} red
          </p>
          {completeness.missingSections.length > 0 && (
            <PillButton variant="ghost" onClick={rerun} disabled={run.isPending} data-testid="button-fill-gaps">
              {run.isPending ? "Researching…" : "Re-run Scout to fill gaps"}
            </PillButton>
          )}
        </Card>
      )}

      <Card className="p-6 space-y-3">
        <h3 className="text-xs uppercase tracking-widest font-mono text-text-faint">Open questions</h3>
        <ul className="text-sm text-text list-decimal list-inside space-y-1">
          {b.openQuestions.map((q: string, i: number) => <li key={i}>{q}</li>)}
        </ul>
      </Card>
    </div>
  );
}
