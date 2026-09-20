/**
 * TeamTab — mobilization staffing surface for the engagement workspace.
 *
 * This file is a thin orchestrator; all logic lives in
 * components/mobilization/:
 *   types.ts          shared data shapes
 *   constants.ts      option lists, token maps, CSS helper
 *   hooks.ts          React-Query hooks
 *   ReadinessPanel.tsx derive + render readiness issues
 *   AssignmentRow.tsx  per-assignment actions (self → /me, mobilizer → engagement)
 *   RequirementRow.tsx collapsible requirement + nested assignments
 *   AddRequirementForm.tsx
 *   AddAssignmentForm.tsx
 *   HandoffsPanel.tsx
 *   FormPrimitives.tsx FormField + EmptySlot
 */
import * as React from "react";
import { useAtelierGetMe } from "@workspace/api-client-react";
import { Card, MonoChip, PillButton, SectionLabel } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, UserPlus, Users, Zap } from "lucide-react";

import {
  useMobilizationData,
  useInvalidateMobilization,
  useEngagementTransition,
  useSelfTransition,
  useActivate,
} from "@/components/mobilization/hooks";
import { deriveReadinessIssues, ReadinessPanel } from "@/components/mobilization/ReadinessPanel";
import { RequirementRow } from "@/components/mobilization/RequirementRow";
import { AssignmentRow } from "@/components/mobilization/AssignmentRow";
import { AddRequirementForm } from "@/components/mobilization/AddRequirementForm";
import { AddAssignmentForm } from "@/components/mobilization/AddAssignmentForm";
import { HandoffsPanel } from "@/components/mobilization/HandoffsPanel";
import { EmptySlot } from "@/components/mobilization/FormPrimitives";

export function TeamTab({ engId }: { engId: string }) {
  const { data: me } = useAtelierGetMe();

  // Data + mutations (loaded before permission gates so we can use eng fields)
  const mob = useMobilizationData(engId);
  const invalidate = useInvalidateMobilization(engId);

  // Permission gates — derived after data is available so we can reference
  // eng.partnerOwnerId / eng.engagementLeadId (mirrors server canMobilize exactly).
  const canViewCost = React.useMemo(
    () => ["founding_partner", "partner", "finance", "hr"].includes(me?.role ?? ""),
    [me],
  );
  const canMobilize = React.useMemo(() => {
    const byRole = ["founding_partner", "partner", "finance", "hr", "senior_manager"].includes(
      me?.role ?? "",
    );
    if (byRole) return true;
    // Owner/lead of this specific engagement may also mobilize.
    const eng = mob.data?.engagement;
    if (!eng || !me?.id) return false;
    return me.id === eng.partnerOwnerId || me.id === eng.engagementLeadId;
  }, [me, mob.data]);

  // Mobilizer transition (end / replace) → engagement endpoint
  const engTransition = useEngagementTransition(engId, invalidate);
  // Self accept/decline → /me endpoint
  const selfTransition = useSelfTransition(invalidate);
  const activate = useActivate(engId, invalidate);

  // Local UI state
  const [showAddReq, setShowAddReq] = React.useState(false);
  const [showAddAsg, setShowAddAsg] = React.useState(false);
  const [reasonMap, setReasonMap] = React.useState<Record<string, string>>({});

  if (mob.isLoading)
    return <Skeleton className="h-64 bg-bg-elevate" data-testid="team-tab-skeleton" />;

  if (mob.isError || !mob.data)
    return (
      <Card className="p-6 text-danger" data-testid="team-tab-error">
        Failed to load mobilization data.{" "}
        <button
          type="button"
          onClick={() => mob.refetch()}
          className="underline ml-2 text-text-mute hover:text-text"
        >
          Retry
        </button>
      </Card>
    );

  const d = mob.data;
  const reqs = d.requirements;
  const asgs = d.assignments;
  const handoffs = d.handoffs;
  const readinessIssues = deriveReadinessIssues(reqs, asgs);
  // Only error-severity issues block activation; warnings (e.g. pending proposals)
  // render in the ReadinessPanel but must not prevent the Activate button.
  const blockingIssues = readinessIssues.filter((i) => i.severity === "error");
  const isActive = d.engagement.mobilizationStatus === "active";

  // Assignments already shown inside a RequirementRow (by requirementId, or
  // by role+seniority match)
  const coveredAsgIds = new Set<string>();
  reqs.forEach((req) => {
    asgs.forEach((a) => {
      if (
        a.requirementId === req.id ||
        (a.role === req.role && a.seniority === req.seniority)
      ) {
        coveredAsgIds.add(a.id);
      }
    });
  });
  const unlinkedAsgs = asgs.filter((a) => !coveredAsgIds.has(a.id));

  const transitionPending = engTransition.isPending || selfTransition.isPending;

  return (
    <div className="space-y-6" data-testid="team-tab">
      {/* Header strip */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <MonoChip
            tone={
              isActive ? "green" : blockingIssues.length === 0 ? "gold" : "amber"
            }
          >
            {isActive
              ? "Active"
              : blockingIssues.length === 0
              ? "Ready"
              : `${blockingIssues.length} issue${blockingIssues.length === 1 ? "" : "s"}`}
          </MonoChip>
          <span className="text-xs font-mono text-text-mute uppercase tracking-widest">
            Mobilization
          </span>
        </div>
        {canMobilize && !isActive && (
          <PillButton
            variant="primary"
            onClick={() => activate.mutate()}
            disabled={activate.isPending || blockingIssues.length > 0}
            data-testid="btn-activate"
            title={
              blockingIssues.length > 0
                ? "Resolve all readiness errors before activating"
                : "Activate mobilization"
            }
          >
            <Zap className="w-3.5 h-3.5 mr-1.5" />
            {activate.isPending ? "Activating…" : "Activate"}
          </PillButton>
        )}
        {isActive && (
          <MonoChip tone="green" data-testid="chip-active">
            Engagement is active
          </MonoChip>
        )}
      </div>

      {/* Readiness issues */}
      {readinessIssues.length > 0 && <ReadinessPanel issues={readinessIssues} />}

      {/* Staffing requirements */}
      <Card className="p-5 space-y-4" data-testid="requirements-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <SectionLabel>Staffing Requirements</SectionLabel>
          {canMobilize && (
            <PillButton
              variant="ghost"
              onClick={() => setShowAddReq((v) => !v)}
              data-testid="btn-add-requirement"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add requirement
            </PillButton>
          )}
        </div>

        {showAddReq && canMobilize && (
          <AddRequirementForm
            engId={engId}
            eng={d.engagement}
            canViewCost={canViewCost}
            onDone={() => {
              setShowAddReq(false);
              invalidate();
            }}
            onCancel={() => setShowAddReq(false)}
          />
        )}

        {reqs.length === 0 && !showAddReq && (
          <EmptySlot
            icon={<Users className="w-5 h-5" />}
            message="No staffing requirements defined yet."
          />
        )}

        {reqs.length > 0 && (
          <div className="space-y-3">
            {reqs.map((req) => {
              const slotAsgs = asgs.filter(
                (a) =>
                  a.requirementId === req.id ||
                  (a.role === req.role && a.seniority === req.seniority),
              );
              return (
                <RequirementRow
                  key={req.id}
                  req={req}
                  assignments={slotAsgs}
                  canViewCost={canViewCost}
                  canMobilize={canMobilize}
                  myUserId={me?.id}
                  reasonMap={reasonMap}
                  setReasonMap={setReasonMap}
                  onSelfTransition={(asgId, state) =>
                    selfTransition.mutate({ assignmentId: asgId, state })
                  }
                  onMobilizerTransition={(asgId, state, reason) =>
                    engTransition.mutate({ assignmentId: asgId, state, reason })
                  }
                  transitionPending={transitionPending}
                />
              );
            })}
          </div>
        )}
      </Card>

      {/* Additional (unlinked) assignments */}
      {unlinkedAsgs.length > 0 && (
        <Card className="p-5 space-y-4" data-testid="unlinked-assignments-panel">
          <SectionLabel>Additional Assignments</SectionLabel>
          <div className="space-y-3">
            {unlinkedAsgs.map((a) => (
              <AssignmentRow
                key={a.id}
                asg={a}
                canViewCost={canViewCost}
                canMobilize={canMobilize}
                myUserId={me?.id}
                reason={reasonMap[a.id] ?? ""}
                setReason={(v) => setReasonMap((m) => ({ ...m, [a.id]: v }))}
                onSelfTransition={(state) =>
                  selfTransition.mutate({ assignmentId: a.id, state })
                }
                onMobilizerTransition={(state, reason) =>
                  engTransition.mutate({ assignmentId: a.id, state, reason })
                }
                pending={transitionPending}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Propose assignment */}
      {canMobilize && (
        <Card className="p-5 space-y-4" data-testid="add-assignment-panel">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <SectionLabel>Propose Assignment</SectionLabel>
            <PillButton
              variant="ghost"
              onClick={() => setShowAddAsg((v) => !v)}
              data-testid="btn-add-assignment"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1" />
              {showAddAsg ? "Cancel" : "Propose person"}
            </PillButton>
          </div>
          {showAddAsg ? (
            <AddAssignmentForm
              engId={engId}
              eng={d.engagement}
              requirements={reqs}
              canViewCost={canViewCost}
              onDone={() => {
                setShowAddAsg(false);
                invalidate();
              }}
              onCancel={() => setShowAddAsg(false)}
            />
          ) : (
            <p className="text-xs text-text-mute">
              Propose a named person against any open requirement or add them directly to the team.
            </p>
          )}
        </Card>
      )}

      {/* Handoffs */}
      {(handoffs.length > 0 || canMobilize) && (
        <HandoffsPanel
          engId={engId}
          handoffs={handoffs}
          canMobilize={canMobilize}
          onDone={invalidate}
        />
      )}
    </div>
  );
}
