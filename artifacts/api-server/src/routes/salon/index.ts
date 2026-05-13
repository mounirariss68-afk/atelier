/**
 * THE SALON — client-realm router (Task #242).
 *
 * Mounted at /api/salon by routes/index.ts. Every endpoint:
 *  - is gated by attachSalonPersona (cookie-based mock auth);
 *  - rejects requests if the active persona has no access grant;
 *  - writes a row to atelier_salon_audit_events for every read or write
 *    so AICo internals see the client's behavior in their own audit feed.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, inArray } from "drizzle-orm";
import {
  db,
  atelierSalonWorkspaces,
  atelierSalonUsers,
  atelierSalonUserEngagementAccess,
  atelierSalonDecisions,
  atelierSalonRequests,
  atelierSalonNotifications,
  atelierSalonAuditEvents,
  atelierEngagements,
  atelierAccounts,
  atelierUsers,
  atelierDeliverables,
  atelierDeliverableVersions,
  atelierDeliverablePublishes,
  atelierMeetings,
  atelierAuditEvents,
} from "@workspace/db";
import {
  attachSalonPersona,
  setSalonPersonaCookie,
  salonPersonaToWire,
  DEFAULT_SALON_PERSONA_ID,
  rejectInternalRealm,
} from "./salonCookie";
import {
  runApprovalChoreographer,
  runEngagementCurator,
} from "../../lib/atelier-agents/runner.js";

const router: IRouter = Router();
router.use(rejectInternalRealm);
router.use(attachSalonPersona);

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function ensureSalonPersona(
  req: Request,
  res: Response,
): typeof atelierSalonUsers.$inferSelect | null {
  if (!req.salonPersona) {
    res.status(401).json({ error: "no-active-salon-persona" });
    return null;
  }
  return req.salonPersona;
}

async function ensureAccess(
  me: typeof atelierSalonUsers.$inferSelect,
  slug: string,
  res: Response,
): Promise<{
  workspace: typeof atelierSalonWorkspaces.$inferSelect;
  engagement: typeof atelierEngagements.$inferSelect;
  access: typeof atelierSalonUserEngagementAccess.$inferSelect;
} | null> {
  const [workspace] = await db
    .select()
    .from(atelierSalonWorkspaces)
    .where(
      and(
        eq(atelierSalonWorkspaces.slug, slug),
        isNull(atelierSalonWorkspaces.deletedAt),
      ),
    );
  if (!workspace) {
    res.status(404).json({ error: "workspace-not-found" });
    return null;
  }
  const [engagement] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, workspace.engagementId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  if (!engagement) {
    res.status(404).json({ error: "engagement-not-found" });
    return null;
  }
  const [access] = await db
    .select()
    .from(atelierSalonUserEngagementAccess)
    .where(
      and(
        eq(atelierSalonUserEngagementAccess.salonUserId, me.id),
        eq(atelierSalonUserEngagementAccess.engagementId, engagement.id),
        isNull(atelierSalonUserEngagementAccess.deletedAt),
      ),
    );
  if (!access || access.revokedAt) {
    res.status(403).json({ error: "no-access" });
    return null;
  }
  return { workspace, engagement, access };
}

async function logAudit(input: {
  engagementId: string;
  workspaceId: string;
  salonUserId: string | null;
  actorName: string;
  action: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  payloadSummary?: string;
}): Promise<void> {
  await db.insert(atelierSalonAuditEvents).values({
    id: rid("sad"),
    engagementId: input.engagementId,
    workspaceId: input.workspaceId,
    salonUserId: input.salonUserId,
    actorName: input.actorName,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    payload: input.payload ?? {},
    payloadSummary: input.payloadSummary ?? null,
  });
}

// Mirror critical Salon-side audits into the internal atelier_audit_events
// feed too so AICo's own audit explorer surfaces client activity.
async function mirrorInternalAudit(input: {
  engagementId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: input.entityType,
    entityId: input.entityId,
    actorType: "human",
    actorLabel: `${input.actorName} (Salon)`,
    action: input.action,
    payload: { ...input.payload, engagementId: input.engagementId },
    payloadSummary: input.summary,
  });
}

// ---------------- /api/salon/me ----------------

router.get("/me", async (req, res, next) => {
  try {
    const me = ensureSalonPersona(req, res);
    if (!me) return;
    const access = await db
      .select()
      .from(atelierSalonUserEngagementAccess)
      .where(
        and(
          eq(atelierSalonUserEngagementAccess.salonUserId, me.id),
          isNull(atelierSalonUserEngagementAccess.deletedAt),
        ),
      );
    const workspaces = access.length
      ? await db
          .select()
          .from(atelierSalonWorkspaces)
          .where(
            and(
              inArray(
                atelierSalonWorkspaces.id,
                access.map((a) => a.workspaceId),
              ),
              isNull(atelierSalonWorkspaces.deletedAt),
            ),
          )
      : [];
    res.json({ persona: salonPersonaToWire(me, access, workspaces) });
  } catch (err) {
    next(err);
  }
});

router.get("/personas", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(atelierSalonUsers)
      .where(isNull(atelierSalonUsers.deletedAt))
      .orderBy(atelierSalonUsers.name);
    res.json({
      personas: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        initials: r.initials,
        title: r.title,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/persona", async (req, res, next) => {
  try {
    const id = String(req.body?.personaId ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "missing-personaId" });
      return;
    }
    const [p] = await db
      .select()
      .from(atelierSalonUsers)
      .where(
        and(eq(atelierSalonUsers.id, id), isNull(atelierSalonUsers.deletedAt)),
      );
    if (!p) {
      res.status(404).json({ error: "persona-not-found" });
      return;
    }
    setSalonPersonaCookie(res, id);
    res.json({ ok: true, personaId: id });
  } catch (err) {
    next(err);
  }
});

// ---------------- portfolio + engagement ----------------

router.get("/engagements", async (req, res, next) => {
  try {
    const me = ensureSalonPersona(req, res);
    if (!me) return;
    const access = await db
      .select()
      .from(atelierSalonUserEngagementAccess)
      .where(
        and(
          eq(atelierSalonUserEngagementAccess.salonUserId, me.id),
          isNull(atelierSalonUserEngagementAccess.deletedAt),
        ),
      );
    if (access.length === 0) {
      res.json({ engagements: [] });
      return;
    }
    const workspaces = await db
      .select()
      .from(atelierSalonWorkspaces)
      .where(
        and(
          inArray(
            atelierSalonWorkspaces.id,
            access.map((a) => a.workspaceId),
          ),
          isNull(atelierSalonWorkspaces.deletedAt),
        ),
      );
    const engagements = await db
      .select()
      .from(atelierEngagements)
      .where(
        and(
          inArray(
            atelierEngagements.id,
            access.map((a) => a.engagementId),
          ),
          isNull(atelierEngagements.deletedAt),
        ),
      );
    const engById = new Map(engagements.map((e) => [e.id, e]));
    const wsById = new Map(workspaces.map((w) => [w.id, w]));
    res.json({
      engagements: access.map((a) => {
        const ws = wsById.get(a.workspaceId);
        const eng = engById.get(a.engagementId);
        return {
          slug: ws?.slug,
          displayName: ws?.displayName ?? eng?.name,
          accentColor: ws?.accentColor ?? "#0B5CFF",
          eyebrowText: ws?.eyebrowText,
          plmStage: eng?.plmStage,
          startDate: eng?.startDate,
          plannedEndDate: eng?.plannedEndDate,
          role: a.role,
          canApprove: a.canApprove,
          downloadsAllowed: a.downloadsAllowed ?? ws?.downloadsAllowedDefault ?? false,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/:slug", async (req, res, next) => {
  try {
    const me = ensureSalonPersona(req, res);
    if (!me) return;
    const ctx = await ensureAccess(me, String(req.params.slug), res);
    if (!ctx) return;
    const { workspace, engagement, access } = ctx;
    const [account] = await db
      .select()
      .from(atelierAccounts)
      .where(
        and(
          eq(atelierAccounts.id, engagement.accountId),
          isNull(atelierAccounts.deletedAt),
        ),
      );
    await logAudit({
      engagementId: engagement.id,
      workspaceId: workspace.id,
      salonUserId: me.id,
      actorName: me.name,
      action: "tab.view",
      entityType: "engagement",
      entityId: engagement.id,
      payloadSummary: `${me.name} opened ${workspace.displayName} (overview)`,
    });
    res.json({
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        displayName: workspace.displayName,
        accentColor: workspace.accentColor,
        clientLogoUrl: workspace.clientLogoUrl,
        aicoLogoUrl: workspace.aicoLogoUrl,
        eyebrowText: workspace.eyebrowText,
        defaultLocale: workspace.defaultLocale,
        rtlEnabled: workspace.rtlEnabled,
        watermarkEnabled: workspace.watermarkEnabled,
      },
      engagement: {
        id: engagement.id,
        name: engagement.name,
        plmStage: engagement.plmStage,
        startDate: engagement.startDate,
        plannedEndDate: engagement.plannedEndDate,
        charter: engagement.charter,
        workstreams: engagement.workstreams,
        valueCase: engagement.valueCase,
        raidStatus: engagement.raidStatus,
        deliverablesDueThisWeek: engagement.deliverablesDueThisWeek,
      },
      account: account
        ? {
            id: account.id,
            name: account.name,
            country: account.country,
            sector: account.sector,
          }
        : null,
      access: {
        role: access.role,
        canApprove: access.canApprove,
        downloadsAllowed:
          access.downloadsAllowed ?? workspace.downloadsAllowedDefault,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Generic per-engagement subresource fetcher used by tabs.
async function withEngagementCtx(
  req: Request,
  res: Response,
): Promise<{
  me: typeof atelierSalonUsers.$inferSelect;
  workspace: typeof atelierSalonWorkspaces.$inferSelect;
  engagement: typeof atelierEngagements.$inferSelect;
  access: typeof atelierSalonUserEngagementAccess.$inferSelect;
} | null> {
  const me = ensureSalonPersona(req, res);
  if (!me) return null;
  const ctx = await ensureAccess(me, String(req.params.slug), res);
  if (!ctx) return null;
  return { me, ...ctx };
}

router.get("/engagements/:slug/deliverables", async (req, res, next) => {
  try {
    const ctx = await withEngagementCtx(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(atelierDeliverables)
      .where(
        and(
          eq(atelierDeliverables.engagementId, ctx.engagement.id),
          isNull(atelierDeliverables.deletedAt),
        ),
      )
      .orderBy(desc(atelierDeliverables.updatedAt));
    // Only client-visible (review|published|final).
    const visible = rows.filter((r) =>
      ["review", "published", "final"].includes(r.clientVisibility),
    );
    await logAudit({
      engagementId: ctx.engagement.id,
      workspaceId: ctx.workspace.id,
      salonUserId: ctx.me.id,
      actorName: ctx.me.name,
      action: "tab.view",
      entityType: "deliverables",
      entityId: ctx.engagement.id,
      payloadSummary: `${ctx.me.name} opened deliverables tab`,
    });
    res.json({
      deliverables: visible.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        clientVisibility: d.clientVisibility,
        latestPublishId: d.latestPublishId,
        dueDate: d.dueDate,
        updatedAt: d.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/deliverables/:id", async (req, res, next) => {
  try {
    const me = ensureSalonPersona(req, res);
    if (!me) return;
    const [d] = await db
      .select()
      .from(atelierDeliverables)
      .where(
        and(
          eq(atelierDeliverables.id, req.params.id),
          isNull(atelierDeliverables.deletedAt),
        ),
      );
    if (!d || !["review", "published", "final"].includes(d.clientVisibility)) {
      res.status(404).json({ error: "deliverable-not-published" });
      return;
    }
    const [workspace] = await db
      .select()
      .from(atelierSalonWorkspaces)
      .where(
        and(
          eq(atelierSalonWorkspaces.engagementId, d.engagementId),
          isNull(atelierSalonWorkspaces.deletedAt),
        ),
      );
    if (!workspace) {
      res.status(404).json({ error: "workspace-not-found" });
      return;
    }
    const [access] = await db
      .select()
      .from(atelierSalonUserEngagementAccess)
      .where(
        and(
          eq(atelierSalonUserEngagementAccess.salonUserId, me.id),
          eq(atelierSalonUserEngagementAccess.engagementId, d.engagementId),
          isNull(atelierSalonUserEngagementAccess.deletedAt),
        ),
      );
    if (!access || access.revokedAt) {
      res.status(403).json({ error: "no-access" });
      return;
    }
    const publish = d.latestPublishId
      ? (
          await db
            .select()
            .from(atelierDeliverablePublishes)
            .where(eq(atelierDeliverablePublishes.id, d.latestPublishId))
        )[0]
      : null;
    const versionId = publish?.deliverableVersionId ?? d.currentVersionId;
    const [version] = versionId
      ? await db
          .select()
          .from(atelierDeliverableVersions)
          .where(eq(atelierDeliverableVersions.id, versionId))
      : [];
    await logAudit({
      engagementId: d.engagementId,
      workspaceId: workspace.id,
      salonUserId: me.id,
      actorName: me.name,
      action: "deliverable.view",
      entityType: "deliverable",
      entityId: d.id,
      payloadSummary: `${me.name} viewed ${d.name}`,
    });
    res.json({
      deliverable: {
        id: d.id,
        name: d.name,
        type: d.type,
        status: d.status,
        clientVisibility: d.clientVisibility,
        latestPublishId: d.latestPublishId,
        body: version?.body ?? "",
        format: version?.format ?? "html",
      },
      publish: publish
        ? {
            id: publish.id,
            sentinelStatus: publish.sentinelStatus,
            publishedAt: publish.publishedAt.toISOString(),
            publishedByName: publish.publishedByName,
            downloadsAllowed:
              access.downloadsAllowed === true && publish.downloadsAllowed === true,
            watermarkRequired: publish.watermarkRequired,
          }
        : null,
      access: {
        role: access.role,
        canApprove: access.canApprove,
        downloadsAllowed:
          access.downloadsAllowed ?? workspace.downloadsAllowedDefault,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/deliverables/:id/decision", async (req, res, next) => {
  try {
    const me = ensureSalonPersona(req, res);
    if (!me) return;
    const kind = String(req.body?.kind ?? "").trim();
    if (!["approve", "request_change", "comment", "sign_off"].includes(kind)) {
      res.status(400).json({ error: "invalid-kind" });
      return;
    }
    const headline = String(req.body?.headline ?? "").trim().slice(0, 200);
    const rationale = String(req.body?.rationale ?? "").trim().slice(0, 2000);
    if (!headline) {
      res.status(400).json({ error: "missing-headline" });
      return;
    }
    // Approve / sign_off require an explicit 1-line rationale (PRD §7.3.x).
    if ((kind === "approve" || kind === "sign_off") && rationale.length < 8) {
      res.status(400).json({
        error: "approval-rationale-required",
        message: "Approval requires a 1-line rationale (min 8 chars).",
      });
      return;
    }
    const [d] = await db
      .select()
      .from(atelierDeliverables)
      .where(eq(atelierDeliverables.id, req.params.id));
    if (!d) {
      res.status(404).json({ error: "deliverable-not-found" });
      return;
    }
    // Salon clients can only act on deliverables that are explicitly visible
    // to them. Anything in internal/draft state is not Salon-actionable.
    if (!["review", "published", "final"].includes(d.clientVisibility ?? "")) {
      res.status(404).json({ error: "deliverable-not-visible" });
      return;
    }
    const [workspace] = await db
      .select()
      .from(atelierSalonWorkspaces)
      .where(eq(atelierSalonWorkspaces.engagementId, d.engagementId));
    const [access] = await db
      .select()
      .from(atelierSalonUserEngagementAccess)
      .where(
        and(
          eq(atelierSalonUserEngagementAccess.salonUserId, me.id),
          eq(atelierSalonUserEngagementAccess.engagementId, d.engagementId),
          isNull(atelierSalonUserEngagementAccess.deletedAt),
        ),
      );
    if (!workspace || !access || access.revokedAt) {
      res.status(403).json({ error: "no-access" });
      return;
    }
    if ((kind === "approve" || kind === "sign_off") && !access.canApprove) {
      res.status(403).json({ error: "not-an-approver" });
      return;
    }
    const id = rid("sdc");
    await db.insert(atelierSalonDecisions).values({
      id,
      engagementId: d.engagementId,
      workspaceId: workspace.id,
      deliverableId: d.id,
      publishId: d.latestPublishId,
      kind,
      headline,
      rationale: rationale || null,
      decidedBySalonUserId: me.id,
      decidedByName: me.name,
    });
    const summary = `${me.name} (Salon ${access.role}) ${kind.replace("_", " ")}: ${headline}`;
    await logAudit({
      engagementId: d.engagementId,
      workspaceId: workspace.id,
      salonUserId: me.id,
      actorName: me.name,
      action: `decision.${kind}`,
      entityType: "deliverable",
      entityId: d.id,
      payload: { decisionId: id, headline, rationale },
      payloadSummary: summary,
    });
    await mirrorInternalAudit({
      engagementId: d.engagementId,
      actorName: me.name,
      action: `salon.decision.${kind}`,
      entityType: "deliverable",
      entityId: d.id,
      summary,
      payload: { decisionId: id, headline },
    });
    // Re-evaluate approval chain.
    const approvers = await db
      .select()
      .from(atelierSalonUserEngagementAccess)
      .where(
        and(
          eq(atelierSalonUserEngagementAccess.engagementId, d.engagementId),
          isNull(atelierSalonUserEngagementAccess.deletedAt),
        ),
      );
    const approverUsers = approvers.length
      ? await db
          .select()
          .from(atelierSalonUsers)
          .where(
            inArray(
              atelierSalonUsers.id,
              approvers.map((a) => a.salonUserId),
            ),
          )
      : [];
    const approverWire = approvers.map((a) => {
      const u = approverUsers.find((x) => x.id === a.salonUserId);
      return {
        id: a.salonUserId,
        name: u?.name ?? a.salonUserId,
        canApprove: a.canApprove,
      };
    });
    const decisions = await db
      .select()
      .from(atelierSalonDecisions)
      .where(
        and(
          eq(atelierSalonDecisions.deliverableId, d.id),
          isNull(atelierSalonDecisions.deletedAt),
        ),
      );
    const choreo = await runApprovalChoreographer({
      triggeredByUserId: null,
      actorLabel: "Approval Choreographer",
      deliverableId: d.id,
      deliverableLabel: d.name,
      publishId: d.latestPublishId ?? "",
      approvers: approverWire,
      decisionsRecorded: decisions.map((dx) => ({
        decidedBySalonUserId: dx.decidedBySalonUserId,
        kind: dx.kind,
      })),
    });
    res.json({ ok: true, decisionId: id, choreography: choreo.output });
  } catch (err) {
    next(err);
  }
});

router.post("/deliverables/:id/download-attempt", async (req, res, next) => {
  try {
    const me = ensureSalonPersona(req, res);
    if (!me) return;
    const [d] = await db
      .select()
      .from(atelierDeliverables)
      .where(eq(atelierDeliverables.id, req.params.id));
    if (!d) {
      res.status(404).json({ error: "deliverable-not-found" });
      return;
    }
    const [workspace] = await db
      .select()
      .from(atelierSalonWorkspaces)
      .where(eq(atelierSalonWorkspaces.engagementId, d.engagementId));
    if (!workspace) {
      res.status(404).json({ error: "workspace-not-found" });
      return;
    }
    // Authz: persona must hold an access grant for this engagement, AND the
    // deliverable must be visible to clients (no internal-draft probing).
    const [access] = await db
      .select()
      .from(atelierSalonUserEngagementAccess)
      .where(
        and(
          eq(atelierSalonUserEngagementAccess.workspaceId, workspace.id),
          eq(atelierSalonUserEngagementAccess.salonUserId, me.id),
          isNull(atelierSalonUserEngagementAccess.deletedAt),
        ),
      );
    if (!access) {
      res.status(403).json({ error: "no-engagement-access" });
      return;
    }
    if (!["review", "published", "final"].includes(d.clientVisibility ?? "")) {
      res.status(404).json({ error: "deliverable-not-visible" });
      return;
    }
    await logAudit({
      engagementId: d.engagementId,
      workspaceId: workspace.id,
      salonUserId: me.id,
      actorName: me.name,
      action: "deliverable.download_blocked",
      entityType: "deliverable",
      entityId: d.id,
      payloadSummary: `${me.name} attempted download of ${d.name} (blocked — copy-request flow)`,
    });
    res.json({ ok: true, blocked: true });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/:slug/decisions", async (req, res, next) => {
  try {
    const ctx = await withEngagementCtx(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(atelierSalonDecisions)
      .where(
        and(
          eq(atelierSalonDecisions.engagementId, ctx.engagement.id),
          isNull(atelierSalonDecisions.deletedAt),
        ),
      )
      .orderBy(desc(atelierSalonDecisions.decidedAt));
    res.json({
      decisions: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        headline: r.headline,
        rationale: r.rationale,
        deliverableId: r.deliverableId,
        decidedByName: r.decidedByName,
        decidedAt: r.decidedAt.toISOString(),
        status: r.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/:slug/meetings", async (req, res, next) => {
  try {
    const ctx = await withEngagementCtx(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(atelierMeetings)
      .where(
        and(
          eq(atelierMeetings.parentType, "engagement"),
          eq(atelierMeetings.parentId, ctx.engagement.id),
          isNull(atelierMeetings.deletedAt),
        ),
      )
      .orderBy(desc(atelierMeetings.date));
    res.json({
      meetings: rows.map((m) => ({
        id: m.id,
        title: m.title,
        startsAt: m.date ?? null,
        durationMinutes: null,
        status: m.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/:slug/team", async (req, res, next) => {
  try {
    const ctx = await withEngagementCtx(req, res);
    if (!ctx) return;
    const [partner] = await db
      .select()
      .from(atelierUsers)
      .where(eq(atelierUsers.id, ctx.engagement.partnerOwnerId));
    const [lead] = await db
      .select()
      .from(atelierUsers)
      .where(eq(atelierUsers.id, ctx.engagement.engagementLeadId));
    const accessRows = await db
      .select()
      .from(atelierSalonUserEngagementAccess)
      .where(
        and(
          eq(atelierSalonUserEngagementAccess.engagementId, ctx.engagement.id),
          isNull(atelierSalonUserEngagementAccess.deletedAt),
        ),
      );
    const salonUsers = accessRows.length
      ? await db
          .select()
          .from(atelierSalonUsers)
          .where(
            inArray(
              atelierSalonUsers.id,
              accessRows.map((a) => a.salonUserId),
            ),
          )
      : [];
    res.json({
      aico: [partner, lead].filter(Boolean).map((u) => ({
        id: u!.id,
        name: u!.name,
        title: u!.title,
        roleLabel: u!.roleLabel,
        initials: u!.initials,
      })),
      client: accessRows.map((a) => {
        const u = salonUsers.find((x) => x.id === a.salonUserId);
        return {
          id: a.salonUserId,
          name: u?.name,
          title: u?.title,
          initials: u?.initials,
          role: a.role,
          canApprove: a.canApprove,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/:slug/requests", async (req, res, next) => {
  try {
    const ctx = await withEngagementCtx(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(atelierSalonRequests)
      .where(
        and(
          eq(atelierSalonRequests.engagementId, ctx.engagement.id),
          isNull(atelierSalonRequests.deletedAt),
        ),
      )
      .orderBy(desc(atelierSalonRequests.raisedAt));
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        detail: r.detail,
        status: r.status,
        raisedByName: r.raisedByName,
        raisedAt: r.raisedAt.toISOString(),
        relatedDeliverableId: r.relatedDeliverableId,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/engagements/:slug/requests", async (req, res, next) => {
  try {
    const ctx = await withEngagementCtx(req, res);
    if (!ctx) return;
    const kind = String(req.body?.kind ?? "other").trim();
    const title = String(req.body?.title ?? "").trim().slice(0, 200);
    const detail = String(req.body?.detail ?? "").trim().slice(0, 2000);
    const relatedDeliverableId =
      typeof req.body?.relatedDeliverableId === "string"
        ? req.body.relatedDeliverableId
        : null;
    if (!title) {
      res.status(400).json({ error: "missing-title" });
      return;
    }
    const id = rid("sreq");
    await db.insert(atelierSalonRequests).values({
      id,
      engagementId: ctx.engagement.id,
      workspaceId: ctx.workspace.id,
      kind,
      title,
      detail: detail || null,
      relatedDeliverableId,
      raisedBySalonUserId: ctx.me.id,
      raisedByName: ctx.me.name,
      assignedToAtelierUserId: ctx.engagement.engagementLeadId,
    });
    const summary = `${ctx.me.name} raised ${kind} request: ${title}`;
    await logAudit({
      engagementId: ctx.engagement.id,
      workspaceId: ctx.workspace.id,
      salonUserId: ctx.me.id,
      actorName: ctx.me.name,
      action: "request.raise",
      entityType: "request",
      entityId: id,
      payloadSummary: summary,
    });
    await mirrorInternalAudit({
      engagementId: ctx.engagement.id,
      actorName: ctx.me.name,
      action: "salon.request.raise",
      entityType: "request",
      entityId: id,
      summary,
      payload: { kind, title },
    });
    res.json({ ok: true, requestId: id });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/:slug/notifications", async (req, res, next) => {
  try {
    const ctx = await withEngagementCtx(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(atelierSalonNotifications)
      .where(
        and(
          eq(atelierSalonNotifications.salonUserId, ctx.me.id),
          eq(atelierSalonNotifications.engagementId, ctx.engagement.id),
          isNull(atelierSalonNotifications.deletedAt),
        ),
      )
      .orderBy(desc(atelierSalonNotifications.createdAt))
      .limit(50);
    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        headline: n.headline,
        body: n.body,
        href: n.href,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/engagements/:slug/curator", async (req, res, next) => {
  try {
    const ctx = await withEngagementCtx(req, res);
    if (!ctx) return;
    const decisions = await db
      .select()
      .from(atelierSalonDecisions)
      .where(eq(atelierSalonDecisions.engagementId, ctx.engagement.id));
    const requests = await db
      .select()
      .from(atelierSalonRequests)
      .where(
        and(
          eq(atelierSalonRequests.engagementId, ctx.engagement.id),
          eq(atelierSalonRequests.status, "open"),
        ),
      );
    const result = await runEngagementCurator({
      triggeredByUserId: null,
      actorLabel: "Engagement Curator",
      engagementId: ctx.engagement.id,
      engagementLabel: ctx.engagement.name,
      decisionsLogged: decisions.length,
      openRequests: requests.length,
      highlights: (ctx.engagement.workstreams ?? [])
        .slice(0, 3)
        .map((w) => `${w.name} — ${w.status}`),
      upcoming: ["Weekly working session", "Mid-flight checkpoint"],
    });
    res.json(result.output);
  } catch (err) {
    next(err);
  }
});

export default router;
