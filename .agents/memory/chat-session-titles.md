---
name: Chat session auto-titles
description: How CLI session titles are generated and what stub-Anthropic probes must expect
---

- After a session's first completed turn, the orchestrator fires a fire-and-forget Haiku call (system prompt starts "You title chat conversations") that writes the session title.
- The UPDATE is guarded on `title IS NULL` — titles are set once and never overwritten; failures are swallowed (session stays untitled).
- **How to apply:** any stub-Anthropic probe that drives /cli/turn will now receive this extra model call after the SSE stream ends. Stubs matching on system-prompt prefixes should either handle it or let it fall to a harmless fallback; a garbage/failed response only leaves the probe session untitled.
- Web history drawer (CommandBar HistoryPanel) and mobile history sheet render `title ?? "New chat"`.
