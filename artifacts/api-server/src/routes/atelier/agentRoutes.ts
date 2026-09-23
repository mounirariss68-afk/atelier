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
import { createHash } from "node:crypto";
import { agentRunIsFresh, effectiveAgentRunStatus } from "../../lib/atelier-agents/run-staleness.js";
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
  atelierWorkCheckpoints,
  atelierMeetings,
  atelierTranscripts,
  atelierOpportunityStageTransitions,
  atelierPaneAItems,
  atelierDeliverables,
  atelierWinLossDebriefs,
  atelierPrompts,
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
import { ensureAssignmentGrant } from "../../lib/atelier-access-autogrant.js";
import { nepAccessFor } from "../../lib/atelier-nep-access.js";
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
  AtelierUpdatePovBody,
  AtelierRegeneratePovOutlineBody,
  AtelierRevisePovBody,
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
  noteAgentLaunch,
  clearAgentLaunch,
} from "../../lib/atelier-agents/launch-visibility.js";
import {
  runPursuitScout,
  runPovOutline,
  runPovDraft,
  runPovDeepResearch,
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
import {
  linkFactsToFiveC,
  computeBriefCompleteness,
  briefAge,
} from "../../lib/atelier-agents/brief-quality.js";
import { getAgent } from "@workspace/agents";
import { resolveEffectiveAgentPrompt } from "../../lib/atelier-agents/loader.js";
import { persistBriefAndFacts } from "../../lib/atelier-agents/scout-persist.js";
import {
  auditPovCitations,
  describeCitationFailure,
  factHygieneFlags,
  findNearDuplicateFacts,
} from "../../lib/atelier-agents/pov-quality.js";
import { buildPovBackgroundContext } from "../../lib/atelier-agents/pov-grounding.js";
import { executeDurablePovWork } from "../../lib/atelier-agents/pov-durable-executor.js";
import { recordOutcomeForRun } from "../../lib/atelier-agents/outcome-ledger.js";
import { canAccessAgentRunTarget } from "../../lib/atelier-agents/agent-run-access.js";
import { createServerOwnedCrmWorkflow, decideWorkCheckpoint } from "../../lib/assistant/workflow-runtime.js";
import { perplexitySearch } from "../../lib/atelier-agents/perplexity.js";
import { findAccountDuplicates, findOpportunityDuplicates } from "../../lib/atelier-dedupe.js";
import { canSeeAccount } from "./accountRoutes.js";
import { opportunityPartnerFirms, partnerFirmSelectionError, replaceOpportunityPartners } from "../../lib/atelier-opportunity-partners.js";
import { canAccessPartnersLens } from "./personaRoles.js";
import {
  startBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  getLatestJob,
  hasRunningJob,
} from "../../lib/background-jobs.js";
import { accessibleEngagementIds } from "./engagementRoutes.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import {
  createBriefDoc,
  buildScoutBriefPdf,
  buildPovPdf,
} from "../../lib/atelier-brief-pdf.js";
import {
  isPovVersionEmpty,
  buildPovPptx,
  renderPovHtml,
} from "../../lib/atelier-pov-export.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  // Task #867 — names made entirely of punctuation/non-Latin characters must
  // never produce an empty slug (empty slugs break URLs and id readability).
  return slug || `x${Math.random().toString(36).slice(2, 8)}`;
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

function canMakeAgentDecision(
  me: typeof atelierUsers.$inferSelect,
  run: typeof atelierAgentRuns.$inferSelect,
): boolean {
  const runtime = getAgent(run.agentId);
  if (!runtime) return false;
  const checkpoints = runtime.humanCheckpoints.filter((cp) => cp.blocking);
  if (checkpoints.length === 0) return false;
  return checkpoints.some((cp) => {
    if (cp.decider === "partner") return me.role === "partner" || me.role === "founding_partner";
    if (cp.decider === "engagement_lead") {
      return me.role === "partner" || me.role === "founding_partner" || me.role === "senior_manager";
    }
    if ((cp.decider as string) === "finance") return me.role === "finance" || me.role === "partner" || me.role === "founding_partner";
    return false;
  });
}

// Task #8 — canonical stalled-aging basis: opportunities sitting in the
// runner stage age from runnerEnteredAt (sticky timestamp set on entry);
// daysInStage is used as the fallback and for every other stage.
function effectiveDaysInStage(
  o: { daysInStage: number; runnerEnteredAt: Date | null },
  salesStage: string,
): number {
  if (salesStage === "runner" && o.runnerEnteredAt) {
    return Math.floor((Date.now() - o.runnerEnteredAt.getTime()) / 86_400_000);
  }
  return o.daysInStage;
}

async function buildOppWire(o: typeof atelierOpportunities.$inferSelect, showPartners = true) {
  const [acct] = await db.select().from(atelierAccounts).where(and(eq(atelierAccounts.id, o.accountId), eq(atelierAccounts.orgId, o.orgId)));
  const [partner] = await db.select().from(atelierUsers).where(and(eq(atelierUsers.id, o.partnerOwnerId), eq(atelierUsers.orgId, o.orgId)));
  const [lead] = await db.select().from(atelierUsers).where(and(eq(atelierUsers.id, o.engagementLeadId), eq(atelierUsers.orgId, o.orgId)));
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
    // Task #653 — forecast fields.
    closeDate: o.closeDate ?? null,
    forecastCategory: o.forecastCategory,
    sourceLead: o.sourceLead,
    // Task #8 — stalled aging: in the runner stage, age from the sticky
    // runnerEnteredAt timestamp (daysInStage is reset by sub-status churn
    // and undercounts); everywhere else keep daysInStage.
    stalled:
      effectiveDaysInStage(o, salesStage) > STALLED_THRESHOLD_DAYS &&
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

function promptHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function promptAgent(agentId: string) {
  const agent = getAgent(agentId);
  if (!agent || agent.status === "stub") return null;
  return agent;
}

// @cli-skip: partner-facing prompt administration read; not an assistant execution capability
router.get("/agents/:agentId/prompt", async (req, res): Promise<void> => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const agent = promptAgent(String(req.params.agentId));
  if (!agent) {
    res.status(404).json({ error: "agent-prompt-not-found", message: "Agent is not executable or is not registered." });
    return;
  }
  const agentId = agent.id;
  try {
    const effective = await resolveEffectiveAgentPrompt({ orgId: me.orgId, agentId });
    res.json({ agentId, ...effective, updatedAt: effective.updatedAt.toISOString() });
  } catch {
    res.status(404).json({ error: "agent-prompt-not-found", message: "Agent prompt file is missing." });
  }
});

// @cli-skip: partner-facing prompt administration write; assistant self-modification is intentionally forbidden
router.put("/agents/:agentId/prompt", async (req, res): Promise<void> => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner" && me.role !== "founding_partner") {
    res.status(403).json({ error: "agent-prompt-edit-forbidden", message: "Only partners and founding partners may edit prompts." });
    return;
  }
  const agent = promptAgent(String(req.params.agentId));
  if (!agent) {
    res.status(404).json({ error: "agent-prompt-not-found", message: "Agent is not executable or is not registered." });
    return;
  }
  const agentId = agent.id;
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  if (!body.trim() || body.length > 100_000) {
    res.status(400).json({ error: "invalid-agent-prompt", message: "Prompt body must be nonempty and no more than 100000 characters." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`atelier-prompt:${me.orgId}:${agentId}`}))`);
      const [prior] = await tx.select({ version: atelierPrompts.version })
        .from(atelierPrompts)
        .where(and(eq(atelierPrompts.orgId, me.orgId), eq(atelierPrompts.agentId, agentId)))
        .orderBy(desc(atelierPrompts.version)).limit(1);
      const version = (prior?.version ?? 0) + 1;
      await tx.update(atelierPrompts).set({ status: "deprecated", updatedAt: new Date() })
        .where(and(eq(atelierPrompts.orgId, me.orgId), eq(atelierPrompts.agentId, agentId), eq(atelierPrompts.status, "active")));
      const [row] = await tx.insert(atelierPrompts).values({
        id: `prompt_${me.orgId}_${agentId}_${version}_${Date.now().toString(36)}`,
        orgId: me.orgId, agentId, version, body, status: "active",
        author: me.name, createdByUserId: me.id,
      }).returning();
      await tx.insert(atelierAuditEvents).values({
        id: rid("aud"), orgId: me.orgId, entityType: "agent_prompt", entityId: agentId,
        actorType: "human", actorId: me.id, actorLabel: me.name, action: "agent_prompt.update",
        payload: { version, priorVersion: prior?.version ?? null, bodySha256: promptHash(body) },
        payloadSummary: `${me.name} updated ${agentId} prompt to version ${version}.`,
      });
      return row;
    });
    res.json({ agentId, body: result.body, source: "override", baseRef: "v1", version: result.version, updatedAt: result.updatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "agent prompt update failed");
    res.status(500).json({ error: "agent-prompt-update-failed" });
  }
});

// -------------------------------------------------------------------
// Live duplicate-opportunity hint (Task #37)
// -------------------------------------------------------------------
// Fuzzy duplicate check used by the create dialog to warn WHILE TYPING,
// before the user submits. Purely advisory — the exact-match 409 on create
// below stays the hard gate. Scoped to open (non-archived) opportunities on
// a single account; never mutates anything.
// @cli-skip: advisory UI hint backing the create dialog; no CLI surface
router.get("/opportunities/check-duplicates", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : "";
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  const excludeId =
    typeof req.query.excludeId === "string" && req.query.excludeId.trim()
      ? req.query.excludeId.trim()
      : undefined;
  if (!accountId || !name) {
    res.status(400).json({ error: "invalid-query", reason: "accountId and name are required." });
    return;
  }
  const [acct] = await db
    .select({ id: atelierAccounts.id })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, accountId), isNull(atelierAccounts.deletedAt)));
  if (!acct) {
    res.status(404).json({ error: "account-not-found" });
    return;
  }
  const rows = await db
    .select({
      id: atelierOpportunities.id,
      name: atelierOpportunities.name,
      salesStage: atelierOpportunities.salesStage,
    })
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.accountId, accountId),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  const candidates = findOpportunityDuplicates(name, rows, { excludeId });
  res.json({ candidates });
});

// -------------------------------------------------------------------
// Create opportunity (auto-runs Pursuit Scout)
// -------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierCreateOpportunityBody.safeParse(req.body);
  if (!parsed.success) {
    // Task #867 — map schema failures to field-level messages so the dialog
    // can point at the offending field instead of a generic error.
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length ? String(issue.path[0]) : "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    res.status(400).json({
      error: "invalid-body",
      fields,
      message:
        Object.keys(fields).length > 0
          ? `Invalid input for: ${Object.keys(fields).join(", ")}.`
          : "Invalid request body.",
    });
    return;
  }
  const input = parsed.data;

  if (await partnerFirmSelectionError(me, input.partnerFirmIds, res)) return;

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
      .where(and(eq(atelierAccounts.id, input.accountId), eq(atelierAccounts.orgId, me.orgId), isNull(atelierAccounts.deletedAt)));
    if (!acct) {
      res.status(404).json({ error: "account-not-found" });
      return;
    }
    // Task #1297 — a non_equity_partner may only attach opportunities to
    // accounts they hold FULL access on (owned or explicitly granted) —
    // not invited-parent read-limited accounts, and never anyone else's.
    if (me.role === "non_equity_partner") {
      const nep = await nepAccessFor(me.id);
      if (!nep.fullIds.has(acct.id)) {
        res.status(403).json({
          error: "nep-account-forbidden",
          message:
            "Non-equity partners can only create opportunities on their own or granted accounts.",
        });
        return;
      }
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
      .where(and(ilike(atelierAccounts.name, newName), eq(atelierAccounts.orgId, me.orgId), isNull(atelierAccounts.deletedAt)));
    if (!acct) {
      // Task #38 — duplicate-account guard, mirroring the duplicate-opportunity
      // one below. A non-archived account in this org whose NORMALIZED name
      // matches ("Aldrees Ltd" vs "Aldrees Limited", diacritics, punctuation)
      // blocks the silent account creation with a structured 409 unless the
      // caller explicitly overrides with allowDuplicateAccount — otherwise the
      // partner should pass accountId to attach the deal to the existing one.
      const orgAccounts = await db
        .select({
          id: atelierAccounts.id,
          name: atelierAccounts.name,
          brandName: atelierAccounts.brandName,
          country: atelierAccounts.country,
          tier: atelierAccounts.tier,
        })
        .from(atelierAccounts)
        .where(
          and(
            eq(atelierAccounts.orgId, me.orgId ?? "aico"),
            isNull(atelierAccounts.deletedAt),
          ),
        );
      const acctDups = findAccountDuplicates(
        { name: newName, country: newCountry },
        orgAccounts,
      );
      const exactAcctDup = acctDups.find((m) => m.exact);
      if (exactAcctDup && input.allowDuplicateAccount !== true) {
        res.status(409).json({
          error: "duplicate-account",
          existing: exactAcctDup,
          similar: acctDups,
          message: `An account named "${exactAcctDup.name}" already exists. Pass accountId to attach this opportunity to it, or allowDuplicateAccount to create a new account anyway.`,
        });
        return;
      }
      const acctId = `acct_${slugify(newName)}_${Math.random().toString(36).slice(2, 6)}`;
      [acct] = await db
        .insert(atelierAccounts)
        .values({
          id: acctId,
          orgId: me.orgId,
          name: newName,
          country: newCountry,
          sector: newSector,
          tier: input.accountTier ?? undefined,
          createdByUserId: me.id,
          // Task #1297 — origination attribution; NEP creators always own
          // the account they originate (visibility flows from ownership).
          originatedByUserId: me.id,
          originatedAt: new Date(),
          partnerOwnerId:
            me.role === "non_equity_partner" ? me.id : undefined,
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
      .where(and(eq(atelierUsers.id, userId), eq(atelierUsers.orgId, me!.orgId), isNull(atelierUsers.deletedAt)));
    return u ? u.id : null;
  }
  // Task #1297 — non_equity_partner creators ALWAYS own their own
  // opportunities (supplied owner/lead ids are ignored).
  const partnerOwnerId =
    me.role === "non_equity_partner"
      ? me.id
      : input.partnerOwnerId
        ? await resolveOwner(input.partnerOwnerId)
        : me.id;
  if (!partnerOwnerId) {
    res.status(400).json({ error: "invalid-partner-owner" });
    return;
  }
  const engagementLeadId =
    me.role === "non_equity_partner"
      ? me.id
      : input.engagementLeadId
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

  // Task #30 — duplicate detection. An open (non-archived) opportunity on the
  // same account whose normalized name matches blocks the create with a
  // structured 409 unless the caller explicitly overrides with allowDuplicate.
  // Fuzzy near-matches ride along as warnings but never block on their own.
  const existingOpps = await db
    .select({
      id: atelierOpportunities.id,
      name: atelierOpportunities.name,
      salesStage: atelierOpportunities.salesStage,
    })
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.accountId, acct.id),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  const dupMatches = findOpportunityDuplicates(input.name, existingOpps);
  const exactDup = dupMatches.find((m) => m.exact);
  if (exactDup && input.allowDuplicate !== true) {
    res.status(409).json({
      error: "duplicate-opportunity",
      existing: exactDup,
      similar: dupMatches,
      message: `An open opportunity named "${exactDup.name}" already exists on ${acct.name}. Pass allowDuplicate to create anyway.`,
    });
    return;
  }

  const oppId = `opp_${slugify(input.name)}_${Math.random().toString(36).slice(2, 6)}`;
  const opp = await db.transaction(async (tx) => {
    const [opp] = await tx
      .insert(atelierOpportunities)
      .values({
        id: oppId,
        orgId: me.orgId,
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

    await replaceOpportunityPartners(tx, me, opp.id, input.partnerFirmIds);
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: me.orgId,
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
    return opp;
  }).catch((err) => {
    req.log.error({ err }, "Opportunity and partner tags rolled back");
    res.status(500).json({ error: "opportunity-save-failed", message: "The opportunity was not created. Please retry." });
    return null;
  });
  if (!opp) return;

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
    opportunity: await buildOppWire(opp, canAccessPartnersLens(me.role)),
    scoutRunId,
    scout,
  });
});

// -------------------------------------------------------------------
// Edit opportunity core details (Task #540)
// -------------------------------------------------------------------
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
  if (await partnerFirmSelectionError(me, input.partnerFirmIds, res)) return;

  // Resolve any supplied owner references to existing, active users so we never
  // persist a dangling FK. Unsupplied owners are left untouched.
  async function resolveOwner(userId: string): Promise<string | null> {
    const [u] = await db
      .select()
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, userId), eq(atelierUsers.orgId, me!.orgId), isNull(atelierUsers.deletedAt)));
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

  if (input.partnerFirmIds !== undefined) changed.push("partnerFirmIds");
  if (changed.length === 0) {
    res.json(await buildOppWire(opp, canAccessPartnersLens(me.role)));
    return;
  }

  patch.updatedAt = new Date();
  const updated = await db.transaction(async (tx) => {
    // Serialize tag replacement with other opportunity edits and canonical co-sell creation.
    await tx.select({ id: atelierOpportunities.id }).from(atelierOpportunities)
      .where(and(eq(atelierOpportunities.id, opp.id), eq(atelierOpportunities.orgId, me.orgId))).for("update");
    const [updated] = await tx
      .update(atelierOpportunities)
      .set(patch)
      .where(eq(atelierOpportunities.id, opp.id))
      .returning();

    await replaceOpportunityPartners(tx, me, opp.id, input.partnerFirmIds);
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: me.orgId,
      entityType: "opportunity",
      entityId: opp.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "opportunity.update",
      payload: { changed, ...patch, updatedAt: undefined },
      payloadSummary: `${me.name} edited ${changed.join(", ")} on "${updated.name}".`,
    });
    return updated;
  }).catch((err) => {
    req.log.error({ err }, "Opportunity and partner tag edit rolled back");
    res.status(500).json({ error: "opportunity-save-failed", message: "No changes were saved. Please retry." });
    return null;
  });
  if (!updated) return;

  // Task #509 — assignment auto-grants: when the opportunity already has a
  // delivery engagement, assigning a new owner/lead must also grant them
  // access to that engagement (firm-wide roles are skipped inside the helper).
  if (changed.includes("partnerOwnerId") || changed.includes("engagementLeadId")) {
    const [linkedEng] = await db
      .select({ id: atelierEngagements.id })
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.opportunityId, opp.id),
          isNull(atelierEngagements.deletedAt),
        ),
      );
    if (linkedEng) {
      if (changed.includes("engagementLeadId") && updated.engagementLeadId) {
        await ensureAssignmentGrant({
          userId: updated.engagementLeadId,
          engagementId: linkedEng.id,
          roleOnEngagement: "lead",
          actor: me,
          reason: "opportunity-lead-assignment",
        });
      }
      if (changed.includes("partnerOwnerId") && updated.partnerOwnerId) {
        await ensureAssignmentGrant({
          userId: updated.partnerOwnerId,
          engagementId: linkedEng.id,
          roleOnEngagement: "member",
          actor: me,
          reason: "opportunity-owner-assignment",
        });
      }
    }
  }

  res.json(await buildOppWire(updated, canAccessPartnersLens(me.role)));
});

// -------------------------------------------------------------------
// Archive (soft-delete) opportunity (Task #540)
// -------------------------------------------------------------------
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

  const now = new Date();
  await db
    .update(atelierOpportunities)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(atelierOpportunities.id, opp.id));

  // Cascade to dependents so archived opps leave no dangling surfaces:
  // soft-delete Win/Loss debriefs and resolve opportunity-linked Pane A items.
  await db
    .update(atelierWinLossDebriefs)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(atelierWinLossDebriefs.opportunityId, opp.id),
        isNull(atelierWinLossDebriefs.deletedAt),
      ),
    );
  await db
    .update(atelierPaneAItems)
    .set({ resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(atelierPaneAItems.hrefKind, "opportunity"),
        eq(atelierPaneAItems.hrefTargetId, opp.id),
        isNull(atelierPaneAItems.resolvedAt),
      ),
    );

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

// -------------------------------------------------------------------
// Score + persist structured qualification rubric (Task #540)
// -------------------------------------------------------------------
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

// Task #8 — persistBriefAndFacts moved to lib/atelier-agents/scout-persist.ts
// so the chat opportunity_create capability shares the exact same logic.

// -------------------------------------------------------------------
// PATCH stage  (5C gate enforced for `pursue`)
// -------------------------------------------------------------------
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
    { id: me.id, name: me.name, orgId: me.orgId, role: me.role },
  );
  if (!result.ok) {
    const code = result.gate?.gate === "suspect_to_prospect_5c" ? "qualifier-required" : result.error;
    res.status(result.status).json({ error: code, ...(result.gate ?? {}) });
    return;
  }
  res.json(await buildOppWire(result.opportunity, canAccessPartnersLens(me.role)));
});

// -------------------------------------------------------------------
// 5C Qualifier  (GET + POST)
// -------------------------------------------------------------------
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

// -------------------------------------------------------------------
// Pursuit Scout — get brief / re-run
// -------------------------------------------------------------------
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
  const facts = (row.citations as AgentFact[]) ?? [];
  // Task #9 — quality signals derived server-side so every consumer (UI, CLI)
  // sees the same evidence links, completeness summary, and staleness flags.
  const age = briefAge(row.createdAt);
  res.json({
    brief: {
      accountSnapshot: row.accountSnapshot,
      buyerLandscape: row.buyerLandscape,
      fiveCDraft: row.fiveCDraft,
      openQuestions: row.openQuestions,
      // Task #872 — alliance-partner fit flags (historical snapshot).
      partnerFit: row.partnerFit ?? [],
      facts,
      confidence: row.confidence,
    },
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
    confidence: row.confidence ?? "amber",
    fiveCFactIds: linkFactsToFiveC(row.fiveCDraft as Record<string, string> | null, facts),
    completeness: computeBriefCompleteness(
      {
        accountSnapshot: row.accountSnapshot as PursuitScoutOutput["accountSnapshot"],
        buyerLandscape: row.buyerLandscape as PursuitScoutOutput["buyerLandscape"],
        fiveCDraft: row.fiveCDraft as PursuitScoutOutput["fiveCDraft"],
        openQuestions: (row.openQuestions as string[]) ?? [],
      },
      facts,
    ),
    ageDays: age.ageDays,
    refreshRecommended: age.refreshRecommended,
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
    const briefFacts = (briefRow?.citations as AgentFact[]) ?? [];
    const briefAgeInfo = briefAge(briefRow?.createdAt ?? null);
    res.json({
      brief: briefRow
        ? {
            accountSnapshot: briefRow.accountSnapshot,
            buyerLandscape: briefRow.buyerLandscape,
            fiveCDraft: briefRow.fiveCDraft,
            openQuestions: briefRow.openQuestions,
            // Task #872 — alliance-partner fit flags (historical snapshot).
            partnerFit: briefRow.partnerFit ?? [],
            facts: briefFacts,
            confidence: briefRow.confidence,
          }
        : undefined,
      runId,
      createdAt: briefRow?.createdAt.toISOString() ?? null,
      confidence: briefRow?.confidence ?? "amber",
      ...(briefRow
        ? {
            fiveCFactIds: linkFactsToFiveC(
              briefRow.fiveCDraft as Record<string, string> | null,
              briefFacts,
            ),
            completeness: computeBriefCompleteness(
              {
                accountSnapshot: briefRow.accountSnapshot as PursuitScoutOutput["accountSnapshot"],
                buyerLandscape: briefRow.buyerLandscape as PursuitScoutOutput["buyerLandscape"],
                fiveCDraft: briefRow.fiveCDraft as PursuitScoutOutput["fiveCDraft"],
                openQuestions: (briefRow.openQuestions as string[]) ?? [],
              },
              briefFacts,
            ),
            ageDays: briefAgeInfo.ageDays,
            refreshRecommended: briefAgeInfo.refreshRecommended,
          }
        : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "scout-failed" });
  }
});

// -------------------------------------------------------------------
// Research facts
// -------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.get("/opportunities/:oppId/research", async (req, res) => {
  const rows = await db
    .select()
    .from(atelierResearchFacts)
    .where(and(eq(atelierResearchFacts.opportunityId, req.params.oppId), isNull(atelierResearchFacts.deletedAt)))
    .orderBy(desc(atelierResearchFacts.createdAt));
  // Task #1022 — hygiene projection: near-duplicate detection across runs
  // (oldest-first so the earliest/promoted copy is canonical) plus stale /
  // low-confidence flags, computed at read time so partners review evidence
  // quality without mutating the rows.
  const dupMap = findNearDuplicateFacts(
    [...rows]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((f) => ({ id: f.id, statement: f.statement, promoted: f.promoted })),
  );
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
      retrievedAt: (f.retrievedAt ?? f.createdAt).toISOString(),
      flags: factHygieneFlags(f),
      duplicateOfId: dupMap.get(f.id) ?? null,
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
        eq(atelierResearchFacts.orgId, me.orgId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "fact-not-found" });
    return;
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: me.orgId,
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: parsed.data.promote ? "fact.promote" : "fact.demote",
    payload: { factId: updated.id, topic: updated.topic },
    payloadSummary: `${me.name} ${parsed.data.promote ? "promoted" : "demoted"} fact "${updated.topic}".`,
  });
  if (updated.runId) {
    await recordOutcomeForRun({
      orgId: me.orgId, eventKey: `research-fact:${updated.id}:${parsed.data.promote ? "accepted" : "rejected"}:${updated.updatedAt.toISOString()}`,
      occurredAt: updated.promotedAt ?? new Date(), runId: updated.runId,
      actorUserId: me.id,
      originEntityType: "opportunity", originEntityId: updated.opportunityId,
      entityType: "research_fact", entityId: updated.id, entryPath: "POST /opportunities/:oppId/research/:factId/promote",
      outcomeKind: "source", outcomeStatus: parsed.data.promote ? "accepted" : "rejected",
      priorState: parsed.data.promote ? "unpromoted" : "promoted", currentState: parsed.data.promote ? "promoted" : "unpromoted",
      sourceAcceptedCount: parsed.data.promote ? 1 : 0, sourceRejectedCount: parsed.data.promote ? 0 : 1,
      missingLinks: [],
    });
  }
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

// Task #1027 — merge a flagged near-duplicate into its canonical fact.
// The duplicate relationship is recomputed SERVER-SIDE over the live pool
// (never trusting the client's duplicateOfId), the duplicate row is
// soft-archived (deletedAt), and promotion carries over to the canonical
// so a promoted duplicate never silently drops out of the evidence set.
// POV factSnapshot blobs are frozen jsonb copies and are never touched.
// @cli-skip: review-surface hygiene action; no CLI surface
router.post("/opportunities/:oppId/research/:factId/merge", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Object-level authorization: the caller must be able to see the account
  // owning this opportunity. 404 (not 403) to avoid an IDOR oracle — same
  // pattern as the opportunity PDF/brief routes below.
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, opp.accountId))) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierResearchFacts)
    .where(
      and(
        eq(atelierResearchFacts.opportunityId, req.params.oppId),
        isNull(atelierResearchFacts.deletedAt),
      ),
    );
  const dup = rows.find((f) => f.id === req.params.factId);
  if (!dup) {
    res.status(404).json({ error: "fact-not-found" });
    return;
  }
  // Same projection the list route renders: oldest-first, promoted wins.
  const dupMap = findNearDuplicateFacts(
    [...rows]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((f) => ({ id: f.id, statement: f.statement, promoted: f.promoted })),
  );
  const canonicalId = dupMap.get(dup.id);
  if (!canonicalId) {
    res.status(409).json({
      error: "not-a-duplicate",
      reason: "This fact is not currently flagged as a near-duplicate; nothing to merge.",
    });
    return;
  }
  const canonical = rows.find((f) => f.id === canonicalId);
  if (!canonical) {
    res.status(409).json({ error: "canonical-not-found" });
    return;
  }
  const now = new Date();
  // Soft-archive the duplicate; carry promotion onto the canonical if only
  // the duplicate was promoted.
  await db
    .update(atelierResearchFacts)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(atelierResearchFacts.id, dup.id));
  if (dup.promoted && !canonical.promoted) {
    await db
      .update(atelierResearchFacts)
      .set({
        promoted: true,
        promotedAt: now,
        promotedByUserId: me.id,
        includedInPov: true,
        updatedAt: now,
      })
      .where(eq(atelierResearchFacts.id, canonical.id));
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "fact.merge",
    payload: {
      mergedFactId: dup.id,
      canonicalFactId: canonical.id,
      topic: dup.topic,
      carriedPromotion: dup.promoted && !canonical.promoted,
    },
    payloadSummary: `${me.name} merged duplicate fact "${dup.topic}" into its canonical copy.`,
  });
  res.json({
    merged: true,
    archivedFactId: dup.id,
    canonicalFactId: canonical.id,
    carriedPromotion: dup.promoted && !canonical.promoted,
  });
});

// Task #1027 — re-verify a stale fact: re-run the source query through the
// shared Perplexity client. Supporting citations → refresh retrievedAt (+
// snippet/source metadata) and clear any prior dead mark; no citations →
// stamp sourceDeadAt so review surfaces show the source is dead. Retrieval
// transport failures are 502s, never silently treated as "dead".
// @cli-skip: review-surface hygiene action; no CLI surface
router.post("/opportunities/:oppId/research/:factId/reverify", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Object-level authorization BEFORE any fact read or external retrieval —
  // 404 (not 403) to avoid an IDOR oracle; guessed ids must never trigger
  // Perplexity spend on someone else's opportunity.
  const opp = await loadOpp(req.params.oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, opp.accountId))) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const [fact] = await db
    .select()
    .from(atelierResearchFacts)
    .where(
      and(
        eq(atelierResearchFacts.id, req.params.factId),
        eq(atelierResearchFacts.opportunityId, req.params.oppId),
        isNull(atelierResearchFacts.deletedAt),
      ),
    );
  if (!fact) {
    res.status(404).json({ error: "fact-not-found" });
    return;
  }
  let result: Awaited<ReturnType<typeof perplexitySearch>>;
  try {
    result = await perplexitySearch(
      `Verify whether this is still accurate and supported by current sources: "${fact.statement}" (topic: ${fact.topic}).`,
    );
  } catch (err) {
    res.status(502).json({
      error: "reverify-unavailable",
      reason: err instanceof Error ? err.message : "Research retrieval failed.",
    });
    return;
  }
  const now = new Date();
  const verified = result.citations.length > 0;
  let updated: typeof atelierResearchFacts.$inferSelect;
  if (verified) {
    const best =
      result.citations.find((c) => c.url === fact.sourceUrl) ?? result.citations[0];
    [updated] = await db
      .update(atelierResearchFacts)
      .set({
        retrievedAt: now,
        sourceDeadAt: null,
        snippet: best.snippet ?? fact.snippet,
        // Only fill source metadata when the fact had none — never overwrite
        // a partner-reviewed source with a different retrieval hit.
        sourceUrl: fact.sourceUrl ?? best.url,
        sourceTitle: fact.sourceTitle ?? best.title ?? null,
        updatedAt: now,
      })
      .where(eq(atelierResearchFacts.id, fact.id))
      .returning();
  } else {
    [updated] = await db
      .update(atelierResearchFacts)
      .set({ sourceDeadAt: now, updatedAt: now })
      .where(eq(atelierResearchFacts.id, fact.id))
      .returning();
  }
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "opportunity",
    entityId: req.params.oppId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: verified ? "fact.reverified" : "fact.source_dead",
    payload: {
      factId: fact.id,
      topic: fact.topic,
      verified,
      citationCount: result.citations.length,
    },
    payloadSummary: verified
      ? `${me.name} re-verified fact "${fact.topic}" — evidence refreshed.`
      : `${me.name} re-verified fact "${fact.topic}" — no supporting sources found; marked dead.`,
  });
  res.json({
    verified,
    fact: {
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
      retrievedAt: (updated.retrievedAt ?? updated.createdAt).toISOString(),
      flags: factHygieneFlags(updated),
      runId: updated.runId,
    },
  });
});

// -------------------------------------------------------------------
// POVs
// -------------------------------------------------------------------
function povWire(p: typeof atelierPovs.$inferSelect) {
  return {
    id: p.id,
    oppId: p.opportunityId,
    title: p.title,
    audience: p.audience,
    objective: p.objective,
    // Task #1053 — depth choice recorded at create time (memo | full).
    depth: (p.depth ?? "full") as "memo" | "full",
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
  // Task #1053 — per-POV depth knob, chosen on the create form and frozen on
  // the row: "memo" (tight 4–6 sections) vs "full" (8–12, default).
  const depth = parsed.data.depth === "memo" ? "memo" : "full";
  // Task #1198 — show "working on it" in the bell during the pre-row window
  // while the outliner LLM warms up (synchronous call, no background job).
  noteAgentLaunch({ agentId: "ag_pov_author", targetId: opp.id, targetLabel: opp.name, userId: me.id });
  try {
    const { runId, outline } = await runPovOutline({
      opportunityId: opp.id,
      opportunityName: opp.name,
      audience: parsed.data.audience,
      objective: parsed.data.objective,
      promotedFacts: promoted,
      triggeredByUserId: me.id,
      actorLabel: "POV Author · Outliner",
      depth,
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
        depth,
        status: "outline",
        outline: outline.sections as never,
        // Task #1022 — the evidence snapshot is frozen at outline APPROVAL time
        // (decision route), not here: facts demoted/promoted during outline
        // review must be reflected in the set the draft runs on.
        runId,
        createdByUserId: me.id,
      })
      .returning();
    res.status(201).json(povWire(pov));
  } finally {
    clearAgentLaunch("ag_pov_author", opp.id);
  }
});

// ── POV deep research (Task #1022) ──────────────────────────────────────────
// Dedicated research pass before outlining: targeted Perplexity queries per
// thesis angle with recency + optional domain filters, synthesised into
// candidate facts that land UNPROMOTED for partner review. Async 202+poll
// (research runs for minutes; the proxy would 502 a held request).
const POV_RESEARCH_JOB_KIND = "pov_research";

// @cli-skip: transient launch status for the Research tab poller; not a data read
router.get("/opportunities/:oppId/pov-research-status", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const job = await getLatestJob([POV_RESEARCH_JOB_KIND], req.params.oppId, me.orgId);
  if (!job) {
    res.json({ status: "idle" });
    return;
  }
  if (job.status === "running") res.json({ status: "running" });
  else if (job.status === "failed") res.json({ status: "failed", error: job.error ?? "failed" });
  else {
    const r = (job.result ?? {}) as { factCount?: number };
    res.json({ status: "done", factCount: r.factCount ?? 0 });
  }
});

// @cli-skip: agent launch surface; chat uses the dedicated research capability path
router.post("/opportunities/:oppId/pov-research", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  // Org-scoped: research burns paid retrieval quota and writes facts onto the
  // opportunity — never allow a caller to target another org's record.
  if (!opp || opp.orgId !== me.orgId) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  const body = (req.body ?? {}) as {
    audience?: unknown;
    objective?: unknown;
    angles?: unknown;
    domains?: unknown;
  };
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 120) : "";
  const objective = typeof body.objective === "string" ? body.objective.trim().slice(0, 500) : "";
  if (!objective) {
    res.status(400).json({ error: "invalid-body", reason: "objective is required" });
    return;
  }
  const strArr = (v: unknown, capLen: number, capItems: number): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string" && !!x.trim())
          .map((x) => x.trim().slice(0, capLen))
          .slice(0, capItems)
      : [];
  const angles = strArr(body.angles, 200, 8);
  const domains = strArr(body.domains, 100, 10);
  if (await hasRunningJob([POV_RESEARCH_JOB_KIND], opp.id, me.orgId)) {
    res.status(409).json({ error: "pov-research-in-progress" });
    return;
  }
  const [acct] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, opp.accountId));
  const jobId = await startBackgroundJob({
    orgId: me.orgId,
    userId: me.id,
    kind: POV_RESEARCH_JOB_KIND,
    lockKey: "pov_research",
    targetType: "opportunity",
    targetId: opp.id,
    label: `POV deep research — "${opp.name}"`,
    resultHref: `/opportunities/${opp.id}?tab=research`,
  });
  if (!jobId) {
    res.status(409).json({ error: "pov-research-in-progress" });
    return;
  }
  const meId = me.id;
  const oppName = opp.name;
  void (async () => {
    try {
      const { runId, facts } = await runPovDeepResearch({
        opportunityId: opp.id,
        opportunityName: oppName,
        accountName: acct?.name ?? oppName,
        accountSector: acct?.sector ?? null,
        audience: audience || "executive",
        objective,
        angles,
        domains,
        triggeredByUserId: meId,
        actorLabel: "POV Author · Deep Research",
      });
      // Dedupe against the opportunity's existing fact pool before insert so
      // repeated research runs don't multiply near-identical statements.
      const existing = await db
        .select({ id: atelierResearchFacts.id, statement: atelierResearchFacts.statement })
        .from(atelierResearchFacts)
        .where(
          and(
            eq(atelierResearchFacts.opportunityId, opp.id),
            isNull(atelierResearchFacts.deletedAt),
          ),
        );
      const pool = existing.map((e) => ({ id: e.id, statement: e.statement, promoted: true }));
      const fresh: typeof facts = [];
      for (const f of facts) {
        const probeId = `probe_${fresh.length}`;
        const dup = findNearDuplicateFacts([
          ...pool,
          ...fresh.map((x, i) => ({ id: `new_${i}`, statement: x.statement })),
          { id: probeId, statement: f.statement },
        ]).get(probeId);
        if (!dup) fresh.push(f);
      }
      if (fresh.length > 0) {
        await db.insert(atelierResearchFacts).values(
          fresh.map((f) => ({
            id: f.id ?? rid("fact"),
            orgId: me.orgId,
            opportunityId: opp.id,
            runId,
            topic: f.topic,
            statement: f.statement,
            sourceUrl: f.sourceUrl ?? null,
            sourceTitle: f.sourceTitle ?? null,
            snippet: f.snippet ?? null,
            confidence: f.confidence,
            retrievedAt: new Date(),
            createdByUserId: meId,
          })),
        );
      }
      await completeBackgroundJob(jobId!, {
        result: { factCount: fresh.length, skippedDuplicates: facts.length - fresh.length, runId },
        notifyTitle: `POV research ready — "${oppName}"`,
        notifyBody: `${fresh.length} candidate fact${fresh.length === 1 ? "" : "s"} to review.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failBackgroundJob(jobId!, msg, { notifyTitle: `POV research failed — "${oppName}"` });
    }
  })();
  res.status(202).json({ started: true });
});

// ── POV draft/revise async launches ─────────────────────────────────────────
// Full multi-section drafts run for minutes; holding the HTTP request open
// gets 502'd by the proxy after ~1–2 min. Same start-then-poll contract as
// the account agents: route validates + registers a launch + returns 202,
// the client polls GET /povs/:povId/draft-status until done/failed.
// Task #1020 — launch state now lives in the durable background-job
// registry (atelier_background_jobs), so status survives restarts, shows
// in the global indicator, and notifies the starter on completion.
const POV_JOB_KINDS = ["pov_draft", "pov_revise"];
const povResultHref = (oppId: string) => `/opportunities/${oppId}?tab=pov`;

// Task #1022 — resolve the evidence set for a POV draft/revise run: the
// snapshot frozen at outline creation/regeneration, or (legacy POVs created
// before snapshots existed) a live query over promoted facts.
function resolvePovEvidence(pov: typeof atelierPovs.$inferSelect): AgentFact[] | null {
  // The snapshot is written BEFORE the approval is recorded (decision
  // route), so an approved outline always has one. No live-query fallback:
  // drafts must never silently pick up facts promoted or demoted after
  // approval. `null` means the snapshot is missing (pre-snapshot legacy POV
  // or a mid-approval read) — callers 412 and ask for a (re-)approval.
  const snap = pov.factSnapshot as AgentFact[] | null;
  if (pov.factSnapshotAt != null && Array.isArray(snap)) return snap;
  return null;
}

// Task #1022 — race-safe version insert: (povId, versionNumber) is now
// UNIQUE, so concurrent launches retry with a freshly computed max+1 instead
// of minting duplicate numbers.
async function insertPovVersionRaceSafe(values: {
  povId: string;
  body: string;
  sections: unknown;
  citations: unknown;
  citationCoverage: number;
  notes: string | null;
  createdByUserId: string;
}): Promise<{ versionId: string; versionNumber: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const versions = await db
      .select({ versionNumber: atelierPovVersions.versionNumber })
      .from(atelierPovVersions)
      .where(eq(atelierPovVersions.povId, values.povId));
    const next = versions.reduce((m, v) => Math.max(m, v.versionNumber), 0) + 1;
    const versionId = rid("povv");
    try {
      await db.insert(atelierPovVersions).values({
        id: versionId,
        povId: values.povId,
        versionNumber: next,
        body: values.body,
        sections: values.sections as never,
        citations: values.citations as never,
        citationCoverage: values.citationCoverage,
        notes: values.notes,
        createdByUserId: values.createdByUserId,
      });
      return { versionId, versionNumber: next };
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (code !== "23505") throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("pov-version-insert-conflict");
}

// @cli-skip: transient launch status for the POV tab poller; not a data read
router.get("/povs/:povId/draft-status", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [pov] = await db.select().from(atelierPovs).where(and(eq(atelierPovs.id, req.params.povId), eq(atelierPovs.orgId, me.orgId)));
  if (!pov || pov.deletedAt) {
    res.status(404).json({ error: "pov-not-found" });
    return;
  }
  const job = await getLatestJob(POV_JOB_KINDS, pov.id, me.orgId);
  const kind = job?.kind === "pov_revise" ? "revise" : "draft";
  if (!job) {
    res.json({ status: "idle" });
    return;
  }
  if (job.status === "running") {
    // Task #1022 — surface multi-pass progress: the draft chain's agent run
    // writes progressPct/statusMessage as it moves through sections → critic
    // → revision → stylist; expose the latest running run for this opp.
    const [run] = await db
      .select({
        progressPct: atelierAgentRuns.progressPct,
        statusMessage: atelierAgentRuns.statusMessage,
      })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.agentId, "ag_pov_draft"),
          eq(atelierAgentRuns.targetId, pov.opportunityId),
          eq(atelierAgentRuns.status, "running"),
          // Task #1046 — never read progress off a heartbeat-dead row.
          agentRunIsFresh(),
        ),
      )
      .orderBy(desc(atelierAgentRuns.createdAt))
      .limit(1);
    res.json({
      status: "running",
      kind,
      progressPct: run?.progressPct ?? null,
      phase: run?.statusMessage ?? null,
    });
  } else if (job.status === "failed") res.json({ status: "failed", kind, error: job.error ?? "failed" });
  else {
    const r = (job.result ?? {}) as { versionId?: string; versionNumber?: number };
    res.json({ status: "done", kind, versionId: r.versionId, versionNumber: r.versionNumber });
  }
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
  // Replay guard: the draft chain may only run while the POV is still an
  // outline. Once a draft exists the status is "drafted"/"approved", so a
  // repeated call to this endpoint cannot mint further versions without a
  // fresh outline approval — reviewers use the /revise route instead.
  if (pov.status !== "outline") {
    res.status(409).json({
      error: "pov-already-drafted",
      reason:
        "This POV already has a draft. Use 'request changes' (revise) to create a new numbered version.",
    });
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
  // Task #1022 — the draft runs on the evidence snapshot frozen at outline
  // APPROVAL, so it always matches the approved outline (no silent drift).
  const promoted = resolvePovEvidence(pov);
  if (promoted == null) {
    res.status(412).json({
      error: "evidence-snapshot-missing",
      reason:
        "This POV has no frozen evidence snapshot. Re-approve the outline to freeze the promoted-fact set before drafting.",
      outlineRunId: pov.runId,
    });
    return;
  }
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
  if (await hasRunningJob(POV_JOB_KINDS, pov.id, me.orgId)) {
    res.status(409).json({ error: "pov-run-in-progress", reason: "A draft is already being generated for this POV." });
    return;
  }
  const jobId = await startBackgroundJob({
    orgId: me.orgId,
    userId: me.id,
    kind: "pov_draft",
    lockKey: "pov", // draft + revise are mutually exclusive on one POV
    targetType: "pov",
    targetId: pov.id,
    label: `POV draft — "${pov.title}"`,
    resultHref: povResultHref(opp.id),
  });
  if (!jobId) {
    // Lost the atomic-start race to a concurrent request.
    res.status(409).json({ error: "pov-run-in-progress", reason: "A draft is already being generated for this POV." });
    return;
  }
  const persona = { id: me.id, role: me.role, orgId: me.orgId };
  let durablePovWork: Awaited<ReturnType<typeof createServerOwnedCrmWorkflow>>;
  try {
    durablePovWork = await createServerOwnedCrmWorkflow({
    orgId: me.orgId,
    requesterId: me.id,
    goal: `Draft POV ${pov.id}`,
    domainLink: `pov:${pov.id}`,
    correlationId: jobId,
    steps: [{
      id: "pov_draft",
      capabilityId: "opportunity.draft_pov",
      input: {
        povId: pov.id, kind: "draft", opportunityName: opp.name, outline,
        promotedFacts: promoted, requesterName: me.name, requesterRole: me.role,
        depth: pov.depth === "memo" ? "memo" : "full",
      },
      dataClasses: ["opportunity", "pov", "research_facts"],
      budget: { maxCostMicros: 1_000_000, maxToolCalls: 20, maxProviderCalls: 20, maxWallMs: 30 * 60_000, maxConcurrentSlots: 1 },
      retryPolicy: { maxAttempts: 3, maxWallMs: 2 * 60 * 60_000 },
      checkpoint: {
        type: "human_approval",
        evidenceSchema: {
          type: "object",
          properties: { outlineRunId: {}, factSnapshotAt: {} },
          required: ["outlineRunId", "factSnapshotAt"],
          additionalProperties: false,
        },
        expiresInMs: 24 * 60 * 60_000,
      },
    }],
    });
    const [draftCheckpoint] = await db.select({ id: atelierWorkCheckpoints.id })
      .from(atelierWorkCheckpoints).where(eq(atelierWorkCheckpoints.workItemId, durablePovWork.workItemId));
    if (draftCheckpoint) {
      const approved = await decideWorkCheckpoint({
        orgId: me.orgId, requesterId: me.id, workItemId: durablePovWork.workItemId,
        checkpointId: draftCheckpoint.id, decision: "approve",
        evidence: { outlineRunId: pov.runId, factSnapshotAt: pov.factSnapshotAt },
      });
      if (!approved) throw new Error("pov-checkpoint-decision-failed");
    } else {
      throw new Error("pov-checkpoint-missing");
    }
  } catch (error) {
    await failBackgroundJob(
      jobId,
      error instanceof Error ? error.message : "pov-workflow-setup-failed",
    );
    res.status(503).json({ error: "pov-checkpoint-unavailable" });
    return;
  }
  void executeDurablePovWork({
    orgId: me.orgId, workItemId: durablePovWork.workItemId,
    workerId: `pov-worker:${me.id}`, jobId: jobId!,
    povId: pov.id, opportunityName: opp.name, outline,
    promotedFacts: promoted, requesterId: me.id, requesterName: me.name, persona,
    title: pov.title, revision: false,
    depth: pov.depth === "memo" ? "memo" : "full",
  });
  res.status(202).json({ started: true });
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

// @cli-skip: pending Task #340 read-parity migration
// Edit a POV's title / objective / outline. Title and objective may be edited
// at any status; the outline may only be edited while the POV is still an
// outline (after a draft exists the outline is frozen — use /revise).
router.patch("/povs/:povId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierUpdatePovBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [pov] = await db.select().from(atelierPovs).where(and(
    eq(atelierPovs.id, req.params.povId),
    eq(atelierPovs.orgId, me.orgId),
  ));
  if (!pov || pov.deletedAt) {
    res.status(404).json({ error: "pov-not-found" });
    return;
  }
  const patch: Partial<typeof atelierPovs.$inferInsert> = {};
  const changed: Record<string, unknown> = {};
  if (typeof parsed.data.title === "string" && parsed.data.title.trim() && parsed.data.title !== pov.title) {
    patch.title = parsed.data.title.trim();
    changed.title = parsed.data.title.trim();
  }
  if (typeof parsed.data.objective === "string" && parsed.data.objective !== pov.objective) {
    patch.objective = parsed.data.objective;
    changed.objective = parsed.data.objective;
  }
  if (parsed.data.outline !== undefined) {
    if (pov.status !== "outline") {
      res.status(409).json({
        error: "outline-frozen",
        reason: "The outline can only be edited before a draft exists. Use 'request changes' to revise a drafted POV.",
      });
      return;
    }
    // Draft-in-flight guard: the background draft snapshots the outline at
    // launch; letting the outline change mid-run would freeze an unapproved
    // outline when the run lands.
    if (await hasRunningJob(POV_JOB_KINDS, pov.id, me.orgId)) {
      res.status(409).json({
        error: "pov-run-in-progress",
        reason: "A draft is currently being generated from this outline. Wait for it to finish before editing.",
      });
      return;
    }
    patch.outline = parsed.data.outline as never;
    changed.outline = parsed.data.outline;
  }
  if (Object.keys(patch).length === 0) {
    res.json(povWire(pov));
    return;
  }
  patch.updatedAt = new Date();
  const [updated] = await db
    .update(atelierPovs)
    .set(patch)
    .where(and(eq(atelierPovs.id, pov.id), eq(atelierPovs.orgId, me.orgId)))
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: me.orgId,
    entityType: "pov",
    entityId: pov.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "pov.update",
    payload: { changes: changed } as never,
    payloadSummary: `${me.name} updated POV "${updated.title}".`,
  });
  if (pov.runId) await recordOutcomeForRun({
    orgId: me.orgId, eventKey: `pov:${pov.id}:edited:${updated.updatedAt.toISOString()}`, occurredAt: updated.updatedAt,
    runId: pov.runId, actorUserId: me.id, originEntityType: "opportunity", originEntityId: updated.opportunityId,
    entityType: "pov", entityId: pov.id, entryPath: "PATCH /povs/:povId",
    outcomeKind: "pov", outcomeStatus: "edited", priorState: pov.status, currentState: updated.status,
    reworkCount: 1, editDistance: Math.min(1, Object.keys(changed).length / 3), missingLinks: [],
  });
  res.json(povWire(updated));
});

// @cli-skip: pending Task #340 read-parity migration
// Regenerate the outline (optionally incorporating reviewer feedback) while the
// POV is still in outline status. A fresh outline run is recorded so a new
// human approval is required before drafting.
router.post("/povs/:povId/outline/regenerate", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierRegeneratePovOutlineBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [pov] = await db.select().from(atelierPovs).where(eq(atelierPovs.id, req.params.povId));
  if (!pov || pov.deletedAt) {
    res.status(404).json({ error: "pov-not-found" });
    return;
  }
  if (pov.status !== "outline") {
    res.status(409).json({
      error: "pov-not-in-outline",
      reason: "The outline can only be regenerated before a draft exists. Use 'request changes' to revise a drafted POV.",
    });
    return;
  }
  if (await hasRunningJob(POV_JOB_KINDS, pov.id, me.orgId)) {
    res.status(409).json({
      error: "pov-run-in-progress",
      reason: "A draft is currently being generated from this outline. Wait for it to finish before regenerating.",
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
  if (promoted.length === 0) {
    res.status(412).json({
      error: "no-promoted-facts",
      reason: "No research facts are promoted for this opportunity. Promote at least one fact before regenerating the outline.",
    });
    return;
  }
  // Task #1198 — bell visibility during synchronous outline-regen LLM call.
  noteAgentLaunch({ agentId: "ag_pov_author", targetId: opp.id, targetLabel: opp.name, userId: me.id });
  let runId: string;
  let outline: PovOutline;
  try {
    ({ runId, outline } = await runPovOutline({
      opportunityId: opp.id,
      opportunityName: opp.name,
      audience: pov.audience ?? "",
      objective: pov.objective ?? "",
      promotedFacts: promoted,
      triggeredByUserId: me.id,
      actorLabel: "POV Author · Outliner (revision)",
      revisionFeedback: parsed.data.feedback?.trim() || undefined,
      priorOutline: (pov.outline as PovOutline["sections"]) ?? [],
      depth: pov.depth === "memo" ? "memo" : "full",
    }));
  } finally {
    clearAgentLaunch("ag_pov_author", opp.id);
  }
  const [updated] = await db
    .update(atelierPovs)
    .set({
      outline: outline.sections as never,
      // Task #1022 — a regenerated outline needs a fresh approval; clear any
      // prior snapshot so it re-freezes at the new approval.
      factSnapshot: null,
      factSnapshotAt: null,
      runId,
      updatedAt: new Date(),
    })
    .where(eq(atelierPovs.id, pov.id))
    .returning();
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "pov",
    entityId: pov.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "pov.outline.regenerate",
    payload: { feedback: parsed.data.feedback ?? null } as never,
    payloadSummary: `${me.name} regenerated the outline for POV "${updated.title}".`,
  });
  res.json(povWire(updated));
});

// @cli-skip: pending Task #340 read-parity migration
// Request changes to a drafted POV — reruns the draft chain with reviewer
// feedback and stores a new numbered version, keeping prior versions intact.
router.post("/povs/:povId/revise", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierRevisePovBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const feedback = parsed.data.feedback.trim();
  if (!feedback) {
    res.status(400).json({ error: "invalid-body", reason: "Feedback is required to revise a POV." });
    return;
  }
  const [pov] = await db.select().from(atelierPovs).where(eq(atelierPovs.id, req.params.povId));
  if (!pov || pov.deletedAt) {
    res.status(404).json({ error: "pov-not-found" });
    return;
  }
  // A revision only makes sense once a draft exists.
  if (pov.status !== "drafted" && pov.status !== "approved") {
    res.status(409).json({
      error: "no-draft-to-revise",
      reason: "This POV has no draft yet. Approve the outline and generate a draft first.",
    });
    return;
  }
  const versions = await db
    .select()
    .from(atelierPovVersions)
    .where(and(eq(atelierPovVersions.povId, pov.id), isNull(atelierPovVersions.deletedAt)))
    .orderBy(desc(atelierPovVersions.versionNumber));
  if (versions.length === 0) {
    res.status(409).json({ error: "no-draft-to-revise", reason: "This POV has no draft version to revise." });
    return;
  }
  const base =
    (parsed.data.baseVersionId && versions.find((v) => v.id === parsed.data.baseVersionId)) ||
    versions.find((v) => v.id === pov.currentVersionId) ||
    versions[0];
  const opp = await loadOpp(pov.opportunityId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }
  // Task #1022 — revisions consume the same evidence snapshot as the
  // original draft, so feedback is applied against the visible evidence.
  const promoted = resolvePovEvidence(pov);
  if (promoted == null) {
    res.status(412).json({
      error: "evidence-snapshot-missing",
      reason:
        "This POV has no frozen evidence snapshot. Re-approve the outline to freeze the promoted-fact set before revising.",
      outlineRunId: pov.runId,
    });
    return;
  }
  if (promoted.length === 0) {
    res.status(412).json({
      error: "no-promoted-facts",
      reason: "No research facts are promoted for this opportunity. Promote at least one fact before revising the POV.",
    });
    return;
  }
  const outline: PovOutline = {
    title: pov.title,
    thesis: pov.objective ?? "",
    sections: (pov.outline as PovOutline["sections"]) ?? [],
  };
  if (await hasRunningJob(POV_JOB_KINDS, pov.id, me.orgId)) {
    res.status(409).json({ error: "pov-run-in-progress", reason: "A revision is already being generated for this POV." });
    return;
  }
  const jobId = await startBackgroundJob({
    orgId: me.orgId,
    userId: me.id,
    kind: "pov_revise",
    lockKey: "pov", // draft + revise are mutually exclusive on one POV
    targetType: "pov",
    targetId: pov.id,
    label: `POV revision — "${pov.title}"`,
    resultHref: povResultHref(opp.id),
  });
  if (!jobId) {
    // Lost the atomic-start race to a concurrent request.
    res.status(409).json({ error: "pov-run-in-progress", reason: "A revision is already being generated for this POV." });
    return;
  }
  const persona = { id: me.id, role: me.role, orgId: me.orgId };
  let durablePovWork: Awaited<ReturnType<typeof createServerOwnedCrmWorkflow>>;
  try {
    durablePovWork = await createServerOwnedCrmWorkflow({
    orgId: me.orgId,
    requesterId: me.id,
    goal: `Revise POV ${pov.id}`,
    domainLink: `pov:${pov.id}`,
    correlationId: jobId,
    steps: [{
      id: "pov_revision",
      capabilityId: "opportunity.draft_pov",
      input: {
        povId: pov.id, kind: "revision", opportunityName: opp.name, outline,
        promotedFacts: promoted, requesterName: me.name, requesterRole: me.role,
        revision: true, revisionFeedback: feedback, priorDraftHtml: base.body ?? "",
        baseVersionNumber: base.versionNumber, depth: pov.depth === "memo" ? "memo" : "full",
      },
      dataClasses: ["opportunity", "pov", "research_facts"],
      budget: { maxCostMicros: 1_000_000, maxToolCalls: 20, maxProviderCalls: 20, maxWallMs: 30 * 60_000, maxConcurrentSlots: 1 },
      retryPolicy: { maxAttempts: 3, maxWallMs: 2 * 60 * 60_000 },
      checkpoint: {
        type: "human_approval",
        evidenceSchema: {
          type: "object",
          properties: { outlineRunId: {}, factSnapshotAt: {} },
          required: ["outlineRunId", "factSnapshotAt"],
          additionalProperties: false,
        },
        expiresInMs: 24 * 60 * 60_000,
      },
    }],
    });
    const [revisionCheckpoint] = await db.select({ id: atelierWorkCheckpoints.id })
      .from(atelierWorkCheckpoints).where(eq(atelierWorkCheckpoints.workItemId, durablePovWork.workItemId));
    if (revisionCheckpoint) {
      const approved = await decideWorkCheckpoint({
        orgId: me.orgId, requesterId: me.id, workItemId: durablePovWork.workItemId,
        checkpointId: revisionCheckpoint.id, decision: "approve",
        evidence: { outlineRunId: pov.runId, factSnapshotAt: pov.factSnapshotAt },
      });
      if (!approved) throw new Error("pov-checkpoint-decision-failed");
    } else {
      throw new Error("pov-checkpoint-missing");
    }
  } catch (error) {
    await failBackgroundJob(
      jobId,
      error instanceof Error ? error.message : "pov-workflow-setup-failed",
    );
    res.status(503).json({ error: "pov-checkpoint-unavailable" });
    return;
  }
  void executeDurablePovWork({
    orgId: me.orgId, workItemId: durablePovWork.workItemId,
    workerId: `pov-worker:${me.id}`, jobId: jobId!,
    povId: pov.id, opportunityName: opp.name, outline,
    promotedFacts: promoted, requesterId: me.id, requesterName: me.name, persona,
    title: pov.title, revision: true,
    revisionFeedback: feedback, priorDraftHtml: base.body ?? "",
    baseVersionNumber: base.versionNumber,
    depth: pov.depth === "memo" ? "memo" : "full",
  });
  res.status(202).json({ started: true });
});

// -------------------------------------------------------------------
// Meetings
// -------------------------------------------------------------------
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

// -------------------------------------------------------------------
// Engagement-side meetings (post-contract)
// -------------------------------------------------------------------
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

// -------------------------------------------------------------------
// Agent runs
// -------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.get("/agent-runs/:runId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [r] = await db.select().from(atelierAgentRuns).where(and(
    eq(atelierAgentRuns.id, req.params.runId),
    eq(atelierAgentRuns.orgId, me.orgId),
    isNull(atelierAgentRuns.deletedAt),
  ));
  if (!r) {
    res.status(404).json({ error: "run-not-found" });
    return;
  }
  if (!(await canAccessAgentRunTarget(me, r))) {
    res.status(404).json({ error: "run-not-found" });
    return;
  }
  res.json({
    id: r.id,
    agentId: r.agentId,
    // Task #1046 — stale "running" rows (dead process) render as error.
    status: effectiveAgentRunStatus(r) as "running" | "blocked" | "complete" | "error",
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
  const [r] = await db.select().from(atelierAgentRuns).where(and(
    eq(atelierAgentRuns.id, req.params.runId), eq(atelierAgentRuns.orgId, me.orgId),
  ));
  if (!r) {
    res.status(404).json({ error: "run-not-found" });
    return;
  }
  if (!(await canAccessAgentRunTarget(me, r))) {
    res.status(404).json({ error: "run-not-found" });
    return;
  }
  if (!canMakeAgentDecision(me, r)) {
    res.status(403).json({ error: "decision-not-authorized" });
    return;
  }
  const priorDecisions = Array.isArray(r.humanDecisions)
    ? (r.humanDecisions as Array<{ decision?: string }>)
    : [];
  if (priorDecisions.some((d) => d.decision === parsed.data.decision)) {
    res.status(409).json({ error: "decision-already-recorded", decision: parsed.data.decision });
    return;
  }
  // Task #1022 — freeze the POV evidence snapshot BEFORE the approval is
  // recorded. Ordering is the race guard: the draft route treats "outline
  // approved" as authoritative only together with a persisted snapshot, and
  // because the snapshot commits first, any request that can observe the
  // approval necessarily observes the snapshot. Fact promotions/demotions
  // made during outline review are captured; changes after this point are not.
  if (
    parsed.data.decision === "approve" &&
    r.status !== "blocked" &&
    (r.agentId === "ag_pov_author" || r.agentId === "pov_author")
  ) {
    const [povForRun] = await db
      .select()
      .from(atelierPovs)
      .where(and(eq(atelierPovs.runId, r.id), isNull(atelierPovs.deletedAt)));
    if (povForRun) {
      const factRows = await db
        .select()
        .from(atelierResearchFacts)
        .where(
          and(
            eq(atelierResearchFacts.opportunityId, povForRun.opportunityId),
            eq(atelierResearchFacts.promoted, true),
            isNull(atelierResearchFacts.deletedAt),
          ),
        );
      const snapshot: AgentFact[] = factRows.map((f) => ({
        id: f.id,
        topic: f.topic,
        statement: f.statement,
        sourceUrl: f.sourceUrl ?? undefined,
        sourceTitle: f.sourceTitle ?? undefined,
        snippet: f.snippet ?? undefined,
        confidence: f.confidence as "green" | "amber" | "red",
      }));
      const now = new Date();
      await db
        .update(atelierPovs)
        .set({ factSnapshot: snapshot as never, factSnapshotAt: now, updatedAt: now })
        .where(eq(atelierPovs.id, povForRun.id));
    }
  }
  await recordDecision({
    orgId: me.orgId,
    runId: r.id,
    decision: parsed.data.decision,
    rationale: parsed.data.rationale ?? "",
    actorId: me.id,
    actorLabel: me.name,
    targetType: r.targetType ?? "agent_run",
    targetId: r.targetId ?? r.id,
    targetLabel: r.targetLabel ?? r.id,
  });
  await recordOutcomeForRun({
    orgId: me.orgId,
    eventKey: `decision:${r.id}:${parsed.data.decision}`,
    occurredAt: new Date(),
    runId: r.id,
    actorUserId: me.id,
    originEntityType: r.targetType ?? "agent_run",
    originEntityId: r.targetId ?? r.id,
    entityType: r.targetType ?? "agent_run",
    entityId: r.targetId ?? r.id,
    entryPath: "POST /agents/:runId/decision",
    outcomeKind: "decision",
    outcomeStatus: parsed.data.decision === "approve" ? "accepted" : parsed.data.decision === "reject" ? "rejected" : "edited",
    priorState: null,
    currentState: parsed.data.decision,
    missingLinks: r.targetId ? [] : ["domain-entity"],
    dataQualityFlags: [],
    metadata: { approvalLatencyMs: Math.max(0, Date.now() - r.createdAt.getTime()) },
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
    } else if (r.agentId === "ag_pov_draft") {
      // Only approving the *draft* run marks the POV approved. Approving the
      // outline run (ag_pov_author) merely unlocks drafting — it must not flip
      // the POV out of "outline" status, or the draft route's status guard
      // would reject the very draft the approval was meant to authorise.
      await db
        .update(atelierPovs)
        .set({ status: "approved", updatedAt: ts })
        .where(and(eq(atelierPovs.runId, r.id), isNull(atelierPovs.deletedAt)));
    }
  }
  const [r2] = await db.select().from(atelierAgentRuns).where(and(
    eq(atelierAgentRuns.id, req.params.runId),
    eq(atelierAgentRuns.orgId, me.orgId),
  ));
  res.json({
    id: r2.id,
    agentId: r2.agentId,
    status: effectiveAgentRunStatus(r2) as "running" | "blocked" | "complete" | "error",
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

// -------------------------------------------------------------------
// v2 — Sales-stage transitions (rationale + evidence + probability)
// -------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/opportunities/:oppId/stage-transition", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const opp = await loadOpp(req.params.oppId);
  if (!opp || opp.orgId !== me.orgId) {
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
    { id: me.id, name: me.name, orgId: me.orgId, role: me.role },
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, ...(result.gate ?? {}) });
    return;
  }

  const causalFacts = await db.select({ runId: atelierResearchFacts.runId })
    .from(atelierResearchFacts).where(and(
      eq(atelierResearchFacts.orgId, me.orgId),
      eq(atelierResearchFacts.opportunityId, opp.id),
      eq(atelierResearchFacts.promoted, true),
      isNull(atelierResearchFacts.deletedAt),
    ));
  const causalRunIds = Array.from(new Set(causalFacts.map((f) => f.runId).filter((id): id is string => !!id)));
  const terminal = resolveSalesStage(result.opportunity.salesStage);
  const terminalStatus = terminal === "contract" ? "converted" :
    ["lost", "no_decision", "withdrawn"].includes(terminal) ? "not_converted" : null;
  if (terminalStatus) for (const runId of causalRunIds) await recordOutcomeForRun({
    orgId: me.orgId, eventKey: `opportunity:${opp.id}:stage:${result.transition.id}:${runId}`,
    occurredAt: new Date(), runId, actorUserId: me.id,
    originEntityType: "opportunity", originEntityId: opp.id, entityType: "opportunity",
    entityId: opp.id, entryPath: "POST /opportunities/:oppId/stage-transition",
    outcomeKind: "research_conversion", outcomeStatus: terminalStatus,
    priorState: result.transition.fromStage, currentState: result.transition.toStage, missingLinks: [],
  });

  res.json({
    opportunity: await buildOppWire(result.opportunity, canAccessPartnersLens(me.role)),
    transition: result.transition,
    // Task #8 — a failed contract-entry engagement auto-create no longer
    // hides in the audit log only; the caller sees it too.
    engagementHookError: result.engagementHookError ?? null,
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

// -------------------------------------------------------------------
// v2 — Pipeline Forecaster (deterministic roll-up)
// -------------------------------------------------------------------
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
      // Task #8 — same runner-aware aging as buildOppWire.
      if (effectiveDaysInStage(o, s) > STALLED_THRESHOLD_DAYS) stalled += 1;
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
    const forecaster = await runPipelineForecaster({ actorId: me.id, actorLabel: me.name, summary });
    await recordOutcomeForRun({
      orgId: me.orgId, eventKey: `forecast:${forecaster.runId}:generated`, occurredAt: new Date(),
      runId: forecaster.runId, actorUserId: me.id, originEntityType: "pipeline", originEntityId: "atelier-global",
      entityType: "pipeline", entityId: "atelier-global", entryPath: "POST /pipeline/forecast/run",
      outcomeKind: "forecast", outcomeStatus: "generated", priorState: null, currentState: "generated",
      missingLinks: [], metadata: { workflow: "pipeline-forecast" },
    });
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

// -------------------------------------------------------------------
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
// -------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/agents/:agentId/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rawId = req.params.agentId;
  const agentId = rawId.startsWith("ag_") ? rawId : `ag_${rawId}`;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { _mode, ...rest } = body;
  const mode = typeof _mode === "string" && _mode.length > 0 ? _mode : undefined;

  // Resolve governance before considering mode extensions. Account-scoped
  // capabilities and orchestrators must never reach a generic mode wrapper,
  // even when the caller supplies a mode that happens to have a dispatcher.
  const agent = getAgent(agentId);
  if (!agent) {
    res.status(404).json({ error: "agent-not-found", agentId });
    return;
  }
  if ((agent.capabilityType ?? "generic") !== "generic") {
    res.status(400).json({
      error: "agent-not-dispatchable-here",
      hint: "This capability is governed by its operational surface.",
      operationalHref: agent.operationalHref ?? null,
    });
    return;
  }

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

// -------------------------------------------------------------------
// Opportunity brief — PDF download
// -------------------------------------------------------------------
// @cli-skip: binary PDF export; no CLI tool shape
router.get("/opportunities/:oppId/brief.pdf", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const { oppId } = req.params;

  const opp = await loadOpp(oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }

  // Gate: persona must be able to see the account that owns this opportunity.
  // 404 (not 403) to avoid IDOR oracle — same pattern as the account route.
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, opp.accountId))) {
    res.status(404).json({ error: "opportunity-not-found" });
    return;
  }

  const [acct] = await db.select({ name: atelierAccounts.name }).from(atelierAccounts).where(eq(atelierAccounts.id, opp.accountId));

  const [briefRow] = await db
    .select()
    .from(atelierBriefs)
    .where(and(eq(atelierBriefs.opportunityId, oppId), isNull(atelierBriefs.deletedAt)))
    .orderBy(desc(atelierBriefs.createdAt))
    .limit(1);

  if (!briefRow) {
    res.status(404).json({ error: "no-brief" });
    return;
  }

  const facts = (briefRow.citations as AgentFact[]) ?? [];
  const age = briefAge(briefRow.createdAt);
  const completeness = computeBriefCompleteness(
    {
      accountSnapshot: briefRow.accountSnapshot as PursuitScoutOutput["accountSnapshot"],
      buyerLandscape: briefRow.buyerLandscape as PursuitScoutOutput["buyerLandscape"],
      fiveCDraft: briefRow.fiveCDraft as PursuitScoutOutput["fiveCDraft"],
      openQuestions: (briefRow.openQuestions as string[]) ?? [],
    },
    facts,
  );

  const oppName = opp.name;
  const accountName = acct?.name ?? "";
  const slug = oppName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "opportunity";
  const filename = `brief-${slug}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", contentDispositionFilename("attachment", filename));

  const doc = createBriefDoc();
  doc.pipe(res);
  buildScoutBriefPdf(doc, {
    oppName,
    accountName,
    brief: {
      accountSnapshot: briefRow.accountSnapshot as Parameters<typeof buildScoutBriefPdf>[1]["brief"]["accountSnapshot"],
      buyerLandscape: briefRow.buyerLandscape as Parameters<typeof buildScoutBriefPdf>[1]["brief"]["buyerLandscape"],
      fiveCDraft: (briefRow.fiveCDraft as Record<string, string>) ?? {},
      openQuestions: (briefRow.openQuestions as string[]) ?? [],
    },
    facts,
    confidence: briefRow.confidence ?? "amber",
    completeness,
    generatedAt: new Date(),
  });
  doc.end();
  void age; // referenced to satisfy lint (age computed but used only for data route)
});

// -------------------------------------------------------------------
// Opportunity POV — export downloads (PDF / PPTX / HTML)
// -------------------------------------------------------------------

/**
 * Shared loader for the POV export routes. Resolves the opportunity (with
 * the same 404-not-403 IDOR-oracle guard as the account route), the POV
 * (`?povId=` or most-recently-created) and the version (`?versionId=` or
 * the current pointer). Writes the error response and returns null when
 * anything is missing or out of the persona's perimeter.
 */
async function resolvePovExportTarget(
  req: Request,
  res: Response,
): Promise<{
  opp: NonNullable<Awaited<ReturnType<typeof loadOpp>>>;
  pov: typeof atelierPovs.$inferSelect;
  version: typeof atelierPovVersions.$inferSelect;
  input: Parameters<typeof buildPovPdf>[1];
  filenameBase: string;
} | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const oppId = String(req.params.oppId ?? "");

  const opp = await loadOpp(oppId);
  if (!opp) {
    res.status(404).json({ error: "opportunity-not-found" });
    return null;
  }

  // Gate: persona must be able to see the account that owns this opportunity.
  // 404 (not 403) to avoid IDOR oracle — same pattern as the account route.
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, opp.accountId))) {
    res.status(404).json({ error: "opportunity-not-found" });
    return null;
  }

  // Export the POV the user is looking at when `?povId=` is supplied; fall back
  // to the most-recently-created POV only when no id is given. A `?versionId=`
  // may pin a specific historical version, else the current pointer is used.
  const reqPovId = typeof req.query.povId === "string" ? req.query.povId : null;
  const reqVersionId = typeof req.query.versionId === "string" ? req.query.versionId : null;

  const pov = reqPovId
    ? (
        await db
          .select()
          .from(atelierPovs)
          .where(
            and(
              eq(atelierPovs.id, reqPovId),
              eq(atelierPovs.opportunityId, oppId),
              isNull(atelierPovs.deletedAt),
            ),
          )
          .limit(1)
      )[0]
    : (
        await db
          .select()
          .from(atelierPovs)
          .where(and(eq(atelierPovs.opportunityId, oppId), isNull(atelierPovs.deletedAt)))
          .orderBy(desc(atelierPovs.createdAt))
          .limit(1)
      )[0];

  if (!pov) {
    res.status(404).json({ error: "no-pov-version" });
    return null;
  }

  const targetVersionId = reqVersionId ?? pov.currentVersionId;
  if (!targetVersionId) {
    res.status(404).json({ error: "no-pov-version" });
    return null;
  }

  const [version] = await db
    .select()
    .from(atelierPovVersions)
    .where(
      and(
        eq(atelierPovVersions.id, targetVersionId),
        eq(atelierPovVersions.povId, pov.id),
        isNull(atelierPovVersions.deletedAt),
      ),
    );

  if (!version) {
    res.status(404).json({ error: "no-pov-version" });
    return null;
  }

  const titleSlug = pov.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "pov";

  return {
    opp,
    pov,
    version,
    filenameBase: `pov-${titleSlug}`,
    input: {
      oppName: opp.name,
      pov: {
        title: pov.title,
        audience: pov.audience ?? null,
        objective: pov.objective ?? null,
      },
      version: {
        versionNumber: version.versionNumber,
        body: version.body ?? "",
        sections: (version.sections as Parameters<typeof buildPovPdf>[1]["version"]["sections"]) ?? [],
        citations: (version.citations as AgentFact[]) ?? [],
        citationCoverage: version.citationCoverage ?? null,
        notes: version.notes ?? null,
      },
      generatedAt: new Date(),
    },
  };
}

// @cli-skip: binary PDF export; no CLI tool shape
router.get("/opportunities/:oppId/pov.pdf", async (req, res) => {
  const target = await resolvePovExportTarget(req, res);
  if (!target) return;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", contentDispositionFilename("attachment", `${target.filenameBase}.pdf`));

  const doc = createBriefDoc();
  doc.pipe(res);
  buildPovPdf(doc, target.input);
  doc.end();
});

// @cli-skip: binary PPTX export; no CLI tool shape
router.get("/opportunities/:oppId/pov.pptx", async (req, res) => {
  const target = await resolvePovExportTarget(req, res);
  if (!target) return;

  // Refuse empty/"Not yet available" drafts — no point shipping a deck of
  // blank slides to a client.
  if (isPovVersionEmpty(target.input.version)) {
    res.status(409).json({
      error: "pov-empty",
      reason: "This POV draft has no content yet — generate the full draft before exporting.",
    });
    return;
  }

  const buf = await buildPovPptx(target.input);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  res.setHeader("Content-Disposition", contentDispositionFilename("attachment", `${target.filenameBase}.pptx`));
  res.send(buf);
});

// @cli-skip: binary HTML-file export; no CLI tool shape
router.get("/opportunities/:oppId/pov.html", async (req, res) => {
  const target = await resolvePovExportTarget(req, res);
  if (!target) return;

  if (isPovVersionEmpty(target.input.version)) {
    res.status(409).json({
      error: "pov-empty",
      reason: "This POV draft has no content yet — generate the full draft before exporting.",
    });
    return;
  }

  const html = renderPovHtml(target.input);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", contentDispositionFilename("attachment", `${target.filenameBase}.html`));
  res.send(html);
});

export default router;
