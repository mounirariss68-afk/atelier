/**
 * Task #553 — internal-meeting scheduling across colleagues' Microsoft
 * 365 calendars.
 *
 * Everything here operates on DELEGATED per-user tokens: to read a
 * colleague's busy times we use that colleague's OWN stored connection
 * (never application-level access). The invite itself is created on the
 * requester's calendar, so attendees receive a normal Outlook invite
 * whether or not they connected Atelier.
 *
 * Time zone: the firm default is Asia/Dubai (fixed UTC+4, no DST).
 * Working hours for auto-found slots are 08:00–18:00 Dubai.
 */
import { eq } from "drizzle-orm";
import { db, atelierMsConnections } from "@workspace/db";
import {
  MsAuthError,
  MsGraphError,
  createCalendarEvent,
  decryptToken,
  deleteCalendarEvent,
  encryptToken,
  getCalendarView,
  hasCalendarWriteScope,
  refreshTokens,
  updateCalendarEvent,
  type MsCalendarEvent,
} from "./msGraph.js";
import { logger } from "./logger";
// Circular at module level (msCalendarSync imports freshAccessToken from
// here) but safe: both sides only reference each other inside functions.
import { noteLocalCalendarChange } from "./msCalendarSync.js";

export const DUBAI_UTC_OFFSET_MS = 4 * 3600 * 1000; // fixed, no DST
export const WORK_START_HOUR = 8; // 08:00 Dubai
export const WORK_END_HOUR = 18; // 18:00 Dubai

// ------------------------------------------------------------------
// Dubai time helpers (fixed UTC+4 — no DST, so plain offset math is safe)
// ------------------------------------------------------------------
export function utcToDubai(d: Date): Date {
  return new Date(d.getTime() + DUBAI_UTC_OFFSET_MS);
}
export function dubaiToUtc(d: Date): Date {
  return new Date(d.getTime() - DUBAI_UTC_OFFSET_MS);
}
/** "2026-07-23" + "08:30" (Dubai wall clock) → UTC Date. */
export function dubaiWallToUtc(dateYmd: string, timeHm: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeHm.trim());
  if (!m || !t) return null;
  const utcMs = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(t[1]),
    Number(t[2]),
  );
  if (Number.isNaN(utcMs)) return null;
  return new Date(utcMs - DUBAI_UTC_OFFSET_MS);
}
export function fmtDubai(d: Date): string {
  const z = utcToDubai(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${z.getUTCFullYear()}-${pad(z.getUTCMonth() + 1)}-${pad(z.getUTCDate())} ${pad(z.getUTCHours())}:${pad(z.getUTCMinutes())}`;
}

// ------------------------------------------------------------------
// Fresh access token for a stored connection (persists rotation + the
// actually-granted scopes so a reconnect self-heals stale scope lists).
// ------------------------------------------------------------------
export type MsConnectionRow = typeof atelierMsConnections.$inferSelect;

export async function freshAccessToken(
  conn: MsConnectionRow,
): Promise<{ accessToken: string; scopes: string[] }> {
  const tokens = await refreshTokens(decryptToken(conn.encRefreshToken));
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (tokens.refreshToken) patch.encRefreshToken = encryptToken(tokens.refreshToken);
  // Persist the live scope list — after admin consent is granted, a
  // silent refresh may pick up Calendars.ReadWrite without a reconnect.
  if (tokens.scopes.length > 0) patch.scopes = tokens.scopes;
  await db
    .update(atelierMsConnections)
    .set(patch)
    .where(eq(atelierMsConnections.id, conn.id));
  return {
    accessToken: tokens.accessToken,
    scopes: tokens.scopes.length > 0 ? tokens.scopes : (conn.scopes ?? []),
  };
}

// ------------------------------------------------------------------
// Busy intervals + earliest-common-slot
// ------------------------------------------------------------------
export interface BusyInterval {
  start: Date;
  end: Date;
}

export function eventsToBusy(events: MsCalendarEvent[]): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const ev of events) {
    if (ev.isCancelled) continue;
    if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
    const s = new Date(`${ev.start.dateTime}${ev.start.dateTime.endsWith("Z") ? "" : "Z"}`);
    const e = new Date(`${ev.end.dateTime}${ev.end.dateTime.endsWith("Z") ? "" : "Z"}`);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) continue;
    out.push({ start: s, end: e });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Earliest slot of `durationMin` minutes, at or after `earliest`, before
 * `latest`, inside working hours (08:00–18:00 Dubai, any day), that does
 * not overlap ANY busy interval. Candidates advance on a 15-minute grid.
 * Pure + deterministic so it can be probed without Graph.
 */
export function findEarliestCommonSlot(args: {
  busy: BusyInterval[];
  durationMin: number;
  earliest: Date;
  latest: Date;
}): { start: Date; end: Date } | null {
  const STEP = 15 * 60 * 1000;
  const durMs = args.durationMin * 60 * 1000;
  // Align the first candidate up to the grid.
  let t = Math.ceil(args.earliest.getTime() / STEP) * STEP;
  const lastStart = args.latest.getTime() - durMs;
  const busy = [...args.busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  while (t <= lastStart) {
    const start = new Date(t);
    const end = new Date(t + durMs);
    // Working-hours check in Dubai wall clock (slot must fit same day).
    const zs = utcToDubai(start);
    const ze = utcToDubai(end);
    const startMinutes = zs.getUTCHours() * 60 + zs.getUTCMinutes();
    const endMinutes = ze.getUTCHours() * 60 + ze.getUTCMinutes();
    const sameDay =
      zs.getUTCFullYear() === ze.getUTCFullYear() &&
      zs.getUTCMonth() === ze.getUTCMonth() &&
      zs.getUTCDate() === ze.getUTCDate();
    const inHours =
      sameDay &&
      startMinutes >= WORK_START_HOUR * 60 &&
      (endMinutes <= WORK_END_HOUR * 60 && (endMinutes > 0 || ze.getUTCHours() === 0));
    if (!inHours) {
      // Jump to the next day's 08:00 Dubai if we've passed 18:00; else step.
      if (startMinutes >= WORK_END_HOUR * 60 || !sameDay) {
        const nextDay = new Date(
          Date.UTC(zs.getUTCFullYear(), zs.getUTCMonth(), zs.getUTCDate() + 1, WORK_START_HOUR, 0),
        );
        t = dubaiToUtc(nextDay).getTime();
      } else if (startMinutes < WORK_START_HOUR * 60) {
        const sameDay8 = new Date(
          Date.UTC(zs.getUTCFullYear(), zs.getUTCMonth(), zs.getUTCDate(), WORK_START_HOUR, 0),
        );
        t = dubaiToUtc(sameDay8).getTime();
      } else {
        t += STEP;
      }
      continue;
    }
    const conflict = busy.find((b) => b.start < end && b.end > start);
    if (!conflict) return { start, end };
    // Skip to the end of the conflicting interval (grid-aligned up).
    t = Math.max(t + STEP, Math.ceil(conflict.end.getTime() / STEP) * STEP);
  }
  return null;
}

// ------------------------------------------------------------------
// Availability across users
// ------------------------------------------------------------------
export interface AvailabilityPerson {
  userId: string;
  name: string;
  email: string;
}

export interface AvailabilityResult {
  /** People whose calendars were actually checked. */
  checked: AvailabilityPerson[];
  /** People with no Microsoft 365 connection — availability unknown. */
  notConnected: AvailabilityPerson[];
  /** People whose connection failed (expired token etc.). */
  failed: Array<AvailabilityPerson & { reason: string }>;
  busy: BusyInterval[];
}

/**
 * Pull busy intervals for each person with a stored connection, using
 * each person's OWN token. Explicit not-connected/failed lists — no
 * silent guessing.
 */
export async function collectBusyTimes(args: {
  people: AvailabilityPerson[];
  windowStart: Date;
  windowEnd: Date;
}): Promise<AvailabilityResult> {
  const result: AvailabilityResult = {
    checked: [],
    notConnected: [],
    failed: [],
    busy: [],
  };
  for (const p of args.people) {
    const [conn] = await db
      .select()
      .from(atelierMsConnections)
      .where(eq(atelierMsConnections.userId, p.userId))
      .limit(1);
    if (!conn) {
      result.notConnected.push(p);
      continue;
    }
    try {
      const { accessToken } = await freshAccessToken(conn);
      const events = await getCalendarView(
        accessToken,
        args.windowStart.toISOString(),
        args.windowEnd.toISOString(),
      );
      result.busy.push(...eventsToBusy(events));
      result.checked.push(p);
    } catch (err) {
      const reason =
        err instanceof MsAuthError
          ? err.code
          : err instanceof MsGraphError
            ? `graph-${err.status}`
            : "graph-unavailable";
      logger.warn({ err, userId: p.userId }, "[ms-scheduling] busy lookup failed");
      result.failed.push({ ...p, reason });
    }
  }
  return result;
}

// ------------------------------------------------------------------
// Booking
// ------------------------------------------------------------------
export class SchedulingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not-connected"
      | "missing-scope"
      | "reconnect-required"
      | "graph-failed",
  ) {
    super(message);
    this.name = "SchedulingError";
  }
}

/**
 * Fresh, write-capable Graph token for a user's stored connection.
 * `whose` = "self" phrases errors at the caller; "organizer" phrases them
 * about the meeting organizer (founding-partner acting on another's
 * meeting — the Outlook event lives on the ORGANIZER's calendar, so we
 * must always use the organizer's own delegated token).
 */
async function calendarWriteToken(
  userId: string,
  whose: "self" | "organizer",
): Promise<{ accessToken: string; organizerEmail: string }> {
  const [conn] = await db
    .select()
    .from(atelierMsConnections)
    .where(eq(atelierMsConnections.userId, userId))
    .limit(1);
  if (!conn) {
    throw new SchedulingError(
      whose === "self"
        ? "You haven't connected Microsoft 365 yet — connect it from your profile to send calendar invites."
        : "The meeting organizer no longer has a Microsoft 365 connection, so the Outlook event can't be updated from here.",
      "not-connected",
    );
  }
  let accessToken: string;
  let scopes: string[];
  try {
    const fresh = await freshAccessToken(conn);
    accessToken = fresh.accessToken;
    scopes = fresh.scopes;
  } catch (err) {
    if (err instanceof MsAuthError) {
      throw new SchedulingError(
        whose === "self"
          ? "Your Microsoft 365 connection has expired. Please disconnect and connect again from your profile."
          : "The meeting organizer's Microsoft 365 connection has expired, so the Outlook event can't be updated from here.",
        "reconnect-required",
      );
    }
    throw err;
  }
  if (!hasCalendarWriteScope(scopes)) {
    throw new SchedulingError(
      "This needs the Calendars.ReadWrite permission. Please reconnect Microsoft 365 from your profile; if that doesn't help, ask your admin to add Calendars.ReadWrite to the Cognirise app in Microsoft Entra and grant consent.",
      "missing-scope",
    );
  }
  return { accessToken, organizerEmail: conn.msEmail };
}

export async function sendInternalInvite(args: {
  requesterUserId: string;
  subject: string;
  bodyText?: string;
  start: Date;
  end: Date;
  attendees: Array<{ email: string; name?: string | null }>;
  online: boolean;
}): Promise<{ event: MsCalendarEvent; organizerEmail: string }> {
  const { accessToken, organizerEmail } = await calendarWriteToken(
    args.requesterUserId,
    "self",
  );
  try {
    const event = await createCalendarEvent(accessToken, {
      subject: args.subject,
      bodyText: args.bodyText,
      startUtcIso: args.start.toISOString(),
      endUtcIso: args.end.toISOString(),
      attendees: args.attendees,
      online: args.online,
    });
    // Task #629 — write-through: the organizer's cached calendar changed.
    noteLocalCalendarChange([args.requesterUserId]);
    return { event, organizerEmail };
  } catch (err) {
    if (err instanceof MsGraphError && err.status === 403) {
      throw new SchedulingError(
        "Microsoft blocked the invite (missing Calendars.ReadWrite permission). Ask your admin to add Calendars.ReadWrite to the Cognirise app in Microsoft Entra and grant admin consent, then reconnect Microsoft 365.",
        "missing-scope",
      );
    }
    throw new SchedulingError(
      "Microsoft 365 is unreachable right now — the invite was not sent. Try again shortly.",
      "graph-failed",
    );
  }
}

/**
 * Task #559 — reschedule the Outlook event behind an internal meeting.
 * PATCHes the ORGANIZER's copy of the event (delegated) so attendees
 * receive a standard Outlook meeting update. `actingUserId` only controls
 * the error phrasing: when a founding partner moves someone else's
 * meeting, the failure message talks about the organizer's connection.
 */
export async function updateInternalInvite(args: {
  organizerUserId: string;
  actingUserId: string;
  msEventId: string;
  start?: Date;
  end?: Date;
  subject?: string;
  /** Full replacement attendee list (Task #568 — attendee edits). */
  attendees?: Array<{ email: string; name?: string | null }>;
}): Promise<void> {
  const { accessToken } = await calendarWriteToken(
    args.organizerUserId,
    args.actingUserId === args.organizerUserId ? "self" : "organizer",
  );
  try {
    await updateCalendarEvent(accessToken, args.msEventId, {
      startUtcIso: args.start?.toISOString(),
      endUtcIso: args.end?.toISOString(),
      subject: args.subject,
      attendees: args.attendees,
    });
    // Task #629 — write-through: the organizer's cached calendar changed.
    noteLocalCalendarChange([args.organizerUserId]);
  } catch (err) {
    if (err instanceof MsGraphError && err.status === 404) {
      // Event vanished from the organizer's mailbox (deleted in Outlook).
      // Atelier row is being brought in line — nothing to move.
      logger.warn(
        { msEventId: args.msEventId },
        "[ms-scheduling] reschedule: event already gone from organizer mailbox",
      );
      return;
    }
    if (err instanceof MsGraphError && err.status === 403) {
      throw new SchedulingError(
        "Microsoft blocked the update (missing Calendars.ReadWrite permission). Reconnect Microsoft 365 or ask your admin to grant Calendars.ReadWrite.",
        "missing-scope",
      );
    }
    throw new SchedulingError(
      "Microsoft 365 is unreachable right now — the meeting was NOT moved. Try again shortly.",
      "graph-failed",
    );
  }
}

/**
 * Task #559 — cancel the Outlook event behind an internal meeting.
 * Deleting the ORGANIZER's copy makes Outlook send every attendee a
 * standard cancellation. A 404 counts as already-cancelled.
 */
export async function cancelInternalInvite(args: {
  organizerUserId: string;
  actingUserId: string;
  msEventId: string;
}): Promise<void> {
  const { accessToken } = await calendarWriteToken(
    args.organizerUserId,
    args.actingUserId === args.organizerUserId ? "self" : "organizer",
  );
  try {
    await deleteCalendarEvent(accessToken, args.msEventId);
    // Task #629 — write-through: the organizer's cached calendar changed.
    noteLocalCalendarChange([args.organizerUserId]);
  } catch (err) {
    if (err instanceof MsGraphError && err.status === 403) {
      throw new SchedulingError(
        "Microsoft blocked the cancellation (missing Calendars.ReadWrite permission). Reconnect Microsoft 365 or ask your admin to grant Calendars.ReadWrite.",
        "missing-scope",
      );
    }
    throw new SchedulingError(
      "Microsoft 365 is unreachable right now — the meeting was NOT cancelled. Try again shortly.",
      "graph-failed",
    );
  }
}
