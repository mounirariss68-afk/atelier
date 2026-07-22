---
name: Atelier leave OOO & holidays
description: Invariants — auto Outlook OOF on approved leave, revoke/shorten, away-strip contract, curated holidays
---

- Revoke and shorten share one route: POST /roster/leave-requests/:id/revoke with optional `{newEndDate}`; shorten requires startDate<=newEndDate<endDate and keeps status "approved"; full revoke sets "cancelled". Second revoke → 409 not-approved.
- **Why:** one code path clears/patches the Outlook OOF event + auto-reply consistently; new leave-mutation surfaces must go through it, not flip status directly.
- /roster/on-leave-today is leadership-gated (partner tier); employee/contractor get 403 — UI strips hide on ANY error (web + mobile) by design. It accepts `?date=YYYY-MM-DD` (default today UTC+4) and returns PARTNER-TIER leave-takers only (join leave.userId→users.role), each with `initials` and `returnDate` (nextWorkingDayAfter of endDate by person country).
- OOF event + auto-reply windows schedule in the leave-taker's own timezone via `timezoneFor(country)` in atelierHolidays.ts (Asia/Dubai fallback) — don't hardcode Asia/Dubai in new Graph scheduling code.
- Calendar rows carry `kind: "ooo"|"holiday"` but the orval AtelierCalendarMeeting type lacks it — clients use a `(m as {kind?:string}).kind` cast helper (meetingKind) in both web and mobile.
- Holiday data is a curated in-code TR/MENA dataset (lib/atelierHolidays.ts) with `tentative` for lunar dates; /me/holidays?start&end; Outlook holiday-calendar merge matches calendar name /holiday|tatil/i, caps 3, non-fatal. Banners show viewer-country chips up-front and collapse other markets behind an expand toggle.
- Graph OOF needs MailboxSettings.ReadWrite; msconnection exposes `mailboxSettingsGranted` and the web ConnectedAccountsCard shows a reconnect prompt when false.
- Mobile "Away" strip is pinned outside the scroll content (above the tab bar) and follows the selected day in day view.
- **How to apply:** verify with scripts/t602-leave-ooo-probe.ts (self-cleaning, NODE_ENV=test persona bypass).
