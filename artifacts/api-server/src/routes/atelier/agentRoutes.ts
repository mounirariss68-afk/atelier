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
import { eq, and, desc, isNull, inArray } from "drizzle-orm";
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
  isTerminalStage,
  migrateLegacyStage,
  validateStageTransition,
  type SalesStage,
} from "../../lib/atelier-agents/pipeline.js";
import { atelierEngagements, atelierCharterVersions } from "@workspace/db";
import { runCharterArchitect } from "../../lib/atelier-agents/runner.js";
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
  type AgentFact,
  type PursuitScoutOutput,
  type PovOutline,
} from "../../lib/atelier-agents/runner.js";

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
  const salesStage = (isSalesStage(o.salesStage)
    ? o.salesStage
    : deriveSalesStage(o.plmStage, o.probabilityPct)) as string;
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    accountId: o.accountId,
    accountName: acct?.name ?? o.accountId,
    plmStage: o.plmStage,
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
    sourceLead: o.sourceLead,
    stalled:
      o.daysInStage > STALLED_THRESHOLD_DAYS &&
      salesStage !== "contract" &&
      salesStage !== "lost" &&
      salesStage !== "no_decision" &&
      salesStage !== "withdrawn",
    createdAt: o.createdAt.toISOString(),
  };
}

const router: IRouter = Router();

// =============================================================
// Create opportunity (auto-runs Pursuit Scout)
// =============================================================
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
    // Reuse an existing account if the name already matches (case-sensitive
    // exact, mirroring previous behaviour) — protects against accidental dupes.
    [acct] = await db
      .select()
      .from(atelierAccounts)
      .where(eq(atelierAccounts.name, newName));
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
      plmStage: "identify",
      // v1/v2 lockstep at create time so the new kanban + forecast see the
      // opportunity in the right column from the moment it's persisted.
      salesStage: deriveSalesStage("identify", probabilityPct),
      partnerOwnerId,
      engagementLeadId,
      dealSizeHypothesis: input.dealSizeUsd ?? 250000,
      probabilityPct,
      nextMilestone,
      nextMilestoneDate,
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

  let scoutRunId: string | null = null;
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
      if (out) await persistBriefAndFacts(opp.id, runId, out);
    } catch (err) {
      // Scout failure shouldn't block opp creation.
      console.warn("[atelier] scout failed", err);
    }
  }

  res.status(201).json({
    opportunity: await buildOppWire(opp),
    scoutRunId,
  });
});

async function persistBriefAndFacts(
  oppId: string,
  runId: string,
  out: PursuitScoutOutput,
): Promise<void> {
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
    citations: out.facts ?? [],
    confidence: out.confidence ?? "amber",
  });
  // Insert facts (don't dedupe — run history is the audit).
  // Every fact emitted by the scout into the brief is by definition
  // `included_in_brief=true`; the partner can later flip POV inclusion
  // on a per-fact basis via the promote endpoint.
  if (out.facts?.length) {
    await db.insert(atelierResearchFacts).values(
      out.facts.map((f) => ({
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
}

// =============================================================
// PATCH stage  (5C gate enforced for `pursue`)
// =============================================================
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
  if (toStage === "pursue") {
    const q = opp.qualify5c ?? null;
    const decision = opp.goNoGoDecision ?? null;
    const filled = q && (["client", "competition", "capability", "capacity", "contract"] as const).every(
      (k) => typeof q[k] === "string" && q[k]!.trim().length > 0,
    );
    if (!filled || !decision || decision.decision !== "go") {
      res.status(412).json({
        error: "qualifier-required",
      });
      return;
    }
  }
  // v1/v2 lockstep: derive a sales_stage from the legacy plm_stage so the
  // v2 kanban + forecast remain consistent when callers hit the v1 route.
  const derivedSales = deriveSalesStage(toStage, opp.probabilityPct);
  const [updated] = await db
    .update(atelierOpportunities)
    .set({
      plmStage: toStage,
      salesStage: derivedSales,
      daysInStage: 0,
      updatedAt: new Date(),
    })
    .where(eq(atelierOpportunities.id, opp.id))
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: opp.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "opportunity.stage_change",
    payload: { from: opp.plmStage, to: toStage, derivedSalesStage: derivedSales, rationale },
    payloadSummary: `${me.name} moved "${opp.name}" from ${opp.plmStage} → ${toStage}${rationale ? ` (${rationale.slice(0, 100)})` : ""}.`,
  });
  res.json(await buildOppWire(updated));
});

// =============================================================
// 5C Qualifier  (GET + POST)
// =============================================================
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
  });
});

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

router.get("/opportunities/:oppId/povs", async (req, res) => {
  const rows = await db
    .select()
    .from(atelierPovs)
    .where(and(eq(atelierPovs.opportunityId, req.params.oppId), isNull(atelierPovs.deletedAt)))
    .orderBy(desc(atelierPovs.createdAt));
  res.json(rows.map(povWire));
});

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

  const transcriptId = rid("trn");
  await db.insert(atelierTranscripts).values({
    id: transcriptId,
    cleanedText: parsed.data.transcript,
    createdByUserId: me.id,
  });

  const { runId, output } = await runMeetingScribe({
    opportunityId: opp.id,
    opportunityName: opp.name,
    transcript: parsed.data.transcript,
    kind: parsed.data.kind,
    priorBrief,
    triggeredByUserId: me.id,
    actorLabel: "Meeting Scribe",
  });

  const meetingId = rid("mtg");
  const [meeting] = await db
    .insert(atelierMeetings)
    .values({
      id: meetingId,
      parentType: "opportunity",
      parentId: opp.id,
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
// Engagement-side meetings (post-contract)
// =============================================================
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
  // Server-side state transition: if the human approved AND the run was a
  // genuine Claude (or mock_config) run (NOT a mock_fallback / blocked run),
  // flip the linked record's status from 'draft' → 'official'. This is the
  // only way records become "committed memory".
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

  // Resolve the canonical from-stage. If the row still carries a legacy
  // 10-stage label, map it through migrateLegacyStage so the gate logic
  // sees the new taxonomy. We also remember the legacy label so the
  // transition row can preserve it (`legacy_stage_label`).
  const rawFromStage = isSalesStage(opp.salesStage)
    ? (opp.salesStage as SalesStage)
    : (deriveSalesStage(opp.plmStage, opp.probabilityPct) as SalesStage);
  const legacyMapped = migrateLegacyStage(opp.salesStage as string);
  const fromSales: SalesStage = legacyMapped?.stage ?? rawFromStage;
  const legacyStageLabel = legacyMapped ? (opp.salesStage as string) : null;

  const to = toStage as SalesStage;

  // ---- Per-transition gates (Task #295) -------------------------------
  // The pure helper is unit-tested in tests/funnel/funnel.test.ts; the
  // route's job is just to map its result onto an HTTP response.
  const gateError = validateStageTransition({
    fromStage: fromSales,
    toStage: to,
    partnerOverride: !!partnerOverride,
    qualify5c: opp.qualify5c ?? null,
    goNoGoDecision: opp.goNoGoDecision ?? null,
    decider,
    verbalCommitDate,
    signaturePath,
    signedInstrumentFileId,
    evidenceArtifactIds: evidenceArtifactIds ?? [],
    reasonCode,
    subStatus,
  });
  if (gateError) {
    const status = gateError.gate === "invalid_sub_status" ? 400 : 412;
    res.status(status).json({ error: "stage-gate-failed", ...gateError });
    return;
  }

  const priorProb = opp.probabilityPct;
  const newProb =
    typeof newProbabilityPct === "number" && newProbabilityPct !== null
      ? newProbabilityPct
      : SALES_STAGE_DEFAULT_PROB[to];
  const derivedPlm = SALES_TO_PLM[to];
  const now = new Date();

  // Sticky runner_entered_at / contract_signed_at — once set, never
  // overwritten — so a Contract→Runner→Contract bounce never re-fires
  // the Charter Architect.
  const sticky = computeStickyStageTimestamps({
    toStage: to,
    now,
    prior: {
      runnerEnteredAt: opp.runnerEnteredAt ?? null,
      contractSignedAt: opp.contractSignedAt ?? null,
    },
  });
  const runnerEnteredAt = sticky.runnerEnteredAt;
  const contractSignedAt = sticky.contractSignedAt;
  // finalPlmStage captures the last-known stage of the funnel for closed
  // deals (mirrors the legacy 10-stage label when applicable).
  const finalPlmStage = isTerminalStage(to)
    ? (legacyStageLabel ?? fromSales)
    : opp.finalPlmStage;

  const [updated] = await db
    .update(atelierOpportunities)
    .set({
      salesStage: to,
      plmStage: derivedPlm,
      probabilityPct: newProb,
      subStatus: subStatus ?? opp.subStatus,
      runnerEnteredAt,
      contractSignedAt,
      finalPlmStage,
      nextMilestone: nextMilestone ?? opp.nextMilestone,
      nextMilestoneDate: nextMilestoneDate ?? opp.nextMilestoneDate,
      daysInStage: 0,
      updatedAt: now,
    })
    .where(eq(atelierOpportunities.id, opp.id))
    .returning();

  const transitionId = rid("stxn");
  await db.insert(atelierOpportunityStageTransitions).values({
    id: transitionId,
    opportunityId: opp.id,
    fromStage: fromSales,
    toStage: to,
    transitionedByUserId: me.id,
    rationaleText: rationaleText.trim(),
    evidenceArtifactIds: evidenceArtifactIds ?? [],
    priorProbabilityPct: priorProb,
    newProbabilityPct: newProb,
    nextMilestone: nextMilestone ?? null,
    nextMilestoneDate: nextMilestoneDate ?? null,
    agentRecommended: false,
    partnerOverride: !!partnerOverride,
    // Task #295 — preserve gate evidence on the transition row.
    legacyStageLabel,
    decider: decider ?? null,
    verbalCommitDate: verbalCommitDate ?? null,
    signaturePath: signaturePath ?? null,
    signedInstrumentFileId: signedInstrumentFileId ?? null,
    reasonCode: reasonCode ?? null,
  });
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: opp.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "opportunity.stage_transition",
    payload: {
      from: fromSales,
      to: toStage,
      priorProb,
      newProb,
      partnerOverride: !!partnerOverride,
      evidenceCount: (evidenceArtifactIds ?? []).length,
    },
    payloadSummary: `${me.name} moved "${opp.name}" ${fromSales} → ${to} (prob ${priorProb}% → ${newProb}%): ${rationaleText.slice(0, 120)}`,
  });

  // Task #295 — Charter Architect auto-fire on Contract entry.
  // When an opp lands in `contract` for the first time, kick off the
  // Charter Architect for the linked engagement (idempotent: skip if a
  // charter version already exists). If no engagement is linked yet, we
  // surface a Pane A item for the partner owner instead of failing.
  if (to === "contract" && !opp.contractSignedAt) {
    try {
      const [eng] = await db
        .select({ id: atelierEngagements.id, name: atelierEngagements.name })
        .from(atelierEngagements)
        .where(
          and(
            eq(atelierEngagements.opportunityId, opp.id),
            isNull(atelierEngagements.deletedAt),
          ),
        )
        .limit(1);
      if (eng) {
        const [existingCharter] = await db
          .select({ id: atelierCharterVersions.id })
          .from(atelierCharterVersions)
          .where(eq(atelierCharterVersions.engagementId, eng.id))
          .limit(1);
        if (!existingCharter) {
          // Best-effort account name lookup. The Charter Architect only
          // needs a non-empty seed; we fall back to the account id if
          // the join returns nothing.
          const [acct] = await db
            .select({ name: atelierAccounts.name })
            .from(atelierAccounts)
            .where(eq(atelierAccounts.id, opp.accountId))
            .limit(1);
          await runCharterArchitect({
            engagementId: eng.id,
            engagementName: eng.name,
            accountName: acct?.name ?? opp.accountId,
            wonProposalSummary: `${opp.name} — auto-fired on Contract entry. Re-derive from won-proposal artifacts and seeded context.`,
            kickoffTranscriptExcerpt: null,
            triggeredByUserId: me.id,
            actorLabel: "Charter Architect",
          });
        }
      } else {
        await db.insert(atelierPaneAItems).values({
          id: rid("pane"),
          orgId: me.orgId,
          userId: opp.partnerOwnerId,
          priority: "high",
          title: `Open engagement for "${opp.name}"`,
          summary: `${opp.name} just hit Contract — open the engagement so Charter Architect can run.`,
          hrefKind: "opportunity",
          hrefTargetId: opp.id,
          dueLabel: "now",
          sortKey: 10,
        });
      }
    } catch (err) {
      req.log?.warn?.({ err, oppId: opp.id }, "charter auto-fire failed (non-blocking)");
    }
  }

  // Task #241 / Task #295 — Closed-opportunity debrief hook.
  // When an opp closes (lost | no_decision | withdrawn — `contract` is the
  // working "won" state), enqueue a pending Win/Loss debrief and a Pane A
  // item for the partner owner, with a 14-day SLA before the partner-
  // override-required gate fires (PRD §5.2). Never blocks the close.
  const CLOSED_STAGES: SalesStage[] = ["contract", "lost", "no_decision", "withdrawn"];
  if (CLOSED_STAGES.includes(to)) {
    // Best-effort: never fail the stage-transition response because of a
    // debrief-side-effect failure. The 14-day SLA gate fires elsewhere.
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
      if (!existing.length) {
        const debriefId = rid("wld");
        const dueAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        await db.insert(atelierWinLossDebriefs).values({
          id: debriefId,
          orgId: me.orgId,
          opportunityId: opp.id,
          outcome: to,
          status: "pending",
          sellerPerceivedReasons: [],
          partnerOwnerUserId: opp.partnerOwnerId,
          engagementLeadUserId: opp.engagementLeadId,
          dueAt,
          createdByUserId: me.id,
        });
        await db.insert(atelierPaneAItems).values({
          id: rid("pane"),
          orgId: me.orgId,
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
          payload: { debriefId, outcome: toStage, dueAt: dueAt.toISOString() },
          payloadSummary: `Atelier enqueued Win/Loss debrief for ${opp.name} (due in 14 days)`,
        });
      }
    } catch (err) {
      req.log?.warn?.({ err, oppId: opp.id }, "winloss debrief enqueue failed (non-blocking)");
    }
  }

  res.json({
    opportunity: await buildOppWire(updated),
    transition: {
      id: transitionId,
      opportunityId: opp.id,
      fromStage: fromSales,
      toStage,
      transitionedByUserId: me.id,
      transitionedByName: me.name,
      rationaleText: rationaleText.trim(),
      evidenceArtifactIds: evidenceArtifactIds ?? [],
      priorProbabilityPct: priorProb,
      newProbabilityPct: newProb,
      nextMilestone: nextMilestone ?? null,
      nextMilestoneDate: nextMilestoneDate ?? null,
      agentRecommended: false,
      partnerOverride: !!partnerOverride,
      createdAt: new Date().toISOString(),
    },
  });
});

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
    const s = (isSalesStage(o.salesStage)
      ? o.salesStage
      : deriveSalesStage(o.plmStage, o.probabilityPct)) as SalesStage;
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
router.post("/pipeline/forecast/run", runForecasterHandler);
// Canonical agent-namespaced alias.
router.post("/agents/pipeline-forecaster/run", runForecasterHandler);

// Pricing Strategist alias — issues a 307 so the original method/body are
// preserved against /opportunities/:oppId/pricing/strategist. Avoids router
// re-entry / middleware double-firing.
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

export default router;
