---
name: Publish slot is Atelier
description: This project's single deployment publishes the Atelier portal at root; the marketing site lives elsewhere.
---

**Rule:** This workspace's one publish slot belongs to the Atelier portal (custom domain atelier.cognirise.ai). Atelier serves at root path `/` (dev + prod), api-server at `/api`; the launch marketing site was moved to `/launch/` in dev and its `[services.production]` block was deliberately removed.

**Why:** cognirise.ai (marketing site) is already published from a separate copy of the project. One Replit project = one deployment, so re-adding a production block to launch (or any demo artifact) would ship it on the Atelier domain.

**How to apply:** When configuring deployment or adding artifacts, only atelier + api-server get `[services.production]`. Atelier's vite config requires BOTH `PORT` and `BASE_PATH` env at build time (provided by `[services.env]`). Health check target: `/api/healthz`. Production is autoscale (static SPA + API process coexist fine). Portal auth is still the demo persona cookie — publish visibility should be password/private until real auth exists. Production DB must be schema-pushed + seeded after first publish.
