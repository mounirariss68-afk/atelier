---
name: Running the CRM test harness
description: How to actually run/verify artifacts/api-server tests/crm/run.ts in this environment
---
`pnpm --filter @workspace/api-server test:crm` (= `tsx ./tests/crm/run.ts`) is a
single-shot test that boots the app and exits.

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
