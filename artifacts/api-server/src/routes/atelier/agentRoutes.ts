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
} from "@workspace/db";
import {
  SALES_TO_PLM,
  SALES_STAGE_DEFAULT_PROB,
  STALLED_THRESHOLD_DAYS,
  deriveSalesStage,
  isSalesStage,
  type SalesStage,
} from "../../lib/atelier-agents/pipeline.js";
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
      salesStage !== "signed" &&
      salesStage !== "lost_no_decision" &&
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

  // Find or create account.
  let [acct] = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.name, input.accountName));
  if (!acct) {
    const acctId = `acct_${slugify(input.accountName)}_${Math.random().toString(36).slice(2, 6)}`;
    [acct] = await db
      .insert(atelierAccounts)
      .values({
        id: acctId,
        name: input.accountName,
        country: input.accountCountry,
        sector: input.accountSector,
        createdByUserId: me.id,
      })
      .returning();
  }

  const oppId = `opp_${slugify(input.name)}_${Math.random().toString(36).slice(2, 6)}`;
  const [opp] = await db
    .insert(atelierOpportunities)
    .values({
      id: oppId,
      slug: slugify(input.name),
      name: input.name,
      accountId: acct.id,
      plmStage: "identify",
      partnerOwnerId: me.id,
      engagementLeadId: me.id,
      dealSizeHypothesis: input.dealSizeUsd ?? 250000,
      probabilityPct: 25,
      nextMilestone: "Run Pursuit Scout · qualify 5C",
      sourceLead: input.contextBlurb || "manual",
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
    payload: { name: opp.name, account: acct.name },
    payloadSummary: `${me.name} created opportunity "${opp.name}" on ${acct.name}.`,
  });

  let scoutRunId: string | null = null;
  if (input.runScout !== false) {
    try {
      const { runId } = await runPursuitScout({
        opportunityId: opp.id,
        accountName: acct.name,
        accountCountry: acct.country,
        accountSector: acct.sector,
        opportunityName: opp.name,
        contextBlurb: input.contextBlurb ?? "",
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
    if (r.agentId === "pursuit_scout") {
      await db
        .update(atelierBriefs)
        .set({ status: "official", approvedAt: ts, approvedByUserId: me.id, updatedAt: ts })
        .where(and(eq(atelierBriefs.runId, r.id), isNull(atelierBriefs.deletedAt)));
    } else if (r.agentId === "meeting_scribe") {
      await db
        .update(atelierMeetings)
        .set({ status: "official", committedAt: ts, committedByUserId: me.id, updatedAt: ts })
        .where(and(eq(atelierMeetings.runId, r.id), isNull(atelierMeetings.deletedAt)));
    } else if (r.agentId === "pov_author") {
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
  const {
    toStage,
    rationaleText,
    evidenceArtifactIds,
    newProbabilityPct,
    nextMilestone,
    nextMilestoneDate,
    partnerOverride,
  } = parsed.data;

  // Gate: late-stage moves require a completed 5C qualifier with go decision,
  // unless an explicit partner_override is supplied.
  const lateStages: SalesStage[] = [
    "proposal_in_flight",
    "submitted",
    "verbal_commit",
    "signed",
  ];
  if (lateStages.includes(toStage as SalesStage) && !partnerOverride) {
    const q = opp.qualify5c ?? null;
    const decision = opp.goNoGoDecision ?? null;
    const filled =
      q &&
      (["client", "competition", "capability", "capacity", "contract"] as const).every(
        (k) => typeof q[k] === "string" && q[k]!.trim().length > 0,
      );
    if (!filled || !decision || decision.decision !== "go") {
      res.status(412).json({ error: "qualifier-required" });
      return;
    }
  }

  const fromSales = (isSalesStage(opp.salesStage)
    ? opp.salesStage
    : deriveSalesStage(opp.plmStage, opp.probabilityPct)) as SalesStage;
  const priorProb = opp.probabilityPct;
  const newProb =
    typeof newProbabilityPct === "number" && newProbabilityPct !== null
      ? newProbabilityPct
      : SALES_STAGE_DEFAULT_PROB[toStage as SalesStage];
  const derivedPlm = SALES_TO_PLM[toStage as SalesStage];

  const [updated] = await db
    .update(atelierOpportunities)
    .set({
      salesStage: toStage,
      plmStage: derivedPlm,
      probabilityPct: newProb,
      nextMilestone: nextMilestone ?? opp.nextMilestone,
      nextMilestoneDate: nextMilestoneDate ?? opp.nextMilestoneDate,
      daysInStage: 0,
      updatedAt: new Date(),
    })
    .where(eq(atelierOpportunities.id, opp.id))
    .returning();

  const transitionId = rid("stxn");
  await db.insert(atelierOpportunityStageTransitions).values({
    id: transitionId,
    opportunityId: opp.id,
    fromStage: fromSales,
    toStage,
    transitionedByUserId: me.id,
    rationaleText: rationaleText.trim(),
    evidenceArtifactIds: evidenceArtifactIds ?? [],
    priorProbabilityPct: priorProb,
    newProbabilityPct: newProb,
    nextMilestone: nextMilestone ?? null,
    nextMilestoneDate: nextMilestoneDate ?? null,
    agentRecommended: false,
    partnerOverride: !!partnerOverride,
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
    payloadSummary: `${me.name} moved "${opp.name}" ${fromSales} → ${toStage} (prob ${priorProb}% → ${newProb}%): ${rationaleText.slice(0, 120)}`,
  });

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
    if (s !== "signed" && s !== "lost_no_decision" && s !== "withdrawn") {
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

router.post("/pipeline/forecast/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const summary = await computeForecast();
  // Side effect: agent runner records audit + flags stalled deals into Pane A.
  try {
    await runPipelineForecaster({ actorId: me.id, actorLabel: me.name, summary });
  } catch (e) {
    // Forecaster is mock-first; never fail the HTTP response on a side-effect error.
    // eslint-disable-next-line no-console
    console.error("[pipeline-forecaster] side-effect error", e);
  }
  res.json(AtelierGetPipelineForecastResponse.parse(summary));
});

export default router;
