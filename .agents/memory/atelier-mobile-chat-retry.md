---
name: Mobile chat retry policy
description: Auto-retry rules for the mobile chat SSE turn stream and why confirm is excluded
---

The mobile chat stream helper auto-retries transient failures (HTTP 502/503/504, or network errors before any SSE frame arrived) with short backoff.

**Why:** the dev API server rebuilds ~10s on every restart/merge, so the Replit proxy returns 502s users saw as raw "HTTP 502" cards; retrying `/cli/turn` is safe because the server dedupes on sessionId+clientTurnKey.

**How to apply:** never retry after the first SSE frame is processed, and never auto-retry `/cli/turn/:id/confirm` (it performs writes and its idempotency is not contract-tested). Any new chat-adjacent endpoint must opt into retry only if it has an equivalent dedupe key. Transient final failures surface as errorKind:"network" → localized "Couldn't reach the server" copy, not the raw status.
