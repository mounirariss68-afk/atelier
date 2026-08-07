---
name: Entity embeddings backfill
description: Semantic entity index (atelier_entity_embeddings) backfill script — prod rerun needed at go-live; idempotent, no cleanup of deleted-entity rows.
---
- `artifacts/api-server/scripts/backfill-entity-embeddings.ts --apply` is dry-run by default, idempotent; run on dev (done 2026-08-07) and MUST re-run on production at go-live (task-branch/dev DB data never merges).
- Table column is `target_id` (not entityId); script imports db via `@workspace/db`.
- **Why:** backfill only fills gaps; it deliberately leaves embedding rows for deleted entities (resolver tolerates missing targets), so row counts can exceed live source rows.
- **How to apply:** at go-live, run the script against prod; extra/orphan rows in spot-checks are expected, gaps are not.
