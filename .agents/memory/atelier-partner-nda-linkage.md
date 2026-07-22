---
name: Partner NDA → firm linkage
description: How partner agreements map to partner-firm registry rows (no FK; name-based join)
---

There is NO FK between `atelier_contract`/`atelier_counterparty` and the unified partner-firm registry (`atelier_partner_firms`). The `/partners/agreements` route resolves `partnerFirmId` by a deterministic normalized-name join (trimmed, case-folded counterparty displayName/legalName vs firm name). The Qualify NDA chip keys on `partnerFirmId`, never `counterpartyId`.

**Why:** partnerFirm.id ≠ counterparty.id; keying UI on counterpartyId silently shows "none" for every firm.

**How to apply:** any new surface associating contracts with partner firms must reuse (or replace with an explicit link column — see Task backlog) this name join; renames break the match, so prefer adding a durable `counterpartyId` link if touching the schema.
