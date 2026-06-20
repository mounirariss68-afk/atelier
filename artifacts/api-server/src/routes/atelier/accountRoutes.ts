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
} from "@workspace/db";
import { accessibleEngagementIds } from "./engagementRoutes.js";

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
async function canSeeAccount(
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
  AtelierRefreshAccountCartographerBody as AtelierCartographerRefreshInput,
  AtelierCreateCredentialBody as AtelierCredentialInput,
  AtelierCreateAccountBody as AtelierCreateAccountInput,
  AtelierUpdateAccountBody as AtelierUpdateAccountInput,
  AtelierCreateContactBody as AtelierCreateContactInput,
  AtelierUpdateContactBody as AtelierUpdateContactInput,
  AtelierCreateContactRelationshipBody as AtelierCreateContactRelationshipInput,
} from "@workspace/api-zod";
import {
  runAccountCartographer,
  runWhitespaceMapper,
  runQbrComposer,
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
): Promise<"running" | "failed" | null> {
  const [latest] = await db
    .select({ status: atelierAgentRuns.status })
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
  if (!latest) return null;
  if (latest.status === "running") return "running";
  if (latest.status === "failed") return "failed";
  return null;
}

async function summariseAccount(
  a: typeof atelierAccounts.$inferSelect,
  access: EngAccess,
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
  const cartographerStatus = await loadCartographerStatus(a.id);
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
    relationshipStrength: Number(a.relationshipStrength ?? 0),
    openOpportunityCount: openOpps.length,
    activeEngagementCount: activeEngs.length,
    lastTouchAt: lastTouch ? new Date(lastTouch.updatedAt).toISOString() : null,
    enrichedAt: a.enrichedAt ? new Date(a.enrichedAt).toISOString() : null,
    pendingUpdateCount: pending.length,
    cartographerStatus,
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
  const out = await Promise.all(allowed.map((a) => summariseAccount(a, access)));
  res.json(out);
});

// ---------- create ----------
// Task #292 — CRM account creation: partner-tier + senior_manager.
const CREATE_ROLES = new Set(["founding_partner", "partner", "senior_manager"]);

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

  // Fire-and-forget Cartographer auto-run. We do not await so the HTTP
  // response stays snappy; the Profile tab polls for completion.
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
            buyerPersona: d.buyerPersona ?? null,
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
  const summary = await summariseAccount(inserted, access);
  res.status(201).json(summary);
});

// ---------- workspace ----------
async function buildWorkspace(accountId: string, access: EngAccess, me: { id: string }) {
  const a = await loadAccount(accountId);
  if (!a) return null;
  const summary = await summariseAccount(a, access);
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

  return {
    account: {
      ...summary,
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
    payload: { fields: changed },
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

  // Task #275 — DIRECT WRITE. Cartographer is now grounded by Anthropic
  // web_search and produces citation URLs for every priority + contact,
  // so we apply the result straight to the account workspace instead of
  // queuing pending proposals. Refresh-from-web is idempotent: signals
  // dedupe on URL, contacts dedupe on lower-cased fullName.
  const incomingSignals = output.sourceSignals ?? [];
  const existingSignals = a.sourceSignals ?? [];
  const seenSignalUrls = new Set(existingSignals.map((s) => s.url));
  const mergedSignals = [
    ...existingSignals,
    ...incomingSignals.filter((s) => !seenSignalUrls.has(s.url)),
  ].slice(-20);

  const priorities = output.account.strategicPriorities ?? [];
  const priorityTexts = priorities.map((p) => p.text);
  const priorityRefs = priorities.map((p) => ({
    text: p.text,
    sourceUrls: Array.isArray(p.sourceUrls) ? p.sourceUrls.filter((u) => typeof u === "string") : [],
  }));

  await db.transaction(async (tx) => {
    // ---- Account: direct-write profile fields ----
    const accountUpdate: Partial<typeof atelierAccounts.$inferInsert> = {
      sourceSignals: mergedSignals,
      enrichedAt: new Date(),
      updatedAt: new Date(),
    };
    if (priorityTexts.length > 0) {
      accountUpdate.strategicPriorities = priorityTexts;
      accountUpdate.strategicPriorityRefs = priorityRefs;
    }
    if (output.account.cogniriseHypothesis && output.account.cogniriseHypothesis.trim().length > 0) {
      accountUpdate.cogniriseHypothesis = output.account.cogniriseHypothesis;
    }
    if (output.account.refreshedSummary && output.account.refreshedSummary.trim().length > 0) {
      accountUpdate.notes = output.account.refreshedSummary;
    }
    await tx.update(atelierAccounts).set(accountUpdate).where(eq(atelierAccounts.id, a.id));

    // ---- Contacts: upsert by fullName (case-insensitive) ----
    const existingContacts = await tx
      .select()
      .from(atelierContacts)
      .where(
        and(eq(atelierContacts.accountId, a.id), isNull(atelierContacts.deletedAt)),
      );
    const byName = new Map<string, (typeof existingContacts)[number]>();
    for (const c of existingContacts) byName.set(c.fullName.toLowerCase(), c);
    const fullNameToId = new Map<string, string>();
    for (const c of existingContacts) fullNameToId.set(c.fullName.toLowerCase(), c.id);

    let inserted = 0;
    let updated = 0;
    for (const dm of output.decisionMakers ?? []) {
      const key = dm.fullName.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        await tx
          .update(atelierContacts)
          .set({
            title: dm.title ?? existing.title,
            seniority: dm.seniority ?? existing.seniority,
            buyerPersona: dm.buyerPersona ?? existing.buyerPersona,
            sourceUrl: dm.sourceUrl ?? existing.sourceUrl,
            confidence: dm.confidence ?? existing.confidence,
            updatedAt: new Date(),
          })
          .where(eq(atelierContacts.id, existing.id));
        updated += 1;
      } else {
        const newId = rid("ct");
        await tx.insert(atelierContacts).values({
          id: newId,
          accountId: a.id,
          fullName: dm.fullName,
          title: dm.title ?? null,
          seniority: dm.seniority ?? null,
          buyerPersona: dm.buyerPersona ?? null,
          influenceScore: dm.seniority === "c_suite" ? 5 : dm.seniority === "vp" ? 4 : 3,
          disposition: "unknown",
          notes: dm.rationale ?? null,
          sourceUrl: dm.sourceUrl ?? null,
          confidence: dm.confidence,
          createdByUserId: me.id,
        });
        fullNameToId.set(key, newId);
        inserted += 1;
      }
    }

    // ---- Relationships: rebuild reports_to edges from reportsToName ----
    const reportsEdges: Array<{
      fromId: string;
      toId: string;
    }> = [];
    for (const dm of output.decisionMakers ?? []) {
      if (!dm.reportsToName) continue;
      const fromId = fullNameToId.get(dm.fullName.toLowerCase());
      const toId = fullNameToId.get(dm.reportsToName.toLowerCase());
      if (fromId && toId && fromId !== toId) {
        reportsEdges.push({ fromId, toId });
      }
    }
    if (reportsEdges.length > 0) {
      // Clear cartographer-managed reports_to edges for this account, then
      // rewrite. We only touch reports_to (not partners_with/blocks, which
      // are partner-curated relationships).
      const existingEdges = await tx
        .select()
        .from(atelierContactRelationships)
        .where(
          and(
            eq(atelierContactRelationships.accountId, a.id),
            eq(atelierContactRelationships.type, "reports_to"),
            isNull(atelierContactRelationships.deletedAt),
          ),
        );
      const haveEdge = new Set(existingEdges.map((e) => `${e.fromContactId}->${e.toContactId}`));
      for (const e of reportsEdges) {
        const k = `${e.fromId}->${e.toId}`;
        if (haveEdge.has(k)) continue;
        await tx.insert(atelierContactRelationships).values({
          id: rid("cr"),
          accountId: a.id,
          fromContactId: e.fromId,
          toContactId: e.toId,
          type: "reports_to",
        });
        haveEdge.add(k);
      }
    }

    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: a.id,
      actorType: "agent",
      actorId: "ag_account_cartographer",
      actorLabel: "Account Cartographer",
      action: "cartographer.refresh",
      payload: {
        signalCount: incomingSignals.length,
        priorityCount: priorityTexts.length,
        contactsInserted: inserted,
        contactsUpdated: updated,
      },
      payloadSummary: `Cartographer wrote ${priorityTexts.length} priorities, ${incomingSignals.length} signals, ${inserted}+${updated} contacts for ${a.name}.`,
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
router.post("/accounts/:accountId/profile-updates/:updateId/decision", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) {
    res.status(403).json({ error: "partner-only", reason: "Only a partner persona can approve or reject Cartographer profile-update proposals." });
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
  const list = a.pendingProfileUpdates ?? [];
  const target = list.find((u) => u.id === req.params.updateId);
  if (!target) {
    res.status(404).json({ error: "proposal-not-found" });
    return;
  }
  // Apply if approved; mark status either way.
  const updates: Partial<typeof atelierAccounts.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (decision === "approve") {
    const f = target.field;
    if (f === "strategicPriorities" && Array.isArray(target.toValue)) {
      updates.strategicPriorities = target.toValue as string[];
    } else if (f === "cogniriseHypothesis" && typeof target.toValue === "string") {
      updates.cogniriseHypothesis = target.toValue;
    } else if (f === "sector" && typeof target.toValue === "string") {
      updates.sector = target.toValue;
    } else if (f === "hqCity" && typeof target.toValue === "string") {
      updates.hqCity = target.toValue;
    } else if (f === "size" && typeof target.toValue === "string") {
      updates.size = target.toValue;
    } else if (f === "sourceSignals" && Array.isArray(target.toValue)) {
      const incoming = target.toValue as Array<{ url?: string }>;
      const existing = (a.sourceSignals as Array<{ url?: string }> | null) ?? [];
      const seen = new Set(existing.map((s) => s.url).filter(Boolean));
      const merged = [...existing];
      for (const sig of incoming) {
        if (sig?.url && !seen.has(sig.url)) {
          merged.push(sig);
          seen.add(sig.url);
        }
      }
      updates.sourceSignals = merged.slice(-50) as typeof a.sourceSignals;
    }
  }
  const newList = list.map((u) =>
    u.id === target.id
      ? { ...u, status: decision === "approve" ? ("approved" as const) : ("rejected" as const) }
      : u,
  );
  updates.pendingProfileUpdates = newList;

  await db.transaction(async (tx) => {
    await tx.update(atelierAccounts).set(updates).where(eq(atelierAccounts.id, a.id));
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
        toValue: target.toValue,
        appliedSignalCount:
          decision === "approve" && target.field === "sourceSignals" && Array.isArray(target.toValue)
            ? (target.toValue as unknown[]).length
            : undefined,
      },
      payloadSummary: `${me.name} ${decision}d Cartographer proposal on field "${target.field}".`,
    });
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
    sourceUrl: c.sourceUrl ?? null,
    confidence: (c.confidence ?? "inferred") as "verified" | "inferred",
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
