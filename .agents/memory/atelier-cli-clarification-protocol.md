---
name: Atelier CLI clarification continuation protocol
description: How a capability pauses for a clarifying question and reads the answer back without re-running expensive work.
---

When an orchestrator capability returns `{ ok: true, clarification: { field, tool, question, partial, suggestions } }`, index.ts pauses, emits a needs_clarification SSE frame, and on the next user turn re-invokes the tool with args = `{ ...partial, [field]: answer }`.

**Key gotcha:** the answer is merged at **TOP-LEVEL args** (sibling to `kind`/`input`/`targetId`), NOT into `input.input`. So inside the tool (`prefill_from_specialist` does `const inp = input.input`), read the answer from `input[field]` (top-level), while `inp` still holds whatever you stashed in `partial.input`.

**Why:** to avoid re-running expensive work (e.g. the Account Cartographer web research) just to attach one answer, stash the already-researched draft in `partial.input.__researchedDraft` and, on the continuation turn, reuse it instead of re-dispatching the specialist.

**How to apply:** branch-vs-HQ account question — when countryPresence is multinational and no valid entityRole answer yet, return clarification with `partial: { kind, input: { ...inp, __researchedDraft: draft } }`; on the next turn read `input.entityRole`, find `inp.__researchedDraft`, skip the Cartographer, stamp the role, emit account_proposal. `clarification` is allowed alongside `ok: true`. Tolerate free-text answers (regex-map "headquarters"→hq etc.), don't require an exact enum.

**End-to-end wiring caveat:** a value the orchestrator stamps on a proposal draft only reaches the create POST if it is threaded through EVERY hop: orchestrator draft → the card's `openWithPrefill(...)` → the prefill type → the dialog's `makeInitial()` hydration → the submit payload. A gap at any hop silently drops it (e.g. a `makeInitial` field hard-reset to "" instead of reading from prefill). When adding a prefilled field, grep all five hops.
