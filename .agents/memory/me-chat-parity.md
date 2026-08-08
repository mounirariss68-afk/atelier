---
name: /me chat-parity registry & ratchet
description: How the self-service chat parity registry, lint, and exclusion copy work — read before adding any mutating /me route or me.* write tool.
---

- Every MUTATING /me route must have an entry in `me-chat-parity.ts` (pure module, keyed `"method /path"` verbatim from source): either `{kind:"capability", capability}` or an exclusion with reason + per-platform UI locations. `lintMeChatParity` (in atelier-lint-routes) fails on missing OR stale keys; cli-catalog tests enforce capability ids exist and copy stays honest.
- Honest refusal copy for excluded actions is GENERATED from the registry (`selfServiceExclusionGuidance()`) and injected into the per-turn contextBlock only for SELF_ONLY_CHAT_ROLES. Never hand-write refusal copy for /me actions elsewhere.
- **Why:** an audit found ~35 self-service actions silently missing from chat; the registry makes the gap impossible to reopen and keeps platform claims truthful (e.g. bank change is web-only).
- **How to apply:** new /me route → add registry entry (and capability if chat-worthy); new me.* write → follow defineSelfWriteCapability (self subject, no selector fields, confirm-gated, navigateTo on commit, disambiguation payloads carry `data.navigateTo: null`).
- Gotchas: probe SELECTOR_FIELDS list treats a schema prop named `email` as a subject selector — name contact emails `contactEmail`; travel profile confirm summary/diff must never echo membership numbers (pending replay input may); cli-selfservice scratch DB is reused — sweep notification kinds at seed or the 5b parity check false-fails.
