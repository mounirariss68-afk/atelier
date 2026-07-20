---
name: drizzle push embedding-column fix
description: Why db push used to abort and how the pgvector column is now schema-declared
---
`drizzle-kit push` (post-merge + dev) used to ABORT on a data-loss prompt: the raw-SQL-added `embedding vector(384)` column on atelier_document_chunk_embeddings wasn't in the Drizzle schema, so push proposed dropping it and non-interactive runs died. That silently kept ALL newer schema (signatories table, firm_signature_requested_* cols, reference sequences, ms_meeting_logs) out of the main dev DB — and therefore out of the Publish dev→prod diff.
**Why:** Publish introspects dev DB vs prod DB; if push never lands changes in dev, prod never gets them.
**How to apply:** the column is now declared in Drizzle (`vector("embedding", { dimensions: 384 })` in atelier-cli-rag.ts) so push is clean — never remove it. atelier-cli-rag.sql stays as idempotent boot self-heal. Push also emits DISABLE ROW LEVEL SECURITY for all tables; post-merge re-applies atelier-rls.sql right after — keep that ordering.
