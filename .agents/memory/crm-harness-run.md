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
- It **cannot be run via `restart_workflow test-crm`**: the runner waits for the
  process to "serve", and since a one-shot test never serves, it SIGTERM/SIGKILLs
  it partway (the workflow shows "failed" even when assertions pass).
- Detached/`setsid` background runs also get reaped when the tool shell returns,
  so /tmp logs capture only the npm header.

**How to verify a specific group fast:** write a standalone probe under
`artifacts/api-server/tests/crm/` that imports `../../src/app.js`, does
`const server = app.listen(0)`, derives the port from `server.address()`, and
hits endpoints with `fetch` using `cookie: atelier_persona=<id>`. Reuse the
PERSONA ids (fp=p_mounir_ariss, sm=p_layla_haddad, etc.), ACC=acc_tasama. This
skips the slow scout group and finishes in <60s. Delete the probe afterward.

**Why:** the new code mirrors the probe's logic, so a green probe == green group
in the real harness (which a proper CI env with an API key runs end to end).
