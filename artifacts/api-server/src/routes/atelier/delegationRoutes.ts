/**
 * Atelier — Task #386: Executive Assistant delegation.
 *
 * Partners delegate admin work (timesheets, expenses, meetings/tasks) to
 * Executive Assistants. Grants are explicit, scoped, many-to-many and
 * revocable; nothing an EA enters takes effect until the partner approves
 * it — delegated entries land as PENDING ITEMS the partner reviews, and
 * only on approval do they become real artifacts that then follow the
 * normal downstream ladders (timesheet submit ladder, expense policy
 * ladder). Every write carries dual attribution: actor = the person
 * acting, payload.onBehalfOf = the principal ("by EA X on behalf of
 * Partner Y").
 *
 * Partner surfaces (partner | founding_partner):
 *   GET   /me/delegates                     — EA candidates + my grants + review count
 *   POST  /me/delegates                     — create a grant { eaUserId, scopes[] }
 *   PATCH /me/delegates/:id                 — update scopes
 *   POST  /me/delegates/:id/revoke          — revoke a grant
 *   GET   /me/delegates/review              — pending items (with overlap hints)
 *   POST  /me/delegates/review/:id/approve  — apply (idempotent)
 *   POST  /me/delegates/review/:id/reject   — reject with a reason
 *
 * EA surfaces (any persona holding an active grant; EAs keep their
 * employee/contractor role so the /me/* boundary — and the /cli/* block —
 * apply unchanged):
 *   GET   /me/assist                          — my grants + my items
 *   GET   /me/assist/:delegationId/timesheet  — partner week, MONETARY-STRIPPED
 *   POST  /me/assist/:delegationId/items      — propose an item
 *   PATCH /me/assist/items/:id                — edit own pending/rejected item
 *   POST  /me/assist/items/:id/resubmit       — rejected → pending
 *   POST  /me/assist/receipt-upload           — signed upload URL
 *
 * Shared:
 *   GET   /me/ea-items/:id/receipt — receipt stream; uploader EA, the
 *   partner and HR only (server-side gate; object ACL owner stays the EA).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierExpenses,
  atelierAuditEvents,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierEaDelegations,
  atelierEaPendingItems,
} from "@workspace/db";
import {
  resolvePerson,
  resolvePersonForCaller,
  ensureWeekShell,
  entryWire,
  recomputeWeekTotals,
  isoWeekOf,
  parseWeekIso,
} from "./ledgerRoutes";
import { emitSelfNotification } from "./meRoutes";
import { isFoundingPartner, isHr, isPartner } from "./personaRoles.js";
import { convertToUsd } from "../../lib/atelier-fx.js";
import { assertAuditAction } from "./auditContract.js";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../../lib/objectStorage.js";
import { sendReceiptForDisplay } from "../../lib/atelier-heic.js";

const router: IRouter = Router();

const EA_SCOPES = ["timesheets", "expenses", "meetings_tasks"] as const;
type EaScope = (typeof EA_SCOPES)[number];
const EA_SCOPE_SET: ReadonlySet<string> = new Set(EA_SCOPES);

const ITEM_KINDS = ["timesheet_entry", "expense", "meeting_task"] as const;
type ItemKind = (typeof ITEM_KINDS)[number];
const KIND_SCOPE: Record<ItemKind, EaScope> = {
  timesheet_entry: "timesheets",
  expense: "expenses",
  meeting_task: "meetings_tasks",
};

type PersonaRow = typeof atelierUsers.$inferSelect;
type DelegationRow = typeof atelierEaDelegations.$inferSelect;
type PendingItemRow = typeof atelierEaPendingItems.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): PersonaRow | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

function ensurePartner(req: Request, res: Response): PersonaRow | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (!isPartner(me.role) && !isFoundingPartner(me.role)) {
    res.status(403).json({
      error: "forbidden",
      message: "Only partners can manage delegates.",
    });
    return null;
  }
  return me;
}

/**
 * Dual-attribution audit row. When onBehalfOf is set, the actor label
 * reads "by <actor> (EA) on behalf of <principal>" and the payload carries
 * both parties — the audit trail must never show a delegated action as the
 * partner acting alone.
 */
async function audit(args: {
  entityType: string;
  entityId: string;
  actor: PersonaRow;
  onBehalfOf?: { userId: string; name: string } | null;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  assertAuditAction(args.action);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.onBehalfOf
      ? `${args.actor.name} (EA) on behalf of ${args.onBehalfOf.name}`
      : args.actor.name,
    action: args.action,
    payload: args.onBehalfOf
      ? {
          ...args.payload,
          onBehalfOf: { userId: args.onBehalfOf.userId, name: args.onBehalfOf.name },
          actedByEa: { userId: args.actor.id, name: args.actor.name },
        }
      : args.payload,
    payloadSummary: args.summary,
  });
}

async function loadOrgUser(orgId: string, userId: string): Promise<PersonaRow | null> {
  const [u] = await db
    .select()
    .from(atelierUsers)
    .where(
      and(eq(atelierUsers.id, userId), eq(atelierUsers.orgId, orgId), isNull(atelierUsers.deletedAt)),
    );
  return u ?? null;
}

/** Roster EA designation for a user (employee via userId, contractor via email). */
async function isRosterEa(orgId: string, user: PersonaRow): Promise<boolean> {
  const [emp] = await db
    .select({ ea: atelierEmployees.isExecutiveAssistant, status: atelierEmployees.status })
    .from(atelierEmployees)
    .where(
      and(
        eq(atelierEmployees.orgId, orgId),
        eq(atelierEmployees.userId, user.id),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  if (emp) return emp.ea === true;
  const email = user.email.trim().toLowerCase();
  const cons = await db
    .select({ ea: atelierContractors.isExecutiveAssistant, email: atelierContractors.email })
    .from(atelierContractors)
    .where(and(eq(atelierContractors.orgId, orgId), isNull(atelierContractors.deletedAt)));
  return cons.some((c) => c.email?.trim().toLowerCase() === email && c.ea === true);
}

function normalizeScopes(raw: unknown): EaScope[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: EaScope[] = [];
  for (const s of raw) {
    if (typeof s !== "string" || !EA_SCOPE_SET.has(s)) return null;
    if (!out.includes(s as EaScope)) out.push(s as EaScope);
  }
  return out;
}

function delegationWire(d: DelegationRow, names: Map<string, string>) {
  return {
    id: d.id,
    partnerUserId: d.partnerUserId,
    partnerName: names.get(d.partnerUserId) ?? d.partnerUserId,
    eaUserId: d.eaUserId,
    eaName: names.get(d.eaUserId) ?? d.eaUserId,
    scopes: d.scopes,
    status: d.status,
    revokedAt: d.revokedAt?.toISOString() ?? null,
    revokedReason: d.revokedReason,
    createdAt: d.createdAt.toISOString(),
  };
}

function itemWire(i: PendingItemRow, names: Map<string, string>) {
  return {
    id: i.id,
    delegationId: i.delegationId,
    partnerUserId: i.partnerUserId,
    partnerName: names.get(i.partnerUserId) ?? i.partnerUserId,
    eaUserId: i.eaUserId,
    eaName: names.get(i.eaUserId) ?? i.eaUserId,
    kind: i.kind,
    payload: i.payload,
    hasReceipt: !!i.receiptFileRef,
    status: i.status,
    rejectionReason: i.rejectionReason,
    decidedAt: i.decidedAt?.toISOString() ?? null,
    appliedRef: i.appliedRef,
    resubmittedAt: i.resubmittedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

async function nameMap(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids));
  if (!uniq.length) return new Map();
  const rows = await db
    .select({ id: atelierUsers.id, name: atelierUsers.name })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.orgId, orgId), inArray(atelierUsers.id, uniq)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Validate + normalize a proposed payload per kind. Whitelist-only: the
 * EA cannot smuggle monetary/HR fields (rates, approvals) into a payload —
 * only the data-entry fields below survive.
 */
function normalizePayload(
  res: Response,
  kind: ItemKind,
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  if (kind === "timesheet_entry") {
    const workDate = raw.workDate;
    const hours = Number(raw.hours);
    if (!isIsoDate(workDate)) {
      res.status(400).json({ error: "invalid-work-date" });
      return null;
    }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      res.status(400).json({ error: "invalid-hours" });
      return null;
    }
    return {
      workDate,
      hours,
      engagementId:
        typeof raw.engagementId === "string" && raw.engagementId ? raw.engagementId : null,
      activityCode:
        typeof raw.activityCode === "string" && raw.activityCode
          ? String(raw.activityCode).slice(0, 60)
          : null,
      billable: raw.billable === true,
      narrative:
        typeof raw.narrative === "string" ? raw.narrative.slice(0, 2000) : null,
    };
  }
  if (kind === "expense") {
    const amount = Number(raw.amount);
    const merchant = String(raw.merchant ?? "").trim().slice(0, 200);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      res.status(400).json({ error: "invalid-amount" });
      return null;
    }
    if (!merchant) {
      res.status(400).json({ error: "merchant-required" });
      return null;
    }
    return {
      expenseDate: isIsoDate(raw.expenseDate)
        ? raw.expenseDate
        : new Date().toISOString().slice(0, 10),
      merchant,
      amount,
      currency: String(raw.currency ?? "USD").toUpperCase().slice(0, 3),
      category:
        typeof raw.category === "string" && raw.category ? String(raw.category).slice(0, 60) : "other",
      description:
        typeof raw.description === "string" ? raw.description.slice(0, 2000) : null,
    };
  }
  // meeting_task
  const title = String(raw.title ?? "").trim().slice(0, 300);
  if (!title) {
    res.status(400).json({ error: "title-required" });
    return null;
  }
  return {
    title,
    date: isIsoDate(raw.date) ? raw.date : null,
    time:
      typeof raw.time === "string" && /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : null,
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, 2000) : null,
    attendees: typeof raw.attendees === "string" ? raw.attendees.slice(0, 500) : null,
  };
}

/**
 * Auto-revoke every active grant a user sits on (either side) when their
 * login is deactivated. Called from the leaver flow — dangling delegations
 * are a classic audit finding. Returns the number revoked.
 */
export async function autoRevokeDelegationsForUser(args: {
  orgId: string;
  userId: string;
  actor: PersonaRow;
  targetName: string;
}): Promise<number> {
  const rows = await db
    .select()
    .from(atelierEaDelegations)
    .where(
      and(eq(atelierEaDelegations.orgId, args.orgId), eq(atelierEaDelegations.status, "active")),
    );
  const affected = rows.filter(
    (d) => d.partnerUserId === args.userId || d.eaUserId === args.userId,
  );
  for (const d of affected) {
    const reason =
      d.partnerUserId === args.userId ? "partner_deactivated" : "ea_deactivated";
    await db
      .update(atelierEaDelegations)
      .set({
        status: "revoked",
        revokedAt: new Date(),
        revokedByUserId: args.actor.id,
        revokedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(atelierEaDelegations.id, d.id));
    await audit({
      entityType: "ea_delegation",
      entityId: d.id,
      actor: args.actor,
      action: "ea.delegation.revoked",
      payload: {
        partnerUserId: d.partnerUserId,
        eaUserId: d.eaUserId,
        reason,
        via: "leaver-deactivation",
      },
      summary: `Delegation auto-revoked (${reason.replace("_", " ")}: ${args.targetName})`,
    });
    // Tell the surviving party their delegation ended.
    const otherUserId = d.partnerUserId === args.userId ? d.eaUserId : d.partnerUserId;
    await emitSelfNotification({
      orgId: args.orgId,
      userId: otherUserId,
      kind: "ea_delegation_revoked",
      title: "A delegation was ended",
      body: `Your delegation with ${args.targetName} was automatically ended because their account was deactivated.`,
      href: d.partnerUserId === args.userId ? "/me/assist" : "/me/delegates",
    });
  }
  return affected.length;
}

// =====================================================================
// PARTNER SIDE — manage grants
// =====================================================================

// @cli-skip: EA delegation partner surface; no CLI shape (Task #386)
router.get("/me/delegates", async (req, res, next) => {
  try {
    const me = ensurePartner(req, res);
    if (!me) return;
    // Roster EA candidates (active, EA-flagged, holding a login).
    const emps = await db
      .select()
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.orgId, me.orgId),
          eq(atelierEmployees.isExecutiveAssistant, true),
          isNull(atelierEmployees.deletedAt),
        ),
      );
    const cons = await db
      .select()
      .from(atelierContractors)
      .where(
        and(
          eq(atelierContractors.orgId, me.orgId),
          eq(atelierContractors.isExecutiveAssistant, true),
          isNull(atelierContractors.deletedAt),
        ),
      );
    const users = await db
      .select({ id: atelierUsers.id, email: atelierUsers.email, name: atelierUsers.name })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.orgId, me.orgId), isNull(atelierUsers.deletedAt)));
    const byEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u]));
    const candidates: Array<{
      userId: string;
      name: string;
      email: string;
      workerType: string;
      rosterStatus: string;
    }> = [];
    for (const e of emps) {
      if (!e.userId || e.status === "offboarded") continue;
      candidates.push({
        userId: e.userId,
        name: e.fullName,
        email: e.email ?? "",
        workerType: "employee",
        rosterStatus: e.status,
      });
    }
    for (const c of cons) {
      if (c.status === "offboarded") continue;
      const u = c.email ? byEmail.get(c.email.trim().toLowerCase()) : undefined;
      if (!u) continue;
      candidates.push({
        userId: u.id,
        name: c.fullName,
        email: c.email ?? "",
        workerType: "contractor",
        rosterStatus: c.status ?? "active",
      });
    }
    const delegations = await db
      .select()
      .from(atelierEaDelegations)
      .where(
        and(
          eq(atelierEaDelegations.orgId, me.orgId),
          eq(atelierEaDelegations.partnerUserId, me.id),
        ),
      )
      .orderBy(desc(atelierEaDelegations.createdAt));
    const pending = await db
      .select({ id: atelierEaPendingItems.id })
      .from(atelierEaPendingItems)
      .where(
        and(
          eq(atelierEaPendingItems.orgId, me.orgId),
          eq(atelierEaPendingItems.partnerUserId, me.id),
          eq(atelierEaPendingItems.status, "pending"),
          isNull(atelierEaPendingItems.deletedAt),
        ),
      );
    const names = await nameMap(
      me.orgId,
      delegations.flatMap((d) => [d.partnerUserId, d.eaUserId]),
    );
    res.json({
      scopes: EA_SCOPES,
      candidates: candidates.sort((a, b) => a.name.localeCompare(b.name)),
      delegations: delegations.map((d) => delegationWire(d, names)),
      pendingReviewCount: pending.length,
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: EA delegation partner mutation; no CLI shape (Task #386)
router.post("/me/delegates", async (req, res, next) => {
  try {
    const me = ensurePartner(req, res);
    if (!me) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const scopes = normalizeScopes(b.scopes);
    if (!scopes) {
      res.status(400).json({ error: "invalid-scopes", allowed: EA_SCOPES });
      return;
    }
    const eaUserId = String(b.eaUserId ?? "");
    const ea = eaUserId ? await loadOrgUser(me.orgId, eaUserId) : null;
    if (!ea) {
      res.status(404).json({ error: "ea-not-found" });
      return;
    }
    if (ea.id === me.id) {
      res.status(400).json({ error: "cannot-delegate-to-self" });
      return;
    }
    if (!(await isRosterEa(me.orgId, ea))) {
      res.status(400).json({
        error: "not-an-ea",
        message: "That person is not designated as an Executive Assistant on the roster.",
      });
      return;
    }
    const [existing] = await db
      .select()
      .from(atelierEaDelegations)
      .where(
        and(
          eq(atelierEaDelegations.orgId, me.orgId),
          eq(atelierEaDelegations.partnerUserId, me.id),
          eq(atelierEaDelegations.eaUserId, ea.id),
          eq(atelierEaDelegations.status, "active"),
        ),
      );
    if (existing) {
      res.status(409).json({ error: "delegation-exists", delegationId: existing.id });
      return;
    }
    const id = rid("eadel");
    await db.insert(atelierEaDelegations).values({
      id,
      orgId: me.orgId,
      partnerUserId: me.id,
      eaUserId: ea.id,
      scopes,
      status: "active",
      createdByUserId: me.id,
    });
    await audit({
      entityType: "ea_delegation",
      entityId: id,
      actor: me,
      action: "ea.delegation.created",
      payload: { eaUserId: ea.id, eaName: ea.name, scopes },
      summary: `${me.name} delegated ${scopes.join(", ")} to ${ea.name} (EA)`,
    });
    await emitSelfNotification({
      orgId: me.orgId,
      userId: ea.id,
      kind: "ea_delegation_granted",
      title: `${me.name} made you their delegate`,
      body: `You can now assist with: ${scopes.join(", ").replace(/_/g, " ")}.`,
      href: "/me/assist",
    });
    const names = await nameMap(me.orgId, [me.id, ea.id]);
    const [row] = await db
      .select()
      .from(atelierEaDelegations)
      .where(eq(atelierEaDelegations.id, id));
    res.status(201).json({ delegation: delegationWire(row, names) });
  } catch (err) {
    next(err);
  }
});

async function requireOwnDelegation(
  req: Request,
  res: Response,
): Promise<{ me: PersonaRow; row: DelegationRow } | null> {
  const me = ensurePartner(req, res);
  if (!me) return null;
  const [row] = await db
    .select()
    .from(atelierEaDelegations)
    .where(
      and(
        eq(atelierEaDelegations.id, String(req.params.id)),
        eq(atelierEaDelegations.orgId, me.orgId),
        eq(atelierEaDelegations.partnerUserId, me.id),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "delegation-not-found" });
    return null;
  }
  return { me, row };
}

// @cli-skip: EA delegation partner mutation; no CLI shape (Task #386)
router.patch("/me/delegates/:id", async (req, res, next) => {
  try {
    const ctx = await requireOwnDelegation(req, res);
    if (!ctx) return;
    const { me, row } = ctx;
    if (row.status !== "active") {
      res.status(409).json({ error: "delegation-revoked" });
      return;
    }
    const scopes = normalizeScopes((req.body ?? {}).scopes);
    if (!scopes) {
      res.status(400).json({ error: "invalid-scopes", allowed: EA_SCOPES });
      return;
    }
    await db
      .update(atelierEaDelegations)
      .set({ scopes, updatedAt: new Date() })
      .where(eq(atelierEaDelegations.id, row.id));
    await audit({
      entityType: "ea_delegation",
      entityId: row.id,
      actor: me,
      action: "ea.delegation.updated",
      payload: { eaUserId: row.eaUserId, priorScopes: row.scopes, scopes },
      summary: `${me.name} changed delegation scopes to ${scopes.join(", ")}`,
    });
    const names = await nameMap(me.orgId, [row.partnerUserId, row.eaUserId]);
    const [updated] = await db
      .select()
      .from(atelierEaDelegations)
      .where(eq(atelierEaDelegations.id, row.id));
    res.json({ delegation: delegationWire(updated, names) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: EA delegation partner mutation; no CLI shape (Task #386)
router.post("/me/delegates/:id/revoke", async (req, res, next) => {
  try {
    const ctx = await requireOwnDelegation(req, res);
    if (!ctx) return;
    const { me, row } = ctx;
    if (row.status === "revoked") {
      // Idempotent — revoking twice is fine.
      const names = await nameMap(me.orgId, [row.partnerUserId, row.eaUserId]);
      res.json({ delegation: delegationWire(row, names), alreadyRevoked: true });
      return;
    }
    await db
      .update(atelierEaDelegations)
      .set({
        status: "revoked",
        revokedAt: new Date(),
        revokedByUserId: me.id,
        revokedReason: "manual",
        updatedAt: new Date(),
      })
      .where(eq(atelierEaDelegations.id, row.id));
    await audit({
      entityType: "ea_delegation",
      entityId: row.id,
      actor: me,
      action: "ea.delegation.revoked",
      payload: { eaUserId: row.eaUserId, reason: "manual" },
      summary: `${me.name} revoked a delegation`,
    });
    await emitSelfNotification({
      orgId: me.orgId,
      userId: row.eaUserId,
      kind: "ea_delegation_revoked",
      title: `${me.name} ended your delegation`,
      body: "You can no longer act on their behalf.",
      href: "/me/assist",
    });
    const names = await nameMap(me.orgId, [row.partnerUserId, row.eaUserId]);
    const [updated] = await db
      .select()
      .from(atelierEaDelegations)
      .where(eq(atelierEaDelegations.id, row.id));
    res.json({ delegation: delegationWire(updated, names) });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// PARTNER SIDE — review loop
// =====================================================================

/**
 * Overlap hints so the partner can spot duplicates at a glance: their own
 * timesheet entries on the proposed work date / their own expenses within
 * ±3 days of the proposed expense date.
 */
async function overlapHint(
  me: PersonaRow,
  item: PendingItemRow,
): Promise<Record<string, unknown> | null> {
  const p = item.payload as Record<string, unknown>;
  if (item.kind === "timesheet_entry" && isIsoDate(p.workDate)) {
    const person = await resolvePerson(me.id);
    if (!person) return null;
    const rows = await db
      .select({ hours: atelierTimesheetEntries.hours })
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.personId, person.id),
          eq(atelierTimesheetEntries.workDate, p.workDate),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      );
    if (!rows.length) return null;
    return {
      kind: "same_day_entries",
      count: rows.length,
      totalHours: +rows.reduce((s, r) => s + Number(r.hours ?? 0), 0).toFixed(2),
    };
  }
  if (item.kind === "expense" && isIsoDate(p.expenseDate)) {
    const d = new Date(`${p.expenseDate}T00:00:00Z`);
    const lo = new Date(d.getTime() - 3 * 86400000).toISOString().slice(0, 10);
    const hi = new Date(d.getTime() + 3 * 86400000).toISOString().slice(0, 10);
    const rows = await db
      .select({ merchant: atelierExpenses.merchant, amount: atelierExpenses.amount })
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.personId, me.id),
          gte(atelierExpenses.expenseDate, lo),
          lte(atelierExpenses.expenseDate, hi),
          isNull(atelierExpenses.deletedAt),
        ),
      );
    if (!rows.length) return null;
    return { kind: "nearby_expenses", count: rows.length };
  }
  return null;
}

// @cli-skip: EA delegation partner review; no CLI shape (Task #386)
router.get("/me/delegates/review", async (req, res, next) => {
  try {
    const me = ensurePartner(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierEaPendingItems)
      .where(
        and(
          eq(atelierEaPendingItems.orgId, me.orgId),
          eq(atelierEaPendingItems.partnerUserId, me.id),
          isNull(atelierEaPendingItems.deletedAt),
        ),
      )
      .orderBy(desc(atelierEaPendingItems.createdAt));
    const names = await nameMap(me.orgId, rows.flatMap((r) => [r.partnerUserId, r.eaUserId]));
    const items = [];
    for (const r of rows.slice(0, 200)) {
      const wire = itemWire(r, names);
      items.push(
        r.status === "pending" ? { ...wire, overlap: await overlapHint(me, r) } : wire,
      );
    }
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

async function requirePartnerItem(
  req: Request,
  res: Response,
): Promise<{ me: PersonaRow; item: PendingItemRow } | null> {
  const me = ensurePartner(req, res);
  if (!me) return null;
  const [item] = await db
    .select()
    .from(atelierEaPendingItems)
    .where(
      and(
        eq(atelierEaPendingItems.id, String(req.params.id)),
        eq(atelierEaPendingItems.orgId, me.orgId),
        eq(atelierEaPendingItems.partnerUserId, me.id),
        isNull(atelierEaPendingItems.deletedAt),
      ),
    );
  if (!item) {
    res.status(404).json({ error: "item-not-found" });
    return null;
  }
  return { me, item };
}

/** Apply an approved item — creates the real artifact and returns its id. */
async function applyApprovedItem(
  res: Response,
  me: PersonaRow,
  ea: PersonaRow,
  item: PendingItemRow,
): Promise<string | null> {
  const p = item.payload as Record<string, unknown>;
  if (item.kind === "timesheet_entry") {
    const person = await resolvePerson(me.id);
    if (!person) {
      res.status(409).json({ error: "partner-has-no-roster-record" });
      return null;
    }
    const workDate = String(p.workDate);
    const { weekIso } = isoWeekOf(new Date(`${workDate}T00:00:00Z`));
    const week = await ensureWeekShell(person, weekIso);
    if (week.status !== "draft" && week.status !== "rejected") {
      res.status(409).json({
        error: "week-locked",
        reason: `Week ${weekIso} is ${week.status}; the entry cannot be added.`,
      });
      return null;
    }
    const entryId = rid("tse");
    await db.insert(atelierTimesheetEntries).values({
      id: entryId,
      weekId: week.id,
      personId: person.id,
      personType: person.type,
      workDate,
      engagementId: typeof p.engagementId === "string" ? p.engagementId : null,
      activityCode:
        (typeof p.activityCode === "string" && p.activityCode) ||
        (p.engagementId ? "billable" : "internal"),
      hours: Number(p.hours),
      billable: !!p.engagementId && p.billable !== false,
      narrative: typeof p.narrative === "string" ? p.narrative : null,
      source: "human",
      status: "draft",
      // Attribution: the EA authored the entry; approval rides in the audit.
      createdByUserId: ea.id,
    });
    await recomputeWeekTotals(week.id);
    return entryId;
  }
  if (item.kind === "expense") {
    const amount = Number(p.amount);
    const currency = String(p.currency ?? "USD");
    const dateStr = String(p.expenseDate);
    const fx = await convertToUsd(amount, currency, dateStr);
    const expId = rid("exp");
    await db.insert(atelierExpenses).values({
      id: expId,
      personId: me.id,
      personType: "employee",
      expenseDate: dateStr,
      captureSource: "manual",
      merchant: String(p.merchant ?? ""),
      description: typeof p.description === "string" ? p.description : null,
      category: typeof p.category === "string" && p.category ? String(p.category) : "other",
      amount,
      currency,
      fxRate: fx.rate,
      fxRateDate: fx.rateDate,
      usdAmount: +fx.usdAmount.toFixed(2),
      contextType: "bd",
      receiptFileRef: item.receiptFileRef,
      receiptEncryptedAtRest: !!item.receiptFileRef,
      summary: (typeof p.description === "string" && p.description) || String(p.merchant ?? ""),
      status: "draft",
      policyStatus: "green",
      createdByUserId: ea.id,
    });
    return expId;
  }
  // meeting_task → a card on the partner's Me home (in-app; calendar
  // delegation via Graph is out of scope — see the design note).
  const when = [p.date, p.time].filter(Boolean).join(" ");
  const notifId = await emitSelfNotification({
    orgId: me.orgId,
    userId: me.id,
    kind: "ea_meeting_task",
    title: String(p.title ?? "Meeting/task"),
    body: [when && `When: ${when}`, p.attendees && `With: ${p.attendees}`, p.notes]
      .filter(Boolean)
      .join(" — "),
    href: "/me/delegates",
  });
  return notifId;
}

// @cli-skip: EA delegation partner review mutation; no CLI shape (Task #386)
router.post("/me/delegates/review/:id/approve", async (req, res, next) => {
  try {
    const ctx = await requirePartnerItem(req, res);
    if (!ctx) return;
    const { me, item } = ctx;
    // Idempotent: approving an already-approved item returns the artifact
    // it created the first time — a double-click never applies twice.
    if (item.status === "approved") {
      res.json({ ok: true, alreadyApplied: true, appliedRef: item.appliedRef, kind: item.kind });
      return;
    }
    if (item.status !== "pending") {
      res.status(409).json({ error: "not-pending", status: item.status });
      return;
    }
    const ea = await loadOrgUser(me.orgId, item.eaUserId);
    if (!ea) {
      res.status(409).json({ error: "ea-not-found" });
      return;
    }
    const appliedRef = await applyApprovedItem(res, me, ea, item);
    if (appliedRef === null) return; // error already written
    await db
      .update(atelierEaPendingItems)
      .set({
        status: "approved",
        decidedAt: new Date(),
        decidedByUserId: me.id,
        appliedRef,
        updatedAt: new Date(),
      })
      .where(eq(atelierEaPendingItems.id, item.id));
    await audit({
      entityType: "ea_pending_item",
      entityId: item.id,
      actor: me,
      action: "ea.item.approved",
      payload: {
        kind: item.kind,
        appliedRef,
        eaUserId: ea.id,
        eaName: ea.name,
        itemPayload: item.payload,
      },
      summary: `${me.name} approved a ${item.kind.replace("_", " ")} entered by ${ea.name} (EA) on their behalf`,
    });
    await emitSelfNotification({
      orgId: me.orgId,
      userId: ea.id,
      kind: "ea_item_approved",
      title: `${me.name} approved your ${item.kind.replace(/_/g, " ")}`,
      body: "The entry has been applied.",
      href: "/me/assist",
    });
    res.json({ ok: true, appliedRef, kind: item.kind });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: EA delegation partner review mutation; no CLI shape (Task #386)
router.post("/me/delegates/review/:id/reject", async (req, res, next) => {
  try {
    const ctx = await requirePartnerItem(req, res);
    if (!ctx) return;
    const { me, item } = ctx;
    if (item.status !== "pending") {
      res.status(409).json({ error: "not-pending", status: item.status });
      return;
    }
    const reason = String((req.body ?? {}).reason ?? "").trim().slice(0, 1000);
    if (!reason) {
      res.status(400).json({ error: "reason-required" });
      return;
    }
    await db
      .update(atelierEaPendingItems)
      .set({
        status: "rejected",
        rejectionReason: reason,
        decidedAt: new Date(),
        decidedByUserId: me.id,
        updatedAt: new Date(),
      })
      .where(eq(atelierEaPendingItems.id, item.id));
    await audit({
      entityType: "ea_pending_item",
      entityId: item.id,
      actor: me,
      action: "ea.item.rejected",
      payload: { kind: item.kind, reason, eaUserId: item.eaUserId },
      summary: `${me.name} rejected a delegated ${item.kind.replace("_", " ")} (${reason})`,
    });
    await emitSelfNotification({
      orgId: me.orgId,
      userId: item.eaUserId,
      kind: "ea_item_rejected",
      title: `${me.name} sent back your ${item.kind.replace(/_/g, " ")}`,
      body: reason,
      href: "/me/assist",
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// EA SIDE — act for a partner
// =====================================================================

async function activeDelegationsForEa(orgId: string, eaUserId: string): Promise<DelegationRow[]> {
  return db
    .select()
    .from(atelierEaDelegations)
    .where(
      and(
        eq(atelierEaDelegations.orgId, orgId),
        eq(atelierEaDelegations.eaUserId, eaUserId),
        eq(atelierEaDelegations.status, "active"),
      ),
    )
    .orderBy(desc(atelierEaDelegations.createdAt));
}

// @cli-skip: EA assist surface; no CLI shape (Task #386)
router.get("/me/assist", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const delegations = await activeDelegationsForEa(me.orgId, me.id);
    const items = await db
      .select()
      .from(atelierEaPendingItems)
      .where(
        and(
          eq(atelierEaPendingItems.orgId, me.orgId),
          eq(atelierEaPendingItems.eaUserId, me.id),
          isNull(atelierEaPendingItems.deletedAt),
        ),
      )
      .orderBy(desc(atelierEaPendingItems.createdAt))
      .limit(200);
    const names = await nameMap(me.orgId, [
      ...delegations.flatMap((d) => [d.partnerUserId, d.eaUserId]),
      ...items.flatMap((i) => [i.partnerUserId, i.eaUserId]),
    ]);
    res.json({
      isExecutiveAssistant: await isRosterEa(me.orgId, me),
      delegations: delegations.map((d) => delegationWire(d, names)),
      items: items.map((i) => itemWire(i, names)),
    });
  } catch (err) {
    next(err);
  }
});

async function requireActiveDelegationForEa(
  req: Request,
  res: Response,
  delegationId: string,
  scope: EaScope,
): Promise<{ me: PersonaRow; delegation: DelegationRow; partner: PersonaRow } | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const [d] = await db
    .select()
    .from(atelierEaDelegations)
    .where(
      and(
        eq(atelierEaDelegations.id, delegationId),
        eq(atelierEaDelegations.orgId, me.orgId),
        eq(atelierEaDelegations.eaUserId, me.id),
      ),
    );
  if (!d || d.status !== "active") {
    res.status(404).json({ error: "delegation-not-found-or-revoked" });
    return null;
  }
  if (!(d.scopes ?? []).includes(scope)) {
    res.status(403).json({ error: "scope-not-delegated", scope });
    return null;
  }
  const partner = await loadOrgUser(me.orgId, d.partnerUserId);
  if (!partner) {
    res.status(409).json({ error: "partner-not-found" });
    return null;
  }
  return { me, delegation: d, partner };
}

// Monetary-stripped view of the partner's week for delegated data entry:
// entries + hours only. No rates, no compensation, no approval queue.
// @cli-skip: EA assist read; no CLI shape (Task #386)
router.get("/me/assist/:delegationId/timesheet", async (req, res, next) => {
  try {
    const ctx = await requireActiveDelegationForEa(
      req,
      res,
      String(req.params.delegationId),
      "timesheets",
    );
    if (!ctx) return;
    const { partner } = ctx;
    const person = await resolvePerson(partner.id);
    if (!person) {
      res.status(409).json({ error: "partner-has-no-roster-record" });
      return;
    }
    const weekIsoRaw = String(req.query.week ?? "");
    let weekIso: string;
    try {
      weekIso = weekIsoRaw ? (parseWeekIso(weekIsoRaw), weekIsoRaw) : isoWeekOf(new Date()).weekIso;
    } catch {
      res.status(400).json({ error: "invalid-week" });
      return;
    }
    const week = await ensureWeekShell(person, weekIso);
    const entries = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(
        and(eq(atelierTimesheetEntries.weekId, week.id), isNull(atelierTimesheetEntries.deletedAt)),
      );
    res.json({
      partnerName: partner.name,
      week: {
        id: week.id,
        weekIso: week.weekIso,
        weekStartDate: week.weekStartDate,
        status: week.status,
        totalHours: week.totalHours,
      },
      entries: entries.map(entryWire),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: EA assist mutation; no CLI shape (Task #386)
router.post("/me/assist/:delegationId/items", async (req, res, next) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kind = String(b.kind ?? "") as ItemKind;
    if (!ITEM_KINDS.includes(kind)) {
      res.status(400).json({ error: "invalid-kind", allowed: ITEM_KINDS });
      return;
    }
    const ctx = await requireActiveDelegationForEa(
      req,
      res,
      String(req.params.delegationId),
      KIND_SCOPE[kind],
    );
    if (!ctx) return;
    const { me, delegation, partner } = ctx;
    const payload = normalizePayload(res, kind, (b.payload ?? {}) as Record<string, unknown>);
    if (!payload) return;
    let receiptFileRef: string | null = null;
    if (kind === "expense" && b.receiptPath) {
      const normalized = await normalizeEaReceipt(res, me, b.receiptPath);
      if (normalized === undefined) return;
      receiptFileRef = normalized;
    }
    const id = rid("eaitem");
    await db.insert(atelierEaPendingItems).values({
      id,
      orgId: me.orgId,
      delegationId: delegation.id,
      partnerUserId: partner.id,
      eaUserId: me.id,
      kind,
      payload,
      receiptFileRef,
      status: "pending",
    });
    await audit({
      entityType: "ea_pending_item",
      entityId: id,
      actor: me,
      onBehalfOf: { userId: partner.id, name: partner.name },
      action: "ea.item.submitted",
      payload: { kind, itemPayload: payload, hasReceipt: !!receiptFileRef },
      summary: `${me.name} (EA) proposed a ${kind.replace(/_/g, " ")} on behalf of ${partner.name}`,
    });
    await emitSelfNotification({
      orgId: me.orgId,
      userId: partner.id,
      kind: "ea_item_pending",
      title: `${me.name} entered a ${kind.replace(/_/g, " ")} for you`,
      body: "Review and approve or send it back.",
      href: "/me/delegates",
    });
    const [row] = await db
      .select()
      .from(atelierEaPendingItems)
      .where(eq(atelierEaPendingItems.id, id));
    const names = await nameMap(me.orgId, [partner.id, me.id]);
    res.status(201).json({ item: itemWire(row, names) });
  } catch (err) {
    next(err);
  }
});

/** Same normalization as the self-service receipt path — ACL owner is the EA. */
async function normalizeEaReceipt(
  res: Response,
  me: PersonaRow,
  raw: unknown,
): Promise<string | null | undefined> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    res.status(400).json({ error: "invalid-receipt-path" });
    return undefined;
  }
  try {
    const svc = new ObjectStorageService();
    const normalized = await svc.trySetObjectEntityAclPolicy(raw, {
      owner: me.id,
      visibility: "private",
    });
    if (!normalized.startsWith("/objects/")) {
      res.status(400).json({ error: "invalid-receipt-path" });
      return undefined;
    }
    return normalized;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(400).json({
        error: "receipt-not-found",
        reason: "Upload the file first, then attach it.",
      });
      return undefined;
    }
    throw err;
  }
}

async function requireOwnEditableItem(
  req: Request,
  res: Response,
): Promise<{ me: PersonaRow; item: PendingItemRow } | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const [item] = await db
    .select()
    .from(atelierEaPendingItems)
    .where(
      and(
        eq(atelierEaPendingItems.id, String(req.params.id)),
        eq(atelierEaPendingItems.orgId, me.orgId),
        eq(atelierEaPendingItems.eaUserId, me.id),
        isNull(atelierEaPendingItems.deletedAt),
      ),
    );
  if (!item) {
    res.status(404).json({ error: "item-not-found" });
    return null;
  }
  if (item.status !== "pending" && item.status !== "rejected") {
    res.status(409).json({ error: "not-editable", status: item.status });
    return null;
  }
  // The grant must still be live and still carry the scope — a revoke cuts
  // off edits/resubmits immediately, not just new items.
  const [d] = await db
    .select()
    .from(atelierEaDelegations)
    .where(eq(atelierEaDelegations.id, item.delegationId));
  if (!d || d.status !== "active" || !(d.scopes ?? []).includes(KIND_SCOPE[item.kind as ItemKind])) {
    res.status(403).json({ error: "delegation-revoked-or-scope-removed" });
    return null;
  }
  return { me, item };
}

// @cli-skip: EA assist mutation; no CLI shape (Task #386)
router.patch("/me/assist/items/:id", async (req, res, next) => {
  try {
    const ctx = await requireOwnEditableItem(req, res);
    if (!ctx) return;
    const { me, item } = ctx;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.payload !== undefined) {
      const payload = normalizePayload(
        res,
        item.kind as ItemKind,
        (b.payload ?? {}) as Record<string, unknown>,
      );
      if (!payload) return;
      patch.payload = payload;
    }
    if (b.receiptPath !== undefined && item.kind === "expense") {
      const normalized = await normalizeEaReceipt(res, me, b.receiptPath);
      if (normalized === undefined) return;
      patch.receiptFileRef = normalized;
    }
    await db
      .update(atelierEaPendingItems)
      .set(patch)
      .where(eq(atelierEaPendingItems.id, item.id));
    const partner = await loadOrgUser(me.orgId, item.partnerUserId);
    await audit({
      entityType: "ea_pending_item",
      entityId: item.id,
      actor: me,
      onBehalfOf: partner ? { userId: partner.id, name: partner.name } : null,
      action: "ea.item.updated",
      payload: { kind: item.kind, patched: Object.keys(patch) },
      summary: `${me.name} (EA) edited a ${item.kind.replace(/_/g, " ")}${partner ? ` on behalf of ${partner.name}` : ""}`,
    });
    const [row] = await db
      .select()
      .from(atelierEaPendingItems)
      .where(eq(atelierEaPendingItems.id, item.id));
    const names = await nameMap(me.orgId, [row.partnerUserId, row.eaUserId]);
    res.json({ item: itemWire(row, names) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: EA assist mutation; no CLI shape (Task #386)
router.post("/me/assist/items/:id/resubmit", async (req, res, next) => {
  try {
    const ctx = await requireOwnEditableItem(req, res);
    if (!ctx) return;
    const { me, item } = ctx;
    if (item.status !== "rejected") {
      res.status(409).json({ error: "not-rejected", status: item.status });
      return;
    }
    await db
      .update(atelierEaPendingItems)
      .set({
        status: "pending",
        rejectionReason: null,
        decidedAt: null,
        decidedByUserId: null,
        resubmittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(atelierEaPendingItems.id, item.id));
    const partner = await loadOrgUser(me.orgId, item.partnerUserId);
    await audit({
      entityType: "ea_pending_item",
      entityId: item.id,
      actor: me,
      onBehalfOf: partner ? { userId: partner.id, name: partner.name } : null,
      action: "ea.item.resubmitted",
      payload: { kind: item.kind, priorReason: item.rejectionReason },
      summary: `${me.name} (EA) resubmitted a ${item.kind.replace(/_/g, " ")}${partner ? ` on behalf of ${partner.name}` : ""}`,
    });
    if (partner) {
      await emitSelfNotification({
        orgId: me.orgId,
        userId: partner.id,
        kind: "ea_item_pending",
        title: `${me.name} resubmitted a ${item.kind.replace(/_/g, " ")}`,
        body: "The item was revised and awaits your review again.",
        href: "/me/delegates",
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: EA assist upload URL; no CLI shape (Task #386)
router.post("/me/assist/receipt-upload", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const svc = new ObjectStorageService();
    const uploadURL = await svc.getObjectEntityUploadURL();
    res.json({ uploadURL });
  } catch (err) {
    next(err);
  }
});

// Receipt stream — uploading EA, the partner it was entered for, and HR.
// The object ACL owner stays the EA; this server-side gate is the ONLY
// widening (partner + HR), matching the task's visibility contract.
// @cli-skip: EA receipt stream; no CLI shape (Task #386)
router.get("/me/ea-items/:id/receipt", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const [item] = await db
      .select()
      .from(atelierEaPendingItems)
      .where(
        and(
          eq(atelierEaPendingItems.id, String(req.params.id)),
          eq(atelierEaPendingItems.orgId, me.orgId),
          isNull(atelierEaPendingItems.deletedAt),
        ),
      );
    if (!item) {
      res.status(404).json({ error: "item-not-found" });
      return;
    }
    const allowed =
      me.id === item.eaUserId ||
      me.id === item.partnerUserId ||
      isHr(me.role) ||
      isFoundingPartner(me.role);
    if (!allowed) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!item.receiptFileRef || !item.receiptFileRef.startsWith("/objects/")) {
      res.status(404).json({ error: "no-receipt" });
      return;
    }
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(item.receiptFileRef);
    const response = await svc.downloadObject(file, 60);
    // Task #554 — HEIC receipts convert to JPEG on the fly for display.
    await sendReceiptForDisplay(res, response);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "no-receipt" });
      return;
    }
    next(err);
  }
});

export default router;
