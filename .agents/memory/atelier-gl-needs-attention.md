---
name: GL needs-attention & proposal split
description: How allocation proposals work for invoice/contractor_payment/bank_transaction vs expenses/pfis, and the merged ledger tab.
---

**Rule:** For invoice, contractor_payment, and bank_transaction, allocation proposals live in `allocProposedEntityId`; `legalEntityId` stays NULL until a human decides. Expenses/pfis are the opposite: propose writes the entity column and the Bookkeeper gates on allocStatus.

**Why:** The Bookkeeper posts those three kinds whenever `legalEntityId` is set (no allocStatus gate), and Bookkeeper changes were out of scope — writing the entity at propose time would auto-post an unapproved proposal.

**How to apply:**
- New proposal surfaces for these kinds must use `proposeGlRecordAllocation` and never write `legalEntityId` directly.
- ALL manual tagging (`/gl/tag`) and approve/change go through `decideAllocation` (period-lock check + reason-required override + audit). Decide audits use field `legalEntityId` for these kinds (`entityId` for expenses).
- The ledger UI has ONE "Needs attention" tab (exceptions section + untagged section with approve/change proposal UI); `/gl/untagged` keeps pending expenses/pfis in the feed via `allocStatus IN (proposed, needs_input)` and runs a capped rules-only propose pass inline (AI only via the sweep).
