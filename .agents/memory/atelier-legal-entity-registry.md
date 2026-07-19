---
name: Atelier legal-entity registry
description: Finance Entities registry design quirks — routes, legacy seed compat, extraction response shape, signing-entities path.
---
- Registry lives at `/api/atelier/finance/entities` (CRUD + `/extract`); signing entities merge at `/api/atelier/signing-entities` (firmProfileRoutes, NOT under /contracts).
- `ENTITIES_SEED` is fully removed (2026-07-19). Plan/report modules read the registry per-request via `listFinanceEntities(orgId)` (org-scoped, excludes archived) and call `setFpaEntities()` to refresh the FPA engine's currency/name maps; empty registry falls back to the firm pseudo-entity.
- **Why:** no-seeding policy; entity lists must be live DB data. Registry entities carry NO fiscal calendar or cash-policy data — seed-derived VAT/CT tax lines and per-entity opening balances were dropped (zeros) until real fields exist.
- Extraction endpoint returns `{documentId, proposal: {documentKind, confidenceNote, fields: {...}}}` — entity data is under `proposal.fields`, not top-level proposal.
- Documents upload accepts `category=corporate_legal` + `entityId` multipart fields; entity detail returns linked docs in `documents`.
- Frontend country filter derives from data via an ISO map in FinanceEntities.tsx — never hardcode country lists.
