---
name: Chat two-phase confirm is model-trusted; commit-token defense
description: Why finance-doc chat writes HMAC-stamp their pending input, and when new capabilities should do the same
---

The orchestrator's tool loop executes ANY tool call whose input carries `confirm:true` — including one the model fabricates in the first turn. `twoPhaseConfirm: true` is declarative; the real gate is that the model normally returns the confirmation envelope instead of committing. `/confirm` replays the server-persisted `pendingWrite.input` verbatim; the `needs_confirmation` frame only shows summary+diff, never `pending.input`.

**Defense pattern** (see `finance-doc-capabilities.ts`): phase 1 stamps `commitToken = HMAC(SESSION_SECRET, tool + canonicalized input minus confirm/commitToken)` into `pending.input`; phase 2 commits only when the token verifies, otherwise it degrades to the phase-1 preview (never errors, never writes). The model can't compute the token, and `/confirm` replays it untouched.

**Why:** injected instructions in attached documents can steer the model to emit `confirm:true` directly; for founder-sensitive writes (bank accounts, payables) the preview card must be unforgeable.

**How to apply:** any new chat write capability handling attacker-influenced content (attachments, emails) should reuse this token pattern until/unless the orchestrator gains a global guard. Keep the token out of summary/diff/data.
