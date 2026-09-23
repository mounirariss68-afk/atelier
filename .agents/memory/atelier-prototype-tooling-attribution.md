---
name: Prototype tooling attribution
description: Authority boundary between CRM prototype tracking and finance tooling-cost allocation.
---

Prototype attribution is an optional dimension on exact vendor-project mappings and materialized invoice splits. It must never replace or redefine the finance bucket: pre-sales remains opportunity-based and post-contract delivery remains engagement-based. Only approved invoice splits count as approved prototype cost; proposed, unmapped, failed, and unreconciled amounts stay separate.

**Why:** A client may have multiple prototypes under one opportunity, but accounting and P&L still rely on the reviewed opportunity or engagement allocation. Treating a prototype as a ledger would bypass existing finance approval and create falsely precise flat-vendor costs.

**How to apply:** Validate that a selected prototype belongs to the chosen opportunity, engagement, or account. Preserve exact-name mapping and immutable approved splits. Label flat-vendor rule allocations as shared/allocated rather than direct usage.