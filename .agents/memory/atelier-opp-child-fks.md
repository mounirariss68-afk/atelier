---
name: Opportunity-child FK integrity
description: Which opp children cascade vs detach on hard delete, and the orphan-cleanup-before-push rule.
---

- Opportunity hard delete now cascades via FK to: stage transitions, briefs, research facts, povs, proposals, deal pricings, win/loss debriefs. Engagements + prototypes detach (ON DELETE SET NULL).
- Meetings/transcripts are polymorphic (parent_type/parent_id) — NO FK possible; the CRM harness sweeps opp-parented meetings + their transcripts before deleting opps. Any new hard-delete path must do the same.
- **Why:** hard deletes only happen from tests/scripts (app path is soft-delete), and orphans previously leaked into dashboards/pulse reads.
- **How to apply:** before `pnpm --filter @workspace/db run push` that adds an FK, delete existing orphan rows first or push fails with 23503 — including orphans against FKs already in the schema that the isolated DB never enforced.
