---
name: Intent-router classifier resilience
description: Chat turn classifier must degrade, never hard-fail; clarification continuations skip it
---
The typed intent classifier that opens every chat turn is advisory bookkeeping.
It must never throw a turn-killing error.

**Rule:** live-classifier failures retry once (15s cutoff each, env
`ATELIER_CLI_CLASSIFIER_TIMEOUT_MS`) then degrade to the deterministic keyword
classifier (confidence 0.4, model tag "deterministic-fallback") with loud logs.
Explicit clarification-answer turns (`continuesTurnId` set) skip the live model
entirely via `deterministicOnly`.

**Why:** a 5s single-shot hard-fail aborted turns constantly under normal AI-proxy
latency ("Request was aborted"), including the turn carrying the user's answer
after a 40s+ specialist research run. Fail-loud was originally deliberate, but
worst case of degrading is routing quality, not privilege escalation — write
gating/confirm flows are enforced downstream.

**How to apply:** any new pre-turn LLM bookkeeping call should follow the same
pattern (retry → deterministic degrade → loud log), and continuation/resume
paths should bypass it. Offline probe: tests/crm/intent-router-fallback-probe.ts.

## Hallucinated tool-name recovery (2026-08-12)
Rule: a model tool call whose name isn't registered no longer kills the turn with a red "tool not registered" error.
- `closestToolName()` (exported from atelier-cli/index) token-overlap-matches the mistyped name against the menu the model was shown; substitution happens BEFORE the assistant history push (transcript consistency) and before the self-only clamp, and only if the corrected name still resolves for the persona (no ACL widening). Requires ≥2/3 overlap AND a clear margin over the runner-up.
- No confident match → one model-side retry per turn: the miss is fed back as an is_error tool_result so the model re-picks from its menu; only a second miss errors the turn.
**Why:** mobile chat died with "tool request_employment_certificate not registered" (real tool: request_employment_letter).
Also SYSTEM_PROMPT hard rule 10: detail-gathering tools must be called immediately — never enumerate their options as a prose bullet list (the tool's multi-field clarification renders the dropdowns/text boxes).
