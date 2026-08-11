---
name: Home assigned-to-me roll-up
description: Contract of GET /atelier/my-open-tasks and the shared owner validation for assignable writes.
---

- GET /atelier/my-open-tasks returns `{items, openCount, overdueCount}` where items merge THREE sources: account activities, account plan actions (open + in_progress), and engagement RAID items (open, live-parent-joined). The old `tasks: AtelierActivity[]` shape is gone.
- Each item carries `kind` (activity | plan_action | raid) and a server-built `href` (plan actions deep-link `?tab=account_plan`); the Home card renders `href` directly — new item kinds must supply it.
- **Why:** work assigned via plan/RAID surfaces was invisible on Home, and the card used to hide on fetch errors; it now shows an error state (isError branch), only hiding when genuinely empty.
- **How to apply:** any NEW assignable entity (e.g. account risks also have ownerId but are NOT included) should be added to this endpoint, not a new card. Owner ids on any assignable write surface (REST or chat/CLI) must be validated via the shared `isValidOrgOwner` helper (`api-server/src/lib/atelier-owner-validate.ts`) or "assigned" items point at non-users and vanish from every roll-up. Regression probe: `test:my-work`.
