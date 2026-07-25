---
name: Statutory filing register actions
description: How statutory filing done/overdue tracking works in the comply register
---
- "Overdue" is derived at READ time in the comply list route (unfiled + dueOn < today), never persisted — no batch job flips statuses. New consumers of the statutory register must not trust the stored `status` blob for overdue.
- Mark filed / reopen go through the dedicated audited route `POST /finance/comply/statutory/:id/mark-filed` (body `{reopen:true}` to undo), which stamps filedOn/filedByUserId/filedByName into the jsonb and writes an `atelier_audit_events` row. Don't use the generic PATCH for filing-status flips — it isn't audited.
- The payroll overview endpoint is what materializes the filing calendar rows (ensureStatutoryFilings); any UI fetching the statutory register on the payroll page must gate on the overview query having settled, or it races the backfill and renders empty.

**Why:** first headless verification showed an empty filings section despite rows existing — the register fetch beat the overview backfill.
**How to apply:** any new surface listing or mutating statutory filings.
