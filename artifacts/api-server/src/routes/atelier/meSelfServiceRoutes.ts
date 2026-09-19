/**
 * Atelier — Task #53: Me lens self-service (timesheets, leave, expenses).
 *
 * Self-scope surfaces (safe for the boundary-locked employee/contractor
 * personas — every read/write answers ONLY for the caller's own identity):
 *
 *   GET  /me/timesheets/current                      — own current week
 *   POST /me/timesheets/:weekId/draft                — run Time Steward on own week
 *   POST /me/timesheets/:weekId/entries              — upsert own entry
 *   POST /me/timesheets/:weekId/entries/:id/confirm  — confirm agent-drafted row
 *   DELETE /me/timesheets/entries/:entryId           — delete own entry
 *   POST /me/timesheets/:weekId/submit               — submit own week
 *
 *   GET  /me/leave                                   — own requests + balance
 *   POST /me/leave                                   — create a leave request
 *   POST /me/leave/:id/cancel                        — cancel own pending request
 *
 *   GET  /me/expenses                                — own claims
 *   POST /me/expenses                                — create draft claim
 *   PATCH /me/expenses/:id                           — edit own draft
 *   DELETE /me/expenses/:id                          — delete own draft
 *   POST /me/expenses/:id/submit                     — submit (deterministic policy)
 *   POST /me/expenses/receipt-upload                 — signed upload URL (private bucket)
 *   GET  /me/expenses/:id/receipt                    — stream own receipt
 *   GET  /me/expense-contexts                        — minimal account/engagement tags
 *
 * Approver surfaces (NOT under /me — self-only personas cannot reach them;
 * these back the existing People/Finance approval pages):
 *
 *   GET  /roster/leave-requests                      — queue (lead approvers + HR)
 *   POST /roster/leave-requests/:id/approve|reject   — decide (no self-approval)
 *   GET  /roster/leave-entitlements?year=            — HR/leadership/finance view
 *   PUT  /roster/leave-entitlements                  — HR upsert per person+year
 *
 * Status changes here and in ledger/wallet emit Me-home notification cards
 * via emitSelfNotification.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierContractors,
  atelierAccounts,
  atelierEngagements,
  atelierExpenses,
  atelierAuditEvents,
  atelierTimesheetWeeks,
  atelierTimesheetEntries,
  atelierTimesheetSignals,
  atelierLeaveRequests,
  atelierLeaveEntitlements,
  atelierLeaveTypeEntitlements,
  atelierRosterReportsTo,
  atelierHolidayOverrides,
  atelierContractRecords,
  atelierContractDocuments,
} from "@workspace/db";
import {
  resolvePersonForCaller,
  ensureWeekShell,
  getWeekResponse,
  entryWire,
  signalWire,
  recomputeWeekTotals,
  detectSuspiciousFlags,
  validateLedgerEntryInput,
  isoWeekOf,
  type PersonRow,
} from "./ledgerRoutes";
import { emitSelfNotification, resolveUserIdForPerson } from "./meRoutes";
// Task #501 — founder submit-notifications shared with the wallet route.
import { notifyFoundersOfSubmittedExpense } from "./walletRoutes";
import { recomputeEngagementCostToDate } from "../../lib/atelier-engagement-pnl-recompute.js";
import {
  canApproveAsLead,
  canApproveAsPartner,
  isHr,
  isLeadership,
  isFinance,
} from "./personaRoles.js";
import {
  runTimeSteward,
  runExpenseAuditor,
  type ExpenseAuditorProposal,
} from "../../lib/atelier-agents/runner.js";
import { proposeExpenseAllocation } from "../../lib/atelier-entity-allocation.js";
import { buildContractDigest } from "../../lib/atelier-contract-digest.js";
import { normalizeContingencyType, wireReimbursementTrigger, resolveExpenseBeneficiary } from "../../lib/atelier-expense-lifecycle.js";
import { convertToUsd, convertUsdTo, DISPLAY_CURRENCIES } from "../../lib/atelier-fx.js";
import { PUSH_CATEGORIES, resolvePushCategoryPrefs } from "../../lib/expoPush.js";
import {
  evaluateExpense,
  ensureDefaultExpensePolicies,
  POLICY_PRINCIPLES,
} from "../../lib/atelier-expense-policy.js";
import { atelierExpensePolicies } from "@workspace/db";
// Task #383 — taxonomy + attribution + funding + merchant-memory learning.
import { resolveExpenseExtras } from "../../lib/atelier-expense-attribution.js";
import {
  resolveCategoryPair,
  policyKeyFor,
  mapLegacyCategory,
} from "../../lib/atelier-expense-taxonomy.js";
import {
  lookupMerchantMemory,
  learnMerchantMapping,
} from "../../lib/atelier-expense-categorizer.js";
import { parseReceiptForExpense } from "../../lib/atelier-receipt-parse.js";
import {
  startBackgroundJob,
  reapStaleRunningJob,
  completeBackgroundJob,
  failBackgroundJob,
  getLatestJob,
} from "../../lib/background-jobs.js";
import { assertAuditAction } from "./auditContract.js";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../../lib/objectStorage.js";
import { sendReceiptForDisplay } from "../../lib/atelier-heic.js";
import { ObjectPermission } from "../../lib/objectAcl.js";
// Task #602 — auto out-of-office on approved leave + curated holidays.
import { applyLeaveOoo, clearLeaveOoo } from "../../lib/atelierLeaveOoo.js";
import {
  holidaysInRange,
  countryToCode,
  nextWorkingDayAfter,
  HOLIDAY_COUNTRIES,
  PUBLIC_HOLIDAYS,
  COUNTRY_NAMES,
  DATASET_YEARS,
  holidayKeyOf,
  applyHolidayOverrides,
  type HolidayCountry,
} from "../../lib/atelierHolidays.js";
// Task #606 — HR review decisions over the curated holiday dataset.
import {
  loadHolidayOverrideRows,
  toHolidayOverrides,
} from "../../lib/atelierHolidayOverrides.js";
import { invalidateFinanceFacts } from "./financeRealFacts";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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

// =====================================================================
// TIMESHEETS — self-scoped mirrors of the /ledger/timesheets surface.
// Ownership is enforced by resolving the CALLER's person row and matching
// it against the week — ids in the URL can never widen access.
// =====================================================================

async function requireSelfPerson(
  req: Request,
  res: Response,
): Promise<{ me: typeof atelierUsers.$inferSelect; person: PersonRow } | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const person = await resolvePersonForCaller(me);
  if (!person) {
    res.status(404).json({
      error: "person-not-found",
      reason: "Active persona is not bound to an employee/contractor row.",
    });
    return null;
  }
  return { me, person };
}

async function requireOwnWeek(
  req: Request,
  res: Response,
  weekId: string,
): Promise<
  | {
      me: typeof atelierUsers.$inferSelect;
      person: PersonRow;
      week: typeof atelierTimesheetWeeks.$inferSelect;
    }
  | null
> {
  const ctx = await requireSelfPerson(req, res);
  if (!ctx) return null;
  const [week] = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(and(eq(atelierTimesheetWeeks.id, weekId), isNull(atelierTimesheetWeeks.deletedAt)));
  if (!week || week.personId !== ctx.person.id) {
    // Foreign weeks 404 (not 403) so ids can't be probed.
    res.status(404).json({ error: "week-not-found" });
    return null;
  }
  return { ...ctx, week };
}

// @cli-skip: self-scope timesheet read; no CLI shape (Task #53)
router.get("/me/timesheets/current", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const { me } = ctx;
    const { weekIso } = isoWeekOf(new Date());
    const week = await ensureWeekShell(ctx.person, weekIso);
    // Approved-leave overlay: leave that intersects this week rides on the
    // timesheet payload so the two surfaces can never disagree.
    const weekStart = week.weekStartDate; // ISO Monday
    const weekEnd = addDaysIso(weekStart, 6);
    const leaveRows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, ctx.me.orgId),
          eq(atelierLeaveRequests.personId, ctx.person.id),
          eq(atelierLeaveRequests.status, "approved"),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      );
    const approvedLeave = leaveRows
      .filter((r) => r.startDate <= weekEnd && weekStart <= r.endDate)
      .map((r) => ({
        id: r.id,
        leaveType: r.leaveType,
        startDate: r.startDate,
        endDate: r.endDate,
        // The specific dates inside THIS week covered by the leave.
        dates: isoDatesBetween(
          r.startDate > weekStart ? r.startDate : weekStart,
          r.endDate < weekEnd ? r.endDate : weekEnd,
        ),
      }));
    // No auto-draft here — the Me lens keeps week loads instant; the user
    // can run the Time Steward explicitly via POST /me/timesheets/:id/draft.
    return getWeekResponse(res, week, ctx.person, { approvedLeave });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope timesheet draft; no CLI shape (Task #53)
router.post("/me/timesheets/:weekId/draft", async (req, res, next) => {
  try {
    const ctx = await requireOwnWeek(req, res, req.params.weekId);
    if (!ctx) return;
    const { week, me } = ctx;
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
      summary: `Time Steward drafted ${out.draftEntriesCreated} entries from Me lens`,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope timesheet entry upsert; no CLI shape (Task #53)
router.post("/me/timesheets/:weekId/entries", async (req, res, next) => {
  try {
    const ctx = await requireOwnWeek(req, res, req.params.weekId);
    if (!ctx) return;
    const { week, me } = ctx;
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
    const structuralError = await validateLedgerEntryInput({ me, week, body, existingId: id });
    if (structuralError) {
      res.status(400).json({ error: "invalid-entry", reason: structuralError });
      return;
    }
    const values = {
      weekId: week.id,
      personId: week.personId,
      personType: week.personType,
      workDate,
      engagementId: (body.engagementId as string | null) ?? null,
      activityCode:
        (body.activityCode as string | null) ?? (body.engagementId ? "billable" : "internal"),
      hours,
      billable: !!body.engagementId && body.billable !== false,
      narrative: (body.narrative as string | null) ?? null,
      source: "human" as const,
      status: "draft" as const,
      createdByUserId: me.id,
    };
    if (id) {
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
      try {
        await db.transaction(async (tx) => {
          const duplicate = await tx.select({ id: atelierTimesheetEntries.id })
            .from(atelierTimesheetEntries)
            .where(and(
              eq(atelierTimesheetEntries.weekId, week.id),
              eq(atelierTimesheetEntries.personId, week.personId),
              eq(atelierTimesheetEntries.workDate, workDate),
              eq(atelierTimesheetEntries.engagementId, values.engagementId as string),
              isNull(atelierTimesheetEntries.deletedAt),
            )).limit(1);
          if (duplicate.length) throw new Error("duplicate-engagement-date");
          await tx.insert(atelierTimesheetEntries).values({ id: rid("tse"), ...values });
        });
      } catch (err) {
        if (err instanceof Error && err.message === "duplicate-engagement-date") {
          res.status(409).json({ error: err.message });
          return;
        }
        throw err;
      }
    }
    await recomputeWeekTotals(week.id);
    if (values.engagementId) await recomputeEngagementCostToDate(values.engagementId, { actorUserId: me.id }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope timesheet entry confirm; no CLI shape (Task #53)
router.post("/me/timesheets/:weekId/entries/:entryId/confirm", async (req, res, next) => {
  try {
    const ctx = await requireOwnWeek(req, res, req.params.weekId);
    if (!ctx) return;
    const { week, me } = ctx;
    if (week.status !== "draft" && week.status !== "rejected") {
      res.status(409).json({ error: "week-locked" });
      return;
    }
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
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope timesheet entry delete; no CLI shape (Task #53)
router.delete("/me/timesheets/entries/:entryId", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const { me } = ctx;
    const [entry] = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(
        and(
          eq(atelierTimesheetEntries.id, req.params.entryId),
          eq(atelierTimesheetEntries.personId, ctx.person.id),
          isNull(atelierTimesheetEntries.deletedAt),
        ),
      );
    if (!entry) {
      res.status(404).json({ error: "entry-not-found" });
      return;
    }
    const [week] = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(eq(atelierTimesheetWeeks.id, entry.weekId));
    if (!week || (week.status !== "draft" && week.status !== "rejected")) {
      res.status(409).json({ error: "week-locked" });
      return;
    }
    await db
      .update(atelierTimesheetEntries)
      .set({ deletedAt: new Date() })
      .where(eq(atelierTimesheetEntries.id, entry.id));
    await recomputeWeekTotals(week.id);
    if (entry.engagementId) await recomputeEngagementCostToDate(entry.engagementId, { actorUserId: me.id }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope timesheet submit; no CLI shape (Task #53)
router.post("/me/timesheets/:weekId/submit", async (req, res, next) => {
  try {
    const ctx = await requireOwnWeek(req, res, req.params.weekId);
    if (!ctx) return;
    const { week, me } = ctx;
    if (week.status !== "draft" && week.status !== "rejected") {
      res.status(409).json({ error: "week-locked", reason: `Week is ${week.status}.` });
      return;
    }
    const entries = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(and(eq(atelierTimesheetEntries.weekId, week.id), isNull(atelierTimesheetEntries.deletedAt)));
    for (const entry of entries) {
      const structuralError = await validateLedgerEntryInput({
        me,
        week,
        existingId: entry.id,
        body: {
          workDate: entry.workDate,
          hours: Number(entry.hours),
          engagementId: entry.engagementId,
          billable: entry.billable,
          narrative: entry.narrative,
        },
      });
      if (structuralError) {
        res.status(400).json({ error: "invalid-entry", entryId: entry.id, reason: structuralError });
        return;
      }
    }
    const signals = await db
      .select()
      .from(atelierTimesheetSignals)
      .where(eq(atelierTimesheetSignals.weekId, week.id));
    const flags = detectSuspiciousFlags(entries.map(entryWire), signals.map(signalWire));
    const force = !!req.body?.acknowledgeFlags;
    if (flags.length && !force) {
      await db
        .update(atelierTimesheetWeeks)
        .set({ suspiciousFlags: flags, updatedAt: new Date() })
        .where(eq(atelierTimesheetWeeks.id, week.id));
      res.status(409).json({
        error: "suspicious-pattern",
        reason:
          "One or more suspicious patterns detected. Re-submit with acknowledgeFlags:true to record an explanation.",
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
      payload: { flags, acknowledged: force, via: "me-lens" },
      summary: `${me.name} submitted week ${week.weekIso} from Me lens`,
    });
    await emitSelfNotification({
      orgId: me.orgId,
      userId: me.id,
      kind: "timesheet_submitted",
      title: `Timesheet ${week.weekIso} submitted`,
      body: "Your week is now with the approvers.",
      href: "/me",
    });
    res.json({ ok: true, flags });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// LEAVE — requests + balance (self)
// =====================================================================
const LEAVE_TYPES = new Set(["annual", "sick", "unpaid", "other"]);
const DEFAULT_ANNUAL_DAYS = 25;
const DEFAULT_SICK_DAYS = 10;

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDatesBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  for (let d = startDate; d <= endDate; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** Mon–Fri days in [start, end], inclusive. */
export function countWorkingDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let n = 0;
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n += 1;
  }
  return n;
}

function leaveToWire(r: typeof atelierLeaveRequests.$inferSelect) {
  return {
    id: r.id,
    personId: r.personId,
    personType: r.personType,
    leaveType: r.leaveType,
    startDate: r.startDate,
    endDate: r.endDate,
    workingDays: r.workingDays,
    note: r.note,
    status: r.status,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionReason: r.decisionReason,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Employment-type bucket for entitlement defaults. Employees carry their
 * roster `employmentType` (FTE | fixed_term | intern); contractors are the
 * synthetic "contractor" bucket.
 */
async function resolveEmploymentType(orgId: string, personId: string): Promise<string | null> {
  const [emp] = await db
    .select({ employmentType: atelierEmployees.employmentType })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, personId), eq(atelierEmployees.orgId, orgId)));
  if (emp) return emp.employmentType;
  const [con] = await db
    .select({ id: atelierContractors.id })
    .from(atelierContractors)
    .where(and(eq(atelierContractors.id, personId), eq(atelierContractors.orgId, orgId)));
  return con ? "contractor" : null;
}

/**
 * Entitlement precedence: per-person row > employment-type row > app
 * defaults (25 annual / 10 sick).
 */
async function getEntitlement(orgId: string, personId: string, year: number) {
  const [ent] = await db
    .select()
    .from(atelierLeaveEntitlements)
    .where(
      and(
        eq(atelierLeaveEntitlements.orgId, orgId),
        eq(atelierLeaveEntitlements.personId, personId),
        eq(atelierLeaveEntitlements.year, year),
      ),
    );
  if (ent) {
    return { annualDays: ent.annualDays, sickDays: ent.sickDays, configured: true, source: "person" as const };
  }
  const employmentType = await resolveEmploymentType(orgId, personId);
  if (employmentType) {
    const [typeEnt] = await db
      .select()
      .from(atelierLeaveTypeEntitlements)
      .where(
        and(
          eq(atelierLeaveTypeEntitlements.orgId, orgId),
          eq(atelierLeaveTypeEntitlements.employmentType, employmentType),
          eq(atelierLeaveTypeEntitlements.year, year),
        ),
      );
    if (typeEnt) {
      return {
        annualDays: typeEnt.annualDays,
        sickDays: typeEnt.sickDays,
        configured: true,
        source: "employment_type" as const,
      };
    }
  }
  return {
    annualDays: DEFAULT_ANNUAL_DAYS,
    sickDays: DEFAULT_SICK_DAYS,
    configured: false,
    source: "default" as const,
  };
}

/**
 * Approval routing (org chart). Returns the atelier_users ids allowed to
 * decide a person's leave: every live manager (reports_to edges — a person
 * MAY have multiple managers; any of them can decide). When the person has
 * no manager edges at all, returns null → the HR/founders fallback applies.
 */
async function getManagerUserIds(orgId: string, personId: string): Promise<Set<string> | null> {
  const edges = await db
    .select()
    .from(atelierRosterReportsTo)
    .where(
      and(eq(atelierRosterReportsTo.orgId, orgId), eq(atelierRosterReportsTo.personId, personId)),
    );
  if (edges.length === 0) return null;
  const mgrPersonIds = Array.from(new Set(edges.map((e) => e.managerPersonId)));
  const mgrs = await db
    .select({ userId: atelierEmployees.userId })
    .from(atelierEmployees)
    .where(
      and(
        inArray(atelierEmployees.id, mgrPersonIds),
        eq(atelierEmployees.orgId, orgId),
        isNull(atelierEmployees.deletedAt),
      ),
    );
  return new Set(mgrs.map((m) => m.userId).filter((u): u is string => !!u));
}

/** HR + founders are the fallback deciders when a person has no manager. */
function isFallbackDecider(me: typeof atelierUsers.$inferSelect): boolean {
  return isHr(me.role) || isLeadership(me.role);
}

/**
 * May `me` decide this person's leave? Managers (any reports_to edge) may;
 * HR/founders may only when the person has NO manager (fallback), keeping
 * routing org-chart-scoped rather than role-wide.
 */
export async function canDecideLeaveFor(
  me: typeof atelierUsers.$inferSelect,
  personId: string,
): Promise<boolean> {
  const mgrUserIds = await getManagerUserIds(me.orgId, personId);
  if (mgrUserIds === null) return isFallbackDecider(me);
  return mgrUserIds.has(me.id);
}

export async function computeLeaveBalance(orgId: string, personId: string, year: number) {
  const ent = await getEntitlement(orgId, personId, year);
  const rows = await db
    .select()
    .from(atelierLeaveRequests)
    .where(
      and(
        eq(atelierLeaveRequests.orgId, orgId),
        eq(atelierLeaveRequests.personId, personId),
        isNull(atelierLeaveRequests.deletedAt),
      ),
    );
  const inYear = rows.filter((r) => r.startDate.startsWith(String(year)));
  const sumDays = (type: string, statuses: string[]) =>
    inYear
      .filter((r) => r.leaveType === type && statuses.includes(r.status))
      .reduce((s, r) => s + Number(r.workingDays || 0), 0);
  const usedAnnual = sumDays("annual", ["approved"]);
  const pendingAnnual = sumDays("annual", ["pending"]);
  const usedSick = sumDays("sick", ["approved"]);
  const pendingSick = sumDays("sick", ["pending"]);
  return {
    year,
    annualDays: ent.annualDays,
    sickDays: ent.sickDays,
    entitlementConfigured: ent.configured,
    usedAnnual,
    pendingAnnual,
    remainingAnnual: +(ent.annualDays - usedAnnual).toFixed(2),
    usedSick,
    pendingSick,
    remainingSick: +(ent.sickDays - usedSick).toFixed(2),
  };
}

// @cli-skip: covered by CLI capability me.leave (Task #405)
router.get("/me/leave", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const { me, person } = ctx;
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const rows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, me.orgId),
          eq(atelierLeaveRequests.personId, person.id),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      )
      .orderBy(desc(atelierLeaveRequests.createdAt));
    const balance = await computeLeaveBalance(me.orgId, person.id, year);
    res.json({ requests: rows.map(leaveToWire), balance });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope leave create; no CLI shape (Task #53)
router.post("/me/leave", async (req, res, next) => {
  try {
    const ctx = await requireSelfPerson(req, res);
    if (!ctx) return;
    const { me, person } = ctx;
    const b = req.body ?? {};
    const leaveType = String(b.leaveType ?? "");
    if (!LEAVE_TYPES.has(leaveType)) {
      res.status(400).json({ error: "invalid-leave-type", allowed: Array.from(LEAVE_TYPES) });
      return;
    }
    if (!isIsoDate(b.startDate) || !isIsoDate(b.endDate) || b.endDate < b.startDate) {
      res.status(400).json({ error: "invalid-date-range" });
      return;
    }
    const workingDays = countWorkingDays(b.startDate, b.endDate);
    if (workingDays <= 0) {
      res.status(400).json({ error: "no-working-days", reason: "Range contains no Mon–Fri days." });
      return;
    }
    // Balance guard for annual leave only — sick/unpaid/other are not
    // debited against a purchased allowance at request time.
    if (leaveType === "annual") {
      const year = Number(b.startDate.slice(0, 4));
      const bal = await computeLeaveBalance(me.orgId, person.id, year);
      if (workingDays > bal.remainingAnnual - bal.pendingAnnual) {
        res.status(409).json({
          error: "insufficient-balance",
          reason: `Request of ${workingDays}d exceeds remaining annual balance (${bal.remainingAnnual}d remaining, ${bal.pendingAnnual}d already pending).`,
          balance: bal,
        });
        return;
      }
    }
    // Overlap guard against own pending/approved requests.
    const existing = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, me.orgId),
          eq(atelierLeaveRequests.personId, person.id),
          inArray(atelierLeaveRequests.status, ["pending", "approved"]),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      );
    const overlaps = existing.some((r) => r.startDate <= b.endDate && b.startDate <= r.endDate);
    if (overlaps) {
      res.status(409).json({ error: "overlapping-request" });
      return;
    }
    const id = rid("leave");
    // Task #602 — partner-tier requests need no approver: auto-approve on
    // submission (stamped autoApproved) and kick off the OOO sync.
    const autoApprove = isLeadership(me.role);
    const [row] = await db
      .insert(atelierLeaveRequests)
      .values({
        id,
        orgId: me.orgId,
        userId: me.id,
        personId: person.id,
        personType: person.type,
        leaveType,
        startDate: b.startDate,
        endDate: b.endDate,
        workingDays,
        note: typeof b.note === "string" ? b.note.slice(0, 2000) : null,
        status: autoApprove ? "approved" : "pending",
        ...(autoApprove
          ? { autoApproved: true, decidedAt: new Date(), decidedByUserId: me.id }
          : {}),
      })
      .returning();
    await audit({
      entityType: "leave_request",
      entityId: id,
      actor: me,
      action: "leave.request",
      payload: { leaveType, startDate: b.startDate, endDate: b.endDate, workingDays },
      summary: `${me.name} requested ${workingDays}d ${leaveType} leave (${b.startDate} → ${b.endDate})`,
    });
    if (autoApprove) {
      await audit({
        entityType: "leave_request",
        entityId: id,
        actor: me,
        action: "leave.auto_approve",
        payload: { role: me.role },
        summary: `${me.name}'s leave ${b.startDate} → ${b.endDate} auto-approved (partner tier)`,
      });
      setImmediate(() => void applyLeaveOoo(id));
    }
    res.status(201).json({ request: leaveToWire(row) });
  } catch (err) {
    next(err);
  }
});

/**
 * Task #602 — shared revoke/shorten for an APPROVED leave. Used by the
 * self cancel route and the HR/approver revoke route. `newEndDate` (when
 * given and inside the current range) shortens instead of revoking —
 * an "early return". Both paths reconcile the Outlook OOO surfaces.
 */
async function revokeOrShortenApprovedLeave(args: {
  me: typeof atelierUsers.$inferSelect;
  row: typeof atelierLeaveRequests.$inferSelect;
  newEndDate: string | null;
  res: Response;
}): Promise<void> {
  const { me, row, newEndDate, res } = args;
  if (newEndDate) {
    if (!isIsoDate(newEndDate) || newEndDate < row.startDate || newEndDate >= row.endDate) {
      res.status(400).json({
        error: "invalid-new-end-date",
        reason: "newEndDate must be a date within the leave, before its current end.",
      });
      return;
    }
    const workingDays = countWorkingDays(row.startDate, newEndDate);
    const [updated] = await db
      .update(atelierLeaveRequests)
      .set({ endDate: newEndDate, workingDays, updatedAt: new Date() })
      .where(eq(atelierLeaveRequests.id, row.id))
      .returning();
    await audit({
      entityType: "leave_request",
      entityId: row.id,
      actor: me,
      action: "leave.shorten",
      payload: { previousEndDate: row.endDate, newEndDate, workingDays },
      summary: `${me.name} shortened leave to ${row.startDate} → ${newEndDate}`,
    });
    if (row.userId !== me.id) {
      await emitSelfNotification({
        orgId: me.orgId,
        userId: row.userId,
        kind: "leave_shortened",
        title: "Leave shortened",
        body: `Your ${row.leaveType} leave now ends ${newEndDate} (was ${row.endDate}).`,
        href: "/me",
      });
    }
    setImmediate(() => void clearLeaveOoo(row.id, "shorten"));
    res.json({ request: leaveToWire(updated) });
    return;
  }
  const [updated] = await db
    .update(atelierLeaveRequests)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(atelierLeaveRequests.id, row.id))
    .returning();
  await audit({
    entityType: "leave_request",
    entityId: row.id,
    actor: me,
    action: "leave.revoke",
    payload: { previousStatus: "approved" },
    summary: `${me.name} revoked approved leave ${row.startDate} → ${row.endDate}`,
  });
  if (row.userId !== me.id) {
    await emitSelfNotification({
      orgId: me.orgId,
      userId: row.userId,
      kind: "leave_revoked",
      title: "Leave revoked",
      body: `Your ${row.leaveType} leave ${row.startDate} → ${row.endDate} was revoked by ${me.name}.`,
      href: "/me",
    });
  }
  setImmediate(() => void clearLeaveOoo(row.id, "revoke"));
  res.json({ request: leaveToWire(updated) });
}

// @cli-skip: self-scope leave cancel; no CLI shape (Task #53)
router.post("/me/leave/:id/cancel", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const [existing] = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.id, req.params.id),
          eq(atelierLeaveRequests.orgId, me.orgId),
          eq(atelierLeaveRequests.userId, me.id),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      );
    if (!existing || !["pending", "approved"].includes(existing.status)) {
      res.status(404).json({ error: "not-cancellable" });
      return;
    }
    // Task #602 — approved leaves can now be revoked or shortened by the
    // person themselves (early return); OOO surfaces are reconciled.
    if (existing.status === "approved") {
      const newEndDate =
        typeof req.body?.newEndDate === "string" ? req.body.newEndDate : null;
      await revokeOrShortenApprovedLeave({ me, row: existing, newEndDate, res });
      return;
    }
    const [row] = await db
      .update(atelierLeaveRequests)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierLeaveRequests.id, existing.id))
      .returning();
    await audit({
      entityType: "leave_request",
      entityId: row.id,
      actor: me,
      action: "leave.cancel",
      payload: {},
      summary: `${me.name} cancelled leave request ${row.startDate} → ${row.endDate}`,
    });
    res.json({ request: leaveToWire(row) });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// LEAVE — approver surfaces (People page). NOT under /me.
// =====================================================================
/**
 * Role pre-gate for the approver surfaces. Row-level routing is enforced
 * separately by canDecideLeaveFor (manager edges, HR/founder fallback) —
 * this only keeps boundary-locked self personas off the surface entirely.
 */
export function canReachApproverSurface(me: typeof atelierUsers.$inferSelect): boolean {
  return canApproveAsLead(me.role) || isHr(me.role);
}

// @cli-skip: approver queue read backing PeopleApprovals UI (Task #53)
router.get("/roster/leave-requests", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canReachApproverSurface(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const status = (req.query.status as string) || "pending";
    const allRows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, me.orgId),
          status === "all" ? undefined : eq(atelierLeaveRequests.status, status),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      )
      .orderBy(desc(atelierLeaveRequests.createdAt));
    // Org-chart routing filter: a row is visible only to the requester's
    // managers, or to HR/founders when the requester has no manager.
    const routable = await Promise.all(
      allRows.map(async (r) => ((await canDecideLeaveFor(me, r.personId)) ? r : null)),
    );
    const rows = routable.filter((r): r is NonNullable<typeof r> => r !== null);
    // Person names for the queue rows.
    const personIds = Array.from(new Set(rows.map((r) => r.personId)));
    const [emps, cons] = await Promise.all([
      personIds.length
        ? db.select().from(atelierEmployees).where(inArray(atelierEmployees.id, personIds))
        : Promise.resolve([] as Array<typeof atelierEmployees.$inferSelect>),
      personIds.length
        ? db.select().from(atelierContractors).where(inArray(atelierContractors.id, personIds))
        : Promise.resolve([] as Array<typeof atelierContractors.$inferSelect>),
    ]);
    const nameById = new Map<string, string>([
      ...emps.map((e) => [e.id, e.fullName] as const),
      ...cons.map((c) => [c.id, c.fullName] as const),
    ]);
    res.json({
      requests: rows.map((r) => ({
        ...leaveToWire(r),
        personName: nameById.get(r.personId) ?? r.personId,
        isOwn: r.userId === me.id,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Team availability for the approvals surface: every approved/pending leave
 * across the roster that intersects the requested [start, end] window, so an
 * approver can spot double-booked absences BEFORE deciding. Read-only,
 * pre-gated on the same approver-surface roles as the queue itself.
 */
// @cli-skip: approver team-calendar read backing PeopleApprovals UI (Task #77)
router.get("/roster/leave-calendar", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canReachApproverSurface(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const start = req.query.start;
    const end = req.query.end;
    if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
      res.status(400).json({ error: "invalid-window", detail: "start and end must be YYYY-MM-DD with start <= end" });
      return;
    }
    const rows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, me.orgId),
          inArray(atelierLeaveRequests.status, ["pending", "approved"]),
          isNull(atelierLeaveRequests.deletedAt),
          // Interval intersection: leave.start <= window.end AND leave.end >= window.start
          lte(atelierLeaveRequests.startDate, end),
          gte(atelierLeaveRequests.endDate, start),
        ),
      )
      .orderBy(atelierLeaveRequests.startDate);
    const personIds = Array.from(new Set(rows.map((r) => r.personId)));
    const [emps, cons] = await Promise.all([
      personIds.length
        ? db.select().from(atelierEmployees).where(inArray(atelierEmployees.id, personIds))
        : Promise.resolve([] as Array<typeof atelierEmployees.$inferSelect>),
      personIds.length
        ? db.select().from(atelierContractors).where(inArray(atelierContractors.id, personIds))
        : Promise.resolve([] as Array<typeof atelierContractors.$inferSelect>),
    ]);
    const nameById = new Map<string, string>([
      ...emps.map((e) => [e.id, e.fullName] as const),
      ...cons.map((c) => [c.id, c.fullName] as const),
    ]);
    res.json({
      window: { start, end },
      entries: rows.map((r) => ({
        id: r.id,
        personId: r.personId,
        personName: nameById.get(r.personId) ?? r.personId,
        leaveType: r.leaveType,
        startDate: r.startDate,
        endDate: r.endDate,
        workingDays: r.workingDays,
        status: r.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

async function decideLeave(
  req: Request,
  res: Response,
  decision: "approved" | "rejected",
): Promise<void> {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canReachApproverSurface(me)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierLeaveRequests)
    .where(
      and(
        eq(atelierLeaveRequests.id, String(req.params.id)),
        eq(atelierLeaveRequests.orgId, me.orgId),
        isNull(atelierLeaveRequests.deletedAt),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "not-found" });
    return;
  }
  // Segregation of duties — nobody decides their own leave.
  if (existing.userId === me.id) {
    res.status(403).json({ error: "no-self-approval" });
    return;
  }
  // Org-chart routing: only the requester's manager(s) may decide; HR and
  // founders act only as fallback when the person has no manager edge.
  if (!(await canDecideLeaveFor(me, existing.personId))) {
    res.status(403).json({ error: "not-your-report" });
    return;
  }
  if (existing.status !== "pending") {
    res.status(409).json({ error: "not-pending", status: existing.status });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 2000) : null;
  if (decision === "rejected" && !reason?.trim()) {
    res.status(400).json({ error: "reason-required" });
    return;
  }
  const [row] = await db
    .update(atelierLeaveRequests)
    .set({
      status: decision,
      decidedAt: new Date(),
      decidedByUserId: me.id,
      decisionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(atelierLeaveRequests.id, existing.id))
    .returning();
  await audit({
    entityType: "leave_request",
    entityId: existing.id,
    actor: me,
    action: decision === "approved" ? "leave.approve" : "leave.reject",
    payload: { reason },
    summary: `${me.name} ${decision} leave ${existing.startDate} → ${existing.endDate}`,
  });
  await emitSelfNotification({
    orgId: me.orgId,
    userId: existing.userId,
    kind: `leave_${decision}`,
    title: `Leave request ${decision}`,
    body: `${existing.leaveType} leave ${existing.startDate} → ${existing.endDate} (${existing.workingDays}d) was ${decision}${reason ? `: ${reason}` : "."}`,
    href: "/me",
  });
  // Task #602 — on approval, sync the Outlook out-of-office surfaces in the
  // background using the LEAVE-TAKER's own connection (never the approver's).
  if (decision === "approved") {
    setImmediate(() => void applyLeaveOoo(existing.id));
  }
  res.json({ request: leaveToWire(row) });
}

// @cli-skip: approver decision backing PeopleApprovals UI (Task #53)
router.post("/roster/leave-requests/:id/approve", (req, res, next) =>
  decideLeave(req, res, "approved").catch(next),
);
// @cli-skip: approver decision backing PeopleApprovals UI (Task #53)
router.post("/roster/leave-requests/:id/reject", (req, res, next) =>
  decideLeave(req, res, "rejected").catch(next),
);

// Task #602 — HR / routed approvers can revoke or shorten an APPROVED
// leave (e.g. an early return). Same org-chart routing as deciding, with
// HR always allowed; self-revocation happens via /me/leave/:id/cancel.
// @cli-skip: approver revoke backing PeopleApprovals UI (Task #602)
router.post("/roster/leave-requests/:id/revoke", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canReachApproverSurface(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const [existing] = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.id, String(req.params.id)),
          eq(atelierLeaveRequests.orgId, me.orgId),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "not-found" });
      return;
    }
    if (existing.status !== "approved") {
      res.status(409).json({ error: "not-approved", status: existing.status });
      return;
    }
    if (!isHr(me.role) && !(await canDecideLeaveFor(me, existing.personId))) {
      res.status(403).json({ error: "not-your-report" });
      return;
    }
    const newEndDate =
      typeof req.body?.newEndDate === "string" ? req.body.newEndDate : null;
    await revokeOrShortenApprovedLeave({ me, row: existing, newEndDate, res });
  } catch (err) {
    next(err);
  }
});

// Task #602 — who is away today. Partner-tier viewers only (the "Away
// today" strips are a leadership surface, not for the whole roster).
// @cli-skip: leadership away-today strip read (Task #602)
router.get("/roster/on-leave-today", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!isLeadership(me.role)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    // Selected-date driven (the strips follow the calendar's day
    // navigator); defaults to today in the firm's base timezone.
    const dateParam = req.query.date;
    const date = isIsoDate(dateParam)
      ? dateParam
      : new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
    const rows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(
        and(
          eq(atelierLeaveRequests.orgId, me.orgId),
          eq(atelierLeaveRequests.status, "approved"),
          lte(atelierLeaveRequests.startDate, date),
          gte(atelierLeaveRequests.endDate, date),
          isNull(atelierLeaveRequests.deletedAt),
        ),
      )
      .orderBy(atelierLeaveRequests.endDate);
    // Effective holidays (HR-confirmed/adjusted dates, Task #606) for the
    // return-date maths below.
    const effectiveHols = applyHolidayOverrides(
      PUBLIC_HOLIDAYS,
      toHolidayOverrides(await loadHolidayOverrideRows(me.orgId)),
    );
    // The strip shows PARTNERS on leave only (spec: partners/founding
    // partners away that day), so filter by the requester's user role.
    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const users = userIds.length
      ? await db
          .select({ id: atelierUsers.id, role: atelierUsers.role })
          .from(atelierUsers)
          .where(and(eq(atelierUsers.orgId, me.orgId), inArray(atelierUsers.id, userIds)))
      : [];
    const partnerUserIds = new Set(
      users.filter((u) => u.role === "partner" || u.role === "founding_partner").map((u) => u.id),
    );
    const partnerRows = rows.filter((r) => partnerUserIds.has(r.userId));
    const personIds = Array.from(new Set(partnerRows.map((r) => r.personId)));
    const [emps, cons] = await Promise.all([
      personIds.length
        ? db.select().from(atelierEmployees).where(inArray(atelierEmployees.id, personIds))
        : Promise.resolve([] as Array<typeof atelierEmployees.$inferSelect>),
      personIds.length
        ? db.select().from(atelierContractors).where(inArray(atelierContractors.id, personIds))
        : Promise.resolve([] as Array<typeof atelierContractors.$inferSelect>),
    ]);
    const infoById = new Map<string, { name: string; country: string | null }>([
      ...emps.map((e) => [e.id, { name: e.fullName, country: e.country ?? null }] as const),
      ...cons.map((c) => [c.id, { name: c.fullName, country: c.country ?? null }] as const),
    ]);
    const initialsOf = (name: string) =>
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("");
    res.json({
      date,
      away: partnerRows.map((r) => {
        const info = infoById.get(r.personId);
        const personName = info?.name ?? r.personId;
        return {
          personId: r.personId,
          personName,
          initials: initialsOf(personName),
          leaveType: r.leaveType,
          startDate: r.startDate,
          endDate: r.endDate,
          returnDate: nextWorkingDayAfter(r.endDate, info?.country ?? null, effectiveHols),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Task #602 — curated TR/MENA public-holiday range read. Any signed-in
// persona may read (needed for the calendar banner on web + mobile).
// Optional ?countries=TR,AE filter; defaults to the whole covered set.
// @cli-skip: static holiday dataset read backing calendar banners (Task #602)
router.get("/me/holidays", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const start = req.query.start;
    const end = req.query.end;
    if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
      res.status(400).json({ error: "invalid-window", detail: "start and end must be YYYY-MM-DD with start <= end" });
      return;
    }
    const countriesParam = typeof req.query.countries === "string" ? req.query.countries : "";
    const requested = countriesParam
      .split(",")
      .map((c) => countryToCode(c))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const countries = requested.length > 0 ? new Set<string>(requested) : null;
    // Viewer's own market so clients can highlight "your" holidays.
    let viewerCountry: string | null = null;
    const [emp] = await db
      .select({ country: atelierEmployees.country })
      .from(atelierEmployees)
      .where(and(eq(atelierEmployees.orgId, me.orgId), eq(atelierEmployees.email, me.email)));
    if (emp) viewerCountry = countryToCode(emp.country);
    if (!viewerCountry) {
      const [con] = await db
        .select({ country: atelierContractors.country })
        .from(atelierContractors)
        .where(and(eq(atelierContractors.orgId, me.orgId), eq(atelierContractors.email, me.email)));
      if (con) viewerCountry = countryToCode(con.country);
    }
    // Task #606 — merge HR review decisions (confirmed/adjusted dates).
    const overrides = toHolidayOverrides(await loadHolidayOverrideRows(me.orgId));
    // Reviewer nudge for HR/leadership only: how many tentative dates in
    // the upcoming window still need review, and whether the curated
    // dataset is about to run out of years.
    let review: { pendingTentative: number; nextYearMissing: number | null } | undefined;
    if (isHr(me.role) || isLeadership(me.role)) {
      review = holidayReviewAttention(overrides);
    }
    res.json({
      window: { start, end },
      countries: Array.from(countries ?? HOLIDAY_COUNTRIES),
      viewerCountry,
      holidays: holidaysInRange(start, end, countries, overrides),
      ...(review ? { review } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// Task #606 — yearly holiday-calendar review. The curated dataset carries
// tentative Islamic dates (moon-sighting dependent); HR/leadership confirm
// or adjust them here so banners and OOO return dates stay trustworthy.
// ---------------------------------------------------------------------

const HOLIDAY_REVIEW_HORIZON_DAYS = 120;

function todayYmdDubai(): string {
  return new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Attention counters shared by /me/holidays (reminder chip) and the
 *  review surface: tentative entries starting within the horizon that
 *  have no review decision yet, plus dataset-coverage runway. */
function holidayReviewAttention(
  overrides: ReturnType<typeof toHolidayOverrides>,
): { pendingTentative: number; nextYearMissing: number | null } {
  const today = todayYmdDubai();
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + HOLIDAY_REVIEW_HORIZON_DAYS);
  const horizonYmd = horizon.toISOString().slice(0, 10);
  const reviewed = new Set(overrides.map((o) => o.holidayKey));
  const pendingTentative = PUBLIC_HOLIDAYS.filter(
    (h) =>
      h.tentative &&
      !reviewed.has(holidayKeyOf(h)) &&
      h.endDate >= today &&
      h.date <= horizonYmd,
  ).length;
  // Warn when the NEXT calendar year isn't covered by the curated table
  // yet (it needs a code update — flag it well before Jan 1).
  const currentYear = Number(today.slice(0, 4));
  const maxYear = DATASET_YEARS[DATASET_YEARS.length - 1] ?? currentYear;
  const nextYearMissing = maxYear <= currentYear ? currentYear + 1 : null;
  return { pendingTentative, nextYearMissing };
}

function canReviewHolidays(me: typeof atelierUsers.$inferSelect): boolean {
  return isHr(me.role) || isLeadership(me.role);
}

const isIsoDateStr = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// @cli-skip: HR holiday-calendar review read (Task #606)
router.get("/roster/holidays/review", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canReviewHolidays(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const yearParam = Number(req.query.year);
    const currentYear = Number(todayYmdDubai().slice(0, 4));
    const year = DATASET_YEARS.includes(yearParam) ? yearParam : (
      DATASET_YEARS.includes(currentYear) ? currentYear : DATASET_YEARS[0]
    );
    const rows = await loadHolidayOverrideRows(me.orgId);
    const rowByKey = new Map(rows.map((r) => [r.holidayKey, r]));
    const holidays = PUBLIC_HOLIDAYS
      .filter((h) => h.date.startsWith(`${year}-`))
      .sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country))
      .map((h) => {
        const key = holidayKeyOf(h);
        const o = rowByKey.get(key) ?? null;
        return {
          key,
          country: h.country,
          countryName: COUNTRY_NAMES[h.country],
          name: h.name,
          baseDate: h.date,
          baseEndDate: h.endDate,
          tentative: h.tentative,
          review: o
            ? {
                status: o.status,
                date: o.date,
                endDate: o.endDate,
                note: o.note,
                reviewedAt: o.updatedAt,
              }
            : null,
        };
      });
    res.json({
      year,
      yearsCovered: DATASET_YEARS,
      attention: holidayReviewAttention(toHolidayOverrides(rows)),
      horizonDays: HOLIDAY_REVIEW_HORIZON_DAYS,
      holidays,
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR holiday-calendar review write (Task #606)
router.post("/roster/holidays/review", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canReviewHolidays(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const key = typeof req.body?.key === "string" ? req.body.key : "";
    const action = req.body?.action;
    const base = PUBLIC_HOLIDAYS.find((h) => holidayKeyOf(h) === key);
    if (!base) {
      res.status(404).json({ error: "unknown-holiday", detail: "key does not match a curated dataset entry" });
      return;
    }
    const note =
      typeof req.body?.note === "string" && req.body.note.trim()
        ? req.body.note.trim().slice(0, 500)
        : null;
    if (action === "clear") {
      const [existing] = await db
        .select()
        .from(atelierHolidayOverrides)
        .where(
          and(
            eq(atelierHolidayOverrides.orgId, me.orgId),
            eq(atelierHolidayOverrides.holidayKey, key),
          ),
        );
      if (existing) {
        await db
          .delete(atelierHolidayOverrides)
          .where(eq(atelierHolidayOverrides.id, existing.id));
        await audit({
          entityType: "holiday",
          entityId: key,
          actor: me,
          action: "holiday.review.clear",
          payload: { key, previous: { status: existing.status, date: existing.date, endDate: existing.endDate } },
          summary: `Cleared review of ${base.country} ${base.name} (${base.date})`,
        });
      }
      res.json({ ok: true, key, review: null });
      return;
    }
    if (action !== "confirm" && action !== "adjust") {
      res.status(400).json({ error: "invalid-action", detail: "action must be confirm | adjust | clear" });
      return;
    }
    let date = base.date;
    let endDate = base.endDate;
    if (action === "adjust") {
      const d = req.body?.date;
      const e = req.body?.endDate ?? d;
      if (!isIsoDateStr(d) || !isIsoDateStr(e) || d > e) {
        res.status(400).json({ error: "invalid-dates", detail: "adjust needs date (and optional endDate) as YYYY-MM-DD with date <= endDate" });
        return;
      }
      // Keep adjustments plausible: within ±30 days of the curated date
      // (moon sightings shift Islamic dates by a day or two, not months).
      const driftMs = Math.abs(Date.parse(d) - Date.parse(base.date));
      if (driftMs > 30 * 24 * 3600 * 1000) {
        res.status(400).json({ error: "date-too-far", detail: "adjusted date must be within 30 days of the curated date" });
        return;
      }
      date = d;
      endDate = e;
    }
    const status = action === "confirm" ? "confirmed" : "adjusted";
    const [existing] = await db
      .select()
      .from(atelierHolidayOverrides)
      .where(
        and(
          eq(atelierHolidayOverrides.orgId, me.orgId),
          eq(atelierHolidayOverrides.holidayKey, key),
        ),
      );
    if (existing) {
      await db
        .update(atelierHolidayOverrides)
        .set({ status, date, endDate, note, updatedByUserId: me.id, updatedAt: new Date() })
        .where(eq(atelierHolidayOverrides.id, existing.id));
    } else {
      await db.insert(atelierHolidayOverrides).values({
        id: rid("holrev"),
        orgId: me.orgId,
        holidayKey: key,
        country: base.country,
        status,
        date,
        endDate,
        note,
        updatedByUserId: me.id,
      });
    }
    await audit({
      entityType: "holiday",
      entityId: key,
      actor: me,
      action: "holiday.review.set",
      payload: { key, status, date, endDate, note, baseDate: base.date, baseEndDate: base.endDate },
      summary: `${status === "confirmed" ? "Confirmed" : "Adjusted"} ${base.country} ${base.name} (${base.date}${status === "adjusted" ? ` → ${date}` : ""})`,
    });
    res.json({ ok: true, key, review: { status, date, endDate, note } });
  } catch (err) {
    next(err);
  }
});

function canConfigureEntitlements(me: typeof atelierUsers.$inferSelect): boolean {
  return isHr(me.role) || isLeadership(me.role) || isFinance(me.role);
}

// @cli-skip: HR entitlement config read (Task #53)
router.get("/roster/leave-entitlements", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canConfigureEntitlements(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const [emps, cons, ents, typeEnts] = await Promise.all([
      db
        .select()
        .from(atelierEmployees)
        .where(and(eq(atelierEmployees.orgId, me.orgId), isNull(atelierEmployees.deletedAt))),
      db
        .select()
        .from(atelierContractors)
        .where(and(eq(atelierContractors.orgId, me.orgId), isNull(atelierContractors.deletedAt))),
      db
        .select()
        .from(atelierLeaveEntitlements)
        .where(and(eq(atelierLeaveEntitlements.orgId, me.orgId), eq(atelierLeaveEntitlements.year, year))),
      db
        .select()
        .from(atelierLeaveTypeEntitlements)
        .where(
          and(
            eq(atelierLeaveTypeEntitlements.orgId, me.orgId),
            eq(atelierLeaveTypeEntitlements.year, year),
          ),
        ),
    ]);
    const entByPerson = new Map(ents.map((e) => [e.personId, e]));
    const typeEntByType = new Map(typeEnts.map((t) => [t.employmentType, t]));
    const people = [
      ...emps.map((e) => ({
        id: e.id,
        name: e.fullName,
        personType: "employee" as const,
        employmentType: e.employmentType,
      })),
      ...cons.map((c) => ({
        id: c.id,
        name: c.fullName,
        personType: "contractor" as const,
        employmentType: "contractor",
      })),
    ];
    res.json({
      year,
      defaults: { annualDays: DEFAULT_ANNUAL_DAYS, sickDays: DEFAULT_SICK_DAYS },
      // Per-employment-type defaults (precedence: person > type > app default).
      typeDefaults: ["FTE", "fixed_term", "intern", "contractor"].map((t) => {
        const row = typeEntByType.get(t);
        return {
          employmentType: t,
          annualDays: row?.annualDays ?? DEFAULT_ANNUAL_DAYS,
          sickDays: row?.sickDays ?? DEFAULT_SICK_DAYS,
          configured: !!row,
        };
      }),
      entitlements: people.map((p) => {
        const ent = entByPerson.get(p.id);
        const typeEnt = typeEntByType.get(p.employmentType);
        return {
          personId: p.id,
          personName: p.name,
          personType: p.personType,
          employmentType: p.employmentType,
          annualDays: ent?.annualDays ?? typeEnt?.annualDays ?? DEFAULT_ANNUAL_DAYS,
          sickDays: ent?.sickDays ?? typeEnt?.sickDays ?? DEFAULT_SICK_DAYS,
          configured: !!ent,
          source: ent ? "person" : typeEnt ? "employment_type" : "default",
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR entitlement config write (Task #53)
router.put("/roster/leave-entitlements", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canConfigureEntitlements(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const b = req.body ?? {};
    const personId = String(b.personId ?? "");
    const employmentType = String(b.employmentType ?? "");
    const year = Number(b.year) || new Date().getUTCFullYear();
    const annualDays = Number(b.annualDays);
    const sickDays = Number(b.sickDays);
    // Employment-type default upsert (personId absent).
    if (!personId && employmentType) {
      if (
        !["FTE", "fixed_term", "intern", "contractor"].includes(employmentType) ||
        !Number.isFinite(annualDays) ||
        !Number.isFinite(sickDays) ||
        annualDays < 0 ||
        sickDays < 0 ||
        annualDays > 366 ||
        sickDays > 366
      ) {
        res.status(400).json({ error: "invalid-body" });
        return;
      }
      const [existingType] = await db
        .select()
        .from(atelierLeaveTypeEntitlements)
        .where(
          and(
            eq(atelierLeaveTypeEntitlements.orgId, me.orgId),
            eq(atelierLeaveTypeEntitlements.employmentType, employmentType),
            eq(atelierLeaveTypeEntitlements.year, year),
          ),
        );
      let typeRow: typeof atelierLeaveTypeEntitlements.$inferSelect;
      if (existingType) {
        [typeRow] = await db
          .update(atelierLeaveTypeEntitlements)
          .set({ annualDays, sickDays, updatedByUserId: me.id, updatedAt: new Date() })
          .where(eq(atelierLeaveTypeEntitlements.id, existingType.id))
          .returning();
      } else {
        [typeRow] = await db
          .insert(atelierLeaveTypeEntitlements)
          .values({
            id: rid("leavetent"),
            orgId: me.orgId,
            employmentType,
            year,
            annualDays,
            sickDays,
            updatedByUserId: me.id,
          })
          .returning();
      }
      await audit({
        entityType: "leave_entitlement",
        entityId: typeRow.id,
        actor: me,
        action: "leave.entitlement.set",
        payload: { employmentType, year, annualDays, sickDays },
        summary: `${me.name} set ${year} ${employmentType} leave defaults: ${annualDays}d annual / ${sickDays}d sick`,
      });
      res.json({ typeEntitlement: typeRow });
      return;
    }
    if (
      !personId ||
      !Number.isFinite(annualDays) ||
      !Number.isFinite(sickDays) ||
      annualDays < 0 ||
      sickDays < 0 ||
      annualDays > 366 ||
      sickDays > 366
    ) {
      res.status(400).json({ error: "invalid-body" });
      return;
    }
    // Person must exist in caller's org.
    const [emp] = await db
      .select({ id: atelierEmployees.id })
      .from(atelierEmployees)
      .where(
        and(
          eq(atelierEmployees.id, personId),
          eq(atelierEmployees.orgId, me.orgId),
          isNull(atelierEmployees.deletedAt),
        ),
      );
    const [con] = emp
      ? [undefined]
      : await db
          .select({ id: atelierContractors.id })
          .from(atelierContractors)
          .where(
            and(
              eq(atelierContractors.id, personId),
              eq(atelierContractors.orgId, me.orgId),
              isNull(atelierContractors.deletedAt),
            ),
          );
    if (!emp && !con) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    const personType = emp ? "employee" : "contractor";
    const [existing] = await db
      .select()
      .from(atelierLeaveEntitlements)
      .where(
        and(
          eq(atelierLeaveEntitlements.personId, personId),
          eq(atelierLeaveEntitlements.year, year),
        ),
      );
    let row: typeof atelierLeaveEntitlements.$inferSelect;
    if (existing) {
      [row] = await db
        .update(atelierLeaveEntitlements)
        .set({ annualDays, sickDays, updatedByUserId: me.id, updatedAt: new Date() })
        .where(eq(atelierLeaveEntitlements.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(atelierLeaveEntitlements)
        .values({
          id: rid("leaveent"),
          orgId: me.orgId,
          personId,
          personType,
          year,
          annualDays,
          sickDays,
          updatedByUserId: me.id,
        })
        .returning();
    }
    await audit({
      entityType: "leave_entitlement",
      entityId: row.id,
      actor: me,
      action: "leave.entitlement.set",
      payload: { personId, year, annualDays, sickDays },
      summary: `${me.name} set ${year} leave entitlement for ${personId}: ${annualDays}d annual / ${sickDays}d sick`,
    });
    res.json({ entitlement: row });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// REPORTING LINES — org-chart edges used for leave approval routing.
// HR/leadership configure them; a person may hold multiple managers.
// =====================================================================

// @cli-skip: HR reporting-line config read (Task #53)
router.get("/roster/reports-to", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canConfigureEntitlements(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const edges = await db
      .select()
      .from(atelierRosterReportsTo)
      .where(eq(atelierRosterReportsTo.orgId, me.orgId));
    res.json({
      edges: edges.map((e) => ({
        id: e.id,
        personId: e.personId,
        managerPersonId: e.managerPersonId,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: HR reporting-line config write (Task #53)
router.put("/roster/reports-to", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    if (!canConfigureEntitlements(me)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const b = req.body ?? {};
    const personId = String(b.personId ?? "");
    const managerPersonIds: string[] = Array.isArray(b.managerPersonIds)
      ? b.managerPersonIds.map(String).filter(Boolean)
      : [];
    if (!personId) {
      res.status(400).json({ error: "invalid-body" });
      return;
    }
    if (managerPersonIds.includes(personId)) {
      res.status(400).json({ error: "self-manager" });
      return;
    }
    if (managerPersonIds.includes("emp_demo_reviewer")) {
      res.status(400).json({ error: "protected-demo-cannot-be-manager" });
      return;
    }
    // Person must exist in the caller's org (employee or contractor).
    const personType = await resolveEmploymentType(me.orgId, personId);
    if (!personType) {
      res.status(404).json({ error: "person-not-found" });
      return;
    }
    // Managers must be live employees in the same org.
    if (managerPersonIds.length) {
      const mgrs = await db
        .select({ id: atelierEmployees.id })
        .from(atelierEmployees)
        .where(
          and(
            inArray(atelierEmployees.id, managerPersonIds),
            eq(atelierEmployees.orgId, me.orgId),
            isNull(atelierEmployees.deletedAt),
          ),
        );
      if (mgrs.length !== new Set(managerPersonIds).size) {
        res.status(404).json({ error: "manager-not-found" });
        return;
      }
    }
    // Replace-set semantics: the payload is the person's full manager list.
    await db
      .delete(atelierRosterReportsTo)
      .where(
        and(
          eq(atelierRosterReportsTo.orgId, me.orgId),
          eq(atelierRosterReportsTo.personId, personId),
        ),
      );
    for (const mgrId of Array.from(new Set(managerPersonIds))) {
      await db.insert(atelierRosterReportsTo).values({
        id: rid("repto"),
        orgId: me.orgId,
        personId,
        managerPersonId: mgrId,
        createdByUserId: me.id,
      });
    }
    await audit({
      entityType: "roster_reports_to",
      entityId: personId,
      actor: me,
      action: "roster.reports_to.set",
      payload: { personId, managerPersonIds },
      summary: `${me.name} set reporting line for ${personId}: ${managerPersonIds.length} manager(s)`,
    });
    res.json({ personId, managerPersonIds: Array.from(new Set(managerPersonIds)) });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// EXPENSES — self-scoped claims. personId here is the atelier_users id
// (the wallet convention), NOT the roster person id.
// =====================================================================
const EXPENSE_CONTEXTS = new Set(["bd", "account", "engagement", "internal"]);

function claimToWire(e: typeof atelierExpenses.$inferSelect) {
  return {
    id: e.id,
    expenseDate: e.expenseDate,
    merchant: e.merchant,
    // Task #396 — layered merchant normalization output.
    merchantNormalized: e.merchantNormalized,
    merchantResolution: e.merchantResolution,
    description: e.description,
    // Task #500 — enriched auditor summary (trip/flight/stay details).
    summary: e.summary,
    category: e.category,
    amount: e.amount,
    currency: e.currency,
    usdAmount: e.usdAmount,
    status: e.status,
    policyStatus: e.policyStatus,
    policyFindings: e.policyFindings,
    contextType: e.contextType,
    accountId: e.accountId,
    engagementId: e.engagementId,
    internalProjectLabel: e.internalProjectLabel,
    // Task #383 — taxonomy + attribution + funding.
    categoryCode: e.categoryCode,
    subCategoryCode: e.subCategoryCode,
    categorySource: e.categorySource,
    bdIndustry: e.bdIndustry,
    entityId: e.entityId,
    costCenter: e.costCenter,
    fundingSource: e.fundingSource,
    fundingBankAccountId: e.fundingBankAccountId,
    businessPurpose: e.businessPurpose,
    beneficiaryUserId: e.beneficiaryUserId,
    owedTo: e.beneficiaryName,
    beneficiaryName: e.beneficiaryName,
    contingencyType: e.contingencyType,
    reimbursementTrigger: wireReimbursementTrigger(e.contingencyType),
    contingencyStatus: e.contingencyStatus,
    projectOutcome: e.projectOutcome,
    recoveryStatus: e.recoveryStatus,
    directCostStatus: e.directCostStatus,
    timesheetWeekId: e.timesheetWeekId,
    approvalRoute: e.approvalRoute,
    clientBillable: e.clientBillable,
    markupPct: e.markupPct,
    receiptFileRef: e.receiptFileRef,
    hasReceipt: !!e.receiptFileRef,
    submittedAt: e.submittedAt?.toISOString() ?? null,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    rejectedAt: e.rejectedAt?.toISOString() ?? null,
    rejectedReason: e.rejectedReason,
    reimbursedAt: e.reimbursedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

/** Validate + normalize the context tag. Returns null and writes the 4xx on failure. */
async function resolveContext(
  res: Response,
  orgId: string,
  b: Record<string, unknown>,
): Promise<
  | { contextType: string; accountId: string | null; engagementId: string | null; internalProjectLabel: string | null }
  | null
> {
  const contextType = String(b.contextType ?? "bd");
  if (!EXPENSE_CONTEXTS.has(contextType)) {
    res.status(400).json({ error: "invalid-context-type", allowed: Array.from(EXPENSE_CONTEXTS) });
    return null;
  }
  let accountId: string | null = null;
  let engagementId: string | null = null;
  let internalProjectLabel: string | null = null;
  if (contextType === "account") {
    accountId = String(b.accountId ?? "");
    const [acc] = accountId
      ? await db
          .select({ id: atelierAccounts.id })
          .from(atelierAccounts)
          .where(
            and(
              eq(atelierAccounts.id, accountId),
              eq(atelierAccounts.orgId, orgId),
              isNull(atelierAccounts.deletedAt),
            ),
          )
      : [undefined];
    if (!acc) {
      res.status(400).json({ error: "account-not-found" });
      return null;
    }
  } else if (contextType === "engagement") {
    engagementId = String(b.engagementId ?? "");
    const [eng] = engagementId
      ? await db
          .select({ id: atelierEngagements.id, accountId: atelierEngagements.accountId })
          .from(atelierEngagements)
          .where(
            and(
              eq(atelierEngagements.id, engagementId),
              eq(atelierEngagements.orgId, orgId),
              isNull(atelierEngagements.deletedAt),
            ),
          )
      : [undefined];
    if (!eng) {
      res.status(400).json({ error: "engagement-not-found" });
      return null;
    }
    if (b.accountId && b.accountId !== eng.accountId) {
      res.status(400).json({ error: "engagement-account-mismatch" });
      return null;
    }
  } else if (contextType === "internal") {
    internalProjectLabel = String(b.internalProjectLabel ?? "").trim().slice(0, 200);
    if (!internalProjectLabel) {
      res.status(400).json({ error: "internal-project-label-required" });
      return null;
    }
  }
  return { contextType, accountId, engagementId, internalProjectLabel };
}

// Task #815 — honest USD display conversion for charts / month totals.
// Prefers the FX numbers stamped on the row at write time; rows that
// predate FX stamping (usdAmount 0 while amount > 0 in a non-USD
// currency) are converted on read via the same shared helper, and the
// source is reported so the client never has to invent a rate.
async function usdDisplayFor(e: typeof atelierExpenses.$inferSelect): Promise<{
  usdAmount: number;
  rate: number;
  rateDate: string | null;
  source: string;
}> {
  const stored = e.usdAmount;
  if (stored > 0 || e.amount === 0 || e.currency === "USD") {
    return {
      usdAmount: +(e.currency === "USD" ? e.amount : stored).toFixed(2),
      rate: e.currency === "USD" ? 1 : e.fxRate,
      rateDate: e.fxRateDate,
      source: e.currency === "USD" ? "identity" : "stored",
    };
  }
  const fx = await convertToUsd(e.amount, e.currency, e.expenseDate);
  return {
    usdAmount: +fx.usdAmount.toFixed(2),
    rate: fx.rate,
    rateDate: fx.rateDate,
    source: fx.source,
  };
}

// ---------------------------------------------------------------------
// Task #827 — per-user display preferences (currently: display currency
// for money rollups). Self-scope: everyone may read/write their own.
// ---------------------------------------------------------------------
// @cli-skip: self-scope preference read; trivial UI plumbing (Task #827)
router.get("/me/preferences", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    // Task #1017 — pushCategories: per-category device-push opt-outs
    // (opt-out model; missing key = enabled). Read fresh — the persona
    // cache may predate a PATCH in the same session.
    const [row] = await db
      .select({ prefs: atelierUsers.pushNotificationPrefs })
      .from(atelierUsers)
      .where(eq(atelierUsers.id, me.id));
    res.json({
      displayCurrency: me.displayCurrency ?? "USD",
      supportedCurrencies: DISPLAY_CURRENCIES,
      pushCategories: resolvePushCategoryPrefs(row?.prefs),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope preference write; trivial UI plumbing (Task #827)
router.patch("/me/preferences", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const auditPayload: Record<string, unknown> = {};
    // displayCurrency — optional now that the endpoint also carries push
    // preferences (Task #1017); still strictly validated when present.
    let cur: string | null = null;
    if (b.displayCurrency !== undefined) {
      cur = String(b.displayCurrency ?? "").toUpperCase();
      if (!DISPLAY_CURRENCIES.includes(cur)) {
        res.status(400).json({ error: "unsupported-currency", allowed: DISPLAY_CURRENCIES });
        return;
      }
      patch.displayCurrency = cur;
      auditPayload.displayCurrency = cur;
      auditPayload.previous = me.displayCurrency;
    }
    // Task #1017 — pushCategories: partial per-category toggles. Unknown
    // categories or non-boolean values are rejected loudly (never
    // silently dropped) so a client typo can't fake a saved preference.
    let mergedPrefs: Record<string, boolean> | null = null;
    if (b.pushCategories !== undefined) {
      const pc = b.pushCategories;
      if (typeof pc !== "object" || pc === null || Array.isArray(pc)) {
        res.status(400).json({ error: "invalid-push-categories", allowed: PUSH_CATEGORIES });
        return;
      }
      const entries = Object.entries(pc as Record<string, unknown>);
      for (const [k, v] of entries) {
        if (!(PUSH_CATEGORIES as readonly string[]).includes(k) || typeof v !== "boolean") {
          res.status(400).json({ error: "invalid-push-categories", allowed: PUSH_CATEGORIES });
          return;
        }
      }
      const [row] = await db
        .select({ prefs: atelierUsers.pushNotificationPrefs })
        .from(atelierUsers)
        .where(eq(atelierUsers.id, me.id));
      mergedPrefs = { ...(row?.prefs ?? {}), ...(pc as Record<string, boolean>) };
      patch.pushNotificationPrefs = mergedPrefs;
      auditPayload.pushCategories = pc;
    }
    if (!Object.keys(patch).length) {
      res.status(400).json({ error: "empty-patch" });
      return;
    }
    await db
      .update(atelierUsers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(atelierUsers.id, me.id));
    await audit({
      entityType: "user",
      entityId: me.id,
      actor: me,
      action: "me.preferences.updated",
      payload: auditPayload,
      summary: `${me.name} updated preferences${cur ? ` (display currency ${cur})` : ""}${auditPayload.pushCategories ? " (push alerts)" : ""}`,
    });
    res.json({
      displayCurrency: cur ?? me.displayCurrency ?? "USD",
      supportedCurrencies: DISPLAY_CURRENCIES,
      pushCategories: resolvePushCategoryPrefs(
        mergedPrefs ??
          (await db
            .select({ prefs: atelierUsers.pushNotificationPrefs })
            .from(atelierUsers)
            .where(eq(atelierUsers.id, me.id)))[0]?.prefs,
      ),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope expense list; no CLI shape (Task #53)
router.get("/me/expenses", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const rows = await db
      .select()
      .from(atelierExpenses)
      .where(and(eq(atelierExpenses.personId, me.id), isNull(atelierExpenses.deletedAt)))
      .orderBy(desc(atelierExpenses.createdAt));
    // Task #827 — every row also carries the amount converted into the
    // caller's display currency (via USD), so clients can total mixed-
    // currency months honestly without inventing rates.
    const displayCurrency = (me.displayCurrency ?? "USD").toUpperCase();
    const expenses = await Promise.all(
      rows.map(async (e) => {
        const usdDisplay = await usdDisplayFor(e);
        let display: { amount: number; currency: string; converted: boolean };
        if (e.currency === displayCurrency) {
          display = { amount: +e.amount.toFixed(2), currency: displayCurrency, converted: false };
        } else {
          const conv = await convertUsdTo(usdDisplay.usdAmount, displayCurrency, e.expenseDate);
          display = { amount: +conv.amount.toFixed(2), currency: displayCurrency, converted: true };
        }
        return { ...claimToWire(e), usdDisplay, display };
      }),
    );
    res.json({ expenses, displayCurrency });
  } catch (err) {
    next(err);
  }
});

/**
 * Task #1107 — read-only policy summary for the submission flow. Returns
 * the plain-language principles plus the caps that would actually apply
 * to the CALLER (role-scoped variants for other roles — e.g. partner
 * flight rules — are filtered out; a role variant for the caller's own
 * role shadows the global rule per axis, mirroring evaluateExpense's
 * most-specific-wins collapse). Strictly read-only: editing stays on the
 * wallet Policy page.
 */
// @cli-skip: self-scope policy summary read; trivial UI plumbing (Task #1107)
router.get("/me/expense-policy", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    await ensureDefaultExpensePolicies(me.orgId);
    const rows = await db
      .select()
      .from(atelierExpensePolicies)
      .where(
        and(
          eq(atelierExpensePolicies.orgId, me.orgId),
          eq(atelierExpensePolicies.active, true),
          isNull(atelierExpensePolicies.deletedAt),
        ),
      );
    // Only rules that can ever apply to the caller: unscoped, or scoped to
    // the caller's own role. (Country-scoped rules are shown with their
    // country tag — which one applies depends on the trip.)
    const relevant = rows.filter(
      (r) => !r.appliesToRole || r.appliesToRole === me.role,
    );
    // Collapse per category+country: within a group the caller-role-scoped
    // rule wins each axis over the global one (same axis semantics as
    // evaluateExpense), so employees never see partner caps and a caller
    // with a role variant sees THEIR numbers, not both.
    const groups = new Map<string, typeof relevant>();
    for (const r of relevant) {
      const key = `${r.category}|${r.appliesToCountry ?? ""}`;
      const g = groups.get(key);
      if (g) g.push(r);
      else groups.set(key, [r]);
    }
    const caps = [...groups.values()].map((g) => {
      const ordered = [...g].sort(
        (a, b) => (b.appliesToRole ? 1 : 0) - (a.appliesToRole ? 1 : 0),
      );
      const pick = <K extends keyof (typeof ordered)[number]>(k: K) =>
        ordered.find((r) => r[k] != null)?.[k] ?? null;
      const capRule = ordered.find((r) => r.capAmountUsd != null) ?? ordered[0];
      return {
        category: ordered[0].category,
        appliesToCountry: ordered[0].appliesToCountry ?? null,
        capAmountUsd: capRule?.capAmountUsd ?? null,
        capUnit: capRule?.capUnit ?? null,
        hardBlockAmountUsd: pick("hardBlockAmountUsd") as number | null,
        approvalThresholdUsd: pick("approvalThresholdUsd") as number | null,
        flightClassMax: pick("flightClassMax") as string | null,
         eligibleRoles: pick("eligibleRoles") as string[] | null,
         requiresReceipt: pick("requiresReceipt") as boolean | null,
         requiresBusinessPurpose: pick("requiresBusinessPurpose") as boolean | null,
         periodicCapUsd: pick("periodicCapUsd") as number | null,
         periodicCapPeriod: pick("periodicCapPeriod") as string | null,
         exceptionApproverRole: pick("exceptionApproverRole") as string | null,
        rationale: (ordered.find((r) => r.rationale)?.rationale ?? null) as
          | string
          | null,
      };
    });
    caps.sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        (a.appliesToCountry ?? "").localeCompare(b.appliesToCountry ?? ""),
    );
    res.json({ principles: POLICY_PRINCIPLES, caps });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope expense create; no CLI shape (Task #53)
router.post("/me/expenses", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      res.status(400).json({ error: "invalid-amount" });
      return;
    }
    const merchant = String(b.merchant ?? "").trim().slice(0, 200);
    if (!merchant) {
      res.status(400).json({ error: "merchant-required" });
      return;
    }
    const businessPurpose = typeof b.businessPurpose === "string"
      ? b.businessPurpose.trim().slice(0, 1000)
      : "";
    if (!businessPurpose) {
      res.status(400).json({ error: "business-purpose-required", message: "Explain the business purpose before saving the claim." });
      return;
    }
    const dateStr = isIsoDate(b.expenseDate) ? b.expenseDate : new Date().toISOString().slice(0, 10);
    const ctxTag = await resolveContext(res, me.orgId, b);
    if (!ctxTag) return;
    const currency = String(b.currency ?? "USD").toUpperCase().slice(0, 3);
    const fx = await convertToUsd(amount, currency, dateStr);
    const receiptPath = await normalizeReceipt(res, me, b.receiptPath);
    if (receiptPath === undefined) return; // error already written
    // Task #383 — taxonomy + attribution + funding validation.
    const extras = await resolveExpenseExtras(res, me.orgId, b, {
      contextType: ctxTag.contextType,
      accountId: ctxTag.accountId,
      personId: me.id,
    });
    if (!extras) return;
    const beneficiaryResult = await resolveExpenseBeneficiary(me.orgId, b.beneficiaryUserId ?? b.owedTo ?? me.id);
    if (!beneficiaryResult.beneficiary) {
      res.status(409).json({ error: beneficiaryResult.ambiguous ? "beneficiary-ambiguous" : "beneficiary-not-found" });
      return;
    }
    const beneficiary = beneficiaryResult.beneficiary;
    const fundingSource = extras.fundingSource ?? "personal_claim";
    if (fundingSource === "personal_claim" && beneficiary.id !== me.id) {
      res.status(400).json({ error: "personal-claim-beneficiary-must-be-self" });
      return;
    }
    if (fundingSource === "company_account" && beneficiary.id !== me.id) {
      res.status(400).json({ error: "company-account-no-beneficiary" });
      return;
    }
    if (me.role === "non_equity_partner") {
      const canonicalPersonId = me.personId ?? me.id;
      let contractId = typeof b.governingContractId === "string" ? b.governingContractId : "";
      let versionId = typeof b.governingContractVersionId === "string" ? b.governingContractVersionId : "";
      if (!contractId || !versionId) {
        const [contractor] = await db.select({ personId: atelierContractors.personId }).from(atelierContractors)
          .where(and(eq(atelierContractors.orgId, me.orgId), eq(atelierContractors.personId, canonicalPersonId), isNull(atelierContractors.deletedAt)));
        const [auto] = await db.select().from(atelierContractRecords).where(and(
          eq(atelierContractRecords.orgId, me.orgId), eq(atelierContractRecords.status, "signed"),
          eq(atelierContractRecords.counterpartyKind, "person"),
          eq(atelierContractRecords.personId, contractor?.personId ?? canonicalPersonId),
        )).orderBy(desc(atelierContractRecords.updatedAt)).limit(1);
        contractId = auto?.id ?? "";
        versionId = auto?.currentDocumentId ?? "";
      }
      const [contract] = await db.select().from(atelierContractRecords).where(and(
        eq(atelierContractRecords.id, contractId), eq(atelierContractRecords.orgId, me.orgId),
        eq(atelierContractRecords.status, "signed"), eq(atelierContractRecords.personId, canonicalPersonId),
      ));
      const [version] = await db.select().from(atelierContractDocuments).where(and(
        eq(atelierContractDocuments.id, versionId), eq(atelierContractDocuments.contractId, contractId),
      ));
      if (!contract || !version || contract.currentDocumentId !== versionId ||
        !["non_equity_partner_employment", "contractor_agreement"].includes(contract.contractType)) {
        res.status(409).json({ error: "signed-governing-contract-required" });
        return;
      }
      b.governingContractId = contractId;
      b.governingContractVersionId = versionId;
      const scope = (contract.fieldValues ?? {}) as Record<string, unknown>;
      const categories = scope.expenseCategories ?? scope.allowedExpenseCategories;
      const projects = scope.projectIds ?? scope.allowedProjects;
      const requestedCategory = typeof b.category === "string" ? b.category : "other";
      if (Array.isArray(categories) && categories.length > 0 && !categories.includes(requestedCategory)) {
        res.status(409).json({ error: "expense-category-not-in-agreement" });
        return;
      }
      if (Array.isArray(projects) && projects.length > 0 && !projects.includes(ctxTag.engagementId)) {
        res.status(409).json({ error: "expense-project-not-in-agreement" });
        return;
      }
    }
    const trigger = normalizeContingencyType(b.contingencyType ?? b.reimbursementTrigger);
    if (trigger !== "none" && fundingSource !== "partner_paid") {
      res.status(400).json({ error: "contingency-requires-partner-funding" });
      return;
    }
    if (trigger !== "none" && !["engagement", "account"].includes(ctxTag.contextType)) {
      res.status(400).json({ error: "contingency-requires-pursuit-context" });
      return;
    }
    // No explicit category pair → try org-wide merchant memory (instant,
    // deterministic). AI proposals are fetched by the UI via the suggest
    // endpoint so create never blocks on a model call.
    let suggestion: import("../../lib/atelier-expense-categorizer").CategorySuggestion | null = null;
    if (!extras.subCategoryCode) {
      suggestion = await lookupMerchantMemory(merchant, me.orgId);
      if (suggestion) {
        const pair = await resolveCategoryPair(suggestion.categoryCode, suggestion.subCategoryCode);
        if (pair) {
          extras.categoryCode = pair.category.code;
          extras.subCategoryCode = pair.sub.code;
          extras.category = policyKeyFor(pair.sub);
          extras.categorySource = "merchant_memory";
        }
      }
    }
    const id = rid("exp");
    await db.insert(atelierExpenses).values({
      id,
      personId: me.id,
      personType: ["contractor", "partner", "founding_partner", "non_equity_partner"].includes(me.role)
        ? me.role
        : "employee",
      engagementId: ctxTag.engagementId,
      expenseDate: dateStr,
      captureSource: "manual",
      merchant,
      description:
        typeof b.description === "string" && b.description.trim()
          ? b.description.slice(0, 2000)
          : null,
      ...extras,
      category:
        extras.category ??
        (typeof b.category === "string" && b.category ? String(b.category) : "other"),
      amount,
      currency,
      fxRate: fx.rate,
      fxRateDate: fx.rateDate,
      usdAmount: +fx.usdAmount.toFixed(2),
      contextType: ctxTag.contextType,
      accountId: ctxTag.accountId,
      internalProjectLabel: ctxTag.internalProjectLabel,
      receiptFileRef: receiptPath,
       receiptFixtureKey: typeof b.receiptFixtureKey === "string" ? b.receiptFixtureKey : null,
      receiptEncryptedAtRest: !!receiptPath,
      summary: (typeof b.description === "string" && b.description.trim()) || merchant,
      businessPurpose,
       beneficiaryUserId: beneficiary.id,
       beneficiaryName: beneficiary.name,
       governingContractId: typeof b.governingContractId === "string" ? b.governingContractId : null,
       governingContractVersionId: typeof b.governingContractVersionId === "string" ? b.governingContractVersionId : null,
       contingencyType: trigger,
       contingencyStatus: trigger !== "none" ? "pending" : "not_applicable",
       directCostStatus: "excluded",
       recoveryStatus: extras.clientBillable ? "pending" : "not_billable",
      status: "draft",
      policyStatus: "green",
      createdByUserId: me.id,
    });
    // Task #1095 — prefill the benefit-principle entity allocation (fail-soft).
    await proposeExpenseAllocation(id, { allowAi: false, actorId: me.id }).catch(() => null);
    await audit({
      entityType: "expense",
      entityId: id,
      actor: me,
      action: "expense.create",
      payload: { amount, currency, contextType: ctxTag.contextType, via: "me-lens" },
      summary: `${me.name} drafted expense ${merchant} (${currency} ${amount.toFixed(2)})`,
    });
    const [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, id));
    res.status(201).json({ expense: claimToWire(row) });
  } catch (err) {
    next(err);
  }
});

/**
 * Normalize a receipt upload path and pin its ACL to the uploader.
 * Returns: null (no receipt), string (normalized /objects/... path), or
 * undefined after writing a 4xx/5xx response.
 */
async function normalizeReceipt(
  res: Response,
  me: typeof atelierUsers.$inferSelect,
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
      res.status(400).json({ error: "receipt-not-found", reason: "Upload the file first, then attach it." });
      return undefined;
    }
    throw err;
  }
}

async function requireOwnDraftExpense(
  req: Request,
  res: Response,
): Promise<{ me: typeof atelierUsers.$inferSelect; row: typeof atelierExpenses.$inferSelect } | null> {
  const me = ensurePersona(req, res);
  if (!me) return null;
  const [row] = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.id, String(req.params.id)),
        eq(atelierExpenses.personId, me.id),
        isNull(atelierExpenses.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "expense-not-found" });
    return null;
  }
  if (row.status !== "draft" && row.status !== "rejected") {
    res.status(409).json({ error: "not-editable", status: row.status });
    return null;
  }
  if (["activated", "lost", "abandoned"].includes(row.contingencyStatus)) {
    res.status(409).json({ error: "contingency-terminal" });
    return null;
  }
  return { me, row };
}

// @cli-skip: self-scope expense edit; no CLI shape (Task #53)
router.patch("/me/expenses/:id", async (req, res, next) => {
  try {
    const ctx = await requireOwnDraftExpense(req, res);
    if (!ctx) return;
    const { me, row } = ctx;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.merchant !== undefined) {
      const merchant = String(b.merchant).trim().slice(0, 200);
      if (!merchant) return void res.status(400).json({ error: "merchant-required" });
      patch.merchant = merchant;
    }
    // Task #757 — empty string clears the description (stored as null so
    // a later receipt parse may prefill it again); create path matches.
    if (b.description !== undefined) {
      const d = String(b.description).slice(0, 2000);
      patch.description = d.trim() ? d : null;
    }
    if (b.businessPurpose !== undefined) {
      const purpose = String(b.businessPurpose).trim().slice(0, 1000);
      if (!purpose) return void res.status(400).json({ error: "business-purpose-required" });
      patch.businessPurpose = purpose;
    }
    if (b.beneficiaryUserId !== undefined || b.owedTo !== undefined) {
      const result = await resolveExpenseBeneficiary(me.orgId, b.beneficiaryUserId ?? b.owedTo);
      if (!result.beneficiary) return void res.status(409).json({ error: result.ambiguous ? "beneficiary-ambiguous" : "beneficiary-not-found" });
      patch.beneficiaryUserId = result.beneficiary.id;
      patch.beneficiaryName = result.beneficiary.name;
    }
    if (b.contingencyType !== undefined || b.reimbursementTrigger !== undefined) {
      const c = normalizeContingencyType(b.contingencyType ?? b.reimbursementTrigger);
      patch.contingencyType = c;
      patch.contingencyStatus = c === "none" ? "not_applicable" : "pending";
    }
    if (b.category !== undefined) {
      // Task #757 — mirror create: an empty category falls back to "other"
      // (the policy engine keys on this flat value; never store "").
      patch.category = String(b.category).trim() || "other";
    }
    if (b.expenseDate !== undefined) {
      if (!isIsoDate(b.expenseDate)) return void res.status(400).json({ error: "invalid-date" });
      patch.expenseDate = b.expenseDate;
    }
    // Task #757 — a date change alone must also recompute FX: the USD
    // amount is pinned to the rate on the expense date (parity with create).
    if (b.amount !== undefined || b.currency !== undefined || b.expenseDate !== undefined) {
      const amount = b.amount !== undefined ? Number(b.amount) : row.amount;
      const currency =
        b.currency !== undefined ? String(b.currency).toUpperCase().slice(0, 3) : row.currency;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000)
        return void res.status(400).json({ error: "invalid-amount" });
      const dateStr = (patch.expenseDate as string) ?? row.expenseDate;
      const fx = await convertToUsd(amount, currency, dateStr);
      patch.amount = amount;
      patch.currency = currency;
      patch.fxRate = fx.rate;
      patch.fxRateDate = fx.rateDate;
      patch.usdAmount = +fx.usdAmount.toFixed(2);
    }
    if (b.contextType !== undefined || b.accountId !== undefined || b.engagementId !== undefined || b.internalProjectLabel !== undefined) {
      const ctxTag = await resolveContext(res, me.orgId, {
        contextType: b.contextType ?? row.contextType,
        accountId: b.accountId ?? row.accountId,
        engagementId: b.engagementId ?? row.engagementId,
        internalProjectLabel: b.internalProjectLabel ?? row.internalProjectLabel,
      });
      if (!ctxTag) return;
      patch.contextType = ctxTag.contextType;
      patch.accountId = ctxTag.accountId;
      patch.engagementId = ctxTag.engagementId;
      patch.internalProjectLabel = ctxTag.internalProjectLabel;
    }
    if (b.receiptPath !== undefined) {
      const receiptPath = await normalizeReceipt(res, me, b.receiptPath);
      if (receiptPath === undefined) return;
      patch.receiptFileRef = receiptPath;
      patch.receiptEncryptedAtRest = !!receiptPath;
    }
    // Task #383 — taxonomy + attribution + funding (patch semantics).
    {
      const effCtx = {
        contextType: (patch.contextType as string) ?? row.contextType,
        accountId: (patch.accountId as string | null) ?? row.accountId,
        personId: me.id,
      };
      const extras = await resolveExpenseExtras(res, me.orgId, b, effCtx);
      if (!extras) return;
      Object.assign(patch, extras);
    }
    const effectiveFunding = (patch.fundingSource as string | undefined) ?? row.fundingSource;
    const effectiveTrigger = normalizeContingencyType((patch.contingencyType as string | undefined) ?? row.contingencyType);
    const effectiveBeneficiary = (patch.beneficiaryUserId as string | undefined) ?? row.beneficiaryUserId ?? me.id;
    if (effectiveFunding === "personal_claim" && effectiveBeneficiary !== me.id)
      return void res.status(400).json({ error: "personal-claim-beneficiary-must-be-self" });
    if (effectiveFunding === "company_account" && effectiveBeneficiary !== me.id)
      return void res.status(400).json({ error: "company-account-no-beneficiary" });
    if (effectiveTrigger !== "none" && effectiveFunding !== "partner_paid")
      return void res.status(400).json({ error: "contingency-requires-partner-funding" });
    const effectiveContext = (patch.contextType as string | undefined) ?? row.contextType;
    if (effectiveTrigger !== "none" && !["account", "engagement"].includes(effectiveContext))
      return void res.status(400).json({ error: "contingency-requires-pursuit-context" });
    // Task #757 — keep the display summary consistent with a manual edit,
    // but never clobber an auditor-composed summary (auditorRunId set).
    if (!row.auditorRunId && (b.description !== undefined || b.merchant !== undefined)) {
      const desc =
        patch.description !== undefined
          ? (patch.description as string | null)
          : row.description;
      const merch = (patch.merchant as string | undefined) ?? row.merchant;
      patch.summary = (desc && desc.trim()) || merch || row.summary;
    }
    const [updated] = await db
      .update(atelierExpenses)
      .set(patch)
      .where(eq(atelierExpenses.id, row.id))
      .returning();
    res.json({ expense: claimToWire(updated) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope expense delete; no CLI shape (Task #53)
router.delete("/me/expenses/:id", async (req, res, next) => {
  try {
    const ctx = await requireOwnDraftExpense(req, res);
    if (!ctx) return;
    await db
      .update(atelierExpenses)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(atelierExpenses.id, ctx.row.id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope expense submit; no CLI shape (Task #53)
router.post("/me/expenses/:id/submit", async (req, res, next) => {
  try {
    const ctx = await requireOwnDraftExpense(req, res);
    if (!ctx) return;
    const { me, row } = ctx;
    // Task #383 — internal spend must carry entity + cost center before it
    // can enter the approval flow (attribution completeness).
    if (row.contextType === "internal" && (!row.entityId || !row.costCenter)) {
      res.status(409).json({
        error: "attribution-incomplete",
        message: "Internal expenses need a legal entity and a cost center before submitting.",
      });
      return;
    }
    if (!row.businessPurpose?.trim()) {
      res.status(409).json({ error: "business-purpose-required", message: "Add a business purpose before submitting." });
      return;
    }
    if (!row.receiptFileRef && !row.receiptFixtureKey && row.captureSource !== "mileage" && row.captureSource !== "per_diem") {
      res.status(409).json({ error: "receipt-required", message: "Attach a receipt before submitting this claim." });
      return;
    }
    // Deterministic policy evaluation (no LLM auditor on the Me lens —
    // claims here are simple reimbursables; the wallet's Expense Auditor
    // remains available on the finance side).
    const policy = await evaluateExpense({
      orgId: row.orgId,
      category: row.category,
      usdAmount: row.usdAmount,
      amount: row.amount,
      currency: row.currency,
      country: row.vatCountry ?? null,
      role: me.role,
      flightClass: null,
      submitterRole: me.role,
      hasReceipt: !!row.receiptFileRef || !!row.receiptFixtureKey,
      businessPurpose: row.businessPurpose,
      personId: row.personId,
      expenseDate: row.expenseDate,
    });
    const overrideRationale =
      typeof req.body?.overrideRationale === "string" ? req.body.overrideRationale.slice(0, 2000) : null;
    if (policy.status === "red") {
      await db
        .update(atelierExpenses)
        .set({ policyStatus: "red", policyFindings: policy.findings, updatedAt: new Date() })
        .where(eq(atelierExpenses.id, row.id));
      res.status(409).json({ error: "policy-red-block", findings: policy.findings });
      return;
    }
    if (policy.status === "amber" && !overrideRationale) {
      await db
        .update(atelierExpenses)
        .set({ policyStatus: "amber", policyFindings: policy.findings, updatedAt: new Date() })
        .where(eq(atelierExpenses.id, row.id));
      res.status(409).json({
        error: "amber-requires-rationale",
        message: "Policy AMBER warning — submit again with `overrideRationale`.",
        findings: policy.findings,
      });
      return;
    }
    const [updated] = await db
      .update(atelierExpenses)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        policyStatus: policy.status,
        policyFindings: policy.findings,
        overrideRationale,
        rejectedAt: null,
        rejectedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(atelierExpenses.id, row.id))
      .returning();
    await audit({
      entityType: "expense",
      entityId: row.id,
      actor: me,
      action: "expense.submit",
      payload: { policyStatus: policy.status, via: "me-lens", override: !!overrideRationale },
      summary: `${me.name} submitted claim ${row.merchant ?? row.id} from Me lens`,
    });
    // Task #383 — a submitted category pair is a CONFIRMED choice: feed the
    // org-wide merchant memory (corrections restart the counter).
    if (row.merchant && updated.categoryCode && updated.subCategoryCode) {
      await learnMerchantMapping({
        merchant: row.merchant,
        categoryCode: updated.categoryCode,
        subCategoryCode: updated.subCategoryCode,
        userId: me.id,
        orgId: me.orgId,
      });
    }
    await emitSelfNotification({
      orgId: me.orgId,
      userId: me.id,
      kind: "expense_submitted",
      title: `Expense claim submitted`,
      body: `${row.merchant} — ${row.currency} ${row.amount.toFixed(2)} is with the approvers.`,
      href: "/me",
    });
    // Task #501 — every submitted claim lands in both founders' queues.
    await notifyFoundersOfSubmittedExpense(updated);
    // Task #1069 — pending-approval totals on finance surfaces refresh promptly.
    invalidateFinanceFacts();
    res.json({ expense: claimToWire(updated) });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope receipt upload URL; no CLI shape (Task #53)
router.post("/me/expenses/receipt-upload", async (req, res, next) => {
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

// =====================================================================
// Task #328 — mobile receipt parse. The employee snaps a real receipt
// photo; a vision model extracts OCR fields from the uploaded image,
// then the EXISTING Expense Auditor classifies + proposes VAT/billable,
// and the deterministic Me-lens policy evaluator stamps findings.
// Draft-only, self-scoped. Fail-loud: extraction errors surface as 422.
// =====================================================================
// @cli-skip: self-scope mobile receipt parse; no CLI shape (Task #328/#396)
router.post("/me/expenses/:id/parse-receipt", async (req, res, next) => {
  try {
    const ctx = await requireOwnDraftExpense(req, res);
    if (!ctx) return;
    const { me, row } = ctx;
    const result = await parseReceiptForExpense({ row, me, via: "me-lens" });
    if (!result.ok) {
      res.status(result.status).json(result.body);
      return;
    }
    res.json({
      expense: claimToWire(result.expense),
      runId: result.runId,
      proposal: result.proposal,
      policyFindings: result.policyFindings,
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// Task #411 — automatic receipt pipeline: the parse is LLM-heavy (vision
// extraction + Expense Auditor) and can run for minutes. A held request
// gets 502'd by the proxy, so clients launch here and poll below.
// Task #1020 — launch state now lives in the durable background-job
// registry (atelier_background_jobs) so it survives restarts, shows in
// the global indicator, and notifies the starter when the read finishes.
// =====================================================================
// Watchdog: a job that has been "running" longer than this is considered
// wedged — reported as failed and eligible for relaunch (a zombie promise
// can only settle its OWN superseded row, never the relaunched one).
const PARSE_LAUNCH_STALE_MS = 10 * 60 * 1000;

function jobIsStaleRunning(job: { status: string; createdAt: Date }): boolean {
  return job.status === "running" && Date.now() - job.createdAt.getTime() > PARSE_LAUNCH_STALE_MS;
}

// @cli-skip: self-scope async receipt parse launch; no CLI shape (Task #411)
router.post("/me/expenses/:id/parse-receipt-async", async (req, res, next) => {
  try {
    const ctx = await requireOwnDraftExpense(req, res);
    if (!ctx) return;
    const { me, row } = ctx;
    if (!row.receiptFileRef || !row.receiptFileRef.startsWith("/objects/")) {
      res.status(400).json({ error: "no-receipt", message: "Attach a receipt first, then parse it." });
      return;
    }
    const existing = await getLatestJob(["receipt_parse"], row.id, me.orgId);
    if (existing?.status === "running" && !jobIsStaleRunning(existing)) {
      res.status(202).json({ status: "running" });
      return;
    }
    if (existing?.status === "running") {
      // Stale watchdog hit — fail the dead row or the running-unique index
      // would block the relaunch below.
      await reapStaleRunningJob(["receipt_parse"], row.id, me.orgId, PARSE_LAUNCH_STALE_MS);
    }
    const jobId = await startBackgroundJob({
      orgId: me.orgId,
      userId: me.id,
      kind: "receipt_parse",
      targetType: "expense",
      targetId: row.id,
      label: "Reading your receipt",
    });
    if (!jobId) {
      // Lost the atomic-start race — another request is already parsing.
      res.status(202).json({ status: "running" });
      return;
    }
    void parseReceiptForExpense({ row, me, via: "me-lens-auto" })
      .then(async (result) => {
        if (result.ok) {
          await completeBackgroundJob(jobId, {
            result: {
              expense: claimToWire(result.expense),
              runId: result.runId,
              proposal: result.proposal,
              policyFindings: result.policyFindings,
            },
            notifyTitle: "Receipt read — expense details filled in",
            notifyBody: "Open the expense to review what was found.",
          });
        } else {
          await failBackgroundJob(jobId, `parse-failed (${result.status})`, {
            result: { wireError: { status: result.status, body: result.body } },
            notifyTitle: "Receipt could not be read",
          });
        }
      })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        await failBackgroundJob(jobId, message, {
          result: { wireError: { status: 502, body: { error: "parse-crashed", message } } },
          notifyTitle: "Receipt could not be read",
        });
      });
    res.status(202).json({ status: "running" });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope async receipt parse poll; no CLI shape (Task #411)
router.get("/me/expenses/:id/parse-receipt-status", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const [row] = await db
      .select({ id: atelierExpenses.id })
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.id, req.params.id),
          eq(atelierExpenses.personId, me.id),
          isNull(atelierExpenses.deletedAt),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "expense-not-found" });
      return;
    }
    const job = await getLatestJob(["receipt_parse"], row.id, me.orgId);
    if (!job) {
      res.json({ status: "none" });
      return;
    }
    if (jobIsStaleRunning(job)) {
      // Watchdog: report a wedged run as failed so the client can offer a
      // retry; the relaunch path above inserts a fresh job row.
      res.json({
        status: "failed",
        error: {
          status: 504,
          body: { error: "parse-timeout", message: "Parsing took too long — try again." },
        },
      });
      return;
    }
    const stored = (job.result ?? {}) as { wireError?: unknown } & Record<string, unknown>;
    if (job.status === "failed") {
      res.json({
        status: "failed",
        error:
          stored.wireError ?? {
            status: 502,
            body: { error: "parse-crashed", message: job.error ?? "failed" },
          },
      });
      return;
    }
    res.json({
      status: job.status,
      ...(job.status === "done" ? { result: stored } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// @cli-skip: self-scope receipt stream; no CLI shape (Task #53)
router.get("/me/expenses/:id/receipt", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const [row] = await db
      .select()
      .from(atelierExpenses)
      .where(
        and(
          eq(atelierExpenses.id, req.params.id),
          eq(atelierExpenses.personId, me.id),
          isNull(atelierExpenses.deletedAt),
        ),
      );
    if (!row?.receiptFileRef || !row.receiptFileRef.startsWith("/objects/")) {
      res.status(404).json({ error: "no-receipt" });
      return;
    }
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(row.receiptFileRef);
    const allowed = await svc.canAccessObjectEntity({
      userId: me.id,
      objectFile: file,
      requestedPermission: ObjectPermission.READ,
    });
    if (!allowed) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
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

// @cli-skip: self-scope context tag lookup; no CLI shape (Task #53)
router.get("/me/expense-contexts", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const [accounts, engagements] = await Promise.all([
      db
        .select({ id: atelierAccounts.id, name: atelierAccounts.name })
        .from(atelierAccounts)
        .where(and(eq(atelierAccounts.orgId, me.orgId), isNull(atelierAccounts.deletedAt))),
      db
        .select({ id: atelierEngagements.id, name: atelierEngagements.name })
        .from(atelierEngagements)
        .where(and(eq(atelierEngagements.orgId, me.orgId), isNull(atelierEngagements.deletedAt))),
    ]);
    const filt = <T extends { name: string }>(rows: T[]) =>
      (q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows).slice(0, 25);
    // Intentionally minimal (id + name only) — this is the tag picker for
    // self personas who cannot reach /accounts or /engagements.
    res.json({ accounts: filt(accounts), engagements: filt(engagements) });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// PENDING-APPROVALS DIGEST — Task #78.
//
// Submitted timesheets, leave requests, and expense claims sit silently in
// approver queues; the requester gets decision notifications, but approvers
// only see pending items if they visit the queue pages. This surface gives
// every persona a self-scope answer to "what is waiting on ME to approve?"
// so the Me home can show a badge + stale-item callout.
//
// Scoping mirrors the real decision gates exactly (never wider):
//   - Timesheets: lead approvers see 'submitted' weeks; partner-tier also
//     sees 'lead_approved'. senior_manager is narrowed to weeks with
//     submitted entries on engagements they actually lead.
//   - Leave: same org-chart routing as /roster/leave-requests
//     (managers; HR/founders only as fallback when there is no manager).
//   - Expenses: partner-tier sees all 'submitted'; senior_manager only
//     claims bound to engagements they lead.
// Own items are always excluded (no self-approval anywhere).
// Non-approver personas simply get total=0 — the route leaks nothing.
// =====================================================================

const APPROVAL_STALE_AFTER_DAYS = 3;

type PendingApprovalItem = {
  kind: "timesheet" | "leave" | "expense";
  id: string;
  title: string;
  personName: string;
  pendingSince: string;
  ageDays: number;
  stale: boolean;
  href: string;
};

async function personNamesById(
  orgId: string,
  personIds: string[],
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(personIds));
  if (ids.length === 0) return new Map();
  const [emps, cons] = await Promise.all([
    db.select().from(atelierEmployees).where(inArray(atelierEmployees.id, ids)),
    db.select().from(atelierContractors).where(inArray(atelierContractors.id, ids)),
  ]);
  return new Map<string, string>([
    ...emps.filter((e) => e.orgId === orgId).map((e) => [e.id, e.fullName] as const),
    ...cons.filter((c) => c.orgId === orgId).map((c) => [c.id, c.fullName] as const),
  ]);
}

// @cli-skip: self-scope digest backing the Me-home approvals badge (Task #78)
router.get("/me/approvals", async (req, res, next) => {
  try {
    const me = ensurePersona(req, res);
    if (!me) return;
    const now = Date.now();
    const items: PendingApprovalItem[] = [];
    const pushItem = (
      kind: PendingApprovalItem["kind"],
      id: string,
      title: string,
      personName: string,
      pendingSince: Date | null,
      href: string,
    ) => {
      const since = pendingSince ?? new Date(now);
      const ageDays = Math.max(0, Math.floor((now - since.getTime()) / 86_400_000));
      items.push({
        kind,
        id,
        title,
        personName,
        pendingSince: since.toISOString(),
        ageDays,
        stale: ageDays >= APPROVAL_STALE_AFTER_DAYS,
        href,
      });
    };

    // Own roster row — used to exclude the caller's own timesheet weeks.
    const ownPerson = await resolvePersonForCaller(me);

    // Engagements the caller leads (scopes senior_manager visibility).
    const ledEngagements =
      me.role === "senior_manager"
        ? await db
            .select({ id: atelierEngagements.id })
            .from(atelierEngagements)
            .where(
              and(
                eq(atelierEngagements.orgId, me.orgId),
                eq(atelierEngagements.engagementLeadId, me.id),
                isNull(atelierEngagements.deletedAt),
              ),
            )
        : [];
    const ledEngIds = ledEngagements.map((e) => e.id);

    // ---- Timesheets --------------------------------------------------
    if (canApproveAsLead(me.role)) {
      const statuses = canApproveAsPartner(me.role)
        ? ["submitted", "lead_approved"]
        : ["submitted"];
      let weeks = await db
        .select()
        .from(atelierTimesheetWeeks)
        .where(
          and(
            eq(atelierTimesheetWeeks.orgId, me.orgId),
            inArray(atelierTimesheetWeeks.status, statuses),
            isNull(atelierTimesheetWeeks.deletedAt),
          ),
        )
        .orderBy(desc(atelierTimesheetWeeks.submittedAt));
      if (ownPerson) weeks = weeks.filter((w) => w.personId !== ownPerson.id);
      // senior_manager: only weeks with submitted entries on engagements
      // they lead (mirrors the object-level check in /ledger/approvals).
      if (me.role === "senior_manager") {
        if (ledEngIds.length === 0) {
          weeks = [];
        } else {
          const weekIds = weeks.map((w) => w.id);
          const entryRows = weekIds.length
            ? await db
                .select({ weekId: atelierTimesheetEntries.weekId })
                .from(atelierTimesheetEntries)
                .where(
                  and(
                    inArray(atelierTimesheetEntries.weekId, weekIds),
                    inArray(atelierTimesheetEntries.engagementId, ledEngIds),
                    eq(atelierTimesheetEntries.status, "submitted"),
                    isNull(atelierTimesheetEntries.deletedAt),
                  ),
                )
            : [];
          const visible = new Set(entryRows.map((r) => r.weekId));
          weeks = weeks.filter((w) => visible.has(w.id));
        }
      }
      const names = await personNamesById(me.orgId, weeks.map((w) => w.personId));
      for (const w of weeks) {
        const awaiting = w.status === "lead_approved" ? "partner sign-off" : "lead approval";
        pushItem(
          "timesheet",
          w.id,
          `Timesheet ${w.weekIso} — awaiting ${awaiting}`,
          names.get(w.personId) ?? w.personId,
          w.status === "lead_approved" ? (w.leadApprovedAt ?? w.submittedAt) : w.submittedAt,
          "/ledger/approvals",
        );
      }
    }

    // ---- Leave -------------------------------------------------------
    if (canReachApproverSurface(me)) {
      const pending = await db
        .select()
        .from(atelierLeaveRequests)
        .where(
          and(
            eq(atelierLeaveRequests.orgId, me.orgId),
            eq(atelierLeaveRequests.status, "pending"),
            isNull(atelierLeaveRequests.deletedAt),
          ),
        )
        .orderBy(desc(atelierLeaveRequests.createdAt));
      const mine = pending.filter((r) => r.userId !== me.id);
      const routable = await Promise.all(
        mine.map(async (r) => ((await canDecideLeaveFor(me, r.personId)) ? r : null)),
      );
      const rows = routable.filter((r): r is NonNullable<typeof r> => r !== null);
      const names = await personNamesById(me.orgId, rows.map((r) => r.personId));
      for (const r of rows) {
        pushItem(
          "leave",
          r.id,
          `${r.leaveType} leave ${r.startDate} → ${r.endDate} (${r.workingDays}d)`,
          names.get(r.personId) ?? r.personId,
          r.createdAt,
          "/people/approvals",
        );
      }
    }

    // ---- Expenses ----------------------------------------------------
    // Mirrors /wallet/expenses/:id/approve exactly: partner-tier AND
    // finance approve firm-wide; senior_manager only on led engagements.
    const isFirmWideExpenseApprover = isLeadership(me.role) || isFinance(me.role);
    const isExpenseApprover = isFirmWideExpenseApprover || me.role === "senior_manager";
    if (isExpenseApprover) {
      let claims = await db
        .select()
        .from(atelierExpenses)
        .where(
          and(
            eq(atelierExpenses.orgId, me.orgId),
            eq(atelierExpenses.status, "submitted"),
            isNull(atelierExpenses.deletedAt),
          ),
        )
        .orderBy(desc(atelierExpenses.submittedAt));
      // No self-approval — EXCEPT founding partners (Task #501): founders
      // may self-approve, so their own claims stay in their digest.
      // senior_manager only sees claims on engagements they lead
      // (mirrors /wallet/expenses/:id/approve).
      if (me.role !== "founding_partner") {
        claims = claims.filter((c) => c.personId !== me.id);
      }
      if (!isFirmWideExpenseApprover) {
        claims = claims.filter((c) => c.engagementId && ledEngIds.includes(c.engagementId));
      }
      const submitterIds = Array.from(new Set(claims.map((c) => c.personId)));
      const submitters = submitterIds.length
        ? await db
            .select({ id: atelierUsers.id, name: atelierUsers.name })
            .from(atelierUsers)
            .where(inArray(atelierUsers.id, submitterIds))
        : [];
      const nameByUser = new Map(submitters.map((u) => [u.id, u.name]));
      for (const c of claims) {
        pushItem(
          "expense",
          c.id,
          `Expense ${c.merchant ?? c.category} — ${c.currency} ${c.amount.toFixed(2)}`,
          nameByUser.get(c.personId) ?? c.personId,
          c.submittedAt,
          "/wallet/expenses",
        );
      }
    }

    // Oldest first so stalled items lead; cap the list for the card.
    items.sort((a, b) => a.pendingSince.localeCompare(b.pendingSince));
    const count = (k: PendingApprovalItem["kind"]) => {
      const of = items.filter((i) => i.kind === k);
      return { count: of.length, stale: of.filter((i) => i.stale).length };
    };
    res.json({
      staleAfterDays: APPROVAL_STALE_AFTER_DAYS,
      total: items.length,
      staleTotal: items.filter((i) => i.stale).length,
      categories: {
        timesheets: count("timesheet"),
        leave: count("leave"),
        expenses: count("expense"),
      },
      items: items.slice(0, 50),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
