/**
 * Atelier — v2 CRM Account routes (Task #238).
 *
 * Endpoints:
 *   GET  /atelier/accounts                            (overridden — richer summary)
 *   GET  /atelier/accounts/:accountId                 (full workspace payload)
 *   POST /atelier/accounts/:accountId/cartographer/refresh
 *   GET  /atelier/accounts/:accountId/contacts
 *   GET  /atelier/accounts/:accountId/whitespace
 *   GET  /atelier/accounts/:accountId/qbr
 *   POST /atelier/accounts/:accountId/profile-updates/:updateId/decision
 *   POST /atelier/contacts/:contactId/disposition
 *   GET  /atelier/credentials
 *   POST /atelier/credentials   (partner only)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, isNull, desc, inArray } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierAgentRuns,
  atelierContacts,
  atelierContactRelationships,
  atelierCredentials,
  atelierOpportunities,
  atelierEngagements,
  atelierUsers,
  atelierAuditEvents,
  atelierAccountInsights,
  atelierAccountTeamMembers,
  atelierAccountActions,
  atelierAccountRisks,
  atelierAccountGoalProgress,
  atelierActivities,
  atelierPersons,
  atelierRaidItems,
  atelierPersonalTasks,
} from "@workspace/db";
import { notDeclinedAssignment } from "./meTasksRoutes.js";
import {
  resolveStructuredNameInput,
  PersonNameValidationError,
  type StructuredName,
} from "../../lib/atelier-person-model.js";
import {
  writePerson,
  writePersonAndSync,
  writePersonFromFullName,
} from "../../lib/atelier-person-sync.js";
import { accessibleEngagementIds } from "./engagementRoutes.js";
import { isRestrictedPersona, isBoardObserver, isFoundingPartner } from "./personaRoles.js";
import {
  archiveAccount,
  restoreAccount,
  permanentlyDeleteAccount,
} from "../../lib/atelier-account-lifecycle.js";
import { mergeAccounts, mergeContacts } from "../../lib/atelier-merge.js";
import { findPersonMatch, richerPersonName } from "../../lib/atelier-agents/person-name.js";
import { resolveIndustryTaxonomy } from "../../lib/atelier-agents/industry-taxonomy.js";
import {
  agentRunIsFresh,
  agentRunRowIsStale,
  hasFreshRunningRun,
  launchEntryIsStale,
  INTERRUPTED_RUN_MESSAGE,
} from "../../lib/atelier-agents/run-staleness.js";
import {
  noteAgentLaunch,
  clearAgentLaunch,
} from "../../lib/atelier-agents/launch-visibility.js";
import {
  classifyCriticalRole,
  computeCriticalRoleCoverage,
  isGovernmentAccount,
} from "../../lib/atelier-agents/critical-roles.js";
import {
  computeAccountFinancials,
  computeAccountHealth,
  buildRelationshipTimeline,
  buildRenewalsAndActions,
  countOpenRisks,
  computeAccountHierarchyRollup,
} from "../../lib/atelier-account-360.js";
import {
  findAccountDuplicates,
  findContactDuplicates,
} from "../../lib/atelier-dedupe.js";
import { buildAccountPlan } from "../../lib/atelier-account-plan.js";
import {
  computeAccountBriefCompleteness,
  linkAccountNarrativeToFacts,
  briefAge,
} from "../../lib/atelier-agents/brief-quality.js";
import {
  buildAccountTimeline,
  isOverdue,
  type ActivityWire,
} from "../../lib/atelier-account-timeline.js";
import { executeAccountDossierRead } from "../../lib/atelier-cli/account-dossier-contract.js";

import {
  nepAccessForCached,
  nepCanSeeAccountId,
} from "../../lib/atelier-nep-access.js";

type EngAccess = Awaited<ReturnType<typeof accessibleEngagementIds>>;
function canSeeEng(access: EngAccess, engId: string) {
  return access.all || access.ids.has(engId);
}

/**
 * Account-level visibility. Partners see all accounts. Non-partners see
 * an account only if they hold at least one engagement-grant on an
 * engagement that belongs to this account, OR they are listed as the
 * account's partnerOwner. Prevents IDOR-style reads of CRM intelligence
 * (contacts, signals, pending updates) by anyone with a valid persona.
 */
export async function canSeeAccount(
  access: EngAccess,
  me: { id: string; role?: string | null },
  accountId: string,
): Promise<boolean> {
  // Task #1297 — Non-Equity Partners: visibility is ONLY the explicit NEP
  // access set (owned + granted accounts, plus read-limited parents of
  // invited opportunities). Never fall through to engagement grants.
  if (me.role === "non_equity_partner") {
    // Task #1304 — memoize the NEP access set per request, keyed on the
    // EngAccess object (resolved once per request and threaded through
    // every canSeeAccount call), so list endpoints resolve it ONCE instead
    // of once per row.
    const nep = await nepAccessForCached(access, me.id);
    return nepCanSeeAccountId(nep, accountId);
  }
  if (access.all) return true;
  // Task #509 — senior managers see every account (tiered access model);
  // opportunity/engagement visibility stays grant-scoped.
  if (access.allAccounts) return true;
  const engs = await db
    .select({ id: atelierEngagements.id })
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.accountId, accountId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  if (engs.some((e) => access.ids.has(e.id))) return true;
  const [a] = await db
    .select({ partnerOwnerId: atelierAccounts.partnerOwnerId })
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, accountId));
  return a?.partnerOwnerId === me.id;
}
import {
  AtelierUpdateContactDispositionBody as AtelierContactDispositionInput,
  AtelierDecideProfileUpdateBody as AtelierProfileUpdateDecisionInput,
  AtelierBulkDecideProfileUpdatesBody as AtelierBulkDecideProfileUpdatesInput,
  AtelierRefreshAccountCartographerBody as AtelierCartographerRefreshInput,
  AtelierCreateCredentialBody as AtelierCredentialInput,
  AtelierCreateAccountBody as AtelierCreateAccountInput,
  AtelierUpdateAccountBody as AtelierUpdateAccountInput,
  AtelierUpdateAccountProcurementBody as AtelierUpdateAccountProcurementInput,
  AtelierCreateContactBody as AtelierCreateContactInput,
  AtelierUpdateContactBody as AtelierUpdateContactInput,
  AtelierCreateContactRelationshipBody as AtelierCreateContactRelationshipInput,
  AtelierCreateAccountInsightBody as AtelierCreateAccountInsightInput,
  AtelierUpdateAccountInsightBody as AtelierUpdateAccountInsightInput,
  AtelierAddAccountTeamMemberBody as AtelierAddAccountTeamMemberInput,
  AtelierUpdateAccountTeamMemberBody as AtelierUpdateAccountTeamMemberInput,
  AtelierCreateAccountActionBody as AtelierCreateAccountActionInput,
  AtelierUpdateAccountActionBody as AtelierUpdateAccountActionInput,
  AtelierCreateAccountRiskBody as AtelierCreateAccountRiskInput,
  AtelierUpdateAccountRiskBody as AtelierUpdateAccountRiskInput,
  AtelierUpsertAccountGoalProgressBody as AtelierUpsertAccountGoalProgressInput,
  AtelierCreateActivityBody as AtelierCreateActivityInput,
  AtelierUpdateActivityBody as AtelierUpdateActivityInput,
  AtelierCheckAccountDuplicatesBody as AtelierCheckAccountDuplicatesInput,
  AtelierCheckContactDuplicatesBody as AtelierCheckContactDuplicatesInput,
  AtelierMergeAccountsBody as AtelierMergeAccountsInput,
  AtelierMergeContactsBody as AtelierMergeContactsInput,
} from "@workspace/api-zod";
import {
  runExecutiveMapperAndQueue,
  chainExecutiveMapperAfterCartographer,
  getExecutiveMapperLaunch,
} from "../../lib/atelier-agents/executive-mapper-chain.js";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import multer from "multer";
import {
  storeAccountLogoBytes,
  loadAccountLogoBytes,
  dropAccountLogoBytes,
} from "../../lib/accountLogoStorage.js";
import {
  createBriefDoc,
  buildAccountResearchBriefPdf,
} from "../../lib/atelier-brief-pdf.js";
import { stripStaleWatchOutCache } from "../../lib/atelier-prepcard-talking-points.js";
import { CRITICAL_ROLES } from "../../lib/atelier-agents/critical-roles.js";
import {
  runAccountCartographer,
  runWhitespaceMapper,
  runQbrComposer,
  buildCartographerProposals,
  AgentNonJsonResponseError,
  runNextBestAction,
  runRelationshipHealth,
  runPreMeetingBriefing,
  runStrategyDeveloper,
  clampStrategyDraft,
  runProcurementNavigator,
  isProcurementGuideEmpty,
  type ProcurementNavigatorOutput,
  type StrategyDeveloperOutput,
  type PendingProfileUpdate,
  type WhitespaceOutput,
  type QbrOutput,
} from "../../lib/atelier-agents/runner.js";
import { indexAccountStrategyExemplar } from "../../lib/atelier-agents/strategy-exemplars.js";
import {
  runProcurementRenewalScan,
  resolveProcurementRenewalPaneItems,
} from "../../lib/atelier-procurement-renewal.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response) {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

async function loadAccount(id: string) {
  const [row] = await db
    .select()
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, id), isNull(atelierAccounts.deletedAt)));
  return row ?? null;
}

// ---------- async agent-run launches (Task #201) ----------
// Long LLM runs (Cartographer refresh, Executive Mapper) must NOT hold the
// HTTP request open — the proxy times held connections out at ~60s and the
// client sees a 502. The routes below record an in-process launch entry,
// kick the work off in the background, and return immediately; the client
// polls a status route. The DB run row (atelier_agent_runs) is the durable
// record that survives reloads/restarts; the in-memory entry closes the
// pre-row race (the run row is only inserted once the background task gets
// going) and captures errors thrown before a run row exists (e.g. budget).
type AgentLaunchState = {
  status: "running" | "succeeded" | "failed";
  error: string | null;
  runId: string | null;
  proposedCount: number | null;
  openQuestions: string[];
  startedAt: number;
  /** Ownership token (Task #1046) — see registerLaunch/settleLaunch. */
  token?: number;
};
const agentLaunches = new Map<string, AgentLaunchState>();
const launchKey = (agentId: string, accountId: string) => `${agentId}:${accountId}`;
let agentLaunchSeq = 0;

/**
 * Task #1046 — token-owned launch registration. The returned token must be
 * passed to settleLaunch by the async completion paths so a wedged old
 * promise that lost its slot to a relaunch can never overwrite the newer
 * launch's state when it eventually settles.
 */
function registerLaunch(key: string, state: Omit<AgentLaunchState, "token">): number {
  const token = ++agentLaunchSeq;
  agentLaunches.set(key, { ...state, token });
  return token;
}

function settleLaunch(key: string, token: number, state: Omit<AgentLaunchState, "token">): void {
  if (agentLaunches.get(key)?.token !== token) return;
  agentLaunches.set(key, { ...state, token });
}

/** Test seam (probes only) — backdate a launch entry's startedAt. */
export function __testBackdateAgentLaunch(
  agentId: string,
  accountId: string,
  startedAt: number,
): void {
  const k = launchKey(agentId, accountId);
  const e = agentLaunches.get(k);
  if (e) agentLaunches.set(k, { ...e, startedAt });
}

/**
 * Task #1046 — single read path for launch entries: a "running" entry whose
 * start time is past the staleness cutoff MAY be a wedged/dead run. The
 * durable heartbeat decides: a long run still stamping progress on its run
 * row stays live; otherwise normalize to "failed" so status readers stop
 * reporting a live run and relaunch guards unlock.
 */
async function getLaunch(agentId: string, accountId: string): Promise<AgentLaunchState | undefined> {
  const key = launchKey(agentId, accountId);
  const entry = agentLaunches.get(key);
  if (!entry || entry.status !== "running" || !launchEntryIsStale(entry.startedAt)) {
    return entry;
  }
  if (await hasFreshRunningRun(agentId, accountId)) return entry;
  const failed: AgentLaunchState = {
    ...entry,
    status: "failed",
    error: INTERRUPTED_RUN_MESSAGE,
  };
  // Only overwrite if unchanged — a relaunch may own the slot by now.
  if (agentLaunches.get(key) === entry) agentLaunches.set(key, failed);
  return failed;
}

/**
 * Task #722 — non-blocking Procurement Navigator auto-run on account
 * creation. Registers a launch entry (so the Procurement tab shows the
 * in-progress state immediately) and degrades gracefully on any failure —
 * the error is recorded on the launch entry / run row, never thrown into
 * the create path. Results land as a reviewable draft (never auto-applied).
 */
async function autoRunProcurementNavigator(
  accountId: string,
  userId: string,
  accountLabel: string,
): Promise<void> {
  const key = launchKey("ag_procurement_navigator", accountId);
  if ((await getLaunch("ag_procurement_navigator", accountId))?.status === "running") return;
  const token = registerLaunch(key, {
    status: "running",
    error: null,
    runId: null,
    proposedCount: null,
    openQuestions: [],
    startedAt: Date.now(),
  });
  void (async () => {
    try {
      const result = await runProcurementNavigator({
        accountId,
        triggeredByUserId: userId,
        actorLabel: "Procurement Navigator (auto)",
      });
      settleLaunch(key, token, {
        status: "succeeded",
        error: null,
        runId: result.runId,
        proposedCount: null,
        openQuestions: [],
        startedAt: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[atelier] auto-on-create procurement navigator failed for ${accountLabel}: ${message}`,
      );
      settleLaunch(key, token, {
        status: "failed",
        error: message,
        runId: null,
        proposedCount: null,
        openQuestions: [],
        startedAt: Date.now(),
      });
    }
  })();
}

async function loadCartographerStatus(
  accountId: string,
): Promise<{ status: "running" | "failed" | null; phase: string | null }> {
  const launch = await getLaunch("account_cartographer", accountId);
  if (launch?.status === "running") {
    // Background task may not have inserted its run row yet — fall through
    // to the DB only for a fresher phase message if one exists.
    const [row] = await db
      .select({ status: atelierAgentRuns.status, statusMessage: atelierAgentRuns.statusMessage })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.targetType, "account"),
          eq(atelierAgentRuns.targetId, accountId),
          eq(atelierAgentRuns.agentId, "account_cartographer"),
        ),
      )
      .orderBy(desc(atelierAgentRuns.createdAt))
      .limit(1);
    return {
      status: "running",
      phase: row?.status === "running" ? (row.statusMessage ?? null) : "Starting research…",
    };
  }
  if (launch?.status === "failed") {
    return { status: "failed", phase: launch.error };
  }
  const [latest] = await db
    .select({
      status: atelierAgentRuns.status,
      statusMessage: atelierAgentRuns.statusMessage,
      createdAt: atelierAgentRuns.createdAt,
      updatedAt: atelierAgentRuns.updatedAt,
    })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.targetType, "account"),
        eq(atelierAgentRuns.targetId, accountId),
        eq(atelierAgentRuns.agentId, "account_cartographer"),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(1);
  if (!latest) return { status: null, phase: null };
  // Task #1046 — a "running" row whose heartbeat stopped is a dead run
  // (crashed process); report it failed instead of spinning forever.
  if (agentRunRowIsStale(latest)) {
    return { status: "failed", phase: INTERRUPTED_RUN_MESSAGE };
  }
  if (latest.status === "running") {
    // Surface the latest live phase (e.g. "Synthesising the brief… (42s)")
    // so the account page shows a meaningful, updating label rather than a
    // bare indefinite spinner.
    return { status: "running", phase: latest.statusMessage ?? null };
  }
  if (latest.status === "failed" || latest.status === "error") {
    // Surface the failure detail (failRun stores the error message in
    // statusMessage) so the account page can show WHY instead of a bare
    // "failed" banner.
    return { status: "failed", phase: latest.statusMessage ?? null };
  }
  return { status: null, phase: null };
}

// Task #868 — SINGLE status source for the Executive Mapper, merged the same
// way as the bespoke status route: the in-process launch entry (covers the
// pre-run-row window and errors thrown before a run row exists) with the
// durable run row (covers page reloads and server restarts mid-run). Used by
// BOTH the workspace shape (header chip / button) and the status route so
// every UI surface reads one consistent state.
async function loadExecutiveMapperStatus(accountId: string): Promise<{
  status: "idle" | "running" | "succeeded" | "failed";
  phase: string | null;
  runId: string | null;
  error: string | null;
  proposedCount: number | null;
  openQuestions: string[];
}> {
  const launch = await getExecutiveMapperLaunch(accountId);
  const [latestRaw] = await db
    .select({
      id: atelierAgentRuns.id,
      status: atelierAgentRuns.status,
      statusMessage: atelierAgentRuns.statusMessage,
      createdAt: atelierAgentRuns.createdAt,
      updatedAt: atelierAgentRuns.updatedAt,
    })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.agentId, "executive_mapper"),
        eq(atelierAgentRuns.targetId, accountId),
        isNull(atelierAgentRuns.deletedAt),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(1);
  // Task #1046 — treat a heartbeat-dead "running" row as errored so the
  // header chip can't show a live run forever after a crash.
  const latest =
    latestRaw && agentRunRowIsStale(latestRaw)
      ? { ...latestRaw, status: "error", statusMessage: INTERRUPTED_RUN_MESSAGE }
      : latestRaw;
  // In-process "running" wins even if the run row already reads complete —
  // the governed-queue write happens after the row completes, and succeeded
  // is only reported once the proposals are actually queued.
  if (launch?.status === "running" || latest?.status === "running") {
    return {
      status: "running",
      phase: latest?.status === "running" ? (latest.statusMessage ?? null) : null,
      runId: latest?.status === "running" ? latest.id : null,
      error: null,
      proposedCount: null,
      openQuestions: [],
    };
  }
  if (launch) {
    return {
      status: launch.status,
      phase: null,
      runId: launch.runId,
      error: launch.error,
      proposedCount: launch.proposedCount,
      openQuestions: launch.openQuestions,
    };
  }
  if (!latest) {
    return { status: "idle", phase: null, runId: null, error: null, proposedCount: null, openQuestions: [] };
  }
  if (latest.status === "error" || latest.status === "failed") {
    return {
      status: "failed",
      phase: null,
      runId: latest.id,
      error: latest.statusMessage ?? "The executive mapping run failed.",
      proposedCount: null,
      openQuestions: [],
    };
  }
  return {
    status: "succeeded",
    phase: null,
    runId: latest.id,
    error: null,
    proposedCount: null,
    openQuestions: [],
  };
}

async function summariseAccount(
  a: typeof atelierAccounts.$inferSelect,
  access: EngAccess,
  me: { id: string; role?: string | null },
) {
  const [partner] = a.partnerOwnerId
    ? await db.select().from(atelierUsers).where(eq(atelierUsers.id, a.partnerOwnerId))
    : [null];
  const allOpps = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.accountId, a.id),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  const allEngs = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.accountId, a.id),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  // Filter engagements by RLS-equivalent persona grants. Opportunities
  // ride along with their engagement (an opp is visible if any visible
  // engagement was spawned from it); partners always see all.
  const engs = allEngs.filter((e) => canSeeEng(access, e.id));
  const visibleOppIds = new Set(
    engs.map((e) => e.opportunityId).filter((x): x is string => !!x),
  );
  const opps = allOpps.filter(
    (o) => access.all || visibleOppIds.has(o.id),
  );
  const openOpps = opps.filter(
    (o) => !["contract", "lost", "no_decision", "withdrawn"].includes(o.salesStage as string),
  );
  const activeEngs = engs.filter(
    (e) => !["closed", "won", "lost"].includes((e.plmStage as string) ?? ""),
  );
  const lastTouch = [...opps, ...engs].sort(
    (x, y) => new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime(),
  )[0];
  const pending = (a.pendingProfileUpdates ?? []).filter(
    (u) => u.status === "pending",
  );
  const { status: cartographerStatus, phase: cartographerPhase } =
    await loadCartographerStatus(a.id);
  // Task #868 — Executive Mapper status rides on the workspace so the page's
  // existing poll drives the header chip and the Map executives button.
  const execMapper = await loadExecutiveMapperStatus(a.id);
  // Task #607 — the company's headline revenue is a money surface, so it
  // honours the same account-financials gate as the rest of the financial
  // signals (account-wide authority + not a restricted / board persona).
  // Restricted personas get null + annualRevenueRedacted=true so the UI can
  // distinguish "withheld" from "not disclosed".
  const accountWide = access.all || a.partnerOwnerId === me.id;
  const canSeeFinancials =
    accountWide &&
    !isRestrictedPersona(me.role ?? null) &&
    !isBoardObserver(me.role ?? null);
  return {
    id: a.id,
    name: a.name,
    brandName: a.brandName ?? null,
    country: a.country,
    sector: a.sector,
    tier: (a.tier ?? "C") as "A" | "B" | "C" | "D",
    status: (a.status ?? "active") as "active" | "dormant" | "archived",
    size: a.size ?? null,
    hqCity: a.hqCity ?? null,
    primaryCurrency: a.primaryCurrency ?? "USD",
    primaryLanguage: a.primaryLanguage ?? "en",
    partnerOwnerId: a.partnerOwnerId ?? null,
    partnerOwnerName: partner?.name ?? null,
    // Task #601/#607 — firmographic enrichment surfaced on the account page.
    employeeCount: a.employeeCount ?? null,
    annualRevenue: canSeeFinancials ? a.annualRevenue ?? null : null,
    annualRevenueRedacted: !canSeeFinancials && a.annualRevenue != null,
    // Task #613 — the revenue figure VIEW and EDIT gate are identical, so the
    // client can use this to hide the revenue inputs in the edit dialog for
    // personas without account-wide financial authority.
    canEditFinancials: canSeeFinancials,
    holdingStructure: a.holdingStructure ?? null,
    countryPresence: a.countryPresence ?? [],
    entityRole: (a.entityRole ?? null) as
      | "hq"
      | "subsidiary"
      | "branch"
      | "office"
      | null,
    // Task #700 — classified industry taxonomy codes surfaced on the
    // account profile (display names resolved client-side via reference data).
    industryCode: a.industryCode ?? null,
    subIndustryCode: a.subIndustryCode ?? null,
    relationshipStrength: Number(a.relationshipStrength ?? 0),
    openOpportunityCount: openOpps.length,
    activeEngagementCount: activeEngs.length,
    lastTouchAt: lastTouch ? new Date(lastTouch.updatedAt).toISOString() : null,
    enrichedAt: a.enrichedAt ? new Date(a.enrichedAt).toISOString() : null,
    pendingUpdateCount: pending.length,
    cartographerStatus,
    cartographerPhase,
    executiveMapperStatus: execMapper.status,
    executiveMapperPhase: execMapper.phase,
    // Task #1191 — expose a served-URL for the uploaded logo so the web UI
    // can display it via <img>. Null when no logo has been uploaded.
    clientLogoUrl: a.clientLogoRef ? `/api/atelier/accounts/${a.id}/logo` : null,
  };
}

const router: IRouter = Router();

// ---------- list ----------
// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  const tier = typeof req.query.tier === "string" ? req.query.tier : undefined;
  const sector = typeof req.query.sector === "string" ? req.query.sector : undefined;
  const ownerId = typeof req.query.ownerId === "string" ? req.query.ownerId : undefined;
  // Task #627 — archived accounts are hidden from the default roster. Pass
  // `?status=archived` to see only archived accounts (the Archived filter) or
  // `?status=all` to include both. permanently-deleted (deletedAt) rows are
  // never returned regardless.
  const statusFilter =
    typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await db
    .select()
    .from(atelierAccounts)
    .where(isNull(atelierAccounts.deletedAt));
  let filtered = rows;
  if (statusFilter === "archived") {
    filtered = filtered.filter((r) => (r.status ?? "active") === "archived");
  } else if (statusFilter !== "all") {
    filtered = filtered.filter((r) => (r.status ?? "active") !== "archived");
  }
  if (tier) filtered = filtered.filter((r) => (r.tier ?? "C") === tier);
  if (sector) filtered = filtered.filter((r) => r.sector === sector);
  if (ownerId) filtered = filtered.filter((r) => r.partnerOwnerId === ownerId);
  // Account-level RLS: a non-partner only sees accounts where they hold an
  // engagement grant or are the partner_owner. Mirrors canSeeAccount().
  const visible = await Promise.all(
    filtered.map(async (r) => ((await canSeeAccount(access, me, r.id)) ? r : null)),
  );
  const allowed = visible.filter((r): r is NonNullable<typeof r> => r !== null);
  const out = await Promise.all(allowed.map((a) => summariseAccount(a, access, me)));
  res.json(out);
});

// ---------- create ----------
// Task #292 — CRM account creation: partner-tier + senior_manager.
// Task #1297 — non_equity_partner may create accounts too (they become the
// partner owner; origination is stamped for later compensation use).
const CREATE_ROLES = new Set([
  "founding_partner",
  "partner",
  "senior_manager",
  "non_equity_partner",
]);

type ReviewedResearch = NonNullable<
  z.infer<typeof AtelierCreateAccountInput>["research"]
>;

/**
 * Task #587 — persist reviewed Cartographer research directly onto a freshly
 * created account, seeding contacts (and reports_to edges) from the supplied
 * decision-makers. DB-only: no LLM/web call. Mirrors the persistence the
 * fire-and-forget auto-run did, but consumes the partner-reviewed payload
 * verbatim instead of re-researching from scratch.
 */
async function persistReviewedResearch(args: {
  account: typeof atelierAccounts.$inferSelect;
  research: ReviewedResearch;
  actorId: string;
}): Promise<void> {
  const { account, research, actorId } = args;
  const priorityRefs = (research.strategicPriorityRefs ?? [])
    .map((p) => ({ text: (p.text ?? "").trim(), sourceUrls: p.sourceUrls ?? [] }))
    .filter((p) => p.text.length > 0);
  // Respect any strategic priorities the partner entered on the dialog; only
  // fall back to the reviewed refs when the account has none yet.
  const mergedPriorities =
    (account.strategicPriorities ?? []).length > 0
      ? account.strategicPriorities
      : priorityRefs.map((p) => p.text);
  const signals = (research.sourceSignals ?? []).slice(-50);
  // Refreshed summary maps to `notes`; only write it when the partner left
  // notes blank, so a hand-typed note is never clobbered.
  const refreshedSummary = (research.refreshedSummary ?? "").trim();
  const notes =
    account.notes && account.notes.trim().length > 0
      ? account.notes
      : refreshedSummary || account.notes;

  const decisionMakers = (research.decisionMakers ?? []).filter(
    (d) => d.fullName && d.fullName.trim().length > 0,
  );

  // Task #698 — resolve the reviewed research's industry onto the app
  // taxonomy so a raw NAICS code / free-text label never lands in the column.
  const reviewedIndustry = resolveIndustryTaxonomy(
    research.industryCode ?? null,
    research.subIndustryCode ?? null,
  );

  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccounts)
      .set({
        industryCode: reviewedIndustry?.industryCode ?? account.industryCode ?? null,
        subIndustryCode:
          reviewedIndustry?.subIndustryCode ?? account.subIndustryCode ?? null,
        notes,
        sourceSignals: signals as typeof account.sourceSignals,
        strategicPriorities: mergedPriorities,
        strategicPriorityRefs: priorityRefs,
        researchBrief:
          (research.researchBrief as typeof account.researchBrief) ??
          account.researchBrief ??
          null,
        enrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(atelierAccounts.id, account.id));

    // Seed contacts, building a name→id map for reports_to resolution.
    const nameToId = new Map<string, string>();
    for (const dm of decisionMakers) {
      const seniority = (dm.seniority ?? null) as
        | "board_chair" | "board_member"
        | "c_suite" | "vp" | "director" | "manager" | "ic" | null;
      const id = rid("con");
      // Task #538 — agent-emitted fullName is parsed into a person row.
      const pw = await writePersonFromFullName(tx, {
        orgId: account.orgId,
        fullName: dm.fullName,
        sourceKind: "contact",
      });
      await tx.insert(atelierContacts).values({
        id,
        orgId: account.orgId,
        accountId: account.id,
        personId: pw.personId,
        fullName: pw.fullName,
        title: dm.title ?? null,
        seniority,
        entityName: dm.entityName ?? null,
        entityScope: dm.entityScope ?? null,
        buyerPersona: dm.buyerPersona ?? null,
        influenceScore:
          seniority === "c_suite" || seniority === "board_chair"
            ? 5
            : seniority === "vp" || seniority === "board_member"
              ? 4
              : 3,
        disposition: "unknown",
        notes: dm.rationale ?? null,
        timeInRole: dm.timeInRole ?? null,
        careerHistory: dm.careerHistory ?? [],
        education: dm.education ?? [],
        sourceUrl: dm.sourceUrl ?? null,
        confidence: dm.confidence === "verified" ? "verified" : "inferred",
        createdByUserId: actorId,
      });
      nameToId.set(dm.fullName.trim().toLowerCase(), id);
    }

    // Resolve reports_to edges now that every contact has an id. We only link
    // when the named manager is also in the seeded set (no dangling edges).
    // Task #8 — track the batch's edges in-memory and reject any edge that
    // would close a reporting cycle (agent output can name A→B and B→A).
    let edgeCount = 0;
    const seededManagers = new Map<string, string[]>();
    for (const dm of decisionMakers) {
      const reportsToName = (dm.reportsToName ?? "").trim();
      if (!reportsToName) continue;
      const fromId = nameToId.get(dm.fullName.trim().toLowerCase());
      const toId = nameToId.get(reportsToName.toLowerCase());
      if (fromId && toId && fromId !== toId) {
        if (cycleInManagers(seededManagers, fromId, toId)) {
          console.warn(
            `[atelier] skipped seeded reports_to edge ${fromId} -> ${toId}: would create a reporting cycle`,
          );
          continue;
        }
        seededManagers.set(fromId, [...(seededManagers.get(fromId) ?? []), toId]);
        await tx.insert(atelierContactRelationships).values({
          id: rid("cr"),
          orgId: account.orgId,
          accountId: account.id,
          fromContactId: fromId,
          toContactId: toId,
          type: "reports_to",
        });
        edgeCount += 1;
      }
    }

    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: account.id,
      actorType: "agent",
      actorId: "ag_account_cartographer",
      actorLabel: "Account Cartographer",
      action: "account.cartographer_run",
      payload: {
        trigger: "reviewed_on_create",
        signalCount: signals.length,
        contactsSeeded: decisionMakers.length,
        reportsToEdges: edgeCount,
        mandateAngles: research.researchBrief?.mandateAngles?.length ?? 0,
      },
      payloadSummary: `Persisted reviewed Cartographer research and seeded ${decisionMakers.length} contact(s) for ${account.brandName ?? account.name}.`,
    });
  });
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/accounts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({ error: "partner-only", reason: "Only Partner or Engagement Lead personas can create accounts." });
    return;
  }
  const parsed = AtelierCreateAccountInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;

  // Task #619 — annual revenue is a money surface, so SETTING it at creation
  // honours the SAME account-financials gate as PATCH /accounts/:id and viewing
  // the figure: only account-WIDE authority (firm-wide partner via access.all,
  // or the would-be partner owner) and not a restricted / board persona may
  // write it. Without this, a non-financial creator in CREATE_ROLES (e.g. a
  // scoped senior_manager) could seed revenue at create time and bypass the
  // Edit Company Details gate entirely. Omitting / nulling revenue is not a
  // financial write, so non-financial creates still succeed.
  if (input.annualRevenue != null) {
    const access = await accessibleEngagementIds(me);
    const wouldBeOwner =
      input.partnerOwnerId ?? (CREATE_ROLES.has(me.role) ? me.id : null);
    const accountWide =
      access.all || (wouldBeOwner != null && wouldBeOwner === me.id);
    const canEditFinancials =
      accountWide &&
      !isRestrictedPersona(me.role ?? null) &&
      !isBoardObserver(me.role ?? null);
    if (!canEditFinancials) {
      res.status(403).json({
        error: "financials-forbidden",
        reason:
          "Only personas with account-wide financial authority can set annual revenue.",
      });
      return;
    }
  }

  const orgId = me.orgId ?? "aico";
  const trimmedName = input.name.trim();

  // Task #38 — duplicate detection, mirroring the duplicate-opportunity guard.
  // An existing non-archived account in this org whose NORMALIZED name matches
  // (case, punctuation, diacritics, legal suffixes: "Aldrees Ltd" ==
  // "Aldrees Limited") blocks the create with a structured 409 unless the
  // caller explicitly overrides with allowDuplicate. Fuzzy near-matches ride
  // along as `similar` warnings but never block on their own.
  const sameOrgRows = await db
    .select({
      id: atelierAccounts.id,
      name: atelierAccounts.name,
      brandName: atelierAccounts.brandName,
      country: atelierAccounts.country,
      tier: atelierAccounts.tier,
    })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt)));
  const dupMatches = findAccountDuplicates(
    {
      name: trimmedName,
      brandName: input.brandName?.trim() || null,
      country: input.country.trim() || null,
    },
    sameOrgRows,
  );
  const exactDup = dupMatches.find((m) => m.exact);
  if (exactDup && input.allowDuplicate !== true) {
    res.status(409).json({
      error: "duplicate-name",
      existingAccountId: exactDup.id,
      existingAccountName: exactDup.name,
      similar: dupMatches,
      message: `An account with this legal name already exists ("${exactDup.name}"). Pass allowDuplicate to create anyway.`,
    });
    return;
  }

  const accountId = rid("acct");
  const now = new Date();
  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(atelierAccounts)
      .values({
        id: accountId,
        orgId,
        name: trimmedName,
        brandName: input.brandName?.trim() || null,
        country: input.country.trim(),
        sector: input.sector.trim(),
        notes: input.notes?.trim() || null,
        parentAccountId: input.parentAccountId ?? null,
        size: input.size ?? null,
        hqCity: input.hqCity?.trim() || null,
        // Task #601 — firmographic enrichment. Figures are persisted only when
        // the partner/researcher supplied them; nulls/empties stay blank (never
        // fabricated). entityRole only set for branch/HQ-classified entities.
        employeeCount: input.employeeCount ?? null,
        annualRevenue: input.annualRevenue ?? null,
        holdingStructure: input.holdingStructure ?? null,
        countryPresence: input.countryPresence ?? [],
        entityRole: input.entityRole ?? null,
        primaryCurrency: input.primaryCurrency.toUpperCase(),
        primaryLanguage: input.primaryLanguage,
        tier: input.tier,
        status: input.status,
        // Task #8 — default the owner to the creator for EVERY role allowed to
        // create accounts (incl. senior_manager); an ownerless account is
        // invisible to owner-scoped views and forecast partner roll-ups.
        // Task #1297 — non_equity_partner creators ALWAYS own their accounts
        // (input.partnerOwnerId is ignored — they cannot assign to others).
        partnerOwnerId:
          me.role === "non_equity_partner"
            ? me.id
            : input.partnerOwnerId ?? (CREATE_ROLES.has(me.role) ? me.id : null),
        // Task #1297 — origination attribution (who originated, when),
        // stamped for every creator; consumed later by NEP compensation.
        originatedByUserId: me.id,
        originatedAt: now,
        relationshipStrength: 0,
        sourceSignals: [],
        strategicPriorities: (input.strategicPriorities ?? []).map((s) => s.trim()).filter(Boolean),
        cogniriseHypothesis: input.cogniriseHypothesis?.trim() || null,
        pendingProfileUpdates: [],
        createdAt: now,
        updatedAt: now,
        createdByUserId: me.id,
      })
      .returning();
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: row.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "account.created",
      payload: {
        name: row.name,
        brandName: row.brandName,
        sector: row.sector,
        country: row.country,
        tier: row.tier,
        status: row.status,
        partnerOwnerId: row.partnerOwnerId,
        primaryCurrency: row.primaryCurrency,
        primaryLanguage: row.primaryLanguage,
      },
      payloadSummary: `${me.name} created account "${row.brandName ?? row.name}".`,
    });
    return row;
  });

  // Task #587 — reviewed research carried over from the chat proposal card.
  // The partner already reviewed the Cartographer's findings, so we persist
  // them verbatim and seed contacts directly — SKIPPING the wasteful second
  // full Cartographer run (which previously re-searched the web from scratch
  // and discarded the reviewed payload). This is awaited (DB-only, no LLM)
  // so the account is fully enriched by the time the response returns.
  if (input.research) {
    try {
      await persistReviewedResearch({
        account: inserted,
        research: input.research,
        actorId: me.id,
      });
    } catch (err) {
      // The account row + created audit event are already committed, but the
      // reviewed research did not persist. Surface this rather than returning a
      // misleading 201 — Task #587's contract is "persist exactly what was
      // reviewed", so a partial create must not look like a success.
      console.error("[atelier] persist reviewed research failed", err);
      res.status(500).json({
        error: "research-persist-failed",
        accountId: inserted.id,
        message:
          "The account was created but its reviewed research could not be saved.",
      });
      return;
    }
    // Cartographer already ran during the chat flow — chain the Executive
    // Mapper now (fire-and-forget; progress shows in the AI activity rail,
    // proposals land in the governed review queue).
    void runExecutiveMapperAndQueue(inserted.id, me.id).catch((err) => {
      console.warn(
        `[atelier] auto-on-create executive mapper failed for ${inserted.brandName ?? inserted.name}`,
        err instanceof Error ? err.message : err,
      );
    });
    // Task #722 — procurement research auto-runs on every new account.
    void autoRunProcurementNavigator(inserted.id, me.id, inserted.brandName ?? inserted.name);
    const fresh = (await loadAccount(inserted.id)) ?? inserted;
    const access = await accessibleEngagementIds(me);
    const summary = await summariseAccount(fresh, access, me);
    res.status(201).json(summary);
    return;
  }

  // Task #722 — procurement research auto-runs on every new account
  // (non-blocking; degrades gracefully — the create never fails on it).
  void autoRunProcurementNavigator(inserted.id, me.id, inserted.brandName ?? inserted.name);

  // Fire-and-forget Cartographer auto-run. We do not await so the HTTP
  // response stays snappy; the Profile tab polls for completion. Only taken
  // when no reviewed research accompanied the create request (e.g. the CRM
  // "New account" button rather than the chat "Review & Create" flow).
  // Task #1193 — Background Work bell visibility for the auto-on-create
  // Cartographer run (pre-run-row window included). Cleared in the finally.
  noteAgentLaunch({
    agentId: "account_cartographer",
    targetId: inserted.id,
    targetLabel: inserted.brandName ?? inserted.name,
    userId: me.id,
  });
  void (async () => {
    try {
      // Task #560 — use the Cartographer's returned v2 output directly
      // (instead of re-reading the stale agent_runs row, which carried the
      // dropped v1 `proposedProfileUpdates` shape). Persist the full
      // research onto the account so nothing is lost on create, and seed
      // contacts from the named decision-makers.
      const { output: out } = await runAccountCartographer({
        accountId: inserted.id,
        accountName: inserted.brandName ?? inserted.name,
        accountSector: inserted.sector,
        accountCountry: inserted.country,
        triggeredByUserId: me.id,
        actorLabel: "Account Cartographer",
      });
      const fresh = await loadAccount(inserted.id);
      if (!fresh) return;
      const mergedSignals = [
        ...(fresh.sourceSignals ?? []),
        ...(out.sourceSignals ?? []),
      ].slice(-20);
      const priorityRefs = (out.account.strategicPriorities ?? [])
        .map((p) => ({ text: p.text, sourceUrls: p.sourceUrls ?? [] }))
        .filter((p) => p.text.trim().length > 0);
      // Respect any priorities/hypothesis the partner entered on the
      // proposal/dialog; only fall back to the Cartographer's when the
      // account has none yet.
      const mergedPriorities =
        (fresh.strategicPriorities ?? []).length > 0
          ? fresh.strategicPriorities
          : priorityRefs.map((p) => p.text);
      const mergedHypothesis =
        fresh.cogniriseHypothesis && fresh.cogniriseHypothesis.trim().length > 0
          ? fresh.cogniriseHypothesis
          : out.account.cogniriseHypothesis || null;
      // Only seed contacts when the account has none, so re-runs never
      // duplicate the decision-maker list.
      const existingContacts = await db
        .select({ id: atelierContacts.id })
        .from(atelierContacts)
        .where(
          and(
            eq(atelierContacts.accountId, inserted.id),
            isNull(atelierContacts.deletedAt),
          ),
        )
        .limit(1);
      const seedContacts =
        existingContacts.length === 0
          ? (out.decisionMakers ?? [])
              .filter((d) => d.fullName.trim().length > 0)
              .slice(0, 7)
          : [];
      // Task #698 — the auto-run previously dropped the agent's identified
      // industry. Resolve it onto the app taxonomy; only fill when the account
      // has none yet (a reviewed/manual classification is never clobbered).
      const autoIndustry = resolveIndustryTaxonomy(
        out.account.industryCode ?? null,
        out.account.subIndustryCode ?? null,
      );
      await db.transaction(async (tx) => {
        await tx
          .update(atelierAccounts)
          .set({
            ...(autoIndustry && !fresh.industryCode
              ? {
                  industryCode: autoIndustry.industryCode,
                  subIndustryCode:
                    fresh.subIndustryCode ?? autoIndustry.subIndustryCode,
                }
              : {}),
            sourceSignals: mergedSignals,
            strategicPriorities: mergedPriorities,
            strategicPriorityRefs: priorityRefs,
            cogniriseHypothesis: mergedHypothesis,
            researchBrief: out.researchBrief,
            enrichedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(atelierAccounts.id, inserted.id));
        for (const d of seedContacts) {
          // Task #538 — agent-emitted fullName is parsed into a person row.
          const pw = await writePersonFromFullName(tx, {
            orgId: inserted.orgId,
            fullName: d.fullName,
            sourceKind: "contact",
          });
          await tx.insert(atelierContacts).values({
            id: rid("con"),
            orgId: inserted.orgId,
            accountId: inserted.id,
            personId: pw.personId,
            fullName: pw.fullName,
            title: d.title ?? null,
            seniority: d.seniority ?? null,
            entityName: d.entityName ?? null,
            entityScope: d.entityScope ?? null,
            buyerPersona: d.buyerPersona ?? null,
            timeInRole: d.timeInRole ?? null,
            careerHistory: d.careerHistory ?? [],
            education: d.education ?? [],
            sourceUrl: d.sourceUrl ?? null,
            confidence: d.confidence === "verified" ? "verified" : "inferred",
            notes: d.rationale ?? null,
            createdByUserId: me.id,
          });
        }
        await tx.insert(atelierAuditEvents).values({
          id: rid("aud"),
          entityType: "account",
          entityId: inserted.id,
          actorType: "agent",
          actorId: "ag_account_cartographer",
          actorLabel: "Account Cartographer",
          action: "account.cartographer_run",
          payload: {
            trigger: "auto_on_create",
            signalCount: out.sourceSignals?.length ?? 0,
            contactsSeeded: seedContacts.length,
            mandateAngles: out.researchBrief?.mandateAngles?.length ?? 0,
          },
          payloadSummary: `Cartographer auto-ran on creation: persisted research and seeded ${seedContacts.length} contact(s) for ${inserted.brandName ?? inserted.name}.`,
        });
      });
      // Cartographer finished — its bell entry clears here; the Executive
      // Mapper chain registers its own (Task #1193).
      clearAgentLaunch("account_cartographer", inserted.id);
      // Cartographer finished — chain the Executive Mapper (people-only
      // roster sweep). Its progress shows in the AI activity rail and its
      // findings land as governed proposals, never direct writes.
      try {
        await runExecutiveMapperAndQueue(inserted.id, me.id);
      } catch (mapErr) {
        console.warn(
          `[atelier] auto-on-create executive mapper failed for ${inserted.brandName ?? inserted.name}`,
          mapErr instanceof Error ? mapErr.message : mapErr,
        );
      }
    } catch (err) {
      // A "no parseable JSON" / aborted response means the model found nothing
      // worth enriching (accounts with no public footprint — test fixtures,
      // stealth companies). That is an expected miss, not a fault: account
      // creation already succeeded, so log it calmly instead of as a warning
      // with a stack trace.
      const msg = err instanceof Error ? err.message : String(err);
      const expectedMiss =
        err instanceof AgentNonJsonResponseError || /abort/i.test(msg);
      if (expectedMiss) {
        console.info(
          `[atelier] auto-on-create cartographer found no enrichment for ${
            inserted.brandName ?? inserted.name
          } (no public footprint)`,
        );
      } else {
        console.warn("[atelier] auto-on-create cartographer failed", err);
      }
      try {
        await db.insert(atelierAuditEvents).values({
          id: rid("aud"),
          entityType: "account",
          entityId: inserted.id,
          actorType: "agent",
          actorId: "ag_account_cartographer",
          actorLabel: "Account Cartographer",
          action: "account.cartographer_run",
          payload: { trigger: "auto_on_create", error: String((err as Error)?.message ?? err) },
          payloadSummary: `Cartographer auto-run failed for ${inserted.brandName ?? inserted.name}.`,
        });
      } catch {
        /* best-effort */
      }
    } finally {
      clearAgentLaunch("account_cartographer", inserted.id);
    }
  })();

  const access = await accessibleEngagementIds(me);
  const summary = await summariseAccount(inserted, access, me);
  res.status(201).json(summary);
});

// ---------- duplicate detection (Task #632) ----------
// Fuzzy duplicate check used to WARN partners before they create an account
// that probably already exists (warn-and-link, never blocking or merging).
// Org-scoped and gated to the same CREATE_ROLES that own account creation.
// Like the exact-name 409 on create, candidates are surfaced org-wide (not
// visibility-filtered) so a scoped creator is still warned about a clashing
// account they cannot otherwise see — the warning carries only id/name/brand/
// country/tier, and opening it still goes through the normal account ACL.
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/accounts/check-duplicates", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason: "Only Partner or Engagement Lead personas can create accounts.",
    });
    return;
  }
  const parsed = AtelierCheckAccountDuplicatesInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const orgId = me.orgId ?? "aico";
  const rows = await db
    .select({
      id: atelierAccounts.id,
      name: atelierAccounts.name,
      brandName: atelierAccounts.brandName,
      country: atelierAccounts.country,
      tier: atelierAccounts.tier,
    })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt)));
  const candidates = findAccountDuplicates(
    { name: input.name, brandName: input.brandName, country: input.country },
    rows,
    { excludeId: input.excludeAccountId ?? undefined },
  );
  res.json({ candidates });
});

// ---------- workspace ----------
// Task #617 — firmographic fields whose edits are tracked in the change
// history surfaced on the Company Details card. Labels mirror the edit dialog.
const FIRMOGRAPHIC_FIELD_LABELS: Record<string, string> = {
  employeeCount: "Employees",
  annualRevenue: "Annual revenue",
  holdingStructure: "Group structure",
  countryPresence: "Country presence",
  entityRole: "Entity role",
};

const ENTITY_ROLE_DISPLAY: Record<string, string> = {
  hq: "Global HQ",
  subsidiary: "Subsidiary",
  branch: "Branch",
  office: "Office",
};

/** Treat two firmographic values as equal for change-tracking. JSON-compares
 *  objects/arrays and normalises null vs undefined so a no-op save (the edit
 *  dialog always sends every field) never produces a spurious history row. */
function firmoValuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Human-readable one-line rendering of a firmographic value for the history
 *  feed. Returns "—" for empty/unknown so the UI never shows a fabricated 0. */
function displayFirmographicValue(field: string, value: unknown): string {
  if (value == null) return "—";
  switch (field) {
    case "employeeCount": {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString() : "—";
    }
    case "annualRevenue": {
      const r = value as { amount?: number | null; currency?: string | null; asOf?: string | null };
      if (r.amount == null) return "—";
      const n = r.amount;
      const abs = Math.abs(n);
      let body: string;
      if (abs >= 1_000_000_000) body = `${(n / 1_000_000_000).toFixed(1)}B`;
      else if (abs >= 1_000_000) body = `${(n / 1_000_000).toFixed(1)}M`;
      else if (abs >= 1_000) body = `${(n / 1_000).toFixed(0)}K`;
      else body = `${Math.round(n)}`;
      const head = r.currency ? `${r.currency} ${body}` : body;
      return r.asOf ? `${head} (${r.asOf})` : head;
    }
    case "holdingStructure": {
      const h = value as { isHoldingCompany?: boolean; isMultiBrand?: boolean; brands?: string[] };
      const flags: string[] = [];
      if (h.isHoldingCompany) flags.push("Holding company");
      if (h.isMultiBrand) flags.push("Multi-brand");
      const brands = (h.brands ?? []).filter((b) => b.trim().length > 0);
      if (brands.length > 0) flags.push(`${brands.length} brand${brands.length === 1 ? "" : "s"}`);
      return flags.length > 0 ? flags.join(" · ") : "—";
    }
    case "countryPresence": {
      const c = value as Array<unknown>;
      const n = Array.isArray(c) ? c.length : 0;
      return n > 0 ? `${n} countr${n === 1 ? "y" : "ies"}` : "—";
    }
    case "entityRole":
      return ENTITY_ROLE_DISPLAY[String(value)] ?? String(value);
    default:
      return "—";
  }
}

/** Build the firmographic change history (newest-first) from the account's
 *  audit events. Annual-revenue rows are redacted for personas without
 *  financial authority — values + displays nulled, canRevert false — so the
 *  money figure is never leaked through the history. */
function buildFirmographicHistory(
  audit: Array<{
    id: string;
    action: string;
    actorType: string;
    actorLabel: string | null;
    payload: unknown;
    createdAt: Date | string;
  }>,
  canSeeFinancials: boolean,
) {
  const out: Array<{
    id: string;
    field: string;
    label: string;
    actorType: string;
    actorLabel: string;
    at: string;
    fromValue: unknown;
    toValue: unknown;
    fromDisplay: string | null;
    toDisplay: string | null;
    redacted: boolean;
    canRevert: boolean;
  }> = [];
  for (const e of audit) {
    if (e.action !== "account.update") continue;
    const changes = (e.payload as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes as Array<{ field?: string; before?: unknown; after?: unknown }>) {
      const field = c.field ?? "";
      if (!(field in FIRMOGRAPHIC_FIELD_LABELS)) continue;
      const redacted = field === "annualRevenue" && !canSeeFinancials;
      out.push({
        id: `${e.id}:${field}`,
        field,
        label: FIRMOGRAPHIC_FIELD_LABELS[field],
        actorType: e.actorType,
        actorLabel: e.actorLabel ?? "",
        at: new Date(e.createdAt).toISOString(),
        fromValue: redacted ? null : (c.before ?? null),
        toValue: redacted ? null : (c.after ?? null),
        fromDisplay: redacted ? null : displayFirmographicValue(field, c.before ?? null),
        toDisplay: redacted ? null : displayFirmographicValue(field, c.after ?? null),
        redacted,
        canRevert: !redacted,
      });
    }
  }
  return out.slice(0, 20);
}

async function buildWorkspace(
  accountId: string,
  access: EngAccess,
  me: { id: string; role?: string | null },
) {
  const a = await loadAccount(accountId);
  if (!a) return null;
  const summary = await summariseAccount(a, access, me);
  const contacts = await db
    .select()
    .from(atelierContacts)
    .where(
      and(eq(atelierContacts.accountId, a.id), isNull(atelierContacts.deletedAt)),
    );
  const contactIds = contacts.map((c) => c.id);
  // Task #567 — resolve Cognirise-side relationship owner display names.
  const contactOwnerIds = Array.from(
    new Set(contacts.map((c) => c.contactOwnerId).filter((x): x is string => !!x)),
  );
  const contactOwners = contactOwnerIds.length
    ? await db
        .select()
        .from(atelierUsers)
        .where(and(inArray(atelierUsers.id, contactOwnerIds), eq(atelierUsers.orgId, a.orgId)))
    : [];
  const ownerName = (id: string | null | undefined) =>
    id ? contactOwners.find((u) => u.id === id)?.name ?? null : null;
  const rels =
    contactIds.length === 0
      ? []
      : await db
          .select()
          .from(atelierContactRelationships)
          .where(
            and(
              eq(atelierContactRelationships.accountId, a.id),
              isNull(atelierContactRelationships.deletedAt),
            ),
          );
  const allOppsWs = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.accountId, a.id),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  const allEngsWs = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.accountId, a.id),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  const wsEngs = allEngsWs.filter((e) => canSeeEng(access, e.id));
  const wsVisibleOppIds = new Set(
    wsEngs.map((e) => e.opportunityId).filter((x): x is string => !!x),
  );
  const opps = allOppsWs.filter(
    (o) => access.all || wsVisibleOppIds.has(o.id),
  );
  const oppLeadIds = Array.from(new Set(opps.map((o) => o.engagementLeadId).filter(Boolean)));
  const oppLeads = oppLeadIds.length
    ? await db.select().from(atelierUsers).where(inArray(atelierUsers.id, oppLeadIds as string[]))
    : [];
  const leadName = (id: string | null | undefined) =>
    id ? oppLeads.find((u) => u.id === id)?.name ?? null : null;
  const oppRefs = opps.map((o) => ({
    id: o.id,
    name: o.name,
    salesStage: o.salesStage,
    dealValueUsd: Number(o.dealSizeHypothesis ?? 0),
    winProbabilityPct: o.probabilityPct ?? null,
    leadName: leadName(o.engagementLeadId),
    nextMilestone: o.nextMilestone ?? null,
  }));
  const engs = wsEngs;
  const engLeadIds = Array.from(new Set(engs.map((e) => e.engagementLeadId).filter(Boolean)));
  const engLeads = engLeadIds.length
    ? await db.select().from(atelierUsers).where(inArray(atelierUsers.id, engLeadIds as string[]))
    : [];
  const engRefs = engs.map((e) => ({
    id: e.id,
    title: e.name,
    status: (e.plmStage as string) ?? "active",
    leadName: engLeads.find((u) => u.id === e.engagementLeadId)?.name ?? null,
    startedAt: e.startDate ? new Date(e.startDate).toISOString() : null,
  }));
  const audit = await db
    .select()
    .from(atelierAuditEvents)
    .where(eq(atelierAuditEvents.entityId, a.id))
    .orderBy(desc(atelierAuditEvents.createdAt))
    .limit(50);

  // Task #566 — parent / subsidiary hierarchy.
  const hierarchyRef = (r: {
    id: string;
    name: string;
    brandName: string | null;
    tier: string;
  }) => ({
    id: r.id,
    name: r.name,
    brandName: r.brandName ?? null,
    tier: (r.tier ?? "C") as "A" | "B" | "C" | "D",
  });
  // Hierarchy refs are only disclosed for accounts the caller is actually
  // authorized to view — otherwise the parent/child link would leak the
  // identity (name/brand/tier) of an out-of-scope or cross-tenant account.
  const [parentRowRaw] = a.parentAccountId
    ? await db
        .select({
          id: atelierAccounts.id,
          name: atelierAccounts.name,
          brandName: atelierAccounts.brandName,
          tier: atelierAccounts.tier,
        })
        .from(atelierAccounts)
        .where(and(eq(atelierAccounts.id, a.parentAccountId), isNull(atelierAccounts.deletedAt)))
    : [];
  const parentRow =
    parentRowRaw && (await canSeeAccount(access, me, parentRowRaw.id)) ? parentRowRaw : null;
  const childRowsRaw = await db
    .select({
      id: atelierAccounts.id,
      name: atelierAccounts.name,
      brandName: atelierAccounts.brandName,
      tier: atelierAccounts.tier,
    })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.parentAccountId, a.id), isNull(atelierAccounts.deletedAt)))
    .orderBy(atelierAccounts.name);
  const childVisibility = await Promise.all(
    childRowsRaw.map((c) => canSeeAccount(access, me, c.id)),
  );
  const childRows = childRowsRaw.filter((_, i) => childVisibility[i]);

  // ---- human insight feed (Task #569): newest-first, author-attributed ----
  const insightRows = await db
    .select()
    .from(atelierAccountInsights)
    .where(
      and(
        eq(atelierAccountInsights.accountId, a.id),
        isNull(atelierAccountInsights.deletedAt),
      ),
    )
    .orderBy(desc(atelierAccountInsights.createdAt));
  const insightAuthorIds = Array.from(new Set(insightRows.map((r) => r.authorId)));
  const insightAuthors = insightAuthorIds.length
    ? await db
        .select()
        .from(atelierUsers)
        .where(inArray(atelierUsers.id, insightAuthorIds))
    : [];

  // ---- account team (Task #569): partner owner + additional members ----
  const teamRows = await db
    .select()
    .from(atelierAccountTeamMembers)
    .where(
      and(
        eq(atelierAccountTeamMembers.accountId, a.id),
        isNull(atelierAccountTeamMembers.deletedAt),
      ),
    )
    .orderBy(atelierAccountTeamMembers.createdAt);
  const teamUserIds = Array.from(
    new Set([
      ...teamRows.map((r) => r.userId),
      ...(a.partnerOwnerId ? [a.partnerOwnerId] : []),
    ]),
  );
  const teamUsers = teamUserIds.length
    ? await db
        .select()
        .from(atelierUsers)
        .where(inArray(atelierUsers.id, teamUserIds))
    : [];

  // Task #570 — compact composite health for the record header. Computed
  // from the account's full engagement/opportunity set for accurate totals,
  // but only surfaced to personas allowed to see financial signals (mirrors
  // the engagement Financials gate). Restricted / board personas get null.
  // Mirror the account-360 gate: the header health chip is a financial-
  // intelligence signal derived from account-wide totals, so only surface it
  // to firm-wide partners (access.all) or the account's partner owner — never
  // to a consultant scoped to a single engagement on the account.
  const accountWide = access.all || a.partnerOwnerId === me.id;
  const canSeeFinancials =
    accountWide &&
    !isRestrictedPersona(me.role ?? null) &&
    !isBoardObserver(me.role ?? null);
  let health: Awaited<ReturnType<typeof computeAccountHealth>> | null = null;
  if (canSeeFinancials) {
    const financials = await computeAccountFinancials({
      orgId: a.orgId,
      accountId: a.id,
      engagements: allEngsWs,
      opportunities: allOppsWs,
    });
    const openRisks = await countOpenRisks({
      orgId: a.orgId,
      engagementIds: allEngsWs.map((e) => e.id),
    });
    health = computeAccountHealth({
      relationshipStrength: Number(a.relationshipStrength ?? 0),
      financials,
      openRisks,
    });
  }

  // Task #632 — hierarchy roll-up. Only computed when the account actually has
  // subsidiaries (children) — there is nothing to roll up for a leaf account.
  // Aggregates open pipeline / opp count / revenue-to-date / composite health
  // across this account + every descendant. Monetary figures + health honour
  // the same account-financials gate (null + financialsRedacted when withheld);
  // the counts stay visible to any workspace reader.
  const hierarchyRollup =
    childRows.length > 0
      ? await computeAccountHierarchyRollup({
          orgId: a.orgId,
          rootAccountId: a.id,
          canSeeFinancials,
        })
      : null;

  // Task #571 — account plan (action plan, risk register, goal progress).
  // Goal progress is joined to the strategy objectives that live on the
  // account record. Surfaced to anyone who can see the account (read parity
  // with the rest of the workspace); writes are gated in the route handlers.
  const plan = await buildAccountPlan({
    accountId: a.id,
    objectives: (a.accountStrategy?.objectives ?? []) as Array<{
      id: string;
      text: string;
      targetValue?: string | null;
      targetDate?: string | null;
    }>,
  });

  return {
    account: {
      ...summary,
      health,
      notes: a.notes ?? null,
      strategicPriorities: a.strategicPriorities ?? [],
      strategicPriorityRefs: (a.strategicPriorityRefs ?? []) as Array<{
        text: string;
        sourceUrls: string[];
      }>,
      cogniriseHypothesis: a.cogniriseHypothesis ?? null,
      accountStrategy: a.accountStrategy ?? null,
      // Task #722 — vendor/procurement registration intelligence.
      procurement: a.procurement ?? null,
      // Task #699 — free-text partner guidance on the strategy.
      strategyGuidance: a.strategyGuidance ?? null,
      competitors: a.competitors ?? [],
      // Validate the talking-points cache key server-side before the brief
      // reaches the client (strips stale entries so the client never needs
      // a crypto dependency for validation).
      researchBrief: a.researchBrief ? stripStaleWatchOutCache(a.researchBrief) : null,
      // Task #9 — deterministic research-quality signals over the persisted
      // brief: completeness checklist/score, narrative→evidence links, age.
      researchQuality: {
        completeness: computeAccountBriefCompleteness(
          a.researchBrief ?? null,
          a.sourceSignals ?? [],
        ),
        narrativeLinks: linkAccountNarrativeToFacts(a.researchBrief ?? null),
        ...briefAge(a.enrichedAt ?? null),
      },
      parentAccountId: a.parentAccountId ?? null,
      parent: parentRow ? hierarchyRef(parentRow) : null,
      children: childRows.map(hierarchyRef),
      // Task #632 — rolled-up family metrics (null for leaf accounts).
      hierarchyRollup,
      sourceSignals: a.sourceSignals ?? [],
      pendingProfileUpdates: a.pendingProfileUpdates ?? [],
      // Task #608/#613 — firmographic enrichment, surfaced so the account edit
      // dialog can prefill the same fields the create dialog exposes. These come
      // from `...summary` already; the firmographic facts are non-financial and
      // ungated. annualRevenue / annualRevenueRedacted / canEditFinancials are
      // intentionally NOT overridden here so the summary's financials gate
      // stands (a previous override re-exposed the raw revenue to every
      // workspace reader, defeating the gate).
      employeeCount: a.employeeCount ?? null,
      holdingStructure: a.holdingStructure ?? null,
      countryPresence: a.countryPresence ?? [],
      entityRole: (a.entityRole ?? null) as
        | "hq"
        | "subsidiary"
        | "branch"
        | "office"
        | null,
    },
    contacts: await (async () => {
      // Task #538 — batch-resolve linked person rows for structured names.
      const persons = await loadPersonsByIds(contacts.map((c) => c.personId));
      // Task #1200 — gov-mode so ministry contacts get gov_*_lead badges.
      const acctGov = isGovernmentAccount({ sector: a.sector, name: a.name });
      return contacts.map((c) =>
        toContactWire(c, ownerName(c.contactOwnerId), persons.get(c.personId ?? "") ?? null, { government: acctGov }),
      );
    })(),
    relationships: rels.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      fromContactId: r.fromContactId,
      toContactId: r.toContactId,
      type: r.type as "reports_to" | "partners_with" | "blocks",
      notes: r.notes ?? null,
    })),
    opportunities: oppRefs,
    engagements: engRefs,
    audit: audit.map((e) => ({
      id: e.id,
      action: e.action,
      actorType: e.actorType,
      actorLabel: e.actorLabel ?? "",
      payloadSummary: e.payloadSummary ?? null,
      createdAt: new Date(e.createdAt).toISOString(),
    })),
    insights: insightRows.map((r) => {
      const author = insightAuthors.find((u) => u.id === r.authorId);
      const created = new Date(r.createdAt);
      const updated = new Date(r.updatedAt);
      return {
        id: r.id,
        accountId: r.accountId,
        authorId: r.authorId,
        authorName: author?.name ?? "Unknown",
        authorInitials: author?.initials ?? null,
        body: r.body,
        category: (r.category ?? null) as
          | "relationship"
          | "risk"
          | "competitive"
          | "opportunity"
          | "general"
          | null,
        createdAt: created.toISOString(),
        updatedAt: updated.toISOString(),
        edited: updated.getTime() - created.getTime() > 1000,
      };
    }),
    accountTeam: (() => {
      const members = teamRows.map((r) => {
        const u = teamUsers.find((x) => x.id === r.userId);
        return {
          id: r.id,
          accountId: r.accountId,
          userId: r.userId,
          userName: u?.name ?? "Unknown",
          userInitials: u?.initials ?? null,
          userTitle: u?.title ?? null,
          roleOnAccount: r.roleOnAccount as
            | "account_manager"
            | "delivery_lead"
            | "partner"
            | "contributor",
          isOwner: r.userId === a.partnerOwnerId,
          createdAt: new Date(r.createdAt).toISOString(),
        };
      });
      // Always surface the account owner, even when they have no explicit
      // team-members row (spec: account team is "owner + additional members").
      if (a.partnerOwnerId && !members.some((m) => m.userId === a.partnerOwnerId)) {
        const owner = teamUsers.find((x) => x.id === a.partnerOwnerId);
        members.unshift({
          id: `owner:${a.partnerOwnerId}`,
          accountId: a.id,
          userId: a.partnerOwnerId,
          userName: owner?.name ?? "Unknown",
          userInitials: owner?.initials ?? null,
          userTitle: owner?.title ?? null,
          roleOnAccount: "partner",
          isOwner: true,
          createdAt: new Date(a.createdAt).toISOString(),
        });
      }
      return members;
    })(),
    // Task #571 — account planning & execution layer.
    actionPlan: plan.actionPlan,
    riskRegister: plan.riskRegister,
    goalProgress: plan.goalProgress,
    // Task #617 — recent firmographic edits + previous values so partners can
    // review and revert an accidental overwrite from the Company Details card.
    firmographicHistory: buildFirmographicHistory(audit, canSeeFinancials),
  };
}

/**
 * Shared C16 account-dossier service contract. HTTP and assistant adapters
 * intentionally map the same authority outcome to different public envelopes,
 * but validation, account scope and canonical data loading live here.
 */
export async function readAccountDossier(args: {
  accountId: string;
  persona: { id: string; role?: string | null; orgId: string };
}) {
  return executeAccountDossierRead({
    accountId: args.accountId,
    loadAccess: () =>
      accessibleEngagementIds(
        args.persona as Parameters<typeof accessibleEngagementIds>[0],
      ),
    canSee: (access, accountId) => canSeeAccount(access, args.persona, accountId),
    loadWorkspace: (access, accountId) =>
      buildWorkspace(accountId, access, args.persona),
  });
}

router.get("/accounts/:accountId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const result = await readAccountDossier({
    accountId: req.params.accountId,
    persona: me,
  });
  if (result.kind === "invalid_input") {
    res.status(400).json({ error: "invalid-account-id" });
    return;
  }
  if (result.kind === "forbidden") {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  if (result.kind === "not_found") {
    res.status(404).json({ error: "not-found" });
    return;
  }
  res.json(result.workspace);
});

// ---------- Account 360: financials, history & health (Task #570) ----------
// Read-only rollup of EXISTING engagement / invoice / opportunity data onto
// the account record. Gated by canSeeAccount; financial signals are blocked
// for restricted / board personas (mirrors the engagement Financials gate).
// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts/:accountId/account-360", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role)) {
    res.status(403).json({ error: "financials-forbidden" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const a = await loadAccount(req.params.accountId);
  if (!a) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  // Account 360 is an account-WIDE financial intelligence rollup (account-level
  // AR/invoices, full pipeline, every engagement's P&L). canSeeAccount alone is
  // too permissive here — it grants access to anyone holding a single
  // engagement-grant on the account, who would then see firm-wide totals for
  // engagements they are not authorised to view. Gate the rollup to account-wide
  // authority: firm-wide partners (access.all) or the account's partner owner.
  // Scoped consultants use the per-engagement Financials screens instead.
  const accountWide = access.all || a.partnerOwnerId === me.id;
  if (!accountWide) {
    res
      .status(403)
      .json({
        error: "account-financials-forbidden",
        reason:
          "Account 360 rollup requires firm-wide or account-owner access.",
      });
    return;
  }
  const engagements = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.accountId, a.id),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  const opportunities = await db
    .select()
    .from(atelierOpportunities)
    .where(
      and(
        eq(atelierOpportunities.accountId, a.id),
        isNull(atelierOpportunities.deletedAt),
      ),
    );
  const financials = await computeAccountFinancials({
    orgId: a.orgId,
    accountId: a.id,
    engagements,
    opportunities,
  });
  const openRisks = await countOpenRisks({
    orgId: a.orgId,
    engagementIds: engagements.map((e) => e.id),
  });
  const health = computeAccountHealth({
    relationshipStrength: Number(a.relationshipStrength ?? 0),
    financials,
    openRisks,
  });
  const timeline = await buildRelationshipTimeline({
    orgId: a.orgId,
    accountId: a.id,
    engagements,
    opportunities,
  });
  const { renewals, nextBestActions } = await buildRenewalsAndActions({
    orgId: a.orgId,
    accountId: a.id,
    relationshipStrength: Number(a.relationshipStrength ?? 0),
    financials,
    engagements,
    opportunities,
    openRisks,
  });
  res.json({
    accountId: a.id,
    financials,
    health,
    timeline,
    renewals,
    nextBestActions,
  });
});

// -------------------------------------------------------------------
// Account insights + account team (Task #569)
// -------------------------------------------------------------------
// INSIGHTS: a human, attributed, timestamped feed distinct from AI
// research and the audit trail. Anyone who can see the account may post;
// edit/delete is author-scoped. TEAM: the partner owner plus additional
// members; managing the team is gated to partner-tier + senior_manager
// (the same CREATE_ROLES that own account strategy). Every mutation is
// written to the audit trail.
// -------------------------------------------------------------------

const INSIGHT_CATEGORY_LABEL: Record<string, string> = {
  relationship: "Relationship",
  risk: "Risk",
  competitive: "Competitive",
  opportunity: "Opportunity",
  general: "General",
};
const TEAM_ROLE_LABEL: Record<string, string> = {
  account_manager: "Account Manager",
  delivery_lead: "Delivery Lead",
  partner: "Partner",
  contributor: "Contributor",
};

// ---------- create insight (any persona who can see the account) ----------
// @cli-skip: pending Task #340 read-parity migration
router.post("/accounts/:accountId/insights", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const parsed = AtelierCreateAccountInsightInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data.body.trim();
  if (!body) {
    res.status(400).json({ error: "body-required" });
    return;
  }
  const category = parsed.data.category ?? null;
  const id = rid("ins");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(atelierAccountInsights).values({
      id,
      orgId: account.orgId,
      accountId: account.id,
      authorId: me.id,
      body,
      category,
      createdByUserId: me.id,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "insight.created",
      payload: { insightId: id, category },
      payloadSummary: `${me.name} posted ${
        category ? `a ${INSIGHT_CATEGORY_LABEL[category] ?? category}` : "an"
      } insight on ${account.brandName ?? account.name}.`,
    });
  });
  const ws = await buildWorkspace(account.id, access, me);
  res.json(ws);
});

// -------------------------------------------------------------------
// Account-management AI agents (account-scoped, propose-then-approve).
// Each endpoint runs an agent over live account context and returns the
// proposal synchronously. Output is never auto-applied: Next-Best-Action
// recommendations become tasks only when a human accepts (via the
// existing POST /activities route), and Relationship-Health assessments
// are governed via the /dismiss endpoint below. All gated by canSeeAccount.
// -------------------------------------------------------------------

async function guardAccountAgent(req: Request, res: Response) {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const account = await loadAccount(req.params.accountId as string);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return null;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return null;
  }
  return { me, account };
}

// ---------- Next-Best-Action: rank next moves on the account ----------
// @cli-skip: bespoke UI agent run/dismiss surface (raw-fetch contract); agents reach the CLI via run_* capabilities
router.post("/accounts/:accountId/agents/next-best-action/run", async (req, res) => {
  const guard = await guardAccountAgent(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as { horizonDays?: number; focus?: string };
  try {
    const result = await runNextBestAction({
      accountId: guard.account.id,
      horizonDays: typeof body.horizonDays === "number" ? body.horizonDays : undefined,
      focus: typeof body.focus === "string" ? body.focus : undefined,
      triggeredByUserId: guard.me.id,
    });
    res.status(202).json({ runId: result.runId, output: result.output });
  } catch (err) {
    res.status(502).json({ error: "agent-failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

// ---------- Relationship-Health / Churn-Risk: score the relationship ----------
// @cli-skip: bespoke UI agent run/dismiss surface (raw-fetch contract); agents reach the CLI via run_* capabilities
router.post("/accounts/:accountId/agents/relationship-health/run", async (req, res) => {
  const guard = await guardAccountAgent(req, res);
  if (!guard) return;
  try {
    const result = await runRelationshipHealth({
      accountId: guard.account.id,
      triggeredByUserId: guard.me.id,
    });
    res.status(202).json({ runId: result.runId, output: result.output });
  } catch (err) {
    res.status(502).json({ error: "agent-failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

// ---------- Relationship-Health: governed dismiss (audit-logged) ----------
// @cli-skip: bespoke UI agent run/dismiss surface (raw-fetch contract); agents reach the CLI via run_* capabilities
router.post("/accounts/:accountId/agents/relationship-health/dismiss", async (req, res) => {
  const guard = await guardAccountAgent(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as { runId?: string; reason?: string };
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: guard.account.orgId,
    entityType: "account",
    entityId: guard.account.id,
    actorType: "human",
    actorId: guard.me.id,
    actorLabel: guard.me.name,
    action: "agent.dismissed",
    payload: {
      agentId: "ag_relationship_health",
      runId: typeof body.runId === "string" ? body.runId : null,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 240) : null,
    },
    payloadSummary: `${guard.me.name} dismissed the relationship-health assessment for ${guard.account.brandName ?? guard.account.name}.`,
  });
  res.json({ ok: true });
});

// ---------- Pre-Meeting Briefing: citable brief for a meeting ----------
// @cli-skip: bespoke UI agent run/dismiss surface (raw-fetch contract); agents reach the CLI via run_* capabilities
router.post("/accounts/:accountId/agents/pre-meeting-briefing/run", async (req, res) => {
  const guard = await guardAccountAgent(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as {
    meetingId?: string;
    meetingPurpose?: string;
    attendees?: string[];
  };
  try {
    const result = await runPreMeetingBriefing({
      accountId: guard.account.id,
      meetingId: typeof body.meetingId === "string" ? body.meetingId : undefined,
      meetingPurpose: typeof body.meetingPurpose === "string" ? body.meetingPurpose : undefined,
      attendees: Array.isArray(body.attendees)
        ? body.attendees.filter((a): a is string => typeof a === "string")
        : undefined,
      triggeredByUserId: guard.me.id,
    });
    res.status(202).json({ runId: result.runId, output: result.output });
  } catch (err) {
    res.status(502).json({ error: "agent-failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

// ---------- Strategy Developer: draft the account strategy (Task #699) ----------
// Propose-then-approve. Long LLM run → async launch + poll (instant return,
// never holds the request open). Run/approve/dismiss all require account-
// strategy edit rights (mirrors PATCH /accounts/:id CREATE_ROLES gate) on
// top of canSeeAccount.
async function guardStrategyDeveloper(req: Request, res: Response) {
  const guard = await guardAccountAgent(req, res);
  if (!guard) return null;
  if (!CREATE_ROLES.has(guard.me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason: "Only Partner or Senior Manager personas can run or approve strategy drafts.",
    });
    return null;
  }
  return guard;
}

const STRATEGY_DEV_AGENT = "ag_strategy_developer";

// @cli-skip: bespoke UI agent run/approve/dismiss surface (raw-fetch contract)
router.post("/accounts/:accountId/agents/strategy-developer/run", async (req, res) => {
  const guard = await guardStrategyDeveloper(req, res);
  if (!guard) return;
  const key = launchKey(STRATEGY_DEV_AGENT, guard.account.id);
  const existing = await getLaunch(STRATEGY_DEV_AGENT, guard.account.id);
  if (existing?.status === "running") {
    res.status(409).json({ error: "already-running" });
    return;
  }
  const token = registerLaunch(key, {
    status: "running",
    error: null,
    runId: null,
    proposedCount: null,
    openQuestions: [],
    startedAt: Date.now(),
  });
  void (async () => {
    try {
      const result = await runStrategyDeveloper({
        accountId: guard.account.id,
        triggeredByUserId: guard.me.id,
      });
      settleLaunch(key, token, {
        status: "succeeded",
        error: null,
        runId: result.runId,
        proposedCount: null,
        openQuestions: [],
        startedAt: Date.now(),
      });
    } catch (err) {
      settleLaunch(key, token, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        runId: null,
        proposedCount: null,
        openQuestions: [],
        startedAt: Date.now(),
      });
    }
  })();
  res.status(202).json({ launched: true });
});

/**
 * Latest reviewable Strategy Developer draft for an account: the newest
 * `complete` run that has not already been approved or dismissed (both
 * decisions are recorded as audit events referencing the runId).
 */
async function loadLatestStrategyDraft(accountId: string) {
  const [run] = await db
    .select()
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.agentId, STRATEGY_DEV_AGENT),
        eq(atelierAgentRuns.targetType, "account"),
        eq(atelierAgentRuns.targetId, accountId),
        eq(atelierAgentRuns.status, "complete"),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const decisions = await db
    .select({ id: atelierAuditEvents.id, action: atelierAuditEvents.action, payload: atelierAuditEvents.payload })
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.entityType, "account"),
        eq(atelierAuditEvents.entityId, accountId),
        inArray(atelierAuditEvents.action, ["agent.approved", "agent.dismissed"]),
      ),
    );
  const decided = decisions.some(
    (d) => (d.payload as { runId?: string } | null)?.runId === run.id,
  );
  if (decided) return null;
  return run;
}

// @cli-skip: bespoke UI agent run/approve/dismiss surface (raw-fetch contract)
router.get("/accounts/:accountId/agents/strategy-developer/status", async (req, res) => {
  const guard = await guardStrategyDeveloper(req, res);
  if (!guard) return;
  const launch = await getLaunch(STRATEGY_DEV_AGENT, guard.account.id);
  if (launch?.status === "running") {
    const [row] = await db
      .select({ statusMessage: atelierAgentRuns.statusMessage, progressPct: atelierAgentRuns.progressPct })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.agentId, STRATEGY_DEV_AGENT),
          eq(atelierAgentRuns.targetType, "account"),
          eq(atelierAgentRuns.targetId, guard.account.id),
          eq(atelierAgentRuns.status, "running"),
        ),
      )
      .orderBy(desc(atelierAgentRuns.createdAt))
      .limit(1);
    res.json({
      status: "running",
      phase: row?.statusMessage ?? "Starting draft…",
      progressPct: row?.progressPct ?? 5,
      draft: null,
      runId: null,
      currentStrategy: guard.account.accountStrategy ?? null,
      strategyGuidance: guard.account.strategyGuidance ?? null,
    });
    return;
  }
  const run = await loadLatestStrategyDraft(guard.account.id);
  res.json({
    status: launch?.status === "failed" ? "failed" : run ? "drafted" : "idle",
    phase: launch?.status === "failed" ? launch.error : null,
    progressPct: null,
    runId: run?.id ?? null,
    draft: (run?.output as StrategyDeveloperOutput | null) ?? null,
    currentStrategy: guard.account.accountStrategy ?? null,
    strategyGuidance: guard.account.strategyGuidance ?? null,
  });
});

// @cli-skip: bespoke UI agent run/approve/dismiss surface (raw-fetch contract)
router.post("/accounts/:accountId/agents/strategy-developer/approve", async (req, res) => {
  const guard = await guardStrategyDeveloper(req, res);
  if (!guard) return;
  // Task #703 — the partner may tweak the drafted fields inline before
  // approving. `editedDraft` (optional) carries the partner-edited strategy;
  // the server re-clamps it against the same caps as the agent draft and
  // audits that the applied strategy was partner-edited.
  const body = (req.body ?? {}) as { runId?: string; editedDraft?: unknown };
  if (typeof body.runId !== "string" || !body.runId) {
    res.status(400).json({ error: "invalid-body", reason: "runId is required." });
    return;
  }
  if (
    body.editedDraft !== undefined &&
    (typeof body.editedDraft !== "object" ||
      body.editedDraft === null ||
      Array.isArray(body.editedDraft))
  ) {
    res.status(400).json({ error: "invalid-body", reason: "editedDraft must be an object." });
    return;
  }
  const [run] = await db
    .select()
    .from(atelierAgentRuns)
    .where(eq(atelierAgentRuns.id, body.runId));
  if (
    !run ||
    run.agentId !== STRATEGY_DEV_AGENT ||
    run.targetType !== "account" ||
    run.targetId !== guard.account.id ||
    run.status !== "complete"
  ) {
    res.status(404).json({ error: "run-not-found" });
    return;
  }
  // A run that was already approved or dismissed cannot be decided again —
  // otherwise a direct API call could apply a draft the partner dismissed.
  const priorDecisions = await db
    .select({ payload: atelierAuditEvents.payload })
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.entityType, "account"),
        eq(atelierAuditEvents.entityId, guard.account.id),
        inArray(atelierAuditEvents.action, ["agent.approved", "agent.dismissed"]),
      ),
    );
  if (priorDecisions.some((d) => (d.payload as { runId?: string } | null)?.runId === run.id)) {
    res.status(409).json({ error: "already-decided", reason: "This draft was already approved or dismissed." });
    return;
  }
  const output = run.output as StrategyDeveloperOutput | null;
  // Defence in depth: re-clamp before writing, even though the runner
  // already clamps — the account write must never exceed the openapi caps.
  // Task #703 — when the partner edited the draft inline, the edited copy is
  // what gets clamped and applied; the pristine agent draft stays on the run
  // row so the audit trail can show what the agent originally proposed.
  const agentDraft = clampStrategyDraft(output?.draftStrategy);
  const strategy =
    body.editedDraft !== undefined ? clampStrategyDraft(body.editedDraft) : agentDraft;
  // Only stamp "edited" when the applied strategy actually differs from the
  // agent's draft (a no-op editedDraft is treated as a plain approve).
  const partnerEdited =
    body.editedDraft !== undefined &&
    JSON.stringify(strategy) !== JSON.stringify(agentDraft);
  if (
    strategy.objectives.length === 0 &&
    !strategy.winHypothesis &&
    strategy.keyPlays.length === 0
  ) {
    res.status(409).json({ error: "empty-draft", reason: "The draft carries no strategy content." });
    return;
  }
  await db
    .update(atelierAccounts)
    .set({ accountStrategy: strategy, updatedAt: new Date() })
    .where(eq(atelierAccounts.id, guard.account.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: guard.account.orgId,
    entityType: "account",
    entityId: guard.account.id,
    actorType: "human",
    actorId: guard.me.id,
    actorLabel: guard.me.name,
    action: "agent.approved",
    payload: {
      agentId: STRATEGY_DEV_AGENT,
      runId: run.id,
      fields: ["accountStrategy"],
      // Task #703 — record that the applied strategy was tweaked by the
      // partner before approval (the pristine agent draft stays on the run row).
      partnerEdited,
    },
    payloadSummary: partnerEdited
      ? `${guard.me.name} approved the Strategy Developer draft on ${guard.account.brandName ?? guard.account.name} with partner edits.`
      : `${guard.me.name} approved the Strategy Developer draft on ${guard.account.brandName ?? guard.account.name}.`,
  });
  // Re-index so future drafts on other accounts learn from this approved
  // strategy (fire-and-forget; failure never breaks the approve).
  void indexAccountStrategyExemplar(guard.account.id);
  res.json({ ok: true, accountStrategy: strategy });
});

// @cli-skip: bespoke UI agent run/approve/dismiss surface (raw-fetch contract)
router.post("/accounts/:accountId/agents/strategy-developer/dismiss", async (req, res) => {
  const guard = await guardStrategyDeveloper(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as { runId?: string; reason?: string };
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: guard.account.orgId,
    entityType: "account",
    entityId: guard.account.id,
    actorType: "human",
    actorId: guard.me.id,
    actorLabel: guard.me.name,
    action: "agent.dismissed",
    payload: {
      agentId: STRATEGY_DEV_AGENT,
      runId: typeof body.runId === "string" ? body.runId : null,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 240) : null,
    },
    payloadSummary: `${guard.me.name} dismissed the Strategy Developer draft for ${guard.account.brandName ?? guard.account.name}.`,
  });
  res.json({ ok: true });
});

// ---------- Procurement Navigator (Task #722) ----------
// Vendor-registration deep research. Propose-then-approve, async launch +
// poll (identical contract to strategy-developer). Anyone who can see the
// account may READ the procurement section (it rides the workspace payload);
// running the agent, approving/dismissing drafts, and editing the tracked
// status require CREATE_ROLES (partner-tier + senior manager) on top of
// canSeeAccount — mirroring the other account write surfaces.
const PROCUREMENT_AGENT = "ag_procurement_navigator";

async function guardProcurementNavigator(req: Request, res: Response) {
  const guard = await guardAccountAgent(req, res);
  if (!guard) return null;
  if (!CREATE_ROLES.has(guard.me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason:
        "Only Partner or Senior Manager personas can run procurement research or edit the registration status.",
    });
    return null;
  }
  return guard;
}

async function loadLatestProcurementDraft(accountId: string) {
  // Latest COMPLETE run that has not been decided (approved/dismissed) since
  // it finished. Decisions are audit events keyed on runId, so check them.
  const [run] = await db
    .select()
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.agentId, PROCUREMENT_AGENT),
        eq(atelierAgentRuns.targetType, "account"),
        eq(atelierAgentRuns.targetId, accountId),
        eq(atelierAgentRuns.status, "complete"),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(1);
  if (!run) return null;
  const decisions = await db
    .select({ id: atelierAuditEvents.id, payload: atelierAuditEvents.payload })
    .from(atelierAuditEvents)
    .where(
      and(
        eq(atelierAuditEvents.entityType, "account"),
        eq(atelierAuditEvents.entityId, accountId),
        inArray(atelierAuditEvents.action, ["agent.approved", "agent.dismissed"]),
      ),
    );
  const decided = decisions.some((d) => {
    const p = d.payload as { agentId?: string; runId?: string } | null;
    return p?.agentId === PROCUREMENT_AGENT && p?.runId === run.id;
  });
  return decided ? null : run;
}

// @cli-skip: bespoke UI agent run/approve/dismiss surface (raw-fetch contract)
router.post("/accounts/:accountId/agents/procurement-navigator/run", async (req, res) => {
  const guard = await guardProcurementNavigator(req, res);
  if (!guard) return;
  const key = launchKey(PROCUREMENT_AGENT, guard.account.id);
  const existing = await getLaunch(PROCUREMENT_AGENT, guard.account.id);
  if (existing?.status === "running") {
    res.status(409).json({ error: "already-running" });
    return;
  }
  const token = registerLaunch(key, {
    status: "running",
    error: null,
    runId: null,
    proposedCount: null,
    openQuestions: [],
    startedAt: Date.now(),
  });
  void (async () => {
    try {
      const result = await runProcurementNavigator({
        accountId: guard.account.id,
        triggeredByUserId: guard.me.id,
      });
      settleLaunch(key, token, {
        status: "succeeded",
        error: null,
        runId: result.runId,
        proposedCount: null,
        openQuestions: [],
        startedAt: Date.now(),
      });
    } catch (err) {
      settleLaunch(key, token, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        runId: null,
        proposedCount: null,
        openQuestions: [],
        startedAt: Date.now(),
      });
    }
  })();
  res.status(202).json({ started: true });
});

// @cli-skip: bespoke UI agent run/approve/dismiss surface (raw-fetch contract)
router.get("/accounts/:accountId/agents/procurement-navigator/status", async (req, res) => {
  const guard = await guardAccountAgent(req, res);
  if (!guard) return;
  const launch = await getLaunch(PROCUREMENT_AGENT, guard.account.id);
  if (launch?.status === "running") {
    const [row] = await db
      .select({
        statusMessage: atelierAgentRuns.statusMessage,
        progressPct: atelierAgentRuns.progressPct,
      })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.agentId, PROCUREMENT_AGENT),
          eq(atelierAgentRuns.targetType, "account"),
          eq(atelierAgentRuns.targetId, guard.account.id),
          eq(atelierAgentRuns.status, "running"),
        ),
      )
      .orderBy(desc(atelierAgentRuns.createdAt))
      .limit(1);
    res.json({
      status: "running",
      phase: row?.statusMessage ?? "Starting procurement research…",
      progressPct: row?.progressPct ?? 5,
      runId: null,
      draft: null,
      procurement: guard.account.procurement ?? null,
    });
    return;
  }
  const run = await loadLatestProcurementDraft(guard.account.id);
  res.json({
    status: launch?.status === "failed" ? "failed" : run ? "drafted" : "idle",
    phase: launch?.status === "failed" ? launch.error : null,
    progressPct: null,
    runId: run?.id ?? null,
    draft: (run?.output as ProcurementNavigatorOutput | null) ?? null,
    procurement: guard.account.procurement ?? null,
  });
});

// @cli-skip: bespoke UI agent run/approve/dismiss surface (raw-fetch contract)
router.post("/accounts/:accountId/agents/procurement-navigator/approve", async (req, res) => {
  const guard = await guardProcurementNavigator(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as { runId?: string };
  const run = await loadLatestProcurementDraft(guard.account.id);
  if (!run || (typeof body.runId === "string" && body.runId !== run.id)) {
    res.status(409).json({ error: "no-pending-draft" });
    return;
  }
  const output = run.output as ProcurementNavigatorOutput | null;
  if (isProcurementGuideEmpty(output)) {
    res.status(409).json({ error: "empty-draft" });
    return;
  }
  const prior = guard.account.procurement ?? null;
  const next = {
    // Human-tracked state survives re-research; a fresh account starts
    // not_registered.
    status: prior?.status ?? ("not_registered" as const),
    statusNotes: prior?.statusNotes ?? null,
    statusUpdatedAt: prior?.statusUpdatedAt ?? null,
    statusUpdatedBy: prior?.statusUpdatedBy ?? null,
    guide: output!.guide,
    lastResearchedAt: new Date(run.updatedAt ?? run.createdAt).toISOString(),
    lastResearchRunId: run.id,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccounts)
      .set({ procurement: next, updatedAt: new Date() })
      .where(eq(atelierAccounts.id, guard.account.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: guard.account.orgId,
      entityType: "account",
      entityId: guard.account.id,
      actorType: "human",
      actorId: guard.me.id,
      actorLabel: guard.me.name,
      action: "agent.approved",
      payload: {
        agentId: PROCUREMENT_AGENT,
        runId: run.id,
        fields: ["procurement.guide"],
        jurisdiction: output!.guide.jurisdiction,
        channel: output!.guide.channel?.name ?? null,
      },
      payloadSummary: `${guard.me.name} approved the Procurement Navigator guide (${output!.guide.channel?.name ?? output!.guide.jurisdiction}) on ${guard.account.brandName ?? guard.account.name}.`,
    });
  });
  res.json({ ok: true, procurement: next });
});

// @cli-skip: bespoke UI agent run/approve/dismiss surface (raw-fetch contract)
router.post("/accounts/:accountId/agents/procurement-navigator/dismiss", async (req, res) => {
  const guard = await guardProcurementNavigator(req, res);
  if (!guard) return;
  const body = (req.body ?? {}) as { runId?: string; reason?: string };
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: guard.account.orgId,
    entityType: "account",
    entityId: guard.account.id,
    actorType: "human",
    actorId: guard.me.id,
    actorLabel: guard.me.name,
    action: "agent.dismissed",
    payload: {
      agentId: PROCUREMENT_AGENT,
      runId: typeof body.runId === "string" ? body.runId : null,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 240) : null,
    },
    payloadSummary: `${guard.me.name} dismissed the Procurement Navigator guide for ${guard.account.brandName ?? guard.account.name}.`,
  });
  res.json({ ok: true });
});

// ---------- Procurement registration status (manual tracking, Task #722) ----------
const PROCUREMENT_STATUSES = new Set([
  "not_registered",
  "in_progress",
  "registered",
  "renewal_due",
]);

// @cli-skip: manual procurement status tracking is a UI-form surface (Task #722)
router.patch("/accounts/:accountId/procurement", async (req, res) => {
  const guard = await guardProcurementNavigator(req, res);
  if (!guard) return;
  const parsed = AtelierUpdateAccountProcurementInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const { status, statusNotes } = parsed.data;
  if (status !== undefined && !PROCUREMENT_STATUSES.has(status)) {
    res.status(400).json({ error: "invalid-status" });
    return;
  }
  const prior = guard.account.procurement ?? null;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const next = {
    status: prior?.status ?? ("not_registered" as const),
    statusNotes: prior?.statusNotes ?? null,
    statusUpdatedAt: prior?.statusUpdatedAt ?? null,
    statusUpdatedBy: prior?.statusUpdatedBy ?? null,
    guide: prior?.guide ?? null,
    lastResearchedAt: prior?.lastResearchedAt ?? null,
    lastResearchRunId: prior?.lastResearchRunId ?? null,
  };
  if (status !== undefined && status !== next.status) {
    changes.status = { from: next.status, to: status };
    next.status = status as typeof next.status;
  }
  if (statusNotes !== undefined) {
    const trimmed = (statusNotes ?? "").trim() || null;
    if (trimmed !== (next.statusNotes ?? null)) {
      changes.statusNotes = { from: next.statusNotes ?? null, to: trimmed };
      next.statusNotes = trimmed;
    }
  }
  if (Object.keys(changes).length === 0) {
    res.json({ ok: true, procurement: prior ?? next });
    return;
  }
  // Task #732 — statusUpdatedAt anchors the renewal-cadence computation
  // ("registered at X + cadence"). A notes-only edit must NOT move the
  // anchor, or routine note updates would silently postpone approaching-
  // renewal reminders forever.
  if (changes.status) {
    next.statusUpdatedAt = new Date().toISOString();
    next.statusUpdatedBy = guard.me.id;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccounts)
      .set({ procurement: next, updatedAt: new Date() })
      .where(eq(atelierAccounts.id, guard.account.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: guard.account.orgId,
      entityType: "account",
      entityId: guard.account.id,
      actorType: "human",
      actorId: guard.me.id,
      actorLabel: guard.me.name,
      action: "account.procurement_status_updated",
      payload: { changes },
      payloadSummary: `${guard.me.name} updated procurement registration ${
        changes.status
          ? `status to ${String((changes.status as { to: unknown }).to).replace(/_/g, " ")}`
          : "notes"
      } on ${guard.account.brandName ?? guard.account.name}.`,
    });
  });
  // Task #732 — renewal reminders track the human-owned status in real time:
  // moving INTO renewal_due surfaces a Pane A reminder for the responsible
  // partner immediately (no waiting for the daily scan); moving OUT of
  // renewal_due/registered resolves any open reminders so stale nags vanish.
  // Fire-and-forget: reminder plumbing must never fail the status PATCH.
  if (changes.status) {
    void (async () => {
      try {
        if (next.status === "renewal_due") {
          await runProcurementRenewalScan({ accountId: guard.account.id });
        } else {
          await resolveProcurementRenewalPaneItems(guard.account.id);
        }
      } catch (err) {
        console.warn(
          `[atelier] procurement renewal reminder sync failed for ${guard.account.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    })();
  }
  res.json({ ok: true, procurement: next });
});

// ---------- edit insight (author only) ----------
// @cli-skip: pending Task #340 read-parity migration
router.patch("/accounts/:accountId/insights/:insightId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierAccountInsights)
    .where(
      and(
        eq(atelierAccountInsights.id, req.params.insightId),
        eq(atelierAccountInsights.accountId, account.id),
        isNull(atelierAccountInsights.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "insight-not-found" });
    return;
  }
  if (row.authorId !== me.id) {
    res.status(403).json({
      error: "not-author",
      reason: "Only the author can edit this insight.",
    });
    return;
  }
  const parsed = AtelierUpdateAccountInsightInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const patch: Partial<typeof atelierAccountInsights.$inferInsert> = {};
  if (parsed.data.body !== undefined) {
    const b = parsed.data.body.trim();
    if (!b) {
      res.status(400).json({ error: "body-required" });
      return;
    }
    patch.body = b;
  }
  if (parsed.data.category !== undefined) {
    patch.category = parsed.data.category ?? null;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no-op", reason: "No editable fields supplied." });
    return;
  }
  patch.updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccountInsights)
      .set(patch)
      .where(eq(atelierAccountInsights.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "insight.edited",
      payload: { insightId: row.id, fields: Object.keys(patch) },
      payloadSummary: `${me.name} edited an insight on ${
        account.brandName ?? account.name
      }.`,
    });
  });
  const ws = await buildWorkspace(account.id, access, me);
  res.json(ws);
});

// ---------- delete insight (author only, soft delete) ----------
// @cli-skip: pending Task #340 read-parity migration
router.delete("/accounts/:accountId/insights/:insightId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierAccountInsights)
    .where(
      and(
        eq(atelierAccountInsights.id, req.params.insightId),
        eq(atelierAccountInsights.accountId, account.id),
        isNull(atelierAccountInsights.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "insight-not-found" });
    return;
  }
  if (row.authorId !== me.id) {
    res.status(403).json({
      error: "not-author",
      reason: "Only the author can delete this insight.",
    });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccountInsights)
      .set({ deletedAt: new Date() })
      .where(eq(atelierAccountInsights.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "insight.deleted",
      payload: { insightId: row.id },
      payloadSummary: `${me.name} deleted an insight on ${
        account.brandName ?? account.name
      }.`,
    });
  });
  const ws = await buildWorkspace(account.id, access, me);
  res.json(ws);
});

// ---------- add team member (partner-only) ----------
// @cli-skip: pending Task #340 read-parity migration
router.post("/accounts/:accountId/team", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason: "Only Partner or Senior Manager personas can manage the account team.",
    });
    return;
  }
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const parsed = AtelierAddAccountTeamMemberInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const userId = parsed.data.userId.trim();
  const role = parsed.data.roleOnAccount;
  const [user] = await db
    .select()
    .from(atelierUsers)
    .where(
      and(
        eq(atelierUsers.id, userId),
        eq(atelierUsers.orgId, account.orgId),
        isNull(atelierUsers.deletedAt),
      ),
    );
  if (!user) {
    res.status(400).json({ error: "invalid-user", reason: "Unknown user." });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierAccountTeamMembers)
    .where(
      and(
        eq(atelierAccountTeamMembers.accountId, account.id),
        eq(atelierAccountTeamMembers.userId, userId),
        isNull(atelierAccountTeamMembers.deletedAt),
      ),
    );
  if (existing) {
    res.status(409).json({ error: "already-member", reason: "Already on the team." });
    return;
  }
  const id = rid("atm");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(atelierAccountTeamMembers).values({
      id,
      orgId: account.orgId,
      accountId: account.id,
      userId,
      roleOnAccount: role,
      createdByUserId: me.id,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "team.memberAdded",
      payload: { memberId: id, userId, roleOnAccount: role },
      payloadSummary: `${me.name} added ${user.name} to the ${
        account.brandName ?? account.name
      } account team as ${TEAM_ROLE_LABEL[role] ?? role}.`,
    });
  });
  const ws = await buildWorkspace(account.id, access, me);
  res.json(ws);
});

// ---------- update team member role (partner-only) ----------
// @cli-skip: pending Task #340 read-parity migration
router.patch("/accounts/:accountId/team/:memberId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason: "Only Partner or Senior Manager personas can manage the account team.",
    });
    return;
  }
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierAccountTeamMembers)
    .where(
      and(
        eq(atelierAccountTeamMembers.id, req.params.memberId),
        eq(atelierAccountTeamMembers.accountId, account.id),
        isNull(atelierAccountTeamMembers.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "member-not-found" });
    return;
  }
  const parsed = AtelierUpdateAccountTeamMemberInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const role = parsed.data.roleOnAccount;
  const [user] = await db
    .select({ name: atelierUsers.name })
    .from(atelierUsers)
    .where(eq(atelierUsers.id, row.userId));
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccountTeamMembers)
      .set({ roleOnAccount: role, updatedAt: new Date() })
      .where(eq(atelierAccountTeamMembers.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "team.roleChanged",
      payload: { memberId: row.id, userId: row.userId, roleOnAccount: role },
      payloadSummary: `${me.name} set ${user?.name ?? "a team member"}'s role to ${
        TEAM_ROLE_LABEL[role] ?? role
      } on ${account.brandName ?? account.name}.`,
    });
  });
  const ws = await buildWorkspace(account.id, access, me);
  res.json(ws);
});

// ---------- remove team member (partner-only, soft delete) ----------
// @cli-skip: pending Task #340 read-parity migration
router.delete("/accounts/:accountId/team/:memberId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason: "Only Partner or Senior Manager personas can manage the account team.",
    });
    return;
  }
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierAccountTeamMembers)
    .where(
      and(
        eq(atelierAccountTeamMembers.id, req.params.memberId),
        eq(atelierAccountTeamMembers.accountId, account.id),
        isNull(atelierAccountTeamMembers.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "member-not-found" });
    return;
  }
  const [user] = await db
    .select({ name: atelierUsers.name })
    .from(atelierUsers)
    .where(eq(atelierUsers.id, row.userId));
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccountTeamMembers)
      .set({ deletedAt: new Date() })
      .where(eq(atelierAccountTeamMembers.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "team.memberRemoved",
      payload: { memberId: row.id, userId: row.userId },
      payloadSummary: `${me.name} removed ${user?.name ?? "a team member"} from the ${
        account.brandName ?? account.name
      } account team.`,
    });
  });
  const ws = await buildWorkspace(account.id, access, me);
  res.json(ws);
});

// -------------------------------------------------------------------
// Account planning & execution layer (Task #571)
// -------------------------------------------------------------------
// Action plan, account risk register, and goal progress. Reads are
// embedded in the workspace (gated by canSeeAccount). Writes are gated
// to people who actively manage the account: partner-tier / senior
// manager (CREATE_ROLES), the account's partner owner, or a member of
// the account team whose role is account_manager / delivery_lead /
// partner. Every mutation is audited and returns the fresh workspace.
// -------------------------------------------------------------------
const PLAN_TEAM_ROLES = new Set(["account_manager", "delivery_lead", "partner"]);

async function canManageAccountPlan(
  me: { id: string; role: string },
  account: { id: string; partnerOwnerId: string | null },
): Promise<boolean> {
  if (CREATE_ROLES.has(me.role)) return true;
  if (account.partnerOwnerId === me.id) return true;
  const [member] = await db
    .select({ roleOnAccount: atelierAccountTeamMembers.roleOnAccount })
    .from(atelierAccountTeamMembers)
    .where(
      and(
        eq(atelierAccountTeamMembers.accountId, account.id),
        eq(atelierAccountTeamMembers.userId, me.id),
        isNull(atelierAccountTeamMembers.deletedAt),
      ),
    );
  return !!member && PLAN_TEAM_ROLES.has(member.roleOnAccount);
}

// Shared guard: load + access + manage permission. Returns the account row
// or null (after sending the appropriate error response).
async function loadManageableAccount(
  req: Request,
  res: Response,
): Promise<{ me: NonNullable<ReturnType<typeof ensurePersona>>; account: NonNullable<Awaited<ReturnType<typeof loadAccount>>>; access: EngAccess } | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const account = await loadAccount(String(req.params.accountId));
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return null;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return null;
  }
  if (!(await canManageAccountPlan(me, account))) {
    res.status(403).json({
      error: "plan-forbidden",
      reason:
        "Only the account team (partner-tier, the account owner, or an account manager / delivery lead) can manage the account plan.",
    });
    return null;
  }
  return { me, account, access };
}

// ---------- create action (account team only) ----------
// @cli-skip: pending Task #340 read-parity migration
router.post("/accounts/:accountId/actions", async (req, res) => {
  const ctx = await loadManageableAccount(req, res);
  if (!ctx) return;
  const { me, account, access } = ctx;
  const parsed = AtelierCreateAccountActionInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const title = parsed.data.title.trim();
  if (!title) {
    res.status(400).json({ error: "title-required" });
    return;
  }
  // Validate optional owner belongs to the org.
  if (parsed.data.ownerId) {
    const [owner] = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.id, parsed.data.ownerId),
          eq(atelierUsers.orgId, account.orgId),
          isNull(atelierUsers.deletedAt),
        ),
      );
    if (!owner) {
      res.status(400).json({ error: "invalid-owner", reason: "Unknown owner." });
      return;
    }
  }
  const id = rid("aca");
  const now = new Date();
  const status = parsed.data.status ?? "open";
  await db.transaction(async (tx) => {
    await tx.insert(atelierAccountActions).values({
      id,
      orgId: account.orgId,
      accountId: account.id,
      title,
      detail: parsed.data.detail?.trim() || null,
      ownerId: parsed.data.ownerId ?? null,
      status,
      priority: parsed.data.priority ?? "medium",
      dueDate: parsed.data.dueDate ?? null,
      linkedObjectiveId: parsed.data.linkedObjectiveId ?? null,
      linkedPlay: parsed.data.linkedPlay?.trim() || null,
      source: parsed.data.source ?? "manual",
      sourceRef: parsed.data.sourceRef ?? null,
      completedAt: status === "done" ? now : null,
      createdByUserId: me.id,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action:
        parsed.data.source === "promoted"
          ? "plan.actionPromoted"
          : "plan.actionCreated",
      payload: { actionId: id, source: parsed.data.source ?? "manual" },
      payloadSummary: `${me.name} ${
        parsed.data.source === "promoted" ? "promoted an AI suggestion into" : "added"
      } an action "${title}" on ${account.brandName ?? account.name}.`,
    });
  });
  res.json(await buildWorkspace(account.id, access, me));
});

// ---------- edit action (account team only) ----------
// @cli-skip: pending Task #340 read-parity migration
router.patch("/accounts/:accountId/actions/:actionId", async (req, res) => {
  const ctx = await loadManageableAccount(req, res);
  if (!ctx) return;
  const { me, account, access } = ctx;
  const [row] = await db
    .select()
    .from(atelierAccountActions)
    .where(
      and(
        eq(atelierAccountActions.id, req.params.actionId),
        eq(atelierAccountActions.accountId, account.id),
        isNull(atelierAccountActions.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "action-not-found" });
    return;
  }
  const parsed = AtelierUpdateAccountActionInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  if (d.ownerId) {
    const [owner] = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.id, d.ownerId),
          eq(atelierUsers.orgId, account.orgId),
          isNull(atelierUsers.deletedAt),
        ),
      );
    if (!owner) {
      res.status(400).json({ error: "invalid-owner", reason: "Unknown owner." });
      return;
    }
  }
  const patch: Partial<typeof atelierAccountActions.$inferInsert> = {};
  if (d.title !== undefined) {
    const t = d.title.trim();
    if (!t) {
      res.status(400).json({ error: "title-required" });
      return;
    }
    patch.title = t;
  }
  if (d.detail !== undefined) patch.detail = d.detail?.trim() || null;
  if (d.ownerId !== undefined) patch.ownerId = d.ownerId ?? null;
  if (d.priority !== undefined) patch.priority = d.priority;
  if (d.dueDate !== undefined) patch.dueDate = d.dueDate ?? null;
  if (d.linkedObjectiveId !== undefined)
    patch.linkedObjectiveId = d.linkedObjectiveId ?? null;
  if (d.linkedPlay !== undefined) patch.linkedPlay = d.linkedPlay?.trim() || null;
  if (d.status !== undefined) {
    patch.status = d.status;
    // Stamp / clear completion when the status crosses the done boundary.
    if (d.status === "done" && row.status !== "done") {
      patch.completedAt = new Date();
    } else if (d.status !== "done" && row.status === "done") {
      patch.completedAt = null;
    }
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no-op", reason: "No editable fields supplied." });
    return;
  }
  patch.updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccountActions)
      .set(patch)
      .where(eq(atelierAccountActions.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "plan.actionUpdated",
      payload: { actionId: row.id, fields: Object.keys(patch) },
      payloadSummary: `${me.name} updated an action on ${
        account.brandName ?? account.name
      }${d.status ? ` (status → ${d.status})` : ""}.`,
    });
  });
  res.json(await buildWorkspace(account.id, access, me));
});

// ---------- delete action (account team only, soft delete) ----------
// @cli-skip: pending Task #340 read-parity migration
router.delete("/accounts/:accountId/actions/:actionId", async (req, res) => {
  const ctx = await loadManageableAccount(req, res);
  if (!ctx) return;
  const { me, account, access } = ctx;
  const [row] = await db
    .select()
    .from(atelierAccountActions)
    .where(
      and(
        eq(atelierAccountActions.id, req.params.actionId),
        eq(atelierAccountActions.accountId, account.id),
        isNull(atelierAccountActions.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "action-not-found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccountActions)
      .set({ deletedAt: new Date() })
      .where(eq(atelierAccountActions.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "plan.actionDeleted",
      payload: { actionId: row.id },
      payloadSummary: `${me.name} deleted an action on ${
        account.brandName ?? account.name
      }.`,
    });
  });
  res.json(await buildWorkspace(account.id, access, me));
});

// ---------- create risk (account team only) ----------
// @cli-skip: pending Task #340 read-parity migration
router.post("/accounts/:accountId/risks", async (req, res) => {
  const ctx = await loadManageableAccount(req, res);
  if (!ctx) return;
  const { me, account, access } = ctx;
  const parsed = AtelierCreateAccountRiskInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const description = parsed.data.description.trim();
  if (!description) {
    res.status(400).json({ error: "description-required" });
    return;
  }
  if (parsed.data.ownerId) {
    const [owner] = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.id, parsed.data.ownerId),
          eq(atelierUsers.orgId, account.orgId),
          isNull(atelierUsers.deletedAt),
        ),
      );
    if (!owner) {
      res.status(400).json({ error: "invalid-owner", reason: "Unknown owner." });
      return;
    }
  }
  const id = rid("acr");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(atelierAccountRisks).values({
      id,
      orgId: account.orgId,
      accountId: account.id,
      kind: parsed.data.kind ?? "risk",
      severity: parsed.data.severity ?? "amber",
      ownerId: parsed.data.ownerId ?? null,
      status: parsed.data.status ?? "open",
      dueDate: parsed.data.dueDate ?? null,
      description,
      mitigation: parsed.data.mitigation?.trim() || null,
      createdByUserId: me.id,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "plan.riskCreated",
      payload: { riskId: id, severity: parsed.data.severity ?? "amber" },
      payloadSummary: `${me.name} logged a ${
        parsed.data.severity ?? "amber"
      } risk on ${account.brandName ?? account.name}.`,
    });
  });
  res.json(await buildWorkspace(account.id, access, me));
});

// ---------- edit risk (account team only) ----------
// @cli-skip: pending Task #340 read-parity migration
router.patch("/accounts/:accountId/risks/:riskId", async (req, res) => {
  const ctx = await loadManageableAccount(req, res);
  if (!ctx) return;
  const { me, account, access } = ctx;
  const [row] = await db
    .select()
    .from(atelierAccountRisks)
    .where(
      and(
        eq(atelierAccountRisks.id, req.params.riskId),
        eq(atelierAccountRisks.accountId, account.id),
        isNull(atelierAccountRisks.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "risk-not-found" });
    return;
  }
  const parsed = AtelierUpdateAccountRiskInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  if (d.ownerId) {
    const [owner] = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.id, d.ownerId),
          eq(atelierUsers.orgId, account.orgId),
          isNull(atelierUsers.deletedAt),
        ),
      );
    if (!owner) {
      res.status(400).json({ error: "invalid-owner", reason: "Unknown owner." });
      return;
    }
  }
  const patch: Partial<typeof atelierAccountRisks.$inferInsert> = {};
  if (d.description !== undefined) {
    const t = d.description.trim();
    if (!t) {
      res.status(400).json({ error: "description-required" });
      return;
    }
    patch.description = t;
  }
  if (d.kind !== undefined) patch.kind = d.kind;
  if (d.severity !== undefined) patch.severity = d.severity;
  if (d.ownerId !== undefined) patch.ownerId = d.ownerId ?? null;
  if (d.status !== undefined) patch.status = d.status;
  if (d.dueDate !== undefined) patch.dueDate = d.dueDate ?? null;
  if (d.mitigation !== undefined) patch.mitigation = d.mitigation?.trim() || null;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no-op", reason: "No editable fields supplied." });
    return;
  }
  patch.updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccountRisks)
      .set(patch)
      .where(eq(atelierAccountRisks.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "plan.riskUpdated",
      payload: { riskId: row.id, fields: Object.keys(patch) },
      payloadSummary: `${me.name} updated a risk on ${
        account.brandName ?? account.name
      }${d.status ? ` (status → ${d.status})` : ""}.`,
    });
  });
  res.json(await buildWorkspace(account.id, access, me));
});

// ---------- delete risk (account team only, soft delete) ----------
// @cli-skip: pending Task #340 read-parity migration
router.delete("/accounts/:accountId/risks/:riskId", async (req, res) => {
  const ctx = await loadManageableAccount(req, res);
  if (!ctx) return;
  const { me, account, access } = ctx;
  const [row] = await db
    .select()
    .from(atelierAccountRisks)
    .where(
      and(
        eq(atelierAccountRisks.id, req.params.riskId),
        eq(atelierAccountRisks.accountId, account.id),
        isNull(atelierAccountRisks.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "risk-not-found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccountRisks)
      .set({ deletedAt: new Date() })
      .where(eq(atelierAccountRisks.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "plan.riskDeleted",
      payload: { riskId: row.id },
      payloadSummary: `${me.name} deleted a risk on ${
        account.brandName ?? account.name
      }.`,
    });
  });
  res.json(await buildWorkspace(account.id, access, me));
});

// ---------- upsert goal progress for a strategy objective ----------
// PUT semantics: creates the progress row for the objective if absent, else
// updates it. The objectiveId must reference an existing strategy objective.
// @cli-skip: pending Task #340 read-parity migration
router.put("/accounts/:accountId/goals/:objectiveId", async (req, res) => {
  const ctx = await loadManageableAccount(req, res);
  if (!ctx) return;
  const { me, account, access } = ctx;
  const objectiveId = req.params.objectiveId;
  const objectives = (account.accountStrategy?.objectives ?? []) as Array<{
    id: string;
    text: string;
  }>;
  const objective = objectives.find((o) => o.id === objectiveId);
  if (!objective) {
    res.status(404).json({
      error: "objective-not-found",
      reason: "No strategy objective with that id on this account.",
    });
    return;
  }
  const parsed = AtelierUpsertAccountGoalProgressInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  const [existing] = await db
    .select()
    .from(atelierAccountGoalProgress)
    .where(
      and(
        eq(atelierAccountGoalProgress.accountId, account.id),
        eq(atelierAccountGoalProgress.objectiveId, objectiveId),
        isNull(atelierAccountGoalProgress.deletedAt),
      ),
    );
  const now = new Date();
  await db.transaction(async (tx) => {
    if (existing) {
      const patch: Partial<typeof atelierAccountGoalProgress.$inferInsert> = {
        updatedAt: now,
      };
      if (d.currentValue !== undefined)
        patch.currentValue = d.currentValue?.trim() || null;
      if (d.status !== undefined) patch.status = d.status;
      if (d.note !== undefined) patch.note = d.note?.trim() || null;
      await tx
        .update(atelierAccountGoalProgress)
        .set(patch)
        .where(eq(atelierAccountGoalProgress.id, existing.id));
    } else {
      await tx.insert(atelierAccountGoalProgress).values({
        id: rid("acg"),
        orgId: account.orgId,
        accountId: account.id,
        objectiveId,
        currentValue: d.currentValue?.trim() || null,
        status: d.status ?? "on_track",
        note: d.note?.trim() || null,
        createdByUserId: me.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "plan.goalProgressUpdated",
      payload: { objectiveId, status: d.status ?? existing?.status ?? "on_track" },
      payloadSummary: `${me.name} updated goal progress on ${
        account.brandName ?? account.name
      }${d.status ? ` (${d.status})` : ""}.`,
    });
  });
  res.json(await buildWorkspace(account.id, access, me));
});

// -------------------------------------------------------------------
// Activities & Tasks (Task #631)
// -------------------------------------------------------------------
// A first-class, polymorphic activity/task layer plus a unified, merged
// timeline read model (activities + insights + meetings + stage moves +
// agent runs). Reads + creates are gated by canSeeAccount (anyone actively
// working the account can log activity / create a task). Editing, completing
// or deleting a row requires being the row's owner (assignee) or creator, or
// holding account-plan management authority. Every mutation is audited and
// returns the refreshed timeline payload.
// -------------------------------------------------------------------
const ACTIVITY_TYPES = new Set(["task", "call", "email", "meeting"]);

async function timelinePayload(
  account: { id: string; name: string; brandName: string | null },
  canManage: boolean,
) {
  const t = await buildAccountTimeline({
    accountId: account.id,
    accountName: account.brandName ?? account.name,
  });
  return { ...t, canManage };
}

// Validate a polymorphic parent belongs to this account; returns the parent
// type/id pair to persist, or null (after sending an error response).
async function resolveActivityParent(
  res: Response,
  account: { id: string },
  parentType: string | undefined,
  parentId: string | null | undefined,
): Promise<{ parentType: "account" | "contact" | "opportunity"; parentId: string } | null> {
  const pt = parentType ?? "account";
  if (pt === "account") {
    return { parentType: "account", parentId: account.id };
  }
  if (!parentId) {
    res.status(400).json({ error: "parent-required", reason: `${pt} parentId is required.` });
    return null;
  }
  if (pt === "contact") {
    const [c] = await db
      .select({ id: atelierContacts.id })
      .from(atelierContacts)
      .where(
        and(
          eq(atelierContacts.id, parentId),
          eq(atelierContacts.accountId, account.id),
          isNull(atelierContacts.deletedAt),
        ),
      );
    if (!c) {
      res.status(400).json({ error: "invalid-parent", reason: "Contact not on this account." });
      return null;
    }
    return { parentType: "contact", parentId };
  }
  if (pt === "opportunity") {
    const [o] = await db
      .select({ id: atelierOpportunities.id })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.id, parentId),
          eq(atelierOpportunities.accountId, account.id),
          isNull(atelierOpportunities.deletedAt),
        ),
      );
    if (!o) {
      res.status(400).json({ error: "invalid-parent", reason: "Opportunity not on this account." });
      return null;
    }
    return { parentType: "opportunity", parentId };
  }
  res.status(400).json({ error: "invalid-parent-type" });
  return null;
}

// ---------- read unified timeline + open-task roll-up ----------
// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts/:accountId/timeline", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const canManage = await canManageAccountPlan(me, account);
  res.json(await timelinePayload(account, canManage));
});

// ---------- pre-meeting client briefing (Task #337) ----------
// Deterministic brief assembled for a calendar meeting matched to this
// account: recent activity (unified timeline), open (non-terminal)
// opportunities, and outstanding tasks/actions. Read-only, gated on the same
// canSeeAccount predicate as the calendar match itself, so anyone who can
// see the meeting chip can open the brief.
// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts/:accountId/meeting-brief", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const TERMINAL_OPP_STAGES = new Set(["contract", "lost", "no_decision", "withdrawn"]);
  const [timeline, oppRows, actionRows] = await Promise.all([
    buildAccountTimeline({ accountId: account.id }),
    db
      .select({
        id: atelierOpportunities.id,
        name: atelierOpportunities.name,
        salesStage: atelierOpportunities.salesStage,
        subStatus: atelierOpportunities.subStatus,
        dealSizeHypothesis: atelierOpportunities.dealSizeHypothesis,
        probabilityPct: atelierOpportunities.probabilityPct,
      })
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.accountId, account.id),
          isNull(atelierOpportunities.deletedAt),
        ),
      )
      .orderBy(desc(atelierOpportunities.dealSizeHypothesis)),
    db
      .select()
      .from(atelierAccountActions)
      .where(
        and(
          eq(atelierAccountActions.accountId, account.id),
          inArray(atelierAccountActions.status, ["open", "in_progress"]),
          isNull(atelierAccountActions.deletedAt),
        ),
      )
      .orderBy(desc(atelierAccountActions.createdAt)),
  ]);
  // Resolve action owner names in one pass.
  const ownerIds = [...new Set(actionRows.map((a) => a.ownerId).filter((x): x is string => !!x))];
  const owners = ownerIds.length
    ? await db
        .select({ id: atelierUsers.id, name: atelierUsers.name })
        .from(atelierUsers)
        .where(inArray(atelierUsers.id, ownerIds))
    : [];
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  res.json({
    accountId: account.id,
    accountName: account.brandName ?? account.name,
    generatedAt: new Date().toISOString(),
    recentActivity: timeline.timeline.slice(0, 8),
    openOpportunities: oppRows.filter((o) => !TERMINAL_OPP_STAGES.has(o.salesStage)),
    openTasks: timeline.openTasks.slice(0, 8),
    openActions: actionRows.slice(0, 8).map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      priority: a.priority,
      dueDate: a.dueDate ?? null,
      ownerName: a.ownerId ? (ownerName.get(a.ownerId) ?? null) : null,
      overdue: isOverdue(a.status, a.dueDate),
    })),
  });
});

// ---------- create activity / task (any persona who can see the account) ----
// @cli-skip: pending Task #340 read-parity migration
router.post("/accounts/:accountId/activities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const parsed = AtelierCreateActivityInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const title = parsed.data.title.trim();
  if (!title) {
    res.status(400).json({ error: "title-required" });
    return;
  }
  const type = parsed.data.type ?? "task";
  if (!ACTIVITY_TYPES.has(type)) {
    res.status(400).json({ error: "invalid-type" });
    return;
  }
  const parent = await resolveActivityParent(
    res,
    account,
    parsed.data.parentType,
    parsed.data.parentId,
  );
  if (!parent) return;
  // Validate optional owner belongs to the org.
  if (parsed.data.ownerId) {
    const [owner] = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.id, parsed.data.ownerId),
          eq(atelierUsers.orgId, account.orgId),
          isNull(atelierUsers.deletedAt),
        ),
      );
    if (!owner) {
      res.status(400).json({ error: "invalid-owner", reason: "Unknown owner." });
      return;
    }
  }
  const id = rid("act");
  const now = new Date();
  const status = parsed.data.status ?? "open";
  await db.transaction(async (tx) => {
    await tx.insert(atelierActivities).values({
      id,
      orgId: account.orgId,
      accountId: account.id,
      parentType: parent.parentType,
      parentId: parent.parentId,
      type,
      title,
      body: parsed.data.body?.trim() || null,
      ownerId: parsed.data.ownerId ?? null,
      dueDate: parsed.data.dueDate ?? null,
      status,
      completedAt: status === "done" ? now : null,
      createdByUserId: me.id,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "activity.created",
      payload: { activityId: id, type, parentType: parent.parentType, parentId: parent.parentId },
      payloadSummary: `${me.name} logged a ${type} "${title}" on ${
        account.brandName ?? account.name
      }.`,
    });
  });
  const canManage = await canManageAccountPlan(me, account);
  res.json(await timelinePayload(account, canManage));
});

// Shared gate for activity mutation: owner (assignee), creator, or someone
// with account-plan management authority.
async function canMutateActivity(
  me: { id: string; role: string },
  account: { id: string; partnerOwnerId: string | null },
  activity: { ownerId: string | null; createdByUserId: string | null },
): Promise<boolean> {
  if (activity.ownerId === me.id) return true;
  if (activity.createdByUserId === me.id) return true;
  return canManageAccountPlan(me, account);
}

// ---------- edit / complete activity ----------
// @cli-skip: pending Task #340 read-parity migration
router.patch("/accounts/:accountId/activities/:activityId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierActivities)
    .where(
      and(
        eq(atelierActivities.id, req.params.activityId),
        eq(atelierActivities.accountId, account.id),
        isNull(atelierActivities.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "activity-not-found" });
    return;
  }
  if (!(await canMutateActivity(me, account, row))) {
    res.status(403).json({
      error: "activity-forbidden",
      reason: "Only the task owner, its creator, or the account team can change it.",
    });
    return;
  }
  const parsed = AtelierUpdateActivityInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const d = parsed.data;
  const patch: Partial<typeof atelierActivities.$inferInsert> = {};
  if (d.title !== undefined) {
    const t = d.title.trim();
    if (!t) {
      res.status(400).json({ error: "title-required" });
      return;
    }
    patch.title = t;
  }
  if (d.type !== undefined) {
    if (!ACTIVITY_TYPES.has(d.type)) {
      res.status(400).json({ error: "invalid-type" });
      return;
    }
    patch.type = d.type;
  }
  if (d.body !== undefined) patch.body = d.body?.trim() || null;
  if (d.dueDate !== undefined) patch.dueDate = d.dueDate ?? null;
  if (d.ownerId !== undefined) {
    if (d.ownerId) {
      const [owner] = await db
        .select({ id: atelierUsers.id })
        .from(atelierUsers)
        .where(
          and(
            eq(atelierUsers.id, d.ownerId),
            eq(atelierUsers.orgId, account.orgId),
            isNull(atelierUsers.deletedAt),
          ),
        );
      if (!owner) {
        res.status(400).json({ error: "invalid-owner", reason: "Unknown owner." });
        return;
      }
    }
    patch.ownerId = d.ownerId ?? null;
  }
  const now = new Date();
  if (d.status !== undefined) {
    if (d.status !== "open" && d.status !== "done") {
      res.status(400).json({ error: "invalid-status" });
      return;
    }
    patch.status = d.status;
    patch.completedAt = d.status === "done" ? row.completedAt ?? now : null;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no-op", reason: "No editable fields supplied." });
    return;
  }
  patch.updatedAt = now;
  await db.transaction(async (tx) => {
    await tx.update(atelierActivities).set(patch).where(eq(atelierActivities.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: d.status === "done" ? "activity.completed" : "activity.edited",
      payload: { activityId: row.id, fields: Object.keys(patch) },
      payloadSummary:
        d.status === "done"
          ? `${me.name} completed "${patch.title ?? row.title}" on ${
              account.brandName ?? account.name
            }.`
          : `${me.name} updated an activity on ${account.brandName ?? account.name}.`,
    });
  });
  const canManage = await canManageAccountPlan(me, account);
  res.json(await timelinePayload(account, canManage));
});

// ---------- delete activity (soft delete) ----------
// @cli-skip: pending Task #340 read-parity migration
router.delete("/accounts/:accountId/activities/:activityId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const [row] = await db
    .select()
    .from(atelierActivities)
    .where(
      and(
        eq(atelierActivities.id, req.params.activityId),
        eq(atelierActivities.accountId, account.id),
        isNull(atelierActivities.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "activity-not-found" });
    return;
  }
  if (!(await canMutateActivity(me, account, row))) {
    res.status(403).json({
      error: "activity-forbidden",
      reason: "Only the task owner, its creator, or the account team can delete it.",
    });
    return;
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(atelierActivities)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(atelierActivities.id, row.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      orgId: account.orgId,
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "activity.deleted",
      payload: { activityId: row.id, type: row.type },
      payloadSummary: `${me.name} deleted a ${row.type} on ${
        account.brandName ?? account.name
      }.`,
    });
  });
  const canManage = await canManageAccountPlan(me, account);
  res.json(await timelinePayload(account, canManage));
});

// ---------- my open work (cross-surface roll-up, overdue-flagged) ----------
// Task #940 — consolidates everything open and assigned to the signed-in
// user: account activity tasks, account plan actions, and engagement RAID
// items. Each item is kind-labelled and deep-links to its parent surface.
// @cli-skip: pending Task #340 read-parity migration
router.get("/my-open-tasks", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [activityRows, actionRows, raidRows, personalRows] = await Promise.all([
    db
      .select()
      .from(atelierActivities)
      .where(
        and(
          eq(atelierActivities.ownerId, me.id),
          eq(atelierActivities.status, "open"),
          isNull(atelierActivities.deletedAt),
        ),
      )
      .orderBy(desc(atelierActivities.createdAt)),
    db
      .select()
      .from(atelierAccountActions)
      .where(
        and(
          eq(atelierAccountActions.orgId, me.orgId),
          eq(atelierAccountActions.ownerId, me.id),
          inArray(atelierAccountActions.status, ["open", "in_progress"]),
          isNull(atelierAccountActions.deletedAt),
        ),
      )
      .orderBy(desc(atelierAccountActions.createdAt)),
    db
      .select({
        raid: atelierRaidItems,
        engagementName: atelierEngagements.name,
        engagementAccountId: atelierEngagements.accountId,
      })
      .from(atelierRaidItems)
      .innerJoin(
        atelierEngagements,
        and(
          eq(atelierEngagements.id, atelierRaidItems.engagementId),
          isNull(atelierEngagements.deletedAt),
        ),
      )
      .where(
        and(
          eq(atelierRaidItems.orgId, me.orgId),
          eq(atelierRaidItems.ownerId, me.id),
          eq(atelierRaidItems.status, "open"),
          isNull(atelierRaidItems.deletedAt),
        ),
      )
      .orderBy(desc(atelierRaidItems.createdAt)),
    // Task #1002 — personal tasks/reminders (strictly own rows).
    db
      .select()
      .from(atelierPersonalTasks)
      .where(
        and(
          eq(atelierPersonalTasks.orgId, me.orgId),
          eq(atelierPersonalTasks.userId, me.id),
          eq(atelierPersonalTasks.status, "open"),
          isNull(atelierPersonalTasks.deletedAt),
          // Task #1011 — declined handed-over tasks drop out of the roll-up.
          notDeclinedAssignment(),
        ),
      )
      .orderBy(desc(atelierPersonalTasks.createdAt)),
  ]);
  // Resolve the account names for all referenced accounts in one query.
  const accountIds = Array.from(
    new Set(
      [
        ...activityRows.map((r) => r.accountId),
        ...actionRows.map((r) => r.accountId),
        ...raidRows.map((r) => r.engagementAccountId),
      ].filter((id): id is string => !!id),
    ),
  );
  const accts = accountIds.length
    ? await db
        .select({
          id: atelierAccounts.id,
          name: atelierAccounts.name,
          brandName: atelierAccounts.brandName,
        })
        .from(atelierAccounts)
        .where(inArray(atelierAccounts.id, accountIds))
    : [];
  const acctName = (id: string | null) => {
    if (!id) return null;
    const a = accts.find((x) => x.id === id);
    return a ? a.brandName ?? a.name : null;
  };
  interface MyWorkItemWire {
    id: string;
    kind: "activity" | "plan_action" | "raid" | "personal";
    type: string | null;
    title: string;
    dueDate: string | null;
    overdue: boolean;
    accountId: string | null;
    accountName: string | null;
    engagementId: string | null;
    engagementName: string | null;
    href: string;
    createdAt: string;
  }
  const items: MyWorkItemWire[] = [
    ...activityRows.map(
      (r): MyWorkItemWire => ({
        id: r.id,
        kind: "activity",
        type: r.type ?? "task",
        title: r.title,
        dueDate: r.dueDate ?? null,
        overdue: isOverdue("open", r.dueDate),
        accountId: r.accountId,
        accountName: acctName(r.accountId),
        engagementId: null,
        engagementName: null,
        href: `/accounts/${r.accountId}`,
        createdAt: new Date(r.createdAt).toISOString(),
      }),
    ),
    ...actionRows.map(
      (r): MyWorkItemWire => ({
        id: r.id,
        kind: "plan_action",
        type: null,
        title: r.title,
        dueDate: r.dueDate ?? null,
        // Plan actions stay non-done in "in_progress" too; isOverdue only
        // fires for "open", so normalise both to open for the check.
        overdue: isOverdue("open", r.dueDate),
        accountId: r.accountId,
        accountName: acctName(r.accountId),
        engagementId: null,
        engagementName: null,
        href: `/accounts/${r.accountId}?tab=account_plan`,
        createdAt: new Date(r.createdAt).toISOString(),
      }),
    ),
    ...raidRows.map(
      ({ raid: r, engagementName, engagementAccountId }): MyWorkItemWire => ({
        id: r.id,
        kind: "raid",
        type: r.kind,
        title: r.description,
        dueDate: r.dueDate ?? null,
        overdue: isOverdue("open", r.dueDate),
        accountId: engagementAccountId ?? null,
        accountName: acctName(engagementAccountId ?? null),
        engagementId: r.engagementId,
        engagementName,
        href: `/engagements/${r.engagementId}`,
        createdAt: new Date(r.createdAt).toISOString(),
      }),
    ),
    ...personalRows.map(
      (r): MyWorkItemWire => ({
        id: r.id,
        kind: "personal",
        type: "task",
        title: r.title,
        // Roll-up rows carry date-only strings; render the due DATE and
        // let the Me Tasks panel show the exact time.
        dueDate: r.dueAt ? r.dueAt.toISOString().slice(0, 10) : null,
        overdue: !!r.dueAt && r.dueAt.getTime() < Date.now(),
        accountId: null,
        accountName: null,
        engagementId: null,
        engagementName: null,
        href: "/me/tasks",
        createdAt: new Date(r.createdAt).toISOString(),
      }),
    ),
  ].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const ad = a.dueDate ?? "9999-12-31";
    const bd = b.dueDate ?? "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return b.createdAt.localeCompare(a.createdAt);
  });
  res.json({
    items,
    openCount: items.length,
    overdueCount: items.filter((t) => t.overdue).length,
  });
});

// ---------- update partner-editable account fields (Task #566) ----------
// PATCH semantics: only the keys present in the body are written. Gated to
// the same partner-tier + senior_manager personas that can create accounts.
// @cli-skip: pending Task #340 read-parity migration
router.patch("/accounts/:accountId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason: "Only Partner or Senior Manager personas can edit account strategy.",
    });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const a = await loadAccount(req.params.accountId);
  if (!a) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const parsed = AtelierUpdateAccountInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", reason: parsed.error.message });
    return;
  }
  const input = parsed.data;

  const update: Partial<typeof atelierAccounts.$inferInsert> = { updatedAt: new Date() };
  const changed: string[] = [];

  if ("notes" in input) {
    update.notes = input.notes ?? null;
    changed.push("notes");
  }
  if ("parentAccountId" in input) {
    const nextParent = input.parentAccountId ?? null;
    // Guard: an account cannot be its own parent.
    if (nextParent && nextParent === a.id) {
      res.status(400).json({ error: "invalid-parent", reason: "An account cannot be its own parent." });
      return;
    }
    if (nextParent) {
      const parent = await loadAccount(nextParent);
      if (!parent) {
        res.status(400).json({ error: "invalid-parent", reason: "Parent account not found." });
        return;
      }
      // Authz: the parent must live in the same org and be visible to the
      // caller. Without this, an editor could link to (and then read back
      // via the workspace `parent` ref) an out-of-scope or cross-tenant
      // account they are not allowed to see.
      if (parent.orgId !== a.orgId || !(await canSeeAccount(access, me, parent.id))) {
        res
          .status(403)
          .json({ error: "invalid-parent", reason: "You cannot link to that parent account." });
        return;
      }
      // Guard: prevent cycles of any length by walking the prospective
      // parent's ancestor chain — if we reach `a.id`, linking would create a
      // loop. (depth-bounded against any pre-existing corrupt data.)
      let cursor: string | null = parent.id;
      const seen = new Set<string>();
      for (let i = 0; cursor && i < 64; i++) {
        if (cursor === a.id) {
          res.status(400).json({
            error: "invalid-parent",
            reason: "That would create a circular hierarchy.",
          });
          return;
        }
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const ancestor = await loadAccount(cursor);
        cursor = ancestor?.parentAccountId ?? null;
      }
    }
    update.parentAccountId = nextParent;
    changed.push("parentAccountId");
  }
  // Task #699 — free-text partner guidance steering the account strategy.
  if ("strategyGuidance" in input) {
    update.strategyGuidance = input.strategyGuidance?.trim() || null;
    changed.push("strategyGuidance");
  }
  if ("accountStrategy" in input) {
    // Stamp ids on any objective that arrived without one so the UI can key
    // rows deterministically.
    const strat = input.accountStrategy;
    update.accountStrategy = strat
      ? {
          objectives: (strat.objectives ?? []).map((o) => ({
            id: o.id || rid("obj"),
            text: o.text,
            targetValue: o.targetValue ?? null,
            targetDate: o.targetDate ?? null,
          })),
          targetServiceLines: strat.targetServiceLines ?? [],
          winHypothesis: strat.winHypothesis ?? "",
          keyPlays: strat.keyPlays ?? [],
        }
      : null;
    changed.push("accountStrategy");
  }
  if ("competitors" in input) {
    update.competitors = (input.competitors ?? []).map((c) => ({
      id: c.id || rid("cmp"),
      name: c.name,
      holds: c.holds ?? null,
      displacementAngle: c.displacementAngle ?? null,
    }));
    changed.push("competitors");
  }
  // Task #617 — per-field before/after for firmographic edits, recorded in the
  // audit payload so the Company Details card can surface "who changed what,
  // when" and offer a one-click revert. Only fields that ACTUALLY changed are
  // recorded (the edit dialog always resends every field, so a deep-equal guard
  // keeps the history free of no-op rows). `before` is the value as currently
  // stored on the account; `after` is the cleaned value being written.
  const firmoChanges: Array<{ field: string; label: string; before: unknown; after: unknown }> = [];
  const recordFirmoChange = (field: string, before: unknown, after: unknown) => {
    if (firmoValuesEqual(before, after)) return;
    firmoChanges.push({ field, label: FIRMOGRAPHIC_FIELD_LABELS[field] ?? field, before, after });
  };

  // Task #608 — firmographic enrichment, partner-editable after create. Each
  // key is written only when present (PATCH semantics) and is coerced/cleaned
  // exactly like the create flow so values stay within server caps and figures
  // are never fabricated (null/empty inputs persist as null/empty).
  if ("employeeCount" in input) {
    update.employeeCount = input.employeeCount ?? null;
    changed.push("employeeCount");
    recordFirmoChange("employeeCount", a.employeeCount ?? null, update.employeeCount);
  }
  if ("annualRevenue" in input) {
    // Task #613 — annual revenue is a money surface, so editing it honours the
    // SAME account-financials gate as viewing it (account-wide authority and not
    // a restricted / board persona). Mirrors summariseAccount's canSeeFinancials
    // so a persona who cannot see the figure can never silently overwrite it.
    const accountWide = access.all || a.partnerOwnerId === me.id;
    const canEditFinancials =
      accountWide &&
      !isRestrictedPersona(me.role ?? null) &&
      !isBoardObserver(me.role ?? null);
    if (!canEditFinancials) {
      res.status(403).json({
        error: "financials-forbidden",
        reason:
          "Only personas with account-wide financial authority can edit annual revenue.",
      });
      return;
    }
    update.annualRevenue = input.annualRevenue ?? null;
    changed.push("annualRevenue");
    recordFirmoChange("annualRevenue", a.annualRevenue ?? null, update.annualRevenue);
  }
  if ("holdingStructure" in input) {
    update.holdingStructure = input.holdingStructure ?? null;
    changed.push("holdingStructure");
    recordFirmoChange("holdingStructure", a.holdingStructure ?? null, update.holdingStructure);
  }
  if ("countryPresence" in input) {
    update.countryPresence = input.countryPresence ?? [];
    changed.push("countryPresence");
    recordFirmoChange("countryPresence", a.countryPresence ?? [], update.countryPresence);
  }
  if ("entityRole" in input) {
    update.entityRole = input.entityRole ?? null;
    changed.push("entityRole");
    recordFirmoChange("entityRole", a.entityRole ?? null, update.entityRole);
  }

  // Task #698 — ownership fields, editable post-create by the same partner-tier
  // personas that can create accounts. partnerOwnerId is validated against a
  // real partner-tier user in the caller's org (never a free-form id); each
  // change is captured with before/after in the audit payload.
  // Archived accounts are frozen: the archive/restore lifecycle routes are the
  // only way in or out of that state, so ownership edits (including status,
  // which would otherwise silently "restore" the account) are rejected.
  const ownershipKeys = [
    "partnerOwnerId",
    "tier",
    "status",
    "hqCity",
    "primaryCurrency",
    "primaryLanguage",
  ] as const;
  if (a.status === "archived" && ownershipKeys.some((k) => k in input)) {
    res.status(409).json({
      error: "account-archived",
      reason: "This account is archived. Restore it before editing ownership fields.",
    });
    return;
  }
  if ("partnerOwnerId" in input) {
    const nextOwner = input.partnerOwnerId ?? null;
    if (nextOwner) {
      const [owner] = await db
        .select({ id: atelierUsers.id, role: atelierUsers.role })
        .from(atelierUsers)
        .where(and(eq(atelierUsers.id, nextOwner), eq(atelierUsers.orgId, a.orgId)));
      if (!owner || (owner.role !== "partner" && owner.role !== "founding_partner")) {
        res.status(400).json({
          error: "invalid-partner-owner",
          reason: "Partner owner must be a partner-tier user in your organisation.",
        });
        return;
      }
    }
    update.partnerOwnerId = nextOwner;
    changed.push("partnerOwnerId");
    recordFirmoChange("partnerOwnerId", a.partnerOwnerId ?? null, nextOwner);
  }
  if ("tier" in input && input.tier) {
    update.tier = input.tier;
    changed.push("tier");
    recordFirmoChange("tier", a.tier ?? null, input.tier);
  }
  if ("status" in input && input.status) {
    // "archived" is deliberately NOT accepted here — archiving is a lifecycle
    // action with its own cascade + audit semantics (POST /archive).
    update.status = input.status;
    changed.push("status");
    recordFirmoChange("status", a.status ?? null, input.status);
  }
  if ("hqCity" in input) {
    update.hqCity = input.hqCity?.trim() || null;
    changed.push("hqCity");
    recordFirmoChange("hqCity", a.hqCity ?? null, update.hqCity);
  }
  if ("primaryCurrency" in input && input.primaryCurrency) {
    update.primaryCurrency = input.primaryCurrency.toUpperCase();
    changed.push("primaryCurrency");
    recordFirmoChange("primaryCurrency", a.primaryCurrency ?? null, update.primaryCurrency);
  }
  if ("primaryLanguage" in input && input.primaryLanguage) {
    update.primaryLanguage = input.primaryLanguage;
    changed.push("primaryLanguage");
    recordFirmoChange("primaryLanguage", a.primaryLanguage ?? null, input.primaryLanguage);
  }

  if (changed.length === 0) {
    res.status(400).json({ error: "empty-update", reason: "No editable fields supplied." });
    return;
  }

  await db.update(atelierAccounts).set(update).where(eq(atelierAccounts.id, a.id));
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "account",
    entityId: a.id,
    actorType: "user",
    actorId: me.id,
    actorLabel: me.name,
    action: "account.update",
    payload: { fields: changed, changes: firmoChanges },
    payloadSummary: `${me.name} updated ${changed.join(", ")} on ${a.name}.`,
  });

  // Task #699 — keep the strategy-exemplar index in sync so future Strategy
  // Developer drafts on other accounts learn from this edit. Fire-and-forget:
  // indexing failure never breaks the write.
  if (changed.includes("accountStrategy")) {
    void indexAccountStrategyExemplar(a.id);
  }

  const ws = await buildWorkspace(a.id, access, me);
  res.json(ws);
});

// ---------- archive / restore / permanent delete (Task #627) ----------
// Reversible archive is the partner-tier default. Permanent delete is the
// restricted destructive path (founding partner only, financial-gated).
const ARCHIVE_ROLES = new Set(["founding_partner", "partner"]);

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/accounts/:accountId/archive", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ARCHIVE_ROLES.has(me.role)) {
    res.status(403).json({ error: "partner-only", reason: "Only partners can archive accounts." });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const result = await archiveAccount(
    { id: me.id, name: me.name, orgId: me.orgId },
    req.params.accountId,
  );
  if (result.status === "not_found") {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const ws = await buildWorkspace(req.params.accountId, access, me);
  res.json({ ok: true, status: result.status, workspace: ws });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/accounts/:accountId/restore", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ARCHIVE_ROLES.has(me.role)) {
    res.status(403).json({ error: "partner-only", reason: "Only partners can restore accounts." });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const result = await restoreAccount(
    { id: me.id, name: me.name, orgId: me.orgId },
    req.params.accountId,
  );
  if (result.status === "not_found") {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const ws = await buildWorkspace(req.params.accountId, access, me);
  res.json({ ok: true, status: result.status, workspace: ws });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.delete("/accounts/:accountId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // True hard-delete is reserved for the founding partner.
  if (!isFoundingPartner(me.role)) {
    res.status(403).json({
      error: "founding-partner-only",
      reason: "Only the founding partner can permanently delete an account. Archive it instead.",
    });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const override =
    req.query.override === "true" ||
    (req.body && (req.body as { override?: unknown }).override === true);
  const result = await permanentlyDeleteAccount(
    { id: me.id, name: me.name, orgId: me.orgId },
    req.params.accountId,
    { override },
  );
  if (result.status === "not_found") {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (result.status === "blocked") {
    res.status(409).json({
      error: "financial-records-exist",
      reason:
        `This account has ${result.financial.invoices} invoice(s) and ` +
        `${result.financial.timesheets} timesheet entr(y/ies). Archive it, or retry with override.`,
      financial: result.financial,
    });
    return;
  }
  res.json({ ok: true, status: result.status });
});

// ---------- merge (Task #640) ----------
// Consolidate a duplicate account INTO this (survivor) account. Re-points every
// child row to the survivor and soft-deletes the duplicate. Gated by the same
// roles + visibility as editing an account (CREATE_ROLES + canSeeAccount on
// BOTH the survivor and the duplicate so a scoped editor can't fold in an
// account they cannot otherwise see).
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/accounts/:accountId/merge", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason: "Only Partner or Senior Manager personas can merge accounts.",
    });
    return;
  }
  const parsed = AtelierMergeAccountsInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const duplicateAccountId = parsed.data.duplicateAccountId;
  if (duplicateAccountId === req.params.accountId) {
    res.status(400).json({ error: "same-record", reason: "Cannot merge an account into itself." });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (
    !(await canSeeAccount(access, me, req.params.accountId)) ||
    !(await canSeeAccount(access, me, duplicateAccountId))
  ) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const result = await mergeAccounts(
    { id: me.id, name: me.name, orgId: me.orgId },
    req.params.accountId,
    duplicateAccountId,
  );
  if (result.status === "not_found") {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (result.status === "same_record") {
    res.status(400).json({ error: "same-record", reason: "Cannot merge an account into itself." });
    return;
  }
  const ws = await buildWorkspace(req.params.accountId, access, me);
  res.json({
    ok: true,
    status: result.status,
    counts: "counts" in result ? result.counts : {},
    workspace: ws,
  });
});

// ---------- cartographer refresh ----------
// @cli-skip: pending Task #340 read-parity migration
router.post("/accounts/:accountId/cartographer/refresh", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const a = await loadAccount(req.params.accountId);
  if (!a) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const parsed = AtelierCartographerRefreshInput.safeParse(req.body ?? {});
  const focusOpportunityId = parsed.success ? (parsed.data.focusOpportunityId ?? null) : null;

  // Task #201 — never stack a second refresh on an account that already has
  // one running (double-click, auto-run overlap).
  const { status: cartStatus } = await loadCartographerStatus(a.id);
  if (cartStatus === "running") {
    res.status(409).json({
      error: "cartographer-already-running",
      message: "The Account Cartographer is already researching this account.",
    });
    return;
  }

  // Task #201 — ASYNC START-THEN-POLL. The Cartographer run takes minutes;
  // holding the request open used to 502 at the proxy. Record the launch,
  // do the whole run + governed-queue write in the background, and return
  // the current workspace immediately. The account page already polls the
  // workspace while cartographerStatus === "running".
  const cartLaunchKey = launchKey("account_cartographer", a.id);
  const cartToken = registerLaunch(cartLaunchKey, {
    status: "running",
    error: null,
    runId: null,
    proposedCount: null,
    openQuestions: [],
    startedAt: Date.now(),
  });
  const triggeredByUserId = me.id;
  // Task #1193 — Background Work bell visibility during the pre-run-row window.
  noteAgentLaunch({
    agentId: "account_cartographer",
    targetId: a.id,
    targetLabel: a.brandName ?? a.name,
    userId: triggeredByUserId,
  });
  void (async () => {
    try {
      const { runId, output } = await runAccountCartographer({
        accountId: a.id,
        accountName: a.name,
        accountSector: a.sector,
        accountCountry: a.country,
        accountHqCity: a.hqCity ?? null,
        triggeredByUserId,
        actorLabel: "Account Cartographer",
        focusOpportunityId,
      });

      // Task #568 — GOVERNED AI POPULATION. A manual refresh no longer
      // direct-writes the account. The Cartographer PROPOSES; a partner then
      // edits / approves / rejects each delta (see the decision + bulk-decision
      // endpoints). This keeps AI population uniformly governed and prevents the
      // agent from clobbering partner-curated fields (notes, hypothesis, etc.).
      // Auto-seeding still happens on CREATE for empty new accounts; only the
      // manual Refresh-from-web is queue-gated.
      const existingContacts = await db
        .select({ fullName: atelierContacts.fullName })
        .from(atelierContacts)
        .where(and(eq(atelierContacts.accountId, a.id), isNull(atelierContacts.deletedAt)));

      // Re-load for the freshest queue — the LLM run takes minutes and other
      // writers (partner edits, approvals) may have touched the row meanwhile.
      const fresh = (await loadAccount(a.id)) ?? a;
      const proposals = buildCartographerProposals({
        proposedBy: "ag_account_cartographer",
        output,
        account: fresh,
        existingContacts,
      });

      const queue = (
        (fresh.pendingProfileUpdates as PendingProfileUpdate[] | null) ?? []
      ).concat(proposals);

      await db.transaction(async (tx) => {
        // enrichedAt records that a refresh ran; the actual field writes wait for
        // partner approval. We never touch notes/hypothesis/priorities here.
        await tx
          .update(atelierAccounts)
          .set({ pendingProfileUpdates: queue, enrichedAt: new Date(), updatedAt: new Date() })
          .where(eq(atelierAccounts.id, a.id));
        await tx.insert(atelierAuditEvents).values({
          id: rid("aud"),
          entityType: "account",
          entityId: a.id,
          actorType: "agent",
          actorId: "ag_account_cartographer",
          actorLabel: "Account Cartographer",
          action: "account.profile.proposeUpdate",
          payload: {
            count: proposals.length,
            fields: proposals.map((p) => p.field),
          },
          payloadSummary:
            proposals.length > 0
              ? `Account Cartographer proposed ${proposals.length} profile update(s) for ${a.name} (awaiting partner review).`
              : `Account Cartographer refresh found no new changes to propose for ${a.name}.`,
        });
      });

      settleLaunch(cartLaunchKey, cartToken, {
        status: "succeeded",
        error: null,
        runId,
        proposedCount: proposals.length,
        openQuestions: [],
        startedAt: Date.now(),
      });

      clearAgentLaunch("account_cartographer", a.id);

      // Cartographer refresh finished and its proposals are queued — chain the
      // Executive Mapper (fire-and-forget), same as the account-creation flow.
      // A failed / empty / already-running sweep never breaks the refresh.
      chainExecutiveMapperAfterCartographer(a.id, triggeredByUserId, a.brandName ?? a.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      settleLaunch(cartLaunchKey, cartToken, {
        status: "failed",
        error: message,
        runId: null,
        proposedCount: null,
        openQuestions: [],
        startedAt: Date.now(),
      });
      clearAgentLaunch("account_cartographer", a.id);
      console.warn(`[atelier] cartographer refresh failed for ${a.name}`, message);
    }
  })();

  const ws = await buildWorkspace(a.id, access, me);
  res.json(ws);
});

// ---------- executive mapper (Task #32) ----------
// People-only deep leadership sweep. Same governed queue as the Cartographer:
// the Mapper PROPOSES contacts (with LinkedIn profile links); a partner then
// approves / edits / rejects each person on the Profile tab.
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure

// Shared Executive Mapper pipeline lives in
// ../../lib/atelier-agents/executive-mapper-chain.ts (extracted so the chat
// orchestrator can chain it too). Imported at the top of this file.

// @cli-skip: long-running agent trigger behind the account AI tab; CLI parity needs run-lifecycle design before exposure
router.post("/accounts/:accountId/executive-mapper/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const a = await loadAccount(req.params.accountId);
  if (!a) {
    res.status(404).json({ error: "not-found" });
    return;
  }

  // Task #201/#868 — ASYNC START-THEN-POLL. The sweep takes minutes; holding
  // the request open used to 502 at the proxy. Launch state is owned by the
  // chain module (registered synchronously inside runExecutiveMapperAndQueue,
  // so every entry point — this route, account-creation auto-run, the
  // post-Cartographer chain — shares one registry); we return immediately and
  // the client follows the shared workspace status.
  const alreadyRunning = () => {
    res.status(409).json({
      error: "executive-mapper-already-running",
      message: "An executive mapping sweep is already running for this account.",
    });
  };
  if ((await getExecutiveMapperLaunch(a.id))?.status === "running") {
    alreadyRunning();
    return;
  }
  const [inFlightRow] = await db
    .select({ id: atelierAgentRuns.id })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.agentId, "executive_mapper"),
        eq(atelierAgentRuns.targetId, a.id),
        eq(atelierAgentRuns.status, "running"),
        // Task #1046 — a stale "running" row (dead process) must not
        // block a relaunch forever.
        agentRunIsFresh(),
        isNull(atelierAgentRuns.deletedAt),
      ),
    )
    .limit(1);
  if (inFlightRow) {
    alreadyRunning();
    return;
  }

  // The "running" launch entry is registered synchronously inside this call
  // (before its first await), so the 202 below can never race a stale "idle".
  void runExecutiveMapperAndQueue(a.id, me.id).catch((err) => {
    const raw = err instanceof Error ? err.message : String(err);
    console.warn(`[atelier] executive mapper run failed for ${a.name}`, raw);
  });

  res.status(202).json({ started: true, status: "running" });
});

// Task #201/#868 — Executive Mapper run status. Bespoke raw-fetch route (not
// in the OpenAPI spec) used by the account page for the settle-toast detail
// fetch. Delegates to the same loadExecutiveMapperStatus helper that feeds
// the workspace shape so every surface reads one consistent state.
// @cli-skip: bespoke agent-read route, surfaced in the Account UI only
router.get("/accounts/:accountId/executive-mapper/status", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  res.json(await loadExecutiveMapperStatus(req.params.accountId));
});

// Task #206 — latest critical-role coverage summary from the most recent
// completed Executive Mapper run. Bespoke raw-fetch route (not in the OpenAPI
// spec), same pattern as the other account-agent routes. Coverage is
// code-computed at run time (guardExecutiveMapperCriticalRoles), so this is a
// pure read of the stored run output.
// @cli-skip: bespoke agent-read route, surfaced in the Account UI only
router.get("/accounts/:accountId/executive-mapper/coverage", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const [run] = await db
    .select({
      id: atelierAgentRuns.id,
      output: atelierAgentRuns.output,
      createdAt: atelierAgentRuns.createdAt,
    })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.targetType, "account"),
        eq(atelierAgentRuns.targetId, req.params.accountId),
        eq(atelierAgentRuns.agentId, "executive_mapper"),
        eq(atelierAgentRuns.status, "complete"),
        isNull(atelierAgentRuns.deletedAt),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt))
    .limit(1);
  // Task #208 — coverage no longer depends on the last run alone. The live
  // CRM roster (which includes approved contact proposals) is re-classified
  // with the same deterministic classifier, so coverage stays accurate as
  // contacts are added, merged, or retitled. The stored run output remains a
  // fallback for role holders the CRM titles alone can't support.
  const liveContacts = await db
    .select({
      fullName: atelierContacts.fullName,
      title: atelierContacts.title,
      confidence: atelierContacts.confidence,
    })
    .from(atelierContacts)
    .where(
      and(
        eq(atelierContacts.accountId, req.params.accountId),
        isNull(atelierContacts.deletedAt),
      ),
    );
  // Task #1189 — government accounts add the gov functional-role slice
  // (ministry IT / Cyber / Customer-care leads) to the coverage view, and the
  // live-roster reclassification must use the same gov-mode classifier the
  // run guard used or approved gov leads would read as unfound.
  const [covAcct] = await db
    .select({ name: atelierAccounts.name, sector: atelierAccounts.sector })
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, req.params.accountId));
  const covGov = isGovernmentAccount({ sector: covAcct?.sector, name: covAcct?.name });
  const crmCoverage = computeCriticalRoleCoverage(
    liveContacts.map((c) => ({
      fullName: c.fullName,
      title: c.title ?? null,
      confidence: (c.confidence === "verified" ? "verified" : "inferred") as
        | "verified"
        | "inferred",
      criticalRole: classifyCriticalRole(c.title, { government: covGov }),
    })),
    { government: covGov },
  );
  const out = (run?.output ?? {}) as {
    criticalRoleCoverage?: unknown;
    droppedBySeniorityGuard?: unknown;
  };
  const runCoverage = Array.isArray(out.criticalRoleCoverage)
    ? (out.criticalRoleCoverage as typeof crmCoverage)
    : null;
  // CRM-derived entries win (fresher); unfound roles fall back to the run.
  const coverage = crmCoverage.map((entry) => {
    if (entry.found) return { ...entry, source: "crm" as const };
    const fromRun = runCoverage?.find((r) => r?.role === entry.role && r.found);
    return fromRun ? { ...fromRun, source: "run" as const } : { ...entry, source: null };
  });
  const anyFound = coverage.some((c) => c.found);
  if (!run && !anyFound) {
    // No mapper run and no classifiable CRM contacts — nothing to show yet.
    res.json({ runId: null, runAt: null, coverage: null, droppedBySeniorityGuard: [] });
    return;
  }
  res.json({
    runId: run?.id ?? null,
    runAt: run?.createdAt ?? null,
    coverage,
    droppedBySeniorityGuard: Array.isArray(out.droppedBySeniorityGuard)
      ? out.droppedBySeniorityGuard
      : [],
  });
});

// Task #207 — cross-account critical-role coverage rollup. Summarises the
// latest completed Executive Mapper run per visible account so partners can
// see portfolio-wide gaps ("which accounts have no CFO / Head of AI mapped?")
// at a glance. Same bespoke raw-fetch pattern as the per-account coverage
// route above; pure read of stored run outputs — nothing is recomputed.
// Registered on its own path (not under /accounts/:accountId) to avoid the
// param-route shadowing trap.
// @cli-skip: bespoke agent-read route, surfaced in the Accounts UI only
router.get("/executive-mapper/coverage-rollup", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  // Active (non-archived, non-deleted) accounts only — archived accounts are
  // out of the pursuit portfolio, so their gaps aren't actionable.
  const rows = await db
    .select({
      id: atelierAccounts.id,
      name: atelierAccounts.name,
      brandName: atelierAccounts.brandName,
      tier: atelierAccounts.tier,
      status: atelierAccounts.status,
    })
    .from(atelierAccounts)
    .where(isNull(atelierAccounts.deletedAt));
  const active = rows.filter((r) => (r.status ?? "active") !== "archived");
  // Account-level RLS: mirror the /accounts list — only accounts the caller
  // can see contribute to the rollup.
  const visible = (
    await Promise.all(
      active.map(async (r) => ((await canSeeAccount(access, me, r.id)) ? r : null)),
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  const totalRoles = CRITICAL_ROLES.length;
  if (visible.length === 0) {
    res.json({ totalRoles, accounts: [] });
    return;
  }

  // Latest completed Executive Mapper run per account: fetch all completed
  // runs for the visible ids newest-first, keep the first per account.
  const runs = await db
    .select({
      targetId: atelierAgentRuns.targetId,
      output: atelierAgentRuns.output,
      createdAt: atelierAgentRuns.createdAt,
    })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.targetType, "account"),
        inArray(
          atelierAgentRuns.targetId,
          visible.map((r) => r.id),
        ),
        eq(atelierAgentRuns.agentId, "executive_mapper"),
        eq(atelierAgentRuns.status, "complete"),
        isNull(atelierAgentRuns.deletedAt),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt));
  const latestByAccount = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (run.targetId && !latestByAccount.has(run.targetId)) {
      latestByAccount.set(run.targetId, run);
    }
  }

  const accounts = visible.map((a) => {
    const run = latestByAccount.get(a.id);
    const out = (run?.output ?? {}) as { criticalRoleCoverage?: unknown };
    const coverage = Array.isArray(out.criticalRoleCoverage)
      ? (out.criticalRoleCoverage as Array<{
          role?: unknown;
          label?: unknown;
          found?: unknown;
        }>)
      : null;
    if (!run || !coverage) {
      // No completed sweep (or an old run predating coverage) — surfaced as
      // "not yet swept" rather than pretending 0/15 gaps are confirmed.
      return {
        accountId: a.id,
        name: a.name,
        brandName: a.brandName,
        tier: a.tier ?? "C",
        runAt: null,
        mappedCount: null,
        missingRoles: [],
      };
    }
    const missingRoles = coverage
      .filter((c) => c && c.found !== true)
      .map((c) => ({
        role: typeof c.role === "string" ? c.role : "",
        label: typeof c.label === "string" ? c.label : "",
      }));
    return {
      accountId: a.id,
      name: a.name,
      brandName: a.brandName,
      tier: a.tier ?? "C",
      runAt: run.createdAt,
      mappedCount: coverage.filter((c) => c && c.found === true).length,
      // Task #1189 — government accounts track extra functional roles (IT /
      // Cyber / Customer care), so their denominator is the stored coverage
      // length, not the global 15-role corporate count.
      roleCount: coverage.length,
      missingRoles,
    };
  });

  res.json({ totalRoles, accounts });
});

// Task #210 — bulk executive-map staleness for the accounts list. Returns,
// for every account the caller can see that has at least one completed
// Executive Mapper run, the latest run timestamp and whether it is stale
// (>= 30 days, matching the in-account coverage chip from Task #209).
// Accounts with no run ever are omitted — there is no map to be stale.
// Bespoke raw-fetch route (not in the OpenAPI spec), same pattern as the
// other account-agent routes. Registered as a static 3-segment path so it
// cannot collide with the /accounts/:accountId/* routes (all 2- or 4-seg).
// @cli-skip: bespoke agent-read route, surfaced in the Accounts list UI only
export const EXEC_MAP_STALE_DAYS = 30;
// @cli-skip: executive-mapper coverage telemetry is an internal agent-health surface, not a user assistant capability
router.get("/accounts/executive-mapper/coverage-staleness", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  // Latest completed run per account, one query. Runs for deleted accounts
  // are filtered by the visibility join below.
  const runs = await db
    .select({
      targetId: atelierAgentRuns.targetId,
      createdAt: atelierAgentRuns.createdAt,
    })
    .from(atelierAgentRuns)
    .where(
      and(
        eq(atelierAgentRuns.targetType, "account"),
        eq(atelierAgentRuns.agentId, "executive_mapper"),
        eq(atelierAgentRuns.status, "complete"),
        isNull(atelierAgentRuns.deletedAt),
      ),
    )
    .orderBy(desc(atelierAgentRuns.createdAt));
  const latestByAccount = new Map<string, Date>();
  for (const r of runs) {
    if (!r.targetId || !r.createdAt) continue;
    if (!latestByAccount.has(r.targetId)) latestByAccount.set(r.targetId, r.createdAt);
  }
  const now = Date.now();
  const entries: { accountId: string; lastRunAt: string; ageDays: number; stale: boolean }[] = [];
  for (const [accountId, lastRunAt] of latestByAccount) {
    if (!(await canSeeAccount(access, me, accountId))) continue;
    const ageDays = Math.floor((now - lastRunAt.getTime()) / 86_400_000);
    entries.push({
      accountId,
      lastRunAt: lastRunAt.toISOString(),
      ageDays,
      stale: ageDays >= EXEC_MAP_STALE_DAYS,
    });
  }
  res.json({ staleDays: EXEC_MAP_STALE_DAYS, entries });
});

// ---------- contacts (graph) ----------
// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts/:accountId/contacts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const ws = await buildWorkspace(req.params.accountId, access, me);
  if (!ws) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  res.json({ contacts: ws.contacts, relationships: ws.relationships });
});

// ---------- whitespace ----------
// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts/:accountId/whitespace", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const a = await loadAccount(req.params.accountId);
  if (!a) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const { output } = await runWhitespaceMapper({
    accountId: a.id,
    accountName: a.name,
    triggeredByUserId: me?.id ?? null,
    actorLabel: "Whitespace Mapper",
  });
  const payload: ReturnType<typeof toWhitespaceWire> = toWhitespaceWire(a.id, output);
  res.json(payload);
});

function toWhitespaceWire(accountId: string, output: WhitespaceOutput) {
  return {
    accountId,
    offerings: output.offerings,
    personas: output.personas,
    cells: output.cells.map((c) => ({
      offering: c.offering,
      persona: c.persona,
      state: c.state,
      note: c.note ?? null,
      oppId: null,
      rationale: c.rationale ?? null,
    })),
    priorityMoves: output.priorityMoves ?? [],
    generatedAt: new Date().toISOString(),
  };
}

// ---------- qbr ----------
// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts/:accountId/qbr", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const a = await loadAccount(req.params.accountId);
  if (!a) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const { output } = await runQbrComposer({
    accountId: a.id,
    accountName: a.name,
    triggeredByUserId: me?.id ?? null,
    actorLabel: "QBR Composer",
  });
  res.json(toQbrWire(a.id, output));
});

function toQbrWire(accountId: string, o: QbrOutput) {
  return {
    accountId,
    periodLabel: o.periodLabel,
    sections: o.sections,
    riskFlags: o.riskFlags ?? [],
    nextMoves: o.nextMoves ?? [],
    generatedAt: new Date().toISOString(),
  };
}

// ---------- profile-update decision ----------
// @cli-skip: pending Task #340 read-parity migration
// Task #568 — shared decision core used by both the single and bulk
// profile-update endpoints. Applies each approved delta to the live account
// (honouring a partner inline edit), upserts discovered contacts + reports_to
// edges, records edit/decide provenance on the queue item, and writes one
// audit event per decision. Runs in a single transaction.
async function applyProfileUpdateDecisions(args: {
  account: typeof atelierAccounts.$inferSelect;
  me: { id: string; name: string };
  decisions: Array<{
    target: PendingProfileUpdate;
    decision: "approve" | "reject";
    hasEdit: boolean;
    editedValue?: unknown;
  }>;
}): Promise<void> {
  const { account: a, me, decisions } = args;
  const now = new Date();
  const nowIso = now.toISOString();
  const decidedIds = new Set(decisions.map((d) => d.target.id));

  const accountUpdate: Partial<typeof atelierAccounts.$inferInsert> = {
    updatedAt: now,
  };
  // Working copy so multiple sourceSignals approvals chain correctly.
  let workingSignals =
    (a.sourceSignals as Array<{ url?: string }> | null) ?? [];

  await db.transaction(async (tx) => {
    // Lazy contact roster — only loaded if a contact proposal is approved.
    // Lookups are FUZZY (shared person-name matcher): approving a proposal
    // spelled "Mohammed Al Jasser" must enrich an existing "Mohammed bin
    // Nasser Al-Jasser" contact, never create a duplicate person.
    let contactRows: Array<{ id: string; fullName: string }> | null = null;
    const loadContacts = async () => {
      if (contactRows) return contactRows;
      contactRows = await tx
        .select({ id: atelierContacts.id, fullName: atelierContacts.fullName })
        .from(atelierContacts)
        .where(and(eq(atelierContacts.accountId, a.id), isNull(atelierContacts.deletedAt)));
      return contactRows;
    };
    const resolveContactId = (rows: Array<{ id: string; fullName: string }>, name: string) =>
      findPersonMatch(name, rows, (r) => r.fullName)?.id;

    for (const { target, decision, hasEdit, editedValue } of decisions) {
      if (decision === "approve") {
        const effectiveValue = hasEdit ? editedValue : target.toValue;
        const f = target.field;
        if (f === "strategicPriorities" && Array.isArray(effectiveValue)) {
          accountUpdate.strategicPriorities = effectiveValue as string[];
          // Preserve the citation refs the agent carried in meta, but only for
          // priorities that survived an edit.
          const refs = (target.meta?.refs as Array<{ text: string; sourceUrls: string[] }> | undefined) ?? [];
          const kept = (effectiveValue as string[]).map(
            (text) => refs.find((r) => r.text === text) ?? { text, sourceUrls: [] },
          );
          accountUpdate.strategicPriorityRefs =
            kept as typeof atelierAccounts.$inferInsert.strategicPriorityRefs;
        } else if (f === "cogniriseHypothesis" && typeof effectiveValue === "string") {
          accountUpdate.cogniriseHypothesis = effectiveValue;
        } else if (f === "sector" && typeof effectiveValue === "string") {
          accountUpdate.sector = effectiveValue;
        } else if (f === "hqCity" && typeof effectiveValue === "string") {
          accountUpdate.hqCity = effectiveValue;
        } else if (f === "size" && typeof effectiveValue === "string") {
          accountUpdate.size = effectiveValue;
        } else if (f === "industry" && effectiveValue && typeof effectiveValue === "object") {
          // Task #698 — re-validate through the taxonomy resolver on apply so
          // an edited/stale proposal can never write an off-taxonomy code.
          const iv = effectiveValue as {
            industryCode?: string | null;
            subIndustryCode?: string | null;
          };
          const resolved = resolveIndustryTaxonomy(
            iv.industryCode ?? null,
            iv.subIndustryCode ?? null,
          );
          if (resolved) {
            accountUpdate.industryCode = resolved.industryCode;
            accountUpdate.subIndustryCode = resolved.subIndustryCode;
          }
        } else if (f === "researchBrief" && effectiveValue && typeof effectiveValue === "object") {
          accountUpdate.researchBrief =
            effectiveValue as typeof atelierAccounts.$inferInsert.researchBrief;
        } else if (f === "sourceSignals" && Array.isArray(effectiveValue)) {
          const incoming = effectiveValue as Array<{ url?: string }>;
          const seen = new Set(workingSignals.map((s) => s.url).filter(Boolean));
          const merged = [...workingSignals];
          for (const sig of incoming) {
            if (sig?.url && !seen.has(sig.url)) {
              merged.push(sig);
              seen.add(sig.url);
            }
          }
          workingSignals = merged.slice(-50);
          accountUpdate.sourceSignals = workingSignals as typeof a.sourceSignals;
        } else if (f === "contact" && effectiveValue && typeof effectiveValue === "object") {
          const dm = effectiveValue as {
            fullName?: string;
            title?: string | null;
            entityName?: string | null;
            entityScope?: string | null;
            seniority?: string | null;
            buyerPersona?: string | null;
            sourceUrl?: string | null;
            linkedinUrl?: string | null;
            confidence?: string | null;
            reportsToName?: string | null;
            rationale?: string | null;
            timeInRole?: string | null;
            careerHistory?: Array<{
              role: string;
              company: string;
              period?: string | null;
              highlight?: string | null;
            }>;
            education?: Array<{
              institution: string;
              programme?: string | null;
              year?: string | null;
            }>;
          };
          if (dm.fullName && dm.fullName.trim()) {
            const rows = await loadContacts();
            const existingRow = findPersonMatch(dm.fullName, rows, (r) => r.fullName);
            const existingId = existingRow?.id;
            const seniority = (dm.seniority ?? null) as
              | "board_chair" | "board_member"
              | "c_suite" | "vp" | "director" | "manager" | "ic" | null;
            if (existingId && existingRow) {
              await tx
                .update(atelierContacts)
                .set({
                  // Keep the richer name spelling on the surviving record.
                  fullName: richerPersonName(existingRow.fullName, dm.fullName),
                  title: dm.title ?? null,
                  seniority,
                  entityName: dm.entityName ?? null,
                  entityScope: dm.entityScope ?? null,
                  buyerPersona: dm.buyerPersona ?? null,
                  timeInRole: dm.timeInRole ?? null,
                  careerHistory: dm.careerHistory ?? [],
                  education: dm.education ?? [],
                  sourceUrl: dm.sourceUrl ?? null,
                  // Never blank an existing LinkedIn link when the agent
                  // simply didn't find one this run.
                  ...(dm.linkedinUrl ? { linkedinUrl: dm.linkedinUrl } : {}),
                  confidence: (dm.confidence ?? "inferred") as "verified" | "inferred",
                  updatedAt: now,
                })
                .where(eq(atelierContacts.id, existingId));
            } else {
              const newId = rid("ct");
              // Task #538 — agent-emitted fullName is parsed into a person row.
              const pw = await writePersonFromFullName(tx, {
                orgId: a.orgId,
                fullName: dm.fullName,
                sourceKind: "contact",
              });
              await tx.insert(atelierContacts).values({
                id: newId,
                accountId: a.id,
                personId: pw.personId,
                fullName: pw.fullName,
                title: dm.title ?? null,
                seniority,
                entityName: dm.entityName ?? null,
                entityScope: dm.entityScope ?? null,
                buyerPersona: dm.buyerPersona ?? null,
                timeInRole: dm.timeInRole ?? null,
                careerHistory: dm.careerHistory ?? [],
                education: dm.education ?? [],
                influenceScore:
                  seniority === "c_suite" || seniority === "board_chair"
                    ? 5
                    : seniority === "vp" || seniority === "board_member"
                      ? 4
                      : 3,
                disposition: "unknown",
                notes: dm.rationale ?? null,
                sourceUrl: dm.sourceUrl ?? null,
                linkedinUrl: dm.linkedinUrl ?? null,
                confidence: (dm.confidence ?? "inferred") as "verified" | "inferred",
                createdByUserId: me.id,
              });
              rows.push({ id: newId, fullName: dm.fullName });
            }
            // reports_to edge — only when the manager already exists.
            const reportsToName = (dm.reportsToName ??
              (target.meta?.reportsToName as string | null | undefined)) ?? null;
            if (reportsToName) {
              const fromId = resolveContactId(rows, dm.fullName);
              const toId = resolveContactId(rows, reportsToName);
              if (fromId && toId && fromId !== toId) {
                const [edge] = await tx
                  .select({ id: atelierContactRelationships.id })
                  .from(atelierContactRelationships)
                  .where(
                    and(
                      eq(atelierContactRelationships.accountId, a.id),
                      eq(atelierContactRelationships.fromContactId, fromId),
                      eq(atelierContactRelationships.toContactId, toId),
                      eq(atelierContactRelationships.type, "reports_to"),
                      isNull(atelierContactRelationships.deletedAt),
                    ),
                  );
                if (!edge) {
                  // Task #8 — cycle guard: walk EVERY existing live
                  // reports_to edge on the account (within this tx) before
                  // inserting; agent proposals can otherwise close a loop.
                  const existingEdges = await tx
                    .select({
                      fromContactId: atelierContactRelationships.fromContactId,
                      toContactId: atelierContactRelationships.toContactId,
                    })
                    .from(atelierContactRelationships)
                    .where(
                      and(
                        eq(atelierContactRelationships.accountId, a.id),
                        eq(atelierContactRelationships.type, "reports_to"),
                        isNull(atelierContactRelationships.deletedAt),
                      ),
                    );
                  const managersOf = new Map<string, string[]>();
                  for (const e of existingEdges) {
                    managersOf.set(e.fromContactId, [
                      ...(managersOf.get(e.fromContactId) ?? []),
                      e.toContactId,
                    ]);
                  }
                  if (cycleInManagers(managersOf, fromId, toId)) {
                    console.warn(
                      `[atelier] skipped proposed reports_to edge ${fromId} -> ${toId}: would create a reporting cycle`,
                    );
                  } else {
                    await tx.insert(atelierContactRelationships).values({
                      id: rid("cr"),
                      accountId: a.id,
                      fromContactId: fromId,
                      toContactId: toId,
                      type: "reports_to",
                    });
                  }
                }
              }
            }
          }
        }
      }

      await tx.insert(atelierAuditEvents).values({
        id: rid("aud"),
        entityType: "account",
        entityId: a.id,
        actorType: "human",
        actorId: me.id,
        actorLabel: me.name,
        action: `profile_update.${decision}`,
        payload: {
          updateId: target.id,
          field: target.field,
          edited: hasEdit,
          toValue: hasEdit ? editedValue : target.toValue,
        },
        payloadSummary: `${me.name} ${decision}d${hasEdit ? " (with edits)" : ""} the AI proposal on field "${target.field}".`,
      });
    }

    // Stamp queue items with their new status + provenance.
    const list = (a.pendingProfileUpdates ?? []) as PendingProfileUpdate[];
    const decisionById = new Map(decisions.map((d) => [d.target.id, d]));
    accountUpdate.pendingProfileUpdates = list.map((u) => {
      if (!decidedIds.has(u.id)) return u;
      const d = decisionById.get(u.id)!;
      const stamped: PendingProfileUpdate = {
        ...u,
        status: d.decision === "approve" ? "approved" : "rejected",
        decidedAt: nowIso,
        decidedBy: me.id,
      };
      if (d.hasEdit) {
        stamped.originalToValue = u.toValue;
        stamped.toValue = d.editedValue;
        stamped.editedAt = nowIso;
        stamped.editedBy = me.id;
      }
      return stamped;
    });

    await tx.update(atelierAccounts).set(accountUpdate).where(eq(atelierAccounts.id, a.id));
  });
}

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/accounts/:accountId/profile-updates/:updateId/decision", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only", reason: "Only a partner persona can approve or reject AI profile-update proposals." });
    return;
  }
  const a = await loadAccount(req.params.accountId);
  if (!a) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const parsed = AtelierProfileUpdateDecisionInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const decision = parsed.data.decision;
  const list = (a.pendingProfileUpdates ?? []) as PendingProfileUpdate[];
  const target = list.find((u) => u.id === req.params.updateId);
  if (!target) {
    res.status(404).json({ error: "proposal-not-found" });
    return;
  }
  if (target.status !== "pending") {
    res.status(409).json({ error: "already-decided" });
    return;
  }
  const hasEdit =
    decision === "approve" && Object.prototype.hasOwnProperty.call(parsed.data, "editedValue");

  await applyProfileUpdateDecisions({
    account: a,
    me,
    decisions: [
      { target, decision, hasEdit, editedValue: (parsed.data as { editedValue?: unknown }).editedValue },
    ],
  });

  const access = await accessibleEngagementIds(me);
  const ws = await buildWorkspace(a.id, access, me);
  res.json(ws);
});

// Task #568 — bulk approve/reject. Omitting updateIds targets every pending
// proposal on the account. Bulk does not support per-item inline edits.
// @cli-skip: governed AI-population endpoint, not part of the read-parity matrix
router.post("/accounts/:accountId/profile-updates/bulk-decision", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only", reason: "Only a partner persona can approve or reject AI profile-update proposals." });
    return;
  }
  const a = await loadAccount(req.params.accountId);
  if (!a) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const parsed = AtelierBulkDecideProfileUpdatesInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const decision = parsed.data.decision;
  const requestedIds = parsed.data.updateIds ?? null;
  const list = (a.pendingProfileUpdates ?? []) as PendingProfileUpdate[];
  const targets = list.filter(
    (u) => u.status === "pending" && (requestedIds === null || requestedIds.includes(u.id)),
  );
  if (targets.length === 0) {
    res.status(404).json({ error: "no-pending-proposals" });
    return;
  }

  await applyProfileUpdateDecisions({
    account: a,
    me,
    decisions: targets.map((target) => ({ target, decision, hasEdit: false })),
  });

  const access = await accessibleEngagementIds(me);
  const ws = await buildWorkspace(a.id, access, me);
  res.json(ws);
});

// ---------- contact disposition ----------
// @cli-skip: pending Task #340 read-parity migration
router.post("/contacts/:contactId/disposition", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const parsed = AtelierContactDispositionInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [c] = await db
    .select()
    .from(atelierContacts)
    .where(and(eq(atelierContacts.id, req.params.contactId), isNull(atelierContacts.deletedAt)));
  if (!c) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, c.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const before = c.disposition;
  // Task #567 — append a trend snapshot capturing the new disposition.
  const dispoTrend = [
    ...(c.relationshipTrend ?? []),
    makeTrendPoint(c.relationshipStrength ?? 0, parsed.data.disposition, parsed.data.note ?? null),
  ];
  await db.transaction(async (tx) => {
    await tx
      .update(atelierContacts)
      .set({ disposition: parsed.data.disposition, relationshipTrend: dispoTrend, updatedAt: new Date() })
      .where(eq(atelierContacts.id, c.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: c.accountId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "contact.disposition",
      payload: { contactId: c.id, before, after: parsed.data.disposition, note: parsed.data.note ?? null },
      payloadSummary: `${me.name} set ${c.fullName}'s disposition to "${parsed.data.disposition}".`,
    });
  });
  const [updated] = await db.select().from(atelierContacts).where(eq(atelierContacts.id, c.id));
  // Task #1200 — derive gov mode from the parent account so the badge is correct.
  const [dispAcct] = await db
    .select({ name: atelierAccounts.name, sector: atelierAccounts.sector })
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, updated.accountId));
  const dispGov = isGovernmentAccount({ sector: dispAcct?.sector ?? null, name: dispAcct?.name ?? "" });
  res.json(
    toContactWire(
      updated,
      await resolveOwnerName(updated.contactOwnerId, updated.orgId),
      (await loadPersonsByIds([updated.personId])).get(updated.personId ?? "") ?? null,
      { government: dispGov },
    ),
  );
});

// ---------- contact CRUD (Task #554) ----------
// Task #538 — resolve the structured-name fields from a contact's linked
// person row. Batch variant for list endpoints; single lookups elsewhere.
type PersonRow = typeof atelierPersons.$inferSelect;
export async function loadPersonsByIds(ids: Array<string | null | undefined>): Promise<Map<string, PersonRow>> {
  const uniq = [...new Set(ids.filter((v): v is string => !!v))];
  if (uniq.length === 0) return new Map();
  const rows = await db.select().from(atelierPersons).where(inArray(atelierPersons.id, uniq));
  return new Map(rows.map((r) => [r.id, r]));
}

function toContactWire(
  c: typeof atelierContacts.$inferSelect,
  ownerName?: string | null,
  person?: PersonRow | null,
  opts?: { government?: boolean },
) {
  return {
    id: c.id,
    accountId: c.accountId,
    fullName: c.fullName,
    // Task #538 — structured name (from the linked person row).
    personId: c.personId ?? null,
    honorific: person?.honorific ?? null,
    firstName: person?.firstName ?? null,
    middleName: person?.middleName ?? null,
    lastName: person?.lastName ?? null,
    preferredName: person?.preferredName ?? null,
    displayName: person?.displayName ?? null,
    title: c.title ?? null,
    seniority: (c.seniority ?? null) as
      | "board_chair"
      | "board_member"
      | "c_suite"
      | "vp"
      | "director"
      | "manager"
      | "ic"
      | "unknown"
      | null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    linkedinUrl: c.linkedinUrl ?? null,
    buyerPersona: c.buyerPersona ?? null,
    // Task #208 — derived on read from the verbatim title by the shared
    // deterministic classifier so approved-proposal tags survive onto the
    // contact and stay accurate whenever the title changes.
    // Task #1200 — pass government mode so ministry contacts get gov_*_lead
    // badges rather than always being classified in corporate mode.
    criticalRole: classifyCriticalRole(c.title, { government: opts?.government ?? false }),
    influenceScore: c.influenceScore ?? 3,
    disposition: c.disposition as
      | "champion"
      | "supporter"
      | "neutral"
      | "skeptic"
      | "blocker"
      | "unknown",
    lastContactAt: c.lastContactAt ? new Date(c.lastContactAt).toISOString() : null,
    contactOwnerId: c.contactOwnerId ?? null,
    // Task #567 — relationship depth.
    contactOwnerName: ownerName ?? null,
    relationshipStrength: c.relationshipStrength ?? 0,
    nextTouchAt: c.nextTouchAt ? new Date(c.nextTouchAt).toISOString() : null,
    relationshipTrend: (c.relationshipTrend ?? []).map((p) => ({
      at: p.at,
      strength: p.strength,
      disposition: p.disposition ?? null,
      note: p.note ?? null,
    })),
    notes: c.notes ?? null,
    // Task #589 — deep stakeholder profile.
    timeInRole: c.timeInRole ?? null,
    careerHistory: (c.careerHistory ?? []).map((h) => ({
      role: h.role,
      company: h.company,
      period: h.period ?? null,
      highlight: h.highlight ?? null,
    })),
    education: (c.education ?? []).map((e) => ({
      institution: e.institution,
      programme: e.programme ?? null,
      year: e.year ?? null,
    })),
    sourceUrl: c.sourceUrl ?? null,
    confidence: (c.confidence ?? "inferred") as "verified" | "inferred",
    // Entity-scope fix — drives the "Group" vs "Subsidiary · X" badge so a
    // subsidiary executive is never read as group leadership.
    entityName: c.entityName ?? null,
    entityScope: (c.entityScope ?? null) as
      | "parent_group"
      | "subsidiary"
      | "division"
      | "standalone"
      | null,
  };
}

// Task #567 — resolve a contact owner's display name for wire responses.
// Scoped by orgId so a stray cross-org owner id can never disclose a foreign
// user's name.
async function resolveOwnerName(
  ownerId: string | null | undefined,
  orgId: string,
): Promise<string | null> {
  if (!ownerId) return null;
  const [u] = await db
    .select()
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, ownerId), eq(atelierUsers.orgId, orgId)));
  return u?.name ?? null;
}

// Task #567 — validate that a supplied contact owner belongs to the same org
// before it is persisted, preventing dangling/cross-org owner references.
async function ownerIdValidForOrg(ownerId: string, orgId: string): Promise<boolean> {
  const [u] = await db
    .select({ id: atelierUsers.id })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.id, ownerId), eq(atelierUsers.orgId, orgId)));
  return !!u;
}

// Task #567 — build an append-only relationship trend snapshot.
function makeTrendPoint(
  strength: number,
  disposition: string | null,
  note: string | null,
): { at: string; strength: number; disposition: string | null; note: string | null } {
  return { at: new Date().toISOString(), strength, disposition, note };
}

// Create a decision-maker contact on an account.
// @cli-skip: pending Task #340 read-parity migration
// Fuzzy duplicate check for contacts, scoped to a single account (Task #632).
// Warns before adding a decision-maker who probably already exists on the same
// account. Gated by the same canSeeAccount check as creating a contact.
router.post("/accounts/:accountId/contacts/check-duplicates", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const parsed = AtelierCheckContactDuplicatesInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const rows = await db
    .select({
      id: atelierContacts.id,
      fullName: atelierContacts.fullName,
      title: atelierContacts.title,
      seniority: atelierContacts.seniority,
    })
    .from(atelierContacts)
    .where(
      and(
        eq(atelierContacts.accountId, account.id),
        isNull(atelierContacts.deletedAt),
      ),
    );
  const candidates = findContactDuplicates(input.fullName, rows, {
    excludeId: input.excludeContactId ?? undefined,
  });
  res.json({ candidates });
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/accounts/:accountId/contacts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const parsed = AtelierCreateContactInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  // Task #538 — structured fields (forms) or fullName (agents/back-compat).
  let structured: StructuredName | null;
  try {
    structured = resolveStructuredNameInput(input);
  } catch (err) {
    if (err instanceof PersonNameValidationError) {
      res.status(400).json({ error: "name-required", reason: err.message });
      return;
    }
    throw err;
  }
  if (!structured) {
    res.status(400).json({ error: "name-required" });
    return;
  }
  const contactId = rid("ct");
  const now = new Date();
  // Task #567 — relationship depth on create. Default owner to the creating
  // persona unless an explicit owner was supplied. Seed the trend history
  // with the initial strength/disposition snapshot.
  const initialStrength = input.relationshipStrength ?? 0;
  const initialDisposition = input.disposition ?? "unknown";
  const ownerId = input.contactOwnerId?.trim() || me.id;
  if (ownerId !== me.id && !(await ownerIdValidForOrg(ownerId, account.orgId))) {
    res.status(400).json({ error: "invalid-owner" });
    return;
  }
  const created = await db.transaction(async (tx) => {
    // Task #538 — person row first; the contact links + mirrors its fullName.
    const person = await writePerson(tx, {
      orgId: account.orgId,
      structured,
      sourceKind: "contact",
      createdByUserId: me.id,
    });
    const [row] = await tx
      .insert(atelierContacts)
      .values({
        id: contactId,
        orgId: account.orgId,
        accountId: account.id,
        fullName: person.fullName,
        personId: person.personId,
        title: input.title?.trim() || null,
        seniority: input.seniority ?? null,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        linkedinUrl: input.linkedinUrl?.trim() || null,
        buyerPersona: input.buyerPersona?.trim() || null,
        influenceScore: input.influenceScore ?? 3,
        disposition: initialDisposition,
        relationshipStrength: initialStrength,
        lastContactAt: input.lastContactAt ? new Date(input.lastContactAt) : null,
        nextTouchAt: input.nextTouchAt ? new Date(input.nextTouchAt) : null,
        relationshipTrend: [makeTrendPoint(initialStrength, initialDisposition, "created")],
        notes: input.notes?.trim() || null,
        // Manually-entered contacts are confirmed by the human creating them.
        confidence: "verified",
        contactOwnerId: ownerId,
        createdByUserId: me.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "contact.created",
      payload: {
        contactId: row.id,
        fullName: row.fullName,
        title: row.title,
        seniority: row.seniority,
        disposition: row.disposition,
      },
      payloadSummary: `${me.name} added contact "${row.fullName}" to ${account.brandName ?? account.name}.`,
    });
    return row;
  });
  const createdPersons = await loadPersonsByIds([created.personId]);
  // Task #1200 — gov mode from the parent account for the badge.
  const createGov = isGovernmentAccount({ sector: account.sector ?? null, name: account.name });
  res.status(201).json(
    toContactWire(
      created,
      await resolveOwnerName(created.contactOwnerId, created.orgId),
      createdPersons.get(created.personId ?? "") ?? null,
      { government: createGov },
    ),
  );
});

// Edit a contact's profile fields.
// @cli-skip: pending Task #340 read-parity migration
router.patch("/contacts/:contactId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [c] = await db
    .select()
    .from(atelierContacts)
    .where(and(eq(atelierContacts.id, req.params.contactId), isNull(atelierContacts.deletedAt)));
  if (!c) {
    res.status(404).json({ error: "contact-not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, c.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  // Task #1200 — derive gov mode once so both response paths (no-change and
  // updated) return the correct gov_*_lead criticalRole badge.
  const [patchAcct] = await db
    .select({ name: atelierAccounts.name, sector: atelierAccounts.sector })
    .from(atelierAccounts)
    .where(eq(atelierAccounts.id, c.accountId));
  const patchGov = isGovernmentAccount({ sector: patchAcct?.sector ?? null, name: patchAcct?.name ?? "" });
  const parsed = AtelierUpdateContactInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const patch: Partial<typeof atelierContacts.$inferInsert> = {};
  const changed: string[] = [];
  // Task #538 — name edits flow through the person record. Structured
  // fields win; a bare fullName is parsed. The person write itself happens
  // inside the transaction below so contact + person stay consistent.
  let nameStructured: StructuredName | null = null;
  const nameTouched =
    input.fullName !== undefined ||
    input.firstName !== undefined ||
    input.lastName !== undefined ||
    input.middleName !== undefined ||
    input.honorific !== undefined ||
    input.preferredName !== undefined;
  if (nameTouched) {
    const existingPerson = c.personId
      ? (await loadPersonsByIds([c.personId])).get(c.personId) ?? null
      : null;
    try {
      nameStructured = resolveStructuredNameInput(input, existingPerson);
    } catch (err) {
      if (err instanceof PersonNameValidationError) {
        res.status(400).json({ error: "name-required", reason: err.message });
        return;
      }
      throw err;
    }
    if (nameStructured) changed.push("fullName");
  }
  if (input.title !== undefined) {
    patch.title = input.title?.trim() || null;
    changed.push("title");
  }
  if (input.seniority !== undefined) {
    patch.seniority = input.seniority ?? null;
    changed.push("seniority");
  }
  if (input.email !== undefined) {
    patch.email = input.email?.trim() || null;
    changed.push("email");
  }
  if (input.phone !== undefined) {
    patch.phone = input.phone?.trim() || null;
    changed.push("phone");
  }
  if (input.linkedinUrl !== undefined) {
    patch.linkedinUrl = input.linkedinUrl?.trim() || null;
    changed.push("linkedinUrl");
  }
  if (input.buyerPersona !== undefined) {
    patch.buyerPersona = input.buyerPersona?.trim() || null;
    changed.push("buyerPersona");
  }
  if (input.influenceScore !== undefined && input.influenceScore !== null) {
    patch.influenceScore = input.influenceScore;
    changed.push("influenceScore");
  }
  if (input.disposition !== undefined) {
    patch.disposition = input.disposition;
    changed.push("disposition");
  }
  // Task #567 — relationship depth fields.
  if (input.relationshipStrength !== undefined && input.relationshipStrength !== null) {
    patch.relationshipStrength = input.relationshipStrength;
    changed.push("relationshipStrength");
  }
  if (input.contactOwnerId !== undefined) {
    const newOwnerId = input.contactOwnerId?.trim() || null;
    if (newOwnerId && !(await ownerIdValidForOrg(newOwnerId, c.orgId))) {
      res.status(400).json({ error: "invalid-owner" });
      return;
    }
    patch.contactOwnerId = newOwnerId;
    changed.push("contactOwnerId");
  }
  if (input.lastContactAt !== undefined) {
    patch.lastContactAt = input.lastContactAt ? new Date(input.lastContactAt) : null;
    changed.push("lastContactAt");
  }
  if (input.nextTouchAt !== undefined) {
    patch.nextTouchAt = input.nextTouchAt ? new Date(input.nextTouchAt) : null;
    changed.push("nextTouchAt");
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes?.trim() || null;
    changed.push("notes");
  }
  if (changed.length === 0) {
    res.json(
      toContactWire(
        c,
        await resolveOwnerName(c.contactOwnerId, c.orgId),
        (await loadPersonsByIds([c.personId])).get(c.personId ?? "") ?? null,
        { government: patchGov },
      ),
    );
    return;
  }
  // Task #567 — append a trend snapshot whenever strength or disposition moves.
  if (changed.includes("relationshipStrength") || changed.includes("disposition")) {
    const nextStrength =
      patch.relationshipStrength !== undefined ? patch.relationshipStrength : c.relationshipStrength ?? 0;
    const nextDisposition =
      patch.disposition !== undefined ? (patch.disposition as string) : c.disposition;
    patch.relationshipTrend = [
      ...(c.relationshipTrend ?? []),
      makeTrendPoint(nextStrength, nextDisposition, null),
    ];
  }
  patch.updatedAt = new Date();
  const updated = await db.transaction(async (tx) => {
    // Task #538 — apply the name via the person record inside the tx so the
    // contact's legacy fullName mirror can never drift from the person row.
    // writePersonAndSync also refreshes any OTHER domain rows linked to the
    // same person (roster/login mirrors).
    if (nameStructured) {
      const w = await writePersonAndSync(tx, {
        orgId: c.orgId,
        personId: c.personId ?? null,
        structured: nameStructured,
        sourceKind: "contact",
        createdByUserId: me.id,
      });
      patch.personId = w.personId;
      patch.fullName = w.fullName;
    }
    const [row] = await tx
      .update(atelierContacts)
      .set(patch)
      .where(eq(atelierContacts.id, c.id))
      .returning();
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: c.accountId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "contact.updated",
      payload: { contactId: c.id, changed },
      payloadSummary: `${me.name} edited ${changed.join(", ")} on contact "${row.fullName}".`,
    });
    return row;
  });
  res.json(
    toContactWire(
      updated,
      await resolveOwnerName(updated.contactOwnerId, updated.orgId),
      (await loadPersonsByIds([updated.personId])).get(updated.personId ?? "") ?? null,
      { government: patchGov },
    ),
  );
});

// Soft-delete (remove) a contact.
// @cli-skip: pending Task #340 read-parity migration
router.delete("/contacts/:contactId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [c] = await db
    .select()
    .from(atelierContacts)
    .where(and(eq(atelierContacts.id, req.params.contactId), isNull(atelierContacts.deletedAt)));
  if (!c) {
    res.status(404).json({ error: "contact-not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, c.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(atelierContacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierContacts.id, c.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: c.accountId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "contact.archived",
      payload: { contactId: c.id, fullName: c.fullName },
      payloadSummary: `${me.name} removed contact "${c.fullName}".`,
    });
  });
  res.status(204).end();
});

// ---------- contact merge (Task #640) ----------
// Consolidate a duplicate contact INTO this (survivor) contact. Both must live
// on the same account. Re-points relationship edges, activities and audit
// history, then soft-deletes the duplicate. Gated by the same roles as editing
// an account (CREATE_ROLES) + visibility on the owning account.
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/contacts/:contactId/merge", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({
      error: "partner-only",
      reason: "Only Partner or Senior Manager personas can merge contacts.",
    });
    return;
  }
  const parsed = AtelierMergeContactsInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const duplicateContactId = parsed.data.duplicateContactId;
  if (duplicateContactId === req.params.contactId) {
    res.status(400).json({ error: "same-record", reason: "Cannot merge a contact into itself." });
    return;
  }
  // Load the survivor to resolve its account, then gate on that account.
  const [survivor] = await db
    .select({ id: atelierContacts.id, accountId: atelierContacts.accountId })
    .from(atelierContacts)
    .where(
      and(
        eq(atelierContacts.id, req.params.contactId),
        eq(atelierContacts.orgId, me.orgId),
        isNull(atelierContacts.deletedAt),
      ),
    );
  if (!survivor) {
    res.status(404).json({ error: "contact-not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, survivor.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const result = await mergeContacts(
    { id: me.id, name: me.name, orgId: me.orgId },
    req.params.contactId,
    duplicateContactId,
  );
  if (result.status === "not_found") {
    res.status(404).json({ error: "contact-not-found" });
    return;
  }
  if (result.status === "different_accounts") {
    res.status(400).json({
      error: "different-accounts",
      reason: "Both contacts must belong to the same account to be merged.",
    });
    return;
  }
  if (result.status === "same_record") {
    res.status(400).json({ error: "same-record", reason: "Cannot merge a contact into itself." });
    return;
  }
  res.json({ ok: true, status: result.status, counts: "counts" in result ? result.counts : {} });
});

// ---------- contact relationships (Task #567) ----------
// Detect whether adding `from reports_to to` would create a reporting cycle by
// walking the existing reports_to chain upward from `to`.
// Task #8 — pure in-memory variant of the cycle walk, for seed paths that
// insert several reports_to edges inside one transaction (the async DB-backed
// guard below can't see uncommitted rows). `managersOf` maps contactId -> its
// managers; returns true when adding from->to would close a cycle.
function cycleInManagers(
  managersOf: Map<string, string[]>,
  fromContactId: string,
  toContactId: string,
): boolean {
  if (fromContactId === toContactId) return true;
  const seen = new Set<string>();
  const stack: string[] = [toContactId];
  while (stack.length) {
    const cursor = stack.pop()!;
    if (cursor === fromContactId) return true;
    if (seen.has(cursor)) continue;
    seen.add(cursor);
    const next = managersOf.get(cursor);
    if (next) stack.push(...next);
  }
  return false;
}

async function wouldCreateReportsCycle(
  accountId: string,
  fromContactId: string,
  toContactId: string,
): Promise<boolean> {
  if (fromContactId === toContactId) return true;
  const edges = await db
    .select()
    .from(atelierContactRelationships)
    .where(
      and(
        eq(atelierContactRelationships.accountId, accountId),
        eq(atelierContactRelationships.type, "reports_to"),
        isNull(atelierContactRelationships.deletedAt),
      ),
    );
  // A contact may have multiple live reports_to edges (no DB uniqueness), so
  // traverse EVERY reachable manager from toContact — not just the first edge
  // found — before concluding the new (from -> to) edge is cycle-free.
  const managersOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = managersOf.get(e.fromContactId);
    if (list) list.push(e.toContactId);
    else managersOf.set(e.fromContactId, [e.toContactId]);
  }
  const seen = new Set<string>();
  const stack: string[] = [toContactId];
  while (stack.length) {
    const cursor = stack.pop()!;
    if (cursor === fromContactId) return true;
    if (seen.has(cursor)) continue;
    seen.add(cursor);
    const next = managersOf.get(cursor);
    if (next) stack.push(...next);
  }
  return false;
}

// Create a relationship edge between two contacts.
// @cli-skip: pending Task #340 read-parity migration
router.post("/accounts/:accountId/contact-relationships", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const account = await loadAccount(req.params.accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, account.id))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const parsed = AtelierCreateContactRelationshipInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const { fromContactId, toContactId, type } = parsed.data;
  if (fromContactId === toContactId) {
    res.status(400).json({ error: "self-relationship" });
    return;
  }
  // Both endpoints must be live contacts on this account.
  const endpoints = await db
    .select()
    .from(atelierContacts)
    .where(
      and(
        eq(atelierContacts.accountId, account.id),
        inArray(atelierContacts.id, [fromContactId, toContactId]),
        isNull(atelierContacts.deletedAt),
      ),
    );
  if (endpoints.length !== 2) {
    res.status(404).json({ error: "contact-not-found" });
    return;
  }
  if (type === "reports_to" && (await wouldCreateReportsCycle(account.id, fromContactId, toContactId))) {
    res.status(400).json({ error: "reporting-cycle" });
    return;
  }
  // Dedupe: ignore an identical live edge.
  const [existing] = await db
    .select()
    .from(atelierContactRelationships)
    .where(
      and(
        eq(atelierContactRelationships.accountId, account.id),
        eq(atelierContactRelationships.fromContactId, fromContactId),
        eq(atelierContactRelationships.toContactId, toContactId),
        eq(atelierContactRelationships.type, type),
        isNull(atelierContactRelationships.deletedAt),
      ),
    );
  if (existing) {
    res.status(201).json({
      id: existing.id,
      accountId: existing.accountId,
      fromContactId: existing.fromContactId,
      toContactId: existing.toContactId,
      type: existing.type as "reports_to" | "partners_with" | "blocks",
      notes: existing.notes ?? null,
    });
    return;
  }
  const relId = rid("rel");
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(atelierContactRelationships)
      .values({
        id: relId,
        orgId: account.orgId,
        accountId: account.id,
        fromContactId,
        toContactId,
        type,
        notes: parsed.data.notes?.trim() || null,
      })
      .returning();
    const fromName = endpoints.find((c) => c.id === fromContactId)?.fullName ?? fromContactId;
    const toName = endpoints.find((c) => c.id === toContactId)?.fullName ?? toContactId;
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: account.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "contact.relationship.created",
      payload: { relationshipId: row.id, fromContactId, toContactId, type },
      payloadSummary: `${me.name} linked "${fromName}" ${type.replace(/_/g, " ")} "${toName}".`,
    });
    return row;
  });
  res.status(201).json({
    id: created.id,
    accountId: created.accountId,
    fromContactId: created.fromContactId,
    toContactId: created.toContactId,
    type: created.type as "reports_to" | "partners_with" | "blocks",
    notes: created.notes ?? null,
  });
});

// Soft-delete a relationship edge.
// @cli-skip: pending Task #340 read-parity migration
router.delete("/contact-relationships/:relationshipId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [rel] = await db
    .select()
    .from(atelierContactRelationships)
    .where(
      and(
        eq(atelierContactRelationships.id, req.params.relationshipId),
        isNull(atelierContactRelationships.deletedAt),
      ),
    );
  if (!rel) {
    res.status(404).json({ error: "relationship-not-found" });
    return;
  }
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, rel.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(atelierContactRelationships)
      .set({ deletedAt: new Date() })
      .where(eq(atelierContactRelationships.id, rel.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: rel.accountId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "contact.relationship.removed",
      payload: { relationshipId: rel.id, fromContactId: rel.fromContactId, toContactId: rel.toContactId, type: rel.type },
      payloadSummary: `${me.name} removed a ${rel.type.replace(/_/g, " ")} link.`,
    });
  });
  res.status(204).end();
});

// ---------- credentials ----------
// @cli-skip: pending Task #340 read-parity migration
router.get("/credentials", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierCredentials)
    .where(isNull(atelierCredentials.deletedAt))
    .orderBy(desc(atelierCredentials.createdAt));
  res.json(
    rows.map((c) => ({
      id: c.id,
      title: c.title,
      accountId: c.accountId ?? null,
      clientName: c.clientName,
      sector: c.sector,
      engagementType: c.engagementType,
      anonymizationStatus: c.anonymizationStatus,
      redactedAbstract: c.redactedAbstract,
      attributedAbstract: c.attributedAbstract ?? null,
      outcomeMetrics: c.outcomeMetrics ?? [],
      evidenceLinks: c.evidenceLinks ?? [],
      relatedAssetId: c.relatedAssetId ?? null,
      tags: c.tags ?? [],
      createdAt: new Date(c.createdAt).toISOString(),
    })),
  );
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/credentials", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const parsed = AtelierCredentialInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const id = `cred_${rid("x").slice(2)}`;
  const c = await db.transaction(async (tx) => {
    await tx.insert(atelierCredentials).values({
      id,
      title: parsed.data.title,
      accountId: parsed.data.accountId ?? null,
      clientName: parsed.data.clientName,
      sector: parsed.data.sector,
      engagementType: parsed.data.engagementType,
      anonymizationStatus: parsed.data.anonymizationStatus ?? "redacted",
      redactedAbstract: parsed.data.redactedAbstract,
      attributedAbstract: parsed.data.attributedAbstract ?? null,
      outcomeMetrics: parsed.data.outcomeMetrics ?? [],
      evidenceLinks: parsed.data.evidenceLinks ?? [],
      tags: parsed.data.tags ?? [],
      createdByUserId: me.id,
    });
    const [row] = await tx.select().from(atelierCredentials).where(eq(atelierCredentials.id, id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "credential",
      entityId: id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "credential.create",
      payload: { title: row.title, sector: row.sector },
      payloadSummary: `${me.name} added Credential "${row.title}".`,
    });
    return row;
  });
  res.status(201).json({
    id: c.id,
    title: c.title,
    accountId: c.accountId ?? null,
    clientName: c.clientName,
    sector: c.sector,
    engagementType: c.engagementType,
    anonymizationStatus: c.anonymizationStatus,
    redactedAbstract: c.redactedAbstract,
    attributedAbstract: c.attributedAbstract ?? null,
    outcomeMetrics: c.outcomeMetrics ?? [],
    evidenceLinks: c.evidenceLinks ?? [],
    relatedAssetId: c.relatedAssetId ?? null,
    tags: c.tags ?? [],
    createdAt: new Date(c.createdAt).toISOString(),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.put("/credentials/:credentialId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const parsed = AtelierCredentialInput.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierCredentials)
    .where(and(eq(atelierCredentials.id, req.params.credentialId), isNull(atelierCredentials.deletedAt)));
  if (!existing) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const patch: Partial<typeof atelierCredentials.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.clientName !== undefined) patch.clientName = parsed.data.clientName;
    if (parsed.data.sector !== undefined) patch.sector = parsed.data.sector;
    if (parsed.data.engagementType !== undefined) patch.engagementType = parsed.data.engagementType;
    // anonymizationStatus is NOT NULL in the schema; only apply when the
    // partial update supplies a non-null value.
    if (parsed.data.anonymizationStatus) patch.anonymizationStatus = parsed.data.anonymizationStatus;
    if (parsed.data.redactedAbstract !== undefined) patch.redactedAbstract = parsed.data.redactedAbstract;
    if (parsed.data.attributedAbstract !== undefined) patch.attributedAbstract = parsed.data.attributedAbstract;
    if (parsed.data.outcomeMetrics !== undefined) patch.outcomeMetrics = parsed.data.outcomeMetrics;
    if (parsed.data.evidenceLinks !== undefined) patch.evidenceLinks = parsed.data.evidenceLinks;
    if (parsed.data.tags !== undefined) patch.tags = parsed.data.tags;
    await tx
      .update(atelierCredentials)
      .set(patch)
      .where(eq(atelierCredentials.id, existing.id));
    const [row] = await tx.select().from(atelierCredentials).where(eq(atelierCredentials.id, existing.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "credential",
      entityId: existing.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "credential.update",
      payload: { fields: Object.keys(parsed.data) },
      payloadSummary: `${me.name} updated Credential "${row.title}".`,
    });
    return row;
  });
  res.json({
    id: updated.id,
    title: updated.title,
    accountId: updated.accountId ?? null,
    clientName: updated.clientName,
    sector: updated.sector,
    engagementType: updated.engagementType,
    anonymizationStatus: updated.anonymizationStatus,
    redactedAbstract: updated.redactedAbstract,
    attributedAbstract: updated.attributedAbstract ?? null,
    outcomeMetrics: updated.outcomeMetrics ?? [],
    evidenceLinks: updated.evidenceLinks ?? [],
    relatedAssetId: updated.relatedAssetId ?? null,
    tags: updated.tags ?? [],
    createdAt: new Date(updated.createdAt).toISOString(),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.delete("/credentials/:credentialId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierCredentials)
    .where(and(eq(atelierCredentials.id, req.params.credentialId), isNull(atelierCredentials.deletedAt)));
  if (!existing) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(atelierCredentials)
      .set({ deletedAt: new Date() })
      .where(eq(atelierCredentials.id, existing.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "credential",
      entityId: existing.id,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "credential.delete",
      payload: { title: existing.title },
      payloadSummary: `${me.name} retired Credential "${existing.title}".`,
    });
  });
  res.status(204).send();
});

// -------------------------------------------------------------------
// Task #1191 — Account client logo upload / serve / delete
// -------------------------------------------------------------------

// SVG is intentionally excluded: an SVG with embedded script would be stored
// and served as same-origin content, creating a stored XSS vector.
const LOGO_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Validate image magic bytes rather than trusting the client-supplied
 * Content-Type / multer MIME string.  Returns the canonical MIME string for a
 * recognised raster format, or null when the bytes don't match any allowlisted
 * signature.  Only raster formats (JPEG, PNG, WebP, GIF) are accepted — SVG is
 * rejected regardless of declared MIME type.
 */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png";
  // GIF: GIF87a or GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
      (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) return "image/gif";
  // WebP: RIFF????WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp";
  return null;
}

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_BYTES, files: 1 },
});

function logoMulterWrapped(
  handler: ReturnType<typeof logoUpload.single>,
): (req: Request, res: Response, next: (err?: unknown) => void) => void {
  return (req, res, next) => {
    handler(req, res, (err?: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({ error: err.code.toLowerCase().replace(/_/g, "-"), message: err.message });
        return;
      }
      res.status(400).json({ error: "upload-error", message: String(err) });
    });
  };
}

// POST /accounts/:accountId/logo — upload / replace client logo
// @cli-skip: binary upload
router.post(
  "/accounts/:accountId/logo",
  logoMulterWrapped(logoUpload.single("logo")),
  async (req: Request, res: Response) => {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!CREATE_ROLES.has(me.role)) {
      res.status(403).json({ error: "partner-only", reason: "Only Partner or Senior Manager personas can upload a client logo." });
      return;
    }
    const accountId = String(req.params.accountId ?? "");
    const access = await accessibleEngagementIds(me);
    if (!(await canSeeAccount(access, me, accountId))) {
      res.status(403).json({ error: "account-forbidden" });
      return;
    }
    const account = await loadAccount(accountId);
    if (!account) { res.status(404).json({ error: "not-found" }); return; }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) { res.status(400).json({ error: "missing-file", reason: "No file attached (field name: logo)." }); return; }

    // Validate magic bytes rather than trusting the client-supplied MIME type.
    // This rejects forged Content-Type headers and SVG files even when the
    // client declares them as image/png.  SVG is never accepted because
    // inline scripts in SVG would create a stored XSS vector when served
    // same-origin.
    const sniffed = sniffImageMime(file.buffer);
    if (!sniffed) {
      res.status(400).json({ error: "invalid-mime", reason: "File must be a JPEG, PNG, WebP or GIF image (SVG is not accepted)." });
      return;
    }

    // Store new bytes, then drop the old blob (in that order for safety).
    const { fileRef } = await storeAccountLogoBytes(file.buffer, sniffed);
    const oldRef = account.clientLogoRef ?? null;

    await db
      .update(atelierAccounts)
      .set({ clientLogoRef: fileRef, updatedAt: new Date() })
      .where(eq(atelierAccounts.id, accountId));

    if (oldRef) {
      await dropAccountLogoBytes(oldRef).catch(() => { /* non-fatal */ });
    }

    res.status(201).json({ ok: true, clientLogoUrl: `/api/atelier/accounts/${accountId}/logo` });
  },
);

// GET /accounts/:accountId/logo — stream the logo bytes
// @cli-skip: binary image stream
router.get("/accounts/:accountId/logo", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const { accountId } = req.params;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const account = await loadAccount(accountId);
  if (!account || !account.clientLogoRef) {
    res.status(404).json({ error: "no-logo" });
    return;
  }
  const result = await loadAccountLogoBytes(account.clientLogoRef);
  if (!result) { res.status(404).json({ error: "no-logo" }); return; }

  // Defense-in-depth headers: nosniff prevents the browser from re-sniffing
  // the content type; the restrictive CSP blocks any script/embed within the
  // image response even if a non-raster asset somehow reached storage; the
  // inline disposition allows <img> rendering while discouraging navigation.
  res.setHeader("Content-Type", result.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(result.buf);
});

// DELETE /accounts/:accountId/logo — remove the client logo
// @cli-skip: destructive image removal
router.delete("/accounts/:accountId/logo", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!CREATE_ROLES.has(me.role)) {
    res.status(403).json({ error: "partner-only" });
    return;
  }
  const { accountId } = req.params;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const account = await loadAccount(accountId);
  if (!account) { res.status(404).json({ error: "not-found" }); return; }

  const oldRef = account.clientLogoRef ?? null;
  if (!oldRef) { res.json({ ok: true }); return; }

  await db
    .update(atelierAccounts)
    .set({ clientLogoRef: null, updatedAt: new Date() })
    .where(eq(atelierAccounts.id, accountId));

  await dropAccountLogoBytes(oldRef).catch(() => { /* non-fatal */ });
  res.json({ ok: true });
});

// -------------------------------------------------------------------
// Account research brief — PDF download
// -------------------------------------------------------------------
// @cli-skip: binary PDF export; no CLI tool shape
router.get("/accounts/:accountId/research-brief.pdf", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const { accountId } = req.params;
  const access = await accessibleEngagementIds(me);
  const visible = await canSeeAccount(access, me, accountId);
  // 404 (not 403) to avoid IDOR oracle on account existence.
  if (!visible) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  const account = await loadAccount(accountId);
  if (!account) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  if (!account.researchBrief) {
    res.status(404).json({ error: "no-brief" });
    return;
  }

  const brief = account.researchBrief as Parameters<typeof buildAccountResearchBriefPdf>[1]["researchBrief"];
  const entityName = account.brandName ?? account.name;

  // Safe ASCII slug for the filename; httpFilename handles non-ASCII via RFC 5987.
  const slug = entityName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "account";
  const filename = `research-brief-${slug}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", contentDispositionFilename("attachment", filename));

  const doc = createBriefDoc();
  doc.pipe(res);
  buildAccountResearchBriefPdf(doc, { accountName: entityName, researchBrief: brief, generatedAt: new Date() });
  doc.end();
});

export default router;
