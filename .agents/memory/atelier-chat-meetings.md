---
name: Chat meeting tools invariants
description: schedule/update client+internal meeting chat capabilities — contracts and probe fixtures
---

- `schedule_client_meeting` parents only on opportunity/engagement (`parentRef` "opportunity:<id>"/"engagement:<id>"); account-only refs disambiguate across the account's LIVE opps/engs and return honest `no_parent` when none. Client contact email is mandatory (real Outlook invite via sendInternalInvite from the requester's own MS account); availability is internal-side only — the preview/summary must say so.
- `update_internal_meeting` resolves removals against the CURRENT internalAttendees, refuses to empty the list (`invalid_input` — cancel instead), and non-organizers get `not_found` (never a leak). Graph update is organizer-token, local-only when msEventId is null.
- **Why:** invites are real; silent fallbacks (fake invites, wrong parents) would mislead clients.
- **How to apply:** any new chat meeting surface must keep the email-required + honest-error + two-phase-confirm contract; recurring meetings stay unsupported — the tool descriptions say so explicitly.
- Probe fixtures: direct `atelierOpportunities` inserts need slug/partnerOwnerId/engagementLeadId/dealSizeHypothesis/probabilityPct/nextMilestone/sourceLead; `atelierEngagements` need slug/opportunityId/plmStage/partnerOwnerId/engagementLeadId/startDate/plannedEndDate. Graph stub pattern: local http server + MS_LOGIN_BASE_URL/MS_GRAPH_BASE_URL + encryptToken'd connection row (see tests/crm/client-meeting-probe.ts).
- Mobile reminders: pure planner in atelier-mobile/lib/reminderPlan.ts (no expo imports, unit-testable); unmatched meetings plan with null account → `mtg.reminderBodyInternal` i18n key; notification data may omit accountId.
