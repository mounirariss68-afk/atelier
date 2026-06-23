---
name: lib/db schema change → rebuild for consumers
description: Why api-server typecheck doesn't see new Drizzle columns until lib/db is rebuilt
---

After editing a Drizzle table in `lib/db/src/schema/*.ts`, consumers like
`@workspace/api-server` will NOT see the new column on `tsc --noEmit` and you
get errors like `'<col>' does not exist in type '{...}'` on `.set({...})`.

**Why:** `lib/db/tsconfig.json` is `composite` + `emitDeclarationOnly` →
consumers resolve `@workspace/db` types through the prebuilt `lib/db/dist/**.d.ts`
(via TS project references), not the live source. The per-package `typecheck`
script is `tsc -p tsconfig.json --noEmit` (no `-b`), so it never rebuilds the
referenced project; the `.d.ts` stays stale.

**How to apply:** after any schema edit, rebuild the declarations before
typechecking consumers:
`pnpm exec tsc -b lib/db/tsconfig.json --force`
Then run `pnpm --filter @workspace/db push` to sync the dev DB. The `.d.ts`
should now contain the new column (grep it to confirm).

**Committed migration file is REQUIRED, not optional:** `db push` only syncs your
dev DB. The repo ALSO maintains hand-written SQL migrations in
`lib/db/drizzle/00NN_<name>.sql` (numbered, topic-prefixed e.g.
`0043_atelier_account_firmographics.sql`) and these are the deploy-safe record —
code review WILL reject a schema change that ships without one. Match the existing
style: idempotent `ALTER TABLE "<t>" ADD COLUMN IF NOT EXISTS "<c>" <type>;`, one
line per column, a header comment, nullable/defaulted so existing rows need no
backfill. Note `meta/_journal.json` + `meta/*_snapshot.json` are STALE (journal
stops ~0011/0023 while SQL files go past 0040) — devs add the SQL file by hand and
do NOT run `drizzle-kit generate`; do the same. `post-merge.sh` applies schema via
`pnpm --filter db push` (not the migrations), but the SQL file must still be
committed. Verify it applies with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <file>`.
