---
name: Derived-cache writes inside shared jsonb blobs
description: How the prep-card talking points cache lives inside researchBrief without clobbering concurrent rewrites
---

The prep card's watch-out talking points are cached under `researchBrief.watchOutTalkingPoints` (key = sha256 of the distilled watch-out list). Cartographer rewrites of the whole blob implicitly invalidate the cache.

**Rule:** never write a derived cache into a shared jsonb blob by re-saving a read snapshot — a slow LLM call in between lets the stale snapshot clobber a concurrent rewrite. Patch only your own key atomically (`jsonb_set(col, '{cacheKey}', payload::jsonb)` guarded on `col IS NOT NULL`); a mismatched key just regenerates next read.

**How to apply:** any card/read-path that caches LLM output inside an account/entity jsonb column (and any future surface reusing `getWatchOutTalkingPoints`). Generation is fail-soft: errors return {} and the surface renders without guidance. Prep card byline is always "Prepared by Riser" — never the requesting user; no third-party logo guessing (client logo only via explicit `clientLogoUrl`, https/data:image).
