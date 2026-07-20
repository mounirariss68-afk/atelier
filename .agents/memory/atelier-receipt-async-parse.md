---
name: Atelier async receipt parse pipeline
description: Conventions for the auto receipt→expense parse pipeline (mobile + portal)
---
- Async parse routes (`/me/expenses/:id/parse-receipt-async` + `/parse-receipt-status`) are raw-fetch, NOT in openapi, with an in-memory launch map keyed by expense id.
- **Rule:** any in-memory launch map needs a stale-running watchdog (running > 10 min → reported failed + relaunchable), or a wedged LLM job permanently blocks retries for that record.
- Mobile draft flow: attach auto-creates a server draft (`draftId`); re-attach PATCHes receiptPath (never a second create). Offline + existing draft must NOT enqueue a create (dupes) — show honest offline toast instead; offline enqueue path is only for `!draftId`.
- Parsed values deliberately overwrite typed values; surfaced via the "auto-filled — review" banner (?parsed=1 on mobile detail).
- Parse error codes worth specific UX: receipt-too-large, receipt-unreadable, auditor-refused.
