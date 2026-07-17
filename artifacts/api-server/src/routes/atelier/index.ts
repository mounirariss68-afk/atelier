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
  atelierDeliverables,
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
import { auditPdfHandler, personAuditPdfHandler } from "./auditPdf";
import { accountPlanPdfHandler } from "./accountPlanPdf";
import { accountPrepCardHandler } from "./accountPrepCard";
import agentRoutes from "./agentRoutes";
import {
  STALLED_THRESHOLD_DAYS,
  deriveSalesStage,
  isSalesStage,
  resolveSalesStage,
  funnelBucket,
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
import rosterRoutes, { rejectNonEmployeePersona } from "./rosterRoutes";
import rosterLifecycleRoutes from "./rosterLifecycleRoutes";
import skillGraphRoutes from "./skillGraphRoutes";
import ledgerRoutes from "./ledgerRoutes";
import walletRoutes from "./walletRoutes";
import invoiceRoutes from "./invoiceRoutes";
import referenceRoutes from "./referenceRoutes";
import principleOverrideRoutes from "./principleOverrideRoutes";
import firmProfileRoutes from "./firmProfileRoutes";
import cliRoutes from "./cliRoutes";
import cliAttachmentRoutes from "./cliAttachmentRoutes";
import cliAdminRoutes from "./cliAdminRoutes";
import v5Routes from "./v5Routes";
import financeEntitiesRoutes from "./financeEntitiesRoutes";
import financePayablesRoutes from "./financePayablesRoutes";
import financeComplyRoutes from "./financeComplyRoutes";
import financePlanRoutes from "./financePlanRoutes";
import financeReportsRoutes from "./financeReportsRoutes";
import agentsLensRoutes from "./agentsLensRoutes";
import codexRoutes from "./codexRoutes";
import changeOrderRoutes from "./changeOrderRoutes";
import deliverableAcceptanceRoutes from "./deliverableAcceptanceRoutes";
import revrecRoutes from "./revrecRoutes";
import bankRoutes from "./bankRoutes";
import cashRoutes from "./cashRoutes";
import renewalRoutes from "./renewalRoutes";
// Task #414 — L2C Wave 2: per-engagement P&L, EAC engine, change-order
// register and firm Engagement Health register. In-memory seed mock
// workflow for the demo; re-baselines on change-order approval.
import engagementPnlRoutes from "./engagementPnlRoutes";
// Task #442 — per-engagement Financials tab (header strip, billing
// schedule, collections, P&L, Action Center, Billing Steward agent).
import engagementFinancialsRoutes from "./engagementFinancialsRoutes";

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
    action: "cross_engagement_read",
    payload: { engagementId: eng.id, viewerRole: me.role },
    summary: `${me.name} viewed engagement ${eng.id} (cross-engagement read)`,
  });
}

registerAtelierRlsDefaults();

const router: IRouter = Router();
router.use(attachPersona);
router.use(rejectClientRealm);
router.use(attachRls);

// Task #254 — Centralized non-employee boundary. Contractors and
// partner-firm resources may ONLY hit engagement-scoped routes plus
// identity (me / personas) and their own roster dossier surfaces.
// Per-route `rejectNonEmployeePersona` calls remain as defense-in-depth.
router.use((req, res, next) => {
  const me = req.atelierPersona;
  if (!me) return next();
  // Task #354 (v5) — recruiter is restricted to /studio (their workspace),
  // identity, and the personas list. Engagements + every other v5 surface
  // are off-limits; see personaRoles.ts and v5Routes.ts for the same rule
  // applied per-route as defense-in-depth.
  if (me.role === "recruiter") {
    const rp = req.path;
    // Strictly: /studio (their workspace) + /me + /personas (persona
    // switcher). /users is intentionally NOT allowed — recruiters do not
    // need org-wide user enumeration; panelist/interviewer lookups belong
    // inside /studio with a recruiter-safe shape.
    if (rp === "/me" || rp.startsWith("/personas")) return next();
    if (rp.startsWith("/studio/")) return next();
    res.status(403).json({
      error: "recruiter-scope",
      message:
        "Recruiter persona may only access /studio, /me, and /personas.",
    });
    return;
  }
  if (me.role !== "contractor" && me.role !== "partner_firm_resource")
    return next();
  const p = req.path;
  if (p === "/me" || p.startsWith("/personas")) return next();
  if (p === "/engagements" || p.startsWith("/engagements/")) return next();
  // Contractors may view/submit their OWN timesheet; partner-firm resources
  // never appear in the ledger UI but DO upload their firm's hours via the
  // partner-firm CSV endpoint and may read their own engagement's economics.
  if (me.role === "contractor" && p.startsWith("/ledger/timesheets")) return next();
  // Contractors may submit/view their OWN wallet expenses (scope=self).
  if (me.role === "contractor" && p.startsWith("/wallet/expenses")) return next();
  if (me.role === "partner_firm_resource" && p.startsWith("/ledger/partner-firm-hours")) return next();
  if (me.role === "partner_firm_resource" && p.startsWith("/ledger/engagement-economics")) return next();
  // Allow per-person dossier endpoints only for the caller's OWN identity
  // (no IDOR enumeration of other people's PII / HR metadata). The :id
  // segment must equal the active persona id; bare `/roster/people` and
  // `/roster/people/` (the partner-only list view) are NOT allowlisted.
  // NOTE: this matches on `me.id` (atelier_users.id). Non-employee dossier
  // rows in `atelier_contractors` / `atelier_partner_firm_resources` use
  // their own primary keys (no `user_id` FK back to atelier_users), so
  // self-dossier access for non-employees is a follow-up workstream that
  // will need a persona→person mapping before this allowlist can resolve.
  const ownDossier = new RegExp(
    `^/roster/people/${me.id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?:/|$)`,
  );
  if (ownDossier.test(p)) return next();
  res.status(403).json({
    error: "non-employee-persona-not-allowed-here",
    message:
      "Contractors and partner-firm resources may only access engagement-scoped routes.",
  });
});

// Audit PDF export — registered before /audit JSON to win the route match.
router.get("/audit/export.pdf", auditPdfHandler);
// Task #261 — Per-Person audit pack PDF (Roster).
router.get("/roster/people/:id/audit", personAuditPdfHandler);
// Task #571 — One-page account-plan / QBR PDF brief.
router.get("/accounts/:accountId/plan.pdf", accountPlanPdfHandler);
// Task #589 — Self-contained first-meeting prep card (HTML).
router.get("/accounts/:accountId/meeting-prep.html", accountPrepCardHandler);

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
// Mount v3 Roster routes (Task #254). Roster endpoints accept any
// authenticated persona — comp/bank fields are stripped server-side
// for non-Partner/Operations callers.
router.use(rosterRoutes);
// Task #255 — onboarding / offboarding sequences, compliance roll-ups,
// conflict-of-interest mutations + Partner override.
router.use(rosterLifecycleRoutes);
// Task #256 — Skill graph + Skill Mapper.
router.use(skillGraphRoutes);
// Task #257 — v3 Ledger: Timesheets + Time Steward.
router.use(ledgerRoutes);
// Task #259 — v3 Wallet: Expenses + Auditor + Policy + FX + VAT.
router.use(walletRoutes);
router.use(invoiceRoutes);
router.use("/wallet/bank", bankRoutes);
router.use("/wallet/cash", cashRoutes);
router.use("/crm/renewals", renewalRoutes);
// Task #290 — Reference-data lookups (countries / industries / sub-industries).
router.use(referenceRoutes);
router.use(principleOverrideRoutes);
router.use(firmProfileRoutes);
// Task #331 — Atelier CLI: SSE turn endpoint, sessions, confirm/cancel.
router.use(cliRoutes);
router.use(cliAttachmentRoutes);
router.use(cliAdminRoutes);
// Task #354 — v5 firm-wide knowledge surfaces (Press / Alliances / Studio /
// Guardhouse / IP catalog) backed by Postgres.
router.use(v5Routes);
router.use(financeEntitiesRoutes);
// Task #418 — Finance Payables (P2P) hardening: vendor master, POs +
// 3-way match, payment runs (maker-checker + dual signatories), WHT
// register, subcontractor pay-when-paid. Seed-only data.
router.use(financePayablesRoutes);
// Task #419 — Wave 7: internal controls catalogue + SoD matrix,
// statutory filings register, transfer-pricing register and
// insurance register. All read-only seed; mounts under /api/atelier
// with persona gating mirroring financeEntitiesRoutes.
router.use(financeComplyRoutes);
// Task #415 — Finance Plan: 13-week direct-method cash forecast and
// backlog/pipeline coverage. Seed-only data.
router.use(financePlanRoutes);
// Task #417 — Finance Reports (Wave 5): three-statement (P&L, BS, CF)
// per entity + consolidated with FX translation and IC eliminations,
// profitability cube, board pack with PDF export and monthly schedules.
router.use(financeReportsRoutes);
// Task #373 — Agents lens (Design / Build / Evaluate / Deploy / Improve /
// Retire) backed by Postgres; replaces the client-side seed module.
router.use(agentsLensRoutes);
// Task #360 — L2C Wave 1: Codex (CLM) — counterparty registry + clause
// library (Step 2). Contract record + state machine land in Step 3 in the
// same file. Change orders, deliverable acceptance, e-sign / DPA flows
// ship in their own route files.
router.use(codexRoutes);
// Task #360 — L2C Wave 1, Step 6: Change Order workflow with the
// draft → partner_approved → client_proposed → client_{accepted,rejected,
// withdrawn} → posted state machine. value_delta_usd masked for
// non-leadership / non-finance personas.
router.use(changeOrderRoutes);
// Task #360 — L2C Wave 1, Step 7: Deliverable Acceptance workflow.
// pending → submitted_to_client → client_signed | client_rejected |
// withdrawn. Wave-2 milestone state machine reads
// atelier_milestone_acceptance_v (migration 0032) to enforce that
// `client_accepted` requires a `client_signed` row here.
router.use(deliverableAcceptanceRoutes);

// L2C Wave 2 (Task #361) — Revenue recognition, period postings,
// adjustments, WIP snapshots, engagement margin, leakage. Mounts
// /revrec/*, /wip/*, /margin/*, /leakage. Gated per-handler.
router.use(revrecRoutes);

// Task #414 — Wave 2 engagement P&L / EAC / change-order register.
router.use(engagementPnlRoutes);
router.use(engagementFinancialsRoutes);

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

// Active atelier users — used by owner pickers (e.g. New Opportunity dialog).
router.get("/users", async (_req, res) => {
  const rows = await db
    .select()
    .from(atelierUsers)
    .where(isNull(atelierUsers.deletedAt));
  res.json(rows.map(personaToWire));
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

router.get("/home", rejectNonEmployeePersona, async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;

  // Pane A — items addressed to this persona (or unassigned high-prio for Partners).
  const paneARowsRaw = await db
    .select()
    .from(atelierPaneAItems)
    .where(
      and(eq(atelierPaneAItems.userId, me.id), isNull(atelierPaneAItems.resolvedAt)),
    );
  // Defensive orphan filter: never surface an opportunity-linked item whose
  // opportunity has been deleted (soft or hard) — e.g. leftover Win/Loss
  // debrief reminders for opportunities that no longer exist.
  const paneOppIds = [
    ...new Set(
      paneARowsRaw.filter((r) => r.hrefKind === "opportunity").map((r) => r.hrefTargetId),
    ),
  ];
  const livePaneOpps = paneOppIds.length
    ? await db
        .select({ id: atelierOpportunities.id })
        .from(atelierOpportunities)
        .where(
          and(
            inArray(atelierOpportunities.id, paneOppIds),
            isNull(atelierOpportunities.deletedAt),
          ),
        )
    : [];
  const livePaneOppIds = new Set(livePaneOpps.map((o) => o.id));
  // Same defensive filter for engagement- and deliverable-linked items:
  // Pane A hrefs are polymorphic, so a card whose target row is missing or
  // soft-deleted must never surface as a dead link.
  const paneEngIds = [
    ...new Set(
      paneARowsRaw.filter((r) => r.hrefKind === "engagement").map((r) => r.hrefTargetId),
    ),
  ];
  const livePaneEngs = paneEngIds.length
    ? await db
        .select({ id: atelierEngagements.id })
        .from(atelierEngagements)
        .where(
          and(
            inArray(atelierEngagements.id, paneEngIds),
            isNull(atelierEngagements.deletedAt),
          ),
        )
    : [];
  const livePaneEngIds = new Set(livePaneEngs.map((e) => e.id));
  const paneDelIds = [
    ...new Set(
      paneARowsRaw.filter((r) => r.hrefKind === "deliverable").map((r) => r.hrefTargetId),
    ),
  ];
  const livePaneDels = paneDelIds.length
    ? await db
        .select({ id: atelierDeliverables.id })
        .from(atelierDeliverables)
        .where(
          and(
            inArray(atelierDeliverables.id, paneDelIds),
            isNull(atelierDeliverables.deletedAt),
          ),
        )
    : [];
  const livePaneDelIds = new Set(livePaneDels.map((d) => d.id));
  const paneARows = paneARowsRaw.filter((r) => {
    if (r.hrefKind === "opportunity") return livePaneOppIds.has(r.hrefTargetId);
    if (r.hrefKind === "engagement") return livePaneEngIds.has(r.hrefTargetId);
    if (r.hrefKind === "deliverable") return livePaneDelIds.has(r.hrefTargetId);
    return true;
  });
  const paneA = paneARows
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary,
      priority: (r.priority === "critical" ? "high" : r.priority) as
        | "high"
        | "medium"
        | "low",
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
    const list = opps.filter((o) => funnelBucket(o.salesStage) === stage);
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
router.get("/activity", rejectNonEmployeePersona, async (req, res) => {
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
    // Task #8 — deal values are denominated in the account's primaryCurrency;
    // surface it so the UI never hardcodes a "$"/USD label.
    currency: acct?.primaryCurrency ?? "USD",
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
    // Task #540 — structured weighted qualification rubric (null until scored).
    qualificationRubric: o.qualificationRubric ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

router.get("/opportunities", rejectNonEmployeePersona, async (req, res) => {
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

router.get("/opportunities/:oppId", rejectNonEmployeePersona, async (req, res) => {
  const [row] = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.id, req.params.oppId as string),
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

router.get("/assets", rejectNonEmployeePersona, async (_req, res) => {
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
    const isPartner = (me.role === "partner" || me.role === "founding_partner");
    let allowed = false;
    if (sentinelStatus === "pass") {
      allowed = true;
    } else if (sentinelStatus === "fail") {
      allowed = false; // hard block — override forbidden
    } else if (sentinelStatus === "warn") {
      // Warn requires Partner persona + ≥10-char rationale. Sentinel's own
      // publishAllowed flag is intentionally ignored here so non-Partner
      // callers cannot silently slip warns past the gate.
      allowed = isPartner && !!overrideRationale && overrideRationale.length >= 10;
    }
    // Persist EVERY publish attempt (allowed or blocked) so the audit table
    // matches the schema intent ("records every push"). Blocked rows carry
    // publishAllowed:false and the Sentinel checks for forensic review.
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
    if (!allowed) {
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
      res.status(409).json({
        error: "sentinel-blocked",
        status: sentinelStatus,
        checks: sentinel.output.checks,
        publishId,
        message:
          sentinelStatus === "fail"
            ? "Publish Sentinel returned fail; override not permitted."
            : "Warn-tier override requires a Partner persona.",
      });
      return;
    }
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
