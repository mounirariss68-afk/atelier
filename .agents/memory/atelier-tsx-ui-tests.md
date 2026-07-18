---
name: Atelier tsx UI tests of page modules
description: Running renderToStaticMarkup tests of atelier page components under tsx (no vitest)
---
Rule: atelier UI tests run via `tsx` (no vitest). When a test imports a big page module (e.g. pages/Account.tsx):
- use `tsx --tsconfig tsconfig.test.json` (jsx: react-jsx) — the artifact's `jsx:"preserve"` makes tsx use the classic transform and pages don't import React;
- any MODULE-LEVEL `import.meta.env.BASE_URL` in the transitive graph crashes under Node — guard as `import.meta.env?.BASE_URL ?? "/"` (identical under Vite). Function-body usages are fine.

**Why:** Node's import.meta has no `env`; esbuild/tsx doesn't inject Vite's define.
**How to apply:** new tests importing page modules → reuse the `test:board-layer` script pattern; if a new page adds a top-level BASE_URL const, guard it.

- SSR render probes of pages using wouter hooks: wrap in `<Router ssrPath="/x">` — `memoryLocation().hook` lacks getServerSnapshot and browser location is undefined under Node.
