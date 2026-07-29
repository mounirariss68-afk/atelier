---
name: Expense description/summary contract
description: Cross-surface rules for expense description prefill and summary sync
---
Rule: every expense write surface (Me-lens create/PATCH, wallet create) stores a blank/whitespace description as NULL; the receipt parse pipeline prefills `description` with the composed enriched summary ONLY when the stored description is empty, and never overwrites user text. The display `summary` follows manual description/merchant edits only when `auditorRunId` is null (an auditor-composed summary is never clobbered — guard must use `!== undefined`, not `??`, since a cleared description is null).

**Why:** users typed descriptions were silently dropped by the auto-create path and impossible to clear via PATCH (empty → undefined = no-op); a `??` fallback resurrected cleared text.

**How to apply:** any new expense write surface must keep blank→NULL semantics and route FX recompute on amount/currency/DATE changes. Pinned by `test:expense-edit` (isolated scratch DB probe). Wallet routes are 403 for employee personas — probe them with a finance persona.
