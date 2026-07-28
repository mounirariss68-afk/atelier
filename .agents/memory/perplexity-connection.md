---
name: Perplexity direct API only
description: Connector proxy removed; research client is direct api.perplexity.ai via PERPLEXITY_API_KEY, with per-query timeout and one 429/5xx retry.
---

The Replit Perplexity connector proxy 404'd platform-side ("No perplexity connection found") since ~2026-07, so the connector path was deleted entirely (2026-07-28). The research client now has exactly two transports:
- `ATELIER_PERPLEXITY_BASE_URL` → offline stub (tests).
- Direct `https://api.perplexity.ai` with the `PERPLEXITY_API_KEY` secret; missing/blank key fails loudly with an actionable typed error.

**Why:** connector was broken platform-side for weeks; direct API verified working and key is present in prod secrets.

**How to apply:** never reintroduce `@replit/connectors-sdk` (dropped from api-server deps/lockfile). Resilience lives in the client: per-query timeout (`ATELIER_PERPLEXITY_TIMEOUT_MS`, default 60s, surfaces as PerplexityConnectionError) and exactly one short-backoff retry on 429/5xx (`ATELIER_PERPLEXITY_RETRY_BACKOFF_MS`). Probe: perplexity-research-probe.ts covers stub, error-body, missing-key, timeout, 429-retry.
