---
name: Atelier RLS test scoping
description: Why CRM scoping must be asserted via RLS helper functions + app ACL, and where restricted personas are hard-denied.
---

# Atelier RLS / scoping — what's actually enforced where

The live DB connection runs as a superuser with BYPASSRLS, so Postgres
row-level-security *table policies* are not enforced on it — a deny policy still
returns every row. Any test or code that expects table-policy narrowing on the
pooled connection will get a false green.

**Where scoping is actually observable:**
1. The RLS *helper functions* (pure SQL, GUC-driven): org defaults to the house org
   when the org GUC is empty; engagement access is allow-all when the engagement-ids
   GUC is empty, CSV-membership otherwise, and a deny sentinel forces false. Drive
   them in tests with transaction-local `set_config(..., true)`.
2. The application ACL layer (accessible-engagement + can-see-account checks).

**Restricted personas:** non-employee personas (partner-firm resource, contractor)
are hard-denied (HTTP 403) on everything outside engagement-scoped routes plus the
identity/persona routes (and a couple of ledger paths) by a central boundary. So a
restricted persona on an account/CRM route returns 403 — not a filtered/empty 200.
Assert the exact 403.

**Why:** these two facts repeatedly cause false greens (expecting RLS narrowing that
never happens) or wrong-mode assertions (expecting filtered rows where the real
contract is a hard 403).
