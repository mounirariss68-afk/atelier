---
name: Outlook calendar webhook cache
description: Invariants of the Graph webhook + delta-sync rolling calendar cache and its changed-since poll
---

# Outlook calendar webhook cache (real-time sync)

- Cache = per-user rolling window (7d back / 31d ahead) in `atelier_ms_cal_events`, sync state (deltaLink/changedAt/lastSyncedAt) in `atelier_ms_cal_sync_state`, one Graph subscription per user in `atelier_ms_cal_subscriptions`.
- **Read path degrades, never breaks**: `getCachedCalendar` returns null (→ live Graph pull) unless deltaLink exists, window covered, lastSyncedAt < 6h, AND a live subscription row exists. Dev/preview has no public webhook URL (needs `MS_WEBHOOK_PUBLIC_URL` or REPLIT_DEPLOYMENT) so dev is always live-pull.
- **Why:** Graph can't reach dev previews; a stale cache silently serving old meetings is worse than a slower live read.
- Webhook route is PUBLIC (mounted before the auth gate) but clientState-gated; always answers 202 (non-2xx makes Graph retry junk). Validation handshake echoes `validationToken` as text/plain.
- Sync is per-user single-flight with a rerun flag (bursts collapse); org-side writes call `noteLocalCalendarChange(userIds)` — bumps changedAt immediately + enqueues a delayed sync. Any NEW surface that writes to Outlook (invites, OOF events) must call it for organizer AND roster attendees.
- `msCalendarSync` ↔ `msScheduling` import each other — safe only because all cross-references stay inside function bodies; don't add module-init-time usage.
- Mobile freshness = cheap `GET /me/calendar/changed` poll (raw fetch, not in openapi) that invalidates every `/api/atelier/me/calendar` react-query key on change.
- Delta event payloads are sparse: omitted fields mean unchanged and must merge into the cached payload; explicit null/false/empty values are updates. Recurring subjects resolve per occurrence from Graph, then its series master, but rows are always reconciled by event id (never by shared iCalUId).
- **Why:** Replacing a cached payload with a partial delta erases subjects and display fields; applying an occurrence change by series identity corrupts sibling occurrences.
- **How to apply:** Any new delta consumer must preserve omitted fields and scope updates/deletes to the Graph event id. Cached and live reads must use the same series-subject fallback.
- **How to test:** `tests/crm/ms-webhook-probe.ts` — full Graph stub incl. `/subscriptions` + delta pages (`$deltatoken` in URL = incremental, `startDateTime` = full); run `NODE_ENV=test pnpm exec tsx tests/crm/ms-webhook-probe.ts`.
- Pre-existing cli-catalog failures (raw opp delete in client-meeting-probe, `request_leave` catalog leak) are NOT calendar-related.
