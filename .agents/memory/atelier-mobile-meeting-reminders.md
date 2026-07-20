---
name: Mobile meeting reminders
description: How atelier-mobile schedules pre-meeting brief notifications and deep-links taps
---
Reminders are device-local (expo-notifications), not server push: a headless component in the tabs layout re-syncs schedules from the shared GET /me/calendar query (7-day window, 15-min polling). Meetings created while the app is fully closed get no reminder until next open — that gap is by design until push infra exists.

**Why:** Expo Go can't do server push without token plumbing; local scheduling shipped first.

**How to apply:** Reminder identifiers are prefixed "mtgbrief-<meetingId>"; any sync must cancel stale prefixed ids or moved meetings double-fire. Notification taps route to /(tabs)/meetings with focusMeetingId/focusAccountId — meetings.tsx keys the row on these to auto-open the brief; keep params stable if refactoring. The opt-in pref (AsyncStorage, default OFF) lives in lib/meetingReminders.ts with a module listener store — reuse it, don't add a parallel pref.
