/**
 * Atelier — agent + opportunity write routes (Task #221).
 *
 * - opportunity create / stage / qualifier
 * - Pursuit Scout brief
 * - Research facts (list + promote)
 * - POV (start, draft, versions)
 * - Meetings (list + scribe submit)
 * - agent runs (get + decision)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, inArray, ilike, sql } from "drizzle-orm";
import {
  db,
  atelierOpportunities,
  atelierAccounts,
  atelierUsers,
  atelierAuditEvents,
  atelierAgentRuns,
  atelierBriefs,
  atelierResearchFacts,
  atelierPovs,
  atelierPovVersions,
  atelierMeetings,
  atelierTranscripts,
  atelierOpportunityStageTransitions,
  atelierPaneAItems,
  atelierWinLossDebriefs,
} from "@workspace/db";
import {
  SALES_TO_PLM,
  SALES_STAGE_DEFAULT_PROB,
  STALLED_THRESHOLD_DAYS,
  computeStickyStageTimestamps,
  deriveSalesStage,
  isSalesStage,
  resolveSalesStage,
  isTerminalStage,
  migrateLegacyStage,
  validateStageTransition,
  type SalesStage,
} from "../../lib/atelier-agents/pipeline.js";
import { atelierEngagements, atelierCharterVersions } from "@workspace/db";
import { runCharterArchitect } from "../../lib/atelier-agents/runner.js";
import { applyStageTransition } from "../../lib/atelier-agents/stage-service.js";
import { scoreRubric } from "../../lib/atelier-cli/qualification-rubric.js";
import { loadAllChunks } from "../../lib/atelier-cli/attachment-capabilities.js";
import {
  AtelierCreateOpportunityBody,
  AtelierUpdateOpportunityStageBody,
  AtelierSubmitQualifierBody,
  AtelierRunPursuitScoutBody,
  AtelierPromoteResearchFactBody,
  AtelierStartPovBody,
  AtelierSubmitMeetingBody,
  AtelierRecordAgentDecisionBody,
  AtelierCreateStageTransitionBody,
  AtelierUpdateOpportunityBody,
  AtelierArchiveOpportunityBody,
  AtelierScoreQualificationRubricBody,
  AtelierGetPipelineForecastResponse,
  AtelierGetStageHistoryResponse,
} from "@workspace/api-zod";
import {
  runPursuitScout,
  runPovOutline,
  runPovDraft,
  runMeetingScribe,
  recordDecision,
  runPipelineForecaster,
  ATELIER_V5_DISPATCH,
  dispatchV5ModeExtension,
  applyCitationGuardrail,
  isScoutBriefEmpty,
  type AgentFact,
  type PursuitScoutOutput,
  type PovOutline,
} from "../../lib/atelier-agents/runner.js";
import { getAgent } from "@workspace/agents";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

async function loadOpp(id: string) {
  const [row] = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, id), isNull(atelierOpportunities.deletedAt)));
  return row;
}

async function buildOppWire(o: typeof atelierOpportunities.$inferSelect) {
  const [acct] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, o.accountId));
  const [partner] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, o.partnerOwnerId));
  const [lead] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, o.engagementLeadId));
  const salesStage = resolveSalesStage(o.salesStage) as string;
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    accountId: o.accountId,
    accountName: acct?.name ?? o.accountId,
    salesStage,
    buyerPersona: o.buyerPersona,
    offeringAnchor: o.offeringAnchor,
    partnerOwnerName: partner?.name ?? o.partnerOwnerId,
    engagementLeadName: lead?.name ?? o.engagementLeadId,
    dealSizeUsd: o.dealSizeHypothesis,
    probabilityPct: o.probabilityPct,
    weightedValueUsd: (o.dealSizeHypothesis * o.probabilityPct) / 100,
    daysInStage: o.daysInStage,
    nextMilestone: o.nextMilestone,
    nextMilestoneDate: o.nextMilestoneDate ?? null,
    // Task #653 — forecast fields.
    closeDate: o.closeDate ?? null,
    forecastCategory: o.forecastCategory,
    sourceLead: o.sourceLead,
    stalled:
      o.daysInStage > STALLED_THRESHOLD_DAYS &&
      salesStage !== "contract" &&
      salesStage !== "lost" &&
      salesStage !== "no_decision" &&
      salesStage !== "withdrawn",
    // Task #296 — sub-status chip + sticky timestamps for kanban aging
    // and the new Runner Aging / Closure Time reports.
    subStatus: o.subStatus ?? null,
    runnerEnteredAt: o.runnerEnteredAt?.toISOString() ?? null,
    contractSignedAt: o.contractSignedAt?.toISOString() ?? null,
    // Task #540 — structured weighted qualification rubric (null until scored).
    qualificationRubric: o.qualificationRubric ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

const router: IRouter = Router();

// =============================================================
// Create opportunity (auto-runs Pursuit Scout)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierCreateOpportunityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const input = parsed.data;

  // `description` is the canonical free-text brief the partner writes for what
  // we're pursuing. It is required by the request schema; the explicit guard
  // below catches whitespace-only input that survives `min(1)`.
  const description = input.description.trim();
  if (!description) {
    res.status(400).json({ error: "description-required" });
    return;
  }

  // Find or create account. Existing-account branch is keyed on accountId;
  // create-new branch requires accountName + country + sector.
  let acct: typeof atelierAccounts.$inferSelect | undefined;
  if (input.accountId) {
    [acct] = await db
      .select()
      .from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, input.accountId), isNull(atelierAccounts.deletedAt)));
    if (!acct) {
      res.status(404).json({ error: "account-not-found" });
      return;
    }
  } else {
    const newName = (input.accountName ?? "").trim();
    const newCountry = (input.accountCountry ?? "").trim();
    const newSector = (input.accountSector ?? "").trim();
    if (!newName || !newCountry || !newSector) {
      res.status(400).json({ error: "account-required" });
      return;
    }
    // Reuse an existing account if the name already matches — case-insensitive
    // exact match (ilike without wildcards) so "Tasama" and "tasama" don't
    // create accidental duplicate accounts.
    [acct] = await db
      .select()
      .from(atelierAccounts)
      .where(and(ilike(atelierAccounts.name, newName), isNull(atelierAccounts.deletedAt)));
    if (!acct) {
      const acctId = `acct_${slugify(newName)}_${Math.random().toString(36).slice(2, 6)}`;
      [acct] = await db
        .insert(atelierAccounts)
        .values({
          id: acctId,
          name: newName,
          country: newCountry,
          sector: newSector,
          tier: input.accountTier ?? undefined,
          createdByUserId: me.id,
        })
        .returning();
    }
  }
  if (!acct) {
    res.status(500).json({ error: "account-resolution-failed" });
    return;
  }

  // Resolve owners. Both default to the creator if unspecified, but if either
  // is supplied it must reference an existing active atelier_users row.
  async function resolveOwner(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const [u] = await db
      .select()
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, userId), isNull(atelierUsers.deletedAt)));
    return u ? u.id : null;
  }
  const partnerOwnerId = input.partnerOwnerId
    ? await resolveOwner(input.partnerOwnerId)
    : me.id;
  if (!partnerOwnerId) {
    res.status(400).json({ error: "invalid-partner-owner" });
    return;
  }
  const engagementLeadId = input.engagementLeadId
    ? await resolveOwner(input.engagementLeadId)
    : me.id;
  if (!engagementLeadId) {
    res.status(400).json({ error: "invalid-engagement-lead" });
    return;
  }

  const probabilityPct =
    typeof input.probabilityPct === "number" ? input.probabilityPct : 25;
  const nextMilestone =
    (input.nextMilestone ?? "").trim() || "Run Pursuit Scout · qualify 5C";
  const nextMilestoneDate = (input.nextMilestoneDate ?? "").trim() || null;
  const closeDate = (input.closeDate ?? "").trim() || null;
  const forecastCategory = input.forecastCategory ?? "pipeline";
  const sourceLead = (input.sourceLead ?? "").trim() || "manual";

  const oppId = `opp_${slugify(input.name)}_${Math.random().toString(36).slice(2, 6)}`;
  const [opp] = await db
    .insert(atelierOpportunities)
    .values({
      id: oppId,
      slug: slugify(input.name),
      name: input.name,
      accountId: acct.id,
      // Persist the partner-authored description as the offering anchor so
      // the opportunity carries it forward without a schema change.
      offeringAnchor: description,
      // Task #654 — salesStage is the single source of truth; the opportunity
      // lands in the right kanban/forecast column from the moment it persists.
      salesStage: deriveSalesStage("identify", probabilityPct),
      partnerOwnerId,
      engagementLeadId,
      dealSizeHypothesis: input.dealSizeUsd ?? 250000,
      probabilityPct,
      nextMilestone,
      nextMilestoneDate,
      closeDate,
      forecastCategory,
      sourceLead,
      createdByUserId: me.id,
    })
    .returning();

  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: opp.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "opportunity.create",
    payload: {
      name: opp.name,
      account: acct.name,
      partnerOwnerId,
      engagementLeadId,
      sourceLead,
      dealSizeUsd: opp.dealSizeHypothesis,
      probabilityPct: opp.probabilityPct,
    },
    payloadSummary: `${me.name} created opportunity "${opp.name}" on ${acct.name}.`,
  });

  // Compose the brief Scout reads first: the partner's description, plus the
  // optional steering "focus areas" textarea.
  const scoutBrief = [
    description,
    input.scoutFocus?.trim()
      ? `Focus areas: ${input.scoutFocus.trim()}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Task #653 — surface the Pursuit Scout outcome instead of swallowing a
  // failed/empty run behind a bare 201. The opportunity itself is already
  // persisted (rows + audit), so we keep creating it — but the response carries
  // an explicit `scout` status so the caller can tell whether a usable brief was
  // produced ("completed"), the run returned an empty/soft-refusal brief
  // ("empty"), or the run failed outright ("failed", with the error). "skipped"
  // means the caller passed runScout:false and no run was attempted.
  let scoutRunId: string | null = null;
  let scout: {
    status: "completed" | "empty" | "failed" | "skipped";
    error?: string;
  } = { status: "skipped" };
  if (input.runScout !== false) {
    try {
      const { runId } = await runPursuitScout({
        opportunityId: opp.id,
        accountName: acct.name,
        accountCountry: acct.country,
        accountSector: acct.sector,
        opportunityName: opp.name,
        contextBlurb: scoutBrief,
        triggeredByUserId: me.id,
        actorLabel: "Pursuit Scout",
      });
      scoutRunId = runId;
      // Persist brief + facts.
      const [latest] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, runId));
      const out = (latest?.output as PursuitScoutOutput) ?? null;
      const persisted = out ? await persistBriefAndFacts(opp.id, runId, out) : { persisted: false, reason: "empty" as const };
      scout = persisted.persisted ? { status: "completed" } : { status: "empty" };
    } catch (err) {
      // A failed Scout run must not block opportunity creation, but it must be
      // surfaced — not swallowed by a clean 201.
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[atelier] scout failed", err);
      scout = { status: "failed", error: message };
    }
  }

  res.status(201).json({
    opportunity: await buildOppWire(opp),
    scoutRunId,
    scout,
  });
});

// =============================================================
// Edit opportunity core details (Task #540)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.patch("/opportunities/:oppId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp || opp.orgId !== me.orgId) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const parsed = AtelierUpdateOpportunityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const input = parsed.data;

  // Resolve any supplied owner references to existing, active users so we never
  // persist a dangling FK. Unsupplied owners are left untouched.
  async function resolveOwner(userId: string): Promise<string | null> {
    const [u] = await db
      .select()
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, userId), isNull(atelierUsers.deletedAt)));
    return u ? u.id : null;
  }

  const patch: Partial<typeof atelierOpportunities.$inferInsert> = {};
  const changed: string[] = [];
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      res.status(400).json({ error: "name-required" });
      return;
    }
    patch.name = name;
    patch.slug = slugify(name);
    changed.push("name");
  }
  if (input.dealSizeUsd !== undefined) {
    patch.dealSizeHypothesis = input.dealSizeUsd;
    changed.push("dealSizeUsd");
  }
  if (input.probabilityPct !== undefined) {
    patch.probabilityPct = input.probabilityPct;
    changed.push("probabilityPct");
  }
  if (input.nextMilestone !== undefined) {
    const nm = (input.nextMilestone ?? "").trim();
    if (!nm) {
      res.status(400).json({ error: "next-milestone-required" });
      return;
    }
    patch.nextMilestone = nm;
    changed.push("nextMilestone");
  }
  if (input.nextMilestoneDate !== undefined) {
    patch.nextMilestoneDate = (input.nextMilestoneDate ?? "").trim() || null;
    changed.push("nextMilestoneDate");
  }
  if (input.closeDate !== undefined) {
    patch.closeDate = (input.closeDate ?? "").trim() || null;
    changed.push("closeDate");
  }
  if (input.forecastCategory !== undefined && input.forecastCategory !== null) {
    patch.forecastCategory = input.forecastCategory;
    changed.push("forecastCategory");
  }
  if (input.buyerPersona !== undefined) {
    patch.buyerPersona = input.buyerPersona;
    changed.push("buyerPersona");
  }
  if (input.offeringAnchor !== undefined) {
    patch.offeringAnchor = input.offeringAnchor;
    changed.push("offeringAnchor");
  }
  if (input.partnerOwnerId !== undefined) {
    const resolved = await resolveOwner(input.partnerOwnerId);
    if (!resolved) {
      res.status(400).json({ error: "invalid-partner-owner" });
      return;
    }
    patch.partnerOwnerId = resolved;
    changed.push("partnerOwnerId");
  }
  if (input.engagementLeadId !== undefined) {
    const resolved = await resolveOwner(input.engagementLeadId);
    if (!resolved) {
      res.status(400).json({ error: "invalid-engagement-lead" });
      return;
    }
    patch.engagementLeadId = resolved;
    changed.push("engagementLeadId");
  }

  if (changed.length === 0) {
    res.json(await buildOppWire(opp));
    return;
  }

  patch.updatedAt = new Date();
  const [updated] = await db
    .update(atelierOpportunities)
    .set(patch)
    .where(eq(atelierOpportunities.id, opp.id))
    .returning();

  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: opp.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "opportunity.update",
    payload: { changed, ...patch, updatedAt: undefined },
    payloadSummary: `${me.name} edited ${changed.join(", ")} on "${updated.name}".`,
  });

  res.json(await buildOppWire(updated));
});

// =============================================================
// Archive (soft-delete) opportunity (Task #540)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/archive", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp || opp.orgId !== me.orgId) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const parsed = AtelierArchiveOpportunityBody.safeParse(req.body ?? {});
  const rationale = parsed.success ? (parsed.data.rationale ?? "") : "";

  await db
    .update(atelierOpportunities)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(atelierOpportunities.id, opp.id));

  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: opp.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "opportunity.archive",
    payload: { rationale },
    payloadSummary: `${me.name} archived "${opp.name}"${rationale ? ` — "${rationale.slice(0, 100)}"` : ""}.`,
  });

  res.json({ ok: true, id: opp.id });
});

// =============================================================
// Score + persist structured qualification rubric (Task #540)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/qualification-rubric", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp || opp.orgId !== me.orgId) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const parsed = AtelierScoreQualificationRubricBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const { attachmentIds, offeringAnchors } = parsed.data;

  const chunks = await loadAllChunks(attachmentIds, me.orgId);
  if (chunks.length === 0) {
    res.status(422).json({ error: "no-chunks" });
    return;
  }

  const [acct] = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, opp.accountId));

  // Caller-supplied anchors take precedence; otherwise fall back to the
  // opportunity's own offering anchor so the strategic-fit dimension has signal.
  const anchors =
    offeringAnchors && offeringAnchors.length > 0
      ? offeringAnchors
      : opp.offeringAnchor
        ? [opp.offeringAnchor]
        : [];

  const rubric = scoreRubric({
    attachmentIds,
    chunks,
    offeringAnchors: anchors,
    accountCountry: acct?.country,
    accountSector: acct?.sector,
  });

  await db
    .update(atelierOpportunities)
    .set({ qualificationRubric: rubric, updatedAt: new Date() })
    .where(eq(atelierOpportunities.id, opp.id));

  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: opp.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "opportunity.qualification_rubric",
    payload: {
      composite: rubric.composite,
      band: rubric.band,
      recommendedDecision: rubric.recommendedDecision,
      attachmentIds: rubric.attachmentIds,
    },
    payloadSummary: `${me.name} scored "${opp.name}" — ${rubric.band} (${rubric.composite}); recommends ${rubric.recommendedDecision ?? "human review"}.`,
  });

  res.json(rubric);
});

async function persistBriefAndFacts(
  oppId: string,
  runId: string,
  out: PursuitScoutOutput,
): Promise<{ persisted: boolean; reason?: "empty" }> {
  // Task #653 — validate the Scout output before it becomes the brief of
  // record. The model can return a structurally-valid-but-empty object (a soft
  // refusal for accounts with no public footprint). Persisting that would put a
  // blank brief in front of the partner as if it were research. Require at least
  // one narrative section to carry content; otherwise skip persistence and leave
  // the prior brief (if any) intact rather than overwriting it with nothing.
  if (isScoutBriefEmpty(out)) {
    console.warn(`[atelier] scout produced an empty brief for ${oppId} — skipping persist`);
    return { persisted: false, reason: "empty" };
  }
  // Run facts through the citation guardrail so any claim without a real source
  // URL is confidence-downgraded (never silently promoted as green evidence).
  const guardedFacts = applyCitationGuardrail(out.facts ?? []);
  // Soft-delete prior briefs so the latest is the source of truth.
  await db
    .update(atelierBriefs)
    .set({ deletedAt: new Date() })
    .where(and(eq(atelierBriefs.opportunityId, oppId), isNull(atelierBriefs.deletedAt)));
  await db.insert(atelierBriefs).values({
    id: rid("brief"),
    opportunityId: oppId,
    runId,
    accountSnapshot: out.accountSnapshot,
    buyerLandscape: out.buyerLandscape,
    fiveCDraft: out.fiveCDraft,
    openQuestions: out.openQuestions ?? [],
    citations: guardedFacts,
    confidence: out.confidence ?? "amber",
  });
  // Insert facts (don't dedupe — run history is the audit).
  // Every fact emitted by the scout into the brief is by definition
  // `included_in_brief=true`; the partner can later flip POV inclusion
  // on a per-fact basis via the promote endpoint.
  if (guardedFacts.length) {
    await db.insert(atelierResearchFacts).values(
      guardedFacts.map((f) => ({
        id: f.id ?? rid("fact"),
        opportunityId: oppId,
        runId,
        topic: f.topic,
        statement: f.statement,
        sourceUrl: f.sourceUrl ?? null,
        sourceTitle: f.sourceTitle ?? null,
        snippet: f.snippet ?? null,
        confidence: f.confidence,
        retrievedAt: new Date(),
        includedInBrief: true,
      })),
    );
  }
  return { persisted: true };
}

// =============================================================
// PATCH stage  (5C gate enforced for `pursue`)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.patch("/opportunities/:oppId/stage", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const parsed = AtelierUpdateOpportunityStageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const { toStage, rationale } = parsed.data;
  // Task #651 — this legacy v1 shim accepts a plm_stage label but now routes
  // through the shared service so the same gates fire as on every other path.
  // Map the legacy plm_stage onto the canonical sales_stage first.
  const targetSales = deriveSalesStage(toStage, opp.probabilityPct) as SalesStage;
  const result = await applyStageTransition(
    opp,
    {
      toStage: targetSales,
      rationaleText: rationale ?? "",
      source: "legacy-patch",
    },
    { id: me.id, name: me.name, orgId: me.orgId },
  );
  if (!result.ok) {
    const code = result.gate?.gate === "suspect_to_prospect_5c" ? "qualifier-required" : result.error;
    res.status(result.status).json({ error: code, ...(result.gate ?? {}) });
    return;
  }
  res.json(await buildOppWire(result.opportunity));
});

// =============================================================
// 5C Qualifier  (GET + POST)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/qualifier", async (req, res) => {
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  res.json({
    oppId: opp.id,
    fiveC: {
      client: opp.qualify5c?.client ?? "",
      competition: opp.qualify5c?.competition ?? "",
      capability: opp.qualify5c?.capability ?? "",
      capacity: opp.qualify5c?.capacity ?? "",
      contract: opp.qualify5c?.contract ?? "",
    },
    decision: opp.goNoGoDecision ?? null,
    // Task #540 — surface the structured weighted rubric alongside the 5C.
    rubric: opp.qualificationRubric ?? null,
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/qualifier", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const parsed = AtelierSubmitQualifierBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const { fiveC, decision, rationale } = parsed.data;
  // Task #653 — rubric enforcement gate. The document-scored qualification
  // rubric (Task #540) used to be decorative: scored, stored, and surfaced, but
  // never enforced anywhere, so it competed with the 5C as a second, toothless
  // qualification system. We keep the 5C go/no-go as THE single qualification
  // decision and let the rubric act only as a veto on over-optimistic calls:
  // when a rubric is on file and lands in the `decline` band, recording a `go`
  // requires an explicit partner override (`overrideRubric:true`) so the
  // disagreement is deliberate and audited rather than silent. Opportunities
  // with no rubric are unaffected (the 5C alone governs).
  const rubricBand = (opp.qualificationRubric as { band?: string } | null)?.band;
  const overrideRubric = (req.body as { overrideRubric?: boolean }).overrideRubric === true;
  const isPartnerTier = me.role === "partner" || me.role === "founding_partner";
  if (decision === "go" && rubricBand === "decline") {
    // Only a partner-tier user may override a DECLINE-band rubric. A non-partner
    // setting overrideRubric:true is rejected so the governance veto cannot be
    // self-cleared by the deal team.
    if (overrideRubric && !isPartnerTier) {
      res.status(403).json({
        error: "rubric-override-forbidden",
        band: rubricBand,
        reason:
          "Overriding a DECLINE-band qualification rubric requires partner authority. Ask a partner to record the Go.",
      });
      return;
    }
    if (!overrideRubric) {
      res.status(422).json({
        error: "rubric-decline-conflict",
        band: rubricBand,
        reason:
          "The scored qualification rubric places this opportunity in the DECLINE band. Recording a Go requires an explicit partner override (set overrideRubric:true) with a rationale.",
      });
      return;
    }
  }
  const ts = new Date().toISOString();
  await db
    .update(atelierOpportunities)
    .set({
      qualify5c: fiveC,
      goNoGoDecision: { decision, decider: me.name, rationale: rationale ?? "", ts },
      updatedAt: new Date(),
    })
    .where(eq(atelierOpportunities.id, opp.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: opp.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "opportunity.qualify_5c",
    payload: { decision, rationale },
    payloadSummary: `${me.name} ${decision === "go" ? "approved 5C ✔" : "marked no-go ✘"} for "${opp.name}"${rationale ? ` — "${rationale.slice(0, 100)}"` : ""}.`,
  });
  res.json({
    oppId: opp.id,
    fiveC,
    decision: { decision, decider: me.name, rationale: rationale ?? "", ts },
  });
});

// =============================================================
// Pursuit Scout — get brief / re-run
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/brief", async (req, res) => {
  const [row] = await db
    .select()
    .from(atelierBriefs)
    .where(and(eq(atelierBriefs.opportunityId, req.params.oppId), isNull(atelierBriefs.deletedAt)))
    .orderBy(desc(atelierBriefs.createdAt))
    .limit(1);
  if (!row) {
    res.json({});
    return;
  }
  res.json({
    brief: {
      accountSnapshot: row.accountSnapshot,
      buyerLandscape: row.buyerLandscape,
      fiveCDraft: row.fiveCDraft,
      openQuestions: row.openQuestions,
      facts: (row.citations as AgentFact[]) ?? [],
      confidence: row.confidence,
    },
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
    confidence: row.confidence ?? "amber",
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/scout", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const [acct] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, opp.accountId));
  if (!acct) {
    res.status(500).json({ error: "account-missing" });
    return;
  }
  const parsed = AtelierRunPursuitScoutBody.safeParse(req.body ?? {});
  const blurb = parsed.success ? parsed.data.contextBlurb ?? "" : "";
  try {
    const { runId } = await runPursuitScout({
      opportunityId: opp.id,
      accountName: acct.name,
      accountCountry: acct.country,
      accountSector: acct.sector,
      opportunityName: opp.name,
      contextBlurb: blurb,
      triggeredByUserId: me.id,
      actorLabel: "Pursuit Scout",
    });
    const [latest] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, runId));
    const out = (latest?.output as PursuitScoutOutput) ?? null;
    if (out) await persistBriefAndFacts(opp.id, runId, out);
    const [briefRow] = await db
      .select()
      .from(atelierBriefs)
      .where(and(eq(atelierBriefs.opportunityId, opp.id), isNull(atelierBriefs.deletedAt)))
      .orderBy(desc(atelierBriefs.createdAt))
      .limit(1);
    res.json({
      brief: briefRow
        ? {
            accountSnapshot: briefRow.accountSnapshot,
            buyerLandscape: briefRow.buyerLandscape,
            fiveCDraft: briefRow.fiveCDraft,
            openQuestions: briefRow.openQuestions,
            facts: (briefRow.citations as AgentFact[]) ?? [],
            confidence: briefRow.confidence,
          }
        : undefined,
      runId,
      createdAt: briefRow?.createdAt.toISOString() ?? null,
      confidence: briefRow?.confidence ?? "amber",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "scout-failed" });
  }
});

// =============================================================
// Research facts
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/research", async (req, res) => {
  const rows = await db
    .select()
    .from(atelierResearchFacts)
    .where(and(eq(atelierResearchFacts.opportunityId, req.params.oppId), isNull(atelierResearchFacts.deletedAt)))
    .orderBy(desc(atelierResearchFacts.createdAt));
  res.json(
    rows.map((f) => ({
      id: f.id,
      oppId: f.opportunityId,
      topic: f.topic,
      statement: f.statement,
      sourceUrl: f.sourceUrl,
      sourceTitle: f.sourceTitle,
      snippet: f.snippet,
      confidence: f.confidence as "green" | "amber" | "red",
      promoted: f.promoted,
      promotedAt: f.promotedAt?.toISOString() ?? null,
      includedInBrief: f.includedInBrief,
      includedInPov: f.includedInPov,
      createdAt: f.createdAt.toISOString(),
      runId: f.runId,
    })),
  );
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/research/:factId/promote", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierPromoteResearchFactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [updated] = await db
    .update(atelierResearchFacts)
    .set({
      promoted: parsed.data.promote,
      promotedAt: parsed.data.promote ? new Date() : null,
      promotedByUserId: parsed.data.promote ? me.id : null,
      // Promotion is the partner-explicit signal that this fact is now part
      // of the dossier carried into POV generation. Demotion clears it.
      includedInPov: parsed.data.promote,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(atelierResearchFacts.id, req.params.factId),
        eq(atelierResearchFacts.opportunityId, req.params.oppId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "fact-not-found" });
    return;
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: parsed.data.promote ? "fact.promote" : "fact.demote",
    payload: { factId: updated.id, topic: updated.topic },
    payloadSummary: `${me.name} ${parsed.data.promote ? "promoted" : "demoted"} fact "${updated.topic}".`,
  });
  res.json({
    id: updated.id,
    oppId: updated.opportunityId,
    topic: updated.topic,
    statement: updated.statement,
    sourceUrl: updated.sourceUrl,
    sourceTitle: updated.sourceTitle,
    snippet: updated.snippet,
    confidence: updated.confidence as "green" | "amber" | "red",
    promoted: updated.promoted,
    promotedAt: updated.promotedAt?.toISOString() ?? null,
    includedInBrief: updated.includedInBrief,
    includedInPov: updated.includedInPov,
    createdAt: updated.createdAt.toISOString(),
    runId: updated.runId,
  });
});

// Unsourced-claim risk acceptance — the partner explicitly takes ownership
// of a red/unsourced fact and the action is logged in the audit trail.
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/research/:factId/accept-risk", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rationale = typeof req.body?.rationale === "string" ? req.body.rationale.slice(0, 500) : "";
  const [fact] = await db
    .select()
    .from(atelierResearchFacts)
    .where(and(eq(atelierResearchFacts.id, req.params.factId), eq(atelierResearchFacts.opportunityId, req.params.oppId)));
  if (!fact) {
    res.status(404).json({ error: "fact-not-found" });
    return;
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "fact.risk_accepted",
    payload: { factId: fact.id, topic: fact.topic, confidence: fact.confidence, rationale },
    payloadSummary: `${me.name} accepted risk on unsourced fact "${fact.topic}"${rationale ? ` — "${rationale.slice(0, 120)}"` : ""}.`,
  });
  res.status(201).json({ accepted: true, factId: fact.id, ts: new Date().toISOString() });
});

// =============================================================
// POVs
// =============================================================
function povWire(p: typeof atelierPovs.$inferSelect) {
  return {
    id: p.id,
    oppId: p.opportunityId,
    title: p.title,
    audience: p.audience,
    objective: p.objective,
    status: p.status as "outline" | "drafting" | "drafted" | "approved",
    outline: (p.outline as PovOutline["sections"]) ?? [],
    currentVersionId: p.currentVersionId,
    runId: p.runId,
    createdAt: p.createdAt.toISOString(),
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/povs", async (req, res) => {
  const rows = await db
    .select()
    .from(atelierPovs)
    .where(and(eq(atelierPovs.opportunityId, req.params.oppId), isNull(atelierPovs.deletedAt)))
    .orderBy(desc(atelierPovs.createdAt));
  res.json(rows.map(povWire));
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/povs", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const parsed = AtelierStartPovBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  // Pull promoted facts as the canonical evidence set.
  const factRows = await db
    .select()
    .from(atelierResearchFacts)
    .where(
      and(
        eq(atelierResearchFacts.opportunityId, opp.id),
        eq(atelierResearchFacts.promoted, true),
        isNull(atelierResearchFacts.deletedAt),
      ),
    );
  const promoted: AgentFact[] = factRows.map((f) => ({
    id: f.id,
    topic: f.topic,
    statement: f.statement,
    sourceUrl: f.sourceUrl ?? undefined,
    sourceTitle: f.sourceTitle ?? undefined,
    snippet: f.snippet ?? undefined,
    confidence: f.confidence as "green" | "amber" | "red",
  }));
  if (promoted.length === 0) {
    res.status(400).json({ error: "no-promoted-facts" });
    return;
  }
  const { runId, outline } = await runPovOutline({
    opportunityId: opp.id,
    opportunityName: opp.name,
    audience: parsed.data.audience,
    objective: parsed.data.objective,
    promotedFacts: promoted,
    triggeredByUserId: me.id,
    actorLabel: "POV Author · Outliner",
  });
  const id = rid("pov");
  const [pov] = await db
    .insert(atelierPovs)
    .values({
      id,
      opportunityId: opp.id,
      title: parsed.data.title,
      audience: parsed.data.audience,
      objective: parsed.data.objective,
      status: "outline",
      outline: outline.sections as never,
      runId,
      createdByUserId: me.id,
    })
    .returning();
  res.status(201).json(povWire(pov));
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/povs/:povId/draft", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [pov] = await db.select().from(atelierPovs).where(eq(atelierPovs.id, req.params.povId));
  if (!pov) {
    res.status(404).json({ error: "pov-not-found" });
    return;
  }
  // Outline-approval gate: a human must have recorded an `approve` decision
  // on the outline run before the section/critic/stylist chain may execute.
  if (!pov.runId) {
    res.status(412).json({ error: "outline-not-approved", reason: "no outline run on file" });
    return;
  }
  const [outlineRun] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, pov.runId));
  const outlineDecisions = (outlineRun?.humanDecisions as Array<{ decision?: string }> | null) ?? [];
  const outlineApproved = outlineDecisions.some((d) => d?.decision === "approve");
  if (!outlineApproved) {
    res.status(412).json({
      error: "outline-not-approved",
      reason: "POV outline must be approved (human decision row) before draft can run",
      outlineRunId: pov.runId,
    });
    return;
  }
  const opp = await loadOpp(pov.opportunityId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const factRows = await db
    .select()
    .from(atelierResearchFacts)
    .where(
      and(
        eq(atelierResearchFacts.opportunityId, opp.id),
        eq(atelierResearchFacts.promoted, true),
        isNull(atelierResearchFacts.deletedAt),
      ),
    );
  const promoted: AgentFact[] = factRows.map((f) => ({
    id: f.id,
    topic: f.topic,
    statement: f.statement,
    sourceUrl: f.sourceUrl ?? undefined,
    sourceTitle: f.sourceTitle ?? undefined,
    snippet: f.snippet ?? undefined,
    confidence: f.confidence as "green" | "amber" | "red",
  }));
  // Task #653 — empty-brief degrade. A POV is an evidence-backed argument; with
  // no promoted facts there is nothing to cite, so refuse with a clear, soft
  // 412 ("promote facts first") rather than generating an uncitable draft.
  if (promoted.length === 0) {
    res.status(412).json({
      error: "no-promoted-facts",
      reason:
        "No research facts have been promoted for this opportunity. Promote at least one fact before drafting the POV so claims can be cited.",
    });
    return;
  }
  const outline: PovOutline = {
    title: pov.title,
    thesis: pov.objective ?? "",
    sections: (pov.outline as PovOutline["sections"]) ?? [],
  };
  const { runId, draft } = await runPovDraft({
    opportunityId: opp.id,
    opportunityName: opp.name,
    outline,
    promotedFacts: promoted,
    triggeredByUserId: me.id,
    actorLabel: "POV Author · Sections+Critic+Stylist",
  });
  // Task #653 — citation-coverage gate. The draft self-reports the share of
  // sections whose claims cite a promoted fact. Below the floor the argument is
  // under-evidenced; reject (without persisting a version) so the partner
  // promotes more facts or tightens the outline instead of shipping thin work.
  const POV_MIN_CITATION_COVERAGE = 0.6;
  if (typeof draft.citationCoverage === "number" && draft.citationCoverage < POV_MIN_CITATION_COVERAGE) {
    res.status(422).json({
      error: "insufficient-citation-coverage",
      citationCoverage: draft.citationCoverage,
      minimum: POV_MIN_CITATION_COVERAGE,
      reason: `POV draft cites facts in only ${Math.round(draft.citationCoverage * 100)}% of sections (minimum ${Math.round(POV_MIN_CITATION_COVERAGE * 100)}%). Promote more facts or tighten the outline before drafting.`,
    });
    return;
  }
  // Version number = max + 1.
  const versions = await db
    .select()
    .from(atelierPovVersions)
    .where(and(eq(atelierPovVersions.povId, pov.id), isNull(atelierPovVersions.deletedAt)));
  const next = (versions.reduce((m, v) => Math.max(m, v.versionNumber), 0) ?? 0) + 1;
  const versionId = rid("povv");
  const [version] = await db
    .insert(atelierPovVersions)
    .values({
      id: versionId,
      povId: pov.id,
      versionNumber: next,
      body: draft.html,
      sections: draft.sections as never,
      citations: promoted as never,
      citationCoverage: draft.citationCoverage,
      notes: draft.voiceFlags?.join(" · ") || null,
      createdByUserId: me.id,
    })
    .returning();
  await db
    .update(atelierPovs)
    .set({ status: "drafted", currentVersionId: versionId, runId, updatedAt: new Date() })
    .where(eq(atelierPovs.id, pov.id));
  res.json({
    id: version.id,
    povId: version.povId,
    versionNumber: version.versionNumber,
    body: version.body,
    sections: version.sections,
    citations: version.citations,
    citationCoverage: version.citationCoverage,
    notes: version.notes,
    createdAt: version.createdAt.toISOString(),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/povs/:povId/versions", async (req, res) => {
  const rows = await db
    .select()
    .from(atelierPovVersions)
    .where(and(eq(atelierPovVersions.povId, req.params.povId), isNull(atelierPovVersions.deletedAt)))
    .orderBy(desc(atelierPovVersions.versionNumber));
  res.json(
    rows.map((v) => ({
      id: v.id,
      povId: v.povId,
      versionNumber: v.versionNumber,
      body: v.body,
      sections: v.sections,
      citations: v.citations,
      citationCoverage: v.citationCoverage,
      notes: v.notes,
      createdAt: v.createdAt.toISOString(),
    })),
  );
});

// =============================================================
// Meetings
// =============================================================
function meetingWire(m: typeof atelierMeetings.$inferSelect, runId: string | null) {
  return {
    id: m.id,
    oppId: m.parentId,
    parentType: m.parentType as "opportunity" | "engagement",
    kind: m.kind as "discovery" | "workshop" | "steering" | "kickoff",
    mode: m.mode as "paste" | "upload" | "live_bot",
    title: m.title,
    date: m.date,
    attendees: m.attendees as { name: string; org: string }[],
    summary: m.summary,
    decisions: m.decisions as unknown[],
    actionItems: m.actionItems as unknown[],
    runId: runId ?? m.runId ?? null,
    status: m.status as "draft" | "official",
    committedAt: m.committedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/meetings", async (req, res) => {
  const rows = await db
    .select()
    .from(atelierMeetings)
    .where(
      and(
        eq(atelierMeetings.parentType, "opportunity"),
        eq(atelierMeetings.parentId, req.params.oppId),
        isNull(atelierMeetings.deletedAt),
      ),
    )
    .orderBy(desc(atelierMeetings.createdAt));
  res.json(rows.map((m) => meetingWire(m, null)));
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/meetings", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const parsed = AtelierSubmitMeetingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  // Load most recent brief as priorBrief context.
  const [briefRow] = await db
    .select()
    .from(atelierBriefs)
    .where(and(eq(atelierBriefs.opportunityId, opp.id), isNull(atelierBriefs.deletedAt)))
    .orderBy(desc(atelierBriefs.createdAt))
    .limit(1);
  const priorBrief: PursuitScoutOutput | null = briefRow
    ? ({
        accountSnapshot: briefRow.accountSnapshot,
        buyerLandscape: briefRow.buyerLandscape,
        fiveCDraft: briefRow.fiveCDraft,
        openQuestions: briefRow.openQuestions,
        facts: (briefRow.citations as AgentFact[]) ?? [],
        confidence: (briefRow.confidence ?? "amber") as "green" | "amber" | "red",
      } as PursuitScoutOutput)
    : null;

  // Task #653 — meeting capture dedup. Re-submitting the same meeting
  // (identical transcript text + kind for this opportunity) must NOT create a
  // second meeting row or re-run the scribe — re-running re-extracts and
  // re-inserts research facts, inflating the opportunity's fact set and skewing
  // the brief. If an identical capture already exists, return it unchanged.
  //
  // Dedup must also be race-safe: two near-simultaneous identical submissions
  // would both pass a naive check-then-insert and each run the scribe. We close
  // that window with a transaction-scoped advisory lock keyed on opp+kind so
  // the check-and-reserve is serialized. The lock is released when the short
  // reservation transaction commits — it is NOT held across the long-running
  // scribe call, so no pooled connection is pinned for the duration of the LLM
  // run. The reserved (placeholder) meeting row is what a concurrent caller
  // sees as the existing capture, so only one scribe ever runs per transcript.
  const newTranscriptText = parsed.data.transcript.trim();
  const lockKey = `atelier:mtg:${opp.id}:${parsed.data.kind}`;

  type Reservation =
    | { kind: "duplicate"; meeting: typeof atelierMeetings.$inferSelect }
    | { kind: "reserved"; transcriptId: string; meetingId: string };

  const reservation: Reservation = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const priorMeetings = await tx
      .select()
      .from(atelierMeetings)
      .where(
        and(
          eq(atelierMeetings.parentType, "opportunity"),
          eq(atelierMeetings.parentId, opp.id),
          eq(atelierMeetings.kind, parsed.data.kind),
          isNull(atelierMeetings.deletedAt),
        ),
      );
    const priorTranscriptIds = priorMeetings
      .map((m) => m.transcriptId)
      .filter((id): id is string => !!id);
    if (priorTranscriptIds.length > 0) {
      const priorTranscripts = await tx
        .select()
        .from(atelierTranscripts)
        .where(inArray(atelierTranscripts.id, priorTranscriptIds));
      const textById = new Map(
        priorTranscripts.map((t) => [t.id, (t.cleanedText ?? "").trim()]),
      );
      const dup = priorMeetings.find(
        (m) => m.transcriptId && textById.get(m.transcriptId) === newTranscriptText,
      );
      if (dup) return { kind: "duplicate", meeting: dup };
    }

    // Reserve: persist the transcript and a placeholder meeting row inside the
    // lock so a concurrent identical submit dedups against it. The scribe runs
    // afterwards (outside the lock) and fills in the analysed fields.
    const transcriptId = rid("trn");
    await tx.insert(atelierTranscripts).values({
      id: transcriptId,
      cleanedText: parsed.data.transcript,
      createdByUserId: me.id,
    });
    const meetingId = rid("mtg");
    await tx.insert(atelierMeetings).values({
      id: meetingId,
      parentType: "opportunity",
      parentId: opp.id,
      mode: parsed.data.mode ?? "paste",
      kind: parsed.data.kind,
      title: parsed.data.title || "Meeting",
      date: parsed.data.date || new Date().toISOString().slice(0, 10),
      transcriptId,
      status: "draft",
      createdByUserId: me.id,
    });
    return { kind: "reserved", transcriptId, meetingId };
  });

  if (reservation.kind === "duplicate") {
    const dup = reservation.meeting;
    res.status(200).json({ ...meetingWire(dup, dup.runId), deduped: true });
    return;
  }

  const { transcriptId, meetingId } = reservation;
  let output: Awaited<ReturnType<typeof runMeetingScribe>>["output"];
  let runId: string;
  try {
    ({ runId, output } = await runMeetingScribe({
      opportunityId: opp.id,
      opportunityName: opp.name,
      transcript: parsed.data.transcript,
      kind: parsed.data.kind,
      priorBrief,
      triggeredByUserId: me.id,
      actorLabel: "Meeting Scribe",
    }));
  } catch (err) {
    // Scribe failed — roll back the reservation so a retry is not permanently
    // dedup-blocked by an empty placeholder row.
    await db.delete(atelierMeetings).where(eq(atelierMeetings.id, meetingId)).catch(() => undefined);
    await db.delete(atelierTranscripts).where(eq(atelierTranscripts.id, transcriptId)).catch(() => undefined);
    throw err;
  }

  const [meeting] = await db
    .update(atelierMeetings)
    .set({
      title: parsed.data.title || output.title,
      attendees: output.attendees as never,
      summary: output.summary,
      decisions: output.decisions as never,
      actionItems: output.actionItems as never,
      runId,
      updatedAt: new Date(),
    })
    .where(eq(atelierMeetings.id, meetingId))
    .returning();
  res.status(201).json(meetingWire(meeting, runId));
});

// =============================================================
// Engagement-side meetings (post-contract)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/engagements/:engId/meetings", async (req, res) => {
  const rows = await db
    .select()
    .from(atelierMeetings)
    .where(
      and(
        eq(atelierMeetings.parentType, "engagement"),
        eq(atelierMeetings.parentId, req.params.engId),
        isNull(atelierMeetings.deletedAt),
      ),
    )
    .orderBy(desc(atelierMeetings.createdAt));
  res.json(rows.map((m) => meetingWire(m, null)));
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/engagements/:engId/meetings", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierSubmitMeetingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const transcriptId = rid("trn");
  await db.insert(atelierTranscripts).values({
    id: transcriptId,
    cleanedText: parsed.data.transcript,
    createdByUserId: me.id,
  });
  const { runId, output } = await runMeetingScribe({
    opportunityId: req.params.engId,
    opportunityName: parsed.data.title || "Engagement meeting",
    transcript: parsed.data.transcript,
    kind: parsed.data.kind,
    priorBrief: null,
    triggeredByUserId: me.id,
    actorLabel: "Meeting Scribe",
  });
  const [meeting] = await db
    .insert(atelierMeetings)
    .values({
      id: rid("mtg"),
      parentType: "engagement",
      parentId: req.params.engId,
      mode: parsed.data.mode ?? "paste",
      kind: parsed.data.kind,
      title: parsed.data.title || output.title,
      date: parsed.data.date || new Date().toISOString().slice(0, 10),
      attendees: output.attendees as never,
      transcriptId,
      summary: output.summary,
      decisions: output.decisions as never,
      actionItems: output.actionItems as never,
      runId,
      status: "draft",
      createdByUserId: me.id,
    })
    .returning();
  res.status(201).json(meetingWire(meeting, runId));
});

// =============================================================
// Agent runs
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/agent-runs/:runId", async (req, res) => {
  const [r] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, req.params.runId));
  if (!r) {
    res.status(404).json({ error: "run-not-found" });
    return;
  }
  res.json({
    id: r.id,
    agentId: r.agentId,
    status: r.status as "running" | "blocked" | "complete" | "error",
    statusMessage: r.statusMessage,
    progressPct: r.progressPct,
    confidence: r.confidence,
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    output: r.output,
    steps: r.steps as unknown[],
    humanDecisions: r.humanDecisions as unknown[],
    costUsd: r.costUsd,
    durationMs: r.durationMs,
    sourcesCount: r.sourcesCount,
    createdAt: r.createdAt.toISOString(),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/agent-runs/:runId/decision", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierRecordAgentDecisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [r] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, req.params.runId));
  if (!r) {
    res.status(404).json({ error: "run-not-found" });
    return;
  }
  await recordDecision({
    runId: r.id,
    decision: parsed.data.decision,
    rationale: parsed.data.rationale ?? "",
    actorId: me.id,
    actorLabel: me.name,
    targetType: r.targetType ?? "agent_run",
    targetId: r.targetId ?? r.id,
    targetLabel: r.targetLabel ?? r.id,
  });
  // Server-side state transition: if the human approved AND the run was not
  // blocked, flip the linked record's status from 'draft' → 'official'.
  // This is the only way records become "committed memory".
  if (parsed.data.decision === "approve" && r.status !== "blocked") {
    const ts = new Date();
    // Accept both canonical (`ag_*`) and legacy bare IDs so historic
    // runs created before the runAgent migration still commit. New
    // runs always write the canonical id.
    if (r.agentId === "ag_pursuit_scout" || r.agentId === "pursuit_scout") {
      await db
        .update(atelierBriefs)
        .set({ status: "official", approvedAt: ts, approvedByUserId: me.id, updatedAt: ts })
        .where(and(eq(atelierBriefs.runId, r.id), isNull(atelierBriefs.deletedAt)));
    } else if (r.agentId === "ag_meeting_scribe" || r.agentId === "meeting_scribe") {
      await db
        .update(atelierMeetings)
        .set({ status: "official", committedAt: ts, committedByUserId: me.id, updatedAt: ts })
        .where(and(eq(atelierMeetings.runId, r.id), isNull(atelierMeetings.deletedAt)));
    } else if (
      r.agentId === "ag_pov_author" ||
      r.agentId === "pov_author" ||
      r.agentId === "ag_pov_draft"
    ) {
      await db
        .update(atelierPovs)
        .set({ status: "approved", updatedAt: ts })
        .where(and(eq(atelierPovs.runId, r.id), isNull(atelierPovs.deletedAt)));
    }
  }
  const [r2] = await db.select().from(atelierAgentRuns).where(eq(atelierAgentRuns.id, req.params.runId));
  res.json({
    id: r2.id,
    agentId: r2.agentId,
    status: r2.status as "running" | "blocked" | "complete" | "error",
    statusMessage: r2.statusMessage,
    progressPct: r2.progressPct,
    confidence: r2.confidence,
    targetType: r2.targetType,
    targetId: r2.targetId,
    targetLabel: r2.targetLabel,
    output: r2.output,
    steps: r2.steps as unknown[],
    humanDecisions: r2.humanDecisions as unknown[],
    costUsd: r2.costUsd,
    durationMs: r2.durationMs,
    sourcesCount: r2.sourcesCount,
    createdAt: r2.createdAt.toISOString(),
  });
});

// =============================================================
// v2 — Sales-stage transitions (rationale + evidence + probability)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/stage-transition", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const parsed = AtelierCreateStageTransitionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  // Body may include any of the new Task #295 gate fields. The generated
  // Zod schema is regenerated from openapi.yaml; the cast keeps this
  // handler resilient if the request was validated by an older client
  // that omits the optional gate fields.
  const body = parsed.data as typeof parsed.data & {
    subStatus?: string | null;
    decider?: string | null;
    verbalCommitDate?: string | null;
    signaturePath?: string | null;
    signedInstrumentFileId?: string | null;
    reasonCode?: string | null;
  };
  const {
    toStage,
    rationaleText,
    evidenceArtifactIds,
    newProbabilityPct,
    nextMilestone,
    nextMilestoneDate,
    partnerOverride,
    subStatus,
    decider,
    verbalCommitDate,
    signaturePath,
    signedInstrumentFileId,
    reasonCode,
  } = body;

  // Task #651 — all stage moves go through the shared service so the gates
  // and every derived-field write are identical across REST / legacy / chat.
  const result = await applyStageTransition(
    opp,
    {
      toStage: toStage as SalesStage,
      rationaleText,
      evidenceArtifactIds: evidenceArtifactIds ?? [],
      newProbabilityPct,
      nextMilestone,
      nextMilestoneDate,
      partnerOverride: !!partnerOverride,
      subStatus,
      decider,
      verbalCommitDate,
      signaturePath,
      signedInstrumentFileId,
      reasonCode,
      source: "rest",
    },
    { id: me.id, name: me.name, orgId: me.orgId },
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, ...(result.gate ?? {}) });
    return;
  }

  res.json({
    opportunity: await buildOppWire(result.opportunity),
    transition: result.transition,
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/stage-history", async (req, res) => {
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierOpportunityStageTransitions)
    .where(eq(atelierOpportunityStageTransitions.opportunityId, opp.id))
    .orderBy(desc(atelierOpportunityStageTransitions.createdAt));
  const userIds = Array.from(new Set(rows.map((r) => r.transitionedByUserId)));
  const users = userIds.length
    ? await db.select().from(atelierUsers).where(inArray(atelierUsers.id, userIds))
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name] as const));
  res.json(
    AtelierGetStageHistoryResponse.parse(
      rows.map((r) => ({
        id: r.id,
        opportunityId: r.opportunityId,
        fromStage: r.fromStage,
        toStage: r.toStage,
        transitionedByUserId: r.transitionedByUserId,
        transitionedByName: nameById.get(r.transitionedByUserId) ?? null,
        rationaleText: r.rationaleText,
        evidenceArtifactIds: r.evidenceArtifactIds ?? [],
        priorProbabilityPct: r.priorProbabilityPct,
        newProbabilityPct: r.newProbabilityPct,
        nextMilestone: r.nextMilestone,
        nextMilestoneDate: r.nextMilestoneDate,
        agentRecommended: r.agentRecommended,
        partnerOverride: r.partnerOverride,
        createdAt: r.createdAt.toISOString(),
      })),
    ),
  );
});

// =============================================================
// v2 — Pipeline Forecaster (deterministic roll-up)
// =============================================================
async function computeForecast() {
  const rows = await db
    .select()
    .from(atelierOpportunities)
    .where(isNull(atelierOpportunities.deletedAt));

  const buckets = new Map<
    SalesStage,
    { count: number; deal: number; weighted: number; daysSum: number }
  >();
  let totalCount = 0;
  let totalDeal = 0;
  let weightedTotal = 0;
  let stalled = 0;
  for (const o of rows) {
    const s = resolveSalesStage(o.salesStage);
    const w = (o.dealSizeHypothesis * o.probabilityPct) / 100;
    const cur = buckets.get(s) ?? { count: 0, deal: 0, weighted: 0, daysSum: 0 };
    cur.count += 1;
    cur.deal += o.dealSizeHypothesis;
    cur.weighted += w;
    cur.daysSum += o.daysInStage;
    buckets.set(s, cur);
    if (s !== "contract" && s !== "lost" && s !== "no_decision" && s !== "withdrawn") {
      totalCount += 1;
      totalDeal += o.dealSizeHypothesis;
      weightedTotal += w;
      if (o.daysInStage > STALLED_THRESHOLD_DAYS) stalled += 1;
    }
  }
  const bucketsWire = Array.from(buckets.entries()).map(([stage, b]) => ({
    stage,
    count: b.count,
    dealSumUsd: b.deal,
    weightedSumUsd: b.weighted,
    avgDaysInStage: b.count ? b.daysSum / b.count : 0,
  }));
  return {
    totalCount,
    totalDealSumUsd: totalDeal,
    weightedPipelineUsd: weightedTotal,
    stalledCount: stalled,
    asOf: new Date().toISOString(),
    buckets: bucketsWire,
  };
}

// @cli-skip: pending Task #340 read-parity migration
router.get("/pipeline/forecast", async (_req, res) => {
  const summary = await computeForecast();
  res.json(AtelierGetPipelineForecastResponse.parse(summary));
});

async function runForecasterHandler(req: Request, res: Response) {
  const me = ensurePersona(req, res);
  if (!me) return;
  const summary = await computeForecast();
  // Side effect: agent runner records audit, flags stalled deals + miscalibrated
  // probabilities into Pane A.
  try {
    await runPipelineForecaster({ actorId: me.id, actorLabel: me.name, summary });
  } catch (e) {
    // Forecaster is mock-first; never fail the HTTP response on a side-effect error.
    // eslint-disable-next-line no-console
    console.error("[pipeline-forecaster] side-effect error", e);
  }
  res.json(AtelierGetPipelineForecastResponse.parse(summary));
}
// @cli-skip: pending Task #340 read-parity migration
router.post("/pipeline/forecast/run", runForecasterHandler);
// Canonical agent-namespaced alias.
// @cli-skip: pending Task #340 read-parity migration
router.post("/agents/pipeline-forecaster/run", runForecasterHandler);

// Pricing Strategist alias — issues a 307 so the original method/body are
// preserved against /opportunities/:oppId/pricing/strategist. Avoids router
// re-entry / middleware double-firing.
// @cli-skip: pending Task #340 read-parity migration
router.post("/agents/pricing-strategist/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const oppId = req.body?.opportunityId;
  if (!oppId || typeof oppId !== "string") {
    res.status(400).json({ error: "opportunityId-required" });
    return;
  }
  res.redirect(
    307,
    `/api/atelier/opportunities/${encodeURIComponent(oppId)}/pricing/strategist`,
  );
});

// =============================================================
// v5 (Task #355) — generic agent dispatcher.
//
// Registered LAST so the more specific bespoke routes above
// (pipeline-forecaster, pricing-strategist) take precedence over the
// `:agentId` placeholder. AgentRun.tsx posts the agent's input fields
// directly here; mode extensions (POV Author press, Account Cartographer
// partner, Pursuit Scout recruiting) are selected via the `_mode` body
// field and shadow the base agent prompt for that run.
//
// Validation note: when `_mode` is present we DO NOT validate against
// the base agent's `inputSchema` because the mode prompt has its own
// shape (e.g. recruiting mode wants `roleId`, while base Pursuit Scout
// wants `accountName`). The mode-specific run wrapper enforces the
// shape it needs and runAgent will validate the final input against the
// registry schema with a warn-on-drift policy.
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/agents/:agentId/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rawId = req.params.agentId;
  const agentId = rawId.startsWith("ag_") ? rawId : `ag_${rawId}`;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { _mode, ...rest } = body;
  const mode = typeof _mode === "string" && _mode.length > 0 ? _mode : undefined;

  // Mode extensions take precedence and bypass the base inputSchema
  // (the base schema would not match the mode's input shape).
  const modeFn = mode ? dispatchV5ModeExtension(agentId, mode) : undefined;
  if (modeFn) {
    try {
      const result = await modeFn({
        ...rest,
        triggeredByUserId: me.id,
      });
      res.status(202).json({
        runId: result.runId,
        agentId,
        mode,
        costUsd: result.costUsd,
        output: result.output,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: "agent-run-failed", message: msg });
    }
    return;
  }

  // No mode requested — require a registered agent and a base dispatcher.
  const agent = getAgent(agentId);
  if (!agent) {
    res.status(404).json({ error: "agent-not-found", agentId });
    return;
  }
  const baseFn = ATELIER_V5_DISPATCH[agentId];
  if (!baseFn) {
    res.status(400).json({
      error: "agent-not-dispatchable-here",
      hint: "This agent is not wired to the generic /run dispatcher; use its bespoke endpoint.",
    });
    return;
  }
  const parsed = agent.inputSchema.safeParse(rest);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-input", issues: parsed.error.issues });
    return;
  }
  try {
    const result = await baseFn({
      ...(parsed.data as Record<string, unknown>),
      triggeredByUserId: me.id,
      actorLabel: agent.name,
    });
    res.status(202).json({
      runId: result.runId,
      agentId,
      mode: null,
      costUsd: result.costUsd,
      output: result.output,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "agent-run-failed", message: msg });
  }
});

export default router;
