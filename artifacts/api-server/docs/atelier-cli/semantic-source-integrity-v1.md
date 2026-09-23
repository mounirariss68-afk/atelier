# Semantic Source Integrity v1

Status: approved for the bounded legal-entity/document pilot on 2026-09-23 after independent architecture review.

## Decision

Atelier keeps PostgreSQL domain records as the authority for identity, lifecycle, access, currentness, and writes. Semantic indexes are disposable, untrusted projections. They may rank already-authorized live records, but they never establish that a record exists, is current, is visible, or can be changed.

Claude may classify a request into reviewed concepts and narrate authorized results. It cannot authorize access, select a stale source over a current pointer, confirm an action, or infer permission from a graph relationship.

## Source-authority map

| Concern | Canonical source | Derived source | Authorization owner | Fail-closed rule |
| --- | --- | --- | --- | --- |
| Legal-entity identity and status | `atelier_legal_entities` | Future aliases and relationship projections | Finance entity routes and partner role gate | No canonical entity means no semantic identity |
| Current CT/VAT certificate | The matching registration entry’s `certificateDocumentId` | Document `entityId`/`docKind`, chunks, embeddings | Finance entity registry | Document links never override the registration pointer |
| Current library bytes | Active document plus `currentVersionId` and matching version/blob | Chunk embeddings | Document Library ACL | Replaced, deleted, inaccessible, or opted-out versions return no evidence |
| CRM/entity candidates | Live domain row | `atelier_entity_embeddings` | Existing domain ACL helpers | Candidate is reloaded and authorized before ranking or disclosure |
| Extracted chat evidence | Live extracted attachment owned/scoped to the actor | Chunk embeddings | Attachment ownership and stamped account/engagement scope | Deleted or non-extracted attachments return no evidence |
| Confirmation authority | Durable assistant action with pinned manifest, policy, input digest, target revisions, and state version | Confirmation UI snapshot | Riser action runtime | Drift or version mismatch invalidates execution |
| Outlook outcome | Durable action/outbox state and provider response | Chat narration | Durable document-email executor | Interrupted or ambiguous transport becomes unknown and cannot be retried blindly |

## Lifecycle rules

1. Each legal entity has at most one CT registration and one VAT registration. Replacing a certificate atomically releases the obsolete document association and claims the new certificate while preserving the old document, versions, bytes, and audit history.
2. Generic document edits cannot create, move, clear, or reclassify a current tax-certificate pointer. Those changes go through the legal-entity registry.
3. Generic create, delete, and version routes cannot create, purge, or supersede a registry-owned tax certificate. Certificate replacement goes through the legal-entity registry.
4. Semantic retrieval joins back to live source records on every read. Delayed projection cleanup therefore affects recall or storage only, never disclosure correctness.
5. Exact IDs and vector hits follow the same actor-aware authorization path.

## Provider boundary

Company-document email uses the existing Riser action state machine. Preview pins exact document/version revisions and canonical recipients. Confirmation rechecks policy, source versions, access, connection scopes, and bytes before a fenced execution claim.

The outbox claim is recorded before Microsoft Graph is called. Graph does not provide a general exactly-once guarantee for these operations. Network timeouts, interrupted execution, and server-side failures where acceptance is uncertain are recorded as `unknown`; repeat execution is blocked pending reconciliation.

## Kill switches

- `ATELIER_SEMANTIC_RETRIEVAL_ENABLED=false` disables vector/entity and document-chunk semantic retrieval. Deterministic source screens and manual selection remain available.
- `DURABLE_DOCUMENT_EMAIL_ENABLED=false` disables company-document email preview and execution. It never restores the legacy direct Graph path.

## Migration and backfill

The rollout is additive. The semantic projection migration enables and forces org RLS on existing projection tables and creates org-isolation policies only when a table exists. No source data is rewritten and no server-boot backfill is required.

Before enabling:

1. Apply the migration in a production-like database and rerun it to prove idempotence.
2. Verify every projection table has forced RLS and its org policy.
3. Check current CT/VAT registration pointers refer to active same-org documents and distinct files.
4. Check each active library document’s current version exists and has a blob reference.
5. Run source-integrity, Riser foundation, chat reliability, document, and finance lifecycle probes.

Validation evidence for this decision includes a rerunnable migration probe, forced-RLS inspection, both concurrent tax claim/purge orderings, stale-versus-live Outlook execution classification, a full API build, Riser foundation, chat reliability, and a clean API restart.

## Observability

- Durable action events expose preview, confirmation, execution, invalidation, terminal state, and correlation ID.
- Outbox state distinguishes sending, delivered, failed, and unknown.
- Existing Riser observations report policy, action, and capability stages without logging decrypted input or provider payloads.
- Operators should alert on unknown outbox rows, prolonged executing actions, source-drift invalidations, and sudden retrieval-empty rates.

## Rollback

1. Set both kill switches to `false`.
2. Leave durable actions/outbox rows intact; reconcile unknown outcomes before any new attempt.
3. Keep projection RLS enabled. Do not roll back to unscoped embedding reads.
4. Use source-backed UI/manual document selection while diagnosing.
5. Roll forward with an additive fix; do not overwrite production data from development.

## Explicit exclusions

This decision does not approve broad enterprise graph ingestion, arbitrary natural-language SQL, automatic identity merges, inferred authorization, autonomous email sending, or replacing PostgreSQL authority.