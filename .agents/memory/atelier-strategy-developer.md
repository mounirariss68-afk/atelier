---
name: Strategy exemplar RAG & draft decisions
description: Account Strategy Developer — how draft decisions are tracked and why exemplar indexing is where it is
---

- **Draft decisions have no run-status column.** Approve/dismiss are recorded solely as `agent.approved`/`agent.dismissed` audit events carrying the runId; the status route hides decided runs and the approve route 409s on already-decided runIds. Any new decision surface must write the same audit shape or dismissed drafts reappear/re-apply.
  - **Why:** propose-then-approve with zero new decision tables — the audit trail is the single source of truth.
- Strategy exemplar retrieval is deliberately brute-force JS cosine over the org's rows (small account roster), strictly org-scoped with the target account excluded; indexing is fire-and-forget after every strategy write surface. A NEW strategy write surface must also trigger re-indexing or the exemplar library silently goes stale.
- Partner guidance lives in its own column (not inside the strategy jsonb) **so guidance survives when the strategy itself is cleared** — keep that split if the strategy shape is ever restructured.
