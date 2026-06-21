---
name: Atelier account strategy objectives are not statically seeded
description: Why goal-progress upserts (PUT /accounts/:id/goals/:objectiveId) can 404 on a cold/test DB.
---

The account `accountStrategy.objectives` array is normally authored by a partner
or proposed by the Account Cartographer agent — it is empty on a cold/test seed.

**Why:** Several places (the account-plan goal-progress seed, the CRM harness)
reference objective ids like `obj_a` and assume they exist on the strategy, but
nothing wrote them there. The goal-progress upsert route validates the
objectiveId against `account.accountStrategy.objectives` and returns 404
`objective-not-found` when it is missing — so the whole CRM suite goes red.

**How to apply:** If a route/test depends on a strategy objective existing,
backfill it idempotently (the account-plan seed `ensureStrategyObjectives()`
writes `obj_a` onto acc_tasama). Don't assume agent-generated strategy fields
are populated in seed/test runs.
