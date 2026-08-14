---
name: Finance autopilot policy & approvals inbox
description: Auto-post policy engine authority, unified approvals inbox contract, scheduled-vs-manual agent run locking
---

- The auto-post policy engine is the ONLY authorization for skipping human review of finance postings. Never-auto actions per the blueprint matrix (payment runs, vendor bank changes, client invoice issue, dunning send, period close, statutory filed, payroll, journal reversal, recon finalise) can never return auto. New automated paths must consult the engine — never inline thresholds.
- **Why:** the blueprint's approval matrix (docs/finance-autonomy-blueprint.md §4) is the single taxonomy, and a review round caught the engine wired as annotation-only. An engine without production call sites at the real posting boundaries delivers nothing — verify a caller actually passes real confidences and the result drives the state transition.
- Thresholds are founder-editable settings read-with-defaults (no seeded row), PATCH partner-tier only, audited.
- Unified approvals inbox is aggregation-only: one shared loader used by REST and chat, deep-linking to existing action endpoints — never fork action logic. Partner-only items are shown to finance viewers as non-actionable, not hidden. Payment-run signing stays web-only (deep-link).
- Chat parity for approvals: extract route handlers into shared core functions called by both; typed-name values must be what the copy names (invoice number / period label), never opaque ids.
- Scheduled + manual agent runs must share ONE durable lock with a stable per-agent key (not per-date target — a date-keyed target stops blocking once the target rolls). A scheduler-only lock does not prevent manual-route races.
- Reverse-and-repost is the only correction path for posted journals: one transaction, reversal + repost linked, blocked in locked periods.
