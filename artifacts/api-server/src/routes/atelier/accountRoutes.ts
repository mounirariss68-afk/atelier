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
  return {
    id: a.id,
    name: a.name,
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
  };
}

const router: IRouter = Router();

// ---------- list ----------
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

// ---------- workspace ----------
async function buildWorkspace(accountId: string, access: EngAccess) {
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

  return {
    account: {
      ...summary,
      notes: a.notes ?? null,
      strategicPriorities: a.strategicPriorities ?? [],
      aicoHypothesis: a.aicoHypothesis ?? null,
      sourceSignals: a.sourceSignals ?? [],
      pendingProfileUpdates: a.pendingProfileUpdates ?? [],
    },
    contacts: contacts.map((c) => ({
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
      disposition: (c.disposition ?? "unknown") as
        | "champion"
        | "supporter"
        | "neutral"
        | "skeptic"
        | "blocker"
        | "unknown",
      lastContactAt: c.lastContactAt ? new Date(c.lastContactAt).toISOString() : null,
      contactOwnerId: c.contactOwnerId ?? null,
      notes: c.notes ?? null,
    })),
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

router.get("/accounts/:accountId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const ws = await buildWorkspace(req.params.accountId, access);
  if (!ws) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  res.json(ws);
});

// ---------- cartographer refresh ----------
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

  const { output } = await runAccountCartographer({
    accountId: a.id,
    accountName: a.name,
    accountSector: a.sector,
    accountCountry: a.country,
    triggeredByUserId: me.id,
    actorLabel: "Account Cartographer",
    focusOpportunityId,
  });

  // Governed-write: persist signals + queue proposed updates as pending
  // chips on the account. Do NOT auto-apply — partner must approve.
  const existingPending = a.pendingProfileUpdates ?? [];
  const newProposals = (output.proposedProfileUpdates ?? []).map((p) => ({
    id: rid("ppu"),
    proposedBy: "ag_account_cartographer",
    proposedAt: new Date().toISOString(),
    field: p.field,
    fromValue: p.fromValue,
    toValue: p.toValue,
    rationale: p.rationale,
    status: "pending" as const,
  }));
  const mergedSignals = [...(a.sourceSignals ?? []), ...(output.sourceSignals ?? [])].slice(-20);

  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccounts)
      .set({
        sourceSignals: mergedSignals,
        pendingProfileUpdates: [...existingPending, ...newProposals],
        enrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(atelierAccounts.id, a.id));

    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: a.id,
      actorType: "agent",
      actorId: "ag_account_cartographer",
      actorLabel: "Account Cartographer",
      action: "cartographer.refresh",
      payload: { proposedCount: newProposals.length, signalCount: output.sourceSignals?.length ?? 0 },
      payloadSummary: `Cartographer queued ${newProposals.length} profile-update proposal(s) for ${a.name}.`,
    });
  });

  const ws = await buildWorkspace(a.id, access);
  res.json(ws);
});

// ---------- contacts (graph) ----------
router.get("/accounts/:accountId/contacts", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const access = await accessibleEngagementIds(me);
  if (!(await canSeeAccount(access, me, req.params.accountId))) {
    res.status(403).json({ error: "account-forbidden" });
    return;
  }
  const ws = await buildWorkspace(req.params.accountId, access);
  if (!ws) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  res.json({ contacts: ws.contacts, relationships: ws.relationships });
});

// ---------- whitespace ----------
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
router.post("/accounts/:accountId/profile-updates/:updateId/decision", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
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
    } else if (f === "aicoHypothesis" && typeof target.toValue === "string") {
      updates.aicoHypothesis = target.toValue;
    } else if (f === "sector" && typeof target.toValue === "string") {
      updates.sector = target.toValue;
    } else if (f === "hqCity" && typeof target.toValue === "string") {
      updates.hqCity = target.toValue;
    } else if (f === "size" && typeof target.toValue === "string") {
      updates.size = target.toValue;
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
      payload: { updateId: target.id, field: target.field, toValue: target.toValue },
      payloadSummary: `${me.name} ${decision}d Cartographer proposal on field "${target.field}".`,
    });
  });

  const access = await accessibleEngagementIds(me);
  const ws = await buildWorkspace(a.id, access);
  res.json(ws);
});

// ---------- contact disposition ----------
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
  await db.transaction(async (tx) => {
    await tx
      .update(atelierContacts)
      .set({ disposition: parsed.data.disposition, updatedAt: new Date() })
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
  res.json({
    id: updated.id,
    accountId: updated.accountId,
    fullName: updated.fullName,
    title: updated.title ?? null,
    seniority: (updated.seniority ?? null) as
      | "c_suite"
      | "vp"
      | "director"
      | "manager"
      | "ic"
      | "unknown"
      | null,
    email: updated.email ?? null,
    phone: updated.phone ?? null,
    linkedinUrl: updated.linkedinUrl ?? null,
    buyerPersona: updated.buyerPersona ?? null,
    influenceScore: updated.influenceScore ?? 3,
    disposition: updated.disposition as
      | "champion"
      | "supporter"
      | "neutral"
      | "skeptic"
      | "blocker"
      | "unknown",
    lastContactAt: updated.lastContactAt ? new Date(updated.lastContactAt).toISOString() : null,
    contactOwnerId: updated.contactOwnerId ?? null,
    notes: updated.notes ?? null,
  });
});

// ---------- credentials ----------
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

router.post("/credentials", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
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

router.put("/credentials/:credentialId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
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
    await tx
      .update(atelierCredentials)
      .set({
        ...(parsed.data.title !== undefined && { title: parsed.data.title }),
        ...(parsed.data.clientName !== undefined && { clientName: parsed.data.clientName }),
        ...(parsed.data.sector !== undefined && { sector: parsed.data.sector }),
        ...(parsed.data.engagementType !== undefined && { engagementType: parsed.data.engagementType }),
        ...(parsed.data.anonymizationStatus !== undefined && { anonymizationStatus: parsed.data.anonymizationStatus }),
        ...(parsed.data.redactedAbstract !== undefined && { redactedAbstract: parsed.data.redactedAbstract }),
        ...(parsed.data.attributedAbstract !== undefined && { attributedAbstract: parsed.data.attributedAbstract }),
        ...(parsed.data.outcomeMetrics !== undefined && { outcomeMetrics: parsed.data.outcomeMetrics }),
        ...(parsed.data.evidenceLinks !== undefined && { evidenceLinks: parsed.data.evidenceLinks }),
        ...(parsed.data.tags !== undefined && { tags: parsed.data.tags }),
        updatedAt: new Date(),
      })
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

router.delete("/credentials/:credentialId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner") {
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
