---
name: Perplexity connection runtime binding
description: Perplexity connector proxy 404s platform-side; research client now falls back to direct API with PERPLEXITY_API_KEY secret.
---
The Replit Perplexity connection reports status "added" via integration search, but at runtime `listConnections("perplexity")` returns null/[] and the `@replit/connectors-sdk` proxy 404s with "No perplexity connection found for this customer". Two re-authorization attempts (UI re-add + ProposeIntegration re-attach, 2026-07-27) did not fix it — persistent platform-side binding issue, not code.

**Resolution (2026-07-28):** the research client (`perplexity.ts`) now falls back automatically: stub base URL (tests) → connector proxy → direct `api.perplexity.ai` with the `PERPLEXITY_API_KEY` secret. A proxy 404 is treated as connector-not-bound only when its body matches "no perplexity connection" (real API 404s stay errors). Still fail-loud (`PerplexityConnectionError`) when neither the connector nor the secret works. Verified live: fallback returns answers + citations.

**How to apply:** live Perplexity research works as long as the `PERPLEXITY_API_KEY` secret is set — no need to escalate the connector binding. If the connector binding is ever fixed platform-side, the proxy path takes precedence automatically. `ATELIER_RESEARCH_PROVIDER=anthropic` remains the env-selectable alternate mode; test suites pin it (scratch-db.ts, alliance run.ts) so they stay offline.
