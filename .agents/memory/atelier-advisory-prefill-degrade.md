---
name: Atelier advisory prefill must degrade, not block
description: Why chat "create account" must survive a Cartographer timeout instead of hard-failing
---

The chat orchestrator's `prefill_from_specialist` (kind=account, verb=create) runs the
Account Cartographer in `research_only` mode — web search + a large JSON synthesis — as an
**advisory** prefill. This step is explicitly advisory: the partner always reviews/edits the
draft on the `account_proposal` card before any row is written.

**Rule:** an advisory prefill failure must NEVER block account creation. On any Cartographer
error, degrade to `ok:true` with `shape:"account_proposal"`, `degraded:true`, and a minimal
draft built from the user-typed name/country/sector — so the proposal card still renders and
"Review & Create" works.

**Why:** heavy conglomerates exhaust the web-search budget
(`ATELIER_WEBSEARCH_TIMEOUT_MS ?? ATELIER_AGENT_TIMEOUT_MS ?? 180_000` ms); the AbortController
fires mid-synthesis and the Anthropic stream throws `APIUserAbortError` ("Request was aborted").
Returning `ok:false` made the orchestrator (instructed to STOP on `ok:false`) abandon the whole
create flow, so a slow research call looked like "add account is broken."

**How to apply:** keep the `ok:false` path only for truly unrecoverable orchestrator errors.
For prefill/enrichment specialists feeding an editable confirm/proposal card, catch → degrade.
Tell the model (via the orchestrator prompt) not to claim it researched the firm when
`degraded:true`. Also emit one terminal progress phase on abort so the live substatus reports
the timeout instead of freezing on its last synthesis-section caption.
