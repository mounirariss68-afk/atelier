// Pure reminder-planning logic split out of meetingReminders.ts so it can
// be unit-tested under Node (no expo imports here — keep it that way).
//
// Task #568 — internal meetings (no CRM account match) now get reminders
// too: they plan with accountId/accountName null and the caller renders
// the internal reminder body instead of the account one.

export const REMINDER_LEAD_MINUTES = 15;
export const REMINDER_ID_PREFIX = "mtgbrief-";

export interface PlannableMeeting {
  id: string;
  subject?: string | null;
  start: string;
  isAllDay?: boolean;
  joinUrl?: string | null;
  matches: Array<{ accountId: string; accountName: string }>;
}

export interface PlannedReminder {
  identifier: string;
  meetingId: string;
  subject: string | null;
  fireAtMs: number;
  /** null for purely internal meetings (no CRM match). */
  accountId: string | null;
  accountName: string | null;
  joinUrl: string | null;
}

/**
 * One reminder per upcoming timed meeting, lead-time minutes before
 * start. CRM-matched meetings carry their first matched account;
 * internal (unmatched) meetings plan with a null account.
 */
export function planReminders(
  meetings: PlannableMeeting[],
  nowMs: number,
  leadMinutes: number = REMINDER_LEAD_MINUTES,
): Map<string, PlannedReminder> {
  const wanted = new Map<string, PlannedReminder>();
  for (const m of meetings) {
    if (m.isAllDay) continue;
    const start = new Date(m.start).getTime();
    if (Number.isNaN(start)) continue;
    const fireAtMs = start - leadMinutes * 60_000;
    if (fireAtMs <= nowMs) continue;
    const first = m.matches.length > 0 ? m.matches[0] : null;
    wanted.set(`${REMINDER_ID_PREFIX}${m.id}`, {
      identifier: `${REMINDER_ID_PREFIX}${m.id}`,
      meetingId: m.id,
      subject: m.subject ?? null,
      fireAtMs,
      accountId: first?.accountId ?? null,
      accountName: first?.accountName ?? null,
      joinUrl: m.joinUrl ?? null,
    });
  }
  return wanted;
}
