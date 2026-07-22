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
import { and, eq, isNull } from "drizzle-orm";
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

type OppRow = typeof atelierOpportunities.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface StageActor {
  id: string;
  name: string;
  orgId: string;
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
  const [updated] = await db
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
    .where(eq(atelierOpportunities.id, opp.id))
    .returning();

  const transitionId = rid("stxn");
  const evidence = (input.evidenceArtifactIds ?? []) as string[];
  await db.insert(atelierOpportunityStageTransitions).values({
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
  await db.insert(atelierAuditEvents).values({
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

  // Contract entry → ensure a linked engagement exists + charter it.
  let firedCharter = false;
  let engagementHookError: string | null = null;
  if (to === "contract" && !opp.contractSignedAt) {
    const hook = await ensureEngagementForContract(updated, actor);
    firedCharter = hook.firedCharter;
    engagementHookError = hook.error;
    // Task #434 — capture the immutable sold-position snapshot at first
    // contract entry. Best-effort: a failure never blocks the stage move
    // (the backfill route can capture it later), but it is logged.
    try {
      const { captureSoldPositionSnapshot } = await import("../atelier-margin-reporting.js");
      await captureSoldPositionSnapshot(updated, { id: actor.id, name: actor.name }, "contract_stage");
    } catch (err) {
      console.warn("[atelier] sold-position snapshot capture failed (non-blocking)", err);
    }
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
