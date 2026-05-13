import * as React from "react";
import { ChevronRight, Circle, CheckCircle2, XCircle } from "lucide-react";
import { MonoChip } from "@/components/ui/primitives";

type Branch = {
  hypothesis: string;
  subHypotheses?: string[];
  evidenceRequired?: string[];
  status?: "open" | "supported" | "refuted" | null;
};

export type HypothesisTreeShape = {
  rootIssue: string;
  branches: Branch[];
};

function statusIcon(s: Branch["status"]) {
  if (s === "supported") return <CheckCircle2 className="w-3.5 h-3.5 text-positive" />;
  if (s === "refuted") return <XCircle className="w-3.5 h-3.5 text-danger" />;
  return <Circle className="w-3.5 h-3.5 text-text-mute" />;
}

export function HypothesisTree({ tree }: { tree: HypothesisTreeShape | null | undefined }) {
  if (!tree || !tree.rootIssue) {
    return (
      <div className="text-text-mute text-sm font-mono py-6">
        No hypothesis tree yet — redraft the charter to generate one.
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="hypothesis-tree">
      <div className="text-xs font-mono text-text-mute uppercase tracking-wide">Root issue</div>
      <div className="text-base text-text font-medium">{tree.rootIssue}</div>
      <div className="space-y-3 mt-4">
        {(tree.branches ?? []).map((b, i) => (
          <div
            key={i}
            className="border border-border-soft rounded-md p-4 bg-bg-deep space-y-2"
            data-testid={`hyp-branch-${i}`}
          >
            <div className="flex items-start gap-2">
              <ChevronRight className="w-4 h-4 mt-0.5 text-gold flex-shrink-0" />
              <div className="flex-1 text-sm text-text">{b.hypothesis}</div>
              <div className="flex items-center gap-1.5 text-xs font-mono text-text-mute">
                {statusIcon(b.status)}
                {b.status ?? "open"}
              </div>
            </div>
            {b.subHypotheses && b.subHypotheses.length > 0 && (
              <ul className="ml-6 space-y-1 text-sm text-text-mute">
                {b.subHypotheses.map((s, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <span className="text-gold/60 mt-1">·</span>
                    {s}
                  </li>
                ))}
              </ul>
            )}
            {b.evidenceRequired && b.evidenceRequired.length > 0 && (
              <div className="ml-6 pt-2 border-t border-border-soft/50">
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-mute mb-1">
                  Evidence required
                </div>
                <div className="flex flex-wrap gap-1">
                  {b.evidenceRequired.map((e, k) => (
                    <MonoChip key={k} tone="default">
                      {e}
                    </MonoChip>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {(!tree.branches || tree.branches.length === 0) && (
          <div className="text-text-mute text-sm font-mono">No branches.</div>
        )}
      </div>
    </div>
  );
}
