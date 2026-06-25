/**
 * Atelier — Sales pipeline constants + helpers (Task #295 / PRD §2.3).
 *
 * Canonical 5-stage funnel + 3 terminals. Replaces the 10-value
 * lifecycle introduced in Task #239. plmStage is still derived
 * (write-time) from salesStage so existing v1 readers keep working.
 *
 *   Working:    suspect → prospect → convert → runner → contract
 *   Terminals:  lost · no_decision · withdrawn
 *
 * `contract` is the kickoff of delivery, not a terminal — once a deal
 * is on paper the engagement takes over. Lost/no_decision/withdrawn
 * are the only stages that *close* the funnel.
 */

export const SALES_STAGES = [
  "suspect",
  "prospect",
  "convert",
  "runner",
  "contract",
  "lost",
  "no_decision",
  "withdrawn",
] as const;

export type SalesStage = (typeof SALES_STAGES)[number];

export const WORKING_STAGES: readonly SalesStage[] = [
  "suspect",
  "prospect",
  "convert",
  "runner",
  "contract",
] as const;

export const TERMINAL_STAGES: readonly SalesStage[] = [
  "lost",
  "no_decision",
  "withdrawn",
] as const;

/**
 * Default win probability used by the Forecaster when no override is set.
 * 5/20/50/80/100 across the working funnel — ramps that match the
 * partner playbook so the weighted-pipeline number is meaningful even
 * when probabilities aren't manually tuned.
 */
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

/** Map a sales stage onto its v1 PLM stage so legacy reads stay valid. */
export const SALES_TO_PLM: Record<SalesStage, string> = {
  suspect: "identify",
  prospect: "shape",
  convert: "pursue",
  runner: "pursue",
  contract: "mobilize",
  lost: "lost",
  no_decision: "no_go",
  withdrawn: "no_go",
};

/** Sub-status taxonomy. UI uses these as the second-level chip per stage. */
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

/** Reason codes required when entering a terminal stage. */
export const TERMINAL_REASON_CODES: Record<
  "lost" | "no_decision" | "withdrawn",
  readonly string[]
> = {
  lost: ["competitor", "price", "fit", "timing", "relationship"],
  no_decision: ["stalled", "deprioritized", "budget_pulled"],
  withdrawn: ["conflict", "capacity", "strategic_fit", "client_request"],
};

/** Days-in-stage threshold above which the Forecaster flags a deal stalled. */
export const STALLED_THRESHOLD_DAYS = 21;

export function isSalesStage(v: unknown): v is SalesStage {
  return typeof v === "string" && (SALES_STAGES as readonly string[]).includes(v);
}

export function isTerminalStage(s: SalesStage): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(s);
}

export function isWorkingStage(s: SalesStage): boolean {
  return (WORKING_STAGES as readonly string[]).includes(s);
}

/**
 * Opportunity-state predicates on the canonical salesStage (Task #654 —
 * plmStage is retired for opportunities; salesStage is the only source of
 * truth). These partition the funnel into open · won · lost:
 *   - "won"  = reached `contract` (signed; the engagement takes over).
 *   - "lost" = any terminal stage (lost · no_decision · withdrawn).
 *   - "open" = a working stage that has not yet reached contract.
 */
export function isWonStage(s: SalesStage): boolean {
  return s === "contract";
}
export function isLostStage(s: SalesStage): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(s);
}
export function isOpenStage(s: SalesStage): boolean {
  return (WORKING_STAGES as readonly string[]).includes(s) && s !== "contract";
}

/**
 * Resolve a stored opportunity stage string to a canonical SalesStage.
 * salesStage is the single source of truth (Task #654); legacy rows may still
 * hold a pre-#295 label there, so migrate those; otherwise default to suspect.
 */
export function resolveSalesStage(stored: string | null | undefined): SalesStage {
  const v = stored ?? "";
  if (isSalesStage(v)) return v;
  return migrateLegacyStage(v)?.stage ?? "suspect";
}

/**
 * Group a canonical SalesStage into the legacy 6-bucket funnel display used by
 * the Home pipeline pane and the CLI "pipeline by stage" view. Keeps those
 * UIs' bucket labels stable while sourcing membership from salesStage.
 */
export const FUNNEL_BUCKET_BY_SALES_STAGE: Record<
  SalesStage,
  "identify" | "shape" | "pursue" | "won" | "lost" | "no_go"
> = {
  suspect: "identify",
  prospect: "shape",
  convert: "pursue",
  runner: "pursue",
  contract: "won",
  lost: "lost",
  no_decision: "no_go",
  withdrawn: "no_go",
};

export function funnelBucket(
  stored: string | null | undefined,
): "identify" | "shape" | "pursue" | "won" | "lost" | "no_go" {
  return FUNNEL_BUCKET_BY_SALES_STAGE[resolveSalesStage(stored)];
}

export function isValidSubStatus(stage: SalesStage, sub: string | null | undefined): boolean {
  if (!sub) return true;
  return (SUB_STATUS_BY_STAGE[stage] as readonly string[]).includes(sub);
}

/**
 * Pure per-transition gate evaluator (Task #295). Mirrors the gates
 * enforced in agentRoutes.ts POST /opportunities/:oppId/stage-transition
 * so the same logic is unit-testable without hitting Express + DB.
 *
 * Returns `null` when the transition passes; otherwise an object with
 * `gate` (machine code) + `reason` (human) + optional `missing` list.
 * `partnerOverride=true` skips every gate except the sub-status
 * taxonomy check (junk strings are never welcome).
 */
export interface StageGateInput {
  fromStage: SalesStage;
  toStage: SalesStage;
  partnerOverride?: boolean;
  /** 5C qualifier blob (suspect→prospect gate). */
  qualify5c?: {
    client?: string;
    competition?: string;
    capability?: string;
    capacity?: string;
    contract?: string;
  } | null;
  /** Go/No-go decision blob (suspect→prospect gate). */
  goNoGoDecision?: { decision: "go" | "no_go" } | null;
  /** Convert→Runner gate. */
  decider?: string | null;
  verbalCommitDate?: string | null;
  signaturePath?: string | null;
  /** Runner→Contract gate. */
  signedInstrumentFileId?: string | null;
  evidenceArtifactIds?: readonly string[] | null;
  /** Terminal gate. */
  reasonCode?: string | null;
  /** Optional sub-status taxonomy check (always enforced). */
  subStatus?: string | null;
}

export interface StageGateError {
  gate: string;
  reason: string;
  missing?: string[];
  allowed?: readonly string[];
}

export function validateStageTransition(input: StageGateInput): StageGateError | null {
  const { fromStage, toStage, partnerOverride } = input;

  // Sub-status taxonomy is enforced even with partner override.
  if (input.subStatus && !isValidSubStatus(toStage, input.subStatus)) {
    return {
      gate: "invalid_sub_status",
      reason: `Sub-status '${input.subStatus}' not in taxonomy for ${toStage}.`,
      allowed: SUB_STATUS_BY_STAGE[toStage],
    };
  }

  if (partnerOverride) return null;

  if (fromStage === "suspect" && toStage === "prospect") {
    const q = input.qualify5c ?? null;
    const filled =
      q &&
      (["client", "competition", "capability", "capacity", "contract"] as const).every(
        (k) => typeof q[k] === "string" && q[k]!.trim().length > 0,
      );
    const decision = input.goNoGoDecision ?? null;
    if (!filled || !decision || decision.decision !== "go") {
      return {
        gate: "suspect_to_prospect_5c",
        reason: "Suspect → Prospect requires a completed 5C qualifier with a Go decision.",
      };
    }
  }

  if (fromStage === "convert" && toStage === "runner") {
    const missing: string[] = [];
    if (!input.decider?.trim()) missing.push("decider");
    if (!input.verbalCommitDate?.trim()) missing.push("verbalCommitDate");
    if (!input.signaturePath?.trim()) missing.push("signaturePath");
    if (missing.length) {
      return {
        gate: "convert_to_runner",
        reason: "Convert → Runner requires a named decider, verbal-commit date, and signature path.",
        missing,
      };
    }
  }

  if (fromStage === "runner" && toStage === "contract") {
    // Task #651 — require the actual signed instrument. A stray evidence
    // artifact must NOT satisfy the contract gate (was: file OR any artifact).
    if (!input.signedInstrumentFileId?.trim()) {
      return {
        gate: "runner_to_contract",
        reason:
          "Runner → Contract requires the signed instrument uploaded as signedInstrumentFileId.",
      };
    }
  }

  if (isTerminalStage(toStage)) {
    const allowed = TERMINAL_REASON_CODES[toStage as "lost" | "no_decision" | "withdrawn"];
    if (!input.reasonCode?.trim() || !allowed.includes(input.reasonCode.trim())) {
      return {
        gate: `terminal_${toStage}`,
        reason: `Entering ${toStage} requires reasonCode ∈ ${allowed.join(", ")}.`,
        allowed,
      };
    }
  }

  return null;
}

/**
 * Sticky timestamp computer for runner_entered_at / contract_signed_at.
 * Pure helper so the auto-fire idempotency invariant ("once set, never
 * overwritten") is unit-testable without DB.
 */
export function computeStickyStageTimestamps(args: {
  toStage: SalesStage;
  now: Date;
  prior: { runnerEnteredAt: Date | null; contractSignedAt: Date | null };
}): { runnerEnteredAt: Date | null; contractSignedAt: Date | null; charterShouldFire: boolean } {
  const runnerEnteredAt =
    args.toStage === "runner" && !args.prior.runnerEnteredAt
      ? args.now
      : args.prior.runnerEnteredAt;
  const contractSignedAt =
    args.toStage === "contract" && !args.prior.contractSignedAt
      ? args.now
      : args.prior.contractSignedAt;
  const charterShouldFire = args.toStage === "contract" && !args.prior.contractSignedAt;
  return { runnerEnteredAt, contractSignedAt, charterShouldFire };
}

/**
 * Map a legacy 10-stage label onto the canonical 5+3. Used by the
 * stage-transition handler when migrating an opportunity that was last
 * touched on the old enum, and by the migration script as a single
 * source of truth for the rollover. Returns `null` for unknown values
 * (caller falls back to deriveSalesStage).
 */
export function migrateLegacyStage(legacy: string): {
  stage: SalesStage;
  subStatus: string | null;
} | null {
  switch (legacy) {
    case "lead":                return { stage: "suspect",  subStatus: "cold" };
    case "qualified":           return { stage: "prospect", subStatus: "qualified" };
    case "discovery_scheduled": return { stage: "prospect", subStatus: "discovery_scheduled" };
    case "pov_in_flight":       return { stage: "convert",  subStatus: "pov_in_flight" };
    case "proposal_in_flight":  return { stage: "convert",  subStatus: "proposal_in_flight" };
    case "submitted":           return { stage: "convert",  subStatus: "submitted" };
    case "verbal_commit":       return { stage: "runner",   subStatus: "verbal" };
    case "signed":              return { stage: "contract", subStatus: "in_flight" };
    case "lost_no_decision":    return { stage: "no_decision", subStatus: null };
    // Already-canonical labels (lost/withdrawn/suspect/prospect/convert/
    // runner/contract/no_decision) are no-ops — caller keeps the row.
    default:                    return null;
  }
}

export function deriveSalesStage(plmStage: string, probabilityPct: number | null): SalesStage {
  const p = probabilityPct ?? 0;
  if (plmStage === "won")      return "contract";
  if (plmStage === "lost")     return "lost";
  if (plmStage === "no_go")    return "withdrawn";
  if (plmStage === "mobilize") return "contract";
  if (plmStage === "deliver")  return "contract";
  if (plmStage === "compound") return "contract";
  if (plmStage === "closed")   return "contract";
  if (plmStage === "identify") return p < 15 ? "suspect" : "prospect";
  if (plmStage === "shape")    return p < 35 ? "prospect" : "convert";
  if (plmStage === "pursue") {
    if (p < 65) return "convert";
    return "runner";
  }
  return "suspect";
}
