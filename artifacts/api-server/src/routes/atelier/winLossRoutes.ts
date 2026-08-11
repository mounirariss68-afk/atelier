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
 * Dispatches through callClaudeJson (live Sonnet/Haiku — no mock fallback).
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
  atelierAssets,
} from "@workspace/db";
import {
  runWinLossInterviewer,
  runThemeCurator,
} from "../../lib/atelier-agents/runner.js";
import { withRls } from "./rls";

// Either the pooled db handle or a transaction-scoped executor bound by
// withRls(). Both expose the .select()/.update()/.insert() surface the
// debrief handlers use, so loadDebrief and the read/edit handlers can run
// under the RLS GUCs (defense-in-depth; primary org isolation is already
// enforced by the RLS policies themselves).
type TxOrDb =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

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

async function loadDebrief(oppId: string, exec: TxOrDb = db) {
  const [row] = await exec
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

// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/win-loss", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const debrief = await withRls(req, (tx) => loadDebrief(req.params.oppId, tx));
  res.json({ debrief });
});

// @cli-skip: pending Task #340 read-parity migration
router.patch("/opportunities/:oppId/win-loss/seller", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const body = req.body as {
    sellerPerceivedReasons?: string[];
    sellerNotes?: string | null;
  };
  const result = await withRls(req, async (tx) => {
    const debrief = await loadDebrief(req.params.oppId, tx);
    if (!debrief) return { notFound: true } as const;
    const [updated] = await tx
      .update(atelierWinLossDebriefs)
      .set({
        sellerPerceivedReasons: body.sellerPerceivedReasons ?? debrief.sellerPerceivedReasons,
        sellerNotes: body.sellerNotes ?? debrief.sellerNotes,
        updatedAt: new Date(),
      })
      .where(eq(atelierWinLossDebriefs.id, debrief.id))
      .returning();
    await tx.insert(atelierAuditEvents).values({
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
    return { updated } as const;
  });
  if ("notFound" in result) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  res.json({ debrief: result.updated });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/win-loss/transcript", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const body = req.body as { transcript?: string; uploadedAt?: string };
  if (!body.transcript || body.transcript.trim().length < 20) {
    res.status(400).json({ error: "transcript-too-short" });
    return;
  }
  const transcript = body.transcript;
  const result = await withRls(req, async (tx) => {
    const debrief = await loadDebrief(req.params.oppId, tx);
    if (!debrief) return { notFound: true } as const;
    const [updated] = await tx
      .update(atelierWinLossDebriefs)
      .set({
        buyerTranscript: transcript,
        buyerTranscriptUploadedAt: new Date(),
        status: debrief.status === "pending" ? "ingested" : debrief.status,
        updatedAt: new Date(),
      })
      .where(eq(atelierWinLossDebriefs.id, debrief.id))
      .returning();
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "opportunity",
      entityId: req.params.oppId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "winloss.transcript_uploaded",
      payload: { debriefId: debrief.id, chars: transcript.length },
      payloadSummary: `${me.name} uploaded ${transcript.length}-char buyer transcript`,
    });
    return { updated } as const;
  });
  if ("notFound" in result) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  res.json({ debrief: result.updated });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/win-loss/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const debrief = await loadDebrief(req.params.oppId);
  if (!debrief) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  // Evidence-binding guardrail (PRD §5.2): NO transcript = NO themes.
  // Server-side enforcement, not just prompt text. The buyer's view must
  // exist (transcript ≥20 chars) before synthesis can run. Partner override
  // path is separate.
  const transcript = (debrief.buyerTranscript ?? "").trim();
  if (transcript.length < 20) {
    res.status(409).json({
      error: "transcript-required",
      detail:
        "Win/Loss synthesis requires a buyer transcript (≥20 chars). Upload one or use /win-loss/override for partner-rationale path.",
    });
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
      suggestedAtelierLessons: output.suggestedAtelierLessons.map((l) => ({
        title: l.title,
        summary: (l as { summary?: string; abstract?: string }).summary
          ?? (l as { summary?: string; abstract?: string }).abstract
          ?? "",
        kind: l.kind as string,
      })),
      lastRunId: runId,
      synthesizedAt: new Date(),
      // Conductor of record at synthesis = the agent. Partner approval
      // overwrites this to partner_off_team.
      conductorRole: "agent",
      updatedAt: new Date(),
    })
    .where(eq(atelierWinLossDebriefs.id, debrief.id))
    .returning();
  res.json({ debrief: updated, runId, output });
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/win-loss/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
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
  // Task #653 — lessons verification gate. Approval publishes the debrief's
  // suggested lessons to Atelier library, so a debrief with no captured
  // lessons cannot be approved/closed — that would close the loop without
  // banking any institutional learning. Require at least one lesson with a
  // non-empty title before approval.
  const pendingLessons = (debrief.suggestedAtelierLessons as Array<{ title?: string }>) ?? [];
  const hasVerifiedLessons = pendingLessons.some(
    (l) => typeof l?.title === "string" && l.title.trim().length > 0,
  );
  if (!hasVerifiedLessons) {
    res.status(422).json({
      error: "lessons-required",
      detail:
        "This debrief has no captured lessons. Synthesize or add at least one Atelier lesson before approving — approval publishes lessons to the library.",
    });
    return;
  }
  // Win/Loss conductor guardrail (PRD §5.2): the deal team (partner_owner
  // + engagement_lead) MUST NOT be the conductor of their own debrief.
  // Approver (= conductor of record) must be either an off-deal partner
  // or "agent" (auto-approve via system actor). Block deal-team self-approve.
  const [opp] = await db
    .select({
      id: atelierOpportunities.id,
      partnerOwnerId: atelierOpportunities.partnerOwnerId,
      engagementLeadId: atelierOpportunities.engagementLeadId,
    })
    .from(atelierOpportunities)
    .where(eq(atelierOpportunities.id, req.params.oppId));
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  // Task #8 — the debrief's own author and the buyer-interview author are
  // just as conflicted as the deal team: nobody approves their own writeup.
  if (debrief.createdByUserId === me.id || debrief.buyerInterviewConductedByUserId === me.id) {
    res.status(403).json({
      error: "author-cannot-approve",
      detail:
        "You authored this debrief or its buyer interview. A different off-deal partner must approve it.",
    });
    return;
  }
  if (opp.partnerOwnerId === me.id || opp.engagementLeadId === me.id) {
    res.status(403).json({
      error: "deal-team-cannot-conduct",
      detail:
        "Win/Loss conductor must be an off-deal partner (or the agent). Deal-team partners cannot publish their own debrief.",
    });
    return;
  }
  // Also block if the buyer interview itself was authored by a deal-team
  // member — even if an off-team partner is approving, a deal-team-authored
  // interview compromises the conductor-of-record. (PRD §5.2 guardrail).
  const interviewAuthorId = debrief.buyerInterviewConductedByUserId;
  if (
    interviewAuthorId &&
    (interviewAuthorId === opp.partnerOwnerId ||
      interviewAuthorId === opp.engagementLeadId)
  ) {
    res.status(403).json({
      error: "deal-team-authored-interview",
      detail:
        "Buyer interview was authored by a deal-team member. Re-conduct the buyer interview off-team before approval.",
    });
    return;
  }
  const conductorRole = "partner_off_team";
  const [updated] = await db
    .update(atelierWinLossDebriefs)
    .set({
      status: "approved",
      approvedByUserId: me.id,
      approvedAt: new Date(),
      conductorRole,
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
  // Publish suggested atelier lessons as atelierAssets with provenance
  // pointing back to this debrief. PRD §5.2: approval = publish to library.
  const lessons = (debrief.suggestedAtelierLessons as Array<{
    title?: string;
    summary?: string;
    abstract?: string;
    kind?: string;
  }>) ?? [];
  const publishedAssetIds: string[] = [];
  for (const lesson of lessons) {
    const text = lesson.summary ?? lesson.abstract;
    if (!lesson.title || !text) continue;
    const aid = rid("ast");
    await db.insert(atelierAssets).values({
      id: aid,
      orgId: me.orgId,
      kind: (lesson.kind as string) ?? "learning",
      title: lesson.title,
      abstract: text,
      provenance: `winloss_debrief:${debrief.id}:opp:${req.params.oppId}`,
      createdByUserId: me.id,
    });
    publishedAssetIds.push(aid);
  }
  if (publishedAssetIds.length) {
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "opportunity",
      entityId: req.params.oppId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "winloss.lessons_published",
      payload: { debriefId: debrief.id, assetIds: publishedAssetIds },
      payloadSummary: `${me.name} published ${publishedAssetIds.length} atelier lesson(s) from debrief`,
    });
  }
  // Auto-refresh Win Themes — approval is the trigger for re-curation,
  // no separate manual call required.
  try {
    await runThemeCuratorAndPersist(me, "auto_on_approve");
  } catch (err) {
    req.log?.warn?.({ err }, "auto-curate after approve failed (non-blocking)");
  }
  res.json({ debrief: updated, publishedAssetIds });
});

// Compliance loop (PRD §5.2): scan for debriefs past their 14-day SLA
// that are still not approved, and (a) escalate the partner Pane A item to
// red/critical, (b) write an audit row noting that close-without-debrief
// now requires partner override + rationale to remove the gate.
//
// Task #653 — extracted into a reusable, transport-free function so both the
// manual REST trigger AND the scheduler (lib/scheduler.ts) run identical logic.
// Without an automatic trigger the SLA escalation was pull-only, so overdue
// debriefs never actually escalated unless someone remembered to POST.
export async function runWinLossOverdueScan(): Promise<{
  scanned: number;
  escalated: number;
}> {
  const now = new Date();
  const overdue = await db
    .select()
    .from(atelierWinLossDebriefs)
    .where(
      and(
        isNull(atelierWinLossDebriefs.deletedAt),
        isNull(atelierWinLossDebriefs.approvedAt),
      ),
    );
  let escalated = 0;
  for (const d of overdue) {
    if (!d.dueAt || d.dueAt > now) continue;
    if (d.status === "approved") continue;
    // Escalate Pane A item to RED (priority=critical, dueLabel "OVERDUE").
    await db
      .update(atelierPaneAItems)
      .set({
        priority: "critical",
        dueLabel: "OVERDUE",
        sortKey: 5,
        summary: `Win/Loss debrief OVERDUE — partner override + rationale now required to clear gate.`,
      })
      .where(
        and(
          eq(atelierPaneAItems.hrefKind, "opportunity"),
          eq(atelierPaneAItems.hrefTargetId, d.opportunityId),
          isNull(atelierPaneAItems.resolvedAt),
        ),
      );
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "opportunity",
      entityId: d.opportunityId,
      actorType: "system",
      actorId: "winloss-sla-monitor",
      actorLabel: "Atelier",
      action: "winloss.sla_breached",
      payload: { debriefId: d.id, dueAt: d.dueAt.toISOString() },
      payloadSummary: `Win/Loss debrief overdue — partner override + rationale required.`,
    });
    escalated++;
  }
  return { scanned: overdue.length, escalated };
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/win-loss/overdue/scan", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const result = await runWinLossOverdueScan();
  res.json(result);
});

// Partner-override path (PRD §5.2): allow a partner to clear the
// close-without-debrief gate with explicit rationale. Marks debrief as
// `withdrawn` (closed without buyer view) and records who/why.
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/win-loss/override", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const body = req.body as { rationale?: string };
  const rationale = (body.rationale ?? "").trim();
  if (rationale.length < 20) {
    res.status(400).json({
      error: "rationale-required",
      detail: "Partner override requires a written rationale (≥20 chars).",
    });
    return;
  }
  const debrief = await loadDebrief(req.params.oppId);
  if (!debrief) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  await db
    .update(atelierWinLossDebriefs)
    .set({
      status: "approved",
      conductorRole: "partner_off_team",
      approvedByUserId: me.id,
      approvedAt: new Date(),
      sellerNotes: `[PARTNER OVERRIDE — no buyer interview]\n${rationale}\n\n${debrief.sellerNotes ?? ""}`,
      updatedAt: new Date(),
    })
    .where(eq(atelierWinLossDebriefs.id, debrief.id));
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
    action: "winloss.partner_override",
    payload: { debriefId: debrief.id, rationale },
    payloadSummary: `${me.name} cleared Win/Loss gate by partner override.`,
  });
  res.json({ ok: true });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/win-loss/debriefs", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const { rows, opps } = await withRls(req, async (tx) => {
    const rows = await tx
      .select()
      .from(atelierWinLossDebriefs)
      .where(isNull(atelierWinLossDebriefs.deletedAt))
      .orderBy(desc(atelierWinLossDebriefs.createdAt))
      .limit(100);
    // Decorate with opportunity name + account.
    const oppIds = [...new Set(rows.map((r) => r.opportunityId))];
    const opps = oppIds.length
      ? await tx
          .select()
          .from(atelierOpportunities)
          .where(inArray(atelierOpportunities.id, oppIds))
      : [];
    return { rows, opps };
  });
  const oppMap = new Map(opps.map((o) => [o.id, o]));
  // Defensive orphan filter: a debrief whose opportunity no longer exists
  // (or is soft-deleted) must never surface in the library.
  const liveRows = rows.filter((r) => {
    const o = oppMap.get(r.opportunityId);
    return !!o && !o.deletedAt;
  });
  const items = liveRows.map((r) => {
    const o = oppMap.get(r.opportunityId)!;
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

// @cli-skip: pending Task #340 read-parity migration
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

// Shared helper: pulls approved-debrief themes, runs the Theme Curator,
// upserts atelierWinThemes rows AND materializes openProposalSuggestions
// as Pane A items on the open Pursue-stage opportunities (PRD §5.2).
async function runThemeCuratorAndPersist(
  me: typeof atelierUsers.$inferSelect,
  trigger: "manual" | "auto_on_approve",
): Promise<{ runId: string; output: import("../../lib/atelier-agents/runner.js").ThemeCuratorOutput }> {
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
    const arr =
      (d.themes as Array<{ tag?: string; name?: string; polarity?: string; evidenceQuote?: string }>) ?? [];
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
  const openOpps = await db
    .select({ id: atelierOpportunities.id, name: atelierOpportunities.name })
    .from(atelierOpportunities)
    .where(
      and(
        isNull(atelierOpportunities.deletedAt),
        inArray(atelierOpportunities.salesStage, [
          "prospect",
          "convert",
          "runner",
        ]),
      ),
    );
  const oppNameMap = new Map(openOpps.map((o) => [o.id, o.name]));
  const { runId, output } = await runThemeCurator({
    triggeredByUserId: me.id,
    actorLabel: me.name,
    debriefThemes,
    openOpportunityIds: openOpps.map((o) => o.id),
  });
  for (const t of output.upsertThemes) {
    const [existing] = await db
      .select()
      .from(atelierWinThemes)
      .where(and(eq(atelierWinThemes.tag, t.tag), isNull(atelierWinThemes.deletedAt)))
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
  // Materialize Curator's openProposalSuggestions as Pane A items so the
  // Composer/Pursue-stage owners actually see them (PRD §5.2).
  // Resolve each open opp's owner so the suggestion lands in their Pane A.
  const oppOwners = openOpps.length
    ? await db
        .select({
          id: atelierOpportunities.id,
          partnerOwnerId: atelierOpportunities.partnerOwnerId,
          engagementLeadId: atelierOpportunities.engagementLeadId,
        })
        .from(atelierOpportunities)
        .where(inArray(atelierOpportunities.id, openOpps.map((o) => o.id)))
    : [];
  const ownerMap = new Map(
    oppOwners.map((o) => [o.id, o.partnerOwnerId ?? o.engagementLeadId ?? null]),
  );
  for (const sug of output.openProposalSuggestions) {
    if (!oppNameMap.has(sug.opportunityId)) continue;
    const ownerId = ownerMap.get(sug.opportunityId);
    if (!ownerId) continue; // Pane A items must have a userId per schema.
    const titleStr = `Insert win theme: ${sug.themeTag.replace(/_/g, " ")}`;
    // Dedupe by (userId, hrefTargetId, title) on unresolved items —
    // the title encodes the themeTag so this is a stable key.
    const dup = await db
      .select({ id: atelierPaneAItems.id })
      .from(atelierPaneAItems)
      .where(
        and(
          eq(atelierPaneAItems.userId, ownerId),
          eq(atelierPaneAItems.hrefKind, "opportunity"),
          eq(atelierPaneAItems.hrefTargetId, sug.opportunityId),
          eq(atelierPaneAItems.title, titleStr),
          isNull(atelierPaneAItems.resolvedAt),
        ),
      )
      .limit(1);
    if (dup.length) continue;
    await db.insert(atelierPaneAItems).values({
      id: rid("pai"),
      orgId: me.orgId,
      userId: ownerId,
      title: titleStr,
      summary: sug.rationale,
      priority: "medium",
      hrefKind: "opportunity",
      hrefTargetId: sug.opportunityId,
      dueLabel: "Theme suggestion",
      sortKey: 60,
      createdByUserId: "theme_curator",
    });
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "atelier",
    entityId: "win_themes",
    actorType: "agent",
    actorId: "theme_curator",
    actorLabel: "Theme Curator",
    action: "winthemes.curated",
    payload: { runId, upserts: output.upsertThemes.length, suggestions: output.openProposalSuggestions.length, trigger },
    payloadSummary: `Theme Curator refreshed ${output.upsertThemes.length} themes (${trigger})`,
  });
  return { runId, output };
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/win-themes/curate", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const { runId, output } = await runThemeCuratorAndPersist(me, "manual");
  res.json({ runId, output });
});

// Lifecycle status PATCH (PRD §5.2): debriefs progress through
// pending -> buyer_scheduled -> buyer_done -> seller_done -> closed
// (or pending -> approved/rejected via approve/override). Allows the UI
// to mark interim milestones without going through full synthesize+approve.
const DEBRIEF_LIFECYCLE = new Set([
  "pending",
  "buyer_scheduled",
  "buyer_done",
  "seller_done",
  "closed",
]);
// @cli-skip: pending Task #340 read-parity migration
router.patch("/opportunities/:oppId/win-loss/status", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const next = String(req.body?.status ?? "");
  if (!DEBRIEF_LIFECYCLE.has(next)) {
    res.status(400).json({ error: "invalid-status", allowed: [...DEBRIEF_LIFECYCLE] });
    return;
  }
  const result = await withRls(req, async (tx) => {
    const debrief = await loadDebrief(req.params.oppId, tx);
    if (!debrief) return { notFound: true } as const;
    const [updated] = await tx
      .update(atelierWinLossDebriefs)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(atelierWinLossDebriefs.id, debrief.id))
      .returning();
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "opportunity",
      entityId: req.params.oppId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "winloss.status_changed",
      payload: { from: debrief.status, to: next, debriefId: debrief.id },
      payloadSummary: `${me.name} moved Win/Loss debrief ${debrief.status} → ${next}`,
    });
    return { updated } as const;
  });
  if ("notFound" in result) {
    res.status(404).json({ error: "debrief-not-found" });
    return;
  }
  res.json({ debrief: result.updated });
});

// Path aliases — task spec uses both /win-loss/ and /winloss/. Mount the
// same handlers on the dashed-less variant by registering a sub-router.
const aliasRouter: IRouter = Router();
aliasRouter.use((req, _res, next) => {
  // Rewrite /winloss/* -> /win-loss/* and /opportunities/:id/winloss -> /opportunities/:id/win-loss
  req.url = req.url.replace(/\/winloss(?=\/|$|\?)/g, "/win-loss");
  next();
});
aliasRouter.use(router);

export default aliasRouter;
