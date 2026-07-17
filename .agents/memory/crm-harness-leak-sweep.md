---
name: CRM harness tag-sweep cleanup
description: Why the harness ends with a __t542 pattern sweep and why the harness must never be a workflow
---

Rule: the CRM harness's `finally` cleanup ends with a pattern sweep deleting every row whose name/id/payload carries the `__t542` tag (audit_events, agent_runs, timesheet_entries, engagements, opportunities, contacts, accounts). Keep it — do not revert to tracked-ID-only cleanup.

**Why:** tracked-ID cleanup leaked 2 engagements per run (the untracked `eng_arch_${STAMP}` archive fixture and the server-auto-created "— delivery" engagement from the won-stage hook), and any SIGKILL skips `finally` entirely. The tag is exclusively test data, so a pattern delete is safe; it also self-heals prior leaks.

**How to apply:** any new fixture the harness creates (directly or via server hooks) must carry the `__t542` tag in its name so the sweep catches it. Never register `test:crm` as a Replit workflow — workflows that don't serve a port are SIGKILLed mid-run, which is exactly what orphans rows; run it via bash only. The run-button "Project" group once pointed at the test-crm workflow (that group + workflow were removed 2026-07-17); don't re-add.
