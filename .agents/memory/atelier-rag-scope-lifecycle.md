---
name: Atelier CLI RAG scope, fail-loud & injection model
description: How document chunk authorization scope, deletion lifecycle, fail-loud, and injection-safety are wired in the Atelier CLI RAG pipeline
---

# Atelier CLI document RAG — scope, lifecycle, safety

## Chunk authorization scope is stamped at LINK time, not upload time
- Attachments link only to user/session/turn — they have NO account/engagement column.
- Chunk rows (`atelier_document_chunk_embeddings`) carry `accountId`/`engagementId`, but
  they are born NULL (uploader-scoped) because upload precedes any entity link.
- Scope is stamped by `setChunkScope()` inside the ingest capabilities AFTER they link
  the doc: `ingest_rfp_to_opportunity`→accountId, `ingest_transcript_to_raid`→engagementId,
  `ingest_receipts_to_expenses`→engagementId (only when an engagement is supplied;
  wallet-only receipts stay uploader-scoped). Deck→firm_profile and spreadsheet→assets
  are org-wide, so they intentionally stamp NO scope.
- The retrieval ACL (`aclPredicate`) keys off these columns: privileged roles see all org
  docs; everyone else sees uploads they own OR docs scoped to an account/engagement they
  can access. So forgetting to stamp scope = stricter-than-correct (members can't retrieve),
  never an ACL bypass.

## Deletion lifecycle: engagements are never hard-deleted
- Only accounts have a real delete path (CLI `account_delete` capability soft-deletes the row).
- Engagements are only ever *closed* (a `plmStage` transition), never hard-deleted.
- Therefore engagement-scoped doc purge rides on the OWNING ACCOUNT's deletion:
  `account_delete` calls `purgeAttachmentsByScope({accountId})` plus one per child engagement.
- `purgeAttachmentsByScope` / `attachmentIdsByScope` REFUSE to run without a scope predicate
  (would otherwise match the whole table). Purge drops blob + chunk vectors + soft-deletes
  the attachment row.

## Fail-loud (no silent lexical-only fallback)
- `searchDocumentChunks` embeds the query ONCE, up front, OUTSIDE any try/catch — a model
  load failure throws out of the whole function; the lexical pass never runs alone.
- The pgvector-missing `catch` only swaps ANN for brute-force cosine (reusing the already
  computed vector), it does NOT swallow embed failures.
- Boot `warmEmbedder()` failure calls `process.exit(1)` (logger.fatal) — a broken model
  crashes boot rather than degrading search invisibly.

## Injection-safety in search_documents
- `safeBlocks` (inert `<attachment>`-wrapped bodies) is the ONLY channel carrying chunk text
  to the model. `results[]` deliberately omits raw `text`/`summary`.
- The orchestrator serializes the whole tool-result `data` into a `tool_result` frame, so any
  raw field there reaches the model — keep document-derived text out of `results[]`.

## Query rewriting
- Multi-turn follow-ups: the handler passes `summarizeSessionDraft(ctx.sessionId)` as
  `contextHint`; it is prepended to the embedded query ONLY (lexical pass still matches the
  raw query so the hint can't dilute keyword precision).

## Retrieval audit
- Every `search_documents` run inserts an `atelierAuditEvents` row (`cli_document.retrieve`)
  with query + citations + attachmentIds — never chunk bodies.
