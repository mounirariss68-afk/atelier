---
name: Atelier firmographic columns need schema push
description: atelier_accounts firmographic columns live in Drizzle schema but may be absent from a fresh isolated DB, causing 500s on account reads
---

The 5 firmographic columns on `atelier_accounts` (employee_count, annual_revenue
jsonb, holding_structure jsonb, country_presence jsonb, entity_role text) are
defined in `lib/db/src/schema/atelier.ts` but an isolated environment's DB
snapshot can predate that schema.

**Symptom:** `GET /api/atelier/accounts` (and any account read) 500s with
`Failed query: select ... employee_count, annual_revenue, ...` because Drizzle
selects all schema columns and they don't exist in the table.

**Fix:** `pnpm --filter @workspace/db push` syncs the schema (additive, safe).

**Why:** Drizzle schema is the source of truth; the DB can lag in fresh/isolated
environments. Push before testing any feature that touches new columns.
