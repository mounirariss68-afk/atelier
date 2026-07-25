---
name: Atelier payroll/VAT/CT/close probes
description: Quirks when testing the finance close stack (payroll runs, VAT return, CT provision, reopen)
---
- Close Controller `ar_tie` auto-check compares GL 1100 vs invoice subledger: probe/manual journals must debit cash (1000), not 1100, or sign-off is blocked.
- Payroll matches employees by fuzzy token contains-match of employees.employingEntity vs entity jurisdiction/shortName/legalNameEn (lowercased); no explicit FK yet (follow-up filed).
- CT provision accrual is autoReverse:false (Dr 6950/Cr 2400); default accrual autoReverse:true → approval also posts flipped journal dated 1st of next period, 409 next_period_locked if that period's GL is locked.
- Reopen releases the period lock only if no OTHER signed-off cycle shares the period.
**How to apply:** when extending finance-654-probe.ts or close/payroll/vat routes.
