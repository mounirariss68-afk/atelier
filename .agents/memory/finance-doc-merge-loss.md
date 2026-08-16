---
name: Merge collisions can silently delete capability code
description: Durable lessons from a task merge that corrupted the finance-doc chat capability file and collided a shared jsonb column.
---
- **Rule:** after multi-task merges touching the same file, don't stop at fixing the boot error — diff the file against its pre-merge revision. A duplicate-definition crash can mask a worse loss: whole blocks replaced by duplicated neighbors, with NO intact copy on any branch (task branches can carry the corruption too). Rebuild lost behavior from its probes and surviving helpers.
- **Rule:** two tasks writing different payload shapes to the same jsonb column is a merge landmine — give each shape its own column. When splitting after the fact, the data move cannot live in a SQL migration file: the DB deploys via push-based schema diffs that add columns but never move data. Idempotent data relocations must ride the api-server boot chores (guarded, cheap WHERE) so dev and prod both converge on redeploy.
- **Why:** a merge triplicated one capability block, deleted two others, and left extraction objects stranded in the old column; readers had moved on, so the data would have silently vanished from the UI in prod.
- **How to apply:** any post-merge repair = boot check + pre-merge diff + run the feature's probe suite (not just the suites for the code you touched).
