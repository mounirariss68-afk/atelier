---
name: Mobile meetings day view
description: Design/contract decisions for the mobile Meetings tab day view and detail sheet
---

- Day view renders meetings as cards (all-day on top, time-ordered, overlap left-border marker, red "now" divider on today) — the old hour-grid timeline was deliberately removed. Don't reintroduce a pixel-per-hour layout.
- Meeting detail sheet: internal meetings with `canManage` get reschedule/cancel using raw `apiJson` against `PATCH/DELETE /api/atelier/me/calendar/internal/:id` — these routes are `@cli-skip` and intentionally NOT in openapi/codegen. Outlook meetings are view-only with a "managed in Outlook" note.
- Day swipe uses a Pan gesture with `activeOffsetX ±24` / `failOffsetY ±16` and RTL-flipped direction; the pinned toggle+DayNavigator lives outside the ScrollView.

**Why:** hour grid was unreadable on phones; lifecycle routes stay bespoke so chat/CLI can't trigger Graph writes.

**How to apply:** any new mobile surface touching internal-meeting lifecycle must reuse these raw routes (never add them to openapi casually). If mobile typecheck reports missing generated props (e.g. `internal`, `canManage`), rebuild `lib/api-zod` + `lib/api-client-react` dist with `tsc -b ... --force` before chasing phantom errors.
