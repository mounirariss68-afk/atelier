---
name: Self-only chat roles clamp
description: Employee/contractor chat personas are clamped to me.* tools; boundary allows /cli/*
---

Employee and contractor personas can use chat (`/cli/turn`) but must only see self-scoped tools.

**The rule:** `SELF_ONLY_CHAT_ROLES` (exported from `capability-catalog.ts`) lists roles whose `capabilitiesForPersona` returns only non-write `me.*` entries; `getToolsForPersona` in `atelier-cli/index.ts` also skips the legacy TOOL_REGISTRY fallthrough for those roles; the central persona boundary in `routes/atelier/index.ts` explicitly allowlists `/cli` + `/cli/*` for employee AND contractor branches.

**Why:** Without the clamp, opening `/cli/*` to employees exposed ~93 org-wide tools (accounts, finance, roster). All three layers are needed — the legacy registry fallthrough silently re-adds tools even when the catalog filters correctly.

**How to apply:** Any new chat-capable role or new tool-registration path must respect SELF_ONLY_CHAT_ROLES; there is no automated test pinning this yet (follow-up proposed).

Related quirks found while verifying:
- Web shell polls `/activity`, `/accounts`, `/reference/bootstrap` regardless of persona → constant 403s for employees (pre-existing; follow-up proposed).
- Web `EntityCard` now flattens one level of scalar-valued nested objects (≤12 entries, `year` sub-key skipped) — previously nested objects rendered "[object Object]".
