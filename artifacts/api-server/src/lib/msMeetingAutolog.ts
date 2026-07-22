/**
 * Task #336 — Auto-log ended Microsoft 365 meetings as CRM activity entries.
 *
 * For every user with a Microsoft 365 connection, the job looks back over a
 * recent window of the user's calendar, finds meetings that have ENDED and
 * whose attendees match CRM contacts the user is allowed to see (same
 * matching + canSeeAccount filter as GET /me/calendar), and creates one
 * "meeting" activity per matched account.
 *
 * Dedupe ledger: atelier_ms_meeting_logs holds one row per
 * (user, event, account). Once a row exists the meeting is never logged
 * again — including after the employee removes the entry (the ledger row
 * flips to status="removed" and stays).
 *
 * The activity body always carries the meeting metadata; when the
 * Anthropic AI integration is configured, a short AI recap is prepended
 * (fail-soft — a summary failure never blocks the metadata log).
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierMeetings,
  atelierMsConnections,
  atelierMsMeetingLogs,
  atelierActivities,
  atelierContacts,
  atelierAccounts,
  atelierAuditEvents,
} from "@workspace/db";
import {
  MsAuthError,
  decryptToken,
  encryptToken,
  getCalendarView,
  msConfigured,
  refreshTokens,
  type MsCalendarEvent,
} from "./msGraph.js";
import { canSeeAccount } from "../routes/atelier/accountRoutes.js";
import { accessibleEngagementIds } from "../routes/atelier/engagementRoutes.js";
import { assertAuditAction } from "../routes/atelier/auditContract";
import { logger } from "./logger";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const LOOKBACK_HOURS = Number(process.env.MS_AUTOLOG_LOOKBACK_HOURS || 24);

interface MatchedContact {
  contactId: string;
  contactName: string;
  accountId: string;
}

export interface AutologResult {
  connectionsScanned: number;
  meetingsExamined: number;
  entriesCreated: number;
  errors: number;
}

/** Optional AI recap of the meeting metadata. Fail-soft: null on any issue. */
async function aiSummary(args: {
  subject: string;
  start: Date;
  end: Date;
  accountName: string;
  contactNames: string[];
  attendeeCount: number;
  location: string | null;
}): Promise<string | null> {
  const baseURL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (!baseURL || !apiKey) return null;
  try {
    const anth = new Anthropic({ baseURL, apiKey });
    const mins = Math.max(1, Math.round((args.end.getTime() - args.start.getTime()) / 60000));
    const resp = await anth.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      system:
        "You write one-sentence CRM notes for a boutique consulting firm. " +
        "Given meeting metadata (you have NO transcript), write a single crisp " +
        "sentence a partner would find useful in the account timeline: what the " +
        "meeting was, with whom, and how long. Plain text only, no preamble.",
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            subject: args.subject,
            client: args.accountName,
            clientContacts: args.contactNames,
            durationMinutes: mins,
            attendeeCount: args.attendeeCount,
            location: args.location,
            endedAt: args.end.toISOString(),
          }),
        },
      ],
    });
    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    return text || null;
  } catch (err) {
    logger.warn({ err }, "[ms-autolog] AI summary failed; logging metadata only");
    return null;
  }
}

function metadataBody(args: {
  start: Date;
  end: Date;
  location: string | null;
  contactNames: string[];
  attendeeCount: number;
  organizerEmail: string | null;
}): string {
  const mins = Math.max(1, Math.round((args.end.getTime() - args.start.getTime()) / 60000));
  const lines = [
    `When: ${args.start.toISOString()} → ${args.end.toISOString()} (${mins} min)`,
    `Client contacts: ${args.contactNames.join(", ") || "—"}`,
    `Attendees: ${args.attendeeCount}`,
  ];
  if (args.location) lines.push(`Location: ${args.location}`);
  if (args.organizerEmail) lines.push(`Organizer: ${args.organizerEmail}`);
  lines.push("Auto-logged from Microsoft 365.");
  return lines.join("\n");
}

/**
 * Run the auto-log for every connection (cron) or a single user (manual
 * "check now" from the Me lens).
 */
export async function runMsMeetingAutolog(opts?: {
  userId?: string;
}): Promise<AutologResult> {
  const result: AutologResult = {
    connectionsScanned: 0,
    meetingsExamined: 0,
    entriesCreated: 0,
    errors: 0,
  };
  if (!msConfigured()) return result;

  const where = opts?.userId
    ? eq(atelierMsConnections.userId, opts.userId)
    : undefined;
  const connections = where
    ? await db.select().from(atelierMsConnections).where(where)
    : await db.select().from(atelierMsConnections);

  for (const conn of connections) {
    result.connectionsScanned += 1;
    try {
      const created = await autologForConnection(conn, result);
      result.entriesCreated += created;
    } catch (err) {
      result.errors += 1;
      const detail = err instanceof MsAuthError ? err.code : "autolog-failed";
      logger.error({ err, userId: conn.userId }, "[ms-autolog] connection scan failed");
      await db
        .update(atelierMsConnections)
        .set({ lastError: detail, updatedAt: new Date() })
        .where(eq(atelierMsConnections.id, conn.id));
    }
  }
  return result;
}

async function autologForConnection(
  conn: typeof atelierMsConnections.$inferSelect,
  result: AutologResult,
): Promise<number> {
  const [me] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, conn.userId));
  if (!me) return 0;

  const now = new Date();
  const windowStart = new Date(now.getTime() - LOOKBACK_HOURS * 3600 * 1000);

  // Fresh access token; persist refresh-token rotation.
  const tokens = await refreshTokens(decryptToken(conn.encRefreshToken));
  if (tokens.refreshToken) {
    await db
      .update(atelierMsConnections)
      .set({
        encRefreshToken: encryptToken(tokens.refreshToken),
        updatedAt: new Date(),
      })
      .where(eq(atelierMsConnections.id, conn.id));
  }
  const events = await getCalendarView(
    tokens.accessToken,
    windowStart.toISOString(),
    now.toISOString(),
  );

  // Task #553 — never auto-log Atelier-booked internal meetings. Their
  // Graph copies (in every attendee's mailbox) share the iCalUId stored
  // on the internal meeting row.
  const internalUids = new Set(
    (
      await db
        .select({ uid: atelierMeetings.msEventUid })
        .from(atelierMeetings)
        .where(
          and(
            eq(atelierMeetings.orgId, me.orgId),
            eq(atelierMeetings.parentType, "internal"),
          ),
        )
    )
      .map((r) => r.uid)
      .filter((u): u is string => Boolean(u)),
  );

  // Ended, real meetings only.
  const ended: Array<MsCalendarEvent & { startAt: Date; endAt: Date }> = [];
  for (const ev of events) {
    if (ev.isCancelled || ev.isAllDay) continue;
    if (ev.iCalUId && internalUids.has(ev.iCalUId)) continue;
    if (!ev.start?.dateTime || !ev.end?.dateTime) continue;
    const startAt = new Date(`${ev.start.dateTime}${ev.start.dateTime.endsWith("Z") ? "" : "Z"}`);
    const endAt = new Date(`${ev.end.dateTime}${ev.end.dateTime.endsWith("Z") ? "" : "Z"}`);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) continue;
    if (endAt > now) continue; // still running / upcoming
    ended.push(Object.assign(ev, { startAt, endAt }));
  }
  result.meetingsExamined += ended.length;
  if (ended.length === 0) {
    await db
      .update(atelierMsConnections)
      .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(atelierMsConnections.id, conn.id));
    return 0;
  }

  // Same matching pipeline as GET /me/calendar: attendee email → contact →
  // account, filtered through canSeeAccount for THIS user.
  const attendeeEmails = new Set<string>();
  for (const ev of ended) {
    for (const a of ev.attendees ?? []) {
      const addr = a.emailAddress?.address?.toLowerCase();
      if (addr && addr !== conn.msEmail) attendeeEmails.add(addr);
    }
    const org = ev.organizer?.emailAddress?.address?.toLowerCase();
    if (org && org !== conn.msEmail) attendeeEmails.add(org);
  }

  const contactByEmail = new Map<string, MatchedContact>();
  const accountName = new Map<string, string>();
  if (attendeeEmails.size > 0) {
    const contacts = await db
      .select({
        id: atelierContacts.id,
        fullName: atelierContacts.fullName,
        email: atelierContacts.email,
        accountId: atelierContacts.accountId,
      })
      .from(atelierContacts)
      .where(
        and(eq(atelierContacts.orgId, me.orgId), isNull(atelierContacts.deletedAt)),
      );
    const wanted = contacts.filter(
      (c) => c.email && attendeeEmails.has(c.email.trim().toLowerCase()),
    );
    const accIds = [...new Set(wanted.map((c) => c.accountId))];
    if (accIds.length > 0) {
      const access = await accessibleEngagementIds(me);
      const visible = new Set<string>();
      for (const id of accIds) {
        if (await canSeeAccount(access, me, id)) visible.add(id);
      }
      if (visible.size > 0) {
        const accounts = await db
          .select({ id: atelierAccounts.id, name: atelierAccounts.name })
          .from(atelierAccounts)
          .where(
            and(
              eq(atelierAccounts.orgId, me.orgId),
              inArray(atelierAccounts.id, [...visible]),
              isNull(atelierAccounts.deletedAt),
            ),
          );
        for (const a of accounts) accountName.set(a.id, a.name);
        for (const c of wanted) {
          if (!accountName.has(c.accountId)) continue;
          contactByEmail.set(c.email!.trim().toLowerCase(), {
            contactId: c.id,
            contactName: c.fullName,
            accountId: c.accountId,
          });
        }
      }
    }
  }

  if (contactByEmail.size === 0) {
    await db
      .update(atelierMsConnections)
      .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(atelierMsConnections.id, conn.id));
    return 0;
  }

  // Existing ledger rows for this user's events (any status — a removed
  // entry must never come back).
  const eventIds = ended.map((ev) => ev.id);
  const ledger = await db
    .select({
      msEventId: atelierMsMeetingLogs.msEventId,
      accountId: atelierMsMeetingLogs.accountId,
    })
    .from(atelierMsMeetingLogs)
    .where(
      and(
        eq(atelierMsMeetingLogs.orgId, me.orgId),
        eq(atelierMsMeetingLogs.userId, me.id),
        inArray(atelierMsMeetingLogs.msEventId, eventIds),
      ),
    );
  const already = new Set(ledger.map((l) => `${l.msEventId}::${l.accountId}`));

  let created = 0;
  for (const ev of ended) {
    // Group this event's matches per account.
    const perAccount = new Map<string, MatchedContact[]>();
    const seen = new Set<string>();
    const candidateEmails = [
      ...(ev.attendees ?? []).map((a) => a.emailAddress?.address?.toLowerCase() ?? ""),
      ev.organizer?.emailAddress?.address?.toLowerCase() ?? "",
    ];
    for (const email of candidateEmails) {
      const m = email ? contactByEmail.get(email) : undefined;
      if (!m || seen.has(m.contactId)) continue;
      seen.add(m.contactId);
      const list = perAccount.get(m.accountId) ?? [];
      list.push(m);
      perAccount.set(m.accountId, list);
    }

    for (const [accId, matches] of perAccount) {
      if (already.has(`${ev.id}::${accId}`)) continue;
      const subject = ev.subject ?? "(no subject)";
      const contactNames = matches.map((m) => m.contactName);
      const accName = accountName.get(accId) ?? "";
      const attendeeCount = (ev.attendees ?? []).length;
      const location = ev.location?.displayName ?? null;

      const summary = await aiSummary({
        subject,
        start: ev.startAt,
        end: ev.endAt,
        accountName: accName,
        contactNames,
        attendeeCount,
        location,
      });
      const meta = metadataBody({
        start: ev.startAt,
        end: ev.endAt,
        location,
        contactNames,
        attendeeCount,
        organizerEmail: ev.organizer?.emailAddress?.address?.toLowerCase() ?? null,
      });
      const body = summary ? `${summary}\n\n${meta}` : meta;

      const activityId = rid("act");
      const logId = rid("mml");
      const nowTs = new Date();
      await db.insert(atelierActivities).values({
        id: activityId,
        orgId: me.orgId,
        accountId: accId,
        parentType: "account",
        parentId: accId,
        type: "meeting",
        title: `Meeting: ${subject}`,
        body,
        ownerId: me.id,
        status: "done",
        completedAt: ev.endAt,
        createdByUserId: me.id,
      });
      await db.insert(atelierMsMeetingLogs).values({
        id: logId,
        orgId: me.orgId,
        userId: me.id,
        msEventId: ev.id,
        accountId: accId,
        activityId,
        subject,
        meetingStart: ev.startAt,
        meetingEnd: ev.endAt,
        matchedContacts: matches.map((m) => ({
          contactId: m.contactId,
          contactName: m.contactName,
        })),
        summarySource: summary ? "ai" : "metadata",
        status: "logged",
      });
      assertAuditAction("ms.meeting.autologged");
      await db.insert(atelierAuditEvents).values({
        id: rid("aud"),
        orgId: me.orgId,
        entityType: "activity",
        entityId: activityId,
        actorType: "agent",
        actorId: "ms-meeting-autolog",
        actorLabel: "Microsoft 365 meeting auto-log",
        action: "ms.meeting.autologged",
        payload: {
          msEventId: ev.id,
          accountId: accId,
          userId: me.id,
          subject,
          summarySource: summary ? "ai" : "metadata",
        },
        payloadSummary: `Auto-logged "${subject}" for ${accName} from ${me.name}'s calendar`,
      });
      already.add(`${ev.id}::${accId}`);
      created += 1;
      logger.info(
        { userId: me.id, accountId: accId, msEventId: ev.id, nowTs: nowTs.toISOString() },
        "[ms-autolog] activity created",
      );
    }
  }

  await db
    .update(atelierMsConnections)
    .set({ lastSyncedAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(atelierMsConnections.id, conn.id));
  return created;
}
