---
name: Win/loss synthesis handlers stay on global db
description: Why win/loss run/approve/override use global db instead of withRls, and how Atelier RLS connection defaults work
---

# Win/loss synthesis/approval handlers intentionally use the global `db`, not `withRls`

In `winLossRoutes.ts`, the read/edit endpoints (`GET win-loss`, `PATCH .../seller`,
`POST .../transcript`) run inside `withRls(req, tx => ...)`. The synthesis/approval
handlers (`run`, `approve`, `override`, overdue-scan) deliberately load the opp/debrief
via the global `db` instead.

**Why:** `withRls` opens a single Drizzle transaction and holds that DB connection for
the whole callback. `run`/`override` invoke a long-running LLM agent
(`runWinLossInterviewer`) mid-handler — wrapping those in `withRls` would pin a pool
connection for the entire model call. Org isolation is still enforced because the pg
pool's connection-level default binds `app.org_id = 'aico'` (see `rls.ts`
`registerAtelierRlsDefaults`) and the RLS policies themselves filter by org. `withRls`
only *narrows* per-request (user/role/engagement GUCs); it is not the only thing
enforcing org isolation.

**How to apply:** Task #540's spec scoped win/loss hardening to *read/edit* endpoints
only (defense-in-depth), explicitly leaving synthesis/approval on the connection-default
path. If a future task makes this truly multi-org (more than the single `aico` tenant),
add a cheap `opp.orgId !== me.orgId → 404` guard on the opp loads in run/approve/override
rather than wrapping the whole handler in `withRls`.
