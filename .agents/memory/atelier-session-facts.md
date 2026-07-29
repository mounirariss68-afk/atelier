---
name: Atelier chat session facts
description: Typed per-session facts store, control-intent normalization, adaptive tool budget (chat memory stack, layer 2)
---

# Typed session facts & intent normalization

- Table `atelier_cli_session_facts` (org/user/session scoped, unique on session+key, TTL ~7d, in RLS org_tables list). Facts are written ONLY from user-stated tool inputs / clarification merges / confirmed writes / async-job completions — never from rolling summaries or titles (those are display metadata only; system prompt rule 4 says so explicitly, facts contract v1).
- Extraction is pure + key-shape driven (`session-facts.ts`: extractFactsFromToolEvent) so new capabilities get facts capture for free; id/cursor/url-ish keys are ignored.
- Ingestion call sites (all fire-and-forget `ingestSessionFacts`): main model loop tool success, clarification continuation, `confirmPendingWrite` (runs OUTSIDE runTurn!), `runAsyncJob`. Any NEW commit path must add its own call.
- Rollout: `ATELIER_CLI_FACTS_MODE` = off | shadow (write+telemetry, block not rendered) | on (default). `[session facts]` block injected as history pair after replay window; recap frame gains additive `facts` array.
- **Why:** the model kept re-asking answered questions; old prompt policy said all prior context is "hints only, re-fetch" — now replay + facts are authoritative for user-stated values, re-fetch is only for live entity data.
- Control intents: `normalizeControlIntent` fires only on WHOLE short prompts (EN/TR/AR affirm/decline/cancel); only "cancel" acts deterministically (clears pendingClarification + retires the paused source turn); affirm/decline are telemetry-only until the shared clarification resolver lands.
- Confirm-path facts must be attributed to the SESSION OWNER (turn.userId), never the confirming approver, or cross-user approvals hide facts from the initiator's later turns.
- Tool budget: fixed HARD_CAP=12 replaced by adaptive `selectRankedAdaptive` (base `ATELIER_CLI_TOOL_CAP`=12, extends while cutoff scores within 0.04, max `ATELIER_CLI_TOOL_CAP_MAX`=20); tie-window means fixtures with score gaps < epsilon WILL extend — probe fixtures need gaps > 0.04.
- Offline probe: `test:chat-facts` (pure, no DB). Full resolver cutover + removal of the free-text clarification-answer heuristics is deliberately deferred to the downstream shared-clarification-resolver work.
