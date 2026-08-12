---
name: Proactive recap outcome lines
description: How the "Catching you up" card gets its content and what new commit paths must do
---

The proactive recap is outcome-oriented: rolling-summary lines may carry a trailing
`" ⇒ <outcome phrase>"` segment (RECAP_OUTCOME_SEP in recap-relevance.ts), built ONLY from
structural signals (tool names via humanizeToolName + entity labels recorded on the session
draft during the turn) — never from prompt text, so PII redaction holds.

**Rules:**
- The card composes exclusively from outcome segments; legacy prompt-echo lines never render
  a card (thin-content suppression). Open threads (turns stuck in awaiting_confirmation /
  awaiting_clarification, queried from atelierCliTurns at recap time) can justify a card alone.
- Any commit path that runs OUTSIDE runTurn (e.g. the two-phase confirm route) must append its
  own `(confirmed) → success ⇒ …` line to session.rollingSummary or the recap will forever say
  the write was "awaiting confirmation". Async background job completion does NOT do this yet.
- chat-core reducer drops contentless proactive_recap frames client-side (stale/legacy guard);
  web CommandBar + mobile chat both render accomplishments/openThreads from the shared frame.

**Why:** user report — the old card replayed redacted prompts ("<what you typed> → success
(2 tools)"), which was redundant and thin.

**How to apply:** when adding a new write-commit surface or turn status, ask whether the
rolling summary gets an outcome line; extend describeTurnOutcome rather than inlining phrases.
