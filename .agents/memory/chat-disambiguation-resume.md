---
name: Chat disambiguation resume
description: How needs_disambiguation option picks resolve — first-class deterministic continuation (mirrors clarification resume), no model extraction.
---

# Chat disambiguation resume (deterministic, first-class)

Option picks after a `needs_disambiguation` turn are resolved **server-side, deterministically** — the model is never asked to extract the id.

**How it works**
- When a tool returns `disambiguation` with a declared string `field` (e.g. `{ kind:"expense", field:"expenseId", options }`), the orchestrator records `pendingDisambiguation` (tool, field, kind, options, partial input, original prompt) in the session draft and enriches the frame with `tool`/`partial`/`turnId`. Envelopes **without** a `field` stay on the legacy model path — declare a field on any new emitter to get the deterministic path.
- A pre-model-loop continuation block (mirroring the clarification resume) resolves the reply via: explicit `disambigOptionId` in the request body (chip taps on web+mobile send it with `continuesTurnId`), an `id <x>` token in the text (legacy client format — still deterministic), a bare option id, ordinals ("the second one", TR/AR forms via `parseOrdinalChoice`), or a unique label match (`matchOption`). On match it merges `{[field]: id}` into the partial and re-runs the tool, handling every envelope (confirmation/clarification/nested disambiguation/refusal/ok/error) and retiring the source turn.
- **Foreign/unknown option replies are rejected honestly**: options re-shown on the new turn (frame carries `rejected`), pending kept, never guessed or handed to the model.
- Non-option replies clear the pending state and fall through to normal orchestration (supersession).
- Rehydration works across restarts: explicit `continuesTurnId` or recency fallback reads the `needs_disambiguation` frame off the prior `partial`-status turn row (`disambigSpecFromFrames`).

**Why:** prompt-injected `(Use the one called "X" — id Y)` relied on model extraction — flagged as the weakest link in every disambiguation flow.

**How to apply:** new disambiguation emitters must set option `id` to the exact tool-input value AND declare `field`; new client surfaces should send `disambigOptionId` + `continuesTurnId` on pick. Regression coverage: conversation-probe E3 (chip pick / ordinal / foreign-id rejection).
