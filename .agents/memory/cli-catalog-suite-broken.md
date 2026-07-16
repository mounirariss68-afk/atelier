---
name: cli-catalog run.ts is import-broken
description: The main capability-catalog test suite doesn't load; new catalog guards go in standalone files.
---
`artifacts/api-server/tests/cli-catalog/run.ts` fails at import time: it imports `pinnedPromptDrift` from capability-catalog.ts, an export that was removed from capability-catalog.ts. The whole suite (role perimeter, PII, schema-hash checks) silently provides no coverage.

**Why:** any new test added to run.ts is dead on arrival until the stale import is repaired.

**How to apply:** put new deterministic catalog guards in standalone files under tests/cli-catalog/ (pattern: `suggestion-jargon.ts` + a `test:*` package script). A follow-up task exists to repair run.ts itself.
