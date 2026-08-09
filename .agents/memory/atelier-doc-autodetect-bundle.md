---
name: Person-doc expiry auto-detect & side=all bundle
description: Upload-time date detection for ID docs and the one-file front+back download bundle
---

**Rules:**
- Upload-time expiry/issue/docNumber detection lives in the shared `atelier-doc-dates` helper (vision for images, unpdf text for PDFs). It only fills fields the user left blank, is best-effort (try/catch, never blocks the save), and skips payloads <4KB so offline probes with garbage bytes never hit the live model. New document-save surfaces (e.g. chat) should reuse this helper, same guards.
- `GET /me/documents/:id/download?side=all` is the ONE-file share for two-sided docs: 2-page PDF for jpeg/png pairs, ZIP otherwise, via the `personDocBundle` lib. pdfkit throws synchronously on corrupt image bytes — the bundle MUST keep its ZIP fallback or the route 500s. No back side ⇒ degrades to plain front stream.
- Clients (mobile card tap, web Download button) always request `side=all` when `hasBackFile`; there is deliberately NO separate back-side open affordance anymore (back replace stays in the ⋮ sheet). The mobile doc-open probe pins this.

**Why:** user-reported: visa expiry wasn't detected, and two-sided IDs shared only one side.

**How to apply:** dev DB was backfilled (one-off script ran extractDocumentDates over expiry-less docs). Re-run that backfill on prod at go-live — DB data never merges.
