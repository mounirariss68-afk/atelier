---
name: Contract templates ingested in main env
description: Task-agent DB data doesn't merge; templates/entities must be re-ingested on main. Done 2026-07-19.
---
Task agents run on isolated DBs — only code merges back. A merged "ingest templates" task leaves the main dev DB empty; re-run ingestion via the live API on main.

**How it was done (2026-07-19):** login as founding partner, `PUT /api/atelier/firm-profile/legal-entities` (Dubai LLC entity, isDefault), then per .docx in `attached_assets/`: `POST /contract-templates` (multipart `file` + `name` + `contractType`) → returns detected `fieldSchema` → `PUT /contract-templates/:id/fields` with `{fields: fieldSchema}` (activates). All six firm templates active: mutual NDA, contractor NDA, internship offer, non-equity partner agreement, 2× partnership MoU.

**Legal-entity registry (2026-07-19):** Dubai LLC also re-ingested into `atelier_legal_entities` via the live API: uploaded the 6 official PDFs as `corporate_legal` vault docs, ran `POST /finance/entities/extract` per doc, merged proposals (owners from the MoA proposal — the Ejari "Owner" is the building lessor, not a shareholder), `POST /finance/entities`, then PATCHed each doc with `entityId`. Firm-profile `legalEntities` was emptied so the registry entity is the sole/default signing entity.

**NDA quote/reference fix (2026-07-19):** `artifacts/api-server/scripts/nda-quote-fix.ts` is an idempotent one-off that patches the contractor-NDA template blob (stray outer quotes on the Receiving Party line), stamps role "reference" on reference_number, and regenerates the affected draft. Because DB rows don't merge, it must be RE-RUN on main (and prod) — `nda-quote-inspect.ts` verifies. **Applied on main 2026-07-21**: template blob+schema fixed; the Nazgul NDA had meanwhile gone out_for_signature with the defective doc, so (user-approved) the DocuSeal request was voided, the draft regenerated (CGNR-NDA-U-2026-001) and resent sign-first by Mounir. Fix script refuses non-draft statuses — a live signature request needs voidSignatureRequest + status reset first. PROD still pending before go-live. The sequences table `atelier_contract_reference_sequences` may be missing on fresh DBs (drizzle push wants to drop the pgvector embedding column — abort and CREATE TABLE manually instead).

**Gotchas:** curl `-F file=@path` silently fails (HTTP 000) when the path has `,`/`&` — copy to a simple /tmp name first. Dev DB data won't be in production; the same ingestion must be repeated on the deployed app (or data migrated) before go-live.
