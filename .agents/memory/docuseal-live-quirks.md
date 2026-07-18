---
name: DocuSeal live API quirks
description: Behaviors of the real DocuSeal Cloud API that the local stub never enforced.
---

Verified live (2026-07-17) with a full send → complete → archive cycle against api.docuseal.com.

- **Templates must contain fields.** POST /submissions on a field-less template fails 422 "Template does not contain fields". The template-from-PDF call now stamps one required signature field per signer (roles "Signer 1..N") on the LAST page; createSubmission must send matching `role` per submitter.
- **Field areas use 1-based page numbers** ("page must be more than 0"). Coordinates are relative 0–1; last page index comes from `unpdf` (`getDocumentProxy(...).numPages`) — pdf-lib is NOT an api-server dependency.
- A submitter can be completed programmatically via `PUT /submitters/:id {completed:true}` even with a required signature field — useful for live e2e probes (`scripts/esign-live-probe.ts`, self-cleaning).
- Completion archives signed PDF **and** a separate audit-trail PDF (audit_log_url is populated on Cloud) as category "contract".
- **Why:** the stub test server accepts field-less templates, so only a live run catches these; keep the stub payload-shape agnostic.
- **How to apply:** any change to template/submission payloads should be re-verified with the live probe when DOCUSEAL_API_KEY is present.
