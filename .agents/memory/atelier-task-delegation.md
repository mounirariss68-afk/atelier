---
name: Personal-task delegation (accept/decline)
description: Invariants for handing personal tasks to colleagues — row ownership, declined-task filtering, chat clamp.
---

- The assignee OWNS the delegated row; delegation adds only an assigner reference + assignment status (NULL = self-created), so all self-scoped read plumbing keeps working unchanged.
- Declined tasks must vanish from EVERY assignee read surface via the shared not-declined predicate exported from the me-tasks routes module (list, Home roll-up, reminder tick). The assigner still sees declines via their assigned-status view.
- Assignment scope gate = the same roster visibility predicate as roster reads; the assignee must have a portal login; self-assign is rejected.
- The chat capability is deliberately NOT me.* so the self-only chat clamp keeps employee/contractor out; runtime also denies restricted personas and resolves names through the roster-scoped matcher (now exported from people-read-capabilities).
- Respond is assignee-only + pending-only (CAS-style update returns null otherwise → 404); decline dismisses pending reminder cards.
- Delegation notifications use deterministic card ids with onConflictDoNothing; device pushes go ONLY through the shared preference-aware push mirror (never direct sends), and task-related notification kinds map to the "tasks" push category.
- Schema changes need BOTH the Drizzle schema edit AND an idempotent SQL file in lib/db/drizzle (files past the journal tail are Publish-diff docs; validate ALTERs against the prior table state).

**Why:** delegation was bolted onto strictly self-scoped tasks; single-ownership + one declined filter prevented forked read paths, and a review rejection caught the missing migration + preference-bypassing pushes.
**How to apply:** any new task surface (mobile list, digest, roll-up) must filter declined rows and carry assignment status/assigner name; any new delegation notification must use the push mirror.
