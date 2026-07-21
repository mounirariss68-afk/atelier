---
name: Chat timesheet tools
description: Invariants for chat's timesheet write/read tools (identity resolution, week keying, totals)
---

# Chat timesheet tool invariants

- `timesheet_entry_create` / `timesheet_entry_update` (coverage-capabilities) must NEVER trust model-supplied weekId/personId/personType. They resolve the caller's roster person server-side via `resolvePersonForCaller` (ledgerRoutes) — employee by `user_id` link, contractor by email — and get-or-create the ISO week via `ensureWeekShell` + `isoWeekOf`.
- **Why:** the original tool inserted literal `"undefined"` strings from the model and reported "Write success" while the read tool showed "No timesheet".
- After any entry write, call `recomputeWeekTotals(weekId)` or week totals drift.
- `timesheet_current` targets the ACTUAL current ISO week (`weekIso` equality), not the latest week row, and returns the week's entries.
- **How to apply:** any new chat surface that writes timesheet rows must reuse `resolveTimesheetCaller` in coverage-capabilities; typed submit/approve flows stay on the /ledger routes.
- Test fixtures that seed a "current" timesheet week must compute `weekIso` dynamically with `isoWeekOf(new Date())` — hardcoded week labels (e.g. "2026-W29") go stale and break `timesheet_current` assertions (cli-me probe was fixed this way).
- Regression probe: `pnpm --dir artifacts/api-server test:cli-timesheet` (scratch-DB, deterministic).
