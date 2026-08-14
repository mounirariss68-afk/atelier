---
name: Contract salary digitization
description: Invariants for the signed-contract → salary proposal → payroll apply pipeline
---
- Salary extraction is proposal-gated: signed-contract extraction only creates reviewable proposal rows; comp is written solely via the shared audited payroll apply path on human approve. Never add an auto-apply path.
- The e-sign signed trigger must stay fully detached (fire-and-forget, failure → proposal status failed) — the webhook path never awaits salary work.
- Concurrency by construction: one live proposal per contract via a partial unique index (Postgres won't infer partial indexes as ON CONFLICT arbiters — catch the 23505 instead); approve/reject claim via conditional status-guarded UPDATE, losers 409.
- Approve overrides are a partial patch: absent → fallback to extracted, absent-in-both never written, explicit null = deliberate clear. Web omits untouched inputs.
- Drift baseline is the resolved APPROVED patch (approvedValues), not the persisted-change audit list — no-op-at-approval fields must still drift when later edited.
- LLM fallback is fail-loud: snippets must appear verbatim in doc text or the field drops; nothing found → failed, never guessed. Contractor counterparties skipped (payroll is employee-only).

**Why:** salary is the highest-stakes roster data; auditors assume a single human-approved write path, and "matches the signed contract" must stay checkable forever.
**How to apply:** new consumers (bulk sweeps, drift alerts) go through the proposal service + decision routes, never write comp fields directly.
