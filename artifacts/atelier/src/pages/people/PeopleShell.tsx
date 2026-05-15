/**
 * PeopleShell — wrapper that renders the People Studio lifecycle ribbon
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
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { STAGES, type StageId } from "./peopleLifecycle";
import { useStageStats } from "./peopleSeed";
import { useCanSeeRewardAndSuccession } from "./peoplePerms";

interface PeopleShellProps {
  /** Active lifecycle stage, if any. */
  stage?: StageId;
  /**
   * Active cross-module id. Retained for backward-compat with existing
   * call sites (PeopleApprovals/PeopleOrg/etc.) — but no longer drives
   * any in-shell rendering. The shell-level `LensSectionTabs` strip
   * already exposes the cross-cutting modules; rendering a second rail
   * here was visual noise (Task #401).
   */
  module?: string;
  children: React.ReactNode;
}

export function PeopleShell({ stage, module: _module, children }: PeopleShellProps) {
  const [loc] = useLocation();

  return (
    <div className="animate-in fade-in" data-testid="people-shell">
      <LifecycleRibbon activeStage={stage} pathname={loc} />
      {children}
    </div>
  );
}

function LifecycleRibbon({ activeStage, pathname }: { activeStage?: StageId; pathname: string }) {
  const stats = useStageStats();
  const { allowed: canSeeReward } = useCanSeeRewardAndSuccession();
  // Reward stage is hidden from the ribbon for non-Partner/Admin personas
  // (Task #364, Wave-4 review).
  const visibleStages = canSeeReward ? STAGES : STAGES.filter((s) => s.id !== "reward");
  return (
    <div className="border-b border-border bg-bg-elevate/40">
      <div className="container-atelier py-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint shrink-0 mr-2">
            Lifecycle
          </span>
          {visibleStages.map((s, i) => {
            const isActive = activeStage === s.id || pathname.startsWith(s.href);
            const stat = stats[s.id];
            const title = stat ? `${s.blurb}\n${stat.count} ${stat.countLabel} · ${stat.nextAction}` : s.blurb;
            return (
              <React.Fragment key={s.id}>
                {i > 0 && (
                  <span className="text-text-faint shrink-0" aria-hidden>
                    ›
                  </span>
                )}
                <Link
                  href={s.href}
                  title={title}
                  data-testid={`people-stage-${s.id}`}
                  className={cn(
                    "shrink-0 px-2.5 py-1 rounded font-mono text-[11px] uppercase tracking-wide border transition-colors flex items-center gap-1.5",
                    isActive
                      ? "border-gold/60 bg-gold/10 text-gold"
                      : "border-transparent text-text-mute hover:text-text hover:border-border",
                  )}
                >
                  <span>{s.label}</span>
                  {stat && stat.count > 0 && (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded-full text-[9px] font-mono",
                        isActive ? "bg-gold/30 text-gold" : "bg-border text-text-faint",
                      )}
                      data-testid={`people-stage-${s.id}-count`}
                    >
                      {stat.count}
                    </span>
                  )}
                </Link>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

