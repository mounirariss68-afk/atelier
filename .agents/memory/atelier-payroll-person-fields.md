---
name: Atelier payroll person fields
description: How employee payroll fields (legal entity link, comp, currency) are written and why the dev data pass never merges.
---
Employee payroll fields (legalEntityId, baseCompensation, baseCurrency, basicWageMonthly, housingAllowanceMonthly, schemeRegisteredOn) are written ONLY via the dedicated `PATCH /roster/people/:id/payroll` route (comp-gated: canEditPeople or finance; employee-only; audits change:"payroll"; mirrors employingEntity text). They are field-locked out of the general person PATCH via SENSITIVE_EDIT_FIELDS.

**Why:** pay data keeps a single audited write path; payroll run validation (payrollRun.ts) requires entity link + comp + currency==entity currency + startDate + nationality per active employee.

**How to apply:** any new surface writing these fields must go through (or replicate the guards of) the payroll PATCH. UI calls it via raw fetch (route not in openapi). Note: dev-DB data passes filling these fields never merge — real values must be re-entered on main/prod via the UI.
