---
name: Stale lib dist fails typecheck/review
description: Rebuild gitignored lib dists before markTaskComplete or review typechecks blame you for other tasks' code
---

Rule: before calling markTaskComplete, rebuild the gitignored generated dists:
`npx tsc -b lib/db/tsconfig.json lib/api-zod/tsconfig.json lib/api-client-react/tsconfig.json --force`.

**Why:** package `typecheck` scripts are `tsc -p --noEmit` and resolve types from
committed-src-but-gitignored `dist/`. When another task merges (e.g. new openapi
fields), your environment's dist lags, and the completion code review's typecheck
fails on THAT task's code — rejecting yours.

**How to apply:** if a completion review cites type errors in files you never
touched (missing properties that DO exist in `lib/api-zod/src/generated`), it is
stale dist — rebuild and re-mark complete with `request_fresh_code_review: true`.

Also: reviewer requests for "a DB migration file" are usually inapplicable — this
project is push-based (drizzle push / Publish diff), no numbered migrations.
