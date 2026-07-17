---
name: db push blocked by orphaned FK rows
description: drizzle-kit push fails with FK violations when old test rows are orphaned; delete orphans then re-push.
---
`pnpm --filter @workspace/db push` re-validates FK constraints; leftover orphaned rows (e.g. `opp_t542-*` test rows in `atelier_opportunity_stage_transitions`, `atelier_engagements`, `atelier_winloss_debriefs` pointing at deleted opportunities) abort the push with error 23503.

**Why:** older suites created rows without cleanup; push touches those tables even for unrelated column adds.

Push can also stall on an interactive create-vs-rename column prompt (no TTY answer possible from the shell): apply the ambiguous column manually via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` with the schema's type/default, then re-push — the ambiguity disappears.

**How to apply:** on a push FK failure, delete orphans generically (`DELETE FROM <t> WHERE NOT EXISTS (SELECT 1 FROM parent ...)`) for every table holding the referencing column, then re-push. Also rebuild `lib/api-zod` (`tsc -b --force`) if api-server typecheck reports missing `@workspace/api-zod` exports — stale dist, same failure mode as lib/db.
