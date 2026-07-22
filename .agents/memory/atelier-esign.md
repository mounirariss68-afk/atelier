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
- Counterparty typed answers (second-party fieldValues) merge once on completed→signed; a status-neutral backfill on contract-detail open (backfillSecondPartyValues) is the repair path — it swallows DocuSeal fetch errors and must never touch status.
- Tests: `tests/esign/run.ts` (script `test:esign`) uses a local stub DocuSeal server + env set before app import; ephemeral atelier_users inserts need email, initials, roleLabel (NOT NULLs). If the reused crm_test scratch DB is stale, drizzle push can hit an interactive rename prompt and wedge — `DROP DATABASE crm_test WITH (FORCE)` and re-run.
- Contract sends anchor signature/date/text boxes to the real signature-block labels (pdf text scan of last 3 pages; counterparty column matched by label). Fallback is the legacy default layout when no anchors found. pdf.js y-origin is bottom-left: `yNorm = 1 - (y+h)/pageH`.
- Signer invite emails are Cognirise-branded (`emailMode:"branded"`): submissions created with `send_email:false`, app emails each actionable signer its DocuSeal slug link via sendEmail/Resend. Delivered ONLY when `ok && via==="resend"`; otherwise signer row shows "Email not delivered" + sender copies the signing link (bespoke raw-fetch route). Legacy null-emailMode requests keep DocuSeal emails. Sequential order preserved: next signer emailed on sync when they become actionable.
- Branded invites require a VALIDATED from-address (`getBrandedFromAddress`: RESEND_BRANDED_FROM → RESEND_FROM → connector from_email, syntax-checked) — none valid ⇒ invite not sent, marked undelivered; the general sendEmail dev fallback sender must never be used for signer-facing mail.
- docx→PDF conversion uses bundled Plus Jakarta Sans TTFs via a temp HOME fonthome for soffice (faithful fonts).

**How to apply:** any new e-sign surface must reuse the sync engine (never write status from webhook payloads) and keep the single-key config model.
