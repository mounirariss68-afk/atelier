---
name: Cash matchProposal shape
description: Persisted bank-txn matchProposal recommended field is a string action, not an object; invoice/ref lives in candidates[0].
---

Rule: on `atelier_bank_transaction.matchProposal`, `recommended` is a string action label (e.g. "apply_full"); the actual target (invoiceId / refId) is in `candidates[0]`. Outflow proposals have `{type:"outflow", candidates:[{refKind,refId,...}]}` and no recommended object.

**Why:** the confirm route and triage UI initially read `recommended.invoiceId` and 400'd on every real proposal; the deterministic matcher writes the string form.

**How to apply:** any consumer of matchProposal (routes, UI, probes) must resolve the target as `typeof recommended === "object" ? recommended.invoiceId : candidates[0]?.invoiceId` (fallback pattern already in cashRoutes confirm + WalletCash).
