/**
 * Task #570 — reliability helpers shared by the chat scheduling tools.
 *
 * - isPastSlot: pure past-time rejection (small grace window so a
 *   preview confirmed a minute later isn't spuriously rejected).
 * - findMatchingBookedMeeting: idempotent confirm-replay + duplicate-
 *   booking detection. One query: live scheduled meetings in the org at
 *   the exact same start instant.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, atelierMeetings } from "@workspace/db";
import { foldRosterName } from "./chat-normalizers.js";

/** Grace so "confirm" a moment after the slot started isn't rejected. */
export const PAST_SLOT_GRACE_MS = 2 * 60 * 1000;

/** Pure — true when the proposed start is in the past (beyond grace). */
export function isPastSlot(start: Date, now: Date = new Date()): boolean {
  return start.getTime() < now.getTime() - PAST_SLOT_GRACE_MS;
}

export interface SameSlotMeeting {
  id: string;
  title: string;
  parentType: string;
  createdByUserId: string | null;
  internalAttendees: Array<{ userId?: string; name?: string; email?: string | null }> | null;
  joinUrl: string | null;
  startAt: Date | null;
  endAt: Date | null;
  locationType: string | null;
}

/** Live (scheduled, not deleted/cancelled) meetings at exactly `startAt`. */
export async function findSameSlotMeetings(
  orgId: string,
  startAt: Date,
): Promise<SameSlotMeeting[]> {
  return db
    .select({
      id: atelierMeetings.id,
      title: atelierMeetings.title,
      parentType: atelierMeetings.parentType,
      createdByUserId: atelierMeetings.createdByUserId,
      internalAttendees: atelierMeetings.internalAttendees,
      joinUrl: atelierMeetings.joinUrl,
      startAt: atelierMeetings.startAt,
      endAt: atelierMeetings.endAt,
      locationType: atelierMeetings.locationType,
    })
    .from(atelierMeetings)
    .where(
      and(
        eq(atelierMeetings.orgId, orgId),
        eq(atelierMeetings.startAt, startAt),
        isNull(atelierMeetings.deletedAt),
        ne(atelierMeetings.status, "cancelled"),
      ),
    )
    .limit(25);
}

/**
 * Confirm-replay idempotency: a meeting with the SAME organizer, same
 * (accent-folded) title, and same exact start already exists — a second
 * "confirm" (double-tap, retried request) must NOT book a second Outlook
 * event. Returns the existing row to answer with.
 */
export function pickReplayMatch(
  rows: SameSlotMeeting[],
  args: { createdByUserId: string; title: string; parentType: string },
): SameSlotMeeting | null {
  const t = foldRosterName(args.title);
  return (
    rows.find(
      (r) =>
        r.createdByUserId === args.createdByUserId &&
        r.parentType === args.parentType &&
        foldRosterName(r.title) === t,
    ) ?? null
  );
}

/**
 * Duplicate-booking preview warning: some OTHER live meeting sits at the
 * same instant with the same folded title or an identical roster
 * attendee set. Never blocks — the summary just warns.
 */
export function buildDuplicateWarning(
  rows: SameSlotMeeting[],
  args: { title: string; attendeeUserIds: string[] },
): string {
  const t = foldRosterName(args.title);
  const wanted = [...new Set(args.attendeeUserIds)].sort().join("|");
  const dup = rows.find((r) => {
    if (foldRosterName(r.title) === t) return true;
    const have = [
      ...new Set((r.internalAttendees ?? []).map((a) => a.userId).filter(Boolean) as string[]),
    ]
      .sort()
      .join("|");
    return wanted.length > 0 && have === wanted;
  });
  return dup
    ? ` Heads-up: "${dup.title}" is already booked at that exact time — this may be a duplicate.`
    : "";
}
