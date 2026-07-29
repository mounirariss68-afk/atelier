---
name: Chat reliability harness
description: Conversation-level chat regression suite, validation gate, and telemetry rollup for the Atelier chat pipeline.
---

# Chat reliability harness

- Suite: `test:chat-suite` in api-server = replay + facts + clarify + reducer-parity + `test:chat-convo` (conversation harness). Registered as validation step `chat-reliability` — run it before merging any orchestrator / clarification-resolver / session-facts / replay / `@workspace/chat-core` change.
- The conversation harness (`tests/chat/conversation-probe.ts`) drives the REAL orchestrator: in-process `/cli/turn` SSE on the crm_test scratch DB, scripted stub Anthropic + stub Ignav/Staying travel providers. Every turn must pass `assertAlive` (final frame, non-error) — that is the dead-end guard. Reuse `seedFlightFacts`/`askHotels`/`postTurn` when adding scenarios.
- **Why:** single-tool probes kept passing while multi-turn conversations regressed (re-asked answered questions, "confirmed" dead ends). Only conversation-level assertions (one clarification round total, exactly-once double-send, superseded turns staying resumable) catch those.
- Real bugs it caught on day one: a TDZ crash (`let lastModel` declared below `record()` — any pre-model-loop `record()` call like the "already answered" narration crashed the turn), and the chronological date-fact fallback gap for positional keys (`travel_search_flights.segments.0.date` has no begin/end semantics; fallback is earliest/latest date scoped to the pending tool's key family so unrelated deadlines never become trip anchors).
- Telemetry rollup: `chat:telemetry-rollup` parses `[cli-telemetry]` JSON lines from logs → reask/dead-end/dup-answer rates. Docs + query cookbook in `src/lib/atelier-cli/CHAT-RELIABILITY.md`.
- Employee/contractor chat is now ALLOWED (200) but clamped to me.* tools — don't assert 403 on `/cli/turn` for them anymore.
- The conversation harness now also covers meetings (stub Microsoft Graph via `MS_LOGIN_BASE_URL`/`MS_GRAPH_BASE_URL` + an encrypted-refresh-token `atelier_ms_connections` row) and expenses (two-phase confirm via `POST /cli/turn/:id/confirm`; concurrent double-confirm must commit exactly once, replayed final carries `replay:true`).
- `create_my_expense` clarifies on MISSING/unparseable amount (multi-field amount + date-picker payload) instead of erroring; it tolerantly parses resolver-merged free-text answers like "120 dollars"/"45 AED" (currency inferred when unset). Out-of-range numbers still `invalid_amount`.
