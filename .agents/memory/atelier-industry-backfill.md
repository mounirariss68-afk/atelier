---
name: Industry backfill is a rerunnable data pass
description: One-off governed industry backfill script; DB data doesn't merge so it must be re-run on main and prod.
---
`artifacts/api-server/scripts/t701-industry-backfill.ts` runs the governed one-time pass: targets ACTIVE accounts whose `industry_code` is null OR not a valid Cognirise taxonomy code (pre-fix rows held raw NAICS like "54"/"23"/"22" — not null), triggers `POST /accounts/:id/cartographer/refresh`, waits on `atelier_agent_runs`, then approves ONLY the `industry` proposal as founding partner via the decision route. Other proposals stay pending for normal review.

**Why:** never a silent bulk write — every value lands through the proposal applier and is audited as a partner approval.

**How to apply:** task-agent DB data never merges — run it on main after merge, and on prod before go-live (multi-minute live LLM runs: use a temp console workflow, not nohup). Idempotent: accounts with a valid taxonomy code are skipped.
