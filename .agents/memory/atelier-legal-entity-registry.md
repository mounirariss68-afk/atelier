---
name: Atelier legal-entity registry
description: Finance Entities registry design quirks — routes, legacy seed compat, extraction response shape, signing-entities path.
---
- Registry lives at `/api/atelier/finance/entities` (CRUD + `/extract`); signing entities merge at `/api/atelier/signing-entities` (firmProfileRoutes, NOT under /contracts).
- Legacy finance plan/report modules still import `ENTITIES_SEED` from financeEntitiesRoutes; it is intentionally an EMPTY compat export (no-seeding policy). Do not repopulate it — those modules fall back to the firm pseudo-entity.
- **Why:** Task rewrite removed seeded entities; keeping the export empty preserved boot without reintroducing demo data.
- Extraction endpoint returns `{documentId, proposal: {documentKind, confidenceNote, fields: {...}}}` — entity data is under `proposal.fields`, not top-level proposal.
- Documents upload accepts `category=corporate_legal` + `entityId` multipart fields; entity detail returns linked docs in `documents`.
- Frontend country filter derives from data via an ISO map in FinanceEntities.tsx — never hardcode country lists.
