/**
 * ReadinessPanel — derives readiness issues from requirements + assignments
 * and renders a bordered warning card with per-issue chips.
 *
 * deriveReadinessIssues mirrors the server's activation validation
 * (POST /engagements/:id/mobilization/activate) closely enough that the
 * "Activate" button is disabled on the same conditions the server would
 * reject. The server remains the authoritative gate; this is a UX guard.
 *
 * Server checks mirrored here:
 *   1. At least one required requirement must exist.
 *   2. At least one accepted assignment must exist.
 *   3. Every accepted assignment must have availabilityStatus === "available".
 *   4. Every accepted assignment must fall within engagement dates (not checked
 *      here — we don't have eng dates in this helper; TeamTab already has them).
 *   5. For each required+open requirement:
 *      a. At least one accepted assignment covers it (by requirementId match).
 *      b. The sum of matched assignment allocationPct >= requirement allocationPct.
 *      c. The matched assignments provide contiguous date coverage from
 *         requirement.startDate through requirement.endDate (gap check).
 *   6. Pending proposals are surfaced as warnings (not errors) since they
 *      could become accepted assignments.
 */
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { seniorityLabel } from "./constants";
import type { StaffingRequirement, StaffingAssignment } from "./types";

export interface ReadinessIssue {
  key: string;
  severity: "warn" | "error";
  message: string;
}

/**
 * Returns true if a sorted list of [startDate, endDate] pairs provides
 * contiguous coverage from `from` through `through` (server algorithm).
 */
function hasDateCoverage(
  from: string,
  through: string,
  spans: Array<{ startDate: string; endDate: string }>,
): boolean {
  if (spans.length === 0) return false;
  const sorted = spans.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  let coveredThrough = from;
  for (const s of sorted) {
    if (s.startDate > coveredThrough) return false; // gap
    if (s.endDate >= coveredThrough) coveredThrough = s.endDate;
  }
  return coveredThrough >= through;
}

export function deriveReadinessIssues(
  reqs: StaffingRequirement[],
  asgs: StaffingAssignment[],
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  const requiredReqs = reqs.filter((r) => r.required && r.status === "open");
  const acceptedAsgs = asgs.filter((a) => a.state === "accepted");

  // Check 1 — at least one required requirement must exist.
  if (requiredReqs.length === 0) {
    issues.push({
      key: "no-required-requirements",
      severity: "error",
      message: "No required staffing requirements defined. Add at least one.",
    });
  }

  // Check 2 — at least one accepted assignment must exist.
  if (acceptedAsgs.length === 0) {
    issues.push({
      key: "no-accepted-assignments",
      severity: "error",
      message: "No accepted assignments. Propose someone and have them accept.",
    });
  }

  // Check 3 — availability must be confirmed on all accepted assignments.
  acceptedAsgs.forEach((a) => {
    if (a.availabilityStatus !== "available") {
      issues.push({
        key: `avail-${a.id}`,
        severity: "error",
        message: `Availability unconfirmed for ${a.role} (${seniorityLabel(a.seniority)}) — must be "available".`,
      });
    }
  });

  // Checks 5a/5b/5c — per required requirement coverage.
  for (const req of requiredReqs) {
    // Matches by requirementId (strict link) only — role+seniority fuzzy match
    // is used for display grouping but the server's activation check uses requirementId.
    const matched = acceptedAsgs.filter((a) => a.requirementId === req.id);

    if (matched.length === 0) {
      issues.push({
        key: `missing-${req.id}`,
        severity: "error",
        message: `Required role not filled: ${req.role} (${seniorityLabel(req.seniority)}) — no accepted assignment linked to this requirement.`,
      });
      continue; // no point checking allocation/dates
    }

    // 5b — allocation sum.
    const totalAlloc = matched.reduce((sum, a) => sum + a.allocationPct, 0);
    if (totalAlloc < req.allocationPct) {
      issues.push({
        key: `allocation-${req.id}`,
        severity: "error",
        message: `${req.role} (${seniorityLabel(req.seniority)}) needs ${req.allocationPct}% allocation — only ${totalAlloc}% covered.`,
      });
    }

    // 5c — date coverage.
    if (!hasDateCoverage(req.startDate, req.endDate, matched)) {
      issues.push({
        key: `dates-${req.id}`,
        severity: "error",
        message: `${req.role} (${seniorityLabel(req.seniority)}) has a gap in date coverage — assignments must span ${req.startDate} through ${req.endDate}.`,
      });
    }
  }

  // Warning — pending proposals (could become accepted).
  const proposed = asgs.filter((a) => a.state === "proposed");
  if (proposed.length > 0) {
    issues.push({
      key: "pending-proposals",
      severity: "warn",
      message: `${proposed.length} assignment${proposed.length === 1 ? "" : "s"} awaiting response`,
    });
  }

  return issues;
}

export function ReadinessPanel({ issues }: { issues: ReadinessIssue[] }) {
  return (
    <Card className="p-4 border-l-4 border-l-warn space-y-2" data-testid="readiness-issues">
      <div className="text-xs font-mono uppercase tracking-widest text-warn flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5" />
        Readiness Issues
      </div>
      <ul className="space-y-1.5">
        {issues.map((issue) => (
          <li key={issue.key} className="flex items-start gap-2 text-sm">
            <MonoChip
              tone={issue.severity === "error" ? "red" : "amber"}
              className="shrink-0 mt-0.5"
            >
              {issue.severity === "error" ? "error" : "warn"}
            </MonoChip>
            <span className="text-text">{issue.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
