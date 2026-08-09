---
name: Document-email cross-domain routing
description: How the personal/company document email tools hand off, split queries, and stay leak-free
---
Both chat email tools (personal docs and Document Library) share splitting/matching/loaders in `document-email-shared.ts`.

**Rules:**
- Handoff only when the OTHER domain resolves ALL query terms unambiguously — then re-run the other tool via `findByToolName` with `documentIds` (prevents recursion). Ambiguous cross-domain hits return an options card naming the correct tool; picking an option re-enters the wrong tool with foreign ids, which the ids-rescue path hands off.
- Self-only chat roles (employee/contractor) NEVER get the library probe; their miss copy stays personal-only (no library titles or mention).
- Ownership cues ("my/personal" vs "our/company/library") are pure regexes in `capability-retriever.ts`; they reorder the document floor and gate a probe-other-domain-first fast path in the tools. Both cues present → no bias.
- Existing probe copy contracts: company-tool miss must keep the phrase "list the documents".

**Why:** "send my saudi visa and emirates id to X" used to dead-end on the company tool with "upload it to the Document Library first".

**Gotcha:** `\b` does not match around Arabic letters (not `\w`) — the standalone "و" conjunction in the query splitter is matched by surrounding whitespace, never `\bو\b`.
