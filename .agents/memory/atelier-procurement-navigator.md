---
name: Procurement Navigator invariants
description: Vendor-registration research agent + account Procurement section — routing, review policy, backfill repeatability
---
- Jurisdiction routing is DETERMINISTIC (keyword/country match in the query builder), never left to the LLM prompt — that's what guarantees Etimad/DPP/eSupply/ADERP/Monaqasat retrieval hits the right official portal.
- Propose-then-approve everywhere: run output stays on the agent-run row; only the /approve route writes `accounts.procurement.guide`. Manual `status`/`statusNotes` (PATCH, audited) must survive approve — merge, never overwrite.
- "Undecided draft" is derived from agent.approved/dismissed audit events keyed on runId (same pattern as Strategy Developer) — there is no decision column.
- Fail-loud guard: a guide without narrative+steps+≥1 http source throws inside the runner, so junk runs land as `failed`, never as drafts.
- Backfill (`scripts/t722-procurement-backfill.ts`) is idempotent (skips approved guides + pending drafts) and leaves results pending review. Task-branch DB data doesn't merge — re-run on main and again for prod.
- Account page tabs are deep-linkable via `?tab=` since this task (used for headless screenshots too).

**Why:** research quality for GCC gov portals was a hard acceptance criterion; prompt-only routing was judged regression-prone (see cartographer-entity-scope precedent).
**How to apply:** any new research surface for accounts should reuse buildProcurementQueries-style deterministic routing + the audit-event decision pattern.
