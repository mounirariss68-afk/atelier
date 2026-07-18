---
name: RAG fresh-DB provisioning
description: Why boot-time raw SQL batches must be fresh-DB safe and how doc-embedding ingest self-heals the pgvector column.
---
# RAG fresh-DB provisioning

**Rule:** any boot-time raw SQL batch (`db.execute(sql.raw(file))`) runs as ONE implicit transaction. If any statement references a table that `drizzle push` hasn't created yet (fresh DB, boot-before-push race), the WHOLE batch rolls back — including `CREATE EXTENSION`. Guard every table-touching statement with `to_regclass(...)` checks inside DO blocks.

**Why:** on a freshly pushed DB, the pgvector `embedding` column on `atelier_document_chunk_embeddings` was never created (boot batch had aborted earlier), and document ingest failed on the vector-mirror UPDATE → uploads got 0 chunks, invisible to AI search.

**Second trap:** Drizzle wraps pg errors as `Failed query: ...` with the real message on `err.cause`. Regexing only `err.message` for "column does not exist" misses it — walk the cause chain and/or check pg codes 42703/42704.

**How to apply:** ingest now self-heals — `populateEmbeddingColumn` detects the missing column, runs `ensureDocEmbeddingColumn()` (exported from rag-bootstrap) and retries once; genuine pgvector absence degrades to jsonb brute-force cosine, never fails ingest. Keep this pattern for any new boot-provisioned DDL.
