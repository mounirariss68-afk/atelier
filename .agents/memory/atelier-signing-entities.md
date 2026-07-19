---
name: Signing-entity registry
description: Where Cognirise signing entities live and the rules around them
---
Signing entities are the firm-profile `payload.legalEntities` array (published section), NOT a table. Each entry has stable `id` (le_*), name/country/address, `isDefault`.

**Rules:** PUT /firm-profile/legal-entities replaces the whole registry and server-enforces exactly one default; ids must stay stable across saves (UI strips a `new-` prefix for fresh rows). GET /signing-entities is the read surface (returns entities + defaultEntityId). Contracts snapshot signingEntityId/Label/Country at create; entity drives firm-side autofill (firm_jurisdiction etc.). No seeder — Dubai LLC default was set via the management surface.

**How to apply:** any new consumer should read GET /signing-entities and treat contract snapshots as immutable history, not lookups into the current registry.
