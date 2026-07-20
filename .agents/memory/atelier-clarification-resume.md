---
name: Clarification resume across in-turn errors
description: How asked-then-errored clarification turns stay answerable; mobile chip/label rendering rules.
---

- A turn that EMITS needs_clarification but later errors in the same turn is promoted back to `awaiting_clarification` at persist time, and rehydration (`isClarificationResumable`) accepts `error`/`partial` turns whose frames contain a needs_clarification frame. Source-turn retirement on answer uses inArray(awaiting_clarification|error|partial).
- **Why:** otherwise the user's answer fails rehydration, re-runs the whole prompt, and re-asks the same question in a loop (re-paying specialist research cost).
- **How to apply:** any new pause-style frame (confirmation etc.) that can be followed by an in-turn failure needs the same promote-in-finally + relaxed-rehydration treatment.
- needs_clarification frames carry `turnId`; the mobile reducer (`lib/chatFrames.ts`, pure/Node-testable, extracted from useChat) captures serverTurnId from ANY frame.
- Mobile single-field clarification fabricates a field with EMPTY label (question is the headline — no duplicate text) and maps server `suggestions` to `choices` chips submitting the id (e.g. "hq").
- `pending-clarification-probe.ts` has 2 pre-existing failures in the soft-deleted-session restore case: the endpoint's on-read supersession sweep cancels the paused turn before the probe deletes the newer turns. Not a regression signal.
