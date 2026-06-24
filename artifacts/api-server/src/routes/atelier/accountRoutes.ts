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
} from "@workspace/db";
import { accessibleEngagementIds } from "./engagementRoutes.js";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import {
  computeAccountFinancials,
  computeAccountHealth,
  buildRelationshipTimeline,
  buildRenewalsAndActions,
  countOpenRisks,
} from "../../lib/atelier-account-360.js";
import { buildAccountPlan } from "../../lib/atelier-account-plan.js";

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
  me: { id: string },
  accountId: string,
): Promise<boolean> {
  if (access.all) return true;
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
} from "@workspace/api-zod";
import {
  runAccountCartographer,
  runWhitespaceMapper,
  runQbrComposer,
  buildCartographerProposals,
  type PendingProfileUpdate,
  type WhitespaceOutput,
  type QbrOutput,
} from "../../lib/atelier-agents/runner.js";

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

async function loadCartographerStatus(
  accountId: string,
): Promise<{ status: "running" | "failed" | null; phase: string | null }> {
  const [latest] = await db
    .select({
      status: atelierAgentRuns.status,
      statusMessage: atelierAgentRuns.statusMessage,
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
  if (latest.status === "running") {
    // Surface the latest live phase (e.g. "Synthesising the brief… (42s)")
    // so the account page shows a meaningful, updating label rather than a
    // bare indefinite spinner.
    return { status: "running", phase: latest.statusMessage ?? null };
  }
  if (latest.status === "failed") return { status: "failed", phase: null };
  return { status: null, phase: null };
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
    (o) => !["won", "lost", "no_go", "closed"].includes(o.plmStage as string),
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
    relationshipStrength: Number(a.relationshipStrength ?? 0),
    openOpportunityCount: openOpps.length,
    activeEngagementCount: activeEngs.length,
    lastTouchAt: lastTouch ? new Date(lastTouch.updatedAt).toISOString() : null,
    enrichedAt: a.enrichedAt ? new Date(a.enrichedAt).toISOString() : null,
    pendingUpdateCount: pending.length,
    cartographerStatus,
    cartographerPhase,
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
  const rows = await db
    .select()
    .from(atelierAccounts)
    .where(isNull(atelierAccounts.deletedAt));
  let filtered = rows;
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
const CREATE_ROLES = new Set(["founding_partner", "partner", "senior_manager"]);

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

  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccounts)
      .set({
        industryCode: research.industryCode ?? account.industryCode ?? null,
        subIndustryCode:
          research.subIndustryCode ?? account.subIndustryCode ?? null,
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
        | "c_suite" | "vp" | "director" | "manager" | "ic" | null;
      const id = rid("con");
      await tx.insert(atelierContacts).values({
        id,
        orgId: account.orgId,
        accountId: account.id,
        fullName: dm.fullName.trim(),
        title: dm.title ?? null,
        seniority,
        entityName: dm.entityName ?? null,
        entityScope: dm.entityScope ?? null,
        buyerPersona: dm.buyerPersona ?? null,
        influenceScore:
          seniority === "c_suite" ? 5 : seniority === "vp" ? 4 : 3,
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
    let edgeCount = 0;
    for (const dm of decisionMakers) {
      const reportsToName = (dm.reportsToName ?? "").trim();
      if (!reportsToName) continue;
      const fromId = nameToId.get(dm.fullName.trim().toLowerCase());
      const toId = nameToId.get(reportsToName.toLowerCase());
      if (fromId && toId && fromId !== toId) {
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
      input.partnerOwnerId ??
      (me.role === "partner" || me.role === "founding_partner" ? me.id : null);
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
  const normalisedName = trimmedName.toLowerCase();

  // Duplicate (case-insensitive) within org, excluding soft-deleted rows.
  const sameOrgRows = await db
    .select({ id: atelierAccounts.id, name: atelierAccounts.name })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt)));
  const dup = sameOrgRows.find((r) => r.name.trim().toLowerCase() === normalisedName);
  if (dup) {
    res.status(409).json({
      error: "duplicate-name",
      existingAccountId: dup.id,
      message: `An account with this legal name already exists.`,
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
        partnerOwnerId: input.partnerOwnerId ?? ((me.role === "partner" || me.role === "founding_partner") ? me.id : null),
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
    const fresh = (await loadAccount(inserted.id)) ?? inserted;
    const access = await accessibleEngagementIds(me);
    const summary = await summariseAccount(fresh, access, me);
    res.status(201).json(summary);
    return;
  }

  // Fire-and-forget Cartographer auto-run. We do not await so the HTTP
  // response stays snappy; the Profile tab polls for completion. Only taken
  // when no reviewed research accompanied the create request (e.g. the CRM
  // "New account" button rather than the chat "Review & Create" flow).
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
      await db.transaction(async (tx) => {
        await tx
          .update(atelierAccounts)
          .set({
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
          await tx.insert(atelierContacts).values({
            id: rid("con"),
            orgId: inserted.orgId,
            accountId: inserted.id,
            fullName: d.fullName.trim(),
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
    } catch (err) {
      console.warn("[atelier] auto-on-create cartographer failed", err);
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
    }
  })();

  const access = await accessibleEngagementIds(me);
  const summary = await summariseAccount(inserted, access, me);
  res.status(201).json(summary);
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
    plmStage: o.plmStage,
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
      competitors: a.competitors ?? [],
      researchBrief: a.researchBrief ?? null,
      parentAccountId: a.parentAccountId ?? null,
      parent: parentRow ? hierarchyRef(parentRow) : null,
      children: childRows.map(hierarchyRef),
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
    contacts: contacts.map((c) => toContactWire(c, ownerName(c.contactOwnerId))),
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

// @cli-skip: pending Task #340 read-parity migration
router.get("/accounts/:accountId", async (req, res) => {
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
  res.json(ws);
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

// ===================================================================
// Account insights + account team (Task #569)
// -------------------------------------------------------------------
// INSIGHTS: a human, attributed, timestamped feed distinct from AI
// research and the audit trail. Anyone who can see the account may post;
// edit/delete is author-scoped. TEAM: the partner owner plus additional
// members; managing the team is gated to partner-tier + senior_manager
// (the same CREATE_ROLES that own account strategy). Every mutation is
// written to the audit trail.
// ===================================================================

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

// ===================================================================
// Account planning & execution layer (Task #571)
// -------------------------------------------------------------------
// Action plan, account risk register, and goal progress. Reads are
// embedded in the workspace (gated by canSeeAccount). Writes are gated
// to people who actively manage the account: partner-tier / senior
// manager (CREATE_ROLES), the account's partner owner, or a member of
// the account team whose role is account_manager / delivery_lead /
// partner. Every mutation is audited and returns the fresh workspace.
// ===================================================================
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

  const ws = await buildWorkspace(a.id, access, me);
  res.json(ws);
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

  const { runId, output } = await runAccountCartographer({
    accountId: a.id,
    accountName: a.name,
    accountSector: a.sector,
    accountCountry: a.country,
    accountHqCity: a.hqCity ?? null,
    triggeredByUserId: me.id,
    actorLabel: "Account Cartographer",
    focusOpportunityId,
  });
  void runId;

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

  const proposals = buildCartographerProposals({
    proposedBy: "ag_account_cartographer",
    output,
    account: a,
    existingContacts,
  });

  const queue = ((a.pendingProfileUpdates as PendingProfileUpdate[] | null) ?? []).concat(
    proposals,
  );

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

  const ws = await buildWorkspace(a.id, access, me);
  res.json(ws);
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
    // Lazy contact map — only loaded if a contact proposal is approved.
    let nameToId: Map<string, string> | null = null;
    const loadContacts = async () => {
      if (nameToId) return nameToId;
      const rows = await tx
        .select({ id: atelierContacts.id, fullName: atelierContacts.fullName })
        .from(atelierContacts)
        .where(and(eq(atelierContacts.accountId, a.id), isNull(atelierContacts.deletedAt)));
      nameToId = new Map(rows.map((c) => [c.fullName.toLowerCase(), c.id]));
      return nameToId;
    };

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
            const map = await loadContacts();
            const key = dm.fullName.toLowerCase();
            const existingId = map.get(key);
            const seniority = (dm.seniority ?? null) as
              | "c_suite" | "vp" | "director" | "manager" | "ic" | null;
            if (existingId) {
              await tx
                .update(atelierContacts)
                .set({
                  title: dm.title ?? null,
                  seniority,
                  entityName: dm.entityName ?? null,
                  entityScope: dm.entityScope ?? null,
                  buyerPersona: dm.buyerPersona ?? null,
                  timeInRole: dm.timeInRole ?? null,
                  careerHistory: dm.careerHistory ?? [],
                  education: dm.education ?? [],
                  sourceUrl: dm.sourceUrl ?? null,
                  confidence: (dm.confidence ?? "inferred") as "verified" | "inferred",
                  updatedAt: now,
                })
                .where(eq(atelierContacts.id, existingId));
            } else {
              const newId = rid("ct");
              await tx.insert(atelierContacts).values({
                id: newId,
                accountId: a.id,
                fullName: dm.fullName,
                title: dm.title ?? null,
                seniority,
                entityName: dm.entityName ?? null,
                entityScope: dm.entityScope ?? null,
                buyerPersona: dm.buyerPersona ?? null,
                timeInRole: dm.timeInRole ?? null,
                careerHistory: dm.careerHistory ?? [],
                education: dm.education ?? [],
                influenceScore: seniority === "c_suite" ? 5 : seniority === "vp" ? 4 : 3,
                disposition: "unknown",
                notes: dm.rationale ?? null,
                sourceUrl: dm.sourceUrl ?? null,
                confidence: (dm.confidence ?? "inferred") as "verified" | "inferred",
                createdByUserId: me.id,
              });
              map.set(key, newId);
            }
            // reports_to edge — only when the manager already exists.
            const reportsToName = (dm.reportsToName ??
              (target.meta?.reportsToName as string | null | undefined)) ?? null;
            if (reportsToName) {
              const fromId = map.get(dm.fullName.toLowerCase());
              const toId = map.get(reportsToName.toLowerCase());
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
  res.json(toContactWire(updated, await resolveOwnerName(updated.contactOwnerId, updated.orgId)));
});

// ---------- contact CRUD (Task #554) ----------
function toContactWire(
  c: typeof atelierContacts.$inferSelect,
  ownerName?: string | null,
) {
  return {
    id: c.id,
    accountId: c.accountId,
    fullName: c.fullName,
    title: c.title ?? null,
    seniority: (c.seniority ?? null) as
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
  const fullName = input.fullName.trim();
  if (!fullName) {
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
    const [row] = await tx
      .insert(atelierContacts)
      .values({
        id: contactId,
        orgId: account.orgId,
        accountId: account.id,
        fullName,
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
  res.status(201).json(toContactWire(created, await resolveOwnerName(created.contactOwnerId, created.orgId)));
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
  const parsed = AtelierUpdateContactInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const patch: Partial<typeof atelierContacts.$inferInsert> = {};
  const changed: string[] = [];
  if (input.fullName !== undefined) {
    const name = input.fullName.trim();
    if (!name) {
      res.status(400).json({ error: "name-required" });
      return;
    }
    patch.fullName = name;
    changed.push("fullName");
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
    res.json(toContactWire(c, await resolveOwnerName(c.contactOwnerId, c.orgId)));
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
  res.json(toContactWire(updated, await resolveOwnerName(updated.contactOwnerId, updated.orgId)));
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

// ---------- contact relationships (Task #567) ----------
// Detect whether adding `from reports_to to` would create a reporting cycle by
// walking the existing reports_to chain upward from `to`.
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

export default router;
