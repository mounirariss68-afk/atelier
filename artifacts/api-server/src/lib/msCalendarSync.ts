/**
 * Task #629 — real-time Outlook calendar sync.
 *
 * Three cooperating pieces:
 *  1. Subscription lifecycle — one Graph change-notification subscription
 *     per connected user (created at connect time + boot, renewed by the
 *     scheduler, cleaned up on disconnect/revoke).
 *  2. Delta reconciliation — on each notification (or maintenance pass) a
 *     Graph calendarView delta query reconciles changed/deleted events into
 *     a per-user rolling cache (CACHE_PAST_DAYS back .. CACHE_FUTURE_DAYS
 *     ahead). Recurring series arrive as expanded occurrences, so a single
 *     cancelled/rescheduled occurrence maps to exactly one cached row.
 *     Removed/cancelled Outlook events that correspond to Atelier-booked
 *     meetings (matched by Graph event id / iCalUId) soft-cancel the
 *     internal row too, so both stores agree.
 *  3. Read path — getCachedCalendar() serves calendar reads from the cache
 *     when it is fresh and covers the window; callers fall back to the
 *     existing live fetch otherwise (dev/preview, expired subscriptions).
 *
 * Concurrency: per-user single-flight queue with a rerun flag — a burst of
 * webhook notifications collapses into at most one in-flight sync plus one
 * follow-up round.
 *
 * Dev fallback: without a publicly reachable webhook URL (no deployment
 * domain and no MS_WEBHOOK_PUBLIC_URL override) subscriptions are skipped
 * with a clear log line and everything behaves exactly as before (live
 * pull on open). In production a subscription failure is logged as an
 * error and recorded on the row — never silently swallowed.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  atelierMeetings,
  atelierAuditEvents,
  atelierMsCalEvents,
  atelierMsCalSubscriptions,
  atelierMsCalSyncState,
  atelierMsConnections,
} from "@workspace/db";
import {
  MsAuthError,
  MsGraphError,
  createGraphSubscription,
  deleteGraphSubscription,
  getCalendarEvent,
  getCalendarViewDelta,
  getCalendarViewForCalendar,
  listCalendars,
  renewGraphSubscription,
  msConfigured,
  type MsCalendarDeltaEvent,
  type MsCalendarEvent,
} from "./msGraph.js";
import { freshAccessToken, type MsConnectionRow } from "./msScheduling.js";

// Rolling cache window: a week back (recent-past day switching) and a
// month ahead (covers the mobile 7-day reminder horizon and the web
// month-ish views).
export const CACHE_PAST_DAYS = 7;
export const CACHE_FUTURE_DAYS = 31;

/** Renew when a subscription has less than this much life left. */
const RENEW_BEFORE_MS = 12 * 3600 * 1000;
/** Graph caps calendar subscriptions around 3 days — ask for ~2.7. */
const SUBSCRIPTION_TTL_MS = 65 * 3600 * 1000;
/** Cache counts as fresh only if a sync succeeded within this horizon
 *  (the maintenance job syncs hourly, so 6h means "recently healthy"). */
const CACHE_FRESH_MS = 6 * 3600 * 1000;
/** Roll the window forward when its end is within this much of the
 *  desired end (i.e. the cached horizon has drifted ~2 days). */
const WINDOW_DRIFT_MS = 2 * 24 * 3600 * 1000;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function dayStartUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function desiredWindow(now = new Date()): { start: Date; end: Date } {
  const today = dayStartUtc(now);
  return {
    start: new Date(today.getTime() - CACHE_PAST_DAYS * 24 * 3600 * 1000),
    end: new Date(today.getTime() + CACHE_FUTURE_DAYS * 24 * 3600 * 1000),
  };
}

function eventTime(ev: MsCalendarEvent, which: "start" | "end"): Date | null {
  const dt = ev[which]?.dateTime;
  if (!dt) return null;
  const d = new Date(dt.endsWith("Z") ? dt : `${dt}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Graph delta objects are sparse: omitted properties mean "unchanged", while
 * explicit null/false/empty values are real updates. Merge only defined keys. */
export function mergeCalendarDelta(
  existing: MsCalendarEvent | null,
  delta: MsCalendarDeltaEvent,
): MsCalendarDeltaEvent {
  const merged = { ...(existing ?? {}) } as MsCalendarDeltaEvent;
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

async function completeDeltaEvent(
  accessToken: string,
  existing: MsCalendarEvent | null,
  delta: MsCalendarDeltaEvent,
): Promise<MsCalendarDeltaEvent> {
  let merged = mergeCalendarDelta(existing, delta);
  const needsAuthoritative =
    !merged.start?.dateTime ||
    !merged.end?.dateTime ||
    merged.subject === undefined ||
    merged.subject === null;
  if (needsAuthoritative) {
    try {
      const authoritative = await getCalendarEvent(accessToken, delta.id);
      merged = mergeCalendarDelta(merged, authoritative);
    } catch (e) {
      console.warn(
        `[mscal] could not hydrate event ${delta.id}: ${String(e).slice(0, 160)}`,
      );
    }
  }
  // Some Graph occurrence shapes still omit the inherited series subject.
  // Resolve it from the master for this occurrence only; never mutate by UID.
  if (
    (merged.subject === undefined || merged.subject === null) &&
    merged.seriesMasterId
  ) {
    try {
      const master = await getCalendarEvent(accessToken, merged.seriesMasterId);
      if (master.subject !== undefined && master.subject !== null) {
        merged.subject = master.subject;
      }
    } catch (e) {
      console.warn(
        `[mscal] could not resolve series subject for ${delta.id}: ${String(e).slice(0, 160)}`,
      );
    }
  }
  return merged;
}

// ------------------------------------------------------------------
// Webhook public URL
// ------------------------------------------------------------------

/**
 * The publicly reachable webhook URL, or null when webhooks can't work
 * (dev preview). Priority: explicit MS_WEBHOOK_PUBLIC_URL override, then
 * the deployment domain. In non-deployed environments we intentionally do
 * NOT guess a dev URL — dev previews are not reliably reachable by Graph,
 * and the read path degrades to the existing live pull.
 */
export function webhookNotificationUrl(): string | null {
  const explicit = process.env.MS_WEBHOOK_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.REPLIT_DEPLOYMENT) {
    const domain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
    if (domain) return `https://${domain}/api/ms/calendar/webhook`;
  }
  return null;
}

let loggedNoWebhookUrl = false;

// ------------------------------------------------------------------
// Subscription lifecycle
// ------------------------------------------------------------------

async function loadConnectionByUser(userId: string): Promise<MsConnectionRow | null> {
  const [row] = await db
    .select()
    .from(atelierMsConnections)
    .where(eq(atelierMsConnections.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Ensure a live Graph subscription exists for this connection. Creates or
 * renews as needed; records lastError on failure. Returns whether a live
 * subscription is in place.
 */
export async function ensureCalendarSubscription(
  conn: MsConnectionRow,
): Promise<{ ok: boolean; reason?: string }> {
  if (!msConfigured()) return { ok: false, reason: "not-configured" };
  const url = webhookNotificationUrl();
  if (!url) {
    if (!loggedNoWebhookUrl) {
      loggedNoWebhookUrl = true;
      console.log(
        "[mscal] no public webhook URL (dev/preview or MS_WEBHOOK_PUBLIC_URL unset) — " +
          "Graph subscriptions disabled, calendar reads stay live-pull",
      );
    }
    return { ok: false, reason: "no-public-url" };
  }

  const [existing] = await db
    .select()
    .from(atelierMsCalSubscriptions)
    .where(
      and(
        eq(atelierMsCalSubscriptions.orgId, conn.orgId),
        eq(atelierMsCalSubscriptions.userId, conn.userId),
      ),
    )
    .limit(1);

  const now = Date.now();
  if (existing && existing.expiresAt.getTime() - now > RENEW_BEFORE_MS && !existing.lastError) {
    return { ok: true };
  }

  try {
    const { accessToken } = await freshAccessToken(conn);
    const newExpiry = new Date(now + SUBSCRIPTION_TTL_MS);

    if (existing && existing.expiresAt.getTime() > now) {
      // Still alive — renew in place.
      try {
        const renewed = await renewGraphSubscription(
          accessToken,
          existing.subscriptionId,
          newExpiry.toISOString(),
        );
        await db
          .update(atelierMsCalSubscriptions)
          .set({
            expiresAt: renewed.expirationDateTime
              ? new Date(renewed.expirationDateTime)
              : newExpiry,
            lastRenewedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(atelierMsCalSubscriptions.id, existing.id));
        return { ok: true };
      } catch (e) {
        // 404 = Graph already dropped it — fall through to re-create.
        if (!(e instanceof MsGraphError && e.status === 404)) throw e;
      }
    }

    // Create fresh (covers: no row, expired row, renewed-404 row).
    const clientState = randomBytes(24).toString("hex");
    const created = await createGraphSubscription(accessToken, {
      notificationUrl: url,
      clientState,
      expirationDateTime: newExpiry.toISOString(),
    });
    const values = {
      subscriptionId: created.id,
      clientState,
      resource: created.resource ?? "/me/events",
      expiresAt: created.expirationDateTime
        ? new Date(created.expirationDateTime)
        : newExpiry,
      lastRenewedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    };
    if (existing) {
      await db
        .update(atelierMsCalSubscriptions)
        .set(values)
        .where(eq(atelierMsCalSubscriptions.id, existing.id));
    } else {
      await db.insert(atelierMsCalSubscriptions).values({
        id: rid("mcs"),
        orgId: conn.orgId,
        userId: conn.userId,
        ...values,
      });
    }
    console.log(`[mscal] subscription ready for user ${conn.userId} (exp ${values.expiresAt.toISOString()})`);
    return { ok: true };
  } catch (e) {
    const detail =
      e instanceof MsAuthError || e instanceof MsGraphError
        ? `${e.name}:${e.message}`.slice(0, 300)
        : String(e).slice(0, 300);
    // Never silent: error-level in production, info in dev.
    const log = process.env.REPLIT_DEPLOYMENT ? console.error : console.warn;
    log(`[mscal] subscription create/renew FAILED for user ${conn.userId}: ${detail}`);
    if (existing) {
      await db
        .update(atelierMsCalSubscriptions)
        .set({ lastError: detail, updatedAt: new Date() })
        .where(eq(atelierMsCalSubscriptions.id, existing.id));
    }
    return { ok: false, reason: detail };
  }
}

/**
 * Remove subscription + cached calendar data for a user (disconnect or
 * revoked connection). Graph-side delete is best-effort — Microsoft drops
 * dead subscriptions on its own once we stop responding.
 */
export async function removeCalendarSubscription(userId: string): Promise<void> {
  const [sub] = await db
    .select()
    .from(atelierMsCalSubscriptions)
    .where(eq(atelierMsCalSubscriptions.userId, userId))
    .limit(1);
  if (sub) {
    try {
      const conn = await loadConnectionByUser(userId);
      if (conn) {
        const { accessToken } = await freshAccessToken(conn);
        await deleteGraphSubscription(accessToken, sub.subscriptionId);
      }
    } catch (e) {
      if (!(e instanceof MsGraphError && e.status === 404)) {
        console.warn(`[mscal] graph subscription delete failed (best-effort): ${String(e).slice(0, 200)}`);
      }
    }
    await db
      .delete(atelierMsCalSubscriptions)
      .where(eq(atelierMsCalSubscriptions.id, sub.id));
  }
  await db.delete(atelierMsCalEvents).where(eq(atelierMsCalEvents.userId, userId));
  await db.delete(atelierMsCalSyncState).where(eq(atelierMsCalSyncState.userId, userId));
}

/** Look up the subscription row for an incoming notification. */
export async function subscriptionByGraphId(subscriptionId: string) {
  const [row] = await db
    .select()
    .from(atelierMsCalSubscriptions)
    .where(eq(atelierMsCalSubscriptions.subscriptionId, subscriptionId))
    .limit(1);
  return row ?? null;
}

// ------------------------------------------------------------------
// Per-user single-flight sync queue
// ------------------------------------------------------------------

const inflight = new Map<string, { rerun: boolean }>();

/**
 * Queue a delta sync for a user. Collapses bursts: if a sync is already
 * running, mark it for one follow-up round instead of stacking.
 */
export function enqueueCalendarSync(userId: string, reason: string): void {
  const cur = inflight.get(userId);
  if (cur) {
    cur.rerun = true;
    return;
  }
  const state = { rerun: false };
  inflight.set(userId, state);
  void (async () => {
    try {
      let rounds = 0;
      do {
        state.rerun = false;
        rounds += 1;
        await runCalendarDeltaSync(userId, reason);
      } while (state.rerun && rounds < 3);
    } catch (e) {
      console.error(`[mscal] sync failed for user ${userId}: ${String(e).slice(0, 300)}`);
    } finally {
      inflight.delete(userId);
    }
  })();
}

// ------------------------------------------------------------------
// Delta reconciliation
// ------------------------------------------------------------------

/**
 * Reconcile removed/cancelled Outlook events against Atelier-booked
 * meeting rows: when the organizer deletes the meeting in Outlook, the
 * internal row soft-cancels too (system-attributed audit).
 */
async function reconcileInternalMeetings(args: {
  orgId: string;
  userId: string;
  removed: Array<{ msEventId: string; iCalUid: string | null }>;
  updated: Array<{ msEventId: string; iCalUid: string | null; startAt: Date; endAt: Date }>;
}): Promise<void> {
  const { orgId, userId } = args;
  if (args.removed.length === 0 && args.updated.length === 0) return;

  const keys = [...args.removed, ...args.updated];
  const eventIds = keys.map((k) => k.msEventId);
  const uids = keys.map((k) => k.iCalUid).filter((u): u is string => Boolean(u));
  const rows = await db
    .select()
    .from(atelierMeetings)
    .where(
      and(
        eq(atelierMeetings.orgId, orgId),
        isNull(atelierMeetings.deletedAt),
        uids.length > 0
          ? or(
              inArray(atelierMeetings.msEventId, eventIds),
              inArray(atelierMeetings.msEventUid, uids),
            )
          : inArray(atelierMeetings.msEventId, eventIds),
      ),
    );
  if (rows.length === 0) return;

  const removedSet = new Set(args.removed.map((r) => r.msEventId));
  const removedUids = new Set(
    args.removed.map((r) => r.iCalUid).filter((u): u is string => Boolean(u)),
  );

  for (const row of rows) {
    const matchedByOwnEvent = Boolean(row.msEventId && removedSet.has(row.msEventId));
    // iCalUId matches on ANY attendee's mailbox copy — only treat it as a
    // cancellation when the notification came from the ORGANIZER's mailbox
    // (an attendee declining/removing their copy must not cancel for all).
    const organizerMailbox = row.createdByUserId === userId;
    const matchedByUid = Boolean(
      row.msEventUid && removedUids.has(row.msEventUid) && organizerMailbox,
    );
    if (matchedByOwnEvent || matchedByUid) {
      if (matchedByOwnEvent && !organizerMailbox) continue;
      const now = new Date();
      await db
        .update(atelierMeetings)
        .set({ status: "cancelled", deletedAt: now, updatedAt: now })
        .where(eq(atelierMeetings.id, row.id));
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        orgId,
        entityType: "meeting",
        entityId: row.id,
        actorType: "system",
        actorId: userId,
        actorLabel: "Outlook sync",
        action: "meeting.cancelled",
        payload: {
          topic: row.title,
          msEventId: row.msEventId,
          source: "outlook-webhook",
        },
        payloadSummary: `Meeting "${row.title}" was cancelled in Outlook; Atelier record updated automatically.`,
      });
      continue;
    }
    // Rescheduled in Outlook by the organizer → mirror the new time.
    const upd = args.updated.find(
      (u) => row.msEventId && u.msEventId === row.msEventId,
    );
    if (upd && organizerMailbox && row.startAt && row.endAt) {
      const changed =
        row.startAt.getTime() !== upd.startAt.getTime() ||
        row.endAt.getTime() !== upd.endAt.getTime();
      if (!changed) continue;
      await db
        .update(atelierMeetings)
        .set({
          startAt: upd.startAt,
          endAt: upd.endAt,
          date: upd.startAt.toISOString().slice(0, 10),
          updatedAt: new Date(),
        })
        .where(eq(atelierMeetings.id, row.id));
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        orgId,
        entityType: "meeting",
        entityId: row.id,
        actorType: "system",
        actorId: userId,
        actorLabel: "Outlook sync",
        action: "meeting.rescheduled",
        payload: {
          topic: row.title,
          previousStart: row.startAt.toISOString(),
          previousEnd: row.endAt.toISOString(),
          start: upd.startAt.toISOString(),
          end: upd.endAt.toISOString(),
          source: "outlook-webhook",
        },
        payloadSummary: `Meeting "${row.title}" was moved in Outlook; Atelier record updated automatically.`,
      });
    }
  }
}

/** Refresh cached holiday-calendar rows (full-sync only, best-effort). */
async function refreshHolidayCache(args: {
  orgId: string;
  userId: string;
  accessToken: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<void> {
  try {
    const cals = await listCalendars(args.accessToken);
    const holidayCals = cals.filter((c) => /holiday|tatil/i.test(c.name ?? ""));
    const rows: (typeof atelierMsCalEvents.$inferInsert)[] = [];
    for (const cal of holidayCals.slice(0, 3)) {
      const events = await getCalendarViewForCalendar(
        args.accessToken,
        cal.id,
        args.windowStart.toISOString(),
        args.windowEnd.toISOString(),
      );
      for (const ev of events) {
        if (ev.isCancelled) continue;
        const startAt = eventTime(ev, "start");
        const endAt = eventTime(ev, "end");
        if (!startAt || !endAt) continue;
        rows.push({
          id: rid("mce"),
          orgId: args.orgId,
          userId: args.userId,
          msEventId: ev.id,
          iCalUid: ev.iCalUId ?? null,
          source: "holiday",
          holidayCalendarName: cal.name ?? null,
          startAt,
          endAt,
          payload: ev as unknown as Record<string, unknown>,
        });
      }
    }
    await db
      .delete(atelierMsCalEvents)
      .where(
        and(
          eq(atelierMsCalEvents.userId, args.userId),
          eq(atelierMsCalEvents.source, "holiday"),
        ),
      );
    if (rows.length > 0) await db.insert(atelierMsCalEvents).values(rows);
  } catch (e) {
    console.warn(`[mscal] holiday cache refresh failed (non-fatal): ${String(e).slice(0, 200)}`);
  }
}

/**
 * Run one delta sync round for a user. Full re-sync when there's no
 * usable delta token, the window needs rolling, or Graph returns 410.
 */
export async function runCalendarDeltaSync(
  userId: string,
  reason: string,
): Promise<{ ok: boolean; changed: number; full: boolean } | { ok: false; error: string }> {
  const conn = await loadConnectionByUser(userId);
  if (!conn) {
    // Connection gone — drop cache + subscription bookkeeping.
    await removeCalendarSubscription(userId);
    return { ok: false, error: "no-connection" };
  }

  const [state] = await db
    .select()
    .from(atelierMsCalSyncState)
    .where(
      and(
        eq(atelierMsCalSyncState.orgId, conn.orgId),
        eq(atelierMsCalSyncState.userId, userId),
      ),
    )
    .limit(1);

  const want = desiredWindow();
  const needsRoll =
    !state ||
    !state.deltaLink ||
    state.windowEnd.getTime() < want.end.getTime() - WINDOW_DRIFT_MS ||
    state.windowStart.getTime() > want.start.getTime() + WINDOW_DRIFT_MS;

  let accessToken: string;
  try {
    ({ accessToken } = await freshAccessToken(conn));
  } catch (e) {
    const detail = e instanceof MsAuthError ? e.code : String(e).slice(0, 200);
    console.error(`[mscal] token refresh failed for user ${userId}: ${detail}`);
    if (state) {
      await db
        .update(atelierMsCalSyncState)
        .set({ lastError: `token:${detail}`, updatedAt: new Date() })
        .where(eq(atelierMsCalSyncState.id, state.id));
    }
    return { ok: false, error: `token:${detail}` };
  }

  const runFull = async (): Promise<{ ok: true; changed: number; full: true }> => {
    const page = await getCalendarViewDelta(accessToken, {
      startIso: want.start.toISOString(),
      endIso: want.end.toISOString(),
    });
    const now = new Date();
    const rows: (typeof atelierMsCalEvents.$inferInsert)[] = [];
    for (const delta of page.events) {
      const ev = delta["@removed"] || delta.isCancelled
        ? delta
        : await completeDeltaEvent(accessToken, null, delta);
      if (ev["@removed"] || ev.isCancelled) continue;
      const startAt = eventTime(ev, "start");
      const endAt = eventTime(ev, "end");
      if (!startAt || !endAt) continue;
      rows.push({
        id: rid("mce"),
        orgId: conn.orgId,
        userId,
        msEventId: ev.id,
        iCalUid: ev.iCalUId ?? null,
        source: "calendar",
        startAt,
        endAt,
        payload: ev as unknown as Record<string, unknown>,
      });
    }
    await db
      .delete(atelierMsCalEvents)
      .where(
        and(
          eq(atelierMsCalEvents.userId, userId),
          eq(atelierMsCalEvents.source, "calendar"),
        ),
      );
    if (rows.length > 0) await db.insert(atelierMsCalEvents).values(rows);
    await refreshHolidayCache({
      orgId: conn.orgId,
      userId,
      accessToken,
      windowStart: want.start,
      windowEnd: want.end,
    });
    const stateValues = {
      deltaLink: page.deltaLink,
      windowStart: want.start,
      windowEnd: want.end,
      changedAt: now,
      lastSyncedAt: now,
      lastError: null,
      updatedAt: now,
    };
    if (state) {
      await db
        .update(atelierMsCalSyncState)
        .set(stateValues)
        .where(eq(atelierMsCalSyncState.id, state.id));
    } else {
      await db.insert(atelierMsCalSyncState).values({
        id: rid("mcss"),
        orgId: conn.orgId,
        userId,
        ...stateValues,
      });
    }
    console.log(`[mscal] full sync for user ${userId} (${reason}): ${rows.length} events cached`);
    return { ok: true, changed: rows.length, full: true };
  };

  try {
    if (needsRoll || !state?.deltaLink) {
      return await runFull();
    }

    // Incremental round.
    let page;
    try {
      page = await getCalendarViewDelta(accessToken, { deltaLink: state.deltaLink });
    } catch (e) {
      if (e instanceof MsGraphError && e.status === 410) {
        console.log(`[mscal] delta token invalidated for user ${userId} — full re-sync`);
        return await runFull();
      }
      throw e;
    }

    let changed = 0;
    const removed: Array<{ msEventId: string; iCalUid: string | null }> = [];
    const updated: Array<{ msEventId: string; iCalUid: string | null; startAt: Date; endAt: Date }> = [];

    for (const ev of page.events) {
      const isRemoval = Boolean(ev["@removed"]) || Boolean(ev.isCancelled);
      if (isRemoval) {
        // A cancelled single occurrence of a recurring series arrives as a
        // tombstone for that occurrence id only — the rest of the series
        // stays cached untouched.
        const [existing] = await db
          .select({ id: atelierMsCalEvents.id, iCalUid: atelierMsCalEvents.iCalUid })
          .from(atelierMsCalEvents)
          .where(
            and(
              eq(atelierMsCalEvents.userId, userId),
              eq(atelierMsCalEvents.msEventId, ev.id),
              eq(atelierMsCalEvents.source, "calendar"),
            ),
          )
          .limit(1);
        if (existing) {
          await db.delete(atelierMsCalEvents).where(eq(atelierMsCalEvents.id, existing.id));
          changed += 1;
        }
        removed.push({
          msEventId: ev.id,
          iCalUid: ev.iCalUId ?? existing?.iCalUid ?? null,
        });
        continue;
      }
      const [existing] = await db
        .select({ payload: atelierMsCalEvents.payload })
        .from(atelierMsCalEvents)
        .where(
          and(
            eq(atelierMsCalEvents.userId, userId),
            eq(atelierMsCalEvents.msEventId, ev.id),
            eq(atelierMsCalEvents.source, "calendar"),
          ),
        )
        .limit(1);
      const complete = await completeDeltaEvent(
        accessToken,
        (existing?.payload as unknown as MsCalendarEvent | undefined) ?? null,
        ev,
      );
      const startAt = eventTime(complete, "start");
      const endAt = eventTime(complete, "end");
      if (!startAt || !endAt) continue;
      // Outside the cached window (delta can emit series masters etc.) —
      // ignore, the live path covers out-of-window reads.
      if (endAt < state.windowStart || startAt > state.windowEnd) continue;
      const values = {
        iCalUid: complete.iCalUId ?? null,
        startAt,
        endAt,
        payload: complete as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      };
      const res = await db
        .update(atelierMsCalEvents)
        .set(values)
        .where(
          and(
            eq(atelierMsCalEvents.userId, userId),
            eq(atelierMsCalEvents.msEventId, ev.id),
            eq(atelierMsCalEvents.source, "calendar"),
          ),
        )
        .returning({ id: atelierMsCalEvents.id });
      if (res.length === 0) {
        await db.insert(atelierMsCalEvents).values({
          id: rid("mce"),
          orgId: conn.orgId,
          userId,
          msEventId: ev.id,
          source: "calendar",
          ...values,
        });
      }
      changed += 1;
      updated.push({ msEventId: ev.id, iCalUid: complete.iCalUId ?? null, startAt, endAt });
    }

    await reconcileInternalMeetings({ orgId: conn.orgId, userId, removed, updated });

    const now = new Date();
    await db
      .update(atelierMsCalSyncState)
      .set({
        deltaLink: page.deltaLink ?? state.deltaLink,
        lastSyncedAt: now,
        lastError: null,
        updatedAt: now,
        ...(changed > 0 ? { changedAt: now } : {}),
      })
      .where(eq(atelierMsCalSyncState.id, state.id));
    if (changed > 0) {
      console.log(`[mscal] delta sync for user ${userId} (${reason}): ${changed} change(s)`);
    }
    return { ok: true, changed, full: false };
  } catch (e) {
    const detail =
      e instanceof MsGraphError || e instanceof MsAuthError
        ? `${e.name}:${e.message}`.slice(0, 300)
        : String(e).slice(0, 300);
    console.error(`[mscal] sync error for user ${userId}: ${detail}`);
    if (state) {
      await db
        .update(atelierMsCalSyncState)
        .set({ lastError: detail, updatedAt: new Date() })
        .where(eq(atelierMsCalSyncState.id, state.id));
    }
    return { ok: false, error: detail };
  }
}

// ------------------------------------------------------------------
// Write-through for Atelier-originated changes
// ------------------------------------------------------------------

/**
 * Called after Atelier itself creates/reschedules/cancels a meeting or
 * OOF event. Bumps changedAt immediately (so pollers react) and queues a
 * delta sync per affected user so the cache converges without waiting for
 * the webhook round-trip. Fire-and-forget, never throws.
 */
export function noteLocalCalendarChange(userIds: Array<string | null | undefined>): void {
  const ids = [...new Set(userIds.filter((u): u is string => Boolean(u)))];
  if (ids.length === 0) return;
  void (async () => {
    try {
      await db
        .update(atelierMsCalSyncState)
        .set({ changedAt: new Date(), updatedAt: new Date() })
        .where(inArray(atelierMsCalSyncState.userId, ids));
    } catch (e) {
      console.warn(`[mscal] changedAt bump failed: ${String(e).slice(0, 200)}`);
    }
    // Give Graph a moment to settle the write before the delta round.
    setTimeout(() => {
      for (const id of ids) enqueueCalendarSync(id, "local-write");
    }, 1500);
  })();
}

// ------------------------------------------------------------------
// Read path
// ------------------------------------------------------------------

export interface CachedCalendar {
  events: MsCalendarEvent[];
  holidays: Array<{ event: MsCalendarEvent; calendarName: string | null }>;
  changedAt: Date;
}

/**
 * Serve a calendar window from the cache, or null when the cache can't
 * answer (window not covered, stale, no live subscription — e.g. dev).
 * Callers fall back to the live Graph fetch on null.
 */
export async function getCachedCalendar(
  userId: string,
  start: Date,
  end: Date,
): Promise<CachedCalendar | null> {
  const [state] = await db
    .select()
    .from(atelierMsCalSyncState)
    .where(eq(atelierMsCalSyncState.userId, userId))
    .limit(1);
  if (!state || !state.deltaLink || !state.lastSyncedAt) return null;
  if (start < state.windowStart || end > state.windowEnd) return null;
  if (Date.now() - state.lastSyncedAt.getTime() > CACHE_FRESH_MS) return null;
  // Without a live subscription the cache only updates on maintenance
  // ticks — not "within seconds" — so prefer the live path.
  const [sub] = await db
    .select({ expiresAt: atelierMsCalSubscriptions.expiresAt })
    .from(atelierMsCalSubscriptions)
    .where(eq(atelierMsCalSubscriptions.userId, userId))
    .limit(1);
  if (!sub || sub.expiresAt.getTime() < Date.now()) return null;

  const rows = await db
    .select()
    .from(atelierMsCalEvents)
    .where(
      and(
        eq(atelierMsCalEvents.userId, userId),
        lt(atelierMsCalEvents.startAt, end),
        sql`${atelierMsCalEvents.endAt} > ${start}`,
      ),
    );
  const events: MsCalendarEvent[] = [];
  const holidays: CachedCalendar["holidays"] = [];
  for (const r of rows) {
    const ev = r.payload as unknown as MsCalendarEvent;
    if (r.source === "holiday") {
      holidays.push({ event: ev, calendarName: r.holidayCalendarName });
    } else {
      events.push(ev);
    }
  }
  events.sort((a, b) => (a.start?.dateTime ?? "").localeCompare(b.start?.dateTime ?? ""));
  return { events, holidays, changedAt: state.changedAt };
}

/** The changed-since signal for mobile polling. Null when no sync state. */
export async function getCalendarChangedAt(userId: string): Promise<Date | null> {
  const [state] = await db
    .select({ changedAt: atelierMsCalSyncState.changedAt })
    .from(atelierMsCalSyncState)
    .where(eq(atelierMsCalSyncState.userId, userId))
    .limit(1);
  return state?.changedAt ?? null;
}

// ------------------------------------------------------------------
// Maintenance (scheduler job + boot)
// ------------------------------------------------------------------

/**
 * Hourly maintenance: ensure/renew subscriptions for every connection,
 * clean up orphans (subscription rows without a connection), roll cache
 * windows forward, and run a safety delta sync for stale caches.
 */
export async function runCalendarSubscriptionMaintenance(): Promise<void> {
  if (!msConfigured()) return;
  const conns = await db.select().from(atelierMsConnections);
  const connUserIds = new Set(conns.map((c) => c.userId));

  // Orphan cleanup: subscription/cache rows whose connection is gone.
  const subs = await db.select().from(atelierMsCalSubscriptions);
  for (const sub of subs) {
    if (!connUserIds.has(sub.userId)) {
      console.log(`[mscal] cleaning up orphan subscription for user ${sub.userId}`);
      await removeCalendarSubscription(sub.userId);
    }
  }

  for (const conn of conns) {
    const ensured = await ensureCalendarSubscription(conn);
    if (!ensured.ok && ensured.reason === "no-public-url") break; // dev — skip all
    // Safety sync: covers missed notifications + rolls the window forward.
    const [state] = await db
      .select({ lastSyncedAt: atelierMsCalSyncState.lastSyncedAt })
      .from(atelierMsCalSyncState)
      .where(eq(atelierMsCalSyncState.userId, conn.userId))
      .limit(1);
    const stale =
      !state?.lastSyncedAt ||
      Date.now() - state.lastSyncedAt.getTime() > 55 * 60 * 1000;
    if (ensured.ok && stale) enqueueCalendarSync(conn.userId, "maintenance");
  }
}
