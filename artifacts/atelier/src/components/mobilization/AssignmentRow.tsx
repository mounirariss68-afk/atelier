/**
 * AssignmentRow — renders a single staffing assignment with state-appropriate
 * action buttons:
 *   - self (isMe + proposed) → Accept / Decline via /me/mobilization-assignments/:id
 *   - mobilizer (accepted)   → End / Replace via engagement endpoint
 */
import * as React from "react";
import { Check, X, LogOut, RefreshCw } from "lucide-react";
import { MonoChip, PillButton } from "@/components/ui/primitives";
import { STATE_TONE, AVAIL_TONE, fmtDate, seniorityLabel } from "./constants";
import type { StaffingAssignment } from "./types";

interface AssignmentRowProps {
  asg: StaffingAssignment;
  /** Whether the current user can see cost/rate data. */
  canViewCost: boolean;
  /** Whether the current user is a mobilizer (can end/replace). */
  canMobilize: boolean;
  /** The current user's userId (to detect "isMe"). */
  myUserId?: string;
  reason: string;
  setReason: (v: string) => void;
  /**
   * Called for self accept/decline — uses the /me endpoint.
   * Only fired when isMe && state === "proposed".
   */
  onSelfTransition: (state: "accepted" | "declined") => void;
  /**
   * Called for mobilizer end/replace — uses the engagement endpoint.
   * Only fired when canMobilize && state === "accepted".
   */
  onMobilizerTransition: (state: "ended" | "replaced", reason?: string) => void;
  pending: boolean;
}

export function AssignmentRow({
  asg,
  canViewCost,
  canMobilize,
  myUserId,
  reason,
  setReason,
  onSelfTransition,
  onMobilizerTransition,
  pending,
}: AssignmentRowProps) {
  const isMe = asg.userId === myUserId;
  const [showReason, setShowReason] = React.useState(false);
  const [pendingState, setPendingState] = React.useState<"ended" | "replaced" | null>(null);

  function actMobilizer(state: "ended" | "replaced") {
    // Always prompt for optional reason before firing mobilizer transitions
    setShowReason(true);
    setPendingState(state);
  }

  function confirmMobilizer() {
    if (pendingState) {
      onMobilizerTransition(pendingState, reason || undefined);
      setShowReason(false);
      setPendingState(null);
    }
  }

  return (
    <div
      className="rounded-md border border-border bg-bg-elevate/30 p-3 space-y-2"
      data-testid={`assignment-row-${asg.id}`}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text">{asg.role}</span>
            <span className="text-xs text-text-mute font-mono">
              {seniorityLabel(asg.seniority)}
            </span>
            <MonoChip tone={STATE_TONE[asg.state] ?? "default"}>{asg.state}</MonoChip>
            <MonoChip tone={AVAIL_TONE[asg.availabilityStatus] ?? "default"}>
              {asg.availabilityStatus}
            </MonoChip>
          </div>
          <div className="text-[11px] font-mono text-text-mute">
            {asg.allocationPct}% · {fmtDate(asg.startDate)} – {fmtDate(asg.endDate)}
          </div>
          {asg.stateReason && (
            <div className="text-[11px] text-text-mute italic">
              Reason: {asg.stateReason}
            </div>
          )}
        </div>

        {canViewCost && asg.rateAmount != null && (
          <div className="text-xs font-mono text-text-mute shrink-0 mt-0.5">
            {asg.rateCurrency} {asg.rateAmount.toLocaleString()}
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {/* Self accept/decline — uses /me endpoint */}
          {isMe && asg.state === "proposed" && (
            <>
              <PillButton
                variant="primary"
                onClick={() => onSelfTransition("accepted")}
                disabled={pending}
                data-testid={`btn-accept-${asg.id}`}
                title="Accept this assignment"
              >
                <Check className="w-3.5 h-3.5 mr-1" />
                Accept
              </PillButton>
              <PillButton
                variant="ghost"
                onClick={() => onSelfTransition("declined")}
                disabled={pending}
                data-testid={`btn-decline-${asg.id}`}
                title="Decline this assignment"
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Decline
              </PillButton>
            </>
          )}

          {/* Mobilizer end/replace — uses engagement endpoint */}
          {canMobilize && asg.state === "accepted" && (
            <>
              <PillButton
                variant="ghost"
                onClick={() => actMobilizer("ended")}
                disabled={pending}
                data-testid={`btn-end-${asg.id}`}
                title="End this assignment"
              >
                <LogOut className="w-3.5 h-3.5 mr-1" />
                End
              </PillButton>
              <PillButton
                variant="ghost"
                onClick={() => actMobilizer("replaced")}
                disabled={pending}
                data-testid={`btn-replace-${asg.id}`}
                title="Mark as replaced (then propose a new person)"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                Replace
              </PillButton>
            </>
          )}
        </div>
      </div>

      {/* Reason input for mobilizer actions */}
      {showReason && (
        <div className="flex items-center gap-2 mt-1">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)…"
            className="flex-1 h-8 px-3 text-xs rounded-md bg-bg-deep border border-border focus:outline-none focus:ring-1 focus:ring-gold text-text"
            data-testid={`input-reason-${asg.id}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmMobilizer();
              if (e.key === "Escape") {
                setShowReason(false);
                setPendingState(null);
              }
            }}
            autoFocus
          />
          <PillButton
            variant="primary"
            disabled={pending}
            onClick={confirmMobilizer}
            data-testid={`btn-confirm-reason-${asg.id}`}
          >
            Confirm
          </PillButton>
          <PillButton
            variant="ghost"
            onClick={() => {
              setShowReason(false);
              setPendingState(null);
            }}
            data-testid={`btn-cancel-reason-${asg.id}`}
          >
            Cancel
          </PillButton>
        </div>
      )}
    </div>
  );
}
