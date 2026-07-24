/**
 * Task #602 — auto out-of-office on approved leave.
 *
 * When a leave request is approved, this module (fire-and-forget from the
 * route) uses the LEAVE-TAKER's own Microsoft connection to:
 *   1. create an all-day "Out of office" calendar event (showAs=oof) and
 *      store its id on the leave row so revocation can remove it, and
 *   2. set Outlook automatic replies (internal audience only) for the
 *      merged window of ALL the person's current/future approved leaves,
 *      with a weekend/holiday-aware "back on <next working day>" message.
 *
 * Safety rules:
 *   - Leaves already fully in the past are skipped (audited as skipped).
 *   - A manually-configured auto-reply is NEVER overwritten: our replies
 *     embed a hidden marker; if the existing enabled reply lacks the
 *     marker we leave it alone (audited as skipped).
 *   - Missing connection or missing MailboxSettings scope degrades
 *     gracefully (event-only, or nothing) with an audit trail; the UI
 *     prompts the user to reconnect Microsoft for the new scope.
 *   - Everything is best-effort: failures audit leave.ooo.failed and
 *     never block the approval itself.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierLeaveRequests,
  atelierMsConnections,
  atelierEmployees,
  atelierContractors,
  atelierAuditEvents,
} from "@workspace/db";
import {
  createAllDayOofEvent,
  deleteCalendarEvent,
  getAutomaticReplies,
  setAutomaticReplies,
  hasMailboxSettingsScope,
  msConfigured,
} from "./msGraph.js";
import { freshAccessToken, type MsConnectionRow } from "./msScheduling.js";
import {
  nextWorkingDayAfter,
  timezoneFor,
  applyHolidayOverrides,
  PUBLIC_HOLIDAYS,
} from "./atelierHolidays.js";
import { loadHolidayOverrides } from "./atelierHolidayOverrides.js";
import { assertAuditAction } from "../routes/atelier/auditContract.js";
import { noteLocalCalendarChange } from "./msCalendarSync.js";
import { logger } from "./logger";

/** Hidden marker embedded in auto-replies we set, so we can tell our own
 *  replies from manually configured ones and never clobber the latter. */
export const OOO_REPLY_MARKER = "atelier-auto-ooo";

type LeaveRow = typeof atelierLeaveRequests.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayYmd(): string {
  // Firm operates on Asia/Dubai (fixed UTC+4).
  return new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtHuman(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function oooAudit(args: {
  leave: LeaveRow;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  assertAuditAction(args.action);
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "leave_request",
    entityId: args.leave.id,
    actorType: "system",
    actorId: "leave-ooo-sync",
    actorLabel: "Out-of-office sync",
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
    orgId: args.leave.orgId,
  });
}

async function loadConnectionForUser(
  orgId: string,
  userId: string,
): Promise<MsConnectionRow | null> {
  const [row] = await db
    .select()
    .from(atelierMsConnections)
    .where(
      and(
        eq(atelierMsConnections.orgId, orgId),
        eq(atelierMsConnections.userId, userId),
      ),
    );
  return row ?? null;
}

async function personInfo(
  orgId: string,
  personId: string,
): Promise<{ country: string | null; name: string }> {
  const [emp] = await db
    .select({ country: atelierEmployees.country, fullName: atelierEmployees.fullName })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, personId), eq(atelierEmployees.orgId, orgId)));
  if (emp) return { country: emp.country ?? null, name: emp.fullName };
  const [con] = await db
    .select({ country: atelierContractors.country, fullName: atelierContractors.fullName })
    .from(atelierContractors)
    .where(and(eq(atelierContractors.id, personId), eq(atelierContractors.orgId, orgId)));
  return { country: con?.country ?? null, name: con?.fullName ?? "Colleague" };
}

async function personCountry(orgId: string, personId: string): Promise<string | null> {
  const [emp] = await db
    .select({ country: atelierEmployees.country })
    .from(atelierEmployees)
    .where(and(eq(atelierEmployees.id, personId), eq(atelierEmployees.orgId, orgId)));
  if (emp) return emp.country ?? null;
  const [con] = await db
    .select({ country: atelierContractors.country })
    .from(atelierContractors)
    .where(and(eq(atelierContractors.id, personId), eq(atelierContractors.orgId, orgId)));
  return con?.country ?? null;
}

/** All current/future approved leaves for this user (endDate >= today). */
async function activeApprovedLeaves(orgId: string, userId: string): Promise<LeaveRow[]> {
  const rows = await db
    .select()
    .from(atelierLeaveRequests)
    .where(
      and(
        eq(atelierLeaveRequests.orgId, orgId),
        eq(atelierLeaveRequests.userId, userId),
        inArray(atelierLeaveRequests.status, ["approved"]),
        isNull(atelierLeaveRequests.deletedAt),
      ),
    );
  const today = todayYmd();
  return rows
    .filter((r) => r.endDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Merge overlapping/adjacent [startDate, endDate] leave windows. */
export function mergeLeaveWindows(
  leaves: Array<{ startDate: string; endDate: string }>,
): Array<{ startDate: string; endDate: string }> {
  const sorted = [...leaves].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const out: Array<{ startDate: string; endDate: string }> = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    // Adjacent (next day) windows merge too — one continuous absence.
    if (last && l.startDate <= addDaysYmd(last.endDate, 1)) {
      if (l.endDate > last.endDate) last.endDate = l.endDate;
    } else {
      out.push({ startDate: l.startDate, endDate: l.endDate });
    }
  }
  return out;
}

function buildReplyHtml(personName: string, returnDay: string): string {
  return (
    `<p>Hello,</p>` +
    `<p>I am currently out of the office and will be back on ${fmtHuman(returnDay)}. ` +
    `I will respond to your message when I return.</p>` +
    `<p>For anything urgent, please reach out to the Cognirise team.</p>` +
    `<p>Best regards,<br/>${personName}</p>` +
    `<span data-atelier="${OOO_REPLY_MARKER}" style="display:none">${OOO_REPLY_MARKER}</span>`
  );
}

/**
 * Reconcile the user's Outlook auto-reply with their merged approved-leave
 * windows. Never touches a manually-configured reply. Returns what it did.
 */
async function reconcileAutoReply(args: {
  leave: LeaveRow;
  accessToken: string;
  personName: string;
}): Promise<"set" | "cleared" | "kept-manual" | "none"> {
  const { leave, accessToken, personName } = args;
  const existing = await getAutomaticReplies(accessToken);
  const existingEnabled = existing.status === "scheduled" || existing.status === "alwaysEnabled";
  const existingIsOurs =
    (existing.internalReplyMessage ?? "").includes(OOO_REPLY_MARKER) ||
    (existing.externalReplyMessage ?? "").includes(OOO_REPLY_MARKER);
  if (existingEnabled && !existingIsOurs) {
    // Manual reply — hands off.
    return "kept-manual";
  }

  const leaves = await activeApprovedLeaves(leave.orgId, leave.userId);
  const windows = mergeLeaveWindows(leaves);
  const today = todayYmd();
  // The window we schedule is the first merged window that is current or
  // upcoming (Outlook supports one scheduled window at a time).
  const win = windows.find((w) => w.endDate >= today) ?? null;

  if (!win) {
    if (existingEnabled && existingIsOurs) {
      await setAutomaticReplies(accessToken, { status: "disabled" });
      return "cleared";
    }
    return "none";
  }

  const country = await personCountry(leave.orgId, leave.personId);
  // Honour HR-confirmed/adjusted holiday dates (Task #606) in the
  // "back on <date>" maths; falls back to the curated dataset.
  const effectiveHolidays = applyHolidayOverrides(
    PUBLIC_HOLIDAYS,
    await loadHolidayOverrides(leave.orgId).catch(() => null),
  );
  const returnDay = nextWorkingDayAfter(win.endDate, country, effectiveHolidays);
  // Schedule in the leave-taker's own timezone (roster country → IANA tz).
  const tz = timezoneFor(country);
  await setAutomaticReplies(accessToken, {
    status: "scheduled",
    externalAudience: "none", // internal audience only
    scheduledStartDateTime: {
      dateTime: `${win.startDate}T00:00:00`,
      timeZone: tz,
    },
    scheduledEndDateTime: {
      // Replies stay on through the last leave day, off from the return day.
      dateTime: `${returnDay}T00:00:00`,
      timeZone: tz,
    },
    internalReplyMessage: buildReplyHtml(personName, returnDay),
  });
  return "set";
}

/**
 * Apply OOO surfaces for a freshly APPROVED leave. Fire-and-forget from
 * the route (never throws).
 */
export async function applyLeaveOoo(leaveId: string): Promise<void> {
  let leave: LeaveRow | undefined;
  try {
    [leave] = await db
      .select()
      .from(atelierLeaveRequests)
      .where(eq(atelierLeaveRequests.id, leaveId));
    if (!leave || leave.status !== "approved") return;
    const { name: personName, country: personCountryName } = await personInfo(
      leave.orgId,
      leave.personId,
    );

    const today = todayYmd();
    if (leave.endDate < today) {
      await oooAudit({
        leave,
        action: "leave.ooo.skipped",
        payload: { reason: "past-leave", endDate: leave.endDate },
        summary: `Out-of-office skipped for past leave ${leave.startDate} → ${leave.endDate}`,
      });
      return;
    }
    if (!msConfigured()) return;
    const conn = await loadConnectionForUser(leave.orgId, leave.userId);
    if (!conn) {
      await oooAudit({
        leave,
        action: "leave.ooo.skipped",
        payload: { reason: "no-ms-connection" },
        summary: `Out-of-office skipped — no Microsoft connection for the leave taker`,
      });
      return;
    }
    const { accessToken, scopes } = await freshAccessToken(conn);

    // 1) All-day OOF calendar event (idempotent — skip if already created).
    let eventId = leave.msOofEventId ?? null;
    if (!eventId) {
      const ev = await createAllDayOofEvent(accessToken, {
        subject: `Out of office — ${personName}`,
        startDate: leave.startDate,
        endDateExclusive: addDaysYmd(leave.endDate, 1),
        bodyText: "Automatically added by the Atelier when leave was approved.",
        timeZone: timezoneFor(personCountryName),
      });
      eventId = ev.id;
      await db
        .update(atelierLeaveRequests)
        .set({ msOofEventId: eventId, updatedAt: new Date() })
        .where(eq(atelierLeaveRequests.id, leave.id));
      // Task #629 — write-through: OOF block landed on the user's calendar.
      noteLocalCalendarChange([leave.userId]);
    }

    // 2) Automatic replies — needs MailboxSettings scope.
    let replyResult: string = "no-scope";
    if (hasMailboxSettingsScope(scopes)) {
      replyResult = await reconcileAutoReply({ leave, accessToken, personName });
    }
    await oooAudit({
      leave,
      action: "leave.ooo.applied",
      payload: { eventId, autoReply: replyResult },
      summary: `Out-of-office applied for leave ${leave.startDate} → ${leave.endDate} (auto-reply: ${replyResult})`,
    });
  } catch (err) {
    logger.error({ err, leaveId }, "leave OOO apply failed");
    if (leave) {
      await oooAudit({
        leave,
        action: "leave.ooo.failed",
        payload: { phase: "apply", error: err instanceof Error ? err.message : String(err) },
        summary: `Out-of-office apply failed for leave ${leave.startDate} → ${leave.endDate}`,
      }).catch(() => undefined);
    }
  }
}

/**
 * Clear/reconcile OOO surfaces after a leave is revoked or shortened.
 * Pass the leave row AS IT WAS (with its msOofEventId) plus whether the
 * whole leave is gone (revoke) or just trimmed (shorten → re-apply).
 */
export async function clearLeaveOoo(
  leaveId: string,
  mode: "revoke" | "shorten",
): Promise<void> {
  let leave: LeaveRow | undefined;
  try {
    [leave] = await db
      .select()
      .from(atelierLeaveRequests)
      .where(eq(atelierLeaveRequests.id, leaveId));
    if (!leave) return;
    if (!msConfigured()) return;
    const { name: personName } = await personInfo(leave.orgId, leave.personId);
    const conn = await loadConnectionForUser(leave.orgId, leave.userId);
    if (!conn) return;
    const { accessToken, scopes } = await freshAccessToken(conn);

    // 1) Remove (or recreate, when shortened) the OOF event.
    if (leave.msOofEventId) {
      await deleteCalendarEvent(accessToken, leave.msOofEventId).catch(() => undefined);
      await db
        .update(atelierLeaveRequests)
        .set({ msOofEventId: null, updatedAt: new Date() })
        .where(eq(atelierLeaveRequests.id, leave.id));
      // Task #629 — write-through: OOF block removed from the calendar.
      noteLocalCalendarChange([leave.userId]);
    }
    if (mode === "shorten" && leave.status === "approved") {
      const today = todayYmd();
      if (leave.endDate >= today) {
        const ev = await createAllDayOofEvent(accessToken, {
          subject: `Out of office — ${personName}`,
          startDate: leave.startDate,
          endDateExclusive: addDaysYmd(leave.endDate, 1),
          bodyText: "Automatically added by the Atelier when leave was approved.",
        });
        await db
          .update(atelierLeaveRequests)
          .set({ msOofEventId: ev.id, updatedAt: new Date() })
          .where(eq(atelierLeaveRequests.id, leave.id));
        // Task #629 — write-through: replacement OOF block created.
        noteLocalCalendarChange([leave.userId]);
      }
    }

    // 2) Reconcile auto-replies against whatever approved leaves remain.
    let replyResult: string = "no-scope";
    if (hasMailboxSettingsScope(scopes)) {
      replyResult = await reconcileAutoReply({ leave, accessToken, personName });
    }
    await oooAudit({
      leave,
      action: "leave.ooo.cleared",
      payload: { mode, autoReply: replyResult },
      summary: `Out-of-office ${mode === "revoke" ? "removed" : "updated"} for leave ${leave.startDate} → ${leave.endDate} (auto-reply: ${replyResult})`,
    });
  } catch (err) {
    logger.error({ err, leaveId }, "leave OOO clear failed");
    if (leave) {
      await oooAudit({
        leave,
        action: "leave.ooo.failed",
        payload: { phase: "clear", error: err instanceof Error ? err.message : String(err) },
        summary: `Out-of-office cleanup failed for leave ${leave.startDate} → ${leave.endDate}`,
      }).catch(() => undefined);
    }
  }
}
