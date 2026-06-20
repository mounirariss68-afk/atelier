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
