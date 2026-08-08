---
name: Entity embeddings backfill
description: Semantic entity index (atelier_entity_embeddings) gap-fill — now a boot chore; prod self-heals on deploy; idempotent, no cleanup of deleted-entity rows.
---
- The gap-fill is a boot chore in api-server startup (shared lib `entity-embedding-backfill`, runs under the same advisory lock as the RAG chunk backfill), so production self-heals on every deploy — including go-live. No manual prod step remains.
- `artifacts/api-server/scripts/backfill-entity-embeddings.ts` is a thin wrapper for manual dry-run/apply on dev (run from artifacts/api-server: `pnpm exec tsx scripts/...`); dev re-applied clean 2026-08-08.
- **Why:** the workspace has no prod write credentials (read-only replica), so a "run script on prod" step could never be executed by the agent; boot-time self-heal is the only reliable path. Embeddings come from the vendored local MiniLM model — no external API, cheap at this scale.
- Backfill only fills gaps (missing row or stale label); it deliberately leaves embedding rows for deleted entities, so row counts can exceed live source rows — orphans in spot-checks are expected, gaps are not.
- mirrorEntityEmbedding swallows per-row errors; verify success by re-collecting gaps, not by return codes.
