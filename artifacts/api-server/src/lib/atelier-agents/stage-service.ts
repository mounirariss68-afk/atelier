/**
 * Atelier — shared opportunity stage-transition service (Task #651).
 *
 * Single source of truth for moving an opportunity between sales stages.
 * Every write path (the gated REST route, the legacy PATCH /stage route,
 * and the chat/CLI `opportunity_move_stage` tool — and therefore
 * propose_write's `transition` verb) calls `applyStageTransition` so the
 * Task #295 gates, all derived-field writes (plmStage, probability default,
 * sub-status, sticky timestamps, finalPlmStage, daysInStage reset), the
 * transition + audit rows, and the Contract / closed-deal side-effects are
 * applied identically no matter who triggers the move. This is what stops
 * `sales_stage` and the legacy `plm_stage` from drifting apart.
 *
 * `evaluate_gate` stays a read-only preview; enforcement now lives at the
 * mutation, not in whether the model remembered to call the preview.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierOpportunities,
  atelierOpportunityStageTransitions,
  atelierAuditEvents,
  atelierAccounts,
  atelierEngagements,
  atelierCharterVersions,
  atelierPaneAItems,
  atelierWinLossDebriefs,
  atelierDealPricings,
  atelierCounterparty,
  atelierContract,
  atelierBillingRule,
  atelierSoldPositionSnapshot,
  atelierEngagementBudget,
  atelierEngagementEtc,
} from "@workspace/db";
import {
  SALES_TO_PLM,
  SALES_STAGE_DEFAULT_PROB,
  computeStickyStageTimestamps,
  deriveSalesStage,
  isSalesStage,
  isTerminalStage,
  migrateLegacyStage,
  validateStageTransition,
  type SalesStage,
  type StageGateError,
} from "./pipeline.js";
import { runCharterArchitect } from "./runner.js";
import { ensureAssignmentGrant } from "../atelier-access-autogrant.js";
import { mirrorEntityEmbedding } from "../atelier-cli/entity-resolver.js";
import {
  simulateStructure,
  buildBillingHandoff,
  normalizeStructureKind,
  normalizeCostLines,
  type StructureSimulation,
} from "../atelier-pricing-structures.js";
import type { MarginPolicy, RateCardRowLite } from "../atelier-pricing.js";

type OppRow = typeof atelierOpportunities.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface StageActor {
  id: string;
  name: string;
  orgId: string;
  role?: string;
}

export interface ApplyStageTransitionInput {
  toStage: SalesStage;
  rationaleText: string;
  evidenceArtifactIds?: readonly string[] | null;
  newProbabilityPct?: number | null;
  nextMilestone?: string | null;
  nextMilestoneDate?: string | null;
  partnerOverride?: boolean;
  subStatus?: string | null;
  /** Convert→Runner gate evidence. */
  decider?: string | null;
  verbalCommitDate?: string | null;
  signaturePath?: string | null;
  /** Runner→Contract gate evidence. */
  signedInstrumentFileId?: string | null;
  /** Terminal gate. */
  reasonCode?: string | null;
  agentRecommended?: boolean;
  /** Free-text source tag for the audit row (e.g. "rest", "legacy", "cli"). */
  source?: string;
}

export interface StageTransitionWire {
  id: string;
  opportunityId: string;
  fromStage: SalesStage;
  toStage: string;
  transitionedByUserId: string;
  transitionedByName: string;
  rationaleText: string;
  evidenceArtifactIds: string[];
  priorProbabilityPct: number;
  newProbabilityPct: number;
  nextMilestone: string | null;
  nextMilestoneDate: string | null;
  agentRecommended: boolean;
  partnerOverride: boolean;
  createdAt: string;
}

export type ApplyStageTransitionResult =
  | { ok: false; status: number; error: string; gate?: StageGateError }
  | {
      ok: true;
      opportunity: OppRow;
      transition: StageTransitionWire;
      firedCharter: boolean;
      // Task #8 — when the contract-entry engagement auto-create/charter
      // hook fails, the stage move still succeeds but the failure is
      // surfaced here (and in an audit event) instead of being swallowed.
      engagementHookError: string | null;
    };

/** Resolve the canonical from-stage for a row that may still carry a legacy label. */
export function canonicalFromStage(opp: OppRow): {
  fromStage: SalesStage;
  legacyStageLabel: string | null;
} {
  const rawFromStage = isSalesStage(opp.salesStage)
    ? (opp.salesStage as SalesStage)
    : ("suspect" as SalesStage);
  const legacyMapped = migrateLegacyStage(opp.salesStage as string);
  return {
    fromStage: legacyMapped?.stage ?? rawFromStage,
    legacyStageLabel: legacyMapped ? (opp.salesStage as string) : null,
  };
}

/**
 * Apply a stage transition to a loaded opportunity. Returns a discriminated
 * result; callers map `ok:false` onto their transport (HTTP status / CLI deny).
 */
export async function applyStageTransition(
  opp: OppRow,
  input: ApplyStageTransitionInput,
  actor: StageActor,
): Promise<ApplyStageTransitionResult> {
  const { fromStage, legacyStageLabel } = canonicalFromStage(opp);
  const to = input.toStage;
  if (
    input.partnerOverride &&
    actor.role !== "partner" &&
    actor.role !== "founding_partner"
  ) {
    return { ok: false, status: 403, error: "partner-override-forbidden" };
  }
  if (
    to === "contract" &&
    fromStage !== "contract" &&
    !input.signedInstrumentFileId?.trim()
  ) {
    return { ok: false, status: 412, error: "contract-signed-instrument-required" };
  }

  // ---- Per-transition gates (Task #295) — enforced at the mutation. -------
  const gateError = validateStageTransition({
    fromStage,
    toStage: to,
    partnerOverride: !!input.partnerOverride,
    qualify5c: opp.qualify5c ?? null,
    goNoGoDecision: opp.goNoGoDecision ?? null,
    decider: input.decider,
    verbalCommitDate: input.verbalCommitDate,
    signaturePath: input.signaturePath,
    signedInstrumentFileId: input.signedInstrumentFileId,
    evidenceArtifactIds: input.evidenceArtifactIds ?? [],
    reasonCode: input.reasonCode,
    subStatus: input.subStatus,
  });
  if (gateError) {
    const status = gateError.gate === "invalid_sub_status" ? 400 : 412;
    return { ok: false, status, error: "stage-gate-failed", gate: gateError };
  }

  // ---- Task #652 — won-lifecycle reverse enforcement. ----------------------
  // An opportunity that already has a live (non-deleted) engagement is
  // "engaged" and may only sit at `contract`. Block any move that would leave
  // it in a pre-contract working stage or a terminal stage, otherwise the
  // engagement is orphaned from a non-won opp — the exact contradiction the
  // handoff invariant forbids. Structural integrity: not bypassable by partner
  // override (close or unlink the engagement first). Idempotent contract
  // re-entry (to === "contract") is always allowed.
  if (to !== "contract") {
    const [linkedEng] = await db
      .select({ id: atelierEngagements.id, name: atelierEngagements.name })
      .from(atelierEngagements)
      .where(
        and(eq(atelierEngagements.opportunityId, opp.id), isNull(atelierEngagements.deletedAt)),
      )
      .limit(1);
    if (linkedEng) {
      return {
        ok: false,
        status: 409,
        error: "engaged-opp-locked",
        gate: {
          gate: "engaged_opp_locked",
          reason: `Opportunity "${opp.name}" has a live engagement ("${linkedEng.name}"); close or unlink that engagement before moving the opportunity out of Contract.`,
        },
      };
    }
  }

  // ---- Task #653 — advance hygiene gate. -----------------------------------
  // Moving an opportunity *forward* through the working pipeline requires the
  // basics every forecast depends on: a concrete next step and a positive deal
  // size. This is a data-quality invariant (not a qualification judgement), so
  // it is NOT bypassable by partner override. Terminal moves (lost /
  // no_decision / withdrawn) and lateral / backward moves are exempt.
  const WORKING_ORDER: Record<string, number> = {
    suspect: 0,
    prospect: 1,
    convert: 2,
    runner: 3,
    contract: 4,
  };
  const fromOrder = WORKING_ORDER[fromStage];
  const toOrder = WORKING_ORDER[to];
  const isForwardAdvance =
    fromOrder !== undefined && toOrder !== undefined && toOrder > fromOrder;
  if (isForwardAdvance) {
    const effectiveNextMilestone = (input.nextMilestone ?? opp.nextMilestone ?? "").trim();
    if (!effectiveNextMilestone) {
      return {
        ok: false,
        status: 422,
        error: "next-step-required",
        gate: {
          gate: "advance_requires_next_step",
          reason: `A concrete next step is required before advancing "${opp.name}" to ${to}.`,
        },
      };
    }
    if (!(opp.dealSizeHypothesis > 0)) {
      return {
        ok: false,
        status: 422,
        error: "deal-size-required",
        gate: {
          gate: "advance_requires_amount",
          reason: `A deal size greater than zero is required before advancing "${opp.name}" to ${to}.`,
        },
      };
    }
  }

  // Commercial handoff is deliberately before the stage write.  A Contract
  // transition must never leave a won opportunity without its pricing
  // baseline and downstream records.
  const priorProb = opp.probabilityPct;
  const newProb =
    typeof input.newProbabilityPct === "number" && input.newProbabilityPct !== null
      ? input.newProbabilityPct
      : SALES_STAGE_DEFAULT_PROB[to];
  const now = new Date();

  const sticky = computeStickyStageTimestamps({
    toStage: to,
    now,
    prior: {
      runnerEnteredAt: opp.runnerEnteredAt ?? null,
      contractSignedAt: opp.contractSignedAt ?? null,
    },
  });
  let updated: OppRow = opp;
  let transitionId = "";
  const evidence = (input.evidenceArtifactIds ?? []) as string[];
  try {
    await db.transaction(async (tx) => {
      if (to === "contract" && fromStage !== "contract") {
        const handoff = await handoffCommercialBaseline(opp, actor, tx, input.signedInstrumentFileId);
        if (!handoff.ok) throw new HandoffAbort(handoff.status, handoff.error);
      }
      [updated] = await tx
        .update(atelierOpportunities)
        .set({
      salesStage: to,
      probabilityPct: newProb,
      subStatus: input.subStatus ?? opp.subStatus,
      runnerEnteredAt: sticky.runnerEnteredAt,
      contractSignedAt: sticky.contractSignedAt,
      nextMilestone: input.nextMilestone ?? opp.nextMilestone,
      nextMilestoneDate: input.nextMilestoneDate ?? opp.nextMilestoneDate,
      daysInStage: 0,
      updatedAt: now,
        })
        .where(
          and(
            eq(atelierOpportunities.id, opp.id),
            eq(atelierOpportunities.orgId, actor.orgId),
            eq(atelierOpportunities.salesStage, opp.salesStage),
          ),
        )
        .returning();
      if (!updated) throw new HandoffAbort(409, "concurrent-stage-transition");

      transitionId = rid("stxn");
      await tx.insert(atelierOpportunityStageTransitions).values({
    id: transitionId,
    opportunityId: opp.id,
    fromStage,
    toStage: to,
    transitionedByUserId: actor.id,
    rationaleText: input.rationaleText.trim(),
    evidenceArtifactIds: evidence,
    priorProbabilityPct: priorProb,
    newProbabilityPct: newProb,
    nextMilestone: input.nextMilestone ?? null,
    nextMilestoneDate: input.nextMilestoneDate ?? null,
    agentRecommended: !!input.agentRecommended,
    partnerOverride: !!input.partnerOverride,
    legacyStageLabel,
    decider: input.decider ?? null,
    verbalCommitDate: input.verbalCommitDate ?? null,
    signaturePath: input.signaturePath ?? null,
    signedInstrumentFileId: input.signedInstrumentFileId ?? null,
    reasonCode: input.reasonCode ?? null,
      });
      await tx.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: opp.id,
    actorType: "human",
    actorId: actor.id,
    actorLabel: actor.name,
    action: "opportunity.stage_transition",
    payload: {
      from: fromStage,
      to,
      priorProb,
      newProb,
      partnerOverride: !!input.partnerOverride,
      evidenceCount: evidence.length,
      source: input.source ?? "rest",
    },
    payloadSummary: `${actor.name} moved "${opp.name}" ${fromStage} → ${to} (prob ${priorProb}% → ${newProb}%): ${input.rationaleText.slice(0, 120)}`,
      });
    });
  } catch (error) {
    if (error instanceof HandoffAbort) return { ok: false, status: error.status, error: error.message };
    throw error;
  }

  // Contract entry → ensure a linked engagement exists + charter it.
  let firedCharter = false;
  let engagementHookError: string | null = null;
  if (to === "contract" && !opp.contractSignedAt) {
    const hook = await ensureEngagementForContract(updated, actor);
    firedCharter = hook.firedCharter;
    engagementHookError = hook.error;
  }

  // Closed-deal Win/Loss debrief enqueue (contract is the working "won").
  const CLOSED_STAGES: SalesStage[] = ["contract", "lost", "no_decision", "withdrawn"];
  if (CLOSED_STAGES.includes(to)) {
    await enqueueWinLossDebrief(updated, to, actor);
  }

  return {
    ok: true,
    opportunity: updated,
    firedCharter,
    engagementHookError,
    transition: {
      id: transitionId,
      opportunityId: opp.id,
      fromStage,
      toStage: to,
      transitionedByUserId: actor.id,
      transitionedByName: actor.name,
      rationaleText: input.rationaleText.trim(),
      evidenceArtifactIds: evidence,
      priorProbabilityPct: priorProb,
      newProbabilityPct: newProb,
      nextMilestone: input.nextMilestone ?? null,
      nextMilestoneDate: input.nextMilestoneDate ?? null,
      agentRecommended: !!input.agentRecommended,
      partnerOverride: !!input.partnerOverride,
      createdAt: now.toISOString(),
    },
  };
}

type HandoffResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Atomically materialise the commercial baseline. IDs and unique constraints
 * make retries and concurrent stage writers converge on the same four rows.
 * This intentionally does not touch staffing, realization, or delivery data.
 */
export async function handoffCommercialBaseline(
  opp: OppRow,
  actor: StageActor,
  executor?: any,
  signedInstrumentFileId?: string | null,
): Promise<HandoffResult> {
  if (actor.orgId !== opp.orgId) {
    return { ok: false, status: 403, error: "cross-tenant-stage-transition" };
  }
  if (!signedInstrumentFileId?.trim()) {
    return { ok: false, status: 412, error: "contract-signed-instrument-required" };
  }
  const q = executor ?? db;

  try {
    const run = async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`commercial:${opp.orgId}:${opp.id}`}))`);
      const [pricing] = await tx
        .select()
        .from(atelierDealPricings)
        .where(
          and(
            eq(atelierDealPricings.orgId, opp.orgId),
            eq(atelierDealPricings.opportunityId, opp.id),
            isNull(atelierDealPricings.deletedAt),
          ),
        )
        .limit(1);
      if (!pricing || !(Number(pricing.computedPriceUsd) > 0)) {
        throw new HandoffAbort(412, "contract-pricing-required");
      }
      const target = Number(pricing.targetMarginPct);
      const sim = pricing.structureSim as unknown as
        | (StructureSimulation & {
            pricingBasis?: {
              rateCardId?: string;
              currency?: string;
              rateCardRows?: unknown[];
              policy?: Record<string, number>;
            };
          })
        | null;
      if (
        !sim ||
        !sim.pricingBasis ||
        sim.pricingBasis.rateCardId !== pricing.rateCardId ||
        !Array.isArray(sim.pricingBasis.rateCardRows) ||
        sim.pricingBasis.rateCardRows.length === 0 ||
        !sim.pricingBasis.policy
      ) {
        throw new HandoffAbort(412, "contract-pricing-basis-required");
      }
      const recomputedSim = simulateStructure({
        kind: normalizeStructureKind(pricing.pricingModel),
        params: pricing.structureParams as Record<string, unknown> | null,
        teamMix: pricing.teamMix ?? [],
        durationWeeks: Number(pricing.durationWeeks),
        rateCardRows: sim.pricingBasis.rateCardRows as RateCardRowLite[],
        policy: sim.pricingBasis.policy as unknown as MarginPolicy,
        costLines: normalizeCostLines(pricing.costLines ?? []),
      });
      if (
        canonicalJson(recomputedSim.scenarios) !== canonicalJson(sim.scenarios) ||
        recomputedSim.riskAdjustedMarginPct !== sim.riskAdjustedMarginPct ||
        recomputedSim.marginLockStatus !== sim.marginLockStatus
      ) {
        throw new HandoffAbort(412, "contract-pricing-basis-mismatch");
      }
      if (!(sim.scenarios.expected.revenueUsd > 0)) {
        throw new HandoffAbort(412, "contract-pricing-required");
      }
      const margin = sim.riskAdjustedMarginPct;
      if (sim.partnerOverrideRequired && !pricing.partnerOverrideId) {
        throw new HandoffAbort(412, "contract-margin-approval-required");
      }
      if (sim.twoPartnerRequired && !pricing.countersignPartnerId) {
        throw new HandoffAbort(412, "contract-countersign-required");
      }

      const [account] = await tx.select({ name: atelierAccounts.name })
        .from(atelierAccounts)
        .where(and(eq(atelierAccounts.orgId, opp.orgId), eq(atelierAccounts.id, opp.accountId))).limit(1);
      if (!account) throw new HandoffAbort(412, "contract-account-required");
      let [counterparty] = await tx
        .select()
        .from(atelierCounterparty)
        .where(
          and(
            eq(atelierCounterparty.orgId, opp.orgId),
            eq(atelierCounterparty.accountId, opp.accountId),
            isNull(atelierCounterparty.deletedAt),
          ),
        )
        .limit(1);
      if (!counterparty) {
        const [created] = await tx
          .insert(atelierCounterparty)
          .values({
            id: `cp_${opp.accountId}`,
            orgId: opp.orgId,
            kind: "client",
            legalName: account.name,
            displayName: account.name,
            accountId: opp.accountId,
            jurisdiction: "",
          })
          .onConflictDoNothing({ target: atelierCounterparty.id })
          .returning();
        counterparty = created;
      }
      if (!counterparty) throw new Error("commercial-counterparty-create-failed");

      const engagements = await tx.select()
        .from(atelierEngagements)
        .where(and(eq(atelierEngagements.orgId, opp.orgId), eq(atelierEngagements.opportunityId, opp.id), isNull(atelierEngagements.deletedAt)))
        .limit(2);
      if (engagements.length > 1) throw new HandoffAbort(409, "multiple-live-engagements-for-opportunity");
      let eng = engagements[0];
      if (!eng) {
        const startDate = new Date().toISOString().slice(0, 10);
        const [created] = await tx
          .insert(atelierEngagements)
          .values({
            id: `eng_${opp.id}`,
            orgId: opp.orgId,
            slug: `${opp.slug}-delivery`.slice(0, 60),
            name: `${opp.name} — delivery`,
            opportunityId: opp.id,
            accountId: opp.accountId,
            plmStage: "mobilize",
            partnerOwnerId: opp.partnerOwnerId,
            engagementLeadId: opp.engagementLeadId,
            startDate,
            plannedEndDate: new Date(Date.now() + Math.max(1, Number(pricing.durationWeeks)) * 7 * 86400000)
              .toISOString()
              .slice(0, 10),
          })
          .onConflictDoNothing({ target: atelierEngagements.id })
          .returning();
        eng = created;
      }
      if (!eng) throw new Error("commercial-engagement-create-failed");

      const startDate = eng.startDate;
      const billing = buildBillingHandoff({ kind: sim.kind, sim, startDate });
      const billingConfig = JSON.parse(JSON.stringify(billing.config));
      const currency = sim.pricingBasis.currency ?? "USD";

      const contracts = await tx
        .select()
        .from(atelierContract)
        .where(
          and(
            eq(atelierContract.orgId, opp.orgId),
            eq(atelierContract.opportunityId, opp.id),
            isNull(atelierContract.deletedAt),
          ),
        )
        .limit(2);
      if (contracts.length > 1) throw new HandoffAbort(409, "multiple-live-contracts-for-opportunity");
      let contract = contracts[0];
      if (!contract) {
        const [created] = await tx
          .insert(atelierContract)
          .values({
            id: `contract_${opp.id}`,
            orgId: opp.orgId,
            instrumentType: "sow",
            counterpartyId: counterparty.id,
            engagementId: eng.id,
            opportunityId: opp.id,
            title: `${opp.name} — statement of work`,
            status: "active",
            currency,
            contractValue: sim.scenarios.expected.revenueUsd,
            contractValueUsd: sim.scenarios.expected.revenueUsd,
            termStart: startDate,
            termEnd: eng.plannedEndDate,
            paymentTermsDays: sim.assumptions.paymentTermsDays,
            fullyExecutedAt: new Date(),
            metadata: {
              handoff: "commercial_baseline",
              pricingId: pricing.id,
              signedInstrumentFileId: signedInstrumentFileId ?? null,
            },
          })
          .onConflictDoNothing({ target: atelierContract.id })
          .returning();
        contract = created;
      }
      if (!contract) throw new Error("commercial-contract-create-failed");
      if (
        contract.status !== "active" ||
        contract.engagementId !== eng.id ||
        contract.counterpartyId !== counterparty.id ||
        contract.currency !== currency ||
        contract.contractValue !== sim.scenarios.expected.revenueUsd ||
        contract.paymentTermsDays !== sim.assumptions.paymentTermsDays ||
        (contract.metadata as Record<string, unknown> | null)?.pricingId !== pricing.id ||
        (contract.metadata as Record<string, unknown> | null)?.signedInstrumentFileId !==
          (signedInstrumentFileId ?? null) ||
        contract.instrumentType !== "sow" ||
        !contract.fullyExecutedAt ||
        contract.contractValueUsd !== sim.scenarios.expected.revenueUsd ||
        contract.termStart !== eng.startDate ||
        contract.termEnd !== eng.plannedEndDate
      ) {
        throw new HandoffAbort(409, "existing-contract-does-not-match-commercial-baseline");
      }

      const billingRuleId = `bill_${eng.id}_baseline`;
      const [insertedRule] = await tx
        .insert(atelierBillingRule)
        .values({
          id: billingRuleId,
          orgId: opp.orgId,
          engagementId: eng.id,
          accountId: opp.accountId,
          ruleType: billing.ruleType,
          currency,
          paymentTermsDays: sim.assumptions.paymentTermsDays,
          legalEntityId: eng.legalEntityId,
          config: billingConfig,
          notes: `${billing.notes} (commercial baseline for ${opp.id})`,
          createdByUserId: actor.id,
        })
        .onConflictDoNothing({ target: atelierBillingRule.id })
        .returning();
      const [billingRule] = insertedRule
        ? [insertedRule]
        : await tx
            .select()
            .from(atelierBillingRule)
            .where(and(eq(atelierBillingRule.id, billingRuleId), eq(atelierBillingRule.orgId, opp.orgId)))
            .limit(1);
      if (
        !billingRule ||
        billingRule.engagementId !== eng.id ||
        billingRule.accountId !== opp.accountId ||
        billingRule.legalEntityId !== eng.legalEntityId ||
        billingRule.ruleType !== billing.ruleType ||
        billingRule.currency !== currency ||
        billingRule.paymentTermsDays !== sim.assumptions.paymentTermsDays ||
        canonicalJson(billingRule.config) !== canonicalJson(billingConfig)
      ) {
        throw new HandoffAbort(409, "existing-billing-rule-does-not-match-commercial-baseline");
      }

      const snapshotId = `sold_${opp.id}`;
      const teamMix = (pricing.teamMix ?? []) as Array<{
        seniority: string;
        role?: string;
        ftePct: number;
      }>;
      const durationWeeks = Number(pricing.durationWeeks);
      const soldHours = teamMix.reduce(
        (sum: number, row) => sum + Number(row.ftePct || 0) * durationWeeks * 40,
        0,
      );
      const [insertedSnapshot] = await tx.insert(atelierSoldPositionSnapshot).values({
        id: snapshotId, orgId: opp.orgId, opportunityId: opp.id,
        engagementId: eng.id, accountId: opp.accountId,
        partnerOwnerId: opp.partnerOwnerId, source: "contract_stage",
        hasPricing: true, pricingModel: pricing.pricingModel,
        rateCardId: pricing.rateCardId, durationWeeks, teamMix, soldHours,
        soldPriceUsd: sim.scenarios.expected.revenueUsd,
        soldCostUsd: sim.scenarios.expected.costUsd,
        soldMarginAmountUsd: sim.scenarios.expected.revenueUsd - sim.scenarios.expected.costUsd,
        soldMarginPct: sim.scenarios.expected.marginPct, targetMarginPct: target,
        soldEffectiveRateUsd: soldHours > 0 ? sim.scenarios.expected.revenueUsd / soldHours : 0,
        currency,
        pricingInputs: {
          rateCardId: pricing.rateCardId,
          pricingModel: pricing.pricingModel,
          durationWeeks,
          teamMix,
          structureParams: pricing.structureParams,
          costLines: normalizeCostLines(pricing.costLines ?? []),
        },
        pricingResults: { computedCostUsd: sim.scenarios.expected.costUsd, computedPriceUsd: sim.scenarios.expected.revenueUsd, computedMarginPct: sim.scenarios.expected.marginPct, riskAdjustedMarginPct: sim.riskAdjustedMarginPct, marginLockStatus: sim.marginLockStatus, structureSim: sim },
        pricingProvenance: {
          pricingId: pricing.id,
          capturedBy: actor.id,
          capturedAt: new Date().toISOString(),
          source: "saved_deal_pricing",
          signedInstrumentFileId: signedInstrumentFileId ?? null,
          contractId: contract.id,
          engagementId: eng.id,
          billingRuleId,
          approvals: {
            partnerOverrideId: pricing.partnerOverrideId,
            partnerOverrideAt: pricing.partnerOverrideAt?.toISOString() ?? null,
            partnerOverrideRationale: pricing.partnerOverrideRationale,
            countersignPartnerId: pricing.countersignPartnerId,
            countersignAt: pricing.countersignAt?.toISOString() ?? null,
            countersignRationale: pricing.countersignRationale,
          },
        },
        createdByUserId: actor.id,
      }).onConflictDoNothing({ target: atelierSoldPositionSnapshot.id }).returning();
      const [snapshot] = insertedSnapshot
        ? [insertedSnapshot]
        : await tx
            .select()
            .from(atelierSoldPositionSnapshot)
            .where(
              and(
                eq(atelierSoldPositionSnapshot.id, snapshotId),
                eq(atelierSoldPositionSnapshot.orgId, opp.orgId),
              ),
            )
            .limit(1);
      const provenance = snapshot?.pricingProvenance as Record<string, unknown> | null;
      if (
        !snapshot ||
        provenance?.pricingId !== pricing.id ||
        provenance?.contractId !== contract.id ||
        provenance?.engagementId !== eng.id ||
        provenance?.billingRuleId !== billingRuleId
      ) {
        throw new HandoffAbort(409, "existing-snapshot-does-not-match-commercial-baseline");
      }

      // The sold snapshot is the immutable original position; the engagement
      // budget is the mutable operational baseline that later posted change
      // orders rebaseline. Create both in the same commercial handoff so a won
      // deal cannot be mobilized without an EAC/P&L starting point.
      const baselineAt = snapshot.capturedAt.toISOString();
      const budgetSubsUsd = sim.costStack.lines
        .filter((line) => !line.passThrough && line.type === "alliance_partner_quote")
        .reduce((sum, line) => sum + Number(line.totalUsd || 0), 0);
      const budgetExpensesUsd = Math.max(
        0,
        Number(sim.costStack.absorbedNonLaborUsd || 0) - budgetSubsUsd,
      );
      const [insertedBudget] = await tx
        .insert(atelierEngagementBudget)
        .values({
          engagementId: eng.id,
          orgId: opp.orgId,
          contractValueUsd: Number(snapshot.soldPriceUsd),
          budgetLabourHours: Number(snapshot.soldHours),
          budgetLabourCostUsd: Number(sim.costStack.laborCostUsd || 0),
          budgetExpensesUsd,
          budgetSubsUsd,
          budgetAtCompletionUsd: Number(snapshot.soldCostUsd),
          baselinedAt: baselineAt,
          partnerOwnerId: opp.partnerOwnerId ?? "",
          engagementLeadId: opp.engagementLeadId ?? "",
          sector: "",
        })
        .onConflictDoNothing({ target: atelierEngagementBudget.engagementId })
        .returning();
      const [budget] = insertedBudget
        ? [insertedBudget]
        : await tx
            .select()
            .from(atelierEngagementBudget)
            .where(
              and(
                eq(atelierEngagementBudget.engagementId, eng.id),
                eq(atelierEngagementBudget.orgId, opp.orgId),
              ),
            )
            .limit(1);
      if (
        !budget ||
        budget.contractValueUsd !== Number(snapshot.soldPriceUsd) ||
        budget.budgetLabourHours !== Number(snapshot.soldHours) ||
        budget.budgetAtCompletionUsd !== Number(snapshot.soldCostUsd)
      ) {
        throw new HandoffAbort(409, "existing-engagement-budget-does-not-match-commercial-baseline");
      }
      await tx
        .insert(atelierEngagementEtc)
        .values({
          engagementId: eng.id,
          orgId: opp.orgId,
          method: "extrapolation",
          manualEtcUsd: null,
          rationale: "Initial estimate from the signed commercial baseline.",
          updatedAtIso: baselineAt,
          updatedByUserId: actor.id,
        })
        .onConflictDoNothing({ target: atelierEngagementEtc.engagementId });

      await tx.update(atelierDealPricings).set({ billingRuleId, billingHandoffAt: new Date() })
        .where(eq(atelierDealPricings.id, pricing.id));
    };
    if (executor) await run(q);
    else await db.transaction(run);
    return { ok: true };
  } catch (error) {
    if (error instanceof HandoffAbort) return { ok: false, status: error.status, error: error.message };
    return { ok: false, status: 409, error: error instanceof Error ? error.message : "commercial-handoff-failed" };
  }
}

class HandoffAbort extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Task #652 — won-lifecycle forward enforcement. When an opportunity reaches
 * `contract`, an engagement MUST exist for it. If one is already linked we
 * just charter it (idempotent); if none exists we auto-create + link a
 * mobilizing engagement and then run the Charter Architect. Best-effort:
 * never throws back into the stage move. Returns whether a charter fired.
 */
export async function ensureEngagementForContract(
  opp: OppRow,
  actor: StageActor,
): Promise<{ firedCharter: boolean; error: string | null }> {
  try {
    let [eng] = await db
      .select({ id: atelierEngagements.id, name: atelierEngagements.name })
      .from(atelierEngagements)
      .where(
        and(eq(atelierEngagements.opportunityId, opp.id), isNull(atelierEngagements.deletedAt)),
      )
      .limit(1);

    const [acct] = await db
      .select({ name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(eq(atelierAccounts.id, opp.accountId))
      .limit(1);

    if (!eng) {
      const start = new Date();
      const plannedEnd = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
      const engId = rid("eng");
      // Task #654 — legalEntityId intentionally starts null here: an
      // auto-created engagement has no invoice history yet. It is set
      // explicitly via PATCH or by the boot backfill once invoices exist.
      const slug = `${opp.slug}-delivery`.slice(0, 60);
      const [created] = await db
        .insert(atelierEngagements)
        .values({
          id: engId,
          orgId: opp.orgId,
          slug,
          name: `${opp.name} — delivery`,
          opportunityId: opp.id,
          accountId: opp.accountId,
          plmStage: "mobilize",
          partnerOwnerId: opp.partnerOwnerId,
          engagementLeadId: opp.engagementLeadId,
          startDate: start.toISOString().slice(0, 10),
          plannedEndDate: plannedEnd.toISOString().slice(0, 10),
        })
        .returning({ id: atelierEngagements.id, name: atelierEngagements.name });
      eng = created;
      // Mirror into the semantic index so the AI resolver can find this
      // engagement immediately on subsequent turns — matching the label
      // composition used by the backfill script (name only, no summary).
      void mirrorEntityEmbedding(opp.orgId, "engagement", eng.id, eng.name);
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "engagement",
        entityId: eng.id,
        actorType: "system",
        actorId: "stage-transition-hook",
        actorLabel: "Atelier",
        action: "engagement.auto_created",
        payload: { opportunityId: opp.id, accountId: opp.accountId },
        payloadSummary: `Atelier opened engagement "${eng.name}" automatically when ${opp.name} reached Contract.`,
      });
      // Task #509 — assignment auto-grants: the opportunity's lead/owner must
      // be able to see the engagement they were assigned to. The helper skips
      // firm-wide roles (founding_partner/partner) and is idempotent.
      if (opp.engagementLeadId) {
        await ensureAssignmentGrant({
          userId: opp.engagementLeadId,
          engagementId: eng.id,
          roleOnEngagement: "lead",
          actor: null,
          reason: "engagement-auto-created-lead",
        });
      }
      if (opp.partnerOwnerId && opp.partnerOwnerId !== opp.engagementLeadId) {
        await ensureAssignmentGrant({
          userId: opp.partnerOwnerId,
          engagementId: eng.id,
          roleOnEngagement: "member",
          actor: null,
          reason: "engagement-auto-created-owner",
        });
      }
    }

    const [existingCharter] = await db
      .select({ id: atelierCharterVersions.id })
      .from(atelierCharterVersions)
      .where(eq(atelierCharterVersions.engagementId, eng.id))
      .limit(1);
    if (existingCharter) return { firedCharter: false, error: null };

    await runCharterArchitect({
      engagementId: eng.id,
      engagementName: eng.name,
      accountName: acct?.name ?? opp.accountId,
      wonProposalSummary: `${opp.name} — auto-fired on Contract entry. Re-derive from won-proposal artifacts and seeded context.`,
      kickoffTranscriptExcerpt: null,
      triggeredByUserId: actor.id,
      actorLabel: "Charter Architect",
    });
    return { firedCharter: true, error: null };
  } catch (err) {
    // Task #8 — the failure must never block the stage move, but it must be
    // surfaced: audit row for the ops trail + error string for the caller,
    // never a silent success.
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[atelier] engagement auto-create/charter failed (non-blocking)", err);
    try {
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "opportunity",
        entityId: opp.id,
        actorType: "system",
        actorId: "stage-transition-hook",
        actorLabel: "Atelier",
        action: "engagement.auto_create_failed",
        payload: { opportunityId: opp.id, accountId: opp.accountId, error: message },
        payloadSummary: `Automatic delivery-engagement setup failed for "${opp.name}" on Contract entry: ${message.slice(0, 160)}`,
      });
    } catch (auditErr) {
      console.warn("[atelier] failed to record engagement auto-create failure", auditErr);
    }
    return { firedCharter: false, error: message };
  }
}

async function enqueueWinLossDebrief(
  opp: OppRow,
  to: SalesStage,
  actor: StageActor,
): Promise<void> {
  try {
    const existing = await db
      .select({ id: atelierWinLossDebriefs.id })
      .from(atelierWinLossDebriefs)
      .where(
        and(
          eq(atelierWinLossDebriefs.opportunityId, opp.id),
          isNull(atelierWinLossDebriefs.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length) return;
    const debriefId = rid("wld");
    const dueAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(atelierWinLossDebriefs).values({
      id: debriefId,
      orgId: actor.orgId,
      opportunityId: opp.id,
      outcome: to,
      status: "pending",
      sellerPerceivedReasons: [],
      partnerOwnerUserId: opp.partnerOwnerId,
      engagementLeadUserId: opp.engagementLeadId,
      dueAt,
      createdByUserId: actor.id,
    });
    await db.insert(atelierPaneAItems).values({
      id: rid("pane"),
      orgId: actor.orgId,
      userId: opp.partnerOwnerId,
      priority: to === "contract" ? "medium" : "high",
      title: `Win/Loss debrief due — ${opp.name}`,
      summary: `${opp.name} closed as ${to.replace(/_/g, " ")}. Capture seller view, schedule buyer interview within 14 days.`,
      hrefKind: "opportunity",
      hrefTargetId: opp.id,
      dueLabel: "14 days",
      sortKey: to === "contract" ? 50 : 20,
    });
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "opportunity",
      entityId: opp.id,
      actorType: "system",
      actorId: "stage-transition-hook",
      actorLabel: "Atelier",
      action: "winloss.debrief_enqueued",
      payload: { debriefId, outcome: to, dueAt: dueAt.toISOString() },
      payloadSummary: `Atelier enqueued Win/Loss debrief for ${opp.name} (due in 14 days)`,
    });
  } catch (err) {
    console.warn("[atelier] winloss debrief enqueue failed (non-blocking)", err);
  }
}
