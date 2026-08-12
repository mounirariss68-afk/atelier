---
name: Durable background-job registry
description: atelier_background_jobs replaces per-feature in-memory launch maps; invariants for adding new background work.
---

All long async agent launches (POV draft/revise, receipt parse, pricing research, alliance cartographer/mapper, merchant enrichment) record in the `atelier_background_jobs` table via `artifacts/api-server/src/lib/background-jobs.ts` — the old in-memory launch maps are gone.

**Rules for any new background work:**
- Start via `startBackgroundJob` — it returns **null when it lost the atomic-start race**: a partial unique index (`status='running'` on org+kind+targetId) is the real duplicate guard, the read-then-check is just a friendly pre-check. Handle null with the same 409/202 as the pre-check.
- Stale-running watchdogs must call `reapStaleRunningJob` before relaunching, or the running-unique index blocks the new insert forever.
- `completeBackgroundJob`/`failBackgroundJob` only transition rows still `running` — zombie promises can't resurrect boot-swept rows. Pass `notifyTitle` to drop a self-notification card (`selfnotif_bgjob_<id>`, onConflictDoNothing = at-most-once, pushes ride the insert's returning()).
- Boot sweep (in the async boot chores) fails only rows created **before process boot** — jobs started while the sweep was queued are safe. Multi-instance deployments would sweep each other's live jobs; acceptable because jobs are in-process anyway.
- Pass `me.orgId` into `getLatestJob`/`hasRunningJob`/`getJobById` at route call sites (foreign ids read as not-found).
- "Latest row per (kind,targetId)" is the authoritative status for feature poll endpoints; each endpoint reconstructs its legacy wire shape from the job row.

**Web indicator:** `BackgroundWorkBell` in the shell title bar polls raw-fetch `GET /me/background-jobs` (own jobs + still-running agent runs as pseudo-jobs); hidden for alliance partners (server-locked out of /me/*). Deep links use `?tab=` on Opportunity (honored in the activeTab initializer). Toast fires on running→terminal transition + broad query invalidation.

**Why:** users clicked "generate draft" twice because nothing showed progress; in-memory maps also lost all state on restart, leaving UIs spinning forever.
