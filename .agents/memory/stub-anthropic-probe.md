---
name: Deterministic agent-route tests via stub Anthropic server
description: How to test Atelier routes that trigger LLM agent runs without live model calls
---
The agent runner has NO mock mode by design (fails hard without AI_INTEGRATIONS_ANTHROPIC_* env). To test routes that run agents (e.g. POST /opportunities/:id/scout) deterministically:

- Boot a local `node:http` server returning a canned Anthropic messages response (`content:[{type:"text",text:JSON.stringify(output)}]`, plus `usage`).
- Set `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`/`_API_KEY` to it BEFORE importing the app — the anthropic client reads env at import time.
- Also set `NODE_ENV=test` before app import or the persona-cookie bypass is off and every request 401s.
- Canned scout output must pass `isScoutBriefEmpty` (some narrative text) or persist is skipped and the envelope fields vanish.
- Agents that use the web-search path (Cartographer, Executive Mapper) go through `anthropic.messages.stream` — the stub must answer requests containing `"stream":true` with an SSE body (message_start → content_block_delta with the JSON → message_delta end_turn → message_stop), or the run fails with "request ended without sending any chunks". See the exec-mapper-chain probe for a working SSE stub.

**Why:** live scout runs are ~45s and flaky (prose/refusals); contract tests must be deterministic.
**How to apply:** reference implementation is the brief-envelope contract probe under the api-server crm tests (`pnpm run test:brief-envelope`).
