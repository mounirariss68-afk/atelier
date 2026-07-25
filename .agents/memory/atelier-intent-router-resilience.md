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
