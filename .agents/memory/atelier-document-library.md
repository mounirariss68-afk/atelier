---
name: Atelier Document Library invariants
description: ACL/dedupe/ingestion invariants for the external-docs library (documents/versions/access)
---

- Chunk embeddings are keyed on the **version id** (attachment_id); superseding a version purges the old version's chunk rows; the retrieval ACL grant clause matches on `currentVersionId`.
- **Per-person grants are org-level-only.** Scoped (account/engagement) docs are governed solely by the account/engagement ACL; the grant route rejects scoped docs (400 `grants-org-level-only`) AND the retrieval grant clause re-asserts `account_id IS NULL AND engagement_id IS NULL` so a stray grant row can never widen the scoped ACL.
- Partners/founding partners bypass the retrieval ACL entirely (predicate returns null), which covers org-level docs; non-partner "all engagements" personas still need explicit grants for org docs.
- Blob dedupe is by sha256 with a refcount — deleting one document must NOT drop a blob still referenced by another version row.
- Upload MIME is whitelisted (pdf/office/text/json/eml/images). `application/octet-stream` is rejected 422 `mime-not-allowed:*`. Deterministic tests: upload garbage bytes as `application/pdf` — extraction fails → 0 chunks → no live embedding call.
- AI-retrieval toggle audits as action `document.update` (payload `{aiRetrieval}`), not a dedicated action name.
- **Why:** grants-widen-ACL was flagged as a security leak in review; the org-level-only boundary is the fix and must hold at both layers.
- **How to apply:** any change to versioning, purge, grants, or the ACL predicate must preserve the org-level-only grant boundary and version-id chunk keying.
