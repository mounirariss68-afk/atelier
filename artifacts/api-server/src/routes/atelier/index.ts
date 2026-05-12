import { Router, type IRouter } from "express";
import { eq, and, desc, isNull, type SQL } from "drizzle-orm";
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
} from "./personaCookie";
import { attachRls, registerAtelierRlsDefaults, withRls } from "./rls";
import { auditPdfHandler } from "./auditPdf";

registerAtelierRlsDefaults();

const router: IRouter = Router();
router.use(attachPersona);
router.use(attachRls);

// Audit PDF export — registered before /audit JSON to win the route match.
router.get("/audit/export.pdf", auditPdfHandler);

function ensurePersona(req: any, res: any) {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona as typeof atelierUsers.$inferSelect;
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
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    accountId: o.accountId,
    accountName: acct?.name ?? o.accountId,
    plmStage: o.plmStage,
    buyerPersona: o.buyerPersona,
    offeringAnchor: o.offeringAnchor,
    partnerOwnerName: partner?.name ?? o.partnerOwnerId,
    engagementLeadName: lead?.name ?? o.engagementLeadId,
    dealSizeUsd: o.dealSizeHypothesis,
    probabilityPct: o.probabilityPct,
    weightedValueUsd: (o.dealSizeHypothesis * o.probabilityPct) / 100,
    daysInStage: o.daysInStage,
    nextMilestone: o.nextMilestone,
    sourceLead: o.sourceLead,
    createdAt: o.createdAt.toISOString(),
  };
}

router.get("/opportunities", async (_req, res) => {
  const rows = await db
    .select()
    .from(atelierOpportunities)
    .where(isNull(atelierOpportunities.deletedAt));
  const wire = await Promise.all(rows.map(buildOpportunityWire));
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

router.get("/engagements", async (_req, res) => {
  const rows = await db
    .select()
    .from(atelierEngagements)
    .where(isNull(atelierEngagements.deletedAt));
  const wire = await Promise.all(rows.map(buildEngagementWire));
  res.json(AtelierListEngagementsResponse.parse(wire));
});

router.get("/engagements/:engId", async (req, res) => {
  const [row] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, req.params.engId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "engagement-not-found" });
    return;
  }
  res.json(AtelierGetEngagementResponse.parse(await buildEngagementWire(row)));
});

// =============================================================
// Accounts / Agents / Assets
// =============================================================
router.get("/accounts", async (_req, res) => {
  const rows = await db
    .select()
    .from(atelierAccounts)
    .where(isNull(atelierAccounts.deletedAt));
  res.json(
    AtelierListAccountsResponse.parse(
      rows.map((a) => ({
        id: a.id,
        name: a.name,
        country: a.country,
        sector: a.sector,
        notes: a.notes,
      })),
    ),
  );
});

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

export default router;
