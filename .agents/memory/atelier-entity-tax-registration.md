---
name: Entity tax-registration pairs
description: Compatibility and ownership rules for Corporate Tax and VAT registration certificates.
---

Active legal entities must carry a complete Corporate Tax pair: number and certificate. VAT remains optional, but once either its number or certificate exists, both are required. The registration owns the explicit certificate reference; the vault document remains the canonical stored file and is atomically claimed, entity-linked, and classified in the same entity transaction.

**Why:** Generic tax-document classification cannot reliably distinguish CT from VAT, enforcing the new rule on every partial patch would make older active entities impossible to maintain before Finance can remediate them, and validate-then-link without a conditional transactional claim allows concurrent entities to reference the same certificate.

**How to apply:** Enforce full pairing on new active entities and whenever registrations/status actually change. Keep reads and unrelated full or partial patches compatible with any unchanged legacy-incomplete CT or VAT pair. Claim certificates inside the entity transaction with org, active-status, and current-owner predicates, and fail unless every expected claim succeeds. Never infer CT versus VAT from a generic tax document when an explicit registration-to-certificate reference exists.