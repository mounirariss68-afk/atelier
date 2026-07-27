---
name: Perplexity connection runtime binding
description: Perplexity connector shows "added" in integrations but the runtime proxy 404s — live research blocked, fail-loud path covers it.
---
The Replit Perplexity connection reports status "added" via integration search, but at runtime `listConnections("perplexity")` returns `[]` and the `@replit/connectors-sdk` proxy 404s with "No perplexity connection found for this customer" (verified from shell, sandbox, and inside a workflow env; re-add reports connectionAlreadyAdded).

**Why:** platform-side binding issue, not code — the research layer (`perplexity.ts`) throws `PerplexityConnectionError` loudly by design, and `ATELIER_RESEARCH_PROVIDER=anthropic` is the env-selectable comparison mode.

**How to apply:** before any live Perplexity smoke test, verify `listConnections("perplexity")` returns a row; if empty, don't burn cycles retrying — the user must re-authorize the connector from the integrations UI. Test suites pin `ATELIER_RESEARCH_PROVIDER=anthropic` (scratch-db.ts, alliance run.ts) so they never hit this.
