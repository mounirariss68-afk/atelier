---
name: Atelier opportunity plm_stage retired
description: opportunity sales_stage is the sole stage source of truth; engagement plmStage is intentionally kept; push-based DB skips numbered-migration backfills.
---

# Opportunity plm_stage retirement

The opportunity `plm_stage` (and `final_plm_stage`) columns are **retired**. `sales_stage`
is the sole source of truth for opportunity stage. Canonical opp sales stages:
`suspect, prospect, convert, runner, contract, lost, no_decision, withdrawn`
(`contract` is the "won" bucket; `isWonStage` ⇔ `contract`).

**Why:** redundant dual-stage modeling caused drift and lockstep bugs; one gated
`applyStageTransition` service now drives every write path.

**How to apply:**
- Never reintroduce an opportunity plm_stage read/write. Map any legacy plm value to
  sales_stage via the `resolveSalesStage` / `deriveSeedSalesStage` helpers.
- **Engagements still keep their own `plmStage`** (identify/shape/pursue/mobilize/
  deliver/compound/won/lost/no_go/closed). Generated api-zod `plmStage` enums on
  `AtelierListEngagementsResponseItem` / `AtelierGetEngagementResponse` are correct —
  do not "clean" them.
- The seed keeps a `plmStage` field on its in-memory authoring objects only; the opp
  INSERT writes `sales_stage` (derived), never the dropped column.

# push-based dev DB skips numbered-migration backfills

`pnpm --filter @workspace/db run push` (drizzle schema diff) does NOT run the numbered
SQL migrations in `lib/db/drizzle/*.sql`. Any test asserting *data* a numbered migration
backfilled — e.g. `tests/funnel/funnel.test.ts` checking `atelier_audit` rows with
action `opportunity.funnel_migrated_5stage` (migration 0027) — will FAIL in this env.

**Why:** that is an environmental/history-dependent failure, not a code regression.
**How to apply:** don't chase it as a bug from a schema/column change; only `test-crm`
is wired into a workflow and is the authoritative CI signal.
