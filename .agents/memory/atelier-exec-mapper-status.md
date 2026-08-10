---
name: Executive Mapper shared status
description: How Executive Mapper run status is surfaced and why the chain module owns the launch registry
---

The Executive Mapper's in-process launch registry lives in the chain module (`getExecutiveMapperLaunch`), NOT in the route: the "running" entry is registered **synchronously** (before the first await) inside `runExecutiveMapperAndQueue`.

**Why:** the run row is inserted late, so a route-owned registry left auto-runs (account creation, post-Cartographer chain, chat dispatch) invisible — the workspace read "idle" during the pre-row window and the UI never followed the run. A completion review rejected exactly this.

**How to apply:** any new Executive Mapper entry point just calls `runExecutiveMapperAndQueue` and gets shared status for free — never re-create per-route launch bookkeeping. The account page reads ONE source (`account.executiveMapperStatus` on the workspace, polled at 4s while running); the Map executives button is stateless over that status (no per-mount pollers — they raced across remounts and doubled toasts/buttons). Settle toast comes from the page-level transition watcher. An "already-running" rejection must not clobber the real run's launch entry (delete the provisional entry instead of writing "failed").
