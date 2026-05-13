/**
 * Atelier — Task #241 Win/Loss routes.
 *
 * Endpoints
 *   GET    /opportunities/:oppId/win-loss            -> debrief snapshot
 *   PATCH  /opportunities/:oppId/win-loss/seller     -> seller view (free fields)
 *   POST   /opportunities/:oppId/win-loss/transcript -> async buyer transcript
 *   POST   /opportunities/:oppId/win-loss/run        -> Win/Loss Interviewer
 *   POST   /opportunities/:oppId/win-loss/approve    -> partner approves debrief
 *   GET    /win-loss/debriefs                         -> library
 *   GET    /win-themes                                -> theme library
 *   POST   /win-themes/curate                         -> Theme Curator run
 *
 * Uses ATELIER_MOCK_AGENTS=1 path automatically through callClaudeJson.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierOpportunities,
  atelierAccounts,
  atelierWinLossDebriefs,
  atelierWinThemes,
  atelierAuditEvents,
  atelierPaneAItems,
} from "@workspace/db";
import {
  runWinLossInterviewer,
  runThemeCurator,
} from "../../lib/atelier-agents/runner.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

const router: IRouter = Router();

async function loadDebrief(oppId: string) {
  const [row] = await db
    .select()
    .from(atelierWinLossDebriefs)
    .where(
      and(
        eq(atelierWinLossDebriefs.opportunityId, oppId),
        isNull(atelierWinLossDebriefs.deletedAt),
      ),
    )
    .orderBy(desc(atelierWinLossDebriefs.createdAt))
    .limit(1);
  return row ?? null;
}

router.get("/opportunities/:oppId/win-loss", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const debrief = await loadDebrief(req.params.oppId);
  res.json({ debrief });
});

router.patch("/opportunities/:oppId/win-loss/seller", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const debrief = await loadDebrief(req.params.oppId);
  if (!debrief) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  const body = req.body as {
    sellerPerceivedReasons?: string[];
    sellerNotes?: string | null;
  };
  const [updated] = await db
    .update(atelierWinLossDebriefs)
    .set({
      sellerPerceivedReasons: body.sellerPerceivedReasons ?? debrief.sellerPerceivedReasons,
      sellerNotes: body.sellerNotes ?? debrief.sellerNotes,
      updatedAt: new Date(),
    })
    .where(eq(atelierWinLossDebriefs.id, debrief.id))
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "winloss.seller_updated",
    payload: { debriefId: debrief.id, reasonCount: (body.sellerPerceivedReasons ?? []).length },
    payloadSummary: `${me.name} updated seller view on Win/Loss debrief`,
  });
  res.json({ debrief: updated });
});

router.post("/opportunities/:oppId/win-loss/transcript", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const debrief = await loadDebrief(req.params.oppId);
  if (!debrief) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  const body = req.body as { transcript?: string; uploadedAt?: string };
  if (!body.transcript || body.transcript.trim().length < 20) {
    res.status(400).json({ error: "transcript-too-short" });
    return;
  }
  const [updated] = await db
    .update(atelierWinLossDebriefs)
    .set({
      buyerTranscript: body.transcript,
      buyerTranscriptUploadedAt: new Date(),
      status: debrief.status === "pending" ? "ingested" : debrief.status,
      updatedAt: new Date(),
    })
    .where(eq(atelierWinLossDebriefs.id, debrief.id))
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "winloss.transcript_uploaded",
    payload: { debriefId: debrief.id, chars: body.transcript.length },
    payloadSummary: `${me.name} uploaded ${body.transcript.length}-char buyer transcript`,
  });
  res.json({ debrief: updated });
});

router.post("/opportunities/:oppId/win-loss/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const debrief = await loadDebrief(req.params.oppId);
  if (!debrief) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  const [opp] = await db
    .select()
    .from(atelierOpportunities)
    .where(eq(atelierOpportunities.id, req.params.oppId));
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const { runId, output } = await runWinLossInterviewer({
    opportunityId: opp.id,
    opportunityName: opp.name,
    outcome: debrief.outcome,
    sellerPerceivedReasons: (debrief.sellerPerceivedReasons as string[]) ?? [],
    buyerTranscript: debrief.buyerTranscript ?? null,
    triggeredByUserId: me.id,
    actorLabel: me.name,
  });
  const [updated] = await db
    .update(atelierWinLossDebriefs)
    .set({
      status: "synthesized",
      buyerAuthenticReasons: output.buyerAuthenticReasons,
      hiddenCompetitor: output.hiddenCompetitor,
      themes: output.themes,
      whatWeWouldDoDifferently: output.whatWeWouldDoDifferently,
      suggestedAtelierLessons: output.suggestedAtelierLessons,
      lastRunId: runId,
      synthesizedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierWinLossDebriefs.id, debrief.id))
    .returning();
  res.json({ debrief: updated, runId, output });
});

router.post("/opportunities/:oppId/win-loss/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const debrief = await loadDebrief(req.params.oppId);
  if (!debrief) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  if (debrief.status !== "synthesized") {
    res.status(409).json({ error: "not-yet-synthesized" });
    return;
  }
  const [updated] = await db
    .update(atelierWinLossDebriefs)
    .set({
      status: "approved",
      approvedByUserId: me.id,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(atelierWinLossDebriefs.id, debrief.id))
    .returning();
  // Resolve the Pane A reminder for the partner.
  await db
    .update(atelierPaneAItems)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(atelierPaneAItems.hrefKind, "opportunity"),
        eq(atelierPaneAItems.hrefTargetId, req.params.oppId),
        isNull(atelierPaneAItems.resolvedAt),
      ),
    );
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "winloss.approved",
    payload: { debriefId: debrief.id },
    payloadSummary: `${me.name} approved Win/Loss debrief`,
  });
  res.json({ debrief: updated });
});

router.get("/win-loss/debriefs", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierWinLossDebriefs)
    .where(isNull(atelierWinLossDebriefs.deletedAt))
    .orderBy(desc(atelierWinLossDebriefs.createdAt))
    .limit(100);
  // Decorate with opportunity name + account.
  const oppIds = [...new Set(rows.map((r) => r.opportunityId))];
  const opps = oppIds.length
    ? await db
        .select()
        .from(atelierOpportunities)
        .where(inArray(atelierOpportunities.id, oppIds))
    : [];
  const oppMap = new Map(opps.map((o) => [o.id, o]));
  const items = rows.map((r) => {
    const o = oppMap.get(r.opportunityId);
    return {
      id: r.id,
      opportunityId: r.opportunityId,
      opportunityName: o?.name ?? r.opportunityId,
      outcome: r.outcome,
      status: r.status,
      hiddenCompetitor: r.hiddenCompetitor,
      themeCount: Array.isArray(r.themes) ? (r.themes as unknown[]).length : 0,
      dueAt: r.dueAt?.toISOString() ?? null,
      synthesizedAt: r.synthesizedAt?.toISOString() ?? null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
  res.json({ items });
});

router.get("/win-themes", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierWinThemes)
    .where(isNull(atelierWinThemes.deletedAt))
    .orderBy(desc(atelierWinThemes.supportCount));
  res.json({ themes: rows });
});

router.post("/win-themes/curate", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Pull approved debriefs' themes as input.
  const debriefs = await db
    .select()
    .from(atelierWinLossDebriefs)
    .where(
      and(
        eq(atelierWinLossDebriefs.status, "approved"),
        isNull(atelierWinLossDebriefs.deletedAt),
      ),
    );
  const debriefThemes: Array<{
    tag: string;
    name: string;
    polarity: string;
    debriefId: string;
    quote: string;
  }> = [];
  for (const d of debriefs) {
    const arr = (d.themes as Array<{ tag?: string; name?: string; polarity?: string; evidenceQuote?: string }>) ?? [];
    for (const t of arr) {
      if (!t.tag) continue;
      debriefThemes.push({
        tag: t.tag,
        name: t.name ?? t.tag,
        polarity: t.polarity ?? "win",
        debriefId: d.id,
        quote: t.evidenceQuote ?? "",
      });
    }
  }
  // Open opps for suggestion targeting.
  const openOpps = await db
    .select({ id: atelierOpportunities.id })
    .from(atelierOpportunities)
    .where(
      and(
        isNull(atelierOpportunities.deletedAt),
        inArray(atelierOpportunities.salesStage, [
          "shape",
          "qualifying",
          "proposal_in_flight",
          "submitted",
        ]),
      ),
    );
  const { runId, output } = await runThemeCurator({
    triggeredByUserId: me.id,
    actorLabel: me.name,
    debriefThemes,
    openOpportunityIds: openOpps.map((o) => o.id),
  });
  // Upsert win themes in-place.
  for (const t of output.upsertThemes) {
    const [existing] = await db
      .select()
      .from(atelierWinThemes)
      .where(
        and(eq(atelierWinThemes.tag, t.tag), isNull(atelierWinThemes.deletedAt)),
      )
      .limit(1);
    if (existing) {
      await db
        .update(atelierWinThemes)
        .set({
          name: t.name,
          description: t.description,
          polarity: t.polarity,
          contributingDebriefIds: t.contributingDebriefIds,
          supportCount: t.contributingDebriefIds.length,
          offeringTags: t.offeringTags,
          sectorTags: t.sectorTags,
          positioningLine: t.positioningLine,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(atelierWinThemes.id, existing.id));
    } else {
      await db.insert(atelierWinThemes).values({
        id: rid("wth"),
        orgId: me.orgId,
        tag: t.tag,
        name: t.name,
        description: t.description,
        polarity: t.polarity,
        contributingDebriefIds: t.contributingDebriefIds,
        supportCount: t.contributingDebriefIds.length,
        offeringTags: t.offeringTags,
        sectorTags: t.sectorTags,
        positioningLine: t.positioningLine,
        lastSeenAt: new Date(),
        createdByUserId: me.id,
      });
    }
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "atelier",
    entityId: "win_themes",
    actorType: "agent",
    actorId: "theme_curator",
    actorLabel: "Theme Curator",
    action: "winthemes.curated",
    payload: { runId, upserts: output.upsertThemes.length },
    payloadSummary: `Theme Curator refreshed ${output.upsertThemes.length} themes`,
  });
  res.json({ runId, output });
});

export default router;
