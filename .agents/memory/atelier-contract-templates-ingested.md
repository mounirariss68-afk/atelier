---
name: Contract templates ingested in main env
description: Task-agent DB data doesn't merge; templates/entities must be re-ingested on main. Done 2026-07-19.
---
Task agents run on isolated DBs — only code merges back. A merged "ingest templates" task leaves the main dev DB empty; re-run ingestion via the live API on main.

**How it was done (2026-07-19):** login as founding partner, `PUT /api/atelier/firm-profile/legal-entities` (Dubai LLC entity, isDefault), then per .docx in `attached_assets/`: `POST /contract-templates` (multipart `file` + `name` + `contractType`) → returns detected `fieldSchema` → `PUT /contract-templates/:id/fields` with `{fields: fieldSchema}` (activates). All six firm templates active: mutual NDA, contractor NDA, internship offer, non-equity partner agreement, 2× partnership MoU.

**Gotchas:** curl `-F file=@path` silently fails (HTTP 000) when the path has `,`/`&` — copy to a simple /tmp name first. Dev DB data won't be in production; the same ingestion must be repeated on the deployed app (or data migrated) before go-live.
