/**
 * PeopleShell — wrapper that renders the People lens lifecycle ribbon
 * and cross-cutting module rail above whatever child page is mounted at
 * `/people/<...>` (Task #364).
 *
 * The Manage shell already renders the lens picker and contextual section
 * tabs. This shell sits *inside* the page, above each module's own PageHero,
 * so users always have a one-glance view of where they are in the
 * Attract → Hire → Onboard → Develop → Perform → Reward → Retain → Offboard
 * lifecycle plus the cross-cutting modules (people, org, access, skills,
 * time, compliance, approvals).
 */

import * as React from "react";
import type { StageId } from "./peopleLifecycle";

interface PeopleShellProps {
  /**
   * Active lifecycle stage. Retained for backward-compat with existing
   * call sites — no longer drives any in-shell rendering. The shell-level
   * `LensSectionTabs` strip already exposes the People stages, so a
   * second lifecycle ribbon here was visual noise (Task #401).
   */
  stage?: StageId;
  /**
   * Active cross-module id. Retained for backward-compat with existing
   * call sites (PeopleApprovals/PeopleOrg/etc.) — but no longer drives
   * any in-shell rendering. (Task #401)
   */
  module?: string;
  children: React.ReactNode;
}

export function PeopleShell({ stage: _stage, module: _module, children }: PeopleShellProps) {
  return (
    <div className="animate-in fade-in" data-testid="people-shell">
      {children}
    </div>
  );
}

