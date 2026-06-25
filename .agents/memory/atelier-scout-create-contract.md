---
name: Pursuit Scout create-path contract
description: Why POST /opportunities returns a structured scout outcome instead of rolling back or swallowing failures.
---

On `POST /opportunities`, the opportunity row + audit are committed BEFORE the Pursuit Scout runs. So a failed/empty Scout run must NOT roll back creation, but must also NOT be swallowed behind a bare 201.

**Rule:** the 201 response carries an explicit `scout: { status: "completed"|"empty"|"failed"|"skipped", error? }`. `skipped`=runScout:false; `failed`=run threw (error surfaced); `empty`=run returned a structurally-valid-but-blank brief (NOT persisted); `completed`=usable brief persisted. Empty-detection is the shared exported `isScoutBriefEmpty()` in `atelier-agents/runner.ts` — reuse it at every Scout persistence entrypoint, don't re-implement the narrative check.

**Why:** an empty soft-refusal brief persisted as the "brief of record" looks like real research to the partner; and a clean 201 on a failed scout hides data-quality loss. Partial-success is the correct contract because the write is already durable.

**How to apply:** if you add another Scout persistence path (e.g. the `/scout` rerun), gate persistence with `isScoutBriefEmpty` and consider surfacing `empty` there too. The create response shape is codegen'd — `scout` lives in `lib/api-spec/openapi.yaml` (AtelierCreateOpportunityResponse); change the spec + run `pnpm --filter @workspace/api-spec run codegen`, never hand-edit generated types. (Optional later: normalize `scout.error` to a stable taxonomy rather than the raw thrown message.)
