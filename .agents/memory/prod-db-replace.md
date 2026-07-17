---
name: Production DB replace path
description: How production database data/schema can (and cannot) be changed from the agent side.
---
Agent access to the production DB is read-only (replica, SELECT only); no prod credentials exist in the workspace. Direct prod DDL/DML, pg_dump|psql pipes, or deploy-hook migrations are forbidden by platform policy.

**Why:** Publish flow is the only supported mutation path — it diffs dev vs prod schema on Publish, and the user can pick "Overwrite data" in the Publish UI for a wholesale dev→prod data replace.

**How to apply:** For any "sync/copy/migrate prod DB" request: clean dev (orphan FK rows block `drizzle-kit push` — see db-push-orphan-fk), verify dev push is clean, take backups (prod via chunked read-only base64 JSON exports through executeSql; ~40 rows/chunk for embedding/transcript tables or the call dies on payload size), then tell the user to Publish with Overwrite data. RLS policies/functions already exist in prod and survive; new tables without table-level policies in dev need none in prod either.

Pre-replace prod snapshot (2026-07-17, 18,157 rows) lives at backups/prod-backup-2026-07-17.tar.gz.
