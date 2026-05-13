import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, inArray, type SQL } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAccounts,
  atelierOpportunities,
  atelierEngagements,
  atelierAgents,
  atelierAgentRuns,
  atelierAssets,
  atelierAuditEvents,
  atelierPaneAItems,
} from "@workspace/db";
import {
  AtelierGetMeResponse,
  AtelierListPersonasResponse,
  AtelierSwitchPersonaBody,
  AtelierSwitchPersonaResponse,
  AtelierGetHomeResponse,
  AtelierGetActivityResponse,
  AtelierGetActivityQueryParams,
  AtelierListOpportunitiesResponse,
  AtelierGetOpportunityResponse,
  AtelierListEngagementsResponse,
  AtelierGetEngagementResponse,
  AtelierListAccountsResponse,
  AtelierListAgentsResponse,
  AtelierListAssetsResponse,
  AtelierListAuditQueryParams,
  AtelierListAuditResponse,
} from "@workspace/api-zod";
import {
  attachPersona,
  personaToWire,
  setPersonaCookie,
  rejectClientRealm,
} from "./personaCookie";
import { attachRls, registerAtelierRlsDefaults, withRls } from "./rls";
import { auditPdfHandler } from "./auditPdf";
import agentRoutes from "./agentRoutes";
import {
  STALLED_THRESHOLD_DAYS,
  deriveSalesStage,
  isSalesStage,
} from "../../lib/atelier-agents/pipeline.js";
import proposalRoutes from "./proposalRoutes";
import knowledgeRoutes from "./knowledgeRoutes";
import accountRoutes from "./accountRoutes";
import pricingRoutes from "./pricingRoutes";
import engagementRoutes, {
  accessibleEngagementIds,
  ensureEngAccess,
  audit as engagementAudit,
} from "./engagementRoutes";
import winLossRoutes from "./winLossRoutes";
import forecastRoutes from "./forecastRoutes";
import reportsRoutes from "./reportsRoutes";

async function recordEngagementRead(
  me: typeof atelierUsers.$inferSelect,
  eng: typeof atelierEngagements.$inferSelect,
) {
  // Cross-engagement read = persona is not the lead/partner-owner of the
  // engagement they're reading. Emits an audit row whenever a partner uses
  // firm-wide visibility on an engagement they don't directly own, or when
  // any other persona reads via an explicit grant rather than ownership.
  const isOwner = eng.engagementLeadId === me.id || eng.partnerOwnerId === me.id;
  if (isOwner) return;
  await engagementAudit({
    entityType: "engagement",
    entityId: eng.id,
    actor: me,
    action: "engagement.cross_read",
    payload: { engagementId: eng.id, viewerRole: me.role },
    summary: `${me.name} viewed engagement ${eng.id} (cross-engagement read)`,
  });
}

registerAtelierRlsDefaults();

const router: IRouter = Router();
router.use(attachPersona);
router.use(rejectClientRealm);
router.use(attachRls);

// Audit PDF export — registered before /audit JSON to win the route match.
router.get("/audit/export.pdf", auditPdfHandler);

// Mount agent / opportunity write routes (Task #221).
router.use(agentRoutes);
router.use(accountRoutes);
// Mount engagement / charter / deliverable / artifact write routes (Task #222).
router.use(engagementRoutes);
// Mount process / prototype / proposal write routes (Task #223).
router.use(proposalRoutes);
// Mount Knowledge Atelier extras (Task #224): prompts, concierge, admin, runs.
router.use(knowledgeRoutes);
// Mount pricing routes (Task #240): rate cards, margin policy, deal pricing,
// pricing strategist, single/two-partner override.
router.use(pricingRoutes);
// Mount Win/Loss + Forecast + Reports routes (Task #241).
router.use(winLossRoutes);
router.use(forecastRoutes);
router.use(reportsRoutes);

function ensurePersona(
  req: Request,
  res: Response,
): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

// =============================================================
// Personas / Me
// =============================================================
router.get("/me", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  res.json(AtelierGetMeResponse.parse(personaToWire(me)));
});

router.get("/personas", async (_req, res) => {
  const rows = await db
    .select()
    .from(atelierUsers)
    .where(isNull(atelierUsers.deletedAt));
  res.json(AtelierListPersonasResponse.parse(rows.map(personaToWire)));
});

router.post("/personas/switch", async (req, res) => {
  const parsed = AtelierSwitchPersonaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [target] = await db
    .select()
    .from(atelierUsers)
    .where(
      and(
        eq(atelierUsers.id, parsed.data.personaId),
        isNull(atelierUsers.deletedAt),
      ),
    );
  if (!target) {
    res.status(404).json({ error: "persona-not-found" });
    return;
  }
  setPersonaCookie(res, target.id);

  // Audit the switch.
  await db.insert(atelierAuditEvents).values({
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    entityType: "session",
    entityId: target.id,
    actorType: "human",
    actorId: target.id,
    actorLabel: target.name,
    action: "persona.switch",
    payload: { to: target.id },
    payloadSummary: `Switched persona to ${target.name}`,
  });

  res.json(AtelierSwitchPersonaResponse.parse(personaToWire(target)));
});

// =============================================================
// Home (Pane A / B / C)
// =============================================================
const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];
const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function eyebrowDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()} · ${DAY_NAMES[d.getDay()]}`;
}

function greetingFor(name: string, hour: number): string {
  const period =
    hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = name.split(" ")[0] ?? name;
  return `${period}, ${first}.`;
}

router.get("/home", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;

  // Pane A — items addressed to this persona (or unassigned high-prio for Partners).
  const paneARows = await db
    .select()
    .from(atelierPaneAItems)
    .where(
      and(eq(atelierPaneAItems.userId, me.id), isNull(atelierPaneAItems.resolvedAt)),
    );
  const paneA = paneARows
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      priority: r.priority as "high" | "medium" | "low",
      hrefKind: r.hrefKind as "opportunity" | "engagement" | "deliverable" | "atelier",
      hrefTargetId: r.hrefTargetId,
      dueLabel: r.dueLabel,
    }));

  // Pane B — pipeline + engagements
  const opps = await db
    .select()
    .from(atelierOpportunities)
    .where(isNull(atelierOpportunities.deletedAt));
  const PIPELINE_STAGES: Array<
    "identify" | "shape" | "pursue" | "won" | "lost" | "no_go"
  > = ["identify", "shape", "pursue", "won", "lost", "no_go"];
  const pipeline = PIPELINE_STAGES.map((stage) => {
    const list = opps.filter((o) => o.plmStage === stage);
    return {
      stage,
      count: list.length,
      weightedValueUsd: list.reduce(
        (acc, o) => acc + (o.dealSizeHypothesis * o.probabilityPct) / 100,
        0,
      ),
      agedRedCount: list.filter((o) => o.daysInStage > 30).length,
    };
  });

  const engs = await db
    .select()
    .from(atelierEngagements)
    .where(isNull(atelierEngagements.deletedAt));
  const engagements = {
    activeCount: engs.filter((e) => e.plmStage !== "closed").length,
    deliverablesDueThisWeek: engs.reduce(
      (acc, e) => acc + (e.deliverablesDueThisWeek ?? 0),
      0,
    ),
    raidAmberCount: engs.filter((e) => e.raidStatus === "amber").length,
    raidRedCount: engs.filter((e) => e.raidStatus === "red").length,
  };

  // Pane C — recent atelier assets
  const assetRows = await db
    .select()
    .from(atelierAssets)
    .where(isNull(atelierAssets.deletedAt))
    .orderBy(desc(atelierAssets.createdAt))
    .limit(6);
  const paneC = assetRows.map((a) => ({
    id: a.id,
    kind: a.kind as
      | "pov"
      | "prompt"
      | "framework"
      | "case_study"
      | "template"
      | "code"
      | "learning",
    title: a.title,
    abstract: a.abstract,
    provenance: a.provenance,
    tags: (a.tags as string[]) ?? [],
    createdAt: a.createdAt.toISOString(),
    bodyOrFileUrl: a.bodyOrFileUrl,
  }));

  const now = new Date();
  res.json(
    AtelierGetHomeResponse.parse({
      eyebrowDate: eyebrowDate(now),
      greeting: greetingFor(me.name, now.getHours()),
      persona: personaToWire(me),
      paneA,
      pipeline,
      engagements,
      paneC,
    }),
  );
});

// =============================================================
// Activity stream
// =============================================================
router.get("/activity", async (req, res) => {
  const parsed = AtelierGetActivityQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;

  const runs = await db
    .select({
      id: atelierAgentRuns.id,
      agentId: atelierAgentRuns.agentId,
      status: atelierAgentRuns.status,
      statusMessage: atelierAgentRuns.statusMessage,
      confidence: atelierAgentRuns.confidence,
      targetType: atelierAgentRuns.targetType,
      targetId: atelierAgentRuns.targetId,
      targetLabel: atelierAgentRuns.targetLabel,
      progressPct: atelierAgentRuns.progressPct,
      sourcesCount: atelierAgentRuns.sourcesCount,
      createdAt: atelierAgentRuns.createdAt,
      agentName: atelierAgents.name,
    })
    .from(atelierAgentRuns)
    .leftJoin(atelierAgents, eq(atelierAgentRuns.agentId, atelierAgents.id))
    .where(isNull(atelierAgentRuns.deletedAt))
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(limit);

  const items = runs.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    agentName: r.agentName ?? r.agentId,
    status: (r.status as "running" | "blocked" | "complete" | "error") ?? "running",
    confidence:
      (r.confidence as "green" | "amber" | "red" | null) ?? null,
    message: r.statusMessage ?? "",
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    startedAt: r.createdAt.toISOString(),
    progressPct: r.progressPct,
    sourcesCount: r.sourcesCount,
  }));

  res.json(AtelierGetActivityResponse.parse(items));
});

// =============================================================
// Opportunities
// =============================================================
async function buildOpportunityWire(
  o: typeof atelierOpportunities.$inferSelect,
) {
  const [acct] = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, o.accountId));
  const [partner] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, o.partnerOwnerId));
  const [lead] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, o.engagementLeadId));
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

router.get("/opportunities", async (req, res) => {
  // Optional query filters: ?stage=&owner=&sector=&account= (CSV allowed).
  // Filtering happens after buildOpportunityWire because salesStage may be
  // derived at read time for legacy rows that pre-date the v2 column.
  const split = (v: unknown): string[] =>
    typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const stages = split(req.query.stage);
  const owners = split(req.query.owner);
  const sectors = split(req.query.sector);
  const accounts = split(req.query.account);

  const rows = await db
    .select()
    .from(atelierOpportunities)
    .where(isNull(atelierOpportunities.deletedAt));
  let wire = await Promise.all(rows.map(buildOpportunityWire));
  if (stages.length) wire = wire.filter((o) => stages.includes(o.salesStage));
  if (owners.length)
    wire = wire.filter((o) => owners.includes(o.partnerOwnerName));
  if (accounts.length)
    wire = wire.filter(
      (o) => accounts.includes(o.accountId) || accounts.includes(o.accountName),
    );
  if (sectors.length) {
    const acctRows = await db.select().from(atelierAccounts);
    const sectorByAcct = new Map(acctRows.map((a) => [a.id, a.sector]));
    wire = wire.filter((o) => sectors.includes(sectorByAcct.get(o.accountId) ?? ""));
  }
  res.json(AtelierListOpportunitiesResponse.parse(wire));
});

router.get("/opportunities/:oppId", async (req, res) => {
  const [row] = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.id, req.params.oppId),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  res.json(AtelierGetOpportunityResponse.parse(await buildOpportunityWire(row)));
});

// =============================================================
// Engagements
// =============================================================
async function buildEngagementWire(
  e: typeof atelierEngagements.$inferSelect,
) {
  const [acct] = await db
    .select()
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, e.accountId));
  const [partner] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, e.partnerOwnerId));
  const [lead] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, e.engagementLeadId));
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    accountId: e.accountId,
    accountName: acct?.name ?? e.accountId,
    plmStage: e.plmStage,
    partnerOwnerName: partner?.name ?? e.partnerOwnerId,
    engagementLeadName: lead?.name ?? e.engagementLeadId,
    startDate: e.startDate,
    plannedEndDate: e.plannedEndDate,
    raidStatus: e.raidStatus as "green" | "amber" | "red",
    deliverablesDueThisWeek: e.deliverablesDueThisWeek,
  };
}

router.get("/engagements", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!access.all && access.ids.size === 0) {
    res.json(AtelierListEngagementsResponse.parse([]));
    return;
  }
  const rows = await db
    .select()
    .from(atelierEngagements)
    .where(
      access.all
        ? isNull(atelierEngagements.deletedAt)
        : and(
            isNull(atelierEngagements.deletedAt),
            inArray(atelierEngagements.id, [...access.ids]),
          ),
    );
  const wire = await Promise.all(rows.map(buildEngagementWire));
  res.json(AtelierListEngagementsResponse.parse(wire));
});

router.get("/engagements/:engId", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return;
  }
  const eng = await ensureEngAccess(res, me, req.params.engId);
  if (!eng) return;
  await recordEngagementRead(me, eng);
  res.json(AtelierGetEngagementResponse.parse(await buildEngagementWire(eng)));
});

// =============================================================
// Accounts / Agents / Assets
// =============================================================
// /accounts handled by accountRoutes (Task #238 — v2 CRM).

router.get("/agents", async (_req, res) => {
  const rows = await db
    .select()
    .from(atelierAgents)
    .where(isNull(atelierAgents.deletedAt));
  res.json(
    AtelierListAgentsResponse.parse(
      rows.map((a) => ({
        id: a.id,
        name: a.name,
        group: a.group,
        stage: a.stage,
        purpose: a.purpose,
        model: a.model,
        starred: a.starred,
        status: a.status as "registered" | "mvp" | "stub",
        runsLast30d: a.runsLast30d,
        inputs: a.inputs,
        outputs: a.outputs,
      })),
    ),
  );
});

router.get("/assets", async (_req, res) => {
  const rows = await db
    .select()
    .from(atelierAssets)
    .where(isNull(atelierAssets.deletedAt))
    .orderBy(desc(atelierAssets.createdAt));
  res.json(
    AtelierListAssetsResponse.parse(
      rows.map((a) => ({
        id: a.id,
        kind: a.kind as
          | "pov"
          | "prompt"
          | "framework"
          | "case_study"
          | "template"
          | "code"
          | "learning",
        title: a.title,
        abstract: a.abstract,
        provenance: a.provenance,
        tags: (a.tags as string[]) ?? [],
        createdAt: a.createdAt.toISOString(),
        bodyOrFileUrl: a.bodyOrFileUrl,
      })),
    ),
  );
});

// =============================================================
// Audit
// =============================================================
router.get("/audit", async (req, res) => {
  const parsed = AtelierListAuditQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-query" });
    return;
  }
  const { entityType, entityId, limit } = parsed.data;
  const conditions: SQL[] = [];
  if (entityType) conditions.push(eq(atelierAuditEvents.entityType, entityType));
  if (entityId) conditions.push(eq(atelierAuditEvents.entityId, entityId));
  // Run the read inside a transaction with request-local RLS GUCs so
  // audit visibility is governed by the same per-request context as the
  // PDF export endpoint. Never read this table through the global `db`
  // handle — that would fall back to connection-level defaults.
  const rows = await withRls(req, async (tx) =>
    conditions.length
      ? tx
          .select()
          .from(atelierAuditEvents)
          .where(and(...conditions))
          .orderBy(desc(atelierAuditEvents.ts))
          .limit(limit ?? 50)
      : tx
          .select()
          .from(atelierAuditEvents)
          .orderBy(desc(atelierAuditEvents.ts))
          .limit(limit ?? 50),
  );
  res.json(
    AtelierListAuditResponse.parse(
      rows.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        actorType: r.actorType as "human" | "agent" | "system",
        actorLabel: r.actorLabel,
        action: r.action,
        payloadSummary: r.payloadSummary,
        ts: r.ts.toISOString(),
      })),
    ),
  );
});

// =============================================================
// Salon-facing agent + publish endpoints (Task #242)
// =============================================================

import {
  atelierDeliverables as _atelierDeliverables,
  atelierDeliverableVersions as _atelierDeliverableVersions,
  atelierDeliverablePublishes,
  atelierSalonWorkspaces,
  atelierSalonNotifications,
  atelierSalonUserEngagementAccess,
} from "@workspace/db";
import {
  runPublishSentinel,
  runSalonConcierge,
  runEngagementCurator,
  runApprovalChoreographer,
  fanoutSalonNotification,
} from "../../lib/atelier-agents/runner.js";

function _rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

router.post("/deliverables/:id/publish", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    const [d] = await db
      .select()
      .from(_atelierDeliverables)
      .where(
        and(
          eq(_atelierDeliverables.id, req.params.id),
          isNull(_atelierDeliverables.deletedAt),
        ),
      );
    if (!d) {
      res.status(404).json({ error: "deliverable-not-found" });
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
      res.status(409).json({
        error: "no-salon-workspace",
        message: "Engagement has no Salon workspace configured",
      });
      return;
    }
    const [version] = d.currentVersionId
      ? await db
          .select()
          .from(_atelierDeliverableVersions)
          .where(eq(_atelierDeliverableVersions.id, d.currentVersionId))
      : [];
    const body = (version?.body ?? "") + " " + (d.criticReportSummary ?? "");
    const sentinel = await runPublishSentinel({
      triggeredByUserId: me.id,
      actorLabel: "Publish Sentinel",
      deliverableId: d.id,
      deliverableLabel: d.name,
      body,
    });
    const overrideRationale =
      typeof req.body?.overrideRationale === "string"
        ? String(req.body.overrideRationale).trim().slice(0, 1000)
        : null;
    // Sentinel policy (Task #242): fail = hard block (no override).
    // warn = Partner-only override with audited rationale.
    const sentinelStatus = sentinel.output.status; // "pass" | "warn" | "fail"
    const isPartner = me.role === "partner";
    let allowed = false;
    if (sentinelStatus === "pass") {
      allowed = true;
    } else if (sentinelStatus === "fail") {
      allowed = false; // hard block — override forbidden
    } else if (sentinelStatus === "warn") {
      allowed =
        sentinel.output.publishAllowed ||
        (isPartner && !!overrideRationale && overrideRationale.length >= 10);
    }
    if (!allowed && (sentinelStatus === "fail" || (sentinelStatus === "warn" && overrideRationale && !isPartner))) {
      res.status(409).json({
        error: "sentinel-blocked",
        status: sentinelStatus,
        checks: sentinel.output.checks,
        message:
          sentinelStatus === "fail"
            ? "Publish Sentinel returned fail; override not permitted."
            : "Warn-tier override requires a Partner persona.",
      });
      return;
    }
    const publishId = _rid("dpub");
    await db.insert(atelierDeliverablePublishes).values({
      id: publishId,
      deliverableId: d.id,
      deliverableVersionId: d.currentVersionId,
      engagementId: d.engagementId,
      workspaceId: workspace.id,
      publishedByAtelierUserId: me.id,
      publishedByName: me.name,
      sentinelRunId: sentinel.runId,
      sentinelStatus: sentinel.output.status,
      sentinelChecks: sentinel.output.checks,
      publishAllowed: allowed,
      overrideRationale,
      overriddenByAtelierUserId: overrideRationale ? me.id : null,
      downloadsAllowed: !!req.body?.downloadsAllowed,
      watermarkRequired: req.body?.watermarkRequired !== false,
      notes: typeof req.body?.notes === "string" ? req.body.notes : null,
    });
    if (allowed) {
      await db
        .update(_atelierDeliverables)
        .set({
          clientVisibility: "published",
          latestPublishId: publishId,
          updatedAt: new Date(),
        })
        .where(eq(_atelierDeliverables.id, d.id));
      const fanout = await fanoutSalonNotification({
        engagementId: d.engagementId,
        kind: "deliverable_published",
        headline: `${d.name} is ready for your review`,
        body: `${me.name} published a new version. Open it in your Salon.`,
        href: `/salon/${workspace.slug}/deliverables/${d.id}`,
      });
      await db.insert(atelierAuditEvents).values({
        id: _rid("aud"),
        entityType: "deliverable",
        entityId: d.id,
        actorType: "human",
        actorId: me.id,
        actorLabel: me.name,
        action: "deliverable.publish_to_salon",
        payload: { publishId, fanout, sentinelStatus: sentinel.output.status },
        payloadSummary: `${me.name} published ${d.name} to Salon (${sentinel.output.status}; ${fanout} client notif)`,
      });
    } else {
      await db.insert(atelierAuditEvents).values({
        id: _rid("aud"),
        entityType: "deliverable",
        entityId: d.id,
        actorType: "human",
        actorId: me.id,
        actorLabel: me.name,
        action: "deliverable.publish_blocked",
        payload: { publishId, sentinelStatus: sentinel.output.status, checks: sentinel.output.checks },
        payloadSummary: `Publish Sentinel BLOCKED ${d.name} (${sentinel.output.status})`,
      });
    }
    res.json({
      ok: true,
      publishId,
      publishAllowed: allowed,
      sentinel: sentinel.output,
    });
  } catch (err) {
    next(err);
  }
});

// Manual run endpoints for the four Salon agents (Agents tab + audit feed).
router.post("/agents/publish-sentinel/run", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    const text = String(req.body?.text ?? "");
    const result = await runPublishSentinel({
      triggeredByUserId: me.id,
      actorLabel: "Publish Sentinel",
      deliverableId: String(req.body?.deliverableId ?? "manual_scan"),
      deliverableLabel: String(req.body?.label ?? "Manual scan"),
      body: text,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/agents/salon-concierge/run", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    const result = await runSalonConcierge({
      triggeredByUserId: me.id,
      actorLabel: "Salon Concierge",
      workspaceId: String(req.body?.workspaceId ?? ""),
      workspaceLabel: String(req.body?.workspaceLabel ?? "Workspace"),
      invitees: Array.isArray(req.body?.invitees) ? req.body.invitees : [],
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/agents/engagement-curator/run", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    const result = await runEngagementCurator({
      triggeredByUserId: me.id,
      actorLabel: "Engagement Curator",
      engagementId: String(req.body?.engagementId ?? ""),
      engagementLabel: String(req.body?.engagementLabel ?? "Engagement"),
      decisionsLogged: Number(req.body?.decisionsLogged ?? 0),
      openRequests: Number(req.body?.openRequests ?? 0),
      highlights: Array.isArray(req.body?.highlights) ? req.body.highlights : [],
      upcoming: Array.isArray(req.body?.upcoming) ? req.body.upcoming : [],
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/agents/approval-choreographer/run", async (req, res, next) => {
  try {
    const me = req.atelierPersona;
    if (!me) {
      res.status(401).json({ error: "no-active-persona" });
      return;
    }
    const result = await runApprovalChoreographer({
      triggeredByUserId: me.id,
      actorLabel: "Approval Choreographer",
      deliverableId: String(req.body?.deliverableId ?? ""),
      deliverableLabel: String(req.body?.deliverableLabel ?? "Deliverable"),
      publishId: String(req.body?.publishId ?? ""),
      approvers: Array.isArray(req.body?.approvers) ? req.body.approvers : [],
      decisionsRecorded: Array.isArray(req.body?.decisionsRecorded)
        ? req.body.decisionsRecorded
        : [],
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
