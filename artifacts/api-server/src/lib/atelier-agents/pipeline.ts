/**
 * Atelier v2 — Sales pipeline constants + helpers (Task #239 / PRD §2.3).
 *
 * 10-stage sales lifecycle replaces the v1 6-stage PLM. plmStage is now a
 * derived (write-time) shadow of salesStage; existing v1 routes/data continue
 * to read plmStage normally, but every write should funnel through these
 * helpers so the two columns stay in lockstep.
 */

export const SALES_STAGES = [
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
] as const;

export type SalesStage = (typeof SALES_STAGES)[number];

/** Default win probability used by the Forecaster when no override is set. */
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

/** Map a v2 sales stage onto its v1 PLM stage so legacy reads stay valid. */
export const SALES_TO_PLM: Record<SalesStage, string> = {
  lead: "identify",
  qualified: "identify",
  discovery_scheduled: "shape",
  pov_in_flight: "shape",
  proposal_in_flight: "pursue",
  submitted: "pursue",
  verbal_commit: "pursue",
  signed: "won",
  lost_no_decision: "lost",
  withdrawn: "no_go",
};

/** Days-in-stage threshold above which the Forecaster flags a deal stalled. */
export const STALLED_THRESHOLD_DAYS = 21;

export function isSalesStage(v: unknown): v is SalesStage {
  return typeof v === "string" && (SALES_STAGES as readonly string[]).includes(v);
}

export function deriveSalesStage(plmStage: string, probabilityPct: number | null): SalesStage {
  const p = probabilityPct ?? 0;
  if (plmStage === "won") return "signed";
  if (plmStage === "lost") return "lost_no_decision";
  if (plmStage === "no_go") return "withdrawn";
  if (plmStage === "identify") return p < 10 ? "lead" : "qualified";
  if (plmStage === "shape") return p < 30 ? "discovery_scheduled" : "pov_in_flight";
  if (plmStage === "pursue") {
    if (p < 60) return "proposal_in_flight";
    if (p < 75) return "submitted";
    return "verbal_commit";
  }
  return "lead";
}
