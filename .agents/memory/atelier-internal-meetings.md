---
name: Atelier internal meeting scheduling
description: Invariants for standalone internal meetings booked via MS Graph (chat scheduling assistant)
---

- Internal meetings are rows in the meetings table with `parentType="internal"`, `parentId="internal"`; visibility = creator, listed `internalAttendees`, or founding partner. `canSeeInternalMeeting` in people-read-capabilities is the shared predicate.
- `/me/calendar` merges Atelier-booked internal meetings even when MS365 is NOT connected/configured — web `MyMeetingsCard` and mobile meetings tab must therefore fetch once the connection status loads, never gate `enabled` on `connected`.
- Dedupe between Graph calendarView and internal rows uses **iCalUId** (`msEventUid` column) — Graph event `id`s are per-mailbox and useless for cross-mailbox matching. The meeting autologger also skips internal iCalUIds.
- Dubai time is fixed UTC+4 (no DST) — all wall-clock math is plain offset arithmetic in `msScheduling.ts`; working hours 08:00–18:00; slot search on a 15-min grid (`findEarliestCommonSlot` is pure — probe it without Graph).
- Invites are sent from the ORGANIZER's own calendar via `createCalendarEvent` (Teams link when online). `sendInternalInvite` throws `SchedulingError` codes: `not-connected`, `missing-scope` (token predates Calendars.ReadWrite → prompt reconnect), `reconnect-required`, `graph-failed`. Invite send happens BEFORE the DB insert — no orphan rows on Graph failure.
- Chat tool `schedule_internal_meeting`: roles exclude employee/contractor/pfr; two-phase confirm; explicit time is honored even outside working hours (only auto-search is clamped).

**Why:** availability reads other colleagues' calendars only if THEY connected; the visibility split and iCalUId dedupe prevent duplicate rows when the invite lands back in the viewer's Outlook.
