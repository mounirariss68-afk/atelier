import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, inArray, or, gte, type SQL } from "drizzle-orm";
import { effectiveAgentRunStatus } from "../../lib/atelier-agents/run-staleness.js";
import { ATELIER_AGENTS, getAgent } from "@workspace/agents";
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
  atelierEmployees,
  atelierContractors,
  atelierEngagementAccess,
  atelierInvoice,
  atelierPartnerFirms,
} from "@workspace/db";
import { opportunityPartnerFirms } from "../../lib/atelier-opportunity-partners.js";
import { partnerOpportunityPdf } from "../../lib/atelier-partner-opportunity-pdf.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
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
import { canAccessPartnersLens } from "./personaRoles";
import { attachRls, registerAtelierRlsDefaults, withRls } from "./rls";
import { auditPdfHandler, personAuditPdfHandler } from "./auditPdf";
import { accountPlanPdfHandler } from "./accountPlanPdf";
import { accountPrepCardHandler } from "./accountPrepCard";
import agentRoutes from "./agentRoutes";
import {
  SALES_STAGES,
  STALLED_THRESHOLD_DAYS,
  deriveSalesStage,
  isSalesStage,
  resolveSalesStage,
} from "../../lib/atelier-agents/pipeline.js";
import proposalRoutes from "./proposalRoutes";
import knowledgeRoutes from "./knowledgeRoutes";
import accountRoutes from "./accountRoutes";
// Task #1297 — Non-Equity Partner scoped-access helpers + grant routes.
import {
  nepAccessFor,
  nepCanSeeOpportunity,
} from "../../lib/atelier-nep-access.js";
import nepAccessRoutes from "./nepAccessRoutes";
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
// Task #50 — Me lens self-scope routes + HR joiner lifecycle.
import meRoutes from "./meRoutes";
import payRoutes from "./payRoutes";
// Task #53 — Me lens self-service: timesheets, leave, expense claims.
import meSelfServiceRoutes from "./meSelfServiceRoutes";
import meTasksRoutes from "./meTasksRoutes";
import mePushRoutes from "./mePushRoutes";
import meSelfBillingRoutes from "./meSelfBillingRoutes";
import delegationRoutes from "./delegationRoutes";
// Task #55 — performance reviews/goals + training library.
import performanceRoutes from "./performanceRoutes";
import meProfileRoutes from "./meProfileRoutes";
import meLetterRoutes from "./meLetterRoutes";
import msAuthRoutes from "./msAuthRoutes";
import joinerRoutes from "./joinerRoutes";
import msProvisioningRoutes from "./msProvisioningRoutes";
import hireRoutes from "./hireRoutes";
import rosterLifecycleRoutes from "./rosterLifecycleRoutes";
import skillGraphRoutes from "./skillGraphRoutes";
import ledgerRoutes from "./ledgerRoutes";
import walletRoutes from "./walletRoutes";
import invoiceRoutes from "./invoiceRoutes";
import billingRoutes from "./billingRoutes";
import referenceRoutes from "./referenceRoutes";
import principleOverrideRoutes from "./principleOverrideRoutes";
import firmProfileRoutes from "./firmProfileRoutes";
import cliRoutes from "./cliRoutes";
// Task #887 — shared alliance-partner /cli allowlist + route annotations.
import { isPartnerCliPathAllowed } from "./partnerPortalCliSurface";
import cliAttachmentRoutes from "./cliAttachmentRoutes";
import documentRoutes from "./documentRoutes";
// Task #62 — E-signing via DocuSeal (signature requests).
import esignRoutes from "./esignRoutes";
import contractLifecycleRoutes from "./contractLifecycleRoutes";
import cliAdminRoutes from "./cliAdminRoutes";
import v5Routes from "./v5Routes";
import partnersRoutes from "./partnersRoutes";
import partnerPortalRoutes from "./partnerPortalRoutes";
import partnerBillingRoutes from "./partnerBillingRoutes";
import { partnerPortalThrottle } from "./portalFirmResolver";
import financeEntitiesRoutes from "./financeEntitiesRoutes";
import shareholderFundingRoutes from "./shareholderFundingRoutes";
import preformationRoutes from "./preformationRoutes";
import expenseTaxonomyRoutes from "./expenseTaxonomyRoutes";
import financePayablesRoutes from "./financePayablesRoutes";
import financeComplyRoutes from "./financeComplyRoutes";
import payrollRoutes from "./payrollRoutes";
import nepCompRoutes from "./nepCompRoutes";
import governanceRoutes from "./governanceRoutes";
import ownershipRoutes from "./ownershipRoutes";
import financePlanRoutes, { computeBacklogKpisForOrg } from "./financePlanRoutes";
import financeReportsRoutes from "./financeReportsRoutes";
import financeMvpSummaryRoutes from "./financeMvpSummaryRoutes";
import codexRoutes from "./codexRoutes";
import changeOrderRoutes from "./changeOrderRoutes";
import deliverableAcceptanceRoutes from "./deliverableAcceptanceRoutes";
import revrecRoutes from "./revrecRoutes";
import glRoutes from "./glRoutes";
import closeRoutes from "./closeRoutes";
import financeAutopilotRoutes from "./financeAutopilotRoutes";
// Task #1251 — vendor tooling spend: line-item mining + project cost
// allocation. Finance-leadership gated inside the router.
import financeToolingRoutes from "./financeToolingRoutes";
import vatRoutes from "./vatRoutes";
import marginReportsRoutes from "./marginReportsRoutes";
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
// Task #383 — expense taxonomy reference data + the categorize-suggest
// helper are safe for every submitter persona (they only expose the shared
// category tree, cost centers, funding sources, entity id+name, and a
// per-request AI suggestion). The Me-lens expense UI needs them.
function isExpenseTaxonomyHelper(p: string): boolean {
  return p === "/wallet/expense-taxonomy" || p === "/wallet/expense-categorize/suggest";
}

router.use((req, res, next) => {
  const me = req.atelierPersona;
  if (!me) return next();
  // Task #354 (v5) — recruiter is restricted to /studio (their workspace),
  // identity, and the personas list. Engagements + every other v5 surface
  // are off-limits; see personaRoles.ts and v5Routes.ts for the same rule
  // applied per-route as defense-in-depth.
  if (me.role === "recruiter") {
    const rp = req.path;
    // Strictly: /studio (their workspace) + /me + /me/* (Task #50 Me-lens
    // self-scope) + /personas (persona switcher). /users is intentionally
    // NOT allowed — recruiters do not need org-wide user enumeration;
    // panelist/interviewer lookups belong inside /studio with a
    // recruiter-safe shape.
    if (rp === "/me" || rp.startsWith("/me/") || rp.startsWith("/personas"))
      return next();
    // Task #51 — profile photos are org-visible (roster views, bio flow).
    if (rp.startsWith("/people-photos/")) return next();
    if (isExpenseTaxonomyHelper(rp)) return next();
    if (rp.startsWith("/studio/")) return next();
    res.status(403).json({
      error: "recruiter-scope",
      message:
        "Recruiter persona may only access /studio, /me, and /personas.",
    });
    return;
  }
  // Task #873 — alliance-partner portal logins. Their entire world is
  // the partner portal: identity (/me), the grant-scoped /partner-portal
  // reads, and chat (/cli — clamped server-side to the partnerportal.*
  // capability set in the capability catalog). Everything else — CRM,
  // roster, finance, documents, /partners alliance intel, /users
  // enumeration — is forbidden here at the central gate.
  if (me.role === "alliance_partner") {
    const p = req.path;
    if (p === "/me") return next();
    // /personas answers with ONLY the caller's own persona for this role
    // (see the self-only branch in the /personas handler below).
    if (p === "/personas") return next();
    if (p === "/partner-portal" || p.startsWith("/partner-portal/")) return next();
    // /cli chat is allowed via an explicit sub-path allowlist (tool surface
    // is clamped to partnerportal.* in getToolsForPersona). Everything else
    // under /cli — attachments (internal-document side channel), admin
    // metrics, help/suggestion indexes, turn recordings — stays 403.
    // Task #887 — the sub-path allowlist lives in partnerPortalCliSurface
    // (single source of truth shared with the partner-portal probe suite,
    // which ratchets every /cli route against the annotation registry).
    if (p === "/cli" || p.startsWith("/cli/")) {
      if (isPartnerCliPathAllowed(p)) return next();
      res.status(403).json({
        error: "alliance-partner-scope",
        message: "This chat feature is not available to alliance-partner logins.",
      });
      return;
    }
    res.status(403).json({
      error: "alliance-partner-scope",
      message:
        "Alliance-partner logins may only access their assigned opportunities via the partner portal.",
    });
    return;
  }
  // Task #50 — self-only employee persona (created by the HR add-joiner
  // flow). Their whole world is the Me lens: identity, self-scope /me/*
  // routes and the persona list. Nothing org-wide, no client surfaces.
  if (me.role === "employee") {
    const p = req.path;
    if (p === "/me" || p.startsWith("/me/") || p.startsWith("/personas"))
      return next();
    // Task #51 — profile photos are org-visible (roster views, bio flow).
    if (p.startsWith("/people-photos/")) return next();
    if (isExpenseTaxonomyHelper(p)) return next();
    // Task #422 — chat is allowed for self personas: their capability
    // surface is clamped server-side to the identity-locked me.* tools
    // (SELF_ONLY_CHAT_ROLES in the capability catalog), so /cli/* cannot
    // reach anything outside the Me lens.
    if (p === "/cli" || p.startsWith("/cli/")) return next();
    res.status(403).json({
      error: "employee-self-scope",
      message: "Employee persona may only access /me and /personas.",
    });
    return;
  }
  // Task #1297 — Non-Equity Partner (NEP). Their world is the Me lens
  // (self-scope, like employee/contractor) PLUS a deliberately narrow CRM
  // slice: accounts they own or were granted, opportunities they own or
  // were invited into, and creating their own accounts/opportunities.
  // Everything else — finance, roster, pipeline rollups, partners lens,
  // documents, users enumeration — is forbidden at this central gate.
  if (me.role === "non_equity_partner") {
    const p = req.path;
    const method = req.method.toUpperCase();
    if (p === "/me" || p.startsWith("/me/") || p.startsWith("/personas"))
      return next();
    if (p.startsWith("/people-photos/")) return next();
    if (isExpenseTaxonomyHelper(p)) return next();
    // Chat: clamped server-side to me.* + their accessible-CRM slice via
    // SELF_ONLY_CHAT_ROLES + the NEP entity clamp in the capability layer.
    if (p === "/cli" || p.startsWith("/cli/")) return next();
    // Accounts: reads flow through canSeeAccount (NEP-aware). Creates are
    // allowed (ownership forced to self). WRITES under an existing account
    // are only allowed when the NEP is the partner owner of that account.
    if (p === "/accounts") return next(); // GET list / POST create
    const acctMatch = p.match(/^\/accounts\/([^/]+)/);
    if (acctMatch) {
      if (method === "GET") return next(); // per-route canSeeAccount gates
      void (async () => {
        const [acct] = await db
          .select({ partnerOwnerId: atelierAccounts.partnerOwnerId })
          .from(atelierAccounts)
          .where(eq(atelierAccounts.id, acctMatch[1]!));
        if (acct && acct.partnerOwnerId === me.id) return next();
        res.status(403).json({
          error: "nep-scope",
          message:
            "Non-equity partners can only edit accounts they own.",
        });
      })().catch(next);
      return;
    }
    // Opportunities: list/detail are NEP-filtered in their handlers;
    // creates are allowed (ownership forced to self); writes require
    // ownership of the opportunity.
    if (p === "/opportunities") return next(); // GET list / POST create
    const oppMatch = p.match(/^\/opportunities\/([^/]+)/);
    if (oppMatch) {
      void (async () => {
        const [opp] = await db
          .select()
          .from(atelierOpportunities)
          .where(
            and(
              eq(atelierOpportunities.id, oppMatch[1]!),
              isNull(atelierOpportunities.deletedAt),
            ),
          );
        if (!opp) {
          res.status(404).json({ error: "opportunity-not-found" });
          return;
        }
        const nep = await nepAccessFor(me.id);
        if (!nepCanSeeOpportunity(nep, opp, me.id)) {
          res.status(404).json({ error: "opportunity-not-found" });
          return;
        }
        if (method !== "GET" && opp.partnerOwnerId !== me.id) {
          res.status(403).json({
            error: "nep-scope",
            message:
              "Non-equity partners can only edit opportunities they own.",
          });
          return;
        }
        next();
      })().catch(next);
      return;
    }
    res.status(403).json({
      error: "nep-scope",
      message:
        "Non-equity partner logins may only access /me, their own accounts and opportunities, and chat.",
    });
    return;
  }
  // Task #50 — contractors are a self-only persona exactly like employees:
  // their whole world is the Me lens. The legacy contractor allowlist
  // (/engagements, /ledger/timesheets, /wallet/expenses) is retired — those
  // capabilities return as self-scoped /me/* sections in dependent tasks.
  if (me.role === "contractor") {
    const p = req.path;
    if (p === "/me" || p.startsWith("/me/") || p.startsWith("/personas"))
      return next();
    // Task #51 — profile photos are org-visible (roster views, bio flow).
    if (p.startsWith("/people-photos/")) return next();
    if (isExpenseTaxonomyHelper(p)) return next();
    // Task #422 — chat for self personas, clamped to me.* tools (see
    // SELF_ONLY_CHAT_ROLES in the capability catalog).
    if (p === "/cli" || p.startsWith("/cli/")) return next();
    res.status(403).json({
      error: "contractor-self-scope",
      message: "Contractor persona may only access /me and /personas.",
    });
    return;
  }
  if (me.role !== "partner_firm_resource") return next();
  const p = req.path;
  // Task #50 — the Me lens self-scope routes are safe for every persona:
  // they only ever answer for the caller's own identity.
  if (p === "/me" || p.startsWith("/me/") || p.startsWith("/personas"))
    return next();
  // Task #51 — profile photos are org-visible (roster views, bio flow).
  if (p.startsWith("/people-photos/")) return next();
  if (isExpenseTaxonomyHelper(p)) return next();
  if (p === "/engagements" || p.startsWith("/engagements/")) return next();
  // Partner-firm resources never appear in the ledger UI but DO upload
  // their firm's hours via the partner-firm CSV endpoint and may read
  // their own engagement's economics.
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

// Task #513 — Partners lens boundary. Firm-wide alliance intel (/partners,
// legacy /alliances) is internal-only: the shared `canAccessPartnersLens`
// predicate allows partner-tier / consultant-tier / finance / hr /
// compliance_officer. External personas (partner_firm_resource above all),
// recruiters, self-only personas and board observers are denied here at
// the gate — per-route checks in partnersRoutes remain as defense-in-depth.
router.use((req, res, next) => {
  const me = req.atelierPersona;
  if (!me) return next();
  const p = req.path;
  const isPartnersSurface =
    p === "/partners" ||
    p.startsWith("/partners/") ||
    p === "/alliances" ||
    p.startsWith("/alliances/");
  if (!isPartnersSurface) return next();
  if (canAccessPartnersLens(me.role)) return next();
  res.status(403).json({
    error: "partners-lens-restricted",
    message: "The Partners lens is restricted to internal roles.",
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

// Task #50 — Me lens self-scope routes (safe for every persona; the only
// routes self-only personas can reach) + HR joiner lifecycle. Mounted
// early so /me/* wins before any broader router pattern.
router.use(meRoutes);
// Task #54 — Personal pay hub: self-scope /me/pay/* + HR /roster/pay/*.
// Mounted with meRoutes so employee/contractor allowlists cover /me/pay.
router.use(payRoutes);
// Task #53 — self-service timesheets / leave / expenses (+ approver
// surfaces under /roster/leave-*). Mounted with meRoutes so /me/* wins
// before broader router patterns.
router.use(meSelfServiceRoutes);
// Task #430 — self-billed (RCTI) invoice self-scope surfaces for
// contractors + partner-firm resources: view, download, dispute.
router.use(meSelfBillingRoutes);
// Task #1002 — personal tasks & reminders (/me/tasks, strictly self-scope).
router.use(meTasksRoutes);
// Task #1010 — device push-token registration (/me/push-tokens, self-scope).
router.use(mePushRoutes);
// Task #386 — EA delegation: partner /me/delegates/* + EA /me/assist/*.
// Mounted with the other /me routers so the self-only-persona boundary
// (and the /cli/* block) already covers EA personas.
router.use(delegationRoutes);
// Task #55 — performance reviews/goals + training library.
router.use(performanceRoutes);
router.use(meProfileRoutes);
// Task #845 — self-service signed salary & employment letters (/me/letters).
router.use(meLetterRoutes);
// Task #327 — per-user Microsoft 365 connection + calendar (self-scope
// /me/msauth/*, /me/msconnection, /me/calendar — safe for every persona).
router.use(msAuthRoutes);
router.use(joinerRoutes);
// Task #628 — Microsoft 365 provisioning admin surface (HR / founders).
router.use(msProvisioningRoutes);
router.use(hireRoutes);
// Mount agent / opportunity write routes (Task #221).
router.use(agentRoutes);
router.use(accountRoutes);
// Task #1297 — NEP account grants + opportunity invites (leadership only).
router.use(nepAccessRoutes);
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
// Governance classification PATCH must precede the legacy broad roster PATCH.
router.use(governanceRoutes);
// Task #1363 — normalized ownership, commercial rights and distributions.
router.use(ownershipRoutes);
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
// Task #429 — Automated billing: rules, triggers, orchestrator worklist.
router.use(billingRoutes);
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
router.use(documentRoutes);
// Task #62 — E-signing (partner-tier gated inside the router).
router.use(esignRoutes);
// Task #159 — Contract lifecycle (templates → prepare → sign → track).
router.use(contractLifecycleRoutes);
router.use(cliAdminRoutes);
// Task #354 — v5 firm-wide knowledge surfaces (Press / Alliances / Studio /
// Guardhouse / IP catalog) backed by Postgres.
router.use(v5Routes);
// Task #513 — Partners lens CRUD (unified registry, co-sell, certs,
// conflicts, e-sign/RCTI projections). Central Partners gate above applies.
router.use(partnersRoutes);
// Task #1173 — per-user throttle on ALL /partner-portal/* traffic, mounted
// ONCE here before BOTH portal routers so partnerBillingRoutes (contracts,
// inbox, invoices, issued, multipart uploads) is covered too and a request
// is counted exactly once. Preview (internal staff) is exempt.
router.use("/partner-portal", partnerPortalThrottle);
// Task #873 — alliance-partner portal: grant-scoped partner reads
// (/partner-portal/*) + leadership grant/login admin surfaces.
router.use(partnerPortalRoutes);
// Task #875 — partner contracts & billing hub (portal + internal surfaces).
router.use(partnerBillingRoutes);
router.use(financeEntitiesRoutes);
router.use(shareholderFundingRoutes);
// Task #1092 — pre-formation entity cost pools (dashboard + settlement).
router.use(preformationRoutes);
// Task #383 — expense taxonomy, categorization suggestions, GL/VAT
// mappings, bank signatory register, client-ready exports.
router.use(expenseTaxonomyRoutes);
// Task #418 — Finance Payables (P2P) hardening: vendor master, POs +
// 3-way match, payment runs (maker-checker + dual signatories), WHT
// register, subcontractor pay-when-paid. Seed-only data.
router.use(financePayablesRoutes);
// Task #419 — Wave 7: internal controls catalogue + SoD matrix,
// statutory filings register, transfer-pricing register and
// insurance register. All read-only seed; mounts under /api/atelier
// with persona gating mirroring financeEntitiesRoutes.
router.use(financeComplyRoutes);
// Task #655 — country statutory payroll layer: payroll runs (GL-posted),
// EOSB accruals/settlements, filing-calendar backfill. Finance-leadership
// gated inside the router.
router.use(payrollRoutes);
// Task #1298 — Non-salaried NEP compensation: effective-dated plans,
// origination/material-contribution attribution, margin-share
// entitlements, conversion tracker + /me/nep-comp self view.
router.use(nepCompRoutes);
// Task #415 — Finance Plan: 13-week direct-method cash forecast and
// backlog/pipeline coverage. Seed-only data.
router.use(financePlanRoutes);
// Task #417 — Finance Reports (Wave 5): three-statement (P&L, BS, CF)
// per entity + consolidated with FX translation and IC eliminations,
// profitability cube, board pack with PDF export and monthly schedules.
router.use(financeReportsRoutes);
router.use(financeMvpSummaryRoutes);
// Task #373 — Agents lens (Design / Build / Evaluate / Deploy / Improve /
// Retire) backed by Postgres; replaces the client-side seed module.
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

// Task #428 — Finance GL backbone: chart of accounts, append-only
// journal, entity tagging, Bookkeeper posting agent, trial balance.
router.use(glRoutes);
router.use(closeRoutes);
// Task #1091 — Finance autopilot: founder-editable thresholds (D1), the
// unified approvals inbox (aggregation only — actions stay on the existing
// endpoints), and reverse-and-repost for agent-posted journals. Persona
// gating (finance leadership) is enforced per-handler.
router.use(financeAutopilotRoutes);
// Task #1251 — vendor tooling spend console (finance-leadership gated).
router.use(financeToolingRoutes);
router.use(vatRoutes);

// Task #434 — Margin / realization reporting suite: sold-position
// snapshots, client margin rollups, overhead allocation, realization
// report, Margin Sentinel. Mounts /margin-reports/*. Gated per-handler.
router.use(marginReportsRoutes);

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

router.get("/personas", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Self-only personas (employee/contractor) never see the org directory:
  // they get exactly their own persona back — nothing to switch to. Everyone
  // else is org-scoped, so no cross-org identity exposure either.
  // Task #873 — alliance partners are external: they must never see the
  // org directory either.
  if (me.role === "employee" || me.role === "contractor" || me.role === "alliance_partner") {
    res.json(AtelierListPersonasResponse.parse([personaToWire(me)]));
    return;
  }
  const rows = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.orgId, me.orgId), isNull(atelierUsers.deletedAt)));
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
  // Task #732 — account-linked items (procurement renewal reminders) must
  // not surface for deleted or archived accounts.
  const paneAccIds = [
    ...new Set(
      paneARowsRaw.filter((r) => r.hrefKind === "account").map((r) => r.hrefTargetId),
    ),
  ];
  const livePaneAccs = paneAccIds.length
    ? await db
        .select({ id: atelierAccounts.id, status: atelierAccounts.status })
        .from(atelierAccounts)
        .where(
          and(
            inArray(atelierAccounts.id, paneAccIds),
            isNull(atelierAccounts.deletedAt),
          ),
        )
    : [];
  const livePaneAccIds = new Set(
    livePaneAccs.filter((a) => (a.status ?? "active") !== "archived").map((a) => a.id),
  );
  const paneARows = paneARowsRaw.filter((r) => {
    if (r.hrefKind === "opportunity") return livePaneOppIds.has(r.hrefTargetId);
    if (r.hrefKind === "engagement") return livePaneEngIds.has(r.hrefTargetId);
    if (r.hrefKind === "deliverable") return livePaneDelIds.has(r.hrefTargetId);
    if (r.hrefKind === "account") return livePaneAccIds.has(r.hrefTargetId);
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
      hrefKind: r.hrefKind as
        | "opportunity"
        | "engagement"
        | "deliverable"
        | "atelier"
        | "account",
      hrefTargetId: r.hrefTargetId,
      dueLabel: r.dueLabel,
    }));

  // Pane B — pipeline + engagements
  const opps = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.orgId, me.orgId),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  // Task #175 — group directly by the canonical 5-stage funnel (+3 terminals)
  // instead of the retired legacy Identify/Shape/Pursue buckets.
  const pipeline = SALES_STAGES.map((stage) => {
    const list = opps.filter((o) => resolveSalesStage(o.salesStage) === stage);
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
    .where(
      and(
        eq(atelierEngagements.orgId, me.orgId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
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

  // ── Task #983 — role-gated KPI band figures ─────────────────────
  // Each block mirrors the gate of the page its number comes from:
  //   winRate   — pipeline data, visible to every org-wide Home viewer.
  //   headcount — roster list gate (fp/partner/senior_manager/finance/hr).
  //   ar        — working-capital report gate (fp/partner/finance).
  //   backlog   — finance plan gate (fp/partner/finance/senior_manager).
  const OPEN_STAGES = new Set(["suspect", "prospect", "convert", "runner"]);
  const wonCount = opps.filter((o) => resolveSalesStage(o.salesStage) === "contract").length;
  const closedCount = opps.filter((o) =>
    ["contract", "lost", "no_decision", "withdrawn"].includes(resolveSalesStage(o.salesStage)),
  ).length;
  const openOpps = opps.filter((o) => OPEN_STAGES.has(resolveSalesStage(o.salesStage)));
  const kpis: Record<string, unknown> = {
    winRate: {
      winRatePct: closedCount > 0 ? Math.round((wonCount / closedCount) * 1000) / 10 : 0,
      wonCount,
      closedCount,
      agedCount: openOpps.filter((o) => o.daysInStage > STALLED_THRESHOLD_DAYS).length,
      openCount: openOpps.length,
    },
  };

  const canSeeRoster = ["founding_partner", "partner", "senior_manager", "finance", "hr"].includes(me.role);
  if (canSeeRoster) {
    const [empRows, conRows] = await Promise.all([
      db
        .select({ id: atelierEmployees.id, userId: atelierEmployees.userId, status: atelierEmployees.status })
        .from(atelierEmployees)
        .where(and(eq(atelierEmployees.orgId, me.orgId), isNull(atelierEmployees.deletedAt))),
      db
        .select({ id: atelierContractors.id, status: atelierContractors.status })
        .from(atelierContractors)
        .where(and(eq(atelierContractors.orgId, me.orgId), isNull(atelierContractors.deletedAt))),
    ]);
    const activeEmps = empRows.filter((e) => e.status === "active");
    const activeCons = conRows.filter((c) => c.status === "active");
    // Bench = active employees with no live allocation on a live, non-closed
    // engagement. Access rows key on the login (atelier_users) id.
    const liveEngIds = engs.filter((e) => e.plmStage !== "closed").map((e) => e.id);
    const accessRows = liveEngIds.length
      ? await db
          .select({ userId: atelierEngagementAccess.userId })
          .from(atelierEngagementAccess)
          .where(
            and(
              inArray(atelierEngagementAccess.engagementId, liveEngIds),
              eq(atelierEngagementAccess.status, "active"),
              isNull(atelierEngagementAccess.deletedAt),
            ),
          )
      : [];
    const staffedUserIds = new Set(accessRows.map((r) => r.userId));
    const staffed = activeEmps.filter((e) => e.userId && staffedUserIds.has(e.userId)).length;
    kpis.headcount = {
      total: activeEmps.length + activeCons.length,
      employees: activeEmps.length,
      contractors: activeCons.length,
      staffed,
      bench: activeEmps.length - staffed,
    };
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (["founding_partner", "partner", "finance"].includes(me.role)) {
    // Same definition as the working-capital report (cashRoutes.ts): open AR
    // is non-draft/non-void invoices with an unpaid remainder; overdue is the
    // subset whose due date has passed.
    const invoices = (
      await db
        .select()
        .from(atelierInvoice)
        .where(and(eq(atelierInvoice.orgId, me.orgId), isNull(atelierInvoice.deletedAt)))
    ).filter((i) => i.status !== "draft" && i.status !== "void" && i.total - i.amountPaid > 0.01);
    const today = new Date().toISOString().slice(0, 10);
    const overdue = invoices.filter((i) => i.dueDate && i.dueDate < today);
    kpis.ar = {
      openUsd: round2(invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0)),
      overdueUsd: round2(overdue.reduce((s, i) => s + (i.total - i.amountPaid), 0)),
      invoiceCount: invoices.length,
      overdueInvoiceCount: overdue.length,
    };
  }

  if (["founding_partner", "partner", "finance", "senior_manager"].includes(me.role)) {
    kpis.backlog = await computeBacklogKpisForOrg(me.orgId);
  }

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
      kpis,
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
      updatedAt: atelierAgentRuns.updatedAt,
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
    // Task #1046 — stale "running" rows (dead process) render as error.
    status: (effectiveAgentRunStatus(r) as "running" | "blocked" | "complete" | "error") ?? "running",
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
  showPartners = true,
) {
  const [acct] = await db
    .select()
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, o.accountId), eq(atelierAccounts.orgId, o.orgId)));
  const [partner] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, o.partnerOwnerId), eq(atelierUsers.orgId, o.orgId)));
  const [lead] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, o.engagementLeadId), eq(atelierUsers.orgId, o.orgId)));
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
    partnerOwnerId: o.partnerOwnerId,
    partnerFirms: showPartners ? await opportunityPartnerFirms(o.orgId, o.id) : [],
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
    closeDate: o.closeDate ?? null,
    forecastCategory: o.forecastCategory,
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

/** One visibility/filter loader for both the pipeline and the full (unpaginated) export. */
async function loadFilteredOpportunities(req: Request, res: Response, requirePartner = false) {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  const partnerRequested = req.query.partnerFirmId !== undefined || requirePartner;
  if (partnerRequested && !canAccessPartnersLens(me.role)) {
    res.status(403).json({ error: "partners-lens-forbidden", message: "Partner filtering and export are not available to your role." });
    return null;
  }
  for (const key of ["stage", "owner", "sector", "account", "partnerFirmId"]) {
    if (req.query[key] !== undefined && typeof req.query[key] !== "string") {
      res.status(400).json({ error: "invalid-filter", message: `Invalid ${key} filter.` });
      return null;
    }
  }
  const partnerFirmId = typeof req.query.partnerFirmId === "string" ? req.query.partnerFirmId.trim() : "";
  if (partnerRequested && !partnerFirmId) {
    res.status(400).json({ error: "partner-required", message: "Select a partner firm before downloading a report." });
    return null;
  }
  const [firm] = partnerFirmId ? await db.select({ id: atelierPartnerFirms.id, name: atelierPartnerFirms.name })
    .from(atelierPartnerFirms).where(and(eq(atelierPartnerFirms.id, partnerFirmId),
      eq(atelierPartnerFirms.orgId, me.orgId), isNull(atelierPartnerFirms.deletedAt))) : [];
  if (partnerFirmId && !firm) {
    res.status(404).json({ error: "partner-firm-not-found" });
    return null;
  }
  // Optional query filters: ?stage=&owner=&sector=&account= (CSV allowed).
  // Filtering happens after buildOpportunityWire because salesStage may be
  // derived at read time for legacy rows that pre-date the v2 column.
  const split = (v: unknown): string[] =>
    typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const stages = split(req.query.stage);
  const owners = split(req.query.owner);
  const sectors = split(req.query.sector);
  const accounts = split(req.query.account);

  let rows = await db
    .select()
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.orgId, me.orgId), isNull(atelierOpportunities.deletedAt)));
  // Task #1297 — non_equity_partner: the pipeline list is clamped to
  // opportunities they own, were invited into, or that sit on an account
  // they hold full access on. No firm-wide pipeline ever.
  const nepMe = req.atelierPersona;
  if (nepMe?.role === "non_equity_partner") {
    const nep = await nepAccessFor(nepMe.id);
    rows = rows.filter((o) => nepCanSeeOpportunity(nep, o, nepMe.id));
  }
  let wire = await Promise.all(rows.map((row) => buildOpportunityWire(row, canAccessPartnersLens(me.role))));
  if (partnerFirmId) wire = wire.filter((o) => o.partnerFirms.some((p) => p.id === partnerFirmId));
  if (stages.length) wire = wire.filter((o) => stages.includes(o.salesStage));
  if (owners.length) {
    // Prefer actual user IDs; retain name matching only for legacy tokens.
    const matchedUsers = await db.select({ id: atelierUsers.id }).from(atelierUsers)
      .where(and(eq(atelierUsers.orgId, me.orgId), inArray(atelierUsers.id, owners)));
    const ownerIds = new Set(matchedUsers.map((u) => u.id));
    wire = wire.filter((o) => owners.some((token) => ownerIds.has(token)
      ? token === o.partnerOwnerId : token === o.partnerOwnerName));
  }
  if (accounts.length)
    wire = wire.filter(
      (o) => accounts.includes(o.accountId) || accounts.includes(o.accountName),
    );
  if (sectors.length) {
    const acctRows = await db.select().from(atelierAccounts).where(eq(atelierAccounts.orgId, me.orgId));
    const sectorByAcct = new Map(acctRows.map((a) => [a.id, a.sector]));
    wire = wire.filter((o) => sectors.includes(sectorByAcct.get(o.accountId) ?? ""));
  }
  return { wire, firm, stages, owners, sectors, accounts };
}

router.get("/opportunities", rejectNonEmployeePersona, async (req, res) => {
  const result = await loadFilteredOpportunities(req, res);
  if (result) res.json(AtelierListOpportunitiesResponse.parse(result.wire));
});

// @cli-skip: manual external-sharing download, no delivery or portal grants.
router.get("/opportunities/partner-report.pdf", rejectNonEmployeePersona, async (req, res) => {
  const result = await loadFilteredOpportunities(req, res, true);
  if (!result || !result.firm) return;
  if (!result.wire.length) {
    res.status(404).json({ error: "no-matching-opportunities", message: "No opportunities match this partner and the selected filters." });
    return;
  }
  try {
    const { wire, firm, stages, owners, sectors, accounts } = result;
    const ownerLabel = owners.length ? [...new Set(wire.map((o) => o.partnerOwnerName))].join(", ") : "All owners";
    const filters = `Stage: ${stages.join(", ") || "All stages"} · Owner: ${ownerLabel}`
      + (sectors.length ? ` · Sector: ${sectors.join(", ")}` : "")
      + (accounts.length ? ` · Client: ${[...new Set(wire.map((o) => o.accountName))].join(", ")}` : "");
    const pdf = await partnerOpportunityPdf(firm.name, filters, wire.map((o) => ({
      name: o.name, accountName: o.accountName, salesStage: o.salesStage,
      partnerOwnerName: o.partnerOwnerName, dealSizeUsd: o.dealSizeUsd, currency: o.currency, closeDate: o.closeDate,
    })));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", contentDispositionFilename("attachment", `Cognirise-${firm.name}-opportunities.pdf`));
    res.send(pdf);
  } catch (err) {
    req.log.error({ err }, "Partner opportunity PDF failed");
    res.status(500).json({ error: "partner-report-failed", message: "The report could not be generated. Please try again." });
  }
});

router.get("/opportunities/:oppId", rejectNonEmployeePersona, async (req, res) => {
  const [row] = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.id, req.params.oppId as string),
        eq(atelierOpportunities.orgId, req.atelierPersona!.orgId),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  // Task #1297 — NEPs only see opportunities in their explicit access set.
  const oppMe = req.atelierPersona;
  if (oppMe?.role === "non_equity_partner") {
    const nep = await nepAccessFor(oppMe.id);
    if (!nepCanSeeOpportunity(nep, row, oppMe.id)) {
      res.status(404).json({ error: "opportunity-not-found" });
      return;
    }
  }
  res.json(AtelierGetOpportunityResponse.parse(await buildOpportunityWire(row, canAccessPartnersLens(oppMe?.role))));
});

// =============================================================
// Engagements
// =============================================================
async function buildEngagementWire(
  e: typeof atelierEngagements.$inferSelect,
) {
  const mobilization = e as typeof e & {
    mobilizationStatus?: string | null;
    charterSeed?: Record<string, unknown> | null;
    commercialSnapshotSummary?: Record<string, unknown> | null;
  };
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
    opportunityId: e.opportunityId ?? null,
    accountId: e.accountId,
    accountName: acct?.name ?? e.accountId,
    plmStage: e.plmStage,
    partnerOwnerName: partner?.name ?? e.partnerOwnerId,
    engagementLeadName: lead?.name ?? e.engagementLeadId,
    startDate: e.startDate,
    plannedEndDate: e.plannedEndDate,
    raidStatus: e.raidStatus as "green" | "amber" | "red",
    deliverablesDueThisWeek: e.deliverablesDueThisWeek,
    legalEntityId: e.legalEntityId ?? null,
    mobilizationStatus: mobilization.mobilizationStatus ?? "not_started",
    charterSeed: mobilization.charterSeed ?? null,
    commercialSnapshotSummary: mobilization.commercialSnapshotSummary ?? null,
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

router.get("/agents", async (req, res) => {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return;
  }
  const catalogueRows = await db
    .select()
    .from(atelierAgents)
    .where(
      and(
        isNull(atelierAgents.deletedAt),
        // Registry metadata is global runtime authority; tenant rows may
        // override presentation fields but may never make a stub executable.
        // Null org rows are the shared catalogue used by existing callers.
        or(isNull(atelierAgents.orgId), eq(atelierAgents.orgId, me.orgId)),
      ),
    );
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentRuns = await db
    .select({ agentId: atelierAgentRuns.agentId })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.orgId, me.orgId),
        gte(atelierAgentRuns.createdAt, since),
        isNull(atelierAgentRuns.deletedAt),
      ),
    );
  const runCounts = new Map<string, number>();
  for (const run of recentRuns) {
    const canonicalId = getAgent(run.agentId)?.id ?? run.agentId;
    runCounts.set(canonicalId, (runCounts.get(canonicalId) ?? 0) + 1);
  }

  // The runtime registry is the execution authority. Catalogue rows are
  // retained only for tenant diagnostics, while registry agents are included
  // even when provisioning has not yet created their catalogue row.
  const catalogueByRuntimeId = new Map<string, (typeof catalogueRows)[number]>();
  for (const row of catalogueRows) {
    const runtime = getAgent(row.id);
    if (runtime && runtime.status !== "stub") {
      const current = catalogueByRuntimeId.get(runtime.id);
      // Prefer the canonical row when both a canonical id and a legacy bare
      // alias survive in an older database.
      if (!current || row.id === runtime.id) {
        catalogueByRuntimeId.set(runtime.id, row);
      }
    }
  }
  const registryRows = ATELIER_AGENTS
    .filter((runtime) => runtime.status !== "stub")
    .map((runtime) => {
      const catalogue = catalogueByRuntimeId.get(runtime.id);
      return {
        id: runtime.id,
        name: catalogue?.name ?? runtime.name,
        group: catalogue?.group ?? runtime.group,
        stage: catalogue?.stage ?? runtime.stage,
        purpose: catalogue?.purpose ?? runtime.purpose,
        model: catalogue?.model ?? runtime.model,
        starred: catalogue?.starred ?? runtime.starred,
        status: runtime.status,
        runsLast30d: runCounts.get(runtime.id) ?? 0,
        inputs: catalogue?.inputs ?? [],
        outputs: catalogue?.outputs ?? [],
        tools: runtime.tools,
        guardrails: runtime.guardrails,
        humanCheckpoints: runtime.humanCheckpoints,
        promptRef: runtime.systemPromptRef,
        executable: (runtime.capabilityType ?? "generic") === "generic",
        capabilityType: runtime.capabilityType ?? "generic",
        operationalHref: runtime.operationalHref ?? `/agents/${runtime.id}`,
      };
    });
  const rows = [
    ...registryRows,
    ...catalogueRows.filter((row) => {
      const runtime = getAgent(row.id);
      return !runtime || runtime.status === "stub";
    }),
  ];
  res.json(
    AtelierListAgentsResponse.parse(
      rows.map((a) => {
        const runtime = getAgent(a.id);
        // A database catalogue row is not an executable agent by itself.
        // Keep unavailable rows visible as diagnostics, but never borrow
        // capabilities or controls from disconnected lifecycle data.
        if (!runtime || runtime.status === "stub") {
          return {
            id: a.id,
            name: a.name,
            group: a.group,
            stage: a.stage,
            purpose: a.purpose,
            model: a.model,
            starred: false,
            status: "stub" as const,
            runsLast30d: runCounts.get(a.id) ?? 0,
            inputs: [],
            outputs: [],
            tools: [],
            guardrails: [],
            humanCheckpoints: [],
            executable: false,
            capabilityType: "generic" as const,
            operationalHref: `/agents/${a.id}`,
          };
        }
        return {
          id: runtime.id,
          name: runtime.name,
          group: runtime.group,
          stage: runtime.stage,
          purpose: runtime.purpose,
          model: runtime.model,
          starred: runtime.starred,
          status: runtime.status,
          runsLast30d: runCounts.get(a.id) ?? 0,
          inputs: runtime.inputSchema ? a.inputs : [],
          outputs: runtime.outputSchema ? a.outputs : [],
          tools: runtime.tools,
          guardrails: runtime.guardrails,
          humanCheckpoints: runtime.humanCheckpoints,
          promptRef: runtime.systemPromptRef,
          executable: (runtime.capabilityType ?? "generic") === "generic",
          capabilityType: runtime.capabilityType ?? "generic",
          operationalHref: runtime.operationalHref ?? `/agents/${runtime.id}`,
        };
      }),
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
