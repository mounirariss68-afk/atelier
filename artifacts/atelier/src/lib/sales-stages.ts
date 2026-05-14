/**
 * Atelier v2 sales-stage constants — must mirror
 * artifacts/api-server/src/lib/atelier-agents/pipeline.ts
 */
import type { SalesStage } from "@workspace/api-client-react";

export const SALES_STAGES: SalesStage[] = [
  "lead",
  "qualified",
  "discovery_scheduled",
  "pov_in_flight",
  "proposal_in_flight",
  "submitted",
  "verbal_commit",
  "signed",
  "lost_no_decision",
  "withdrawn",
];

export const TERMINAL_STAGES: SalesStage[] = [
  "signed",
  "lost_no_decision",
  "withdrawn",
];

export const SALES_STAGE_LABEL: Record<SalesStage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  discovery_scheduled: "Discovery scheduled",
  pov_in_flight: "POV in flight",
  proposal_in_flight: "Proposal in flight",
  submitted: "Submitted",
  verbal_commit: "Verbal commit",
  signed: "Signed",
  lost_no_decision: "Conceded / Folded",
  withdrawn: "Stalled",
};

// Short blurb shown under each stage name on the kanban board.
export const SALES_STAGE_DESCRIPTION: Record<SalesStage, string> = {
  lead: "Unqualified inbound or sourced interest",
  qualified: "Fit + budget signals confirmed",
  discovery_scheduled: "Discovery session on the calendar",
  pov_in_flight: "Proof-of-value build underway",
  proposal_in_flight: "Drafting commercials & SoW",
  submitted: "Proposal with the client, awaiting feedback",
  verbal_commit: "Verbal yes — paperwork pending",
  signed: "Countersigned and booked",
  lost_no_decision: "Conceded to a competitor or folded with no decision",
  withdrawn: "Stalled — we stepped away or the client withdrew",
};

export const SALES_STAGE_DEFAULT_PROB: Record<SalesStage, number> = {
  lead: 5,
  qualified: 15,
  discovery_scheduled: 25,
  pov_in_flight: 35,
  proposal_in_flight: 50,
  submitted: 65,
  verbal_commit: 80,
  signed: 100,
  lost_no_decision: 0,
  withdrawn: 0,
};

export const STALLED_THRESHOLD_DAYS = 21;

export function stageTone(s: SalesStage): "default" | "gold" | "green" | "amber" | "red" {
  if (s === "signed") return "green";
  if (s === "lost_no_decision" || s === "withdrawn") return "red";
  if (s === "verbal_commit" || s === "submitted") return "gold";
  if (s === "proposal_in_flight" || s === "pov_in_flight") return "amber";
  return "default";
}
