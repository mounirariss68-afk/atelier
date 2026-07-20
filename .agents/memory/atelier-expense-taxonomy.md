---
name: Atelier expense taxonomy surfaces
description: Self-scope allowlist + scratch-DB gotchas for the expense taxonomy/categorization feature
---

- Employee/contractor/recruiter/partner_firm_resource personas are hard-locked to `/me/*` by the central gate in `routes/atelier/index.ts`. Any NEW non-`/me` endpoint the Me-lens UI needs (e.g. `/wallet/expense-taxonomy`, `/wallet/expense-categorize/suggest`) must be explicitly allowlisted in EVERY persona branch of that gate or those personas get 403.
  - **Why:** the Me expense UI (web + mobile) is used by self-only personas; the taxonomy/suggest helpers live under `/wallet/*`.
  - **How to apply:** use/extend `isExpenseTaxonomyHelper()`-style predicates in the gate; keep endpoints read-only/reference-safe before allowlisting.
- Role gates alone are NOT tenant isolation: every by-id fetch on finance routes (bank accounts, engagements, expenses) must also filter `orgId = me.orgId` or founding partners can reach other orgs' rows (IDOR). The expense-taxonomy probe has cross-org 404 regression checks — keep them.
- `atelierLegalEntities` has NO `name` column — display name is `shortName || legalNameEn`; `legalNameEn` and `country` are NOT NULL (test inserts need both).
- Taxonomy rows are installed by `ensureExpenseTaxonomy()` at server boot; scratch/test DBs start empty — probes must call it after app import or every category-pair validation 400s.
- Expense create: `fundingSource=company_account` requires a registered active `fundingBankAccountId` (400 bank-account-required otherwise); BD/account context nulls entity/costCenter; internal context nulls bdIndustry.
- Taxonomy GET also returns org-scoped active `bankAccounts` (id + label only) so any submitter can pick the paying account; keep it label-only (no IBAN/sensitive fields).
- PDF export appendix embeds only JPEG/PNG receipts (pdfkit `doc.image`); other formats get an on-file note page; `atelier_expenses.capture_source` is NOT NULL (direct test inserts need it).
- Timesheet auto-approve (`autoApproveTimesheetExpenses`) must org-scope both the select and each update: timesheet week ids are deterministic (`tsw_<person>_<week>`), so a lookalike id in another org is reachable without the guard; VAT register rows carry the expense's orgId explicitly.
