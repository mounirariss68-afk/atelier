---
name: CRM dummy-data wipe
description: Dev DB dummy clients/opportunities were wiped; which boot seeds are gated and how to re-wipe.
---
The Atelier dev DB CRM slate (accounts, opportunities, and every dependent record) was wiped on 2026-07-16.

**Rule:** boot must never resurrect dummy CRM rows. `atelier-seed-l2c` and `atelier-seed-account-plan` deliberately log+skip when their demo accounts are absent — keep any new demo seed behind the same "skip if demo parents missing" gate.

**Why:** the user tests CRM flows from a clean slate; silent re-seeding on restart would corrupt that.

**How to apply:** if dummy rows reappear, re-run `cd scripts && pnpm tsx src/wipe-crm-dummy-data.ts` (idempotent, self-verifying, preserves users/auth/org/reference data). The test-crm harness transiently creates+cleans its own tagged rows — that is not reseeding.
