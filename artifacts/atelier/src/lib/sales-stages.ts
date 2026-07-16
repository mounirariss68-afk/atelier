/**
 * Atelier sales-stage constants — must mirror
 * artifacts/api-server/src/lib/atelier-agents/pipeline.ts
 *
 * Task #295 — 5 canonical stages + 3 terminals.
 */
import type { SalesStage } from "@workspace/api-client-react";

export const SALES_STAGES: SalesStage[] = [
  "suspect",
  "prospect",
  "convert",
  "runner",
  "contract",
  "lost",
  "no_decision",
  "withdrawn",
];

export const WORKING_STAGES: SalesStage[] = [
  "suspect",
  "prospect",
  "convert",
  "runner",
  "contract",
];

export const TERMINAL_STAGES: SalesStage[] = [
  "lost",
  "no_decision",
  "withdrawn",
];

export const SALES_STAGE_LABEL: Record<SalesStage, string> = {
  suspect: "Suspect",
  prospect: "Prospect",
  convert: "Convert",
  runner: "Runner",
  contract: "Contract",
  lost: "Lost",
  no_decision: "No decision",
  withdrawn: "Withdrawn",
};

export const SALES_STAGE_DESCRIPTION: Record<SalesStage, string> = {
  suspect: "Cold or warmed signal — not yet qualified",
  prospect: "Qualified fit + buyer engaged",
  convert: "Active pursuit — POV, proposal, submitted",
  runner: "Verbal yes — paperwork in motion",
  contract: "Signed and mobilising into delivery",
  lost: "Conceded to a competitor or other reason",
  no_decision: "Client declined to decide",
  withdrawn: "We stepped away or the client withdrew",
};

export const SALES_STAGE_DEFAULT_PROB: Record<SalesStage, number> = {
  suspect: 5,
  prospect: 20,
  convert: 50,
  runner: 80,
  contract: 100,
  lost: 0,
  no_decision: 0,
  withdrawn: 0,
};

export const SUB_STATUS_BY_STAGE: Record<SalesStage, readonly string[]> = {
  suspect: ["cold", "warmed", "targeted"],
  prospect: ["qualified", "discovery_scheduled"],
  convert: ["pov_in_flight", "proposal_in_flight", "submitted"],
  runner: ["verbal", "in_legal", "in_procurement"],
  contract: ["mobilizing", "kickoff_set", "in_flight"],
  lost: [],
  no_decision: [],
  withdrawn: [],
};

export const SUB_STATUS_LABEL: Record<string, string> = {
  cold: "Cold",
  warmed: "Warmed",
  targeted: "Targeted",
  qualified: "Qualified",
  discovery_scheduled: "Discovery scheduled",
  pov_in_flight: "POV in flight",
  proposal_in_flight: "Proposal in flight",
  submitted: "Submitted",
  verbal: "Verbal commit",
  in_legal: "In legal",
  in_procurement: "In procurement",
  mobilizing: "Mobilising",
  kickoff_set: "Kickoff set",
  in_flight: "In flight",
};

export const TERMINAL_REASON_CODES: Record<
  "lost" | "no_decision" | "withdrawn",
  readonly { value: string; label: string }[]
> = {
  lost: [
    { value: "competitor",   label: "Lost to competitor" },
    { value: "price",        label: "Price" },
    { value: "fit",          label: "Fit" },
    { value: "timing",       label: "Timing" },
    { value: "relationship", label: "Relationship" },
  ],
  no_decision: [
    { value: "stalled",        label: "Stalled" },
    { value: "deprioritized",  label: "Deprioritised" },
    { value: "budget_pulled",  label: "Budget pulled" },
  ],
  withdrawn: [
    { value: "conflict",        label: "Conflict of interest" },
    { value: "capacity",        label: "Capacity constraints" },
    { value: "strategic_fit",   label: "Strategic fit" },
    { value: "client_request",  label: "Client request" },
  ],
};

export const STALLED_THRESHOLD_DAYS = 21;

/**
 * Runner-aging tier (Task #296) — drives the colored left-border on
 * Runner-column cards in Pipeline.tsx and the "Runner Aging" report.
 * Procurement-stuck deals are a distinct risk class: ≤21d is healthy,
 * 21–44d amber (chase legal/procurement), ≥45d red (escalate to partner).
 */
export type RunnerAgeTier = "fresh" | "amber" | "red";
export const RUNNER_AGE_AMBER_DAYS = 21;
export const RUNNER_AGE_RED_DAYS = 45;

export function runnerAgeDays(runnerEnteredAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!runnerEnteredAt) return null;
  const t = Date.parse(runnerEnteredAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export function runnerAgeTier(days: number | null): RunnerAgeTier {
  if (days === null || days < RUNNER_AGE_AMBER_DAYS) return "fresh";
  if (days < RUNNER_AGE_RED_DAYS) return "amber";
  return "red";
}

/**
 * Working-pipeline ordering — mirrors WORKING_ORDER in the server's
 * stage-service.ts. Used client-side to detect a *forward* advance so the
 * StageTransitionDialog can preview the server's advance-hygiene gate
 * (a concrete next step + a positive deal size are required to advance).
 */
export const WORKING_ORDER: Record<string, number> = {
  suspect: 0,
  prospect: 1,
  convert: 2,
  runner: 3,
  contract: 4,
};

/** True when moving `from` → `to` advances forward through the working pipeline. */
export function isForwardAdvance(from: SalesStage, to: SalesStage): boolean {
  const f = WORKING_ORDER[from];
  const t = WORKING_ORDER[to];
  return f !== undefined && t !== undefined && t > f;
}

export function stageTone(s: SalesStage): "default" | "gold" | "green" | "amber" | "red" {
  if (s === "contract") return "green";
  if (s === "lost" || s === "no_decision" || s === "withdrawn") return "red";
  if (s === "runner") return "gold";
  if (s === "convert") return "amber";
  return "default";
}
