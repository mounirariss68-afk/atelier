---
name: Atelier DocuSeal e-sign invariants
description: Design decisions for the e-sign (Agreements) feature — webhook trust model, status derivation, archival, config gating.
---

# Atelier DocuSeal e-sign

- Webhook is a TRIGGER only, never trusted data: any webhook hit just schedules an authoritative re-fetch from the DocuSeal API. Polling (`startEsignPolling`) is the fallback; both funnel through the same `syncEsignRequest`.
  **Why:** webhook payloads are unauthenticated-ish and can arrive out of order; a single sync path prevents state regressions.
- Terminal request statuses (completed/declined/voided/expired) never regress; expiry is derived locally from `expiresAt` in `deriveRequestStatus`, not from DocuSeal.
- On completion, TWO documents are archived into the Document Library via `createDocument`: signed PDF + separate audit-trail PDF, kind "contract".
- Routes are partner-gated (founding_partner/partner) and `@cli-skip` annotated; DocuSeal errors surface as 502 `DocusealError`. Public webhook mounted before the global auth gate with optional `DOCUSEAL_WEBHOOK_SECRET` (timing-safe `x-docuseal-secret` compare).
- App degrades gracefully without `DOCUSEAL_API_KEY`: Agreements UI shows an "unconfigured" banner; no crashes. Key is a single shared secret — DocuSeal bills per dashboard seat ($20/mo) + $0.20/completed doc; signers are free, so one seat serves the whole firm.
- Tests: `tests/esign/run.ts` (script `test:esign`) uses a local stub DocuSeal server + env set before app import; ephemeral atelier_users inserts need email, initials, roleLabel (NOT NULLs).

**How to apply:** any new e-sign surface must reuse the sync engine (never write status from webhook payloads) and keep the single-key config model.
