---
name: Running the CRM test harness
description: How to actually run/verify artifacts/api-server tests/crm/run.ts in this environment
---
`pnpm --filter @workspace/api-server test:crm` (= `tsx ./tests/crm/run.ts`) is a
single-shot test that boots the app and exits.

**Isolation (2026-07-17):** the harness NEVER touches the live DB. Its first
import (`tests/crm/scratch-db.ts`) synchronously auto-provisions a `crm_test`
database on the same server, drizzle-pushes the schema + applies
atelier-rls.sql each run, and rewrites DATABASE_URL before @workspace/db loads.
TEST_DATABASE_URL is only an explicit override; there is no live-DB fallback.
The bootstrap now also runs a boot seed child (`scratch-db-boot-seed.ts`):
founder users + auth + reference seeds, so scripts anchored on
`p_mounir_ariss` work on the scratch DB.
**All standalone test scripts (me-*, pay-hub, esign, uat probes, cli-*,
crm probes, funnel, spine-backfill…) now import this same bootstrap as their
FIRST import (2026-07-17). Never reintroduce the old
`if (TEST_DATABASE_URL) … else live` prologue.** Scripts share the one
`crm_test` DB — do NOT run two suites concurrently (push-force clashes).
Known env-only failures on scratch: funnel 0027 audit-row check (push skips
numbered migrations) and 3 stale uat/probe-l1 checks (acc_dge / p_board_obs
fixtures don't exist anywhere anymore — pre-existing, fail on live too).
CRITICAL lesson: the bootstrap must stay **synchronous** (spawnSync child
processes for pg/push work) — top-level await in an ESM module does NOT block
sibling imports, so an async bootstrap lets @workspace/db bind the LIVE URL.

Gotchas observed:
- It takes **>120s** wall time. A large chunk is one REAL Anthropic "pursuit
  scout" call in the Opportunities group that aborts after ~45s when no API key
  is present (ATELIER_MOCK_AGENTS=1 does NOT mock that path here).
- **Best way to run it: `restart_workflow test-crm` (it is a registered
  one-shot workflow).** It runs to completion and the run summary shows the final
  `✓ CRM harness: all checks passed.` (or `✗ … N check(s) failed`). It does NOT
  get SIGKILLed — an earlier note that it can't run via restart_workflow is
  obsolete. After it finishes, the freshest output is in the **newest**
  `/tmp/logs/test-crm_*.log`; you must call `refresh_all_logs` to rotate a new
  file, otherwise you re-read the stale prior run's log.
- Running it **inline** via the bash tool (`pnpm … test:crm`) often exceeds the
  120s shell cap and gets killed mid-run, leaving a truncated log — prefer the
  workflow.
- Detached/`setsid` background runs also get reaped when the tool shell returns,
  so /tmp logs capture only the npm header.

**How to verify a specific group fast:** write a standalone probe under
`artifacts/api-server/tests/crm/` that imports `../../src/app.js`, does
`const server = app.listen(0)`, derives the port from `server.address()`, and
hits endpoints with `fetch` using `cookie: atelier_persona=<id>`. Reuse the
PERSONA ids (fp/sm/etc — see the harness fixture file for the ids), ACC=acc_tasama. This
skips the slow scout group and finishes in <60s. Delete the probe afterward.

**Why:** the new code mirrors the probe's logic, so a green probe == green group
in the real harness (which a proper CI env with an API key runs end to end).

**Probe auth gotcha:** persona cookie is only honored when `NODE_ENV=test` (or
a real auth session exists) — `attachPersona` otherwise 401s. Run probes as
`NODE_ENV=test pnpm exec tsx tests/crm/<probe>.ts`. Also: direct
`db.insert(atelierAccounts)` needs notNull `sector` and text `tier` ('A'–'D');
POST /opportunities zod body requires `description` (+ dealSizeUsd sensible).

Gotcha (2026-07-17): fresh isolated envs can hit ERR_MODULE_NOT_FOUND for `pg`
from tests/crm/scratch-db-admin.ts — api-server declares pg but the install can
be stale/unlinked; fix with `pnpm install --filter @workspace/api-server`.
