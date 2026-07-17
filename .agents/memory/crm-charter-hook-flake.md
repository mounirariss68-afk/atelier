---
name: CRM harness charter-hook check fails env-only
description: Why "stage-transition response surfaces engagementHookError (null on success)" fails in isolated envs
---
The contract-entry hook (ensureEngagementForContract) fires a REAL charter LLM call (runCharterArchitect) — it is NOT covered by ATELIER_MOCK_AGENTS (that flag isn't referenced in src at all). In isolated task environments the call dies with APIUserAbortError, so the harness check requiring `engagementHookError === null` fails deterministically, while the engagement auto-create itself succeeds.

**Why:** two consecutive full test:crm runs (2026-07-17) failed on ONLY this check; the failure is the awaited live LLM call, not CRUD logic.

**How to apply:** treat this single failure as environmental when attributing test:crm results; a real fix means stubbing the charter LLM (see stub-Anthropic probe pattern) or honoring a mock flag in runCharterArchitect.
