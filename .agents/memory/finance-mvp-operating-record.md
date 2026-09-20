---
name: Finance MVP operating record
description: Durable accounting-safety rules for the pre-revenue finance MVP.
---

Shareholder funding is an append-only register. Contributions are confirmed, then repayments and reversals are separate linked entries; never rewrite or delete the original economic event. Planned and in-formation entities are valid attribution targets.

**Why:** Early-stage funding still needs a reliable audit trail, and destructive edits would make bank reconciliation and equity-versus-loan treatment impossible to explain later.

**How to apply:** Any new funding mutation must be organization/entity scoped, idempotent, period-lock aware, evidence linked, and represented as a new lifecycle entry.

Finance summaries must preserve source currencies as separate buckets. A display-currency total is allowed only through the server FX conversion contract. Ratios spanning unlike currencies remain unavailable unless conversion makes the values comparable.

**Why:** Adding unlike currencies produces plausible but false totals and margins.

**How to apply:** New report metrics return currency buckets first; never sum bucket amounts or compute a cross-currency percentage directly.

Bank reconciliation acknowledgement is not approval. A period can close only after every exception has been resolved through an approved match or classification.

**Why:** Acknowledging an unresolved item does not establish what the transaction represents.

**How to apply:** New reconciliation paths must end in an approved terminal state before finalisation and must reject mutations after the period is locked.