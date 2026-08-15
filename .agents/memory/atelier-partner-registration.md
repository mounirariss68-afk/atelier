---
name: Partner registration flow
description: Registration v2 docs/contacts, firm-doc registry, upload validation, contact suggestions
---
- Token purpose partner_registration; pre-auth upload/list/delete endpoints validate the token WITHOUT consuming (consume only at final submit, CAS-protected); rate-limited 10/15min per IP.
- "Registered" signal is firm.registrationCompletedAt (NOT cred.userManaged); firm bank columns write only via finance approve — registration/portal never touch payable bank details.
- Firm documents live in atelier_partner_firm_documents (pfdoc_*, reviewStatus pending|accepted|rejected, uploadedVia registration|portal|internal); bytes via partnerDocStorage (`partnerdoc:` prefix); wire never exposes fileRef.
- Upload validation is server-side: strict base64 (round-trip check) + magic-byte match against declared mime (pdf/png/jpeg only), 10MB cap; downloads set nosniff + shared httpFilename helper. **Why:** client mime labels are attacker-controlled on a pre-auth surface.
- Big JSON uploads need the path-scoped express.json({limit:"16mb"}) mounted BEFORE the global 100KB parser in app.ts — per-route parsers never see the body otherwise. New upload routes must be added to that path list.
- Firm-doc expiries surface as read-time pseudo-records in GET /roster/compliance (kind firm_doc:<kind>, personId null, partnerFirmId set → partnerBuckets); never written to compliance_records.
- Portal contact edits create atelier_partner_contact_suggestions (pending superseded by newer submission); internal approve REPLACES firm contacts (full-list semantics), re-attaching existing ids/personIds by email-then-name so stampContactPersons doesn't duplicate roster promotions.
- Internal review gate is requirePartnerAdmin (canEditPartnersLens), deliberately wider than the bank-changes finance/leadership gate. Decision literals on the wire: firm docs accepted|rejected, suggestions approved|rejected.
- Probe: pnpm --filter @workspace/api-server run test:partner-reg-docs (scratch DB, budgets around the pre-auth rate limit).
