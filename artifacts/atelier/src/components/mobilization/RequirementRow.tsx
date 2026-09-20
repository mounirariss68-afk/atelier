/**
 * RequirementRow — collapsible row for one staffing requirement, listing
 * its matched assignments inside an expandable body.
 */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MonoChip } from "@/components/ui/primitives";
import { AVAIL_TONE, fmtDate, seniorityLabel } from "./constants";
import { AssignmentRow } from "./AssignmentRow";
import { EmptySlot } from "./FormPrimitives";
import type { StaffingRequirement, StaffingAssignment } from "./types";

interface RequirementRowProps {
  req: StaffingRequirement;
  assignments: StaffingAssignment[];
  canViewCost: boolean;
  canMobilize: boolean;
  myUserId?: string;
  reasonMap: Record<string, string>;
  setReasonMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSelfTransition: (assignmentId: string, state: "accepted" | "declined") => void;
  onMobilizerTransition: (
    assignmentId: string,
    state: "ended" | "replaced",
    reason?: string,
  ) => void;
  transitionPending: boolean;
}

export function RequirementRow({
  req,
  assignments,
  canViewCost,
  canMobilize,
  myUserId,
  reasonMap,
  setReasonMap,
  onSelfTransition,
  onMobilizerTransition,
  transitionPending,
}: RequirementRowProps) {
  const [expanded, setExpanded] = React.useState(true);

  const activeAsgs = assignments.filter(
    (a) => a.state === "accepted" || a.state === "proposed",
  );
  const filledCount = assignments.filter((a) => a.state === "accepted").length;

  return (
    <div
      className="border border-border-soft rounded-md bg-bg-deep"
      data-testid={`requirement-row-${req.id}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-elevate/40 transition-colors rounded-md"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-text-mute shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-mute shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text">{req.role}</span>
            <span className="text-xs text-text-mute font-mono">
              {seniorityLabel(req.seniority)}
            </span>
            {req.required && (
              <MonoChip tone="amber" className="text-[10px]">
                Required
              </MonoChip>
            )}
            <MonoChip
              tone={filledCount > 0 ? "green" : "default"}
              className="text-[10px]"
            >
              {filledCount}/{activeAsgs.length} filled
            </MonoChip>
          </div>
          <div className="text-[11px] font-mono text-text-mute mt-0.5">
            {req.allocationPct}% · {fmtDate(req.startDate)} – {fmtDate(req.endDate)}
          </div>
        </div>
        {canViewCost && req.rateAmount != null && (
          <div className="text-xs font-mono text-text-mute shrink-0">
            {req.rateCurrency} {req.rateAmount.toLocaleString()}
            {req.rateSource ? ` (${req.rateSource})` : ""}
          </div>
        )}
        <MonoChip
          tone={AVAIL_TONE[req.availabilityStatus] ?? "default"}
          className="shrink-0"
        >
          {req.availabilityStatus}
        </MonoChip>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border-soft pt-3">
          {req.notes && (
            <p className="text-xs text-text-mute italic">{req.notes}</p>
          )}

          {assignments.length === 0 && (
            <EmptySlot message="No assignments yet for this requirement." />
          )}

          {assignments.map((a) => (
            <AssignmentRow
              key={a.id}
              asg={a}
              canViewCost={canViewCost}
              canMobilize={canMobilize}
              myUserId={myUserId}
              reason={reasonMap[a.id] ?? ""}
              setReason={(v) => setReasonMap((m) => ({ ...m, [a.id]: v }))}
              onSelfTransition={(state) => onSelfTransition(a.id, state)}
              onMobilizerTransition={(state, reason) =>
                onMobilizerTransition(a.id, state, reason)
              }
              pending={transitionPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
