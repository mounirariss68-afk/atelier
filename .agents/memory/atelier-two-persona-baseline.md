---
name: Atelier two-persona baseline
description: Only founders exist as users; all RBAC test personas are ephemeral, provisioned by the harnesses themselves.
---

The only seeded atelier_users are the two founding partners (see the auth credential seed for their ids). All other demo personas were deliberately purged — from seed-atelier, the api-server boot seeds, and the DB.

**Why:** User requested removal of all dummy personas and everything they touched; RBAC test coverage had to survive without seeded non-founder users.

**How to apply:**
- Never reintroduce non-founder personas into any seed. Actor/lead notNull columns on founder-owned seed records point at a founder.
- RBAC tests (CRM harness, UAT probes, dedupe probe, CLI suite) provision EPHEMERAL personas (ids like p_test_*) via direct db.insert at start and delete them in finally cleanup, including their engagement-access grant rows. Scoping semantics: senior_manager = lead grant on eng_tasama_bpo_phase1; consultant = member grant on eng_dge_effortless_v1; restricted = partner_firm_resource grant; no-access = employee with no grant.
- seed-atelier does NOT truncate every table (timesheets, calendar events, skills, wallet, partner-firm hours use idempotent inserts) — a seed-code purge alone leaves orphans; scan all atelier% text columns for stale ids after destructive seed edits.
- scripts/src/test-task-254-routes.ts hits the live server with persona cookies only; since the auth lockdown every such request 401s — the script needs an authenticated environment to be meaningful.
