---
name: api-server reading sibling artifact assets
description: How the bundled api-server loads static files (e.g. logos) from sibling artifacts, and the atelier light-surface caveat.
---

# Loading a static asset into the bundled api-server

The api-server builds with esbuild to `artifacts/api-server/dist/index.mjs` and does
**not** copy static assets. To read a file at runtime (e.g. embed a PNG into a pdfkit
PDF), resolve it relative to the bundled output via `import.meta.url`:

```ts
new URL("../../atelier/public/<file>", import.meta.url)
```

From `dist/index.mjs`, `../../` climbs `dist` → `api-server` → `artifacts`, so a sibling
artifact's `public/` is reachable. This survives the esbuild bundle because the output
location is fixed. Wrap the read in try/catch and fall back gracefully.

**Why:** there is no asset-copy step in build.mjs, and inlining a ~650KB image as base64
into source is too heavy.

# Atelier light-surface caveat

Every atelier **frontend** surface uses the CSS-variable theme (`bg-bg`) which flips
navy↔off-white with the theme toggle; TopNav/PageHero are always-navy "dark islands".
So there is **no permanently-light frontend surface** for a navy-wordmark logo — the only
genuinely light atelier surfaces are the **server-generated documents** (board-pack PDF
in financeReportsRoutes.ts, proposal docs in proposal-docs.ts, both pdfkit).

**How to apply:** when asked to put a light/navy logo on an atelier "report" surface,
target the server-side PDF, not a frontend component (which would be invisible in dark mode).
