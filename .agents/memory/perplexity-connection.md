---
name: Perplexity connection runtime binding
description: Perplexity connector shows "added" in integrations but the runtime proxy 404s — live research blocked, fail-loud path covers it.
---
The Replit Perplexity connection reports status "added" via integration search (connection ID `conn_perplexity_01KYCMSBCFNB9QYEQ771GVA4J1`), but at runtime `listConnections("perplexity")` returns `[]` and the `@replit/connectors-sdk` proxy 404s with "No perplexity connection found for this customer".

Verified from: shell, CodeExecution sandbox, AND from within a dedicated workflow (proper repl session context). All three return 404.

Two re-authorization attempts were made (2026-07-27): once via the user removing/re-adding from the Integrations pane, and once via `ProposeIntegration` re-attach — neither resolved the runtime binding.

**Why:** persistent Replit platform-side binding issue, not code. The research layer (`perplexity.ts`) throws `PerplexityConnectionError` loudly by design, and `ATELIER_RESEARCH_PROVIDER=anthropic` is the env-selectable fallback mode.

**How to apply:** before any live Perplexity smoke test, verify `listConnections("perplexity")` returns a row; if empty, escalate to Replit support — re-adding from the UI and re-attaching via ProposeIntegration have both been tried and didn't fix it. Test suites pin `ATELIER_RESEARCH_PROVIDER=anthropic` (scratch-db.ts, alliance run.ts) so they never hit this path.
