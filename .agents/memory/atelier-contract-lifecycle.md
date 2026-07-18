---
name: Atelier contract lifecycle quirks
description: Non-obvious design decisions in the Word-contract lifecycle (templates → fill → redline → sign).
---

- Document kinds are `generated_draft | final_docx | converted_pdf | signed_pdf` — there is NO "redline" kind. `POST /contracts/:id/final` always records `final_docx` (status `final_uploaded`); docx→PDF conversion happens at send-for-signature time (`converted_pdf`), not at upload.
  **Why:** external redlines are just intermediate final uploads; converting once at send avoids stale PDFs.
- Regenerate/create/final routes respond 201 with only the NEW document in `documents`; fetch GET /contracts/:id to see the full chain.
- Me lens: employee/contractor personas are hard-gated to `/me/*`, so their contracts are served by bespoke `GET /me/contracts` (raw fetch in UI, not in OpenAPI); rows render unlinked because `/contracts/:id` is partner-tier.
- Manual PATCH to signature-driven statuses (signed/declined/expired/out_for_signature) → 409; terminal statuses never regress.
- Probe: `pnpm --filter @workspace/api-server test:contracts` — stub Anthropic + stub DocuSeal booted before app import; DocuSeal stub must serve `documents[{url}]` for completion archiving.
