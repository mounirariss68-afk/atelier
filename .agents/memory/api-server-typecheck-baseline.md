---
name: api-server / atelier typecheck baseline is dirty
description: tsc -b on these packages reports many pre-existing errors; how to tell yours apart.
---

`tsc -b` on `@workspace/api-server` and `@workspace/atelier` reports MANY pre-existing type errors at HEAD, so a non-empty result is NOT evidence your change broke something.

**Why:** these never block runtime — the api-server ships via esbuild bundle (`build.mjs`, no typecheck) and the frontend via Vite; `tsc -b` is not in the build hot path, so the baseline has been allowed to drift.

**How to apply:** to attribute an error to your edit, grep the tsc output for your own filenames and/or `git diff HEAD -- <file>` to confirm the offending lines are yours. Do not try to fix the baseline errors — out of scope. Also: `tsc -b --noEmit` fails with TS6310 ("referenced project may not disable emit") — use plain `tsc -b`.

**Corollary — a clean esbuild build does NOT prove your imports resolve.** Because `build.mjs` never typechecks, using a symbol you forgot to import (e.g. `sql` from `drizzle-orm`) compiles fine and only throws at RUNTIME (`sql is not a function` → a generic 500 with no useful stack in the pino logs). If a route 500s right after you added new code and the build was green, first check that every helper you used is actually imported at the top of the file.
