---
name: Chat disambiguation resume is prompt-injected
description: How disambiguation option picks flow back into tools (not deterministic), and what tools must emit.
---

The rule: `ToolResult.disambiguation` ends the turn (`needs_disambiguation`, status partial); the server does NOT map the pick back into tool input. Web/mobile chip taps submit a NEW turn with the original prompt plus `(Use the one called "<label>" — id <optionId>)`; the model re-calls the tool with the id. `disambiguation.field` is carried through SSE but ignored server-side.

**Why:** clarifications have a deterministic merge/resume path (clarification-resolver), disambiguations never did — every existing tool (delete_my_document, meeting tools, person tools, expense tools) relies on prompt-injected ids. An architect review of Task #787 flagged this as fragile (model-extraction dependent), but changing it is a protocol-level project, not a per-tool fix.

**How to apply:** when a tool emits disambiguation, make each option `id` the exact value the tool accepts as input (e.g. expenseId, documentId), so the injected `id <optionId>` lands correctly. isWrite tools must also set `data.navigateTo: null`. Don't expect resolver-style deterministic resume, and don't re-flag this per tool; a dedicated task exists to make resume deterministic platform-wide.
