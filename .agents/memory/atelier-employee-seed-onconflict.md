---
name: Atelier employee seed onConflictDoNothing
description: New atelier_employees columns won't backfill on re-seed unless added to the idempotent update loop
---

The employee insert in `scripts/src/seed-atelier.ts` uses `.onConflictDoNothing()`.
On a re-seed, the COGNIRISE-000x rows already exist, so the insert is a no-op and
any newly-added column keeps its DB default (e.g. `[]` / null) — the seeded values
in the EMPLOYEES array are silently ignored.

**Why:** the seed is meant to be re-runnable; first insert is do-nothing on conflict.

**How to apply:** when you add a column to `atelierEmployees` and want seeded values
to land on existing rows, also add it to the idempotent per-employee `db.update(atelierEmployees).set({...})`
loop near the bottom of seedAtelier (the same loop that sets utilizationTargetPct),
not just to the EMPLOYEES array. Verify with a psql query after re-seeding.
