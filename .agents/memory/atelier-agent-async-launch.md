---
name: Atelier async agent launches
description: Start-then-poll contract for long-running account agent routes (Executive Mapper, Cartographer refresh)
---

Long-running agent routes must never hold the HTTP request open (proxy 502s after ~1–2 min). Pattern in accountRoutes.ts:

- In-memory `agentLaunches` Map keyed by `launchKey(agentId, accountId)` tracks running/failed launches; it bridges the gap between route return and the DB run row landing (and the queue write landing AFTER the run row completes — in-memory "running" wins over a complete row).
- Routes return immediately: exec-mapper run → 202 `{started:true}`; cartographer refresh → 200 current workspace with `cartographerStatus:"running"`. Duplicate start while running → 409.
- Status source of truth for reload recovery: bespoke GET `/accounts/:id/executive-mapper/status` (raw-fetch, @cli-skip, not in OpenAPI); cartographer uses the existing workspace `cartographerStatus` polling.
- runner.ts failRun writes status "error" (NOT "failed") with the message in `statusMessage` — status readers must treat both as failed.

**Why:** synchronous runs 502'd via the Replit proxy; rollback to sync would reintroduce it.
**How to apply:** any new agent-triggering route gets the same launch-entry + background IIFE + poll contract. E2E pattern: tests/crm/exec-mapper-async-probe.ts (stub Anthropic with mutable fail/delay flags; workspace GET is `/accounts/:id`, no `/workspace` suffix).
