/**
 * Task #559 — reschedule / cancel of standalone internal meetings booked
 * via the Atelier (Task #553).
 *
 * One shared implementation used by BOTH the REST routes
 * (PATCH/DELETE /me/calendar/internal/:id) and the chat capabilities, so
 * the Graph call, the Atelier row update, and the audit entry can never
 * drift between surfaces.
 *
 * Authorization: the ORGANIZER (createdByUserId) of a meeting, or a
 * founding partner. The Outlook event lives on the organizer's calendar,
 * so Graph writes always use the organizer's own delegated token — even
 * when a founding partner performs the action.
 *
 * Graph-first ordering: the Outlook update/cancellation is attempted
 * BEFORE the Atelier row changes. If Graph fails, nothing changes locally
 * and the caller gets an explicit error — the row and the mailbox are
 * never silently out of sync. Meetings whose organizer never had a Graph
 * event (msEventId null) update locally only.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, atelierMeetings, atelierAuditEvents } from "@workspace/db";
import {
  SchedulingError,
  cancelInternalInvite,
  fmtDubai,
  updateInternalInvite,
} from "./msScheduling.js";

export type InternalMeetingRow = typeof atelierMeetings.$inferSelect;

export interface MeetingActor {
  id: string;
  orgId: string;
  name: string;
  role: string;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class MeetingLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "forbidden"
      | "already_cancelled"
      | "invalid_input",
  ) {
    super(message);
    this.name = "MeetingLifecycleError";
  }
}

/** Load an internal meeting the actor is allowed to manage (organizer or
 *  founding partner), org-scoped. Throws MeetingLifecycleError. */
export async function loadManagedInternalMeeting(
  actor: MeetingActor,
  meetingId: string,
): Promise<InternalMeetingRow> {
  const [row] = await db
    .select()
    .from(atelierMeetings)
    .where(
      and(
        eq(atelierMeetings.id, meetingId),
        eq(atelierMeetings.orgId, actor.orgId),
        eq(atelierMeetings.parentType, "internal"),
        isNull(atelierMeetings.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new MeetingLifecycleError("Internal meeting not found.", "not_found");
  }
  if (row.status === "cancelled") {
    throw new MeetingLifecycleError(
      "This meeting has already been cancelled.",
      "already_cancelled",
    );
  }
  if (!canManageInternalMeeting(actor, row)) {
    throw new MeetingLifecycleError(
      "Only the person who booked this meeting (or a founding partner) can change it.",
      "forbidden",
    );
  }
  return row;
}

export function canManageInternalMeeting(
  actor: Pick<MeetingActor, "id" | "role">,
  m: Pick<InternalMeetingRow, "createdByUserId">,
): boolean {
  return actor.role === "founding_partner" || m.createdByUserId === actor.id;
}

async function auditMeeting(args: {
  actor: MeetingActor;
  meetingId: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    orgId: args.actor.orgId,
    entityType: "meeting",
    entityId: args.meetingId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

/**
 * Reschedule: Graph PATCH on the organizer's event (attendees get a
 * standard Outlook update), then update the Atelier row + audit.
 * Throws SchedulingError (Graph/connection problems) or
 * MeetingLifecycleError (auth/state problems).
 */
export async function rescheduleInternalMeeting(args: {
  actor: MeetingActor;
  meetingId: string;
  start: Date;
  end: Date;
  via: "rest" | "cli";
  turnId?: string;
}): Promise<{ meeting: InternalMeetingRow; graphUpdated: boolean }> {
  const row = await loadManagedInternalMeeting(args.actor, args.meetingId);
  if (!(args.end > args.start)) {
    throw new MeetingLifecycleError("End must be after start.", "invalid_input");
  }
  const organizerId = row.createdByUserId;
  let graphUpdated = false;
  if (row.msEventId && organizerId) {
    await updateInternalInvite({
      organizerUserId: organizerId,
      actingUserId: args.actor.id,
      msEventId: row.msEventId,
      start: args.start,
      end: args.end,
    });
    graphUpdated = true;
  }
  const prevStart = row.startAt?.toISOString() ?? null;
  const prevEnd = row.endAt?.toISOString() ?? null;
  await db
    .update(atelierMeetings)
    .set({
      startAt: args.start,
      endAt: args.end,
      date: fmtDubai(args.start).slice(0, 10),
      updatedAt: new Date(),
    })
    .where(eq(atelierMeetings.id, row.id));
  const whenLabel = `${fmtDubai(args.start)}–${fmtDubai(args.end).slice(-5)} (Dubai)`;
  await auditMeeting({
    actor: args.actor,
    meetingId: row.id,
    action: "meeting.rescheduled",
    payload: {
      topic: row.title,
      previousStart: prevStart,
      previousEnd: prevEnd,
      start: args.start.toISOString(),
      end: args.end.toISOString(),
      msEventId: row.msEventId,
      graphUpdated,
      via: args.via,
      ...(args.turnId ? { turnId: args.turnId } : {}),
    },
    summary: `${args.actor.name} rescheduled internal meeting "${row.title}" to ${whenLabel}.`,
  });
  const [fresh] = await db
    .select()
    .from(atelierMeetings)
    .where(eq(atelierMeetings.id, row.id))
    .limit(1);
  return { meeting: fresh ?? row, graphUpdated };
}

/**
 * Cancel: Graph DELETE on the organizer's event (attendees get a standard
 * Outlook cancellation), then soft-cancel the Atelier row + audit.
 */
export async function cancelInternalMeeting(args: {
  actor: MeetingActor;
  meetingId: string;
  via: "rest" | "cli";
  turnId?: string;
}): Promise<{ meeting: InternalMeetingRow; graphCancelled: boolean }> {
  const row = await loadManagedInternalMeeting(args.actor, args.meetingId);
  const organizerId = row.createdByUserId;
  let graphCancelled = false;
  if (row.msEventId && organizerId) {
    await cancelInternalInvite({
      organizerUserId: organizerId,
      actingUserId: args.actor.id,
      msEventId: row.msEventId,
    });
    graphCancelled = true;
  }
  const now = new Date();
  await db
    .update(atelierMeetings)
    .set({ status: "cancelled", deletedAt: now, updatedAt: now })
    .where(eq(atelierMeetings.id, row.id));
  await auditMeeting({
    actor: args.actor,
    meetingId: row.id,
    action: "meeting.cancelled",
    payload: {
      topic: row.title,
      start: row.startAt?.toISOString() ?? null,
      end: row.endAt?.toISOString() ?? null,
      msEventId: row.msEventId,
      graphCancelled,
      via: args.via,
      ...(args.turnId ? { turnId: args.turnId } : {}),
    },
    summary: `${args.actor.name} cancelled internal meeting "${row.title}".`,
  });
  return { meeting: row, graphCancelled };
}

export { SchedulingError };
