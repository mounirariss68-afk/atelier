---
name: Win/Loss orphan defenses
description: How opportunity deletion interacts with Win/Loss debriefs and Pane A dashboard items
---
Rule: atelier_winloss_debriefs.opportunity_id has an ON DELETE CASCADE FK to atelier_opportunities (the only FK in an otherwise FK-free schema). Pane A items are polymorphic (hrefKind/hrefTargetId) so they CANNOT get an FK — GET /home defensively filters opportunity-kind items whose opp is missing or soft-deleted, and GET /win-loss/debriefs filters debriefs the same way.

**Why:** the stage-transition close hook creates debrief + Pane A rows; test harnesses hard-delete opportunities straight through the DB, which used to leak orphans onto the dashboard.

**How to apply:** any new opportunity-child table should either get a cascade FK or defensive read filtering; any new pane-item kind needs its own orphan filter in /home. The CRM harness cleanup also sweeps debriefs + pane items by opportunity id before deleting opps. Probe: `artifacts/api-server/tests/crm/probe-winloss-orphans.ts` (deterministic, mock agents).
