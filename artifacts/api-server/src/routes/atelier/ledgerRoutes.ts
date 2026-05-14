/**
 * Atelier — v3 Ledger: Timesheets + approvals + partner-firm hours intake.
 * Task #257.
 *
 * Conventions:
 *   - Persona-gated; non-employee personas (contractor, partner_firm_resource)
 *     are allowed to view their OWN week + submit, but cannot approve.
 *   - Suspicious-pattern blocks on submit:
 *       (a) any single day > 14h
 *       (b) any double-booked day (>1 entry on same engagement+date with
 *           overlapping calendar signals)
 *       (c) week is fully billable but has zero meeting/calendar signals
 *   - Approval ladder: submitted → lead_approved → partner_approved.
 *     Lead approve enabled for engagement_lead/partner/operations; partner
 *     approval requires partner.
 *   - Partner-firm resources never appear in /ledger/timesheets — their
 *     hours land in atelier_partner_firm_hours via CSV upload (Operations/
 *     Partner only) and surface in engagement-economics, not the timesheet.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { eq, and, isNull, inArray, desc } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierTimesheetSignals,
  atelierPartnerFirmHours,
  atelierEngagements,
  atelierAuditEvents,
  atelierPartnerFirmResources,
} from "@workspace/db";
import { runTimeSteward, runUtilizationAnalyst } from "../../lib/atelier-agents/runner.js";
import {
  runLedgerNudgeTick,
  runLedgerStewardTick,
  runUtilizationSnapshotTick,
  runBurnSentinelTick,
  getEngagementBurnSummary,
} from "../../lib/atelier-agents/ledgerNudges.js";
import {
  atelierUtilizationSnapshots,
  atelierAccounts,
  atelierDealPricings,
  atelierRateCards,
  atelierRateCardRows,
  atelierOpportunities,
} from "@workspace/db";
import { gte, sql } from "drizzle-orm";
import { assertAuditAction } from "./auditContract.js";

const router: IRouter = Router();

/**
 * Canonical status set used for ledger "actuals" (burn, realized margin,
 * realization rate). We intentionally include `submitted` (and the
 * lead/partner-approved chain) so live engagements show progress *as
 * timesheets flow* rather than only after final partner approval — that
 * matches the partner-room mental model that "submitted hours are real
 * even if not yet signed off". Drafts/rejected entries are excluded.
 * Keep every burn/margin/realization query in this file pinned to this
 * constant so the policy stays consistent.
 */
const LEDGER_ACTUAL_STATUSES = ["submitted", "lead_approved", "approved", "partner_approved"] as const;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

// Task #292 — Approval / partner-firm-hour gates now route through the
// 9-persona model (founding_partner | partner | finance | hr |
// senior_manager | consultant | contractor | partner_firm_resource |
// board_observer). See personaRoles.ts for the canonical groupings.
import {
  canApproveAsLead as _canApproveLead,
  canApproveAsPartner as _canApprovePartner,
  canUploadPartnerFirmHours as _canUploadPartnerFirmHours,
  canViewPartnerFirmHours as _canViewPartnerFirmHours,
  canManagePartnerFirm as _canManagePartnerFirm,
} from "./personaRoles.js";

function canApproveLead(me: typeof atelierUsers.$inferSelect): boolean {
  return _canApproveLead(me.role);
}
function canApprovePartner(me: typeof atelierUsers.$inferSelect): boolean {
  return _canApprovePartner(me.role);
}
function canUploadPartnerFirmHours(me: typeof atelierUsers.$inferSelect): boolean {
  return _canUploadPartnerFirmHours(me.role);
}
function canViewPartnerFirmHours(me: typeof atelierUsers.$inferSelect): boolean {
  return _canViewPartnerFirmHours(me.role);
}
function canManagePartnerFirm(me: typeof atelierUsers.$inferSelect): boolean {
  return _canManagePartnerFirm(me.role);
}

// Object-level ACL for the partner-firm-hours endpoints. Returns the caller's
// partner-firm row (firm id + seconded engagements) so callers can scope
// queries/inserts; returns null when the user is not a partner-firm resource.
// Leadership roles (partner/operations/engagement_lead) bypass this scoping.
async function resolvePartnerFirmScope(
  me: typeof atelierUsers.$inferSelect,
): Promise<{ partnerFirmId: string; secondedEngagementIds: string[] } | null> {
  if (me.role !== "partner_firm_resource") return null;
  const [pfr] = await db
    .select({
      partnerFirmId: atelierPartnerFirmResources.partnerFirmId,
      secondedToEngagementIds: atelierPartnerFirmResources.secondedToEngagementIds,
    })
    .from(atelierPartnerFirmResources)
    .where(
      and(
        eq(atelierPartnerFirmResources.partnerFirmPmUserId, me.id),
        isNull(atelierPartnerFirmResources.deletedAt),
      ),
    )
    .limit(1);
  if (!pfr) return { partnerFirmId: "__none__", secondedEngagementIds: [] };
  return {
    partnerFirmId: pfr.partnerFirmId,
    secondedEngagementIds: (pfr.secondedToEngagementIds as string[] | null) ?? [],
  };
}

async function audit(args: {
  entityType: string;
  entityId: string;
  actor: typeof atelierUsers.$inferSelect;
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
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// --- ISO week helpers (Mon-anchored) ----------------------------------
function isoWeekOf(d: Date): { weekIso: string; weekStart: Date } {
  // Copy to UTC, set to Thursday of current week (ISO-8601 anchor).
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const monday = new Date(d);
  const md = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - (md - 1));
  monday.setUTCHours(0, 0, 0, 0);
  return { weekIso: `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`, weekStart: monday };
}

function parseWeekIso(weekIso: string): Date {
  // Returns the Monday of the given ISO week.
  const m = /^(\d{4})-W(\d{2})$/.exec(weekIso);
  if (!m) throw new Error(`invalid week_iso: ${weekIso}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO week 1 = the week with Jan 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const monday = new Date(week1Mon);
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return monday;
}

// --- Person resolution ------------------------------------------------
type PersonRow = {
  id: string;
  type: "employee" | "contractor";
  fullName: string;
  email: string;
  userId: string | null;
};

async function resolvePerson(personIdOrUserId: string): Promise<PersonRow | null> {
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, personIdOrUserId), isNull(atelierEmployees.deletedAt)));
  if (emp) return { id: emp.id, type: "employee", fullName: emp.fullName, email: emp.email, userId: emp.userId };
  // Fallback: lookup by userId (atelier_users.id)
  const [empByUser] = await db
    .select()
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.userId, personIdOrUserId), isNull(atelierEmployees.deletedAt)));
  if (empByUser)
    return { id: empByUser.id, type: "employee", fullName: empByUser.fullName, email: empByUser.email, userId: empByUser.userId };
  const [con] = await db
    .select()
    .from(atelierContractors)
    .where(and(eq(atelierContractors.id, personIdOrUserId), isNull(atelierContractors.deletedAt)));
  if (con) return { id: con.id, type: "contractor", fullName: con.fullName, email: con.email, userId: null };
  return null;
}

// Resolve the person row for the active persona. Employees carry a
// userId column so the direct-id + userId fallback in resolvePerson covers
// them. atelier_contractors has no user_id column, so contractor personas
// won't resolve via id alone — fall back to email match against the
// atelier_users persona to keep contractor self-timesheet routes working.
async function resolvePersonForCaller(me: typeof atelierUsers.$inferSelect): Promise<PersonRow | null> {
  const direct = await resolvePerson(me.id);
  if (direct) return direct;
  if (!me.email) return null;
  const [conByEmail] = await db
    .select()
    .from(atelierContractors)
    .where(and(eq(atelierContractors.email, me.email), isNull(atelierContractors.deletedAt)));
  if (conByEmail)
    return { id: conByEmail.id, type: "contractor", fullName: conByEmail.fullName, email: conByEmail.email, userId: null };
  return null;
}

/**
 * Ownership/role gate for any timesheet *mutation* (draft / entries CRUD /
 * submit). The caller must either own the week (their resolved person id ==
 * week.personId) or hold an approver role. Without this, any authenticated
 * persona could submit/edit anyone else's week by id.
 */
async function assertCanMutateWeek(
  req: Request,
  res: Response,
  week: typeof atelierTimesheetWeeks.$inferSelect,
): Promise<typeof atelierUsers.$inferSelect | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const callerPerson = await resolvePersonForCaller(me);
  const isSelf = callerPerson?.id === week.personId;
  if (!isSelf && !canApproveLead(me)) {
    res.status(403).json({ error: "forbidden", reason: "Only the week owner or an approver can modify this week." });
    return null;
  }
  return me;
}

// --- Week shell -------------------------------------------------------
async function ensureWeekShell(person: PersonRow, weekIso: string): Promise<typeof atelierTimesheetWeeks.$inferSelect> {
  const [existing] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(
      and(
        eq(atelierTimesheetWeeks.personId, person.id),
        eq(atelierTimesheetWeeks.weekIso, weekIso),
        isNull(atelierTimesheetWeeks.deletedAt),
      ),
    );
  if (existing) return existing;
  const monday = parseWeekIso(weekIso);
  const weekStartDate = monday.toISOString().slice(0, 10);
  const id = `tsw_${person.id}_${weekIso}`;
  const [row] = await db
    .insert(atelierTimesheetWeeks)
    .values({
      id,
      personId: person.id,
      personType: person.type,
      weekIso,
      weekStartDate,
      status: "draft",
    })
    .returning();
  return row;
}

// --- Wire shape -------------------------------------------------------
function entryWire(e: typeof atelierTimesheetEntries.$inferSelect) {
  return {
    id: e.id,
    workDate: e.workDate,
    engagementId: e.engagementId,
    activityCode: e.activityCode,
    hours: e.hours,
    billable: e.billable,
    narrative: e.narrative,
    source: e.source,
    draftedByAgentId: e.draftedByAgentId,
    signalIds: (e.signalIds as string[]) ?? [],
    status: e.status,
  };
}

function signalWire(s: typeof atelierTimesheetSignals.$inferSelect) {
  return {
    id: s.id,
    workDate: s.workDate,
    signalType: s.signalType,
    sourceRefType: s.sourceRefType,
    sourceRefId: s.sourceRefId,
    engagementHint: s.engagementHint,
    evidenceSummary: s.evidenceSummary,
    weightHours: s.weightHours,
    observedAt: s.observedAt.toISOString(),
  };
}

async function recomputeWeekTotals(weekId: string): Promise<typeof atelierTimesheetWeeks.$inferSelect | null> {
  const entries = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(and(eq(atelierTimesheetEntries.weekId, weekId), isNull(atelierTimesheetEntries.deletedAt)));
  const total = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
  const billable = entries.reduce((s, e) => s + (e.billable ? Number(e.hours || 0) : 0), 0);
  const [row] = await db
    .update(atelierTimesheetWeeks)
    .set({ totalHours: total, billableHours: billable, updatedAt: new Date() })
    .where(eq(atelierTimesheetWeeks.id, weekId))
    .returning();
  return row ?? null;
}

function detectSuspiciousFlags(entries: ReturnType<typeof entryWire>[], signals: ReturnType<typeof signalWire>[]): string[] {
  const flags: string[] = [];
  // (a) any day > 14h
  const byDay = new Map<string, number>();
  for (const e of entries) {
    byDay.set(e.workDate, (byDay.get(e.workDate) ?? 0) + Number(e.hours || 0));
  }
  for (const [day, h] of byDay) {
    if (h > 14) flags.push(`day_overload:${day}:${h}h`);
  }
  // (b) double-booked: two billable entries on same date and same engagement
  const seen = new Map<string, number>();
  for (const e of entries) {
    if (!e.engagementId) continue;
    const key = `${e.workDate}__${e.engagementId}`;
    const c = (seen.get(key) ?? 0) + 1;
    seen.set(key, c);
    if (c === 2) flags.push(`double_booked:${e.workDate}:${e.engagementId}`);
  }
  // (c) fully billable + zero meeting/calendar signals
  const totalH = entries.reduce((s, e) => s + Number(e.hours || 0), 0);
  const billH = entries.reduce((s, e) => s + (e.billable ? Number(e.hours || 0) : 0), 0);
  const meetingSignals = signals.filter((s) => s.signalType === "meeting" || s.signalType === "calendar").length;
  if (totalH > 0 && billH === totalH && meetingSignals === 0) {
    flags.push("fully_billable_no_meetings");
  }
  return flags;
}

// =====================================================================
// GET /ledger/timesheets/current  → current week for the active persona
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/timesheets/current", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const person = await resolvePersonForCaller(me);
  if (!person) {
    res.status(404).json({ error: "person-not-found", reason: "Active persona is not bound to an employee/contractor row." });
    return;
  }
  const { weekIso } = isoWeekOf(new Date());
  const week = await ensureWeekShell(person, weekIso);
  await maybeAutoDraft(week, me);
  return getWeekResponse(res, week, person);
});

// Auto-populate the steward draft when an employee opens their week and it
// has no agent_drafted entries yet. Spec calls for "draft already populated"
// on /ledger/timesheets — this is the on-load path; the daily steward tick
// (registerLedgerNudges below) handles the morning prepopulation.
async function maybeAutoDraft(
  week: typeof atelierTimesheetWeeks.$inferSelect,
  me: typeof atelierUsers.$inferSelect,
): Promise<void> {
  if (week.status !== "draft" && week.status !== "rejected") return;
  const [existing] = await db
    .select({ id: atelierTimesheetEntries.id })
    .from(atelierTimesheetEntries)
    .where(
      and(
        eq(atelierTimesheetEntries.weekId, week.id),
        eq(atelierTimesheetEntries.source, "agent_drafted"),
        isNull(atelierTimesheetEntries.deletedAt),
      ),
    )
    .limit(1);
  if (existing) return;
  try {
    await runTimeSteward({
      weekId: week.id,
      personId: week.personId,
      weekStartDate: week.weekStartDate,
      triggeredByUserId: me.id,
    });
  } catch (err) {
    // Auto-draft is best-effort — never block the week view if the steward fails.
    console.warn("[ledger] auto-draft failed for week", week.id, err);
  }
}

// =====================================================================
// GET /ledger/timesheets/:personId/:weekIso
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/timesheets/:personId/:weekIso", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const person = await resolvePerson(req.params.personId);
  if (!person) {
    res.status(404).json({ error: "person-not-found" });
    return;
  }
  // Only the person themselves, or partner/operations/engagement_lead, may view.
  const callerPerson = await resolvePersonForCaller(me);
  const isSelf = callerPerson?.id === person.id;
  if (!isSelf && !canApproveLead(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const week = await ensureWeekShell(person, req.params.weekIso);
  if (isSelf) await maybeAutoDraft(week, me);
  return getWeekResponse(res, week, person);
});

async function getWeekResponse(
  res: Response,
  week: typeof atelierTimesheetWeeks.$inferSelect,
  person: PersonRow,
) {
  const entries = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(and(eq(atelierTimesheetEntries.weekId, week.id), isNull(atelierTimesheetEntries.deletedAt)));
  const signals = await db
    .select()
    .from(atelierTimesheetSignals)
    .where(eq(atelierTimesheetSignals.weekId, week.id));
  const wireEntries = entries.map(entryWire);
  const wireSignals = signals.map(signalWire);
  res.json({
    week: {
      id: week.id,
      personId: person.id,
      personType: person.type,
      personName: person.fullName,
      weekIso: week.weekIso,
      weekStartDate: week.weekStartDate,
      status: week.status,
      totalHours: week.totalHours,
      billableHours: week.billableHours,
      suspiciousFlags: (week.suspiciousFlags as string[]) ?? [],
      submittedAt: week.submittedAt?.toISOString() ?? null,
      leadApprovedAt: week.leadApprovedAt?.toISOString() ?? null,
      partnerApprovedAt: week.partnerApprovedAt?.toISOString() ?? null,
      rejectionReason: week.rejectionReason,
    },
    entries: wireEntries,
    signals: wireSignals,
  });
}

// =====================================================================
// POST /ledger/timesheets/:weekId/draft   → run Time Steward
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/timesheets/:weekId/draft", async (req, res) => {
  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(eq(atelierTimesheetWeeks.id, req.params.weekId));
  if (!week) {
    res.status(404).json({ error: "week-not-found" });
    return;
  }
  const me = await assertCanMutateWeek(req, res, week);
  if (!me) return;
  if (week.status !== "draft" && week.status !== "rejected") {
    res.status(409).json({ error: "week-locked", reason: `Week is ${week.status}; cannot redraft.` });
    return;
  }
  const out = await runTimeSteward({
    weekId: week.id,
    personId: week.personId,
    weekStartDate: week.weekStartDate,
    triggeredByUserId: me.id,
  });
  await audit({
    entityType: "timesheet_week",
    entityId: week.id,
    actor: me,
    action: "ledger.draft",
    payload: out as unknown as Record<string, unknown>,
    summary: `Time Steward drafted ${out.draftEntriesCreated} entries (${out.totalHoursDrafted}h) from ${out.signalsCreated} signals`,
  });
  res.json(out);
});

// =====================================================================
// POST /ledger/timesheets/:weekId/entries   → upsert a manual entry
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/timesheets/:weekId/entries", async (req, res) => {
  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(eq(atelierTimesheetWeeks.id, req.params.weekId));
  if (!week) {
    res.status(404).json({ error: "week-not-found" });
    return;
  }
  const me = await assertCanMutateWeek(req, res, week);
  if (!me) return;
  if (week.status !== "draft" && week.status !== "rejected") {
    res.status(409).json({ error: "week-locked" });
    return;
  }
  const body = req.body ?? {};
  const id = body.id as string | undefined;
  const workDate = body.workDate as string;
  const hours = Number(body.hours ?? 0);
  if (!workDate || !Number.isFinite(hours)) {
    res.status(400).json({ error: "invalid-body" });
    return;
  }
  const values = {
    weekId: week.id,
    personId: week.personId,
    personType: week.personType,
    workDate,
    engagementId: (body.engagementId as string | null) ?? null,
    activityCode: (body.activityCode as string | null) ?? (body.engagementId ? "billable" : "internal"),
    hours,
    billable: !!body.engagementId && body.billable !== false,
    narrative: (body.narrative as string | null) ?? null,
    source: "human" as const,
    status: "draft" as const,
    createdByUserId: me.id,
  };
  if (id) {
    // SECURITY: scope the update by BOTH entry id AND week id so a caller
    // authorized on one week cannot overwrite an entry that belongs to a
    // different week (or a different person) just by knowing its id.
    const result = await db
      .update(atelierTimesheetEntries)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(atelierTimesheetEntries.id, id),
          eq(atelierTimesheetEntries.weekId, week.id),
          eq(atelierTimesheetEntries.personId, week.personId),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      )
      .returning({ id: atelierTimesheetEntries.id });
    if (!result.length) {
      res.status(404).json({ error: "entry-not-in-week" });
      return;
    }
  } else {
    await db.insert(atelierTimesheetEntries).values({ id: rid("tse"), ...values });
  }
  await recomputeWeekTotals(week.id);
  res.json({ ok: true });
});

// =====================================================================
// POST /ledger/timesheets/:weekId/entries/:entryId/confirm
// One-tap row confirm: promotes an agent-drafted entry to a human-confirmed
// row (source stays "agent_drafted" so the AI provenance is preserved, but
// status flips to "confirmed" and the confirming user is recorded). The
// route is week-scoped to prevent cross-week confirmation.
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/timesheets/:weekId/entries/:entryId/confirm", async (req, res) => {
  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(eq(atelierTimesheetWeeks.id, req.params.weekId));
  if (!week) {
    res.status(404).json({ error: "week-not-found" });
    return;
  }
  const me = await assertCanMutateWeek(req, res, week);
  if (!me) return;
  if (week.status !== "draft" && week.status !== "rejected") {
    res.status(409).json({ error: "week-locked" });
    return;
  }
  // Flip status to "confirmed" and stamp the confirming user via
  // createdByUserId (entries table has no separate confirmer column —
  // the audit_event row below records who confirmed).
  // Hardening: only agent_drafted rows can be "confirmed" — human rows are
  // already authored by the user and have no draft state to promote.
  const result = await db
    .update(atelierTimesheetEntries)
    .set({ status: "confirmed", createdByUserId: me.id, updatedAt: new Date() })
    .where(
      and(
        eq(atelierTimesheetEntries.id, req.params.entryId),
        eq(atelierTimesheetEntries.weekId, week.id),
        eq(atelierTimesheetEntries.source, "agent_drafted"),
        isNull(atelierTimesheetEntries.deletedAt),
      ),
    )
    .returning({ id: atelierTimesheetEntries.id });
  if (!result.length) {
    res.status(404).json({ error: "entry-not-confirmable" });
    return;
  }
  await audit({
    entityType: "timesheet_entry",
    entityId: req.params.entryId,
    actor: me,
    action: "ledger.entry.confirm",
    payload: { weekId: week.id },
    summary: `${me.name} confirmed agent-drafted entry ${req.params.entryId}`,
  });
  res.json({ ok: true });
});

// @cli-skip: pending Task #340 read-parity migration
router.delete("/ledger/timesheets/entries/:entryId", async (req, res) => {
  const [entry] = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(eq(atelierTimesheetEntries.id, req.params.entryId));
  if (!entry) {
    res.status(404).json({ error: "entry-not-found" });
    return;
  }
  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(eq(atelierTimesheetWeeks.id, entry.weekId));
  if (!week) {
    res.status(404).json({ error: "week-not-found" });
    return;
  }
  const me = await assertCanMutateWeek(req, res, week);
  if (!me) return;
  if (week.status !== "draft" && week.status !== "rejected") {
    res.status(409).json({ error: "week-locked" });
    return;
  }
  await db
    .update(atelierTimesheetEntries)
    .set({ deletedAt: new Date() })
    .where(eq(atelierTimesheetEntries.id, entry.id));
  await recomputeWeekTotals(week.id);
  res.json({ ok: true });
});

// =====================================================================
// POST /ledger/timesheets/:weekId/submit
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/timesheets/:weekId/submit", async (req, res) => {
  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(eq(atelierTimesheetWeeks.id, req.params.weekId));
  if (!week) {
    res.status(404).json({ error: "week-not-found" });
    return;
  }
  const me = await assertCanMutateWeek(req, res, week);
  if (!me) return;
  if (week.status !== "draft" && week.status !== "rejected") {
    res.status(409).json({ error: "week-locked", reason: `Week is ${week.status}.` });
    return;
  }
  const entries = await db
    .select()
    .from(atelierTimesheetEntries)
    .where(and(eq(atelierTimesheetEntries.weekId, week.id), isNull(atelierTimesheetEntries.deletedAt)));
  const signals = await db.select().from(atelierTimesheetSignals).where(eq(atelierTimesheetSignals.weekId, week.id));
  const flags = detectSuspiciousFlags(entries.map(entryWire), signals.map(signalWire));
  const force = !!req.body?.acknowledgeFlags;
  if (flags.length && !force) {
    await db
      .update(atelierTimesheetWeeks)
      .set({ suspiciousFlags: flags, updatedAt: new Date() })
      .where(eq(atelierTimesheetWeeks.id, week.id));
    res.status(409).json({
      error: "suspicious-pattern",
      reason: "One or more suspicious patterns detected. Re-submit with acknowledgeFlags:true to record an explanation.",
      flags,
    });
    return;
  }
  await db
    .update(atelierTimesheetEntries)
    .set({ status: "submitted", updatedAt: new Date() })
    .where(eq(atelierTimesheetEntries.weekId, week.id));
  await db
    .update(atelierTimesheetWeeks)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      submittedByUserId: me.id,
      suspiciousFlags: flags,
      rejectionReason: null,
      rejectedAt: null,
      rejectedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(atelierTimesheetWeeks.id, week.id));
  await audit({
    entityType: "timesheet_week",
    entityId: week.id,
    actor: me,
    action: "ledger.submit",
    payload: { flags, acknowledged: force },
    summary: `${me.name} submitted week ${week.weekIso}${flags.length ? ` (acknowledged ${flags.length} flag(s))` : ""}`,
  });
  res.json({ ok: true, flags });
});

// =====================================================================
// GET /ledger/approvals  → queue for approver personas, grouped by engagement.
// Returns weeks WITH their entries and signals inline so the approvals UI
// can show per-row evidence without an N+1 round-trip.
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/approvals", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApproveLead(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const stage = (req.query.stage as string) ?? "submitted";
  const rows = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(and(eq(atelierTimesheetWeeks.status, stage), isNull(atelierTimesheetWeeks.deletedAt)))
    .orderBy(desc(atelierTimesheetWeeks.submittedAt));

  const weekIds = rows.map((r) => r.id);
  const personIds = Array.from(new Set(rows.map((r) => r.personId)));
  const [emps, cons, allEntries, allSignals, allEngs] = await Promise.all([
    personIds.length
      ? db.select().from(atelierEmployees).where(inArray(atelierEmployees.id, personIds))
      : Promise.resolve([] as Array<typeof atelierEmployees.$inferSelect>),
    personIds.length
      ? db.select().from(atelierContractors).where(inArray(atelierContractors.id, personIds))
      : Promise.resolve([] as Array<typeof atelierContractors.$inferSelect>),
    weekIds.length
      ? db
          .select()
          .from(atelierTimesheetEntries)
          .where(and(inArray(atelierTimesheetEntries.weekId, weekIds), isNull(atelierTimesheetEntries.deletedAt)))
      : Promise.resolve([] as Array<typeof atelierTimesheetEntries.$inferSelect>),
    weekIds.length
      ? db.select().from(atelierTimesheetSignals).where(inArray(atelierTimesheetSignals.weekId, weekIds))
      : Promise.resolve([] as Array<typeof atelierTimesheetSignals.$inferSelect>),
    db.select().from(atelierEngagements).where(isNull(atelierEngagements.deletedAt)),
  ]);
  const nameById = new Map<string, string>([
    ...emps.map((e) => [e.id, e.fullName] as const),
    ...cons.map((c) => [c.id, c.fullName] as const),
  ]);
  const engNameById = new Map(allEngs.map((e) => [e.id, e.name] as const));
  const entriesByWeek = new Map<string, typeof allEntries>();
  for (const e of allEntries) {
    const arr = entriesByWeek.get(e.weekId) ?? [];
    arr.push(e);
    entriesByWeek.set(e.weekId, arr);
  }
  const signalsByWeek = new Map<string, typeof allSignals>();
  for (const s of allSignals) {
    const arr = signalsByWeek.get(s.weekId) ?? [];
    arr.push(s);
    signalsByWeek.set(s.weekId, arr);
  }

  // Group: engagementId → [{week, entries-on-that-engagement, signals-on-that-engagement}]
  const groups = new Map<string, {
    engagementId: string | null;
    engagementName: string;
    weeks: Array<{
      id: string;
      personId: string;
      personName: string;
      weekIso: string;
      status: string;
      totalHours: number;
      billableHours: number;
      suspiciousFlags: string[];
      submittedAt: string | null;
      engagementEntries: ReturnType<typeof entryWire>[];
      engagementSignals: ReturnType<typeof signalWire>[];
    }>;
  }>();
  for (const w of rows) {
    const wEntries = entriesByWeek.get(w.id) ?? [];
    const wSignals = signalsByWeek.get(w.id) ?? [];
    // A single week can span multiple engagements — emit one group entry per
    // engagement found, plus an "internal" bucket if any non-billable rows.
    const engsHit = new Set<string | null>(wEntries.map((e) => e.engagementId));
    if (!engsHit.size) engsHit.add(null);
    for (const engId of engsHit) {
      const key = engId ?? "__internal__";
      const g = groups.get(key) ?? {
        engagementId: engId,
        engagementName: engId ? engNameById.get(engId) ?? engId : "Internal / non-billable",
        weeks: [],
      };
      const engEntries = wEntries.filter((e) => e.engagementId === engId).map(entryWire);
      const sigIdsOnEng = new Set(engEntries.flatMap((e) => e.signalIds));
      g.weeks.push({
        id: w.id,
        personId: w.personId,
        personName: nameById.get(w.personId) ?? w.personId,
        weekIso: w.weekIso,
        status: w.status,
        totalHours: w.totalHours,
        billableHours: w.billableHours,
        suspiciousFlags: (w.suspiciousFlags as string[]) ?? [],
        submittedAt: w.submittedAt?.toISOString() ?? null,
        engagementEntries: engEntries,
        engagementSignals: wSignals.filter((s) => sigIdsOnEng.has(s.id) || s.engagementHint === engId).map(signalWire),
      });
      groups.set(key, g);
    }
  }
  res.json({
    stage,
    groups: Array.from(groups.values()).sort((a, b) => a.engagementName.localeCompare(b.engagementName)),
  });
});

// =====================================================================
// POST /ledger/approvals/:weekId/approve   role: 'lead' | 'partner'
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/approvals/:weekId/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const role = (req.body?.role as string) ?? "lead";
  // Engagement-scoped countersign: callers approve only entries belonging
  // to a specific engagement bucket. `engagementId === null` (or omitted +
  // explicit __internal__) targets non-billable / internal rows.
  const rawEng = req.body?.engagementId;
  const engagementId: string | null =
    rawEng === undefined || rawEng === null || rawEng === "__internal__" ? null : String(rawEng);

  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(eq(atelierTimesheetWeeks.id, req.params.weekId));
  if (!week) {
    res.status(404).json({ error: "week-not-found" });
    return;
  }
  if (role !== "lead" && role !== "partner") {
    return void res.status(400).json({ error: "invalid-role" });
  }
  if (role === "lead" && !canApproveLead(me)) return void res.status(403).json({ error: "forbidden" });
  if (role === "partner" && !canApprovePartner(me)) return void res.status(403).json({ error: "forbidden" });

  // Object-level authorization (Task #292 — 9-persona model).
  // senior_manager (replaces engagement_lead) may only countersign entries
  // on engagements they actually lead. Partner-tier + finance bypass this
  // check (firm-wide scope).
  if (engagementId && me.role === "senior_manager") {
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(and(eq(atelierEngagements.id, engagementId), isNull(atelierEngagements.deletedAt)));
    if (!eng) return void res.status(404).json({ error: "engagement-not-found" });
    if (eng.engagementLeadId !== me.id)
      return void res.status(403).json({ error: "forbidden", reason: "Not the engagement lead." });
  }

  // Source entry status we'll advance, and target status. Lead countersign
  // requires entries currently 'submitted'; partner countersign requires
  // 'lead_approved'.
  const fromStatus = role === "lead" ? "submitted" : "lead_approved";
  const toStatus = role === "lead" ? "lead_approved" : "approved";

  // Engagement-scoped entry update. Build the engagement filter so null
  // (internal) is matched explicitly.
  const engFilter = engagementId
    ? eq(atelierTimesheetEntries.engagementId, engagementId)
    : isNull(atelierTimesheetEntries.engagementId);
  const updated = await db
    .update(atelierTimesheetEntries)
    .set({ status: toStatus, updatedAt: new Date() })
    .where(
      and(
        eq(atelierTimesheetEntries.weekId, week.id),
        engFilter,
        eq(atelierTimesheetEntries.status, fromStatus),
        isNull(atelierTimesheetEntries.deletedAt),
      ),
    )
    .returning({ id: atelierTimesheetEntries.id });

  if (updated.length === 0)
    return void res
      .status(409)
      .json({ error: "no-eligible-entries", reason: `No entries in '${fromStatus}' for that engagement.` });

  // Derive week status from entry roll-up rather than mutating it directly.
  // Lead pass: when no entries remain in 'submitted', week → lead_approved.
  // Partner pass: when no entries remain in 'lead_approved' AND no entries
  // remain in 'submitted', week → partner_approved.
  const remaining = await db
    .select({ status: atelierTimesheetEntries.status })
    .from(atelierTimesheetEntries)
    .where(and(eq(atelierTimesheetEntries.weekId, week.id), isNull(atelierTimesheetEntries.deletedAt)));
  const remainStatuses = new Set(remaining.map((r) => r.status));
  if (role === "lead" && week.status === "submitted" && !remainStatuses.has("submitted")) {
    await db
      .update(atelierTimesheetWeeks)
      .set({ status: "lead_approved", leadApprovedAt: new Date(), leadApprovedByUserId: me.id, updatedAt: new Date() })
      .where(eq(atelierTimesheetWeeks.id, week.id));
  } else if (
    role === "partner" &&
    (week.status === "lead_approved" || week.status === "submitted") &&
    !remainStatuses.has("submitted") &&
    !remainStatuses.has("lead_approved")
  ) {
    await db
      .update(atelierTimesheetWeeks)
      .set({
        status: "partner_approved",
        partnerApprovedAt: new Date(),
        partnerApprovedByUserId: me.id,
        updatedAt: new Date(),
      })
      .where(eq(atelierTimesheetWeeks.id, week.id));
  }

  await audit({
    entityType: "timesheet_week",
    entityId: week.id,
    actor: me,
    action: `ledger.approve.${role}`,
    payload: { role, engagementId, entriesAdvanced: updated.length },
    summary: `${me.name} ${role}-approved ${updated.length} entr${updated.length === 1 ? "y" : "ies"} on week ${week.weekIso} (eng=${engagementId ?? "internal"})`,
  });
  res.json({ ok: true, entriesAdvanced: updated.length });
});

// =====================================================================
// POST /ledger/approvals/:weekId/reject
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/approvals/:weekId/reject", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApproveLead(me)) return void res.status(403).json({ error: "forbidden" });
  const reason = (req.body?.reason as string) ?? "";
  if (!reason.trim()) return void res.status(400).json({ error: "reason-required" });
  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(eq(atelierTimesheetWeeks.id, req.params.weekId));
  if (!week) return void res.status(404).json({ error: "week-not-found" });
  if (week.status !== "submitted" && week.status !== "lead_approved")
    return void res.status(409).json({ error: "out-of-order", reason: `Week is ${week.status}.` });
  await db
    .update(atelierTimesheetWeeks)
    .set({
      status: "rejected",
      rejectedAt: new Date(),
      rejectedByUserId: me.id,
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(atelierTimesheetWeeks.id, week.id));
  await db
    .update(atelierTimesheetEntries)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(atelierTimesheetEntries.weekId, week.id));
  await audit({
    entityType: "timesheet_week",
    entityId: week.id,
    actor: me,
    action: "ledger.reject",
    payload: { reason },
    summary: `${me.name} rejected week ${week.weekIso}: ${reason.slice(0, 80)}`,
  });
  res.json({ ok: true });
});

// =====================================================================
// GET /ledger/roster/people/:id/timesheet-summary  (legacy alias)
// AND /roster/people/:id/timesheet-summary  (canonical path per spec)
// Rolling 4-week + YTD billable %, missing-week flags.
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/roster/people/:id/timesheet-summary", (req, res, next) => {
  // Delegate to the /ledger/-prefixed handler so both URLs share one impl.
  req.url = `/ledger/roster/people/${req.params.id}/timesheet-summary`;
  next("route");
});
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/roster/people/:id/timesheet-summary", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const person = await resolvePerson(req.params.id);
  if (!person) return void res.status(404).json({ error: "person-not-found" });
  const callerPerson = await resolvePersonForCaller(me);
  const isSelf = callerPerson?.id === person.id;
  if (!isSelf && !canApproveLead(me)) return void res.status(403).json({ error: "forbidden" });

  const weeks = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(and(eq(atelierTimesheetWeeks.personId, person.id), isNull(atelierTimesheetWeeks.deletedAt)))
    .orderBy(desc(atelierTimesheetWeeks.weekStartDate));
  const sorted = [...weeks].sort((a, b) => (a.weekStartDate < b.weekStartDate ? 1 : -1));
  const last4 = sorted.slice(0, 4);
  const ytd = sorted.filter((w) => w.weekStartDate.startsWith(String(new Date().getUTCFullYear())));

  const sum = (rows: typeof weeks, key: "totalHours" | "billableHours") => rows.reduce((s, r) => s + Number(r[key] || 0), 0);
  const billPct = (rows: typeof weeks) => {
    const t = sum(rows, "totalHours");
    return t > 0 ? Math.round((sum(rows, "billableHours") / t) * 1000) / 10 : 0;
  };

  // Missing weeks: walk back 4 weeks from current and flag any without a row.
  const missing: string[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i * 7);
    const { weekIso } = isoWeekOf(d);
    if (!weeks.find((w) => w.weekIso === weekIso)) missing.push(weekIso);
  }

  // Last-submitted week (anything past draft) — surfaces "did they actually
  // submit?" status for the roster dossier signals strip.
  const lastSubmitted = sorted.find((w) => w.status !== "draft" && w.status !== "rejected") ?? null;

  res.json({
    personId: person.id,
    personName: person.fullName,
    lastSubmittedWeek: lastSubmitted
      ? {
          weekIso: lastSubmitted.weekIso,
          status: lastSubmitted.status,
          submittedAt: lastSubmitted.submittedAt?.toISOString() ?? null,
          totalHours: lastSubmitted.totalHours,
          billableHours: lastSubmitted.billableHours,
        }
      : null,
    lastSubmittedWeekStatus: lastSubmitted?.status ?? "none",
    rolling4Week: {
      weeks: last4.map((w) => ({
        weekIso: w.weekIso,
        status: w.status,
        totalHours: w.totalHours,
        billableHours: w.billableHours,
      })),
      totalHours: sum(last4, "totalHours"),
      billableHours: sum(last4, "billableHours"),
      billablePct: billPct(last4),
    },
    ytd: {
      totalHours: sum(ytd, "totalHours"),
      billableHours: sum(ytd, "billableHours"),
      billablePct: billPct(ytd),
    },
    missingWeeks: missing,
  });
});

// =====================================================================
// POST /ledger/partner-firm-hours/:engagementId
// Accepts the CSV in three shapes (in priority order):
//   1. multipart/form-data with field "file" (preferred — matches the spec
//      and the upload UI's <input type="file">).
//   2. application/json with body { csv: "..." } (programmatic ingest).
//   3. text/csv raw body (curl convenience).
// CSV header: resource_name,partner_firm_id,week_iso,hours,cost_amount,cost_currency
// =====================================================================
const partnerFirmUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB ceiling for an HR CSV
});
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/partner-firm-hours/:engagementId", partnerFirmUpload.single("file"), async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canUploadPartnerFirmHours(me)) return void res.status(403).json({ error: "forbidden" });
  const engagementId = String(req.params.engagementId);
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, engagementId), isNull(atelierEngagements.deletedAt)));
  if (!eng) return void res.status(404).json({ error: "engagement-not-found" });
  // Object-level scope: a partner_firm_resource may only upload to engagements
  // they're seconded to, and every CSV row's partner_firm_id must equal their
  // own firm. Partner / operations bypass these checks.
  const scope = await resolvePartnerFirmScope(me);
  if (scope && !scope.secondedEngagementIds.includes(eng.id)) {
    return void res.status(403).json({ error: "engagement-not-in-scope" });
  }

  const csvText: string =
    req.file?.buffer?.toString("utf8") ??
    (typeof req.body === "string"
      ? req.body
      : typeof req.body?.csv === "string"
        ? req.body.csv
        : "");
  if (!csvText.trim()) return void res.status(400).json({ error: "empty-csv" });
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return void res.status(400).json({ error: "csv-needs-header-and-row" });
  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const required = ["resource_name", "partner_firm_id", "week_iso", "hours", "cost_amount", "cost_currency"];
  for (const r of required) if (!header.includes(r)) return void res.status(400).json({ error: `csv-missing:${r}` });
  const idx = (k: string) => header.indexOf(k);
  const batchRef = rid("pfh_batch");
  const inserts: Array<typeof atelierPartnerFirmHours.$inferInsert> = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((s) => s.trim());
    const rowFirmId = cells[idx("partner_firm_id")];
    if (scope && rowFirmId !== scope.partnerFirmId) {
      return void res.status(403).json({ error: "row-firm-mismatch", reason: `row partner_firm_id ${rowFirmId} != caller firm ${scope.partnerFirmId}` });
    }
    inserts.push({
      id: rid("pfh"),
      engagementId: eng.id,
      partnerFirmId: rowFirmId,
      resourceName: cells[idx("resource_name")],
      weekIso: cells[idx("week_iso")],
      hours: Number(cells[idx("hours")]) || 0,
      costAmount: Number(cells[idx("cost_amount")]) || 0,
      costCurrency: cells[idx("cost_currency")] || "USD",
      csvUploadRef: batchRef,
      uploadedByUserId: me.id,
    });
  }
  if (inserts.length) await db.insert(atelierPartnerFirmHours).values(inserts);
  await audit({
    entityType: "engagement",
    entityId: eng.id,
    actor: me,
    action: "ledger.partner_firm_hours.upload",
    payload: { batchRef, rows: inserts.length },
    summary: `${me.name} uploaded ${inserts.length} partner-firm hour rows for ${eng.name}`,
  });
  res.json({ ok: true, batchRef, rows: inserts.length });
});

// =====================================================================
// GET /ledger/engagement-economics/:engagementId
// Surfaces partner-firm hours + cost roll-ups for the engagement-economics
// panel. Same role + object-level ACL as /ledger/partner-firm-hours: a
// partner_firm_resource sees only their own firm's rows on engagements
// they are seconded to; leadership (partner/operations/engagement_lead)
// sees the full picture.
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/engagement-economics/:engagementId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canViewPartnerFirmHours(me)) return void res.status(403).json({ error: "forbidden" });
  const engagementId = req.params.engagementId;
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, engagementId), isNull(atelierEngagements.deletedAt)));
  if (!eng) return void res.status(404).json({ error: "engagement-not-found" });
  const scope = await resolvePartnerFirmScope(me);
  if (scope && !scope.secondedEngagementIds.includes(engagementId)) {
    return void res.status(403).json({ error: "engagement-not-in-scope" });
  }
  const baseFilter = scope
    ? and(
        eq(atelierPartnerFirmHours.engagementId, engagementId),
        eq(atelierPartnerFirmHours.partnerFirmId, scope.partnerFirmId),
        isNull(atelierPartnerFirmHours.deletedAt),
      )
    : and(eq(atelierPartnerFirmHours.engagementId, engagementId), isNull(atelierPartnerFirmHours.deletedAt));
  const rows = await db
    .select()
    .from(atelierPartnerFirmHours)
    .where(baseFilter)
    .orderBy(desc(atelierPartnerFirmHours.weekIso));
  const byFirm = new Map<string, { partnerFirmId: string; hours: number; costAmount: number; costCurrency: string }>();
  for (const r of rows) {
    const cur = byFirm.get(r.partnerFirmId) ?? {
      partnerFirmId: r.partnerFirmId,
      hours: 0,
      costAmount: 0,
      costCurrency: r.costCurrency,
    };
    cur.hours += Number(r.hours || 0);
    cur.costAmount += Number(r.costAmount || 0);
    byFirm.set(r.partnerFirmId, cur);
  }
  res.json({
    engagementId,
    engagementName: eng.name,
    partnerFirmRollup: Array.from(byFirm.values()),
    rows: rows.map((r) => ({
      id: r.id,
      partnerFirmId: r.partnerFirmId,
      resourceName: r.resourceName,
      weekIso: r.weekIso,
      hours: r.hours,
      costAmount: r.costAmount,
      costCurrency: r.costCurrency,
      uploadedAt: r.uploadedAt.toISOString(),
    })),
  });
});

// =====================================================================
// GET /ledger/partner-firm-hours/:engagementId  → engagement-economics panel
// =====================================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/partner-firm-hours/:engagementId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Sensitive commercial data — restrict to leadership + partner-firm PMs.
  if (!canViewPartnerFirmHours(me)) return void res.status(403).json({ error: "forbidden" });
  // Object-level scope: a partner_firm_resource may only read engagements
  // they're seconded to, and only rows for their own firm. Leadership reads all.
  const scope = await resolvePartnerFirmScope(me);
  if (scope && !scope.secondedEngagementIds.includes(req.params.engagementId)) {
    return void res.status(403).json({ error: "engagement-not-in-scope" });
  }
  const baseFilter = scope
    ? and(
        eq(atelierPartnerFirmHours.engagementId, req.params.engagementId),
        eq(atelierPartnerFirmHours.partnerFirmId, scope.partnerFirmId),
        isNull(atelierPartnerFirmHours.deletedAt),
      )
    : and(eq(atelierPartnerFirmHours.engagementId, req.params.engagementId), isNull(atelierPartnerFirmHours.deletedAt));
  const rows = await db
    .select()
    .from(atelierPartnerFirmHours)
    .where(baseFilter)
    .orderBy(desc(atelierPartnerFirmHours.weekIso));
  res.json(
    rows.map((r) => ({
      id: r.id,
      partnerFirmId: r.partnerFirmId,
      resourceName: r.resourceName,
      weekIso: r.weekIso,
      hours: r.hours,
      costAmount: r.costAmount,
      costCurrency: r.costCurrency,
      uploadedAt: r.uploadedAt.toISOString(),
    })),
  );
});

// Test-only manual nudge trigger (also useful for ops to fire a deadline
// reminder out-of-band). Gated to partner/operations to avoid abuse.
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/nudges/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Task #292 — partner-tier + finance can fire the manual nudge.
  if (!canApprovePartner(me) && me.role !== "finance") {
    return void res.status(403).json({ error: "forbidden" });
  }
  const force = req.body?.force as "submit_due" | "approve_due" | undefined;
  const out = await runLedgerNudgeTick({ force });
  res.json(out);
});

// Manual trigger for the daily Time Steward draft pass — partner-tier +
// finance only. Lets QA and runbooks force the same backfill that runs
// Mon 06:00 GST from startLedgerNudgeJob's 15-minute ticker.
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/steward/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApprovePartner(me) && me.role !== "finance") {
    return void res.status(403).json({ error: "forbidden" });
  }
  const out = await runLedgerStewardTick({ force: true });
  res.json(out);
});

// =====================================================================
// Task #258 — Utilization, Realization, Burn Sentinel
// =====================================================================

// ISO week list for the last N weeks (newest first).
function lastNWeeks(n: number): { weekIso: string; weekStartDate: string }[] {
  const out: { weekIso: string; weekStartDate: string }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i * 7);
    const day = (d.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
    const target = new Date(monday);
    target.setUTCDate(target.getUTCDate() + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    out.push({
      weekIso: `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
      weekStartDate: monday.toISOString().slice(0, 10),
    });
  }
  return out;
}

function defaultTargetPctFor(role: string | null | undefined, seniority: string | null | undefined): number {
  // Task #292 — partner-tier (founding_partner|partner) keeps the same
  // 50% target; senior_manager replaces engagement_lead at 65%.
  if (role === "partner" || role === "founding_partner" || seniority === "partner") return 0.5;
  if (role === "senior_manager" || seniority === "principal") return 0.65;
  if (seniority === "manager" || seniority === "senior_consultant") return 0.7;
  return 0.75;
}

// ---------------------------------------------------------------------
// GET /ledger/utilization/person/:id
// Rolling 4 weeks + YTD + engagement mix + variance vs target.
// ACL: self OR partner/operations/engagement_lead.
// ---------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/utilization/person/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const personId = req.params.id;

  // Accept either an employee id or a user id (the rest of the system uses
  // both, so callers shouldn't have to know which one they have).
  const [emp] = await db
    .select()
    .from(atelierEmployees)
    .where(and(
      isNull(atelierEmployees.deletedAt),
      personId.startsWith("emp_") ? eq(atelierEmployees.id, personId) : eq(atelierEmployees.userId, personId),
    ));

  // Task #292 — leadership for utilization viewing = lead-approver tier.
  if (!canApproveLead(me)) {
    if (!emp || emp.userId !== me.id) return void res.status(403).json({ error: "forbidden" });
  }
  const resolvedPersonId = emp?.id ?? personId;
  const personLabel = emp?.fullName ?? personId;
  const targetPct = emp?.utilizationTargetPct
    ? emp.utilizationTargetPct / 100
    : defaultTargetPctFor(emp?.role, emp?.seniority);

  const last4 = lastNWeeks(4);
  const last4Iso = last4.map((w) => w.weekIso);
  const snapshots = await db
    .select()
    .from(atelierUtilizationSnapshots)
    .where(eq(atelierUtilizationSnapshots.personId, resolvedPersonId));

  const last4Snaps = snapshots
    .filter((s) => last4Iso.includes(s.weekIso))
    .sort((a, b) => a.weekIso.localeCompare(b.weekIso));
  const ytdSnaps = snapshots.filter((s) => s.weekIso.startsWith(String(new Date().getUTCFullYear())));

  const sum = (arr: { billableHours: number; totalHours: number; availableHours: number }[]) => ({
    billable: arr.reduce((s, r) => s + Number(r.billableHours), 0),
    total: arr.reduce((s, r) => s + Number(r.totalHours), 0),
    available: arr.reduce((s, r) => s + Number(r.availableHours), 0),
  });
  const r4 = sum(last4Snaps);
  const ytd = sum(ytdSnaps);
  const rolling4UtilPct = r4.available > 0 ? r4.billable / r4.available : 0;
  const ytdUtilPct = ytd.available > 0 ? ytd.billable / ytd.available : 0;

  // engagement mix across rolling 4
  const mixMap = new Map<string, { name: string; hours: number; billable: boolean }>();
  for (const s of last4Snaps) {
    for (const m of (s.engagementMix as Array<{ engagementId: string | null; name: string; hours: number; billable: boolean }>) ?? []) {
      const k = m.engagementId ?? "__internal__";
      const prev = mixMap.get(k) ?? { name: m.name, hours: 0, billable: m.billable };
      mixMap.set(k, { name: m.name, hours: prev.hours + Number(m.hours), billable: prev.billable || m.billable });
    }
  }
  const mix = Array.from(mixMap.entries()).map(([engagementId, v]) => ({
    engagementId: engagementId === "__internal__" ? null : engagementId,
    name: v.name,
    hours: v.hours,
    billable: v.billable,
  })).sort((a, b) => b.hours - a.hours);

  res.json({
    personId: resolvedPersonId,
    personLabel,
    role: emp?.role ?? "unknown",
    seniority: emp?.seniority ?? "unknown",
    targetPct,
    rolling4UtilPct,
    ytdUtilPct,
    variancePct: rolling4UtilPct - targetPct,
    weeks: last4Snaps.map((s) => ({
      weekIso: s.weekIso,
      weekStartDate: s.weekStartDate,
      billableHours: Number(s.billableHours),
      totalHours: Number(s.totalHours),
      utilizationPct: Number(s.utilizationPct),
      targetPct: Number(s.targetPct),
    })),
    engagementMix: mix,
    snapshotsAvailable: snapshots.length > 0,
    // Use the most recent snapshot timestamp across the rolling-4w slice
    // (or the full set if last4 is empty), not whatever happens to sit in
    // index 0 of an unsorted array.
    computedAt: ((last4Snaps.length > 0 ? last4Snaps : snapshots).reduce<Date | null>((acc, s) => {
      const t = s.computedAt ? new Date(s.computedAt) : null;
      if (t && (!acc || t > acc)) return t;
      return acc;
    }, null))?.toISOString() ?? null,
  });
});

// ---------------------------------------------------------------------
// GET /ledger/utilization/engagement/:slug
// Planned vs actual hours, planned vs actual cost, realized margin,
// burn-rate, weeks-of-runway.  :slug accepts either id or slug.
// ACL: leadership OR engagement lead/partner owner of this engagement.
// ---------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/utilization/engagement/:slug", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const key = req.params.slug;

  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(and(
      isNull(atelierEngagements.deletedAt),
      // accept id or slug
      key.includes("eng_") ? eq(atelierEngagements.id, key) : eq(atelierEngagements.slug, key),
    ));
  if (!eng) return void res.status(404).json({ error: "engagement-not-found" });

  // Task #292 — partner-tier + finance + the named engagement lead/partner.
  const isLeadership = canApprovePartner(me) || me.role === "finance";
  const isLead = me.id === eng.engagementLeadId || me.id === eng.partnerOwnerId;
  if (!isLeadership && !isLead) return void res.status(403).json({ error: "forbidden" });

  // Pricing baseline
  const [pricing] = eng.opportunityId
    ? await db
        .select()
        .from(atelierDealPricings)
        .where(and(eq(atelierDealPricings.opportunityId, eng.opportunityId), isNull(atelierDealPricings.deletedAt)))
    : [undefined as never];

  const teamMix = (pricing?.teamMix as Array<{ seniority: string; role?: string; ftePct: number }>) ?? [];
  const durationWeeks = pricing ? Number(pricing.durationWeeks) : 0;

  // Planned hours per seniority bucket: ftePct * duration_weeks * 40
  const plannedBySeniority = new Map<string, { plannedHours: number; role?: string }>();
  for (const t of teamMix) {
    const planned = Number(t.ftePct || 0) * durationWeeks * 40;
    const prev = plannedBySeniority.get(t.seniority) ?? { plannedHours: 0, role: t.role };
    plannedBySeniority.set(t.seniority, { plannedHours: prev.plannedHours + planned, role: prev.role });
  }
  const plannedTotal = Array.from(plannedBySeniority.values()).reduce((s, r) => s + r.plannedHours, 0);
  const plannedCostUsd = pricing ? Number(pricing.computedCostUsd) : 0;
  const plannedPriceUsd = pricing ? Number(pricing.computedPriceUsd) : 0;
  const plannedMarginPct = pricing ? Number(pricing.computedMarginPct) : 0;

  // Actual: pull approved+lead_approved+submitted entries on this engagement.
  const actualEntries = await db
    .select({
      hours: atelierTimesheetEntries.hours,
      personId: atelierTimesheetEntries.personId,
      billable: atelierTimesheetEntries.billable,
      status: atelierTimesheetEntries.status,
    })
    .from(atelierTimesheetEntries)
    .where(and(
      eq(atelierTimesheetEntries.engagementId, eng.id),
      inArray(atelierTimesheetEntries.status, LEDGER_ACTUAL_STATUSES as unknown as string[]),
      isNull(atelierTimesheetEntries.deletedAt),
    ));

  const personIds = Array.from(new Set(actualEntries.map((e) => e.personId)));
  const empRows = personIds.length
    ? await db.select().from(atelierEmployees).where(inArray(atelierEmployees.id, personIds))
    : [];
  const empById = new Map(empRows.map((e) => [e.id, e] as const));

  // Find the active rate card to cost the actual hours (use the latest one).
  const [activeCard] = await db
    .select()
    .from(atelierRateCards)
    .where(isNull(atelierRateCards.deletedAt))
    .orderBy(desc(atelierRateCards.createdAt))
    .limit(1);
  const cardRows = activeCard
    ? await db.select().from(atelierRateCardRows).where(and(eq(atelierRateCardRows.rateCardId, activeCard.id), isNull(atelierRateCardRows.deletedAt)))
    : [];
  const rateBySeniority = new Map(cardRows.map((r) => [r.seniority, { cost: Number(r.dayRateInternalCost), price: Number(r.dayRateClientPrice) }] as const));

  // Bucket actuals by seniority (mapped through employee.seniority → rate card seniority).
  const senioritySeenLabels: Record<string, string> = {
    partner: "Partner", principal: "Principal", manager: "SubjectMatterLead",
    senior_consultant: "AIEngineer", consultant: "AIEngineer", analyst: "Analyst",
  };
  const actualBySeniority = new Map<string, { hours: number; costUsd: number; priceUsd: number }>();
  for (const e of actualEntries) {
    const emp = empById.get(e.personId);
    const seniorityKey = senioritySeenLabels[(emp?.seniority ?? "consultant").toLowerCase()] ?? "AIEngineer";
    const rate = rateBySeniority.get(seniorityKey) ?? { cost: 600, price: 1500 };
    const hours = Number(e.hours || 0);
    const days = hours / 8;
    const prev = actualBySeniority.get(seniorityKey) ?? { hours: 0, costUsd: 0, priceUsd: 0 };
    actualBySeniority.set(seniorityKey, {
      hours: prev.hours + hours,
      costUsd: prev.costUsd + days * rate.cost,
      priceUsd: prev.priceUsd + (e.billable ? days * rate.price : 0),
    });
  }
  const actualTotalHours = Array.from(actualBySeniority.values()).reduce((s, r) => s + r.hours, 0);
  const actualCostUsd = Array.from(actualBySeniority.values()).reduce((s, r) => s + r.costUsd, 0);
  const actualBilledUsd = Array.from(actualBySeniority.values()).reduce((s, r) => s + r.priceUsd, 0);
  const realizedMarginPct = actualBilledUsd > 0 ? (actualBilledUsd - actualCostUsd) / actualBilledUsd : 0;

  const burnPct = plannedTotal > 0 ? actualTotalHours / plannedTotal : 0;
  const weeksOfRunwayPlannedHours = plannedTotal - actualTotalHours;
  const recentEntries = actualEntries.length;
  // crude: average billable hours/week over last 4 weeks of entries.
  const last4Iso = lastNWeeks(4).map((w) => w.weekIso);
  const recentBillable = await db
    .select({ hours: atelierTimesheetEntries.hours, weekIso: atelierTimesheetWeeks.weekIso })
    .from(atelierTimesheetEntries)
    .innerJoin(atelierTimesheetWeeks, eq(atelierTimesheetEntries.weekId, atelierTimesheetWeeks.id))
    .where(and(
      eq(atelierTimesheetEntries.engagementId, eng.id),
      eq(atelierTimesheetEntries.billable, true),
      inArray(atelierTimesheetWeeks.weekIso, last4Iso),
      isNull(atelierTimesheetEntries.deletedAt),
    ));
  const recentRunRate = recentBillable.length
    ? recentBillable.reduce((s, r) => s + Number(r.hours), 0) / Math.max(1, new Set(recentBillable.map((r) => r.weekIso)).size)
    : 0;
  const weeksOfRunway = recentRunRate > 0 ? weeksOfRunwayPlannedHours / recentRunRate : null;

  const planVsActual = Array.from(new Set([...plannedBySeniority.keys(), ...actualBySeniority.keys()])).map((seniority) => {
    const planned = plannedBySeniority.get(seniority) ?? { plannedHours: 0 };
    const actual = actualBySeniority.get(seniority) ?? { hours: 0, costUsd: 0, priceUsd: 0 };
    return {
      seniority,
      plannedHours: planned.plannedHours,
      actualHours: actual.hours,
      variancePct: planned.plannedHours > 0 ? (actual.hours - planned.plannedHours) / planned.plannedHours : 0,
      actualCostUsd: actual.costUsd,
      actualPriceUsd: actual.priceUsd,
    };
  });

  res.json({
    engagementId: eng.id,
    engagementSlug: eng.slug,
    engagementName: eng.name,
    opportunityId: eng.opportunityId,
    plmStage: eng.plmStage,
    planned: {
      hours: plannedTotal,
      costUsd: plannedCostUsd,
      priceUsd: plannedPriceUsd,
      marginPct: plannedMarginPct,
      durationWeeks,
      pricingId: pricing?.id ?? null,
    },
    actual: {
      hours: actualTotalHours,
      costUsd: actualCostUsd,
      billedUsd: actualBilledUsd,
      marginPct: realizedMarginPct,
    },
    planVsActual,
    burnPct,
    weeksOfRunway,
    rateCardId: activeCard?.id ?? null,
  });
});

// ---------------------------------------------------------------------
// GET /ledger/utilization/firm  (Partner-only)
// Partner-by-partner utilization, sector-by-sector margin realization,
// firm realization rate, and a leakage report.
// ---------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/utilization/firm", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if ((me.role !== "partner" && me.role !== "founding_partner")) return void res.status(403).json({ error: "partner-only" });

  // Last 4 weeks for utilization
  const last4Iso = lastNWeeks(4).map((w) => w.weekIso);
  const snaps = await db
    .select()
    .from(atelierUtilizationSnapshots)
    .where(inArray(atelierUtilizationSnapshots.weekIso, last4Iso));
  const emps = await db.select().from(atelierEmployees).where(isNull(atelierEmployees.deletedAt));
  const empById = new Map(emps.map((e) => [e.id, e] as const));

  // Group by partner-owner via engagements assigned to each person.
  // Simplification: utilization is per person; we attribute persons to the
  // partner who owns the largest share of their billable hours over the
  // window. Falls back to "(unattributed)" when the person had no billable
  // engagement work in the window.
  const engs = await db.select().from(atelierEngagements).where(isNull(atelierEngagements.deletedAt));
  const engById = new Map(engs.map((e) => [e.id, e] as const));

  type PartnerAgg = { partnerId: string; partnerName: string; people: { personId: string; name: string; utilPct: number; targetPct: number }[]; weightedUtil: number; weightedTarget: number; weight: number };
  const partnerAgg = new Map<string, PartnerAgg>();
  // partner-owner id on engagements is a *user* id (e.g. "p_mounir_ariss"),
  // not an employee id, so key the aggregator by user id and look up the
  // display name via employees.userId.
  const partners = emps.filter((e) => e.role === "partner");
  for (const p of partners) {
    const key = p.userId ?? p.id;
    partnerAgg.set(key, { partnerId: key, partnerName: p.fullName, people: [], weightedUtil: 0, weightedTarget: 0, weight: 0 });
  }
  partnerAgg.set("__unattributed__", { partnerId: "__unattributed__", partnerName: "(unattributed)", people: [], weightedUtil: 0, weightedTarget: 0, weight: 0 });

  // group snaps by person
  const snapsByPerson = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const arr = snapsByPerson.get(s.personId) ?? [];
    arr.push(s);
    snapsByPerson.set(s.personId, arr);
  }
  for (const [personId, personSnaps] of snapsByPerson) {
    const totalBill = personSnaps.reduce((s, r) => s + Number(r.billableHours), 0);
    const totalAvail = personSnaps.reduce((s, r) => s + Number(r.availableHours), 0);
    const utilPct = totalAvail > 0 ? totalBill / totalAvail : 0;
    const targetPct = personSnaps[0] ? Number(personSnaps[0].targetPct) : 0;

    // attribute via dominant engagement
    const engHours = new Map<string, number>();
    for (const s of personSnaps) {
      for (const m of (s.engagementMix as Array<{ engagementId: string | null; hours: number; billable: boolean }>) ?? []) {
        if (!m.engagementId || !m.billable) continue;
        engHours.set(m.engagementId, (engHours.get(m.engagementId) ?? 0) + Number(m.hours));
      }
    }
    let dominantPartnerId = "__unattributed__";
    let dominantHours = 0;
    for (const [engId, h] of engHours) {
      if (h > dominantHours) {
        const eng = engById.get(engId);
        if (eng) {
          dominantPartnerId = eng.partnerOwnerId;
          dominantHours = h;
        }
      }
    }
    const agg = partnerAgg.get(dominantPartnerId) ?? partnerAgg.get("__unattributed__")!;
    const emp = empById.get(personId);
    agg.people.push({ personId, name: emp?.fullName ?? personId, utilPct, targetPct });
    agg.weightedUtil += utilPct * totalAvail;
    agg.weightedTarget += targetPct * totalAvail;
    agg.weight += totalAvail;
  }

  const partnerSummary = Array.from(partnerAgg.values())
    .filter((p) => p.people.length > 0)
    .map((p) => ({
      partnerId: p.partnerId,
      partnerName: p.partnerName,
      utilPct: p.weight > 0 ? p.weightedUtil / p.weight : 0,
      targetPct: p.weight > 0 ? p.weightedTarget / p.weight : 0,
      peopleCount: p.people.length,
      people: p.people.sort((a, b) => b.utilPct - a.utilPct),
    }));

  // Sector margin realization: per account, aggregate engagement-economics
  const accounts = await db.select().from(atelierAccounts).where(isNull(atelierAccounts.deletedAt));
  const accountById = new Map(accounts.map((a) => [a.id, a] as const));

  type SectorAgg = { sector: string; plannedMargin: number; realizedMargin: number; engagementCount: number; weightUsd: number };
  const sectorAgg = new Map<string, SectorAgg>();

  // Cost actual entries
  const allActuals = await db
    .select({
      engagementId: atelierTimesheetEntries.engagementId,
      hours: atelierTimesheetEntries.hours,
      personId: atelierTimesheetEntries.personId,
      billable: atelierTimesheetEntries.billable,
    })
    .from(atelierTimesheetEntries)
    .where(and(
      inArray(atelierTimesheetEntries.status, LEDGER_ACTUAL_STATUSES as unknown as string[]),
      isNull(atelierTimesheetEntries.deletedAt),
    ));

  const [activeCard] = await db
    .select()
    .from(atelierRateCards)
    .where(isNull(atelierRateCards.deletedAt))
    .orderBy(desc(atelierRateCards.createdAt))
    .limit(1);
  const cardRows = activeCard
    ? await db.select().from(atelierRateCardRows).where(eq(atelierRateCardRows.rateCardId, activeCard.id))
    : [];
  const rateBySeniority = new Map(cardRows.map((r) => [r.seniority, { cost: Number(r.dayRateInternalCost), price: Number(r.dayRateClientPrice) }] as const));
  const senLabel: Record<string, string> = {
    partner: "Partner", principal: "Principal", manager: "SubjectMatterLead",
    senior_consultant: "AIEngineer", consultant: "AIEngineer", analyst: "Analyst",
  };

  // Per-engagement actuals
  const perEng = new Map<string, { hours: number; cost: number; price: number; billableHours: number }>();
  for (const e of allActuals) {
    if (!e.engagementId) continue;
    const emp = empById.get(e.personId);
    const sk = senLabel[(emp?.seniority ?? "consultant").toLowerCase()] ?? "AIEngineer";
    const rate = rateBySeniority.get(sk) ?? { cost: 600, price: 1500 };
    const days = Number(e.hours || 0) / 8;
    const prev = perEng.get(e.engagementId) ?? { hours: 0, cost: 0, price: 0, billableHours: 0 };
    perEng.set(e.engagementId, {
      hours: prev.hours + Number(e.hours || 0),
      cost: prev.cost + days * rate.cost,
      price: prev.price + (e.billable ? days * rate.price : 0),
      billableHours: prev.billableHours + (e.billable ? Number(e.hours || 0) : 0),
    });
  }

  // Engagement leakage list: billable hours that are 'lead_approved' but not
  // yet 'partner_approved'/'approved' (proxy for "not yet invoiced" since
  // the Wallet/invoicing module lands in Task #259).
  const leakRows = await db
    .select({
      engagementId: atelierTimesheetEntries.engagementId,
      hours: atelierTimesheetEntries.hours,
      personId: atelierTimesheetEntries.personId,
    })
    .from(atelierTimesheetEntries)
    .where(and(
      eq(atelierTimesheetEntries.status, "lead_approved"),
      eq(atelierTimesheetEntries.billable, true),
      isNull(atelierTimesheetEntries.deletedAt),
    ));
  const leakByEng = new Map<string, number>();
  for (const r of leakRows) {
    if (!r.engagementId) continue;
    leakByEng.set(r.engagementId, (leakByEng.get(r.engagementId) ?? 0) + Number(r.hours || 0));
  }

  // Realization rate (firm-wide) = approved billable hours / (approved + lead_approved billable hours)
  let invoicedAtFullRate = 0;
  let availableAtFullRate = 0;
  for (const e of allActuals) {
    if (!e.billable) continue;
    availableAtFullRate += Number(e.hours || 0);
    // 'approved' or 'partner_approved' is our proxy for invoice-ready.
    // (Note: actual entries fetch above doesn't carry status; we redo it below for clarity.)
  }
  const apr = await db
    .select({ status: atelierTimesheetEntries.status, hours: atelierTimesheetEntries.hours })
    .from(atelierTimesheetEntries)
    .where(and(
      eq(atelierTimesheetEntries.billable, true),
      inArray(atelierTimesheetEntries.status, ["lead_approved", "approved", "partner_approved"]),
      isNull(atelierTimesheetEntries.deletedAt),
    ));
  const fullRateAvail = apr.reduce((s, r) => s + Number(r.hours), 0);
  const fullRateInv = apr.filter((r) => r.status === "approved" || r.status === "partner_approved").reduce((s, r) => s + Number(r.hours), 0);
  const realizationRatePct = fullRateAvail > 0 ? fullRateInv / fullRateAvail : 0;

  // Batch-prefetch pricings for *all* engagements in this view so neither
  // the sector-aggregation loop below nor the engagement rollup further
  // down has to N+1 a per-engagement pricing query. Keyed by opportunityId.
  const oppIds = engs.map((e) => e.opportunityId).filter((x): x is string => !!x);
  const pricingRows = oppIds.length
    ? await db
        .select()
        .from(atelierDealPricings)
        .where(and(inArray(atelierDealPricings.opportunityId, oppIds), isNull(atelierDealPricings.deletedAt)))
    : [];
  const pricingByOpp = new Map(pricingRows.map((p) => [p.opportunityId, p] as const));

  // Sector margin
  for (const eng of engs) {
    const acct = accountById.get(eng.accountId);
    if (!acct) continue;
    const actuals = perEng.get(eng.id);
    if (!actuals) continue;
    const realizedMargin = actuals.price > 0 ? (actuals.price - actuals.cost) / actuals.price : 0;
    const pricing = eng.opportunityId ? pricingByOpp.get(eng.opportunityId) : undefined;
    const plannedMargin = pricing ? Number(pricing.computedMarginPct) : 0;
    const sec = sectorAgg.get(acct.sector) ?? { sector: acct.sector, plannedMargin: 0, realizedMargin: 0, engagementCount: 0, weightUsd: 0 };
    const w = actuals.price;
    sec.plannedMargin += plannedMargin * w;
    sec.realizedMargin += realizedMargin * w;
    sec.weightUsd += w;
    sec.engagementCount += 1;
    sectorAgg.set(acct.sector, sec);
  }
  const sectorSummary = Array.from(sectorAgg.values()).map((s) => ({
    sector: s.sector,
    plannedMarginPct: s.weightUsd > 0 ? s.plannedMargin / s.weightUsd : 0,
    realizedMarginPct: s.weightUsd > 0 ? s.realizedMargin / s.weightUsd : 0,
    engagementCount: s.engagementCount,
    revenueUsd: s.weightUsd,
  }));

  // Per-engagement leakage + realized-margin row, with re-look CTA
  // pointer. `pricingByOpp` was prefetched above the sector loop.
  const engagementRollup = engs.map((eng) => {
    const acct = accountById.get(eng.accountId);
    const actuals = perEng.get(eng.id) ?? { hours: 0, cost: 0, price: 0, billableHours: 0 };
    const realizedMargin = actuals.price > 0 ? (actuals.price - actuals.cost) / actuals.price : 0;
    const pricing = eng.opportunityId ? pricingByOpp.get(eng.opportunityId) : undefined;
    const plannedMargin = pricing ? Number(pricing.computedMarginPct) : 0;
    const targetMargin = pricing ? Number(pricing.targetMarginPct) : 0.55;
    // Trigger the re-look CTA whenever an engagement is below its target,
    // including zero or negative realized margin (those are exactly the
    // engagements that most need a pricing review).
    const belowTarget = actuals.hours > 0 && realizedMargin < targetMargin;
    return {
      engagementId: eng.id,
      engagementName: eng.name,
      accountName: acct?.name ?? "?",
      sector: acct?.sector ?? "?",
      partnerOwnerId: eng.partnerOwnerId,
      opportunityId: eng.opportunityId,
      plannedMarginPct: plannedMargin,
      realizedMarginPct: realizedMargin,
      targetMarginPct: targetMargin,
      belowTarget,
      reLookHref: belowTarget && eng.opportunityId ? `/pricing/${eng.opportunityId}` : null,
      leakageHours: leakByEng.get(eng.id) ?? 0,
    };
  });

  res.json({
    period: { weeks: 4, weekIsos: last4Iso },
    realizationRatePct,
    fullRateInvoicedHours: fullRateInv,
    fullRateAvailableHours: fullRateAvail,
    partnerSummary,
    sectorSummary,
    engagementRollup,
    snapshotsAvailable: snaps.length > 0,
    // Most recent snapshot timestamp across the rolling-4w window, not
    // index 0 of an unsorted array.
    computedAt: (snaps.reduce<Date | null>((acc, s) => {
      const t = s.computedAt ? new Date(s.computedAt) : null;
      if (t && (!acc || t > acc)) return t;
      return acc;
    }, null))?.toISOString() ?? null,
  });
});

// ---------------------------------------------------------------------
// POST /ledger/utilization/narrative  → run Utilization Analyst.
// Body: { view, targetId, period, numericBlock }
// ---------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/utilization/narrative", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const body = (req.body ?? {}) as {
    view?: "person" | "engagement" | "firm";
    targetId?: string;
    targetLabel?: string;
    period?: string;
  };
  if (!body.view || !body.targetId) {
    return void res.status(400).json({ error: "view-and-targetId-required" });
  }
  // Hydrate the numeric block server-side from the canonical snapshot/data
  // store. Any client-supplied numericBlock is intentionally ignored — the
  // analyst contract is "deterministic numbers first", so the only numbers
  // it ever sees are ones we computed ourselves on this turn. This also
  // lets us derive the freshness anchor (computedAt) from the same source.
  const hydrated = await hydrateUtilizationNumericBlock(body.view, body.targetId, me);
  if ("error" in hydrated) return void res.status(hydrated.status).json({ error: hydrated.error });
  const out = await runUtilizationAnalyst({
    view: body.view,
    targetId: body.targetId,
    targetLabel: body.targetLabel ?? body.targetId,
    period: body.period ?? "rolling-4w",
    numericBlock: hydrated.numericBlock,
    computedAt: hydrated.computedAt,
    triggeredByUserId: me.id,
  });
  res.json(out);
});

// Server-side numeric-block hydrator. Mirrors the math in the corresponding
// GET handlers but only returns the fields the analyst is allowed to cite.
async function hydrateUtilizationNumericBlock(
  view: "person" | "engagement" | "firm",
  targetId: string,
  me: { id: string; role: string },
): Promise<
  | { numericBlock: Record<string, unknown> | null; computedAt: string | null }
  | { error: string; status: number }
> {
  if (view === "person") {
    const [emp] = await db
      .select()
      .from(atelierEmployees)
      .where(and(
        isNull(atelierEmployees.deletedAt),
        targetId.startsWith("emp_") ? eq(atelierEmployees.id, targetId) : eq(atelierEmployees.userId, targetId),
      ));
    // Task #292 — lead-tier (partner|founding_partner|senior_manager|finance).
    const isLeadership = canApproveLead(me);
    if (!isLeadership && (!emp || emp.userId !== me.id)) return { error: "forbidden", status: 403 };
    const resolvedId = emp?.id ?? targetId;
    const last4Iso = lastNWeeks(4).map((w) => w.weekIso);
    const snaps = await db
      .select()
      .from(atelierUtilizationSnapshots)
      .where(eq(atelierUtilizationSnapshots.personId, resolvedId));
    const last4 = snaps.filter((s) => last4Iso.includes(s.weekIso));
    const ytd = snaps.filter((s) => s.weekIso.startsWith(String(new Date().getUTCFullYear())));
    const sum = (arr: typeof snaps) => ({
      bill: arr.reduce((s, r) => s + Number(r.billableHours), 0),
      avail: arr.reduce((s, r) => s + Number(r.availableHours), 0),
    });
    // Hard refusal contract: if no snapshot rows exist for this person at
    // all, the analyst MUST refuse rather than narrate synthetic zeros.
    if (snaps.length === 0) return { numericBlock: null, computedAt: null };
    const r4 = sum(last4); const yt = sum(ytd);
    const targetPct = emp?.utilizationTargetPct ? emp.utilizationTargetPct / 100 : defaultTargetPctFor(emp?.role, emp?.seniority);
    const utilizationPct = r4.avail > 0 ? r4.bill / r4.avail : 0;
    // Freshness anchor must come from the *same scoped slice* the metric
    // is built on (rolling-4w). An older YTD row would falsely mark fresh
    // numbers as stale.
    const scopedComputed = (last4.length > 0 ? last4 : snaps).reduce<Date | null>((acc, s) => {
      const t = s.computedAt ? new Date(s.computedAt) : null;
      if (t && (!acc || t > acc)) return t;
      return acc;
    }, null);
    const computedAt = scopedComputed ? scopedComputed.toISOString() : null;
    return {
      numericBlock: {
        utilizationPct,
        targetPct,
        ytdUtilPct: yt.avail > 0 ? yt.bill / yt.avail : 0,
        variancePct: utilizationPct - targetPct,
        weeks: last4.length,
      },
      computedAt,
    };
  }
  if (view === "engagement") {
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(and(
        isNull(atelierEngagements.deletedAt),
        targetId.includes("eng_") ? eq(atelierEngagements.id, targetId) : eq(atelierEngagements.slug, targetId),
      ));
    if (!eng) return { error: "engagement-not-found", status: 404 };
    // Task #292 — partner-tier + finance + named lead/partner-owner.
    const isLeadership = canApprovePartner(me) || me.role === "finance";
    const isLead = me.id === eng.engagementLeadId || me.id === eng.partnerOwnerId;
    if (!isLeadership && !isLead) return { error: "forbidden", status: 403 };
    // Reuse the engagement endpoint's pricing + actuals math by calling the
    // same helper. Cheap path: re-run the queries inline (kept terse).
    const [pricing] = eng.opportunityId
      ? await db.select().from(atelierDealPricings).where(and(eq(atelierDealPricings.opportunityId, eng.opportunityId), isNull(atelierDealPricings.deletedAt)))
      : [undefined as never];
    const teamMix = (pricing?.teamMix as Array<{ ftePct: number }>) ?? [];
    const durationWeeks = pricing ? Number(pricing.durationWeeks) : 0;
    const plannedHours = teamMix.reduce((s, t) => s + Number(t.ftePct || 0) * durationWeeks * 40, 0);
    const actuals = await db
      .select({ hours: atelierTimesheetEntries.hours, billable: atelierTimesheetEntries.billable, updatedAt: atelierTimesheetEntries.updatedAt })
      .from(atelierTimesheetEntries)
      .where(and(
        eq(atelierTimesheetEntries.engagementId, eng.id),
        inArray(atelierTimesheetEntries.status, LEDGER_ACTUAL_STATUSES as unknown as string[]),
        isNull(atelierTimesheetEntries.deletedAt),
      ));
    // Hard refusal: no pricing baseline AND no actual hours = nothing for
    // the analyst to anchor on. Refuse rather than narrate "0 vs 0".
    if (!pricing && actuals.length === 0) return { numericBlock: null, computedAt: null };
    const actualHours = actuals.reduce((s, a) => s + Number(a.hours || 0), 0);
    const burnPct = plannedHours > 0 ? actualHours / plannedHours : 0;
    const plannedMarginPct = pricing ? Number(pricing.computedMarginPct) : 0;
    return {
      numericBlock: {
        plannedHours,
        actualHours,
        burnPct,
        plannedMarginPct,
        plmStage: eng.plmStage,
      },
      // Engagement freshness must reflect the *most recent of* pricing
      // baseline and actual time entries — pricing changes infrequently
      // but timesheet flow drives realized economics. Anchoring on
      // pricing.updatedAt alone falsely staled live engagements.
      computedAt: (() => {
        const candidates: number[] = [];
        if (pricing?.updatedAt) candidates.push(new Date(pricing.updatedAt).getTime());
        for (const a of actuals) if (a.updatedAt) candidates.push(new Date(a.updatedAt).getTime());
        if (candidates.length === 0) return null;
        return new Date(Math.max(...candidates)).toISOString();
      })(),
    };
  }
  // view === "firm"
  if ((me.role !== "partner" && me.role !== "founding_partner")) return { error: "partner-only", status: 403 };
  const last4Iso = lastNWeeks(4).map((w) => w.weekIso);
  const snaps = await db.select().from(atelierUtilizationSnapshots).where(inArray(atelierUtilizationSnapshots.weekIso, last4Iso));
  // Hard refusal: no snapshots in the window = nothing to anchor on.
  if (snaps.length === 0) return { numericBlock: null, computedAt: null };
  const totalBill = snaps.reduce((s, r) => s + Number(r.billableHours), 0);
  const totalAvail = snaps.reduce((s, r) => s + Number(r.availableHours), 0);
  const firmComputed = snaps.reduce<Date | null>((acc, s) => {
    const t = s.computedAt ? new Date(s.computedAt) : null;
    if (t && (!acc || t > acc)) return t;
    return acc;
  }, null);
  const apr = await db
    .select({ status: atelierTimesheetEntries.status, hours: atelierTimesheetEntries.hours })
    .from(atelierTimesheetEntries)
    .where(and(
      eq(atelierTimesheetEntries.billable, true),
      inArray(atelierTimesheetEntries.status, ["lead_approved", "approved", "partner_approved"]),
      isNull(atelierTimesheetEntries.deletedAt),
    ));
  const fullRateAvail = apr.reduce((s, r) => s + Number(r.hours), 0);
  const fullRateInv = apr.filter((r) => r.status === "approved" || r.status === "partner_approved").reduce((s, r) => s + Number(r.hours), 0);
  return {
    numericBlock: {
      firmUtilizationPct: totalAvail > 0 ? totalBill / totalAvail : 0,
      realizationRatePct: fullRateAvail > 0 ? fullRateInv / fullRateAvail : 0,
      peopleCount: new Set(snaps.map((s) => s.personId)).size,
      weeks: last4Iso.length,
    },
    computedAt: firmComputed ? firmComputed.toISOString() : null,
  };
}

// ---------------------------------------------------------------------
// POST /ledger/utilization/snapshot/run (Partner/Operations) — manual recompute.
// POST /ledger/burn-sentinel/run        (Partner/Operations) — manual sweep.
// ---------------------------------------------------------------------
// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/utilization/snapshot/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Task #292 — partner-tier + finance.
  if (!canApprovePartner(me) && me.role !== "finance") return void res.status(403).json({ error: "forbidden" });
  const out = await runUtilizationSnapshotTick({ force: true, weeksBack: 8 });
  res.json(out);
});

// @cli-skip: pending Task #340 read-parity migration
router.post("/ledger/burn-sentinel/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApprovePartner(me) && me.role !== "finance") return void res.status(403).json({ error: "forbidden" });
  const out = await runBurnSentinelTick({ force: true });
  res.json(out);
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/ledger/burn-sentinel/engagement/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(and(eq(atelierEngagements.id, req.params.id), isNull(atelierEngagements.deletedAt)));
  if (!eng) return void res.status(404).json({ error: "engagement-not-found" });
  // Task #292 — partner-tier + finance + named engagement lead/partner-owner.
  const isLeadership = canApprovePartner(me) || me.role === "finance";
  const isLead = me.id === eng.engagementLeadId || me.id === eng.partnerOwnerId;
  if (!isLeadership && !isLead) return void res.status(403).json({ error: "forbidden" });
  const summary = await getEngagementBurnSummary(req.params.id);
  if (!summary) return void res.status(404).json({ error: "no-burn-data" });
  res.json(summary);
});

export default router;
