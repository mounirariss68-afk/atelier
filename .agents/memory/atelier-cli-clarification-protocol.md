---
name: Atelier CLI clarification continuation protocol
description: How a capability pauses for a clarifying question and reads the answer back without re-running expensive work.
---

When an orchestrator capability returns `{ ok: true, clarification: { field, tool, question, partial, suggestions } }`, index.ts pauses, emits a needs_clarification SSE frame, and on the next user turn re-invokes the tool with args = `{ ...partial, [field]: answer }`.

**Key gotcha:** the answer is merged at **TOP-LEVEL args** (sibling to `kind`/`input`/`targetId`), NOT into `input.input`. So inside the tool (`prefill_from_specialist` does `const inp = input.input`), read the answer from `input[field]` (top-level), while `inp` still holds whatever you stashed in `partial.input`.

**Why:** to avoid re-running expensive work (e.g. the Account Cartographer web research) just to attach one answer, stash the already-researched draft in `partial.input.__researchedDraft` and, on the continuation turn, reuse it instead of re-dispatching the specialist.

**How to apply:** branch-vs-HQ account question — when countryPresence is multinational and no valid entityRole answer yet, return clarification with `partial: { kind, input: { ...inp, __researchedDraft: draft } }`; on the next turn read `input.entityRole`, find `inp.__researchedDraft`, skip the Cartographer, stamp the role, emit account_proposal. `clarification` is allowed alongside `ok: true`. Tolerate free-text answers (regex-map "headquarters"→hq etc.), don't require an exact enum.

**Durability caveat:** pendingClarification lives in an in-memory SESSION_DRAFTS map, so it dies on server restart, and the question card lived only in React state, so it died on page reload — while the turn stayed `awaiting_clarification` in the DB (question stranded/invisible). The fix has three legs that must stay together: (1) runTurn rehydrates pendingClarification from the session's latest prior turn's last needs_clarification frame; (2) GET /cli/turns/pending-clarification returns the question only if the persona's single most-recent turn overall is awaiting_clarification (newer turn supersedes → null); (3) useCli restores the turn on mount, guarded by `currentRef || activeTurnKeyRef` so a just-started submit is never clobbered. Probe: tests/crm/pending-clarification-probe.ts.

**End-to-end wiring caveat:** a value the orchestrator stamps on a proposal draft only reaches the create POST if it is threaded through EVERY hop: orchestrator draft → the card's `openWithPrefill(...)` → the prefill type → the dialog's `makeInitial()` hydration → the submit payload. A gap at any hop silently drops it (e.g. a `makeInitial` field hard-reset to "" instead of reading from prefill). When adding a prefilled field, grep all five hops.

**Rollover caveat (survives session timeout):** session inactivity rollover must PAUSE while the session's latest turn is awaiting_clarification (otherwise the soft-delete strands the question and a late answer becomes a fresh misrouted prompt). Answers carry `continuesTurnId` client→POST /cli/turn→runTurn, which rehydrates cross-session after validating userId/orgId + awaiting_clarification; after continuation the source turn is set to `cancelled`. The pending endpoint now ignores session liveness, applies a 7-day TTL, and (since a later change) supersedes via ANY newer turn cross-session; cancel also resolves awaiting_clarification turns.

**Timestamp precision gotcha:** pg `timestamp` keeps microseconds but drizzle Date round-trips at ms, so `created_at > row.createdAt` matches the row itself. Use `gte + ne(id)` (or compare by id) for "newer than this row" queries.

**clientTurnKey dedupe caveat:** the turn idempotency dedupe treats `awaiting_clarification` as terminal, so an answer that reuses the asked turn's clientTurnKey gets its question frames REPLAYED — a silent no-op. Rule: every clarification answer must carry a fresh clientTurnKey even when it streams into the same UI turn, and the server must never dedupe-replay an answer-shaped request (continuesTurnId or non-empty clarificationValues) against a paused turn — it runs the continuation under a derived key because (session_id, client_turn_key) is unique.
