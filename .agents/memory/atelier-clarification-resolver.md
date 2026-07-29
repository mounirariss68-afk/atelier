---
name: Atelier shared clarification resolver
description: How replies to pending chat clarifications are classified/resolved; flags, fallbacks, and gate semantics.
---

One shared subsystem (`clarification-resolver.ts` in atelier-cli) owns clarification replies.

**Rules:**
- Gate: replies while pending are classified by the resolver — a fresh request no longer silently drops the question; the source turn stays resumable and a `[pending question]` primer rides into model context (+ `clarification_superseded` telemetry).
- Continuation precedence: multi-field `clarificationValues` > Task #570 reroute > resolver typed values/confirm > LLM assist (`resolveWithModel`, null on ANY failure) > legacy raw merge. LLM failure NEVER clears pending.
- "confirmed" while pending executes the tool with the partial + fact-derived date fills; if fields still missing the tool re-asks (`confirmDeadEnd` telemetry).
- Decline/affirm map to a literal option value when ANY asked field has yes/no-ish options (localized: evet/hayır/نعم/لا); only otherwise does decline cancel.
- `FRESH_COMMAND_OPENERS` must stay in sync with legacy `COMMAND_OPENERS` in index.ts (drift caused a review Fail — "cancel" was missing).
- Referential answers ("same dates I specified") and "5 nights" anchor derivation resolve against Task #741 typed session facts; no facts → honest `unparsed` re-ask.
- Flags: `ATELIER_CLI_CLARIFICATION_RESOLVER` (on|off kill switch, no data migration), `ATELIER_CLI_RESOLVER_LLM` (off in probes for offline determinism).

**Why:** raw-text merges + the old shape heuristic produced non-sensical loops (re-asking answered questions, dropping questions on a heuristic miss).

**How to apply:** any new clarification-emitting tool gets typed resolution for free via `fields[].inputType/options`; new command verbs must be added to BOTH opener sets; migration matrix lives in `CLARIFICATION-MIGRATION.md` next to the module.
