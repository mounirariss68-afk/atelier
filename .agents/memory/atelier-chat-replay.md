---
name: Chat verbatim replay window
description: Invariants for the atelier chat replay window (budget, session lineage, telemetry)
---

Recent chat turns replay verbatim into model history via a pure composer over persisted turn rows.

**Rules:**
- Keep the composer pure (no DB) so the offline probe (test:chat-replay) stays runnable anywhere; budgets are char-partitioned and oldest turns drop first, with `replay_window` telemetry flagging truncation.
- Inactivity rollover must preserve lineage: the fresh session records its predecessor and carries the rolling summary; replay seeds from the (soft-deleted) predecessor tail when underfilled. Any new rollover path must keep this.
- Replay fetch is org/user-scoped, excludes current + streaming turns, and degrades to no-replay on failure — never block the turn.
- The rolling summary now covers only turns beyond the window; treat it as non-authoritative.

**Why:** the "re-asks answered questions" bug came from the model seeing only a one-line rolling summary — facts from two turns earlier were genuinely absent.

**How to apply:** when adding chat context primers or session-lifecycle changes, thread them through the replay window rather than adding parallel summaries.
