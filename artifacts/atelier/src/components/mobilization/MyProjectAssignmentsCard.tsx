/**
 * MyProjectAssignmentsCard — appears on the Me / Overview section.
 *
 * Fetches GET /me/mobilization-assignments (proposed + accepted only).
 * Proposed rows show Accept / Decline buttons (PATCH /me/mobilization-assignments/:id).
 * Accepted rows show role, engagement, dates and allocation.
 * Rates are never shown.
 * Handles ?focus=mobilization by scrolling/focusing the card on mount.
 */
import * as React from "react";
import { Link } from "wouter";
import { Check, X, Briefcase } from "lucide-react";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyMobilizationAssignments, useMeSelfTransition } from "./hooks";
import { fmtDate, seniorityLabel, STATE_TONE } from "./constants";
import type { MyAssignment } from "./types";

interface MyProjectAssignmentsCardProps {
  /** When true, scroll the card into view on mount (driven by ?focus=mobilization). */
  focusOnMount?: boolean;
}

export function MyProjectAssignmentsCard({ focusOnMount }: MyProjectAssignmentsCardProps) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const { data, isLoading, isError, refetch } = useMyMobilizationAssignments();
  const selfTransition = useMeSelfTransition();

  // Scroll into view when focus=mobilization is in the URL
  React.useEffect(() => {
    if (focusOnMount && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      // Light focus ring to draw the eye
      cardRef.current.focus({ preventScroll: true });
    }
  }, [focusOnMount]);

  if (isLoading)
    return <Skeleton className="h-28 bg-bg-elevate" data-testid="my-assignments-skeleton" />;

  if (isError)
    return (
      <Card className="p-4" data-testid="my-assignments-error">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-mute">Could not load project assignments.</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-gold hover:underline"
          >
            Retry
          </button>
        </div>
      </Card>
    );

  // Nothing to show: return null so the card doesn't appear when the user
  // has no current assignments.
  if (!data || data.length === 0) return null;

  const proposed = data.filter((a) => a.state === "proposed");
  const accepted = data.filter((a) => a.state === "accepted");

  return (
    <Card
      ref={cardRef}
      tabIndex={-1}
      className="p-4 focus:outline-none focus:ring-2 focus:ring-gold/40"
      data-testid="my-project-assignments-card"
      id="mobilization"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-text-mute" />
          <h3 className="text-sm font-semibold text-text">Project assignments</h3>
          {proposed.length > 0 && (
            <span
              className="inline-flex items-center justify-center rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-gold"
              data-testid="my-assignments-pending-count"
            >
              {proposed.length} pending
            </span>
          )}
        </div>
      </div>

      {/* Proposed — need a response */}
      {proposed.length > 0 && (
        <div className="space-y-2 mb-4" data-testid="my-assignments-proposed">
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">
            Awaiting your response
          </div>
          {proposed.map((a) => (
            <ProposedRow
              key={a.id}
              asg={a}
              onAccept={() => selfTransition.mutate({ assignmentId: a.id, state: "accepted" })}
              onDecline={() => selfTransition.mutate({ assignmentId: a.id, state: "declined" })}
              pending={selfTransition.isPending}
            />
          ))}
        </div>
      )}

      {/* Accepted — current projects */}
      {accepted.length > 0 && (
        <div className="space-y-2" data-testid="my-assignments-accepted">
          {proposed.length > 0 && (
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1">
              Active on
            </div>
          )}
          {accepted.map((a) => (
            <AcceptedRow key={a.id} asg={a} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ProposedRow({
  asg,
  onAccept,
  onDecline,
  pending,
}: {
  asg: MyAssignment;
  onAccept: () => void;
  onDecline: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-md border border-gold/30 bg-bg-deep flex-wrap"
      data-testid={`my-asg-proposed-${asg.id}`}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <MonoChip tone={STATE_TONE[asg.state] ?? "default"}>{asg.state}</MonoChip>
          <span className="text-sm font-medium text-text truncate">
            {asg.role}
          </span>
          <span className="text-xs text-text-mute font-mono">
            {seniorityLabel(asg.seniority)}
          </span>
        </div>
        <div className="text-[11px] font-mono text-text-mute">
          <Link
            href={`/clients/deliver/engagements/${asg.engagementId}/team`}
            className="hover:text-gold transition-colors"
          >
            {asg.engagementName}
          </Link>
          {" "}· {asg.allocationPct}% · {fmtDate(asg.startDate)} – {fmtDate(asg.endDate)}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <PillButton
          variant="primary"
          onClick={onAccept}
          disabled={pending}
          data-testid={`btn-me-accept-${asg.id}`}
          title="Accept this assignment"
        >
          <Check className="w-3.5 h-3.5 mr-1" />
          Accept
        </PillButton>
        <PillButton
          variant="ghost"
          onClick={onDecline}
          disabled={pending}
          data-testid={`btn-me-decline-${asg.id}`}
          title="Decline this assignment"
        >
          <X className="w-3.5 h-3.5 mr-1" />
          Decline
        </PillButton>
      </div>
    </div>
  );
}

function AcceptedRow({ asg }: { asg: MyAssignment }) {
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-md border border-border-soft bg-bg-deep flex-wrap"
      data-testid={`my-asg-accepted-${asg.id}`}
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <MonoChip tone="green">accepted</MonoChip>
          <span className="text-sm font-medium text-text truncate">{asg.role}</span>
          <span className="text-xs text-text-mute font-mono">
            {seniorityLabel(asg.seniority)}
          </span>
        </div>
        <div className="text-[11px] font-mono text-text-mute">
          <Link
            href={`/clients/deliver/engagements/${asg.engagementId}/team`}
            className="hover:text-gold transition-colors"
          >
            {asg.engagementName}
          </Link>
          {" "}· {asg.allocationPct}% · {fmtDate(asg.startDate)} – {fmtDate(asg.endDate)}
        </div>
      </div>
    </div>
  );
}
