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
import { runTimeSteward } from "../../lib/atelier-agents/runner.js";
import { runLedgerNudgeTick, runLedgerStewardTick } from "../../lib/atelier-agents/ledgerNudges.js";

const router: IRouter = Router();

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

function canApproveLead(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner" || me.role === "engagement_lead" || me.role === "operations";
}
function canApprovePartner(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner";
}
// Partner-firm-resource personas (the partner-firm PMs) upload their own
// firm's hours; partner/operations may also do so on their behalf.
function canUploadPartnerFirmHours(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner_firm_resource" || me.role === "partner" || me.role === "operations";
}
// Engagement economics consumers: leadership + the firm whose hours these are.
function canViewPartnerFirmHours(me: typeof atelierUsers.$inferSelect): boolean {
  return (
    me.role === "partner" ||
    me.role === "operations" ||
    me.role === "engagement_lead" ||
    me.role === "partner_firm_resource"
  );
}
function canManagePartnerFirm(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner" || me.role === "operations";
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
router.post("/ledger/approvals/:weekId/approve", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const role = (req.body?.role as string) ?? "lead";
  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(eq(atelierTimesheetWeeks.id, req.params.weekId));
  if (!week) {
    res.status(404).json({ error: "week-not-found" });
    return;
  }
  if (role === "lead") {
    if (!canApproveLead(me)) return void res.status(403).json({ error: "forbidden" });
    if (week.status !== "submitted")
      return void res.status(409).json({ error: "out-of-order", reason: `Week is ${week.status}.` });
    await db
      .update(atelierTimesheetWeeks)
      .set({ status: "lead_approved", leadApprovedAt: new Date(), leadApprovedByUserId: me.id, updatedAt: new Date() })
      .where(eq(atelierTimesheetWeeks.id, week.id));
    // Cascade: every submitted entry in this week becomes lead_approved so
    // the entry-level audit trail mirrors the week-level approval state.
    await db
      .update(atelierTimesheetEntries)
      .set({ status: "lead_approved", updatedAt: new Date() })
      .where(
        and(
          eq(atelierTimesheetEntries.weekId, week.id),
          eq(atelierTimesheetEntries.status, "submitted"),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      );
  } else if (role === "partner") {
    if (!canApprovePartner(me)) return void res.status(403).json({ error: "forbidden" });
    if (week.status !== "lead_approved")
      return void res
        .status(409)
        .json({ error: "out-of-order", reason: `Partner approval requires lead_approved (currently ${week.status}).` });
    await db
      .update(atelierTimesheetWeeks)
      .set({
        status: "partner_approved",
        partnerApprovedAt: new Date(),
        partnerApprovedByUserId: me.id,
        updatedAt: new Date(),
      })
      .where(eq(atelierTimesheetWeeks.id, week.id));
    await db
      .update(atelierTimesheetEntries)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(atelierTimesheetEntries.weekId, week.id));
  } else {
    return void res.status(400).json({ error: "invalid-role" });
  }
  await audit({
    entityType: "timesheet_week",
    entityId: week.id,
    actor: me,
    action: `ledger.approve.${role}`,
    payload: { role },
    summary: `${me.name} approved week ${week.weekIso} (${role})`,
  });
  res.json({ ok: true });
});

// =====================================================================
// POST /ledger/approvals/:weekId/reject
// =====================================================================
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
router.get("/roster/people/:id/timesheet-summary", (req, res, next) => {
  // Delegate to the /ledger/-prefixed handler so both URLs share one impl.
  req.url = `/ledger/roster/people/${req.params.id}/timesheet-summary`;
  next("route");
});
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
router.post("/ledger/nudges/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner" && me.role !== "operations") {
    return void res.status(403).json({ error: "forbidden" });
  }
  const force = req.body?.force as "submit_due" | "approve_due" | undefined;
  const out = await runLedgerNudgeTick({ force });
  res.json(out);
});

// Manual trigger for the daily Time Steward draft pass — partner/operations
// only. Lets QA and runbooks force the same backfill that runs Mon 06:00 GST
// from startLedgerNudgeJob's 15-minute ticker.
router.post("/ledger/steward/run", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (me.role !== "partner" && me.role !== "operations") {
    return void res.status(403).json({ error: "forbidden" });
  }
  const out = await runLedgerStewardTick({ force: true });
  res.json(out);
});

export default router;
