---
name: Atelier finance real-facts wiring
description: Guardrails for the Plan/Comply/Reports finance surfaces that read real records; all queries org-scoped
---
- Finance Plan/Comply/Reports must derive every figure from real DB records (or manual entry) — never fabricated arrays, noise, or synthetic scenarios. Budget/forecast render honest zeros until a real committed scenario exists.
- Everything is tenant-scoped: the shared facts loader takes the caller's orgId (per-org cache), and comply register CRUD filters and stamps orgId. Never add a finance query without org scoping.
- Reports operate on a single "firm" pseudo-entity (USD) because no legal entities are registered; reports route handlers must load facts for the caller's org before the synchronous statement generators run.
- The finance comply registers persist in `atelier_finance_compliance_entries` — NOT `atelier_compliance_records`, which is a pre-existing roster/visa table (name-collision trap).
- New tables need BOTH the Drizzle schema entry AND an idempotent numbered SQL file in lib/db/drizzle/ (CREATE TABLE IF NOT EXISTS style), or environments that only run migrations hit missing-relation errors.

**Why:** demo-data wipe policy — every number must trace to a DB row; a review rejected unscoped queries (cross-tenant leakage) and schema-only table adds (deploy breakage).
