---
name: Agent registry backup restore
description: Restoring atelier_agents from the 2026-07-17 backup — status field is unreliable, use an ID allowlist
---
The 2026-07-17 prod backup marks 24 agents "mvp", but only 8 MVP + 5 registered were confirmed implemented.
**Why:** backup status was inflated; restoring by status would resurrect unimplemented agents.
**How to apply:** any further registry restore must pin an explicit ID allowlist (see scripts/src/restore-agents-from-2026-07-17-backup.ts); never re-add a seeder. Prod copies rows only via Publish "Overwrite data".
